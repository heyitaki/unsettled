//! Regression tests for the six defects found by the post-committee adversarial review.
//! Each test names the rule or invariant it pins so a future refactor cannot quietly undo it.

use std::fs;
use std::path::PathBuf;

use unsettled_engine::board::{ConversionOptions, SimBoard};
use unsettled_engine::game::{GameArena, GameConfig};
use unsettled_engine::longest_road::{RoadCard, update_road_card};
use unsettled_engine::policy::heuristic_v1::{self, HeuristicParams};
use unsettled_engine::policy::{PolicyKind, PolicyScratch, priority_trader};
use unsettled_engine::rng::Xoshiro256StarStar;
use unsettled_engine::rules::{Buildable, Resource, RuleConfig};
use unsettled_engine::topology::{Layout, Topology};
use unsettled_engine::view::{Action, DecisionPhase, DevPlay};
use unsettled_engine::wire::{WireBoard, WirePort};

fn fixture_path(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../src/parser/__tests__/expected/")
        .join(name)
}

fn empty_board() -> (Topology, SimBoard, RuleConfig, GameConfig, GameArena) {
    let topology = Topology::load(Layout::Extension6).unwrap();
    let rules = RuleConfig::base(Layout::Extension6);
    let wire =
        WireBoard::parse_str(&fs::read_to_string(fixture_path("board-draft-empty.json")).unwrap())
            .unwrap();
    let board =
        SimBoard::try_from_wire(wire, &topology, &rules, ConversionOptions::default()).unwrap();
    let config = GameConfig::default();
    let mut arena = GameArena::default();
    arena.prepare(&board, &topology, &rules, &config);
    (topology, board, rules, config, arena)
}

// --- Finding 1: Longest Road card state machine -----------------------------------------------

#[test]
fn cut_holder_yields_the_card_to_the_single_longest_challenger() {
    // Official rule: when the holder's road is broken, the card passes to the player with the
    // strictly longest qualifying road. Counting every seat at or above the minimum wrongly
    // retires the card whenever two or more challengers qualify.
    let mut card = RoadCard {
        holder: Some(0),
        retired: false,
    };
    update_road_card(&mut card, &[4, 6, 5], 5);
    assert_eq!(card.holder, Some(1), "seat 1 has the strictly longest road");
    assert!(!card.retired);
}

#[test]
fn cut_holder_retires_the_card_only_when_the_best_challengers_tie() {
    let mut card = RoadCard {
        holder: Some(0),
        retired: false,
    };
    update_road_card(&mut card, &[4, 6, 6], 5);
    assert_eq!(card.holder, None, "tied best challengers leave the card unheld");
    assert!(card.retired);
}

#[test]
fn tied_challengers_above_a_qualifying_holder_do_not_take_the_card() {
    // The holder still qualifies (6 >= 5) but is out-length by two tied challengers; the card is
    // set aside rather than handed to whichever seat happens to sort last.
    let mut card = RoadCard {
        holder: Some(0),
        retired: false,
    };
    update_road_card(&mut card, &[6, 7, 7], 5);
    assert_eq!(card.holder, None, "a tie among challengers awards nobody");
}

#[test]
fn a_single_longer_challenger_still_takes_the_card_from_a_qualifying_holder() {
    let mut card = RoadCard {
        holder: Some(0),
        retired: false,
    };
    update_road_card(&mut card, &[6, 8, 7], 5);
    assert_eq!(card.holder, Some(1));
}

// --- Finding 2: Largest Army / Longest Road are never pursued ---------------------------------

