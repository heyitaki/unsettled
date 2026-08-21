use std::fs;
use std::path::PathBuf;

use unsettled_engine::board::{ConversionOptions, SimBoard};
use unsettled_engine::etw::{
    ETW_CAP, EtwInputs, etw_for_seat, expected_turns_to_win, inputs_for_seat,
};
use unsettled_engine::game::{GameArena, GameConfig};
use unsettled_engine::rules::{Buildable, PlayerModifiers, RESOURCE_COUNT, RuleConfig};
use unsettled_engine::topology::{Layout, Topology};
use unsettled_engine::view::{DecisionPhase, DecisionView};
use unsettled_engine::wire::WireBoard;

fn inputs() -> EtwInputs {
    EtwInputs {
        win_vp: 10,
        public_vp: 6,
        dev_count: 0,
        all_seats_dev_count_sum: 0,
        dev_deck_remaining: 20,
        dev_victory_points: 5,
        production_pips: [4, 4, 4, 4, 4],
        pieces_settlement: 2,
        pieces_city: 2,
        settlements_on_board: 2,
        settlement_cost: Some([1, 1, 1, 1, 0]),
        city_cost: Some([0, 0, 2, 0, 3]),
        road_cost: Some([1, 0, 0, 1, 0]),
        dev_cost: Some([0, 1, 1, 0, 1]),
        settlement_vp: 1,
        city_vp: 2,
        trade_rates: [4; RESOURCE_COUNT],
        belief_expected: [0.0; RESOURCE_COUNT],
        hand_total: 0,
    }
}

fn fixture(
    modifiers: [PlayerModifiers; 6],
) -> (Topology, SimBoard, RuleConfig, GameConfig, GameArena) {
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
    let config = GameConfig {
        modifiers,
        ..GameConfig::default()
    };
    let mut arena = GameArena::default();
    arena.prepare(&board, &topology, &rules, &config);
    (topology, board, rules, config, arena)
}

fn view_for<'a>(
    arena: &'a GameArena,
    board: &'a SimBoard,
    topology: &'a Topology,
    observer: usize,
) -> DecisionView<'a> {
    arena.decision_view(board, topology, observer, DecisionPhase::Action)
}

#[test]
fn more_production_never_increases_etw() {
    let mut previous = ETW_CAP;
    for pips in 0..=36 {
        let mut case = inputs();
        case.production_pips = [pips, 0, 0, 0, 0];
        let value = expected_turns_to_win(&case);
        assert!(
            value <= previous,
            "pips={pips}, value={value}, previous={previous}"
        );
        if value > 0.0 && value < ETW_CAP && previous < ETW_CAP {
            assert!(value < previous);
        }
        previous = value;
    }
}

#[test]
fn more_public_vp_or_queued_vp_never_increases_etw() {
    let mut previous = ETW_CAP;
    for public_vp in 0..=10 {
        let mut case = inputs();
        case.public_vp = public_vp;
        let value = expected_turns_to_win(&case);
        assert!(value <= previous);
        previous = value;
    }

    let mut settlement_only = inputs();
    settlement_only.win_vp = 1;
    settlement_only.public_vp = 0;
    settlement_only.production_pips = [36, 0, 0, 0, 0];
    settlement_only.belief_expected = [2.0, 1.0, 1.0, 2.0, 0.0];
    settlement_only.pieces_city = 0;
    settlement_only.dev_deck_remaining = 0;
    let before = expected_turns_to_win(&settlement_only);
    settlement_only.pieces_city = 1;
    let after = expected_turns_to_win(&settlement_only);
    assert!(after <= before, "before={before}, after={after}");

    let mut no_routes = inputs();
    no_routes.pieces_settlement = 0;
    no_routes.pieces_city = 0;
    no_routes.dev_deck_remaining = 0;
    let before = expected_turns_to_win(&no_routes);
    no_routes.pieces_settlement = 1;
    assert!(expected_turns_to_win(&no_routes) <= before);
}

#[test]
fn degenerate_inputs_hit_the_pinned_boundaries() {
    let mut case = inputs();
    case.public_vp = case.win_vp;
    assert_eq!(expected_turns_to_win(&case), 0.0);

    case = inputs();
    case.production_pips = [0; RESOURCE_COUNT];
    assert_eq!(expected_turns_to_win(&case), ETW_CAP);

    case = inputs();
    case.pieces_settlement = 0;
    case.pieces_city = 0;
    case.dev_deck_remaining = 0;
    assert_eq!(expected_turns_to_win(&case), ETW_CAP);

    case = inputs();
    case.settlement_cost = None;
    case.city_cost = None;
    case.dev_cost = None;
    assert_eq!(expected_turns_to_win(&case), ETW_CAP);

    case = inputs();
    case.dev_count = 4;
    case.dev_deck_remaining = 0;
    case.all_seats_dev_count_sum = 0;
    let value = expected_turns_to_win(&case);
    assert!(value.is_finite() && value <= ETW_CAP);

    case = inputs();
    case.production_pips = [1, 0, 0, 0, 0];
    let value = expected_turns_to_win(&case);
    assert!(value.is_finite() && value <= ETW_CAP);
}

