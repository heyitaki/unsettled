use std::hint::black_box;
use std::time::Instant;

use serde::{Deserialize, Serialize};
use unsettled_engine::game::{GameArena, GameConfig};
use unsettled_engine::policy::PolicyKind;
use unsettled_engine::policy::heuristic_v1::HeuristicParams;
use unsettled_engine::rng::mix64;
use unsettled_engine::rules::RuleConfig;
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
fn the_four_gate_cells_produce_four_distinct_outcome_vectors() {
    let baseline = oracle_outcomes([PolicyKind::HeuristicV1; 6]);
    let threat = oracle_outcomes([PolicyKind::HeuristicV1Threat; 6]);
    let devcards = oracle_outcomes([PolicyKind::HeuristicV1Devcards; 6]);
    let both = oracle_outcomes([PolicyKind::HeuristicV1ThreatDevcards; 6]);
    let expected: Vec<OracleOutcome> =
        serde_json::from_str(include_str!("../../../fixtures/robber-gate-baseline.json")).unwrap();
    assert_eq!(baseline, expected);
    for (left_name, left, right_name, right) in [
        ("baseline", &baseline, "threat", &threat),
        ("baseline", &baseline, "devcards", &devcards),
        ("baseline", &baseline, "both", &both),
        ("threat", &threat, "devcards", &devcards),
        ("threat", &threat, "both", &both),
        ("devcards", &devcards, "both", &both),
    ] {
        assert_ne!(left, right, "{left_name} matched {right_name}");
    }
}

#[test]
fn devcards_gate_defaults_to_off() {
    assert!(HeuristicParams::default().dev_cards.is_none());
    assert!(HeuristicParams::default().threat.is_none());
}

#[test]
fn devcards_policy_games_are_legal_and_hold_invariants() {
    for layout in [Layout::Standard4, Layout::Extension6] {
        let seats = if layout == Layout::Standard4 { 4 } else { 6 };
        let topology = Topology::load(layout).unwrap();
        let rules = RuleConfig::base(layout);
        for policy in [
            PolicyKind::HeuristicV1Devcards,
            PolicyKind::HeuristicV1ThreatDevcards,
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
fn devcards_arm_knight_play_rate_is_reported() {
    let boards = oracle_boards();
    let topology = Topology::load(Layout::Standard4).unwrap();
    let rules = RuleConfig::base(Layout::Standard4);
    let mut arena = GameArena::default();
    let mut totals = [0_u64; 4];
    let mut games = 0_u64;
    for (board_index, board) in boards.iter().enumerate() {
        for seed in 0..25_u64 {
            let hero = (board_index * 25 + seed as usize) % 4;
            for (cell, policy) in [
                PolicyKind::HeuristicV1,
                PolicyKind::HeuristicV1Threat,
                PolicyKind::HeuristicV1Devcards,
                PolicyKind::HeuristicV1ThreatDevcards,
            ]
            .into_iter()
            .enumerate()
            {
                let mut policies = [PolicyKind::HeuristicV1; 6];
                policies[hero] = policy;
                arena.play(
                    board,
                    &topology,
                    &rules,
                    &GameConfig {
                        policies,
                        seed,
                        ..GameConfig::default()
                    },
                );
                totals[cell] += u64::from(arena.state.players[hero].knights_played);
            }
            games += 1;
        }
    }
    eprintln!("knight plays over {games} games: {totals:?}");
    assert!(totals.into_iter().all(|total| total > 0));
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
            let mut policies = [PolicyKind::HeuristicV1; 6];
            match configuration {
                'A' => {}
                'B' => policies[games % 4] = PolicyKind::HeuristicV1Devcards,
                'C' => policies[games % 4] = PolicyKind::HeuristicV1ThreatDevcards,
                'D' => policies = [PolicyKind::HeuristicV1Devcards; 6],
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
fn devcards_arm_throughput_is_comparable() {
    let boards = oracle_boards();
    let topology = Topology::load(Layout::Standard4).unwrap();
    let rules = RuleConfig::base(Layout::Standard4);
    let mut arena = GameArena::default();
    for configuration in ['A', 'B', 'C', 'D'] {
        black_box(play_window(
            &mut arena,
            &boards,
            &topology,
            &rules,
            configuration,
            0..25,
        ));
    }
    let mut rates = [[0.0; 5]; 4];
    for round in 0..5 {
        for (index, configuration) in ['A', 'B', 'C', 'D'].into_iter().enumerate() {
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
    let mut ratios = [[0.0; 5]; 3];
    for round in 0..5 {
        for arm in 0..3 {
            ratios[arm][round] = rates[arm + 1][round] / rates[0][round];
        }
    }
    let b = median(ratios[0]);
    let c = median(ratios[1]);
    let d = median(ratios[2]);
    eprintln!("median(B/A)={b:.6} median(C/A)={c:.6} median(D/A)={d:.6}");
    assert!(b >= 0.85, "median(B/A)={b}");
    assert!(c >= 0.80, "median(C/A)={c}");
    assert!(d >= 0.70, "median(D/A)={d}");
}
