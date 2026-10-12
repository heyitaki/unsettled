use std::cell::{LazyCell, OnceCell};
use std::hint::black_box;
use std::time::{Duration, Instant};

use rayon::prelude::*;
use serde::Serialize;
use serde_json::Value;
use unsettled_engine::advice::advise;
use unsettled_engine::board::SimBoard;
use unsettled_engine::game::{
    GameArena, GameConfig, GameResult, can_place_settlement, setup_order,
};
use unsettled_engine::placement::analysis::{analyze, forget_nested_rankings};
use unsettled_engine::placement::{self, PlacementKind, prepare_app_formula_boards};
use unsettled_engine::policy::{self, PolicyKind, PolicyScratch};
use unsettled_engine::rng::{Xoshiro256StarStar, mix64};
use unsettled_engine::rules::{Buildable, OwnedPort, Resource, RuleConfig, TradeConfig};
use unsettled_engine::state::{EMPTY, MAX_EDGES, MAX_SEATS, MAX_VERTICES, PlayerState};
use unsettled_engine::topology::{Layout, Topology};
use unsettled_engine::trade::{TradeOffer, embargoed};
use unsettled_engine::view::{Action, DecisionPhase, DecisionView, DevPlay};

use crate::boardgen::generate_board;
use crate::evaluate::{PERF_SEED, evaluation_workers};
use crate::heuristics::parse_heuristic;

pub const DEFAULT_WEIGHTS: &str = "placement/default-weights.json";
pub const REFERENCE_POLICY: PolicyKind = PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenial;

pub fn reference_policy_name() -> String {
    serde_json::to_value(REFERENCE_POLICY)
        .unwrap()
        .as_str()
        .unwrap()
        .to_owned()
}

// Fractions of each reference game's own length keep later stages before its winning turn.
// Integer arithmetic rounds seat turns down to complete rounds, the unit of rules.turn_cap.
const EARLY_FRACTION: (u16, u16) = (1, 4);
const MID_FRACTION: (u16, u16) = (1, 2);
const LATE_FRACTION: (u16, u16) = (3, 4);
const STAGES: [(&str, (u16, u16)); 3] = [
    ("early", EARLY_FRACTION),
    ("mid", MID_FRACTION),
    ("late", LATE_FRACTION),
];

// Exhaust the same bounded search in every filter and build profile before calling a decision rare.
const SEARCH_SEED_OFFSETS: [u64; 6] = [0, 1, 2, 3, 4, 5];

// Bound automatic passes and their per-call view buffers on very cheap decisions.
const MAX_CALIBRATION_CALLS: usize = 65_536;

pub struct BenchRequest<'a> {
    pub filter: Option<&'a str>,
    pub quick: bool,
    pub calls: Option<usize>,
    pub min_pass: Duration,
    pub repeats: usize,
    pub games: usize,
    pub threads: usize,
    pub policy: PolicyKind,
    pub policy_name: &'a str,
    pub weights: &'a str,
    pub greedy: PlacementKind,
    pub draft: PlacementKind,
}

#[derive(Serialize)]
pub struct BenchResult {
    seed: String,
    policy: String,
    weights: String,
    scenarios: Vec<Scenario>,
}

#[derive(Serialize)]
struct Scenario {
    id: String,
    group: String,
    layout: Layout,
    #[serde(flatten)]
    outcome: Outcome,
}

#[derive(Serialize)]
#[serde(tag = "status", rename_all = "lowercase")]
enum Outcome {
    Measured {
        #[serde(flatten)]
        measurement: Measurement,
        #[serde(rename = "gamesPerSecond", skip_serializing_if = "Option::is_none")]
        games_per_second: Option<f64>,
    },
    Skipped {
        reason: String,
    },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Measurement {
    calls: usize,
    repeats: usize,
    ns_per_call_min: f64,
    ns_per_call_median: f64,
    state_hash: String,
    decision_hash: String,
}

impl BenchResult {
    pub fn print_table(&self) {
        println!(
            "seed: {}  policy: {}  weights: {}",
            self.seed, self.policy, self.weights
        );
        println!(
            "{:<48} {:>7} {:>7} {:>13} {:>13} {:>12}",
            "scenario", "calls", "repeats", "min ns/call", "median ns/call", "games/sec"
        );
        for row in &self.scenarios {
            match &row.outcome {
                Outcome::Measured {
                    measurement: m,
                    games_per_second,
                } => println!(
                    "{:<48} {:>7} {:>7} {:>13.1} {:>13.1} {:>12}",
                    row.id,
                    m.calls,
                    m.repeats,
                    m.ns_per_call_min,
                    m.ns_per_call_median,
                    games_per_second.map_or_else(|| String::from(""), |rate| format!("{rate:.2}"))
                ),
                Outcome::Skipped { reason } => println!("{:<48} skipped: {reason}", row.id),
            }
        }
    }

