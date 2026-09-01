use unsettled_engine::game::{
    GameArena, GameConfig, SetupPick, can_place_settlement, setup_order,
};
use unsettled_engine::rng::mix64;
use unsettled_engine::rules::RuleConfig;
use unsettled_engine::state::EMPTY;
use unsettled_engine::topology::{Layout, Topology};

#[path = "../../cli/src/boardgen.rs"]
mod boardgen;

const TUNING_SEED: u64 = 0x7a11_1e5e_ed20_2607;

fn cases() -> [(Layout, usize); 2] {
    [(Layout::Standard4, 4), (Layout::Extension6, 6)]
}

#[test]
fn trace_records_every_setup_pick_in_snake_order() {
    for (layout, seats) in cases() {
        let topology = Topology::load(layout).unwrap();
        let rules = RuleConfig::base(layout);
        for game in 0..8_u64 {
            let seed = mix64(TUNING_SEED ^ game);
            let board = boardgen::generate_board(layout, seats, seed).unwrap();
            assert!(board.buildings().is_empty() && board.roads().is_empty());
            let config = GameConfig {
                seed,
                ..GameConfig::default()
            };

            let mut arena = GameArena::default();
            let mut trace = Vec::new();
            arena.play_traced(&board, &topology, &rules, &config, &mut trace);

            assert_eq!(trace.len(), 2 * seats);
            let seats_picked: Vec<u8> = trace.iter().map(|pick| pick.seat).collect();
            assert_eq!(seats_picked, setup_order(seats));
            for (index, pick) in trace.iter().enumerate() {
                // The second round is the one that grants resources, so both fields follow the
                // same split of the trace.
                let round = u8::from(index >= seats);
                assert_eq!(pick.pick, round);
                assert_eq!(pick.grant, round == 1);
            }
        }
    }
}

/// Replaying the trace onto empty owner arrays has to land exactly where setup landed, which is
/// what makes the trace usable as the input to a placement diagnostic.
#[test]
fn replaying_the_trace_reproduces_setup_ownership() {
    for (layout, seats) in cases() {
        let topology = Topology::load(layout).unwrap();
        let rules = RuleConfig::base(layout);
        for game in 0..8_u64 {
            let seed = mix64(TUNING_SEED ^ game ^ (1 << 33));
            let board = boardgen::generate_board(layout, seats, seed).unwrap();
            let config = GameConfig {
                seed,
                ..GameConfig::default()
            };

            let mut arena = GameArena::default();
            let mut trace = Vec::new();
            arena.play_traced(&board, &topology, &rules, &config, &mut trace);

            let mut vertex_owner = vec![EMPTY; topology.vertex_count()];
            let mut edge_owner = vec![EMPTY; topology.edge_count()];
            for pick in &trace {
                assert!(can_place_settlement(&topology, &vertex_owner, pick.vertex));
                assert!(topology.edge_endpoints(pick.edge).contains(&pick.vertex));
                assert_eq!(edge_owner[usize::from(pick.edge)], EMPTY);
                vertex_owner[usize::from(pick.vertex)] = pick.seat;
                edge_owner[usize::from(pick.edge)] = pick.seat;
            }

            // A second arena stopped right after setup is the reference: same board, same seed,
            // no trace.
            let mut reference = GameArena::default();
            reference.prepare(&board, &topology, &rules, &config);
            reference.setup_for_test(&board, &topology, &rules, &config);
            assert_eq!(
                vertex_owner.as_slice(),
                &reference.state.vertex_owner[..topology.vertex_count()]
            );
            assert_eq!(
                edge_owner.as_slice(),
                &reference.state.edge_owner[..topology.edge_count()]
            );
        }
    }
}

/// The trace only observes: it must not consume an RNG draw, reorder a decision, or change a
/// score. The corpus diff proves this across the whole behaviour surface; this pins it in the
/// suite so a later edit to the trace hook cannot slip through.
#[test]
fn tracing_does_not_move_the_game() {
    for (layout, seats) in cases() {
        let topology = Topology::load(layout).unwrap();
        let rules = RuleConfig::base(layout);
        for game in 0..8_u64 {
            let seed = mix64(TUNING_SEED ^ game ^ (1 << 34));
            let board = boardgen::generate_board(layout, seats, seed).unwrap();
            let config = GameConfig {
                seed,
                ..GameConfig::default()
            };

            let mut traced = GameArena::default();
            let mut trace: Vec<SetupPick> = Vec::new();
            let traced_result = traced.play_traced(&board, &topology, &rules, &config, &mut trace);

            let mut plain = GameArena::default();
            let plain_result = plain.play(&board, &topology, &rules, &config);

            assert_eq!(traced_result.winner, plain_result.winner);
            assert_eq!(traced_result.vp, plain_result.vp);
            assert_eq!(traced_result.turns, plain_result.turns);
            assert_eq!(traced_result.draw, plain_result.draw);
            assert_eq!(traced_result.illegal_actions, plain_result.illegal_actions);
            assert_eq!(
                traced.state.vertex_owner[..topology.vertex_count()],
                plain.state.vertex_owner[..topology.vertex_count()]
            );
            assert_eq!(
                traced.state.edge_owner[..topology.edge_count()],
                plain.state.edge_owner[..topology.edge_count()]
            );
        }
    }
}
