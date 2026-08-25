use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;

use unsettled_engine::board::{ConversionOptions, SimBoard};
use unsettled_engine::game::{GameArena, GameConfig};
use unsettled_engine::longest_road::{RoadCard, RoadNetwork};
use unsettled_engine::policy::denial::{self, DenialParams};
use unsettled_engine::policy::devcards::DevCardParams;
use unsettled_engine::policy::heuristic_v1::{self, HeuristicParams};
use unsettled_engine::policy::threat::ThreatParams;
use unsettled_engine::policy::{self, PolicyKind, PolicyScratch};
use unsettled_engine::rng::Xoshiro256StarStar;
use unsettled_engine::rules::{Buildable, Resource, RuleConfig, TradeConfig};
use unsettled_engine::topology::{Edge, Layout, Topology, Vertex};
use unsettled_engine::trade::TradeOffer;
use unsettled_engine::view::{Action, DecisionPhase, DevPlay, ScoredAction, pips};
use unsettled_engine::wire::WireBoard;

fn fixture() -> (Topology, SimBoard, RuleConfig, GameConfig, GameArena) {
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
    let config = GameConfig::default();
    let mut arena = GameArena::default();
    arena.prepare(&board, &topology, &rules, &config);
    (topology, board, rules, config, arena)
}

fn equal_brick_pair(board: &SimBoard, topology: &Topology) -> (u8, u8) {
    for low in 0..topology.hex_count() {
        for high in low + 1..topology.hex_count() {
            let low = low as u8;
            let high = high as u8;
            if board.tiles()[usize::from(low)] == Some(Resource::Brick)
                && board.tiles()[usize::from(high)] == Some(Resource::Brick)
                && board.tokens()[usize::from(low)].map(pips)
                    == board.tokens()[usize::from(high)].map(pips)
                && !topology
                    .hex_vertices(low)
                    .iter()
                    .any(|vertex| topology.hex_vertices(high).contains(vertex))
            {
                return (low, high);
            }
        }
    }
    panic!("fixture needs two separated equal-pip brick hexes");
}

fn simple_path(
    topology: &Topology,
    edge_count: usize,
    excluded: &HashSet<Edge>,
) -> (Vec<Vertex>, Vec<Edge>) {
    fn visit(
        topology: &Topology,
        edge_count: usize,
        excluded: &HashSet<Edge>,
        vertices: &mut Vec<Vertex>,
        edges: &mut Vec<Edge>,
    ) -> bool {
        if edges.len() == edge_count {
            return true;
        }
        let current = *vertices.last().unwrap();
        for edge in topology.vertex_edges(current) {
            if excluded.contains(edge) || edges.contains(edge) {
                continue;
            }
            let [left, right] = topology.edge_endpoints(*edge);
            let next = if left == current { right } else { left };
            if vertices.contains(&next) {
                continue;
            }
            edges.push(*edge);
            vertices.push(next);
            if visit(topology, edge_count, excluded, vertices, edges) {
                return true;
            }
            vertices.pop();
            edges.pop();
        }
        false
    }

    for start in 0..topology.vertex_count() {
        let mut vertices = vec![start as Vertex];
        let mut edges = Vec::new();
        if visit(topology, edge_count, excluded, &mut vertices, &mut edges) {
            return (vertices, edges);
        }
    }
    panic!("topology has no simple path of length {edge_count}");
}

fn give_path(arena: &mut GameArena, seat: usize, edges: &[Edge]) {
    for edge in edges {
        assert_eq!(arena.state.edge_owner[usize::from(*edge)], u8::MAX);
        arena.state.edge_owner[usize::from(*edge)] = seat as u8;
        arena.state.players[seat].pieces[Buildable::Road.index()] -= 1;
    }
}

fn bridged_holder_fixture() -> (Topology, SimBoard, RuleConfig, GameConfig, GameArena) {
    fn path_from(
        topology: &Topology,
        current: Vertex,
        remaining: usize,
        excluded_edges: &HashSet<Edge>,
        excluded_vertices: &HashSet<Vertex>,
        vertices: &mut Vec<Vertex>,
        edges: &mut Vec<Edge>,
    ) -> bool {
        if remaining == 0 {
            return true;
        }
        for edge in topology.vertex_edges(current) {
            if excluded_edges.contains(edge) || edges.contains(edge) {
                continue;
            }
            let [left, right] = topology.edge_endpoints(*edge);
            let next = if left == current { right } else { left };
            if excluded_vertices.contains(&next) || vertices.contains(&next) {
                continue;
            }
            vertices.push(next);
            edges.push(*edge);
            if path_from(
                topology,
                next,
                remaining - 1,
                excluded_edges,
                excluded_vertices,
                vertices,
                edges,
            ) {
                return true;
            }
            edges.pop();
            vertices.pop();
        }
        false
    }

    let (topology, board, rules, config, mut arena) = fixture();
    for bridge in 0..topology.edge_count() {
        let bridge = bridge as Edge;
        let [left, right] = topology.edge_endpoints(bridge);
        let excluded_edges = HashSet::from([bridge]);
        let mut left_vertices = vec![left];
        let mut left_edges = Vec::new();
        if !path_from(
            &topology,
            left,
            5,
            &excluded_edges,
            &HashSet::from([right]),
            &mut left_vertices,
            &mut left_edges,
        ) {
            continue;
        }
        let mut right_vertices = vec![right];
        let mut right_edges = Vec::new();
        let excluded_vertices = left_vertices.iter().copied().collect::<HashSet<_>>();
        let mut right_excluded_edges = excluded_edges.clone();
        right_excluded_edges.extend(left_edges.iter().copied());
        if !path_from(
            &topology,
            right,
            5,
            &right_excluded_edges,
            &excluded_vertices,
            &mut right_vertices,
            &mut right_edges,
        ) {
            continue;
        }
        give_path(&mut arena, 0, &left_edges);
        give_path(&mut arena, 0, &right_edges);
        let mut excluded = left_edges
            .iter()
            .chain(&right_edges)
            .copied()
            .collect::<HashSet<_>>();
        excluded.insert(bridge);
        let (_, challenger) = simple_path(&topology, 5, &excluded);
        give_path(&mut arena, 1, &challenger);
        arena.recompute_roads_for_test(&topology, &rules, board.seats());
        arena.state.longest_road = RoadCard {
            holder: Some(0),
            retired: false,
        };
        arena.state.players[0].resources = [1, 0, 0, 1, 0];
        return (topology, board, rules, config, arena);
    }
    panic!("fixture needs two five-edge components joined by one legal bridge");
}

