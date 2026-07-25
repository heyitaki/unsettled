#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct RoadCard {
    pub holder: Option<usize>,
    pub retired: bool,
}

pub fn longest_road(edges: &[[u8; 2]], blocked_vertices: &[bool]) -> u8 {
    let mut best = 0;
    for vertex in 0..blocked_vertices.len() {
        dfs(vertex as u8, edges, blocked_vertices, 0, false, &mut best);
    }
    best
}

/// Who holds a "most of X wins" card, given each seat's count.
///
/// Longest Road and Largest Army share this rule exactly: the card goes to the unique leader at or
/// above `minimum`; when the top count is tied nobody takes it, except that an incumbent who is
/// among those tied at the top keeps it (a challenger must strictly exceed the holder). Both cards
/// call this so the tie handling cannot drift apart between them.
pub fn leading_holder(current: Option<usize>, values: &[u8], minimum: u8) -> Option<usize> {
    let best = values.iter().copied().max().unwrap_or_default();
    if best < minimum {
        return None;
    }
    let mut sole_leader = None;
    let mut leader_count = 0_u8;
    for (seat, value) in values.iter().enumerate() {
        if *value == best {
            sole_leader = Some(seat);
            leader_count += 1;
        }
    }
    if leader_count == 1 {
        sole_leader
    } else {
        current.filter(|holder| values.get(*holder) == Some(&best))
    }
}

pub fn update_road_card(card: &mut RoadCard, lengths: &[u8], minimum: u8) {
    card.holder = leading_holder(card.holder, lengths, minimum);
    card.retired = card.holder.is_none();
}

fn dfs(
    vertex: u8,
    edges: &[[u8; 2]],
    blocked_vertices: &[bool],
    used: u128,
    arrived: bool,
    best: &mut u8,
) {
    *best = (*best).max(used.count_ones() as u8);
    if arrived && blocked_vertices[usize::from(vertex)] {
        return;
    }
    for (index, endpoints) in edges.iter().enumerate() {
        let bit = 1_u128 << index;
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
        dfs(other, edges, blocked_vertices, used | bit, true, best);
    }
}