#[test]
fn six_vp_with_pipeline_beats_eight_vp_built_out() {
    let six = inputs();
    let mut eight = inputs();
    eight.public_vp = 8;
    eight.production_pips = [1, 0, 0, 0, 0];
    eight.pieces_settlement = 0;
    eight.pieces_city = 0;
    eight.dev_deck_remaining = 0;
    assert!(expected_turns_to_win(&six) < expected_turns_to_win(&eight));
}

#[test]
fn bigger_banked_hand_never_increases_etw() {
    let mut previous = ETW_CAP;
    for cards in 0..=12 {
        let mut case = inputs();
        case.belief_expected = [f64::from(cards), 0.0, 0.0, 0.0, 0.0];
        case.hand_total = cards;
        let value = expected_turns_to_win(&case);
        assert!(
            value <= previous,
            "cards={cards}, value={value}, previous={previous}"
        );
        previous = value;
    }
}

#[test]
fn etw_inputs_are_identical_across_hidden_compositions_and_observers() {
    let mut modifiers = std::array::from_fn(|_| PlayerModifiers::default());
    modifiers[2]
        .extra_cost_alternatives
        .push((Buildable::Settlement, [1, 0, 0, 0, 0]));
    let (topology, board, _rules, _config, mut first) = fixture(modifiers);
    let mut second = first.clone();
    first.state.players[2].resources = [5, 0, 0, 0, 0];
    second.state.players[2].resources = [0, 0, 0, 0, 5];
    assert_eq!(
        inputs_for_seat(&view_for(&first, &board, &topology, 2), 2),
        inputs_for_seat(&view_for(&second, &board, &topology, 2), 2)
    );
    assert_eq!(
        inputs_for_seat(&view_for(&first, &board, &topology, 0), 2),
        inputs_for_seat(&view_for(&first, &board, &topology, 1), 2)
    );
    assert_eq!(
        etw_for_seat(&view_for(&first, &board, &topology, 0), 2),
        etw_for_seat(&view_for(&first, &board, &topology, 1), 2)
    );
}

#[test]
fn fix1_maximum_public_dev_counts_do_not_overflow_etw() {
    let mut case = inputs();
    case.all_seats_dev_count_sum = u16::MAX;
    case.dev_deck_remaining = 1;
    let value = expected_turns_to_win(&case);
    assert!(value.is_finite() && value <= ETW_CAP);
}

#[test]
fn fix1_non_finite_belief_input_returns_the_pinned_cap() {
    let mut case = inputs();
    case.belief_expected[0] = f64::NAN;
    assert_eq!(expected_turns_to_win(&case), ETW_CAP);
}

#[test]
fn fix1_zero_trade_rates_do_not_credit_an_empty_surplus() {
    let mut ordinary = inputs();
    ordinary.belief_expected = [0.0; RESOURCE_COUNT];
    ordinary.hand_total = 0;
    let mut zero_rate = ordinary.clone();
    zero_rate.trade_rates = [0; RESOURCE_COUNT];
    assert_eq!(
        expected_turns_to_win(&zero_rate),
        expected_turns_to_win(&ordinary)
    );
}

#[test]
fn fix1_zero_trade_rate_saturates_credit_for_a_positive_surplus() {
    let mut ordinary = inputs();
    ordinary.belief_expected = [10.0, 0.0, 0.0, 0.0, 0.0];
    ordinary.hand_total = 10;
    let mut zero_rate = ordinary.clone();
    zero_rate.trade_rates = [0; RESOURCE_COUNT];
    assert!(expected_turns_to_win(&zero_rate) <= expected_turns_to_win(&ordinary));
}

#[test]
fn etw_inputs_survive_hands_beyond_u16() {
    let modifiers = std::array::from_fn(|_| PlayerModifiers::default());
    let (topology, board, _rules, _config, mut arena) = fixture(modifiers);
    // An 87,000-card hand is legal under large configured bank supplies and must not
    // reach EtwInputs through a u16 total.
    for resource in 0..3 {
        arena.state.players[0].resources[resource] = 29_000;
    }
    let view = view_for(&arena, &board, &topology, 0);
    assert_eq!(inputs_for_seat(&view, 0).hand_total, 87_000);
}
