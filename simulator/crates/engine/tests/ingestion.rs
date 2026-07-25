use std::fs;
use std::path::PathBuf;

use serde_json::{Value, json};
use unsettled_engine::board::{ConversionError, ConversionOptions, SimBoard};
use unsettled_engine::rules::RuleConfig;
use unsettled_engine::topology::{Layout, Topology};
use unsettled_engine::wire::{BuildingTier, WireBoard, WireBuilding};

fn fixture(name: &str) -> String {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../src/parser/__tests__/expected")
        .join(name);
    fs::read_to_string(path).unwrap()
}

#[test]
fn real_fixtures_parse_losslessly_and_map_to_indices() {
    let draft = WireBoard::parse_str(&fixture("board-draft-empty.json")).unwrap();
    assert_eq!(draft.players.len(), 5);
    assert_eq!(draft.ports.len(), 11);
    assert_eq!(
        draft
            .ports
            .iter()
            .filter(|port| port
                .resource
                .as_ref()
                .is_some_and(|value| value.as_str() == "sheep")
                && port.rate == 2.0)
            .count(),
        2
    );
    let topology = Topology::load(Layout::Extension6).unwrap();
    let sim = SimBoard::try_from_wire(
        draft,
        &topology,
        &RuleConfig::base(Layout::Extension6),
        ConversionOptions::default(),
    )
    .unwrap();
    assert_eq!(sim.seats(), 5);
    assert_eq!(sim.ports().len(), 11);

    let endgame = WireBoard::parse_str(&fixture("board-endgame-pieces.json")).unwrap();
    assert_eq!(endgame.roads.len(), 33);
    assert_eq!(endgame.buildings.len(), 23);
    assert_eq!(
        (
            endgame
                .buildings
                .iter()
                .filter(|piece| piece.tier == BuildingTier::Settlement)
                .count(),
            endgame
                .buildings
                .iter()
                .filter(|piece| piece.tier == BuildingTier::City)
                .count(),
            endgame
                .buildings
                .iter()
                .filter(|piece| piece.tier == BuildingTier::SuperCity)
                .count(),
        ),
        (13, 9, 1)
    );
}

#[test]
fn exact_key_pass_rejects_missing_nullable_and_nested_keys() {
    let source = fixture("board-draft-empty.json");
    let base: Value = serde_json::from_str(&source).unwrap();
    for key in ["robber", "mePlayerId"] {
        let mut value = base.clone();
        value.as_object_mut().unwrap().remove(key);
        assert!(
            WireBoard::parse_value(value)
                .unwrap_err()
                .to_string()
                .contains("exact keys")
        );
    }
    for (array, key) in [
        ("hexes", "tile"),
        ("hexes", "numberToken"),
        ("ports", "resource"),
    ] {
        let mut value = base.clone();
        value[array][0].as_object_mut().unwrap().remove(key);
        assert!(
            WireBoard::parse_value(value)
                .unwrap_err()
                .to_string()
                .contains("exact keys")
        );
    }
    let mut extra = base;
    extra["surprise"] = json!(true);
    assert!(WireBoard::parse_value(extra).is_err());
}

#[test]
fn port_rates_match_the_javascript_number_envelope() {
    let source = fixture("board-draft-empty.json");
    for accepted in [4_294_967_296.0, 1e20] {
        let mut value: Value = serde_json::from_str(&source).unwrap();
        value["ports"][0]["rate"] = json!(accepted);
        let wire = WireBoard::parse_value(value).unwrap();
        let topology = Topology::load(Layout::Extension6).unwrap();
        let sim = SimBoard::try_from_wire(
            wire,
            &topology,
            &RuleConfig::base(Layout::Extension6),
            ConversionOptions::default(),
        )
        .unwrap();
        assert_eq!(sim.ports()[0].rate, u32::MAX);
    }
    for rejected in [1.0, 2.5] {
        let mut value: Value = serde_json::from_str(&source).unwrap();
        value["ports"][0]["rate"] = json!(rejected);
        assert!(WireBoard::parse_value(value).is_err());
    }
}

#[test]
fn wire_and_simulation_readiness_are_separate() {
    let source = fixture("board-draft-empty.json");
    let mut null_tile: Value = serde_json::from_str(&source).unwrap();
    null_tile["hexes"][0]["tile"] = Value::Null;
    let wire = WireBoard::parse_value(null_tile).unwrap();
    let topology = Topology::load(Layout::Extension6).unwrap();
    assert!(matches!(
        SimBoard::try_from_wire(
            wire,
            &topology,
            &RuleConfig::base(Layout::Extension6),
            ConversionOptions::default()
        ),
        Err(ConversionError::NullTile { .. })
    ));

    let mut standard: Value = serde_json::from_str(&source).unwrap();
    standard["layout"] = json!("standard4");
    standard["hexes"] = Value::Array(
        standard["hexes"]
            .as_array()
            .unwrap()
            .iter()
            .take(19)
            .cloned()
            .collect(),
    );
    assert!(
        WireBoard::parse_value(standard).is_err(),
        "wrong hex set is rejected at the wire layer"
    );
}

#[test]
fn adjacent_initial_buildings_are_wire_valid_but_not_simulation_ready() {
    let topology = Topology::load(Layout::Extension6).unwrap();
    let rules = RuleConfig::base(Layout::Extension6);
    let mut wire = WireBoard::parse_str(&fixture("board-draft-empty.json")).unwrap();
    let first = 0;
    let second = topology.vertex_adjacent(first)[0];
    wire.buildings = vec![
        WireBuilding {
            vertex_id: topology.vertex_id(first).to_string(),
            player_id: wire.players[0].id.clone(),
            tier: BuildingTier::Settlement,
        },
        WireBuilding {
            vertex_id: topology.vertex_id(second).to_string(),
            player_id: wire.players[1].id.clone(),
            tier: BuildingTier::Settlement,
        },
    ];
    wire.validate().unwrap();
    assert!(matches!(
        SimBoard::try_from_wire(wire, &topology, &rules, ConversionOptions::default()),
        Err(ConversionError::OccupiedOverlap)
    ));
}

#[test]
fn null_robber_uses_the_lowest_topology_desert_index() {
    let topology = Topology::load(Layout::Extension6).unwrap();
    let rules = RuleConfig::base(Layout::Extension6);
    let mut wire = WireBoard::parse_str(&fixture("board-draft-empty.json")).unwrap();
    let existing_desert = wire
        .hexes
        .iter()
        .position(|hex| hex.tile == Some(unsettled_engine::wire::TileKind::Desert))
        .unwrap();
    let added_desert = if existing_desert == 0 { 1 } else { 0 };
    wire.hexes[added_desert].tile = Some(unsettled_engine::wire::TileKind::Desert);
    wire.hexes[added_desert].number_token = None;
    wire.robber = None;
    wire.hexes.reverse();
    wire.validate().unwrap();

    let expected = wire
        .hexes
        .iter()
        .filter(|hex| hex.tile == Some(unsettled_engine::wire::TileKind::Desert))
        .map(|hex| topology.hex_by_key(&hex.coord.key()).unwrap())
        .min()
        .unwrap();
    let board =
        SimBoard::try_from_wire(wire, &topology, &rules, ConversionOptions::default()).unwrap();
    assert_eq!(board.robber(), expected);
}
