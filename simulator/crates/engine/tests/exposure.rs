//! The shared hand-size exposure model and its three consumers (SIM-GAP-14/15/16/18):
//! the discard choice, the pre-emptive shedding trade, and the pre-roll dev-card charge.

use std::fs;
use std::path::PathBuf;

use unsettled_engine::board::{ConversionOptions, SimBoard};
use unsettled_engine::game::{GameArena, GameConfig};
use unsettled_engine::policy::PolicyScratch;
use unsettled_engine::policy::devcards::{self, DevCardParams, DevOffers};
use unsettled_engine::policy::exposure;
use unsettled_engine::policy::heuristic_v1::{self, HeuristicParams, LegacyValuation};
use unsettled_engine::rules::{Buildable, PlayerModifiers, Resource, RuleConfig};
use unsettled_engine::topology::{Layout, Topology};
use unsettled_engine::view::{Action, DecisionPhase, DevPlay, ScoredAction};
use unsettled_engine::wire::WireBoard;

fn fixture_wire() -> (Topology, RuleConfig, WireBoard) {
    let topology = Topology::load(Layout::Extension6).unwrap();
    let rules = RuleConfig::base(Layout::Extension6);
    let relative = PathBuf::from("src/parser/__tests__/expected/board-draft-empty.json");
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .map(|root| root.join(&relative))
        .find(|candidate| candidate.is_file())
        .expect("board fixture must be reachable from the worktree or sweep root");
    let wire = WireBoard::parse_str(&fs::read_to_string(path).unwrap()).unwrap();
    (topology, rules, wire)
}

/// An empty board where every one of the observer's trade rates is 2:1 via a bank-rate
/// override, so no goal exists and the shed trade is the only bank-trade source.
fn flat_two_rate_fixture(hand: [i16; 5]) -> (Topology, SimBoard, GameArena) {
    let (topology, rules, wire) = fixture_wire();
    let board =
        SimBoard::try_from_wire(wire, &topology, &rules, ConversionOptions::default()).unwrap();
    let mut config = GameConfig::default();
    config.modifiers[0].bank_rate_override = Some(2);
    let mut arena = GameArena::default();
    arena.prepare(&board, &topology, &rules, &config);
    arena.state.players[0].resources = hand;
    (topology, board, arena)
}

/// The observer owns a settlement on a 2:1 ore port and holds no road pieces, so the only
/// possible goal is a city (cost `[0, 0, 2, 0, 3]`: two wheat, three ore) and only ore
/// trades at 2:1.
fn ore_port_fixture(hand: [i16; 5]) -> (Topology, SimBoard, GameArena) {
    let (topology, rules, mut wire) = fixture_wire();
    wire.ports[0].resource = Some(Resource::Ore);
    wire.ports[0].rate = 2.0;
    let board =
        SimBoard::try_from_wire(wire, &topology, &rules, ConversionOptions::default()).unwrap();
    let port_vertex = topology.edge_endpoints(board.ports()[0].edge)[0];
    let mut arena = GameArena::default();
    arena.prepare(&board, &topology, &rules, &GameConfig::default());
    arena.state.vertex_owner[usize::from(port_vertex)] = 0;
    arena.state.vertex_tier[usize::from(port_vertex)] = 1;
    arena.state.players[0].pieces[Buildable::Road.index()] = 0;
    arena.refresh_player_rules(&board, &topology, &rules, 0, &PlayerModifiers::default());
    arena.state.players[0].resources = hand;
    (topology, board, arena)
}

fn shed_candidates(actions: &[ScoredAction]) -> Vec<ScoredAction> {
    // Goal and dev-completing trades score 300+; the shed candidate is the only bank trade
    // that can appear below that.
    actions
        .iter()
        .filter(|candidate| {
            matches!(candidate.action, Action::TradeBank { .. }) && candidate.score < 100.0
        })
        .copied()
        .collect()
}

// Forwarded arguments of `exposure::expected_seven_loss`, one observing test each:
// - `hand_total`: expected_seven_loss_matches_the_closed_form (8 vs 7 vs 9 cards)
// - `discard_threshold`: expected_seven_loss_matches_the_closed_form (threshold 9 half)
// - `rolls`: expected_seven_loss_matches_the_closed_form (one roll vs four rolls)
#[test]
fn expected_seven_loss_matches_the_closed_form() {
    let chance_four = 1.0 - (5.0_f64 / 6.0).powi(4);
    assert_eq!(exposure::expected_seven_loss(8, 7, 4), chance_four * 4.0);
    assert_eq!(exposure::expected_seven_loss(7, 7, 4), 0.0);
    // Nine and eight cards discard the same four, so the model prices them identically.
    assert_eq!(
        exposure::expected_seven_loss(9, 7, 4),
        exposure::expected_seven_loss(8, 7, 4)
    );
    let chance_one = 1.0 - (5.0_f64 / 6.0).powi(1);
    assert_eq!(exposure::expected_seven_loss(8, 7, 1), chance_one * 4.0);
    // A non-default threshold moves the exposure boundary.
    assert_eq!(exposure::expected_seven_loss(9, 9, 4), 0.0);
    assert_eq!(exposure::expected_seven_loss(10, 9, 4), chance_four * 5.0);
}