fn road_city_fixture(holder_near: bool, own_vp: u8) -> (Topology, SimBoard, GameArena) {
    let (topology, board, _rules, _config, mut arena) = fixture();
    let (vertices, path) = simple_path(&topology, 6, &HashSet::new());
    arena.state.vertex_owner[usize::from(vertices[0])] = 0;
    arena.state.vertex_tier[usize::from(vertices[0])] = 1;
    give_path(&mut arena, 0, &path[..5]);
    arena.state.players[0].vp_public = own_vp;
    arena.state.players[0].longest_road_len = 5;
    arena.state.players[0].resources = [1, 0, 2, 1, 3];
    arena.state.longest_road = RoadCard {
        holder: Some(1),
        retired: false,
    };
    arena.state.players[1].longest_road_len = 5;
    if holder_near {
        for vertex in (0..topology.vertex_count())
            .map(|candidate| candidate as Vertex)
            .filter(|candidate| !vertices.contains(candidate))
            .take(4)
        {
            arena.state.vertex_owner[usize::from(vertex)] = 1;
            arena.state.vertex_tier[usize::from(vertex)] = 1;
            arena.state.players[1].pieces[Buildable::Settlement.index()] -= 1;
        }
        arena.state.players[1].vp_public = 9;
        for resource in Resource::ALL {
            arena.state.players[1].resources[resource.index()] = 5;
            arena.state.belief.gain(1, resource.index(), 5);
        }
    }
    (topology, board, arena)
}

fn action_with_params(
    topology: &Topology,
    board: &SimBoard,
    arena: &GameArena,
    params: &HeuristicParams,
) -> Action {
    let view = arena.decision_view(board, topology, 0, DecisionPhase::Action);
    let mut scratch = PolicyScratch::default();
    let mut rng = Xoshiro256StarStar::from_seed(17);
    heuristic_v1::action(&view, &mut scratch, params, &mut rng)
}

fn longest_road_challenger_fixture(
    holder: usize,
    challenger: usize,
) -> (Topology, SimBoard, RuleConfig, GameConfig, GameArena) {
    let (topology, board, rules, config, mut arena) = fixture();
    let mut excluded = HashSet::new();
    let (_, holder_roads) = simple_path(&topology, 5, &excluded);
    excluded.extend(holder_roads.iter().copied());
    let (_, challenger_roads) = simple_path(&topology, 5, &excluded);
    give_path(&mut arena, holder, &holder_roads);
    give_path(&mut arena, challenger, &challenger_roads);
    arena.recompute_roads_for_test(&topology, &rules, board.seats());
    arena.state.longest_road = RoadCard {
        holder: Some(holder),
        retired: false,
    };
    arena.state.players[challenger].vp_public = 9;
    (topology, board, rules, config, arena)
}

fn contest_fixture() -> (Topology, SimBoard, GameArena, Edge, Edge) {
    let (topology, board, _rules, _config, mut arena) = fixture();
    for target in 0..topology.vertex_count() {
        let target = target as Vertex;
        let incident = topology.vertex_edges(target);
        if incident.len() < 2 {
            continue;
        }
        for observer_edge in incident {
            let observer_source = topology
                .edge_endpoints(*observer_edge)
                .into_iter()
                .find(|vertex| *vertex != target)
                .unwrap();
            let Some(observer_base) = topology
                .vertex_edges(observer_source)
                .iter()
                .copied()
                .find(|edge| *edge != *observer_edge && !incident.contains(edge))
            else {
                continue;
            };
            for opponent_edge in incident {
                if opponent_edge == observer_edge {
                    continue;
                }
                let opponent_source = topology
                    .edge_endpoints(*opponent_edge)
                    .into_iter()
                    .find(|vertex| *vertex != target)
                    .unwrap();
                let Some(opponent_base) = topology
                    .vertex_edges(opponent_source)
                    .iter()
                    .copied()
                    .find(|edge| *edge != *opponent_edge && !incident.contains(edge))
                else {
                    continue;
                };
                if observer_base == opponent_base {
                    continue;
                }
                arena.state.edge_owner[usize::from(observer_base)] = 0;
                arena.state.edge_owner[usize::from(opponent_base)] = 1;
                arena.state.players[1].vp_public = 9;
                let observer_edge = *observer_edge;
                let opponent_edge = *opponent_edge;
                return (topology, board, arena, observer_edge, opponent_edge);
            }
        }
    }
    panic!("fixture needs two independent approaches to one vertex");
}

fn score_for(actions: &[ScoredAction], predicate: impl Fn(Action) -> bool) -> f32 {
    actions
        .iter()
        .find(|candidate| predicate(candidate.action))
        .map(|candidate| candidate.score)
        .unwrap()
}

fn expansion_score(
    view: &unsettled_engine::view::DecisionView<'_>,
    first: Edge,
    params: &HeuristicParams,
) -> Option<f32> {
    let mut best = None;
    for target in view.topology().edge_endpoints(first) {
        if view.is_expansion_target(target) {
            let score = heuristic_v1::vertex_score(
                view,
                target,
                params,
                heuristic_v1::BuildKind::Settlement,
            ) + 0.25;
            if best.is_none_or(|current| score > current) {
                best = Some(score);
            }
        }
    }
    for second in view.topology().edge_neighbors(first) {
        if !view.legal_road_after(first, *second) {
            continue;
        }
        for target in view.topology().edge_endpoints(*second) {
            if view.is_expansion_target(target) {
                let score = heuristic_v1::vertex_score(
                    view,
                    target,
                    params,
                    heuristic_v1::BuildKind::Settlement,
                );
                if best.is_none_or(|current| score > current) {
                    best = Some(score);
                }
            }
        }
    }
    best
}

fn pair_from_play(play: Option<DevPlay>) -> Option<(Edge, Edge)> {
    match play {
        Some(DevPlay::RoadBuilding { first, second }) => Some((first?, second?)),
        _ => None,
    }
}

fn expected_contest_pair(
    view: &unsettled_engine::view::DecisionView<'_>,
    params: &HeuristicParams,
    context: &denial::DenialContext,
    score_params: &DenialParams,
) -> Option<((Edge, Edge), f32)> {
    let mut best = None;
    let mut best_score = f32::NEG_INFINITY;
    for first in 0..view.topology().edge_count() {
        let first = first as Edge;
        if !view.legal_road(first) {
            continue;
        }
        for second in view.topology().edge_neighbors(first) {
            if !view.legal_road_after(first, *second) {
                continue;
            }
            let expansion = view
                .topology()
                .edge_endpoints(*second)
                .iter()
                .map(|vertex| {
                    heuristic_v1::vertex_score(
                        view,
                        *vertex,
                        params,
                        heuristic_v1::BuildKind::Settlement,
                    )
                })
                .fold(f32::NEG_INFINITY, f32::max);
            let contest = denial::contest_term(view, context, score_params, first)
                .max(denial::contest_term(view, context, score_params, *second));
            let score = expansion + contest;
            if score > best_score {
                best = Some(((first, *second), score));
                best_score = score;
            }
        }
    }
    best
}

fn expected_monopoly_for_goal(
    view: &unsettled_engine::view::DecisionView<'_>,
    goal: Buildable,
) -> Option<Resource> {
    let cost = view.costs(goal).first()?;
    Resource::ALL
        .into_iter()
        .filter(|resource| view.own_hand()[resource.index()] < i16::from(cost[resource.index()]))
        .max_by_key(|resource| {
            (0..view.seats())
                .filter(|seat| *seat != view.observer())
                .map(|seat| {
                    let production = view.production_pips(seat);
                    let total: u16 = production.iter().sum();
                    if total == 0 {
                        0
                    } else {
                        u32::from(view.hand_size(seat)) * u32::from(production[resource.index()])
                            / u32::from(total)
                    }
                })
                .sum::<u32>()
        })
        .filter(|resource| {
            (0..view.seats())
                .filter(|seat| *seat != view.observer())
                .map(|seat| {
                    let production = view.production_pips(seat);
                    let total: u16 = production.iter().sum();
                    if total == 0 {
                        0
                    } else {
                        u32::from(view.hand_size(seat)) * u32::from(production[resource.index()])
                            / u32::from(total)
                    }
                })
                .sum::<u32>()
                > 0
        })
}

