use std::fs;
use std::path::PathBuf;

use unsettled_engine::board::{ConversionOptions, SimBoard};
use unsettled_engine::game::{GameArena, GameConfig};
use unsettled_engine::policy::heuristic_v1::turns_to_afford;
use unsettled_engine::rules::{
    Buildable, PlayerModifiers, PortAction, PortRule, PortSelector, Resource, RuleConfig,
};
use unsettled_engine::topology::{Layout, Topology};
use unsettled_engine::view::{Action, DecisionPhase};
use unsettled_engine::wire::WireBoard;

fn fixture() -> (Topology, SimBoard, RuleConfig) {
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
    (topology, board, rules)
}

fn connect_empty_vertex(arena: &mut GameArena, topology: &Topology, seat: u8) -> u8 {
    for vertex in 0..topology.vertex_count() {
        let vertex = vertex as u8;
        if arena.state.vertex_owner[usize::from(vertex)] == unsettled_engine::state::EMPTY
            && topology.vertex_adjacent(vertex).iter().all(|adjacent| {
                arena.state.vertex_owner[usize::from(*adjacent)] == unsettled_engine::state::EMPTY
            })
        {
            let edge = topology.vertex_edges(vertex)[0];
            arena.state.edge_owner[usize::from(edge)] = seat;
            return vertex;
        }
    }
    panic!("fixture has no empty vertex");
}

#[test]
fn bricklayer_cost_alternative_is_live_in_validation_and_payment() {
    let (topology, board, rules) = fixture();
    let mut modified = GameConfig::default();
    modified.modifiers[0]
        .extra_cost_alternatives
        .push((Buildable::Settlement, [0, 0, 0, 4, 0]));
    let mut arena = GameArena::default();
    arena.prepare(&board, &topology, &rules, &modified);
    let vertex = connect_empty_vertex(&mut arena, &topology, 0);
    arena.state.players[0].resources = [0, 0, 0, 4, 0];
    let action = Action::BuildSettlement(vertex);
    assert!(arena.validate_action(&board, &topology, 0, action, DecisionPhase::Action));
    assert!(arena.apply_action_for_test(
        &board,
        &topology,
        &rules,
        &modified,
        0,
        action,
        DecisionPhase::Action,
    ));
    assert_eq!(arena.state.players[0].resources, [0; 5]);

    let mut base = GameArena::default();
    let base_config = GameConfig::default();
    base.prepare(&board, &topology, &rules, &base_config);
    let vertex = connect_empty_vertex(&mut base, &topology, 0);
    base.state.players[0].resources = [0, 0, 0, 4, 0];
    assert!(!base.validate_action(
        &board,
        &topology,
        0,
        Action::BuildSettlement(vertex),
        DecisionPhase::Action,
    ));
}

#[test]
fn bank_rate_override_changes_one_seats_live_trade() {
    let (topology, board, rules) = fixture();
    let mut config = GameConfig::default();
    config.modifiers[0].bank_rate_override = Some(3);
    let mut arena = GameArena::default();
    arena.prepare(&board, &topology, &rules, &config);
    arena.state.players[0].resources[Resource::Wood.index()] = 3;
    arena.state.players[1].resources[Resource::Wood.index()] = 3;
    let trade = Action::TradeBank {
        give: Resource::Wood,
        get: Resource::Ore,
        count: 1,
    };
    assert!(arena.validate_action(&board, &topology, 0, trade, DecisionPhase::Action));
    assert!(!arena.validate_action(&board, &topology, 1, trade, DecisionPhase::Action));
    assert!(arena.apply_action_for_test(
        &board,
        &topology,
        &rules,
        &config,
        0,
        trade,
        DecisionPhase::Action,
    ));
    assert_eq!(arena.state.players[0].resources, [0, 0, 0, 0, 1]);
}

#[test]
fn disabled_port_changes_validation_and_policy_cost_estimate() {
    let (topology, board, rules) = fixture();
    let port = board
        .ports()
        .iter()
        .find(|port| port.resource.is_some() && port.rate == 2)
        .copied()
        .unwrap();
    let resource = port.resource.unwrap();
    let vertex = topology.edge_endpoints(port.edge)[0];
    let producer = (0..topology.vertex_count())
        .map(|candidate| candidate as u8)
        .find(|candidate| {
            topology.vertex_hexes(*candidate).iter().any(|hex| {
                board.tiles()[usize::from(*hex)] == Some(resource)
                    && board.tokens()[usize::from(*hex)].is_some()
            })
        })
        .unwrap();

    let normal_config = GameConfig::default();
    let mut normal = GameArena::default();
    normal.prepare(&board, &topology, &rules, &normal_config);
    normal.state.vertex_owner[usize::from(vertex)] = 0;
    normal.state.vertex_owner[usize::from(producer)] = 0;
    normal.refresh_player_rules(&board, &topology, &rules, 0, &normal_config.modifiers[0]);

    let mut cursed_config = GameConfig::default();
    cursed_config.modifiers[0] = PlayerModifiers {
        port_rules: vec![PortRule {
            selector: PortSelector::All,
            action: PortAction::Disable,
        }],
        ..PlayerModifiers::default()
    };
    let mut cursed = GameArena::default();
    cursed.prepare(&board, &topology, &rules, &cursed_config);
    cursed.state.vertex_owner[usize::from(vertex)] = 0;
    cursed.state.vertex_owner[usize::from(producer)] = 0;
    cursed.refresh_player_rules(&board, &topology, &rules, 0, &cursed_config.modifiers[0]);

    normal.state.players[0].resources[resource.index()] = 2;
    cursed.state.players[0].resources[resource.index()] = 2;
    let get = Resource::ALL
        .into_iter()
        .find(|candidate| *candidate != resource)
        .unwrap();
    let trade = Action::TradeBank {
        give: resource,
        get,
        count: 1,
    };
    assert!(normal.validate_action(&board, &topology, 0, trade, DecisionPhase::Action));
    assert!(!cursed.validate_action(&board, &topology, 0, trade, DecisionPhase::Action));

    let missing = Resource::ALL
        .into_iter()
        .find(|candidate| *candidate != resource && *candidate != Resource::Ore)
        .unwrap();
    let mut almost_settlement = [1_i16, 1, 1, 1, 0];
    almost_settlement[missing.index()] = 0;
    normal.state.players[0].resources = almost_settlement;
    cursed.state.players[0].resources = almost_settlement;
    let normal_view = normal.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let cursed_view = cursed.decision_view(&board, &topology, 0, DecisionPhase::Action);
    assert!(
        turns_to_afford(&normal_view, Buildable::Settlement)
            < turns_to_afford(&cursed_view, Buildable::Settlement)
    );
}
