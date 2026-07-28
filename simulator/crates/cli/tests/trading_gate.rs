use std::fs::{self, OpenOptions};
use std::hint::black_box;
use std::io::{ErrorKind, Write};
use std::path::Path;
use std::time::Instant;

use serde::{Deserialize, Serialize};
use unsettled_engine::game::{GameArena, GameConfig};
use unsettled_engine::policy::PolicyKind;
use unsettled_engine::rng::mix64;
use unsettled_engine::rules::{RuleConfig, TradeConfig};
use unsettled_engine::topology::{Layout, Topology};
use unsettled_sim::boardgen::generate_board;
use unsettled_sim::evaluate::TUNING_SEED;

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct OracleOutcome {
    board: usize,
    seed: u64,
    winner: Option<u8>,
    turns: u16,
    vp: [u8; 6],
    illegal_actions: u32,
}

fn oracle_boards() -> Vec<unsettled_engine::board::SimBoard> {
    (0..4)
        .map(|index| {
            generate_board(Layout::Standard4, 4, mix64(TUNING_SEED ^ index as u64)).unwrap()
        })
        .collect()
}

fn oracle_outcomes(policies: [PolicyKind; 6]) -> Vec<OracleOutcome> {
    oracle_outcomes_with_trading(policies, true)
}

fn oracle_outcomes_with_trading(
    policies: [PolicyKind; 6],
    player_trading: bool,
) -> Vec<OracleOutcome> {
    let topology = Topology::load(Layout::Standard4).unwrap();
    let mut rules = RuleConfig::base(Layout::Standard4);
    rules.player_trading = player_trading.then(TradeConfig::default);
    let mut arena = GameArena::default();
    let mut outcomes = Vec::new();
    for (board_index, board) in oracle_boards().iter().enumerate() {
        for seed in 0..12 {
            let config = GameConfig {
                policies,
                seed,
                ..GameConfig::default()
            };
            let result = arena.play(board, &topology, &rules, &config);
            outcomes.push(OracleOutcome {
                board: board_index,
                seed,
                winner: result.winner,
                turns: result.turns,
                vp: result.vp,
                illegal_actions: result.illegal_actions,
            });
        }
    }
    outcomes
}

#[test]
fn trading_gate_off_is_corpus_identical() {
    let expected: Vec<OracleOutcome> =
        serde_json::from_str(include_str!("../../../fixtures/trading-gate-baseline.json")).unwrap();
    assert_eq!(
        oracle_outcomes([PolicyKind::HeuristicV1Trader; 6]),
        expected
    );
}

#[test]
fn the_trading_gate_cells_produce_distinct_outcome_vectors() {
    let baseline = oracle_outcomes([PolicyKind::HeuristicV1Trader; 6]);
    let aware = oracle_outcomes([PolicyKind::HeuristicV1TraderAware; 6]);
    let disabled = oracle_outcomes_with_trading([PolicyKind::HeuristicV1Trader; 6], false);
    assert_ne!(baseline, aware);
    assert_ne!(baseline, disabled);
    assert_ne!(aware, disabled);
}

#[test]
fn trading_gate_defaults_to_off() {
    let params = unsettled_engine::policy::heuristic_v1::HeuristicParams::default();
    assert!(params.threat.is_none());
    assert!(params.dev_cards.is_none());
    assert!(params.trading.is_none());
}

#[test]
fn trading_policy_games_are_legal_and_hold_invariants() {
    for layout in [Layout::Standard4, Layout::Extension6] {
        let seats = if layout == Layout::Standard4 { 4 } else { 6 };
        let topology = Topology::load(layout).unwrap();
        let mut rules = RuleConfig::base(layout);
        rules.player_trading = Some(TradeConfig::default());
        for policy in [
            PolicyKind::HeuristicV1TraderAware,
            PolicyKind::HeuristicV1TraderAwareThreat,
            PolicyKind::HeuristicV1TraderAwareDevcards,
            PolicyKind::HeuristicV1TraderAwareThreatDevcards,
        ] {
            let mut arena = GameArena::default();
            let mut config = GameConfig {
                policies: [policy; 6],
                ..GameConfig::default()
            };
            for game in 0..100_u64 {
                let board = generate_board(layout, seats, mix64(TUNING_SEED ^ game)).unwrap();
                config.seed = TUNING_SEED ^ ((layout == Layout::Extension6) as u64) << 32 ^ game;
                let result = arena.play(&board, &topology, &rules, &config);
                assert_eq!(result.illegal_actions, 0, "layout={layout:?}, game={game}");
                assert!(
                    arena.invariants_hold(&board, &topology, &rules),
                    "layout={layout:?}, game={game}"
                );
            }
        }
    }
}