#[test]
fn denial_pressure_falls_below_the_building_band_when_no_opponent_is_close() {
    let (topology, board, arena) = road_city_fixture(false, 5);
    assert!(matches!(
        action_with_params(&topology, &board, &arena, &HeuristicParams::default()),
        Action::BuildRoad(_)
    ));
    let params = HeuristicParams {
        denial: Some(DenialParams::default()),
        ..HeuristicParams::default()
    };
    assert!(matches!(
        action_with_params(&topology, &board, &arena, &params),
        Action::UpgradeCity(_)
    ));
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    for kind in [
        PolicyKind::HeuristicV1Denial,
        PolicyKind::HeuristicV1TraderDenial,
    ] {
        let mut scratch = PolicyScratch::default();
        let mut rng = Xoshiro256StarStar::from_seed(17);
        assert!(matches!(
            policy::action(kind, &view, &mut scratch, &mut rng),
            Action::UpgradeCity(_)
        ));
    }
}

#[test]
fn denial_pressure_beats_the_building_band_when_the_holder_is_close() {
    let (topology, board, arena) = road_city_fixture(true, 5);
    let params = HeuristicParams {
        denial: Some(DenialParams::default()),
        ..HeuristicParams::default()
    };
    assert!(matches!(
        action_with_params(&topology, &board, &arena, &params),
        Action::BuildRoad(_)
    ));
}

#[test]
fn the_win_now_short_circuit_is_not_modulated_by_pressure() {
    let (topology, board, arena) = road_city_fixture(false, 8);
    let params = HeuristicParams {
        denial: Some(DenialParams {
            pressure_floor: 0.0,
            pressure_span: 0.0,
            ..DenialParams::default()
        }),
        ..HeuristicParams::default()
    };
    assert!(matches!(
        action_with_params(&topology, &board, &arena, &params),
        Action::BuildRoad(_)
    ));
}

#[test]
fn the_holder_defends_longest_road_when_a_challenger_is_one_road_away() {
    let (topology, board, _rules, _config, arena) = bridged_holder_fixture();
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let params = DenialParams {
        race_danger_min: 0.0,
        defend_weight: 1_000_000.0,
        ..DenialParams::default()
    };
    let context = denial::context(&view, &params);
    assert!(denial::should_defend(&context).is_some());
    assert!(
        denial::defend_term(
            &view,
            &context,
            &params,
            view.longest_road_len(0).saturating_add(1),
        )
        .is_some()
    );
    let heuristic_params = HeuristicParams {
        denial: Some(params),
        ..HeuristicParams::default()
    };
    let mut scratch = PolicyScratch::default();
    let mut rng = Xoshiro256StarStar::from_seed(17);
    assert!(matches!(
        heuristic_v1::action(&view, &mut scratch, &heuristic_params, &mut rng),
        Action::BuildRoad(_)
    ));
    let road_score = score_for(scratch.actions.as_slice(), |action| {
        matches!(action, Action::BuildRoad(_))
    });
    assert!(
        road_score > 100_000.0,
        "the production road score must contain the defensive term"
    );
}

#[test]
fn the_holder_does_not_defend_longest_road_without_a_challenger() {
    let (topology, board, _rules, _config, mut arena) = longest_road_challenger_fixture(0, 1);
    arena.state.players[1].pieces[Buildable::Road.index()] = 0;
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let params = DenialParams {
        race_danger_min: 0.0,
        ..DenialParams::default()
    };
    let context = denial::context(&view, &params);
    assert_eq!(denial::should_defend(&context), None);
    arena.state.players[0].resources = [1, 0, 0, 1, 0];
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let actions = heuristic_v1::recommend(
        &view,
        &HeuristicParams {
            denial: Some(DenialParams {
                defend_weight: 1_000_000.0,
                ..params
            }),
            ..HeuristicParams::default()
        },
    );
    if let Some(road) = actions
        .iter()
        .find(|candidate| matches!(candidate.action, Action::BuildRoad(_)))
    {
        assert!(road.score < 100_000.0);
    }
}

#[test]
fn a_contested_vertex_raises_the_score_of_the_road_that_claims_it() {
    let (topology, board, arena, candidate, opponent_edge) = contest_fixture();
    let target = topology
        .edge_endpoints(candidate)
        .into_iter()
        .find(|vertex| topology.edge_endpoints(opponent_edge).contains(vertex))
        .unwrap();
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    assert_ne!(
        view.compute_one_step(1) & (1 << target),
        0,
        "the rival reaches the shared target through one new legal road"
    );

    let (topology, board, _rules, _config, mut arena) = fixture();
    let initial = arena.state.clone();
    let params = HeuristicParams {
        denial: Some(DenialParams {
            danger_floor: 500.0,
            contest_weight: 1_000.0,
            contest_cap: 500.0,
            ..DenialParams::default()
        }),
        ..HeuristicParams::default()
    };
    let denial_params = params.denial.as_ref().unwrap();
    let mut found = None;
    'fixtures: for observer_base in 0..topology.edge_count() {
        for opponent_base in 0..topology.edge_count() {
            if observer_base == opponent_base {
                continue;
            }
            arena.state = initial.clone();
            arena.state.edge_owner[observer_base] = 0;
            arena.state.edge_owner[opponent_base] = 1;
            arena.state.players[0].pieces[Buildable::Road.index()] -= 1;
            arena.state.players[1].pieces[Buildable::Road.index()] -= 1;
            arena.state.players[0].resources = [1, 0, 0, 1, 0];
            arena.state.players[1].vp_public = 9;
            for seat in 2..board.seats() {
                arena.state.players[seat].pieces[Buildable::Settlement.index()] = 0;
            }
            let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
            let road = |actions: Vec<ScoredAction>| {
                actions
                    .into_iter()
                    .find_map(|candidate| match candidate.action {
                        Action::BuildRoad(edge) => Some((edge, candidate.score)),
                        _ => None,
                    })
            };
            let Some(off) = road(heuristic_v1::recommend(&view, &HeuristicParams::default()))
            else {
                continue;
            };
            let Some(on) = road(heuristic_v1::recommend(&view, &params)) else {
                continue;
            };
            let context = denial::context(&view, denial_params);
            let on_contest = denial::contest_term(&view, &context, denial_params, on.0);
            let off_contest = denial::contest_term(&view, &context, denial_params, off.0);
            if on.0 != off.0 && on_contest > off_contest {
                let expected =
                    40.0 + expansion_score(&view, on.0, &params).unwrap_or_default() + on_contest;
                assert_eq!(on.1.to_bits(), expected.to_bits());
                let mut scratch = PolicyScratch::default();
                let mut rng = Xoshiro256StarStar::from_seed(17);
                assert_eq!(
                    heuristic_v1::action(&view, &mut scratch, &params, &mut rng),
                    Action::BuildRoad(on.0)
                );
                assert_eq!(
                    score_for(scratch.actions.as_slice(), |action| {
                        action == Action::BuildRoad(on.0)
                    })
                    .to_bits(),
                    expected.to_bits()
                );
                found = Some((off, on));
                break 'fixtures;
            }
        }
    }
    assert!(
        found.is_some(),
        "no road action was re-aimed toward a more contested vertex"
    );
}

