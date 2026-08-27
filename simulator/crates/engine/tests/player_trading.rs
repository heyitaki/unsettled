use std::fs;
use std::path::PathBuf;

use unsettled_engine::board::{ConversionOptions, SimBoard};
use unsettled_engine::etw;
use unsettled_engine::game::{GameArena, GameConfig, trade_players};
use unsettled_engine::longest_road::RoadCard;
#[cfg(debug_assertions)]
use unsettled_engine::policy::heuristic_v1::HeuristicParams;
#[cfg(debug_assertions)]
use unsettled_engine::policy::heuristic_v1_trader;
use unsettled_engine::policy::threat::{self, ThreatParams};
use unsettled_engine::policy::trading::{self, TradeParams};
use unsettled_engine::policy::{self, PolicyKind, PolicyScratch, random_legal};
use unsettled_engine::rng::{Xoshiro256StarStar, mix64};
use unsettled_engine::rules::{Buildable, RESOURCE_COUNT, Resource, RuleConfig, TradeConfig};
use unsettled_engine::state::EMPTY;
use unsettled_engine::topology::{Edge, Layout, Topology};
use unsettled_engine::trade::{
    TradeOffer, acceptance_probability, conservative_hidden_vp, conservative_hidden_vp_for,
    embargoed, expected_hidden_vp, softened_accept, vp_estimate,
};
use unsettled_engine::view::{Action, ActionBuf, DecisionPhase, DecisionView, DevPlay};
use unsettled_engine::wire::WireBoard;

#[path = "../../cli/src/boardgen.rs"]
mod boardgen;

const TUNING_SEED: u64 = 0x7a11_1e5e_ed20_2607;

fn fixture() -> (Topology, SimBoard, RuleConfig, GameConfig, GameArena) {
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
    let config = GameConfig::default();
    let mut arena = GameArena::default();
    arena.prepare(&board, &topology, &rules, &config);
    (topology, board, rules, config, arena)
}

/// Replay-derived fixture: the state is whatever `turn_cap` turns of the default policy produce,
/// so any default-policy change silently moves it. Every consumer must loudly assert the
/// replay-derived preconditions its subject depends on (hands, dev cards, eligible recipients,
/// score orderings) before the subject assertion, so a policy change fails at a named
/// precondition instead of an unrelated subject (SIM-GAP-31).
fn truncated_game(
    game: u64,
    turn_cap: u16,
    trade_config: TradeConfig,
) -> (Topology, SimBoard, RuleConfig, GameConfig, GameArena) {
    let topology = Topology::load(Layout::Extension6).unwrap();
    let board = boardgen::generate_board(
        Layout::Extension6,
        6,
        mix64(TUNING_SEED ^ game ^ (u64::from(turn_cap) << 40)),
    )
    .unwrap();
    let mut rules = RuleConfig::base(Layout::Extension6);
    rules.player_trading = Some(trade_config);
    rules.turn_cap = turn_cap;
    let config = GameConfig {
        policies: [PolicyKind::HeuristicV1Trader; 6],
        seed: TUNING_SEED ^ game ^ (u64::from(turn_cap) << 20),
        ..GameConfig::default()
    };
    let mut arena = GameArena::default();
    arena.play(&board, &topology, &rules, &config);
    (topology, board, rules, config, arena)
}

fn deterministic_truncated_game(
    game: u64,
) -> (Topology, SimBoard, RuleConfig, GameConfig, GameArena) {
    truncated_game(
        game,
        8,
        TradeConfig {
            acceptance_temperature: 0.0,
            ..TradeConfig::default()
        },
    )
}

fn enable_trading(rules: &mut RuleConfig) {
    rules.player_trading = Some(TradeConfig::default());
}

#[cfg(debug_assertions)]
fn invalid_trading_params() -> HeuristicParams {
    HeuristicParams {
        trading: Some(TradeParams {
            danger_floor: 0.0,
            ..TradeParams::default()
        }),
        ..HeuristicParams::default()
    }
}

fn move_from_bank(arena: &mut GameArena, seat: usize, resource: Resource, count: u16) {
    arena.state.bank[resource.index()] -= count;
    arena.state.players[seat].resources[resource.index()] += count as i16;
}

// Replay-derived precondition helpers (SIM-GAP-31): name the truncated-game state properties a
// subject assertion silently depends on, so a moved replay fails here with the reason.
fn assert_can_offer(view: &DecisionView<'_>, give: Resource, get: Resource, count: u8) {
    assert!(
        view.legal_offer_trade(give, get, count),
        "replay precondition: seat {} can no longer offer {count} {give:?} for {get:?}; hand={:?}",
        view.observer(),
        view.own_hand(),
    );
}

fn assert_pinned_knight_plays(view: &DecisionView<'_>, plays: &[(u8, usize)]) {
    assert!(
        view.can_play_dev(0),
        "replay precondition: seat {} no longer holds a playable knight",
        view.observer()
    );
    for (destination, victim) in plays {
        assert_ne!(
            view.robber(),
            *destination,
            "replay precondition: robber already sits on hex {destination}"
        );
        assert!(
            view.stealable_on_hex(*destination, *victim),
            "replay precondition: seat {victim} is not a stealable victim on hex {destination}"
        );
    }
}

fn eligible_recipients(view: &DecisionView<'_>, get: Resource) -> Vec<usize> {
    (0..view.seats())
        .filter(|seat| {
            *seat != view.observer()
                && !embargoed(view, *seat, false)
                && view.belief().expected(*seat)[get.index()] >= 1.0
        })
        .collect()
}

fn explicit_trading_state() -> (Topology, SimBoard, RuleConfig, GameConfig, GameArena) {
    let topology = Topology::load(Layout::Extension6).unwrap();
    let board = boardgen::generate_board(Layout::Extension6, 6, mix64(TUNING_SEED ^ (8_u64 << 40)))
        .unwrap();
    let mut rules = RuleConfig::base(Layout::Extension6);
    // Nobody in this hand-authored state crossed the legacy VP embargo; danger cannot
    // exceed 1.0, so out-of-range thresholds keep the whole table tradeable and the
    // fixture's selection mechanics observable.
    rules.player_trading = Some(TradeConfig {
        acceptance_temperature: 0.0,
        embargo_danger: 2.0,
        embargo_takeover_danger: 2.0,
        ..TradeConfig::default()
    });
    rules.turn_cap = 8;
    let config = GameConfig {
        policies: [PolicyKind::HeuristicV1Trader; 6],
        seed: TUNING_SEED ^ (8_u64 << 20),
        ..GameConfig::default()
    };
    let mut arena = GameArena::default();
    arena.prepare(&board, &topology, &rules, &config);
    while arena
        .decision_view(&board, &topology, 0, DecisionPhase::Action)
        .dev_deck_remaining()
        > 12
    {
        move_from_bank(&mut arena, 0, Resource::Ore, 1);
        move_from_bank(&mut arena, 0, Resource::Sheep, 1);
        move_from_bank(&mut arena, 0, Resource::Wheat, 1);
        assert!(arena.apply_action_for_test(
            &board,
            &topology,
            &rules,
            &config,
            0,
            Action::BuyDev,
            DecisionPhase::Action,
        ));
    }

    arena.state.belief = serde_json::from_str(
        r#"{
            "totals":[4,7,7,5,6,2],
            "lo":[[1,0,0,2,1],[2,0,0,2,2],[1,3,0,0,3],[0,2,1,2,0],[0,0,0,6,0],[1,1,0,0,0]],
            "hi":[[1,0,0,2,1],[2,0,1,2,3],[1,3,0,0,3],[0,2,1,2,0],[0,0,0,6,0],[1,1,0,0,0]]
        }"#,
    )
    .unwrap();
    arena.state.vertex_owner = [
        5, 255, 255, 255, 255, 255, 5, 255, 1, 255, 4, 255, 255, 255, 255, 255, 255, 255, 255, 2,
        255, 1, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 5, 255, 255, 255,
        255, 255, 255, 255, 255, 255, 255, 255, 1, 255, 3, 255, 255, 255, 255, 4, 255, 1, 255, 255,
        255, 255, 255, 0, 255, 3, 255, 255, 255, 2, 255, 1, 255, 255, 0, 255, 3, 255, 255, 255,
        255,
    ];
    arena.state.vertex_tier = [
        1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 1, 0, 0, 0, 0, 2, 0, 1, 0, 0, 0,
        0, 0, 2, 0, 1, 0, 0, 0, 2, 0, 1, 0, 0, 1, 0, 1, 0, 0, 0, 0,
    ];
    arena.state.edge_owner = [
        5, 255, 255, 3, 3, 255, 255, 255, 5, 5, 5, 1, 255, 255, 4, 1, 4, 255, 255, 255, 255, 255,
        255, 255, 255, 5, 2, 255, 2, 2, 5, 1, 255, 4, 4, 4, 4, 4, 255, 255, 255, 255, 255, 255,
        255, 255, 255, 5, 5, 5, 5, 255, 255, 255, 255, 255, 255, 255, 5, 5, 255, 255, 1, 3, 255, 3,
        3, 3, 255, 255, 255, 255, 2, 4, 1, 255, 1, 1, 1, 1, 2, 255, 0, 0, 255, 3, 3, 255, 255, 255,
        1, 2, 255, 1, 1, 1, 255, 255, 255, 0, 0, 0, 3, 3, 255, 255, 1, 255, 1,
    ];
    let resources = [
        [1, 0, 0, 2, 1],
        [2, 0, 1, 2, 2],
        [1, 3, 0, 0, 3],
        [0, 2, 1, 2, 0],
        [0, 0, 0, 6, 0],
        [1, 1, 0, 0, 0],
    ];
    let trade_rates = [
        [3, 3, 3, 3, 3],
        [4, 2, 4, 4, 4],
        [4, 4, 4, 4, 4],
        [4, 4, 4, 4, 4],
        [4, 4, 4, 4, 4],
        [4, 4, 4, 4, 4],
    ];
    let pieces = [
        [10, 4, 3, 0],
        [0, 1, 3, 0],
        [9, 4, 3, 0],
        [5, 2, 4, 0],
        [7, 5, 2, 0],
        [3, 2, 4, 0],
    ];
    let playable_dev = [
        [0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0],
        [1, 0, 0, 0, 0],
        [0, 0, 0, 0, 0],
        [2, 0, 0, 0, 0],
        [0, 0, 0, 0, 0],
    ];
    let bought_dev = [
        [1, 0, 0, 0, 0],
        [0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0],
    ];
    let revealed_dev = [
        [0, 0, 0, 0, 0],
        [0, 0, 1, 0, 1],
        [2, 0, 1, 1, 0],
        [1, 0, 0, 0, 0],
        [3, 0, 1, 0, 1],
        [2, 0, 0, 0, 1],
    ];
    let knights = [0, 0, 2, 1, 3, 2];
    let public_vp = [3, 8, 3, 3, 6, 3];
    let dev_vp = [0, 0, 1, 0, 0, 2];
    let road_len = [5, 11, 3, 8, 4, 5];
    for seat in 0..board.seats() {
        let player = &mut arena.state.players[seat];
        player.resources = resources[seat];
        player.trade_rate = trade_rates[seat];
        player.pieces = pieces[seat];
        player.playable_dev = playable_dev[seat];
        player.bought_dev = bought_dev[seat];
        player.dev_plays_revealed = revealed_dev[seat];
        player.knights_played = knights[seat];
        player.vp_public = public_vp[seat];
        player.vp_dev = dev_vp[seat];
        player.longest_road_len = road_len[seat];
    }
    arena.state.bank = [19, 18, 22, 12, 18];
    arena.state.robber = 26;
    arena.state.longest_road = RoadCard {
        holder: Some(1),
        retired: false,
    };
    arena.state.largest_army = Some(4);
    arena.state.round = 7;
    arena.state.current_seat = 5;
    (topology, board, rules, config, arena)
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
    // The estimate crosses the legacy VP threshold; the danger model does not embargo a
    // seat with zero production regardless of hidden cards.
    assert!(embargoed(&view, 1, true));
    assert!(!embargoed(&view, 1, false));
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
fn legacy_embargo_blocks_a_seat_at_one_point_below_the_win_threshold() {
    let (topology, board, mut rules, config, mut arena) = fixture();
    enable_trading(&mut rules);
    arena.prepare(&board, &topology, &rules, &config);
    arena.state.players[1].vp_public = rules.win_vp - 1;
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);

    assert!(embargoed(&view, 1, true));
}

