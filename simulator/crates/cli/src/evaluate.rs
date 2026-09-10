use std::collections::BTreeMap;
use std::fs;
use std::num::NonZero;
use std::path::Path;
use std::process::Command;

use rayon::prelude::*;
use serde::Serialize;
use unsettled_engine::game::{GameArena, GameConfig};
use unsettled_engine::placement::{PlacementKind, prepare_app_formula_boards};
use unsettled_engine::policy::PolicyKind;
use unsettled_engine::rng::{derive_evaluation_seed, mix64};
use unsettled_engine::rules::{RuleConfig, TradeConfig};
use unsettled_engine::topology::{Layout, Topology};

use crate::boardgen::generate_board;
use crate::output::Meta;
use crate::stats::{alpha_z, wilson};

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

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum EvaluationDomain {
    Tuning,
    Eval,
    Gate,
    Tuning2,
    Eval2,
    Gate2,
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
        }
    }

    pub const fn seed(self) -> u64 {
        match self {
            Self::Tuning => TUNING_SEED,
            Self::Eval => EVAL_SEED,
            Self::Gate => GATE_SEED,
            Self::Tuning2 => TUNING2_SEED,
            Self::Eval2 => EVAL2_SEED,
            Self::Gate2 => GATE2_SEED,
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

pub fn evaluate(request: EvaluateRequest<'_>) -> Result<Evaluation, String> {
    validate_request(&request)?;
    let topology = Topology::load(request.layout)?;
    let units = request
        .boards
        .checked_mul(request.reps)
        .and_then(|count| count.checked_mul(request.seats))
        .ok_or_else(|| "evaluation unit count overflow".to_string())?;
    let game_count = request
        .arms
        .len()
        .checked_mul(units)
        .ok_or_else(|| "evaluation game count overflow".to_string())?;
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
    let mut placement_kinds = Vec::with_capacity(request.arms.len() + 1);
    placement_kinds.push(request.field);
    placement_kinds.extend(request.arms.iter().map(|(_, kind)| *kind));
    prepare_app_formula_boards(&mut boards, &topology, &placement_kinds);

    let schedule = evaluation_schedule(request.boards, request.reps, request.seats);
    if schedule.len() != units {
        return Err(format!(
            "evaluation schedule integrity error: expected {units} units, collected {}",
            schedule.len()
        ));
    }
    let mut jobs = Vec::with_capacity(game_count);
    for arm_index in 0..request.arms.len() {
        for unit_index in 0..units {
            jobs.push(EvaluationJob {
                arm_index,
                unit_index,
            });
        }
    }
    let workers = evaluation_workers(request.threads);
    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(workers)
        .build()
        .map_err(|error| error.to_string())?;
    let mut rules = RuleConfig::base(request.layout);
    rules.player_trading = request.player_trading;
    let outcomes: Vec<EvaluationOutcome> = pool.install(|| {
        jobs.par_iter()
            .map_init(GameArena::default, |arena, job| {
                let unit = schedule[job.unit_index];
                let mut config = GameConfig::default();
                for seat in 0..request.seats {
                    config.placements[seat] = request.field;
                    config.policies[seat] = request.policy;
                }
                config.placements[unit.hero_seat] = request.arms[job.arm_index].1;
                if let Some(policy) = request.arm_policies[job.arm_index] {
                    config.policies[unit.hero_seat] = policy;
                }
                config.seed = derive_evaluation_seed(
                    domain_seed,
                    unit.board as u64,
                    unit.rep as u64,
                    unit.hero_seat as u64,
                );
                let result = arena.play(&boards[unit.board], &topology, &rules, &config);
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

    let mut indicators = (0..request.arms.len())
        .map(|_| Vec::with_capacity(units))
        .collect::<Vec<_>>();
    let mut draw_indicators = (0..request.arms.len())
        .map(|_| Vec::with_capacity(units))
        .collect::<Vec<_>>();
    let mut seen = vec![false; game_count];
    let mut illegal_actions = 0_u64;
    for (job, outcome) in jobs.iter().zip(&outcomes) {
        let pair_index = job.arm_index * units + job.unit_index;
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
            .any(|arm_indicators| arm_indicators.len() != units)
    {
        return Err(
            "evaluation schedule integrity error: not every arm and unit pair was played exactly once"
                .into(),
        );
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
        config: EvaluationConfig {
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
        },
        arms,
        pairs,
        illegal_actions,
    })
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
