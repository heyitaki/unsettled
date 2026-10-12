//! Rival picks and the windows they are played in: the rollout layer under the ranking.
//!
//! Twin of `opponentPick`, `bestPartners`, `partnerTable`, `bestLegalCandidate` and
//! `simulateWindowDetailed` in `src/engine/analyze.ts`. A vertex is its grid index, so a scan in
//! index order is the TypeScript's grid order.
//!
//! Every scan reads two views of the pieces. `blocked` is every vertex the distance rule bars.
//! `vertex_owner` is the settlements standing, the board's and the picks made since, each under
//! the seat holding it, and never the distance-rule closure: the expansion walk applies that rule
//! itself. It must give a seat exactly the vertices that seat's holdings fold.

use std::cell::OnceCell;

use super::{Board, softmax_pick};
use crate::placement::app_formula::{AppFormulaScorer, Holdings, js_max};
use crate::placement::expansion;
use crate::topology::{Topology, Vertex};

/// Below this, two pair scores are the same pair read in either order: the pair value is
/// symmetric apart from float noise unless the grant is priced, and noise must not decide which
/// half goes first.
pub(super) const PAIR_TIE: f64 = 1e-9;

/// One pick of a window.
#[derive(Clone, Copy, Debug)]
pub(super) struct Turn {
    pub(super) seat: u8,
    /// The pick is its seat's second, which pays out a starting hand.
    pub(super) receives_grant: bool,
    /// A seat with a pick still to come is choosing a first settlement, priced as a pair.
    pub(super) has_later_pick: bool,
}

/// What a window leaves behind, beside the `blocked` and `vertex_owner` it grew in place.
pub(super) struct WindowResult {
    /// Every seat's holdings once the window has run.
    pub(super) holdings: Vec<Holdings>,
    /// The seat behind each entry of `taken`. A turn with nothing to pick is in neither.
    pub(super) pickers: Vec<u8>,
    pub(super) taken: Vec<Vertex>,
}

/// Names a window's pick from the picks made so far, their seats, the seat on turn and its
/// uniform. `None`, or a vertex that is blocked, leaves the pick to `opponent_pick`.
pub(super) type PickOverride<'f> = &'f mut dyn FnMut(&[Vertex], &[u8], u8, f64) -> Option<Vertex>;

/// Each legal candidate's best partner as an index into the legal list, `None` when no legal
/// vertex is clear of it, in which case that candidate is priced alone beside rivals priced as
/// pairs, and the partner's value, 0 when there is none.
pub(super) struct Partners {
    pub(super) mate: Vec<Option<usize>>,
    pub(super) value: Vec<f64>,
}

/// Twin of `blockVertex`: the distance rule bars a settled vertex and its neighbours.
pub(super) fn block_vertex(topology: &Topology, blocked: &mut [bool], vertex: Vertex) {
    blocked[usize::from(vertex)] = true;
    for adjacent in topology.vertex_adjacent(vertex) {
        blocked[usize::from(*adjacent)] = true;
    }
}

/// Keeps the best `top_k` scores in order. `<=` ranks a later equal score below an earlier one,
/// and a NaN score never compares, so it lands at rank 0.
fn insert_top(
    vertices: &mut Vec<Vertex>,
    scores: &mut Vec<f64>,
    top_k: f64,
    vertex: Vertex,
    score: f64,
) {
    let mut rank = 0;
    while rank < scores.len() && score <= scores[rank] {
        rank += 1;
    }
    if rank as f64 >= top_k {
        return;
    }
    vertices.insert(rank, vertex);
    scores.insert(rank, score);
    if vertices.len() as f64 > top_k {
        vertices.pop();
        scores.pop();
    }
}

// Vertices this thread priced both ways and found equal, so a test can tell the fast path ran.
#[cfg(test)]
thread_local! {
    static CHECKED_VERTICES: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}

#[cfg(test)]
pub(super) fn checked_vertices() -> usize {
    CHECKED_VERTICES.with(std::cell::Cell::get)
}

