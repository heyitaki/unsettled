use std::fs;
use std::path::PathBuf;

use unsettled_engine::board::{ConversionOptions, SimBoard};
use unsettled_engine::game::{GameArena, GameConfig, trade_players};
use unsettled_engine::longest_road::RoadCard;
use unsettled_engine::policy::{self, PolicyKind, PolicyScratch, random_legal};
use unsettled_engine::rng::Xoshiro256StarStar;
use unsettled_engine::rules::{Buildable, RESOURCE_COUNT, Resource, RuleConfig, TradeConfig};
use unsettled_engine::state::EMPTY;
use unsettled_engine::topology::{Edge, Layout, Topology};
use unsettled_engine::trade::{
    TradeOffer, acceptance_probability, conservative_hidden_vp, conservative_hidden_vp_for,
    embargoed, expected_hidden_vp, softened_accept, vp_estimate,
};
use unsettled_engine::view::{Action, ActionBuf, DecisionPhase, DevPlay};
use unsettled_engine::wire::WireBoard;

fn fixture() -> (Topology, SimBoard, RuleConfig, GameConfig, GameArena) {
    let topology = Topology::load(Layout::Extension6).unwrap();
    let rules = RuleConfig::base(Layout::Extension6);
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

fn enable_trading(rules: &mut RuleConfig) {
    rules.player_trading = Some(TradeConfig::default());
}

fn move_from_bank(arena: &mut GameArena, seat: usize, resource: Resource, count: u16) {
    arena.state.bank[resource.index()] -= count;
    arena.state.players[seat].resources[resource.index()] += count as i16;
}

fn give_road(arena: &mut GameArena, seat: usize, edge: Edge) {
    assert_eq!(arena.state.edge_owner[usize::from(edge)], EMPTY);
    arena.state.edge_owner[usize::from(edge)] = seat as u8;
    arena.state.players[seat].pieces[Buildable::Road.index()] -= 1;
}

fn give_four_cities(arena: &mut GameArena, seat: usize) {
    give_cities(arena, seat, 0, 4);
}

fn give_cities(arena: &mut GameArena, seat: usize, start: usize, count: usize) {
    for vertex in start..start + count {
        arena.state.vertex_owner[vertex] = seat as u8;
        arena.state.vertex_tier[vertex] = 2;
    }
    arena.state.players[seat].pieces[Buildable::City.index()] -= count as u8;
    arena.state.players[seat].vp_public += 2 * count as u8;
}

fn give_settlement(arena: &mut GameArena, seat: usize, vertex: usize) {
    arena.state.vertex_owner[vertex] = seat as u8;
    arena.state.vertex_tier[vertex] = 1;
    arena.state.players[seat].pieces[Buildable::Settlement.index()] -= 1;
    arena.state.players[seat].vp_public += 1;
}

#[test]
fn player_trade_refuses_insufficient_payment_without_mutating_either_hand() {
    let mut proposer = [0_i16; RESOURCE_COUNT];
    let mut responder = [0_i16; RESOURCE_COUNT];
    proposer[Resource::Wood.index()] = 1;
    responder[Resource::Ore.index()] = 1;
    let before = (proposer, responder);

    assert!(!trade_players(
        &mut proposer,
        &mut responder,
        Resource::Wood,
        Resource::Ore,
        2,
    ));
    assert_eq!((proposer, responder), before);

    proposer[Resource::Wood.index()] = 2;
    responder[Resource::Ore.index()] = 0;
    let before = (proposer, responder);
    assert!(!trade_players(
        &mut proposer,
        &mut responder,
        Resource::Wood,
        Resource::Ore,
        2,
    ));
    assert_eq!((proposer, responder), before);
}

#[test]
fn player_trade_conserves_every_resource_across_both_hands() {
    let mut proposer = [0_i16; RESOURCE_COUNT];
    let mut responder = [0_i16; RESOURCE_COUNT];
    proposer[Resource::Wood.index()] = 2;
    responder[Resource::Ore.index()] = 1;
    let before = std::array::from_fn::<_, RESOURCE_COUNT, _>(|resource| {
        proposer[resource] + responder[resource]
    });

    assert!(trade_players(
        &mut proposer,
        &mut responder,
        Resource::Wood,
        Resource::Ore,
        2,
    ));
    assert_eq!(
        std::array::from_fn::<_, RESOURCE_COUNT, _>(|resource| {
            proposer[resource] + responder[resource]
        }),
        before
    );
}

#[test]
fn offer_legality_rejects_missing_like_for_like_and_out_of_range_counts() {
    let (topology, board, mut rules, config, mut arena) = fixture();
    enable_trading(&mut rules);
    arena.prepare(&board, &topology, &rules, &config);
    move_from_bank(&mut arena, 0, Resource::Wood, 2);

    for action in [
        Action::OfferTrade {
            give: Resource::Ore,
            get: Resource::Wood,
            count: 1,
        },
        Action::OfferTrade {
            give: Resource::Wood,
            get: Resource::Wood,
            count: 1,
        },
        Action::OfferTrade {
            give: Resource::Wood,
            get: Resource::Ore,
            count: 0,
        },
        Action::OfferTrade {
            give: Resource::Wood,
            get: Resource::Ore,
            count: 3,
        },
    ] {
        assert!(!arena.validate_action(&board, &topology, 0, action, DecisionPhase::Action));
    }
    assert!(!arena.validate_action(
        &board,
        &topology,
        0,
        Action::OfferTrade {
            give: Resource::Wood,
            get: Resource::Ore,
            count: 1,
        },
        DecisionPhase::PreRoll,
    ));
}

#[test]
fn max_offers_per_turn_is_visible_to_the_policy_and_prevents_illegal_retries() {
    let (topology, board, mut rules, mut config, mut arena) = fixture();
    rules.player_trading = Some(TradeConfig {
        max_offers_per_turn: 1,
        ..TradeConfig::default()
    });
    config.policies = [PolicyKind::HeuristicV1Trader; 6];
    arena.prepare(&board, &topology, &rules, &config);
    move_from_bank(&mut arena, 0, Resource::Ore, 1);
    let offer = Action::OfferTrade {
        give: Resource::Ore,
        get: Resource::Wood,
        count: 1,
    };

    assert!(arena.validate_action(&board, &topology, 0, offer, DecisionPhase::Action));
    assert!(arena.apply_action_for_test(
        &board,
        &topology,
        &rules,
        &config,
        0,
        offer,
        DecisionPhase::Action,
    ));
    assert!(!arena.validate_action(&board, &topology, 0, offer, DecisionPhase::Action));
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let mut scratch = PolicyScratch::default();
    let mut rng = Xoshiro256StarStar::from_seed(3);
    assert_ne!(
        policy::action(PolicyKind::HeuristicV1Trader, &view, &mut scratch, &mut rng,),
        offer
    );
    assert!(!arena.begin_turn_for_test(&board, &topology, &rules, &config, 0));
    assert!(arena.validate_action(&board, &topology, 0, offer, DecisionPhase::Action));

    let result = arena.play(&board, &topology, &rules, &config);
    assert_eq!(result.illegal_actions, 0);
}

#[test]
fn hidden_vp_posterior_matches_a_hand_computed_hypergeometric_state() {
    assert!((expected_hidden_vp(2, 3, 10) - 0.6).abs() < 1e-12);
    assert_eq!(conservative_hidden_vp(2, 3, 10, 0.46), 0);
    assert_eq!(conservative_hidden_vp(2, 3, 10, 0.9), 1);
    assert_eq!(conservative_hidden_vp(2, 3, 10, 0.95), 2);
}

#[test]
fn hidden_vp_estimate_crosses_the_embargo_threshold_and_is_monotone_in_confidence() {
    let (topology, board, mut rules, config, mut arena) = fixture();
    enable_trading(&mut rules);
    arena.prepare(&board, &topology, &rules, &config);
    arena.state.players[1].vp_public = 8;
    arena.state.players[1].playable_dev[0] = 5;
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let low = vp_estimate(&view, 1, 0.1);
    let middle = vp_estimate(&view, 1, 0.5);
    let high = vp_estimate(&view, 1, 0.9);

    assert!(low <= middle && middle <= high);
    assert!(high >= 9);
    assert!(embargoed(&view, 1));
}

#[test]
fn revealed_dev_plays_preserve_the_public_pool_identity() {
    let (topology, board, mut rules, config, mut arena) = fixture();
    enable_trading(&mut rules);
    arena.prepare(&board, &topology, &rules, &config);
    arena.set_next_dev_for_test(0);
    for resource in Resource::ALL {
        let count = u16::from(rules.dev_cost[resource.index()]);
        move_from_bank(&mut arena, 0, resource, count);
    }
    assert!(arena.apply_action_for_test(
        &board,
        &topology,
        &rules,
        &config,
        0,
        Action::BuyDev,
        DecisionPhase::Action,
    ));
    arena.promote_dev_for_test(0);
    let destination = (0..topology.hex_count())
        .map(|hex| hex as u8)
        .find(|hex| *hex != arena.state.robber)
        .unwrap();
    assert!(arena.apply_action_for_test(
        &board,
        &topology,
        &rules,
        &config,
        0,
        Action::PlayDev(DevPlay::Knight {
            destination,
            victim: None,
        }),
        DecisionPhase::PreRoll,
    ));
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let deck_total = rules.dev_deck.knight
        + rules.dev_deck.victory_point
        + rules.dev_deck.road_building
        + rules.dev_deck.year_of_plenty
        + rules.dev_deck.monopoly;
    let held: u8 = (0..board.seats()).map(|seat| view.dev_count(seat)).sum();
    let revealed: u8 = (0..board.seats())
        .map(|seat| view.dev_plays_revealed(seat).iter().sum::<u8>())
        .sum();

    assert_eq!(deck_total, view.dev_deck_remaining() + held + revealed);
}

#[test]
fn embargo_blocks_a_seat_at_one_point_below_the_win_threshold() {
    let (topology, board, mut rules, config, mut arena) = fixture();
    enable_trading(&mut rules);
    arena.prepare(&board, &topology, &rules, &config);
    arena.state.players[1].vp_public = rules.win_vp - 1;
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);

    assert!(embargoed(&view, 1));
}