// Forwarded arguments of `trade::embargoed` (SIM-GAP-27), one observing test each:
// - `view` (trade config gate): invalid_trade_params_panic_before_response_without_trade_config
//   (no trading config means nobody is embargoed on any path)
// - `seat` (self-check vs belief estimate): the_self_check_prices_the_real_hand_not_the_belief
// - `legacy_vp`: hidden_vp_estimate_crosses_the_embargo_threshold_and_is_monotone_in_confidence
//   (same view, both flag values, opposite verdicts)
// - `embargo_danger_floor`: the_danger_embargo_thresholds_match_the_capped_etw_closed_form
// - `embargo_danger`: the_danger_embargo_thresholds_match_the_capped_etw_closed_form
// - `embargo_takeover_danger` and the award-imminence queries:
//   embargo_detects_a_single_road_bridging_two_components_into_longest_road,
//   embargo_detects_largest_army_one_knight_away
// - `hidden_vp_confidence` (legacy path only): responder_embargo_does_not_depend_on_the_proposers_hidden_vp
// - policy kind -> flag (engine eligibility pass): the_engine_forwards_each_seats_legacy_embargo_flag

/// Zero production caps ETW at exactly `ETW_CAP`, so danger is exactly
/// `floor / (ETW_CAP + floor)` and the threshold comparison is a closed form.
#[test]
fn the_danger_embargo_thresholds_match_the_capped_etw_closed_form() {
    let capped_danger = |floor: f64| floor / (etw::ETW_CAP + floor);
    for (config, expected) in [
        // Boundary inclusive: danger >= threshold embargoes.
        (
            TradeConfig {
                embargo_danger_floor: 4.0,
                embargo_danger: capped_danger(4.0),
                ..TradeConfig::default()
            },
            true,
        ),
        // Nudged above the seat's danger: no embargo.
        (
            TradeConfig {
                embargo_danger_floor: 4.0,
                embargo_danger: capped_danger(4.0) + 1e-12,
                ..TradeConfig::default()
            },
            false,
        ),
        // Same threshold, default floor 1.0: 1/501 sits far below 4/504.
        (
            TradeConfig {
                embargo_danger: capped_danger(4.0),
                ..TradeConfig::default()
            },
            false,
        ),
    ] {
        let (topology, board, mut rules, game_config, mut arena) = fixture();
        rules.player_trading = Some(config);
        arena.prepare(&board, &topology, &rules, &game_config);
        let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
        assert_eq!(etw::etw_for_seat(&view, 1), etw::ETW_CAP);
        assert_eq!(embargoed(&view, 1, false), expected, "config={config:?}");
    }
}

#[test]
fn the_self_check_prices_the_real_hand_not_the_belief() {
    let build = |config: TradeConfig| {
        let (topology, board, mut rules, game_config, mut arena) = fixture();
        rules.player_trading = Some(config);
        arena.prepare(&board, &topology, &rules, &game_config);
        give_four_cities(&mut arena, 1);
        give_settlement(&mut arena, 1, 4);
        // Bank moves never touch the belief state, so seat 1's hand is invisible to rivals.
        for resource in Resource::ALL {
            move_from_bank(&mut arena, 1, resource, 2);
        }
        (topology, board, arena)
    };

    let (topology, board, arena) = build(TradeConfig::default());
    let floor = TradeConfig::default().embargo_danger_floor;
    let self_view = arena.decision_view(&board, &topology, 1, DecisionPhase::TradeResponse);
    let self_danger = threat::danger_from_etw(
        etw::expected_turns_to_win(&trading::own_inputs(&self_view)),
        floor,
    );
    let rival_view = arena.decision_view(&board, &topology, 0, DecisionPhase::TradeResponse);
    let rival_danger = threat::danger_from_etw(
        etw::expected_turns_to_win(&etw::inputs_for_seat(&rival_view, 1)),
        floor,
    );
    assert!(
        self_danger > rival_danger,
        "the hidden hand must buy down the self ETW (self={self_danger}, rival={rival_danger})"
    );

    let threshold = (self_danger + rival_danger) / 2.0;
    let (topology, board, arena) = build(TradeConfig {
        embargo_danger: threshold,
        ..TradeConfig::default()
    });
    let self_view = arena.decision_view(&board, &topology, 1, DecisionPhase::TradeResponse);
    assert!(embargoed(&self_view, 1, false));
    let rival_view = arena.decision_view(&board, &topology, 0, DecisionPhase::TradeResponse);
    assert!(!embargoed(&rival_view, 1, false));
}

#[test]
fn the_engine_forwards_each_seats_legacy_embargo_flag() {
    assert!(policy::vp_embargo(
        PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacyembargo
    ));
    assert!(!policy::vp_embargo(
        PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenial
    ));
    assert!(!policy::vp_embargo(PolicyKind::HeuristicV1Trader));

    // A zero-production seat one point from winning is embargoed only by the legacy
    // thresholds, so which model the engine consults is observable through the trade RNG
    // stream: an embargoed proposer dies before any responder consultation draws from it.
    let (topology, board, mut rules, mut config, mut arena) = fixture();
    enable_trading(&mut rules);
    config.policies = [PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenial; 6];
    arena.prepare(&board, &topology, &rules, &config);
    move_from_bank(&mut arena, 0, Resource::Wood, 1);
    move_from_bank(&mut arena, 1, Resource::Ore, 1);
    // The responder needs a goal to reach the acceptance draw at all.
    give_road(&mut arena, 1, 10);
    arena.state.players[0].vp_public = rules.win_vp - 1;
    let proposer_view = arena.decision_view(&board, &topology, 0, DecisionPhase::TradeResponse);
    assert!(embargoed(&proposer_view, 0, true));
    assert!(!embargoed(&proposer_view, 0, false));
    let offer = Action::OfferTrade {
        give: Resource::Wood,
        get: Resource::Ore,
        count: 1,
    };

    let mut legacy = arena.clone();
    let trace_before = arena.trade_trace_for_test::<4>();

    assert!(arena.apply_action_for_test(
        &board,
        &topology,
        &rules,
        &config,
        0,
        offer,
        DecisionPhase::Action,
    ));
    assert_ne!(
        arena.trade_trace_for_test::<4>(),
        trace_before,
        "the danger model must let the proposer through to responder consultation"
    );

    let mut legacy_config = config.clone();
    legacy_config.policies =
        [PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacyembargo; 6];
    assert!(legacy.apply_action_for_test(
        &board,
        &topology,
        &rules,
        &legacy_config,
        0,
        offer,
        DecisionPhase::Action,
    ));
    assert_eq!(
        legacy.trade_trace_for_test::<4>(),
        trace_before,
        "the legacy flag must embargo the proposer before any responder is consulted"
    );
}

