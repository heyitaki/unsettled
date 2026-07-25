use std::fs;
use std::path::{Path, PathBuf};

use clap::{Args, Parser, Subcommand};
use serde::Deserialize;
use unsettled_engine::board::{ConversionOptions, SimBoard};
use unsettled_engine::placement::PlacementKind;
use unsettled_engine::policy::PolicyKind;
use unsettled_engine::rng::mix64;
use unsettled_engine::rules::RuleConfig;
use unsettled_engine::topology::{Layout, Topology};
use unsettled_engine::wire::WireBoard;
use unsettled_sim::boardgen::generate_board;
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

fn main() {
    if let Err(error) = execute(Cli::parse()) {
        eprintln!("error: {error}");
        std::process::exit(2);
    }
}

fn execute(cli: Cli) -> Result<(), String> {
    match cli.command {
        Command::Tournament(args) => tournament(args),
        Command::Simulate(args) => simulate(args),
        Command::Bench(args) => bench(args),
    }
}

fn tournament(args: TournamentArgs) -> Result<(), String> {
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
    let policy = parse_policy(&policy_name)?;
    let schedule = tournament_schedule(boards.len(), reps, heuristics.len());
    let result = run(RunRequest {
        boards: &boards,
        topology: &topology,
        schedule: &schedule,
        heuristics: &heuristics,
        policy,
        policy_name: &policy_name,
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

fn simulate(args: SimulateArgs) -> Result<(), String> {
    let source = fs::read_to_string(&args.board).map_err(|error| error.to_string())?;
    let wire = WireBoard::parse_str(&source).map_err(|error| error.to_string())?;
    let topology = Topology::load(wire.layout)?;
    let board = SimBoard::try_from_wire(
        wire,
        &topology,
        &RuleConfig::base(topology.layout()),
        ConversionOptions {
            allow_unofficial: args.allow_unofficial,
        },
    )
    .map_err(|error| error.to_string())?;
    let heuristics = parse_heuristics(&args.heuristics)?;
    let policy = parse_policy(&args.policy)?;
    let schedule = simulate_schedule(args.games, heuristics.len());
    run(RunRequest {
        boards: std::slice::from_ref(&board),
        topology: &topology,
        schedule: &schedule,
        heuristics: &heuristics,
        policy,
        policy_name: &args.policy,
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
        .map(|name| PlacementKind::parse(name).ok_or_else(|| format!("unknown heuristic {name}")))
        .collect::<Result<Vec<_>, _>>()?;
    if heuristics.is_empty() {
        return Err("at least one heuristic is required".into());
    }
    let mut unique = heuristics.clone();
    unique.sort_by_key(|kind| kind.name());
    unique.dedup();
    if unique.len() != heuristics.len() {
        return Err("heuristic names must be distinct".into());
    }
    Ok(heuristics)
}

fn parse_policy(value: &str) -> Result<PolicyKind, String> {
    PolicyKind::parse(value).ok_or_else(|| format!("unknown policy {value}"))
}