#[test]
fn embargoed_responder_is_skipped_without_mutating_any_hand() {
    let (topology, board, mut rules, mut config, mut arena) = fixture();
    rules.player_trading = Some(TradeConfig {
        opponent_gain_weight: 0.0,
        acceptance_temperature: 0.0,
        ..TradeConfig::default()
    });
    config.policies = [PolicyKind::HeuristicV1Trader; 6];
    arena.prepare(&board, &topology, &rules, &config);
    move_from_bank(&mut arena, 0, Resource::Wood, 1);
    move_from_bank(&mut arena, 1, Resource::Ore, 1);
    give_road(&mut arena, 1, 10);
    arena.state.players[1].vp_public = rules.win_vp - 1;
    let hands = std::array::from_fn::<_, 6, _>(|seat| arena.state.players[seat].resources);

    assert!(arena.apply_action_for_test(
        &board,
        &topology,
        &rules,
        &config,
        0,
        Action::OfferTrade {
            give: Resource::Wood,
            get: Resource::Ore,
            count: 1,
        },
        DecisionPhase::Action,
    ));
    assert_eq!(
        std::array::from_fn::<_, 6, _>(|seat| arena.state.players[seat].resources),
        hands
    );
}

fn bridge_shape(topology: &Topology) -> (Edge, Edge, Edge) {
    (0..topology.edge_count())
        .map(|edge| edge as Edge)
        .find_map(|bridge| {
            let [left_vertex, right_vertex] = topology.edge_endpoints(bridge);
            let left = topology
                .vertex_edges(left_vertex)
                .iter()
                .copied()
                .find(|edge| *edge != bridge)?;
            let right = topology
                .vertex_edges(right_vertex)
                .iter()
                .copied()
                .find(|edge| *edge != bridge && *edge != left)?;
            Some((bridge, left, right))
        })
        .unwrap()
}

