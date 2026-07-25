use unsettled_engine::topology::{Layout, Topology};
use unsettled_sim::boardgen::generate_board;
use unsettled_sim::schedule::tournament_schedule;

#[test]
fn rotations_balance_every_heuristic_across_every_seat() {
    for seats in 3..=6 {
        for heuristic_count in 2..=7 {
            let schedule = tournament_schedule(1, 1, heuristic_count);
            let mut counts = vec![vec![0; seats]; heuristic_count];
            for entry in schedule {
                for seat in 0..seats {
                    counts[(seat + entry.rotation) % heuristic_count][seat] += 1;
                }
            }
            assert!(counts.iter().flatten().all(|count| *count == 1));
        }
    }
}

#[test]
fn generated_boards_have_physical_multisets_and_nonadjacent_red_tokens() {
    for layout in [Layout::Standard4, Layout::Extension6] {
        let topology = Topology::load(layout).unwrap();
        for seed in 0..500 {
            let board = generate_board(
                layout,
                if layout == Layout::Standard4 { 4 } else { 6 },
                seed,
            )
            .unwrap();
            assert_eq!(board.tiles().len(), topology.hex_count());
            assert_eq!(board.ports().len(), topology.default_port_edges().len());
            for hex in 0..topology.hex_count() {
                if matches!(board.tokens()[hex], Some(6 | 8)) {
                    assert!(
                        topology
                            .hex_neighbors(hex as u8)
                            .iter()
                            .all(|neighbor| !matches!(
                                board.tokens()[usize::from(*neighbor)],
                                Some(6 | 8)
                            ))
                    );
                }
            }
        }
    }
}
