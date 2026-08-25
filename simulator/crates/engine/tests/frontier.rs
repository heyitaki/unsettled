//! The J5 frontier measure (`policy::frontier::opened`), its blend into the settlement
//! expansion term of `vertex_score` behind `HeuristicParams::frontier_mix`, and the
//! SIM-GAP-24 `dev_buy_scale` exposure on the development-card buy score.

use std::fs;
use std::path::PathBuf;

use unsettled_engine::board::{ConversionOptions, SimBoard};
use unsettled_engine::game::{GameArena, GameConfig};
use unsettled_engine::policy::frontier;
use unsettled_engine::policy::heuristic_v1::{self, BuildKind, HeuristicParams, LegacyValuation};
use unsettled_engine::rules::{RESOURCE_COUNT, RuleConfig};
use unsettled_engine::topology::{Layout, Topology};
use unsettled_engine::view::{DecisionPhase, pips};
use unsettled_engine::wire::WireBoard;

fn fixture() -> (Topology, SimBoard, RuleConfig, GameArena) {
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
    let mut arena = GameArena::default();
    arena.prepare(&board, &topology, &rules, &GameConfig::default());
    (topology, board, rules, arena)
}

/// A vertex's production pips with the robber skip `vertex_score` applies.
fn local_production(board: &SimBoard, topology: &Topology, vertex: u8) -> [u16; RESOURCE_COUNT] {
    let mut production = [0_u16; RESOURCE_COUNT];
    for hex in topology.vertex_hexes(vertex) {
        if *hex == board.robber() {
            continue;
        }
        if let (Some(resource), Some(token)) = (
            board.tiles()[usize::from(*hex)],
            board.tokens()[usize::from(*hex)],
        ) {
            production[resource.index()] += u16::from(pips(token));
        }
    }
    production
}

/// A degree-three vertex whose neighbours are all degree three: on the empty board its
/// frontier is exactly 3 reachable neighbours + 3 * 2 settleable sites beyond them.
fn interior_vertex(topology: &Topology) -> u8 {
    (0..topology.vertex_count() as u8)
        .find(|vertex| {
            topology.vertex_adjacent(*vertex).len() == 3
                && topology
                    .vertex_adjacent(*vertex)
                    .iter()
                    .all(|adjacent| topology.vertex_adjacent(*adjacent).len() == 3)
        })
        .expect("extension6 has interior vertices")
}

// Forwarded arguments of `frontier::opened`, the `vertex_score` blend, and the buy-score
// scale, one observing test each:
// - the connecting edge's ownership: the_frontier_counts_the_opened_vertices_in_the_closed_form
//   (rival road case)
// - the adjacent vertex's ownership: same test (rival settlement on the neighbour)
// - the observer's network reach (`road_reaches`, both rings): same test (own road case)
// - `is_expansion_target` on the distance-2 site: same test (rival settlement beyond)
// - `params.frontier_mix` (blend weight and the mix-one endpoint):
//   the_mix_blends_the_degree_and_the_frontier_in_the_closed_form
// - the zero-mix guard (frontier never computed, degree count bit-for-bit):
//   a_zero_mix_keeps_the_degree_count_bit_for_bit
// - the trial labels: the_frontier_labels_select_their_trial_mixes in `policy::mod`
// - `params.dev_buy_scale` (both spellings of the buy score):
//   the_dev_buy_scale_multiplies_the_buy_score

#[test]
fn the_frontier_counts_the_opened_vertices_in_the_closed_form() {
    // Empty board: every branch is open, so the interior fan is 3 + 3 * 2.
    let (topology, board, _rules, arena) = fixture();
    let vertex = interior_vertex(&topology);
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    assert_eq!(frontier::opened(&view, vertex), 9.0);
    let first = topology.vertex_adjacent(vertex)[0];

    // A rival road on the connecting edge closes that whole branch: -1 reachable, -2 sites.
    let (topology, board, _rules, mut arena) = fixture();
    let edge = topology.edge_between(vertex, first).unwrap();
    arena.state.edge_owner[usize::from(edge)] = 1;
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    assert_eq!(frontier::opened(&view, vertex), 6.0);

    // A rival settlement on the neighbour closes the branch the same way.
    let (topology, board, _rules, mut arena) = fixture();
    arena.state.vertex_owner[usize::from(first)] = 1;
    arena.state.vertex_tier[usize::from(first)] = 1;
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    assert_eq!(frontier::opened(&view, vertex), 6.0);

    // An own road one step out means that branch opens nothing new: the neighbour (and the
    // site beyond it) are already reached, so nothing there is newly opened.
    let (topology, board, _rules, mut arena) = fixture();
    let beyond = *topology
        .vertex_adjacent(first)
        .iter()
        .find(|candidate| **candidate != vertex)
        .unwrap();
    let far = topology.edge_between(first, beyond).unwrap();
    arena.state.edge_owner[usize::from(far)] = 0;
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    assert_eq!(frontier::opened(&view, vertex), 6.0);

    // A rival settlement on a distance-2 site removes only that site: it is still newly
    // reachable territory behind the neighbour, but no longer distance-rule-open.
    let (topology, board, _rules, mut arena) = fixture();
    arena.state.vertex_owner[usize::from(beyond)] = 1;
    arena.state.vertex_tier[usize::from(beyond)] = 1;
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    assert_eq!(frontier::opened(&view, vertex), 8.0);
}