// Forwarded arguments of `exposure::marginal_conversion_scaled`, one observing test each:
// - `count` (bundle boundary): marginal_conversion_prices_bundles_above_spares
// - `rate` (port vs bank spares): marginal_conversion_prices_bundles_above_spares
// - `base_rate` (bundle protection only below it): marginal_conversion_prices_bundles_above_spares
#[test]
fn marginal_conversion_prices_bundles_above_spares() {
    // Breaking a full bundle at a ported (better-than-base) rate costs the whole scale.
    assert_eq!(exposure::marginal_conversion_scaled(2, 2, 4), 12);
    assert_eq!(exposure::marginal_conversion_scaled(3, 3, 4), 12);
    // Spares cost partial progress: a ported spare outranks an unported one.
    assert_eq!(exposure::marginal_conversion_scaled(3, 2, 4), 6);
    assert_eq!(exposure::marginal_conversion_scaled(4, 3, 4), 4);
    assert_eq!(exposure::marginal_conversion_scaled(3, 4, 4), 3);
    // At the base rate there is no bundle protection: a bank-rate four-stack prices flat.
    assert_eq!(exposure::marginal_conversion_scaled(4, 4, 4), 3);
    assert_eq!(exposure::marginal_conversion_scaled(2, 2, 2), 6);
    assert_eq!(exposure::marginal_conversion_scaled(0, 2, 4), 0);
}

// Forwarded arguments of `heuristic_v1::discard`'s conversion ranking, one observing test each:
// - trade rates (via `view`): the_discard_sheds_the_cheapest_conversion_first
// - goal cost (via `scratch`): goal_need_dominates_conversion_on_disagreement
// - `params.legacy_valuation.exposure_blind`: the_legacy_flag_restores_the_greedy_discard
#[test]
fn the_discard_sheds_the_cheapest_conversion_first() {
    // Hand: one sheep (4:1 spare, marginal 3) and two ore (2:1 full bundle, marginal 12).
    // The road goal needs neither, so conversion decides: the sheep goes first even though
    // the ore surplus is larger.
    let (topology, board, arena) = ore_port_fixture([0, 1, 0, 0, 2]);
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let mut scratch = PolicyScratch::default();
    scratch.goal = Some(Buildable::Road);
    let discarded = heuristic_v1::discard(&view, 1, &mut scratch, &HeuristicParams::default());
    assert_eq!(discarded, [0, 1, 0, 0, 0]);
}

#[test]
fn the_legacy_flag_restores_the_greedy_discard() {
    // Same state as above: the pre-change greedy rule sheds from the largest surplus (ore).
    let (topology, board, arena) = ore_port_fixture([0, 1, 0, 0, 2]);
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let mut scratch = PolicyScratch::default();
    scratch.goal = Some(Buildable::Road);
    let params = HeuristicParams {
        legacy_valuation: Some(LegacyValuation {
            exposure_blind: true,
            ..LegacyValuation::default()
        }),
        ..HeuristicParams::default()
    };
    let discarded = heuristic_v1::discard(&view, 1, &mut scratch, &params);
    assert_eq!(discarded, [0, 0, 0, 0, 1]);
}

#[test]
fn goal_need_dominates_conversion_on_disagreement() {
    // The road goal needs the wood and the brick; only the ported ore is surplus. Conversion
    // alone would shed a cheap unported spare, but a needed card is never taken while any
    // surplus exists, so the ore bundle is broken instead.
    let (topology, board, arena) = ore_port_fixture([1, 0, 0, 1, 2]);
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let mut scratch = PolicyScratch::default();
    scratch.goal = Some(Buildable::Road);
    let discarded = heuristic_v1::discard(&view, 1, &mut scratch, &HeuristicParams::default());
    assert_eq!(discarded, [0, 0, 0, 0, 1]);
}

