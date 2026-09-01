use std::fs;
use std::path::Path;

use rayon::prelude::*;
use serde::Serialize;
use unsettled_engine::game::{GameArena, GameConfig, SetupPick};
use unsettled_engine::placement::{PlacementKind, prepare_app_formula_boards};
use unsettled_engine::policy::PolicyKind;
use unsettled_engine::rng::{derive_evaluation_seed, mix64};
use unsettled_engine::rules::{RuleConfig, TradeConfig};
use unsettled_engine::topology::{Layout, Topology};

use crate::boardgen::generate_board;
use crate::coastal::{
    CoastalPick, CoastalSelection, PickComparison, coastal_selection, game_comparisons,
};
use crate::evaluate::{EvaluationDomain, EvaluationUnit, evaluation_schedule, evaluation_workers};
use crate::expansion::{ExpansionReading, PairOutcome, PairReading, expansion_reading, game_pairs};
use crate::output::Meta;
use crate::stats::normal_quantile;

/// A diagnostic has no hero seat: every seat plays `--placement` and `--policy`, so there is no
/// arm to rotate and no rotation coordinate to vary. The evaluation seed derivation still takes
/// one, and pinning it here to slot 0 is what makes a diagnostic run reproducible: the boards come
/// from the domain seed exactly as `evaluate` generates them, and each diagnostic game is seeded
/// like the `hero_seat == 0` unit of an `evaluate` run at the same domain, layout and seat count.
const DIAGNOSTIC_HERO_SEAT: usize = 0;

pub struct DiagnoseRequest<'a> {
    pub layout: Layout,
    pub seats: usize,
    pub domain: EvaluationDomain,
    pub placement_spec: &'a str,
    pub placement: PlacementKind,
    pub boards: usize,
    pub reps: usize,
    pub policy: PolicyKind,
    pub policy_name: &'a str,
    pub player_trading: Option<TradeConfig>,
    pub alpha: f64,
    pub threads: usize,
    pub allow_unofficial: bool,
}

/// One game's observation: where in the schedule it was played, the setup picks every seat made,
/// how each pick compared with its pip-matched runner-up, what each completed pair looked like,
/// and how the game ended. The SP0 statistics are read off these records.
#[derive(Clone, Debug)]
pub struct GameObservation {
    pub unit: EvaluationUnit,
    pub picks: Vec<SetupPick>,
    /// One entry per pick, in pick order. Computed per game so the aggregation stays serial.
    pub comparisons: Vec<PickComparison>,
    /// One entry per seat that completed a pair, in the order the pairs completed.
    pub pairs: Vec<PairReading>,
    pub winner: Option<u8>,
    pub draw: bool,
    pub illegal_actions: u32,
}