#[test]
fn embargo_detects_a_single_road_bridging_two_components_into_longest_road() {
    let (topology, board, mut rules, config, mut arena) = fixture();
    enable_trading(&mut rules);
    rules.longest_road_min = 3;
    arena.prepare(&board, &topology, &rules, &config);
    let (bridge, left, right) = bridge_shape(&topology);
    arena.state.edge_owner[usize::from(left)] = 1;
    arena.state.edge_owner[usize::from(right)] = 1;
    arena.state.players[1].pieces[Buildable::Road.index()] -= 2;
    arena.state.players[1].vp_public = rules.win_vp - 2;
    arena.state.longest_road = RoadCard {
        holder: Some(2),
        retired: false,
    };
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let mut network = view.road_network_for(1);

    assert_eq!(network.base_length(), 1);
    assert_eq!(
        network.probe(&[topology.edge_endpoints(bridge)], u8::MAX),
        3
    );
    assert!(view.road_takes_longest_road(1));
    assert!(embargoed(&view, 1));
}

#[test]
fn embargo_detects_largest_army_one_knight_away() {
    let (topology, board, mut rules, config, mut arena) = fixture();
    enable_trading(&mut rules);
    arena.prepare(&board, &topology, &rules, &config);
    arena.state.players[1].vp_public = rules.win_vp - 2;
    arena.state.players[1].knights_played = 3;
    arena.state.players[2].knights_played = 3;
    arena.state.largest_army = Some(2);
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);

    assert!(view.knight_takes_largest_army_for(1));
    assert!(embargoed(&view, 1));
}