#[test]
fn the_contest_term_is_bounded_by_contest_cap() {
    let (topology, board, arena, candidate, _) = contest_fixture();
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let params = DenialParams {
        contest_weight: 1_000_000.0,
        contest_cap: 7.25,
        ..DenialParams::default()
    };
    let context = denial::context(&view, &params);
    assert!(denial::contest_term(&view, &context, &params, candidate) <= params.contest_cap);
}

#[test]
fn the_largest_army_holder_defends_against_a_closing_challenger() {
    let (topology, board, _rules, _config, mut arena) = fixture();
    arena.state.largest_army = Some(0);
    arena.state.players[0].knights_played = 3;
    arena.state.players[1].knights_played = 2;
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let params = DenialParams {
        army_defend_weight: 137.0,
        ..DenialParams::default()
    };
    let context = denial::context(&view, &params);
    let term = denial::army_defend_term(&context, &params).unwrap();
    assert!(term > 0.0);
    arena.state.players[0].resources = [0, 1, 1, 0, 1];
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let off = score_for(
        &heuristic_v1::recommend(&view, &HeuristicParams::default()),
        |action| action == Action::BuyDev,
    );
    let on = score_for(
        &heuristic_v1::recommend(
            &view,
            &HeuristicParams {
                denial: Some(params),
                ..HeuristicParams::default()
            },
        ),
        |action| action == Action::BuyDev,
    );
    assert_eq!(off, 45.0);
    assert_eq!(on.to_bits(), (45.0 + term).to_bits());
}

#[test]
fn road_building_is_aimed_by_the_denial_terms() {
    let (topology, board, _rules, _config, mut arena) = fixture();
    let initial = arena.state.clone();
    let params = HeuristicParams {
        denial: Some(DenialParams {
            danger_floor: 500.0,
            contest_weight: 10_000.0,
            contest_cap: 10_000.0,
            ..DenialParams::default()
        }),
        ..HeuristicParams::default()
    };
    let denial_params = params.denial.as_ref().unwrap();
    let mut found = None;
    'fixtures: for observer_base in 0..topology.edge_count() {
        for opponent_base in 0..topology.edge_count() {
            if observer_base == opponent_base {
                continue;
            }
            arena.state = initial.clone();
            arena.state.edge_owner[observer_base] = 0;
            arena.state.edge_owner[opponent_base] = 1;
            arena.state.players[0].pieces[Buildable::Road.index()] -= 1;
            arena.state.players[1].pieces[Buildable::Road.index()] -= 1;
            arena.state.players[0].playable_dev[2] = 1;
            arena.state.players[1].vp_public = 9;
            for seat in 2..board.seats() {
                arena.state.players[seat].pieces[Buildable::Settlement.index()] = 0;
            }
            let view = arena.decision_view(&board, &topology, 0, DecisionPhase::PreRoll);
            let context = denial::context(&view, denial_params);
            let Some((expected, expected_score)) =
                expected_contest_pair(&view, &params, &context, denial_params)
            else {
                continue;
            };
            let mut on_scratch = PolicyScratch::default();
            let on = heuristic_v1::pre_roll(&view, &mut on_scratch, &params);
            assert_eq!(pair_from_play(on), Some(expected));
            assert!(expected_score.is_finite());

            let devcard_params = HeuristicParams {
                dev_cards: Some(DevCardParams::default()),
                ..params.clone()
            };
            let mut devcard_scratch = PolicyScratch::default();
            assert_eq!(
                pair_from_play(heuristic_v1::pre_roll(
                    &view,
                    &mut devcard_scratch,
                    &devcard_params,
                )),
                Some(expected)
            );
            found = Some(expected);
            break 'fixtures;
        }
    }
    assert!(
        found.is_some(),
        "no Road Building pair was re-aimed toward a more contested vertex"
    );

    let (topology, board, _rules, _config, mut arena) = bridged_holder_fixture();
    arena.state.players[0].playable_dev[2] = 1;
    let denial_params = DenialParams {
        race_danger_min: 0.0,
        defend_weight: 1_000_000.0,
        contest_weight: 0.0,
        ..DenialParams::default()
    };
    let params = HeuristicParams {
        denial: Some(denial_params),
        ..HeuristicParams::default()
    };
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::PreRoll);
    let context = denial::context(&view, &denial_params);
    let current = view.longest_road_len(0);
    let cap = current.saturating_add(denial_params.defend_probe_slack);
    let mut network = view.road_network();
    let mut expected = None;
    let mut expected_score = f32::NEG_INFINITY;
    for first in 0..topology.edge_count() {
        let first = first as Edge;
        if !view.legal_road(first) {
            continue;
        }
        for second in topology.edge_neighbors(first) {
            if !view.legal_road_after(first, *second) {
                continue;
            }
            let expansion = topology
                .edge_endpoints(*second)
                .iter()
                .map(|vertex| {
                    heuristic_v1::vertex_score(
                        &view,
                        *vertex,
                        &params,
                        heuristic_v1::BuildKind::Settlement,
                    )
                })
                .fold(f32::NEG_INFINITY, f32::max);
            let length = view.road_length_on(&mut network, first, Some(*second), cap);
            let road_bonus = denial::defend_term(&view, &context, &denial_params, length)
                .map_or(0.0, |(score, _)| score);
            let score = expansion + road_bonus;
            if score > expected_score {
                expected = Some((first, *second));
                expected_score = score;
            }
        }
    }
    assert!(expected_score > 100_000.0);
    let mut scratch = PolicyScratch::default();
    assert_eq!(
        pair_from_play(heuristic_v1::pre_roll(&view, &mut scratch, &params)),
        expected
    );
}

#[test]
fn denial_danger_defaults_agree_with_threat_and_trading() {
    assert_eq!(
        DenialParams::default().danger_floor,
        unsettled_engine::policy::threat::ThreatParams::default().danger_floor
    );
    assert_eq!(
        DenialParams::default().danger_floor,
        unsettled_engine::policy::trading::TradeParams::default().danger_floor
    );
}

