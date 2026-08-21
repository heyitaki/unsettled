use std::fs;
use std::path::PathBuf;

use unsettled_engine::board::{ConversionOptions, SimBoard};
use unsettled_engine::game::{GameArena, GameConfig};
use unsettled_engine::policy::heuristic_v1::{HeuristicParams, recommend, score_actions};
use unsettled_engine::rules::{Resource, RuleConfig};
use unsettled_engine::topology::{Layout, Topology};
use unsettled_engine::view::{ActionBuf, DecisionPhase};
use unsettled_engine::wire::WireBoard;

fn fixture() -> (Topology, SimBoard, RuleConfig, GameConfig) {
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
    (topology, board, rules, GameConfig::default())
}

#[test]
fn hidden_opponent_composition_does_not_change_live_recommendations() {
    let (topology, board, rules, config) = fixture();
    let mut first = GameArena::default();
    let mut second = GameArena::default();
    first.prepare(&board, &topology, &rules, &config);
    second.prepare(&board, &topology, &rules, &config);
    first.state.players[1].resources = [5, 0, 0, 0, 0];
    second.state.players[1].resources = [0, 0, 0, 0, 5];

    let first_view = first.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let second_view = second.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let params = HeuristicParams::default();
    assert_eq!(first_view.to_owned(), second_view.to_owned());
    assert_eq!(
        recommend(&first_view, &params),
        recommend(&second_view, &params)
    );
}

#[test]
fn allocation_free_scorer_and_vec_adapter_are_equivalent_on_live_state() {
    let (topology, board, rules, config) = fixture();
    let mut arena = GameArena::default();
    arena.prepare(&board, &topology, &rules, &config);
    arena.state.players[0].resources[Resource::Wood.index()] = 1;
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let params = HeuristicParams::default();
    let mut buffer = ActionBuf::new();
    score_actions(&view, &params, &mut buffer);
    assert_eq!(recommend(&view, &params), buffer.as_slice());
}

#[test]
fn heuristic_parameters_change_live_scores() {
    let (topology, board, rules, config) = fixture();
    let mut arena = GameArena::default();
    arena.prepare(&board, &topology, &rules, &config);
    let port = board
        .ports()
        .iter()
        .find(|port| port.resource.is_none())
        .unwrap();
    let vertex = topology
        .edge_endpoints(port.edge)
        .into_iter()
        .find(|vertex| {
            topology.vertex_hexes(*vertex).iter().any(|hex| {
                board.tiles()[usize::from(*hex)].is_some()
                    && board.tokens()[usize::from(*hex)].is_some()
            })
        })
        .unwrap();
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let with_ports = unsettled_engine::policy::heuristic_v1::vertex_score(
        &view,
        vertex,
        &HeuristicParams::default(),
        unsettled_engine::policy::heuristic_v1::BuildKind::Settlement,
    );
    let without_ports = unsettled_engine::policy::heuristic_v1::vertex_score(
        &view,
        vertex,
        &HeuristicParams {
            port_weight: 0.0,
            ..HeuristicParams::default()
        },
        unsettled_engine::policy::heuristic_v1::BuildKind::Settlement,
    );
    assert_ne!(with_ports, without_ports);
}