#[test]
fn a_seat_two_points_below_the_win_threshold_trades_when_no_award_is_imminent() {
    let (topology, board, mut rules, config, mut arena) = fixture();
    rules.player_trading = Some(TradeConfig {
        opponent_gain_weight: 0.0,
        acceptance_temperature: 0.0,
        ..TradeConfig::default()
    });
    arena.prepare(&board, &topology, &rules, &config);
    arena.state.players[1].vp_public = rules.win_vp - 2;
    move_from_bank(&mut arena, 1, Resource::Ore, 1);
    give_road(&mut arena, 1, 10);
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);

    assert!(!embargoed(&view, 1));
    let view = arena.decision_view(&board, &topology, 1, DecisionPhase::TradeResponse);
    let mut rng = Xoshiro256StarStar::from_seed(5);
    assert!(policy::respond_trade(
        PolicyKind::HeuristicV1Trader,
        &view,
        TradeOffer {
            proposer: 0,
            give: Resource::Wood,
            get: Resource::Ore,
            count: 1,
        },
        &mut rng,
    ));
}

#[test]
fn responder_decision_does_not_leak_an_opponents_face_down_dev_identity() {
    let (topology, board, mut rules, config, mut first) = fixture();
    enable_trading(&mut rules);
    rules
        .player_trading
        .as_mut()
        .unwrap()
        .acceptance_temperature = 0.0;
    rules.player_trading.as_mut().unwrap().opponent_gain_weight = 1.0;
    first.prepare(&board, &topology, &rules, &config);
    let mut second = first.clone();
    first.state.players[0].playable_dev[0] = 1;
    second.state.players[0].playable_dev[2] = 1;
    give_road(&mut first, 1, 10);
    give_road(&mut second, 1, 10);
    move_from_bank(&mut first, 1, Resource::Ore, 1);
    move_from_bank(&mut second, 1, Resource::Ore, 1);
    let offer = TradeOffer {
        proposer: 0,
        give: Resource::Wood,
        get: Resource::Ore,
        count: 1,
    };
    let first_view = first.decision_view(&board, &topology, 1, DecisionPhase::TradeResponse);
    let second_view = second.decision_view(&board, &topology, 1, DecisionPhase::TradeResponse);
    let mut first_rng = Xoshiro256StarStar::from_seed(7);
    let mut second_rng = Xoshiro256StarStar::from_seed(7);

    assert_eq!(first_view.dev_count(0), second_view.dev_count(0));
    assert_eq!(
        conservative_hidden_vp_for(&first_view, 0, 0.9),
        conservative_hidden_vp_for(&second_view, 0, 0.9)
    );
    assert_eq!(
        vp_estimate(&first_view, 0, 0.9),
        vp_estimate(&second_view, 0, 0.9)
    );
    assert_eq!(
        policy::respond_trade(
            PolicyKind::HeuristicV1Trader,
            &first_view,
            offer,
            &mut first_rng,
        ),
        policy::respond_trade(
            PolicyKind::HeuristicV1Trader,
            &second_view,
            offer,
            &mut second_rng,
        )
    );
}

