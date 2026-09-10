use std::fs;
use std::path::{Path, PathBuf};

use std::hint::black_box;
use std::time::Instant;

use serde::{Deserialize, Serialize};
use unsettled_engine::board::{ConversionOptions, SimBoard};
use unsettled_engine::game::{GameArena, GameConfig};
use unsettled_engine::policy::heuristic_v1::{self, HeuristicParams};
use unsettled_engine::policy::threat::ThreatParams;
use unsettled_engine::policy::{self, PolicyKind};
use unsettled_engine::rng::{Xoshiro256StarStar, mix64};
use unsettled_engine::rules::{Buildable, Resource, RuleConfig};
use unsettled_engine::topology::{Layout, Topology};
use unsettled_engine::view::{Action, ActionBuf, DecisionPhase, DevPlay, pips};
use unsettled_engine::wire::WireBoard;
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

fn equal_brick_pair(board: &SimBoard, topology: &Topology) -> (u8, u8) {
    for low in 0..topology.hex_count() {
        for high in low + 1..topology.hex_count() {
            let low = low as u8;
            let high = high as u8;
            if board.tiles()[usize::from(low)] == Some(Resource::Brick)
                && board.tiles()[usize::from(high)] == Some(Resource::Brick)
                && board.tokens()[usize::from(low)].map(pips)
                    == board.tokens()[usize::from(high)].map(pips)
                && !topology
                    .hex_vertices(low)
                    .iter()
                    .any(|vertex| topology.hex_vertices(high).contains(vertex))
            {
                return (low, high);
            }
        }
    }
    panic!("fixture needs two separated equal-pip brick hexes");
}

fn knight_fixture() -> (Topology, SimBoard, RuleConfig, GameArena) {
    let topology = Topology::load(Layout::Extension6).unwrap();
    let rules = RuleConfig::base(Layout::Extension6);
    let relative = PathBuf::from("src/parser/__tests__/expected/board-draft-empty.json");
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .map(|root| root.join(&relative))
        .find(|candidate| candidate.is_file())
        .expect("board fixture must be reachable from the worktree or sweep root");
    let wire = WireBoard::parse_str(&fs::read_to_string(path).unwrap()).unwrap();
    let board =
        SimBoard::try_from_wire(wire, &topology, &rules, ConversionOptions::default()).unwrap();
    let mut arena = GameArena::default();
    arena.prepare(&board, &topology, &rules, &GameConfig::default());
    (topology, board, rules, arena)
}

#[test]
#[ignore = "regenerates fixtures/robber-gate-baseline.json; run deliberately"]
fn generate_robber_gate_baseline() {
    let mut encoded =
        serde_json::to_string_pretty(&oracle_outcomes([PolicyKind::HeuristicV1; 6])).unwrap();
    encoded.push('\n');
    let path =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/robber-gate-baseline.json");
    fs::write(path, encoded).unwrap();
}

#[test]
fn heuristic_v1_outcomes_match_the_pre_change_oracle() {
    let expected: Vec<OracleOutcome> =
        serde_json::from_str(include_str!("../../../fixtures/robber-gate-baseline.json")).unwrap();
    assert_eq!(oracle_outcomes([PolicyKind::HeuristicV1; 6]), expected);
}

#[test]
fn threat_arm_changes_at_least_one_game_outcome() {
    let expected: Vec<OracleOutcome> =
        serde_json::from_str(include_str!("../../../fixtures/robber-gate-baseline.json")).unwrap();
    assert_ne!(
        oracle_outcomes([PolicyKind::HeuristicV1Threat; 6]),
        expected
    );
}

