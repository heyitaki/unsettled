//! The J3 piece-economy terms (SIM-GAP-29): the settlement-slot return on city value
//! (`policy::piece_economy::SlotReturn`) and the cost-pressure charge on build candidates
//! (`goal_need::GoalNeed::cost_term`).

use std::fs;
use std::path::PathBuf;

use unsettled_engine::board::{ConversionOptions, SimBoard};
use unsettled_engine::game::{GameArena, GameConfig};
use unsettled_engine::policy::PolicyScratch;
use unsettled_engine::policy::goal_need::GoalNeed;
use unsettled_engine::policy::heuristic_v1::{self, BUILD_BAND, BuildKind, HeuristicParams};
use unsettled_engine::policy::piece_economy::SlotReturn;
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

/// A vertex's production pips with the same robber skip `vertex_score` applies.
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

// Forwarded arguments of `SlotReturn::derive`, `GoalNeed::cost_term`, and their consumers,
// one observing test each:
// - observer settlement pieces left (`derive`): the_slot_return_matches_the_closed_form
//   (5 -> 0.0, 1 -> 0.8, 0 -> 1.0 against the fixed limit of five)
// - settlement piece limit (`derive`): the_slot_return_matches_the_closed_form (the
//   hard-coded fifths in the expected values)
// - board-wide open sites (`derive`): the_slot_return_scales_with_open_sites (a saturated
//   board zeroes the value, one open site prices at 1/5)
// - `params.slot_return_weight`: the_city_candidates_add_the_weighted_slot_term (3.0),
//   a_zero_slot_weight_restores_the_pre_term_scores_bit_for_bit (0.0), and
//   the_econ_labels_select_their_trial_weights in `policy::mod` (the trial labels)
// - the slot reaching the goal chooser (pure state, unlike the need term):
//   the_slot_term_reaches_the_goal_chooser
// - `buildable` / cost variants / own hand (`cost_term`):
//   the_cost_term_prices_the_first_affordable_variant (variant order under an
//   extra-cost alternative, per-buildable costs, affordability from the hand)
// - the need vector (`cost_term`): the_cost_term_prices_the_first_affordable_variant
//   (synthetic non-uniform need)
// - the decision's selected goal (forwarded into the pressure on build candidates):
//   the_settlement_candidates_pay_the_cost_pressure_for_the_selected_goal
// - `params.cost_pressure_weight`: the same test (1.5),
//   the_road_candidate_pays_the_cost_pressure (0.0 vs 1.5 two-run diff), and the label
//   test in `policy::mod`
// - chooser independence (the pressure never reaches goal selection):
//   the_goal_chooser_never_pays_the_cost_pressure

#[test]
fn the_slot_return_matches_the_closed_form() {
    let (topology, board, _rules, mut arena) = fixture();
    {
        let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
        assert_eq!(view.piece_limit(Buildable::Settlement), 5);
        // Full supply: nothing has been placed, so the return is worthless however open
        // the board is.
        assert_eq!(SlotReturn::derive(&view).value, 0.0);
    }
    arena.state.players[0].pieces[Buildable::Settlement.index()] = 1;
    {
        let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
        // Four of five placed, and an empty board holds far more than five open sites, so
        // the site fraction caps at one.
        assert_eq!(SlotReturn::derive(&view).value, 1.0 - 1.0 / 5.0);
    }
    arena.state.players[0].pieces[Buildable::Settlement.index()] = 0;
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    assert_eq!(SlotReturn::derive(&view).value, 1.0);
}