#[test]
fn lambda_and_temperature_have_the_registered_limiting_behaviour() {
    assert_eq!(acceptance_probability(1.0, 0.0), 1.0);
    assert_eq!(acceptance_probability(0.0, 0.0), 0.0);
    assert_eq!(acceptance_probability(-1.0, 0.0), 0.0);
    assert!((acceptance_probability(1.0, 1_000_000.0) - 0.5).abs() < 1e-6);

    let (topology, board, mut rules, config, mut arena) = fixture();
    rules.player_trading = Some(TradeConfig {
        opponent_gain_weight: 0.0,
        acceptance_temperature: 0.0,
        ..TradeConfig::default()
    });
    arena.prepare(&board, &topology, &rules, &config);
    move_from_bank(&mut arena, 1, Resource::Ore, 1);
    give_road(&mut arena, 1, 10);
    let offer = TradeOffer {
        proposer: 0,
        give: Resource::Wood,
        get: Resource::Ore,
        count: 1,
    };
    let view = arena.decision_view(&board, &topology, 1, DecisionPhase::TradeResponse);
    let mut rng = Xoshiro256StarStar::from_seed(9);
    let accepted = policy::respond_trade(PolicyKind::HeuristicV1Trader, &view, offer, &mut rng);
    assert!(accepted);

    rules.player_trading.as_mut().unwrap().opponent_gain_weight = 1_000.0;
    arena.prepare(&board, &topology, &rules, &config);
    arena.state.players[0].vp_public = 1;
    move_from_bank(&mut arena, 1, Resource::Ore, 1);
    give_road(&mut arena, 1, 10);
    let view = arena.decision_view(&board, &topology, 1, DecisionPhase::TradeResponse);
    assert!(!policy::respond_trade(
        PolicyKind::HeuristicV1Trader,
        &view,
        offer,
        &mut rng,
    ));
}

#[test]
fn large_temperature_softening_is_near_even_over_a_deterministic_sample() {
    let mut rng = Xoshiro256StarStar::from_seed(71);
    let accepted = (0..20_000)
        .filter(|_| softened_accept(1.0, 1_000_000.0, &mut rng))
        .count();

    assert!((9_700..=10_300).contains(&accepted));
}

#[test]
fn heuristic_trader_emits_only_enabled_self_improving_offers() {
    let (topology, board, mut rules, mut config, mut arena) = fixture();
    enable_trading(&mut rules);
    config.policies[0] = PolicyKind::HeuristicV1Trader;
    arena.prepare(&board, &topology, &rules, &config);
    move_from_bank(&mut arena, 0, Resource::Ore, 1);
    give_road(&mut arena, 0, 10);
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let mut scratch = PolicyScratch::default();
    let mut rng = Xoshiro256StarStar::from_seed(17);
    let action = policy::action(PolicyKind::HeuristicV1Trader, &view, &mut scratch, &mut rng);

    assert!(matches!(
        action,
        Action::OfferTrade {
            give: Resource::Ore,
            count: 1,
            ..
        }
    ));

    let mut disabled_rules = rules.clone();
    disabled_rules.player_trading = None;
    arena.prepare(&board, &topology, &disabled_rules, &config);
    move_from_bank(&mut arena, 0, Resource::Ore, 1);
    give_road(&mut arena, 0, 10);
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    assert!(!matches!(
        policy::action(PolicyKind::HeuristicV1Trader, &view, &mut scratch, &mut rng,),
        Action::OfferTrade { .. }
    ));
}

