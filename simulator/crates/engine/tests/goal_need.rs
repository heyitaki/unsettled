//! The shared goal-need model (Phase J1) and its first consumer, the `vertex_score`
//! build-target term.

use std::fs;
use std::path::PathBuf;

use unsettled_engine::board::{ConversionOptions, SimBoard};
use unsettled_engine::game::{GameArena, GameConfig};
use unsettled_engine::policy::PolicyScratch;
use unsettled_engine::policy::goal_need::GoalNeed;
use unsettled_engine::policy::heuristic_v1::{self, BUILD_BAND, BuildKind, HeuristicParams};
use unsettled_engine::rng::Xoshiro256StarStar;
use unsettled_engine::rules::{Buildable, RESOURCE_COUNT, RuleConfig};
use unsettled_engine::topology::{Layout, Topology};
use unsettled_engine::view::{Action, DecisionPhase, pips};
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

/// A vertex's production pips with the same robber skip `vertex_score` and
/// `production_pips` apply.
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

// Forwarded arguments of `GoalNeed::derive` and the `vertex_score` goal-need term, one
// observing test each:
// - `goal` (which buildable's costs are read): the_need_vector_matches_the_closed_form
//   (city vs road need vectors on one state)
// - own hand (via `view`): the_need_vector_matches_the_closed_form and
//   an_affordable_goal_needs_nothing
// - own production pips (via `view`): the_need_vector_matches_the_closed_form (the
//   pips-per-round subtraction)
// - seats as rolls per round (via `view`): the_need_vector_matches_the_closed_form (the
//   hard-coded 5.0 factor on the five-seat fixture)
// - cost variants (via `view`): the_need_uses_the_closest_cost_variant
// - candidate production (`production_term`): the_vertex_term_weights_production_by_need
// - the decision's selected goal (forwarded into the build candidates):
//   the_build_candidates_add_the_weighted_term_for_the_selected_goal
// - `params.goal_need_weight`: the_build_candidates_add_the_weighted_term_for_the_selected_goal
//   (2.5), a_zero_weight_restores_the_pre_term_scores_bit_for_bit (0.0), and
//   the_goal_need_labels_select_their_trial_weights in `policy::mod` (the trial labels)
// - chooser independence (the goal chooser never receives the need term):
//   the_goal_chooser_prices_vertices_without_the_need_term

#[test]
fn the_need_vector_matches_the_closed_form() {
    let (topology, board, _rules, mut arena) = fixture();
    let owned = (0..topology.vertex_count() as u8)
        .find(|vertex| {
            local_production(&board, &topology, *vertex)
                .iter()
                .sum::<u16>()
                > 0
        })
        .unwrap();
    arena.state.vertex_owner[usize::from(owned)] = 0;
    arena.state.vertex_tier[usize::from(owned)] = 1;
    // One wheat and one ore in hand against the city cost [0, 0, 2, 0, 3].
    arena.state.players[0].resources = [0, 0, 1, 0, 1];
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let own = view.production_pips(0);
    let missing = [0_u8, 0, 1, 0, 2];
    // Five seats on this fixture, so one round is five rolls; a wrong rolls source
    // (a constant four, say) fails these exact values.
    let expected: [f32; RESOURCE_COUNT] = std::array::from_fn(|resource| {
        (f32::from(missing[resource]) - f32::from(own[resource]) * 5.0 / 36.0).max(0.0)
    });
    assert_eq!(view.seats(), 5);
    assert_eq!(GoalNeed::derive(&view, Buildable::City).need, expected);

    // A different goal reads a different cost: the road cost [1, 0, 0, 1, 0] needs wood
    // and brick instead.
    let road_missing = [1_u8, 0, 0, 1, 0];
    let road_expected: [f32; RESOURCE_COUNT] = std::array::from_fn(|resource| {
        (f32::from(road_missing[resource]) - f32::from(own[resource]) * 5.0 / 36.0).max(0.0)
    });
    assert_eq!(GoalNeed::derive(&view, Buildable::Road).need, road_expected);
}