#[test]
fn an_all_needed_hand_keeps_the_greedy_least_damage_rule() {
    // Every held card sits at or under the settlement cost, so the conversion ranking finds
    // no surplus and the original greedy rule decides — bit-identical to the legacy flag,
    // including its quirk of returning short when the greedy tie lands on an empty resource
    // (the game then substitutes its legal default).
    let (topology, board, arena) = ore_port_fixture([1, 1, 0, 1, 0]);
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let legacy = HeuristicParams {
        legacy_valuation: Some(LegacyValuation {
            exposure_blind: true,
            ..LegacyValuation::default()
        }),
        ..HeuristicParams::default()
    };
    let mut scratch = PolicyScratch::default();
    scratch.goal = Some(Buildable::Settlement);
    let discarded =
        heuristic_v1::discard(&view, 1, &mut scratch, &HeuristicParams::default());
    let mut scratch = PolicyScratch::default();
    scratch.goal = Some(Buildable::Settlement);
    let greedy = heuristic_v1::discard(&view, 1, &mut scratch, &legacy);
    assert_eq!(discarded, greedy);
}

// Forwarded arguments of `heuristic_v1::shed_trade`, one observing test each:
// - hand exposure (via `view`): a_seven_safe_hand_offers_no_shed_trade
// - `params.shed_weight`: the_shed_trade_prices_certainty_against_expected_loss (non-default
//   weight in the closed form) and zeroing_the_shed_weight_disables_the_candidate
// - `params.legacy_valuation.exposure_blind`: the_legacy_flag_removes_the_shed_trade
// - goal cost (via `goal`): the_goal_cost_is_never_shed_into
#[test]
fn the_shed_trade_prices_certainty_against_expected_loss() {
    // Eight cards, five seats, every rate 2:1: the trade pays one card with certainty against
    // an expected loss of (1 - (5/6)^5) * 4 cards to the next seven.
    let (topology, board, arena) = flat_two_rate_fixture([4, 4, 0, 0, 0]);
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    assert_eq!(view.seats(), 5, "closed form assumes the five-seat fixture");
    let params = HeuristicParams {
        shed_weight: 7.0,
        ..HeuristicParams::default()
    };
    let actions = heuristic_v1::recommend(&view, &params);
    let shed = shed_candidates(&actions);
    assert_eq!(shed.len(), 1);
    let expected_value = (1.0 - (5.0_f64 / 6.0).powi(5)) * 4.0 - 1.0;
    assert_eq!(
        shed[0].action,
        Action::TradeBank {
            give: Resource::Wood,
            get: Resource::Ore,
            count: 1,
        }
    );
    assert_eq!(shed[0].score.to_bits(), (7.0 * expected_value as f32).to_bits());
}

#[test]
fn a_seven_safe_hand_offers_no_shed_trade() {
    let (topology, board, arena) = flat_two_rate_fixture([4, 3, 0, 0, 0]);
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let actions = heuristic_v1::recommend(&view, &HeuristicParams::default());
    assert!(shed_candidates(&actions).is_empty());
}

#[test]
fn the_legacy_flag_removes_the_shed_trade() {
    let (topology, board, arena) = flat_two_rate_fixture([4, 4, 0, 0, 0]);
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let params = HeuristicParams {
        legacy_valuation: Some(LegacyValuation {
            exposure_blind: true,
            ..LegacyValuation::default()
        }),
        ..HeuristicParams::default()
    };
    let actions = heuristic_v1::recommend(&view, &params);
    assert!(shed_candidates(&actions).is_empty());
}

#[test]
fn zeroing_the_shed_weight_disables_the_candidate() {
    let (topology, board, arena) = flat_two_rate_fixture([4, 4, 0, 0, 0]);
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let params = HeuristicParams {
        shed_weight: 0.0,
        ..HeuristicParams::default()
    };
    let actions = heuristic_v1::recommend(&view, &params);
    assert!(shed_candidates(&actions).is_empty());
}

#[test]
fn the_goal_cost_is_never_shed_into() {
    // The city goal (two wheat, three ore) protects three ore. With four ore the surplus is
    // one, below the 2:1 rate, so no shed fires even though the hand is exposed; a fifth ore
    // clears the cost and the shed trade appears, receiving the goal-needed wheat.
    let (topology, board, arena) = ore_port_fixture([3, 1, 0, 0, 4]);
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let actions = heuristic_v1::recommend(&view, &HeuristicParams::default());
    assert!(shed_candidates(&actions).is_empty());

    let (topology, board, arena) = ore_port_fixture([3, 0, 0, 0, 5]);
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    assert_eq!(view.seats(), 5, "closed form assumes the five-seat fixture");
    let actions = heuristic_v1::recommend(&view, &HeuristicParams::default());
    let shed = shed_candidates(&actions);
    assert_eq!(shed.len(), 1);
    let expected_value = (1.0 - (5.0_f64 / 6.0).powi(5)) * 4.0 - 1.0;
    assert_eq!(
        shed[0].action,
        Action::TradeBank {
            give: Resource::Ore,
            get: Resource::Wheat,
            count: 1,
        }
    );
    assert_eq!(
        shed[0].score.to_bits(),
        (HeuristicParams::default().shed_weight * expected_value as f32).to_bits()
    );
}

