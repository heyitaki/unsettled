use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;

use unsettled_engine::board::{ConversionOptions, SimBoard};
use unsettled_engine::game::{GameArena, GameConfig};
use unsettled_engine::placement::app_formula::{AppFormulaScorer, EngineWeights};
use unsettled_engine::placement::{
    PlacementKind, prepare_app_formula_boards, register_app_formula,
};
use unsettled_engine::policy::{PolicyKind, random_legal};
use unsettled_engine::rng::Xoshiro256StarStar;
use unsettled_engine::rules::{Buildable, PlayerModifiers, Resource, RuleConfig};
use unsettled_engine::topology::{Edge, Layout, Topology, Vertex};
use unsettled_engine::view::{Action, ActionBuf, DecisionPhase, DevPlay, pips};
use unsettled_engine::wire::{TileKind, WireBoard};

fn wire_fixture() -> WireBoard {
    let relative = PathBuf::from("src/parser/__tests__/expected/board-draft-empty.json");
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .map(|root| root.join(&relative))
        .find(|candidate| candidate.is_file())
        .expect("board fixture must be reachable from the worktree or sweep root");
    WireBoard::parse_str(&fs::read_to_string(path).unwrap()).unwrap()
}

fn fixture() -> (Topology, SimBoard, RuleConfig) {
    let topology = Topology::load(Layout::Extension6).unwrap();
    let rules = RuleConfig::base(Layout::Extension6);
    let board = SimBoard::try_from_wire(
        wire_fixture(),
        &topology,
        &rules,
        ConversionOptions::default(),
    )
    .unwrap();
    (topology, board, rules)
}

fn other_hex(topology: &Topology, robber: u8) -> u8 {
    (0..topology.hex_count())
        .map(|hex| hex as u8)
        .find(|hex| *hex != robber)
        .unwrap()
}

