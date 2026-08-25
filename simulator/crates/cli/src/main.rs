use std::fs;
use std::path::{Path, PathBuf};
use std::time::Instant;

use clap::{Args, Parser, Subcommand};
use serde::Deserialize;
use unsettled_engine::board::{ConversionOptions, SimBoard};
use unsettled_engine::placement::{PlacementKind, prepare_app_formula_boards};
use unsettled_engine::policy::PolicyKind;
use unsettled_engine::rng::mix64;
use unsettled_engine::rules::{RuleConfig, TradeConfig};
use unsettled_engine::topology::{Layout, Topology};
use unsettled_engine::wire::WireBoard;
use unsettled_sim::boardgen::generate_board;
use unsettled_sim::evaluate::{
    EvaluateRequest, EvaluationDomain, evaluate, evaluation_meta, parse_arm_spec,
    write_evaluation_outputs,
};
use unsettled_sim::heuristics::parse_heuristic;
use unsettled_sim::runner::{RunRequest, benchmark, run};
use unsettled_sim::schedule::{simulate_schedule, tournament_schedule};

#[derive(Parser)]
#[command(
    name = "unsettled-sim",
    version,
    about = "Seeded Catan self-play simulator"
)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Compare placement heuristics across boards, repetitions, and seat rotations.
    Tournament(TournamentArgs),
    /// Evaluate labelled hero placement arms against a fixed field.
    Evaluate(EvaluateArgs),
    /// Simulate games from an app-exported Board JSON file.
    Simulate(SimulateArgs),
    /// Measure single-core and parallel game throughput.
    Bench(BenchArgs),
}

#[derive(Args)]
struct TournamentArgs {
    #[arg(long)]
    layout: Option<String>,
    #[arg(long)]
    board: Vec<PathBuf>,
    #[arg(long)]
    board_dir: Option<PathBuf>,
    #[arg(long)]
    random_boards: Option<usize>,
    #[arg(long)]
    reps: Option<usize>,
    #[arg(long)]
    heuristics: Option<String>,
    #[arg(long)]
    policy: Option<String>,
    #[arg(long)]
    seed: Option<u64>,
    #[arg(long)]
    threads: Option<usize>,
    #[arg(long)]
    out: Option<PathBuf>,
    #[arg(long)]
    seats: Option<usize>,
    #[arg(long)]
    allow_unofficial: bool,
    #[arg(long)]
    config: Option<PathBuf>,
    #[arg(long)]
    jsonl: Option<PathBuf>,
    #[command(flatten)]
    trade: TradeArgs,
}

#[derive(Default, Deserialize)]
#[serde(default, deny_unknown_fields, rename_all = "camelCase")]
struct TournamentFileConfig {
    layout: Option<String>,
    board: Vec<PathBuf>,
    board_dir: Option<PathBuf>,
    random_boards: Option<usize>,
    reps: Option<usize>,
    heuristics: Option<String>,
    policy: Option<String>,
    seed: Option<u64>,
    threads: Option<usize>,
    out: Option<PathBuf>,
    seats: Option<usize>,
    allow_unofficial: bool,
    jsonl: Option<PathBuf>,
}

#[derive(Args)]
struct SimulateArgs {
    #[arg(long)]
    board: PathBuf,
    #[arg(long, default_value_t = 1000)]
    games: usize,
    #[arg(
        long,
        default_value = "max_pips,pip_diversity,pip_scarcity,port_synergy,random"
    )]
    heuristics: String,
    #[arg(long, default_value = "heuristic-v1")]
    policy: String,
    #[arg(long, default_value_t = 7)]
    seed: u64,
    #[arg(long, default_value_t = 0)]
    threads: usize,
    #[arg(long)]
    out: PathBuf,
    #[arg(long)]
    allow_unofficial: bool,
    #[command(flatten)]
    trade: TradeArgs,
}

#[derive(Args)]
struct EvaluateArgs {
    #[arg(long, default_value = "standard4")]
    layout: String,
    #[arg(long)]
    seats: Option<usize>,
    #[arg(long)]
    domain: String,
    #[arg(long)]
    field: String,
    #[arg(long)]
    arm: Vec<String>,
    #[arg(long)]
    arm_policy: Vec<String>,
    #[arg(long)]
    reference: Option<String>,
    #[arg(long)]
    boards: usize,
    #[arg(long)]
    reps: usize,
    #[arg(long, default_value = "heuristic-v1")]
    policy: String,
    #[arg(long, default_value_t = 0.01, allow_hyphen_values = true)]
    threshold: f64,
    #[arg(long, default_value_t = 0.05)]
    alpha: f64,
    #[arg(long, default_value_t = 0)]
    threads: usize,
    #[arg(long)]
    out: PathBuf,
    #[arg(long)]
    allow_unofficial: bool,
    #[command(flatten)]
    trade: TradeArgs,
}

