use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;

use unsettled_engine::board::{ConversionOptions, SimBoard};
use unsettled_engine::game::{GameArena, GameConfig};
use unsettled_engine::longest_road::RoadCard;
use unsettled_engine::policy::PolicyScratch;
use unsettled_engine::policy::denial::DenialParams;
use unsettled_engine::policy::heuristic_v1::{
    self, BUILD_BAND, BuildKind, HeuristicParams, LegacyValuation,
};
use unsettled_engine::policy::heuristic_v1_trader;
use unsettled_engine::policy::trading::TradeParams;
use unsettled_engine::policy::{self, PolicyKind};
use unsettled_engine::rng::Xoshiro256StarStar;
use unsettled_engine::rules::{Buildable, Resource, RuleConfig, TradeConfig};
use unsettled_engine::topology::{Edge, Layout, Topology, Vertex};
use unsettled_engine::view::{Action, DecisionPhase, ScoredAction, pips};
use unsettled_engine::wire::WireBoard;

fn fixture(player_trading: bool) -> (Topology, SimBoard, RuleConfig, GameConfig, GameArena) {
    let topology = Topology::load(Layout::Extension6).unwrap();
    let mut rules = RuleConfig::base(Layout::Extension6);
    if player_trading {
        rules.player_trading = Some(TradeConfig {
            acceptance_temperature: 0.0,
            ..TradeConfig::default()
        });
    }
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

fn local_production(board: &SimBoard, topology: &Topology, vertex: Vertex) -> [u16; 5] {
    let mut production = [0; 5];
    for hex in topology.vertex_hexes(vertex) {
        if let (Some(resource), Some(token)) = (
            board.tiles()[usize::from(*hex)],
            board.tokens()[usize::from(*hex)],
        ) {
            production[resource.index()] += u16::from(pips(token));
        }
    }
    production
}

fn score_for(actions: &[ScoredAction], predicate: impl Fn(Action) -> bool) -> f32 {
    actions
        .iter()
        .find(|candidate| predicate(candidate.action))
        .map(|candidate| candidate.score)
        .expect("expected scored action")
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
        arena.state.edge_owner[usize::from(*edge)] = seat as u8;
        arena.state.players[seat].pieces[Buildable::Road.index()] -= 1;
    }
}

fn building_fixture(
    city_high: bool,
) -> (
    Topology,
    SimBoard,
    GameArena,
    Vertex,
    Vertex,
    HeuristicParams,
) {
    let (topology, board, _rules, _config, mut arena) = fixture(false);
    let mut vertices = (0..topology.vertex_count())
        .map(|vertex| vertex as Vertex)
        .collect::<Vec<_>>();
    vertices.sort_by_key(|vertex| {
        local_production(&board, &topology, *vertex)
            .iter()
            .sum::<u16>()
    });
    let (city, settlement) = if city_high {
        vertices
            .iter()
            .rev()
            .find_map(|city| {
                vertices
                    .iter()
                    .find(|settlement| {
                        **settlement != *city
                            && !topology.vertex_adjacent(*city).contains(settlement)
                    })
                    .map(|settlement| (*city, *settlement))
            })
            .unwrap()
    } else {
        vertices
            .iter()
            .find_map(|city| {
                vertices
                    .iter()
                    .rev()
                    .find(|settlement| {
                        **settlement != *city
                            && !topology.vertex_adjacent(*city).contains(settlement)
                    })
                    .map(|settlement| (*city, *settlement))
            })
            .unwrap()
    };
    arena.state.vertex_owner[usize::from(city)] = 0;
    arena.state.vertex_tier[usize::from(city)] = 1;
    arena.state.edge_owner[usize::from(topology.vertex_edges(settlement)[0])] = 0;
    arena.state.players[0].resources = [1, 1, 3, 1, 3];
    let params = HeuristicParams {
        production_weight: 100.0,
        scarcity_weight: 0.0,
        diversity_bonus: 0.0,
        port_weight: 0.0,
        expansion_weight: 0.0,
        ..HeuristicParams::default()
    };
    (topology, board, arena, city, settlement, params)
}