/// The embargo floor still defaults with the threat-side danger floor; the trade-side
/// floor was decoupled by the Phase-I adoption (M-46), which moved only the trade axis
/// the sweep won on.
#[test]
fn the_embargo_floor_defaults_with_the_threat_danger_floor() {
    assert_eq!(
        TradeConfig::default().embargo_danger_floor,
        ThreatParams::default().danger_floor
    );
    assert_eq!(TradeParams::default().danger_floor, 4.0);
}

#[test]
fn embargoed_responder_is_skipped_without_mutating_any_hand() {
    let (topology, board, mut rules, mut config, mut arena) = fixture();
    // 0.02 splits a building seat's danger from an empty seat's floor of 1/501.
    rules.player_trading = Some(TradeConfig {
        opponent_gain_weight: 0.0,
        acceptance_temperature: 0.0,
        embargo_danger: 0.02,
        ..TradeConfig::default()
    });
    config.policies = [PolicyKind::HeuristicV1Trader; 6];
    arena.prepare(&board, &topology, &rules, &config);
    move_from_bank(&mut arena, 0, Resource::Wood, 1);
    move_from_bank(&mut arena, 1, Resource::Ore, 1);
    give_road(&mut arena, 1, 10);
    give_four_cities(&mut arena, 1);
    give_settlement(&mut arena, 1, 4);
    assert_eq!(arena.state.players[1].vp_public, rules.win_vp - 1);
    // The engine's eligibility pass runs each seat's self-check.
    let responder_view = arena.decision_view(&board, &topology, 1, DecisionPhase::TradeResponse);
    assert!(embargoed(&responder_view, 1, false));
    let proposer_view = arena.decision_view(&board, &topology, 0, DecisionPhase::TradeResponse);
    assert!(!embargoed(&proposer_view, 0, false));
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
    // Zero production caps ETW at 500, so danger is exactly floor/(500+floor) = 1/501: the
    // hard threshold is out of reach and the takeover threshold sits just below the seat's
    // danger, so only the imminence clause can embargo.
    rules.player_trading = Some(TradeConfig {
        embargo_danger: 1.0,
        embargo_takeover_danger: 1.0 / 501.0,
        ..TradeConfig::default()
    });
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
    assert!(embargoed(&view, 1, false));
}

#[test]
fn embargo_detects_largest_army_one_knight_away() {
    let (topology, board, mut rules, config, mut arena) = fixture();
    rules.player_trading = Some(TradeConfig {
        embargo_danger: 1.0,
        embargo_takeover_danger: 1.0 / 501.0,
        ..TradeConfig::default()
    });
    arena.prepare(&board, &topology, &rules, &config);
    arena.state.players[1].vp_public = rules.win_vp - 2;
    arena.state.players[1].knights_played = 3;
    arena.state.players[2].knights_played = 3;
    arena.state.largest_army = Some(2);
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);

    assert!(view.knight_takes_largest_army_for(1));
    assert!(embargoed(&view, 1, false));
    // Seat 3 sits at the same danger but holds no imminent award swing, so the takeover
    // clause alone cannot embargo it.
    assert!(!view.knight_takes_largest_army_for(3));
    assert!(!view.road_takes_longest_road(3));
    assert!(!embargoed(&view, 3, false));
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

    assert!(!embargoed(&view, 1, false));
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
    assert_eq!(first_view.dev_count(0), second_view.dev_count(0));
    assert_eq!(
        conservative_hidden_vp_for(&first_view, 0, 0.9),
        conservative_hidden_vp_for(&second_view, 0, 0.9)
    );
    assert_eq!(
        vp_estimate(&first_view, 0, 0.9),
        vp_estimate(&second_view, 0, 0.9)
    );
    for kind in [
        PolicyKind::HeuristicV1Trader,
        PolicyKind::HeuristicV1TraderAware,
    ] {
        let mut first_rng = Xoshiro256StarStar::from_seed(7);
        let mut second_rng = Xoshiro256StarStar::from_seed(7);
        assert_eq!(
            policy::respond_trade(kind, &first_view, offer, &mut first_rng),
            policy::respond_trade(kind, &second_view, offer, &mut second_rng)
        );
    }
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
    assert_eq!(arena.state.players[2].resources[Resource::Wood.index()], 1);
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
    assert_eq!(arena.state.players[1].resources[Resource::Wood.index()], 1);
}