#[test]
fn acceptor_selection_chooses_the_lowest_vp_estimate() {
    let (topology, board, mut rules, mut config, mut arena) = fixture();
    rules.player_trading = Some(TradeConfig {
        opponent_gain_weight: 0.0,
        acceptance_temperature: 0.0,
        max_offers_per_turn: 1,
        ..TradeConfig::default()
    });
    config.policies = [PolicyKind::HeuristicV1Trader; 6];
    arena.prepare(&board, &topology, &rules, &config);
    move_from_bank(&mut arena, 0, Resource::Wood, 1);
    for responder in 1..=3 {
        move_from_bank(&mut arena, responder, Resource::Ore, 1);
        give_road(&mut arena, responder, 10 + responder as u8 * 10);
    }
    give_cities(&mut arena, 1, 0, 2);
    give_cities(&mut arena, 2, 2, 1);
    give_cities(&mut arena, 3, 3, 3);
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::TradeResponse);
    let confidence = rules.player_trading.unwrap().hidden_vp_confidence;
    assert_eq!(
        (1..=3)
            .map(|seat| (seat, vp_estimate(&view, seat, confidence)))
            .collect::<Vec<_>>(),
        vec![(1, 4), (2, 2), (3, 6)]
    );

    assert!(arena.apply_action_for_test(
        &board,
        &topology,
        &rules,
        &config,
        0,
        Action::OfferTrade {
            give: Resource::Wood,
            get: Resource::Ore,
            count: 1,
        },
        DecisionPhase::Action,
    ));
    assert_eq!(
        arena.state.players[2].resources[Resource::Wood.index()],
        1
    );
}

#[test]
fn acceptor_selection_breaks_estimate_ties_by_rotation_relative_rank() {
    let (topology, board, mut rules, mut config, mut arena) = fixture();
    rules.player_trading = Some(TradeConfig {
        opponent_gain_weight: 0.0,
        acceptance_temperature: 0.0,
        max_offers_per_turn: 1,
        ..TradeConfig::default()
    });
    config.policies = [PolicyKind::HeuristicV1Trader; 6];
    arena.prepare(&board, &topology, &rules, &config);
    let proposer = 3;
    move_from_bank(&mut arena, proposer, Resource::Wood, 1);
    for responder in [0, 1, 4] {
        move_from_bank(&mut arena, responder, Resource::Ore, 1);
        give_road(&mut arena, responder, 10 + responder as u8 * 10);
    }
    assert_eq!(
        [0, 1, 4].map(|seat| (seat + board.seats() - proposer) % board.seats()),
        [2, 3, 1]
    );
    assert!(arena.invariants_hold(&board, &topology, &rules));

    assert!(arena.apply_action_for_test(
        &board,
        &topology,
        &rules,
        &config,
        proposer,
        Action::OfferTrade {
            give: Resource::Wood,
            get: Resource::Ore,
            count: 1,
        },
        DecisionPhase::Action,
    ));
    assert_eq!(
        arena.state.players[1].resources[Resource::Wood.index()],
        1
    );
}

#[test]
fn every_policy_kind_selects_the_same_farthest_counterparty() {
    let (topology, board, mut rules, config, mut arena) = fixture();
    enable_trading(&mut rules);
    arena.prepare(&board, &topology, &rules, &config);
    let proposer = 3;
    let view = arena.decision_view(&board, &topology, proposer, DecisionPhase::TradeResponse);

    for kind in [
        PolicyKind::RandomLegal,
        PolicyKind::GreedyNoTrade,
        PolicyKind::PriorityTrader,
        PolicyKind::HeuristicV1,
        PolicyKind::HeuristicV1Noports,
        PolicyKind::HeuristicV1Trader,
    ] {
        assert_eq!(policy::select_counterparty(kind, &view, &[0, 2]), 2);
    }
}