fn one_short_hand(
    view: &unsettled_engine::view::DecisionView<'_>,
    kind: Buildable,
) -> ([i16; 5], Resource, Resource) {
    let cost = view.costs(kind)[0];
    let get = Resource::ALL
        .into_iter()
        .find(|resource| cost[resource.index()] > 0)
        .unwrap();
    let give = Resource::ALL
        .into_iter()
        .find(|resource| *resource != get)
        .unwrap();
    let mut hand = cost.map(i16::from);
    hand[get.index()] -= 1;
    hand[give.index()] += 4;
    (hand, give, get)
}

#[test]
fn port_synergy_prices_board_wide_own_production() {
    let (topology, board, _rules, _config, mut arena) = fixture(false);
    let (port_vertex, resource, local) = board
        .ports()
        .iter()
        .filter_map(|port| port.resource.map(|resource| (port, resource)))
        .find_map(|(port, resource)| {
            topology
                .edge_endpoints(port.edge)
                .into_iter()
                .find_map(|vertex| {
                    let local = local_production(&board, &topology, vertex)[resource.index()];
                    (local > 0).then_some((vertex, resource, local))
                })
        })
        .unwrap();
    let owned = (0..topology.vertex_count())
        .map(|vertex| vertex as Vertex)
        .find(|vertex| {
            *vertex != port_vertex
                && !topology.vertex_adjacent(port_vertex).contains(vertex)
                && local_production(&board, &topology, *vertex)[resource.index()] > 0
        })
        .unwrap();
    arena.state.vertex_owner[usize::from(owned)] = 0;
    arena.state.vertex_tier[usize::from(owned)] = 1;
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let own = view.production_pips(0)[resource.index()];
    let improvement = 1.0 / 2.0 - 1.0 / 4.0;
    let params = HeuristicParams {
        production_weight: 0.0,
        scarcity_weight: 0.0,
        diversity_bonus: 0.0,
        port_weight: 7.0,
        expansion_weight: 0.0,
        ..HeuristicParams::default()
    };
    let actual = heuristic_v1::vertex_score(&view, port_vertex, &params, BuildKind::Settlement);
    let expected = f32::from(own + local) * improvement * params.port_weight;
    assert_eq!(actual.to_bits(), expected.to_bits());
    assert!(actual > f32::from(local) * improvement * params.port_weight);
}

#[test]
fn settlement_goal_ranks_by_score_not_pips() {
    let (topology, board, _rules, _config, mut arena) = fixture(false);
    let pips_max = (0..topology.vertex_count())
        .map(|vertex| vertex as Vertex)
        .max_by_key(|vertex| {
            local_production(&board, &topology, *vertex)
                .iter()
                .sum::<u16>()
        })
        .unwrap();
    let score_max = (0..topology.vertex_count())
        .map(|vertex| vertex as Vertex)
        .min_by_key(|vertex| {
            local_production(&board, &topology, *vertex)
                .iter()
                .sum::<u16>()
        })
        .unwrap();
    assert_ne!(pips_max, score_max);
    arena.state.edge_owner[usize::from(topology.vertex_edges(pips_max)[0])] = 0;
    arena.state.edge_owner[usize::from(topology.vertex_edges(score_max)[0])] = 0;
    arena.state.players[0].pieces[Buildable::Road.index()] = 0;
    let params = HeuristicParams {
        production_weight: -10.0,
        scarcity_weight: 0.0,
        diversity_bonus: 0.0,
        port_weight: 0.0,
        expansion_weight: 0.0,
        ..HeuristicParams::default()
    };
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let (hand, give, get) = one_short_hand(&view, Buildable::Settlement);
    arena.state.players[0].resources = hand;
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let best = (0..topology.vertex_count())
        .map(|vertex| vertex as Vertex)
        .filter(|vertex| view.legal_settlement(*vertex))
        .map(|vertex| heuristic_v1::vertex_score(&view, vertex, &params, BuildKind::Settlement))
        .filter(|score| score.is_finite())
        .fold(f32::NEG_INFINITY, f32::max);
    let expected = 400.0
        + (1.0 + best / 20.0)
            / heuristic_v1::turns_to_afford(&view, Buildable::Settlement).max(0.25);
    let actions = heuristic_v1::recommend(&view, &params);
    let actual = score_for(&actions, |action| {
        action
            == Action::TradeBank {
                give,
                get,
                count: 1,
            }
    });
    assert_eq!(actual.to_bits(), expected.to_bits());
}