    fn push(&mut self, id: String, layout: Layout, outcome: Outcome) {
        self.scenarios.push(Scenario {
            group: id.split('/').next().unwrap().to_owned(),
            id,
            layout,
            outcome,
        });
    }
}

pub fn benchmark(request: &BenchRequest<'_>) -> Result<BenchResult, String> {
    if let Some(filter) = request.filter
        && ![Layout::Standard4, Layout::Extension6]
            .into_iter()
            .flat_map(scenario_ids)
            .any(|id| id.contains(filter))
    {
        return Err(format!("bench filter {filter:?} matches no scenario id"));
    }
    if request.calls == Some(0) || request.repeats == 0 || request.games == 0 {
        return Err("--calls, --repeats and --games must be positive".into());
    }
    if !request.policy.port_rules().is_empty() {
        return Err(format!(
            "bench policy {} has rule-level effects that reference states cannot carry",
            request.policy_name
        ));
    }
    let mut result = BenchResult {
        seed: format!("{PERF_SEED:016x}"),
        policy: request.policy_name.to_owned(),
        weights: request.weights.to_owned(),
        scenarios: Vec::new(),
    };
    let advice_fixture = OnceCell::new();
    for (layout, seats) in [(Layout::Standard4, 4), (Layout::Extension6, 6)] {
        if !scenario_ids(layout).any(|id| matches_filter(request, &id)) {
            continue;
        }
        let reference_greedy = parse_heuristic(&format!("app_formula:{DEFAULT_WEIGHTS}"), seats)?;
        let topology = Topology::load(layout)?;
        let raw = generate_board(layout, seats, mix64(PERF_SEED))?;
        let mut board = raw.clone();
        prepare_app_formula_boards(
            std::slice::from_mut(&mut board),
            &topology,
            &[reference_greedy, request.greedy, request.draft],
        );
        placement_scenarios(
            &mut result,
            request,
            &raw,
            &board,
            &topology,
            reference_greedy,
        );
        decision_scenarios(&mut result, request, &board, &topology, reference_greedy);
        e2e_scenarios(&mut result, request, &board, &topology)?;
        advise_scenarios(&mut result, request, layout, &advice_fixture)?;
        analyze_scenarios(&mut result, request, layout)?;
    }
    Ok(result)
}

struct StressScenario {
    name: &'static str,
    score: fn(&PlayerState) -> u32,
    minimum: fn(&RuleConfig) -> u32,
}

// Award-length roads and discard-sized hands keep the stress rows on costly paths.
const STRESS_SCENARIOS: [StressScenario; 2] = [
    StressScenario {
        name: "long_road",
        score: |player| u32::from(player.longest_road_len),
        minimum: |rules| u32::from(rules.longest_road_min),
    },
    StressScenario {
        name: "full_hand",
        score: PlayerState::hand_total,
        minimum: |rules| u32::from(rules.discard_threshold) + 1,
    },
];
const E2E_MODES: [&str; 2] = ["single_core", "all_cores"];
const ADVISE_KINDS: [(&str, &str); 6] = [
    ("turn", "turn"),
    ("pre_roll", "preRoll"),
    ("discard", "discard"),
    ("robber", "robber"),
    ("trade_response", "tradeResponse"),
    ("produce", "produce"),
];
// Layout, row, case of the analysis parity fixture, and the player the board is viewed as when
// that is not the case's own. `behind_three` is the worst-case opening seen from the fourth seat,
// which ranks the three seats ahead of it before its own pick.
const ANALYZE_ROWS: [(Layout, &str, &str, Option<&str>); 3] = [
    (Layout::Standard4, "opening", "empty-first-seat-standard4", None),
    (Layout::Extension6, "opening", "worst-case-default-rollouts", None),
    (Layout::Extension6, "behind_three", "worst-case-default-rollouts", Some("p4")),
];

fn advise_id(layout: Layout, kind: &str) -> String {
    format!("advise/{}/{kind}", layout.as_str())
}

fn analyze_id(layout: Layout, kind: &str) -> String {
    format!("analyze/{}/{kind}", layout.as_str())
}

fn placement_id(layout: Layout, suffix: &str) -> String {
    format!("placement/{}/{suffix}", layout.as_str())
}

fn e2e_id(layout: Layout, mode: &str) -> String {
    format!("e2e/{}/{mode}", layout.as_str())
}

fn decision_id(layout: Layout, kind: DecisionKind, stage: &str) -> String {
    format!("decision/{}/{}/{stage}", layout.as_str(), kind.name())
}

fn decision_ids(layout: Layout) -> impl Iterator<Item = String> {
    DECISION_KINDS
        .into_iter()
        .flat_map(move |kind| {
            STAGES
                .into_iter()
                .map(move |(stage, _)| decision_id(layout, kind, stage))
        })
        .chain(
            STRESS_SCENARIOS
                .into_iter()
                .map(move |stress| decision_id(layout, DecisionKind::Action, stress.name)),
        )
}

fn scenario_ids(layout: Layout) -> impl Iterator<Item = String> {
    [
        "prepare",
        "score_all",
        "greedy/first",
        "greedy/middle",
        "greedy/turn",
        "greedy/last",
        "draft/first",
        "draft/middle",
        "full_draft",
    ]
    .into_iter()
    .map(move |stage| placement_id(layout, stage))
    .chain(decision_ids(layout))
    .chain(E2E_MODES.into_iter().map(move |mode| e2e_id(layout, mode)))
    .chain(
        ADVISE_KINDS
            .into_iter()
            .map(move |(kind, _)| advise_id(layout, kind)),
    )
    .chain(
        ANALYZE_ROWS
            .into_iter()
            .filter(move |row| row.0 == layout)
            .map(move |(_, kind, ..)| analyze_id(layout, kind)),
    )
}

fn matches_filter(request: &BenchRequest<'_>, id: &str) -> bool {
    request.filter.is_none_or(|filter| id.contains(filter))
}

#[derive(Clone, Copy)]
struct Fingerprint(u64);

impl Fingerprint {
    fn bytes(&mut self, bytes: &[u8]) {
        self.0 = mix64(self.0 ^ bytes.len() as u64);
        for byte in bytes {
            self.0 = mix64(self.0 ^ u64::from(*byte));
        }
    }