#[test]
fn acceptor_selection_uses_hidden_vp_estimates_not_public_vp() {
    let (topology, board, mut rules, mut config, mut arena) = fixture();
    rules.player_trading = Some(TradeConfig {
        opponent_gain_weight: 0.0,
        acceptance_temperature: 0.0,
        max_offers_per_turn: 1,
        hidden_vp_confidence: 0.9,
    });
    config.policies = [PolicyKind::HeuristicV1Trader; 6];
    arena.prepare(&board, &topology, &rules, &config);
    move_from_bank(&mut arena, 0, Resource::Wood, 1);
    for responder in 1..=2 {
        move_from_bank(&mut arena, responder, Resource::Ore, 1);
        give_road(&mut arena, responder, 10 + responder as u8 * 10);
    }
    arena.state.players[1].playable_dev[0] = 5;
    give_settlement(&mut arena, 2, 0);
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::TradeResponse);
    assert!(view.public_vp(1) < view.public_vp(2));
    assert!(
        vp_estimate(&view, 1, 0.9) > vp_estimate(&view, 2, 0.9),
        "the hidden-card posterior must reverse the public-VP ordering"
    );

    assert!(arena.apply_action_for_test(
        &board,
        &topology,
        &rules,
        &config,
        0,
        Action::OfferTrade {
            give: Resource::Wood,
            get: Resource::Ore,
            count: 1,
        },
        DecisionPhase::Action,
    ));
    assert_eq!(
        arena.state.players[2].resources[Resource::Wood.index()],
        1
    );
}

#[test]
fn embargoed_proposer_is_declined_before_any_counterparty_mutation() {
    let (topology, board, mut rules, mut config, mut arena) = fixture();
    rules.player_trading = Some(TradeConfig {
        opponent_gain_weight: 0.0,
        acceptance_temperature: 0.0,
        ..TradeConfig::default()
    });
    config.policies = [PolicyKind::HeuristicV1Trader; 6];
    arena.prepare(&board, &topology, &rules, &config);
    move_from_bank(&mut arena, 0, Resource::Wood, 1);
    move_from_bank(&mut arena, 1, Resource::Ore, 1);
    give_road(&mut arena, 1, 10);
    give_four_cities(&mut arena, 0);
    give_settlement(&mut arena, 0, 4);
    assert_eq!(arena.state.players[0].vp_public, rules.win_vp - 1);
    let hands = std::array::from_fn::<_, 6, _>(|seat| arena.state.players[seat].resources);
    let trade_trace = arena.trade_trace_for_test::<16>();

    assert!(arena.apply_action_for_test(
        &board,
        &topology,
        &rules,
        &config,
        0,
        Action::OfferTrade {
            give: Resource::Wood,
            get: Resource::Ore,
            count: 1,
        },
        DecisionPhase::Action,
    ));
    assert_eq!(
        std::array::from_fn::<_, 6, _>(|seat| arena.state.players[seat].resources),
        hands
    );
    assert_eq!(arena.trade_trace_for_test::<16>(), trade_trace);
}

#[test]
fn responder_embargo_does_not_depend_on_the_proposers_hidden_vp() {
    let (topology, board, mut rules, mut config, mut first) = fixture();
    rules.player_trading = Some(TradeConfig {
        opponent_gain_weight: 0.0,
        acceptance_temperature: 0.0,
        hidden_vp_confidence: 0.5,
        ..TradeConfig::default()
    });
    config.policies = [PolicyKind::HeuristicV1Trader; 6];
    first.prepare(&board, &topology, &rules, &config);
    move_from_bank(&mut first, 0, Resource::Wood, 1);
    move_from_bank(&mut first, 1, Resource::Ore, 1);
    give_road(&mut first, 1, 10);
    give_four_cities(&mut first, 1);
    first.state.players[1].vp_dev = 1;
    let mut second = first.clone();
    second.state.players[0].vp_dev = 1;
    let offer = Action::OfferTrade {
        give: Resource::Wood,
        get: Resource::Ore,
        count: 1,
    };

    assert!(first.apply_action_for_test(
        &board,
        &topology,
        &rules,
        &config,
        0,
        offer,
        DecisionPhase::Action,
    ));
    assert!(second.apply_action_for_test(
        &board,
        &topology,
        &rules,
        &config,
        0,
        offer,
        DecisionPhase::Action,
    ));
    assert_eq!(
        first.state.players[1].resources[Resource::Wood.index()],
        0
    );
    assert_eq!(
        second.state.players[1].resources[Resource::Wood.index()],
        0
    );
}

