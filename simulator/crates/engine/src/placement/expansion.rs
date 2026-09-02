//! SP3's expansion term: what the best sites a candidate opens are worth to the pair.
//!
//! Mirror of `src/engine/expansion.ts`, down to the comparison order, because the `W13` parity
//! class pins the two against each other. The walk reads the occupancy the scorer is handed, so it
//! is the one component that depends on where everybody else's pieces stand.

use super::app_formula::{AppFormulaScorer, Holdings, js_max};
use crate::state::EMPTY;
use crate::topology::{Edge, Vertex};

/// Paid road-builds a site may cost before it is out of reach. The free setup road is not one.
const MAX_PAID_BUILDS: usize = 2;

/// A site the candidate opens, at the cost the walk settled it for.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct ExpansionSite {
    pub vertex: Vertex,
    /// Roads that must be bought to settle it, over and above the free setup road.
    pub paid_builds: u32,
}

pub(super) struct ExpansionValue {
    /// The term, already multiplied by `expansionWeight`.
    pub value: f64,
    /// The setup road to lay, or `None` when the candidate opens nothing.
    pub road: Option<Edge>,
}

const NO_EXPANSION: ExpansionValue = ExpansionValue {
    value: 0.0,
    road: None,
};

// Times this thread entered the walk, so a test can pin that the shipped weight of 0 never
// reaches it. Thread-local rather than global: tests run in parallel and would otherwise move
// each other's count.
#[cfg(test)]
thread_local! {
    static WALK_CALLS: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}

#[cfg(test)]
fn walk_calls() -> usize {
    WALK_CALLS.with(std::cell::Cell::get)
}

/// One walk state: a vertex, and whether the free setup road has been spent getting there.
#[derive(Clone, Copy)]
struct Reached {
    vertex: Vertex,
    road_used: bool,
}

/// Every site the candidate opens through one of its own incident edges, keyed by that edge and
/// listed in ascending edge order, which is ascending edge id and so the order the TypeScript walk
/// takes its sorted incident edges in.
///
/// The walk leaves `candidate` along each first edge and spreads outward. A rival's road is
/// impassable and a vertex a rival holds is a dead end, because a settlement stops a road network
/// even though a road may be laid right up to it. The seat's own roads are free to travel, the
/// first unowned edge on a path is free as well (it is the setup road the settlement comes with),
/// and every unowned edge after that costs one paid build. Reach ends at `MAX_PAID_BUILDS`.
///
/// A site is a vertex at least two edges out that would be legal once the candidate is built:
/// unoccupied, with no occupied neighbour, and not adjacent to the candidate.
pub(super) fn sites_by_edge(
    scorer: &AppFormulaScorer,
    vertex_owner: &[u8],
    edge_owner: &[u8],
    seat: u8,
    candidate: Vertex,
) -> Vec<(Edge, Vec<ExpansionSite>)> {
    #[cfg(test)]
    WALK_CALLS.with(|calls| calls.set(calls.get() + 1));

    let occupied = |vertex: Vertex| vertex_owner[usize::from(vertex)] != EMPTY;
    let rival = |vertex: Vertex| {
        let owner = vertex_owner[usize::from(vertex)];
        owner != EMPTY && owner != seat
    };
    let neighbours_candidate = |vertex: Vertex| scorer.vertex_adjacent(candidate).contains(&vertex);
    let is_site = |vertex: Vertex| {
        !occupied(vertex)
            && vertex != candidate
            && !neighbours_candidate(vertex)
            && scorer
                .vertex_adjacent(vertex)
                .iter()
                .all(|neighbour| !occupied(*neighbour))
    };

    let mut firsts: Vec<(Edge, Vertex)> = scorer
        .steps(candidate)
        .filter(|(edge, _)| {
            let owner = edge_owner[usize::from(*edge)];
            owner == EMPTY || owner == seat
        })
        .collect();
    firsts.sort_unstable();

    let mut by_edge = Vec::with_capacity(firsts.len());
    for (first_edge, first_vertex) in firsts {
        // Cheapest-first: a free step joins the band being drained, a paid one the next band, so a
        // state is settled at its minimum paid-build count the first time it is popped.
        let mut bands: [Vec<Reached>; MAX_PAID_BUILDS + 1] =
            std::array::from_fn(|_| Vec::new());
        // The free setup road is spent only on an edge nobody owns; travelling the seat's own road
        // keeps it in hand for later on the same path.
        bands[0].push(Reached {
            vertex: first_vertex,
            road_used: edge_owner[usize::from(first_edge)] == EMPTY,
        });
        // One bit per (vertex, road spent) state. `extension6`, the widest layout, has 80
        // vertices; a wider one would shift past the mask's end, which is a silent wrong answer in
        // release rather than a panic.
        debug_assert!(
            vertex_owner.len() <= 128,
            "the expansion walk's state bitmask is 128 bits wide"
        );
        let mut settled = [0_u128; 2];
        let mut sites = Vec::new();
        for cost in 0..=MAX_PAID_BUILDS {
            let mut head = 0;
            while head < bands[cost].len() {
                let state = bands[cost][head];
                head += 1;
                let lane = usize::from(state.road_used);
                let bit = 1_u128 << state.vertex;
                if settled[lane] & bit != 0 {
                    continue;
                }
                settled[lane] |= bit;
                // Every vertex past the first step is at least two edges out; the adjacency test
                // in `is_site` drops the ones that are two edges out but still touch the candidate.
                if state.vertex != first_vertex && is_site(state.vertex) {
                    sites.push(ExpansionSite {
                        vertex: state.vertex,
                        paid_builds: cost as u32,
                    });
                }
                if rival(state.vertex) {
                    continue;
                }
                for (edge, to) in scorer.steps(state.vertex) {
                    let owner = edge_owner[usize::from(edge)];
                    if owner != EMPTY && owner != seat {
                        continue;
                    }
                    let unowned = owner == EMPTY;
                    let next_cost = cost + usize::from(unowned && state.road_used);
                    if next_cost > MAX_PAID_BUILDS {
                        continue;
                    }
                    let road_used = state.road_used || unowned;
                    if settled[usize::from(road_used)] & (1 << to) != 0 {
                        continue;
                    }
                    bands[next_cost].push(Reached {
                        vertex: to,
                        road_used,
                    });
                }
            }
        }
        if !sites.is_empty() {
            by_edge.push((first_edge, sites));
        }
    }
    by_edge
}