#[test]
fn city_goal_value_tracks_the_upgraded_vertex() {
    let (topology, board, _rules, _config, mut arena) = fixture(false);
    let mut vertices = (0..topology.vertex_count())
        .map(|vertex| vertex as Vertex)
        .collect::<Vec<_>>();
    vertices.sort_by_key(|vertex| {
        local_production(&board, &topology, *vertex)
            .iter()
            .sum::<u16>()
    });
    let low = vertices[0];
    let high = *vertices
        .iter()
        .rev()
        .find(|vertex| !topology.vertex_adjacent(low).contains(vertex))
        .unwrap();
    for vertex in [low, high] {
        arena.state.vertex_owner[usize::from(vertex)] = 0;
        arena.state.vertex_tier[usize::from(vertex)] = 1;
    }
    arena.state.players[0].pieces[Buildable::Settlement.index()] = 0;
    for edge in &mut arena.state.edge_owner {
        *edge = 1;
    }
    let params = HeuristicParams {
        production_weight: 10.0,
        scarcity_weight: 0.0,
        diversity_bonus: 0.0,
        port_weight: 0.0,
        expansion_weight: 0.0,
        ..HeuristicParams::default()
    };
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let (hand, give, get) = one_short_hand(&view, Buildable::City);
    arena.state.players[0].resources = hand;
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let best = heuristic_v1::vertex_score(&view, high, &params, BuildKind::City);
    let expected = 400.0
        + (1.0 + best / 20.0) / heuristic_v1::turns_to_afford(&view, Buildable::City).max(0.25);
    let actions = heuristic_v1::recommend(&view, &params);
    let actual = score_for(&actions, |action| {
        action
            == Action::TradeBank {
                give,
                get,
                count: 1,
            }
    });
    assert_eq!(actual.to_bits(), expected.to_bits());
}

#[test]
fn city_score_excludes_the_expansion_frontier() {
    let (topology, board, arena, city, settlement, _) = building_fixture(false);
    let params = HeuristicParams {
        production_weight: 0.0,
        scarcity_weight: 0.0,
        diversity_bonus: 0.0,
        port_weight: 0.0,
        expansion_weight: 100.0,
        ..HeuristicParams::default()
    };
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let actions = heuristic_v1::recommend(&view, &params);
    let city_score = score_for(&actions, |action| action == Action::UpgradeCity(city));
    let settlement_score = score_for(&actions, |action| {
        action == Action::BuildSettlement(settlement)
    });
    assert_eq!(city_score.to_bits(), BUILD_BAND.to_bits());
    assert_eq!(
        settlement_score.to_bits(),
        (BUILD_BAND + topology.vertex_adjacent(settlement).len() as f32 * params.expansion_weight)
            .to_bits()
    );
}

/// A regression guard, not evidence for the fix: the assertion held identically before this batch,
/// for the reason `heuristic_v1.rs::vertex_score` records, so it cannot distinguish the fixed
/// scorer from the pre-batch one. What it does do is fail any change that reintroduces a nonzero
/// city diversity count, which is why the legacy flag has no diversity arm to restore.
#[test]
fn city_score_excludes_diversity() {
    let (topology, board, arena, city, _, _) = building_fixture(true);
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let without = score_for(
        &heuristic_v1::recommend(
            &view,
            &HeuristicParams {
                production_weight: 0.0,
                scarcity_weight: 0.0,
                diversity_bonus: 0.0,
                port_weight: 0.0,
                expansion_weight: 0.0,
                ..HeuristicParams::default()
            },
        ),
        |action| action == Action::UpgradeCity(city),
    );
    let with = score_for(
        &heuristic_v1::recommend(
            &view,
            &HeuristicParams {
                production_weight: 0.0,
                scarcity_weight: 0.0,
                diversity_bonus: 1_000.0,
                port_weight: 0.0,
                expansion_weight: 0.0,
                ..HeuristicParams::default()
            },
        ),
        |action| action == Action::UpgradeCity(city),
    );
    assert_eq!(without.to_bits(), BUILD_BAND.to_bits());
    assert_eq!(with.to_bits(), without.to_bits());
}

