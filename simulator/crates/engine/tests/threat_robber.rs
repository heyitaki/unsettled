use std::fs;
use std::path::PathBuf;

use unsettled_engine::board::{ConversionOptions, SimBoard};
use unsettled_engine::etw::{self, EtwInputs, expected_turns_to_win};
use unsettled_engine::game::{GameArena, GameConfig};
use unsettled_engine::policy::heuristic_v1::{self, HeuristicParams};
use unsettled_engine::policy::threat::{self, ThreatContext, ThreatParams};
use unsettled_engine::rules::{Buildable, RESOURCE_COUNT, Resource, RuleConfig};
use unsettled_engine::topology::{Layout, Topology};
use unsettled_engine::view::{DecisionPhase, pips};
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

fn place_on_hex(arena: &mut GameArena, topology: &Topology, hex: u8, seat: usize, offset: usize) {
    let vertex = topology.hex_vertices(hex)[offset];
    arena.state.vertex_owner[usize::from(vertex)] = seat as u8;
    arena.state.vertex_tier[usize::from(vertex)] = 1;
}

fn equal_pip_pair(board: &SimBoard, topology: &Topology, resource: Option<Resource>) -> (u8, u8) {
    for low in 0..topology.hex_count() {
        for high in low + 1..topology.hex_count() {
            let low = low as u8;
            let high = high as u8;
            let low_token = board.tokens()[usize::from(low)];
            let high_token = board.tokens()[usize::from(high)];
            if low_token.is_none()
                || low_token.map(pips) != high_token.map(pips)
                || resource.is_some_and(|value| {
                    board.tiles()[usize::from(low)] != Some(value)
                        || board.tiles()[usize::from(high)] != Some(value)
                })
                || topology
                    .hex_vertices(low)
                    .iter()
                    .any(|vertex| topology.hex_vertices(high).contains(vertex))
            {
                continue;
            }
            return (low, high);
        }
    }
    panic!("fixture needs two separated equal-pip hexes");
}

fn dominant_offset(board: &SimBoard, topology: &Topology, hex: u8) -> Option<usize> {
    topology
        .hex_vertices(hex)
        .iter()
        .enumerate()
        .find_map(|(offset, _)| offset_is_dominant(board, topology, hex, offset).then_some(offset))
}

fn offset_is_dominant(board: &SimBoard, topology: &Topology, hex: u8, offset: usize) -> bool {
    let target_pips = board.tokens()[usize::from(hex)].map_or(0, pips);
    topology
        .vertex_hexes(topology.hex_vertices(hex)[offset])
        .iter()
        .all(|adjacent| {
            let adjacent_pips = board.tokens()[usize::from(*adjacent)].map_or(0, pips);
            adjacent_pips < target_pips || (adjacent_pips == target_pips && *adjacent >= hex)
        })
}

fn dominant_equal_pip_pair(
    board: &SimBoard,
    topology: &Topology,
    resource: Resource,
) -> (u8, usize, u8, usize) {
    for low in 0..topology.hex_count() {
        for high in low + 1..topology.hex_count() {
            let low = low as u8;
            let high = high as u8;
            if board.tiles()[usize::from(low)] != Some(resource)
                || board.tiles()[usize::from(high)] != Some(resource)
                || board.tokens()[usize::from(low)].map(pips)
                    != board.tokens()[usize::from(high)].map(pips)
            {
                continue;
            }
            if let (Some(low_offset), Some(high_offset)) = (
                dominant_offset(board, topology, low),
                dominant_offset(board, topology, high),
            ) {
                return (low, low_offset, high, high_offset);
            }
        }
    }
    panic!("fixture needs dominant separated equal-pip resource hexes");
}

fn two_dominant_offsets(board: &SimBoard, topology: &Topology, hex: u8) -> Option<[usize; 2]> {
    let mut offsets = (0..6).filter(|offset| offset_is_dominant(board, topology, hex, *offset));
    Some([offsets.next()?, offsets.next()?])
}

fn dominant_hex_with_two_offsets(board: &SimBoard, topology: &Topology) -> (u8, [usize; 2]) {
    (0..topology.hex_count())
        .map(|hex| hex as u8)
        .filter(|hex| board.tokens()[usize::from(*hex)].is_some())
        .find_map(|hex| two_dominant_offsets(board, topology, hex).map(|offsets| (hex, offsets)))
        .expect("fixture needs a hex with two dominant vertices")
}

