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

/// The walk's and the term's working memory, reused across calls so neither allocates once the
/// buffers have grown. Per thread, not global: workers run the setup phase in parallel and would
/// otherwise share one buffer, and a thread only ever reads what its own call just wrote.
///
/// Adoption is what made this necessary. While `expansionWeight` shipped at 0 the walk was never
/// entered in a measured run, so allocating freshly inside it cost nothing; M-66 put the term in
/// the field, and `cli/tests/alloc.rs` pins the setup hot loop at zero steady-state allocations.
#[derive(Default)]
struct Scratch {
    /// The candidate's own passable incident edges, sorted, which fixes the walk's order.
    firsts: Vec<(Edge, Vertex)>,
    /// One queue per paid-build count, drained cheapest first.
    bands: [Vec<Reached>; MAX_PAID_BUILDS + 1],
    /// Sites, flat and grouped by first edge; `edges` holds each edge and its `[start, end)` span.
    sites: Vec<ExpansionSite>,
    edges: Vec<(Edge, usize, usize)>,
    /// Per `term` call, indexed by vertex: a site's undiscounted score, and its cheapest reach.
    scores: Vec<Option<f64>>,
    cheapest: Vec<Option<(u32, f64)>>,
    /// One discounted value per site of the first edge being folded.
    values: Vec<f64>,
}

thread_local! {
    static SCRATCH: std::cell::RefCell<Scratch> =
        std::cell::RefCell::new(Scratch::default());
}

