use unsettled_engine::longest_road::{RoadCard, RoadNetwork, longest_road, update_road_card};

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

/// Independent reference: try every start vertex, with no pruning of any kind.
fn brute_force(edges: &[[u8; 2]], blocked: &[bool]) -> u8 {
    fn walk(vertex: u8, edges: &[[u8; 2]], blocked: &[bool], used: u64, arrived: bool) -> u8 {
        let mut best = used.count_ones() as u8;
        if arrived && blocked[usize::from(vertex)] {
            return best;
        }
        for (index, endpoints) in edges.iter().enumerate() {
            let bit = 1_u64 << index;
            if used & bit != 0 {
                continue;
            }
            let other = if endpoints[0] == vertex {
                endpoints[1]
            } else if endpoints[1] == vertex {
                endpoints[0]
            } else {
                continue;
            };
            best = best.max(walk(other, edges, blocked, used | bit, true));
        }
        best
    }
    (0..blocked.len())
        .map(|vertex| walk(vertex as u8, edges, blocked, 0, false))
        .max()
        .unwrap_or(0)
}

/// The search only starts from odd-degree and blocked vertices. That is an argument about maximum
/// trails, not an obvious property, so it is checked exhaustively against a reference that starts
/// everywhere -- over graphs deliberately including cycles, bridges and blocked junctions.
#[test]
fn pruned_search_matches_exhaustive_reference() {
    const VERTICES: usize = 8;
    let all_pairs: Vec<[u8; 2]> = (0..VERTICES)
        .flat_map(|a| (a + 1..VERTICES).map(move |b| [a as u8, b as u8]))
        .collect();
    let mut state = 0x2545_f491_4f6c_dd1d_u64;
    let mut next = || {
        state ^= state << 13;
        state ^= state >> 7;
        state ^= state << 17;
        state
    };
    for _ in 0..3_000 {
        // Vertex degree is capped at three by board geometry, and the network relies on it.
        let mut degree = [0_u8; VERTICES];
        let mut edges = Vec::new();
        for pair in &all_pairs {
            let (a, b) = (usize::from(pair[0]), usize::from(pair[1]));
            if degree[a] < 3 && degree[b] < 3 && next() % 3 == 0 {
                degree[a] += 1;
                degree[b] += 1;
                edges.push(*pair);
            }
        }
        let blocked: Vec<bool> = (0..VERTICES).map(|_| next() % 5 == 0).collect();
        assert_eq!(
            longest_road(&edges, &blocked),
            brute_force(&edges, &blocked),
            "edges {edges:?} blocked {blocked:?}"
        );
    }
}

/// Probing must agree with a full recomputation, and capping must only ever hide lengths at or
/// above the cap -- that is the whole contract the policy's `road_length_cap` relies on.
#[test]
fn probing_agrees_with_full_recomputation_and_respects_the_cap() {
    let mut state = 0x9e37_79b9_7f4a_7c15_u64;
    let mut next = || {
        state ^= state << 13;
        state ^= state >> 7;
        state ^= state << 17;
        state
    };
    for _ in 0..2_000 {
        const VERTICES: usize = 8;
        let mut degree = [0_u8; VERTICES];
        let mut edges = Vec::new();
        for a in 0..VERTICES {
            for b in a + 1..VERTICES {
                if degree[a] < 3 && degree[b] < 3 && next() % 3 == 0 {
                    degree[a] += 1;
                    degree[b] += 1;
                    edges.push([a as u8, b as u8]);
                }
            }
        }
        let blocked: Vec<bool> = (0..VERTICES).map(|_| next() % 6 == 0).collect();
        // Any pair of vertices that is not already a segment stands in for a prospective road.
        let candidates: Vec<[u8; 2]> = (0..VERTICES)
            .flat_map(|a| (a + 1..VERTICES).map(move |b| [a as u8, b as u8]))
            .filter(|pair| !edges.contains(pair) && degree[usize::from(pair[0])] < 3)
            .filter(|pair| degree[usize::from(pair[1])] < 3)
            .collect();
        let mut network = RoadNetwork::from_edges(&edges, &blocked);
        // One segment is the ordinary road; two is the Road Building card, and only the pair
        // exercises rewinding several slots and a probe spanning two components.
        for pair in candidates.windows(2) {
            for segments in [&pair[..1], &pair[..2]] {
                let mut extended = edges.clone();
                extended.extend_from_slice(segments);
                if extended
                    .iter()
                    .flatten()
                    .any(|vertex| extended.iter().flatten().filter(|v| *v == vertex).count() > 3)
                {
                    continue; // Board geometry caps vertex degree at three.
                }
                let exact = longest_road(&extended, &blocked);
                assert_eq!(
                    network.probe(segments, u8::MAX),
                    exact,
                    "probe disagreed with recomputation: {edges:?} + {segments:?}"
                );
                for cap in 1..=exact.saturating_add(1) {
                    let capped = network.probe(segments, cap);
                    if exact < cap {
                        assert_eq!(capped, exact, "cap {cap} changed an answer below it");
                    } else {
                        assert!(capped >= cap, "cap {cap} under-reported as {capped}");
                    }
                }
            }
        }
    }
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