#[test]
fn the_denial_goal_change_reaches_pre_roll_dev_card_targeting() {
    let (topology, board, mut arena) = road_city_fixture(false, 5);
    arena.state.players[0].resources = [0; 5];
    arena.state.players[0].playable_dev[3] = 1;
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::PreRoll);
    let mut off_scratch = PolicyScratch::default();
    let off = heuristic_v1::pre_roll(&view, &mut off_scratch, &HeuristicParams::default());
    let params = HeuristicParams {
        denial: Some(DenialParams {
            pressure_floor: 0.0,
            pressure_span: 0.0,
            ..DenialParams::default()
        }),
        ..HeuristicParams::default()
    };
    let mut on_scratch = PolicyScratch::default();
    let on = heuristic_v1::pre_roll(&view, &mut on_scratch, &params);
    assert_ne!(off, on);
    let mut policy_scratch = PolicyScratch::default();
    let mut policy_rng = Xoshiro256StarStar::from_seed(7);
    let mut direct_policy_scratch = PolicyScratch::default();
    let direct_policy = heuristic_v1::pre_roll(
        &view,
        &mut direct_policy_scratch,
        &HeuristicParams {
            denial: Some(DenialParams::default()),
            ..HeuristicParams::default()
        },
    );
    assert_eq!(
        policy::pre_roll(
            PolicyKind::HeuristicV1Denial,
            &view,
            &mut policy_scratch,
            &mut policy_rng,
        ),
        direct_policy
    );

    let (topology, board, mut arena) = road_city_fixture(false, 5);
    arena.state.players[0].resources = [0; 5];
    arena.state.players[0].playable_dev[4] = 1;
    let initial = arena.state.clone();
    let mut monopoly_observed = false;
    for vertex in 0..topology.vertex_count() {
        arena.state = initial.clone();
        let vertex = vertex as Vertex;
        if arena.state.vertex_owner[usize::from(vertex)] != u8::MAX {
            continue;
        }
        arena.state.vertex_owner[usize::from(vertex)] = 1;
        arena.state.vertex_tier[usize::from(vertex)] = 1;
        arena.state.players[1].pieces[Buildable::Settlement.index()] -= 1;
        for resource in Resource::ALL {
            arena.state.players[1].resources[resource.index()] = 5;
            arena.state.belief.gain(1, resource.index(), 5);
        }
        let view = arena.decision_view(&board, &topology, 0, DecisionPhase::PreRoll);
        let mut scratch = PolicyScratch::default();
        let play = heuristic_v1::pre_roll(&view, &mut scratch, &params);
        let Some(goal) = scratch.goal else {
            continue;
        };
        let expected = expected_monopoly_for_goal(&view, goal);
        let road = expected_monopoly_for_goal(&view, Buildable::Road);
        if expected.is_none() || expected == road {
            continue;
        }
        assert_eq!(
            play,
            expected.map(|resource| DevPlay::Monopoly { resource })
        );
        monopoly_observed = true;
        break;
    }
    assert!(
        monopoly_observed,
        "fixture must distinguish the selected goal from a forced Road goal"
    );

    let (topology, board, mut arena) = road_city_fixture(true, 5);
    arena.state.players[0].resources = [0; 5];
    arena.state.players[0].playable_dev[3] = 1;
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::PreRoll);
    let completion_params = HeuristicParams {
        denial: Some(DenialParams::default()),
        dev_cards: Some(DevCardParams {
            etw_weight: 0.0,
            tempo_weight: 0.0,
            completion_weight: 100.0,
            ..DevCardParams::default()
        }),
        ..HeuristicParams::default()
    };
    let mut completion_scratch = PolicyScratch::default();
    assert!(matches!(
        heuristic_v1::pre_roll(&view, &mut completion_scratch, &completion_params),
        Some(DevPlay::YearOfPlenty { .. })
    ));
    assert_eq!(completion_scratch.goal, Some(Buildable::Road));

    let (topology, board, _rules, _config, mut arena) = fixture();
    let initial = arena.state.clone();
    let mut policy_gate_reached = false;
    'fixtures: for observer_base in 0..topology.edge_count() {
        for opponent_base in 0..topology.edge_count() {
            if observer_base == opponent_base {
                continue;
            }
            arena.state = initial.clone();
            arena.state.edge_owner[observer_base] = 0;
            arena.state.edge_owner[opponent_base] = 1;
            arena.state.players[0].pieces[Buildable::Road.index()] -= 1;
            arena.state.players[1].pieces[Buildable::Road.index()] -= 1;
            arena.state.players[0].playable_dev[2] = 1;
            arena.state.players[1].vp_public = 9;
            for seat in 2..board.seats() {
                arena.state.players[seat].pieces[Buildable::Settlement.index()] = 0;
            }
            let view = arena.decision_view(&board, &topology, 0, DecisionPhase::PreRoll);
            let mut off_scratch = PolicyScratch::default();
            let mut off_rng = Xoshiro256StarStar::from_seed(7);
            let off = policy::pre_roll(
                PolicyKind::HeuristicV1,
                &view,
                &mut off_scratch,
                &mut off_rng,
            );
            let mut on_scratch = PolicyScratch::default();
            let mut on_rng = Xoshiro256StarStar::from_seed(7);
            let on = policy::pre_roll(
                PolicyKind::HeuristicV1Denial,
                &view,
                &mut on_scratch,
                &mut on_rng,
            );
            if off != on {
                policy_gate_reached = true;
                break 'fixtures;
            }
        }
    }
    assert!(
        policy_gate_reached,
        "policy::pre_roll dropped the denial gate"
    );
}

#[test]
fn knight_action_score_is_identical_under_the_denial_gate() {
    let (topology, board, _rules, _config, mut arena) = fixture();
    arena.state.players[0].playable_dev[0] = 1;
    arena.state.players[0].knights_played = 2;
    arena.state.players[0].vp_public = 4;
    let victim_vertex = topology.hex_vertices(
        (0..topology.hex_count())
            .map(|hex| hex as u8)
            .find(|hex| *hex != arena.state.robber)
            .unwrap(),
    )[0];
    arena.state.vertex_owner[usize::from(victim_vertex)] = 1;
    arena.state.vertex_tier[usize::from(victim_vertex)] = 1;
    arena.state.players[1].resources[Resource::Wood.index()] = 1;
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let off = heuristic_v1::recommend(&view, &HeuristicParams::default());
    let params = HeuristicParams {
        denial: Some(DenialParams::default()),
        ..HeuristicParams::default()
    };
    let on = heuristic_v1::recommend(&view, &params);
    let knight = |actions: &[ScoredAction]| {
        score_for(actions, |action| {
            matches!(action, Action::PlayDev(DevPlay::Knight { .. }))
        })
    };
    assert_eq!(knight(&off).to_bits(), knight(&on).to_bits());
    assert_eq!(knight(&off).to_bits(), 12_300.0_f32.to_bits());
}

#[test]
fn threat_denial_policy_forwards_threat_params_to_robber() {
    let (topology, board, _rules, _config, mut arena) = fixture();
    let (leader_hex, dangerous_hex) = equal_brick_pair(&board, &topology);
    for (hex, seat) in [(leader_hex, 1), (dangerous_hex, 2)] {
        let vertex = topology.hex_vertices(hex)[0];
        arena.state.vertex_owner[usize::from(vertex)] = seat;
        arena.state.vertex_tier[usize::from(vertex)] = 1;
    }
    arena.state.players[1].vp_public = 8;
    arena.state.players[1].pieces[Buildable::Settlement.index()] = 0;
    arena.state.players[1].pieces[Buildable::City.index()] = 0;
    arena.state.players[2].vp_public = 7;
    arena.state.players[1].resources = [2, 0, 0, 0, 0];
    arena.state.players[2].resources = [5, 0, 0, 0, 0];
    arena.state.belief.gain(1, Resource::Wood.index(), 2);
    arena.state.belief.gain(2, Resource::Wood.index(), 5);
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let expected = heuristic_v1::robber(
        &view,
        &HeuristicParams {
            threat: Some(ThreatParams::default()),
            denial: Some(DenialParams::default()),
            ..HeuristicParams::default()
        },
    );
    assert_ne!(
        expected,
        heuristic_v1::robber(&view, &HeuristicParams::default())
    );

    let mut rng = Xoshiro256StarStar::from_seed(7);
    assert_eq!(
        policy::robber(PolicyKind::HeuristicV1ThreatDenial, &view, &mut rng),
        expected
    );
}