/// What every scan of a ranking reads and no pick changes: the scorer, which is the TypeScript's
/// `BoardContext`, and the board's roads, which a rollout never adds to.
pub(super) struct Context<'a> {
    pub(super) scorer: &'a AppFormulaScorer,
    topology: &'static Topology,
    pub(super) edge_owner: Vec<u8>,
    /// One partner table per seat, which is the draft slot the scores scale by, built on first
    /// use.
    partners: Vec<OnceCell<Vec<f64>>>,
}

impl<'a> Context<'a> {
    /// `scorer` is `board.scorer(..)`. Pieces other than roads do not enter the context, so one
    /// serves every scratch board a ranking builds.
    pub(super) fn new(board: &Board, scorer: &'a AppFormulaScorer) -> Self {
        Self {
            scorer,
            topology: board.topology,
            edge_owner: board.owners().1,
            partners: vec![OnceCell::new(); board.player_ids.len()],
        }
    }

    /// The partner half of a first settlement's pair value: row `first`, column `second`, the
    /// second's score without its expansion component, stored row after row.
    ///
    /// A rival with a pick still to come is choosing a first settlement, and what it is worth is
    /// the pair it leads to: its own score plus the best second settlement that candidate opens.
    /// The second's score without expansion depends only on the two vertices and the seat's draft
    /// slot, because a first pick starts from empty holdings and a second settlement always
    /// receives the setup grant, so it is tabulated once and every scan reads it. Expansion is the
    /// one part that moves with the occupancy, so `top_candidates` adds it per scan.
    pub(super) fn partner_table(&self, seat: u8) -> &[f64] {
        self.partners[usize::from(seat)].get_or_init(|| {
            let count = self.topology.vertex_count();
            let diversity = self.scorer.slot_scale(seat).diversity;
            let mut table = Vec::with_capacity(count * count);
            for first in 0..count {
                let mut holdings = Holdings::empty();
                self.scorer.add_to_holdings(&mut holdings, first as Vertex);
                let holdings_total = self.scorer.holdings_diversity_total(&holdings);
                for second in 0..count {
                    table.push(self.scorer.scaled_total_with_diversity(
                        holdings,
                        second as Vertex,
                        true,
                        diversity,
                        holdings_total,
                    ));
                }
            }
            table
        })
    }

