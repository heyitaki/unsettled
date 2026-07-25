use unsettled_engine::game::{GameArena, GameConfig};
use unsettled_engine::placement::PlacementKind;
use unsettled_engine::policy::PolicyKind;
use unsettled_engine::rng::{derive_game_seed, mix64};
use unsettled_engine::rules::RuleConfig;
use unsettled_engine::topology::{Layout, Topology};
use unsettled_sim::boardgen::generate_board;
use unsettled_sim::schedule::tournament_schedule;

const HEURISTICS: [PlacementKind; 6] = [
    PlacementKind::MaxPips,
    PlacementKind::PipDiversity,
    PlacementKind::PipScarcity,
    PlacementKind::PortSynergy,
    PlacementKind::CityFocus,
    PlacementKind::Random,
];

fn ranking(policy: PolicyKind) -> Vec<PlacementKind> {
    let topology = Topology::load(Layout::Standard4).unwrap();
    let rules = RuleConfig::base(Layout::Standard4);
    let boards = (0..20)
        .map(|index| generate_board(Layout::Standard4, 4, mix64(42 ^ index)).unwrap())
        .collect::<Vec<_>>();
    let schedule = tournament_schedule(boards.len(), 10, HEURISTICS.len());
    let mut wins = [0_u64; 6];
    let mut arena = GameArena::default();
    for entry in schedule {
        let mut config = GameConfig::default();
        for seat in 0..4 {
            config.placements[seat] = HEURISTICS[(seat + entry.rotation) % HEURISTICS.len()];
            config.policies[seat] = policy;
        }
        config.seed = derive_game_seed(42, entry.board as u64, entry.rep as u64);
        let result = arena.play(&boards[entry.board], &topology, &rules, &config);
        if let Some(winner) = result.winner {
            wins[(usize::from(winner) + entry.rotation) % HEURISTICS.len()] += 1;
        }
    }
    let mut ranking = HEURISTICS.to_vec();
    ranking.sort_by_key(|kind| {
        let index = HEURISTICS
            .iter()
            .position(|candidate| candidate == kind)
            .unwrap();
        std::cmp::Reverse(wins[index])
    });
    ranking
}

fn spearman(first: &[PlacementKind], second: &[PlacementKind]) -> f64 {
    let squared_difference: usize = first
        .iter()
        .enumerate()
        .map(|(rank, heuristic)| {
            let other = second
                .iter()
                .position(|candidate| candidate == heuristic)
                .unwrap();
            rank.abs_diff(other).pow(2)
        })
        .sum();
    let n = first.len() as f64;
    1.0 - 6.0 * squared_difference as f64 / (n * (n * n - 1.0))
}

#[test]
fn top_placements_are_stable_across_post_placement_policies() {
    let rankings = [
        ranking(PolicyKind::HeuristicV1),
        ranking(PolicyKind::HeuristicV1Noports),
        ranking(PolicyKind::PriorityTrader),
    ];
    for (index, ranking) in rankings.iter().enumerate() {
        eprintln!("ranking {index}: {ranking:?}");
    }
    let mut expected_top = rankings[0][..2].to_vec();
    expected_top.sort_by_key(|kind| kind.name());
    for ranking in &rankings[1..] {
        let mut top = ranking[..2].to_vec();
        top.sort_by_key(|kind| kind.name());
        assert_eq!(top, expected_top);
    }
    for left in 0..rankings.len() {
        for right in left + 1..rankings.len() {
            let rho = spearman(&rankings[left], &rankings[right]);
            eprintln!("ranking Spearman rho {left}/{right}: {rho:.4}");
            assert!(rho >= 0.7);
        }
    }
}