    fn value(&mut self, value: &impl Serialize) {
        self.bytes(&serde_json::to_vec(value).expect("benchmark inputs are serializable"));
    }
}

fn scenario_seed(id: &str) -> u64 {
    let mut hash = Fingerprint(PERF_SEED);
    hash.bytes(id.as_bytes());
    hash.0
}

// Prepared candidate scorers and candidate scratch are deliberately excluded: changing an
// arm must change its choices without changing the reference position it is measured on.
fn board_hash(board: &SimBoard, topology: &Topology) -> Fingerprint {
    let mut hash = Fingerprint(PERF_SEED);
    hash.value(&(
        board.layout(),
        board.seats(),
        board.tiles(),
        board.tokens(),
        board.robber(),
        board.player_ids(),
    ));
    hash.value(
        &board
            .ports()
            .iter()
            .map(|port| (port.edge, port.resource, port.rate))
            .collect::<Vec<_>>(),
    );
    hash.value(
        &board
            .roads()
            .iter()
            .map(|road| (road.edge, road.seat))
            .collect::<Vec<_>>(),
    );
    hash.value(
        &board
            .buildings()
            .iter()
            .map(|building| (building.vertex, building.seat, building.tier))
            .collect::<Vec<_>>(),
    );
    for hex in 0..topology.hex_count() as u8 {
        hash.value(&(
            topology.hex_key(hex),
            topology.hex_vertices(hex),
            topology.hex_edges(hex),
            topology.hex_neighbors(hex),
        ));
    }
    for vertex in 0..topology.vertex_count() as u8 {
        hash.value(&(
            topology.vertex_id(vertex),
            topology.vertex_hexes(vertex),
            topology.vertex_edges(vertex),
            topology.vertex_adjacent(vertex),
        ));
    }
    for edge in 0..topology.edge_count() as u8 {
        hash.value(&(
            topology.edge_id(edge),
            topology.edge_endpoints(edge),
            topology.edge_neighbors(edge),
        ));
    }
    hash.value(&(
        topology.coastal_edges(),
        topology.default_port_edges(),
        topology.resource_counts(),
        topology.token_counts(),
    ));
    hash
}

// The caller reads the clock so instruction profiles collect only calls and loop overhead.
#[inline(never)]
fn timed_pass<T>(calls: usize, mut call: impl FnMut() -> T) -> T {
    let first = black_box(call());
    for _ in 1..calls {
        black_box(call());
    }
    first
}

fn measure<C, T>(
    request: &BenchRequest<'_>,
    id: &str,
    state: Fingerprint,
    mut setup: impl FnMut(usize) -> C,
    mut call: impl FnMut(&mut C, &mut Xoshiro256StarStar) -> T,
    mut fold: impl FnMut(&mut Fingerprint, T, &C),
) -> Outcome {
    let seed = scenario_seed(id);
    let mut hash = Fingerprint(seed);
    let mut first_pass = true;
    let mut run_pass = |calls| {
        let mut context = setup(calls);
        let mut rng = Xoshiro256StarStar::from_seed(seed);
        let start = Instant::now();
        let first = timed_pass(calls, || call(black_box(&mut context), black_box(&mut rng)));
        let elapsed = start.elapsed();
        if first_pass {
            fold(&mut hash, first, &context);
            first_pass = false;
        }
        elapsed
    };
    let mut calls = request.calls.unwrap_or(1);
    if !request.quick {
        // The last calibration pass also serves as warm-up.
        loop {
            let elapsed = run_pass(calls);
            if request.calls.is_some()
                || elapsed >= request.min_pass
                || calls == MAX_CALIBRATION_CALLS
            {
                break;
            }
            calls *= 2;
        }
    }
    let times = (0..request.repeats)
        .map(|_| run_pass(calls).as_nanos() as f64 / calls as f64)
        .collect();
    Outcome::Measured {
        measurement: measurement(calls, times, state, hash),
        games_per_second: None,
    }
}

fn measurement(
    calls: usize,
    mut times: Vec<f64>,
    state: Fingerprint,
    decision: Fingerprint,
) -> Measurement {
    times.sort_by(f64::total_cmp);
    let middle = times.len() / 2;
    let median = if times.len().is_multiple_of(2) {
        (times[middle - 1] + times[middle]) / 2.0
    } else {
        times[middle]
    };
    Measurement {
        calls,
        repeats: times.len(),
        ns_per_call_min: times[0],
        ns_per_call_median: median,
        state_hash: format!("{:016x}", state.0),
        decision_hash: format!("{:016x}", decision.0),
    }
}

#[derive(Clone)]
struct DraftPosition {
    vertices: [u8; MAX_VERTICES],
    edges: [u8; MAX_EDGES],
}

impl DraftPosition {
    fn apply(&mut self, pick: Option<(u8, u8)>, seat: u8) {
        let (vertex, edge) = pick.expect("the benchmark draft has legal placements");
        self.vertices[usize::from(vertex)] = seat;
        self.edges[usize::from(edge)] = seat;
    }

    fn choose(
        &self,
        kind: PlacementKind,
        board: &SimBoard,
        topology: &Topology,
        slot: usize,
        rng: &mut Xoshiro256StarStar,
    ) -> Option<(u8, u8)> {
        let seats = board.seats();
        let seat = if slot < seats {
            slot
        } else {
            2 * seats - slot - 1
        } as u8;
        let production = placement::production_pips(board, topology, &self.vertices, None, seat);
        placement::choose(
            black_box(kind),
            black_box(board),
            black_box(topology),
            black_box(&self.vertices),
            black_box(&self.edges),
            seat,
            &production,
            slot >= seats,
            rng,
        )
    }

    fn empty() -> Self {
        Self {
            vertices: [EMPTY; MAX_VERTICES],
            edges: [EMPTY; MAX_EDGES],
        }
    }

