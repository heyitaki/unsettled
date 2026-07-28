use std::fs;
use std::path::PathBuf;

use unsettled_engine::board::{ConversionOptions, SimBoard};
use unsettled_engine::game::{GameArena, GameConfig};
use unsettled_engine::policy::{self, PolicyKind};
use unsettled_engine::rng::{Streams, Xoshiro256StarStar};
use unsettled_engine::rules::{Buildable, Resource, RuleConfig, TradeConfig};
use unsettled_engine::state::EMPTY;
use unsettled_engine::topology::{Layout, Topology};
use unsettled_engine::trade::TradeOffer;
use unsettled_engine::view::{Action, DecisionPhase};
use unsettled_engine::wire::WireBoard;

fn fixture() -> (Topology, SimBoard, RuleConfig, GameConfig, GameArena) {
    let topology = Topology::load(Layout::Extension6).unwrap();
    let mut rules = RuleConfig::base(Layout::Extension6);
    rules.player_trading = Some(TradeConfig {
        acceptance_temperature: 0.5,
        ..TradeConfig::default()
    });
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../src/parser/__tests__/expected/board-draft-empty.json");
    let wire = WireBoard::parse_str(&fs::read_to_string(path).unwrap()).unwrap();
    let board =
        SimBoard::try_from_wire(wire, &topology, &rules, ConversionOptions::default()).unwrap();
    let config = GameConfig::default();
    let mut arena = GameArena::default();
    arena.prepare(&board, &topology, &rules, &config);
    (topology, board, rules, config, arena)
}

fn move_from_bank(arena: &mut GameArena, seat: usize, resource: Resource) {
    arena.state.bank[resource.index()] -= 1;
    arena.state.players[seat].resources[resource.index()] += 1;
}

fn traces(mut streams: Streams) -> ([u64; 8], [u64; 8], [u64; 8], [[u64; 8]; 6]) {
    (
        std::array::from_fn(|_| streams.dice.next_u64()),
        std::array::from_fn(|_| streams.deck.next_u64()),
        std::array::from_fn(|_| streams.chance.next_u64()),
        std::array::from_fn(|seat| std::array::from_fn(|_| streams.policy[seat].next_u64())),
    )
}

#[test]
fn trade_stream_advancement_is_isolated_from_every_existing_stream() {
    let expected = traces(Streams::new(42));
    let mut advanced = Streams::new(42);
    for _ in 0..10_000 {
        advanced.trade.next_u64();
    }

    assert_eq!(traces(advanced), expected);
}

#[test]
fn existing_stream_advancement_is_isolated_from_the_trade_stream() {
    let mut expected = Streams::new(42);
    let trade = std::array::from_fn::<_, 100, _>(|_| expected.trade.next_u64());
    let mut advanced = Streams::new(42);
    for _ in 0..10_000 {
        advanced.dice.next_u64();
        advanced.deck.next_u64();
        advanced.chance.next_u64();
        for policy in &mut advanced.policy {
            policy.next_u64();
        }
    }

    assert_eq!(
        std::array::from_fn::<_, 100, _>(|_| advanced.trade.next_u64()),
        trade
    );
}

#[test]
fn gated_and_ungated_responses_consume_the_same_number_of_draws() {
    let (topology, board, rules, mut config, mut baseline) = fixture();
    move_from_bank(&mut baseline, 0, Resource::Wood);
    move_from_bank(&mut baseline, 1, Resource::Ore);
    assert_eq!(baseline.state.edge_owner[10], EMPTY);
    baseline.state.edge_owner[10] = 1;
    baseline.state.players[1].pieces[Buildable::Road.index()] -= 1;
    let mut aware = baseline.clone();
    let offer = Action::OfferTrade {
        give: Resource::Wood,
        get: Resource::Ore,
        count: 1,
    };

    config.policies = [PolicyKind::HeuristicV1Trader; 6];
    assert!(baseline.apply_action_for_test(
        &board,
        &topology,
        &rules,
        &config,
        0,
        offer,
        DecisionPhase::Action,
    ));
    config.policies = [PolicyKind::HeuristicV1TraderAware; 6];
    assert!(aware.apply_action_for_test(
        &board,
        &topology,
        &rules,
        &config,
        0,
        offer,
        DecisionPhase::Action,
    ));
    assert_eq!(
        baseline.trade_trace_for_test::<8>(),
        aware.trade_trace_for_test::<8>()
    );
}

#[test]
fn missing_goal_rejects_without_consuming_trade_rng() {
    let (topology, board, rules, _config, mut arena) = fixture();
    move_from_bank(&mut arena, 1, Resource::Ore);
    let view = arena.decision_view(&board, &topology, 1, DecisionPhase::TradeResponse);
    let offer = TradeOffer {
        proposer: 0,
        give: Resource::Wood,
        get: Resource::Ore,
        count: 1,
    };
    for kind in [
        PolicyKind::HeuristicV1Trader,
        PolicyKind::HeuristicV1TraderAware,
    ] {
        let mut rng = Xoshiro256StarStar::from_seed(31);
        let mut expected = rng.clone();
        assert!(!policy::respond_trade(kind, &view, offer, &mut rng));
        assert_eq!(rng.next_u64(), expected.next_u64());
    }
    assert_eq!(rules.player_trading.unwrap().acceptance_temperature, 0.5);
}