#[derive(Args)]
struct BenchArgs {
    #[arg(long, default_value = "standard4")]
    layout: String,
    #[arg(long, default_value_t = 20_000)]
    games: usize,
    #[arg(long, default_value_t = 0)]
    threads: usize,
}

#[derive(Args, Clone, Copy, Default)]
struct TradeArgs {
    #[arg(long)]
    player_trading: bool,
    #[arg(long, requires = "player_trading")]
    opponent_gain_weight: Option<f32>,
    #[arg(long, requires = "player_trading", allow_hyphen_values = true)]
    acceptance_temperature: Option<f32>,
    #[arg(long, requires = "player_trading")]
    max_offers_per_turn: Option<u8>,
    #[arg(long, requires = "player_trading")]
    hidden_vp_confidence: Option<f64>,
    #[arg(long, requires = "player_trading")]
    embargo_danger_floor: Option<f64>,
    #[arg(long, requires = "player_trading")]
    embargo_danger: Option<f64>,
    #[arg(long, requires = "player_trading")]
    embargo_takeover_danger: Option<f64>,
}

impl TradeArgs {
    fn config(self) -> Option<TradeConfig> {
        self.player_trading.then(|| {
            let defaults = TradeConfig::default();
            TradeConfig {
                opponent_gain_weight: self
                    .opponent_gain_weight
                    .unwrap_or(defaults.opponent_gain_weight),
                acceptance_temperature: self
                    .acceptance_temperature
                    .unwrap_or(defaults.acceptance_temperature),
                max_offers_per_turn: self
                    .max_offers_per_turn
                    .unwrap_or(defaults.max_offers_per_turn),
                hidden_vp_confidence: self
                    .hidden_vp_confidence
                    .unwrap_or(defaults.hidden_vp_confidence),
                embargo_danger_floor: self
                    .embargo_danger_floor
                    .unwrap_or(defaults.embargo_danger_floor),
                embargo_danger: self.embargo_danger.unwrap_or(defaults.embargo_danger),
                embargo_takeover_danger: self
                    .embargo_takeover_danger
                    .unwrap_or(defaults.embargo_takeover_danger),
            }
        })
    }
}

fn main() {
    if let Err(error) = execute(Cli::parse()) {
        eprintln!("error: {error}");
        std::process::exit(2);
    }
}

fn execute(cli: Cli) -> Result<(), String> {
    match cli.command {
        Command::Tournament(args) => tournament(args),
        Command::Evaluate(args) => evaluate_command(args),
        Command::Simulate(args) => simulate(args),
        Command::Bench(args) => bench(args),
    }
}