    fn fingerprint(&self, board: &SimBoard, topology: &Topology, slot: usize) -> Fingerprint {
        let mut hash = board_hash(board, topology);
        hash.value(&(&self.vertices[..], &self.edges[..], slot));
        hash
    }
}

fn placement_scenarios(
    result: &mut BenchResult,
    request: &BenchRequest<'_>,
    raw: &SimBoard,
    board: &SimBoard,
    topology: &Topology,
    reference: PlacementKind,
) {
    let layout = topology.layout();
    let id = |suffix| placement_id(layout, suffix);
    let empty = DraftPosition::empty();
    let state = empty.fingerprint(board, topology, 0);
    let prepare_id = id("prepare");
    if matches_filter(request, &prepare_id) {
        let outcome = measure(
            request,
            &prepare_id,
            board_hash(raw, topology),
            |calls| (vec![raw.clone(); calls], 0),
            |(boards, cursor), _| {
                let board = &mut boards[*cursor];
                *cursor += 1;
                prepare_app_formula_boards(
                    black_box(std::slice::from_mut(board)),
                    black_box(topology),
                    black_box(&[request.draft]),
                );
                *cursor - 1
            },
            |hash, index, (boards, _)| {
                for vertex in 0..topology.vertex_count() as u8 {
                    hash.value(
                        &placement::setup_candidate_score(
                            request.draft,
                            &boards[index],
                            topology,
                            &empty.vertices,
                            &empty.edges,
                            0,
                            vertex,
                            false,
                        )
                        .to_bits(),
                    );
                }
            },
        );
        result.push(prepare_id, layout, outcome);
    }
    let score_id = id("score_all");
    if matches_filter(request, &score_id) {
        let outcome = measure(
            request,
            &score_id,
            state,
            |_| (),
            |_, _| {
                let mut scores = [0.0_f64; MAX_VERTICES];
                for vertex in 0..topology.vertex_count() as u8 {
                    if can_place_settlement(topology, &empty.vertices, vertex) {
                        scores[usize::from(vertex)] = placement::setup_candidate_score(
                            black_box(request.greedy),
                            black_box(board),
                            black_box(topology),
                            &empty.vertices,
                            &empty.edges,
                            0,
                            vertex,
                            false,
                        );
                    }
                }
                scores
            },
            |hash, scores, _| {
                hash.value(
                    &scores[..topology.vertex_count()]
                        .iter()
                        .map(|score| score.to_bits())
                        .collect::<Vec<_>>(),
                )
            },
        );
        result.push(score_id, layout, outcome);
    }
    let seats = board.seats();
    let order = setup_order(seats);
    let positions = LazyCell::new(|| {
        let mut positions = vec![empty.clone()];
        let mut rng = Xoshiro256StarStar::from_seed(scenario_seed(&id("occupancy")));
        for (slot, seat) in order.iter().enumerate() {
            let mut position = positions.last().unwrap().clone();
            position.apply(
                position.choose(reference, board, topology, slot, &mut rng),
                *seat,
            );
            positions.push(position);
        }
        positions
    });
    for (suffix, slot, kind) in [
        ("greedy/first", 0, request.greedy),
        ("greedy/middle", seats / 2, request.greedy),
        ("greedy/turn", seats, request.greedy),
        ("greedy/last", 2 * seats - 1, request.greedy),
        ("draft/first", 0, request.draft),
        ("draft/middle", seats / 2, request.draft),
    ] {
        let id = id(suffix);
        if !matches_filter(request, &id) {
            continue;
        }
        let position = &positions[slot];
        let seat = order[slot];
        let production =
            placement::production_pips(board, topology, &position.vertices, None, seat);
        let outcome = measure(
            request,
            &id,
            position.fingerprint(board, topology, slot),
            |_| (),
            |_, rng| {
                placement::choose(
                    black_box(kind),
                    black_box(board),
                    black_box(topology),
                    black_box(&position.vertices),
                    black_box(&position.edges),
                    black_box(seat),
                    black_box(&production),
                    black_box(slot >= seats),
                    rng,
                )
            },
            |hash, pick, _| hash.value(&pick),
        );
        result.push(id, layout, outcome);
    }
    let full_id = id("full_draft");
    if matches_filter(request, &full_id) {
        let outcome = measure(
            request,
            &full_id,
            state,
            |calls| (vec![DraftPosition::empty(); calls], 0),
            |(positions, cursor), rng| {
                let position = &mut positions[*cursor];
                *cursor += 1;
                let mut picks = [None; MAX_SEATS * 2];
                for (slot, seat) in order.iter().enumerate() {
                    picks[slot] = position.choose(request.draft, board, topology, slot, rng);
                    position.apply(picks[slot], *seat);
                }
                picks
            },
            |hash, picks, _| hash.value(&picks),
        );
        result.push(full_id, layout, outcome);
    }
}

#[derive(Clone, Copy)]
enum DecisionKind {
    PreRoll,
    Action,
    Discard,
    Robber,
    RespondTrade,
    SelectCounterparty,
}

const DECISION_KINDS: [DecisionKind; 6] = [
    DecisionKind::PreRoll,
    DecisionKind::Action,
    DecisionKind::Discard,
    DecisionKind::Robber,
    DecisionKind::RespondTrade,
    DecisionKind::SelectCounterparty,
];

impl DecisionKind {
    fn name(self) -> &'static str {
        match self {
            Self::PreRoll => "pre_roll",
            Self::Action => "action",
            Self::Discard => "discard",
            Self::Robber => "robber",
            Self::RespondTrade => "respond_trade",
            Self::SelectCounterparty => "select_counterparty",
        }
    }

    fn phase(self) -> DecisionPhase {
        match self {
            Self::PreRoll => DecisionPhase::PreRoll,
            Self::RespondTrade | Self::SelectCounterparty => DecisionPhase::TradeResponse,
            _ => DecisionPhase::Action,
        }
    }
}

#[derive(Serialize)]
enum Decision {
    PreRoll(Option<DevPlay>),
    Action(Action),
    Discard([u8; 5]),
    Robber((u8, Option<u8>)),
    RespondTrade(bool),
    SelectCounterparty(usize),
}

struct DecisionInput {
    seat: usize,
    count: u8,
    offer: Option<TradeOffer>,
    acceptors: Vec<usize>,
    delta: [f64; 5],
}

impl DecisionInput {
    fn for_seat(seat: usize) -> Self {
        Self {
            seat,
            count: 0,
            offer: None,
            acceptors: Vec::new(),
            delta: [0.0; 5],
        }
    }
}

fn reference_config() -> GameConfig {
    GameConfig {
        policies: [REFERENCE_POLICY; MAX_SEATS],
        ..GameConfig::default()
    }
}