#[test]
fn the_slot_return_scales_with_open_sites() {
    let (topology, board, _rules, mut arena) = fixture();
    arena.state.players[0].pieces[Buildable::Settlement.index()] = 0;
    for vertex in 0..topology.vertex_count() {
        arena.state.vertex_owner[vertex] = 1;
    }
    {
        let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
        // Saturated board: proximity is 1 but there is nowhere to spend the freed piece.
        assert_eq!(SlotReturn::derive(&view).value, 0.0);
    }
    // Clearing one vertex and its neighbors opens exactly that vertex: each cleared
    // neighbor still touches an owned vertex, so only the center passes the distance rule.
    let center = 0_u8;
    arena.state.vertex_owner[usize::from(center)] = u8::MAX;
    for adjacent in topology.vertex_adjacent(center) {
        arena.state.vertex_owner[usize::from(*adjacent)] = u8::MAX;
    }
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    assert_eq!(SlotReturn::derive(&view).value, 1.0 / 5.0);
}

/// The city-term fixture: the observer owns one productive tier-1 vertex, holds exactly the
/// city cost, and has one settlement piece left (slot return 0.8 on the open board).
fn city_fixture(weight: f32) -> (Topology, SimBoard, GameArena, HeuristicParams, u8) {
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
    arena.state.players[0].pieces[Buildable::Settlement.index()] = 1;
    arena.state.players[0].resources = [0, 0, 2, 0, 3];
    let params = HeuristicParams {
        slot_return_weight: weight,
        ..HeuristicParams::default()
    };
    (topology, board, arena, params, owned)
}

#[test]
fn the_city_candidates_add_the_weighted_slot_term() {
    let (topology, board, arena, params, owned) = city_fixture(3.0);
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let slot = SlotReturn::derive(&view);
    assert_eq!(slot.value, 0.8);
    let mut scratch = PolicyScratch::default();
    let mut rng = Xoshiro256StarStar::from_seed(7);
    heuristic_v1::action(&view, &mut scratch, &params, &mut rng);
    let mut cities = 0;
    for candidate in scratch.actions.as_slice() {
        let Action::UpgradeCity(vertex) = candidate.action else {
            continue;
        };
        cities += 1;
        assert_eq!(vertex, owned);
        let expected = BUILD_BAND
            + (heuristic_v1::vertex_score(&view, vertex, &params, BuildKind::City)
                + params.slot_return_weight * slot.value);
        assert_eq!(candidate.score.to_bits(), expected.to_bits());
    }
    assert_eq!(cities, 1);
}

#[test]
fn a_zero_slot_weight_restores_the_pre_term_scores_bit_for_bit() {
    let (topology, board, arena, params, owned) = city_fixture(0.0);
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    assert!(
        SlotReturn::derive(&view).value > 0.0,
        "the fixture must be one where a non-zero weight would move the score"
    );
    let mut scratch = PolicyScratch::default();
    let mut rng = Xoshiro256StarStar::from_seed(7);
    heuristic_v1::action(&view, &mut scratch, &params, &mut rng);
    let city = scratch
        .actions
        .as_slice()
        .iter()
        .find_map(|candidate| match candidate.action {
            Action::UpgradeCity(vertex) => Some((vertex, candidate.score)),
            _ => None,
        })
        .expect("the city upgrade must be a candidate");
    let expected =
        BUILD_BAND + heuristic_v1::vertex_score(&view, city.0, &params, BuildKind::City);
    assert_eq!(city.0, owned);
    assert_eq!(city.1.to_bits(), expected.to_bits());
}

