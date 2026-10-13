//! Rival picks and the windows they are played in: the rollout layer under the ranking.
//!
//! Twin of `opponentPick`, `bestPartners`, `partnerTable`, `bestLegalCandidate` and
//! `simulateWindowDetailed` in `src/engine/analyze.ts` at `5f4b97eb`. A vertex is its grid index,
//! so a scan in index order is the TypeScript's grid order.
//!
//! Every scan reads three views of the pieces. `blocked` is every vertex the distance rule bars.
//! `vertex_owner` is the settlements standing, the board's and the picks made since, each under
//! the seat holding it, and never the distance-rule closure: the expansion walk applies that rule
//! itself. It must give a seat exactly the vertices that seat's holdings fold. `edge_owner` is the
//! roads standing, the board's and the setup road of each pick made since.

use std::cell::{Cell, OnceCell, RefCell};
use std::collections::HashMap;

use super::{Board, softmax_pick};
use crate::placement::app_formula::{AppFormulaScorer, Holdings, SingleRoadBounds, js_max};
use crate::placement::expansion;
use crate::state::{EMPTY, MAX_SEATS};
use crate::topology::{Edge, Topology, Vertex};

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

/// What a window leaves behind, beside the blocked vertices and piece owners it grew in place.
pub(super) struct WindowResult {
    /// Every seat's holdings once the window has run.
    pub(super) holdings: Vec<Holdings>,
    /// The seat behind each entry of `taken`. A turn with nothing to pick is in neither.
    pub(super) pickers: Vec<u8>,
    pub(super) taken: Vec<Vertex>,
    pub(super) roads: Vec<Option<Edge>>,
}

/// Names a window's pick from the picks made so far, their seats, the seat on turn and its
/// uniform and earlier roads. `None`, or a blocked vertex, leaves the pick to `opponent_pick`.
pub(super) type PickOverride<'f> =
    &'f mut dyn FnMut(&[Vertex], &[u8], u8, f64, &[Option<Edge>]) -> Option<Vertex>;

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

/// A window's settlements and roads as bit masks, grown pick by pick between scans.
#[derive(Clone, Copy)]
struct Standing {
    by_seat: [u128; MAX_SEATS],
    settled: u128,
    /// Every settled vertex and its neighbours.
    closure: u128,
    edges_by_seat: [u128; MAX_SEATS],
    edges: u128,
}

impl Standing {
    fn new(topology: &Topology, vertex_owner: &[u8], edge_owner: &[u8]) -> Self {
        let mut standing = Self {
            by_seat: [0; MAX_SEATS], settled: 0, closure: 0,
            edges_by_seat: [0; MAX_SEATS], edges: 0,
        };
        for (vertex, seat) in vertex_owner.iter().enumerate() {
            if *seat != EMPTY {
                standing.settle(topology, vertex as Vertex, *seat);
            }
        }
        for (edge, owner) in edge_owner.iter().enumerate() {
            if *owner != EMPTY {
                standing.road(edge as Edge, *owner);
            }
        }
        standing
    }

    fn occupancy(&self, seat: u8) -> expansion::Occupancy {
        let own = self.by_seat[usize::from(seat)];
        let roads = self.edges_by_seat[usize::from(seat)];
        expansion::Occupancy::default()
            .with_roads(roads, self.edges & !roads)
            .with_settlements(own, self.settled & !own, self.closure)
    }

    fn road(&mut self, edge: Edge, seat: u8) {
        self.edges_by_seat[usize::from(seat)] |= 1 << edge;
        self.edges |= 1 << edge;
    }

