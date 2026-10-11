//! SP5's draft-aware setup: a first settlement valued by what survives the picks that follow it.
//!
//! The field's `app_formula` takes the greedy argmax at every setup pick, so it prices a first
//! settlement as though the board would still be untouched when its turn came round again. This
//! kind models the picks in between: it puts a candidate down, lets every intervening seat take
//! the argmax the same formula would take, and scores the candidate by its own worth plus the
//! best second settlement still standing once the rivals have had their turn.
//!
//! Knowing what each rival would have taken is also what makes a denial credit possible, so
//! `setupDenialWeight` rides this kind and no other: at a nonzero weight a candidate is paid for
//! what taking it costs the rivals who pick before the hero's second settlement. It ships at 0.
//!
//! Deterministic by construction, so it never draws on the policy RNG stream: settlement ties go
//! to the lowest vertex index and road ties to the lowest edge id, where the field draws at
//! random. Exactness against the field is the model's point, so the lookahead scores every legal
//! candidate and every intervening pick. `ScoreRows` reuses whole rows when possible and otherwise
//! bounds argmax candidates before evaluating those that can still win.

use std::ops::Range;

use super::app_formula::{AppFormulaScorer, js_max};
use super::expansion;
use crate::game::{can_place_settlement, setup_order};
use crate::state::EMPTY;
use crate::topology::{Edge, Topology, Vertex};

/// The two formulas a draft arm runs: the hero's, which an arm sweeps, and the opponent model's,
/// pinned to the field's weights so a sweep moves one side of the draft only.
#[derive(Clone, Debug)]
pub(crate) struct DraftScorers {
    pub hero: AppFormulaScorer,
    pub opponent: AppFormulaScorer,
}

#[derive(Clone, Copy)]
struct RowArgmax {
    taken: Option<(Vertex, f64)>,
    free: Option<(Vertex, f64)>,
    occupancy: Option<expansion::Occupancy>,
}

#[cfg(test)]
use std::cell::Cell;

#[cfg(test)]
thread_local! {
    // Per row kind: legal candidates and exact evaluations, excluding the reference check.
    static ARGMAX_COUNTS: Cell<[[usize; 2]; 2]> = const { Cell::new([[0; 2]; 2]) };
}

/// One seat's vertex scores, at one holdings set and one setup grant.
///
/// Every component of the formula but `expansion` is a function of the seat, its own holdings and
/// the candidate alone, so a row computed while weighing one hero candidate is exactly the row
/// wanted for the next. `expansion` is the exception: it walks the occupancy around the
/// candidate, which the lookahead moves as it replays. Rows are therefore kept only while both
/// formulas carry `expansionWeight` 0. Otherwise the lookahead scores only legal vertices into
/// `scratch`, including those reopened for denial.
struct ScoreRows {
    /// Row length: the board's vertices, which is what `best_legal` scans.
    vertices: usize,
    /// Key space for the holdings half of a row key, which indexes the owner array rather than
    /// the vertex range: the engine hands out a fixed-width owner array wider than the layout.
    owner_slots: usize,
    reusable: bool,
    rows: Vec<Option<Vec<f64>>>,
    scratch: Vec<f64>,
}

impl ScoreRows {
    fn new(seats: usize, vertices: usize, owner_slots: usize, reusable: bool) -> Self {
        let slots = if reusable {
            seats * (owner_slots + 1) * 2
        } else {
            0
        };
        Self {
            vertices,
            owner_slots,
            reusable,
            rows: vec![None; slots],
            scratch: Vec::new(),
        }
    }

    /// The seat's row as `best_legal` reads it under `vacated`: the cached row while rows are
    /// reusable, otherwise scores for the legal vertices alone and `NEG_INFINITY` for the rest,
    /// which no scan reads.
    #[allow(clippy::too_many_arguments)]
    fn legal_row(
        &mut self,
        scorer: &AppFormulaScorer,
        topology: &Topology,
        vertex_owner: &[u8],
        edge_owner: &[u8],
        seat: u8,
        grant: bool,
        vacated: Option<Vertex>,
    ) -> &[f64] {
        self.legal_row_with_memo(
            scorer, topology, vertex_owner, edge_owner, seat, grant, vacated, true,
        ).0
    }

    #[allow(clippy::too_many_arguments)]
    fn legal_row_with_memo(
        &mut self,
        scorer: &AppFormulaScorer,
        topology: &Topology,
        vertex_owner: &[u8],
        edge_owner: &[u8],
        seat: u8,
        grant: bool,
        vacated: Option<Vertex>,
        memoize: bool,
    ) -> (&[f64], Option<expansion::Occupancy>) {
        if self.reusable {
            return (self.row(scorer, vertex_owner, edge_owner, seat, grant), None);
        }
        let holdings = scorer.holdings_for_owner(vertex_owner, seat);
        let mut holdings_total = None;
        let scale = scorer.slot_scale(seat);
        let occupancy = expansion::Occupancy::new(scorer, vertex_owner, edge_owner, seat);
        self.scratch.clear();
        expansion::PRICE_MEMO.with_borrow_mut(|memo| {
            let serial = memoize.then(|| memo.serial(scorer.id, occupancy.own_vertices));
            let base_tag = expansion::base_tag(seat, grant);
            self.scratch.extend((0..self.vertices).map(|index| {
                let vertex = index as Vertex;
                let legal = if vacated.is_none() {
                    occupancy.blocked & (1 << vertex) == 0
                } else {
                    legal_with_vacancy(topology, vertex_owner, vacated, vertex)
                };
                if legal {
                    let mut base_total = || {
                        let total = *holdings_total
                            .get_or_insert_with(|| scorer.holdings_diversity_total(&holdings));
                        scorer.scaled_total_with_diversity(
                            holdings, vertex, grant, scale.diversity, total,
                        )
                    };
                    let base = if let Some(serial) = serial {
                        let key = expansion::price_key(serial, vertex, base_tag);
                        memo.price(key, base_total)
                    } else {
                        base_total()
                    };
                    base + scale.expansion * expansion::row_value(
                        scorer, &holdings, vertex, &occupancy, memo, serial,
                    )
                } else {
                    f64::NEG_INFINITY
                }
            }));
        });
        (&self.scratch, Some(occupancy))
    }

    /// Strict bound skips preserve both nested argmaxes; unsupported arithmetic uses the full row.
    #[allow(clippy::too_many_arguments)]
    fn argmax_row(
        &mut self,
        scorer: &AppFormulaScorer,
        topology: &Topology,
        vertex_owner: &[u8],
        edge_owner: &[u8],
        seat: u8,
        grant: bool,
        vacated: Option<Vertex>,
        memoize: bool,
    ) -> RowArgmax {
        if !self.reusable {
            if let Some(result) = self.pruned_argmax(
                scorer, topology, vertex_owner, edge_owner, seat, grant, vacated, memoize,
            ) {
                #[cfg(debug_assertions)]
                {
                    let reference = self.full_argmax(
                        scorer, topology, vertex_owner, edge_owner, seat, grant, vacated, memoize,
                    );
                    let bits = |answer: Option<(Vertex, f64)>| {
                        answer.map(|(vertex, score)| (vertex, score.to_bits()))
                    };
                    assert_eq!(bits(result.taken), bits(reference.taken));
                    assert_eq!(bits(result.free), bits(reference.free));
                }
                return result;
            }
        }
        self.full_argmax(scorer, topology, vertex_owner, edge_owner, seat, grant, vacated, memoize)
    }

    #[allow(clippy::too_many_arguments)]
    fn full_argmax(
        &mut self,
        scorer: &AppFormulaScorer,
        topology: &Topology,
        vertex_owner: &[u8],
        edge_owner: &[u8],
        seat: u8,
        grant: bool,
        vacated: Option<Vertex>,
        memoize: bool,
    ) -> RowArgmax {
        let (row, occupancy) = self.legal_row_with_memo(
            scorer, topology, vertex_owner, edge_owner, seat, grant, vacated, memoize,
        );
        let taken = if let Some(occupancy) = occupancy {
            best_legal_mask(row, !occupancy.blocked)
        } else {
            best_legal(topology, vertex_owner, None, row)
        };
        let free = if vacated.is_some() {
            best_legal(topology, vertex_owner, vacated, row)
        } else {
            taken
        };
        RowArgmax { taken, free, occupancy }
    }