fn tournament(args: TournamentArgs) -> Result<(), String> {
    let player_trading = args.trade.config();
    let file_config = if let Some(path) = &args.config {
        serde_json::from_str::<TournamentFileConfig>(
            &fs::read_to_string(path).map_err(|error| error.to_string())?,
        )
        .map_err(|error| format!("invalid tournament config: {error}"))?
    } else {
        TournamentFileConfig::default()
    };
    let layout_name = args
        .layout
        .or(file_config.layout)
        .unwrap_or_else(|| "standard4".into());
    let layout = parse_layout(&layout_name)?;
    let topology = Topology::load(layout)?;
    let default_seats = if layout == Layout::Standard4 { 4 } else { 6 };
    let seats = args.seats.or(file_config.seats).unwrap_or(default_seats);
    let allow_unofficial = args.allow_unofficial || file_config.allow_unofficial;
    let random_boards = args
        .random_boards
        .or(file_config.random_boards)
        .unwrap_or(0);
    let reps = args.reps.or(file_config.reps).unwrap_or(25);
    let heuristic_names = args
        .heuristics
        .or(file_config.heuristics)
        .unwrap_or_else(|| {
            "max_pips,pip_diversity,pip_scarcity,port_synergy,city_focus,random".into()
        });
    let policy_name = args
        .policy
        .or(file_config.policy)
        .unwrap_or_else(|| "heuristic-v1".into());
    let seed = args.seed.or(file_config.seed).unwrap_or(42);
    let threads = args.threads.or(file_config.threads).unwrap_or(0);
    let out = args
        .out
        .or(file_config.out)
        .ok_or_else(|| "--out is required unless supplied by --config".to_string())?;
    let jsonl = args.jsonl.or(file_config.jsonl);
    let official = match layout {
        Layout::Standard4 => (3..=4).contains(&seats),
        Layout::Extension6 => (5..=6).contains(&seats),
    };
    if !official && !allow_unofficial {
        return Err("non-official layout and seat combinations require --allow-unofficial".into());
    }
    let mut boards = Vec::new();
    for path in args.board.iter().chain(&file_config.board) {
        boards.push(load_board(path, &topology, allow_unofficial)?);
    }
    if let Some(directory) = args.board_dir.as_ref().or(file_config.board_dir.as_ref()) {
        let mut paths = fs::read_dir(directory)
            .map_err(|error| error.to_string())?
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|path| {
                path.extension()
                    .is_some_and(|extension| extension == "json")
            })
            .collect::<Vec<_>>();
        paths.sort();
        for path in paths {
            boards.push(load_board(&path, &topology, allow_unofficial)?);
        }
    }
    for board_index in 0..random_boards {
        boards.push(generate_board(
            layout,
            seats,
            mix64(seed ^ board_index as u64),
        )?);
    }
    if boards.is_empty() {
        return Err("provide --random-boards, --board, or --board-dir".into());
    }
    if boards
        .iter()
        .any(|board| !board.roads().is_empty() || !board.buildings().is_empty())
    {
        return Err("tournament boards must be draft-empty".into());
    }
    let heuristics = parse_heuristics(&heuristic_names)?;
    prepare_app_formula_boards(&mut boards, &topology, &heuristics);
    let policy = parse_policy(&policy_name)?;
    let schedule = tournament_schedule(boards.len(), reps, heuristics.len());
    let result = run(RunRequest {
        boards: &boards,
        topology: &topology,
        schedule: &schedule,
        heuristics: &heuristics,
        policy,
        policy_name: &policy_name,
        player_trading,
        seed,
        threads,
        allow_unofficial,
        out: &out,
        jsonl: jsonl.as_deref(),
    })?;
    println!(
        "completed {} games, illegal actions: {}",
        result.config.schedule_size, result.illegal_actions
    );
    Ok(())
}

fn evaluate_command(args: EvaluateArgs) -> Result<(), String> {
    let player_trading = args.trade.config();
    let layout = parse_layout(&args.layout)?;
    let seats = args
        .seats
        .unwrap_or(if layout == Layout::Standard4 { 4 } else { 6 });
    let domain = EvaluationDomain::parse(&args.domain)?;
    let parsed_arms = args
        .arm
        .iter()
        .map(|arm| parse_arm_spec(arm))
        .collect::<Result<Vec<_>, _>>()?;
    let mut labels = parsed_arms
        .iter()
        .map(|(label, _)| label.as_str())
        .collect::<Vec<_>>();
    labels.sort_unstable();
    if let Some(collision) = labels.windows(2).find(|pair| pair[0] == pair[1]) {
        return Err(format!("duplicate arm label {}", collision[0]));
    }
    let field = parse_heuristic(&args.field)?;
    let arms = parsed_arms
        .iter()
        .map(|(label, spec)| Ok((label.clone(), parse_heuristic(spec)?)))
        .collect::<Result<Vec<_>, String>>()?;
    let arm_specs = parsed_arms
        .iter()
        .map(|(_, spec)| spec.clone())
        .collect::<Vec<_>>();
    let mut arm_policies = vec![None; arms.len()];
    let mut arm_policy_names = vec![None; arms.len()];
    for override_spec in &args.arm_policy {
        let (label, policy_name) = parse_arm_spec(override_spec)?;
        let arm_index = arms
            .iter()
            .position(|(arm_label, _)| *arm_label == label)
            .ok_or_else(|| format!("arm policy {label} does not name an arm"))?;
        if arm_policies[arm_index].is_some() {
            return Err(format!("duplicate arm policy label {label}"));
        }
        arm_policies[arm_index] = Some(
            PolicyKind::parse(&policy_name)
                .ok_or_else(|| format!("unknown policy {policy_name}"))?,
        );
        arm_policy_names[arm_index] = Some(policy_name);
    }
    let policy = parse_policy(&args.policy)?;
    let started = Instant::now();
    let evaluation = evaluate(EvaluateRequest {
        layout,
        seats,
        domain,
        field_spec: &args.field,
        field,
        arms: &arms,
        arm_specs: &arm_specs,
        arm_policies: &arm_policies,
        arm_policy_names: &arm_policy_names,
        reference: args.reference.as_deref(),
        boards: args.boards,
        reps: args.reps,
        policy,
        policy_name: &args.policy,
        player_trading,
        threshold: args.threshold,
        alpha: args.alpha,
        threads: args.threads,
        allow_unofficial: args.allow_unofficial,
    })?;
    let elapsed = started.elapsed().as_secs_f64();
    let games = evaluation
        .config
        .units
        .checked_mul(evaluation.arms.len())
        .ok_or_else(|| "evaluation game count overflow".to_string())?;
    let meta = evaluation_meta(elapsed, games, args.threads);
    write_evaluation_outputs(&args.out, &evaluation, &meta)?;
    println!(
        "completed evaluation domain {} ({}) with {} arms, {} units, {} games, illegal actions: {}",
        evaluation.config.domain,
        evaluation.config.domain_seed,
        evaluation.arms.len(),
        evaluation.config.units,
        games,
        evaluation.illegal_actions
    );
    Ok(())
}

