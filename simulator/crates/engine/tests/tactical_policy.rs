use std::fs;
use std::path::PathBuf;

use unsettled_engine::board::{ConversionOptions, SimBoard};
use unsettled_engine::game::{GameArena, GameConfig};
use unsettled_engine::policy::PolicyScratch;
use unsettled_engine::policy::heuristic_v1::{self, HeuristicParams};
use unsettled_engine::policy::{greedy_no_trade, priority_trader};
use unsettled_engine::rng::Xoshiro256StarStar;
use unsettled_engine::rules::{Buildable, Resource, RuleConfig};
use unsettled_engine::topology::{Layout, Topology};
use unsettled_engine::view::{Action, DecisionPhase, DevPlay, pips};
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

fn own_settlement(arena: &mut GameArena, topology: &Topology) -> u8 {
    let vertex = 0_u8;
    arena.state.vertex_owner[usize::from(vertex)] = 0;
    arena.state.vertex_tier[usize::from(vertex)] = 1;
    arena.state.players[0].pieces[Buildable::Settlement.index()] -= 1;
    arena.state.players[0].vp_public += 1;
    let edge = topology.vertex_edges(vertex)[0];
    arena.state.edge_owner[usize::from(edge)] = 0;
    vertex
}

#[test]
fn affordable_city_is_preferred_over_an_affordable_settlement() {
    let (topology, board, _rules, _config, mut arena) = fixture();
    let city_vertex = own_settlement(&mut arena, &topology);
    let settlement_vertex = (0..topology.vertex_count())
        .map(|vertex| vertex as u8)
        .find(|vertex| {
            *vertex != city_vertex && !topology.vertex_adjacent(city_vertex).contains(vertex)
        })
        .unwrap();
    arena.state.edge_owner[usize::from(topology.vertex_edges(settlement_vertex)[0])] = 0;
    arena.state.players[0].resources = [1, 1, 3, 1, 3];
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    assert!(view.affordable_settlement().is_some());
    let mut scratch = PolicyScratch::default();
    let mut rng = Xoshiro256StarStar::from_seed(1);
    assert_eq!(
        heuristic_v1::action(&view, &mut scratch, &HeuristicParams::default(), &mut rng,),
        Action::UpgradeCity(city_vertex)
    );
}

#[test]
fn two_to_one_port_trade_completes_the_city_goal() {
    let (topology, board, rules, config, mut arena) = fixture();
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
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let mut scratch = PolicyScratch::default();
    let mut rng = Xoshiro256StarStar::from_seed(2);
    assert_eq!(
        heuristic_v1::action(&view, &mut scratch, &HeuristicParams::default(), &mut rng,),
        Action::TradeBank {
            give,
            get,
            count: 1,
        }
    );
}

#[test]
fn robber_targets_the_leaders_highest_pip_hex_without_hitting_self() {
    let (topology, board, _rules, _config, mut arena) = fixture();
    let target = (0..topology.hex_count())
        .map(|hex| hex as u8)
        .filter(|hex| *hex != arena.state.robber)
        .max_by_key(|hex| board.tokens()[usize::from(*hex)].map_or(0, pips))
        .unwrap();
    let target_vertex = topology.hex_vertices(target)[0];
    arena.state.vertex_owner[usize::from(target_vertex)] = 1;
    arena.state.vertex_tier[usize::from(target_vertex)] = 1;
    arena.state.players[1].vp_public = 8;
    // Only a seat holding cards is a nameable victim, so the leader needs a hand for this test to
    // still exercise victim selection rather than the no-eligible-victim path.
    arena.state.players[1].resources = [1, 0, 0, 0, 0];
    let low = (0..topology.hex_count())
        .map(|hex| hex as u8)
        .find(|hex| {
            *hex != arena.state.robber
                && *hex != target
                && !topology.hex_vertices(*hex).contains(&target_vertex)
        })
        .unwrap();
    arena.state.vertex_owner[usize::from(topology.hex_vertices(low)[0])] = 2;
    arena.state.players[2].vp_public = 2;
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    assert_eq!(heuristic_v1::robber(&view), (target, Some(1)));
}

#[test]
fn discard_preserves_the_active_city_cost() {
    let (topology, board, _rules, _config, mut arena) = fixture();
    own_settlement(&mut arena, &topology);
    arena.state.players[0].resources = [4, 4, 2, 4, 3];
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let mut scratch = PolicyScratch {
        goal: Some(Buildable::City),
    };
    let discarded = heuristic_v1::discard(&view, 4, &mut scratch);
    assert_eq!(discarded[Resource::Wheat.index()], 0);
    assert_eq!(discarded[Resource::Ore.index()], 0);
    assert_eq!(discarded.iter().sum::<u8>(), 4);
}

#[test]
fn pre_roll_knight_fires_when_robber_blocks_four_pips() {
    let (topology, board, _rules, _config, mut arena) = fixture();
    let blocked = (0..topology.hex_count())
        .map(|hex| hex as u8)
        .find(|hex| board.tokens()[usize::from(*hex)].is_some_and(|token| pips(token) >= 4))
        .unwrap();
    arena.state.robber = blocked;
    arena.state.vertex_owner[usize::from(topology.hex_vertices(blocked)[0])] = 0;
    arena.state.players[0].playable_dev[0] = 1;
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::PreRoll);
    let mut scratch = PolicyScratch::default();
    assert!(matches!(
        heuristic_v1::pre_roll(
            &view,
            &mut scratch,
            &HeuristicParams::default()
        ),
        Some(DevPlay::Knight { destination, .. }) if destination != blocked
    ));
}

#[test]
fn road_building_uses_two_connected_legal_edges() {
    let (topology, board, _rules, _config, mut arena) = fixture();
    own_settlement(&mut arena, &topology);
    arena.state.players[0].playable_dev[2] = 1;
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::PreRoll);
    let mut scratch = PolicyScratch::default();
    let Some(DevPlay::RoadBuilding {
        first: Some(first),
        second: Some(second),
    }) = heuristic_v1::pre_roll(&view, &mut scratch, &HeuristicParams::default())
    else {
        panic!("road building was not selected");
    };
    assert!(view.legal_road(first));
    assert!(view.legal_road_after(first, second));
    let first_endpoints = topology.edge_endpoints(first);
    let second_endpoints = topology.edge_endpoints(second);
    assert!(
        first_endpoints
            .iter()
            .any(|vertex| second_endpoints.contains(vertex))
    );
}

#[test]
fn year_of_plenty_completes_an_unaffordable_city() {
    let (topology, board, _rules, _config, mut arena) = fixture();
    own_settlement(&mut arena, &topology);
    arena.state.players[0].resources = [0, 0, 2, 0, 1];
    arena.state.players[0].playable_dev[3] = 1;
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::PreRoll);
    let mut scratch = PolicyScratch::default();
    assert_eq!(
        heuristic_v1::pre_roll(&view, &mut scratch, &HeuristicParams::default(),),
        Some(DevPlay::YearOfPlenty {
            first: Resource::Ore,
            second: Resource::Ore,
        })
    );
}

#[test]
fn deterministic_robber_policies_always_move_when_every_hex_touches_self() {
    let (topology, board, _rules, _config, mut arena) = fixture();
    for vertex in 0..topology.vertex_count() {
        arena.state.vertex_owner[vertex] = 0;
        arena.state.vertex_tier[vertex] = 1;
    }
    let current = arena.state.robber;
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);

    assert_ne!(heuristic_v1::robber(&view).0, current);
    assert_ne!(greedy_no_trade::robber(&view).0, current);
    assert_ne!(priority_trader::robber(&view).0, current);
}
