use unsettled_engine::game::{
    apply_production, can_build_road, can_place_settlement, setup_order, trade_bank,
    update_largest_army,
};
use unsettled_engine::rules::Resource;
use unsettled_engine::state::EMPTY;
use unsettled_engine::topology::{Layout, Topology};

#[test]
fn setup_snake_order_matches_the_app() {
    for seats in 3..=6 {
        let expected: Vec<_> = (0..seats)
            .chain((0..seats).rev())
            .map(|seat| seat as u8)
            .collect();
        assert_eq!(setup_order(seats), expected);
    }
}

#[test]
fn distance_rule_blocks_adjacent_vertices() {
    let topology = Topology::load(Layout::Standard4).unwrap();
    let mut owners = [EMPTY; 80];
    let occupied = 0_u8;
    owners[usize::from(occupied)] = 0;
    let adjacent = topology.vertex_adjacent(occupied)[0];
    assert!(!can_place_settlement(&topology, &owners, adjacent));
    let free = (0..topology.vertex_count())
        .map(|vertex| vertex as u8)
        .find(|vertex| !topology.vertex_adjacent(occupied).contains(vertex) && *vertex != occupied)
        .unwrap();
    assert!(can_place_settlement(&topology, &owners, free));
}

#[test]
fn road_legality_covers_q39_and_q40() {
    let topology = Topology::load(Layout::Standard4).unwrap();
    let mut vertices = [EMPTY; 80];
    let mut edges = [EMPTY; 109];
    let junction = 10_u8;
    let incident = topology.vertex_edges(junction);
    edges[usize::from(incident[0])] = 0;
    vertices[usize::from(junction)] = 1;
    assert!(!can_build_road(
        &topology,
        &vertices,
        &edges,
        0,
        incident[1],
        1
    ));
    assert!(can_build_road(
        &topology,
        &vertices,
        &edges,
        1,
        incident[1],
        1
    ));

    vertices[usize::from(junction)] = EMPTY;
    assert!(can_build_road(
        &topology,
        &vertices,
        &edges,
        0,
        incident[1],
        1
    ));
    assert!(!can_build_road(
        &topology,
        &vertices,
        &edges,
        0,
        incident[1],
        0
    ));
}

#[test]
fn bank_shortage_starves_multiple_recipients_but_not_one() {
    let mut bank = [0_u16; 5];
    bank[Resource::Wood.index()] = 3;
    let mut hands = [[0_i16; 5]; 6];
    let mut demand = [[0_u8; 5]; 6];
    demand[0][Resource::Wood.index()] = 2;
    demand[1][Resource::Wood.index()] = 2;
    apply_production(&mut bank, &mut hands, &demand, 2);
    assert_eq!(hands[0][0] + hands[1][0], 0);
    assert_eq!(bank[0], 3);

    demand[1][0] = 0;
    demand[0][0] = 5;
    apply_production(&mut bank, &mut hands, &demand, 2);
    assert_eq!(hands[0][0], 3);
    assert_eq!(bank[0], 0);
}

#[test]
fn bank_trade_rejects_like_for_like_and_refunds_supply() {
    let mut hand = [0_i16; 5];
    hand[0] = 4;
    let mut bank = [19_u16; 5];
    bank[0] -= 4;
    assert!(!trade_bank(
        &mut hand,
        &mut bank,
        Resource::Wood,
        Resource::Wood,
        4,
        1
    ));
    assert!(trade_bank(
        &mut hand,
        &mut bank,
        Resource::Wood,
        Resource::Ore,
        4,
        1
    ));
    assert_eq!(hand, [0, 0, 0, 0, 1]);
    assert_eq!(bank, [19, 19, 19, 19, 18]);
}

#[test]
fn largest_army_state_machine_holds() {
    let mut holder = None;
    update_largest_army(&mut holder, &[3, 2, 0], 3);
    assert_eq!(holder, Some(0));
    update_largest_army(&mut holder, &[3, 3, 0], 3);
    assert_eq!(holder, Some(0));
    update_largest_army(&mut holder, &[3, 4, 0], 3);
    assert_eq!(holder, Some(1));
}