#[test]
fn trading_results_are_byte_identical_between_serial_and_parallel_schedules() {
    let (topology, board, mut rules, mut config, _) = fixture();
    enable_trading(&mut rules);
    config.policies = [PolicyKind::HeuristicV1Trader; 6];
    rules.turn_cap = 20;
    let run = |seed| {
        let mut game_config = config.clone();
        game_config.seed = seed;
        GameArena::default().play(&board, &topology, &rules, &game_config)
    };
    let serial: Vec<_> = (0..12).map(run).collect();
    let parallel: Vec<_> = std::thread::scope(|scope| {
        (0..12)
            .map(|seed| scope.spawn(move || run(seed)))
            .collect::<Vec<_>>()
            .into_iter()
            .map(|handle| handle.join().unwrap())
            .collect()
    });

    assert_eq!(
        serde_json::to_vec(&serial).unwrap(),
        serde_json::to_vec(&parallel).unwrap()
    );
}

#[test]
fn disabled_trading_keeps_offer_budget_at_zero_and_action_space_unchanged() {
    let (topology, board, rules, config, arena) = fixture();
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);

    assert!(view.trade_config().is_none());
    assert_eq!(view.offers_remaining_this_turn(), 0);
    assert!(!view.legal_offer_trade(Resource::Wood, Resource::Ore, 1));
    assert_eq!(rules.player_trading, None);
    assert_eq!(config.policies[0], PolicyKind::HeuristicV1);
    assert!(
        arena.state.edge_owner[..topology.edge_count()]
            .iter()
            .all(|owner| *owner == EMPTY)
    );
}

#[test]
fn random_legal_enumerates_offers_only_when_trading_is_enabled() {
    let (topology, board, mut rules, config, mut arena) = fixture();
    move_from_bank(&mut arena, 0, Resource::Wood, 2);
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let mut actions = ActionBuf::new();
    let mut rng = Xoshiro256StarStar::from_seed(13);
    random_legal::legal_actions(&view, &mut rng, &mut actions);
    assert!(
        actions
            .as_slice()
            .iter()
            .all(|candidate| !matches!(candidate.action, Action::OfferTrade { .. }))
    );

    enable_trading(&mut rules);
    arena.prepare(&board, &topology, &rules, &config);
    move_from_bank(&mut arena, 0, Resource::Wood, 2);
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    random_legal::legal_actions(&view, &mut rng, &mut actions);
    assert_eq!(
        actions
            .as_slice()
            .iter()
            .filter(|candidate| matches!(candidate.action, Action::OfferTrade { .. }))
            .count(),
        8
    );
}

#[test]
fn legacy_rule_json_defaults_player_trading_to_disabled() {
    let rules = RuleConfig::base(Layout::Standard4);
    let mut json = serde_json::to_value(&rules).unwrap();
    json.as_object_mut().unwrap().remove("playerTrading");
    let decoded: RuleConfig = serde_json::from_value(json).unwrap();

    assert_eq!(decoded.player_trading, None);
    assert_eq!(
        PolicyKind::parse("heuristic-v1-trader"),
        Some(PolicyKind::HeuristicV1Trader)
    );
}

#[test]
fn every_preexisting_policy_declines_player_trade_responses() {
    let (topology, board, mut rules, config, mut arena) = fixture();
    enable_trading(&mut rules);
    arena.prepare(&board, &topology, &rules, &config);
    let view = arena.decision_view(&board, &topology, 1, DecisionPhase::TradeResponse);
    let offer = TradeOffer {
        proposer: 0,
        give: Resource::Wood,
        get: Resource::Ore,
        count: 1,
    };
    for kind in [
        PolicyKind::RandomLegal,
        PolicyKind::GreedyNoTrade,
        PolicyKind::PriorityTrader,
        PolicyKind::HeuristicV1,
        PolicyKind::HeuristicV1Noports,
    ] {
        let mut rng = Xoshiro256StarStar::from_seed(11);
        assert!(!policy::respond_trade(kind, &view, offer, &mut rng));
    }
}