#[test]
fn the_slot_term_reaches_the_goal_chooser() {
    // A weak owned vertex (city goal) against strong detached settlement targets: at zero
    // weight the settlement goal wins on vertex value; a large slot weight lifts the city
    // term past it. Both goals are affordable, so turns cannot separate them.
    let (topology, board, _rules, mut arena) = fixture();
    let placement = (0..topology.vertex_count() as u8)
        .filter(|vertex| {
            let total: u16 = local_production(&board, &topology, *vertex).iter().sum();
            (1..=4).contains(&total)
        })
        .find_map(|owned| {
            (0..topology.edge_count() as u8).find_map(|edge| {
                let [first, second] = topology.edge_endpoints(edge);
                let strong = |vertex: u8| {
                    vertex != owned
                        && !topology.vertex_adjacent(vertex).contains(&owned)
                        && local_production(&board, &topology, vertex)
                            .iter()
                            .sum::<u16>()
                            > local_production(&board, &topology, owned)
                                .iter()
                                .sum::<u16>()
                                + 5
                };
                (strong(first) && strong(second)).then_some((owned, edge))
            })
        });
    let (owned, edge) = placement.expect("fixture board offers a qualifying placement");
    arena.state.vertex_owner[usize::from(owned)] = 0;
    arena.state.vertex_tier[usize::from(owned)] = 1;
    arena.state.edge_owner[usize::from(edge)] = 0;
    arena.state.players[0].pieces[Buildable::Settlement.index()] = 1;
    // Both the settlement and the city are affordable, flooring both goals' horizons.
    arena.state.players[0].resources = [1, 1, 3, 1, 3];
    let goal_for = |weight: f32| {
        let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
        let params = HeuristicParams {
            slot_return_weight: weight,
            ..HeuristicParams::default()
        };
        let mut scratch = PolicyScratch::default();
        let mut rng = Xoshiro256StarStar::from_seed(7);
        heuristic_v1::action(&view, &mut scratch, &params, &mut rng);
        scratch.goal
    };
    assert_eq!(
        goal_for(0.0),
        Some(Buildable::Settlement),
        "the baseline chooser must prefer the strong settlement targets"
    );
    assert_eq!(goal_for(1.0e6), Some(Buildable::City));
}

#[test]
fn the_cost_term_prices_the_first_affordable_variant() {
    let (topology, board, rules, _arena) = fixture();
    let mut config = GameConfig::default();
    config.modifiers[0]
        .extra_cost_alternatives
        .push((Buildable::City, [2, 0, 0, 0, 0]));
    let mut arena = GameArena::default();
    arena.prepare(&board, &topology, &rules, &config);
    let need = GoalNeed {
        need: [0.5, 1.0, 2.0, 0.0, 0.25],
    };
    // Only the two-wood alternative is payable: 2 * 0.5.
    arena.state.players[0].resources = [2, 0, 0, 0, 0];
    {
        let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
        assert_eq!(need.cost_term(&view, Buildable::City), 1.0);
        // The road cost [1, 0, 0, 1, 0] is payable from wood alone? It is not (no brick),
        // so an unpayable buildable prices at zero.
        assert_eq!(need.cost_term(&view, Buildable::Road), 0.0);
    }
    // Both variants payable: the first (base [0, 0, 2, 0, 3]) wins, mirroring `pay_cost`:
    // 2 * 2.0 + 3 * 0.25.
    arena.state.players[0].resources = [2, 0, 2, 0, 3];
    {
        let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
        assert_eq!(need.cost_term(&view, Buildable::City), 4.75);
    }
    // Road payable: 1 * 0.5 + 1 * 0.0.
    arena.state.players[0].resources = [1, 0, 0, 1, 0];
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    assert_eq!(need.cost_term(&view, Buildable::Road), 0.5);
}

/// The cost-pressure fixture, adapted from the J1 selected-goal fixture: the observer holds
/// exactly the settlement cost, owns an upgradeable settlement with no wheat production
/// (the city goal keeps a full card of wheat need) and one detached road whose endpoints
/// are legal settlement sites adding a new resource, and has no road pieces. A hugely
/// negative `diversity_bonus` sinks every settlement goal below the city goal, so the
/// selected goal is an unaffordable city while settlement builds are affordable — the state
/// where paying for a settlement spends the wheat the city still needs.
fn pressure_fixture(weight: f32) -> (Topology, SimBoard, GameArena, HeuristicParams, u8, u8) {
    let (topology, board, _rules, mut arena) = fixture();
    let wheat = 2;
    let placement = (0..topology.vertex_count() as u8)
        .filter(|vertex| {
            let production = local_production(&board, &topology, *vertex);
            production.iter().sum::<u16>() > 0 && production[wheat] == 0
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
                    && new_resource(second))
                .then_some((owned, edge))
            })
        });
    let (owned, edge) = placement.expect("fixture board offers a qualifying placement");
    arena.state.vertex_owner[usize::from(owned)] = 0;
    arena.state.vertex_tier[usize::from(owned)] = 1;
    arena.state.edge_owner[usize::from(edge)] = 0;
    arena.state.players[0].pieces[Buildable::Road.index()] = 0;
    arena.state.players[0].resources = [1, 1, 1, 1, 0];
    let params = HeuristicParams {
        diversity_bonus: -10_000.0,
        cost_pressure_weight: weight,
        ..HeuristicParams::default()
    };
    let [first, second] = topology.edge_endpoints(edge);
    (topology, board, arena, params, first, second)
}