fn dominant_tie_pair(board: &SimBoard, topology: &Topology) -> (u8, [usize; 2], u8, [usize; 2]) {
    for low in 0..topology.hex_count() {
        for high in low + 1..topology.hex_count() {
            let low = low as u8;
            let high = high as u8;
            if board.tokens()[usize::from(low)].map(pips)
                != board.tokens()[usize::from(high)].map(pips)
                || topology
                    .hex_vertices(low)
                    .iter()
                    .any(|vertex| topology.hex_vertices(high).contains(vertex))
            {
                continue;
            }
            if let (Some(low_offsets), Some(high_offsets)) = (
                two_dominant_offsets(board, topology, low),
                two_dominant_offsets(board, topology, high),
            ) {
                return (low, low_offsets, high, high_offsets);
            }
        }
    }
    panic!("fixture needs two equal-pip hexes with two dominant vertices each");
}

fn dominant_increasing_pip_pair(board: &SimBoard, topology: &Topology) -> (u8, usize, u8, usize) {
    for low in 0..topology.hex_count() {
        for high in low + 1..topology.hex_count() {
            let low = low as u8;
            let high = high as u8;
            let Some(low_pips) = board.tokens()[usize::from(low)].map(pips) else {
                continue;
            };
            let Some(high_pips) = board.tokens()[usize::from(high)].map(pips) else {
                continue;
            };
            if low_pips >= high_pips
                || topology
                    .hex_vertices(low)
                    .iter()
                    .any(|vertex| topology.hex_vertices(high).contains(vertex))
            {
                continue;
            }
            if let (Some(low_offset), Some(high_offset)) = (
                dominant_offset(board, topology, low),
                dominant_offset(board, topology, high),
            ) {
                return (low, low_offset, high, high_offset);
            }
        }
    }
    panic!("fixture needs a lower-index, lower-pip dominant pair");
}

fn dominant_multi_victim_pair(
    board: &SimBoard,
    topology: &Topology,
) -> (u8, [usize; 2], u8, usize) {
    for multi in 0..topology.hex_count() {
        for single in multi + 1..topology.hex_count() {
            let multi = multi as u8;
            let single = single as u8;
            if board.tokens()[usize::from(multi)].map(pips)
                != board.tokens()[usize::from(single)].map(pips)
                || topology
                    .hex_vertices(multi)
                    .iter()
                    .any(|vertex| topology.hex_vertices(single).contains(vertex))
            {
                continue;
            }
            let multi_offsets = (0..6)
                .filter(|offset| offset_is_dominant(board, topology, multi, *offset))
                .collect::<Vec<_>>();
            for first in 0..multi_offsets.len() {
                for second in first + 1..multi_offsets.len() {
                    let offsets = [multi_offsets[first], multi_offsets[second]];
                    let first_hexes =
                        topology.vertex_hexes(topology.hex_vertices(multi)[offsets[0]]);
                    let second_hexes =
                        topology.vertex_hexes(topology.hex_vertices(multi)[offsets[1]]);
                    if first_hexes
                        .iter()
                        .filter(|hex| second_hexes.contains(hex))
                        .any(|hex| *hex != multi)
                    {
                        continue;
                    }
                    for single_offset in 0..6 {
                        if !offset_is_dominant(board, topology, single, single_offset) {
                            continue;
                        }
                        let single_hexes =
                            topology.vertex_hexes(topology.hex_vertices(single)[single_offset]);
                        if single_hexes
                            .iter()
                            .any(|hex| first_hexes.contains(hex) || second_hexes.contains(hex))
                        {
                            continue;
                        }
                        return (multi, offsets, single, single_offset);
                    }
                }
            }
        }
    }
    panic!("fixture needs isolated multi-victim and single-victim hexes");
}

