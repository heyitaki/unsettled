use crate::state::{EMPTY, MAX_EDGES, MAX_VERTICES};
use crate::topology::{Edge, Topology, Vertex};

/// Prospective segments a caller may splice onto an owned network at once. Road building lays two.
const PROBE_CAPACITY: usize = 2;
const MAX_TRAIL_EDGES: usize = MAX_EDGES + PROBE_CAPACITY;
/// The search marks used segments in a `u128`, and floods components through a `u128` vertex set.
const _: () = assert!(MAX_TRAIL_EDGES <= u128::BITS as usize);
const _: () = assert!(MAX_VERTICES <= u128::BITS as usize);
/// Board geometry gives every vertex two or three incident edges.
const MAX_VERTEX_DEGREE: usize = 3;

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct RoadCard {
    pub holder: Option<usize>,
    pub retired: bool,
}

/// A seat's road graph, held as adjacency lists and searched for its longest edge-simple trail.
///
/// The trail search is exponential in the worst case, so what it walks matters more than anything
/// else in the hot loop. Two properties keep it affordable:
///
/// * Adjacency. Following the two or three edges at a vertex beats rescanning every edge on the
///   board, which is what a flat edge list forces at every step of every branch.
/// * Incremental probing. [`RoadNetwork::probe`] splices candidate segments in, searches only the
///   component they touch, and rolls back. Every other component is untouched, and a trail never
///   leaves its component, so those cannot beat the base length already measured. Scoring every
///   legal road for a seat therefore costs one full search plus one small search per candidate,
///   not a full search per candidate.
///
/// A probed segment is assumed not to be owned already; laying a road the seat holds is not a
/// legal action, and the graph would gain a parallel edge if it were.
pub struct RoadNetwork {
    endpoints: [[Vertex; 2]; MAX_TRAIL_EDGES],
    /// Slot indices into `endpoints`, grouped by the vertex they touch.
    incident: [[u8; MAX_VERTEX_DEGREE]; MAX_VERTICES],
    degree: [u8; MAX_VERTICES],
    /// Vertices an opponent building occupies: a trail may end there but not pass through.
    blocked: [bool; MAX_VERTICES],
    /// Vertices with at least one segment, as a bitset, so start selection skips the empty board.
    occupied: u128,
    len: usize,
    /// Segments the seat owns, below any probe currently spliced on.
    owned: usize,
    base: u8,
}

impl RoadNetwork {
    /// The observer's own segments, with opposing buildings marked as blocking junctions.
    pub fn for_seat(
        topology: &Topology,
        vertex_owner: &[u8],
        edge_owner: &[u8],
        seat: u8,
    ) -> Self {
        let mut network = Self::empty();
        for vertex in 0..topology.vertex_count() {
            let owner = vertex_owner[vertex];
            network.blocked[vertex] = owner != EMPTY && owner != seat;
        }
        for edge in 0..topology.edge_count() {
            if edge_owner[edge] == seat {
                network.push(topology.edge_endpoints(edge as Edge));
            }
        }
        network.sealed()
    }

    pub fn from_edges(edges: &[[Vertex; 2]], blocked_vertices: &[bool]) -> Self {
        let mut network = Self::empty();
        network.blocked[..blocked_vertices.len()].copy_from_slice(blocked_vertices);
        for pair in edges {
            network.push(*pair);
        }
        network.sealed()
    }

    /// Longest trail over the owned segments alone.
    pub const fn base_length(&self) -> u8 {
        self.base
    }

    /// Longest trail the seat would hold after laying `segments`, leaving the network unchanged.
    ///
    /// `cap` is the longest trail the caller can still tell apart: the search stops as soon as it
    /// reaches that length, and the answer is then only guaranteed to be at least `cap`. Pass
    /// [`u8::MAX`] for the exact length. Capping is what keeps a long late-game network affordable,
    /// since the deepest branches are also the most expensive ones to walk.
    pub fn probe(&mut self, segments: &[[Vertex; 2]], cap: u8) -> u8 {
        let probed = self.len;
        for pair in segments {
            self.push(*pair);
        }
        let best = self.longest_trail_through(probed, cap);
        self.rewind(probed);
        best
    }

    fn empty() -> Self {
        Self {
            endpoints: [[0; 2]; MAX_TRAIL_EDGES],
            incident: [[0; MAX_VERTEX_DEGREE]; MAX_VERTICES],
            degree: [0; MAX_VERTICES],
            blocked: [false; MAX_VERTICES],
            occupied: 0,
            len: 0,
            owned: 0,
            base: 0,
        }
    }

    fn sealed(mut self) -> Self {
        self.owned = self.len;
        self.base = self.search(u128::MAX, self.len, 0);
        self
    }

    fn push(&mut self, endpoints: [Vertex; 2]) {
        let slot = self.len;
        assert!(slot < MAX_TRAIL_EDGES, "road network overflow");
        self.endpoints[slot] = endpoints;
        for vertex in endpoints {
            let vertex = usize::from(vertex);
            let degree = usize::from(self.degree[vertex]);
            assert!(degree < MAX_VERTEX_DEGREE, "vertex degree exceeds geometry");
            self.incident[vertex][degree] = slot as u8;
            self.degree[vertex] += 1;
            self.occupied |= 1 << vertex;
        }
        self.len += 1;
    }