    /// Calls `visit` with every unblocked vertex in index order and what `marginal_parts` gives
    /// `seat` for it: the slot-scaled expansion part, then the total.
    ///
    /// The numbers come off the scorer's fast paths and carry the reference's bits. The part
    /// without expansion is read from the price memo. The expansion part is `row_value`, which
    /// takes a candidate's sites from the shared reach table or a masked walk over the window's
    /// pieces as bit masks, prices them through `SitePricer`, and remembers the result. Debug and
    /// test builds price every vertex both ways and compare.
    ///
    /// The memo keys a seat's holdings by the set of vertices it holds, and here that set does
    /// name one holdings value per scorer although holdings fold in `board.buildings` order: a
    /// seat already on the board has at most one pick left, and the two picks of a seat that is
    /// not fold from zero, where either order gives the same sums.
    fn scan(
        &self,
        seat: u8,
        holdings: &Holdings,
        blocked: &[bool],
        vertex_owner: &[u8],
        receives_grant: bool,
        visit: &mut dyn FnMut(Vertex, f64, f64),
    ) {
        let scorer = self.scorer;
        let reference = |vertex: Vertex| {
            scorer.marginal_parts(
                holdings,
                vertex_owner,
                &self.edge_owner,
                seat,
                vertex,
                receives_grant,
            )
        };
        let legal = (0..self.topology.vertex_count())
            .filter(|vertex| !blocked[*vertex])
            .map(|vertex| vertex as Vertex);
        expansion::PRICE_MEMO.with(|memo| {
            // The memo outlives the call, so a wasm call that trapped inside a scan left it
            // borrowed for good. Every later scan then takes the reference path.
            let Ok(mut memo) = memo.try_borrow_mut() else {
                for vertex in legal {
                    let (walk, total) = reference(vertex);
                    visit(vertex, walk, total);
                }
                return;
            };
            let memo = &mut *memo;
            let scale = scorer.slot_scale(seat);
            let occupancy = expansion::Occupancy::new(scorer, vertex_owner, &self.edge_owner, seat);
            let serial = memo.serial(scorer.id, occupancy.own_vertices);
            let base_tag = expansion::base_tag(seat, receives_grant);
            let mut holdings_total = None;
            for vertex in legal {
                let rest = memo.price(expansion::price_key(serial, vertex, base_tag), || {
                    let total = *holdings_total
                        .get_or_insert_with(|| scorer.holdings_diversity_total(holdings));
                    scorer.scaled_total_with_diversity(
                        *holdings,
                        vertex,
                        receives_grant,
                        scale.diversity,
                        total,
                    )
                });
                let sites =
                    expansion::row_value(scorer, holdings, vertex, &occupancy, memo, Some(serial));
                let walk = scale.expansion * sites;
                let total = walk + rest;
                #[cfg(any(test, debug_assertions))]
                {
                    let (reference_walk, reference_total) = reference(vertex);
                    assert_eq!(
                        (walk.to_bits(), total.to_bits()),
                        (reference_walk.to_bits(), reference_total.to_bits()),
                        "vertex {vertex} for seat {seat}: {walk} and {total} on the fast path, \
                         {reference_walk} and {reference_total} on the reference path"
                    );
                    #[cfg(test)]
                    CHECKED_VERTICES.with(|checked| checked.set(checked.get() + 1));
                }
                visit(vertex, walk, total);
            }
        });
    }

    /// Twin of `bestPartners`. `legal` is in index order and `expansion` runs parallel to it.
    /// Strict `>` from negative infinity, so the lowest index wins a tie.
    pub(super) fn best_partners(
        &self,
        legal: &[Vertex],
        table: &[f64],
        expansion: &[f64],
    ) -> Partners {
        let count = self.topology.vertex_count();
        // Vertices the current row cannot pair with: itself and its neighbours, marked then
        // unmarked.
        let mut skip = vec![false; count];
        let mut partners = Partners {
            mate: Vec::with_capacity(legal.len()),
            value: Vec::with_capacity(legal.len()),
        };
        for vertex in legal {
            let row = &table[usize::from(*vertex) * count..][..count];
            block_vertex(self.topology, &mut skip, *vertex);
            let mut best = f64::NEG_INFINITY;
            let mut best_index = None;
            for (other, candidate) in legal.iter().enumerate() {
                if skip[usize::from(*candidate)] {
                    continue;
                }
                let partner = row[usize::from(*candidate)] + expansion[other];
                if partner > best {
                    best = partner;
                    best_index = Some(other);
                }
            }
            skip[usize::from(*vertex)] = false;
            for adjacent in self.topology.vertex_adjacent(*vertex) {
                skip[usize::from(*adjacent)] = false;
            }
            partners.mate.push(best_index);
            partners.value.push(if best_index.is_some() { best } else { 0.0 });
        }
        partners
    }