// Greedy setup keeps reference sampling cheap; placement and e2e time draft-aware setup.
fn reference_game(
    board: &SimBoard,
    topology: &Topology,
    greedy: PlacementKind,
    cap: u16,
    offset: u64,
) -> (GameArena, GameResult) {
    let mut arena = GameArena::default();
    let mut rules = rules(topology.layout());
    rules.turn_cap = cap;
    let result = arena.play(
        board,
        topology,
        &rules,
        &GameConfig {
            placements: [greedy; MAX_SEATS],
            seed: mix64(PERF_SEED ^ offset),
            ..reference_config()
        },
    );
    #[cfg(test)]
    tests::SAMPLES.with_borrow_mut(|samples| {
        samples.push((topology.layout(), cap, offset, result.turns, result.winner))
    });
    (arena, result)
}

fn rules(layout: Layout) -> RuleConfig {
    let mut rules = RuleConfig::base(layout);
    rules.player_trading = Some(TradeConfig::default());
    rules
}

struct DecisionSample {
    arena: GameArena,
    reset: GameArena,
    input: DecisionInput,
}

// A capped round hands the turn to seat 0. Other observers share that turn's counters.
fn normalized_sample(
    kind: DecisionKind,
    arena: &GameArena,
    board: &SimBoard,
    topology: &Topology,
) -> Option<DecisionSample> {
    let mut reset = arena.clone();
    reset.reset_turn_for_test(0);
    let mut normalized = reset.clone();
    if kind.phase() != DecisionPhase::PreRoll
        && normalized.begin_turn_for_test(
            board,
            topology,
            &rules(topology.layout()),
            &reference_config(),
            0,
        )
    {
        return None;
    }
    let input = match kind {
        DecisionKind::RespondTrade | DecisionKind::SelectCounterparty => {
            trade_input(kind, &normalized, board, topology)?
        }
        DecisionKind::Discard => (0..board.seats()).find_map(|seat| {
            let view = normalized.decision_view(board, topology, seat, kind.phase());
            let size = view.hand_total(seat);
            (size > u32::from(view.discard_threshold())).then(|| DecisionInput {
                count: (size / 2) as u8,
                ..DecisionInput::for_seat(seat)
            })
        })?,
        _ => DecisionInput::for_seat(0),
    };
    Some(DecisionSample {
        arena: normalized,
        reset,
        input,
    })
}

fn trade_input(
    kind: DecisionKind,
    arena: &GameArena,
    board: &SimBoard,
    topology: &Topology,
) -> Option<DecisionInput> {
    let proposer = 0;
    let view = arena.decision_view(board, topology, proposer, DecisionPhase::Action);
    if embargoed(&view, proposer) {
        return None;
    }
    let mut rng = Xoshiro256StarStar::from_seed(mix64(PERF_SEED ^ proposer as u64));
    let action = policy::action(
        REFERENCE_POLICY,
        &view,
        &mut PolicyScratch::default(),
        &mut rng,
    );
    let offer = if let Action::OfferTrade { give, get, count } = action {
        TradeOffer {
            proposer,
            give,
            get,
            count,
        }
    } else {
        Resource::ALL.into_iter().find_map(|give| {
            Resource::ALL.into_iter().find_map(|get| {
                view.legal_offer_trade(give, get, 1).then_some(TradeOffer {
                    proposer,
                    give,
                    get,
                    count: 1,
                })
            })
        })?
    };
    let mut eligible = Vec::new();
    let mut accepted = Vec::new();
    for seat in 1..board.seats() {
        let responder = arena.decision_view(board, topology, seat, DecisionPhase::TradeResponse);
        if responder.own_hand()[offer.get.index()] >= 1 && !embargoed(&responder, seat) {
            eligible.push(seat);
            if policy::respond_trade(REFERENCE_POLICY, &responder, offer, &mut rng) {
                accepted.push(seat);
            }
        }
    }
    let responder = *eligible.first()?;
    let acceptors = if accepted.is_empty() {
        eligible
    } else {
        accepted
    };
    Some(DecisionInput {
        seat: if matches!(kind, DecisionKind::RespondTrade) {
            responder
        } else {
            proposer
        },
        count: 0,
        offer: Some(offer),
        delta: policy::trading::responder_delta(offer),
        acceptors,
    })
}

fn view_hash(view: &DecisionView<'_>) -> Fingerprint {
    let mut hash = board_hash(view.board(), view.topology());
    hash.value(&match view.phase() {
        DecisionPhase::PreRoll => 0_u8,
        DecisionPhase::Action => 1,
        DecisionPhase::SpecialBuild => 2,
        DecisionPhase::TradeResponse => 3,
    });
    hash.value(&(
        view.observer(),
        view.own_hand(),
        view.own_playable_dev(),
        view.own_bought_dev(),
        view.own_total_vp(),
    ));
    hash.value(&(
        view.dev_deck_remaining(),
        view.offers_remaining_this_turn(),
        view.robber(),
        view.largest_army_holder(),
        view.longest_road_holder(),
    ));
    hash.value(&std::array::from_fn::<_, 5, _>(|kind| {
        view.can_play_dev(kind)
    }));
    for seat in 0..view.seats() {
        hash.value(&(
            view.hand_total(seat),
            view.public_vp(seat),
            view.dev_count(seat),
            view.dev_plays_revealed(seat),
            view.knights_played(seat),
            view.longest_road_len(seat),
        ));
        hash.value(&(
            view.belief().total(seat),
            view.belief().lo(seat),
            view.belief().hi(seat),
        ));
        hash.value(&Buildable::ALL.map(|buildable| view.pieces(seat, buildable)));
        let rules = view.rules_for(seat);
        for buildable in Buildable::ALL {
            hash.value(&(
                rules.costs(buildable),
                rules.limit(buildable),
                rules.vp(buildable),
                rules.yield_multiplier(buildable),
            ));
        }
        hash.value(&(
            rules.dev_cost(),
            rules.dev_victory_points(),
            rules.dev_deck_initial(),
            rules.discard_threshold(),
            rules.win_vp(),
        ));
        hash.value(&(
            rules.longest_road_min(),
            rules.longest_road_vp(),
            rules.largest_army_min(),
            rules.largest_army_vp(),
        ));
        hash.value(&rules.trade_config().map(|trade| {
            (
                trade.opponent_gain_weight.to_bits(),
                trade.acceptance_temperature.to_bits(),
                trade.max_offers_per_turn,
                trade.hidden_vp_confidence.to_bits(),
                trade.embargo_danger_floor.to_bits(),
                trade.embargo_danger.to_bits(),
                trade.embargo_takeover_danger.to_bits(),
            )
        }));
        for resource in Resource::ALL {
            hash.value(&rules.trade_rate(resource));

            // The private port rule is observable only through prospective rates.
            for port in view.ports() {
                hash.value(&rules.prospective_trade_rate(
                    OwnedPort {
                        resource: port.resource,
                        rate: port.rate,
                    },
                    resource,
                ));
            }
        }
    }
    hash.value(&Resource::ALL.map(|resource| view.bank(resource)));
    for vertex in 0..view.topology().vertex_count() as u8 {
        hash.value(&(view.vertex_owner(vertex), view.vertex_tier(vertex)));
    }
    for edge in 0..view.topology().edge_count() as u8 {
        hash.value(&view.edge_owner(edge));
    }
    hash
}