#[test]
fn a_strong_settlement_outranks_a_marginal_city() {
    let (topology, board, arena, city, settlement, params) = building_fixture(false);
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let actions = heuristic_v1::recommend(&view, &params);
    let city_score = score_for(&actions, |action| action == Action::UpgradeCity(city));
    let settlement_score = score_for(&actions, |action| {
        action == Action::BuildSettlement(settlement)
    });
    assert!(settlement_score > city_score);
    let mut scratch = PolicyScratch::default();
    let mut rng = Xoshiro256StarStar::from_seed(9);
    assert_eq!(
        heuristic_v1::action(&view, &mut scratch, &params, &mut rng),
        Action::BuildSettlement(settlement)
    );
}

#[test]
fn an_affordable_city_outranks_a_marginal_settlement() {
    let (topology, board, arena, city, settlement, params) = building_fixture(true);
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let actions = heuristic_v1::recommend(&view, &params);
    let city_score = score_for(&actions, |action| action == Action::UpgradeCity(city));
    let settlement_score = score_for(&actions, |action| {
        action == Action::BuildSettlement(settlement)
    });
    assert!(city_score > settlement_score);
    assert!(settlement_score >= BUILD_BAND);
}

#[test]
fn expansion_road_targets_are_scored_as_settlements() {
    let (topology, board, _rules, _config, mut first_hop_arena) = fixture(false);
    let (start, first, target, second) = (0..topology.vertex_count())
        .find_map(|start| {
            let start = start as Vertex;
            topology.vertex_edges(start).iter().find_map(|first| {
                let [left, right] = topology.edge_endpoints(*first);
                let middle = if left == start { right } else { left };
                topology.vertex_edges(middle).iter().find_map(|second| {
                    if second == first {
                        return None;
                    }
                    let [left, right] = topology.edge_endpoints(*second);
                    let target = if left == middle { right } else { left };
                    (topology.vertex_adjacent(target).len() == 3
                        && !topology.vertex_adjacent(start).contains(&target))
                    .then_some((start, *first, target, *second))
                })
            })
        })
        .expect("fixture needs a two-road route to a degree-three settlement target");
    let params = HeuristicParams {
        production_weight: 0.0,
        scarcity_weight: 0.0,
        diversity_bonus: 0.0,
        port_weight: 0.0,
        expansion_weight: 100.0,
        ..HeuristicParams::default()
    };

    first_hop_arena.state.vertex_owner[usize::from(start)] = 0;
    first_hop_arena.state.vertex_tier[usize::from(start)] = 1;
    give_path(&mut first_hop_arena, 0, &[first]);
    let view = first_hop_arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    first_hop_arena.state.players[0].resources = view.costs(Buildable::Road)[0].map(i16::from);
    let view = first_hop_arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    assert!(view.legal_road(second));
    assert!(view.is_expansion_target(target));
    let first_hop_score = score_for(&heuristic_v1::recommend(&view, &params), |action| {
        action == Action::BuildRoad(second)
    });
    let first_hop_expected =
        40.0 + topology.vertex_adjacent(target).len() as f32 * params.expansion_weight + 0.25;
    assert_eq!(first_hop_score.to_bits(), first_hop_expected.to_bits());

    let (_topology, _board, _rules, _config, mut second_hop_arena) = fixture(false);
    second_hop_arena.state.vertex_owner[usize::from(start)] = 0;
    second_hop_arena.state.vertex_tier[usize::from(start)] = 1;
    let view = second_hop_arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    second_hop_arena.state.players[0].resources = view.costs(Buildable::Road)[0].map(i16::from);
    let view = second_hop_arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    assert!(view.legal_road(first));
    assert!(view.legal_road_after(first, second));
    assert!(view.is_expansion_target(target));
    let second_hop_score = score_for(&heuristic_v1::recommend(&view, &params), |action| {
        action == Action::BuildRoad(first)
    });
    let second_hop_expected =
        40.0 + topology.vertex_adjacent(target).len() as f32 * params.expansion_weight;
    assert_eq!(second_hop_score.to_bits(), second_hop_expected.to_bits());
}

