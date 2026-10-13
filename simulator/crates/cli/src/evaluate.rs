use std::collections::BTreeMap;
use std::fs;
use std::num::NonZero;
use std::ops::Range;
use std::path::Path;
use std::process::Command;

use rayon::prelude::*;
use serde::Serialize;
use unsettled_engine::board::SimBoard;
use unsettled_engine::game::{GameArena, GameConfig, setup_order};
use unsettled_engine::placement::{PlacementKind, prepare_app_formula_boards};
use unsettled_engine::policy::PolicyKind;
use unsettled_engine::rng::{derive_evaluation_seed, mix64};
use unsettled_engine::rules::{RuleConfig, TradeConfig};
use unsettled_engine::topology::{Edge, Layout, Topology, Vertex};

use crate::boardgen::generate_board;
use crate::output::Meta;
use crate::stats::{alpha_z, wilson};

pub const EVALUATION_CHUNK_BOARDS: usize = 1_000;

pub const TUNING_SEED: u64 = 0x7a11_1e5e_ed20_2607;
pub const EVAL_SEED: u64 = 0xe7a1_5eed_2026_0724;
/// Third domain, held for the final adoption gate and spent there by M-46. A domain
/// cannot be un-spent: once a parameter has been screened against it, its estimate for
/// *that* parameter is no longer unbiased. The spend ledger is in `programme.md` under
/// "Seed-domain discipline".
pub const GATE_SEED: u64 = 0x6a7e_5eed_2026_0725;

/// Second-generation domains, minted for the placement programme's SP6 phase because
/// the first three are all spent: `tuning` screened SP1 through SP5, `eval` confirmed
/// twice and `gate` decided the Phase-I adoption. SP6 changes the field to the
/// draft-aware kind, which re-opens every question on seeds no parameter has seen.
/// Same recipe as the three above: a readable tag and the date the domain was minted.
pub const TUNING2_SEED: u64 = 0x7a12_5eed_2026_0902;
pub const EVAL2_SEED: u64 = 0xe7a2_5eed_2026_0902;
pub const GATE2_SEED: u64 = 0x6a72_5eed_2026_0902;

/// Third-generation domains, minted for the seat-count weights programme because all six
/// earlier domains are spent. One generation served all five seat counts, and seat counts on
/// one layout share its boards: the seat count only sets a generated board's player list.
pub const TUNING3_SEED: u64 = 0x7a13_5eed_2026_1010;
pub const EVAL3_SEED: u64 = 0xe7a3_5eed_2026_1010;
pub const GATE3_SEED: u64 = 0x6a73_5eed_2026_1010;

/// Fourth-generation domains, minted because seat counts on one layout share boards in
/// the first three generations. These fold the seat count into the seed.
pub const TUNING4_SEED: u64 = 0x7a14_5eed_2026_1010;
pub const EVAL4_SEED: u64 = 0xe7a4_5eed_2026_1010;
pub const GATE4_SEED: u64 = 0x6a74_5eed_2026_1010;

/// Cut-off adoption gate, with the seat count folded in as in generation four.
pub const GATE5_SEED: u64 = 0x6a75_5eed_2026_1012;

/// Board-strategy domains, with the seat count folded in as in generation four.
pub const TUNING5_SEED: u64 = 0x7a15_5eed_2026_1013;
pub const TUNING6_SEED: u64 = 0x7a16_5eed_2026_1013;
pub const EVAL5_SEED: u64 = 0xe7a5_5eed_2026_1013;
pub const GATE6_SEED: u64 = 0x6a76_5eed_2026_1013;

/// Performance-only domain, disjoint from every evaluation generation. Reusable for
/// timing and deterministic benchmark fixtures, never for screening or adoption evidence.
pub const PERF_SEED: u64 = 0x9e4f_5eed_2026_1010;

const _: () = {
    let domains = [
        TUNING_SEED,
        EVAL_SEED,
        GATE_SEED,
        TUNING2_SEED,
        EVAL2_SEED,
        GATE2_SEED,
        TUNING3_SEED,
        EVAL3_SEED,
        GATE3_SEED,
        TUNING4_SEED,
        EVAL4_SEED,
        GATE4_SEED,
        GATE5_SEED,
        TUNING5_SEED,
        TUNING6_SEED,
        EVAL5_SEED,
        GATE6_SEED,
        PERF_SEED,
    ];
    let mut left = 0;
    while left < domains.len() {
        let mut right = left + 1;
        while right < domains.len() {
            assert!(domains[left] != domains[right]);
            right += 1;
        }
        left += 1;
    }
};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum EvaluationDomain {
    Tuning,
    Eval,
    Gate,
    Tuning2,
    Eval2,
    Gate2,
    Tuning3,
    Eval3,
    Gate3,
    Tuning4,
    Eval4,
    Gate4,
    Gate5,
    Tuning5,
    Tuning6,
    Eval5,
    Gate6,
    /// Repeatable for timing and memory readings without spending a held-out domain; outcomes are never evidence.
    Perf,
}