fn city_and_unused_pair(board: &SimBoard, topology: &Topology) -> (u8, usize, u8, usize) {
    for unused in 0..topology.hex_count() {
        for needed in unused + 1..topology.hex_count() {
            let unused = unused as u8;
            let needed = needed as u8;
            if board.tiles()[usize::from(unused)] != Some(Resource::Brick)
                || board.tiles()[usize::from(needed)] != Some(Resource::Wheat)
                || board.tokens()[usize::from(unused)].map(pips)
                    != board.tokens()[usize::from(needed)].map(pips)
                || topology
                    .hex_vertices(unused)
                    .iter()
                    .any(|vertex| topology.hex_vertices(needed).contains(vertex))
            {
                continue;
            }
            if let (Some(unused_offset), Some(needed_offset)) = (
                dominant_offset(board, topology, unused),
                dominant_offset(board, topology, needed),
            ) {
                return (unused, unused_offset, needed, needed_offset);
            }
        }
    }
    panic!("fixture needs a lower brick and higher equal-pip wheat");
}

fn set_belief_and_hand(arena: &mut GameArena, seat: usize, cards: [u16; RESOURCE_COUNT]) {
    arena.state.players[seat].resources = cards.map(|count| i16::try_from(count).unwrap());
    for (resource, count) in cards.into_iter().enumerate() {
        if count > 0 {
            arena.state.belief.gain(seat, resource, count);
        }
    }
}

fn make_stalled_leader(arena: &mut GameArena, seat: usize) {
    arena.state.players[seat].vp_public = 8;
    arena.state.players[seat].pieces[Buildable::Settlement.index()] = 0;
    arena.state.players[seat].pieces[Buildable::City.index()] = 0;
}

fn make_city_runner(arena: &mut GameArena, seat: usize) {
    arena.state.players[seat].vp_public = 7;
    arena.state.players[seat].pieces[Buildable::City.index()] = 4;
}

#[test]
fn threat_robber_prefers_the_hex_that_most_delays_the_nearest_winner() {
    let (topology, board, _rules, _config, mut arena) = fixture();
    let (leader_hex, leader_offset, dangerous_hex, dangerous_offset) =
        dominant_equal_pip_pair(&board, &topology, Resource::Brick);
    place_on_hex(&mut arena, &topology, leader_hex, 1, leader_offset);
    place_on_hex(&mut arena, &topology, dangerous_hex, 2, dangerous_offset);
    make_stalled_leader(&mut arena, 1);
    make_city_runner(&mut arena, 2);

    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let params = ThreatParams::default();
    let context = threat::context(&view, &params);
    let leader_terms = threat::seat_terms(&view, &params, &context, leader_hex, 1);
    let dangerous_terms = threat::seat_terms(&view, &params, &context, dangerous_hex, 2);
    assert_eq!(leader_terms.need, 0.0);
    assert_eq!(dangerous_terms.need, 0.0);
    assert_eq!(leader_terms.block, dangerous_terms.block);
    assert_eq!(leader_terms.steal, 0.0);
    assert_eq!(dangerous_terms.steal, 0.0);
    assert_eq!(threat::robber(&view, &params).0, dangerous_hex);
    assert_eq!(
        heuristic_v1::robber(&view, &HeuristicParams::default()).0,
        leader_hex
    );
}

#[test]
fn threat_baseline_and_hypothetical_production_are_robber_free() {
    let (topology, board, _rules, _config, mut arena) = fixture();
    let current = (0..topology.hex_count())
        .map(|hex| hex as u8)
        .find(|hex| board.tiles()[usize::from(*hex)].is_some())
        .unwrap();
    arena.state.robber = current;
    let candidate = (0..topology.hex_count())
        .map(|hex| hex as u8)
        .find(|hex| *hex != current && board.tiles()[usize::from(*hex)].is_some())
        .unwrap();
    place_on_hex(&mut arena, &topology, current, 1, 0);
    place_on_hex(&mut arena, &topology, candidate, 1, 0);
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let visible = view.production_pips(1);
    let restored = threat::hex_contribution(&view, current, 1);
    let free = threat::robber_free_production_pips(&view, 1);
    assert_eq!(
        free,
        std::array::from_fn(|resource| visible[resource] + restored[resource])
    );
    let restored_resource = board.tiles()[usize::from(current)].unwrap().index();
    assert!(free[restored_resource] > visible[restored_resource]);
    let blocked = threat::hex_contribution(&view, candidate, 1);
    assert_eq!(
        threat::hypothetical_production_pips(&view, candidate, 1),
        std::array::from_fn(|resource| free[resource] - blocked[resource])
    );
}