#[test]
fn the_denial_context_reads_its_own_danger_floor() {
    let (topology, board, arena) = road_city_fixture(false, 5);
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let low = DenialParams {
        danger_floor: 0.1,
        pressure_floor: 0.0,
        pressure_span: 500.0,
        ..DenialParams::default()
    };
    let high = DenialParams {
        danger_floor: 100.0,
        ..low
    };
    let low_context = denial::context(&view, &low);
    let high_context = denial::context(&view, &high);
    assert_ne!(
        denial::pressure(&low_context, &low, view.longest_road_holder()).to_bits(),
        denial::pressure(&high_context, &high, view.longest_road_holder()).to_bits()
    );
    let low_action = action_with_params(
        &topology,
        &board,
        &arena,
        &HeuristicParams {
            denial: Some(low),
            ..HeuristicParams::default()
        },
    );
    let high_action = action_with_params(
        &topology,
        &board,
        &arena,
        &HeuristicParams {
            denial: Some(high),
            ..HeuristicParams::default()
        },
    );
    assert_ne!(low_action, high_action);
}

#[test]
fn a_third_party_racer_raises_pressure_on_taking_the_card() {
    let (topology, board, _rules, _config, mut arena) = longest_road_challenger_fixture(1, 2);
    let params = DenialParams {
        race_danger_min: 0.0,
        ..DenialParams::default()
    };
    let raced = {
        let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
        let context = denial::context(&view, &params);
        assert_eq!(
            context.longest_road_challenger().map(|value| value.0),
            Some(2)
        );
        denial::pressure(&context, &params, view.longest_road_holder())
    };
    arena.state.players[2].pieces[Buildable::Road.index()] = 0;
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let context = denial::context(&view, &params);
    let unraced = denial::pressure(&context, &params, view.longest_road_holder());
    assert!(raced > unraced);
}

#[test]
fn an_occupied_connecting_edge_does_not_make_a_vertex_contested() {
    let (topology, board, mut arena, candidate, opponent_edge) = contest_fixture();
    arena.state.edge_owner[usize::from(opponent_edge)] = 2;
    for seat in 2..board.seats() {
        arena.state.players[seat].pieces[Buildable::Settlement.index()] = 0;
    }
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let params = DenialParams::default();
    let context = denial::context(&view, &params);
    assert_eq!(
        denial::contest_term(&view, &context, &params, candidate),
        0.0
    );
}

#[test]
fn a_seat_with_no_road_pieces_contests_nothing() {
    let (topology, board, mut arena, candidate, _) = contest_fixture();
    arena.state.players[1].pieces[Buildable::Road.index()] = 0;
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let params = DenialParams::default();
    assert_eq!(view.compute_one_step(1), 0);
    let context = denial::context(&view, &params);
    assert_eq!(
        denial::contest_term(&view, &context, &params, candidate),
        0.0
    );
}

#[test]
fn a_seat_with_no_settlement_pieces_contests_nothing() {
    let (topology, board, mut arena, candidate, _) = contest_fixture();
    arena.state.players[1].pieces[Buildable::Settlement.index()] = 0;
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let params = DenialParams::default();
    let context = denial::context(&view, &params);
    assert_eq!(
        denial::contest_term(&view, &context, &params, candidate),
        0.0
    );
}

fn dev_buy_scores(holder_vp: u8) -> (f32, f32) {
    let (topology, board, _rules, _config, mut arena) = fixture();
    arena.state.largest_army = Some(1);
    arena.state.players[1].knights_played = 3;
    arena.state.players[1].vp_public = holder_vp;
    arena.state.players[0].knights_played = 3;
    let vertex = topology.hex_vertices(0)[0];
    arena.state.vertex_owner[usize::from(vertex)] = 1;
    arena.state.vertex_tier[usize::from(vertex)] = 1;
    if holder_vp >= 9 {
        for resource in Resource::ALL {
            arena.state.players[1].resources[resource.index()] = 5;
            arena.state.belief.gain(1, resource.index(), 5);
        }
    }
    arena.state.players[0].resources = [0, 1, 1, 0, 1];
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let params = HeuristicParams {
        denial: Some(DenialParams::default()),
        ..HeuristicParams::default()
    };
    let recommended = score_for(&heuristic_v1::recommend(&view, &params), |action| {
        action == Action::BuyDev
    });
    let mut scratch = PolicyScratch::default();
    let mut rng = Xoshiro256StarStar::from_seed(29);
    heuristic_v1::action(&view, &mut scratch, &params, &mut rng);
    let action_path = score_for(scratch.actions.as_slice(), |action| {
        action == Action::BuyDev
    });
    (recommended, action_path)
}

#[test]
fn dev_buy_contest_bonus_scales_with_opponent_danger() {
    let low = dev_buy_scores(2);
    let high = dev_buy_scores(9);
    assert_eq!(low.0.to_bits(), low.1.to_bits());
    assert_eq!(high.0.to_bits(), high.1.to_bits());
    assert_ne!(low.0.to_bits(), high.0.to_bits());
}

#[test]
fn the_largest_army_challenger_is_chosen_on_the_combined_score() {
    let (topology, board, _rules, _config, mut arena) = fixture();
    arena.state.largest_army = Some(0);
    arena.state.players[0].knights_played = 6;
    arena.state.players[1].knights_played = 2;
    arena.state.players[1].vp_public = 9;
    arena.state.players[2].knights_played = 6;
    arena.state.players[2].vp_public = 2;
    let high_vertex = topology.hex_vertices(0)[0];
    let low_vertex = topology.hex_vertices(1)[3];
    arena.state.vertex_owner[usize::from(high_vertex)] = 1;
    arena.state.vertex_tier[usize::from(high_vertex)] = 1;
    arena.state.vertex_owner[usize::from(low_vertex)] = 2;
    arena.state.vertex_tier[usize::from(low_vertex)] = 1;
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let params = DenialParams::default();
    let context = denial::context(&view, &params);
    let (chosen, _, _) = context.largest_army_challenger().unwrap();
    let contribution = |seat: usize| {
        let gap = view
            .largest_army_min()
            .max(view.knights_played(0).saturating_add(1))
            .saturating_sub(view.knights_played(seat));
        (params.pressure_floor + params.pressure_span * context.danger(seat) as f32)
            * (params.army_gap_half / (params.army_gap_half + f32::from(gap)))
    };
    assert!((1..view.seats()).all(|seat| contribution(chosen) >= contribution(seat)));
    assert!(denial::army_defend_term(&context, &params).is_some());
}