    #[allow(clippy::too_many_arguments)]
    fn pruned_argmax(
        &mut self,
        scorer: &AppFormulaScorer,
        topology: &Topology,
        vertex_owner: &[u8],
        edge_owner: &[u8],
        seat: u8,
        grant: bool,
        vacated: Option<Vertex>,
        memoize: bool,
    ) -> Option<RowArgmax> {
        let scale = scorer.slot_scale(seat);
        let bounds = scorer.expansion_bounds(scale.expansion)?;
        let occupancy = expansion::Occupancy::new(scorer, vertex_owner, edge_owner, seat);
        let taken = !occupancy.blocked & (u128::MAX >> (128 - self.vertices));
        let free = if vacated.is_some() {
            (0..self.vertices as Vertex)
                .filter(|vertex| legal_with_vacancy(topology, vertex_owner, vacated, *vertex))
                .fold(0, |mask, vertex| mask | (1 << vertex))
        } else {
            taken
        };
        let holdings = scorer.holdings_for_owner(vertex_owner, seat);
        let mut holdings_total = None;
        let mut upper = [0.0; 128];
        self.scratch.resize(self.vertices, f64::NEG_INFINITY);
        expansion::PRICE_MEMO.with_borrow_mut(|memo| {
            let serial = memoize.then(|| memo.serial(scorer.id, occupancy.own_vertices));
            let base_tag = expansion::base_tag(seat, grant);
            let mut seeds = [None; 2];
            let mut rest = free;
            while rest != 0 {
                let vertex = rest.trailing_zeros() as Vertex;
                rest &= rest - 1;
                let mut base_total = || {
                    let total = *holdings_total
                        .get_or_insert_with(|| scorer.holdings_diversity_total(&holdings));
                    scorer.scaled_total_with_diversity(holdings, vertex, grant, scale.diversity, total)
                };
                let base = if let Some(serial) = serial {
                    memo.price(expansion::price_key(serial, vertex, base_tag), base_total)
                } else {
                    base_total()
                };
                let table_path = scorer.reach.table_path(vertex, &occupancy);
                let expansion = if let Some(serial) = serial {
                    memo.price(expansion::bound_key(serial, vertex, table_path), || {
                        bounds.value(scorer, &holdings, vertex, table_path)
                    })
                } else {
                    bounds.value(scorer, &holdings, vertex, table_path)
                };
                let bound = base + scale.expansion * expansion;
                if !base.is_finite() || !bound.is_finite() {
                    return None;
                }
                self.scratch[usize::from(vertex)] = base;
                upper[usize::from(vertex)] = bound;
                if taken & (1 << vertex) != 0 {
                    keep_best(&mut seeds[0], vertex, base);
                }
                keep_best(&mut seeds[1], vertex, base);
            }
            let mut initial = 0_u128;
            for (legal, seed) in [taken, free].into_iter().zip(seeds) {
                if legal != 0 {
                    initial |= 1 << legal.trailing_zeros();
                    initial |= 1 << seed.unwrap().0;
                }
            }
            let mut best = [None; 2];
            #[cfg(test)]
            let mut evaluated = 0_u128;
            let mut evaluate = |vertex: Vertex, best: &mut [Option<(Vertex, f64)>; 2]| {
                let score = self.scratch[usize::from(vertex)] + scale.expansion
                    * expansion::row_value(scorer, &holdings, vertex, &occupancy, memo, serial);
                if score.is_nan() {
                    return false;
                }
                #[cfg(test)]
                { evaluated |= 1 << vertex; }
                if taken & (1 << vertex) != 0 {
                    keep_best(&mut best[0], vertex, score);
                }
                keep_best(&mut best[1], vertex, score);
                true
            };
            rest = initial;
            while rest != 0 {
                let vertex = rest.trailing_zeros() as Vertex;
                rest &= rest - 1;
                if !evaluate(vertex, &mut best) {
                    return None;
                }
            }
            rest = free & !initial;
            while rest != 0 {
                let vertex = rest.trailing_zeros() as Vertex;
                rest &= rest - 1;
                let held = best[usize::from(taken & (1 << vertex) == 0)].unwrap().1;
                if upper[usize::from(vertex)] < held {
                    continue;
                }
                if !evaluate(vertex, &mut best) {
                    return None;
                }
            }
            #[cfg(test)]
            ARGMAX_COUNTS.with(|counts| {
                let mut next = counts.get();
                next[usize::from(memoize)][0] += free.count_ones() as usize;
                next[usize::from(memoize)][1] += evaluated.count_ones() as usize;
                counts.set(next);
            });
            Some(RowArgmax { taken: best[0], free: best[1], occupancy: Some(occupancy) })
        })
    }

    /// The seat's score for every vertex on this state, computed once per distinct
    /// (seat, holdings, grant) triple while rows are reusable.
    ///
    /// The holdings half of the key is read back out of `vertex_owner` rather than passed in, so
    /// a caller cannot key a row to holdings it was not scored against. A seat holding more than
    /// one settlement has no key and its row is recomputed, which the setup phase never reaches:
    /// nobody holds two settlements before the hero's second pick.
    fn row(
        &mut self,
        scorer: &AppFormulaScorer,
        vertex_owner: &[u8],
        edge_owner: &[u8],
        seat: u8,
        grant: bool,
    ) -> &[f64] {
        let slot = if self.reusable {
            holdings_key(vertex_owner, seat)
                .map(|held| slot_index(self.owner_slots, seat, held, grant))
        } else {
            None
        };
        let Some(slot) = slot else {
            score_row(
                scorer,
                self.vertices,
                vertex_owner,
                edge_owner,
                seat,
                grant,
                &mut self.scratch,
            );
            return &self.scratch;
        };
        if self.rows[slot].is_none() {
            let mut row = Vec::new();
            score_row(
                scorer,
                self.vertices,
                vertex_owner,
                edge_owner,
                seat,
                grant,
                &mut row,
            );
            self.rows[slot] = Some(row);
        }
        self.rows[slot].as_deref().expect("the row was just filled")
    }
}

/// Seeds arrive out of order, so equal scores retain the lowest vertex's bits.
fn keep_best(best: &mut Option<(Vertex, f64)>, vertex: Vertex, score: f64) {
    if best.is_none_or(|(held_vertex, held)| score > held || (score == held && vertex < held_vertex)) {
        *best = Some((vertex, score));
    }
}

fn score_row(
    scorer: &AppFormulaScorer,
    vertices: usize,
    vertex_owner: &[u8],
    edge_owner: &[u8],
    seat: u8,
    grant: bool,
    out: &mut Vec<f64>,
) {
    out.clear();
    out.extend((0..vertices).map(|vertex| {
        scorer.score_for_owner(vertex_owner, edge_owner, seat, vertex as Vertex, grant)
    }));
}

/// The seat's holdings as a row key: `Some(None)` for nothing placed, `Some(Some(vertex))` for a
/// single settlement, and `None` for two or more, which has no key.
fn holdings_key(vertex_owner: &[u8], seat: u8) -> Option<Option<Vertex>> {
    let mut held = None;
    for (vertex, owner) in vertex_owner.iter().enumerate() {
        if *owner == seat {
            if held.is_some() {
                return None;
            }
            held = Some(vertex as Vertex);
        }
    }
    Some(held)
}

fn slot_index(owner_slots: usize, seat: u8, held: Option<Vertex>, grant: bool) -> usize {
    let holdings = held.map_or(0, |vertex| usize::from(vertex) + 1);
    (usize::from(seat) * (owner_slots + 1) + holdings) * 2 + usize::from(grant)
}

/// The best-scoring legal vertex in a row, ties to the lowest vertex index.
///
/// `vacated` names a vertex to treat as unoccupied for legality alone, which is the denial
/// credit's preregistered counterfactual: the same row answers what a seat could have taken had
/// another seat not taken that vertex, by reopening the vertex and everything its distance ring
/// barred. Only reachability moves, never a score. That is exact while `expansionWeight` is 0,
/// where no component reads the board beyond the scoring seat's own holdings. Above 0 every
/// vertex the vacancy reopens is still priced with the candidate standing, because a settlement
/// is a dead end for the expansion walk, so the counterfactual stays a legality one by definition
/// rather than becoming a full re-score.
fn best_legal(
    topology: &Topology,
    vertex_owner: &[u8],
    vacated: Option<Vertex>,
    row: &[f64],
) -> Option<(Vertex, f64)> {
    let legal = (0..row.len() as Vertex)
        .filter(|vertex| legal_with_vacancy(topology, vertex_owner, vacated, *vertex))
        .fold(0, |mask, vertex| mask | (1 << vertex));
    best_legal_mask(row, legal)
}

fn best_legal_mask(row: &[f64], mut legal: u128) -> Option<(Vertex, f64)> {
    legal &= u128::MAX.checked_shr((128 - row.len()) as u32).unwrap_or(0);
    let mut best: Option<(Vertex, f64)> = None;
    while legal != 0 {
        let vertex = legal.trailing_zeros() as Vertex;
        legal &= legal - 1;
        let score = row[usize::from(vertex)];
        if best.is_none_or(|(_, held)| score > held) {
            best = Some((vertex, score));
        }
    }
    best
}

/// `game::can_place_settlement`, with one vertex read as empty whatever the owner array says.
fn legal_with_vacancy(
    topology: &Topology,
    vertex_owner: &[u8],
    vacated: Option<Vertex>,
    vertex: Vertex,
) -> bool {
    let Some(vacated) = vacated else {
        return can_place_settlement(topology, vertex_owner, vertex);
    };
    let free =
        |candidate: Vertex| candidate == vacated || vertex_owner[usize::from(candidate)] == EMPTY;
    free(vertex)
        && topology
            .vertex_adjacent(vertex)
            .iter()
            .all(|adjacent| free(*adjacent))
}

