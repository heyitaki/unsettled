use unsettled_engine::longest_road::{RoadCard, longest_road, update_road_card};

#[test]
fn edge_simple_trails_count_cycles_and_tails() {
    let cycle = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0]];
    assert_eq!(longest_road(&cycle, &[false; 6]), 6);
    let tail = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0], [0, 6]];
    assert_eq!(longest_road(&tail, &[false; 7]), 7);
}

#[test]
fn blocked_junction_can_end_but_not_traverse() {
    let edges = [[0, 1], [1, 2], [2, 3], [3, 4]];
    let mut blocked = [false; 5];
    blocked[2] = true;
    assert_eq!(longest_road(&edges, &blocked), 2);
}

#[test]
fn q27_q28_card_state_machine_is_explicit() {
    let mut card = RoadCard::default();
    update_road_card(&mut card, &[5, 4, 0], 5);
    assert_eq!(card.holder, Some(0));
    update_road_card(&mut card, &[5, 5, 0], 5);
    assert_eq!(card.holder, Some(0), "tie stays with holder");
    update_road_card(&mut card, &[4, 5, 5], 5);
    assert_eq!(card.holder, None);
    assert!(card.retired);
    update_road_card(&mut card, &[4, 6, 5], 5);
    assert_eq!(card.holder, Some(1));
    assert!(!card.retired);
}
