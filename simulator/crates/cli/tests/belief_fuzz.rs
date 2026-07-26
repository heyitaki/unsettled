use unsettled_engine::game::{GameArena, GameConfig};
use unsettled_engine::placement::PlacementKind;
use unsettled_engine::policy::PolicyKind;
use unsettled_engine::rules::RuleConfig;
use unsettled_engine::topology::{Layout, Topology};
use unsettled_sim::boardgen::generate_board;

#[test]
fn random_legal_games_keep_belief_sound_ungated_on_both_layouts() {
    for layout in [Layout::Standard4, Layout::Extension6] {
        let seats = if layout == Layout::Standard4 { 4 } else { 6 };
        let topology = Topology::load(layout).unwrap();
        let rules = RuleConfig::base(layout);
        let mut arena = GameArena::default();
        let mut config = GameConfig {
            placements: [PlacementKind::Random; 6],
            policies: [PolicyKind::RandomLegal; 6],
            ..GameConfig::default()
        };
        for game in 0..100_u64 {
            let board = generate_board(layout, seats, 0xb311_3f00_2026_0000 ^ game).unwrap();
            config.seed =
                0xb311_3f00_5eed_0000 ^ ((layout == Layout::Extension6) as u64) << 32 ^ game;
            let result = arena.play(&board, &topology, &rules, &config);
            assert_eq!(result.illegal_actions, 0, "layout={layout:?}, game={game}");
            for seat in 0..seats {
                assert_eq!(
                    arena.state.belief.total(seat),
                    u32::from(arena.state.players[seat].hand_size()),
                    "layout={layout:?}, game={game}, seat={seat}"
                );
                assert!(
                    arena
                        .state
                        .belief
                        .contains(seat, &arena.state.players[seat].resources),
                    "layout={layout:?}, game={game}, seat={seat}"
                );
            }
        }
    }
}