    fn settle(&mut self, topology: &Topology, vertex: Vertex, seat: u8) {
        let bit = 1 << vertex;
        self.by_seat[usize::from(seat)] |= bit;
        self.settled |= bit;
        self.closure |= bit;
        for adjacent in topology.vertex_adjacent(vertex) {
            self.closure |= 1 << adjacent;
        }
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

// Vertices this thread priced both ways and found equal, vertices a scan skipped by their bound,
// pair candidates skipped by theirs, and scans that read their window's masks, so a test can tell
// the fast path ran, that it skipped, and that a window carried its settlements.
#[cfg(test)]
thread_local! {
    static CARRIED_SCANS: Cell<usize> = const { Cell::new(0) };
    static CHECKED_VERTICES: Cell<usize> = const { Cell::new(0) };
    static SKIPPED_VERTICES: Cell<usize> = const { Cell::new(0) };
    static SKIPPED_PAIRS: Cell<usize> = const { Cell::new(0) };
}

#[cfg(test)]
fn carried_scans() -> usize {
    CARRIED_SCANS.with(Cell::get)
}

#[cfg(test)]
pub(super) fn checked_vertices() -> usize {
    CHECKED_VERTICES.with(Cell::get)
}

#[cfg(test)]
pub(super) fn skipped_vertices() -> usize {
    SKIPPED_VERTICES.with(Cell::get)
}

#[cfg(test)]
pub(super) fn skipped_pairs() -> usize {
    SKIPPED_PAIRS.with(Cell::get)
}

/// The scorer and partner tables shared by every scan of a ranking.
pub(super) struct Context<'a> {
    pub(super) scorer: &'a AppFormulaScorer,
    topology: &'static Topology,
    #[cfg(test)]
    pub(super) edge_owner: Vec<u8>,
    /// One partner table per seat, which is the draft slot the scores scale by, built on first
    /// use.
    partners: Vec<OnceCell<Vec<f64>>>,
    /// The highest entry of each row of a seat's partner table that a partner could read.
    partner_caps: Vec<OnceCell<Vec<f64>>>,
    /// The pieces of the window on turn, set by `simulate_window` around each pick it leaves
    /// to `opponent_pick`. A scan made outside a window finds none and reads `vertex_owner`.
    standing: Cell<Option<Standing>>,
    roads: RefCell<HashMap<(Vertex, [u128; 5]), Option<Edge>>>,
    base_rows: RefCell<HashMap<(u128, u8), Vec<Option<f64>>>>,
    open_bounds: RefCell<HashMap<u128, Vec<Option<f64>>>>,
    single_road_bounds: RefCell<HashMap<(Vertex, Edge, u128), SingleRoadBounds>>,
}

impl<'a> Context<'a> {
    /// `scorer` is `board.scorer(..)` and serves every scratch board a ranking builds.
    pub(super) fn new(board: &Board, scorer: &'a AppFormulaScorer) -> Self {
        let seats = board.player_ids.len();
        #[cfg(test)]
        let edge_owner = board.owners().1;
        Self {
            scorer,
            topology: board.topology,
            #[cfg(test)]
            edge_owner,
            partners: vec![OnceCell::new(); seats],
            partner_caps: vec![OnceCell::new(); seats],
            standing: Cell::new(None),
            roads: RefCell::new(HashMap::new()),
            base_rows: RefCell::new(HashMap::new()),
            open_bounds: RefCell::new(HashMap::new()),
            single_road_bounds: RefCell::new(HashMap::new()),
        }
    }