#[test]
fn the_settlement_candidates_pay_the_cost_pressure_for_the_selected_goal() {
    let (topology, board, arena, params, first, second) = pressure_fixture(1.5);
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let mut scratch = PolicyScratch::default();
    let mut rng = Xoshiro256StarStar::from_seed(7);
    heuristic_v1::action(&view, &mut scratch, &params, &mut rng);
    assert_eq!(scratch.goal, Some(Buildable::City));
    let need = GoalNeed::derive(&view, Buildable::City);
    let pressure = need.cost_term(&view, Buildable::Settlement);
    // One wheat in hand against the city's two: paying the settlement's wheat card costs
    // the goal a full card of need (no wheat production on the owned vertex).
    assert_eq!(pressure, 1.0);
    let mut settlements = 0;
    for candidate in scratch.actions.as_slice() {
        let Action::BuildSettlement(vertex) = candidate.action else {
            continue;
        };
        settlements += 1;
        assert!(vertex == first || vertex == second);
        let mut expected =
            BUILD_BAND + heuristic_v1::vertex_score(&view, vertex, &params, BuildKind::Settlement);
        expected -= params.cost_pressure_weight * pressure;
        assert_eq!(candidate.score.to_bits(), expected.to_bits());
    }
    assert_eq!(settlements, 2);
}

#[test]
fn a_zero_pressure_weight_restores_the_pre_term_scores_bit_for_bit() {
    let (topology, board, arena, params, _first, _second) = pressure_fixture(0.0);
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let mut scratch = PolicyScratch::default();
    let mut rng = Xoshiro256StarStar::from_seed(7);
    heuristic_v1::action(&view, &mut scratch, &params, &mut rng);
    assert_eq!(scratch.goal, Some(Buildable::City));
    assert!(
        GoalNeed::derive(&view, Buildable::City).cost_term(&view, Buildable::Settlement) > 0.0,
        "the fixture must be one where a non-zero weight would move the score"
    );
    let mut settlements = 0;
    for candidate in scratch.actions.as_slice() {
        let Action::BuildSettlement(vertex) = candidate.action else {
            continue;
        };
        settlements += 1;
        let expected =
            BUILD_BAND + heuristic_v1::vertex_score(&view, vertex, &params, BuildKind::Settlement);
        assert_eq!(candidate.score.to_bits(), expected.to_bits());
    }
    assert_eq!(settlements, 2);
}

#[test]
fn the_goal_chooser_never_pays_the_cost_pressure() {
    // At this weight a leak into goal selection would sink the city goal (its own cost
    // overlaps its own need heavily) far below the road-less alternatives; the pressure
    // applies only to the pushed build candidates, so the city goal and the closed-form
    // scores both hold.
    let (topology, board, arena, params, _first, _second) = pressure_fixture(1.0e9);
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let mut scratch = PolicyScratch::default();
    let mut rng = Xoshiro256StarStar::from_seed(7);
    heuristic_v1::action(&view, &mut scratch, &params, &mut rng);
    assert_eq!(scratch.goal, Some(Buildable::City));
    let need = GoalNeed::derive(&view, Buildable::City);
    let pressure = need.cost_term(&view, Buildable::Settlement);
    for candidate in scratch.actions.as_slice() {
        let Action::BuildSettlement(vertex) = candidate.action else {
            continue;
        };
        let mut expected =
            BUILD_BAND + heuristic_v1::vertex_score(&view, vertex, &params, BuildKind::Settlement);
        expected -= params.cost_pressure_weight * pressure;
        assert_eq!(candidate.score.to_bits(), expected.to_bits());
    }
}

