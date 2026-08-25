//! The J5 frontier measure (SIM-GAP-28): what building at a vertex actually opens.
//!
//! The degree-valued expansion count this replaces filters a candidate's neighbours on
//! being unowned, but settlement legality already requires every neighbour unowned, so
//! that count is always the vertex's topological degree and discriminates nothing beyond
//! coast versus interior. The frontier instead counts the distinct vertices a settlement
//! here would newly open to the observer:
//!
//! - **newly reachable** — each adjacent unowned vertex the observer's road network does
//!   not already reach, connected through an unowned edge: a new road continuation point;
//! - **newly settleable** — behind each such vertex, the distance-rule-open sites
//!   (`DecisionView::is_expansion_target`) one further unowned edge away that the network
//!   does not already reach.
//!
//! A vertex deep inside the observer's own network scores zero (nothing new is opened),
//! while a vertex on the frontier facing open land scores its whole fan. The vertex graph
//! has girth six (no triangles or 4-cycles), so a distance-2 site is reachable through
//! exactly one counted neighbour and nothing is double-counted.

use crate::view::DecisionView;

/// The number of vertices a settlement at `vertex` newly opens for the observer.
pub fn opened(view: &DecisionView<'_>, vertex: u8) -> f32 {
    let topology = view.topology();
    let mut count = 0_u32;
    for &adjacent in topology.vertex_adjacent(vertex) {
        let Some(edge) = topology.edge_between(vertex, adjacent) else {
            continue;
        };
        if view.edge_owner(edge).is_some()
            || view.vertex_owner(adjacent).is_some()
            || view.road_reaches(adjacent)
        {
            continue;
        }
        count += 1;
        for &beyond in topology.vertex_adjacent(adjacent) {
            if beyond == vertex {
                continue;
            }
            let Some(far) = topology.edge_between(adjacent, beyond) else {
                continue;
            };
            if view.edge_owner(far).is_some() || view.road_reaches(beyond) {
                continue;
            }
            if view.is_expansion_target(beyond) {
                count += 1;
            }
        }
    }
    count as f32
}
