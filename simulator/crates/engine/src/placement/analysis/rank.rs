//! The ranking itself: every legal candidate scored across the rollouts' pre-windows.
//!
//! Twin of `rankCandidates` in the deleted `src/engine/analyze.ts`.

use super::window::{Context, Turn, block_vertex};
use super::{Board, Breakdown, DraftState, Recommendation, TakenVertex};
use super::{receives_second_settlement_grant, remaining_turns};
use crate::placement::app_formula::{Holdings, ScoreBreakdown};
use crate::topology::{Edge, Vertex};

/// One rollout's picks ahead of the analysed pick, and the board they leave.
pub(super) struct PreWindow {
    /// Every vertex the distance rule bars once the window's picks stand.
    pub(super) blocked: Vec<bool>,
    /// The settlements standing by then, each under the seat holding it.
    pub(super) vertex_owner: Vec<u8>,
    pub(super) edge_owner: Vec<u8>,
    /// Every seat's holdings by then: the board's, then the window's picks in order.
    pub(super) holdings: Vec<Holdings>,
    pub(super) taken: Vec<Vertex>,
    pub(super) roads: Vec<Option<Edge>>,
    pub(super) pickers: Vec<u8>,
    /// The rollout's uniforms by draft turn. Its mid-windows draw from the same row.
    pub(super) uniforms: Vec<f64>,
}

const NO_SCORE: ScoreBreakdown = ScoreBreakdown {
    production: 0.0,
    scarcity: 0.0,
    robber: 0.0,
    diversity: 0.0,
    port: 0.0,
    hand_value: 0.0,
    expansion: 0.0,
};

fn add_breakdown(target: &mut ScoreBreakdown, value: ScoreBreakdown) {
    target.production += value.production;
    target.scarcity += value.scarcity;
    target.robber += value.robber;
    target.diversity += value.diversity;
    target.port += value.port;
    target.hand_value += value.hand_value;
    target.expansion += value.expansion;
}

/// Whether `a` sorts ahead of `b`, each a vertex and its rank score: the higher rank score, then
/// the lower index. A NaN gap is no gap, so it falls through to the index.
fn ranks_before(a: (Vertex, f64), b: (Vertex, f64)) -> bool {
    let gap = b.1 - a.1;
    gap < 0.0 || (!(gap > 0.0) && a.0 < b.0)
}

/// The end `Array.prototype.slice(0, end)` cuts at: `end` truncated, NaN read as 0 and a negative
/// one counted back from the length.
fn slice_end(length: usize, end: f64) -> usize {
    let end = end.trunc();
    if end < 0.0 { length.saturating_sub(-end as usize) } else { length.min(end as usize) }
}