#[test]
fn threat_context_uses_the_robber_free_production_baseline() {
    let (topology, board, _rules, _config, mut arena) = fixture();
    let current = (0..topology.hex_count())
        .map(|hex| hex as u8)
        .find(|hex| board.tiles()[usize::from(*hex)].is_some())
        .unwrap();
    arena.state.robber = current;
    place_on_hex(&mut arena, &topology, current, 1, 0);

    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let params = ThreatParams::default();
    let context = threat::context(&view, &params);
    let free = threat::robber_free_production_pips(&view, 1);
    let visible = view.production_pips(1);
    let restored_resource = board.tiles()[usize::from(current)].unwrap().index();
    assert_eq!(context.free_pips[1], free);
    assert!(context.free_pips[1][restored_resource] > visible[restored_resource]);

    let mut inputs = etw::inputs_for_seat(&view, 1);
    inputs.production_pips = free;
    assert_eq!(context.etw_free[1], etw::expected_turns_to_win(&inputs));
}

#[test]
fn threat_robber_prefers_blocking_a_resource_the_victim_still_needs() {
    let (topology, board, mut rules, config, mut arena) = fixture();
    rules.dev_deck.victory_point = 0;
    arena.prepare(&board, &topology, &rules, &config);
    let (unused, unused_offset, needed, needed_offset) = city_and_unused_pair(&board, &topology);
    place_on_hex(&mut arena, &topology, unused, 1, unused_offset);
    place_on_hex(&mut arena, &topology, needed, 1, needed_offset);
    make_city_runner(&mut arena, 1);
    set_belief_and_hand(&mut arena, 1, [0, 1, 1, 0, 1]);

    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let params = ThreatParams::default();
    let context = threat::context(&view, &params);
    let mut expected = [0.0; RESOURCE_COUNT];
    expected[Resource::Wheat.index()] = 1.0 / 3.0;
    expected[Resource::Ore.index()] = 2.0 / 3.0;
    assert_eq!(context.need[1], expected);
    assert_eq!(threat::robber(&view, &params).0, needed);
}

#[test]
fn threat_victim_is_the_most_dangerous_card_holder_not_the_public_vp_leader() {
    let (topology, board, _rules, _config, mut arena) = fixture();
    let (target, offsets) = dominant_hex_with_two_offsets(&board, &topology);
    place_on_hex(&mut arena, &topology, target, 1, offsets[0]);
    place_on_hex(&mut arena, &topology, target, 2, offsets[1]);
    make_stalled_leader(&mut arena, 1);
    make_city_runner(&mut arena, 2);
    set_belief_and_hand(&mut arena, 1, [1, 0, 0, 0, 0]);
    set_belief_and_hand(&mut arena, 2, [1, 0, 0, 0, 0]);

    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let params = ThreatParams::default();
    assert_eq!(threat::robber(&view, &params), (target, Some(2)));
    assert_eq!(
        heuristic_v1::robber(&view, &HeuristicParams::default()),
        (target, Some(1))
    );
}

#[test]
fn threat_robber_never_names_an_empty_handed_victim() {
    let (topology, board, _rules, _config, mut arena) = fixture();
    let (target, offsets) = dominant_hex_with_two_offsets(&board, &topology);
    place_on_hex(&mut arena, &topology, target, 1, offsets[0]);
    place_on_hex(&mut arena, &topology, target, 2, offsets[1]);
    make_city_runner(&mut arena, 1);
    arena.state.players[1].vp_public = 9;
    make_stalled_leader(&mut arena, 2);
    arena.state.players[2].vp_public = 2;
    set_belief_and_hand(&mut arena, 2, [1, 0, 0, 0, 0]);

    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let params = ThreatParams::default();
    let context = threat::context(&view, &params);
    let hand_bonus = params.victim_hand_weight * f64::from(view.hand_total(2)).min(params.hand_cap)
        / params.hand_cap;
    assert!(context.danger[1] > context.danger[2] + hand_bonus);
    assert_eq!(threat::robber(&view, &params), (target, Some(2)));
}