#[test]
fn threat_policy_games_are_legal_and_hold_invariants() {
    for layout in [Layout::Standard4, Layout::Extension6] {
        let seats = if layout == Layout::Standard4 { 4 } else { 6 };
        let topology = Topology::load(layout).unwrap();
        let rules = RuleConfig::base(layout);
        let mut arena = GameArena::default();
        let mut config = GameConfig {
            policies: [PolicyKind::HeuristicV1Threat; 6],
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

#[test]
fn threat_arm_rejoins_the_knight_score() {
    let (topology, board, _rules, mut arena) = knight_fixture();
    let (leader_hex, dangerous_hex) = equal_brick_pair(&board, &topology);
    for (hex, seat) in [(leader_hex, 1), (dangerous_hex, 2)] {
        let vertex = topology.hex_vertices(hex)[0];
        arena.state.vertex_owner[usize::from(vertex)] = seat;
        arena.state.vertex_tier[usize::from(vertex)] = 1;
    }
    arena.state.players[1].vp_public = 8;
    arena.state.players[1].pieces[Buildable::Settlement.index()] = 0;
    arena.state.players[1].pieces[Buildable::City.index()] = 0;
    arena.state.players[2].vp_public = 7;
    arena.state.players[1].resources = [2, 0, 0, 0, 0];
    arena.state.players[2].resources = [5, 0, 0, 0, 0];
    arena.state.belief.gain(1, Resource::Wood.index(), 2);
    arena.state.belief.gain(2, Resource::Wood.index(), 5);
    arena.state.players[0].playable_dev[0] = 2;
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    assert!(!view.knight_takes_largest_army());
    assert_ne!(view.hand_size(1).min(12), view.hand_size(2).min(12));

    let mut off = Box::new(ActionBuf::new());
    heuristic_v1::score_actions(&view, &HeuristicParams::default(), &mut off);
    let params = HeuristicParams {
        threat: Some(ThreatParams::default()),
        ..HeuristicParams::default()
    };
    let mut on = Box::new(ActionBuf::new());
    heuristic_v1::score_actions(&view, &params, &mut on);
    let knight = |actions: &ActionBuf| {
        actions
            .as_slice()
            .iter()
            .find_map(|scored| match scored.action {
                Action::PlayDev(DevPlay::Knight {
                    destination,
                    victim,
                }) => Some(((destination, victim), scored.score)),
                _ => None,
            })
            .unwrap()
    };
    let (off_pair, off_score) = knight(&off);
    let (on_pair, on_score) = knight(&on);
    // SIM-GAP-09 closed: the threat arm prices the pair it actually plays instead of the
    // frozen self-regarding baseline, so score and pair both move together.
    assert_ne!(off_score.to_bits(), on_score.to_bits());
    assert_ne!(off_pair, on_pair);

    for kind in [
        PolicyKind::HeuristicV1ThreatDenial,
        PolicyKind::HeuristicV1ThreatDevcardsDenial,
        PolicyKind::HeuristicV1TraderThreatDenial,
        PolicyKind::HeuristicV1TraderThreatDevcardsDenial,
        PolicyKind::HeuristicV1TraderAwareThreatDenial,
        PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenial,
    ] {
        let mut rng = Xoshiro256StarStar::from_seed(7);
        assert_eq!(policy::robber(kind, &view, &mut rng), on_pair, "{kind:?}");
    }
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
            let mut policies = match configuration {
                'A' => [PolicyKind::HeuristicV1; 6],
                'B' => [PolicyKind::HeuristicV1Threat; 6],
                'C' => [PolicyKind::HeuristicV1; 6],
                _ => unreachable!(),
            };
            if configuration == 'C' {
                policies[games % 4] = PolicyKind::HeuristicV1Threat;
            }
            let config = GameConfig {
                policies,
                seed,
                ..GameConfig::default()
            };
            black_box(arena.play(board, topology, rules, &config));
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
fn threat_arm_throughput_is_comparable() {
    let boards = oracle_boards();
    let topology = Topology::load(Layout::Standard4).unwrap();
    let rules = RuleConfig::base(Layout::Standard4);
    let mut arena = GameArena::default();
    for configuration in ['A', 'B', 'C'] {
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
        for (configuration_index, configuration) in ['A', 'B', 'C'].into_iter().enumerate() {
            rates[configuration_index][round] = play_window(
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
                rates[configuration_index][round]
            );
        }
    }
    let mut b_over_a = [0.0; 5];
    let mut c_over_a = [0.0; 5];
    for round in 0..5 {
        b_over_a[round] = rates[1][round] / rates[0][round];
        c_over_a[round] = rates[2][round] / rates[0][round];
        eprintln!(
            "round={} B/A={:.6} C/A={:.6}",
            round + 1,
            b_over_a[round],
            c_over_a[round]
        );
    }
    let median_b_over_a = median(b_over_a);
    let median_c_over_a = median(c_over_a);
    eprintln!("median(B/A)={median_b_over_a:.6} median(C/A)={median_c_over_a:.6}");
    assert!(median_b_over_a >= 0.50, "median(B/A)={median_b_over_a}");
    assert!(median_c_over_a >= 0.85, "median(C/A)={median_c_over_a}");
}

#[test]
fn threat_arm_knight_play_rate_is_reported() {
    let boards = oracle_boards();
    let topology = Topology::load(Layout::Standard4).unwrap();
    let rules = RuleConfig::base(Layout::Standard4);
    let mut arena = GameArena::default();
    let mut totals = [0_u64; 2];
    let mut games = 0_u64;
    for (board_index, board) in boards.iter().enumerate() {
        for seed in 0..12_u64 {
            let hero = (board_index * 12 + seed as usize) % 4;
            for (arm, policy) in [PolicyKind::HeuristicV1, PolicyKind::HeuristicV1Threat]
                .into_iter()
                .enumerate()
            {
                let mut policies = [PolicyKind::HeuristicV1; 6];
                policies[hero] = policy;
                let config = GameConfig {
                    policies,
                    seed,
                    ..GameConfig::default()
                };
                arena.play(board, &topology, &rules, &config);
                totals[arm] += u64::from(arena.state.players[hero].knights_played);
            }
            games += 1;
        }
    }
    let off_rate = totals[0] as f64 / games as f64;
    let on_rate = totals[1] as f64 / games as f64;
    eprintln!(
        "heroKnightRate heuristic-v1={off_rate:.6} heuristic-v1-threat={on_rate:.6} ratio={:.6}",
        on_rate / off_rate
    );
}