/// Per-worker scratch, reused across games so the parallel map allocates once per worker rather
/// than once per game.
#[derive(Default)]
struct Scratch {
    arena: GameArena,
    trace: Vec<SetupPick>,
    vertex_owner: Vec<u8>,
    edge_owner: Vec<u8>,
    comparisons: Vec<PickComparison>,
    pairs: Vec<PairReading>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsConfig {
    pub domain: String,
    pub domain_seed: u64,
    pub layout: String,
    pub seats: usize,
    pub placement: String,
    pub placement_heuristic: String,
    pub policy: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub player_trading: Option<TradeConfig>,
    pub boards: usize,
    pub reps: usize,
    pub games: usize,
    pub alpha: f64,
    pub z: f64,
    pub allow_unofficial: bool,
}

/// What the run actually observed, as counts. The SP0 statistics computed from the same
/// observations join this block; these counts are what says how much evidence they rest on.
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObservationCounts {
    pub games: usize,
    pub setup_picks: usize,
    pub decided_games: usize,
    pub drawn_games: usize,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostics {
    pub config: DiagnosticsConfig,
    pub observations: ObservationCounts,
    pub coastal_selection: CoastalSelection,
    pub expansion: ExpansionReading,
    pub illegal_actions: u64,
}

pub fn diagnose(request: DiagnoseRequest<'_>) -> Result<Diagnostics, String> {
    validate_request(&request)?;
    let topology = Topology::load(request.layout)?;
    let games = request
        .boards
        .checked_mul(request.reps)
        .ok_or_else(|| "diagnostic game count overflow".to_string())?;
    let domain_seed = request.domain.seed();
    let mut boards = (0..request.boards)
        .map(|board_index| {
            generate_board(
                request.layout,
                request.seats,
                mix64(domain_seed ^ board_index as u64),
            )
        })
        .collect::<Result<Vec<_>, _>>()?;
    prepare_app_formula_boards(&mut boards, &topology, &[request.placement]);

    // One unit per (board, rep) in board-major order: an evaluation schedule over a single
    // rotation, which is the pinned hero-seat slot.
    let schedule = evaluation_schedule(request.boards, request.reps, 1);
    if schedule.len() != games
        || schedule
            .iter()
            .any(|unit| unit.hero_seat != DIAGNOSTIC_HERO_SEAT)
    {
        return Err(format!(
            "diagnostic schedule integrity error: expected {games} games at hero seat {DIAGNOSTIC_HERO_SEAT}, collected {}",
            schedule.len()
        ));
    }
    let workers = evaluation_workers(request.threads);
    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(workers)
        .build()
        .map_err(|error| error.to_string())?;
    let mut rules = RuleConfig::base(request.layout);
    rules.player_trading = request.player_trading;
    let observations: Vec<GameObservation> = pool.install(|| {
        schedule
            .par_iter()
            .map_init(Scratch::default, |scratch, unit| {
                scratch.trace.clear();
                let mut config = GameConfig::default();
                for seat in 0..request.seats {
                    config.placements[seat] = request.placement;
                    config.policies[seat] = request.policy;
                }
                config.seed = derive_evaluation_seed(
                    domain_seed,
                    unit.board as u64,
                    unit.rep as u64,
                    DIAGNOSTIC_HERO_SEAT as u64,
                );
                let board = &boards[unit.board];
                let result = scratch.arena.play_traced(
                    board,
                    &topology,
                    &rules,
                    &config,
                    &mut scratch.trace,
                );
                game_comparisons(
                    board,
                    &topology,
                    request.placement,
                    &scratch.trace,
                    &mut scratch.vertex_owner,
                    &mut scratch.comparisons,
                );
                game_pairs(
                    board,
                    &topology,
                    &scratch.trace,
                    &mut scratch.vertex_owner,
                    &mut scratch.edge_owner,
                    &mut scratch.pairs,
                );
                GameObservation {
                    unit: *unit,
                    picks: scratch.trace.clone(),
                    comparisons: scratch.comparisons.clone(),
                    pairs: scratch.pairs.clone(),
                    winner: result.winner,
                    draw: result.draw,
                    illegal_actions: result.illegal_actions,
                }
            })
            .collect()
    });
    if observations.len() != games {
        return Err(format!(
            "diagnostic schedule integrity error: expected {games} observations, collected {}",
            observations.len()
        ));
    }

    // Serial aggregation through the schedule order, so no count depends on which worker
    // finished first.
    let mut counts = ObservationCounts::default();
    let mut illegal_actions = 0_u64;
    let mut coastal_picks = Vec::with_capacity(games * 2 * request.seats);
    let mut expansion_pairs = Vec::with_capacity(games * request.seats);
    for (unit, observation) in schedule.iter().zip(&observations) {
        if observation.unit != *unit {
            return Err(
                "diagnostic schedule integrity error: observations are out of schedule order"
                    .into(),
            );
        }
        if observation.comparisons.len() != observation.picks.len() {
            return Err("diagnostic integrity error: a pick is missing its comparison".into());
        }
        counts.games += 1;
        counts.setup_picks += observation.picks.len();
        if observation.winner.is_some() {
            counts.decided_games += 1;
        }
        if observation.draw {
            counts.drawn_games += 1;
        }
        illegal_actions += u64::from(observation.illegal_actions);
        for (pick, comparison) in observation.picks.iter().zip(&observation.comparisons) {
            coastal_picks.push(CoastalPick {
                board: observation.unit.board,
                seat: pick.seat,
                comparison: *comparison,
                seat_won: observation.winner == Some(pick.seat),
            });
        }
        for reading in &observation.pairs {
            expansion_pairs.push(PairOutcome {
                reading: *reading,
                seat_won: observation.winner == Some(reading.seat),
            });
        }
    }
    let z = normal_quantile(1.0 - request.alpha / 2.0);

    Ok(Diagnostics {
        config: DiagnosticsConfig {
            domain: request.domain.name().to_string(),
            domain_seed,
            layout: request.layout.as_str().to_string(),
            seats: request.seats,
            placement: request.placement_spec.to_string(),
            placement_heuristic: request.placement.name().to_string(),
            policy: request.policy_name.to_string(),
            player_trading: request.player_trading,
            boards: request.boards,
            reps: request.reps,
            games,
            alpha: request.alpha,
            z,
            allow_unofficial: request.allow_unofficial,
        },
        observations: counts,
        coastal_selection: coastal_selection(&coastal_picks, request.seats, request.boards, z),
        expansion: expansion_reading(&expansion_pairs, request.seats),
        illegal_actions,
    })
}

pub fn write_diagnostic_outputs(
    directory: &Path,
    diagnostics: &Diagnostics,
    meta: &Meta,
) -> Result<(), String> {
    fs::create_dir_all(directory).map_err(|error| error.to_string())?;
    let diagnostics_json =
        serde_json::to_vec_pretty(diagnostics).map_err(|error| error.to_string())?;
    fs::write(
        directory.join("diagnostics.json"),
        [diagnostics_json.as_slice(), b"\n"].concat(),
    )
    .map_err(|error| error.to_string())?;
    let meta_json = serde_json::to_vec_pretty(meta).map_err(|error| error.to_string())?;
    fs::write(
        directory.join("meta.json"),
        [meta_json.as_slice(), b"\n"].concat(),
    )
    .map_err(|error| error.to_string())
}

fn validate_request(request: &DiagnoseRequest<'_>) -> Result<(), String> {
    if request.boards == 0 {
        return Err("boards must be positive".into());
    }
    if request.reps == 0 {
        return Err("reps must be positive".into());
    }
    let official = match request.layout {
        Layout::Standard4 => (3..=4).contains(&request.seats),
        Layout::Extension6 => (5..=6).contains(&request.seats),
    };
    if !official && !request.allow_unofficial {
        return Err("non-official layout and seat combinations require --allow-unofficial".into());
    }
    if !(2..=6).contains(&request.seats) {
        return Err("seat count must be between 2 and 6".into());
    }
    if !request.alpha.is_finite() || request.alpha <= 0.0 || request.alpha >= 1.0 {
        return Err("alpha must be greater than 0 and less than 1".into());
    }
    Ok(())
}