fn simulate(args: SimulateArgs) -> Result<(), String> {
    let player_trading = args.trade.config();
    let source = fs::read_to_string(&args.board).map_err(|error| error.to_string())?;
    let wire = WireBoard::parse_str(&source).map_err(|error| error.to_string())?;
    let topology = Topology::load(wire.layout)?;
    let mut board = SimBoard::try_from_wire(
        wire,
        &topology,
        &RuleConfig::base(topology.layout()),
        ConversionOptions {
            allow_unofficial: args.allow_unofficial,
        },
    )
    .map_err(|error| error.to_string())?;
    let heuristics = parse_heuristics(&args.heuristics)?;
    prepare_app_formula_boards(std::slice::from_mut(&mut board), &topology, &heuristics);
    let policy = parse_policy(&args.policy)?;
    let schedule = simulate_schedule(args.games, heuristics.len());
    run(RunRequest {
        boards: std::slice::from_ref(&board),
        topology: &topology,
        schedule: &schedule,
        heuristics: &heuristics,
        policy,
        policy_name: &args.policy,
        player_trading,
        seed: args.seed,
        threads: args.threads,
        allow_unofficial: args.allow_unofficial,
        out: &args.out,
        jsonl: None,
    })?;
    println!("completed {} games", args.games);
    Ok(())
}

fn bench(args: BenchArgs) -> Result<(), String> {
    let layout = parse_layout(&args.layout)?;
    let topology = Topology::load(layout)?;
    let board = generate_board(layout, if layout == Layout::Standard4 { 4 } else { 6 }, 1)?;
    let result = benchmark(&board, &topology, args.games, args.threads)?;
    println!("total games: {}", result.total_games);
    println!("elapsed seconds: {:.6}", result.elapsed_seconds);
    println!("physical cores: {}", result.physical_cores);
    println!("logical cores: {}", result.logical_cores);
    println!("configured workers: {}", result.workers);
    println!("single-core games/sec: {:.2}", result.single_core_rate);
    println!("all-core games/sec: {:.2}", result.all_core_rate);
    println!(
        "parallel efficiency: {:.2}%",
        result.parallel_efficiency() * 100.0
    );
    Ok(())
}

fn load_board(
    path: &Path,
    topology: &Topology,
    allow_unofficial: bool,
) -> Result<SimBoard, String> {
    let source = fs::read_to_string(path).map_err(|error| error.to_string())?;
    let wire = WireBoard::parse_str(&source).map_err(|error| error.to_string())?;
    SimBoard::try_from_wire(
        wire,
        topology,
        &RuleConfig::base(topology.layout()),
        ConversionOptions { allow_unofficial },
    )
    .map_err(|error| error.to_string())
}

fn parse_layout(name: &str) -> Result<Layout, String> {
    match name {
        "standard4" => Ok(Layout::Standard4),
        "extension6" => Ok(Layout::Extension6),
        _ => Err(format!("unknown layout {name}")),
    }
}

fn parse_heuristics(value: &str) -> Result<Vec<PlacementKind>, String> {
    let heuristics = value
        .split(',')
        .map(parse_heuristic)
        .collect::<Result<Vec<_>, _>>()?;
    if heuristics.is_empty() {
        return Err("at least one heuristic is required".into());
    }
    let mut names = heuristics
        .iter()
        .map(|kind| kind.name())
        .collect::<Vec<_>>();
    names.sort_unstable();
    if let Some(collision) = names.windows(2).find(|pair| pair[0] == pair[1]) {
        return Err(format!(
            "heuristic name collision: {} is used by multiple arms",
            collision[0]
        ));
    }
    Ok(heuristics)
}

fn parse_policy(value: &str) -> Result<PolicyKind, String> {
    PolicyKind::parse(value).ok_or_else(|| format!("unknown policy {value}"))
}