    /// Repeated rollouts reuse roads by holdings and the occupancy the walk can read.
    pub(super) fn setup_road(
        &self,
        holdings: &Holdings,
        vertex_owner: &[u8],
        edge_owner: &[u8],
        seat: u8,
        candidate: Vertex,
        occupancy: Option<&expansion::Occupancy>,
    ) -> Option<Edge> {
        let scorer = self.scorer;
        let occupancy = occupancy.copied().unwrap_or_else(|| {
            expansion::Occupancy::new(scorer, vertex_owner, edge_owner, seat)
        });
        let compute = || expansion::row_road(
            scorer, vertex_owner, edge_owner, seat, candidate, Some(&occupancy),
        );
        let road = if let Ok(mut roads) = self.roads.try_borrow_mut() {
            *roads.entry((candidate, occupancy.road_key(scorer, candidate))).or_insert_with(compute)
        } else {
            compute()
        };
        #[cfg(any(test, debug_assertions))]
        assert_eq!(road, expansion::term(scorer, holdings, vertex_owner, edge_owner, seat, candidate).road);
        #[cfg(not(any(test, debug_assertions)))]
        let _ = holdings;
        road
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

    /// The most a first settlement's partner can score without its expansion component: the
    /// highest entry of its table row outside the vertex and its neighbours. A NaN entry never
    /// wins a partner scan, so it is passed over here as well.
    fn partner_caps(&self, seat: u8) -> &[f64] {
        self.partner_caps[usize::from(seat)].get_or_init(|| {
            let count = self.topology.vertex_count();
            let table = self.partner_table(seat);
            (0..count)
                .map(|first| {
                    let row = &table[first * count..][..count];
                    let adjacent = self.topology.vertex_adjacent(first as Vertex);
                    (0..count)
                        .filter(|second| {
                            *second != first && !adjacent.contains(&(*second as Vertex))
                        })
                        .fold(f64::NEG_INFINITY, |cap, second| cap.max(row[second]))
                })
                .collect()
        })
    }

    /// Calls `visit` with every unblocked vertex in index order and what `marginal_parts` gives
    /// `seat` for it: the slot-scaled expansion part, then the total.
    ///
    /// `floor` is the total a vertex has to beat to matter to the caller, who may raise it from
    /// `visit`; NaN is no floor. A vertex is neither priced nor visited when the scorer's upper
    /// bound on its expansion part puts its total at or below the floor. The bound is added up
    /// with the operations of the total, which round in step with their operands, so a skipped
    /// vertex's total is at or below the floor too. Weights the bound does not cover skip nothing.
    ///
    /// The numbers come off the scorer's fast paths and carry the reference's bits. The part
    /// without expansion and the open-table bounds are indexed by the vertices the seat holds, plus
    /// seat and grant for the former. The expansion part takes a candidate's sites from the shared
    /// reach table, from the one-road table when exactly one of the seat's roads is near, or from
    /// a masked walk over the window's pieces as bit masks, prices them through `SitePricer`, and
    /// remembers the result. Debug and test builds price every vertex both ways and compare.
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
        edge_owner: &[u8],
        receives_grant: bool,
        floor: &Cell<f64>,
        visit: &mut dyn FnMut(Vertex, f64, f64),
    ) {
        let scorer = self.scorer;
        let reference = |vertex: Vertex| {
            scorer.marginal_parts(
                holdings,
                vertex_owner,
                edge_owner,
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
            let rebuilt = || expansion::Occupancy::new(scorer, vertex_owner, edge_owner, seat);
            let occupancy = match self.standing.get() {
                Some(standing) => {
                    #[cfg(test)]
                    CARRIED_SCANS.with(|carried| carried.set(carried.get() + 1));
                    standing.occupancy(seat)
                }
                None => rebuilt(),
            };
            #[cfg(any(test, debug_assertions))]
            assert_eq!(occupancy, rebuilt(), "seat {seat}: the masks carried against rebuilt");
            let serial = memo.serial(scorer.id, occupancy.own_vertices);
            let base_tag = expansion::base_tag(seat, receives_grant);
            let bounds = scorer.expansion_bounds(scale.expansion);
            let single_edge = occupancy.single_edge();
            let mut holdings_total = None;
            let mut open_bounds = self.open_bounds.borrow_mut();
            let mut open_row = bounds.map(|_| open_bounds.entry(occupancy.own_vertices)
                .or_insert_with(|| vec![None; self.topology.vertex_count()]));
            let mut base_rows = self.base_rows.borrow_mut();
            let base_row = base_rows.entry((occupancy.own_vertices, base_tag))
                .or_insert_with(|| vec![None; self.topology.vertex_count()]);
            for vertex in legal {
                let rest = *base_row[usize::from(vertex)].get_or_insert_with(|| {
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
                #[cfg(any(test, debug_assertions))]
                {
                    let total = scorer.holdings_diversity_total(holdings);
                    let expected = scorer.scaled_total_with_diversity(
                        *holdings, vertex, receives_grant, scale.diversity, total,
                    );
                    assert_eq!(rest.to_bits(), expected.to_bits(), "cached base at {vertex}");
                }
                let table_path = scorer.reach.table_path(vertex, &occupancy);
                let single = single_edge.filter(|_| !table_path);
                let floor = floor.get();
                if let Some(bounds) = bounds
                    && !floor.is_nan()
                {
                    let upper = if let Some(edge) = single {
                        let key = expansion::single_road_bound_key(serial, vertex, edge);
                        memo.price(key, || {
                            let mut held = self.single_road_bounds.borrow_mut();
                            let sites = held.entry((vertex, edge, occupancy.own_vertices))
                                .or_insert_with(|| {
                                    let reach = scorer.reach.single_road(vertex, edge);
                                    SingleRoadBounds::new(scorer, reach, occupancy.own_vertices)
                                });
                            bounds.single_road_value(scorer, holdings, vertex, sites)
                        })
                    } else if table_path {
                        let value = *open_row.as_mut().expect("bounds have a row")[usize::from(vertex)]
                            .get_or_insert_with(|| bounds.value(scorer, holdings, vertex, true));
                        #[cfg(any(test, debug_assertions))]
                        assert_eq!(value.to_bits(), bounds.value(scorer, holdings, vertex, true).to_bits(),
                            "cached open bound at {vertex}");
                        value
                    } else {
                        let key = expansion::bound_key(serial, vertex, false);
                        memo.price(key, || bounds.value(scorer, holdings, vertex, false))
                    };
                    #[cfg(any(test, debug_assertions))]
                    if let Some(edge) = single {
                        let fresh = SingleRoadBounds::new(scorer, scorer.reach.single_road(vertex, edge), occupancy.own_vertices);
                        let fresh = bounds.single_road_value(scorer, holdings, vertex, &fresh);
                        assert_eq!(upper.to_bits(), fresh.to_bits(), "cached single-road bound at {vertex}");
                        assert!(scale.expansion * upper + rest >= reference(vertex).1, "single-road bound at {vertex}");
                    }
                    if scale.expansion * upper + rest <= floor {
                        #[cfg(test)]
                        SKIPPED_VERTICES.with(|skipped| skipped.set(skipped.get() + 1));
                        continue;
                    }
                }
                let sites = if let Some(edge) = single {
                    let reach = scorer.reach.single_road(vertex, edge);
                    expansion::single_road_value(scorer, holdings, vertex, &occupancy, memo, serial, reach)
                } else {
                    expansion::row_value(scorer, holdings, vertex, &occupancy, memo, Some(serial))
                };
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
    pub(super) fn best_partners(
        &self,
        legal: &[Vertex],
        table: &[f64],
        expansion: &[f64],
    ) -> Partners {
        let mut skip = vec![false; self.topology.vertex_count()];
        let mut partners = Partners {
            mate: Vec::with_capacity(legal.len()),
            value: Vec::with_capacity(legal.len()),
        };
        for index in 0..legal.len() {
            let (mate, value) = self.best_partner(legal, table, expansion, index, &mut skip);
            partners.mate.push(mate);
            partners.value.push(value);
        }
        partners
    }

    /// One row of `best_partners`: the mate and value of `legal[index]`. Strict `>` from negative
    /// infinity, so the lowest index wins a tie. `skip` is scratch, one flag per vertex, all
    /// clear on entry and on return.
    fn best_partner(
        &self,
        legal: &[Vertex],
        table: &[f64],
        expansion: &[f64],
        index: usize,
        skip: &mut [bool],
    ) -> (Option<usize>, f64) {
        let count = self.topology.vertex_count();
        let vertex = legal[index];
        let row = &table[usize::from(vertex) * count..][..count];
        // Vertices the row cannot pair with: itself and its neighbours, marked then unmarked.
        block_vertex(self.topology, skip, vertex);
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
        skip[usize::from(vertex)] = false;
        for adjacent in self.topology.vertex_adjacent(vertex) {
            skip[usize::from(*adjacent)] = false;
        }
        (best_index, if best_index.is_some() { best } else { 0.0 })
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
        edge_owner: &[u8],
        receives_grant: bool,
        has_later_pick: bool,
    ) -> (Vec<Vertex>, Vec<f64>) {
        let find = |bounded| {
            self.top_candidates_scan(
                seat,
                holdings,
                blocked,
                vertex_owner,
                edge_owner,
                receives_grant,
                has_later_pick,
                bounded,
            )
        };
        let top = find(true);
        #[cfg(any(test, debug_assertions))]
        {
            let bits = |top: &(Vec<Vertex>, Vec<f64>)| {
                (top.0.clone(), top.1.iter().map(|score| score.to_bits()).collect::<Vec<_>>())
            };
            assert_eq!(bits(&top), bits(&find(false)), "seat {seat}: bounded against full");
        }
        top
    }

    /// `top_candidates`, skipping the vertices that cannot make the list when `bounded`.
    #[allow(clippy::too_many_arguments)]
    fn top_candidates_scan(
        &self,
        seat: u8,
        holdings: &Holdings,
        blocked: &[bool],
        vertex_owner: &[u8],
        edge_owner: &[u8],
        receives_grant: bool,
        has_later_pick: bool,
        bounded: bool,
    ) -> (Vec<Vertex>, Vec<f64>) {
        let top_k = js_max(1.0, self.scorer.weights().opponent_top_k);
        let floor = Cell::new(f64::NAN);
        let mut top_vertices = Vec::new();
        let mut top_scores = Vec::new();
        let Some(table) =
            (has_later_pick && !vertex_owner.contains(&seat)).then(|| self.partner_table(seat))
        else {
            // Priced alone, a vertex is ranked as it is visited, and once the list is full a
            // score at or below its last ranks past the cut. A NaN score ranks first and lets
            // every later score in ahead of it, so nothing is skipped once one is listed.
            let mut any_nan = false;
            let mut rank = |vertex, _, total: f64| {
                insert_top(&mut top_vertices, &mut top_scores, top_k, vertex, total);
                any_nan |= total.is_nan();
                if bounded && !any_nan && top_scores.len() as f64 >= top_k {
                    floor.set(top_scores[top_scores.len() - 1]);
                } else {
                    floor.set(f64::NAN);
                }
            };
            self.scan(seat, holdings, blocked, vertex_owner, edge_owner, receives_grant, &floor, &mut rank);
            return (top_vertices, top_scores);
        };
        // Priced as a pair, every vertex is some candidate's partner, so all of them are priced.
        let count = self.topology.vertex_count();
        let mut legal = Vec::with_capacity(count);
        let mut own = Vec::with_capacity(count);
        // The scan's two halves kept apart: the walk's value is also the partner's expansion.
        let mut expansion = Vec::with_capacity(count);
        let mut keep = |vertex, walk, total| {
            legal.push(vertex);
            expansion.push(walk);
            own.push(total);
        };
        self.scan(seat, holdings, blocked, vertex_owner, edge_owner, receives_grant, &floor, &mut keep);
        // Each candidate's mate and partner value. The full scan has `best_partners` find them
        // all; the bounded one finds a row when a candidate that may make the list reads it.
        let mut plans: Vec<Option<(Option<usize>, f64)>> = if bounded {
            vec![None; legal.len()]
        } else {
            let plan = self.best_partners(&legal, table, &expansion);
            plan.mate.into_iter().zip(plan.value).map(Some).collect()
        };
        let mut skip = vec![false; count];
        let mut plan = |index: usize| {
            *plans[index].get_or_insert_with(|| {
                self.best_partner(&legal, table, &expansion, index, &mut skip)
            })
        };
        // No partner is worth more than the best its table row holds beside the highest
        // expansion on the board, and a candidate with no partner adds 0.
        let caps = self.partner_caps(seat);
        let reach = expansion.iter().copied().fold(f64::NEG_INFINITY, js_max);
        let mut any_nan = false;
        for (index, vertex) in legal.iter().enumerate() {
            // The cut of the alone branch above, on the most the pair can score.
            if bounded
                && !any_nan
                && top_scores.len() as f64 >= top_k
                && own[index] + js_max(caps[usize::from(*vertex)] + reach, 0.0)
                    <= top_scores[top_scores.len() - 1]
            {
                #[cfg(test)]
                SKIPPED_PAIRS.with(|skipped| skipped.set(skipped.get() + 1));
                continue;
            }
            let (mate, value) = plan(index);
            let score = own[index] + value;
            if let Some(other) = mate {
                let (mate_of_other, value_of_other) = plan(other);
                if mate_of_other == Some(index) {
                    // The grant goes to the second settlement, so with it priced the two
                    // orientations of a pair differ and the better one is the candidate; otherwise
                    // they tie to the bit and the half worth more alone goes first.
                    let gap = score - (own[other] + value_of_other);
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
            any_nan |= score.is_nan();
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
        edge_owner: &[u8],
        uniform: f64,
        receives_grant: bool,
        has_later_pick: bool,
    ) -> Option<Vertex> {
        let (vertices, scores) = self.top_candidates(
            seat,
            holdings,
            blocked,
            vertex_owner,
            edge_owner,
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
        edge_owner: &[u8],
        receives_grant: bool,
    ) -> Option<Vertex> {
        // The best vertex and its score's bits, skipping the vertices that cannot beat the best
        // so far when `bounded`. A later vertex has to score higher, so one that can only tie is
        // skipped as well.
        let find = |bounded| {
            let mut best = None;
            let mut best_score = f64::NEG_INFINITY;
            let floor = Cell::new(f64::NAN);
            let mut keep = |vertex, _, score| {
                if score > best_score {
                    best = Some(vertex);
                    best_score = score;
                    if bounded {
                        floor.set(score);
                    }
                }
            };
            self.scan(seat, holdings, blocked, vertex_owner, edge_owner, receives_grant, &floor, &mut keep);
            (best, best_score.to_bits())
        };
        let best = find(true);
        #[cfg(any(test, debug_assertions))]
        assert_eq!(best, find(false), "seat {seat}: bounded against full");
        best.0
    }

    /// Twin of `simulateWindowDetailed`: plays `turns` in order from `initial_holdings`, which is
    /// indexed by seat. Each turn draws one uniform whether or not `pick_override` supplies its
    /// pick, and a turn with nothing to pick is skipped. A pick bars its vertex and neighbours in
    /// `blocked`, stands in `vertex_owner` on its vertex alone, and lays its road in `edge_owner`.
    ///
    /// The pieces are read into bit masks on entry and each pick grows them, so later scans
    /// read the current settlements and roads without rebuilding them.
    pub(super) fn simulate_window(
        &self,
        turns: &[Turn],
        initial_holdings: &[Holdings],
        blocked: &mut [bool],
        vertex_owner: &mut [u8],
        edge_owner: &mut [u8],
        next_uniform: &mut dyn FnMut() -> f64,
        mut pick_override: Option<PickOverride<'_>>,
    ) -> WindowResult {
        let mut result = WindowResult {
            holdings: initial_holdings.to_vec(),
            pickers: Vec::with_capacity(turns.len()),
            taken: Vec::with_capacity(turns.len()),
            roads: Vec::with_capacity(turns.len()),
        };
        let mut standing = Standing::new(self.topology, vertex_owner, edge_owner);
        for turn in turns {
            let uniform = next_uniform();
            let held = result.holdings[usize::from(turn.seat)];
            let forced = pick_override
                .as_mut()
                .and_then(|pick| pick(&result.taken, &result.pickers, turn.seat, uniform, &result.roads))
                .filter(|vertex| !blocked[usize::from(*vertex)]);
            let picked = forced.or_else(|| {
                // Held only across this call: an override may run a nested ranking, whose windows
                // share the context.
                self.standing.set(Some(standing));
                let picked = self.opponent_pick(
                    turn.seat,
                    &held,
                    blocked,
                    vertex_owner,
                    edge_owner,
                    uniform,
                    turn.receives_grant,
                    turn.has_later_pick,
                );
                self.standing.set(None);
                picked
            });
            let Some(vertex) = picked else { continue };
            let road = self.setup_road(
                &held, vertex_owner, edge_owner, turn.seat, vertex,
                Some(&standing.occupancy(turn.seat)),
            );
            if let Some(edge) = road {
                edge_owner[usize::from(edge)] = turn.seat;
                standing.road(edge, turn.seat);
            }
            block_vertex(self.topology, blocked, vertex);
            vertex_owner[usize::from(vertex)] = turn.seat;
            standing.settle(self.topology, vertex, turn.seat);
            self.scorer
                .add_to_holdings(&mut result.holdings[usize::from(turn.seat)], vertex);
            result.taken.push(vertex);
            result.roads.push(road);
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
            context.best_legal_candidate(0, &holdings, blocked, &vertex_owner, &context.edge_owner, false)
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
            context.best_legal_candidate(0, &holdings, &blocked, &vertex_owner, &context.edge_owner, false),
            None
        );
        // Each NaN lands at rank 0 and pushes the list down, so the last three scanned are left.
        let (vertices, scores) =
            context.top_candidates(0, &holdings, &blocked, &vertex_owner, &context.edge_owner, false, false);
        let last: Vec<Vertex> = legal.iter().rev().take(3).copied().collect();
        assert_eq!(vertices, last);
        assert!(scores.iter().all(|score| score.is_nan()));
        assert_eq!(
            context.opponent_pick(0, &holdings, &blocked, &vertex_owner, &context.edge_owner, 0.0, false, false),
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
            context.opponent_pick(0, &holdings, &blocked, &vertex_owner, &context.edge_owner, uniform, false, false)
        };
        assert_eq!(pick(0.0), Some(legal[0]));
        assert_eq!(pick(0.2), Some(legal[0]));
        assert_eq!(pick(0.5), Some(legal[1]));
        assert_eq!(pick(0.9), Some(legal[2]));
    }

    #[test]
    fn bounded_scans_keep_the_lowest_index_among_equal_scores() {
        // Nothing produces and expansion is unpriced, so every score ties and every bound is the
        // score it caps: each tie is settled by a skip.
        let (board, mut weights) = corpus("numberless-board");
        weights.expansion_weight = 0.0;
        weights.opponent_top_k = 3.0;
        let scorer = board.scorer(weights);
        let context = Context::new(&board, &scorer);
        let (vertex_owner, _) = board.owners();
        let blocked = board.blocked();
        let legal = board.legal_vertices();
        let holdings = Holdings::empty();
        let top = |has_later_pick, bounded| {
            context
                .top_candidates_scan(
                    0,
                    &holdings,
                    &blocked,
                    &vertex_owner,
                    &context.edge_owner,
                    false,
                    has_later_pick,
                    bounded,
                )
                .0
        };

        let skipped = skipped_vertices();
        assert_eq!(
            context.best_legal_candidate(0, &holdings, &blocked, &vertex_owner, &context.edge_owner, false),
            Some(legal[0])
        );
        assert_eq!(skipped_vertices() - skipped, legal.len() - 1);
        assert_eq!(top(false, true), legal[..3]);
        assert_eq!(skipped_vertices() - skipped, 2 * legal.len() - 4);

        let skipped = skipped_pairs();
        let pairs = top(true, true);
        assert!(skipped_pairs() > skipped, "no pair was skipped");
        assert_eq!(pairs, top(true, false));
        assert_eq!(pairs[0], legal[0]);
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
            &context.edge_owner,
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
            context.top_candidates(holder, &holdings, &blocked, &vertex_owner, &context.edge_owner, true, has_later_pick)
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
            &mut context.edge_owner.clone(),
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
    fn a_window_carries_its_settlements_from_pick_to_pick() {
        // The board already holds settlements, and every scan of a test build compares the masks
        // it was handed with the masks rebuilt from `vertex_owner`.
        let (board, weights) = corpus("mid-first-round");
        let scorer = board.scorer(weights);
        let context = Context::new(&board, &scorer);
        let carried = carried_scans();
        let ran = run_window(&board, &context, board.blocked(), None);
        assert_eq!(ran.result.taken.len(), 3);
        // Each pick is scanned twice in a test build: bounded, then in full.
        assert_eq!(carried_scans() - carried, 6);

        // A scan outside a window has no masks to read and rebuilds them.
        let holdings = Holdings::empty();
        context.best_legal_candidate(3, &holdings, &ran.blocked, &ran.vertex_owner, &context.edge_owner, false);
        assert_eq!(carried_scans() - carried, 6);
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
            Some(&mut |taken: &[Vertex], pickers: &[u8], seat, uniform, _| {
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
        let repeated = run_window(&board, &context, board.blocked(), Some(&mut |_, _, _, _, _| {
            Some(forced[0])
        }));
        let once = run_window(
            &board,
            &context,
            board.blocked(),
            Some(&mut |taken: &[Vertex], _, _, _, _| taken.is_empty().then_some(forced[0])),
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
            let ran = run_window(&board, &context, all.clone(), Some(&mut |_, _, _, _, _| forced));
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
    #[test]
    fn base_rows_keep_holdings_seat_and_grant_across_road_changes() {
        for contest_weight in [0.0, 0.5] {
            let discounted = crate::placement::expansion::discounted_sites();
            let (board, mut weights) = corpus("empty-first-seat-standard4");
            weights.contest_weight = contest_weight;
            weights.hand_value_weight = 0.4;
            let scorer = board.scorer(weights);
            let context = Context::new(&board, &scorer);
            for road_owner in [EMPTY, 1, 0, EMPTY] {
                for seat in 0..2 {
                    for held in [None, Some(0), Some(7)] {
                        for grant in [false, true] {
                            let (mut vertices, mut edges) = board.owners();
                            edges[0] = road_owner;
                            let mut blocked = board.blocked();
                            if let Some(vertex) = held {
                                vertices[usize::from(vertex)] = seat;
                                block_vertex(board.topology, &mut blocked, vertex);
                            }
                            let holdings = scorer.holdings_for_owner(&vertices, seat);
                            context.scan(seat, &holdings, &blocked, &vertices, &edges, grant,
                                &Cell::new(f64::NAN), &mut |vertex, expansion, total| {
                                    let expected = scorer.marginal_parts(
                                        &holdings, &vertices, &edges, seat, vertex, grant,
                                    );
                                    assert_eq!((expansion.to_bits(), total.to_bits()),
                                        (expected.0.to_bits(), expected.1.to_bits()));
                                });
                        }
                    }
                }
            }
            assert_eq!(context.base_rows.borrow().len(), 12);
            if contest_weight != 0.0 {
                assert!(crate::placement::expansion::discounted_sites() > discounted);
            }
        }
    }

    #[test]
    fn open_bound_rows_keep_holdings_when_the_board_changes() {
        for contest_weight in [0.0, 0.5] {
            let discounted = crate::placement::expansion::discounted_sites();
            let (board, mut weights) = corpus("empty-first-seat-standard4");
            weights.contest_weight = contest_weight;
            let scorer = board.scorer(weights);
            let context = Context::new(&board, &scorer);
            for _ in 0..2 {
                for held in [None, Some(0), Some(7)] {
                    let (mut vertices, mut edges) = board.owners();
                    let mut blocked = board.blocked();
                    if let Some(vertex) = held {
                        vertices[usize::from(vertex)] = 0;
                        block_vertex(board.topology, &mut blocked, vertex);
                    }
                    if contest_weight != 0.0 {
                        vertices[20] = 1;
                        block_vertex(board.topology, &mut blocked, 20);
                        edges[usize::from(board.topology.vertex_edges(20)[0])] = 1;
                    }
                    let holdings = scorer.holdings_for_owner(&vertices, 0);
                    context.scan(0, &holdings, &blocked, &vertices, &edges, false,
                        &Cell::new(f64::NEG_INFINITY), &mut |_, _, _| {});
                }
            }
            assert_eq!(context.open_bounds.borrow().len(), 3);
            if contest_weight != 0.0 {
                assert!(crate::placement::expansion::discounted_sites() > discounted);
            }
        }
    }

}
