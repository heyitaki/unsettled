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

fn ranking(policy: PolicyKind) -> (Vec<PlacementKind>, [u64; 6]) {
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
    (ranking, wins)
}

fn wins_for(kind: PlacementKind, wins: &[u64; 6]) -> u64 {
    wins[HEURISTICS
        .iter()
        .position(|candidate| *candidate == kind)
        .unwrap()]
}

/// Ranks by win count, giving heuristics whose win counts sit within `TIE_MARGIN` of their
/// neighbor the average of the tied ranks, so a coin-flip boundary crossing cannot move anyone
/// several whole ranks.
fn midranks(wins: &[u64; 6]) -> [f64; 6] {
    let mut order: Vec<usize> = (0..HEURISTICS.len()).collect();
    order.sort_by_key(|index| std::cmp::Reverse(wins[*index]));
    let mut ranks = [0.0; 6];
    let mut cluster_start = 0;
    for position in 0..order.len() {
        let cluster_continues = position + 1 < order.len()
            && wins[order[position]] - wins[order[position + 1]] <= TIE_MARGIN;
        if cluster_continues {
            continue;
        }
        let average = (cluster_start + position) as f64 / 2.0;
        for entry in &order[cluster_start..=position] {
            ranks[*entry] = average;
        }
        cluster_start = position + 1;
    }
    ranks
}

fn spearman(first: &[u64; 6], second: &[u64; 6]) -> f64 {
    let (first, second) = (midranks(first), midranks(second));
    let squared_difference: f64 = first
        .iter()
        .zip(second)
        .map(|(left, right)| (left - right).powi(2))
        .sum();
    let n = HEURISTICS.len() as f64;
    1.0 - 6.0 * squared_difference / (n * (n * n - 1.0))
}

/// One standard error of a win-count difference between two near-tied heuristics on this
/// 1,200-game-per-policy schedule is ~22 wins, so a top-2 boundary swap inside this margin is
/// sampling noise, not a demotion; a real regression pushes the displaced heuristic far outside it.
const TIE_MARGIN: u64 = 25;

#[test]
fn top_placements_are_stable_across_post_placement_policies() {
    let rankings = [
        ranking(PolicyKind::HeuristicV1),
        ranking(PolicyKind::HeuristicV1Noports),
        ranking(PolicyKind::PriorityTrader),
    ];
    for (index, (ranking, wins)) in rankings.iter().enumerate() {
        eprintln!("ranking {index}: {ranking:?} wins {wins:?}");
    }
    let expected_top = &rankings[0].0[..2];
    for (ranking, wins) in &rankings[1..] {
        for expected in expected_top {
            if ranking[..2].contains(expected) {
                continue;
            }
            let displaced = wins_for(*expected, wins);
            let boundary = wins_for(ranking[1], wins);
            assert!(
                boundary - displaced <= TIE_MARGIN,
                "{expected:?} fell out of the top two by {} wins ({boundary} vs {displaced})",
                boundary - displaced,
            );
        }
    }
    for left in 0..rankings.len() {
        for right in left + 1..rankings.len() {
            let rho = spearman(&rankings[left].1, &rankings[right].1);
            eprintln!("ranking Spearman rho {left}/{right}: {rho:.4}");
            assert!(rho >= 0.7);
        }
    }
}