#[test]
fn road_building_pair_targets_are_scored_as_settlements() {
    let (topology, board, _rules, _config, mut arena) = fixture(false);
    let (start, expected, first_pair) = (0..topology.vertex_count())
        .find_map(|start| {
            let start = start as Vertex;
            arena.state.vertex_owner[usize::from(start)] = 0;
            arena.state.vertex_tier[usize::from(start)] = 1;
            let view = arena.decision_view(&board, &topology, 0, DecisionPhase::PreRoll);
            let own = view.production_pips(0);
            let mut first_pair = None;
            let mut expected = None;
            let mut best_score = f32::NEG_INFINITY;
            for first in 0..topology.edge_count() {
                let first = first as Edge;
                if !view.legal_road(first) {
                    continue;
                }
                for second in topology.edge_neighbors(first) {
                    if !view.legal_road_after(first, *second) {
                        continue;
                    }
                    first_pair.get_or_insert((first, *second));
                    let score = topology
                        .edge_endpoints(*second)
                        .iter()
                        .map(|vertex| {
                            local_production(&board, &topology, *vertex)
                                .iter()
                                .enumerate()
                                .filter(|(resource, value)| **value > 0 && own[*resource] == 0)
                                .count() as f32
                                * 1_000.0
                        })
                        .fold(f32::NEG_INFINITY, f32::max);
                    if score > best_score {
                        best_score = score;
                        expected = Some((first, *second));
                    }
                }
            }
            arena.state.vertex_owner[usize::from(start)] = u8::MAX;
            arena.state.vertex_tier[usize::from(start)] = 0;
            match (expected, first_pair) {
                (Some(expected), Some(first_pair)) if expected != first_pair => {
                    Some((start, expected, first_pair))
                }
                _ => None,
            }
        })
        .expect("fixture needs diversity scoring to reorder a legal road-building pair");
    assert_ne!(expected, first_pair);
    arena.state.vertex_owner[usize::from(start)] = 0;
    arena.state.vertex_tier[usize::from(start)] = 1;
    arena.state.players[0].playable_dev[2] = 1;
    let params = HeuristicParams {
        production_weight: 0.0,
        scarcity_weight: 0.0,
        diversity_bonus: 1_000.0,
        port_weight: 0.0,
        expansion_weight: 0.0,
        ..HeuristicParams::default()
    };
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::PreRoll);
    assert_eq!(
        heuristic_v1::pre_roll(&view, &mut PolicyScratch::default(), &params),
        Some(unsettled_engine::view::DevPlay::RoadBuilding {
            first: Some(expected.0),
            second: Some(expected.1),
        })
    );
}

#[test]
fn both_buildings_share_one_band() {
    let (topology, board, arena, _, _, _) = building_fixture(false);
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    for candidate in heuristic_v1::recommend(&view, &HeuristicParams::default()) {
        if matches!(
            candidate.action,
            Action::UpgradeCity(_) | Action::BuildSettlement(_)
        ) {
            assert!(
                (BUILD_BAND..BUILD_BAND + 1_000.0).contains(&candidate.score),
                "{candidate:?}"
            );
        }
    }
}

fn road_city_fixture(own_vp: u8) -> (Topology, SimBoard, RuleConfig, GameArena) {
    let (topology, board, rules, _config, mut arena) = fixture(false);
    let (vertices, path) = simple_path(&topology, 6, &HashSet::new());
    arena.state.vertex_owner[usize::from(vertices[0])] = 0;
    arena.state.vertex_tier[usize::from(vertices[0])] = 1;
    give_path(&mut arena, 0, &path[..5]);
    arena.state.players[0].vp_public = own_vp;
    arena.state.players[0].longest_road_len = 5;
    arena.state.players[0].resources = [1, 1, 2, 1, 3];
    arena.state.longest_road = RoadCard {
        holder: Some(1),
        retired: false,
    };
    arena.state.players[1].longest_road_len = 5;
    (topology, board, rules, arena)
}

#[test]
fn a_low_pressure_denial_road_no_longer_outranks_an_affordable_settlement() {
    let (topology, board, _rules, arena) = road_city_fixture(5);
    let params = HeuristicParams {
        denial: Some(DenialParams::default()),
        ..HeuristicParams::default()
    };
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let actions = heuristic_v1::recommend(&view, &params);
    let road = score_for(&actions, |action| matches!(action, Action::BuildRoad(_)));
    let settlement = score_for(&actions, |action| {
        matches!(action, Action::BuildSettlement(_))
    });
    assert!((500.0..BUILD_BAND).contains(&road));
    assert!(settlement > road);
}