/// The setup road for a settlement about to be placed, chosen without touching the RNG.
///
/// SP3's road rule first, exactly as `choose_app_formula` applies it. When the expansion term is
/// off, or the settlement opens nothing, it falls back to the same far-endpoint scoring the field
/// uses, with ties broken by the lower edge id rather than by a random draw. Scored against the
/// state before the settlement lands, which is the state the field scores it against.
fn setup_road(
    scorer: &AppFormulaScorer,
    topology: &Topology,
    vertex_owner: &[u8],
    edge_owner: &[u8],
    seat: u8,
    vertex: Vertex,
    occupancy: Option<&expansion::Occupancy>,
) -> Edge {
    let road = expansion::row_road(scorer, vertex_owner, edge_owner, seat, vertex, occupancy);
    if let Some(edge) = road {
        return edge;
    }
    let mut selected = topology.vertex_edges(vertex)[0];
    let mut selected_score = f64::NEG_INFINITY;
    let mut chosen = false;
    for edge in topology.vertex_edges(vertex) {
        let endpoints = topology.edge_endpoints(*edge);
        let destination = if endpoints[0] == vertex {
            endpoints[1]
        } else {
            endpoints[0]
        };
        // The road points at a future settlement, not one being placed now, so setup cards do not
        // belong in this score. `choose_app_formula` scores it the same way.
        let score = scorer.score_for_owner(vertex_owner, edge_owner, seat, destination, false);
        if !chosen || score > selected_score || (score == selected_score && *edge < selected) {
            selected = *edge;
            selected_score = score;
            chosen = true;
        }
    }
    selected
}

/// What one rival loses to the hero's candidate: its best had the candidate stayed free, less its
/// best with the candidate taken, floored at 0.
///
/// The floor is what makes this a credit and never a charge. Vacating a vertex only widens what a
/// seat may legally take, so the difference is non-negative on any board; the floor is the guard
/// for a degenerate weights vector, where a score can come back `NaN` and `js_max` propagates it
/// rather than silently reading as 0. A rival with no legal vertex on one side of the comparison
/// has no best to difference and is charged nothing, which setup never reaches: twelve
/// settlements cannot block every vertex of a supported layout.
fn denial_gain(free: Option<(Vertex, f64)>, taken: Option<(Vertex, f64)>) -> f64 {
    match (free, taken) {
        (Some((_, free)), Some((_, taken))) => js_max(0.0, free - taken),
        _ => 0.0,
    }
}

/// The plain formula argmax over the legal candidates, ties to the lowest vertex index.
fn best_direct(
    scorer: &AppFormulaScorer,
    topology: &Topology,
    vertex_owner: &[u8],
    edge_owner: &[u8],
    seat: u8,
    grant: bool,
) -> Option<Vertex> {
    let mut rows = ScoreRows::new(
        usize::from(seat) + 1, topology.vertex_count(), vertex_owner.len(), false,
    );
    let (row, occupancy) = rows.legal_row_with_memo(
        scorer, topology, vertex_owner, edge_owner, seat, grant, None, true,
    );
    best_legal_mask(row, !occupancy.unwrap().blocked).map(|(vertex, _)| vertex)
}

/// One hero's first-pick lookahead over one board state, carrying the scratch every candidate
/// reuses: the replayed owner arrays and the score rows.
struct Lookahead<'a> {
    /// The hero's formula, which an arm sweeps: it prices the candidate, plans the second
    /// settlement and lays the hero's setup road.
    hero_scorer: &'a AppFormulaScorer,
    /// The opponent model, pinned to the field's weights: it takes every intervening pick.
    opponent_scorer: &'a AppFormulaScorer,
    topology: &'a Topology,
    seats: usize,
    hero: u8,
    /// The unchanged input board shared by all candidate replays.
    hero_occupancy: expansion::Occupancy,
    order: Vec<u8>,
    /// The positions in `order` strictly between the hero's two picks. Empty for the seat that
    /// picks last in the first round, which picks twice in a row and has nothing to look past.
    intervening: Range<usize>,
    rows: ScoreRows,
    owners: Vec<u8>,
    edges: Vec<u8>,
    /// The hero's `setupDenialWeight`. An arm sweeps the hero's formula, so the price the hero
    /// puts on a rival's loss is the hero's own, while the loss itself is scored at the rival's.
    denial_weight: f64,
    /// What the candidate `replay` last placed cost the intervening rivals, summed over them and
    /// before the weight. Stays 0 while `denial_weight` is 0, where `replay` never scans for it.
    denial: f64,
}

impl<'a> Lookahead<'a> {
    fn new(
        hero_scorer: &'a AppFormulaScorer,
        opponent_scorer: &'a AppFormulaScorer,
        topology: &'a Topology,
        seats: usize,
        hero: u8,
        vertex_owner: &[u8],
        edge_owner: &[u8],
    ) -> Option<Self> {
        let order = setup_order(seats);
        let first = order.iter().position(|seat| *seat == hero)?;
        let last = order.iter().rposition(|seat| *seat == hero)?;
        let reusable = hero_scorer.weights().expansion_weight == 0.0
            && opponent_scorer.weights().expansion_weight == 0.0;
        Some(Self {
            hero_scorer,
            opponent_scorer,
            topology,
            seats,
            hero,
            hero_occupancy: expansion::Occupancy::new(hero_scorer, vertex_owner, edge_owner, hero),
            order,
            intervening: first + 1..last,
            rows: ScoreRows::new(seats, topology.vertex_count(), vertex_owner.len(), reusable),
            owners: vertex_owner.to_vec(),
            edges: edge_owner.to_vec(),
            denial_weight: hero_scorer.weights().setup_denial_weight,
            denial: 0.0,
        })
    }

    /// What the candidate is worth once the intervening picks are taken into account: its own
    /// marginal score plus the best second settlement still legal after the replay, plus the
    /// setup denial credit. A candidate whose replay leaves the hero nowhere to go is worth its
    /// own marginal alone.
    fn value(&mut self, vertex_owner: &[u8], edge_owner: &[u8], candidate: Vertex) -> f64 {
        let marginal = self.hero_scorer.score_for_owner(
            vertex_owner,
            edge_owner,
            self.hero,
            candidate,
            false,
        );
        self.value_with_marginal(vertex_owner, edge_owner, candidate, marginal)
    }

    fn value_with_marginal(
        &mut self,
        vertex_owner: &[u8],
        edge_owner: &[u8],
        candidate: Vertex,
        marginal: f64,
    ) -> f64 {
        self.replay(vertex_owner, edge_owner, candidate, None);
        let second = self.planned_second().map_or(0.0, |(_, score)| score);
        // At the shipped weight the credit is not merely zero but never formed: `replay` skips
        // its second scan and the value is exactly the one the kind carried before SP5's denial
        // term existed.
        if self.denial_weight == 0.0 {
            return marginal + second;
        }
        marginal + second + self.denial_weight * self.denial
    }

    /// The best second settlement still legal on the board `replay` left, at the hero's own
    /// formula and with the setup grant only the second round pays.
    fn planned_second(&mut self) -> Option<(Vertex, f64)> {
        // Each hero key is seen once per lookahead and would only evict the rivals' entries.
        self.rows.argmax_row(
            self.hero_scorer,
            self.topology,
            &self.owners,
            &self.edges,
            self.hero,
            true,
            None,
            false,
        ).taken
    }

    /// Places the candidate for the hero and lets every intervening seat take its argmax, in
    /// `setup_order` order, leaving the replayed state in `owners` and `edges`.
    ///
    /// Each rival's argmax score here is its best with the hero's candidate taken. The same row
    /// scanned with `Some(candidate)` vacated is its best had the candidate still been free, and
    /// SP5's setup denial credit is the difference of the two, floored at 0 and summed over the
    /// intervening rivals into `denial`. A rival is charged at the position it actually picks
    /// from, so its loss is measured against the board the replay has reached, not the board the
    /// hero picked from.
    fn replay(
        &mut self,
        vertex_owner: &[u8],
        edge_owner: &[u8],
        candidate: Vertex,
        mut picks: Option<&mut Vec<(u8, Vertex)>>,
    ) {
        self.owners.copy_from_slice(vertex_owner);
        self.edges.copy_from_slice(edge_owner);
        self.denial = 0.0;
        // `new` read the hero's occupancy from the board it was given, which every caller
        // passes here again.
        debug_assert_eq!(
            self.hero_occupancy,
            expansion::Occupancy::new(self.hero_scorer, vertex_owner, edge_owner, self.hero),
        );
        let road = setup_road(
            self.hero_scorer,
            self.topology,
            vertex_owner,
            edge_owner,
            self.hero,
            candidate,
            Some(&self.hero_occupancy),
        );
        self.owners[usize::from(candidate)] = self.hero;
        self.edges[usize::from(road)] = self.hero;
        for position in self.intervening.clone() {
            let seat = self.order[position];
            // `setup_order` runs the first round forward and the second reversed, so a position
            // past the seat count is a second-round pick, which is the round that pays the grant.
            let grant = position >= self.seats;
            let vacated = (self.denial_weight != 0.0).then_some(candidate);
            let result = self.rows.argmax_row(
                self.opponent_scorer,
                self.topology,
                &self.owners,
                &self.edges,
                seat,
                grant,
                vacated,
                true,
            );
            if vacated.is_some() {
                self.denial += denial_gain(result.free, result.taken);
            }
            let pick = result.taken;
            let Some((pick, _)) = pick else {
                continue;
            };
            let road = setup_road(
                self.opponent_scorer,
                self.topology,
                &self.owners,
                &self.edges,
                seat,
                pick,
                result.occupancy.as_ref(),
            );
            self.owners[usize::from(pick)] = seat;
            self.edges[usize::from(road)] = seat;
            if let Some(picks) = picks.as_deref_mut() {
                picks.push((seat, pick));
            }
        }
    }
}

