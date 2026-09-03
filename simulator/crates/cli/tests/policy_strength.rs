use unsettled_engine::game::{GameArena, GameConfig};
use unsettled_engine::placement::PlacementKind;
use unsettled_engine::policy::PolicyKind;
use unsettled_engine::rng::{derive_evaluation_seed, mix64};
use unsettled_engine::rules::{Resource, RuleConfig};
use unsettled_engine::topology::{Layout, Topology};
use unsettled_sim::boardgen::generate_board;
use unsettled_sim::evaluate::{
    EVAL2_SEED, EVAL_SEED, GATE2_SEED, GATE_SEED, TUNING2_SEED, TUNING_SEED,
};
use unsettled_sim::stats::wilson95;

fn evaluate(hero: PolicyKind, baseline: PolicyKind, games: usize) -> (u64, f64) {
    let topology = Topology::load(Layout::Standard4).unwrap();
    let rules = RuleConfig::base(Layout::Standard4);
    let boards = (0..10)
        .map(|index| generate_board(Layout::Standard4, 4, mix64(EVAL_SEED ^ index)).unwrap())
        .collect::<Vec<_>>();
    let mut arena = GameArena::default();
    let mut wins = 0;
    for game in 0..games {
        let hero_seat = game % 4;
        let board_index = (game / 4) % boards.len();
        let rep = game / (4 * boards.len());
        let mut config = GameConfig::default();
        config.placements = [PlacementKind::MaxPips; 6];
        config.policies = [baseline; 6];
        config.policies[hero_seat] = hero;
        config.seed =
            derive_evaluation_seed(EVAL_SEED, board_index as u64, rep as u64, hero_seat as u64);
        let result = arena.play(&boards[board_index], &topology, &rules, &config);
        wins += u64::from(result.winner == Some(hero_seat as u8));
    }
    (wins, wins as f64 / games as f64)
}

#[test]
fn tuning_and_evaluation_seed_domains_are_disjoint() {
    let seeds = |domain| {
        (0..5)
            .flat_map(move |board| {
                (0..3).flat_map(move |rep| {
                    (0..4)
                        .map(move |hero_seat| derive_evaluation_seed(domain, board, rep, hero_seat))
                })
            })
            .collect::<std::collections::BTreeSet<_>>()
    };

    let boards = |domain, layout, seats| {
        (0..5)
            .map(|index| {
                let board = generate_board(layout, seats, mix64(domain ^ index)).unwrap();
                (
                    board.tiles().to_vec(),
                    board.tokens().to_vec(),
                    board.robber(),
                )
            })
            .collect::<Vec<(Vec<Option<Resource>>, Vec<Option<u8>>, u8)>>()
    };

    // Pairwise across all six domains, not just tuning/eval: a held-out domain only holds
    // its value as an unspent gate if it shares neither seed streams nor generated boards
    // with the domains tuning work is free to burn. Boards are compared on both layouts
    // because a domain that collided on only one of them would still leak through a run
    // there, and every domain is runnable on either.
    let domains = [
        ("tuning", TUNING_SEED),
        ("eval", EVAL_SEED),
        ("gate", GATE_SEED),
        ("tuning2", TUNING2_SEED),
        ("eval2", EVAL2_SEED),
        ("gate2", GATE2_SEED),
    ];
    let layouts = [(Layout::Standard4, 4), (Layout::Extension6, 6)];
    for (index, (left_name, left)) in domains.iter().enumerate() {
        for (right_name, right) in &domains[index + 1..] {
            assert_ne!(left, right, "{left_name} and {right_name} share a seed");
            assert!(
                seeds(*left).is_disjoint(&seeds(*right)),
                "{left_name} and {right_name} share evaluation seeds"
            );
            for (layout, seats) in layouts {
                assert_ne!(
                    boards(*left, layout, seats),
                    boards(*right, layout, seats),
                    "{left_name} and {right_name} generate the same {layout:?} boards"
                );
            }
        }
    }
}

#[test]
fn priority_trader_is_calibrated_against_both_baselines() {
    let (random_wins, random_rate) =
        evaluate(PolicyKind::PriorityTrader, PolicyKind::RandomLegal, 400);
    eprintln!("priority-trader vs random-legal: {random_wins}/400 = {random_rate:.4}");
    assert!(random_rate >= 0.85);

    let (greedy_wins, greedy_rate) =
        evaluate(PolicyKind::PriorityTrader, PolicyKind::GreedyNoTrade, 1_000);
    let lower = wilson95(greedy_wins, 1_000)[0];
    eprintln!(
        "priority-trader vs greedy-no-trade: {greedy_wins}/1000 = {greedy_rate:.4}, Wilson lower = {lower:.4}"
    );
    assert!(lower > 0.25);
}

#[test]
fn heuristic_v1_clears_all_predeclared_superiority_gates() {
    let (random_wins, random_rate) =
        evaluate(PolicyKind::HeuristicV1, PolicyKind::RandomLegal, 400);
    eprintln!("heuristic-v1 vs random-legal: {random_wins}/400 = {random_rate:.4}");
    assert!(random_rate >= 0.90);

    let (greedy_wins, greedy_rate) =
        evaluate(PolicyKind::HeuristicV1, PolicyKind::GreedyNoTrade, 1_000);
    eprintln!("heuristic-v1 vs greedy-no-trade: {greedy_wins}/1000 = {greedy_rate:.4}");
    assert!(greedy_rate > 0.375);

    let (priority_wins, priority_rate) =
        evaluate(PolicyKind::HeuristicV1, PolicyKind::PriorityTrader, 2_000);
    let lower = wilson95(priority_wins, 2_000)[0];
    eprintln!(
        "heuristic-v1 vs priority-trader: {priority_wins}/2000 = {priority_rate:.4}, Wilson lower = {lower:.4}"
    );
    assert!(lower >= 0.30);
}
