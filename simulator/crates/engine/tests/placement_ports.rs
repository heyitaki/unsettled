use std::fs;
use std::path::PathBuf;

use unsettled_engine::board::{ConversionOptions, SimBoard};
use unsettled_engine::placement::{PlacementKind, vertex_score};
use unsettled_engine::rules::{Resource, RuleConfig};
use unsettled_engine::topology::{Layout, Topology};
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

#[test]
fn port_synergy_uses_matching_resource_port_kind_and_rate() {
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
    let score = |board: &SimBoard| {
        vertex_score(
            PlacementKind::PortSynergy,
            board,
            &topology,
            vertex,
            &[0; 5],
        )
    };

    assert!(score(&matching_two) > score(&mismatching_two));
    assert!(score(&generic) > score(&without));
    assert!(score(&matching_two) > score(&matching_four));
}
