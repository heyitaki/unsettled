use std::fs;
use std::path::PathBuf;

use unsettled_engine::board::{ConversionOptions, SimBoard};
use unsettled_engine::game::{GameArena, GameConfig};
use unsettled_engine::longest_road::{RoadCard, longest_road};
use unsettled_engine::policy::PolicyScratch;
use unsettled_engine::policy::heuristic_v1::{self, HeuristicParams};
use unsettled_engine::rng::Xoshiro256StarStar;
use unsettled_engine::topology::{Layout, Topology};
use unsettled_engine::view::{Action, DecisionPhase};
use unsettled_engine::wire::WireBoard;

fn fixture() -> (Topology, SimBoard, GameArena) {
    let topology = Topology::load(Layout::Extension6).unwrap();
    let rules = unsettled_engine::rules::RuleConfig::base(Layout::Extension6);
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../src/parser/__tests__/expected/board-draft-empty.json");
    let wire = WireBoard::parse_str(&fs::read_to_string(path).unwrap()).unwrap();
    let board =
        SimBoard::try_from_wire(wire, &topology, &rules, ConversionOptions::default()).unwrap();
    let mut arena = GameArena::default();
    arena.prepare(&board, &topology, &rules, &GameConfig::default());
    (topology, board, arena)
}

fn find_path(topology: &Topology, length: usize) -> (u8, Vec<u8>) {
    fn visit(
        topology: &Topology,
        vertex: u8,
        length: usize,
        visited: u128,
        path: &mut Vec<u8>,
    ) -> bool {
        if path.len() == length {
            return true;
        }
        for edge in topology.vertex_edges(vertex) {
            let endpoints = topology.edge_endpoints(*edge);
            let next = if endpoints[0] == vertex {
                endpoints[1]
            } else {
                endpoints[0]
            };
            let bit = 1_u128 << next;
            if visited & bit != 0 {
                continue;
            }
            path.push(*edge);
            if visit(topology, next, length, visited | bit, path) {
                return true;
            }
            path.pop();
        }
        false
    }

    for start in 0..topology.vertex_count() {
        let mut path = Vec::with_capacity(length);
        if visit(
            topology,
            start as u8,
            length,
            1_u128 << start,
            &mut path,
        ) {
            return (start as u8, path);
        }
    }
    panic!("topology has no simple path of length {length}");
}

#[test]
fn longest_road_win_beats_an_affordable_city() {
    let (topology, board, mut arena) = fixture();
    let (start, path) = find_path(&topology, 6);
    arena.state.vertex_owner[usize::from(start)] = 0;
    arena.state.vertex_tier[usize::from(start)] = 1;
    for edge in &path[..5] {
        arena.state.edge_owner[usize::from(*edge)] = 0;
    }
    arena.state.players[0].vp_public = 8;
    arena.state.players[0].longest_road_len = 5;
    arena.state.players[0].resources = [1, 0, 2, 1, 3];
    arena.state.longest_road = RoadCard {
        holder: Some(1),
        retired: false,
    };
    arena.state.players[1].longest_road_len = 5;

    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let mut scratch = PolicyScratch::default();
    let mut rng = Xoshiro256StarStar::from_seed(17);
    let action =
        heuristic_v1::action(&view, &mut scratch, &HeuristicParams::default(), &mut rng);
    let Action::BuildRoad(chosen) = action else {
        panic!("the two-point Longest Road win must beat the one-point city, chose {action:?}");
    };

    let mut roads = [[0_u8; 2]; 7];
    for (index, edge) in path[..5].iter().copied().enumerate() {
        roads[index] = topology.edge_endpoints(edge);
    }
    roads[5] = topology.edge_endpoints(chosen);
    assert!(
        longest_road(&roads[..6], &[false; 80]) > 5,
        "the selected road must actually take the card"
    );
}