#[test]
fn the_need_uses_the_closest_cost_variant() {
    let (topology, board, rules, _arena) = fixture();
    let mut config = GameConfig::default();
    config.modifiers[0]
        .extra_cost_alternatives
        .push((Buildable::City, [0, 1, 0, 0, 0]));
    let mut arena = GameArena::default();
    arena.prepare(&board, &topology, &rules, &config);
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    // The base city cost [0, 0, 2, 0, 3] is five short of the empty hand; the one-sheep
    // alternative is one short and wins, with no production to subtract.
    assert_eq!(
        GoalNeed::derive(&view, Buildable::City).need,
        [0.0, 1.0, 0.0, 0.0, 0.0]
    );
}

#[test]
fn an_affordable_goal_needs_nothing() {
    let (topology, board, _rules, mut arena) = fixture();
    arena.state.players[0].resources = [0, 0, 2, 0, 3];
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    assert_eq!(GoalNeed::derive(&view, Buildable::City).need, [0.0; 5]);
}

#[test]
fn the_vertex_term_weights_production_by_need() {
    let need = GoalNeed {
        need: [0.0, 1.5, 0.0, 0.25, 2.0],
    };
    // 2 * 1.5 + 4 * 0.25 + 1 * 2.0; wood and wheat production is dead weight.
    assert_eq!(need.production_term(&[3, 2, 5, 4, 1]), 6.0);
    assert_eq!(need.production_term(&[7, 0, 9, 0, 0]), 0.0);
}

/// The J1 integration fixture: the observer holds exactly the settlement cost, owns an
/// upgradeable settlement (the city goal) and one detached road whose endpoints are legal
/// settlement sites, and has no road pieces (no road goal). A hugely negative
/// `diversity_bonus` sinks every settlement goal candidate below the city goal, so the
/// decision's selected goal is an unaffordable city with real need while settlement builds
/// are affordable — the state where the goal-need term prices build candidates.
fn selected_goal_fixture(
    weight: f32,
) -> (Topology, SimBoard, GameArena, HeuristicParams, u8, u8, u8) {
    let (topology, board, _rules, mut arena) = fixture();
    let ore = 4;
    let placement = (0..topology.vertex_count() as u8)
        .filter(|vertex| {
            local_production(&board, &topology, *vertex)
                .iter()
                .sum::<u16>()
                > 0
        })
        .find_map(|owned| {
            let own = local_production(&board, &topology, owned);
            (0..topology.edge_count() as u8).find_map(|edge| {
                let [first, second] = topology.edge_endpoints(edge);
                let legal_target = |vertex: u8| {
                    vertex != owned && !topology.vertex_adjacent(vertex).contains(&owned)
                };
                let new_resource = |vertex: u8| {
                    let production = local_production(&board, &topology, vertex);
                    (0..RESOURCE_COUNT)
                        .any(|resource| production[resource] > 0 && own[resource] == 0)
                };
                (legal_target(first)
                    && legal_target(second)
                    && new_resource(first)
                    && new_resource(second)
                    && (local_production(&board, &topology, first)[ore] > 0
                        || local_production(&board, &topology, second)[ore] > 0))
                .then_some((owned, edge))
            })
        });
    let (owned, edge) = placement.expect("fixture board offers a qualifying placement");
    arena.state.vertex_owner[usize::from(owned)] = 0;
    arena.state.vertex_tier[usize::from(owned)] = 1;
    arena.state.edge_owner[usize::from(edge)] = 0;
    arena.state.players[0].pieces[Buildable::Road.index()] = 0;
    // Exactly the settlement cost: settlements are affordable, the city is not, and no
    // bank trade or dev buy is payable.
    arena.state.players[0].resources = [1, 1, 1, 1, 0];
    let params = HeuristicParams {
        diversity_bonus: -10_000.0,
        goal_need_weight: weight,
        ..HeuristicParams::default()
    };
    let [first, second] = topology.edge_endpoints(edge);
    (topology, board, arena, params, owned, first, second)
}