/// The draft kind's setup pick: the lookahead for the first settlement, the plain formula argmax
/// for the second.
///
/// `grant` tells the two rounds apart, exactly as it does in `game.rs::setup`: only the second
/// round pays the setup grant. Nothing the hero cares about follows its second pick, so there is
/// nothing to look ahead over and that pick is the ordinary argmax.
pub(super) fn choose(
    scorers: &DraftScorers,
    topology: &Topology,
    seats: usize,
    vertex_owner: &[u8],
    edge_owner: &[u8],
    seat: u8,
    grant: bool,
) -> Option<(Vertex, Edge)> {
    let vertex = if grant {
        best_direct(
            &scorers.hero,
            topology,
            vertex_owner,
            edge_owner,
            seat,
            true,
        )?
    } else {
        first_pick(scorers, topology, seats, vertex_owner, edge_owner, seat)?
    };
    let road = setup_road(
        &scorers.hero,
        topology,
        vertex_owner,
        edge_owner,
        seat,
        vertex,
        None,
    );
    Some((vertex, road))
}

/// The lookahead's argmax over every legal first settlement, ties to the lowest vertex index.
fn first_pick(
    scorers: &DraftScorers,
    topology: &Topology,
    seats: usize,
    vertex_owner: &[u8],
    edge_owner: &[u8],
    hero: u8,
) -> Option<Vertex> {
    let mut lookahead = Lookahead::new(
        &scorers.hero,
        &scorers.opponent,
        topology,
        seats,
        hero,
        vertex_owner,
        edge_owner,
    )?;
    let marginals = lookahead.rows
        .legal_row(&scorers.hero, topology, vertex_owner, edge_owner, hero, false, None)
        .to_vec();
    let mut best: Option<(Vertex, f64)> = None;
    for vertex_index in 0..topology.vertex_count() {
        let candidate = vertex_index as Vertex;
        if !can_place_settlement(topology, vertex_owner, candidate) {
            continue;
        }
        let value = lookahead.value_with_marginal(
            vertex_owner, edge_owner, candidate, marginals[vertex_index],
        );
        if best.is_none_or(|(_, held)| value > held) {
            best = Some((candidate, value));
        }
    }
    best.map(|(vertex, _)| vertex)
}

/// Re-score a setup candidate exactly as [`choose`] ranked it: the lookahead value for a first
/// pick, the hero formula's marginal for a second. Observation only, and no cheaper than the pick
/// itself, since a first pick's rank is the whole replay.
pub(super) fn candidate_score(
    scorers: &DraftScorers,
    topology: &Topology,
    seats: usize,
    vertex_owner: &[u8],
    edge_owner: &[u8],
    seat: u8,
    candidate: Vertex,
    grant: bool,
) -> f64 {
    if grant {
        return scorers
            .hero
            .score_for_owner(vertex_owner, edge_owner, seat, candidate, true);
    }
    Lookahead::new(
        &scorers.hero,
        &scorers.opponent,
        topology,
        seats,
        seat,
        vertex_owner,
        edge_owner,
    )
    .map_or(f64::NEG_INFINITY, |mut lookahead| {
        lookahead.value(vertex_owner, edge_owner, candidate)
    })
}

/// What the first-pick lookahead expects to follow the hero's candidate.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LookaheadPlan {
    /// The intervening picks, in `setup_order` order, each as the seat and the vertex it takes.
    pub picks: Vec<(u8, Vertex)>,
    /// The second settlement the hero plans on the board those picks leave, `None` only when the
    /// replay leaves it no legal site.
    pub second: Option<Vertex>,
}