/// What the candidate is worth as a place to expand *from*, and the road that goes there.
///
/// A site is priced by what settling it would be worth to this pair: the ordinary formula's
/// marginal score of the site given the holdings plus the candidate, with no setup grant and with
/// the expansion component itself left out, so the term cannot recurse. That value decays by one
/// factor of `expansionDecay` per paid road-build, and the term is the weight times the sum of the
/// two best sites, because a pair only ever settles a handful of them.
///
/// The road is the first edge of the cheapest path to the best site, ties broken by the larger
/// top-two sum still reachable through that edge, then by the lower edge id.
pub(super) fn term(
    scorer: &AppFormulaScorer,
    holdings: &Holdings,
    vertex_owner: &[u8],
    edge_owner: &[u8],
    seat: u8,
    candidate: Vertex,
) -> ExpansionValue {
    let weights = scorer.weights();
    if weights.expansion_weight == 0.0 {
        return NO_EXPANSION;
    }
    let by_edge = sites_by_edge(scorer, vertex_owner, edge_owner, seat, candidate);
    if by_edge.is_empty() {
        return NO_EXPANSION;
    }
    let mut with_candidate = *holdings;
    scorer.add_to_holdings(&mut with_candidate, candidate);
    // One score per site, shared by every first edge that reaches it: a site's worth depends on
    // the site and the pair, never on the road taken to get there.
    let mut scores: Vec<Option<f64>> = vec![None; vertex_owner.len()];
    let mut cheapest: Vec<Option<f64>> = vec![None; vertex_owner.len()];
    let mut road: Option<Edge> = None;
    let mut best_site = f64::NEG_INFINITY;
    let mut best_pair = f64::NEG_INFINITY;
    let mut values = Vec::new();
    for (first_edge, sites) in &by_edge {
        values.clear();
        for site in sites {
            let index = usize::from(site.vertex);
            let score = match scores[index] {
                Some(score) => score,
                None => {
                    let score = scorer.total_with_holdings(with_candidate, site.vertex, false);
                    scores[index] = Some(score);
                    score
                }
            };
            // `powf`, not `powi`: JavaScript's `**` is `Math.pow`, and the two Rust intrinsics are
            // free to round differently.
            values.push(score * weights.expansion_decay.powf(f64::from(site.paid_builds)));
        }
        let best = values.iter().fold(f64::NEG_INFINITY, |held, value| {
            js_max(held, *value)
        });
        let pair = top_two(&values);
        if road.is_none()
            || best > best_site
            || (best == best_site && pair > best_pair)
            || (best == best_site && pair == best_pair && Some(*first_edge) < road)
        {
            road = Some(*first_edge);
            best_site = best;
            best_pair = pair;
        }
        for (site, value) in sites.iter().zip(&values) {
            let held = &mut cheapest[usize::from(site.vertex)];
            // The cheapest path is the most valuable one, decay being at most 1 per build.
            if held.is_none_or(|held| *value > held) {
                *held = Some(*value);
            }
        }
    }
    let reached: Vec<f64> = cheapest.into_iter().flatten().collect();
    ExpansionValue {
        value: weights.expansion_weight * top_two(&reached),
        road,
    }
}