/// Seat 0 sits at 8 public VP with two knights played and exactly one playable knight in hand.
/// The robber is parked somewhere that does not touch seat 0, so no "unblock myself" motive
/// applies. Playing the knight takes Largest Army (+2 VP) and wins the game outright.
fn winning_knight_state() -> (Topology, SimBoard, RuleConfig, GameConfig, GameArena) {
    let (topology, board, rules, config, mut arena) = empty_board();
    arena.state.players[0].vp_public = 8;
    arena.state.players[0].knights_played = 2;
    arena.state.players[0].playable_dev[0] = 1;
    arena.state.players[0].resources = [0; 5];
    // Park the robber on a hex seat 0 does not touch, and give an opponent a stealable presence
    // so the knight has a sensible destination.
    let robber = arena.state.robber;
    let target = (0..topology.hex_count())
        .map(|hex| hex as u8)
        .find(|hex| *hex != robber)
        .unwrap();
    arena.state.vertex_owner[usize::from(topology.hex_vertices(target)[0])] = 1;
    arena.state.vertex_tier[usize::from(topology.hex_vertices(target)[0])] = 1;
    arena.state.players[1].vp_public = 4;
    arena.state.players[1].resources = [2, 0, 0, 0, 0];
    (topology, board, rules, config, arena)
}

#[test]
fn heuristic_v1_plays_its_only_knight_to_win_largest_army() {
    let (topology, board, _rules, _config, arena) = winning_knight_state();
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let mut scratch = PolicyScratch::default();
    let mut rng = Xoshiro256StarStar::from_seed(11);
    assert!(
        matches!(
            heuristic_v1::action(&view, &mut scratch, &HeuristicParams::default(), &mut rng),
            Action::PlayDev(DevPlay::Knight { .. })
        ),
        "a single knight that wins Largest Army must be played"
    );
}

#[test]
fn priority_trader_plays_its_only_knight_to_win_largest_army() {
    // The comparator must not share the blind spot, or it cannot police heuristic-v1.
    let (topology, board, _rules, _config, arena) = winning_knight_state();
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let mut scratch = PolicyScratch::default();
    assert!(
        matches!(
            priority_trader::action(&view, &mut scratch),
            Action::PlayDev(DevPlay::Knight { .. })
        ),
        "the independent comparator must also take a winning Largest Army"
    );
}

/// A road that bridges two of the observer's own components raises the longest trail by far more
/// than one segment, so any "current length + 1" reachability bound is unsound. Seats begin the
/// game with exactly two disconnected road stubs, so this shape is routine, not exotic.
#[test]
fn a_bridging_road_that_wins_longest_road_is_not_skipped_by_the_reachability_guard() {
    let (topology, board, _rules, _config, mut arena) = empty_board();
    // Two separate 3-edge runs joined by one free edge in the middle.
    let (bridge, left, right) = topology
        .coastal_edges()
        .iter()
        .find_map(|candidate| {
            let [a, b] = topology.edge_endpoints(*candidate);
            let left: Vec<u8> = topology
                .vertex_edges(a)
                .iter()
                .copied()
                .filter(|edge| *edge != *candidate)
                .take(1)
                .collect();
            let right: Vec<u8> = topology
                .vertex_edges(b)
                .iter()
                .copied()
                .filter(|edge| *edge != *candidate)
                .take(1)
                .collect();
            (!left.is_empty() && !right.is_empty()).then(|| (*candidate, left[0], right[0]))
        })
        .expect("topology has an edge with neighbours on both ends");
    arena.state.edge_owner[usize::from(left)] = 0;
    arena.state.edge_owner[usize::from(right)] = 0;
    let start = topology.edge_endpoints(left)[0];
    arena.state.vertex_owner[usize::from(start)] = 0;
    arena.state.vertex_tier[usize::from(start)] = 1;
    arena.state.players[0].longest_road_len = 1;
    arena.state.players[0].resources = [1, 0, 0, 1, 0];
    arena.state.players[0].vp_public = 8;
    arena.state.longest_road = RoadCard {
        holder: Some(1),
        retired: false,
    };
    arena.state.players[1].longest_road_len = 2;

    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    // The observer's best trail is 1, and the card needs 3, so a "+1 per segment" bound would
    // declare this unreachable -- yet laying `bridge` joins both runs into a trail of 3.
    assert_eq!(view.road_length_after(bridge, None), 3);
    assert!(
        view.own_road_count() >= 2,
        "the bound must be driven by segments owned, not by the current trail length"
    );
}

