use std::fs::{self, OpenOptions};
use std::hint::black_box;
use std::io::{ErrorKind, Write};
use std::path::Path;
use std::time::Instant;

use serde::{Deserialize, Serialize};
use unsettled_engine::game::{GameArena, GameConfig};
use unsettled_engine::policy::denial::DenialParams;
use unsettled_engine::policy::heuristic_v1::{self, HeuristicParams};
use unsettled_engine::policy::{PolicyKind, PolicyScratch};
use unsettled_engine::rng::{Xoshiro256StarStar, mix64};
use unsettled_engine::rules::RuleConfig;
use unsettled_engine::topology::{Layout, Topology};
use unsettled_engine::view::DecisionPhase;
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
    let topology = Topology::load(Layout::Standard4).unwrap();
    let rules = RuleConfig::base(Layout::Standard4);
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
fn denial_gate_off_is_corpus_identical() {
    let expected: Vec<OracleOutcome> =
        serde_json::from_str(include_str!("../../../fixtures/denial-gate-baseline.json")).unwrap();
    assert_eq!(oracle_outcomes([PolicyKind::HeuristicV1; 6]), expected);
}

#[test]
fn the_denial_gate_cells_produce_distinct_outcome_vectors() {
    assert_ne!(
        oracle_outcomes([PolicyKind::HeuristicV1; 6]),
        oracle_outcomes([PolicyKind::HeuristicV1Denial; 6])
    );
}

#[test]
fn denial_defaults_to_off() {
    let params = unsettled_engine::policy::heuristic_v1::HeuristicParams::default();
    assert!(params.threat.is_none());
    assert!(params.dev_cards.is_none());
    assert!(params.trading.is_none());
    assert!(params.denial.is_none());
}

#[test]
fn denial_policy_games_are_legal_and_hold_invariants() {
    for layout in [Layout::Standard4, Layout::Extension6] {
        let seats = if layout == Layout::Standard4 { 4 } else { 6 };
        let topology = Topology::load(layout).unwrap();
        let rules = RuleConfig::base(layout);
        for policy in [
            PolicyKind::HeuristicV1Denial,
            PolicyKind::HeuristicV1ThreatDenial,
            PolicyKind::HeuristicV1DevcardsDenial,
            PolicyKind::HeuristicV1ThreatDevcardsDenial,
            PolicyKind::HeuristicV1TraderDenial,
            PolicyKind::HeuristicV1TraderThreatDenial,
            PolicyKind::HeuristicV1TraderDevcardsDenial,
            PolicyKind::HeuristicV1TraderThreatDevcardsDenial,
            PolicyKind::HeuristicV1TraderAwareDenial,
            PolicyKind::HeuristicV1TraderAwareThreatDenial,
            PolicyKind::HeuristicV1TraderAwareDevcardsDenial,
            PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenial,
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
fn denial_arm_outcome_shift_is_reported() {
    let baseline = oracle_outcomes([PolicyKind::HeuristicV1; 6]);
    let denial = oracle_outcomes([PolicyKind::HeuristicV1Denial; 6]);
    let changed = baseline
        .iter()
        .zip(&denial)
        .filter(|(left, right)| left != right)
        .count();
    eprintln!(
        "denial gate changed {changed}/{} oracle outcomes",
        baseline.len()
    );
}

#[test]
#[ignore = "single-threaded observation; run deliberately on a quiet machine"]
fn denial_arm_per_decision_cost_is_reported() {
    let topology = Topology::load(Layout::Standard4).unwrap();
    let mut rules = RuleConfig::base(Layout::Standard4);
    rules.turn_cap = 20;
    let board = generate_board(Layout::Standard4, 4, TUNING_SEED).unwrap();
    let mut arena = GameArena::default();
    arena.play(
        &board,
        &topology,
        &rules,
        &GameConfig {
            policies: [PolicyKind::HeuristicV1; 6],
            seed: TUNING_SEED,
            ..GameConfig::default()
        },
    );
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    const DECISIONS: u64 = 50_000;
    for (policy, params) in [
        (PolicyKind::HeuristicV1, HeuristicParams::default()),
        (
            PolicyKind::HeuristicV1Denial,
            HeuristicParams {
                denial: Some(DenialParams::default()),
                ..HeuristicParams::default()
            },
        ),
    ] {
        let mut scratch = PolicyScratch::default();
        let mut rng = Xoshiro256StarStar::from_seed(TUNING_SEED);
        let started = Instant::now();
        for _ in 0..DECISIONS {
            black_box(heuristic_v1::action(&view, &mut scratch, &params, &mut rng));
        }
        eprintln!(
            "policy={policy:?} decisions={DECISIONS} nsPerDecision={:.3}",
            started.elapsed().as_nanos() as f64 / DECISIONS as f64
        );
    }
}

#[test]
#[ignore = "regenerates fixtures/denial-gate-baseline.json; run deliberately"]
fn generate_denial_gate_baseline() {
    let mut encoded =
        serde_json::to_string_pretty(&oracle_outcomes([PolicyKind::HeuristicV1; 6])).unwrap();
    encoded.push('\n');
    let target =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/denial-gate-baseline.json");
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