struct ReferenceSamples<'a> {
    board: &'a SimBoard,
    topology: &'a Topology,
    greedy: PlacementKind,

    // A filtered stage needs only its length-finding game and one replay.
    lengths: Vec<(u64, u16)>,
    games: Vec<(u16, u64, GameArena)>,
}

impl<'a> ReferenceSamples<'a> {
    fn new(board: &'a SimBoard, topology: &'a Topology, greedy: PlacementKind) -> Self {
        Self {
            board,
            topology,
            greedy,
            lengths: Vec::new(),
            games: Vec::new(),
        }
    }

    fn first_usable(&mut self, kind: DecisionKind, fraction: (u16, u16)) -> Option<DecisionSample> {
        let (board, topology) = (self.board, self.topology);
        SEARCH_SEED_OFFSETS.into_iter().find_map(|offset| {
            let cap = self.stage_cap(fraction, offset);
            normalized_sample(kind, self.get(cap, offset), board, topology)
        })
    }

    fn stage_cap(&mut self, (numerator, denominator): (u16, u16), offset: u64) -> u16 {
        let turns = match self.lengths.iter().find(|(seed, _)| *seed == offset) {
            Some((_, turns)) => *turns,
            None => {
                let (_, result) = reference_game(
                    self.board,
                    self.topology,
                    self.greedy,
                    rules(self.topology.layout()).turn_cap,
                    offset,
                );
                self.lengths.push((offset, result.turns));
                result.turns
            }
        };
        let cap = (u32::from(turns) * u32::from(numerator)
            / (u32::from(denominator) * self.board.seats() as u32)) as u16;
        assert!(
            cap > 0 && u32::from(cap) * (self.board.seats() as u32) < u32::from(turns),
            "reference length {turns} cannot supply a live stage at {numerator}/{denominator}, seed offset {offset}"
        );
        cap
    }

    fn get(&mut self, cap: u16, offset: u64) -> &GameArena {
        let index = self
            .games
            .iter()
            .position(|sample| sample.0 == cap && sample.1 == offset)
            .unwrap_or_else(|| {
                let (arena, result) =
                    reference_game(self.board, self.topology, self.greedy, cap, offset);
                assert!(
                    result.winner.is_none(),
                    "reference sample ended at cap {cap}, seed offset {offset}"
                );
                self.games.push((cap, offset, arena));
                self.games.len() - 1
            });
        &self.games[index].2
    }
}

fn decision_scenarios(
    result: &mut BenchResult,
    request: &BenchRequest<'_>,
    board: &SimBoard,
    topology: &Topology,
    reference_greedy: PlacementKind,
) {
    let layout = topology.layout();
    let mut samples = ReferenceSamples::new(board, topology, reference_greedy);
    for kind in DECISION_KINDS {
        for (stage, fraction) in STAGES {
            let id = decision_id(layout, kind, stage);
            if !matches_filter(request, &id) {
                continue;
            }
            let outcome = match samples.first_usable(kind, fraction) {
                Some(sample) => measure_decision(request, &id, kind, &sample, board, topology),
                None => Outcome::Skipped {
                    reason: format!(
                        "no legal {} at {}/{} of reference length, seed offsets {SEARCH_SEED_OFFSETS:?}",
                        kind.name(),
                        fraction.0,
                        fraction.1
                    ),
                },
            };
            result.push(id, layout, outcome);
        }
    }

    stress_scenarios(result, request, &mut samples);
}

fn stress_scenarios(
    result: &mut BenchResult,
    request: &BenchRequest<'_>,
    samples: &mut ReferenceSamples<'_>,
) {
    let board = samples.board;
    let topology = samples.topology;
    let layout = topology.layout();
    if !STRESS_SCENARIOS.iter().any(|stress| {
        matches_filter(
            request,
            &decision_id(layout, DecisionKind::Action, stress.name),
        )
    }) {
        return;
    }
    let mut pool = Vec::new();
    for offset in SEARCH_SEED_OFFSETS {
        for (stage, fraction) in STAGES {
            let cap = samples.stage_cap(fraction, offset);
            if let Some(sample) = normalized_sample(
                DecisionKind::Action,
                samples.get(cap, offset),
                board,
                topology,
            ) {
                let hash = action_hash(&sample, board, topology);
                pool.push((stage, cap, offset, sample, hash));
            }
        }
    }
    let mut excluded: Vec<_> = STAGES
        .into_iter()
        .filter_map(|(stage, _)| {
            pool.iter()
                .find(|(candidate_stage, ..)| *candidate_stage == stage)
                .map(|(_, _, _, _, hash)| *hash)
        })
        .collect();

    // Both searches use the same pool even under a filter; their selected positions must differ.
    for stress in STRESS_SCENARIOS {
        let name = stress.name;
        let id = decision_id(layout, DecisionKind::Action, name);
        let mut best = None;
        let mut best_score = 0;
        for (_, cap, offset, sample, hash) in &pool {
            let score = (stress.score)(&sample.arena.state.players[0]);
            if score > best_score && !excluded.contains(hash) {
                best = Some((sample, *cap, *offset, *hash));
                best_score = score;
            }
        }
        let minimum = (stress.minimum)(&rules(layout));
        if best_score < minimum {
            if matches_filter(request, &id) {
                result.push(id, layout, Outcome::Skipped { reason: format!("best {name} score {best_score} is below required {minimum}, seed offsets {SEARCH_SEED_OFFSETS:?}") });
            }
            continue;
        }
        let (sample, _cap, _offset, hash) = best.unwrap();
        excluded.push(hash);
        #[cfg(test)]
        tests::STRESS
            .with_borrow_mut(|samples| samples.push((layout, name, _offset, _cap, best_score)));
        if matches_filter(request, &id) {
            let outcome =
                measure_decision(request, &id, DecisionKind::Action, sample, board, topology);
            result.push(id, layout, outcome);
        }
    }
}

