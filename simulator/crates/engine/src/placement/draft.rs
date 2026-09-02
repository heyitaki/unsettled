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
//! candidate and every intervening pick; the speed comes from `ScoreRows`, never from pruning.

use std::ops::Range;

use super::app_formula::{AppFormulaScorer, js_max};
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

/// One seat's score for every vertex, at one holdings set and one setup grant.
///
/// Every component of the formula but `expansion` is a function of the seat, its own holdings and
/// the candidate alone, so a row computed while weighing one hero candidate is exactly the row
/// wanted for the next. `expansion` is the exception: it walks the occupancy around the
/// candidate, which the lookahead moves as it replays. Rows are therefore kept only while both
/// formulas carry `expansionWeight` 0, and recomputed into `scratch` when either does not.
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
/// `vacated` names a vertex to treat as unoccupied for legality alone. That is how the same row
/// answers what a seat could have taken had another seat not taken that vertex: the scores in the
/// row do not move, only which of them are still reachable.
fn best_legal(
    topology: &Topology,
    vertex_owner: &[u8],
    vacated: Option<Vertex>,
    row: &[f64],
) -> Option<(Vertex, f64)> {
    let mut best: Option<(Vertex, f64)> = None;
    for (vertex_index, score) in row.iter().enumerate() {
        let vertex = vertex_index as Vertex;
        if !legal_with_vacancy(topology, vertex_owner, vacated, vertex) {
            continue;
        }
        if best.is_none_or(|(_, held)| *score > held) {
            best = Some((vertex, *score));
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
) -> Edge {
    if let Some(edge) = scorer.expansion_road(vertex_owner, edge_owner, seat, vertex) {
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
    let mut best: Option<(Vertex, f64)> = None;
    for vertex_index in 0..topology.vertex_count() {
        let vertex = vertex_index as Vertex;
        if !can_place_settlement(topology, vertex_owner, vertex) {
            continue;
        }
        let score = scorer.score_for_owner(vertex_owner, edge_owner, seat, vertex, grant);
        if best.is_none_or(|(_, held)| score > held) {
            best = Some((vertex, score));
        }
    }
    best.map(|(vertex, _)| vertex)
}

/// One hero's first-pick lookahead over one board state, carrying the scratch every candidate
/// reuses: the replayed owner arrays and the score rows.
struct Lookahead<'a> {
    scorers: &'a DraftScorers,
    topology: &'a Topology,
    seats: usize,
    hero: u8,
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
        scorers: &'a DraftScorers,
        topology: &'a Topology,
        seats: usize,
        hero: u8,
        vertex_owner: &[u8],
        edge_owner: &[u8],
    ) -> Option<Self> {
        let order = setup_order(seats);
        let first = order.iter().position(|seat| *seat == hero)?;
        let last = order.iter().rposition(|seat| *seat == hero)?;
        let reusable = scorers.hero.weights().expansion_weight == 0.0
            && scorers.opponent.weights().expansion_weight == 0.0;
        Some(Self {
            scorers,
            topology,
            seats,
            hero,
            order,
            intervening: first + 1..last,
            rows: ScoreRows::new(seats, topology.vertex_count(), vertex_owner.len(), reusable),
            owners: vertex_owner.to_vec(),
            edges: edge_owner.to_vec(),
            denial_weight: scorers.hero.weights().setup_denial_weight,
            denial: 0.0,
        })
    }

    /// What the candidate is worth once the intervening picks are taken into account: its own
    /// marginal score plus the best second settlement still legal after the replay, plus the
    /// setup denial credit. A candidate whose replay leaves the hero nowhere to go is worth its
    /// own marginal alone.
    fn value(&mut self, vertex_owner: &[u8], edge_owner: &[u8], candidate: Vertex) -> f64 {
        let marginal = self.scorers.hero.score_for_owner(
            vertex_owner,
            edge_owner,
            self.hero,
            candidate,
            false,
        );
        self.replay(vertex_owner, edge_owner, candidate, None);
        let second = {
            let row = self.rows.row(
                &self.scorers.hero,
                &self.owners,
                &self.edges,
                self.hero,
                true,
            );
            best_legal(self.topology, &self.owners, None, row).map_or(0.0, |(_, score)| score)
        };
        // At the shipped weight the credit is not merely zero but never formed: `replay` skips
        // its second scan and the value is exactly the one the kind carried before SP5's denial
        // term existed.
        if self.denial_weight == 0.0 {
            return marginal + second;
        }
        marginal + second + self.denial_weight * self.denial
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
        let road = setup_road(
            &self.scorers.hero,
            self.topology,
            vertex_owner,
            edge_owner,
            self.hero,
            candidate,
        );
        self.owners[usize::from(candidate)] = self.hero;
        self.edges[usize::from(road)] = self.hero;
        for position in self.intervening.clone() {
            let seat = self.order[position];
            // `setup_order` runs the first round forward and the second reversed, so a position
            // past the seat count is a second-round pick, which is the round that pays the grant.
            let grant = position >= self.seats;
            let pick = {
                let row = self.rows.row(
                    &self.scorers.opponent,
                    &self.owners,
                    &self.edges,
                    seat,
                    grant,
                );
                let taken = best_legal(self.topology, &self.owners, None, row);
                if self.denial_weight != 0.0 {
                    let free = best_legal(self.topology, &self.owners, Some(candidate), row);
                    self.denial += denial_gain(free, taken);
                }
                taken
            };
            let Some((pick, _)) = pick else {
                continue;
            };
            let road = setup_road(
                &self.scorers.opponent,
                self.topology,
                &self.owners,
                &self.edges,
                seat,
                pick,
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
    let mut lookahead = Lookahead::new(scorers, topology, seats, hero, vertex_owner, edge_owner)?;
    let mut best: Option<(Vertex, f64)> = None;
    for vertex_index in 0..topology.vertex_count() {
        let candidate = vertex_index as Vertex;
        if !can_place_settlement(topology, vertex_owner, candidate) {
            continue;
        }
        let value = lookahead.value(vertex_owner, edge_owner, candidate);
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
    Lookahead::new(scorers, topology, seats, seat, vertex_owner, edge_owner)
        .map_or(f64::NEG_INFINITY, |mut lookahead| {
            lookahead.value(vertex_owner, edge_owner, candidate)
        })
}

/// The intervening picks the first-pick lookahead predicts when the hero takes `candidate` at
/// this state, in `setup_order` order. Observation only: the replay without its valuation, so a
/// test can hold the opponent model against the picks a real field made.
pub(super) fn replay_picks(
    scorers: &DraftScorers,
    topology: &Topology,
    seats: usize,
    vertex_owner: &[u8],
    edge_owner: &[u8],
    hero: u8,
    candidate: Vertex,
) -> Vec<(u8, Vertex)> {
    let mut picks = Vec::new();
    if let Some(mut lookahead) =
        Lookahead::new(scorers, topology, seats, hero, vertex_owner, edge_owner)
    {
        lookahead.replay(vertex_owner, edge_owner, candidate, Some(&mut picks));
    }
    picks
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

    /// Seats and hero of the denial tests. At six seats the hero picking fifth is followed by the
    /// last seat's two picks and nothing else, so the credit sums exactly one rival's two losses.
    const SEATS: usize = 6;
    const HERO: u8 = 4;
    const RIVAL: u8 = 5;

    /// What each intervening rival loses to the hero's candidate, computed without the lookahead:
    /// a full legality scan per rival per position, once with the candidate taken and once with
    /// the vertex genuinely empty rather than merely vacated for legality.
    ///
    /// Roads are left off the replayed board. Only the `expansion` component reads edges and the
    /// committed weights ship it at 0, which is the same condition `ScoreRows` reuses rows under.
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
            let best = |owners: &[u8]| {
                let mut best: Option<(Vertex, f64)> = None;
                for index in 0..topology.vertex_count() {
                    let vertex = index as Vertex;
                    if !can_place_settlement(topology, owners, vertex) {
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
            let (pick, taken) = best(&owners);
            let mut free_board = owners.clone();
            free_board[usize::from(candidate)] = EMPTY;
            let (_, free) = best(&free_board);
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
    /// direct score would. Only the `expansion` component reads anything else, and it is off at
    /// the shipped weights this test loads.
    #[test]
    fn a_cached_row_matches_a_direct_score() {
        let (topology, board) = fixture();
        let scorers = scorers(&topology, &board);
        let mut vertex_owner = vec![EMPTY; topology.vertex_count()];
        vertex_owner[7] = 1;
        let edge_owner = vec![EMPTY; topology.edge_count()];
        let mut rows = ScoreRows::new(6, topology.vertex_count(), vertex_owner.len(), true);

        for _ in 0..2 {
            let row = rows
                .row(&scorers.opponent, &vertex_owner, &edge_owner, 1, true)
                .to_vec();
            for (vertex, score) in row.iter().enumerate() {
                let direct = scorers.opponent.score_for_owner(
                    &vertex_owner,
                    &edge_owner,
                    1,
                    vertex as Vertex,
                    true,
                );
                assert_eq!(*score, direct, "vertex {vertex}");
            }
        }
    }

    /// The credit a candidate earns is the weight times what the intervening rivals lose to it,
    /// and taking the next rival's own first choice is the case that costs it most.
    ///
    /// The state is an empty board with the hero at the fifth position, which no real draft
    /// reaches: the lookahead reads no history, only what stands and who picks next, so the
    /// arrangement is the whole input. The losses are recomputed here the long way round, so the
    /// two agree only if a rival's scores really are independent of what the hero owns.
    #[test]
    fn the_denial_credit_is_what_the_intervening_rivals_lose() {
        const WEIGHT: f64 = 0.75;
        let (topology, board) = fixture();
        let plain = scorers(&topology, &board);
        let credited = scorers_at_denial(&topology, &board, WEIGHT);
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

        let mut uncredited = Lookahead::new(
            &plain,
            &topology,
            SEATS,
            HERO,
            &vertex_owner,
            &edge_owner,
        )
        .expect("the hero picks twice");
        let base = uncredited.value(&vertex_owner, &edge_owner, candidate);
        let mut lookahead = Lookahead::new(
            &credited,
            &topology,
            SEATS,
            HERO,
            &vertex_owner,
            &edge_owner,
        )
        .expect("the hero picks twice");
        let paid = lookahead.value(&vertex_owner, &edge_owner, candidate);

        let expected: f64 = losses.iter().sum();
        assert_eq!(lookahead.denial, expected);
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

        let mut uncredited = Lookahead::new(
            &plain,
            &topology,
            SEATS,
            HERO,
            &vertex_owner,
            &edge_owner,
        )
        .expect("the hero picks twice");
        let base = uncredited.value(&vertex_owner, &edge_owner, candidate);
        let mut lookahead = Lookahead::new(
            &credited,
            &topology,
            SEATS,
            HERO,
            &vertex_owner,
            &edge_owner,
        )
        .expect("the hero picks twice");

        assert_eq!(lookahead.value(&vertex_owner, &edge_owner, candidate), base);
        assert_eq!(lookahead.denial, 0.0);
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