fn simple_path(
    topology: &Topology,
    edge_count: usize,
    excluded: &HashSet<Edge>,
    require_branch_at: Option<usize>,
) -> (Vec<Vertex>, Vec<Edge>) {
    fn visit(
        topology: &Topology,
        edge_count: usize,
        excluded: &HashSet<Edge>,
        require_branch_at: Option<usize>,
        vertices: &mut Vec<Vertex>,
        edges: &mut Vec<Edge>,
    ) -> bool {
        if edges.len() == edge_count {
            return require_branch_at.is_none_or(|index| {
                topology
                    .vertex_edges(vertices[index])
                    .iter()
                    .any(|edge| !edges.contains(edge) && !excluded.contains(edge))
            });
        }
        let current = *vertices.last().unwrap();
        for edge in topology.vertex_edges(current) {
            if excluded.contains(edge) || edges.contains(edge) {
                continue;
            }
            let endpoints = topology.edge_endpoints(*edge);
            let next = if endpoints[0] == current {
                endpoints[1]
            } else {
                endpoints[0]
            };
            if vertices.contains(&next) {
                continue;
            }
            edges.push(*edge);
            vertices.push(next);
            if visit(
                topology,
                edge_count,
                excluded,
                require_branch_at,
                vertices,
                edges,
            ) {
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
        if visit(
            topology,
            edge_count,
            excluded,
            require_branch_at,
            &mut vertices,
            &mut edges,
        ) {
            return (vertices, edges);
        }
    }
    panic!("topology has no requested path");
}

#[test]
fn pre_roll_knight_largest_army_gain_wins_before_the_roll() {
    let (topology, board, mut rules) = fixture();
    rules.win_vp = 10;
    let mut config = GameConfig::default();
    config.policies[0] = PolicyKind::HeuristicV1;
    let mut arena = GameArena::default();
    arena.prepare(&board, &topology, &rules, &config);
    let blocked = (0..topology.hex_count())
        .map(|hex| hex as u8)
        .find(|hex| board.tokens()[usize::from(*hex)].is_some_and(|token| pips(token) >= 4))
        .unwrap();
    arena.state.robber = blocked;
    arena.state.vertex_owner[usize::from(topology.hex_vertices(blocked)[0])] = 0;
    arena.state.players[0].vp_public = 8;
    arena.state.players[0].knights_played = 2;
    arena.state.players[0].playable_dev[0] = 1;

    assert!(arena.begin_turn_for_test(&board, &topology, &rules, &config, 0));
    assert_eq!(arena.state.largest_army, Some(0));
    assert_eq!(arena.state.players[0].vp_public, 10);
}

#[test]
fn pre_roll_road_building_longest_road_gain_wins_before_the_roll() {
    let (topology, board, mut rules) = fixture();
    rules.win_vp = 10;
    let config = GameConfig::default();
    let mut arena = GameArena::default();
    arena.prepare(&board, &topology, &rules, &config);
    let (vertices, roads) = simple_path(&topology, 4, &HashSet::new(), None);
    arena.state.vertex_owner[usize::from(vertices[0])] = 0;
    arena.state.vertex_tier[usize::from(vertices[0])] = 1;
    for edge in &roads {
        arena.state.edge_owner[usize::from(*edge)] = 0;
    }
    for vertex in &vertices[..vertices.len() - 1] {
        for edge in topology.vertex_edges(*vertex) {
            if !roads.contains(edge) {
                arena.state.edge_owner[usize::from(*edge)] = 1;
            }
        }
    }
    arena.state.players[0].pieces[Buildable::Road.index()] = 11;
    arena.state.players[0].vp_public = 8;
    arena.state.players[0].playable_dev[2] = 1;

    assert!(arena.begin_turn_for_test(&board, &topology, &rules, &config, 0));
    assert_eq!(arena.state.longest_road.holder, Some(0));
    assert_eq!(arena.state.players[0].vp_public, 10);
}

#[test]
fn seven_flow_discards_moves_and_steals_zero_or_one_card() {
    let (topology, board, rules) = fixture();
    let mut config = GameConfig::default();
    config.policies = [PolicyKind::GreedyNoTrade; 6];
    let mut arena = GameArena::default();
    arena.prepare(&board, &topology, &rules, &config);
    arena.state.players[0].resources[Resource::Wood.index()] = 8;
    arena.state.bank[Resource::Wood.index()] -= 8;
    let old_robber = arena.state.robber;
    arena.resolve_seven_for_test(&board, &topology, &rules, &config, 0);
    assert_eq!(arena.state.players[0].resources.iter().sum::<i16>(), 4);
    assert_ne!(arena.state.robber, old_robber);
    assert_eq!(
        arena.state.players[1].resources.iter().sum::<i16>(),
        0,
        "no adjacent victim means no steal"
    );

    let mut empty = GameArena::default();
    empty.prepare(&board, &topology, &rules, &config);
    let target = other_hex(&topology, empty.state.robber);
    empty.state.vertex_owner[usize::from(topology.hex_vertices(target)[0])] = 1;
    empty.state.vertex_tier[usize::from(topology.hex_vertices(target)[0])] = 1;
    empty.state.players[1].vp_public = 5;
    empty.resolve_seven_for_test(&board, &topology, &rules, &config, 0);
    assert_eq!(empty.state.robber, target);
    assert_eq!(empty.state.players[0].resources.iter().sum::<i16>(), 0);

    let mut one = GameArena::default();
    one.prepare(&board, &topology, &rules, &config);
    let target = other_hex(&topology, one.state.robber);
    one.state.vertex_owner[usize::from(topology.hex_vertices(target)[0])] = 1;
    one.state.vertex_tier[usize::from(topology.hex_vertices(target)[0])] = 1;
    one.state.players[1].vp_public = 5;
    one.state.players[1].resources[Resource::Ore.index()] = 2;
    one.state.bank[Resource::Ore.index()] -= 2;
    one.resolve_seven_for_test(&board, &topology, &rules, &config, 0);
    assert_eq!(one.state.players[0].resources.iter().sum::<i16>(), 1);
    assert_eq!(one.state.players[1].resources.iter().sum::<i16>(), 1);
}

#[test]
fn second_setup_settlement_grants_only_adjacent_non_desert_resources() {
    let (topology, board, rules) = fixture();
    let desert = board.tiles().iter().position(Option::is_none).unwrap() as u8;
    for seed in 0..1_000 {
        let mut config = GameConfig::default();
        config.seed = seed;
        config.placements[0] = PlacementKind::Random;
        let mut arena = GameArena::default();
        arena.prepare(&board, &topology, &rules, &config);
        let Some(vertex) = arena.setup_pick_for_test(&board, &topology, &rules, &config, 0, true)
        else {
            continue;
        };
        if !topology.vertex_hexes(vertex).contains(&desert) {
            continue;
        }
        let mut expected = [0_i16; 5];
        for hex in topology.vertex_hexes(vertex) {
            if let Some(resource) = board.tiles()[usize::from(*hex)] {
                expected[resource.index()] += 1;
            }
        }
        assert_eq!(arena.state.players[0].resources, expected);
        assert_eq!(
            arena.state.players[0].resources.iter().sum::<i16>(),
            topology.vertex_hexes(vertex).len() as i16 - 1
        );
        assert!(
            topology
                .vertex_edges(vertex)
                .iter()
                .any(|edge| { arena.state.edge_owner[usize::from(*edge)] == 0 })
        );
        return;
    }
    panic!("no deterministic random setup pick touched the desert");
}

#[test]
fn app_formula_setup_pick_wires_the_second_settlement_grant_flag() {
    let (topology, original, rules) = fixture();
    let desert = original.tiles().iter().position(Option::is_none).unwrap() as u8;
    let low_pair = (0..topology.vertex_count())
        .find_map(|vertex| {
            let hexes = topology
                .vertex_hexes(vertex as Vertex)
                .iter()
                .copied()
                .filter(|hex| *hex != desert)
                .take(2)
                .collect::<Vec<_>>();
            (hexes.len() == 2).then_some([hexes[0], hexes[1]])
        })
        .expect("fixture has a vertex touching two producing hexes");
    let high_hex = (0..topology.hex_count())
        .map(|hex| hex as u8)
        .find(|hex| {
            *hex != desert
                && topology.hex_vertices(*hex).iter().all(|vertex| {
                    topology
                        .vertex_hexes(*vertex)
                        .iter()
                        .all(|neighbor| !low_pair.contains(neighbor))
                })
        })
        .expect("fixture has a hex separated from the low-card pair");
    let mut wire = wire_fixture();
    for hex in &mut wire.hexes {
        let index = topology.hex_by_key(&hex.coord.key()).unwrap();
        if index == desert {
            continue;
        }
        hex.tile = Some(if low_pair.contains(&index) || index == high_hex {
            TileKind::Wood
        } else {
            TileKind::Sheep
        });
        hex.number_token = Some(if index == high_hex { 6.0 } else { 2.0 });
    }
    let mut board =
        SimBoard::try_from_wire(wire, &topology, &rules, ConversionOptions::default()).unwrap();
    let default_weights: EngineWeights =
        serde_json::from_str(include_str!("../../../placement/default-weights.json")).unwrap();
    let argmax = |scorer: &AppFormulaScorer, grant| {
        let mut vertices = Vec::new();
        let mut best_score = f64::NEG_INFINITY;
        for vertex_index in 0..topology.vertex_count() {
            let vertex = vertex_index as Vertex;
            let score = scorer.marginal_total(&[], vertex, grant);
            if score > best_score {
                vertices.clear();
                vertices.push(vertex);
                best_score = score;
            } else if score == best_score {
                vertices.push(vertex);
            }
        }
        vertices
    };
    let mut weights = default_weights.clone();
    weights.resource_value.wood = 1.0;
    weights.resource_value.sheep = 0.0;
    weights.resource_value.wheat = 0.0;
    weights.resource_value.brick = 0.0;
    weights.resource_value.ore = 0.0;
    weights.hand_value_weight = 1_000.0;
    weights.scarcity_weight = 0.0;
    weights.diversity_weight = 0.0;
    weights.recipe_road_bonus = 0.0;
    weights.recipe_city_bonus = 0.0;
    weights.recipe_settlement_bonus = 0.0;
    weights.port_weight = 0.0;
    weights.robber_discount = 0.0;
    let scorer = AppFormulaScorer::new(&board, &topology, weights.clone());
    let first_argmax = argmax(&scorer, false);
    let second_argmax = argmax(&scorer, true);
    assert!(
        first_argmax
            .iter()
            .all(|vertex| !second_argmax.contains(vertex))
    );

    let placement = register_app_formula("app_formula:grant-wiring".into(), weights).unwrap();
    prepare_app_formula_boards(std::slice::from_mut(&mut board), &topology, &[placement]);
    let mut config = GameConfig::default();
    config.placements[0] = placement;
    let pick = |grant| {
        let mut arena = GameArena::default();
        arena.prepare(&board, &topology, &rules, &config);
        arena
            .setup_pick_for_test(&board, &topology, &rules, &config, 0, grant)
            .expect("fixture has a legal setup placement")
    };
    let first = pick(false);
    let second = pick(true);

    assert_ne!(first, second);
    assert!(first_argmax.contains(&first));
    assert!(second_argmax.contains(&second));
    assert!(!first_argmax.contains(&second));
}

#[test]
fn special_build_phase_and_live_dev_timing_use_the_shipped_state() {
    let (topology, board, rules) = fixture();
    let config = GameConfig::default();
    let mut arena = GameArena::default();
    arena.prepare(&board, &topology, &rules, &config);
    arena.state.players[1].resources = [4, 1, 1, 0, 1];
    arena.state.bank[Resource::Wood.index()] -= 4;
    arena.state.bank[Resource::Sheep.index()] -= 1;
    arena.state.bank[Resource::Wheat.index()] -= 1;
    arena.state.bank[Resource::Ore.index()] -= 1;
    assert!(!arena.validate_action(
        &board,
        &topology,
        1,
        Action::TradeBank {
            give: Resource::Wood,
            get: Resource::Brick,
            count: 1,
        },
        DecisionPhase::SpecialBuild,
    ));
    assert!(!arena.validate_action(
        &board,
        &topology,
        1,
        Action::PlayDev(DevPlay::Monopoly {
            resource: Resource::Wood,
        }),
        DecisionPhase::SpecialBuild,
    ));
    arena.set_next_dev_for_test(0);
    assert!(arena.validate_action(
        &board,
        &topology,
        1,
        Action::BuyDev,
        DecisionPhase::SpecialBuild,
    ));
    assert!(arena.apply_action_for_test(
        &board,
        &topology,
        &rules,
        &config,
        1,
        Action::BuyDev,
        DecisionPhase::SpecialBuild,
    ));
    assert_eq!(arena.state.players[1].bought_dev[0], 1);
    let destination = other_hex(&topology, arena.state.robber);
    let knight = Action::PlayDev(DevPlay::Knight {
        destination,
        victim: None,
    });
    assert!(!arena.validate_action(&board, &topology, 1, knight, DecisionPhase::PreRoll,));
    arena.promote_dev_for_test(1);
    assert!(arena.validate_action(&board, &topology, 1, knight, DecisionPhase::PreRoll,));

    let mut overflow = GameArena::default();
    overflow.prepare(&board, &topology, &rules, &config);
    let vertex = 0;
    let edge = topology.vertex_edges(vertex)[0];
    overflow.state.edge_owner[usize::from(edge)] = 1;
    overflow.state.players[1].pieces[Buildable::Road.index()] -= 1;
    overflow.state.players[1].resources = [1, 1, 1, 1, 0];
    for resource in 0..4 {
        overflow.state.bank[resource] -= 1;
    }
    overflow.state.players[1].vp_public = rules.win_vp - 1;
    let build = Action::BuildSettlement(vertex);
    assert!(overflow.apply_action_for_test(
        &board,
        &topology,
        &rules,
        &config,
        1,
        build,
        DecisionPhase::SpecialBuild,
    ));
    assert_eq!(overflow.state.players[1].vp_public, rules.win_vp);
    assert!(overflow.begin_turn_for_test(&board, &topology, &rules, &config, 1));
}

#[test]
fn live_dev_timing_enforces_purchase_delay_one_per_turn_and_all_pre_roll_kinds() {
    let (topology, board, rules) = fixture();
    let config = GameConfig::default();
    let destination = other_hex(&topology, board.robber());
    let plays = [
        DevPlay::Knight {
            destination,
            victim: None,
        },
        DevPlay::RoadBuilding {
            first: None,
            second: None,
        },
        DevPlay::YearOfPlenty {
            first: Resource::Wood,
            second: Resource::Sheep,
        },
        DevPlay::Monopoly {
            resource: Resource::Ore,
        },
    ];
    for play in plays {
        let kind = play.kind_index();
        let mut arena = GameArena::default();
        arena.prepare(&board, &topology, &rules, &config);
        arena.state.players[0].bought_dev[kind] = 1;
        assert!(!arena.validate_action(
            &board,
            &topology,
            0,
            Action::PlayDev(play),
            DecisionPhase::PreRoll,
        ));
        arena.promote_dev_for_test(0);
        assert!(arena.validate_action(
            &board,
            &topology,
            0,
            Action::PlayDev(play),
            DecisionPhase::PreRoll,
        ));
        assert!(arena.apply_action_for_test(
            &board,
            &topology,
            &rules,
            &config,
            0,
            Action::PlayDev(play),
            DecisionPhase::PreRoll,
        ));
        arena.state.players[0].playable_dev[4] = 1;
        assert!(!arena.validate_action(
            &board,
            &topology,
            0,
            Action::PlayDev(DevPlay::Monopoly {
                resource: Resource::Wood,
            }),
            DecisionPhase::PreRoll,
        ));
    }
}

#[test]
fn trade_rates_follow_bank_generic_specific_and_synthetic_port_data() {
    let (topology, board, mut rules) = fixture();
    let config = GameConfig::default();
    let mut base = GameArena::default();
    base.prepare(&board, &topology, &rules, &config);
    assert!(
        Resource::ALL
            .into_iter()
            .all(|resource| base.flattened_rules(0).trade_rate(resource) == 4)
    );

    let generic = board
        .ports()
        .iter()
        .find(|port| port.resource.is_none())
        .unwrap();
    let mut generic_arena = GameArena::default();
    generic_arena.prepare(&board, &topology, &rules, &config);
    generic_arena.state.vertex_owner[usize::from(topology.edge_endpoints(generic.edge)[0])] = 0;
    generic_arena.refresh_player_rules(&board, &topology, &rules, 0, &config.modifiers[0]);
    assert!(
        Resource::ALL
            .into_iter()
            .all(|resource| generic_arena.flattened_rules(0).trade_rate(resource) == 3)
    );

    let specific = board
        .ports()
        .iter()
        .find(|port| port.resource.is_some() && port.rate == 2)
        .unwrap();
    let matching = specific.resource.unwrap();
    let mut specific_arena = GameArena::default();
    specific_arena.prepare(&board, &topology, &rules, &config);
    specific_arena.state.vertex_owner[usize::from(topology.edge_endpoints(specific.edge)[0])] = 0;
    specific_arena.refresh_player_rules(&board, &topology, &rules, 0, &config.modifiers[0]);
    assert_eq!(specific_arena.flattened_rules(0).trade_rate(matching), 2);
    assert!(
        Resource::ALL
            .into_iter()
            .filter(|resource| *resource != matching)
            .all(|resource| specific_arena.flattened_rules(0).trade_rate(resource) == 4)
    );

    let mut synthetic_wire = wire_fixture();
    let port_index = synthetic_wire
        .ports
        .iter()
        .position(|port| port.resource.is_some())
        .unwrap();
    synthetic_wire.ports[port_index].rate = 4.0;
    rules.bank_trade_rate = 5;
    let synthetic = SimBoard::try_from_wire(
        synthetic_wire,
        &topology,
        &rules,
        ConversionOptions::default(),
    )
    .unwrap();
    let synthetic_port = synthetic.ports()[port_index];
    let synthetic_resource = synthetic_port.resource.unwrap();
    let mut synthetic_arena = GameArena::default();
    synthetic_arena.prepare(&synthetic, &topology, &rules, &config);
    synthetic_arena.state.vertex_owner
        [usize::from(topology.edge_endpoints(synthetic_port.edge)[0])] = 0;
    synthetic_arena.refresh_player_rules(&synthetic, &topology, &rules, 0, &config.modifiers[0]);
    assert_eq!(
        synthetic_arena
            .flattened_rules(0)
            .trade_rate(synthetic_resource),
        4
    );

    let mut favorable = GameConfig::default();
    favorable.modifiers[0] = PlayerModifiers {
        bank_rate_override: Some(2),
        ..PlayerModifiers::default()
    };
    let mut never_rises = GameArena::default();
    never_rises.prepare(&synthetic, &topology, &rules, &favorable);
    never_rises.state.vertex_owner[usize::from(topology.edge_endpoints(synthetic_port.edge)[0])] =
        0;
    never_rises.refresh_player_rules(&synthetic, &topology, &rules, 0, &favorable.modifiers[0]);
    assert_eq!(
        never_rises
            .flattened_rules(0)
            .trade_rate(synthetic_resource),
        2
    );

    for (arena, board, resource, rate) in [
        (&mut base, &board, Resource::Wood, 4),
        (&mut generic_arena, &board, Resource::Wood, 3),
        (&mut specific_arena, &board, matching, 2),
    ] {
        arena.state.players[0].resources[resource.index()] = rate;
        assert!(!arena.validate_action(
            board,
            &topology,
            0,
            Action::TradeBank {
                give: resource,
                get: resource,
                count: 1,
            },
            DecisionPhase::Action,
        ));
    }
}

#[test]
fn road_cut_recomputes_the_network_and_transfers_the_card() {
    let (topology, board, rules) = fixture();
    let config = GameConfig::default();
    let mut arena = GameArena::default();
    arena.prepare(&board, &topology, &rules, &config);
    let (vertices, roads) = simple_path(&topology, 8, &HashSet::new(), Some(4));
    let excluded = roads.iter().copied().collect::<HashSet<_>>();
    let (_, other_roads) = simple_path(&topology, 5, &excluded, None);
    for edge in &roads {
        arena.state.edge_owner[usize::from(*edge)] = 0;
    }
    for edge in &other_roads {
        arena.state.edge_owner[usize::from(*edge)] = 2;
    }
    arena.state.players[0].pieces[Buildable::Road.index()] = 7;
    arena.state.players[2].pieces[Buildable::Road.index()] = 10;
    arena.recompute_roads_for_test(&topology, &rules, board.seats());
    assert_eq!(arena.state.players[0].longest_road_len, 8);
    assert_eq!(arena.state.longest_road.holder, Some(0));

    let cut = vertices[4];
    let branch = topology
        .vertex_edges(cut)
        .iter()
        .copied()
        .find(|edge| !roads.contains(edge) && !other_roads.contains(edge))
        .unwrap();
    arena.state.edge_owner[usize::from(branch)] = 1;
    arena.state.players[1].pieces[Buildable::Road.index()] -= 1;
    arena.state.players[1].resources = [1, 1, 1, 1, 0];
    for resource in 0..4 {
        arena.state.bank[resource] -= 1;
    }
    assert!(arena.apply_action_for_test(
        &board,
        &topology,
        &rules,
        &config,
        1,
        Action::BuildSettlement(cut),
        DecisionPhase::Action,
    ));
    assert_eq!(arena.state.players[0].longest_road_len, 4);
    assert_eq!(arena.state.longest_road.holder, Some(2));
}

#[test]
fn setup_policy_consumption_does_not_shift_the_dice_stream() {
    let (topology, board, rules) = fixture();
    let mut first_config = GameConfig::default();
    first_config.seed = 0x5151;
    first_config.placements = [PlacementKind::Random; 6];
    first_config.policies = [PolicyKind::RandomLegal; 6];
    let mut second_config = GameConfig::default();
    second_config.seed = first_config.seed;
    second_config.placements = [PlacementKind::CityFocus; 6];
    second_config.policies = [PolicyKind::PriorityTrader; 6];
    let mut first = GameArena::default();
    first.prepare(&board, &topology, &rules, &first_config);
    first.setup_for_test(&board, &topology, &rules, &first_config);
    let mut second = GameArena::default();
    second.prepare(&board, &topology, &rules, &second_config);
    second.setup_for_test(&board, &topology, &rules, &second_config);

    assert_eq!(
        first.dice_trace_for_test::<128>(),
        second.dice_trace_for_test::<128>()
    );
}

/// Seats a loaded victim and an empty-handed one on `destination` and readies seat 0's knight.
fn steal_decline_fixture() -> (Topology, SimBoard, RuleConfig, GameConfig, GameArena, u8) {
    let (topology, board, rules) = fixture();
    let config = GameConfig::default();
    let mut arena = GameArena::default();
    arena.prepare(&board, &topology, &rules, &config);
    let destination = other_hex(&topology, arena.state.robber);
    let empty_vertex = topology.hex_vertices(destination)[0];
    let loaded_vertex = topology.hex_vertices(destination)[3];
    arena.state.vertex_owner[usize::from(empty_vertex)] = 1;
    arena.state.vertex_tier[usize::from(empty_vertex)] = 1;
    arena.state.vertex_owner[usize::from(loaded_vertex)] = 2;
    arena.state.vertex_tier[usize::from(loaded_vertex)] = 1;
    arena.state.players[2].resources[Resource::Wood.index()] = 1;
    arena.state.bank[Resource::Wood.index()] -= 1;
    arena.state.players[0].playable_dev[0] = 1;
    (topology, board, rules, config, arena, destination)
}

#[test]
fn naming_an_adjacent_empty_handed_victim_is_legal_and_steals_nothing() {
    let (topology, board, rules, config, mut arena, destination) = steal_decline_fixture();
    let knight = |victim| Action::PlayDev(DevPlay::Knight { destination, victim });

    // The rules let seat 0 decline the steal by naming the empty-handed seat 1, or take it from
    // the loaded seat 2; declining outright stays illegal while a loaded seat is adjacent, and a
    // seat that is not on the hex stays unnameable.
    assert!(arena.validate_action(&board, &topology, 0, knight(Some(1)), DecisionPhase::PreRoll));
    assert!(arena.validate_action(&board, &topology, 0, knight(Some(2)), DecisionPhase::PreRoll));
    assert!(!arena.validate_action(&board, &topology, 0, knight(None), DecisionPhase::PreRoll));
    assert!(!arena.validate_action(&board, &topology, 0, knight(Some(3)), DecisionPhase::PreRoll));

    assert!(arena.apply_action_for_test(
        &board,
        &topology,
        &rules,
        &config,
        0,
        knight(Some(1)),
        DecisionPhase::PreRoll,
    ));
    assert_eq!(arena.state.robber, destination);
    assert_eq!(arena.state.players[0].resources.iter().sum::<i16>(), 0);
    assert_eq!(arena.state.players[1].resources.iter().sum::<i16>(), 0);
    assert_eq!(
        arena.state.players[2].resources.iter().sum::<i16>(),
        1,
        "the declined steal must not touch the loaded seat either"
    );
}

#[test]
fn declining_outright_is_legal_only_when_no_adjacent_seat_holds_cards() {
    let (topology, board, _rules, _config, mut arena, destination) = steal_decline_fixture();
    arena.state.players[2].resources[Resource::Wood.index()] = 0;
    arena.state.bank[Resource::Wood.index()] += 1;
    let knight = |victim| Action::PlayDev(DevPlay::Knight { destination, victim });

    // With every adjacent hand empty there is nothing a steal could move, so both encodings of
    // "steal nothing" are legal: declining outright and naming either empty-handed seat.
    assert!(arena.validate_action(&board, &topology, 0, knight(None), DecisionPhase::PreRoll));
    assert!(arena.validate_action(&board, &topology, 0, knight(Some(1)), DecisionPhase::PreRoll));
    assert!(arena.validate_action(&board, &topology, 0, knight(Some(2)), DecisionPhase::PreRoll));
}

#[test]
fn random_legal_enumerates_the_empty_handed_naming_and_only_legal_actions() {
    let (topology, board, _rules, _config, arena, destination) = steal_decline_fixture();
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let mut rng = Xoshiro256StarStar::from_seed(7);
    let mut buf = ActionBuf::default();
    random_legal::legal_actions(&view, &mut rng, &mut buf);
    let actions: Vec<_> = buf.as_slice().iter().map(|scored| scored.action).collect();

    let knight = |victim| Action::PlayDev(DevPlay::Knight { destination, victim });
    assert!(actions.contains(&knight(Some(1))), "the legal decline must be offered");
    assert!(actions.contains(&knight(Some(2))));
    assert!(!actions.contains(&knight(None)), "declining outright is illegal here");
    for action in actions {
        assert!(
            arena.validate_action(&board, &topology, 0, action, DecisionPhase::Action),
            "random-legal enumerated an illegal action: {action:?}"
        );
    }
}

#[test]
fn rules_can_raise_the_road_limit_beyond_the_base_piece_count() {
    let (topology, board, mut rules) = fixture();
    rules
        .buildables
        .iter_mut()
        .find(|spec| spec.kind == Buildable::Road)
        .unwrap()
        .per_player_limit = 20;
    let config = GameConfig::default();
    let mut arena = GameArena::default();
    arena.prepare(&board, &topology, &rules, &config);
    let (_, roads) = simple_path(&topology, 20, &HashSet::new(), None);
    for edge in roads {
        arena.state.edge_owner[usize::from(edge)] = 0;
    }
    arena.state.players[0].pieces[Buildable::Road.index()] = 0;

    arena.recompute_roads_for_test(&topology, &rules, board.seats());
    assert_eq!(arena.state.players[0].longest_road_len, 20);
}