    /// A rival's candidates, best first, and their scores: everything `opponentPick` does ahead
    /// of its draw. Each is priced as a pair when the rival has a pick still to come and holds
    /// nothing yet, and alone otherwise, since holdings already carry the first settlement a last
    /// pick is completing.
    ///
    /// The pair value is the unordered pair's, so its two halves would tie to the bit and the draw
    /// would split one plan across two candidates. A player planning a pair takes its contested
    /// half first, so when two candidates are each other's best partner only the one worth more
    /// alone stays a candidate. A priced grant breaks the symmetry, and then the orientation worth
    /// more is the one that stays.
    pub(super) fn top_candidates(
        &self,
        seat: u8,
        holdings: &Holdings,
        blocked: &[bool],
        vertex_owner: &[u8],
        receives_grant: bool,
        has_later_pick: bool,
    ) -> (Vec<Vertex>, Vec<f64>) {
        let top_k = js_max(1.0, self.scorer.weights().opponent_top_k);
        let table =
            (has_later_pick && !vertex_owner.contains(&seat)).then(|| self.partner_table(seat));
        let mut legal = Vec::new();
        let mut own = Vec::new();
        // The scan's two halves kept apart: the walk's value is also the partner's expansion.
        let mut expansion = Vec::new();
        let mut keep = |vertex, walk, total| {
            legal.push(vertex);
            expansion.push(walk);
            own.push(total);
        };
        self.scan(seat, holdings, blocked, vertex_owner, receives_grant, &mut keep);
        let plan = table.map(|table| self.best_partners(&legal, table, &expansion));
        let mut top_vertices = Vec::new();
        let mut top_scores = Vec::new();
        for (index, vertex) in legal.iter().enumerate() {
            let mut score = own[index];
            if let Some(plan) = &plan {
                score += plan.value[index];
                if let Some(other) = plan.mate[index]
                    && plan.mate[other] == Some(index)
                {
                    // The grant goes to the second settlement, so with it priced the two
                    // orientations of a pair differ and the better one is the candidate; otherwise
                    // they tie to the bit and the half worth more alone goes first.
                    let gap = score - (own[other] + plan.value[other]);
                    let weaker = if gap.abs() > PAIR_TIE {
                        gap < 0.0
                    } else {
                        own[other] > own[index] || (own[other] == own[index] && other < index)
                    };
                    if weaker {
                        continue;
                    }
                }
            }
            insert_top(&mut top_vertices, &mut top_scores, top_k, *vertex, score);
        }
        (top_vertices, top_scores)
    }

    /// Twin of `opponentPick`: the softmax draw over the rival's top candidates.
    ///
    /// The pair value assumes the planned second survives the picks in between, and prices its
    /// expansion against the current occupancy with empty holdings rather than the candidate. The
    /// hero's own ranking rolls the picks in between out and can choose a different pick.
    #[allow(clippy::too_many_arguments)]
    pub(super) fn opponent_pick(
        &self,
        seat: u8,
        holdings: &Holdings,
        blocked: &[bool],
        vertex_owner: &[u8],
        uniform: f64,
        receives_grant: bool,
        has_later_pick: bool,
    ) -> Option<Vertex> {
        let (vertices, scores) = self.top_candidates(
            seat,
            holdings,
            blocked,
            vertex_owner,
            receives_grant,
            has_later_pick,
        );
        softmax_pick(&scores, uniform, self.scorer.weights().softmax_temperature)
            .map(|index| vertices[index])
    }

    /// Twin of `bestLegalCandidate`: the unblocked vertex scoring highest for `seat`. Strict `>`
    /// from negative infinity, so the lowest index wins a tie and an all-NaN scan finds nothing.
    pub(super) fn best_legal_candidate(
        &self,
        seat: u8,
        holdings: &Holdings,
        blocked: &[bool],
        vertex_owner: &[u8],
        receives_grant: bool,
    ) -> Option<Vertex> {
        let mut best = None;
        let mut best_score = f64::NEG_INFINITY;
        let mut keep = |vertex, _, score| {
            if score > best_score {
                best = Some(vertex);
                best_score = score;
            }
        };
        self.scan(seat, holdings, blocked, vertex_owner, receives_grant, &mut keep);
        best
    }