#[test]
fn every_ungated_policy_kind_selects_the_same_farthest_counterparty() {
    let (topology, board, mut rules, config, mut arena) = fixture();
    enable_trading(&mut rules);
    arena.prepare(&board, &topology, &rules, &config);
    let proposer = 3;
    let view = arena.decision_view(&board, &topology, proposer, DecisionPhase::TradeResponse);
    let delta = policy::trading::responder_delta(TradeOffer {
        proposer,
        give: Resource::Wood,
        get: Resource::Ore,
        count: 1,
    });

    for kind in [
        PolicyKind::RandomLegal,
        PolicyKind::GreedyNoTrade,
        PolicyKind::PriorityTrader,
        PolicyKind::HeuristicV1,
        PolicyKind::HeuristicV1Noports,
        PolicyKind::HeuristicV1Trader,
    ] {
        assert_eq!(policy::select_counterparty(kind, &view, &delta, &[0, 2]), 2);
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
        ..TradeConfig::default()
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
    assert_eq!(arena.state.players[2].resources[Resource::Wood.index()], 1);
}

#[test]
fn embargoed_proposer_is_declined_before_any_counterparty_mutation() {
    let (topology, board, mut rules, mut config, mut arena) = fixture();
    rules.player_trading = Some(TradeConfig {
        opponent_gain_weight: 0.0,
        acceptance_temperature: 0.0,
        embargo_danger: 0.02,
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
    let proposer_view = arena.decision_view(&board, &topology, 0, DecisionPhase::TradeResponse);
    assert!(embargoed(&proposer_view, 0, false));
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
        embargo_danger: 0.02,
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
    for arena in [&first, &second] {
        let responder_view = arena.decision_view(&board, &topology, 1, DecisionPhase::TradeResponse);
        assert!(embargoed(&responder_view, 1, false));
        let proposer_view = arena.decision_view(&board, &topology, 0, DecisionPhase::TradeResponse);
        assert!(!embargoed(&proposer_view, 0, false));
    }
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
    assert_eq!(first.state.players[1].resources[Resource::Wood.index()], 0);
    assert_eq!(second.state.players[1].resources[Resource::Wood.index()], 0);
}

#[test]
fn trading_results_are_byte_identical_between_serial_and_parallel_schedules() {
    let (topology, board, mut rules, mut config, _) = fixture();
    enable_trading(&mut rules);
    rules.turn_cap = 20;
    for kind in [
        PolicyKind::HeuristicV1Trader,
        PolicyKind::HeuristicV1TraderAware,
    ] {
        config.policies = [kind; 6];
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
            serde_json::to_vec(&parallel).unwrap(),
            "{kind:?}"
        );
    }
}

#[test]
#[cfg(debug_assertions)]
#[should_panic]
fn invalid_trade_params_panic_before_response_without_trade_config() {
    let (topology, board, _rules, _config, arena) = fixture();
    let view = arena.decision_view(&board, &topology, 1, DecisionPhase::TradeResponse);
    let offer = TradeOffer {
        proposer: 0,
        give: Resource::Wood,
        get: Resource::Ore,
        count: 1,
    };
    let mut rng = Xoshiro256StarStar::from_seed(1);
    heuristic_v1_trader::respond_trade(&view, offer, &invalid_trading_params(), &mut rng);
}

#[test]
#[cfg(debug_assertions)]
#[should_panic]
fn invalid_trade_params_panic_before_response_in_the_wrong_phase() {
    let (topology, board, mut rules, config, mut arena) = fixture();
    enable_trading(&mut rules);
    arena.prepare(&board, &topology, &rules, &config);
    let view = arena.decision_view(&board, &topology, 1, DecisionPhase::Action);
    let offer = TradeOffer {
        proposer: 0,
        give: Resource::Wood,
        get: Resource::Ore,
        count: 1,
    };
    let mut rng = Xoshiro256StarStar::from_seed(1);
    heuristic_v1_trader::respond_trade(&view, offer, &invalid_trading_params(), &mut rng);
}

#[test]
#[cfg(debug_assertions)]
#[should_panic]
fn invalid_trade_params_panic_before_response_with_no_requested_resource() {
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
    let mut rng = Xoshiro256StarStar::from_seed(1);
    heuristic_v1_trader::respond_trade(&view, offer, &invalid_trading_params(), &mut rng);
}

#[test]
#[cfg(debug_assertions)]
#[should_panic]
fn invalid_trade_params_panic_before_response_with_no_goal() {
    let (topology, board, mut rules, config, mut arena) = fixture();
    enable_trading(&mut rules);
    arena.prepare(&board, &topology, &rules, &config);
    move_from_bank(&mut arena, 1, Resource::Ore, 1);
    let view = arena.decision_view(&board, &topology, 1, DecisionPhase::TradeResponse);
    let offer = TradeOffer {
        proposer: 0,
        give: Resource::Wood,
        get: Resource::Ore,
        count: 1,
    };
    let mut rng = Xoshiro256StarStar::from_seed(1);
    heuristic_v1_trader::respond_trade(&view, offer, &invalid_trading_params(), &mut rng);
}

#[test]
#[cfg(debug_assertions)]
#[should_panic]
fn invalid_trade_params_panic_before_action_with_no_legal_offer() {
    let (topology, board, mut rules, config, mut arena) = fixture();
    enable_trading(&mut rules);
    arena.prepare(&board, &topology, &rules, &config);
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let mut scratch = PolicyScratch::default();
    let mut rng = Xoshiro256StarStar::from_seed(1);
    heuristic_v1_trader::action(&view, &mut scratch, &invalid_trading_params(), &mut rng);
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

#[test]
fn trader_gate_policy_names_round_trip() {
    for (name, kind) in [
        (
            "heuristic-v1-trader-threat",
            PolicyKind::HeuristicV1TraderThreat,
        ),
        (
            "heuristic-v1-trader-devcards",
            PolicyKind::HeuristicV1TraderDevcards,
        ),
        (
            "heuristic-v1-trader-threat-devcards",
            PolicyKind::HeuristicV1TraderThreatDevcards,
        ),
        (
            "heuristic-v1-trader-aware",
            PolicyKind::HeuristicV1TraderAware,
        ),
        (
            "heuristic-v1-trader-aware-threat",
            PolicyKind::HeuristicV1TraderAwareThreat,
        ),
        (
            "heuristic-v1-trader-aware-devcards",
            PolicyKind::HeuristicV1TraderAwareDevcards,
        ),
        (
            "heuristic-v1-trader-aware-threat-devcards",
            PolicyKind::HeuristicV1TraderAwareThreatDevcards,
        ),
    ] {
        assert_eq!(PolicyKind::parse(name), Some(kind), "{name}");
    }
}

#[test]
fn aware_response_receives_the_policy_trade_params() {
    let (topology, board, rules, _config, arena) = explicit_trading_state();
    let offer = TradeOffer {
        proposer: 2,
        give: Resource::Sheep,
        get: Resource::Wood,
        count: 2,
    };
    let view = arena.decision_view(&board, &topology, 1, DecisionPhase::TradeResponse);
    let margin = trading::acceptance_margin(
        &view,
        &TradeParams::default(),
        rules.player_trading.as_ref().unwrap(),
        offer,
    );
    assert!((margin - 2.004_129_171).abs() <= 1e-6, "margin={margin}");
    let mut aware_rng = Xoshiro256StarStar::from_seed(1);
    let mut denial_rng = Xoshiro256StarStar::from_seed(1);
    let mut baseline_rng = Xoshiro256StarStar::from_seed(1);
    assert!(policy::respond_trade(
        PolicyKind::HeuristicV1TraderAware,
        &view,
        offer,
        &mut aware_rng
    ));
    assert!(!policy::respond_trade(
        PolicyKind::HeuristicV1Trader,
        &view,
        offer,
        &mut baseline_rng
    ));
    assert!(policy::respond_trade(
        PolicyKind::HeuristicV1TraderAwareDenial,
        &view,
        offer,
        &mut denial_rng
    ));
}

#[test]
fn every_ablation_kind_dispatches_trade_responses_through_the_trader_path() {
    let (topology, board, _rules, _config, arena) = explicit_trading_state();
    let offer = TradeOffer {
        proposer: 2,
        give: Resource::Sheep,
        get: Resource::Wood,
        count: 2,
    };
    let view = arena.decision_view(&board, &topology, 1, DecisionPhase::TradeResponse);
    for kind in [
        PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacyall,
        PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacyport,
        PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacychooser,
        PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacycityterms,
        PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacyband,
        PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacycitygoal,
        PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacycards,
        PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacydeck,
        PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacyexposure,
    ] {
        let mut rng = Xoshiro256StarStar::from_seed(1);
        assert!(
            policy::respond_trade(kind, &view, offer, &mut rng),
            "{kind:?}"
        );
    }
}

#[test]
fn acceptance_uses_the_proposers_inputs_and_offer_delta() {
    let (topology, board, rules, _config, arena) = explicit_trading_state();
    let params = TradeParams::default();
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::TradeResponse);
    let one = TradeOffer {
        proposer: 1,
        give: Resource::Wood,
        get: Resource::Brick,
        count: 1,
    };
    let two = TradeOffer { count: 2, ..one };
    let one_margin =
        trading::acceptance_margin(&view, &params, rules.player_trading.as_ref().unwrap(), one);
    let two_margin =
        trading::acceptance_margin(&view, &params, rules.player_trading.as_ref().unwrap(), two);
    assert!((one_margin - -4.625_853_062).abs() <= 1e-6);
    assert!((two_margin - -3.643_231_153).abs() <= 1e-6);
    assert_ne!(one_margin, two_margin);

    let proposer = etw::inputs_for_seat(&view, one.proposer);
    let theirs_one = trading::counterparty_score(&proposer, &params, &trading::proposer_delta(one));
    let theirs_two = trading::counterparty_score(&proposer, &params, &trading::proposer_delta(two));
    assert_ne!(theirs_one, theirs_two);
}

#[test]
fn acceptance_uses_the_proposers_trade_rates_and_production() {
    let (topology, board, rules, _config, arena) = explicit_trading_state();
    let params = TradeParams::default();
    let offer = TradeOffer {
        proposer: 1,
        give: Resource::Wheat,
        get: Resource::Sheep,
        count: 1,
    };
    let view = arena.decision_view(&board, &topology, 2, DecisionPhase::TradeResponse);
    assert_eq!(
        Resource::ALL.map(|resource| view.trade_rate_for(1, resource)),
        [4, 2, 4, 4, 4]
    );
    assert_eq!(
        Resource::ALL.map(|resource| view.trade_rate_for(2, resource)),
        [4, 4, 4, 4, 4]
    );
    let margin = trading::acceptance_margin(
        &view,
        &params,
        rules.player_trading.as_ref().unwrap(),
        offer,
    );
    assert!((margin - -4.075_591_564).abs() <= 1e-6, "margin={margin}");

    let offer = TradeOffer {
        proposer: 1,
        give: Resource::Wood,
        get: Resource::Brick,
        count: 1,
    };
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::TradeResponse);
    let margin = trading::acceptance_margin(
        &view,
        &params,
        rules.player_trading.as_ref().unwrap(),
        offer,
    );
    assert!((margin - -4.625_853_062).abs() <= 1e-6, "margin={margin}");
}

#[test]
fn own_inputs_replace_uncertain_belief_with_the_exact_hand() {
    let (topology, board, rules, _config, arena) = explicit_trading_state();
    let offer = TradeOffer {
        proposer: 2,
        give: Resource::Ore,
        get: Resource::Brick,
        count: 1,
    };
    let view = arena.decision_view(&board, &topology, 1, DecisionPhase::TradeResponse);
    assert_eq!(view.belief().expected(1), [2.0, 0.0, 0.5, 2.0, 2.5]);
    assert_eq!(*view.own_hand(), [2, 0, 1, 2, 2]);
    assert_eq!(
        trading::own_inputs(&view).belief_expected,
        [2.0, 0.0, 1.0, 2.0, 2.0]
    );
    let margin = trading::acceptance_margin(
        &view,
        &TradeParams::default(),
        rules.player_trading.as_ref().unwrap(),
        offer,
    );
    assert!((margin - 0.612_004_817).abs() <= 1e-6, "margin={margin}");
}

#[test]
fn acceptance_forwards_opponent_weight_and_margin_scale() {
    let offer = TradeOffer {
        proposer: 1,
        give: Resource::Wood,
        get: Resource::Brick,
        count: 1,
    };
    let (topology, board, rules, _config, arena) = explicit_trading_state();
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::TradeResponse);
    let weighted = trading::acceptance_margin(
        &view,
        &TradeParams::default(),
        rules.player_trading.as_ref().unwrap(),
        offer,
    );
    let unweighted_config = TradeConfig {
        opponent_gain_weight: 0.0,
        ..*rules.player_trading.as_ref().unwrap()
    };
    let unweighted =
        trading::acceptance_margin(&view, &TradeParams::default(), &unweighted_config, offer);
    assert!((weighted - -4.625_853_062).abs() <= 1e-6);
    assert!((unweighted - 0.238_586_158).abs() <= 1e-6);

    let (topology, board, mut rules, config, arena) = explicit_trading_state();
    let state = arena.state.clone();
    rules.player_trading = Some(TradeConfig::default());
    let mut arena = GameArena::default();
    arena.prepare(&board, &topology, &rules, &config);
    arena.state = state;
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::TradeResponse);
    let margin = trading::acceptance_margin(
        &view,
        &TradeParams::default(),
        rules.player_trading.as_ref().unwrap(),
        offer,
    );
    let probability = acceptance_probability(margin, 0.5);
    assert!((margin - -4.625_853_062).abs() <= 1e-6, "margin={margin}");
    assert!((probability - 0.000_095_939).abs() <= 1e-6);
    let mut rng = Xoshiro256StarStar::from_seed(23);
    assert!(!policy::respond_trade(
        PolicyKind::HeuristicV1TraderAware,
        &view,
        offer,
        &mut rng
    ));
}

#[test]
fn aware_counterparty_selection_uses_the_shared_score() {
    let (topology, board, _rules, _config, arena) = explicit_trading_state();
    let proposer = 1;
    let offer = TradeOffer {
        proposer,
        give: Resource::Wheat,
        get: Resource::Wood,
        count: 2,
    };
    let view = arena.decision_view(&board, &topology, proposer, DecisionPhase::TradeResponse);
    assert_eq!(vp_estimate(&view, 0, 0.9), vp_estimate(&view, 2, 0.9));
    let delta = trading::responder_delta(offer);
    let scores = [0, 2].map(|seat| {
        trading::counterparty_score(
            &etw::inputs_for_seat(&view, seat),
            &TradeParams::default(),
            &delta,
        )
    });
    assert!((scores[0] - 0.331_008_784).abs() <= 1e-9);
    assert!((scores[1] - 0.303_406_592).abs() <= 1e-9);
    assert_eq!(
        policy::select_counterparty(PolicyKind::HeuristicV1TraderAware, &view, &delta, &[0, 2]),
        2
    );
    assert_eq!(
        policy::select_counterparty(PolicyKind::HeuristicV1Trader, &view, &delta, &[0, 2]),
        0
    );
}