#[test]
fn the_road_candidate_pays_the_cost_pressure() {
    // A city cost alternative of two wood and one brick leaves the goal one wood short of
    // the [1, 0, 0, 1, 0] hand, so building the (affordable) road spends the wood the city
    // still needs — the only base-rules-adjacent shape where a road's cost overlaps a goal,
    // hence the alternative. The owned vertex must produce some wood (a finite city
    // horizon, so the city goal outranks the road goal) but at most six pips (so expected
    // production does not cover the missing card).
    let (topology, board, rules, _arena) = fixture();
    let mut config = GameConfig::default();
    config.modifiers[0]
        .extra_cost_alternatives
        .push((Buildable::City, [2, 0, 0, 1, 0]));
    let wood = 0;
    // An affordable road goal scores at the 0.25-turn floor (0.35 / 0.25 = 1.4), so an
    // unaffordable city outranks it only under enormous production: a one-card wood
    // shortfall must close in ~a turn through bank trades. The observer therefore owns
    // every wood-free productive vertex (keeping the wood income, and with it the
    // outstanding wood need, pinned to the one searched vertex), and the search takes the
    // first wood vertex whose city goal wins.
    let boosters: Vec<u8> = (0..topology.vertex_count() as u8)
        .filter(|vertex| {
            let production = local_production(&board, &topology, *vertex);
            production[wood] == 0 && production.iter().sum::<u16>() > 0
        })
        .collect();
    let mut arena = GameArena::default();
    let chosen = (0..topology.vertex_count() as u8)
        .filter(|vertex| {
            (1..=6).contains(&local_production(&board, &topology, *vertex)[wood])
                && !boosters.contains(vertex)
        })
        .find(|owned| {
            arena.prepare(&board, &topology, &rules, &config);
            for vertex in boosters.iter().chain([owned]) {
                arena.state.vertex_owner[usize::from(*vertex)] = 0;
                arena.state.vertex_tier[usize::from(*vertex)] = 1;
            }
            // A rival's long road keeps Longest Road out of reach, so the road goal stays
            // in its flat 40-band and the city goal can outrank it.
            arena.state.players[1].longest_road_len = 6;
            arena.state.players[0].resources = [1, 0, 0, 1, 0];
            let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
            let mut scratch = PolicyScratch::default();
            let mut rng = Xoshiro256StarStar::from_seed(7);
            heuristic_v1::action(&view, &mut scratch, &HeuristicParams::default(), &mut rng);
            scratch.goal == Some(Buildable::City)
        });
    assert!(
        chosen.is_some(),
        "fixture board offers a wood vertex whose city goal outranks the road goal"
    );
    let road_score = |weight: f32| {
        let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
        let params = HeuristicParams {
            cost_pressure_weight: weight,
            ..HeuristicParams::default()
        };
        let mut scratch = PolicyScratch::default();
        let mut rng = Xoshiro256StarStar::from_seed(7);
        heuristic_v1::action(&view, &mut scratch, &params, &mut rng);
        assert_eq!(scratch.goal, Some(Buildable::City), "weight {weight}");
        scratch
            .actions
            .as_slice()
            .iter()
            .find_map(|candidate| match candidate.action {
                Action::BuildRoad(_) => Some(candidate.score),
                _ => None,
            })
            .expect("the road build must be a candidate")
    };
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let pressure = GoalNeed::derive(&view, Buildable::City).cost_term(&view, Buildable::Road);
    assert!(
        pressure > 0.0,
        "the road cost must overlap the city alternative's need"
    );
    let baseline = road_score(0.0);
    let expected = baseline - 1.5 * pressure;
    assert_eq!(road_score(1.5).to_bits(), expected.to_bits());
}