    /// Twin of `simulateWindowDetailed`: plays `turns` in order from `initial_holdings`, which is
    /// indexed by seat. Each turn draws one uniform whether or not `pick_override` supplies its
    /// pick, and a turn with nothing to pick is skipped. A pick bars its vertex and neighbours in
    /// `blocked` and stands in `vertex_owner` on its vertex alone.
    pub(super) fn simulate_window(
        &self,
        turns: &[Turn],
        initial_holdings: &[Holdings],
        blocked: &mut [bool],
        vertex_owner: &mut [u8],
        next_uniform: &mut dyn FnMut() -> f64,
        mut pick_override: Option<PickOverride<'_>>,
    ) -> WindowResult {
        let mut result = WindowResult {
            holdings: initial_holdings.to_vec(),
            pickers: Vec::new(),
            taken: Vec::new(),
        };
        for turn in turns {
            let uniform = next_uniform();
            let held = result.holdings[usize::from(turn.seat)];
            let forced = pick_override
                .as_mut()
                .and_then(|pick| pick(&result.taken, &result.pickers, turn.seat, uniform))
                .filter(|vertex| !blocked[usize::from(*vertex)]);
            let picked = forced.or_else(|| {
                self.opponent_pick(
                    turn.seat,
                    &held,
                    blocked,
                    vertex_owner,
                    uniform,
                    turn.receives_grant,
                    turn.has_later_pick,
                )
            });
            let Some(vertex) = picked else { continue };
            block_vertex(self.topology, blocked, vertex);
            vertex_owner[usize::from(vertex)] = turn.seat;
            self.scorer
                .add_to_holdings(&mut result.holdings[usize::from(turn.seat)], vertex);
            result.taken.push(vertex);
            result.pickers.push(turn.seat);
        }
        result
    }
}

#[cfg(test)]
mod tests {
    use super::super::{AnalysisRequest, weights_for_seats};
    use super::*;
    use crate::placement::app_formula::EngineWeights;
    use crate::wire::WireBoard;

    /// A corpus case's board and the weights its request ranks with.
    fn corpus(name: &str) -> (Board, EngineWeights) {
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../fixtures/analysis-parity.json");
        let fixture: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
        let case = fixture["cases"]
            .as_array()
            .unwrap()
            .iter()
            .find(|case| case["name"] == name)
            .unwrap_or_else(|| panic!("no corpus case {name}"));
        let request: AnalysisRequest = serde_json::from_value(case["request"].clone()).unwrap();
        let board = Board::from_wire(&WireBoard::parse_value(request.board).unwrap()).unwrap();
        let weights = request
            .options
            .weights
            .unwrap_or_else(|| weights_for_seats(board.player_ids.len()).clone());
        (board, weights)
    }

    /// Every legal vertex's `(expansion, total)` for the first seat holding nothing.
    fn first_seat_parts(board: &Board, context: &Context<'_>) -> Vec<(f64, f64)> {
        let (vertex_owner, _) = board.owners();
        board
            .legal_vertices()
            .iter()
            .map(|vertex| {
                context.scorer.marginal_parts(
                    &Holdings::empty(),
                    &vertex_owner,
                    &context.edge_owner,
                    0,
                    *vertex,
                    false,
                )
            })
            .collect()
    }

    #[test]
    fn best_legal_candidate_takes_the_lowest_index_among_equal_maxima() {
        let (board, weights) = corpus("numberless-board");
        let scorer = board.scorer(weights);
        let context = Context::new(&board, &scorer);
        let (vertex_owner, _) = board.owners();
        let mut blocked = board.blocked();
        let legal = board.legal_vertices();
        // Nothing produces, so every vertex scores the same.
        let totals = first_seat_parts(&board, &context);
        assert!(legal.len() > 2 && totals.iter().all(|parts| parts.1 == totals[0].1));

        let holdings = Holdings::empty();
        let best = |blocked: &[bool]| {
            context.best_legal_candidate(0, &holdings, blocked, &vertex_owner, false)
        };
        assert_eq!(best(&blocked), Some(legal[0]));
        blocked[usize::from(legal[0])] = true;
        assert_eq!(best(&blocked), Some(legal[1]));
        blocked.fill(true);
        assert_eq!(best(&blocked), None);
    }