/// The plan the first-pick lookahead forms when the hero takes `candidate` at this state.
///
/// Observation only: the replay without the valuation it feeds, so a test or a diagnostic can
/// hold the opponent model against the picks a real field made. No cheaper than ranking one
/// candidate, because it is the same replay.
pub(super) fn lookahead_plan(
    hero_scorer: &AppFormulaScorer,
    opponent_scorer: &AppFormulaScorer,
    topology: &Topology,
    seats: usize,
    vertex_owner: &[u8],
    edge_owner: &[u8],
    hero: u8,
    candidate: Vertex,
) -> Option<LookaheadPlan> {
    let mut lookahead = Lookahead::new(
        hero_scorer,
        opponent_scorer,
        topology,
        seats,
        hero,
        vertex_owner,
        edge_owner,
    )?;
    let mut picks = Vec::new();
    lookahead.replay(vertex_owner, edge_owner, candidate, Some(&mut picks));
    let second = lookahead.planned_second().map(|(vertex, _)| vertex);
    Some(LookaheadPlan { picks, second })
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;

    use super::*;
    use crate::board::{ConversionOptions, SimBoard};
    use crate::placement::app_formula::EngineWeights;
    use crate::rules::RuleConfig;
    use crate::topology::Layout;
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

    fn bound_weights() -> Vec<EngineWeights> {
        let mut scaled = default_weights();
        scaled.expansion_decay = 0.3;
        for row in scaled.slot_scales.values_mut() {
            for (seat, scale) in row {
                let seat = seat.parse::<f64>().unwrap();
                scale.diversity = 0.5 + seat * 0.15;
                scale.expansion = 0.2 + seat * 0.25;
            }
        }
        let mut concentration = default_weights();
        concentration.robber_concentration_weight = -3.0;
        let mut ports = default_weights();
        ports.port_weight = 12.0;
        ports.near_port_radius = 3.0;
        let mut weights = vec![default_weights(), scaled, concentration, ports];
        let mut random = 0x4250_554e_4445_4421_u64;
        let mut draw = || {
            random = random.wrapping_mul(6_364_136_223_846_793_005)
                .wrapping_add(1_442_695_040_888_963_407);
            (random >> 33) as f64 / (1_u64 << 31) as f64
        };
        for _ in 0..20 {
            let mut vector = default_weights();
            vector.expansion_weight = 1.2 * draw();
            vector.expansion_decay = 0.125 + 0.875 * draw();
            vector.diversity_weight = 3.0 * draw();
            vector.diversity_cap = 0.5 + 7.5 * draw();
            vector.recipe_cap = vector.diversity_cap;
            vector.coverage_exponent = 4.0 * draw();
            vector.coverage_scarcity_weight = draw();
            vector.resource_value = super::super::app_formula::ResourceValues {
                wood: 0.1 + 3.0 * draw(), sheep: 0.1 + 3.0 * draw(),
                wheat: 0.1 + 3.0 * draw(), brick: 0.1 + 3.0 * draw(),
                ore: 0.1 + 3.0 * draw(),
            };
            vector.recipe_road_bonus = 3.0 * draw();
            vector.recipe_city_bonus = 3.0 * draw();
            vector.recipe_settlement_bonus = 3.0 * draw();
            vector.recipe_dev_card_bonus = 3.0 * draw();
            vector.duplicate_number_penalty = 2.0 * draw();
            vector.port_weight = 10.0 * draw();
            vector.port_surplus_threshold = 6.0 * draw() - 2.0;
            vector.robber_concentration_weight = 6.0 * draw() - 3.0;
            vector.near_port_radius = (3.0 * draw()).floor();
            vector.near_port_decay = draw();
            weights.push(vector);
        }
        weights
    }

    fn answer_bits(answer: Option<(Vertex, f64)>) -> Option<(Vertex, u64)> {
        answer.map(|(vertex, score)| (vertex, score.to_bits()))
    }

    /// The bound dominates exact expansion and both nested argmaxes retain their score bits.
    #[test]
    fn bounded_rows_match_full_rows_on_scrambled_boards() {
        for (topology, board) in expansion::tests::walk_fixtures() {
            let boards = expansion::tests::scrambled_owners(&topology);
            let mut rows = ScoreRows::new(6, topology.vertex_count(), topology.vertex_count(), false);
            for (weight_index, weights) in bound_weights().into_iter().enumerate() {
                let scorer = AppFormulaScorer::new(&board, &topology, weights);
                for (board_index, (vertices, edges)) in boards.iter().enumerate() {
                    let vacancy = vertices.iter().position(|owner| *owner != EMPTY)
                        .map(|vertex| vertex as Vertex).or(Some(0));
                    for seat in 0..6 {
                        let holdings = scorer.holdings_for_owner(vertices, seat);
                        let occupancy = expansion::Occupancy::new(&scorer, vertices, edges, seat);
                        let scale = scorer.slot_scale(seat).expansion;
                        let bounds = scorer.expansion_bounds(scale).unwrap();
                        for grant in [false, true] {
                            expansion::PRICE_MEMO.with_borrow_mut(|memo| {
                                let serial = memo.serial(scorer.id, occupancy.own_vertices);
                                for vertex in 0..topology.vertex_count() as Vertex {
                                    if !legal_with_vacancy(&topology, vertices, vacancy, vertex) {
                                        continue;
                                    }
                                    let upper = bounds.value(&scorer, &holdings, vertex,
                                        scorer.reach.table_path(vertex, &occupancy));
                                    let exact = expansion::row_value(
                                        &scorer, &holdings, vertex, &occupancy, memo, Some(serial),
                                    );
                                    assert!(scale * exact <= scale * upper,
                                        "weight={weight_index} board={board_index} seat={seat} grant={grant} vertex={vertex} exact={exact:?} upper={upper:?}");
                                }
                            });
                            for vacated in [None, vacancy] {
                                let memoize = (board_index + usize::from(grant)) % 2 == 0;
                                let actual = rows.pruned_argmax(&scorer, &topology, vertices, edges,
                                    seat, grant, vacated, memoize).expect("the finite bound must be used");
                                let expected = rows.full_argmax(&scorer, &topology, vertices, edges,
                                    seat, grant, vacated, memoize);
                                assert_eq!(answer_bits(actual.taken), answer_bits(expected.taken),
                                    "weight={weight_index} board={board_index} seat={seat} grant={grant} vacancy={vacated:?}");
                                assert_eq!(answer_bits(actual.free), answer_bits(expected.free));
                                assert_eq!(actual.occupancy, expected.occupancy);
                            }
                        }
                    }
                }
            }
        }
    }

    /// Invalid proof signs take the full path, while exact ties keep the lowest legal index.
    #[test]
    fn bounded_rows_fall_back_for_unsupported_weights_and_preserve_ties() {
        for (topology, board) in expansion::tests::walk_fixtures() {
            let mut negative_expansion = default_weights();
            negative_expansion.expansion_weight = -0.3;
            let mut negative_port = default_weights();
            negative_port.port_weight = -1.0;
            let mut nan = default_weights();
            nan.resource_value.wheat = f64::NAN;
            let mut recipe = default_weights();
            recipe.recipe_cap += 1.0;
            let mut rows = ScoreRows::new(6, topology.vertex_count(), topology.vertex_count(), false);
            for weights in [negative_expansion, negative_port, nan, recipe] {
                let scorer = AppFormulaScorer::new(&board, &topology, weights);
                assert!(scorer.expansion_bounds(1.0).is_none());
                let before = ARGMAX_COUNTS.with(Cell::get);
                for (vertices, edges) in expansion::tests::scrambled_owners(&topology) {
                    for seat in 0..6 {
                        for grant in [false, true] {
                            for vacated in [None, Some(0)] {
                                let actual = rows.argmax_row(&scorer, &topology, &vertices, &edges,
                                    seat, grant, vacated, true);
                                let expected = rows.full_argmax(&scorer, &topology, &vertices, &edges,
                                    seat, grant, vacated, true);
                                assert_eq!(answer_bits(actual.taken), answer_bits(expected.taken));
                                assert_eq!(answer_bits(actual.free), answer_bits(expected.free));
                            }
                        }
                    }
                }
                assert_eq!(ARGMAX_COUNTS.with(Cell::get), before);
            }
            let mut tie = default_weights();
            tie.resource_value = super::super::app_formula::ResourceValues {
                wood: 0.0, sheep: 0.0, wheat: 0.0, brick: 0.0, ore: 0.0,
            };
            tie.scarcity_weight = 0.0;
            tie.robber_discount = 0.0;
            tie.diversity_weight = 0.0;
            tie.recipe_road_bonus = 0.0;
            tie.recipe_city_bonus = 0.0;
            tie.recipe_settlement_bonus = 0.0;
            tie.recipe_dev_card_bonus = 0.0;
            tie.port_weight = 0.0;
            tie.duplicate_number_penalty = 0.0;
            let scorer = AppFormulaScorer::new(&board, &topology, tie);
            assert!(scorer.expansion_bounds(1.0).is_some());
            let vertices = vec![EMPTY; topology.vertex_count()];
            let edges = vec![EMPTY; topology.edge_count()];
            let actual = rows.argmax_row(&scorer, &topology, &vertices, &edges, 0, true, None, false);
            let row = rows.legal_row(&scorer, &topology, &vertices, &edges, 0, true, None);
            assert!(row.iter().all(|score| score.to_bits() == row[0].to_bits()));
            assert_eq!(answer_bits(actual.taken), Some((0, row[0].to_bits())));
        }
    }

    /// A finite proof gate still falls back if a row's arithmetic overflows or its base is NaN.
    #[test]
    fn nonfinite_bounds_and_bases_use_the_full_row() {
        let (topology, board) = fixture();
        let mut overflow = default_weights();
        overflow.port_weight = f64::MAX;
        let mut nan = default_weights();
        for row in nan.slot_scales.values_mut() {
            for scale in row.values_mut() {
                scale.diversity = f64::NAN;
            }
        }
        let vertices = vec![EMPTY; topology.vertex_count()];
        let edges = vec![EMPTY; topology.edge_count()];
        let mut rows = ScoreRows::new(6, topology.vertex_count(), topology.vertex_count(), false);
        for weights in [overflow, nan] {
            let scorer = AppFormulaScorer::new(&board, &topology, weights);
            assert!(scorer.expansion_bounds(-1.0).is_none());
            assert!(scorer.expansion_bounds(f64::NAN).is_none());
            assert!(scorer.expansion_bounds(1.0).is_some());
            for memoize in [false, true] {
                assert!(rows.pruned_argmax(&scorer, &topology, &vertices, &edges,
                    0, true, None, memoize).is_none());
                let actual = rows.argmax_row(&scorer, &topology, &vertices, &edges,
                    0, true, None, memoize);
                let expected = rows.full_argmax(&scorer, &topology, &vertices, &edges,
                    0, true, None, memoize);
                assert_eq!(answer_bits(actual.taken), answer_bits(expected.taken));
            }
        }
    }

    /// Both row kinds prune real candidates; full-row verification is excluded from the counter.
    #[test]
    fn bounded_rows_skip_most_fixture_candidates() {
        for (topology, board) in expansion::tests::walk_fixtures() {
            let scorers = DraftScorers {
                hero: AppFormulaScorer::new(&board, &topology, default_weights()),
                opponent: AppFormulaScorer::new(&board, &topology, default_weights()),
            };
            let vertices = vec![EMPTY; topology.vertex_count()];
            let edges = vec![EMPTY; topology.edge_count()];
            let before = ARGMAX_COUNTS.with(Cell::get);
            assert!(first_pick(&scorers, &topology, board.seats() as usize, &vertices, &edges, 0).is_some());
            let after = ARGMAX_COUNTS.with(Cell::get);
            for kind in 0..2 {
                let legal = after[kind][0] - before[kind][0];
                let evaluated = after[kind][1] - before[kind][1];
                assert!(legal > 0);
                assert!(evaluated * 2 < legal, "kind={kind} evaluated={evaluated} legal={legal}");
                println!("vertices={} memoize={} evaluated={} legal={} skipped={:.2}%",
                    topology.vertex_count(), kind == 1, evaluated, legal,
                    100.0 * (legal - evaluated) as f64 / legal as f64);
            }
        }
    }

    /// Mask scans keep the byte scan's first legal NaN and lowest-index finite ties.
    #[test]
    fn mask_argmax_preserves_ties_and_nan_order() {
        let (topology, _) = fixture();
        let mut owners = vec![EMPTY; topology.vertex_count()];
        owners[0] = 0;
        let legal = (0..topology.vertex_count() as Vertex)
            .filter(|vertex| can_place_settlement(&topology, &owners, *vertex))
            .fold(0_u128, |mask, vertex| mask | (1 << vertex));
        for fill in [f64::NAN, f64::NEG_INFINITY, 0.0, 1.0] {
            let mut row = vec![fill; topology.vertex_count()];
            let (vertex, score) = best_legal_mask(&row, legal).unwrap();
            assert_eq!(vertex, legal.trailing_zeros() as Vertex);
            assert_eq!(score.to_bits(), fill.to_bits());
            for index in [0, topology.vertex_count() / 2, topology.vertex_count() - 1] {
                row[index] = 2.0;
                assert_eq!(
                    best_legal_mask(&row, legal).map(|(vertex, score)| (vertex, score.to_bits())),
                    best_legal(&topology, &owners, None, &row)
                        .map(|(vertex, score)| (vertex, score.to_bits())),
                );
            }
        }
        assert!(best_legal_mask(&vec![f64::NAN; topology.vertex_count()], 0).is_none());
    }

    /// A precomputed marginal row preserves the replay value and the first pick's argmax.
    #[test]
    fn hero_marginal_rows_match_direct_lookahead_values() {
        let (topology, board) = fixture();
        let scorers = scorers(&topology, &board);
        let vertices = vec![EMPTY; topology.vertex_count()];
        let edges = vec![EMPTY; topology.edge_count()];
        for hero in [0, 5] {
            let mut direct = Lookahead::new(
                &scorers.hero, &scorers.opponent, &topology, 6, hero, &vertices, &edges,
            ).unwrap();
            let mut rows = Lookahead::new(
                &scorers.hero, &scorers.opponent, &topology, 6, hero, &vertices, &edges,
            ).unwrap();
            let marginals = rows.rows.legal_row(
                &scorers.hero, &topology, &vertices, &edges, hero, false, None,
            ).to_vec();
            let mut best: Option<(Vertex, f64)> = None;
            for candidate in 0..topology.vertex_count() as Vertex {
                let expected = direct.value(&vertices, &edges, candidate);
                assert_eq!(
                    rows.value_with_marginal(
                        &vertices, &edges, candidate, marginals[usize::from(candidate)],
                    ).to_bits(),
                    expected.to_bits()
                );
                if best.is_none_or(|(_, held)| expected > held) {
                    best = Some((candidate, expected));
                }
            }
            assert_eq!(
                first_pick(&scorers, &topology, 6, &vertices, &edges, hero),
                best.map(|(vertex, _)| vertex)
            );
        }
    }

    /// A second-pick row keeps the direct scan's winner, including NaN comparisons and ties.
    #[test]
    fn direct_pick_rows_match_reference_argmax() {
        let (topology, board) = fixture();
        let mut no_expansion = default_weights();
        no_expansion.expansion_weight = 0.0;
        let mut degenerate = default_weights();
        degenerate.diversity_weight = f64::NAN;
        for weights in [default_weights(), no_expansion, degenerate] {
            let scorer = AppFormulaScorer::new(&board, &topology, weights);
            for seat in 0..6 {
                let mut vertices = vec![EMPTY; topology.vertex_count()];
                let mut edges = vec![EMPTY; topology.edge_count()];
                for shifted in 0..8 {
                    vertices.fill(EMPTY);
                    edges.fill(EMPTY);
                    let held = (shifted * 7) as Vertex;
                    vertices[usize::from(held)] = seat;
                    for edge in topology.vertex_edges(held) {
                        edges[usize::from(*edge)] = seat;
                    }
                    let mut expected: Option<(Vertex, f64)> = None;
                    for vertex in 0..topology.vertex_count() as Vertex {
                        if can_place_settlement(&topology, &vertices, vertex) {
                            let score = scorer.score_for_owner(&vertices, &edges, seat, vertex, true);
                            if expected.is_none_or(|(_, best)| score > best) {
                                expected = Some((vertex, score));
                            }
                        }
                    }
                    assert_eq!(
                        best_direct(&scorer, &topology, &vertices, &edges, seat, true),
                        expected.map(|(vertex, _)| vertex)
                    );
                }
            }
        }
    }

    fn default_weights() -> EngineWeights {
        serde_json::from_str(include_str!("../../../../placement/default-weights.json")).unwrap()
    }

    fn scorers(topology: &Topology, board: &SimBoard) -> DraftScorers {
        scorers_at_denial(topology, board, 0.0)
    }

    /// The pairing an SP5 denial arm runs: the weight moves on the hero's side alone, and the
    /// opponent model stays on the committed vector.
    fn scorers_at_denial(topology: &Topology, board: &SimBoard, weight: f64) -> DraftScorers {
        let mut hero = default_weights();
        hero.setup_denial_weight = weight;
        DraftScorers {
            hero: AppFormulaScorer::new(board, topology, hero),
            opponent: AppFormulaScorer::new(board, topology, default_weights()),
        }
    }

    /// The same pairing with the expansion walk switched off on both sides, for the one test that
    /// recomputes a rival's losses itself. The walk is the only component that reads the board
    /// beyond the scoring seat's own holdings, so with it off a rival's score depends on nothing
    /// but which vertices are occupied. That is what lets the recomputation stay a short,
    /// independent statement of the rule instead of a second copy of `replay`, which would have
    /// to lay every setup road the replay lays and would assert nothing the code does not say.
    /// The shipped weight is 0.1 since M-66; the credit's own behaviour above 0 is the
    /// legality-only counterfactual `best_legal` documents.
    fn scorers_without_expansion(
        topology: &Topology,
        board: &SimBoard,
        weight: f64,
    ) -> DraftScorers {
        let mut hero = default_weights();
        hero.setup_denial_weight = weight;
        hero.expansion_weight = 0.0;
        let mut opponent = default_weights();
        opponent.expansion_weight = 0.0;
        DraftScorers {
            hero: AppFormulaScorer::new(board, topology, hero),
            opponent: AppFormulaScorer::new(board, topology, opponent),
        }
    }

    /// Seats and hero of the denial tests. At six seats the hero picking fifth is followed by the
    /// last seat's two picks and nothing else, so the credit sums exactly one rival's two losses.
    const SEATS: usize = 6;
    const HERO: u8 = 4;
    const RIVAL: u8 = 5;

    /// The hero's lookahead over a `DraftScorers` pair, which is the pairing the kind itself holds
    /// and the shape every test below wants.
    fn lookahead<'a>(
        scorers: &'a DraftScorers,
        topology: &'a Topology,
        vertex_owner: &[u8],
        edge_owner: &[u8],
    ) -> Lookahead<'a> {
        Lookahead::new(
            &scorers.hero,
            &scorers.opponent,
            topology,
            SEATS,
            HERO,
            vertex_owner,
            edge_owner,
        )
        .expect("the hero picks twice")
    }

    /// What each intervening rival loses to the hero's candidate, computed without the lookahead:
    /// a full legality scan per rival per position, once with the candidate taken and once with
    /// the vertex genuinely empty rather than merely vacated for legality.
    ///
    /// Roads are left off the replayed board. Only the `expansion` component reads edges and these
    /// scorers hold it at 0, which is the same condition `ScoreRows` reuses rows under.
    fn rival_losses(
        scorers: &DraftScorers,
        topology: &Topology,
        vertex_owner: &[u8],
        edge_owner: &[u8],
        candidate: Vertex,
    ) -> Vec<f64> {
        let order = setup_order(SEATS);
        let first = order.iter().position(|seat| *seat == HERO).unwrap();
        let last = order.iter().rposition(|seat| *seat == HERO).unwrap();
        let mut owners = vertex_owner.to_vec();
        owners[usize::from(candidate)] = HERO;
        let mut losses = Vec::new();
        for position in first + 1..last {
            let seat = order[position];
            let grant = position >= SEATS;
            // `vacated` reopens a vertex for legality alone, which is the credit's preregistered
            // counterfactual and what `best_legal` implements: every score is still taken with
            // the candidate standing, so only reachability moves. Recomputed here rather than
            // called, so the two agree only if the credit really is that difference.
            let best = |owners: &[u8], vacated: Option<Vertex>| {
                let free = |vertex: Vertex| {
                    Some(vertex) == vacated || owners[usize::from(vertex)] == EMPTY
                };
                let mut best: Option<(Vertex, f64)> = None;
                for index in 0..topology.vertex_count() {
                    let vertex = index as Vertex;
                    let legal = free(vertex)
                        && topology
                            .vertex_adjacent(vertex)
                            .iter()
                            .all(|adjacent| free(*adjacent));
                    if !legal {
                        continue;
                    }
                    let score = scorers
                        .opponent
                        .score_for_owner(owners, edge_owner, seat, vertex, grant);
                    if best.is_none_or(|(_, held)| score > held) {
                        best = Some((vertex, score));
                    }
                }
                best.expect("a rival always has somewhere legal to go during setup")
            };
            let (pick, taken) = best(&owners, None);
            let (_, free) = best(&owners, Some(candidate));
            losses.push((free - taken).max(0.0));
            owners[usize::from(pick)] = seat;
        }
        losses
    }

    /// The two halves of SP5's denial credit come off one row: putting a vertex back can only
    /// widen what a seat may legally take, so its best can only rise.
    #[test]
    fn vacating_a_taken_vertex_never_lowers_the_best_available_score() {
        let (topology, board) = fixture();
        let scorers = scorers(&topology, &board);
        let mut vertex_owner = vec![EMPTY; topology.vertex_count()];
        let edge_owner = vec![EMPTY; topology.edge_count()];
        let mut rows = ScoreRows::new(6, topology.vertex_count(), vertex_owner.len(), true);

        // A rival on the board's best opening, which is what a hero candidate takes away.
        let row = rows
            .row(&scorers.opponent, &vertex_owner, &edge_owner, 1, false)
            .to_vec();
        let (taken, free_best) =
            best_legal(&topology, &vertex_owner, None, &row).expect("an empty board has a best");
        vertex_owner[usize::from(taken)] = 0;

        let (_, blocked_best) = best_legal(&topology, &vertex_owner, None, &row)
            .expect("the board still has legal vertices");
        let (restored, restored_best) = best_legal(&topology, &vertex_owner, Some(taken), &row)
            .expect("vacating restores at least the vacated vertex");

        assert_eq!(restored, taken);
        assert_eq!(restored_best, free_best);
        assert!(restored_best >= blocked_best);
    }

    /// The row cache is keyed by seat, holdings and grant, so a hit must carry the same numbers a
    /// direct score would.
    ///
    /// Both ways round. `reusable` is false whenever either formula carries a nonzero
    /// `expansionWeight`, which is the one component that reads the board beyond the scoring
    /// seat's own holdings; that path recomputes into a shared scratch buffer instead, and a
    /// scratch left stale from the previous call would answer with another seat's numbers.
    #[test]
    fn a_cached_row_matches_a_direct_score() {
        let (topology, board) = fixture();
        let scorers = scorers(&topology, &board);
        let mut vertex_owner = vec![EMPTY; topology.vertex_count()];
        vertex_owner[7] = 1;
        let edge_owner = vec![EMPTY; topology.edge_count()];

        for reusable in [true, false] {
            let mut rows =
                ScoreRows::new(6, topology.vertex_count(), vertex_owner.len(), reusable);
            for seat in [1, 2] {
                for _ in 0..2 {
                    let row = rows
                        .row(&scorers.opponent, &vertex_owner, &edge_owner, seat, true)
                        .to_vec();
                    for (vertex, score) in row.iter().enumerate() {
                        let direct = scorers.opponent.score_for_owner(
                            &vertex_owner,
                            &edge_owner,
                            seat,
                            vertex as Vertex,
                            true,
                        );
                        assert_eq!(*score, direct, "reusable {reusable} seat {seat} vertex {vertex}");
                    }
                }
            }
        }
    }

    /// The uncached path scores only what a scan can read: the legal vertices, plus the ones the
    /// denial scan's vacated vertex reopens. A cached row is shared by states with different
    /// legality and stays whole.
    #[test]
    fn an_uncached_row_scores_only_the_vertices_a_pick_can_take() {
        use crate::placement::expansion::row_value_calls;

        let (topology, board) = fixture();
        let scorers = scorers(&topology, &board);
        let mut vertex_owner = vec![EMPTY; topology.vertex_count()];
        vertex_owner[7] = 1;
        let other = (20..topology.vertex_count() as Vertex)
            .find(|vertex| can_place_settlement(&topology, &vertex_owner, *vertex))
            .expect("one settlement leaves most of the board legal");
        vertex_owner[usize::from(other)] = 3;
        let edge_owner = vec![EMPTY; topology.edge_count()];

        let mut rows = ScoreRows::new(6, topology.vertex_count(), vertex_owner.len(), false);
        for vacated in [None, Some(7)] {
            let legal: Vec<Vertex> = (0..topology.vertex_count() as Vertex)
                .filter(|vertex| legal_with_vacancy(&topology, &vertex_owner, vacated, *vertex))
                .collect();
            assert!(legal.len() < topology.vertex_count());

            let before = row_value_calls();
            let row = rows
                .legal_row(
                    &scorers.opponent,
                    &topology,
                    &vertex_owner,
                    &edge_owner,
                    2,
                    true,
                    vacated,
                )
                .to_vec();
            assert_eq!(
                row_value_calls() - before,
                legal.len(),
                "one expansion valuation per legal vertex, vacated {vacated:?}"
            );
            assert_eq!(row.len(), topology.vertex_count());
            for vertex in &legal {
                let direct = scorers.opponent.score_for_owner(
                    &vertex_owner,
                    &edge_owner,
                    2,
                    *vertex,
                    true,
                );
                assert_eq!(row[usize::from(*vertex)], direct, "vertex {vertex} vacated {vacated:?}");
            }
        }

        let cached = scorers_without_expansion(&topology, &board, 0.0);
        let mut rows = ScoreRows::new(6, topology.vertex_count(), vertex_owner.len(), true);
        let whole = rows
            .row(&cached.opponent, &vertex_owner, &edge_owner, 2, true)
            .to_vec();
        let legal_only = rows
            .legal_row(
                &cached.opponent,
                &topology,
                &vertex_owner,
                &edge_owner,
                2,
                true,
                None,
            )
            .to_vec();
        assert_eq!(legal_only, whole);
    }

    /// The uncached row against a direct score on boards a draft can and cannot reach: several
    /// settlements per seat, road chains of the scoring seat's own, rival roads across the walk,
    /// and a vacated vertex. One `ScoreRows` serves every state and all formulas, so anything it
    /// remembers between calls has to be keyed by all of what it was computed from.
    #[test]
    fn an_uncached_row_matches_direct_scores_on_scrambled_boards() {
        let (topology, board) = fixture();
        let mut far = default_weights();
        far.expansion_decay = 0.35;
        far.expansion_weight = 0.4;
        let mut scaled = default_weights();
        scaled.expansion_decay = 0.3;
        for row in scaled.slot_scales.values_mut() {
            for (seat, scale) in row {
                let seat = seat.parse::<f64>().unwrap();
                scale.diversity = 0.5 + seat * 0.15;
                scale.expansion = 0.2 + seat * 0.25;
            }
        }
        let scorers = [
            AppFormulaScorer::new(&board, &topology, default_weights()),
            AppFormulaScorer::new(&board, &topology, far),
            AppFormulaScorer::new(&board, &topology, scaled),
        ];
        assert_eq!(scorers[2].slot_scale(0).diversity, 0.5);
        assert_ne!(scorers[2].slot_scale(0), scorers[2].slot_scale(1));
        let mut state = 0x9e37_79b9_7f4a_7c15_u64;
        let mut draw = |bound: usize| {
            state = state
                .wrapping_mul(6_364_136_223_846_793_005)
                .wrapping_add(1_442_695_040_888_963_407);
            ((state >> 33) as usize) % bound
        };
        let mut rows = ScoreRows::new(6, topology.vertex_count(), topology.vertex_count(), false);
        let mut compared = 0_usize;
        for board_index in 0..120 {
            let mut vertex_owner = vec![EMPTY; topology.vertex_count()];
            let mut edge_owner = vec![EMPTY; topology.edge_count()];
            for _ in 0..draw(11) {
                let seat = draw(6) as u8;
                let legal: Vec<Vertex> = (0..topology.vertex_count() as Vertex)
                    .filter(|vertex| can_place_settlement(&topology, &vertex_owner, *vertex))
                    .collect();
                if legal.is_empty() {
                    break;
                }
                let vertex = legal[draw(legal.len())];
                vertex_owner[usize::from(vertex)] = seat;
                // A chain of up to three roads out of the settlement, so a seat's own roads reach
                // well into the region another candidate's walk covers.
                let mut end = vertex;
                for _ in 0..draw(4) {
                    let edges = topology.vertex_edges(end);
                    let edge = edges[draw(edges.len())];
                    if edge_owner[usize::from(edge)] != EMPTY {
                        break;
                    }
                    edge_owner[usize::from(edge)] = seat;
                    let endpoints = topology.edge_endpoints(edge);
                    end = if endpoints[0] == end {
                        endpoints[1]
                    } else {
                        endpoints[0]
                    };
                }
            }
            let occupied: Vec<Vertex> = (0..topology.vertex_count() as Vertex)
                .filter(|vertex| vertex_owner[usize::from(*vertex)] != EMPTY)
                .collect();
            let vacancies = [
                None,
                (!occupied.is_empty()).then(|| occupied[draw(occupied.len())]),
            ];
            for seat in 0..6_u8 {
                let scorer = &scorers[(board_index + usize::from(seat)) % scorers.len()];
                let grant = (board_index + usize::from(seat)) % 2 == 0;
                for vacated in vacancies {
                    let row = rows
                        .legal_row(
                            scorer,
                            &topology,
                            &vertex_owner,
                            &edge_owner,
                            seat,
                            grant,
                            vacated,
                        )
                        .to_vec();
                    assert_eq!(row.len(), topology.vertex_count());
                    for vertex in 0..topology.vertex_count() as Vertex {
                        if !legal_with_vacancy(&topology, &vertex_owner, vacated, vertex) {
                            continue;
                        }
                        let direct =
                            scorer.score_for_owner(&vertex_owner, &edge_owner, seat, vertex, grant);
                        assert_eq!(
                            row[usize::from(vertex)].to_bits(),
                            direct.to_bits(),
                            "board {board_index} seat {seat} vertex {vertex} vacated {vacated:?}"
                        );
                        compared += 1;
                    }
                }
            }
        }
        assert!(compared > 20_000, "the boards must leave plenty to compare, got {compared}");
    }

    /// Owner-array padding is outside the graph and cannot block any expansion site.
    #[test]
    fn uncached_rows_ignore_rival_owners_past_the_graph() {
        let (topology, board) = fixture();
        let scorer = AppFormulaScorer::new(&board, &topology, default_weights());
        let mut vertices = vec![EMPTY; topology.vertex_count() + 1];
        vertices[topology.vertex_count()] = 1;
        let edges = vec![EMPTY; topology.edge_count()];
        let mut rows = ScoreRows::new(6, topology.vertex_count(), vertices.len(), false);
        let row = rows.legal_row(&scorer, &topology, &vertices, &edges, 0, false, None);
        for vertex in 0..topology.vertex_count() as Vertex {
            let direct = scorer.score_for_owner(&vertices, &edges, 0, vertex, false);
            assert_eq!(row[usize::from(vertex)].to_bits(), direct.to_bits());
        }
    }

    /// Degenerate weights preserve score bits on both reach paths and under a legality vacancy.
    #[test]
    fn uncached_rows_preserve_degenerate_weight_bits() {
        let (topology, board) = fixture();
        let mut rows = ScoreRows::new(6, topology.vertex_count(), topology.vertex_count(), false);
        for weight in [0.0, -0.0, -0.4, f64::NAN] {
            for decay in [0.0, -0.0, -0.5, f64::NAN] {
                let mut weights = default_weights();
                weights.expansion_weight = weight;
                weights.expansion_decay = decay;
                weights.resource_value.wheat = -2.0;
                let scorer = AppFormulaScorer::new(&board, &topology, weights);
                let mut vertices = vec![EMPTY; topology.vertex_count()];
                vertices[3] = 0;
                vertices[15] = 1;
                let mut edges = vec![EMPTY; topology.edge_count()];
                for own_roads in [false, true] {
                    if own_roads {
                        for edge in (0..edges.len()).step_by(3) {
                            edges[edge] = 0;
                        }
                    }
                    for vacated in [None, Some(3), Some(15)] {
                        let row =
                            rows.legal_row(&scorer, &topology, &vertices, &edges, 0, true, vacated);
                        for vertex in 0..topology.vertex_count() as Vertex {
                            if legal_with_vacancy(&topology, &vertices, vacated, vertex) {
                                let direct =
                                    scorer.score_for_owner(&vertices, &edges, 0, vertex, true);
                                assert_eq!(
                                    row[usize::from(vertex)].to_bits(),
                                    direct.to_bits(),
                                    "weight {weight} decay {decay} vertex {vertex} roads {own_roads}"
                                );
                            }
                        }
                    }
                }
            }
        }
    }

    /// The lookahead with SP3's expansion term switched on, which is the combination no committed
    /// arm carries and the one that turns the row cache off.
    ///
    /// The candidate's value must still be its own marginal plus the best second settlement the
    /// replay leaves standing, computed the long way round here. This is also the only test that
    /// drives `ScoreRows`' scratch path through a whole replay rather than a single row.
    #[test]
    fn the_lookahead_holds_up_with_the_expansion_term_on() {
        let (topology, board) = fixture();
        let mut weights = default_weights();
        weights.expansion_weight = 0.3;
        let scorers = DraftScorers {
            hero: AppFormulaScorer::new(&board, &topology, weights.clone()),
            opponent: AppFormulaScorer::new(&board, &topology, weights),
        };
        let vertex_owner = vec![EMPTY; topology.vertex_count()];
        let edge_owner = vec![EMPTY; topology.edge_count()];

        let mut lookahead = lookahead(&scorers, &topology, &vertex_owner, &edge_owner);
        let candidate: Vertex = 24;
        let value = lookahead.value(&vertex_owner, &edge_owner, candidate);

        let marginal =
            scorers
                .hero
                .score_for_owner(&vertex_owner, &edge_owner, HERO, candidate, false);
        // The replay is deterministic, so running it again leaves `owners` and `edges` exactly as
        // `value` left them, and the best surviving second settlement can be scanned off them.
        lookahead.replay(&vertex_owner, &edge_owner, candidate, None);
        assert_eq!(lookahead.owners[usize::from(candidate)], HERO);
        let second = (0..topology.vertex_count())
            .map(|index| index as Vertex)
            .filter(|vertex| can_place_settlement(&topology, &lookahead.owners, *vertex))
            .map(|vertex| {
                scorers.hero.score_for_owner(
                    &lookahead.owners,
                    &lookahead.edges,
                    HERO,
                    vertex,
                    true,
                )
            })
            .fold(f64::NEG_INFINITY, f64::max);
        assert!(second.is_finite(), "the hero must have somewhere to go");
        assert_eq!(value, marginal + second);
    }

    /// The credit a candidate earns is the weight times what the intervening rivals lose to it,
    /// and taking the next rival's own first choice is the case that costs it most.
    ///
    /// The state is an empty board with the hero at the fifth position, which no real draft
    /// reaches: the lookahead reads no history, only what stands and who picks next, so the
    /// arrangement is the whole input. The losses are recomputed here the long way round, over
    /// the whole vertex set and seat by seat, so the two agree only if the credit really is the
    /// sum of the intervening rivals' floored losses at the positions they pick from.
    #[test]
    fn the_denial_credit_is_what_the_intervening_rivals_lose() {
        const WEIGHT: f64 = 0.75;
        let (topology, board) = fixture();
        let plain = scorers_without_expansion(&topology, &board, 0.0);
        let credited = scorers_without_expansion(&topology, &board, WEIGHT);
        let vertex_owner = vec![EMPTY; topology.vertex_count()];
        let edge_owner = vec![EMPTY; topology.edge_count()];

        let mut row = Vec::new();
        score_row(
            &plain.opponent,
            topology.vertex_count(),
            &vertex_owner,
            &edge_owner,
            RIVAL,
            false,
            &mut row,
        );
        let (candidate, _) = best_legal(&topology, &vertex_owner, None, &row)
            .expect("an empty board has a best opening");

        let losses = rival_losses(&plain, &topology, &vertex_owner, &edge_owner, candidate);
        assert_eq!(losses.len(), 2, "seat {RIVAL} picks twice between the hero's picks");
        assert!(
            losses[0] > 0.0,
            "taking the rival's own first choice must cost it something"
        );

        let mut uncredited = lookahead(&plain, &topology, &vertex_owner, &edge_owner);
        let base = uncredited.value(&vertex_owner, &edge_owner, candidate);
        let mut credited = lookahead(&credited, &topology, &vertex_owner, &edge_owner);
        let paid = credited.value(&vertex_owner, &edge_owner, candidate);

        let expected: f64 = losses.iter().sum();
        assert_eq!(credited.denial, expected);
        assert_eq!(paid, base + WEIGHT * expected);
    }

    /// A candidate the rivals would have passed over at every pick of theirs costs them nothing,
    /// so it earns nothing, and its value is the one it carries at the shipped weight.
    #[test]
    fn a_candidate_no_rival_would_have_taken_earns_no_credit() {
        let (topology, board) = fixture();
        let plain = scorers(&topology, &board);
        let credited = scorers_at_denial(&topology, &board, 1.5);
        let vertex_owner = vec![EMPTY; topology.vertex_count()];
        let edge_owner = vec![EMPTY; topology.edge_count()];

        let candidate = (0..topology.vertex_count() as Vertex)
            .find(|candidate| {
                can_place_settlement(&topology, &vertex_owner, *candidate)
                    && rival_losses(&plain, &topology, &vertex_owner, &edge_owner, *candidate)
                        .iter()
                        .all(|loss| *loss == 0.0)
            })
            .expect("some opening leaves both of the rival's picks where they were");

        let mut uncredited = lookahead(&plain, &topology, &vertex_owner, &edge_owner);
        let base = uncredited.value(&vertex_owner, &edge_owner, candidate);
        let mut credited = lookahead(&credited, &topology, &vertex_owner, &edge_owner);

        assert_eq!(credited.value(&vertex_owner, &edge_owner, candidate), base);
        assert_eq!(credited.denial, 0.0);
    }

    /// The credit is a credit and never a charge: a rival that comes out ahead pays the hero
    /// nothing back, and a rival with no best on one side of the comparison is not differenced.
    #[test]
    fn the_denial_gain_floors_at_zero() {
        assert_eq!(denial_gain(Some((3, 2.0)), Some((7, 0.5))), 1.5);
        assert_eq!(denial_gain(Some((3, 0.5)), Some((7, 2.0))), 0.0);
        assert_eq!(denial_gain(None, Some((7, 2.0))), 0.0);
        assert_eq!(denial_gain(Some((3, 2.0)), None), 0.0);
    }
}