#[test]
fn responder_delta_and_offer_count_reach_counterparty_selection() {
    let (topology, board, _rules, _config, arena) = explicit_trading_state();
    let offer = TradeOffer {
        proposer: 1,
        give: Resource::Wood,
        get: Resource::Brick,
        count: 1,
    };
    let view = arena.decision_view(&board, &topology, 1, DecisionPhase::TradeResponse);
    let delta = trading::responder_delta(offer);
    let scores = [3, 4].map(|seat| {
        trading::counterparty_score(
            &etw::inputs_for_seat(&view, seat),
            &TradeParams::default(),
            &delta,
        )
    });
    assert!((scores[0] - 0.164_123_419).abs() <= 1e-9);
    assert!((scores[1] - 0.351_821_595).abs() <= 1e-9);
    assert_eq!(
        policy::select_counterparty(PolicyKind::HeuristicV1TraderAware, &view, &delta, &[3, 4]),
        3
    );

    let (topology, board, _rules, _config, arena) = deterministic_truncated_game(1);
    let offer = TradeOffer {
        proposer: 0,
        give: Resource::Sheep,
        get: Resource::Ore,
        count: 2,
    };
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::TradeResponse);
    let delta = trading::responder_delta(offer);
    let scores = [3, 4].map(|seat| {
        trading::counterparty_score(
            &etw::inputs_for_seat(&view, seat),
            &TradeParams::default(),
            &delta,
        )
    });
    assert!(
        scores[1] < scores[0],
        "replay precondition: seat 4 must be the cheaper counterparty (scores={scores:?})"
    );
    assert_eq!(
        policy::select_counterparty(PolicyKind::HeuristicV1TraderAware, &view, &delta, &[3, 4]),
        4
    );
}

#[test]
fn applied_aware_trade_mutates_the_selected_recipients_hand() {
    let (topology, board, rules, mut config, mut arena) = explicit_trading_state();
    config.policies[1] = PolicyKind::HeuristicV1TraderAware;
    let proposer_view = arena.decision_view(&board, &topology, 1, DecisionPhase::TradeResponse);
    assert!(
        !embargoed(&proposer_view, 1, false),
        "fixture precondition: proposer embargoed"
    );
    let seat_three_before = arena.state.players[3].resources[Resource::Wood.index()];
    let seat_four_before = arena.state.players[4].resources[Resource::Wood.index()];
    assert!(arena.apply_action_for_test(
        &board,
        &topology,
        &rules,
        &config,
        1,
        Action::OfferTrade {
            give: Resource::Wood,
            get: Resource::Brick,
            count: 1,
        },
        DecisionPhase::Action,
    ));
    assert_eq!(
        arena.state.players[3].resources[Resource::Wood.index()],
        seat_three_before + 1
    );
    assert_eq!(
        arena.state.players[4].resources[Resource::Wood.index()],
        seat_four_before
    );
}

#[test]
fn applied_aware_trade_forwards_the_offer_count_to_selection() {
    let (topology, board, rules, mut config, mut arena) = deterministic_truncated_game(0);
    config.policies[0] = PolicyKind::HeuristicV1TraderAware;
    arena.begin_turn_for_test(&board, &topology, &rules, &config, 0);
    let seat_two_before = arena.state.players[2].resources[Resource::Wood.index()];
    let seat_three_before = arena.state.players[3].resources[Resource::Wood.index()];
    let action = Action::OfferTrade {
        give: Resource::Wood,
        get: Resource::Ore,
        count: 2,
    };
    assert!(
        arena.validate_action(&board, &topology, 0, action, DecisionPhase::Action),
        "hand={:?}",
        arena.state.players[0].resources
    );
    // Replay preconditions (SIM-GAP-31): the subject observes count-forwarding only if the two
    // pinned seats both accept and seat 3 strictly minimises the counterparty score over the
    // whole acceptor set under the count-2 delta.
    let offer = TradeOffer {
        proposer: 0,
        give: Resource::Wood,
        get: Resource::Ore,
        count: 2,
    };
    let proposer_view = arena.decision_view(&board, &topology, 0, DecisionPhase::TradeResponse);
    assert!(
        !embargoed(&proposer_view, 0, false),
        "replay precondition: proposer embargoed"
    );
    let mut acceptors = Vec::new();
    for seat in 1..board.seats() {
        if arena.state.players[seat].resources[Resource::Ore.index()] < 1 {
            continue;
        }
        let view = arena.decision_view(&board, &topology, seat, DecisionPhase::TradeResponse);
        if embargoed(&view, seat, false) {
            continue;
        }
        // Acceptance is deterministic at acceptance_temperature 0.0, so any seed works.
        let mut rng = Xoshiro256StarStar::from_seed(seat as u64);
        if policy::respond_trade(PolicyKind::HeuristicV1Trader, &view, offer, &mut rng) {
            acceptors.push(seat);
        }
    }
    assert!(
        acceptors.contains(&2) && acceptors.contains(&3),
        "replay precondition: seats 2 and 3 must both accept (acceptors={acceptors:?})"
    );
    let delta = trading::responder_delta(offer);
    let score = |seat: usize| {
        trading::counterparty_score(
            &etw::inputs_for_seat(&proposer_view, seat),
            &TradeParams::default(),
            &delta,
        )
    };
    assert!(
        acceptors
            .iter()
            .all(|seat| *seat == 3 || score(3) < score(*seat)),
        "replay precondition: seat 3 must be the strict cheapest acceptor (scores={:?})",
        acceptors
            .iter()
            .map(|seat| (*seat, score(*seat)))
            .collect::<Vec<_>>()
    );
    assert!(arena.apply_action_for_test(
        &board,
        &topology,
        &rules,
        &config,
        0,
        action,
        DecisionPhase::Action,
    ));
    assert_eq!(
        arena.state.players[2].resources[Resource::Wood.index()],
        seat_two_before
    );
    assert_eq!(
        arena.state.players[3].resources[Resource::Wood.index()],
        seat_three_before + 2
    );
}

#[test]
fn applied_aware_trade_forwards_a_nonzero_delta_to_selection() {
    let (topology, board, rules, mut config, mut arena) = explicit_trading_state();
    config.policies = [PolicyKind::HeuristicV1TraderAware; 6];
    move_from_bank(&mut arena, 0, Resource::Ore, 1);
    let seat_five_before = arena.state.players[5].resources[Resource::Wood.index()];
    let seat_two_before = arena.state.players[2].resources[Resource::Wood.index()];
    let action = Action::OfferTrade {
        give: Resource::Ore,
        get: Resource::Wood,
        count: 2,
    };
    // Fixture preconditions, asserted rather than claimed: under the count-2 responder
    // delta seat 2 is the strict cheapest of the wood-holding acceptors {1, 2, 5}, while
    // a zero (unforwarded) delta ranks seat 5 below seat 2 — so the seat-5 assertion at
    // the end fails if the delta does not reach selection.
    {
        let proposer_view = arena.decision_view(&board, &topology, 0, DecisionPhase::TradeResponse);
        let delta = trading::responder_delta(TradeOffer {
            proposer: 0,
            give: Resource::Ore,
            get: Resource::Wood,
            count: 2,
        });
        let score = |seat: usize, delta: &[f64; RESOURCE_COUNT]| {
            trading::counterparty_score(
                &etw::inputs_for_seat(&proposer_view, seat),
                &TradeParams::default(),
                delta,
            )
        };
        for other in [1, 5] {
            assert!(
                score(2, &delta) < score(other, &delta),
                "fixture precondition: seat 2 must be the strict cheapest under the real delta"
            );
        }
        let zero = [0.0; RESOURCE_COUNT];
        assert!(
            score(5, &zero) < score(2, &zero),
            "fixture precondition: a zero delta must prefer seat 5, else the subject is untested"
        );
    }
    assert!(arena.apply_action_for_test(
        &board,
        &topology,
        &rules,
        &config,
        0,
        action,
        DecisionPhase::Action,
    ));
    assert_eq!(
        arena.state.players[5].resources[Resource::Wood.index()],
        seat_five_before
    );
    assert_eq!(
        arena.state.players[2].resources[Resource::Wood.index()],
        seat_two_before - 1
    );
}

#[test]
fn exact_counterparty_ties_keep_the_first_acceptor() {
    let (topology, board, mut rules, config, mut arena) = fixture();
    enable_trading(&mut rules);
    arena.prepare(&board, &topology, &rules, &config);
    let view = arena.decision_view(&board, &topology, 1, DecisionPhase::TradeResponse);
    assert_eq!(
        trading::select_counterparty(
            &view,
            &TradeParams::default(),
            &[0.0; RESOURCE_COUNT],
            &[0, 2]
        ),
        0
    );
}

#[test]
fn aware_action_receives_the_policy_trade_params() {
    let (topology, board, _rules, _config, arena) = deterministic_truncated_game(0);
    let view = arena.decision_view(&board, &topology, 2, DecisionPhase::Action);
    assert_can_offer(&view, Resource::Ore, Resource::Wheat, 1);
    assert!(
        !eligible_recipients(&view, Resource::Wheat).is_empty(),
        "replay precondition: no eligible wheat recipient remains"
    );
    let run = |kind| {
        let mut scratch = PolicyScratch::default();
        let mut rng = Xoshiro256StarStar::from_seed(8_u64 << 48 ^ 0 << 8 ^ 2);
        policy::action(kind, &view, &mut scratch, &mut rng)
    };
    assert_eq!(
        run(PolicyKind::HeuristicV1TraderAware),
        Action::OfferTrade {
            give: Resource::Ore,
            get: Resource::Wheat,
            count: 1,
        }
    );
    assert_ne!(
        run(PolicyKind::HeuristicV1Trader),
        run(PolicyKind::HeuristicV1TraderAware)
    );
}