    /// Drops every segment above `len`. Sound because slots are handed out in increasing order and
    /// each vertex's incident list is appended to in that same order, so the highest live slot is
    /// simultaneously the last entry at both of its endpoints -- which is what makes dropping it a
    /// matter of decrementing a degree. A probe must therefore never rewind below the owned prefix.
    fn rewind(&mut self, len: usize) {
        debug_assert!(len >= self.owned, "rewound past the seat's own segments");
        while self.len > len {
            self.len -= 1;
            for vertex in self.endpoints[self.len] {
                self.degree[usize::from(vertex)] -= 1;
                if self.degree[usize::from(vertex)] == 0 {
                    self.occupied &= !(1 << vertex);
                }
            }
        }
    }

    /// Best trail that can use one of the segments from slot `probed` onward, never below the base.
    ///
    /// Only the components those segments touch are searched. A trail never leaves its component,
    /// and every other component was already measured into the base length.
    fn longest_trail_through(&self, probed: usize, cap: u8) -> u8 {
        let mut touched = 0_u128;
        for slot in probed..self.len {
            for vertex in self.endpoints[slot] {
                touched |= 1 << vertex;
            }
        }
        self.search(touched, usize::from(cap), self.base)
    }

    /// Longest trail in every component `scope` touches, capped at `ceiling` and never below the
    /// length `floor` already known from elsewhere.
    fn search(&self, scope: u128, ceiling: usize, floor: u8) -> u8 {
        let mut best = floor;
        let mut remaining = scope & self.occupied;
        while remaining != 0 {
            let seed = remaining.trailing_zeros() as Vertex;
            let (component, edges) = self.component_of(seed);
            remaining &= !component;
            // A trail cannot use more edges than its component holds.
            let reach = ceiling.min(edges);
            if usize::from(best) >= reach {
                continue;
            }
            let mut starts = self.trail_starts(component);
            if starts == 0 {
                // Every degree even and nothing blocking: an Euler circuit walks the whole
                // component, so its length is known without searching at all.
                best = best.max(edges as u8);
                continue;
            }
            while starts != 0 {
                let vertex = starts.trailing_zeros() as Vertex;
                starts &= starts - 1;
                self.walk(vertex, 0, 0, false, reach, &mut best);
            }
        }
        best
    }

    /// The vertices reachable from `seed`, and how many segments that component holds.
    fn component_of(&self, seed: Vertex) -> (u128, usize) {
        let mut reached = 1_u128 << seed;
        let mut frontier = [seed; MAX_VERTICES];
        let mut top = 1;
        let mut degrees = 0_usize;
        while top > 0 {
            top -= 1;
            let vertex = frontier[top];
            degrees += usize::from(self.degree[usize::from(vertex)]);
            for slot in self.incident_slots(vertex) {
                for other in self.endpoints[usize::from(*slot)] {
                    if reached & (1 << other) == 0 {
                        reached |= 1 << other;
                        frontier[top] = other;
                        top += 1;
                    }
                }
            }
        }
        // No segment is a loop, so each one contributed to exactly two of the degrees counted.
        (reached, degrees / 2)
    }

    /// Where a maximum trail in `component` can be assumed to start.
    ///
    /// A trail whose endpoint has even degree leaves an unused edge behind there, and prepending
    /// that edge makes the trail longer -- so a maximum trail ends at odd-degree vertices. Blocked
    /// vertices are exempt: nothing can be prepended *through* one, so they stay candidates. An
    /// empty result means the component is Eulerian, which the caller answers outright.
    ///
    /// Walking from every vertex instead is also correct, and is what this replaced: it explores
    /// each trail from both ends and from every interior vertex besides.
    fn trail_starts(&self, component: u128) -> u128 {
        let mut starts = 0;
        let mut rest = component;
        while rest != 0 {
            let vertex = rest.trailing_zeros();
            rest &= rest - 1;
            let index = vertex as usize;
            if self.degree[index] % 2 == 1 || self.blocked[index] {
                starts |= 1 << vertex;
            }
        }
        starts
    }

    fn walk(
        &self,
        vertex: Vertex,
        used: u128,
        length: u8,
        arrived: bool,
        ceiling: usize,
        best: &mut u8,
    ) {
        if length > *best {
            *best = length;
        }
        if usize::from(*best) >= ceiling || (arrived && self.blocked[usize::from(vertex)]) {
            return;
        }
        for slot in self.incident_slots(vertex) {
            let bit = 1_u128 << slot;
            if used & bit != 0 {
                continue;
            }
            let pair = self.endpoints[usize::from(*slot)];
            let other = if pair[0] == vertex { pair[1] } else { pair[0] };
            self.walk(other, used | bit, length + 1, true, ceiling, best);
        }
    }

    fn incident_slots(&self, vertex: Vertex) -> &[u8] {
        let vertex = usize::from(vertex);
        &self.incident[vertex][..usize::from(self.degree[vertex])]
    }
}

pub fn longest_road(edges: &[[Vertex; 2]], blocked_vertices: &[bool]) -> u8 {
    RoadNetwork::from_edges(edges, blocked_vertices).base_length()
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