// Forwarded arguments of `devcards::score_candidates`' seven charge, one observing test each:
// - `params.exposure_weight`: the_seven_charge_is_subtracted_from_card_adding_plays (non-default
//   weight in the closed form)
// - added cards (2 for Year of Plenty, the floored expected haul for Monopoly):
//   the_seven_charge_is_subtracted_from_card_adding_plays
// - hand and threshold (via `view`): a_large_charge_defers_a_card_adding_play (six-card hand
//   pushed over the threshold by the play)
#[test]
fn the_seven_charge_is_subtracted_from_card_adding_plays() {
    let (topology, rules, wire) = fixture_wire();
    let board =
        SimBoard::try_from_wire(wire, &topology, &rules, ConversionOptions::default()).unwrap();
    let mut arena = GameArena::default();
    arena.prepare(&board, &topology, &rules, &GameConfig::default());
    // Six cards in hand: two more cross the threshold of seven and expose four to the
    // observer's own imminent roll.
    arena.state.players[0].resources = [2, 2, 2, 0, 0];
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::PreRoll);
    let offers = DevOffers {
        plenty: Some((Resource::Brick, Resource::Ore)),
        monopoly: false,
        road: None,
    };
    let charged = DevCardParams {
        exposure_weight: 0.4,
        ..DevCardParams::default()
    };
    let blind = DevCardParams {
        exposure_weight: 0.0,
        ..DevCardParams::default()
    };
    let with_charge = devcards::score_candidates(&view, &charged, offers, None).scored[1]
        .unwrap()
        .score;
    let without = devcards::score_candidates(&view, &blind, offers, None).scored[1]
        .unwrap()
        .score;
    let charge = 0.4
        * (exposure::expected_seven_loss(8, 7, 1) - exposure::expected_seven_loss(6, 7, 1));
    assert!(charge > 0.0);
    assert_eq!(with_charge.to_bits(), (without - charge).to_bits());
}

#[test]
fn the_legacy_flag_zeroes_the_charge_through_the_pre_roll_path() {
    // With a heavy exposure weight the charged path holds instead of playing Year of Plenty;
    // the exposure_blind flag must restore the play by zeroing the weight before the
    // comparison runs.
    let (topology, rules, wire) = fixture_wire();
    let board =
        SimBoard::try_from_wire(wire, &topology, &rules, ConversionOptions::default()).unwrap();
    let mut arena = GameArena::default();
    arena.prepare(&board, &topology, &rules, &GameConfig::default());
    arena.state.players[0].resources = [2, 2, 2, 0, 0];
    arena.state.players[0].playable_dev[3] = 1;
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::PreRoll);
    let heavy = HeuristicParams {
        dev_cards: Some(DevCardParams {
            exposure_weight: 10.0,
            ..DevCardParams::default()
        }),
        ..HeuristicParams::default()
    };
    let mut scratch = PolicyScratch::default();
    assert_eq!(heuristic_v1::pre_roll(&view, &mut scratch, &heavy), None);
    let legacy = HeuristicParams {
        legacy_valuation: Some(LegacyValuation {
            exposure_blind: true,
            ..LegacyValuation::default()
        }),
        ..heavy
    };
    let mut scratch = PolicyScratch::default();
    assert!(matches!(
        heuristic_v1::pre_roll(&view, &mut scratch, &legacy),
        Some(DevPlay::YearOfPlenty { .. })
    ));
}

#[test]
fn a_large_charge_defers_a_card_adding_play() {
    let (topology, rules, wire) = fixture_wire();
    let board =
        SimBoard::try_from_wire(wire, &topology, &rules, ConversionOptions::default()).unwrap();
    let mut arena = GameArena::default();
    arena.prepare(&board, &topology, &rules, &GameConfig::default());
    arena.state.players[0].resources = [2, 2, 2, 0, 0];
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::PreRoll);
    let offers = DevOffers {
        plenty: Some((Resource::Brick, Resource::Ore)),
        monopoly: false,
        road: None,
    };
    let blind = DevCardParams {
        exposure_weight: 0.0,
        ..DevCardParams::default()
    };
    assert_eq!(
        devcards::pre_roll_choice(&view, &blind, offers, None),
        Some(DevPlay::YearOfPlenty {
            first: Resource::Brick,
            second: Resource::Ore,
        })
    );
    let heavy = DevCardParams {
        exposure_weight: 10.0,
        ..DevCardParams::default()
    };
    assert_eq!(devcards::pre_roll_choice(&view, &heavy, offers, None), None);
}