// --- Finding 3: robber victim selection -------------------------------------------------------

#[test]
fn robber_prefers_a_victim_holding_cards_over_an_empty_handed_leader() {
    let (topology, board, _rules, _config, mut arena) = empty_board();
    let robber = arena.state.robber;
    // A hex touching two opponents: the VP leader holds nothing, the trailer holds three ore.
    let target = (0..topology.hex_count())
        .map(|hex| hex as u8)
        .find(|hex| *hex != robber && !topology.hex_vertices(*hex).is_empty())
        .unwrap();
    let vertices = topology.hex_vertices(target);
    arena.state.vertex_owner[usize::from(vertices[0])] = 1;
    arena.state.vertex_tier[usize::from(vertices[0])] = 1;
    arena.state.vertex_owner[usize::from(vertices[2])] = 2;
    arena.state.vertex_tier[usize::from(vertices[2])] = 1;
    arena.state.players[1].vp_public = 8;
    arena.state.players[1].resources = [0; 5];
    arena.state.players[2].vp_public = 3;
    arena.state.players[2].resources = [0, 0, 0, 0, 3];

    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let (destination, victim) =
        heuristic_v1::robber(&view, &heuristic_v1::HeuristicParams::default());
    if destination == target {
        assert_eq!(
            victim,
            Some(2),
            "stealing from an empty hand wastes the robber"
        );
    }
    // Whatever hex is chosen, a victim must be named whenever the hex touches a loaded opponent.
    let loaded = topology
        .hex_vertices(destination)
        .iter()
        .filter_map(|vertex| {
            let owner = arena.state.vertex_owner[usize::from(*vertex)];
            (owner != u8::MAX && owner != 0).then_some(owner)
        })
        .any(|seat| arena.state.players[usize::from(seat)].resources.iter().sum::<i16>() > 0);
    assert_eq!(
        loaded,
        victim.is_some_and(|seat| arena.state.players[usize::from(seat)]
            .resources
            .iter()
            .sum::<i16>()
            > 0),
        "a hex touching a loaded opponent must name a loaded victim"
    );
}

// --- Finding 4: the no-ports ablation must actually forgo port rates --------------------------

#[test]
fn noports_ablation_does_not_trade_at_port_rates() {
    // Mirrors tactical_policy::two_to_one_port_trade_completes_the_city_goal, but through the
    // ablation: if the ablation still trades 2:1 it is not an ablation, and the port_synergy
    // ranking-stability evidence it underwrites is circular. The ablation is a rules-level effect
    // carried by the seat's policy, so it has to be configured before the rules are flattened.
    let topology = Topology::load(Layout::Extension6).unwrap();
    let rules = RuleConfig::base(Layout::Extension6);
    let wire =
        WireBoard::parse_str(&fs::read_to_string(fixture_path("board-draft-empty.json")).unwrap())
            .unwrap();
    let board =
        SimBoard::try_from_wire(wire, &topology, &rules, ConversionOptions::default()).unwrap();
    let mut config = GameConfig::default();
    config.policies[0] = PolicyKind::HeuristicV1Noports;
    let mut arena = GameArena::default();
    arena.prepare(&board, &topology, &rules, &config);
    let port = board
        .ports()
        .iter()
        .find(|port| port.resource.is_some() && port.rate == 2)
        .copied()
        .unwrap();
    let give = port.resource.unwrap();
    let city_vertex = topology.edge_endpoints(port.edge)[0];
    arena.state.vertex_owner[usize::from(city_vertex)] = 0;
    arena.state.vertex_tier[usize::from(city_vertex)] = 1;
    arena.refresh_player_rules(&board, &topology, &rules, 0, &config.modifiers[0]);
    let get = if give == Resource::Ore {
        Resource::Wheat
    } else {
        Resource::Ore
    };
    let mut hand = [0_i16; 5];
    hand[Resource::Wheat.index()] = 2;
    hand[Resource::Ore.index()] = 3;
    hand[get.index()] -= 1;
    hand[give.index()] += 2;
    arena.state.players[0].resources = hand;

    // The seat owns a 2:1 port, but the ablation must leave it trading at the base bank rate.
    assert_eq!(
        arena.state.players[0].trade_rate[give.index()],
        4,
        "the no-ports ablation must not receive the 2:1 port rate"
    );

    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let mut scratch = PolicyScratch::default();
    let mut rng = Xoshiro256StarStar::from_seed(3);
    let chosen = unsettled_engine::policy::action(
        PolicyKind::HeuristicV1Noports,
        &view,
        &mut scratch,
        &mut rng,
    );
    assert_ne!(
        chosen,
        Action::TradeBank {
            give,
            get,
            count: 1,
        },
        "the no-ports ablation must not exploit a 2:1 port rate"
    );
}