#[test]
fn trading_arm_outcome_shift_is_reported() {
    let baseline = oracle_outcomes([PolicyKind::HeuristicV1Trader; 6]);
    let aware = oracle_outcomes([PolicyKind::HeuristicV1TraderAware; 6]);
    let changed = baseline
        .iter()
        .zip(&aware)
        .filter(|(left, right)| left != right)
        .count();
    eprintln!(
        "trading gate changed {changed}/{} oracle outcomes",
        baseline.len()
    );
    assert!(changed >= 1);
}

fn play_window(
    arena: &mut GameArena,
    boards: &[unsettled_engine::board::SimBoard],
    topology: &Topology,
    rules: &RuleConfig,
    configuration: char,
    seeds: std::ops::Range<u64>,
) -> f64 {
    let started = Instant::now();
    let mut games = 0_usize;
    for seed in seeds {
        for board in boards {
            let mut policies = [PolicyKind::HeuristicV1Trader; 6];
            match configuration {
                'A' => {}
                'B' => policies[games % 4] = PolicyKind::HeuristicV1TraderAware,
                'D' => policies = [PolicyKind::HeuristicV1TraderAware; 6],
                _ => unreachable!(),
            }
            black_box(arena.play(
                board,
                topology,
                rules,
                &GameConfig {
                    policies,
                    seed,
                    ..GameConfig::default()
                },
            ));
            games += 1;
        }
    }
    games as f64 / started.elapsed().as_secs_f64()
}

fn median(mut values: [f64; 5]) -> f64 {
    values.sort_by(f64::total_cmp);
    values[2]
}

#[test]
#[ignore = "single-threaded throughput gate; run deliberately on a quiet machine"]
fn trading_arm_throughput_is_comparable() {
    let boards = oracle_boards();
    let topology = Topology::load(Layout::Standard4).unwrap();
    let mut rules = RuleConfig::base(Layout::Standard4);
    rules.player_trading = Some(TradeConfig::default());
    let mut arena = GameArena::default();
    for configuration in ['A', 'B', 'D'] {
        black_box(play_window(
            &mut arena,
            &boards,
            &topology,
            &rules,
            configuration,
            0..25,
        ));
    }
    let mut rates = [[0.0; 5]; 3];
    for round in 0..5 {
        for (index, configuration) in ['A', 'B', 'D'].into_iter().enumerate() {
            rates[index][round] = play_window(
                &mut arena,
                &boards,
                &topology,
                &rules,
                configuration,
                100..350,
            );
            eprintln!(
                "round={} config={} gamesPerSecond={:.6}",
                round + 1,
                configuration,
                rates[index][round]
            );
        }
    }
    let b = median(std::array::from_fn(|round| {
        rates[1][round] / rates[0][round]
    }));
    let d = median(std::array::from_fn(|round| {
        rates[2][round] / rates[0][round]
    }));
    eprintln!("median(B/A)={b:.6} median(D/A)={d:.6}");
    assert!(b >= 0.50, "median(B/A)={b}");
    assert!(d >= 0.70, "median(D/A)={d}");
}

#[test]
#[ignore = "regenerates fixtures/trading-gate-baseline.json; run deliberately"]
fn generate_trading_gate_baseline() {
    let mut encoded =
        serde_json::to_string_pretty(&oracle_outcomes([PolicyKind::HeuristicV1Trader; 6])).unwrap();
    encoded.push('\n');
    let target =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/trading-gate-baseline.json");
    match OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&target)
    {
        Ok(mut file) => {
            file.write_all(encoded.as_bytes()).unwrap();
            file.sync_all().unwrap();
            println!("PUBLISHED {}", target.display());
        }
        Err(error) if error.kind() == ErrorKind::AlreadyExists => {
            let existing = fs::read(&target).unwrap();
            if existing.is_empty() {
                panic!(
                    "REFUSED: target exists and is EMPTY (a distinct state from absent): {}",
                    target.display()
                );
            } else if existing == encoded.as_bytes() {
                println!("IDENTICAL {}", target.display());
            } else {
                panic!(
                    "REFUSED: target exists and DIFFERS; publishing would destroy it: {}",
                    target.display()
                );
            }
        }
        Err(error) => panic!("REFUSED: {error}"),
    }
}