    #[test]
    fn an_all_nan_scan_has_no_best_and_lists_its_last_vertices_first() {
        let (board, mut weights) = corpus("empty-first-seat-standard4");
        weights.scarcity_weight = f64::NAN;
        weights.opponent_top_k = 3.0;
        let scorer = board.scorer(weights);
        let context = Context::new(&board, &scorer);
        let (vertex_owner, _) = board.owners();
        let blocked = board.blocked();
        let legal = board.legal_vertices();
        assert!(first_seat_parts(&board, &context).iter().all(|parts| parts.1.is_nan()));

        let holdings = Holdings::empty();
        assert_eq!(
            context.best_legal_candidate(0, &holdings, &blocked, &vertex_owner, false),
            None
        );
        // Each NaN lands at rank 0 and pushes the list down, so the last three scanned are left.
        let (vertices, scores) =
            context.top_candidates(0, &holdings, &blocked, &vertex_owner, false, false);
        let last: Vec<Vertex> = legal.iter().rev().take(3).copied().collect();
        assert_eq!(vertices, last);
        assert!(scores.iter().all(|score| score.is_nan()));
        assert_eq!(
            context.opponent_pick(0, &holdings, &blocked, &vertex_owner, 0.0, false, false),
            legal.last().copied()
        );
    }

    #[test]
    fn top_k_insertion_ranks_a_later_equal_score_below_an_earlier_one() {
        let mut vertices = Vec::new();
        let mut scores = Vec::new();
        let mut insert = |vertex, score| insert_top(&mut vertices, &mut scores, 3.0, vertex, score);
        insert(10, 5.0);
        insert(11, 5.0);
        insert(12, 7.0);
        // A third 5 would rank fourth, past the cut.
        insert(13, 5.0);
        insert(14, 6.0);
        insert(15, f64::NAN);
        assert_eq!(vertices, [15, 12, 14]);
        assert!(scores[0].is_nan() && scores[1..] == [7.0, 6.0]);

        // A top-K below 1 never reaches the scan, and a NaN one keeps everything.
        let (mut vertices, mut scores) = (Vec::new(), Vec::new());
        for vertex in 0..5 {
            insert_top(&mut vertices, &mut scores, f64::NAN, vertex, 1.0);
        }
        assert_eq!(vertices, [0, 1, 2, 3, 4]);
    }

    #[test]
    fn equal_scores_are_drawn_in_scan_order() {
        let (board, mut weights) = corpus("numberless-board");
        weights.opponent_top_k = 3.0;
        weights.softmax_temperature = 1.0;
        let scorer = board.scorer(weights);
        let context = Context::new(&board, &scorer);
        let (vertex_owner, _) = board.owners();
        let blocked = board.blocked();
        let legal = board.legal_vertices();
        // Three equal scores split the draw into thirds, earliest scanned first.
        let pick = |uniform| {
            let holdings = Holdings::empty();
            context.opponent_pick(0, &holdings, &blocked, &vertex_owner, uniform, false, false)
        };
        assert_eq!(pick(0.0), Some(legal[0]));
        assert_eq!(pick(0.2), Some(legal[0]));
        assert_eq!(pick(0.5), Some(legal[1]));
        assert_eq!(pick(0.9), Some(legal[2]));
    }