#[test]
fn aware_action_checks_every_eligible_recipient() {
    let (topology, board, _rules, _config, arena) = deterministic_truncated_game(0);
    let view = arena.decision_view(&board, &topology, 3, DecisionPhase::Action);
    assert_can_offer(&view, Resource::Brick, Resource::Wheat, 1);
    let recipients = eligible_recipients(&view, Resource::Wheat);
    assert!(
        recipients.len() >= 2,
        "replay precondition: checking every recipient needs at least two, got {recipients:?}"
    );
    let mut scratch = PolicyScratch::default();
    let mut rng = Xoshiro256StarStar::from_seed(8_u64 << 48 ^ 0 << 8 ^ 3);
    assert_eq!(
        policy::action(
            PolicyKind::HeuristicV1TraderAware,
            &view,
            &mut scratch,
            &mut rng
        ),
        Action::OfferTrade {
            give: Resource::Brick,
            get: Resource::Wheat,
            count: 1,
        }
    );
}

#[test]
fn aware_action_uses_the_minimum_recipient_score() {
    let (topology, board, _rules, _config, arena) = deterministic_truncated_game(15);
    let view = arena.decision_view(&board, &topology, 4, DecisionPhase::Action);
    assert_can_offer(&view, Resource::Sheep, Resource::Ore, 1);
    let recipients = eligible_recipients(&view, Resource::Ore);
    assert!(
        recipients.len() >= 2,
        "replay precondition: the minimum needs at least two recipients, got {recipients:?}"
    );
    let delta = trading::responder_delta(TradeOffer {
        proposer: 4,
        give: Resource::Sheep,
        get: Resource::Ore,
        count: 1,
    });
    let scores: Vec<f64> = recipients
        .iter()
        .map(|seat| {
            trading::counterparty_score(
                &etw::inputs_for_seat(&view, *seat),
                &TradeParams::default(),
                &delta,
            )
        })
        .collect();
    assert!(
        scores.iter().any(|score| (score - scores[0]).abs() > 1e-12),
        "replay precondition: flat recipient scores never exercise the minimum (scores={scores:?})"
    );
    let mut scratch = PolicyScratch::default();
    let mut rng = Xoshiro256StarStar::from_seed(8_u64 << 48 ^ 15 << 8 ^ 4);
    assert_eq!(
        policy::action(
            PolicyKind::HeuristicV1TraderAware,
            &view,
            &mut scratch,
            &mut rng
        ),
        Action::OfferTrade {
            give: Resource::Sheep,
            get: Resource::Ore,
            count: 1,
        }
    );
}

#[test]
fn aware_threat_params_reach_base_action_scoring() {
    let (topology, board, _rules, _config, arena) = deterministic_truncated_game(9);
    let view = arena.decision_view(&board, &topology, 2, DecisionPhase::Action);
    assert_pinned_knight_plays(&view, &[(2, 4), (2, 3)]);
    let seed = 8_u64 << 48 ^ 9 << 8 ^ 2;
    let run = |kind| {
        let mut scratch = PolicyScratch::default();
        let mut rng = Xoshiro256StarStar::from_seed(seed);
        policy::action(kind, &view, &mut scratch, &mut rng)
    };
    assert_eq!(
        run(PolicyKind::HeuristicV1TraderAwareThreat),
        Action::PlayDev(DevPlay::Knight {
            destination: 2,
            victim: Some(4),
        })
    );
    assert_eq!(
        run(PolicyKind::HeuristicV1TraderAware),
        Action::PlayDev(DevPlay::Knight {
            destination: 2,
            victim: Some(3),
        })
    );
}

#[test]
fn aware_pre_roll_receives_threat_and_devcards_params() {
    let (topology, board, _rules, _config, arena) = deterministic_truncated_game(0);
    let view = arena.decision_view(&board, &topology, 4, DecisionPhase::PreRoll);
    assert!(
        view.can_play_dev(4),
        "replay precondition: seat 4 no longer holds a playable monopoly"
    );
    let seed = 8_u64 << 48 ^ 0 << 8 ^ 4;
    let run = |kind| {
        let mut scratch = PolicyScratch::default();
        let mut rng = Xoshiro256StarStar::from_seed(seed);
        policy::pre_roll(kind, &view, &mut scratch, &mut rng)
    };
    assert_eq!(
        run(PolicyKind::HeuristicV1TraderAwareDevcards),
        Some(DevPlay::Monopoly {
            resource: Resource::Brick,
        })
    );
    assert_eq!(
        run(PolicyKind::HeuristicV1Trader),
        Some(DevPlay::Monopoly {
            resource: Resource::Wood,
        })
    );

    let (topology, board, _rules, _config, arena) = deterministic_truncated_game(9);
    let view = arena.decision_view(&board, &topology, 2, DecisionPhase::PreRoll);
    assert_pinned_knight_plays(&view, &[(2, 4), (2, 3)]);
    let seed = 8_u64 << 48 ^ 9 << 8 ^ 2;
    let run = |kind| {
        let mut scratch = PolicyScratch::default();
        let mut rng = Xoshiro256StarStar::from_seed(seed);
        policy::pre_roll(kind, &view, &mut scratch, &mut rng)
    };
    assert_eq!(
        run(PolicyKind::HeuristicV1TraderAwareThreat),
        Some(DevPlay::Knight {
            destination: 2,
            victim: Some(4),
        })
    );
    assert_eq!(
        run(PolicyKind::HeuristicV1TraderAware),
        Some(DevPlay::Knight {
            destination: 2,
            victim: Some(3),
        })
    );
}

#[test]
fn flat_proposal_group_keeps_the_first_enumerated_offer() {
    let expected = Action::OfferTrade {
        give: Resource::Wood,
        get: Resource::Wheat,
        count: 1,
    };
    {
        let (topology, board, _rules, _config, arena) = deterministic_truncated_game(0);
        let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
        assert_can_offer(&view, Resource::Wood, Resource::Wheat, 1);
        assert!(
            !eligible_recipients(&view, Resource::Wheat).is_empty(),
            "replay precondition: no eligible wheat recipient remains"
        );
    }
    let run = |rng_seed| {
        let (topology, board, _rules, _config, arena) = truncated_game(
            0,
            8,
            TradeConfig {
                acceptance_temperature: 0.0,
                ..TradeConfig::default()
            },
        );
        let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
        let mut scratch = PolicyScratch::default();
        let mut rng = Xoshiro256StarStar::from_seed(rng_seed);
        policy::action(
            PolicyKind::HeuristicV1TraderAware,
            &view,
            &mut scratch,
            &mut rng,
        )
    };
    for repeat in 0..8 {
        assert_eq!(run(8_u64 << 48 ^ 0 << 8 ^ 0 ^ repeat), expected);
    }
    let parallel = std::thread::scope(|scope| {
        [
            scope.spawn(|| run(8_u64 << 48 ^ 0 << 8 ^ 0)),
            scope.spawn(|| run(8_u64 << 48 ^ 0 << 8 ^ 0)),
        ]
        .map(|handle| handle.join().unwrap())
    });
    assert_eq!(parallel, [expected; 2]);
}

#[test]
fn proposal_recipient_filter_uses_expected_holdings() {
    let (topology, board, _rules, _config, arena) = truncated_game(
        184,
        8,
        TradeConfig {
            acceptance_temperature: 0.0,
            ..TradeConfig::default()
        },
    );
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    assert!((0..view.seats()).any(|seat| {
        seat != view.observer()
            && !embargoed(&view, seat, false)
            && view.belief().expected(seat)[Resource::Wheat.index()] >= 1.0
            && view.belief().lo(seat)[Resource::Wheat.index()] == 0
    }));
    let mut scratch = PolicyScratch::default();
    let mut rng = Xoshiro256StarStar::from_seed(8_u64 << 48 ^ 184 << 8 ^ 0);
    assert_eq!(
        policy::action(
            PolicyKind::HeuristicV1TraderAware,
            &view,
            &mut scratch,
            &mut rng
        ),
        Action::OfferTrade {
            give: Resource::Wood,
            get: Resource::Wheat,
            count: 1,
        }
    );
}

#[test]
fn proposal_recipient_filter_excludes_embargoed_seats() {
    let (topology, board, _rules, _config, arena) = truncated_game(
        55,
        8,
        TradeConfig {
            acceptance_temperature: 0.0,
            ..TradeConfig::default()
        },
    );
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    assert!((0..view.seats()).any(|seat| seat != view.observer() && embargoed(&view, seat, false)));
    assert!((0..view.seats()).any(|seat| seat != view.observer() && !embargoed(&view, seat, false)));
    let mut scratch = PolicyScratch::default();
    let mut rng = Xoshiro256StarStar::from_seed(8_u64 << 48 ^ 55 << 8 ^ 0);
    assert_eq!(
        policy::action(
            PolicyKind::HeuristicV1TraderAware,
            &view,
            &mut scratch,
            &mut rng
        ),
        Action::OfferTrade {
            give: Resource::Wood,
            get: Resource::Wheat,
            count: 1,
        }
    );
}