fn action_hash(sample: &DecisionSample, board: &SimBoard, topology: &Topology) -> u64 {
    view_hash(
        &sample
            .arena
            .decision_view(board, topology, 0, DecisionPhase::Action),
    )
    .0
}

fn measure_decision(
    request: &BenchRequest<'_>,
    id: &str,
    kind: DecisionKind,
    sample: &DecisionSample,
    board: &SimBoard,
    topology: &Topology,
) -> Outcome {
    let DecisionSample {
        arena,
        reset,
        input,
    } = sample;
    let mut state = view_hash(&arena.decision_view(board, topology, input.seat, kind.phase()));
    state.value(&(
        input.count,
        input.offer,
        &input.acceptors,
        input.delta.map(f64::to_bits),
    ));
    // A discarding seat holds the goal of its last pre-roll, and a pre-roll that plays a knight
    // returns before it records one. No sample can replay that earlier turn, so the goal comes
    // from the seat's pre-roll once the reference has played its own: with the knight gone the
    // goal is written, where a cold scratch would send discard down its first-turn fallback.
    let mut primer = reset.clone();
    if matches!(kind, DecisionKind::Discard) {
        primer.begin_turn_for_test(
            board,
            topology,
            &rules(topology.layout()),
            &reference_config(),
            input.seat,
        );
    }
    measure(
        request,
        id,
        state,
        |calls| {
            let mut scratch = PolicyScratch::default();

            // GameArena::run_pre_roll sets the goal carried into action and discard.
            // Pre-roll overwrites that goal itself; robber and trade take no scratch.
            if matches!(kind, DecisionKind::Action | DecisionKind::Discard) {
                let view =
                    primer.decision_view(board, topology, input.seat, DecisionPhase::PreRoll);
                #[cfg(test)]
                tests::PRIMING.with_borrow_mut(|views| views.push(view_hash(&view).0));
                let mut rng = Xoshiro256StarStar::from_seed(scenario_seed(id));
                policy::pre_roll(request.policy, &view, &mut scratch, &mut rng);
            }
            // Arena callers construct a view per decision, so legality caches start cold
            // even though the seat's scratch is reused across calls within a pass.
            let views: Vec<_> = (0..calls)
                .map(|_| arena.decision_view(board, topology, input.seat, kind.phase()))
                .collect();
            (views, 0, scratch)
        },
        |(views, cursor, scratch), rng| {
            let view = black_box(&views[*cursor]);
            *cursor += 1;
            let policy = black_box(request.policy);
            #[cfg(test)]
            tests::DECISIONS.with_borrow_mut(|calls| {
                calls.push(tests::DecisionCall {
                    policy,
                    seat: view.observer(),
                    phase: view.phase(),
                    goal: scratch.goal,
                    rng: rng.clone().next_u64(),
                })
            });
            match kind {
                DecisionKind::PreRoll => {
                    Decision::PreRoll(policy::pre_roll(policy, view, scratch, rng))
                }
                DecisionKind::Action => {
                    Decision::Action(policy::action(policy, view, scratch, rng))
                }
                DecisionKind::Discard => Decision::Discard(policy::discard(
                    policy,
                    view,
                    black_box(input.count),
                    scratch,
                    rng,
                )),
                DecisionKind::Robber => Decision::Robber(policy::robber(policy, view, rng)),
                DecisionKind::RespondTrade => Decision::RespondTrade(policy::respond_trade(
                    policy,
                    view,
                    black_box(input.offer.unwrap()),
                    rng,
                )),
                DecisionKind::SelectCounterparty => {
                    Decision::SelectCounterparty(policy::select_counterparty(
                        policy,
                        view,
                        black_box(&input.delta),
                        black_box(&input.acceptors),
                    ))
                }
            }
        },
        |hash, decision, _| hash.value(&decision),
    )
}

