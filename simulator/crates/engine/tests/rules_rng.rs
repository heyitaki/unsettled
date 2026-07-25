use unsettled_engine::rng::{Streams, Xoshiro256StarStar, derive_game_seed, splitmix64};
use unsettled_engine::rules::{
    Buildable, PlayerModifiers, PortAction, PortRule, PortSelector, Resource, RuleConfig,
};
use unsettled_engine::topology::Layout;

#[test]
fn splitmix64_matches_published_reference_values() {
    let mut state = 0;
    assert_eq!(splitmix64(&mut state), 0xe220_a839_7b1d_cdaf);
    assert_eq!(splitmix64(&mut state), 0x6e78_9e6a_a1b9_65f4);
    assert_eq!(splitmix64(&mut state), 0x06c4_5d18_8009_454f);
    assert_eq!(splitmix64(&mut state), 0xf88b_b8a8_724c_81ec);
}

#[test]
fn streams_are_isolated_and_coordinate_seeds_do_not_collide() {
    let mut streams = Streams::new(42);
    let chance: Vec<_> = (0..100).map(|_| streams.chance.next_u64()).collect();
    let mut other = Streams::new(42);
    for _ in 0..10_000 {
        other.policy[0].next_u64();
    }
    assert_eq!(
        chance,
        (0..100)
            .map(|_| other.chance.next_u64())
            .collect::<Vec<_>>()
    );

    let mut seeds = std::collections::HashSet::new();
    for board in 0..1_000 {
        for rep in 0..100 {
            assert!(seeds.insert(derive_game_seed(7, board, rep)));
        }
    }
}

#[test]
fn seeded_dice_tracks_the_exact_distribution() {
    let mut rng = Xoshiro256StarStar::from_seed(91);
    let mut counts = [0_u32; 13];
    let rolls = 1_000_000_u32;
    for _ in 0..rolls {
        let roll = rng.range(6) + rng.range(6) + 2;
        counts[roll as usize] += 1;
    }
    let ways = [0, 0, 1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1];
    for roll in 2..=12 {
        let observed = f64::from(counts[roll]) / f64::from(rolls);
        let exact = f64::from(ways[roll]) / 36.0;
        assert!(
            (observed - exact).abs() <= 0.003,
            "roll {roll}: {observed} vs {exact}"
        );
    }
}

#[test]
fn modifiers_flatten_costs_and_trade_rates_per_player() {
    let rules = RuleConfig::base(Layout::Standard4);
    let mut modified = PlayerModifiers::default();
    modified
        .extra_cost_alternatives
        .push((Buildable::Settlement, [0, 0, 0, 4, 0]));
    modified.bank_rate_override = Some(3);
    modified.port_rules.push(PortRule {
        selector: PortSelector::All,
        action: PortAction::Disable,
    });
    let flattened = rules.flatten(
        &[modified, PlayerModifiers::default()],
        &[Vec::new(), Vec::new()],
    );
    assert!(
        flattened[0]
            .costs(Buildable::Settlement)
            .contains(&[0, 0, 0, 4, 0])
    );
    assert_eq!(flattened[0].trade_rate(Resource::Wood), 3);
    assert_eq!(flattened[1].trade_rate(Resource::Wood), 4);
}

#[test]
fn base_flattened_rules_take_the_no_effects_fast_path() {
    let rules = RuleConfig::base(Layout::Standard4);
    let flattened = rules.flatten_player(&PlayerModifiers::default(), &[]);
    assert!(!flattened.has_effects());
}
