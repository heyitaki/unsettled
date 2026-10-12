//! Best picks: the ranking of settlement placements during the snake draft.
//!
//! Twin of `src/engine/analyze.ts`, down to the order of evaluation, because
//! `simulator/fixtures/analysis-parity.json` pins the two against each other.

use std::sync::OnceLock;

use serde::{Deserialize, Serialize, Serializer};

use super::app_formula::{
    AppFormulaScorer, EngineWeights, Holdings, ScoreBreakdown, ScorerBoard, js_max, js_min,
};
use crate::board::{InitialBuilding, InitialRoad, SimPort};
use crate::rules::Resource;
use crate::state::EMPTY;
use crate::topology::{Hex, Topology, Vertex};
use crate::wire::{BuildingTier, TileKind, WireBoard};

// Reached only from its own tests until the ranking plays windows through it.
#[allow(dead_code)]
mod window;

/// The request JSON. The app sends `board` and `targetPick`; `options` exists for the corpus and
/// the tests, which need small rollout counts, other seeds and other weights.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AnalysisRequest {
    /// The app's `Board` JSON as the worker receives it.
    pub board: serde_json::Value,
    /// A pick index of the analysed player. One that is not a remaining pick of theirs, or is
    /// their next pick, behaves as unset.
    #[serde(default)]
    pub target_pick: Option<f64>,
    #[serde(default)]
    pub options: AnalysisOptions,
}

/// Numbers are `f64` where the TypeScript reads them beside a weight, which is one too.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AnalysisOptions {
    /// Defaults to 7.
    #[serde(default)]
    pub seed: Option<u32>,
    /// Defaults to `rollout_count`.
    #[serde(default)]
    pub rollouts: Option<f64>,
    /// Defaults to the weights' `maxResults`.
    #[serde(default)]
    pub max_results: Option<f64>,
    /// Defaults to `weights_for_seats` of the roster size.
    #[serde(default)]
    pub weights: Option<EngineWeights>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum AnalysisStatus {
    Ready,
    NoMe,
    MeDone,
    Complete,
    NoProduction,
    NoAvailability,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum DraftWarning {
    SnakeInconsistent,
    NonSettlementBuildings,
    SoloRoster,
}

/// Mirror of `DraftState` in `src/engine/draft.ts`.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftState {
    pub sequence: Vec<String>,
    pub placed_count: usize,
    pub turn_index: Option<usize>,
    pub current_player_id: Option<String>,
    pub my_pick_indices: Vec<usize>,
    pub my_remaining_pick_indices: Vec<usize>,
    pub remaining_pick_indices: Vec<usize>,
    pub warnings: Vec<DraftWarning>,
}