impl EvaluationDomain {
    pub fn parse(value: &str) -> Result<Self, String> {
        match value {
            "tuning" => Ok(Self::Tuning),
            "eval" => Ok(Self::Eval),
            "gate" => Ok(Self::Gate),
            "tuning2" => Ok(Self::Tuning2),
            "eval2" => Ok(Self::Eval2),
            "gate2" => Ok(Self::Gate2),
            "tuning3" => Ok(Self::Tuning3),
            "eval3" => Ok(Self::Eval3),
            "gate3" => Ok(Self::Gate3),
            "tuning4" => Ok(Self::Tuning4),
            "eval4" => Ok(Self::Eval4),
            "gate4" => Ok(Self::Gate4),
            "gate5" => Ok(Self::Gate5),
            "tuning5" => Ok(Self::Tuning5),
            "tuning6" => Ok(Self::Tuning6),
            "eval5" => Ok(Self::Eval5),
            "gate6" => Ok(Self::Gate6),
            "perf" => Ok(Self::Perf),
            _ => Err(format!("unknown evaluation domain {value}")),
        }
    }

    pub const fn name(self) -> &'static str {
        match self {
            Self::Tuning => "tuning",
            Self::Eval => "eval",
            Self::Gate => "gate",
            Self::Tuning2 => "tuning2",
            Self::Eval2 => "eval2",
            Self::Gate2 => "gate2",
            Self::Tuning3 => "tuning3",
            Self::Eval3 => "eval3",
            Self::Gate3 => "gate3",
            Self::Tuning4 => "tuning4",
            Self::Eval4 => "eval4",
            Self::Gate4 => "gate4",
            Self::Gate5 => "gate5",
            Self::Tuning5 => "tuning5",
            Self::Tuning6 => "tuning6",
            Self::Eval5 => "eval5",
            Self::Gate6 => "gate6",
            Self::Perf => "perf",
        }
    }

    pub fn seed(self, seats: usize) -> u64 {
        match self {
            Self::Tuning => TUNING_SEED,
            Self::Eval => EVAL_SEED,
            Self::Gate => GATE_SEED,
            Self::Tuning2 => TUNING2_SEED,
            Self::Eval2 => EVAL2_SEED,
            Self::Gate2 => GATE2_SEED,
            Self::Tuning3 => TUNING3_SEED,
            Self::Eval3 => EVAL3_SEED,
            Self::Gate3 => GATE3_SEED,
            Self::Tuning4 => mix64(TUNING4_SEED ^ seats as u64),
            Self::Eval4 => mix64(EVAL4_SEED ^ seats as u64),
            Self::Gate4 => mix64(GATE4_SEED ^ seats as u64),
            Self::Gate5 => mix64(GATE5_SEED ^ seats as u64),
            Self::Tuning5 => mix64(TUNING5_SEED ^ seats as u64),
            Self::Tuning6 => mix64(TUNING6_SEED ^ seats as u64),
            Self::Eval5 => mix64(EVAL5_SEED ^ seats as u64),
            Self::Gate6 => mix64(GATE6_SEED ^ seats as u64),
            Self::Perf => mix64(PERF_SEED ^ seats as u64),
        }
    }
}