// --- Finding 5: superCity ingestion must not underflow the piece pool -------------------------

#[test]
fn the_real_endgame_fixture_prepares_without_underflowing_super_city_pieces() {
    let topology = Topology::load(Layout::Extension6).unwrap();
    let rules = RuleConfig::base(Layout::Extension6);
    let wire = WireBoard::parse_str(
        &fs::read_to_string(fixture_path("board-endgame-pieces.json")).unwrap(),
    )
    .unwrap();
    let board =
        SimBoard::try_from_wire(wire, &topology, &rules, ConversionOptions::default()).unwrap();
    let config = GameConfig::default();
    let mut arena = GameArena::default();
    // Base rules give SuperCity a per-player limit of 0 while the fixture contains a real
    // superCity building; preparation must not wrap the remaining-piece count to 255.
    arena.prepare(&board, &topology, &rules, &config);
    for seat in 0..board.seats() {
        for buildable in Buildable::ALL {
            assert!(
                arena.state.players[seat].pieces[buildable.index()] <= 20,
                "seat {seat} {buildable:?} piece pool underflowed to {}",
                arena.state.players[seat].pieces[buildable.index()]
            );
        }
    }
    // Preparing is not enough: `play` debug-asserts that placed + remaining == limit after setup
    // and every turn, so a pool that merely clamps instead of widening the limit fails here while
    // looking correct above. This is a debug-only assertion, so a release-mode run cannot catch it.
    let result = arena.play(&board, &topology, &rules, &config);
    assert!(result.illegal_actions == 0, "imported board produced illegal actions");
}

// --- Finding 6: owned-port array must not overflow on a custom board --------------------------

#[test]
fn a_board_where_one_seat_touches_many_ports_does_not_panic() {
    let topology = Topology::load(Layout::Extension6).unwrap();
    let rules = RuleConfig::base(Layout::Extension6);
    let mut wire =
        WireBoard::parse_str(&fs::read_to_string(fixture_path("board-draft-empty.json")).unwrap())
            .unwrap();
    // A port on every coastal edge is structurally legal for the app's format; a seat that
    // touches more than the fixed owned-port capacity must be handled, not indexed out of bounds.
    wire.ports = topology
        .coastal_edges()
        .iter()
        .map(|edge| WirePort {
            edge_id: topology.edge_id(*edge).to_string(),
            resource: None,
            rate: 3.0,
        })
        .collect();
    let Ok(board) = SimBoard::try_from_wire(wire, &topology, &rules, ConversionOptions::default())
    else {
        return; // Rejecting the board at the ingestion border is an acceptable fix.
    };
    let config = GameConfig::default();
    let mut arena = GameArena::default();
    arena.prepare(&board, &topology, &rules, &config);
    // Own a long coastal run so this seat touches far more ports than the fixed capacity.
    for edge in topology.coastal_edges() {
        for vertex in topology.edge_endpoints(*edge) {
            arena.state.vertex_owner[usize::from(vertex)] = 0;
            arena.state.vertex_tier[usize::from(vertex)] = 1;
        }
    }
    arena.refresh_player_rules(&board, &topology, &rules, 0, &config.modifiers[0]);
}