#[test]
fn threat_robber_breaks_hex_and_victim_ties_toward_the_lowest_index() {
    let (topology, board, mut rules, config, mut arena) = fixture();
    rules.dev_deck.victory_point = 0;
    arena.prepare(&board, &topology, &rules, &config);
    let (low, low_offsets, high, high_offsets) = dominant_tie_pair(&board, &topology);
    for (hex, offsets) in [(low, low_offsets), (high, high_offsets)] {
        place_on_hex(&mut arena, &topology, hex, 1, offsets[0]);
        place_on_hex(&mut arena, &topology, hex, 2, offsets[1]);
    }
    for seat in [1, 2] {
        arena.state.players[seat].vp_public = 10;
        arena.state.players[seat].pieces[Buildable::Settlement.index()] = 0;
        arena.state.players[seat].pieces[Buildable::City.index()] = 0;
        set_belief_and_hand(&mut arena, seat, [1, 0, 0, 0, 0]);
    }
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    assert_eq!(
        threat::robber(&view, &ThreatParams::default()),
        (low, Some(1))
    );
}

#[test]
fn threat_hex_score_uses_only_the_best_available_steal() {
    let (topology, board, _rules, _config, mut arena) = fixture();
    let (multi, multi_offsets, single, single_offset) =
        dominant_multi_victim_pair(&board, &topology);
    place_on_hex(&mut arena, &topology, multi, 1, multi_offsets[0]);
    place_on_hex(&mut arena, &topology, multi, 2, multi_offsets[1]);
    place_on_hex(&mut arena, &topology, single, 3, single_offset);
    for seat in [1, 2] {
        make_stalled_leader(&mut arena, seat);
        set_belief_and_hand(&mut arena, seat, [8, 0, 0, 0, 0]);
    }
    make_city_runner(&mut arena, 3);
    set_belief_and_hand(&mut arena, 3, [1, 0, 0, 0, 0]);

    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let mut params = ThreatParams {
        need_weight: 0.0,
        block_weight: 0.0,
        steal_weight: 1.0,
        victim_hand_weight: 8.0,
        ..ThreatParams::default()
    };
    let context = threat::context(&view, &params);
    let first = threat::seat_terms(&view, &params, &context, multi, 1);
    let second = threat::seat_terms(&view, &params, &context, multi, 2);
    let competing = threat::seat_terms(&view, &params, &context, single, 3);
    let multi_base =
        first.delay + first.need + first.block + second.delay + second.need + second.block;
    let competing_base = competing.delay + competing.need + competing.block;
    let gap = competing_base - multi_base;
    assert!(gap > 0.0);
    assert!(first.steal + second.steal > competing.steal);
    assert!(first.steal.max(second.steal) > competing.steal);

    let summed_flip = gap / (first.steal + second.steal - competing.steal);
    let maximum_limit = gap / (first.steal.max(second.steal) - competing.steal);
    assert!(summed_flip < maximum_limit);
    params.steal_weight = (summed_flip + maximum_limit) / 2.0;

    let context = threat::context(&view, &params);
    let first = threat::seat_terms(&view, &params, &context, multi, 1);
    let second = threat::seat_terms(&view, &params, &context, multi, 2);
    let competing = threat::seat_terms(&view, &params, &context, single, 3);
    assert!(multi_base + first.steal.max(second.steal) < competing_base + competing.steal);
    assert!(multi_base + first.steal + second.steal > competing_base + competing.steal);
    assert_eq!(threat::robber(&view, &params).0, single);
}

#[test]
fn threat_hex_score_uses_the_highest_ranked_steal_regardless_of_seat_order() {
    let (topology, board, _rules, _config, mut arena) = fixture();
    let (multi, multi_offsets, single, single_offset) =
        dominant_multi_victim_pair(&board, &topology);
    place_on_hex(&mut arena, &topology, multi, 1, multi_offsets[0]);
    place_on_hex(&mut arena, &topology, multi, 2, multi_offsets[1]);
    place_on_hex(&mut arena, &topology, single, 3, single_offset);
    for seat in [1, 2, 3] {
        make_stalled_leader(&mut arena, seat);
    }
    set_belief_and_hand(&mut arena, 1, [8, 0, 0, 0, 0]);
    set_belief_and_hand(&mut arena, 2, [1, 0, 0, 0, 0]);
    set_belief_and_hand(&mut arena, 3, [4, 0, 0, 0, 0]);

    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let params = ThreatParams {
        delay_weight: 0.0,
        need_weight: 0.0,
        steal_weight: 10.0,
        victim_hand_weight: 1.0,
        ..ThreatParams::default()
    };
    let context = threat::context(&view, &params);
    let first = threat::seat_terms(&view, &params, &context, multi, 1);
    let last = threat::seat_terms(&view, &params, &context, multi, 2);
    let competing = threat::seat_terms(&view, &params, &context, single, 3);
    assert!(first.steal > competing.steal);
    assert!(competing.steal > last.steal);
    assert_eq!(threat::robber(&view, &params).0, multi);
}