#[test]
fn the_denial_goal_change_reaches_the_action_path_bank_trade_band() {
    let (topology, board, mut arena) = road_city_fixture(false, 5);
    arena.state.players[0].resources = [4, 0, 1, 0, 2];
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let off = heuristic_v1::recommend(&view, &HeuristicParams::default());
    let params = HeuristicParams {
        denial: Some(DenialParams {
            pressure_floor: 0.0,
            pressure_span: 0.0,
            ..DenialParams::default()
        }),
        ..HeuristicParams::default()
    };
    let on = heuristic_v1::recommend(&view, &params);
    let changed_trade = off.iter().any(|left| {
        matches!(left.action, Action::TradeBank { .. })
            && on
                .iter()
                .find(|right| right.action == left.action)
                .is_some_and(|right| right.score.to_bits() != left.score.to_bits())
    });
    assert!(changed_trade);

    let (topology, board, _rules, _config, mut arena) = bridged_holder_fixture();
    arena.state.players[0].pieces[Buildable::Settlement.index()] = 0;
    arena.state.players[0].pieces[Buildable::City.index()] = 0;
    arena.state.players[0].resources = [0, 4, 0, 1, 0];
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let params = HeuristicParams {
        denial: Some(DenialParams {
            race_danger_min: 0.0,
            defend_weight: 1_000_000.0,
            ..DenialParams::default()
        }),
        ..HeuristicParams::default()
    };
    let recommended = heuristic_v1::recommend(&view, &params);
    let expected = recommended
        .iter()
        .find(|candidate| {
            matches!(candidate.action, Action::TradeBank { .. }) && candidate.score > 400.0
        })
        .copied()
        .expect("the gated road goal must emit a completing bank trade");
    let mut scratch = PolicyScratch::default();
    let mut rng = Xoshiro256StarStar::from_seed(31);
    heuristic_v1::action(&view, &mut scratch, &params, &mut rng);
    assert!(scratch.actions.as_slice().iter().any(|candidate| {
        candidate.action == expected.action && candidate.score.to_bits() == expected.score.to_bits()
    }));
}

#[test]
fn defend_probe_slack_sets_the_probe_depth_it_names() {
    let mut network = RoadNetwork::from_edges(&[[0, 1], [2, 3]], &[false; 4]);
    let prospective = [[1, 2], [3, 0]];
    assert_eq!(network.probe(&prospective, u8::MAX), 4);
    assert_eq!(network.probe(&prospective, 3), 4);

    let (topology, board, _rules, _config, arena) = bridged_holder_fixture();
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let two = DenialParams {
        race_danger_min: 0.0,
        defend_probe_slack: 2,
        ..DenialParams::default()
    };
    let three = DenialParams {
        defend_probe_slack: 3,
        ..two
    };
    let two_context = denial::context(&view, &two);
    let three_context = denial::context(&view, &three);
    let current = view.longest_road_len(0);
    let two_score = denial::defend_term(&view, &two_context, &two, current.saturating_add(2))
        .unwrap()
        .0;
    let three_score = denial::defend_term(&view, &three_context, &three, current.saturating_add(3))
        .unwrap()
        .0;
    let closed_form = |params: DenialParams, context: &denial::DenialContext, gain: u8| {
        let danger = denial::should_defend(context).unwrap().1;
        let pressure = (params.pressure_floor + params.pressure_span * danger as f32)
            * (1.0 + params.race_bonus);
        params.defend_weight * pressure * f32::from(gain)
            / (f32::from(gain) + params.defend_headroom_half)
    };
    assert_eq!(
        two_score.to_bits(),
        closed_form(two, &two_context, 2).to_bits()
    );
    assert_eq!(
        three_score.to_bits(),
        closed_form(three, &three_context, 3).to_bits()
    );
    assert_ne!(two_score.to_bits(), three_score.to_bits());

    let action_score = |params| {
        score_for(
            &heuristic_v1::recommend(
                &view,
                &HeuristicParams {
                    denial: Some(params),
                    ..HeuristicParams::default()
                },
            ),
            |action| matches!(action, Action::BuildRoad(_)),
        )
    };
    assert_ne!(
        action_score(two).to_bits(),
        action_score(three).to_bits(),
        "the production action path must observe the non-default slack"
    );
}

#[test]
fn recommend_reflects_the_denial_gate() {
    let (topology, board, arena) = road_city_fixture(false, 5);
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let off = heuristic_v1::recommend(&view, &HeuristicParams::default());
    let params = HeuristicParams {
        denial: Some(DenialParams {
            pressure_floor: 0.0,
            pressure_span: 0.0,
            ..DenialParams::default()
        }),
        ..HeuristicParams::default()
    };
    let on = heuristic_v1::recommend(&view, &params);
    assert_ne!(off, on);
}

#[test]
fn a_denial_trader_responds_to_a_goal_that_only_exists_when_gated() {
    let (topology, board, mut rules, mut config, mut arena) = fixture();
    rules.player_trading = Some(TradeConfig {
        acceptance_temperature: 0.0,
        opponent_gain_weight: 0.0,
        ..TradeConfig::default()
    });
    config.policies = [PolicyKind::HeuristicV1Trader; 6];
    arena.prepare(&board, &topology, &rules, &config);
    let mut excluded = HashSet::new();
    let (_, holder_roads) = simple_path(&topology, 5, &excluded);
    excluded.extend(holder_roads.iter().copied());
    let holder_region = holder_roads
        .iter()
        .flat_map(|edge| topology.edge_endpoints(*edge))
        .flat_map(|vertex| {
            std::iter::once(vertex).chain(topology.vertex_adjacent(vertex).iter().copied())
        })
        .collect::<HashSet<_>>();
    excluded.extend(
        holder_region
            .iter()
            .flat_map(|vertex| topology.vertex_edges(*vertex).iter().copied()),
    );
    let (_, challenger_roads) = simple_path(&topology, 5, &excluded);
    give_path(&mut arena, 0, &holder_roads);
    give_path(&mut arena, 1, &challenger_roads);
    arena.recompute_roads_for_test(&topology, &rules, board.seats());
    arena.state.longest_road = RoadCard {
        holder: Some(0),
        retired: false,
    };
    arena.state.players[1].vp_public = 9;
    let mut challenger_vertices = Vec::new();
    for vertex in challenger_roads
        .iter()
        .flat_map(|edge| topology.edge_endpoints(*edge))
    {
        if !challenger_vertices.contains(&vertex) {
            challenger_vertices.push(vertex);
        }
    }
    for vertex in challenger_vertices.into_iter().take(4) {
        arena.state.vertex_owner[usize::from(vertex)] = 1;
        arena.state.vertex_tier[usize::from(vertex)] = 1;
        arena.state.players[1].pieces[Buildable::Settlement.index()] -= 1;
    }
    for resource in Resource::ALL {
        arena.state.players[1].resources[resource.index()] = 5;
        arena.state.belief.gain(1, resource.index(), 5);
    }
    arena.state.players[0].pieces[Buildable::Road.index()] = 1;
    arena.state.players[0].pieces[Buildable::Settlement.index()] = 0;
    arena.state.players[0].pieces[Buildable::City.index()] = 0;
    loop {
        let view = arena.decision_view(&board, &topology, 0, DecisionPhase::TradeResponse);
        let target = (0..topology.edge_count())
            .map(|edge| edge as Edge)
            .filter(|edge| view.legal_road(*edge))
            .flat_map(|edge| topology.edge_endpoints(edge))
            .find(|vertex| view.is_expansion_target(*vertex));
        let Some(target) = target else {
            break;
        };
        let block = if topology
            .vertex_edges(target)
            .iter()
            .all(|edge| arena.state.edge_owner[usize::from(*edge)] != 0)
        {
            target
        } else {
            topology
                .vertex_adjacent(target)
                .iter()
                .copied()
                .find(|vertex| {
                    arena.state.vertex_owner[usize::from(*vertex)] == u8::MAX
                        && topology
                            .vertex_edges(*vertex)
                            .iter()
                            .all(|edge| arena.state.edge_owner[usize::from(*edge)] != 0)
                })
                .unwrap_or(target)
        };
        arena.state.vertex_owner[usize::from(block)] = 2;
        arena.state.vertex_tier[usize::from(block)] = 1;
    }
    arena.state.players[0].resources = [0, 1, 1, 0, 1];
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::TradeResponse);
    let denial_params = DenialParams::default();
    let context = denial::context(&view, &denial_params);
    assert!(denial::should_defend(&context).is_some());
    let current = view.longest_road_len(0);
    let mut network = view.road_network();
    let extensions = (0..topology.edge_count())
        .map(|edge| edge as Edge)
        .filter(|edge| view.legal_road(*edge))
        .map(|edge| {
            (
                edge,
                view.road_length_on(&mut network, edge, None, current.saturating_add(2)),
            )
        })
        .filter(|(_, length)| *length > current)
        .collect::<Vec<_>>();
    let expansion_targets = (0..topology.edge_count())
        .map(|edge| edge as Edge)
        .filter(|edge| view.legal_road(*edge))
        .flat_map(|edge| topology.edge_endpoints(edge))
        .filter(|vertex| view.is_expansion_target(*vertex))
        .collect::<Vec<_>>();
    assert!(!extensions.is_empty());
    assert!(expansion_targets.is_empty());
    let accepted = Resource::ALL.into_iter().any(|give| {
        Resource::ALL.into_iter().any(|get| {
            if give == get {
                return false;
            }
            let offer = TradeOffer {
                proposer: 1,
                give,
                get,
                count: 1,
            };
            let mut off_rng = Xoshiro256StarStar::from_seed(3);
            let mut on_rng = Xoshiro256StarStar::from_seed(3);
            !policy::respond_trade(PolicyKind::HeuristicV1Trader, &view, offer, &mut off_rng)
                && policy::respond_trade(
                    PolicyKind::HeuristicV1TraderDenial,
                    &view,
                    offer,
                    &mut on_rng,
                )
        })
    });
    assert!(accepted, "no trade was enabled by the gated-only road goal");
}