/// JSON has no non-finite numbers, so they travel as the strings the corpus generator writes.
fn js_number<S: Serializer>(value: &f64, serializer: S) -> Result<S::Ok, S::Error> {
    if value.is_finite() {
        serializer.serialize_f64(*value)
    } else if value.is_nan() {
        serializer.serialize_str("NaN")
    } else if *value > 0.0 {
        serializer.serialize_str("Infinity")
    } else {
        serializer.serialize_str("-Infinity")
    }
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Breakdown {
    #[serde(serialize_with = "js_number")]
    pub production: f64,
    #[serde(serialize_with = "js_number")]
    pub scarcity: f64,
    #[serde(serialize_with = "js_number")]
    pub robber: f64,
    #[serde(serialize_with = "js_number")]
    pub diversity: f64,
    #[serde(serialize_with = "js_number")]
    pub port: f64,
    #[serde(serialize_with = "js_number")]
    pub hand_value: f64,
    #[serde(serialize_with = "js_number")]
    pub expansion: f64,
}

impl From<ScoreBreakdown> for Breakdown {
    fn from(value: ScoreBreakdown) -> Self {
        Self {
            production: value.production,
            scarcity: value.scarcity,
            robber: value.robber,
            diversity: value.diversity,
            port: value.port,
            hand_value: value.hand_value,
            expansion: value.expansion,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Recommendation {
    pub first_pick: String,
    /// The setup road the expansion walk would lay from `first_pick`, if it opens anything.
    pub first_road: Option<String>,
    pub planned_second: Vec<String>,
    #[serde(serialize_with = "js_number")]
    pub survival: f64,
    #[serde(serialize_with = "js_number")]
    pub score: f64,
    #[serde(serialize_with = "js_number")]
    pub rank_score: f64,
    pub breakdown: Breakdown,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TakenVertex {
    pub vertex_id: String,
    pub player_id: String,
    #[serde(serialize_with = "js_number")]
    pub frequency: f64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftAnalysis {
    pub status: AnalysisStatus,
    pub draft: DraftState,
    pub recommendations: Vec<Recommendation>,
    pub taken_before_first_pick: Vec<TakenVertex>,
    pub warnings: Vec<DraftWarning>,
}

/// Twin of `mulberry32` in `src/engine/random.ts`: 32-bit wrapping arithmetic throughout.
pub struct Mulberry32 {
    state: u32,
}

pub fn mulberry32(seed: u32) -> Mulberry32 {
    Mulberry32 { state: seed }
}

impl Mulberry32 {
    /// The next uniform in `[0, 1)`: a 32-bit value over 2^32, which is exact.
    pub fn next_f64(&mut self) -> f64 {
        self.state = self.state.wrapping_add(0x6d2b_79f5);
        let state = self.state;
        let mut value = (state ^ state >> 15).wrapping_mul(1 | state);
        value = value.wrapping_add((value ^ value >> 7).wrapping_mul(61 | value)) ^ value;
        f64::from(value ^ value >> 14) / 4_294_967_296.0
    }
}

/// Index into `scores`, which is ordered best first, drawn in proportion to
/// `exp((score - best) / temperature)`. The TypeScript returns the vertex at that index of a
/// parallel list. A non-positive `uniform` or `temperature` takes the first.
pub fn softmax_pick(scores: &[f64], uniform: f64, temperature: f64) -> Option<usize> {
    let maximum = *scores.first()?;
    if uniform <= 0.0 || temperature <= 0.0 {
        return Some(0);
    }
    let mut total = 0.0;
    let probabilities: Vec<f64> = scores
        .iter()
        .map(|score| {
            let probability = ((score - maximum) / temperature).exp();
            total += probability;
            probability
        })
        .collect();
    let mut threshold = uniform * total;
    for (index, probability) in probabilities.iter().enumerate() {
        threshold -= probability;
        if threshold <= 0.0 {
            return Some(index);
        }
    }
    Some(scores.len() - 1)
}

/// Rollouts the budget affords: each costs one scan per pick ahead, then for every candidate one
/// scan per pick between the player's two settlements and one for the second settlement.
pub fn rollout_count(
    legal_count: usize,
    pre_picks: usize,
    mid_picks: usize,
    weights: &EngineWeights,
) -> f64 {
    let cost_per_rollout = pre_picks * legal_count + legal_count * (mid_picks + 1) * legal_count;
    let budgeted = (weights.rollout_budget / js_max(1.0, cost_per_rollout as f64)).floor();
    js_max(weights.rollouts_min, js_min(weights.rollouts_max, budgeted))
}

pub struct StatusInput {
    pub complete: bool,
    pub me_valid: bool,
    pub me_done: bool,
    pub legal_count: usize,
    pub has_positive_score: bool,
    pub recommendation_count: usize,
}

/// The one status precedence.
pub fn resolve_status(input: &StatusInput) -> AnalysisStatus {
    if input.complete {
        AnalysisStatus::Complete
    } else if !input.me_valid {
        AnalysisStatus::NoMe
    } else if input.me_done {
        AnalysisStatus::MeDone
    } else if input.legal_count == 0 {
        AnalysisStatus::NoAvailability
    } else if !input.has_positive_score {
        AnalysisStatus::NoProduction
    } else if input.recommendation_count == 0 {
        AnalysisStatus::NoAvailability
    } else {
        AnalysisStatus::Ready
    }
}

/// The shipped weights for a roster size: `seat-weights/seats-<n>.json` for two to six seats and
/// `default-weights.json` otherwise. Embedded, so the wasm build needs no file access.
pub fn weights_for_seats(seats: usize) -> &'static EngineWeights {
    static WEIGHTS: OnceLock<[EngineWeights; 6]> = OnceLock::new();
    let weights = WEIGHTS.get_or_init(|| {
        [
            include_str!("../../../../placement/default-weights.json"),
            include_str!("../../../../placement/seat-weights/seats-2.json"),
            include_str!("../../../../placement/seat-weights/seats-3.json"),
            include_str!("../../../../placement/seat-weights/seats-4.json"),
            include_str!("../../../../placement/seat-weights/seats-5.json"),
            include_str!("../../../../placement/seat-weights/seats-6.json"),
        ]
        .map(|json| serde_json::from_str(json).expect("embedded weights parse"))
    });
    match seats {
        2..=6 => &weights[seats - 1],
        _ => &weights[0],
    }
}

/// The app's board as the analysis reads it. `SimBoard::try_from_wire` refuses boards the app only
/// warns about (a blank tile, a resource hex with no number, no robber and no desert, adjacent
/// buildings, one player), so the analysis converts on its own and accepts every board
/// `WireBoard::validate` does, which is every board the app's `validateBoard` accepts.
struct Board {
    topology: &'static Topology,
    player_ids: Vec<String>,
    /// `mePlayerId` as a seat, which is its index in `players`.
    me: Option<u8>,
    /// In `board.buildings` order, which is the order holdings fold in.
    buildings: Vec<InitialBuilding>,
    roads: Vec<InitialRoad>,
    /// `None` for a desert and for a blank tile: neither produces.
    tiles: Vec<Option<Resource>>,
    tokens: Vec<Option<u8>>,
    robber: Option<Hex>,
    ports: Vec<SimPort>,
}

impl Board {
    /// `wire` has passed `WireBoard::validate`, so every id it names is on the layout or the
    /// roster.
    fn from_wire(wire: &WireBoard) -> Result<Self, String> {
        let topology = Topology::shared(wire.layout)?;
        let seat = |id: &str| {
            wire.players
                .iter()
                .position(|player| player.id == id)
                .expect("wire validation checked the roster") as u8
        };
        let mut tiles = vec![None; topology.hex_count()];
        let mut tokens = vec![None; topology.hex_count()];
        for item in &wire.hexes {
            let hex = topology
                .hex_by_key(&item.coord.key())
                .expect("wire validation mapped hex");
            tiles[usize::from(hex)] = item.tile.and_then(TileKind::resource);
            tokens[usize::from(hex)] = item.number_token.map(|token| token as u8);
        }
        Ok(Self {
            topology,
            player_ids: wire.players.iter().map(|player| player.id.clone()).collect(),
            me: wire.me_player_id.as_deref().map(seat),
            buildings: wire
                .buildings
                .iter()
                .map(|building| InitialBuilding {
                    vertex: topology
                        .vertex_by_id(&building.vertex_id)
                        .expect("wire validation mapped building"),
                    seat: seat(&building.player_id),
                    tier: building.tier,
                })
                .collect(),
            roads: wire
                .roads
                .iter()
                .map(|road| InitialRoad {
                    edge: topology
                        .edge_by_id(&road.edge_id)
                        .expect("wire validation mapped road"),
                    seat: seat(&road.player_id),
                })
                .collect(),
            tiles,
            tokens,
            // No stand-in when the robber is unplaced: the TypeScript robs no hex then.
            robber: wire.robber.as_ref().map(|coord| {
                topology
                    .hex_by_key(&coord.key())
                    .expect("wire validation mapped robber")
            }),
            ports: wire
                .ports
                .iter()
                .map(|port| SimPort {
                    edge: topology
                        .edge_by_id(&port.edge_id)
                        .expect("wire validation mapped port"),
                    resource: port.resource,
                    rate: port.rate as u32,
                })
                .collect(),
        })
    }

    /// The scorer over this board's tiles, tokens, robber and ports. Pieces and the claimed
    /// player do not enter it, so one scorer serves every scratch board a ranking builds.
    fn scorer(&self, weights: EngineWeights) -> AppFormulaScorer {
        AppFormulaScorer::from_parts(
            ScorerBoard {
                tiles: &self.tiles,
                tokens: &self.tokens,
                robber: self.robber,
                ports: &self.ports,
                seats: self.player_ids.len(),
            },
            self.topology,
            weights,
        )
    }

    /// Every seat's holdings. Twin of `holdingsFromBoard`: buildings of any tier, folded in
    /// `board.buildings` order.
    fn holdings(&self, scorer: &AppFormulaScorer) -> Vec<Holdings> {
        let mut holdings = vec![Holdings::empty(); self.player_ids.len()];
        for building in &self.buildings {
            scorer.add_to_holdings(&mut holdings[usize::from(building.seat)], building.vertex);
        }
        holdings
    }

    /// The pieces as the scorer's occupancy reads them: the owning seat per vertex and per edge.
    /// Twin of `occupancyFromBoard`, whose `blocked` is the built vertices themselves.
    fn owners(&self) -> (Vec<u8>, Vec<u8>) {
        let mut vertex_owner = vec![EMPTY; self.topology.vertex_count()];
        for building in &self.buildings {
            vertex_owner[usize::from(building.vertex)] = building.seat;
        }
        let mut edge_owner = vec![EMPTY; self.topology.edge_count()];
        for road in &self.roads {
            edge_owner[usize::from(road.edge)] = road.seat;
        }
        (vertex_owner, edge_owner)
    }

    /// Twin of `blockedVertices` over the board's buildings: every vertex the distance rule bars.
    fn blocked(&self) -> Vec<bool> {
        let mut blocked = vec![false; self.topology.vertex_count()];
        for building in &self.buildings {
            window::block_vertex(self.topology, &mut blocked, building.vertex);
        }
        blocked
    }

    /// Twin of `legalSettlementVertices`: the vertices neither built on nor beside a building,
    /// in index order.
    fn legal_vertices(&self) -> Vec<Vertex> {
        let blocked = self.blocked();
        (0..self.topology.vertex_count())
            .filter(|vertex| !blocked[*vertex])
            .map(|vertex| vertex as Vertex)
            .collect()
    }
}

fn draft_is_over(board: &Board, placed_count: usize, sequence_len: usize) -> bool {
    placed_count >= sequence_len
        || board
            .buildings
            .iter()
            .any(|building| building.tier != BuildingTier::Settlement)
}

/// Twin of `inferDraftState` in `src/engine/draft.ts`.
fn infer_draft_state(board: &Board) -> DraftState {
    let seats = board.player_ids.len();
    // The snake: every seat in roster order, then back again.
    let order: Vec<usize> = (0..seats).chain((0..seats).rev()).collect();
    let mut actual = vec![0_usize; seats];
    let mut settlements = 0;
    for building in &board.buildings {
        if building.tier == BuildingTier::Settlement {
            actual[usize::from(building.seat)] += 1;
            settlements += 1;
        }
    }
    let placed_count = settlements.min(order.len());
    let mut warnings = Vec::new();
    if settlements != board.buildings.len() {
        warnings.push(DraftWarning::NonSettlementBuildings);
    }
    if seats == 1 {
        warnings.push(DraftWarning::SoloRoster);
    }
    let mut expected = vec![0_usize; seats];
    for seat in &order[..placed_count] {
        expected[*seat] += 1;
    }
    // Only meaningful while the draft is still running: once it is over, building counts drift
    // from the snake through ordinary play.
    if !draft_is_over(board, placed_count, order.len()) && expected != actual {
        warnings.push(DraftWarning::SnakeInconsistent);
    }

    let turn_index = (placed_count < order.len()).then_some(placed_count);
    // A seat holding more settlements than the snake has reached has made that many of its coming
    // picks already. Every seat picks twice.
    let mut skips: Vec<usize> = (0..seats)
        .map(|seat| actual[seat].min(2).saturating_sub(expected[seat]))
        .collect();
    let mut remaining_pick_indices = Vec::new();
    for index in turn_index.unwrap_or(order.len())..order.len() {
        let skip = &mut skips[order[index]];
        if *skip > 0 {
            *skip -= 1;
        } else {
            remaining_pick_indices.push(index);
        }
    }
    let mine = |index: &usize| board.me == Some(order[*index] as u8);
    DraftState {
        sequence: order.iter().map(|seat| board.player_ids[*seat].clone()).collect(),
        placed_count,
        turn_index,
        current_player_id: turn_index.map(|index| board.player_ids[order[index]].clone()),
        my_pick_indices: (0..order.len()).filter(mine).collect(),
        my_remaining_pick_indices: remaining_pick_indices.iter().copied().filter(mine).collect(),
        remaining_pick_indices,
        warnings,
    }
}

/// Twin of `draftIsComplete`.
fn draft_is_complete(board: &Board, draft: &DraftState) -> bool {
    draft_is_over(board, draft.placed_count, draft.sequence.len())
}

/// Whether the pick at `turn_index` is its player's second, which is the one that pays out a
/// starting hand.
fn receives_second_settlement_grant(draft: &DraftState, turn_index: usize) -> bool {
    draft.sequence.get(turn_index).is_some_and(|player_id| {
        draft.sequence[..turn_index].iter().filter(|earlier| *earlier == player_id).count() == 1
    })
}

/// Twin of `analyzeBoard`: the response JSON for a request, or `{"error": ...}` for one that is
/// not valid JSON of the request shape or whose board the app's `validateBoard` would refuse.
/// `progress` receives the fraction of the ranking done so far.
pub fn analyze(request_json: &str, progress: &mut dyn FnMut(f64)) -> String {
    match analyze_request(request_json, progress) {
        Ok(analysis) => serde_json::to_string(&analysis).expect("the response serialises"),
        Err(error) => serde_json::json!({ "error": error }).to_string(),
    }
}

fn analyze_request(
    request_json: &str,
    _progress: &mut dyn FnMut(f64),
) -> Result<DraftAnalysis, String> {
    let request: AnalysisRequest =
        serde_json::from_str(request_json).map_err(|error| error.to_string())?;
    let wire = WireBoard::parse_value(request.board).map_err(|error| error.to_string())?;
    let board = Board::from_wire(&wire)?;
    let weights = request
        .options
        .weights
        .unwrap_or_else(|| weights_for_seats(board.player_ids.len()).clone());
    let scorer = board.scorer(weights);

    let draft = infer_draft_state(&board);
    let pick_offset = request
        .target_pick
        .and_then(|target| {
            draft.my_remaining_pick_indices.iter().position(|index| *index as f64 == target)
        })
        .unwrap_or(0);
    let legal = board.legal_vertices();
    let complete = draft_is_complete(&board, &draft);
    let me_done = draft.my_remaining_pick_indices.is_empty();
    let has_positive_score = match board.me {
        Some(me) if !complete && !me_done && !legal.is_empty() => {
            let receives_grant = draft
                .my_remaining_pick_indices
                .get(pick_offset)
                .is_some_and(|index| receives_second_settlement_grant(&draft, *index));
            let holdings = board.holdings(&scorer)[usize::from(me)];
            let (vertex_owner, edge_owner) = board.owners();
            legal.iter().any(|vertex| {
                let (_, total) = scorer.marginal_parts(
                    &holdings,
                    &vertex_owner,
                    &edge_owner,
                    me,
                    *vertex,
                    receives_grant,
                );
                total > 0.0
            })
        }
        _ => false,
    };

    let status = resolve_status(&StatusInput {
        complete,
        me_valid: board.me.is_some(),
        me_done,
        legal_count: legal.len(),
        has_positive_score,
        recommendation_count: 0,
    });
    Ok(DraftAnalysis {
        status,
        warnings: draft.warnings.clone(),
        draft,
        // Nothing is ranked yet, so the statuses that keep these lists have nothing to keep.
        recommendations: Vec::new(),
        taken_before_first_pick: Vec::new(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rollout_count_matches_the_values_the_app_pins() {
        let weights = weights_for_seats(6);
        assert_eq!(rollout_count(80, 0, 10, weights), 7.0);
        assert_eq!(rollout_count(80, 3, 2, weights), 24.0);
        assert_eq!(rollout_count(80, 5, 0, weights), 24.0);
        assert_eq!(rollout_count(80, 10, 0, weights), 24.0);
    }

    #[test]
    fn rollout_count_stays_inside_the_weights_bounds() {
        let weights = weights_for_seats(6);
        assert_eq!(rollout_count(0, 0, 0, weights), weights.rollouts_max);
        assert_eq!(rollout_count(80, 0, 100, weights), weights.rollouts_min);
    }

    #[test]
    fn resolve_status_follows_the_precedence() {
        // Each step clears the condition the previous status came from and nothing else.
        let mut input = StatusInput {
            complete: true,
            me_valid: false,
            me_done: true,
            legal_count: 0,
            has_positive_score: false,
            recommendation_count: 0,
        };
        assert_eq!(resolve_status(&input), AnalysisStatus::Complete);
        input.complete = false;
        assert_eq!(resolve_status(&input), AnalysisStatus::NoMe);
        input.me_valid = true;
        assert_eq!(resolve_status(&input), AnalysisStatus::MeDone);
        input.me_done = false;
        assert_eq!(resolve_status(&input), AnalysisStatus::NoAvailability);
        input.legal_count = 5;
        assert_eq!(resolve_status(&input), AnalysisStatus::NoProduction);
        input.has_positive_score = true;
        assert_eq!(resolve_status(&input), AnalysisStatus::NoAvailability);
        input.recommendation_count = 2;
        assert_eq!(resolve_status(&input), AnalysisStatus::Ready);
    }

    #[test]
    fn softmax_pick_takes_the_first_without_a_draw() {
        let scores = [1.0, 5.0, 3.0];
        assert_eq!(softmax_pick(&scores, 0.0, 1.25), Some(0));
        assert_eq!(softmax_pick(&scores, -0.5, 1.25), Some(0));
        assert_eq!(softmax_pick(&scores, 0.9, 0.0), Some(0));
        assert_eq!(softmax_pick(&scores, 0.9, -1.0), Some(0));
        assert_eq!(softmax_pick(&[], 0.9, 1.25), None);
        assert_eq!(softmax_pick(&[], 0.0, 0.0), None);
    }

    #[test]
    fn softmax_pick_falls_through_to_the_last() {
        // A threshold above the total is never used up, and a NaN one never compares.
        assert_eq!(softmax_pick(&[2.0, 1.0, 0.0], 1.5, 1.0), Some(2));
        assert_eq!(softmax_pick(&[2.0, f64::NAN, 0.0], 0.1, 1.0), Some(2));
        assert_eq!(softmax_pick(&[2.0, 1.0, 0.0], f64::NAN, 1.0), Some(2));
    }

    #[test]
    fn softmax_pick_draws_by_weight() {
        // Weights 1, e^-1 and e^-2 sum to 1.50321, so the bands end at 0.66524 and 0.90997.
        let scores = [2.0, 1.0, 0.0];
        assert_eq!(softmax_pick(&scores, 0.5, 1.0), Some(0));
        assert_eq!(softmax_pick(&scores, 0.7, 1.0), Some(1));
        assert_eq!(softmax_pick(&scores, 0.95, 1.0), Some(2));
        // Doubling the temperature flattens them to 1, e^-0.5 and e^-1: bands end at 0.50648
        // and 0.81368.
        assert_eq!(softmax_pick(&scores, 0.6, 2.0), Some(1));
        assert_eq!(softmax_pick(&scores, 0.85, 2.0), Some(2));
    }

    #[test]
    fn non_finite_numbers_travel_as_strings() {
        let taken = |frequency| {
            serde_json::to_value(TakenVertex {
                vertex_id: "v".into(),
                player_id: "p".into(),
                frequency,
            })
            .unwrap()["frequency"]
                .clone()
        };
        assert_eq!(taken(0.75), 0.75);
        assert_eq!(taken(f64::NAN), "NaN");
        assert_eq!(taken(f64::INFINITY), "Infinity");
        assert_eq!(taken(f64::NEG_INFINITY), "-Infinity");
    }

    #[test]
    fn response_json_uses_the_app_names() {
        let analysis = DraftAnalysis {
            status: AnalysisStatus::NoAvailability,
            draft: DraftState {
                sequence: vec!["a".into()],
                placed_count: 0,
                turn_index: Some(0),
                current_player_id: None,
                my_pick_indices: vec![],
                my_remaining_pick_indices: vec![],
                remaining_pick_indices: vec![0],
                warnings: vec![DraftWarning::NonSettlementBuildings],
            },
            recommendations: vec![],
            taken_before_first_pick: vec![],
            warnings: vec![DraftWarning::SnakeInconsistent, DraftWarning::SoloRoster],
        };
        assert_eq!(
            serde_json::to_value(&analysis).unwrap(),
            serde_json::json!({
                "status": "no-availability",
                "draft": {
                    "sequence": ["a"],
                    "placedCount": 0,
                    "turnIndex": 0,
                    "currentPlayerId": null,
                    "myPickIndices": [],
                    "myRemainingPickIndices": [],
                    "remainingPickIndices": [0],
                    "warnings": ["non-settlement-buildings"],
                },
                "recommendations": [],
                "takenBeforeFirstPick": [],
                "warnings": ["snake-inconsistent", "solo-roster"],
            })
        );
    }

    #[test]
    fn request_json_reads_what_the_app_and_the_corpus_send() {
        let app: AnalysisRequest = serde_json::from_str(r#"{"board":{},"targetPick":5}"#).unwrap();
        assert_eq!(app.target_pick, Some(5.0));
        assert!(app.options.seed.is_none() && app.options.weights.is_none());
        let corpus: AnalysisRequest = serde_json::from_str(
            r#"{"board":{},"options":{"seed":12345,"rollouts":3,"maxResults":2}}"#,
        )
        .unwrap();
        assert_eq!(corpus.target_pick, None);
        assert_eq!(corpus.options.seed, Some(12345));
        assert_eq!(corpus.options.rollouts, Some(3.0));
        assert_eq!(corpus.options.max_results, Some(2.0));
        assert!(serde_json::from_str::<AnalysisRequest>(r#"{"board":{},"rolouts":3}"#).is_err());
    }
}