#[cfg(debug_assertions)]
#[test]
#[should_panic(expected = "params.hand_cap.is_finite() && params.hand_cap > 0.0")]
fn threat_seat_terms_rejects_invalid_params() {
    let (topology, board, _rules, _config, mut arena) = fixture();
    let target = dominant_hex_with_two_offsets(&board, &topology).0;
    place_on_hex(&mut arena, &topology, target, 1, 0);
    set_belief_and_hand(&mut arena, 1, [1, 0, 0, 0, 0]);

    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let context = threat::context(&view, &ThreatParams::default());
    let params = ThreatParams {
        hand_cap: 0.0,
        ..ThreatParams::default()
    };
    let _ = threat::seat_terms(&view, &params, &context, target, 1);
}

#[test]
fn threat_hex_score_keeps_the_unscaled_block_floor() {
    let (topology, board, _rules, _config, mut arena) = fixture();
    let (low, low_offset, high, high_offset) = dominant_increasing_pip_pair(&board, &topology);
    place_on_hex(&mut arena, &topology, low, 1, low_offset);
    place_on_hex(&mut arena, &topology, high, 2, high_offset);
    make_stalled_leader(&mut arena, 1);
    make_stalled_leader(&mut arena, 2);

    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let params = ThreatParams {
        delay_weight: 0.0,
        need_weight: 0.0,
        steal_weight: 0.0,
        ..ThreatParams::default()
    };
    let context = threat::context(&view, &params);
    let low_terms = threat::seat_terms(&view, &params, &context, low, 1);
    let high_terms = threat::seat_terms(&view, &params, &context, high, 2);
    assert_eq!(low_terms.delay, high_terms.delay);
    assert_eq!(low_terms.need, high_terms.need);
    assert_eq!(low_terms.steal, high_terms.steal);
    assert!(high_terms.block > low_terms.block);
    assert_eq!(threat::robber(&view, &params).0, high);
}

#[test]
fn threat_robber_never_blocks_the_observers_own_production() {
    let (topology, board, _rules, _config, mut arena) = fixture();
    let (target, offsets) = dominant_hex_with_two_offsets(&board, &topology);
    place_on_hex(&mut arena, &topology, target, 0, offsets[0]);
    place_on_hex(&mut arena, &topology, target, 1, offsets[1]);
    make_city_runner(&mut arena, 1);

    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    assert_ne!(threat::robber(&view, &ThreatParams::default()).0, target);
}

#[test]
fn threat_robber_falls_back_to_the_first_other_hex_when_every_hex_touches_the_observer() {
    let (topology, board, _rules, _config, mut arena) = fixture();
    for vertex in 0..topology.vertex_count() {
        arena.state.vertex_owner[vertex] = 0;
        arena.state.vertex_tier[vertex] = 1;
    }
    let current = arena.state.robber;
    let expected = (0..topology.hex_count())
        .map(|hex| hex as u8)
        .find(|hex| *hex != current)
        .unwrap();
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    assert_eq!(
        threat::robber(&view, &ThreatParams::default()),
        (expected, None)
    );
}

#[test]
fn threat_robber_ignores_hidden_composition_of_identical_public_streams() {
    let (topology, board, _rules, _config, mut first) = fixture();
    let target = equal_pip_pair(&board, &topology, Some(Resource::Brick)).0;
    place_on_hex(&mut first, &topology, target, 1, 0);
    first.state.belief.gain(1, Resource::Wood.index(), 2);
    let mut second = first.clone();
    first.state.players[1].resources = [2, 0, 0, 0, 0];
    second.state.players[1].resources = [0, 0, 0, 0, 2];
    let first_view = first.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let second_view = second.decision_view(&board, &topology, 0, DecisionPhase::Action);
    assert_eq!(
        threat::robber(&first_view, &ThreatParams::default()),
        threat::robber(&second_view, &ThreatParams::default())
    );
}