fn e2e_scenarios(
    result: &mut BenchResult,
    request: &BenchRequest<'_>,
    board: &SimBoard,
    topology: &Topology,
) -> Result<(), String> {
    let layout = topology.layout();
    if !E2E_MODES
        .into_iter()
        .any(|mode| matches_filter(request, &e2e_id(layout, mode)))
    {
        return Ok(());
    }
    let rules = rules(layout);
    let seed = scenario_seed(&format!("e2e/{}", layout.as_str()));
    let configs: Vec<_> = (0..request.games)
        .map(|index| GameConfig {
            placements: [request.draft; MAX_SEATS],
            policies: [request.policy; MAX_SEATS],
            seed: mix64(seed ^ index as u64),
            ..GameConfig::default()
        })
        .collect();
    let mut state = board_hash(board, topology);
    state.value(&rules);
    for mode in E2E_MODES {
        let id = e2e_id(layout, mode);
        if !matches_filter(request, &id) {
            continue;
        }
        let mut hash = Fingerprint(seed);
        let pool = if mode == "all_cores" {
            Some(
                rayon::ThreadPoolBuilder::new()
                    .num_threads(evaluation_workers(request.threads))
                    .build()
                    .map_err(|error| error.to_string())?,
            )
        } else {
            None
        };
        let mut times = Vec::with_capacity(request.repeats);
        for pass in 0..request.repeats {
            let mut arena = GameArena::default();
            let mut results = vec![None; request.games];

            #[cfg(test)]
            tests::E2E_PASSES.with_borrow_mut(|passes| passes.push((id.clone(), request.games)));

            // Per-game scheduling keeps uneven batches busy; indexed slots retain schedule order.
            let start = Instant::now();
            let first = timed_pass(1, || {
                if let Some(pool) = &pool {
                    pool.install(|| {
                        configs
                            .par_iter()
                            .zip(results.par_iter_mut())
                            .for_each_init(GameArena::default, |arena, (config, result)| {
                                *result = Some(black_box(arena.play(
                                    black_box(board),
                                    black_box(topology),
                                    black_box(&rules),
                                    black_box(config),
                                )));
                            });
                    });
                } else {
                    for (config, result) in configs.iter().zip(&mut results) {
                        *result = Some(black_box(arena.play(
                            black_box(board),
                            black_box(topology),
                            black_box(&rules),
                            black_box(config),
                        )));
                    }
                }
                std::array::from_fn::<_, 1, _>(|index| results[index].unwrap())
            });
            let elapsed = start.elapsed();
            if pass == 0 {
                hash.value(&first);
            }
            times.push(elapsed.as_nanos() as f64 / request.games as f64);
        }
        let measurement = measurement(request.games, times, state, hash);
        let games_per_second = Some(1e9 / measurement.ns_per_call_median);
        result.push(
            id,
            layout,
            Outcome::Measured {
                measurement,
                games_per_second,
            },
        );
    }
    Ok(())
}

fn advice_request(fixture: &Value, name: &str) -> Result<String, String> {
    fixture
        .get("cases")
        .and_then(Value::as_array)
        .and_then(|cases| cases.iter().find(|case| case["name"] == name))
        .and_then(|case| case.get("request"))
        .map(Value::to_string)
        .ok_or_else(|| format!("bench advice fixture is missing case {name}"))
}

fn advise_scenarios(
    result: &mut BenchResult,
    request: &BenchRequest<'_>,
    layout: Layout,
    fixture: &OnceCell<Result<Value, String>>,
) -> Result<(), String> {
    // These cases pin four and six seats without depending on a candidate or the working directory.
    let prefix = match layout {
        Layout::Standard4 => "standard4-11",
        Layout::Extension6 => "extension6-23",
    };
    for (kind, fixture_kind) in ADVISE_KINDS {
        let id = advise_id(layout, kind);
        if !matches_filter(request, &id) {
            continue;
        }
        let fixture = fixture
            .get_or_init(|| {
                #[cfg(test)]
                tests::ADVICE_PARSES.set(tests::ADVICE_PARSES.get() + 1);
                serde_json::from_str(include_str!("../../../fixtures/advice-parity.json"))
                    .map_err(|error| format!("invalid bench advice fixture: {error}"))
            })
            .as_ref()
            .map_err(Clone::clone)?;
        let request_text = advice_request(fixture, &format!("{prefix}-{fixture_kind}"))?;
        let mut state = Fingerprint(PERF_SEED);
        state.bytes(request_text.as_bytes());
        let mut response = String::new();
        let outcome = measure(
            request,
            &id,
            state,
            |_| (),
            |_, _| advise(black_box(&request_text)),
            |hash, first, _| {
                hash.bytes(first.as_bytes());
                response = first;
            },
        );
        let value: Value = serde_json::from_str(&response)
            .map_err(|error| format!("{id}: invalid advice response: {error}"))?;
        if let Some(error) = value.get("error") {
            return Err(format!("{id}: advice failed: {error}"));
        }
        result.push(id, layout, outcome);
    }
    Ok(())
}

// The request the app's worker sends for a corpus board: the board alone, without the case's test
// options, so the ranking runs its default rollouts.
fn analysis_request(fixture: &Value, name: &str, me: Option<&str>) -> Result<String, String> {
    let mut board = fixture
        .get("cases")
        .and_then(Value::as_array)
        .and_then(|cases| cases.iter().find(|case| case["name"] == name))
        .map(|case| case["request"]["board"].clone())
        .ok_or_else(|| format!("bench analysis fixture is missing case {name}"))?;
    if let Some(me) = me {
        board["mePlayerId"] = me.into();
    }
    Ok(serde_json::json!({ "board": board }).to_string())
}

fn analyze_scenarios(
    result: &mut BenchResult,
    request: &BenchRequest<'_>,
    layout: Layout,
) -> Result<(), String> {
    let fixture = LazyCell::new(|| {
        serde_json::from_str::<Value>(include_str!("../../../fixtures/analysis-parity.json"))
            .map_err(|error| format!("invalid bench analysis fixture: {error}"))
    });
    for (row_layout, kind, case, me) in ANALYZE_ROWS {
        let id = analyze_id(layout, kind);
        if row_layout != layout || !matches_filter(request, &id) {
            continue;
        }
        let request_text = analysis_request(fixture.as_ref().map_err(Clone::clone)?, case, me)?;
        let mut state = Fingerprint(PERF_SEED);
        state.bytes(request_text.as_bytes());
        let mut response = String::new();
        let outcome = measure(
            request,
            &id,
            state,
            |_| (),
            // Every call ranks the seats ahead afresh: with the rankings the last call cached,
            // `behind_three` would time three lookups from its second call on.
            |_, _| {
                forget_nested_rankings();
                analyze(black_box(&request_text), &mut |_| {})
            },
            |hash, first, _| {
                hash.bytes(first.as_bytes());
                response = first;
            },
        );
        let value: Value = serde_json::from_str(&response)
            .map_err(|error| format!("{id}: invalid analysis response: {error}"))?;
        if value["status"] != "ready" {
            return Err(format!("{id}: analysis ranked nothing: {response}"));
        }
        result.push(id, layout, outcome);
    }
    Ok(())
}

#[cfg(test)]
#[path = "../tests/bench/unit.rs"]
mod tests;