/// Every site the candidate opens through one of its own incident edges, written into `scratch`
/// grouped by that edge and listed in ascending edge order, which is ascending edge id and so the
/// order the TypeScript walk takes its sorted incident edges in.
///
/// The walk leaves `candidate` along each first edge and spreads outward. A rival's road is
/// impassable and a vertex a rival holds is a dead end, because a settlement stops a road network
/// even though a road may be laid right up to it. The seat's own roads are free to travel, the
/// first unowned edge on a path is free as well (it is the setup road the settlement comes with),
/// and every unowned edge after that costs one paid build. Reach ends at `MAX_PAID_BUILDS`.
///
/// A site is a vertex at least two edges out that would be legal once the candidate is built:
/// unoccupied, with no occupied neighbour, and not adjacent to the candidate.
fn walk(
    scratch: &mut Scratch,
    scorer: &AppFormulaScorer,
    vertex_owner: &[u8],
    edge_owner: &[u8],
    seat: u8,
    candidate: Vertex,
) {
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

    scratch.firsts.clear();
    scratch.firsts.extend(scorer.steps(candidate).filter(|(edge, _)| {
        let owner = edge_owner[usize::from(*edge)];
        owner == EMPTY || owner == seat
    }));
    scratch.firsts.sort_unstable();

    scratch.sites.clear();
    scratch.edges.clear();
    for index in 0..scratch.firsts.len() {
        let (first_edge, first_vertex) = scratch.firsts[index];
        // Cheapest-first: a free step joins the band being drained, a paid one the next band, so a
        // state is settled at its minimum paid-build count the first time it is popped.
        let bands = &mut scratch.bands;
        for band in bands.iter_mut() {
            band.clear();
        }
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
        // The two road-spent lanes settle a vertex separately, so one site can be popped twice:
        // once over the seat's own roads and once over the free setup road. Bands drain
        // cheapest-first, so the first pop is the cheapest one; recording the repeat would let
        // `top_two` pair a site with itself. One bit per vertex, unlike `settled`'s two lanes.
        let mut recorded = 0_u128;
        let span_start = scratch.sites.len();
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
                if state.vertex != first_vertex && recorded & bit == 0 && is_site(state.vertex) {
                    recorded |= bit;
                    scratch.sites.push(ExpansionSite {
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
        if scratch.sites.len() > span_start {
            scratch
                .edges
                .push((first_edge, span_start, scratch.sites.len()));
        }
    }
}

/// `walk`'s sites in the shape the tests read them: one owned vector per first edge.
#[cfg(test)]
pub(super) fn sites_by_edge(
    scorer: &AppFormulaScorer,
    vertex_owner: &[u8],
    edge_owner: &[u8],
    seat: u8,
    candidate: Vertex,
) -> Vec<(Edge, Vec<ExpansionSite>)> {
    SCRATCH.with_borrow_mut(|scratch| {
        walk(scratch, scorer, vertex_owner, edge_owner, seat, candidate);
        scratch
            .edges
            .iter()
            .map(|(edge, start, end)| (*edge, scratch.sites[*start..*end].to_vec()))
            .collect()
    })
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
    let mut with_candidate = *holdings;
    scorer.add_to_holdings(&mut with_candidate, candidate);
    SCRATCH.with_borrow_mut(|scratch| {
        walk(scratch, scorer, vertex_owner, edge_owner, seat, candidate);
        if scratch.edges.is_empty() {
            return NO_EXPANSION;
        }
        // One score per site, shared by every first edge that reaches it: a site's worth depends
        // on the site and the pair, never on the road taken to get there.
        scratch.scores.clear();
        scratch.scores.resize(vertex_owner.len(), None);
        // Each site at the cheapest paid-build count any first edge reaches it for, matching
        // `ExpansionSite`'s own definition. Folding on the larger *value* instead would pick the
        // dearest path for a site the pair scores below zero, decay shrinking a negative toward 0.
        // `expansion.ts::expansionTerm` folds the same way.
        scratch.cheapest.clear();
        scratch.cheapest.resize(vertex_owner.len(), None);
        let Scratch {
            sites,
            edges,
            scores,
            cheapest,
            values,
            ..
        } = scratch;

        let mut road: Option<Edge> = None;
        let mut best_site = f64::NEG_INFINITY;
        let mut best_pair = f64::NEG_INFINITY;
        for (first_edge, start, end) in edges.iter() {
            let span = &sites[*start..*end];
            values.clear();
            for site in span {
                let index = usize::from(site.vertex);
                let score = match scores[index] {
                    Some(score) => score,
                    None => {
                        // Unscaled by any draft slot: a site is a settlement some later turn buys,
                        // so what the pair's *current* pick position leans on says nothing about
                        // it. SP4's scales price this whole term instead, through the `expansion`
                        // scale its caller applies. `expansion.ts::expansionTerm` matches.
                        let score = scorer.total_with_holdings(with_candidate, site.vertex, false);
                        scores[index] = Some(score);
                        score
                    }
                };
                // `powf`, not `powi`: JavaScript's `**` is `Math.pow`, and the two Rust intrinsics
                // are free to round differently.
                values.push(score * weights.expansion_decay.powf(f64::from(site.paid_builds)));
            }
            let best = values
                .iter()
                .fold(f64::NEG_INFINITY, |held, value| js_max(held, *value));
            let pair = top_two(values);
            if road.is_none()
                || best > best_site
                || (best == best_site && pair > best_pair)
                || (best == best_site && pair == best_pair && Some(*first_edge) < road)
            {
                road = Some(*first_edge);
                best_site = best;
                best_pair = pair;
            }
            for (site, value) in span.iter().zip(values.iter()) {
                let held = &mut cheapest[usize::from(site.vertex)];
                if held.is_none_or(|(paid_builds, _)| site.paid_builds < paid_builds) {
                    *held = Some((site.paid_builds, *value));
                }
            }
        }
        // Folded in vertex order, which is the order the collected vector carried, and `top_two`
        // reads the same two numbers out of any order in any case.
        values.clear();
        values.extend(cheapest.iter().flatten().map(|(_, value)| *value));
        ExpansionValue {
            value: weights.expansion_weight * top_two(values),
            road,
        }
    })
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
    use crate::placement::app_formula::{EngineWeights, ResourceValues};
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

    /// A weight of 0 skips the walk entirely, which is what keeps a zeroed vector on the rollout
    /// hot path it was on before the term existed. The shipped weight is 0.1 since M-66, the SP6
    /// gate, so the shipped vector walks: that is asserted here too, because the whole adoption
    /// is worthless if the term the gate measured is skipped in the field.
    #[test]
    fn a_zero_weight_never_reaches_the_walk_and_the_shipped_one_does() {
        let (topology, board) = fixture();
        let shipped = default_weights();
        assert_eq!(shipped.expansion_weight, 0.1, "the shipped weight is the adopted 0.1");
        let mut zeroed = shipped.clone();
        zeroed.expansion_weight = 0.0;
        let scorer = AppFormulaScorer::new(&board, &topology, zeroed);
        let vertex_owner = vec![EMPTY; topology.vertex_count()];
        let edge_owner = vec![EMPTY; topology.edge_count()];

        let before = walk_calls();
        for vertex in 0..topology.vertex_count() {
            scorer.score_for_owner(&vertex_owner, &edge_owner, 0, vertex as Vertex, true);
            scorer.breakdown_for_owner(&vertex_owner, &edge_owner, 0, vertex as Vertex, false);
        }
        assert_eq!(walk_calls(), before, "weight 0 must not walk");

        let scorer = AppFormulaScorer::new(&board, &topology, shipped);
        let score = scorer.score_for_owner(&vertex_owner, &edge_owner, 0, 0, false);
        assert!(walk_calls() > before, "the shipped weight must walk");
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

    /// The road is the first edge of the cheapest path to the best site, ties on the larger
    /// top-two sum and then on the lower edge index.
    ///
    /// Recomputed here from the per-edge walk on every candidate the board offers, which is what
    /// `src/engine/__tests__/expansion.test.ts` does to the TypeScript rule. The parity fixture
    /// pins the term's *value* across the two languages and nothing pins its direction, so an
    /// arm at a nonzero weight could lay a road the app would not recommend with no test failing.
    #[test]
    fn the_road_goes_to_the_best_site_and_ties_fall_to_the_lower_edge() {
        let (topology, board) = fixture();
        let mut weights = default_weights();
        weights.expansion_weight = 0.3;
        let decay = weights.expansion_decay;
        let scorer = AppFormulaScorer::new(&board, &topology, weights);
        let vertex_owner = vec![EMPTY; topology.vertex_count()];
        let edge_owner = vec![EMPTY; topology.edge_count()];
        let holdings = Holdings::empty();

        let mut roads = 0;
        for vertex in 0..topology.vertex_count() {
            let candidate = vertex as Vertex;
            let by_edge = sites_by_edge(&scorer, &vertex_owner, &edge_owner, 0, candidate);
            let road = term(&scorer, &holdings, &vertex_owner, &edge_owner, 0, candidate).road;
            if by_edge.is_empty() {
                assert_eq!(road, None, "vertex {vertex} opens nothing");
                continue;
            }
            let mut with_candidate = holdings;
            scorer.add_to_holdings(&mut with_candidate, candidate);
            // (best, pair, edge), ranked the way the rule ranks them: best and pair descending,
            // edge ascending. `f64::total_cmp` only orders the keys here; the rule's own
            // comparisons are the ones under test.
            let mut ranked: Vec<(f64, f64, Edge)> = by_edge
                .iter()
                .map(|(first_edge, sites)| {
                    let mut values: Vec<f64> = sites
                        .iter()
                        .map(|site| {
                            scorer.total_with_holdings(with_candidate, site.vertex, false)
                                * decay.powf(f64::from(site.paid_builds))
                        })
                        .collect();
                    values.sort_by(|left, right| right.total_cmp(left));
                    // `top_two` of one value is that value, not the value plus negative infinity.
                    let best = values[0];
                    let pair = values.get(1).map_or(best, |second| best + second);
                    (best, pair, *first_edge)
                })
                .collect();
            ranked.sort_by(|left, right| {
                right
                    .0
                    .total_cmp(&left.0)
                    .then(right.1.total_cmp(&left.1))
                    .then(left.2.cmp(&right.2))
            });
            assert_eq!(road, Some(ranked[0].2), "vertex {vertex} road");
            roads += 1;
        }
        assert!(roads > 0, "no candidate on the fixture board opens a site");
    }

    /// A site is listed once per first edge, at the cheapest cost the walk reaches it for.
    ///
    /// A chain of the seat's own roads out of the candidate leaves both road-spent lanes live: the
    /// far end is reached over own roads with the setup road still in hand, and again a ring around
    /// with the road spent. The lanes settle separately, so without the per-vertex guard the walk
    /// lists that one site twice, at two costs, and `top_two` pairs it with itself. Mirrors
    /// `src/engine/__tests__/expansion.test.ts`.
    #[test]
    fn a_site_is_listed_once_per_first_edge() {
        let (topology, board) = fixture();
        let mut weights = default_weights();
        weights.expansion_weight = 0.3;
        let scorer = AppFormulaScorer::new(&board, &topology, weights);
        let candidate: Vertex = 24;
        let near = topology.vertex_edges(candidate)[0];
        let neighbour = topology
            .edge_endpoints(near)
            .into_iter()
            .find(|vertex| *vertex != candidate)
            .unwrap();
        let far = *topology
            .vertex_edges(neighbour)
            .iter()
            .find(|edge| **edge != near)
            .unwrap();
        let far_end = topology
            .edge_endpoints(far)
            .into_iter()
            .find(|vertex| *vertex != neighbour)
            .unwrap();

        let vertex_owner = vec![EMPTY; topology.vertex_count()];
        let mut edge_owner = vec![EMPTY; topology.edge_count()];
        edge_owner[usize::from(near)] = 0;
        edge_owner[usize::from(far)] = 0;

        let by_edge = sites_by_edge(&scorer, &vertex_owner, &edge_owner, 0, candidate);
        let sites = by_edge
            .iter()
            .find(|(edge, _)| *edge == near)
            .map(|(_, sites)| sites)
            .expect("the own-road direction must open sites");
        let listed: Vec<&ExpansionSite> =
            sites.iter().filter(|site| site.vertex == far_end).collect();
        assert_eq!(
            listed,
            vec![&ExpansionSite {
                vertex: far_end,
                paid_builds: 0
            }],
            "the far end of the own-road chain is one site, reached free"
        );
        for (edge, sites) in &by_edge {
            let mut seen: Vec<Vertex> = sites.iter().map(|site| site.vertex).collect();
            let listed = seen.len();
            seen.sort_unstable();
            seen.dedup();
            assert_eq!(seen.len(), listed, "edge {edge} listed a site twice");
        }
    }

    /// With every direction worth the same, the rule has nothing left but the edge index, and it
    /// must take the lower one.
    ///
    /// The tie is built by flattening the site scores rather than the board: every weight that
    /// feeds a vertex's value is zeroed, so each site is worth exactly 0 and each edge out of a
    /// candidate reaches the same best and the same pair. `expansion.ts` breaks the same tie on
    /// the lower edge *id*, a string comparison, and `topology.rs::pack_edges_are_listed_in_edge_id_order`
    /// is what keeps the two rules the same rule.
    #[test]
    fn equal_directions_fall_to_the_lower_edge() {
        let (topology, board) = fixture();
        let mut weights = default_weights();
        weights.expansion_weight = 0.3;
        weights.expansion_decay = 1.0;
        weights.resource_value = ResourceValues {
            wood: 0.0,
            sheep: 0.0,
            wheat: 0.0,
            brick: 0.0,
            ore: 0.0,
        };
        weights.hand_value_weight = 0.0;
        weights.scarcity_weight = 0.0;
        weights.diversity_weight = 0.0;
        weights.coverage_scarcity_weight = 0.0;
        weights.duplicate_number_penalty = 0.0;
        weights.recipe_road_bonus = 0.0;
        weights.recipe_city_bonus = 0.0;
        weights.recipe_settlement_bonus = 0.0;
        weights.recipe_dev_card_bonus = 0.0;
        weights.port_weight = 0.0;
        weights.port_coverage_deficit_weight = 0.0;
        weights.robber_discount = 0.0;
        weights.robber_concentration_weight = 0.0;
        let scorer = AppFormulaScorer::new(&board, &topology, weights);
        let vertex_owner = vec![EMPTY; topology.vertex_count()];
        let edge_owner = vec![EMPTY; topology.edge_count()];
        let holdings = Holdings::empty();

        let mut ties = 0;
        for vertex in 0..topology.vertex_count() {
            let candidate = vertex as Vertex;
            assert_eq!(
                scorer.total_with_holdings(holdings, candidate, false),
                0.0,
                "vertex {vertex} must be worth nothing, or the directions are not tied"
            );
            let by_edge = sites_by_edge(&scorer, &vertex_owner, &edge_owner, 0, candidate);
            if by_edge.len() < 2 {
                continue;
            }
            let road = term(&scorer, &holdings, &vertex_owner, &edge_owner, 0, candidate).road;
            let lowest = by_edge.iter().map(|(edge, _)| *edge).min();
            assert_eq!(road, lowest, "vertex {vertex} must fall to the lower edge");
            ties += 1;
        }
        assert!(ties > 0, "no candidate reached the edge tie-break");
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