#[test]
fn default_heuristic_params_keep_todays_robber_rule() {
    let (topology, board, _rules, _config, mut arena) = fixture();
    let target = (0..topology.hex_count())
        .map(|hex| hex as u8)
        .filter(|hex| *hex != arena.state.robber)
        .max_by_key(|hex| board.tokens()[usize::from(*hex)].map_or(0, pips))
        .unwrap();
    place_on_hex(&mut arena, &topology, target, 1, 0);
    arena.state.players[1].vp_public = 8;
    set_belief_and_hand(&mut arena, 1, [1, 0, 0, 0, 0]);
    let params = HeuristicParams::default();
    assert!(params.threat.is_none());
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    assert_eq!(heuristic_v1::robber(&view, &params), (target, Some(1)));
}

fn representative_inputs() -> EtwInputs {
    EtwInputs {
        win_vp: 10,
        public_vp: 7,
        dev_count: 0,
        all_seats_dev_count_sum: 0,
        dev_deck_remaining: 0,
        dev_victory_points: 5,
        production_pips: [3, 3, 3, 3, 8],
        pieces_settlement: 0,
        pieces_city: 4,
        settlements_on_board: 1,
        settlement_cost: Some([1, 1, 1, 1, 0]),
        city_cost: Some([0, 0, 2, 0, 3]),
        road_cost: Some([1, 0, 0, 1, 0]),
        dev_cost: Some([0, 1, 1, 0, 1]),
        settlement_vp: 1,
        city_vp: 2,
        trade_rates: [2, 4, 4, 4, 4],
        belief_expected: [3.0, 0.0, 2.0, 3.0, 0.0],
        hand_total: 8,
    }
}

#[test]
fn etw_production_income_is_resource_blind() {
    let first = representative_inputs();
    let mut second = first.clone();
    second.production_pips.rotate_left(2);
    assert_eq!(
        expected_turns_to_win(&first),
        expected_turns_to_win(&second)
    );
}

#[test]
fn threat_term_magnitudes_match_the_representative_table() {
    let (topology, board, _rules, _config, mut arena) = fixture();
    let hex = (0..topology.hex_count())
        .map(|hex| hex as u8)
        .find(|hex| {
            board.tiles()[usize::from(*hex)] == Some(Resource::Ore)
                && board.tokens()[usize::from(*hex)].map(pips) == Some(5)
        })
        .unwrap();
    place_on_hex(&mut arena, &topology, hex, 1, 0);
    set_belief_and_hand(&mut arena, 1, [3, 0, 2, 3, 0]);
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let params = ThreatParams::default();
    let inputs = representative_inputs();
    let etw_free = expected_turns_to_win(&inputs);
    assert!((etw_free - 26.1).abs() < 1e-9);

    for danger in [1.0, 0.3, 0.05] {
        let mut context = ThreatContext {
            inputs: [const { None }; 6],
            free_pips: [[0; RESOURCE_COUNT]; 6],
            etw_free: [0.0; 6],
            danger: [0.0; 6],
            need: [[0.0; RESOURCE_COUNT]; 6],
        };
        context.inputs[1] = Some(inputs.clone());
        context.free_pips[1] = inputs.production_pips;
        context.etw_free[1] = etw_free;
        context.danger[1] = danger;
        context.need[1][Resource::Ore.index()] = 1.0;
        let terms = threat::seat_terms(&view, &params, &context, hex, 1);
        match danger {
            1.0 => {
                assert!(terms.delay > terms.need);
                assert!(terms.need > terms.block);
                assert!(terms.block > terms.steal);
                assert!(terms.delay > terms.need + terms.block + terms.steal);
            }
            0.3 => {
                assert!(terms.delay > terms.block);
                assert!(terms.block > terms.need);
                assert!(terms.need > terms.steal);
            }
            _ => {
                assert!(terms.block > terms.delay);
                assert!(terms.steal > terms.need);
            }
        }
    }
}