#[test]
#[ignore = "searches the forwarding fixture space; run deliberately after implementation"]
fn find_forwarding_fixtures() {
    let mut found_w3 = false;
    let mut found_w13 = false;
    let mut found_w15_devcards = false;
    let mut found_w15_threat = false;
    for turn_cap in [8, 10, 12, 14, 16, 20, 24] {
        for game in 0..60_u64 {
            let (topology, board, _rules, _config, arena) = truncated_game(
                game,
                turn_cap,
                TradeConfig {
                    acceptance_temperature: 0.0,
                    ..TradeConfig::default()
                },
            );
            for seat in 0..board.seats() {
                let seed = u64::from(turn_cap) << 48 ^ game << 8 ^ seat as u64;
                let view = arena.decision_view(&board, &topology, seat, DecisionPhase::Action);
                let run_action = |kind| {
                    let mut scratch = PolicyScratch::default();
                    let mut rng = Xoshiro256StarStar::from_seed(seed);
                    policy::action(kind, &view, &mut scratch, &mut rng)
                };
                let aware = run_action(PolicyKind::HeuristicV1TraderAware);
                let baseline = run_action(PolicyKind::HeuristicV1Trader);
                let aware_threat = run_action(PolicyKind::HeuristicV1TraderAwareThreat);
                if !found_w3 && aware != baseline {
                    eprintln!(
                        "W3 turn_cap={turn_cap} game={game} seat={seat} aware={aware:?} baseline={baseline:?}"
                    );
                    found_w3 = true;
                }
                if !found_w13 && aware_threat != aware {
                    eprintln!(
                        "W13 turn_cap={turn_cap} game={game} seat={seat} correct={aware_threat:?} mutant={aware:?}"
                    );
                    found_w13 = true;
                }
                if matches!(aware, Action::OfferTrade { .. }) {
                    eprintln!(
                        "W12_SCAN turn_cap={turn_cap} game={game} seat={seat} action={aware:?}"
                    );
                }

                let view = arena.decision_view(&board, &topology, seat, DecisionPhase::PreRoll);
                let run_pre_roll = |kind| {
                    let mut scratch = PolicyScratch::default();
                    let mut rng = Xoshiro256StarStar::from_seed(seed);
                    policy::pre_roll(kind, &view, &mut scratch, &mut rng)
                };
                let devcards = run_pre_roll(PolicyKind::HeuristicV1TraderAwareDevcards);
                let default = run_pre_roll(PolicyKind::HeuristicV1Trader);
                let threat = run_pre_roll(PolicyKind::HeuristicV1TraderAwareThreat);
                let aware_pre = run_pre_roll(PolicyKind::HeuristicV1TraderAware);
                if !found_w15_devcards && devcards != default {
                    eprintln!(
                        "W15_DEVCARDS turn_cap={turn_cap} game={game} seat={seat} correct={devcards:?} mutant={default:?}"
                    );
                    found_w15_devcards = true;
                }
                // Threat vs aware, matching the committed test's isolated-axis contrast.
                if !found_w15_threat && threat != aware_pre {
                    eprintln!(
                        "W15_THREAT turn_cap={turn_cap} game={game} seat={seat} correct={threat:?} mutant={aware_pre:?}"
                    );
                    found_w15_threat = true;
                }
            }
            if found_w3 && found_w13 && found_w15_devcards && found_w15_threat {
                return;
            }
        }
    }
    assert!(found_w3, "W3 fixture not found");
    assert!(found_w13, "W13 fixture not found");
    assert!(found_w15_devcards, "W15 dev-cards fixture not found");
    assert!(found_w15_threat, "W15 threat fixture not found");
}

#[test]
fn non_finite_counterparty_scores_use_the_first_acceptor_fallback() {
    let (topology, board, _rules, _config, arena) = truncated_game(
        49,
        12,
        TradeConfig {
            acceptance_temperature: 0.0,
            ..TradeConfig::default()
        },
    );
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::TradeResponse);
    let mut nan_delta = [0.0; RESOURCE_COUNT];
    nan_delta[1] = -10.0;
    let nan_params = TradeParams {
        etw_weight: f64::MAX,
        benefit_weight: 0.0,
        tempo_weight: 0.0,
        ..TradeParams::default()
    };
    let nan_score =
        trading::counterparty_score(&etw::inputs_for_seat(&view, 3), &nan_params, &nan_delta);
    assert!(nan_score.is_nan(), "score={nan_score}");
    assert_eq!(
        trading::select_counterparty(&view, &nan_params, &nan_delta, &[3, 1]),
        1
    );

    let (topology, board, _rules, _config, arena) = deterministic_truncated_game(0);
    let view = arena.decision_view(&board, &topology, 1, DecisionPhase::TradeResponse);
    let delta = [-1.0, 1.0, 0.0, 0.0, 0.0];
    let mixed_params = TradeParams {
        tempo_weight: f64::MAX,
        benefit_weight: f64::MAX,
        ..TradeParams::default()
    };
    assert_eq!(
        [0, 4].map(|seat| trading::counterparty_score(
            &etw::inputs_for_seat(&view, seat),
            &mixed_params,
            &delta,
        )),
        [f64::INFINITY, f64::NEG_INFINITY]
    );
    assert_eq!(
        trading::select_counterparty(&view, &mixed_params, &delta, &[0, 4]),
        0
    );
}