    /// Runs the first seat's pair-mode scan on a corpus board and checks every mutual pair: the
    /// half the rule keeps is a candidate and the other is not. Returns how many pairs fell
    /// outside `PAIR_TIE`, inside it with halves worth different amounts alone, and inside it
    /// with halves worth the same alone.
    fn mutual_pairs(name: &str) -> [usize; 3] {
        let (board, mut weights) = corpus(name);
        // Every candidate the rule keeps stays listed.
        weights.opponent_top_k = f64::INFINITY;
        let scorer = board.scorer(weights);
        let context = Context::new(&board, &scorer);
        let (vertex_owner, _) = board.owners();
        assert!(!vertex_owner.contains(&0), "{name}: the first seat holds something");
        let legal = board.legal_vertices();
        let (kept, _) = context.top_candidates(
            0,
            &Holdings::empty(),
            &board.blocked(),
            &vertex_owner,
            false,
            true,
        );

        let parts = first_seat_parts(&board, &context);
        let expansion: Vec<f64> = parts.iter().map(|parts| parts.0).collect();
        let plan = context.best_partners(&legal, context.partner_table(0), &expansion);
        let pair = |index: usize| parts[index].1 + plan.value[index];
        let mut seen = [0; 3];
        for (index, mate) in plan.mate.iter().enumerate() {
            // Each mutual pair once, from its lower index.
            let Some(other) = *mate else { continue };
            if other < index || plan.mate[other] != Some(index) {
                continue;
            }
            let gap = pair(index) - pair(other);
            let (class, lower_stays) = if gap.abs() > PAIR_TIE {
                (0, gap > 0.0)
            } else if parts[index].1 != parts[other].1 {
                (1, parts[index].1 > parts[other].1)
            } else {
                (2, true)
            };
            seen[class] += 1;
            let (stays, goes) = if lower_stays { (index, other) } else { (other, index) };
            assert!(
                kept.contains(&legal[stays]) && !kept.contains(&legal[goes]),
                "{name}: pair {index} and {other}"
            );
        }
        seen
    }

    #[test]
    fn the_mutual_mate_rule_drops_the_weaker_half() {
        // The grant is priced here, so the two orders of a pair are worth different amounts.
        assert!(mutual_pairs("mutual-mate")[0] > 0);
    }

    #[test]
    fn inside_pair_tie_the_half_worth_less_alone_is_dropped() {
        let [outside, unequal, _] = mutual_pairs("pair-inside-tie");
        assert_eq!(outside, 0);
        assert!(unequal > 0);
    }

    #[test]
    fn inside_pair_tie_equal_halves_drop_the_higher_index() {
        // Nothing produces, so every pair ties and so do its halves.
        let [outside, unequal, equal] = mutual_pairs("numberless-board");
        assert_eq!([outside, unequal], [0, 0]);
        assert!(equal > 0);
    }

    #[test]
    fn a_seat_holding_something_is_priced_alone() {
        let (board, weights) = corpus("mid-first-round");
        let scorer = board.scorer(weights);
        let context = Context::new(&board, &scorer);
        let (vertex_owner, _) = board.owners();
        let blocked = board.blocked();
        let holder = board.buildings[0].seat;
        let holdings = board.holdings(&scorer)[usize::from(holder)];
        let scan = |has_later_pick| {
            context.top_candidates(holder, &holdings, &blocked, &vertex_owner, true, has_later_pick)
        };
        // Pair mode needs both a later pick and empty holdings, so the flag alone changes nothing.
        assert_eq!(scan(true), scan(false));
        assert!(context.partners.iter().all(|table| table.get().is_none()));
    }

    struct Ran {
        result: WindowResult,
        blocked: Vec<bool>,
        vertex_owner: Vec<u8>,
        uniforms: Vec<f64>,
    }

    /// Plays the first three seats' first picks on a corpus board, drawing 0.25, 0.5 and 0.75.
    fn run_window(
        board: &Board,
        context: &Context<'_>,
        mut blocked: Vec<bool>,
        pick_override: Option<PickOverride<'_>>,
    ) -> Ran {
        let turns: Vec<Turn> = (0..3)
            .map(|seat| Turn { seat, receives_grant: false, has_later_pick: true })
            .collect();
        let (mut vertex_owner, _) = board.owners();
        let mut uniforms = Vec::new();
        let result = context.simulate_window(
            &turns,
            &board.holdings(context.scorer),
            &mut blocked,
            &mut vertex_owner,
            &mut || {
                uniforms.push(0.25 * (uniforms.len() + 1) as f64);
                uniforms[uniforms.len() - 1]
            },
            pick_override,
        );
        Ran { result, blocked, vertex_owner, uniforms }
    }