/// Sum of the two largest values, or of the one there is, or 0 for none. A NaN never wins a
/// comparison here, exactly as it never wins one in the TypeScript original.
fn top_two(values: &[f64]) -> f64 {
    let mut first = f64::NEG_INFINITY;
    let mut second = f64::NEG_INFINITY;
    for value in values {
        if *value > first {
            second = first;
            first = *value;
        } else if *value > second {
            second = *value;
        }
    }
    if first == f64::NEG_INFINITY {
        return 0.0;
    }
    if second == f64::NEG_INFINITY {
        first
    } else {
        first + second
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;

    use super::*;
    use crate::board::{ConversionOptions, SimBoard};
    use crate::placement::app_formula::EngineWeights;
    use crate::rules::RuleConfig;
    use crate::topology::{Layout, Topology};
    use crate::wire::WireBoard;

    fn fixture() -> (Topology, SimBoard) {
        let relative = PathBuf::from("src/parser/__tests__/expected/board-draft-empty.json");
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .ancestors()
            .map(|root| root.join(&relative))
            .find(|candidate| candidate.is_file())
            .expect("board fixture must be reachable from the worktree or sweep root");
        let wire = WireBoard::parse_str(&fs::read_to_string(path).unwrap()).unwrap();
        let topology = Topology::load(Layout::Extension6).unwrap();
        let board = SimBoard::try_from_wire(
            wire,
            &topology,
            &RuleConfig::base(Layout::Extension6),
            ConversionOptions::default(),
        )
        .unwrap();
        (topology, board)
    }

    fn default_weights() -> EngineWeights {
        serde_json::from_str(include_str!("../../../../placement/default-weights.json")).unwrap()
    }

    /// The walk is skipped entirely at the shipped weight, which is what keeps the rollout hot
    /// path and the whole behaviour corpus where they were.
    #[test]
    fn the_shipped_weight_never_reaches_the_walk() {
        let (topology, board) = fixture();
        let weights = default_weights();
        assert_eq!(weights.expansion_weight, 0.0, "the shipped weight is 0");
        let scorer = AppFormulaScorer::new(&board, &topology, weights.clone());
        let vertex_owner = vec![EMPTY; topology.vertex_count()];
        let edge_owner = vec![EMPTY; topology.edge_count()];

        let before = walk_calls();
        for vertex in 0..topology.vertex_count() {
            scorer.score_for_owner(&vertex_owner, &edge_owner, 0, vertex as Vertex, true);
            scorer.breakdown_for_owner(&vertex_owner, &edge_owner, 0, vertex as Vertex, false);
        }
        assert_eq!(walk_calls(), before, "weight 0 must not walk");

        let mut witness = weights;
        witness.expansion_weight = 0.3;
        let scorer = AppFormulaScorer::new(&board, &topology, witness);
        let score = scorer.score_for_owner(&vertex_owner, &edge_owner, 0, 0, false);
        assert!(walk_calls() > before, "a nonzero weight must walk");
        assert!(score.is_finite());
    }

    /// The two boxing walks find the same sites.
    ///
    /// `cli::expansion::reachable_expansion_sites` counts what a seat's *existing* road network
    /// reaches in two more builds; this walk counts what a candidate would open with its free
    /// setup road plus two. Give the CLI walk the seat's settlement on the candidate and a road
    /// out of every one of its edges, which is the setup road in each direction at once, and the
    /// two horizons coincide: three edges of open board either way.
    #[test]
    fn the_walk_reaches_what_the_boxing_walk_reaches() {
        let (topology, board) = fixture();
        let mut weights = default_weights();
        weights.expansion_weight = 0.3;
        let scorer = AppFormulaScorer::new(&board, &topology, weights);
        let candidate: Vertex = 24;
        let rivals: [Vertex; 2] = [40, 55];

        let mut vertex_owner = vec![EMPTY; topology.vertex_count()];
        let mut edge_owner = vec![EMPTY; topology.edge_count()];
        for rival in rivals {
            vertex_owner[usize::from(rival)] = 1;
        }
        // One rival road well away from the candidate, so both walks have a wall to respect.
        edge_owner[usize::from(topology.vertex_edges(rivals[0])[0])] = 1;

        let mut walked: Vec<Vertex> = sites_by_edge(&scorer, &vertex_owner, &edge_owner, 0, candidate)
            .into_iter()
            .flat_map(|(_, sites)| sites.into_iter().map(|site| site.vertex))
            .collect();
        walked.sort_unstable();
        walked.dedup();

        let mut boxed_owner = vertex_owner.clone();
        boxed_owner[usize::from(candidate)] = 0;
        let mut boxed_edges = edge_owner.clone();
        for edge in topology.vertex_edges(candidate) {
            boxed_edges[usize::from(*edge)] = 0;
        }
        let counted = boxing_sites(&topology, &boxed_owner, &boxed_edges, 0);
        assert!(!walked.is_empty(), "the candidate must open something");
        assert_eq!(walked, counted);

        // The pieces have to be doing something, or the two walks agree on an empty board and the
        // comparison above proves nothing about the stop rules.
        let open = sites_by_edge(
            &scorer,
            &vec![EMPTY; topology.vertex_count()],
            &vec![EMPTY; topology.edge_count()],
            0,
            candidate,
        );
        let open: Vec<Vertex> = open
            .into_iter()
            .flat_map(|(_, sites)| sites.into_iter().map(|site| site.vertex))
            .collect();
        assert!(
            walked.iter().all(|vertex| open.contains(vertex)) && walked.len() < open.len(),
            "the rivals must close sites the open board offers"
        );
    }

    /// `cli::expansion::reachable_expansion_sites` as a set rather than a count. The CLI crate
    /// depends on the engine, not the other way round, so the walk under test is compared against
    /// a transcription of it kept here; `crates/cli/src/expansion.rs` is the original.
    fn boxing_sites(
        topology: &Topology,
        vertex_owner: &[u8],
        edge_owner: &[u8],
        seat: u8,
    ) -> Vec<Vertex> {
        let mut reached = 0_u128;
        for edge in 0..topology.edge_count() {
            if edge_owner[edge] == seat {
                for vertex in topology.edge_endpoints(edge as Edge) {
                    reached |= 1 << vertex;
                }
            }
        }
        let mut frontier = reached;
        for _ in 0..MAX_PAID_BUILDS {
            let mut next = 0_u128;
            for vertex in 0..topology.vertex_count() {
                if frontier & (1 << vertex) == 0 {
                    continue;
                }
                let owner = vertex_owner[vertex];
                if owner != EMPTY && owner != seat {
                    continue;
                }
                for adjacent in topology.vertex_adjacent(vertex as Vertex) {
                    let Some(edge) = topology.edge_between(vertex as Vertex, *adjacent) else {
                        continue;
                    };
                    if edge_owner[usize::from(edge)] != EMPTY || reached & (1 << adjacent) != 0 {
                        continue;
                    }
                    next |= 1 << adjacent;
                }
            }
            reached |= next;
            frontier = next;
        }
        (0..topology.vertex_count())
            .map(|vertex| vertex as Vertex)
            .filter(|vertex| {
                reached & (1 << vertex) != 0
                    && crate::game::can_place_settlement(topology, vertex_owner, *vertex)
            })
            .collect()
    }
}