pub struct EvaluateRequest<'a> {
    pub layout: Layout,
    pub seats: usize,
    pub domain: EvaluationDomain,
    pub field_spec: &'a str,
    pub field: PlacementKind,
    pub arms: &'a [(String, PlacementKind)],
    pub arm_specs: &'a [String],
    pub arm_policies: &'a [Option<PolicyKind>],
    pub arm_policy_names: &'a [Option<String>],
    pub reference: Option<&'a str>,
    pub boards: usize,
    pub reps: usize,
    pub policy: PolicyKind,
    pub policy_name: &'a str,
    pub player_trading: Option<TradeConfig>,
    pub threshold: f64,
    pub alpha: f64,
    pub threads: usize,
    pub allow_unofficial: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct EvaluationUnit {
    pub board: usize,
    pub rep: usize,
    pub hero_seat: usize,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EvaluationConfig {
    pub domain: String,
    pub domain_seed: u64,
    pub layout: String,
    pub seats: usize,
    pub policy: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub arm_policies: Option<BTreeMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub player_trading: Option<TradeConfig>,
    pub boards: usize,
    pub reps: usize,
    pub hero_seats: usize,
    pub units: usize,
    pub field: String,
    pub field_heuristic: String,
    pub reference: Option<String>,
    pub threshold: f64,
    pub alpha: f64,
    pub z: f64,
    pub allow_unofficial: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArmStats {
    pub spec: String,
    pub heuristic: String,
    pub games: u64,
    pub wins: u64,
    pub win_rate: f64,
    pub wilson: [f64; 2],
    pub draws: u64,
}

/// The numbers of one paired comparison: the discordant counts, the point estimate,
/// both intervals, and which of the two was selected. It carries no verdict, so the
/// same estimator serves the pooled comparison and the per-hero-seat table.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PairStats {
    pub n: usize,
    pub b: u64,
    pub c: u64,
    pub estimate: f64,
    pub mcnemar: [f64; 2],
    pub clustered: [f64; 2],
    pub clusters: usize,
    pub clustered_degenerate: bool,
    pub interval_used: String,
    pub interval: [f64; 2],
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PairComparison {
    pub arm: String,
    pub reference: String,
    #[serde(flatten)]
    pub stats: PairStats,
    /// One verdict per comparison, computed on the pooled units. There is no per-seat
    /// verdict: the disposition rule a run preregisters is stated once, for the whole
    /// comparison, and applying it again inside each seat would be a second test the
    /// run never declared.
    pub verdict: String,
    /// Indexed by hero seat, over that seat's units alone, through the same estimator
    /// and both intervals as the pooled table. Seat equals draft slot by
    /// `game.rs::setup_order`, so this is the slot breakdown.
    ///
    /// Record only. It exists because a slot-keyed weight is diluted in the pooled
    /// estimate by the slots it does not touch, so a term that moves one slot can
    /// read `equivalent` pooled. A pattern read here is a hypothesis for a later
    /// preregistered run, never a disposition on this one.
    pub per_hero_seat: Vec<PairStats>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Evaluation {
    pub config: EvaluationConfig,
    pub arms: BTreeMap<String, ArmStats>,
    pub pairs: Vec<PairComparison>,
    pub illegal_actions: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PickStats {
    pub units: usize,
    pub changed: usize,
    pub changed_pick_share: f64,
}

#[derive(Clone, Debug, Serialize)]
pub struct Picks {
    pub config: EvaluationConfig,
    pub arms: BTreeMap<String, PickStats>,
}

struct PreparedEvaluation {
    topology: Topology,
    schedule: Vec<EvaluationUnit>,
    rules: RuleConfig,
    pool: rayon::ThreadPool,
    domain_seed: u64,
}

type PickTrace = [(Vertex, Edge); 2];

#[derive(Clone, Copy)]
struct EvaluationJob {
    arm_index: usize,
    unit_index: usize,
}

#[derive(Clone, Copy)]
struct EvaluationOutcome {
    hero_won: bool,
    draw: bool,
    illegal_actions: u32,
}

pub fn parse_arm_spec(value: &str) -> Result<(String, String), String> {
    let (label, spec) = value
        .split_once('=')
        .ok_or_else(|| "arm must be label=spec".to_string())?;
    if label.is_empty() {
        return Err("arm label must not be empty".into());
    }
    if spec.is_empty() {
        return Err(format!("arm {label} must have a non-empty spec"));
    }
    Ok((label.to_string(), spec.to_string()))
}

pub fn evaluation_schedule(boards: usize, reps: usize, seats: usize) -> Vec<EvaluationUnit> {
    let mut schedule = Vec::with_capacity(boards * reps * seats);
    for board in 0..boards {
        for rep in 0..reps {
            for hero_seat in 0..seats {
                schedule.push(EvaluationUnit {
                    board,
                    rep,
                    hero_seat,
                });
            }
        }
    }
    schedule
}

fn prepare_evaluation(request: &EvaluateRequest<'_>) -> Result<PreparedEvaluation, String> {
    validate_request(request)?;
    let topology = Topology::load(request.layout)?;
    let units = request
        .boards
        .checked_mul(request.reps)
        .and_then(|count| count.checked_mul(request.seats))
        .ok_or_else(|| "evaluation unit count overflow".to_string())?;
    request
        .arms
        .len()
        .checked_mul(units)
        .ok_or_else(|| "evaluation game count overflow".to_string())?;
    let domain_seed = request.domain.seed(request.seats);

    let schedule = evaluation_schedule(request.boards, request.reps, request.seats);
    if schedule.len() != units {
        return Err(format!(
            "evaluation schedule integrity error: expected {units} units, collected {}",
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
    Ok(PreparedEvaluation { topology, schedule, rules, pool, domain_seed })
}

fn prepare_evaluation_chunk(
    request: &EvaluateRequest<'_>,
    topology: &Topology,
    domain_seed: u64,
    board_range: Range<usize>,
) -> Result<(Vec<SimBoard>, Vec<EvaluationJob>), String> {
    let units_per_board = request.reps * request.seats;
    let unit_range = board_range.start * units_per_board..board_range.end * units_per_board;
    let mut boards = board_range
        .map(|board_index| {
            generate_board(
                request.layout,
                request.seats,
                mix64(domain_seed ^ board_index as u64),
            )
        })
        .collect::<Result<Vec<_>, _>>()?;
    let mut placement_kinds = Vec::with_capacity(request.arms.len() + 1);
    placement_kinds.push(request.field);
    placement_kinds.extend(request.arms.iter().map(|(_, kind)| *kind));
    prepare_app_formula_boards(&mut boards, topology, &placement_kinds);

    let mut jobs = Vec::with_capacity(request.arms.len() * unit_range.len());
    for arm_index in 0..request.arms.len() {
        for unit_index in unit_range.clone() {
            jobs.push(EvaluationJob {
                arm_index,
                unit_index,
            });
        }
    }
    Ok((boards, jobs))
}

pub fn evaluate(request: EvaluateRequest<'_>) -> Result<Evaluation, String> {
    evaluate_in_chunks(request, EVALUATION_CHUNK_BOARDS)
}

pub fn evaluate_in_chunks(
    request: EvaluateRequest<'_>,
    chunk_boards: usize,
) -> Result<Evaluation, String> {
    if chunk_boards == 0 {
        return Err("chunk boards must be positive".into());
    }
    let PreparedEvaluation { topology, schedule, rules, pool, domain_seed } =
        prepare_evaluation(&request)?;
    let units = schedule.len();
    let mut indicators = (0..request.arms.len())
        .map(|_| Vec::with_capacity(units))
        .collect::<Vec<_>>();
    let mut draw_indicators = (0..request.arms.len())
        .map(|_| Vec::with_capacity(units))
        .collect::<Vec<_>>();
    let mut illegal_actions = 0_u64;
    for board_start in (0..request.boards).step_by(chunk_boards) {
        let board_end = board_start + chunk_boards.min(request.boards - board_start);
        let unit_start = board_start * request.reps * request.seats;
        let unit_end = board_end * request.reps * request.seats;
        let chunk_units = unit_end - unit_start;
        let (boards, jobs) = prepare_evaluation_chunk(
            &request, &topology, domain_seed, board_start..board_end,
        )?;
        let game_count = jobs.len();
        let outcomes: Vec<EvaluationOutcome> = pool.install(|| {
            jobs.par_iter()
                .map_init(GameArena::default, |arena, job| {
                    let unit = schedule[job.unit_index];
                    let config = evaluation_unit_config(&request, unit, job.arm_index, domain_seed);
                    let result = arena.play(&boards[unit.board - board_start], &topology, &rules, &config);
                    EvaluationOutcome {
                        hero_won: result.winner == Some(unit.hero_seat as u8),
                        draw: result.draw,
                        illegal_actions: result.illegal_actions,
                    }
                })
                .collect()
        });
        if outcomes.len() != game_count {
            return Err(format!(
                "evaluation schedule integrity error: expected {game_count} games, collected {}",
                outcomes.len()
            ));
        }

        let mut seen = vec![false; game_count];
        for (job, outcome) in jobs.iter().zip(&outcomes) {
            let pair_index = job.arm_index * chunk_units + job.unit_index - unit_start;
            if seen[pair_index] {
                return Err(format!(
                    "evaluation schedule integrity error: arm {} unit {} was played more than once",
                    job.arm_index, job.unit_index
                ));
            }
            seen[pair_index] = true;
            indicators[job.arm_index].push(outcome.hero_won);
            draw_indicators[job.arm_index].push(outcome.draw);
            illegal_actions += u64::from(outcome.illegal_actions);
        }
        if seen.iter().any(|played| !played)
            || indicators
                .iter()
                .any(|arm_indicators| arm_indicators.len() != unit_end)
        {
            return Err(
                "evaluation schedule integrity error: not every arm and unit pair was played exactly once"
                    .into(),
            );
        }
    }

    let z = alpha_z(request.alpha)?;
    let arms = request
        .arms
        .iter()
        .enumerate()
        .map(|(arm_index, (label, kind))| {
            Ok((
                label.clone(),
                summarize_arm(
                    &request.arm_specs[arm_index],
                    kind.name(),
                    &indicators[arm_index],
                    &draw_indicators[arm_index],
                    z,
                )?,
            ))
        })
        .collect::<Result<BTreeMap<_, _>, String>>()?;
    let board_of_unit = schedule.iter().map(|unit| unit.board).collect::<Vec<_>>();
    let mut pairs = Vec::new();
    if let Some(reference_label) = request.reference {
        let reference_index = request
            .arms
            .iter()
            .position(|(label, _)| label == reference_label)
            .expect("validated evaluation reference");
        let mut arm_indices = (0..request.arms.len())
            .filter(|arm_index| *arm_index != reference_index)
            .collect::<Vec<_>>();
        arm_indices.sort_by(|left, right| request.arms[*left].0.cmp(&request.arms[*right].0));
        for arm_index in arm_indices {
            let stats = try_paired_stats(
                &indicators[arm_index],
                &indicators[reference_index],
                &board_of_unit,
                request.boards,
                z,
            )?;
            let verdict = pair_verdict(stats.interval, request.threshold).to_string();
            pairs.push(PairComparison {
                arm: request.arms[arm_index].0.clone(),
                reference: reference_label.to_string(),
                per_hero_seat: per_hero_seat_stats(
                    &schedule,
                    &indicators[arm_index],
                    &indicators[reference_index],
                    request.seats,
                    request.boards,
                    z,
                )?,
                stats,
                verdict,
            });
        }
    }
    Ok(Evaluation {
        config: evaluation_config(&request, domain_seed, units, z),
        arms,
        pairs,
        illegal_actions,
    })
}

pub fn evaluate_picks(mut request: EvaluateRequest<'_>) -> Result<Picks, String> {
    if request.reference.is_none() || request.arms.len() < 2 {
        return Err("--picks-only requires --reference and at least two arms".into());
    }
    validate_request(&request)?;

    // Draft kinds draw nothing from the game seed, so repetitions add no information.
    request.reps = 1;
    let PreparedEvaluation { topology, schedule, rules, pool, domain_seed } =
        prepare_evaluation(&request)?;
    let (boards, jobs) = prepare_evaluation_chunk(
        &request, &topology, domain_seed, 0..request.boards,
    )?;
    let units = schedule.len();
    let traces: Vec<Result<PickTrace, String>> = pool.install(|| {
        jobs.par_iter()
            .map_init(GameArena::default, |arena, job| {
                let unit = schedule[job.unit_index];
                let config = evaluation_unit_config(&request, unit, job.arm_index, domain_seed);
                draft_trace(arena, &boards[unit.board], &topology, &rules, &config, unit)
            })
            .collect()
    });
    let traces = traces.into_iter().collect::<Result<Vec<_>, _>>()?;
    let reference_label = request.reference.expect("validated picks reference");
    let reference = request.arms.iter().position(|(name, _)| name == reference_label)
        .expect("validated evaluation reference");
    let arms = request.arms.iter().enumerate()
        .map(|(index, (label, _))| {
            let changed = (0..units).filter(|unit| {
                trace_changed(&traces[index * units + unit], &traces[reference * units + unit])
            }).count();
            (label.clone(), PickStats {
                units,
                changed,
                changed_pick_share: changed as f64 / units as f64,
            })
        })
        .collect();
    Ok(Picks {
        config: evaluation_config(&request, domain_seed, units, alpha_z(request.alpha)?),
        arms,
    })
}

fn changed_edge(before: &[u8], after: &[u8], unit: EvaluationUnit) -> Result<Edge, String> {
    let mut changed = before.iter().zip(after).enumerate()
        .filter(|(_, (before, after))| before != after)
        .map(|(edge, _)| edge as Edge);
    match (changed.next(), changed.next()) {
        (Some(edge), None) => Ok(edge),
        _ => Err(format!(
            "picks-only board {} seat {}: expected exactly one changed edge per hero pick",
            unit.board, unit.hero_seat,
        )),
    }
}

fn draft_trace(
    arena: &mut GameArena,
    board: &SimBoard,
    topology: &Topology,
    rules: &RuleConfig,
    config: &GameConfig,
    unit: EvaluationUnit,
) -> Result<PickTrace, String> {
    arena.prepare(board, topology, rules, config);
    let seats = board.seats();
    let mut trace = [(0, 0); 2];
    for (i, seat) in setup_order(seats).into_iter().enumerate() {
        let seat = usize::from(seat);
        let before = (seat == unit.hero_seat).then_some(arena.state.edge_owner);
        let vertex = arena.setup_pick_for_test(board, topology, rules, config, seat, i >= seats)
            .ok_or_else(|| format!("picks-only board {} seat {seat}: no setup settlement", unit.board))?;
        if let Some(before) = before {
            let edge = changed_edge(&before, &arena.state.edge_owner, unit)?;
            trace[usize::from(i >= seats)] = (vertex, edge);
        }
    }
    Ok(trace)
}

fn trace_changed(arm: &PickTrace, reference: &PickTrace) -> bool {
    arm != reference
}

fn evaluation_unit_config(
    request: &EvaluateRequest<'_>,
    unit: EvaluationUnit,
    arm_index: usize,
    domain_seed: u64,
) -> GameConfig {
    let mut config = GameConfig::default();
    for seat in 0..request.seats {
        config.placements[seat] = request.field;
        config.policies[seat] = request.policy;
    }
    config.placements[unit.hero_seat] = request.arms[arm_index].1;
    if let Some(policy) = request.arm_policies[arm_index] {
        config.policies[unit.hero_seat] = policy;
    }
    config.seed = derive_evaluation_seed(
        domain_seed,
        unit.board as u64,
        unit.rep as u64,
        unit.hero_seat as u64,
    );
    config
}

fn evaluation_config(
    request: &EvaluateRequest<'_>,
    domain_seed: u64,
    units: usize,
    z: f64,
) -> EvaluationConfig {
    EvaluationConfig {
        domain: request.domain.name().to_string(),
        domain_seed,
        layout: request.layout.as_str().to_string(),
        seats: request.seats,
        policy: request.policy_name.to_string(),
        arm_policies: {
            let values = request
                .arms
                .iter()
                .zip(request.arm_policy_names)
                .filter_map(|((label, _), policy)| {
                    policy
                        .as_ref()
                        .map(|policy| (label.clone(), policy.clone()))
                })
                .collect::<BTreeMap<_, _>>();
            (!values.is_empty()).then_some(values)
        },
        player_trading: request.player_trading,
        boards: request.boards,
        reps: request.reps,
        hero_seats: request.seats,
        units,
        field: request.field_spec.to_string(),
        field_heuristic: request.field.name().to_string(),
        reference: request.reference.map(str::to_string),
        threshold: request.threshold,
        alpha: request.alpha,
        z,
        allow_unofficial: request.allow_unofficial,
    }
}

pub fn summarize_arm(
    spec: &str,
    heuristic: &str,
    wins: &[bool],
    draws: &[bool],
    z: f64,
) -> Result<ArmStats, String> {
    if wins.len() != draws.len() {
        return Err("arm win and draw indicators must have equal lengths".into());
    }
    if wins.is_empty() {
        return Err("arm marginal statistics require at least one game".into());
    }
    let games = wins.len() as u64;
    let win_count = wins.iter().map(|won| u64::from(*won)).sum();
    let draw_count = draws.iter().map(|draw| u64::from(*draw)).sum();
    Ok(ArmStats {
        spec: spec.to_string(),
        heuristic: heuristic.to_string(),
        games,
        wins: win_count,
        win_rate: win_count as f64 / games as f64,
        wilson: wilson(win_count, games, z),
        draws: draw_count,
    })
}

pub fn paired_stats(
    arm: &[bool],
    reference: &[bool],
    board_of_unit: &[usize],
    boards: usize,
    z: f64,
) -> PairStats {
    try_paired_stats(arm, reference, board_of_unit, boards, z)
        .expect("paired statistics require a valid balanced schedule")
}

/// The preregistered verdict rule applied to the selected interval. It sits beside the
/// estimator rather than inside it because a verdict belongs to a run's registration,
/// and only the pooled comparison has one.
pub fn pair_verdict(interval: [f64; 2], threshold: f64) -> &'static str {
    if interval[0] > threshold {
        "better"
    } else if interval[1] < -threshold {
        "worse"
    } else if interval[0] > -threshold && interval[1] < threshold {
        "equivalent"
    } else {
        "inconclusive"
    }
}

/// Slices a paired comparison by hero seat. Each slice keeps every board, so its
/// cluster size is `reps` and the balanced-schedule requirement still holds.
fn per_hero_seat_stats(
    schedule: &[EvaluationUnit],
    arm: &[bool],
    reference: &[bool],
    seats: usize,
    boards: usize,
    z: f64,
) -> Result<Vec<PairStats>, String> {
    (0..seats)
        .map(|hero_seat| {
            let mut arm_units = Vec::new();
            let mut reference_units = Vec::new();
            let mut board_of_unit = Vec::new();
            for (unit_index, unit) in schedule.iter().enumerate() {
                if unit.hero_seat != hero_seat {
                    continue;
                }
                arm_units.push(arm[unit_index]);
                reference_units.push(reference[unit_index]);
                board_of_unit.push(unit.board);
            }
            try_paired_stats(&arm_units, &reference_units, &board_of_unit, boards, z)
        })
        .collect()
}

pub fn try_paired_stats(
    arm: &[bool],
    reference: &[bool],
    board_of_unit: &[usize],
    boards: usize,
    z: f64,
) -> Result<PairStats, String> {
    if arm.len() != reference.len() || arm.len() != board_of_unit.len() {
        return Err("paired statistics vectors must have equal lengths".into());
    }
    if arm.is_empty() {
        return Err("paired statistics require at least one unit".into());
    }
    if boards == 0 {
        return Err("paired statistics require at least one board".into());
    }
    let mut b = 0_u64;
    let mut c = 0_u64;
    let mut board_differences = vec![0_i64; boards];
    let mut board_units = vec![0_usize; boards];
    for ((arm_won, reference_won), board) in arm.iter().zip(reference).zip(board_of_unit) {
        if *board >= boards {
            return Err(format!(
                "paired statistics board index {board} is outside {boards} clusters"
            ));
        }
        match (*arm_won, *reference_won) {
            (true, false) => {
                b += 1;
                board_differences[*board] += 1;
            }
            (false, true) => {
                c += 1;
                board_differences[*board] -= 1;
            }
            _ => {}
        }
        board_units[*board] += 1;
    }
    let cluster_size = board_units[0];
    if cluster_size == 0 || board_units.iter().any(|count| *count != cluster_size) {
        return Err("paired statistics require a balanced board schedule".into());
    }

    let n = arm.len();
    let n_float = n as f64;
    let difference = b as f64 - c as f64;
    let estimate = difference / n_float;
    let mcnemar_variance = (b + c) as f64 - difference * difference / n_float;
    let mcnemar_se = mcnemar_variance.max(0.0).sqrt() / n_float;
    let mcnemar = bounded_interval(estimate, z * mcnemar_se);

    let (clustered, clustered_degenerate) = if boards < 2 {
        ([-1.0, 1.0], true)
    } else {
        let board_means = board_differences
            .iter()
            .map(|difference| *difference as f64 / cluster_size as f64)
            .collect::<Vec<_>>();
        let mean = board_means.iter().sum::<f64>() / boards as f64;
        let variance = board_means
            .iter()
            .map(|board_mean| {
                let centered = board_mean - mean;
                centered * centered
            })
            .sum::<f64>()
            / (boards - 1) as f64;
        let standard_error = (variance / boards as f64).sqrt();
        (bounded_interval(estimate, z * standard_error), false)
    };
    let mcnemar_width = mcnemar[1] - mcnemar[0];
    let clustered_width = clustered[1] - clustered[0];
    let (interval_used, interval) = if mcnemar_width > clustered_width {
        ("mcnemar", mcnemar)
    } else {
        ("clustered", clustered)
    };
    Ok(PairStats {
        n,
        b,
        c,
        estimate,
        mcnemar,
        clustered,
        clusters: boards,
        clustered_degenerate,
        interval_used: interval_used.to_string(),
        interval,
    })
}

pub fn evaluation_workers(threads: usize) -> usize {
    if threads == 0 {
        std::thread::available_parallelism().map_or(1, NonZero::get)
    } else {
        threads
    }
    .max(1)
}

pub fn evaluation_meta(elapsed_seconds: f64, games: usize, threads: usize) -> Meta {
    Meta {
        elapsed_seconds,
        games_per_second: games as f64 / elapsed_seconds,
        threads: evaluation_workers(threads),
        rust_version: rust_version(),
        simulator_version: env!("CARGO_PKG_VERSION").into(),
    }
}

pub fn write_evaluation_outputs(
    directory: &Path,
    evaluation: &Evaluation,
    meta: &Meta,
) -> Result<(), String> {
    fs::create_dir_all(directory).map_err(|error| error.to_string())?;
    let evaluation_json =
        serde_json::to_vec_pretty(evaluation).map_err(|error| error.to_string())?;
    fs::write(
        directory.join("evaluation.json"),
        [evaluation_json.as_slice(), b"\n"].concat(),
    )
    .map_err(|error| error.to_string())?;
    let meta_json = serde_json::to_vec_pretty(meta).map_err(|error| error.to_string())?;
    fs::write(
        directory.join("meta.json"),
        [meta_json.as_slice(), b"\n"].concat(),
    )
    .map_err(|error| error.to_string())
}

pub fn write_picks_output(directory: &Path, picks: &Picks) -> Result<(), String> {
    fs::create_dir_all(directory).map_err(|error| error.to_string())?;
    let json = serde_json::to_vec_pretty(picks).map_err(|error| error.to_string())?;
    fs::write(directory.join("picks.json"), [json.as_slice(), b"\n"].concat())
        .map_err(|error| error.to_string())
}

fn bounded_interval(estimate: f64, margin: f64) -> [f64; 2] {
    [(estimate - margin).max(-1.0), (estimate + margin).min(1.0)]
}

fn rust_version() -> String {
    Command::new(option_env!("RUSTC").unwrap_or("rustc"))
        .arg("--version")
        .output()
        .ok()
        .filter(|output| output.status.success())
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .map(|version| version.trim().to_string())
        .unwrap_or_else(|| "unknown".to_string())
}

fn validate_request(request: &EvaluateRequest<'_>) -> Result<(), String> {
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
    if request.arms.is_empty() {
        return Err("at least one arm is required".into());
    }
    if request.arm_specs.len() != request.arms.len() {
        return Err("each evaluation arm must have exactly one spec".into());
    }
    if request.arm_policies.len() != request.arms.len()
        || request.arm_policy_names.len() != request.arms.len()
    {
        return Err("each evaluation arm must have exactly one policy override slot".into());
    }
    let mut labels = request
        .arms
        .iter()
        .map(|(label, _)| label.as_str())
        .collect::<Vec<_>>();
    if labels.iter().any(|label| label.is_empty()) {
        return Err("arm label must not be empty".into());
    }
    labels.sort_unstable();
    if let Some(collision) = labels.windows(2).find(|pair| pair[0] == pair[1]) {
        return Err(format!("duplicate arm label {}", collision[0]));
    }
    match (request.arms.len(), request.reference) {
        (1, Some(reference)) if request.arms[0].0 != reference => {
            return Err(format!("reference {reference} does not name an arm"));
        }
        (1, _) => {}
        (_, None) => return Err("reference is required when evaluating multiple arms".into()),
        (_, Some(reference)) if !request.arms.iter().any(|(label, _)| label == reference) => {
            return Err(format!("reference {reference} does not name an arm"));
        }
        _ => {}
    }
    if !request.threshold.is_finite() || request.threshold < 0.0 {
        return Err("threshold must be finite and non-negative".into());
    }
    alpha_z(request.alpha)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use unsettled_engine::placement::app_formula::EngineWeights;
    use unsettled_engine::placement::register_app_formula_draft;

    #[test]
    fn trace_comparison_counts_order_and_each_pick_component() {
        let reference = [(1, 2), (3, 4)];
        assert!(!trace_changed(&reference, &reference));
        assert!(trace_changed(&[(3, 4), (1, 2)], &reference));
        assert!(trace_changed(&[(1, 5), (3, 4)], &reference));
        assert!(trace_changed(&[(5, 2), (3, 4)], &reference));
    }

    #[test]
    fn a_hero_pick_requires_exactly_one_changed_edge() {
        let unit = EvaluationUnit { board: 7, rep: 0, hero_seat: 1 };
        assert_eq!(changed_edge(&[0, 0], &[0, 1], unit).unwrap(), 1);
        for after in [[0, 0], [1, 1]] {
            let error = changed_edge(&[0, 0], &after, unit).unwrap_err();
            assert!(error.contains("board 7"), "{error}");
            assert!(error.contains("seat 1"), "{error}");
            assert!(error.contains("exactly one changed edge"), "{error}");
        }
    }

    #[test]
    fn picks_only_counts_a_real_draft_taking_the_same_pair_in_reverse_order() {
        let mut anchor: EngineWeights =
            serde_json::from_str(include_str!("../../../placement/default-weights.json")).unwrap();
        anchor.coverage_exponent = 1.0;
        anchor.diversity_weight = 3.2;
        anchor.contest_weight = 0.0;
        anchor.reprice_first_expansion = 0.0;
        let mut weights = anchor.clone();
        weights.contest_weight = 0.5;
        let base = register_app_formula_draft(
            "picks-order-base".into(), anchor.clone(), anchor.clone(),
        ).unwrap();
        let arm = register_app_formula_draft("picks-order-arm".into(), weights, anchor).unwrap();
        let topology = Topology::load(Layout::Standard4).unwrap();
        let rules = RuleConfig::base(Layout::Standard4);
        let mut board = generate_board(Layout::Standard4, 2, 39).unwrap();
        prepare_app_formula_boards(std::slice::from_mut(&mut board), &topology, &[base, arm]);
        let unit = EvaluationUnit { board: 0, rep: 0, hero_seat: 1 };
        let mut arena = GameArena::default();
        let mut config = GameConfig::default();
        config.placements = [base; 6];
        let reference = draft_trace(&mut arena, &board, &topology, &rules, &config, unit).unwrap();
        config.placements[unit.hero_seat] = arm;
        let candidate = draft_trace(&mut arena, &board, &topology, &rules, &config, unit).unwrap();
        assert_ne!(reference[0], reference[1]);
        assert_eq!(candidate, [reference[1], reference[0]]);
        assert!(trace_changed(&candidate, &reference));
    }
}