#[test]
fn the_action_path_goal_reaches_the_next_discard() {
    let (topology, board, mut arena) = road_city_fixture(false, 5);
    arena.state.players[0].resources = [2, 1, 1, 1, 2];
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let mut off_scratch = PolicyScratch::default();
    let mut off_rng = Xoshiro256StarStar::from_seed(19);
    heuristic_v1::action(
        &view,
        &mut off_scratch,
        &HeuristicParams::default(),
        &mut off_rng,
    );
    let off = heuristic_v1::discard(&view, 3, &mut off_scratch, &HeuristicParams::default());
    let params = HeuristicParams {
        denial: Some(DenialParams {
            pressure_floor: 0.0,
            pressure_span: 0.0,
            ..DenialParams::default()
        }),
        ..HeuristicParams::default()
    };
    let mut on_scratch = PolicyScratch::default();
    let mut on_rng = Xoshiro256StarStar::from_seed(19);
    heuristic_v1::action(&view, &mut on_scratch, &params, &mut on_rng);
    let on = heuristic_v1::discard(&view, 3, &mut on_scratch, &params);
    assert_ne!(off, on);
}

// Forwarded arguments of `heuristic_v1::discard`, one observing test each:
// - `view` (hand contents): discard_preserves_the_active_city_cost (tactical_policy.rs)
// - `count`: discard_preserves_the_active_city_cost asserts the discarded sum
// - `scratch` (carried goal): the_action_path_goal_reaches_the_next_discard
// - `params` (fallback path, scratch goal absent): the_gated_params_reach_the_discard_fallback
#[test]
fn the_gated_params_reach_the_discard_fallback() {
    let (topology, board, mut arena) = road_city_fixture(false, 5);
    arena.state.players[0].resources = [2, 1, 1, 1, 2];
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    // No prior action() call: scratch.goal is None, so discard recomputes the goal itself. The
    // ungated and gated params reach different goals on this fixture (the action-path test above
    // establishes that), and each goal's cost fixes the greedy discard vector in closed form:
    // hand [2,1,1,1,2], count 3, discard = argmax(remaining - cost), ties to the highest index.
    let off = heuristic_v1::discard(
        &view,
        3,
        &mut PolicyScratch::default(),
        &HeuristicParams::default(),
    );
    let params = HeuristicParams {
        denial: Some(DenialParams {
            pressure_floor: 0.0,
            pressure_span: 0.0,
            ..DenialParams::default()
        }),
        ..HeuristicParams::default()
    };
    let on = heuristic_v1::discard(&view, 3, &mut PolicyScratch::default(), &params);
    // Ungated goal: road, cost [1,0,0,1,0] -> shed ore, ore (tie with wood, highest index wins),
    // then wheat.
    assert_eq!(off, [0, 0, 1, 0, 2]);
    // Gated goal: settlement, cost [1,1,1,1,0] -> shed ore, ore, then wood.
    assert_eq!(on, [1, 0, 0, 0, 2]);
}

macro_rules! denial_param_guard {
    ($name:ident, $field:ident, $value:expr) => {
        #[test]
        #[cfg(debug_assertions)]
        #[should_panic]
        fn $name() {
            denial::assert_params(&DenialParams {
                $field: $value,
                ..DenialParams::default()
            });
        }
    };
}

denial_param_guard!(denial_assert_params_rejects_danger_floor, danger_floor, 0.0);
denial_param_guard!(
    denial_assert_params_rejects_pressure_floor,
    pressure_floor,
    f32::NAN
);
denial_param_guard!(
    denial_assert_params_rejects_pressure_span,
    pressure_span,
    -1.0
);
denial_param_guard!(denial_assert_params_rejects_race_bonus, race_bonus, -1.0);
denial_param_guard!(
    denial_assert_params_rejects_race_danger_min,
    race_danger_min,
    1.1
);
denial_param_guard!(
    denial_assert_params_rejects_defend_weight,
    defend_weight,
    -1.0
);
denial_param_guard!(
    denial_assert_params_rejects_defend_headroom_half,
    defend_headroom_half,
    0.0
);
denial_param_guard!(
    denial_assert_params_rejects_defend_probe_slack,
    defend_probe_slack,
    0
);
denial_param_guard!(
    denial_assert_params_rejects_contest_weight,
    contest_weight,
    -1.0
);
denial_param_guard!(
    denial_assert_params_rejects_contest_cap,
    contest_cap,
    f32::NAN
);
denial_param_guard!(
    denial_assert_params_rejects_contest_goal_share,
    contest_goal_share,
    -1.0
);
denial_param_guard!(
    denial_assert_params_rejects_army_defend_weight,
    army_defend_weight,
    -1.0
);
denial_param_guard!(
    denial_assert_params_rejects_army_gap_half,
    army_gap_half,
    0.0
);