#[test]
fn a_dev_completing_trade_no_longer_outranks_an_affordable_settlement() {
    let (topology, board, _rules, _config, mut arena) = fixture(false);
    let target = topology.vertex_adjacent(0)[0];
    arena.state.edge_owner[usize::from(topology.vertex_edges(target)[0])] = 0;
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let settlement_cost = view.costs(Buildable::Settlement)[0];
    let dev_cost = *view.dev_cost();
    let get = Resource::ALL
        .into_iter()
        .find(|resource| dev_cost[resource.index()] > settlement_cost[resource.index()])
        .unwrap();
    let give = Resource::ALL
        .into_iter()
        .find(|resource| *resource != get)
        .unwrap();
    arena.state.players[0].resources = settlement_cost.map(i16::from);
    arena.state.players[0].resources[give.index()] += 4;
    arena.state.players[0].vp_public = 9;
    arena.state.players[0].knights_played = 2;
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let actions = heuristic_v1::recommend(&view, &HeuristicParams::default());
    let settlement = score_for(&actions, |action| {
        matches!(action, Action::BuildSettlement(_))
    });
    let trade = actions
        .iter()
        .filter(|candidate| {
            candidate.action
                == Action::TradeBank {
                    give,
                    get,
                    count: 1,
                }
        })
        .map(|candidate| candidate.score)
        .fold(f32::NEG_INFINITY, f32::max);
    assert!(trade > 500.0);
    assert!(settlement > trade);
}

#[test]
fn an_aware_offer_no_longer_outranks_an_affordable_settlement() {
    let (topology, board, _rules, _config, mut arena) = fixture(true);
    let target = topology.vertex_adjacent(0)[0];
    arena.state.edge_owner[usize::from(topology.vertex_edges(target)[0])] = 0;
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    arena.state.players[0].resources = view.costs(Buildable::Settlement)[0].map(i16::from);
    arena.state.players[0].resources[Resource::Wood.index()] += 3;
    for resource in Resource::ALL {
        arena.state.players[1].resources[resource.index()] = 2;
        arena.state.belief.gain(1, resource.index(), 2);
    }
    let params = HeuristicParams {
        trading: Some(TradeParams {
            offer_base: 800.0,
            offer_span: 1.0,
            ..TradeParams::default()
        }),
        ..HeuristicParams::default()
    };
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let settlement = score_for(&heuristic_v1::recommend(&view, &params), |action| {
        matches!(action, Action::BuildSettlement(_))
    });
    let mut scratch = PolicyScratch::default();
    let mut rng = Xoshiro256StarStar::from_seed(11);
    let fixed = heuristic_v1_trader::action(&view, &mut scratch, &params, &mut rng);
    let mut legacy = params.clone();
    legacy.legacy_valuation = Some(LegacyValuation {
        band_ladder: true,
        ..LegacyValuation::default()
    });
    let mut scratch = PolicyScratch::default();
    let mut rng = Xoshiro256StarStar::from_seed(11);
    let old = heuristic_v1_trader::action(&view, &mut scratch, &legacy, &mut rng);
    assert!(settlement >= BUILD_BAND);
    assert!(matches!(old, Action::OfferTrade { .. }));
    assert!(matches!(fixed, Action::BuildSettlement(_)));
}

#[test]
fn ablation_kinds_dispatch_through_trader_paths() {
    let (topology, board, _rules, _config, mut arena) = fixture(true);
    let target = topology.vertex_adjacent(0)[0];
    arena.state.edge_owner[usize::from(topology.vertex_edges(target)[0])] = 0;
    arena.state.players[0].pieces[Buildable::Road.index()] = 0;
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let cost = view.costs(Buildable::Settlement)[0];
    for resource in Resource::ALL {
        arena.state.players[1].resources[resource.index()] = 2;
        arena.state.belief.gain(1, resource.index(), 2);
    }
    let get = Resource::ALL
        .into_iter()
        .find(|resource| cost[resource.index()] > 0)
        .unwrap();
    let give = Resource::ALL
        .into_iter()
        .find(|resource| *resource != get)
        .unwrap();
    arena.state.players[0].resources = cost.map(i16::from);
    arena.state.players[0].resources[get.index()] -= 1;
    arena.state.players[0].resources[give.index()] += 2;
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let expected = Action::OfferTrade {
        give: Resource::Sheep,
        get: Resource::Ore,
        count: 1,
    };
    for kind in [
        PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacyall,
        PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacyport,
        PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacychooser,
        PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacycityterms,
        PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacyband,
        PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacycitygoal,
    ] {
        let mut scratch = PolicyScratch::default();
        let mut rng = Xoshiro256StarStar::from_seed(11);
        assert_eq!(
            policy::action(kind, &view, &mut scratch, &mut rng),
            expected,
            "{kind:?}"
        );
    }
}