/// Re-finds every replay-derived fixture in this module after a behavior change moves the
/// truncated games. Each block mirrors one test's preconditions and prints the concrete
/// values (game, seat, offer, scores) to pin; run with `--ignored --nocapture` and update
/// the constants in the corresponding test.
#[test]
#[ignore = "searches the replay fixture space; run deliberately after a behavior change"]
fn refind_replay_fixtures() {
    let temp_zero = || TradeConfig {
        acceptance_temperature: 0.0,
        ..TradeConfig::default()
    };

    // aware_action_checks_every_eligible_recipient / aware_action_uses_the_minimum_recipient_score
    // / flat_proposal_group_keeps_the_first_enumerated_offer: an aware offer with enough
    // recipients; MIN needs non-flat scores, FLAT needs the same offer across eight rng streams.
    let mut found_offer = 0;
    for game in 0..300_u64 {
        let (topology, board, _rules, _config, arena) = deterministic_truncated_game(game);
        for seat in 0..board.seats() {
            let view = arena.decision_view(&board, &topology, seat, DecisionPhase::Action);
            let mut scratch = PolicyScratch::default();
            let mut rng = Xoshiro256StarStar::from_seed(8_u64 << 48 ^ game << 8 ^ seat as u64);
            let action = policy::action(PolicyKind::HeuristicV1TraderAware, &view, &mut scratch, &mut rng);
            let Action::OfferTrade { give, get, count: 1 } = action else {
                continue;
            };
            if !view.legal_offer_trade(give, get, 1) {
                continue;
            }
            let recipients = eligible_recipients(&view, get);
            if recipients.len() < 2 {
                continue;
            }
            let delta = trading::responder_delta(TradeOffer {
                proposer: seat,
                give,
                get,
                count: 1,
            });
            let scores: Vec<f64> = recipients
                .iter()
                .map(|other| {
                    trading::counterparty_score(
                        &etw::inputs_for_seat(&view, *other),
                        &TradeParams::default(),
                        &delta,
                    )
                })
                .collect();
            let nonflat = scores.iter().any(|score| (score - scores[0]).abs() > 1e-12);
            let stable = (0..8).all(|repeat| {
                let mut scratch = PolicyScratch::default();
                let mut rng = Xoshiro256StarStar::from_seed(
                    8_u64 << 48 ^ game << 8 ^ seat as u64 ^ repeat,
                );
                policy::action(PolicyKind::HeuristicV1TraderAware, &view, &mut scratch, &mut rng)
                    == action
            });
            eprintln!(
                "OFFER game={game} seat={seat} give={give:?} get={get:?} recipients={recipients:?} nonflat={nonflat} stable={stable}"
            );
            found_offer += 1;
        }
        if found_offer >= 12 {
            break;
        }
    }

    // aware_action_receives_the_policy_trade_params: an aware offer with an eligible recipient
    // where the plain trader arm chooses a different action, so the params seam is observable.
    'params_offer: for game in 0..300_u64 {
        let (topology, board, _rules, _config, arena) = deterministic_truncated_game(game);
        for seat in 0..board.seats() {
            let view = arena.decision_view(&board, &topology, seat, DecisionPhase::Action);
            let seed = 8_u64 << 48 ^ game << 8 ^ seat as u64;
            let run = |kind| {
                let mut scratch = PolicyScratch::default();
                let mut rng = Xoshiro256StarStar::from_seed(seed);
                policy::action(kind, &view, &mut scratch, &mut rng)
            };
            let aware = run(PolicyKind::HeuristicV1TraderAware);
            let Action::OfferTrade { give, get, count: 1 } = aware else {
                continue;
            };
            if !view.legal_offer_trade(give, get, 1)
                || eligible_recipients(&view, get).is_empty()
                || run(PolicyKind::HeuristicV1Trader) == aware
            {
                continue;
            }
            eprintln!("PARAMS_OFFER game={game} seat={seat} give={give:?} get={get:?}");
            break 'params_offer;
        }
    }

    // proposal_recipient_filter_uses_expected_holdings: an aware offer whose `get` has a
    // recipient held only on belief (expected >= 1 with a zero floor), so the filter's
    // expected-holdings read is observable.
    'holdings: for game in 0..300_u64 {
        let (topology, board, _rules, _config, arena) = truncated_game(game, 8, temp_zero());
        let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
        let mut scratch = PolicyScratch::default();
        let mut rng = Xoshiro256StarStar::from_seed(8_u64 << 48 ^ game << 8);
        let action = policy::action(PolicyKind::HeuristicV1TraderAware, &view, &mut scratch, &mut rng);
        let Action::OfferTrade { give, get, count: 1 } = action else {
            continue;
        };
        let believed: Vec<usize> = (0..view.seats())
            .filter(|seat| {
                *seat != view.observer()
                    && !embargoed(&view, *seat, false)
                    && view.belief().expected(*seat)[get.index()] >= 1.0
                    && view.belief().lo(*seat)[get.index()] == 0
            })
            .collect();
        if believed.is_empty() {
            continue;
        }
        eprintln!("HOLDINGS game={game} give={give:?} get={get:?} believed={believed:?}");
        break 'holdings;
    }

    // aware_threat_params_reach_base_action_scoring (and the knight half of
    // aware_pre_roll_receives_threat_and_devcards_params): threat and aware arms both play a
    // knight but disagree on placement, at action and pre-roll phases.
    'knight: for game in 0..300_u64 {
        let (topology, board, _rules, _config, arena) = deterministic_truncated_game(game);
        for seat in 0..board.seats() {
            let seed = 8_u64 << 48 ^ game << 8 ^ seat as u64;
            let both = [DecisionPhase::Action, DecisionPhase::PreRoll].map(|phase| {
                let view = arena.decision_view(&board, &topology, seat, phase);
                let run = |kind| {
                    let mut scratch = PolicyScratch::default();
                    let mut rng = Xoshiro256StarStar::from_seed(seed);
                    match phase {
                        DecisionPhase::Action => match policy::action(kind, &view, &mut scratch, &mut rng) {
                            Action::PlayDev(play) => Some(play),
                            _ => None,
                        },
                        _ => policy::pre_roll(kind, &view, &mut scratch, &mut rng),
                    }
                };
                (run(PolicyKind::HeuristicV1TraderAwareThreat), run(PolicyKind::HeuristicV1TraderAware))
            });
            let [(action_threat, action_aware), (pre_threat, pre_aware)] = both;
            let (Some(DevPlay::Knight { destination: td, victim: tv }), Some(DevPlay::Knight { destination: ad, victim: av })) =
                (action_threat, action_aware)
            else {
                continue;
            };
            if (td, tv) == (ad, av) {
                continue;
            }
            if pre_threat != action_threat || pre_aware != action_aware {
                continue;
            }
            eprintln!(
                "KNIGHT game={game} seat={seat} threat=({td},{tv:?}) aware=({ad},{av:?})"
            );
            break 'knight;
        }
    }

    // aware_pre_roll_receives_threat_and_devcards_params (monopoly half): devcards and default
    // arms both pick a monopoly pre-roll but disagree on the resource.
    'monopoly: for game in 0..600_u64 {
        let (topology, board, _rules, _config, arena) = deterministic_truncated_game(game);
        for seat in 0..board.seats() {
            let view = arena.decision_view(&board, &topology, seat, DecisionPhase::PreRoll);
            if !view.can_play_dev(4) {
                continue;
            }
            let seed = 8_u64 << 48 ^ game << 8 ^ seat as u64;
            let run = |kind| {
                let mut scratch = PolicyScratch::default();
                let mut rng = Xoshiro256StarStar::from_seed(seed);
                policy::pre_roll(kind, &view, &mut scratch, &mut rng)
            };
            let devcards = run(PolicyKind::HeuristicV1TraderAwareDevcards);
            let default = run(PolicyKind::HeuristicV1Trader);
            let (Some(DevPlay::Monopoly { resource: dev }), Some(DevPlay::Monopoly { resource: base })) =
                (devcards, default)
            else {
                continue;
            };
            if dev == base {
                continue;
            }
            eprintln!("MONOPOLY game={game} seat={seat} devcards={dev:?} default={base:?}");
            break 'monopoly;
        }
    }

    // responder_delta_and_offer_count_reach_counterparty_selection (live half): seat 4 strictly
    // cheaper than seat 3 for the Sheep -> Ore count-2 responder delta.
    for game in 0..40_u64 {
        let (topology, board, _rules, _config, arena) = deterministic_truncated_game(game);
        let view = arena.decision_view(&board, &topology, 0, DecisionPhase::TradeResponse);
        let delta = trading::responder_delta(TradeOffer {
            proposer: 0,
            give: Resource::Sheep,
            get: Resource::Ore,
            count: 2,
        });
        let scores = [3, 4].map(|seat| {
            trading::counterparty_score(
                &etw::inputs_for_seat(&view, seat),
                &TradeParams::default(),
                &delta,
            )
        });
        if scores[1] < scores[0] {
            eprintln!("RESPONDER_DELTA game={game} scores={scores:?}");
            break;
        }
    }

    // applied_aware_trade_forwards_the_offer_count_to_selection: after seat 0 begins its turn,
    // a count-2 offer with at least two acceptors and a strict cheapest among them.
    'count2: for game in 0..80_u64 {
        let (topology, board, rules, mut config, mut arena) = deterministic_truncated_game(game);
        config.policies[0] = PolicyKind::HeuristicV1TraderAware;
        arena.begin_turn_for_test(&board, &topology, &rules, &config, 0);
        let proposer_view = arena.decision_view(&board, &topology, 0, DecisionPhase::TradeResponse);
        if embargoed(&proposer_view, 0, false) {
            continue;
        }
        for give in Resource::ALL {
            for get in Resource::ALL {
                if give == get
                    || arena.state.players[0].resources[give.index()] < 2
                {
                    continue;
                }
                let offer = TradeOffer {
                    proposer: 0,
                    give,
                    get,
                    count: 2,
                };
                let mut acceptors = Vec::new();
                for seat in 1..board.seats() {
                    if arena.state.players[seat].resources[get.index()] < 1 {
                        continue;
                    }
                    let view = arena.decision_view(&board, &topology, seat, DecisionPhase::TradeResponse);
                    if embargoed(&view, seat, false) {
                        continue;
                    }
                    let mut rng = Xoshiro256StarStar::from_seed(seat as u64);
                    if policy::respond_trade(PolicyKind::HeuristicV1Trader, &view, offer, &mut rng) {
                        acceptors.push(seat);
                    }
                }
                if acceptors.len() < 2 {
                    continue;
                }
                let delta = trading::responder_delta(offer);
                let score = |seat: usize| {
                    trading::counterparty_score(
                        &etw::inputs_for_seat(&proposer_view, seat),
                        &TradeParams::default(),
                        &delta,
                    )
                };
                let cheapest = acceptors
                    .iter()
                    .copied()
                    .min_by(|a, b| score(*a).partial_cmp(&score(*b)).unwrap())
                    .unwrap();
                if acceptors
                    .iter()
                    .all(|seat| *seat == cheapest || score(cheapest) < score(*seat))
                {
                    eprintln!(
                        "COUNT2 game={game} give={give:?} get={get:?} acceptors={acceptors:?} cheapest={cheapest}"
                    );
                    break 'count2;
                }
            }
        }
    }

    // proposal_recipient_filter_excludes_embargoed_seats: mixed embargo state at seat 0 whose
    // aware action is still an offer (turn-cap-8 truncation, temperature zero).
    for game in 0..1200_u64 {
        let (topology, board, _rules, _config, arena) = truncated_game(game, 8, temp_zero());
        let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
        let mixed = (0..view.seats()).any(|seat| seat != view.observer() && embargoed(&view, seat, false))
            && (0..view.seats()).any(|seat| seat != view.observer() && !embargoed(&view, seat, false));
        if !mixed {
            continue;
        }
        let mut scratch = PolicyScratch::default();
        let mut rng = Xoshiro256StarStar::from_seed(8_u64 << 48 ^ game << 8);
        let action = policy::action(PolicyKind::HeuristicV1TraderAware, &view, &mut scratch, &mut rng);
        if matches!(action, Action::OfferTrade { .. }) {
            eprintln!("EMBARGO game={game} action={action:?}");
            break;
        }
    }

    // non_finite_counterparty_scores_use_the_first_acceptor_fallback: a NaN score for seat 4
    // under the overflow params (turn-cap-10 truncation), and an [inf, -inf] pair at seats
    // [0, 4] from seat 1's response view (turn-cap-8 truncation).
    'nan: for turn_cap in [10, 12, 14, 16, 20, 24] {
        for game in 0..600_u64 {
            let (topology, board, _rules, _config, arena) =
                truncated_game(game, turn_cap, temp_zero());
            let view = arena.decision_view(&board, &topology, 0, DecisionPhase::TradeResponse);
            let mut nan_delta = [0.0; RESOURCE_COUNT];
            nan_delta[1] = -10.0;
            let nan_params = TradeParams {
                etw_weight: f64::MAX,
                benefit_weight: 0.0,
                tempo_weight: 0.0,
                ..TradeParams::default()
            };
            for target in 1..board.seats() {
                let score = trading::counterparty_score(
                    &etw::inputs_for_seat(&view, target),
                    &nan_params,
                    &nan_delta,
                );
                if score.is_nan() {
                    eprintln!("NAN turn_cap={turn_cap} game={game} target={target}");
                    break 'nan;
                }
            }
        }
    }
    for game in 0..300_u64 {
        let (topology, board, _rules, _config, arena) = deterministic_truncated_game(game);
        let view = arena.decision_view(&board, &topology, 1, DecisionPhase::TradeResponse);
        let delta = [-1.0, 1.0, 0.0, 0.0, 0.0];
        let mixed_params = TradeParams {
            tempo_weight: f64::MAX,
            benefit_weight: f64::MAX,
            ..TradeParams::default()
        };
        let scores = [0, 4].map(|seat| {
            trading::counterparty_score(&etw::inputs_for_seat(&view, seat), &mixed_params, &delta)
        });
        if scores == [f64::INFINITY, f64::NEG_INFINITY] {
            eprintln!("INF_PAIR game={game}");
            break;
        }
    }
}
