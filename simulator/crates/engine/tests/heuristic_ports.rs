use std::fs;
use std::path::PathBuf;

use unsettled_engine::board::{ConversionOptions, SimBoard};
use unsettled_engine::game::{GameArena, GameConfig};
use unsettled_engine::policy::heuristic_v1::{HeuristicParams, vertex_score};
use unsettled_engine::rules::{
    PlayerModifiers, PortAction, PortRule, PortSelector, Resource, RuleConfig,
};
use unsettled_engine::topology::{Layout, Topology};
use unsettled_engine::view::DecisionPhase;
use unsettled_engine::wire::WireBoard;

fn fixture() -> (Topology, RuleConfig, WireBoard) {
    let topology = Topology::load(Layout::Extension6).unwrap();
    let rules = RuleConfig::base(Layout::Extension6);
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../src/parser/__tests__/expected/board-draft-empty.json");
    let wire = WireBoard::parse_str(&fs::read_to_string(path).unwrap()).unwrap();
    (topology, rules, wire)
}

fn convert(wire: WireBoard, topology: &Topology, rules: &RuleConfig) -> SimBoard {
    SimBoard::try_from_wire(wire, topology, rules, ConversionOptions::default()).unwrap()
}

fn production_at(board: &SimBoard, topology: &Topology, vertex: u8) -> [u16; 5] {
    let mut production = [0; 5];
    for hex in topology.vertex_hexes(vertex) {
        if let (Some(resource), Some(token)) = (
            board.tiles()[usize::from(*hex)],
            board.tokens()[usize::from(*hex)],
        ) {
            production[resource.index()] += u16::from(6_u8.saturating_sub(7_u8.abs_diff(token)));
        }
    }
    production
}

fn score(
    board: &SimBoard,
    topology: &Topology,
    rules: &RuleConfig,
    vertex: u8,
    modifier: PlayerModifiers,
) -> f32 {
    let mut config = GameConfig::default();
    config.modifiers[0] = modifier;
    let mut arena = GameArena::default();
    arena.prepare(board, topology, rules, &config);
    let view = arena.decision_view(board, topology, 0, DecisionPhase::Action);
    vertex_score(&view, vertex, &HeuristicParams::default())
}

#[test]
fn prospective_port_score_uses_resource_rate_and_observer_rules() {
    let (topology, rules, wire) = fixture();
    let base = convert(wire.clone(), &topology, &rules);
    let (port_index, vertex, matching, mismatching) = wire
        .ports
        .iter()
        .enumerate()
        .find_map(|(port_index, port)| {
            topology
                .edge_endpoints(topology.edge_by_id(&port.edge_id).unwrap())
                .into_iter()
                .find_map(|vertex| {
                    let production = production_at(&base, &topology, vertex);
                    let matching = Resource::ALL
                        .into_iter()
                        .find(|resource| production[resource.index()] > 0)?;
                    let mismatching = Resource::ALL
                        .into_iter()
                        .find(|resource| production[resource.index()] == 0)?;
                    Some((port_index, vertex, matching, mismatching))
                })
        })
        .unwrap();
    let board_with = |resource, rate| {
        let mut candidate = wire.clone();
        candidate.ports[port_index].resource = resource;
        candidate.ports[port_index].rate = rate;
        convert(candidate, &topology, &rules)
    };
    let matching_two = board_with(Some(matching), 2.0);
    let matching_four = board_with(Some(matching), 4.0);
    let mismatching_two = board_with(Some(mismatching), 2.0);
    let generic = board_with(None, 3.0);
    let mut without_wire = wire;
    without_wire.ports.remove(port_index);
    let without = convert(without_wire, &topology, &rules);
    let base_modifier = PlayerModifiers::default();

    let matching_score = score(
        &matching_two,
        &topology,
        &rules,
        vertex,
        base_modifier.clone(),
    );
    assert!(
        matching_score
            > score(
                &mismatching_two,
                &topology,
                &rules,
                vertex,
                base_modifier.clone(),
            )
    );
    assert!(
        matching_score
            > score(
                &matching_four,
                &topology,
                &rules,
                vertex,
                base_modifier.clone(),
            )
    );
    let without_score = score(&without, &topology, &rules, vertex, base_modifier.clone());
    assert!(score(&generic, &topology, &rules, vertex, base_modifier,) > without_score);

    let disabled = PlayerModifiers {
        port_rules: vec![PortRule {
            selector: PortSelector::All,
            action: PortAction::Disable,
        }],
        ..PlayerModifiers::default()
    };
    assert!(
        (score(&matching_two, &topology, &rules, vertex, disabled) - without_score).abs()
            < f32::EPSILON
    );
}