/// The recommendations, best first and cut to `max_results`, and the modal pre-window's picks.
///
/// `candidates` is the board's legal vertices in index order. `pick_offset` is which of the
/// player's remaining picks is ranked; past 0 the pre-windows hold the player's own earlier pick,
/// which is why each window's holdings for the player are read from the window. `progress`
/// receives the fraction of the candidates scored so far.
pub(super) fn rank_candidates(
    context: &Context<'_>,
    board: &Board,
    draft: &DraftState,
    candidates: &[Vertex],
    pre_windows: &[PreWindow],
    max_results: f64,
    pick_offset: usize,
    progress: &mut dyn FnMut(f64),
) -> (Vec<Recommendation>, Vec<TakenVertex>) {
    let topology = board.topology;
    let scorer = context.scorer;
    let vertex_count = topology.vertex_count();
    let mut taken_counts = vec![0_usize; vertex_count];
    for window in pre_windows {
        for vertex in &window.taken {
            taken_counts[usize::from(*vertex)] += 1;
        }
    }
    // The "likely gone" spots come from the modal pre-window. The picks are mutually legal,
    // ordered by draft turn, with their roads and frequencies across all rollouts.
    let Some(modal) = pre_windows.first() else {
        return (Vec::new(), Vec::new());
    };
    let taken_before_first_pick = modal
        .taken
        .iter()
        .zip(&modal.pickers)
        .zip(&modal.roads)
        .map(|((vertex, seat), road)| TakenVertex {
            vertex_id: topology.vertex_id(*vertex).to_owned(),
            player_id: board.player_ids[usize::from(*seat)].clone(),
            road: road.map(|edge| topology.edge_id(edge).to_owned()),
            frequency: taken_counts[usize::from(*vertex)] as f64 / pre_windows.len() as f64,
        })
        .collect();
    let (Some(me), Some(first_pick_index)) =
        (board.me, draft.my_remaining_pick_indices.get(pick_offset).copied())
    else {
        return (Vec::new(), taken_before_first_pick);
    };
    let second_pick_index = draft.my_remaining_pick_indices.get(pick_offset + 1).copied();
    let (mid_turns, mid_indices): (Vec<Turn>, Vec<usize>) = match second_pick_index {
        Some(second) => remaining_turns(board, draft, first_pick_index + 1, second, Some(me)),
        None => Default::default(),
    };
    let first_receives_grant = receives_second_settlement_grant(draft, first_pick_index);
    let second_receives_grant =
        second_pick_index.is_some_and(|second| receives_second_settlement_grant(draft, second));
    let reprice = scorer.weights().reprice_first_expansion == 1.0
        && scorer.weights().expansion_weight != 0.0 && !mid_turns.is_empty();

    // A mid-window's pieces and distance closure, copied into reusable buffers.
    let mut blocked = Vec::new();
    let mut vertex_owner = Vec::new();
    let mut edge_owner = Vec::new();
    let mut ranked: Vec<(Vertex, Recommendation)> = Vec::new();
    for (scored, candidate) in candidates.iter().enumerate() {
        let mut total = NO_SCORE;
        let mut planned_second = vec![0_usize; vertex_count];
        let mut survived = 0_usize;
        let mut drawn_second = None;
        let mut drawn_second_road = None;
        for window in pre_windows {
            if window.blocked[usize::from(*candidate)] {
                continue;
            }
            survived += 1;
            // Scored per window rather than once against the bare board: by the time the player
            // picks, the seats ahead have taken the vertices this window records.
            let my_holdings = window.holdings[usize::from(me)];

            // The first marginal moves across this replay only when re-pricing is enabled.
            let play_mid_window = |blocked: &mut Vec<bool>, vertex_owner: &mut Vec<u8>, edge_owner: &mut Vec<u8>| {
                blocked.clone_from(&window.blocked);
                block_vertex(topology, blocked, *candidate);
                // The second pick sees the candidate's road and every intervening pick's pieces.
                vertex_owner.clone_from(&window.vertex_owner);
                edge_owner.clone_from(&window.edge_owner);
                let road = context.setup_road(
                    &my_holdings, vertex_owner, edge_owner, me, *candidate, None,
                );
                if let Some(edge) = road {
                    edge_owner[usize::from(edge)] = me;
                }
                vertex_owner[usize::from(*candidate)] = me;
                let mut first_holdings = my_holdings;
                scorer.add_to_holdings(&mut first_holdings, *candidate);
                let mut drawn = 0;
                context.simulate_window(
                    &mid_turns,
                    &window.holdings,
                    blocked,
                    vertex_owner,
                    edge_owner,
                    &mut || {
                        drawn += 1;
                        window.uniforms[mid_indices[drawn - 1]]
                    },
                    None,
                );
                (road, first_holdings)
            };
            let first_holdings = if reprice {
                let (road, first_holdings) = play_mid_window(&mut blocked, &mut vertex_owner, &mut edge_owner);

                // The vertex reset before scoring and road reset afterward mirror
                // `Lookahead::value_with_marginal` and cut-off requirement 16, though inert here.

                // A reused setup edge must retain the road that was already priced at pick time.
                vertex_owner[usize::from(*candidate)] = window.vertex_owner[usize::from(*candidate)];
                if let Some(edge) = road {
                    edge_owner[usize::from(edge)] = window.edge_owner[usize::from(edge)];
                }
                add_breakdown(&mut total, scorer.marginal_breakdown(
                    &my_holdings, &vertex_owner, &edge_owner, me, *candidate, first_receives_grant,
                ));
                vertex_owner[usize::from(*candidate)] = me;
                if let Some(edge) = road {
                    edge_owner[usize::from(edge)] = me;
                }
                first_holdings
            } else {
                add_breakdown(
                    &mut total,
                    scorer.marginal_breakdown(
                        &my_holdings,
                        &window.vertex_owner,
                        &window.edge_owner,
                        me,
                        *candidate,
                        first_receives_grant,
                    ),
                );
                if second_pick_index.is_none() {
                    continue;
                }
                play_mid_window(&mut blocked, &mut vertex_owner, &mut edge_owner).1
            };
            let Some(second) = context.best_legal_candidate(
                me,
                &first_holdings,
                &blocked,
                &vertex_owner,
                &edge_owner,
                second_receives_grant,
            ) else {
                continue;
            };
            add_breakdown(
                &mut total,
                scorer.marginal_breakdown(
                    &first_holdings,
                    &vertex_owner,
                    &edge_owner,
                    me,
                    second,
                    second_receives_grant,
                ),
            );
            if survived == 1 {
                drawn_second = Some(usize::from(second));
                drawn_second_road = context.setup_road(
                    &first_holdings, &vertex_owner, &edge_owner, me, second, None,
                );
            }
            planned_second[usize::from(second)] += 1;
        }
        progress((scored + 1) as f64 / candidates.len() as f64);
        if survived == 0 {
            continue;
        }

        let windows = survived as f64;
        let breakdown = ScoreBreakdown {
            production: total.production / windows,
            scarcity: total.scarcity / windows,
            robber: total.robber / windows,
            diversity: total.diversity / windows,
            port: total.port / windows,
            hand_value: total.hand_value / windows,
            expansion: total.expansion / windows,
        };
        let survival = windows / pre_windows.len() as f64;
        let score = breakdown.total();
        // The drawn rollout leads, then frequency with the lower index first among equals.
        let mut seconds: Vec<usize> =
            (0..vertex_count).filter(|vertex| planned_second[*vertex] > 0).collect();
        seconds.sort_by_key(|vertex| std::cmp::Reverse(planned_second[*vertex]));
        if let Some(drawn) = drawn_second {
            seconds.retain(|vertex| *vertex != drawn);
            seconds.insert(0, drawn);
        }
        ranked.push((
            *candidate,
            Recommendation {
                first_pick: topology.vertex_id(*candidate).to_owned(),
                // Filled in below, once the list has been cut to the results the panel shows.
                first_road: None,
                second_road: drawn_second_road.map(|edge| topology.edge_id(edge).to_owned()),
                planned_second: seconds
                    .iter()
                    .take(3)
                    .map(|vertex| topology.vertex_id(*vertex as Vertex).to_owned())
                    .collect(),
                survival,
                score,
                rank_score: survival * score,
                breakdown: Breakdown::from(breakdown),
            },
        ));
    }

    // A stable insertion sort rather than `sort_by`, which may panic on a comparison that is not a
    // total order, and a NaN rank score among finite ones makes this one not. Over a total order
    // every stable sort agrees with the TypeScript's.
    for index in 1..ranked.len() {
        let mut at = index;
        while at > 0
            && ranks_before(
                (ranked[at].0, ranked[at].1.rank_score),
                (ranked[at - 1].0, ranked[at - 1].1.rank_score),
            )
        {
            ranked.swap(at, at - 1);
            at -= 1;
        }
    }
    ranked.truncate(slice_end(ranked.len(), max_results));

    // The road the expansion walk would lay from each first pick. Asked after the cut, because the
    // walk is the expensive half of the term. Read off the lowest-index window the candidate
    // survived, which for all but a candidate the modal window blocked is the modal window, so the
    // drawn road and the drawn losses agree; walking a blocked candidate against the modal
    // occupancy would draw a road out of a placement that window made illegal.
    let recommendations = ranked
        .into_iter()
        .map(|(vertex, mut recommendation)| {
            let window = pre_windows
                .iter()
                .find(|window| !window.blocked[usize::from(vertex)])
                .unwrap_or(modal);
            recommendation.first_road = context.setup_road(
                &window.holdings[usize::from(me)],
                &window.vertex_owner,
                &window.edge_owner,
                me,
                vertex,
                None,
            )
            .map(|edge| topology.edge_id(edge).to_owned());
            recommendation
        })
        .collect();
    (recommendations, taken_before_first_pick)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_higher_rank_score_sorts_first_and_the_index_breaks_a_tie() {
        assert!(ranks_before((9, 2.0), (1, 1.0)));
        assert!(!ranks_before((1, 1.0), (9, 2.0)));
        assert!(ranks_before((1, 1.0), (9, 1.0)));
        assert!(!ranks_before((9, 1.0), (1, 1.0)));
        assert!(!ranks_before((4, 1.0), (4, 1.0)));
    }

    #[test]
    fn a_gap_that_is_not_a_number_falls_through_to_the_index() {
        for (low, high) in [
            (f64::NAN, 5.0),
            (5.0, f64::NAN),
            (f64::NAN, f64::NAN),
            (f64::INFINITY, f64::INFINITY),
        ] {
            assert!(ranks_before((1, low), (9, high)), "{low} against {high}");
            assert!(!ranks_before((9, low), (1, high)), "{low} against {high}");
        }
        assert!(ranks_before((9, f64::INFINITY), (1, 5.0)));
    }

    #[test]
    fn slice_end_follows_array_slice() {
        assert_eq!(slice_end(8, 3.0), 3);
        assert_eq!(slice_end(8, 3.9), 3);
        assert_eq!(slice_end(8, 20.0), 8);
        assert_eq!(slice_end(8, f64::INFINITY), 8);
        assert_eq!(slice_end(8, 0.0), 0);
        assert_eq!(slice_end(8, f64::NAN), 0);
        assert_eq!(slice_end(8, -0.5), 0);
        assert_eq!(slice_end(8, -3.0), 5);
        assert_eq!(slice_end(8, -20.0), 0);
        assert_eq!(slice_end(8, f64::NEG_INFINITY), 0);
    }
}