fn bridged_progress_fixture() -> (Topology, SimBoard, RuleConfig, GameArena) {
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

    let (topology, board, rules, _config, mut arena) = fixture(false);
    for bridge in 0..topology.edge_count() {
        let bridge = bridge as Edge;
        let [left, right] = topology.edge_endpoints(bridge);
        let excluded_edges = HashSet::from([bridge]);
        let mut left_vertices = vec![left];
        let mut left_edges = Vec::new();
        if !path_from(
            &topology,
            left,
            4,
            &excluded_edges,
            &HashSet::from([right]),
            &mut left_vertices,
            &mut left_edges,
        ) {
            continue;
        }
        let mut right_vertices = vec![right];
        let mut right_edges = Vec::new();
        let mut right_excluded = excluded_edges.clone();
        right_excluded.extend(left_edges.iter().copied());
        let left_set = left_vertices.iter().copied().collect::<HashSet<_>>();
        if !path_from(
            &topology,
            right,
            4,
            &right_excluded,
            &left_set,
            &mut right_vertices,
            &mut right_edges,
        ) {
            continue;
        }
        give_path(&mut arena, 0, &left_edges);
        give_path(&mut arena, 0, &right_edges);
        arena.state.vertex_owner[usize::from(left)] = 0;
        arena.state.vertex_tier[usize::from(left)] = 1;
        let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
        let settlement = view.costs(Buildable::Settlement)[0];
        let road = view.costs(Buildable::Road)[0];
        arena.state.players[0].resources =
            std::array::from_fn(|index| i16::from(settlement[index].max(road[index])));
        arena.state.players[0].vp_public = 9;
        arena.state.players[0].longest_road_len = 4;
        arena.state.players[1].longest_road_len = 9;
        arena.state.longest_road = RoadCard {
            holder: Some(1),
            retired: false,
        };
        return (topology, board, rules, arena);
    }
    panic!("fixture needs a bridge between two four-edge components");
}

#[test]
fn a_progress_road_no_longer_outranks_an_affordable_settlement() {
    let (topology, board, _rules, arena) = bridged_progress_fixture();
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let actions = heuristic_v1::recommend(&view, &HeuristicParams::default());
    let road = score_for(&actions, |action| matches!(action, Action::BuildRoad(_)));
    let settlement = score_for(&actions, |action| {
        matches!(action, Action::BuildSettlement(_))
    });
    assert!((500.0..BUILD_BAND).contains(&road));
    assert!(settlement > road);
}

#[test]
fn a_pressured_dev_card_no_longer_outranks_an_affordable_settlement() {
    let (topology, board, _rules, _config, mut arena) = fixture(false);
    let target = topology.vertex_adjacent(0)[0];
    arena.state.edge_owner[usize::from(topology.vertex_edges(target)[0])] = 0;
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let settlement_cost = view.costs(Buildable::Settlement)[0];
    let dev_cost = *view.dev_cost();
    arena.state.players[0].resources =
        std::array::from_fn(|index| i16::from(settlement_cost[index].max(dev_cost[index])));
    arena.state.players[0].vp_public = 9;
    arena.state.players[0].knights_played = 2;
    let params = HeuristicParams {
        denial: Some(DenialParams {
            pressure_floor: 3.0,
            pressure_span: 0.0,
            ..DenialParams::default()
        }),
        ..HeuristicParams::default()
    };
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let actions = heuristic_v1::recommend(&view, &params);
    let dev = score_for(&actions, |action| action == Action::BuyDev);
    let settlement = score_for(&actions, |action| {
        matches!(action, Action::BuildSettlement(_))
    });
    assert!(dev > 500.0);
    assert!(settlement > dev);
}
