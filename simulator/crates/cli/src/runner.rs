use std::fs::{self, File};
use std::io::{BufWriter, Write};
use std::path::Path;
use std::process::Command;
use std::time::Instant;

use rayon::prelude::*;
use unsettled_engine::board::SimBoard;
use unsettled_engine::game::{GameArena, GameConfig, GameResult};
use unsettled_engine::placement::PlacementKind;
use unsettled_engine::policy::PolicyKind;
use unsettled_engine::rng::derive_game_seed;
use unsettled_engine::rules::RuleConfig;
use unsettled_engine::topology::Topology;

use crate::output::{Meta, ResultConfig, Results, write_outputs};
use crate::schedule::ScheduleEntry;
use crate::stats::aggregate;

pub struct RunRequest<'a> {
    pub boards: &'a [SimBoard],
    pub topology: &'a Topology,
    pub schedule: &'a [ScheduleEntry],
    pub heuristics: &'a [PlacementKind],
    pub policy: PolicyKind,
    pub policy_name: &'a str,
    pub seed: u64,
    pub threads: usize,
    pub allow_unofficial: bool,
    pub out: &'a Path,
    pub jsonl: Option<&'a Path>,
}

pub fn run(request: RunRequest<'_>) -> Result<Results, String> {
    if request.boards.is_empty() || request.heuristics.is_empty() {
        return Err("at least one board and heuristic are required".into());
    }
    let seats = request.boards[0].seats();
    if request.boards.iter().any(|board| board.seats() != seats) {
        return Err("all boards in one run must have the same seat count".into());
    }
    let rules = RuleConfig::base(request.topology.layout());
    let workers = if request.threads == 0 {
        num_cpus::get()
    } else {
        request.threads
    }
    .max(1);
    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(workers)
        .build()
        .map_err(|error| error.to_string())?;
    let started = Instant::now();
    let games: Vec<GameResult> = pool.install(|| {
        request
            .schedule
            .par_iter()
            .map_init(GameArena::default, |arena, entry| {
                let mut config = GameConfig::default();
                for seat in 0..seats {
                    config.placements[seat] =
                        request.heuristics[(seat + entry.rotation) % request.heuristics.len()];
                    config.policies[seat] = request.policy;
                }
                config.seed = derive_game_seed(request.seed, entry.board as u64, entry.rep as u64);
                arena.play(
                    &request.boards[entry.board],
                    request.topology,
                    &rules,
                    &config,
                )
            })
            .collect()
    });
    let elapsed = started.elapsed().as_secs_f64();
    let (heuristics, head_to_head) = aggregate(request.schedule, &games, request.heuristics, seats);
    let illegal_actions = games
        .iter()
        .map(|game| u64::from(game.illegal_actions))
        .sum();
    let results = Results {
        config: ResultConfig {
            layout: request.topology.layout().as_str().to_string(),
            policy: request.policy_name.to_string(),
            seed: request.seed,
            schedule_size: request.schedule.len(),
            allow_unofficial: request.allow_unofficial,
        },
        heuristics,
        head_to_head,
        illegal_actions,
    };
    if let Some(path) = request.jsonl {
        if let Some(parent) = path
            .parent()
            .filter(|parent| !parent.as_os_str().is_empty())
        {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let file = File::create(path).map_err(|error| error.to_string())?;
        let mut writer = BufWriter::new(file);
        for (entry, result) in request.schedule.iter().zip(&games) {
            let placements: Vec<_> = (0..seats)
                .map(|seat| {
                    request.heuristics[(seat + entry.rotation) % request.heuristics.len()].name()
                })
                .collect();
            serde_json::to_writer(
                &mut writer,
                &serde_json::json!({
                    "board": entry.board,
                    "rep": entry.rep,
                    "rotation": entry.rotation,
                    "placements": placements,
                    "result": result,
                }),
            )
            .map_err(|error| error.to_string())?;
            writer.write_all(b"\n").map_err(|error| error.to_string())?;
        }
        writer.flush().map_err(|error| error.to_string())?;
    }
    let meta = Meta {
        elapsed_seconds: elapsed,
        games_per_second: request.schedule.len() as f64 / elapsed,
        threads: workers,
        rust_version: rust_version(),
        simulator_version: env!("CARGO_PKG_VERSION").into(),
    };
    write_outputs(request.out, &results, &meta)?;
    Ok(results)
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

pub fn benchmark(
    board: &SimBoard,
    topology: &Topology,
    games: usize,
    threads: usize,
) -> Result<BenchResult, String> {
    let rules = RuleConfig::base(topology.layout());
    let sample = games.min(2_000).max(1);
    let mut arena = GameArena::default();
    let mut config = GameConfig::default();
    for seed in 0..50 {
        config.seed = seed;
        arena.play(board, topology, &rules, &config);
    }
    let single_started = Instant::now();
    for seed in 0..sample {
        config.seed = seed as u64;
        arena.play(board, topology, &rules, &config);
    }
    let single_elapsed = single_started.elapsed().as_secs_f64();
    let workers = if threads == 0 {
        num_cpus::get()
    } else {
        threads
    }
    .max(1);
    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(workers)
        .build()
        .map_err(|error| error.to_string())?;
    let all_started = Instant::now();
    pool.install(|| {
        (0..games)
            .into_par_iter()
            .for_each_init(GameArena::default, |arena, seed| {
                let mut game = GameConfig::default();
                game.seed = seed as u64;
                arena.play(board, topology, &rules, &game);
            });
    });
    let all_elapsed = all_started.elapsed().as_secs_f64();
    Ok(BenchResult {
        total_games: games,
        elapsed_seconds: all_elapsed,
        physical_cores: num_cpus::get_physical(),
        logical_cores: num_cpus::get(),
        workers,
        single_core_rate: sample as f64 / single_elapsed,
        all_core_rate: games as f64 / all_elapsed,
    })
}

pub struct BenchResult {
    pub total_games: usize,
    pub elapsed_seconds: f64,
    pub physical_cores: usize,
    pub logical_cores: usize,
    pub workers: usize,
    pub single_core_rate: f64,
    pub all_core_rate: f64,
}

impl BenchResult {
    pub fn parallel_efficiency(&self) -> f64 {
        self.all_core_rate
            / (self.single_core_rate * self.workers.min(self.physical_cores).max(1) as f64)
    }
}