#[test]
fn the_build_candidates_add_the_weighted_term_for_the_selected_goal() {
    let (topology, board, arena, params, _owned, first, second) = selected_goal_fixture(2.5);
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let mut scratch = PolicyScratch::default();
    let mut rng = Xoshiro256StarStar::from_seed(7);
    heuristic_v1::action(&view, &mut scratch, &params, &mut rng);
    assert_eq!(scratch.goal, Some(Buildable::City));
    let need = GoalNeed::derive(&view, Buildable::City);
    let mut settlements = 0;
    let mut live_terms = 0;
    for candidate in scratch.actions.as_slice() {
        let Action::BuildSettlement(vertex) = candidate.action else {
            continue;
        };
        settlements += 1;
        assert!(vertex == first || vertex == second);
        let term = need.production_term(&local_production(&board, &topology, vertex));
        if term != 0.0 {
            live_terms += 1;
        }
        let expected = BUILD_BAND
            + (heuristic_v1::vertex_score(&view, vertex, &params, BuildKind::Settlement)
                + params.goal_need_weight * term);
        assert_eq!(candidate.score.to_bits(), expected.to_bits());
    }
    assert_eq!(settlements, 2);
    assert!(live_terms > 0, "the fixture must exercise a non-zero term");
}

#[test]
fn a_zero_weight_restores_the_pre_term_scores_bit_for_bit() {
    let (topology, board, arena, params, _owned, _first, _second) = selected_goal_fixture(0.0);
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let mut scratch = PolicyScratch::default();
    let mut rng = Xoshiro256StarStar::from_seed(7);
    heuristic_v1::action(&view, &mut scratch, &params, &mut rng);
    assert_eq!(scratch.goal, Some(Buildable::City));
    let need = GoalNeed::derive(&view, Buildable::City);
    let mut live_terms = 0;
    for candidate in scratch.actions.as_slice() {
        let Action::BuildSettlement(vertex) = candidate.action else {
            continue;
        };
        if need.production_term(&local_production(&board, &topology, vertex)) != 0.0 {
            live_terms += 1;
        }
        let expected =
            BUILD_BAND + heuristic_v1::vertex_score(&view, vertex, &params, BuildKind::Settlement);
        assert_eq!(candidate.score.to_bits(), expected.to_bits());
    }
    assert!(
        live_terms > 0,
        "the fixture must be one where a non-zero weight would move the score"
    );
}

#[test]
fn the_goal_chooser_prices_vertices_without_the_need_term() {
    // At this weight, leaking the need term into the chooser's settlement pricing would
    // swamp the negative diversity term (the targets produce city-needed ore) and flip the
    // selected goal to Settlement; the chooser structurally passes no need, so the city
    // goal and the closed-form candidate scores both hold.
    let (topology, board, arena, params, _owned, _first, _second) =
        selected_goal_fixture(1.0e9);
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let mut scratch = PolicyScratch::default();
    let mut rng = Xoshiro256StarStar::from_seed(7);
    heuristic_v1::action(&view, &mut scratch, &params, &mut rng);
    assert_eq!(scratch.goal, Some(Buildable::City));
    let need = GoalNeed::derive(&view, Buildable::City);
    for candidate in scratch.actions.as_slice() {
        let Action::BuildSettlement(vertex) = candidate.action else {
            continue;
        };
        let expected = BUILD_BAND
            + (heuristic_v1::vertex_score(&view, vertex, &params, BuildKind::Settlement)
                + params.goal_need_weight
                    * need.production_term(&local_production(&board, &topology, vertex)));
        assert_eq!(candidate.score.to_bits(), expected.to_bits());
    }
}