    #[test]
    fn simulate_window_grows_blocked_by_the_distance_rule_and_owners_by_the_vertex() {
        let (board, weights) = corpus("empty-first-seat-standard4");
        let scorer = board.scorer(weights);
        let context = Context::new(&board, &scorer);
        let ran = run_window(&board, &context, board.blocked(), None);
        assert_eq!(ran.uniforms, [0.25, 0.5, 0.75]);
        assert_eq!(ran.result.pickers, [0, 1, 2]);
        assert_eq!(ran.result.taken.len(), 3);

        let mut blocked = board.blocked();
        let (mut vertex_owner, _) = board.owners();
        let mut holdings = board.holdings(&scorer);
        for (vertex, seat) in ran.result.taken.iter().zip(&ran.result.pickers) {
            assert!(!blocked[usize::from(*vertex)], "a pick landed on a barred vertex");
            blocked[usize::from(*vertex)] = true;
            for adjacent in board.topology.vertex_adjacent(*vertex) {
                blocked[usize::from(*adjacent)] = true;
            }
            vertex_owner[usize::from(*vertex)] = *seat;
            scorer.add_to_holdings(&mut holdings[usize::from(*seat)], *vertex);
        }
        assert_eq!(ran.blocked, blocked);
        assert_eq!(ran.vertex_owner, vertex_owner);
        assert_eq!(format!("{:?}", ran.result.holdings), format!("{holdings:?}"));
    }

    #[test]
    fn simulate_window_draws_one_uniform_per_turn_under_an_override() {
        let (board, weights) = corpus("empty-first-seat-standard4");
        let scorer = board.scorer(weights);
        let context = Context::new(&board, &scorer);
        let free = run_window(&board, &context, board.blocked(), None);
        // The free run's picks are mutually legal, so they can be forced in any order.
        let forced: Vec<Vertex> = free.result.taken.iter().rev().copied().collect();

        let mut calls = Vec::new();
        let ran = run_window(
            &board,
            &context,
            board.blocked(),
            Some(&mut |taken: &[Vertex], pickers: &[u8], seat, uniform| {
                calls.push((taken.to_vec(), pickers.to_vec(), seat, uniform));
                Some(forced[taken.len()])
            }),
        );
        assert_eq!(ran.result.taken, forced);
        assert_eq!(ran.result.pickers, [0, 1, 2]);
        assert_eq!(ran.uniforms, [0.25, 0.5, 0.75]);
        assert_eq!(calls[0], (vec![], vec![], 0, 0.25));
        assert_eq!(calls[2], (forced[..2].to_vec(), vec![0, 1], 2, 0.75));

        // A forced vertex that is barred by then, like no vertex at all, leaves the pick to
        // `opponent_pick`.
        let repeated = run_window(&board, &context, board.blocked(), Some(&mut |_, _, _, _| {
            Some(forced[0])
        }));
        let once = run_window(
            &board,
            &context,
            board.blocked(),
            Some(&mut |taken: &[Vertex], _, _, _| taken.is_empty().then_some(forced[0])),
        );
        assert_eq!(repeated.uniforms, [0.25, 0.5, 0.75]);
        assert_eq!(repeated.result.taken[0], forced[0]);
        assert_eq!(repeated.result.taken.len(), 3);
        assert_eq!(repeated.result.taken, once.result.taken);
    }

    #[test]
    fn simulate_window_skips_a_turn_with_no_pick() {
        let (board, weights) = corpus("empty-first-seat-standard4");
        let scorer = board.scorer(weights);
        let context = Context::new(&board, &scorer);
        let all = vec![true; board.topology.vertex_count()];
        for forced in [None, Some(0)] {
            let ran = run_window(&board, &context, all.clone(), Some(&mut |_, _, _, _| forced));
            assert_eq!(ran.uniforms, [0.25, 0.5, 0.75]);
            assert!(ran.result.taken.is_empty() && ran.result.pickers.is_empty());
            assert_eq!(ran.blocked, all);
            assert_eq!(ran.vertex_owner, board.owners().0);
            assert_eq!(
                format!("{:?}", ran.result.holdings),
                format!("{:?}", board.holdings(&scorer))
            );
        }
    }
}
