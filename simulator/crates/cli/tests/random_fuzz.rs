use unsettled_engine::game::{GameArena, GameConfig};
use unsettled_engine::placement::PlacementKind;
use unsettled_engine::policy::PolicyKind;
use unsettled_engine::rules::RuleConfig;
use unsettled_engine::topology::{Layout, Topology};
use unsettled_sim::boardgen::generate_board;

#[test]
fn random_legal_fuzz_preserves_game_invariants_on_both_layouts() {
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
            let board = generate_board(layout, seats, 0xf022_2026_0724_0000 ^ game).unwrap();
            config.seed =
                0xf022_5eed_0000_0000 ^ ((layout == Layout::Extension6) as u64) << 32 ^ game;
            let result = arena.play(&board, &topology, &rules, &config);
            assert_eq!(result.illegal_actions, 0, "layout={layout:?}, game={game}");
            assert!(
                arena.invariants_hold(&board, &topology, &rules),
                "layout={layout:?}, game={game}"
            );
        }
    }
}