#[test]
fn the_mix_blends_the_degree_and_the_frontier_in_the_closed_form() {
    let (topology, board, _rules, arena) = fixture();
    let vertex = interior_vertex(&topology);
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    assert!(
        view.board().ports_at(vertex).next().is_none(),
        "an interior vertex carries no port, so the port term is zero"
    );
    let params = HeuristicParams {
        expansion_weight: 0.4,
        frontier_mix: 0.5,
        ..HeuristicParams::default()
    };
    // The full expression, replicated with the code's own operation order. The observer
    // owns nothing, so own production is zero and the diversity filter reduces to
    // produced-here.
    let production = local_production(&board, &topology, vertex);
    let board_totals = view.board_resource_pips();
    let raw: u16 = production.iter().sum();
    let scarcity = production
        .iter()
        .enumerate()
        .map(|(resource, value)| f32::from(*value) / f32::from(board_totals[resource].max(1)))
        .sum::<f32>();
    let diversity = production.iter().filter(|value| **value > 0).count() as f32;
    let degree = 3.0_f32;
    let blended = degree + 0.5 * (frontier::opened(&view, vertex) - degree);
    let expected = f32::from(raw) * 1.0
        + scarcity * 0.35 * 10.0
        + diversity * 1.4
        + 0.0 * 0.1
        + blended * 0.4;
    let actual = heuristic_v1::vertex_score(&view, vertex, &params, BuildKind::Settlement);
    assert_eq!(actual.to_bits(), expected.to_bits());
    // A different mix forwards differently.
    let full = HeuristicParams {
        frontier_mix: 1.0,
        ..params.clone()
    };
    let expected_full = f32::from(raw) * 1.0
        + scarcity * 0.35 * 10.0
        + diversity * 1.4
        + 0.0 * 0.1
        + frontier::opened(&view, vertex) * 0.4;
    let actual_full = heuristic_v1::vertex_score(&view, vertex, &full, BuildKind::Settlement);
    assert_eq!(actual_full.to_bits(), expected_full.to_bits());
    assert_ne!(actual.to_bits(), actual_full.to_bits());
}

#[test]
fn a_zero_mix_keeps_the_degree_count_bit_for_bit() {
    // An own road out of the candidate makes the frontier (6) differ from the degree (3),
    // so a mix that leaked into the default path would move the score.
    let (topology, board, _rules, mut arena) = fixture();
    let vertex = interior_vertex(&topology);
    let first = topology.vertex_adjacent(vertex)[0];
    let edge = topology.edge_between(vertex, first).unwrap();
    arena.state.edge_owner[usize::from(edge)] = 0;
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    assert_ne!(frontier::opened(&view, vertex), 3.0);

    let zero = HeuristicParams {
        expansion_weight: 0.4,
        ..HeuristicParams::default()
    };
    let production = local_production(&board, &topology, vertex);
    let board_totals = view.board_resource_pips();
    let raw: u16 = production.iter().sum();
    let scarcity = production
        .iter()
        .enumerate()
        .map(|(resource, value)| f32::from(*value) / f32::from(board_totals[resource].max(1)))
        .sum::<f32>();
    let diversity = production.iter().filter(|value| **value > 0).count() as f32;
    let expected = f32::from(raw) * 1.0
        + scarcity * 0.35 * 10.0
        + diversity * 1.4
        + 0.0 * 0.1
        + 3.0 * 0.4;
    let actual = heuristic_v1::vertex_score(&view, vertex, &zero, BuildKind::Settlement);
    assert_eq!(actual.to_bits(), expected.to_bits());

    let mixed = HeuristicParams {
        frontier_mix: 1.0,
        ..zero.clone()
    };
    assert_ne!(
        heuristic_v1::vertex_score(&view, vertex, &mixed, BuildKind::Settlement).to_bits(),
        actual.to_bits()
    );
}

#[test]
fn the_dev_buy_scale_multiplies_the_buy_score() {
    let (topology, board, _rules, arena) = fixture();
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    // The deck-aware spelling.
    let base = heuristic_v1::dev_buy_score(&view, &HeuristicParams::default());
    assert!(base > 0.0, "an untouched deck must price a buy above zero");
    let scaled = HeuristicParams {
        dev_buy_scale: 2.5,
        ..HeuristicParams::default()
    };
    assert_eq!(
        heuristic_v1::dev_buy_score(&view, &scaled).to_bits(),
        (base * 2.5).to_bits()
    );
    // The legacy deck-blind spelling scales too, so a Phase-H sweep moves every arm.
    let legacy = HeuristicParams {
        legacy_valuation: Some(LegacyValuation {
            deck_blind_buying: true,
            ..LegacyValuation::default()
        }),
        ..HeuristicParams::default()
    };
    let legacy_base = heuristic_v1::dev_buy_score(&view, &legacy);
    assert!(legacy_base > 0.0);
    let legacy_scaled = HeuristicParams {
        dev_buy_scale: 2.5,
        ..legacy.clone()
    };
    assert_eq!(
        heuristic_v1::dev_buy_score(&view, &legacy_scaled).to_bits(),
        (legacy_base * 2.5).to_bits()
    );
}
