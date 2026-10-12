//! SP3's expansion term: what the best sites a candidate opens are worth to the pair.
//!
//! Ported from `src/engine/expansion.ts`, down to the comparison order. That file and its tests
//! are deleted: a comment that names one refers to commit `8107fc15`. The walk reads the occupancy
//! the scorer is handed, so it is the one component that depends on where everybody else's pieces
//! stand.

use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

use super::app_formula::{AppFormulaScorer, Holdings, SitePricer, VERTEX_FANOUT, VertexLinks, js_max};
use crate::rng::mix64;
use crate::state::EMPTY;
use crate::topology::{Edge, Vertex};

/// Paid road-builds a site may cost before it is out of reach. The free setup road is not one.
pub(super) const MAX_PAID_BUILDS: usize = 2;

/// Indexed by paid builds, with one bit per reached site.
type SiteMasks = [u128; MAX_PAID_BUILDS + 1];
const SITES_MEMO_LEN: usize = 4_096;
const CONTEXT_MEMO_LEN: usize = 256;
const CONTEXT_MEMO_WAYS: usize = 4;
const CONTEXT_MEMO_SETS: usize = CONTEXT_MEMO_LEN / CONTEXT_MEMO_WAYS;
const PRICE_MEMO_LEN: usize = 16_384;
const VALUE_MEMO_LEN: usize = 8_192;
const WALK_MEMO_WAYS: usize = 2;
static NEXT_REACH_ID: AtomicU64 = AtomicU64::new(1);

/// A site the candidate opens, at the cost the walk settled it for.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct ExpansionSite {
    pub vertex: Vertex,
    /// Roads that must be bought to settle it, over and above the free setup road.
    pub paid_builds: u32,
}

pub(super) struct ExpansionValue {
    /// The term, already multiplied by `expansionWeight`.
    pub value: f64,
    /// The setup road to lay, or `None` when the candidate opens nothing.
    pub road: Option<Edge>,
}

const NO_EXPANSION: ExpansionValue = ExpansionValue {
    value: 0.0,
    road: None,
};

#[derive(Debug)]
struct ReachEntry {
    site: Vertex,
    paid_builds: usize,
    edges: u128,
    through: u128,
}

#[derive(Debug, Default)]
struct OpenReach {
    edges: u128,
    through: u128,
    sites: u128,
    masks: SiteMasks,
}

#[derive(Debug, Default)]
pub(super) struct ReachTable {
    id: u64,
    entries: Vec<ReachEntry>,
    spans: Vec<std::ops::Range<usize>>,
    first_spans: Vec<[(Edge, std::ops::Range<usize>); VERTEX_FANOUT]>,
    /// With no own roads here, the free first edge leaves at most two paid edges, all in the table.
    near_edges: Vec<u128>,
    open: Vec<OpenReach>,
}

impl ReachTable {
    pub(super) fn table_path(&self, candidate: Vertex, occupancy: &Occupancy) -> bool {
        occupancy.own_edges & self.near_edges[usize::from(candidate)] == 0
    }

    pub(super) fn open_masks(&self, candidate: Vertex) -> SiteMasks {
        self.open[usize::from(candidate)].masks
    }

    pub(super) fn shared(links: &[VertexLinks]) -> Arc<Self> {
        LAST_REACH.with_borrow_mut(|last| {
            if let Some((held, table)) = last {
                if held == links {
                    return Arc::clone(table);
                }
            }
            let table = Arc::new(Self::new(links));
            *last = Some((links.to_vec(), Arc::clone(&table)));
            table
        })
    }

    fn new(links: &[VertexLinks]) -> Self {
        let mut table = Self {
            id: NEXT_REACH_ID.fetch_add(1, Ordering::Relaxed),
            ..Self::default()
        };
        for index in 0..links.len() {
            let vertex = index as Vertex;
            let start = table.entries.len();
            let mut near_edges = 0;
            let is_site = |site| site != vertex && !links[index].adjacent().contains(&site);
            let mut first_spans = std::array::from_fn(|_| (Edge::MAX, 0..0));
            for (direction, (first, a)) in links[index].steps().enumerate() {
                let first_start = table.entries.len();
                near_edges |= 1 << first;
                for (second, b) in links[usize::from(a)].steps() {
                    near_edges |= 1 << second;
                    let edges = (1 << first) | (1 << second);
                    if is_site(b) {
                        table.entries.push(ReachEntry {
                            site: b,
                            paid_builds: 1,
                            edges,
                            through: 1 << a,
                        });
                    }
                    for (third, c) in links[usize::from(b)].steps() {
                        near_edges |= 1 << third;
                        for (edge, _) in links[usize::from(c)].steps() {
                            near_edges |= 1 << edge;
                        }
                        if is_site(c) {
                            table.entries.push(ReachEntry {
                                site: c,
                                paid_builds: 2,
                                edges: edges | (1 << third),
                                through: (1 << a) | (1 << b),
                            });
                        }
                    }
                }
                first_spans[direction] = (first, first_start..table.entries.len());
            }
            table.first_spans.push(first_spans);
            let mut open = OpenReach::default();
            for entry in &table.entries[start..] {
                open.edges |= entry.edges;
                open.through |= entry.through;
                open.sites |= 1 << entry.site;
                open.masks[entry.paid_builds] |= 1 << entry.site;
            }
            open.masks[2] &= !open.masks[1];
            table.open.push(open);
            table.spans.push(start..table.entries.len());
            table.near_edges.push(near_edges);
        }
        table
    }

    fn sites(&self, candidate: Vertex, occupancy: &Occupancy, memo: &mut [SitesEntry]) -> SiteMasks {
        let open = &self.open[usize::from(candidate)];
        let masked = [
            occupancy.blocked & open.sites,
            occupancy.rival_edges & open.edges,
            occupancy.rival_vertices & open.through,
        ];
        if masked == [0; 3] {
            return open.masks;
        }
        let mut hash = self.id ^ u64::from(candidate).rotate_left(32);
        for (i, mask) in masked.iter().enumerate() {
            hash ^= (*mask as u64).rotate_left((i * 11) as u32)
                ^ ((*mask >> 64) as u64).rotate_left((i * 11 + 7) as u32);
        }
        let entry = &mut memo[mix64(hash) as usize & (SITES_MEMO_LEN - 1)];
        if entry.table == self.id && entry.candidate == candidate && entry.masked == masked {
            return entry.sites;
        }
        let sites = self.scan_sites(candidate, occupancy);
        *entry = SitesEntry {
            table: self.id,
            candidate,
            masked,
            sites,
        };
        sites
    }

    fn scan_sites(&self, candidate: Vertex, occupancy: &Occupancy) -> SiteMasks {
        self.scan_span(self.spans[usize::from(candidate)].clone(), occupancy)
    }

    fn road_sites(&self, candidate: Vertex, edge: Edge, occupancy: &Occupancy) -> SiteMasks {
        let span = &self.first_spans[usize::from(candidate)].iter()
            .find(|(first, _)| *first == edge).expect("incident edge has a span").1;
        self.scan_span(span.clone(), occupancy)
    }

    fn scan_span(&self, span: std::ops::Range<usize>, occupancy: &Occupancy) -> SiteMasks {
        let mut sites = SiteMasks::default();
        for entry in &self.entries[span] {
            let bit = 1 << entry.site;
            if bit & occupancy.blocked == 0
                && entry.edges & occupancy.rival_edges == 0
                && entry.through & occupancy.rival_vertices == 0
            {
                sites[entry.paid_builds] |= bit;
            }
        }
        sites[2] &= !sites[1];
        sites
    }
}

#[derive(Clone, Copy, Default)]
struct SitesEntry {
    table: u64,
    candidate: Vertex,
    masked: [u128; 3],
    sites: SiteMasks,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub(super) struct Occupancy {
    rival_vertices: u128,
    pub(super) blocked: u128,
    rival_edges: u128,
    pub(super) own_edges: u128,
    pub(super) own_vertices: u128,
}

impl Occupancy {
    pub(super) fn new(
        scorer: &AppFormulaScorer,
        vertex_owner: &[u8],
        edge_owner: &[u8],
        seat: u8,
    ) -> Self {
        debug_assert!(vertex_owner.len() <= 128, "vertex masks are 128 bits wide");
        debug_assert!(edge_owner.len() <= 128, "edge masks are 128 bits wide");
        let mut masks = Self::default();
        let vertices = vertex_owner.len().min(scorer.reach.spans.len());
        for (vertex, owner) in occupied_owners(&vertex_owner[..vertices]) {
            let bit = 1 << vertex;
            if owner == seat {
                masks.own_vertices |= bit;
            } else {
                masks.rival_vertices |= bit;
            }
            masks.blocked |= bit;
            for adjacent in scorer.vertex_adjacent(vertex as Vertex) {
                masks.blocked |= 1 << adjacent;
            }
        }
        for (edge, owner) in occupied_owners(edge_owner) {
            if owner == seat {
                masks.own_edges |= 1 << edge;
            } else {
                masks.rival_edges |= 1 << edge;
            }
        }
        masks
    }

    /// These roads around other settlements: the vertices the seat holds, the vertices its rivals
    /// hold, and every settled vertex with its neighbours.
    pub(super) fn with_settlements(self, own: u128, rival: u128, blocked: u128) -> Self {
        Self { own_vertices: own, rival_vertices: rival, blocked, ..self }
    }

    pub(super) fn place(
        &mut self,
        scorer: &AppFormulaScorer,
        seat: u8,
        owner: u8,
        vertex: Vertex,
        edge: Edge,
    ) {
        let vertex_bit = 1 << vertex;
        let edge_bit = 1 << edge;
        self.own_vertices &= !vertex_bit;
        self.rival_vertices &= !vertex_bit;
        self.own_edges &= !edge_bit;
        self.rival_edges &= !edge_bit;
        if seat == owner {
            self.own_vertices |= vertex_bit;
            self.own_edges |= edge_bit;
        } else {
            self.rival_vertices |= vertex_bit;
            self.rival_edges |= edge_bit;
        }
        self.blocked |= vertex_bit;
        for adjacent in scorer.vertex_adjacent(vertex) {
            self.blocked |= 1 << adjacent;
        }
    }

    fn restricted(&self, vertices: u128, edges: u128) -> [u128; 4] {
        [
            self.blocked & vertices,
            self.rival_vertices & vertices,
            self.own_edges & edges,
            self.rival_edges & edges,
        ]
    }
}

fn occupied_owners(owners: &[u8]) -> impl Iterator<Item = (usize, u8)> + '_ {
    owners
        .chunks(8)
        .enumerate()
        .filter(|(_, bytes)| {
            bytes.len() < 8
                || u64::from_ne_bytes((*bytes).try_into().unwrap()) != u64::from_ne_bytes([EMPTY; 8])
        })
        .flat_map(|(word, bytes)| {
            bytes.iter().enumerate().filter_map(move |(offset, owner)| {
                (*owner != EMPTY).then_some((word * 8 + offset, *owner))
            })
        })
}

/// A site's cheapest reach from any source is the minimum of the individual walks.
fn mask_walk(
    scorer: &AppFormulaScorer,
    occupancy: &Occupancy,
    candidate: Vertex,
    sources: [u128; 2],
) -> SiteMasks {
    mask_walk_recorded::<false>(scorer, occupancy, candidate, sources).sites
}

#[derive(Clone, Copy, Default)]
struct WalkRead {
    sites: SiteMasks,
    vertices: u128,
    edges: u128,
}

fn mask_walk_recorded<const RECORD: bool>(
    scorer: &AppFormulaScorer,
    occupancy: &Occupancy,
    candidate: Vertex,
    sources: [u128; 2],
) -> WalkRead {
    debug_assert!(
        scorer.reach.spans.len() <= 128,
        "vertex masks are 128 bits wide"
    );
    if scorer.reach.spans.len() <= 64 {
        mask_walk_words::<1, RECORD>(scorer, occupancy, candidate, sources)
    } else {
        mask_walk_words::<2, RECORD>(scorer, occupancy, candidate, sources)
    }
}

fn mask_walk_words<const WORDS: usize, const RECORD: bool>(
    scorer: &AppFormulaScorer,
    occupancy: &Occupancy,
    candidate: Vertex,
    sources: [u128; 2],
) -> WalkRead {
    let split =
        |bits: u128| -> [u64; WORDS] { std::array::from_fn(|word| (bits >> (word * 64)) as u64) };
    let mut excluded = occupancy.blocked | (1 << candidate);
    for adjacent in scorer.vertex_adjacent(candidate) {
        excluded |= 1 << adjacent;
    }
    let excluded = split(excluded);
    let rivals = split(occupancy.rival_vertices);

    // Edges always need two words: even the 54-vertex layout has 72 edges.
    let rival_edges = [
        occupancy.rival_edges as u64,
        (occupancy.rival_edges >> 64) as u64,
    ];
    let own_edges = [
        occupancy.own_edges as u64,
        (occupancy.own_edges >> 64) as u64,
    ];
    let mut frontier = [[0_u64; WORDS]; MAX_PAID_BUILDS + 2];
    frontier[0] = split(sources[0]);
    frontier[1] = split(sources[1]);
    let mut settled = [[0_u64; WORDS]; 2];
    let mut recorded = [0; WORDS];
    let mut sites = [[0; WORDS]; MAX_PAID_BUILDS + 1];
    let mut read_edges = [0_u64; 2];

    // The unused-road lane only occurs at cost 0; each unowned edge advances one band.
    for band in 0..MAX_PAID_BUILDS + 2 {
        let lane = usize::from(band != 0);
        let cost = band.saturating_sub(1);
        for word in 0..WORDS {
            frontier[band][word] &= !settled[lane][word];
        }
        while frontier[band][0] != 0 || (WORDS == 2 && frontier[band][1] != 0) {
            let word = usize::from(WORDS == 2 && frontier[band][0] == 0);
            let offset = frontier[band][word].trailing_zeros();
            let vertex = (word * 64) as Vertex + offset as Vertex;
            let bit = 1 << offset;
            frontier[band][word] &= frontier[band][word] - 1;
            settled[lane][word] |= bit;
            if (excluded[word] | recorded[word]) & bit == 0 {
                sites[cost][word] |= bit;
                recorded[word] |= bit;
            }
            if rivals[word] & bit != 0 {
                continue;
            }
            if band == MAX_PAID_BUILDS + 1 {
                for (edge, to) in scorer.steps(vertex) {
                    let edge_word = usize::from(edge >= 64);
                    let edge_bit = 1 << (edge & 63);
                    if RECORD {
                        read_edges[edge_word] |= edge_bit;
                    }
                    if own_edges[edge_word] & edge_bit != 0 {
                        let to_word = usize::from(WORDS == 2 && to >= 64);
                        frontier[band][to_word] |= (1 << (to & 63)) & !settled[lane][to_word];
                    }
                }
                continue;
            }
            for (edge, to) in scorer.steps(vertex) {
                let edge_word = usize::from(edge >= 64);
                let edge_bit = 1 << (edge & 63);
                if RECORD {
                    read_edges[edge_word] |= edge_bit;
                }
                if rival_edges[edge_word] & edge_bit != 0 {
                    continue;
                }
                let to_word = usize::from(WORDS == 2 && to >= 64);
                let to_bit = 1 << (to & 63);
                if own_edges[edge_word] & edge_bit == 0 {
                    frontier[band + 1][to_word] |= to_bit;
                } else {
                    frontier[band][to_word] |= to_bit & !settled[lane][to_word];
                }
            }
        }
    }
    let join = |bits: [u64; WORDS]| {
        let low = u128::from(bits[0]);
        if WORDS == 1 {
            low
        } else {
            low | (u128::from(bits[1]) << 64)
        }
    };
    WalkRead {
        sites: sites.map(join),
        vertices: if RECORD {
            join(std::array::from_fn(|i| settled[0][i] | settled[1][i]))
        } else {
            0
        },
        edges: u128::from(read_edges[0]) | (u128::from(read_edges[1]) << 64),
    }
}

/// Sites stay exact while occupancy restricted to the walk's read sets still matches.
#[derive(Clone, Copy, Default)]
struct WalkEntry {
    table: u64,
    walk: WalkRead,
    occupancy: [u128; 4],
}

impl WalkEntry {
    fn matches(&self, table: u64, occupancy: &Occupancy) -> bool {
        self.table == table
            && self.occupancy == occupancy.restricted(self.walk.vertices, self.walk.edges)
    }
}

struct WalkMemo {
    entries: Vec<[WalkEntry; WALK_MEMO_WAYS]>,
    next: [usize; 128],
}

impl Default for WalkMemo {
    fn default() -> Self {
        Self {
            entries: vec![[WalkEntry::default(); WALK_MEMO_WAYS]; 128],
            next: [0; 128],
        }
    }
}

impl WalkMemo {
    fn sites(
        &mut self,
        scorer: &AppFormulaScorer,
        occupancy: &Occupancy,
        candidate: Vertex,
    ) -> SiteMasks {
        let index = usize::from(candidate);
        for entry in &self.entries[index] {
            if entry.matches(scorer.reach.id, occupancy) {
                return entry.walk.sites;
            }
        }
        let mut sources = [0; 2];
        let mut edges = 0;
        for (edge, to) in scorer.steps(candidate) {
            let bit = 1 << edge;
            edges |= bit;
            if occupancy.rival_edges & bit == 0 {
                sources[usize::from(occupancy.own_edges & bit == 0)] |= 1 << to;
            }
        }
        let mut walk = mask_walk_recorded::<true>(scorer, occupancy, candidate, sources);
        walk.edges |= edges;
        self.entries[index][self.next[index]] = WalkEntry {
            table: scorer.reach.id,
            occupancy: occupancy.restricted(walk.vertices, walk.edges),
            walk,
        };
        self.next[index] = (self.next[index] + 1) % WALK_MEMO_WAYS;
        walk.sites
    }
}

/// One cache line holds the full key and value, avoiding a second line on a hit.
#[derive(Clone, Copy, Default)]
#[repr(C, align(64))]
struct ValueEntry {
    sites: [u64; 6],
    key: u64,
    value: f64,
}

impl ValueEntry {
    fn new(serial: u32, candidate: Vertex, sites: SiteMasks) -> Self {
        Self {
            sites: std::array::from_fn(|i| (sites[i / 2] >> (64 * (i % 2))) as u64),
            key: (u64::from(serial) << 8) | u64::from(candidate),
            value: 0.0,
        }
    }

    fn index(&self) -> usize {
        let mut hash = self.key;
        for (i, mask) in self.sites.iter().enumerate() {
            hash ^= mask.rotate_left((i * 11) as u32);
        }
        mix64(hash) as usize & (VALUE_MEMO_LEN - 1)
    }

    fn same_key(&self, other: &Self) -> bool {
        self.key == other.key && self.sites == other.sites
    }
}

pub(super) struct PriceMemo {
    /// Each context is (scorer id, own-vertex mask, serial).
    contexts: [[(u64, u128, u32); CONTEXT_MEMO_WAYS]; CONTEXT_MEMO_SETS],
    next_context: [usize; CONTEXT_MEMO_SETS],
    prices: Vec<(u64, f64)>,
    values: Vec<ValueEntry>,
    next_serial: u32,
    sites: Vec<SitesEntry>,
    walks: WalkMemo,
}

impl Default for PriceMemo {
    fn default() -> Self {
        Self {
            contexts: [[(0, 0, 0); CONTEXT_MEMO_WAYS]; CONTEXT_MEMO_SETS],
            next_context: [0; CONTEXT_MEMO_SETS],
            prices: vec![(0, 0.0); PRICE_MEMO_LEN],
            values: vec![ValueEntry::default(); VALUE_MEMO_LEN],
            next_serial: 1,
            sites: vec![SitesEntry::default(); SITES_MEMO_LEN],
            walks: WalkMemo::default(),
        }
    }
}

impl PriceMemo {
    pub(super) fn serial(&mut self, scorer: u64, own: u128) -> u32 {
        let index = Self::context_index(scorer, own);
        for (held_scorer, held_own, serial) in self.contexts[index] {
            if held_scorer == scorer && held_own == own {
                return serial;
            }
        }
        if self.next_serial == u32::MAX {
            self.contexts.fill([(0, 0, 0); CONTEXT_MEMO_WAYS]);
            self.next_context.fill(0);
            self.prices.fill((0, 0.0));
            self.values.fill(ValueEntry::default());
            self.next_serial = 1;
        }
        let serial = self.next_serial;
        self.next_serial += 1;
        self.contexts[index][self.next_context[index]] = (scorer, own, serial);
        self.next_context[index] = (self.next_context[index] + 1) % CONTEXT_MEMO_WAYS;
        serial
    }

    pub(super) fn price(&mut self, key: u64, compute: impl FnOnce() -> f64) -> f64 {
        let index = (key.wrapping_mul(0x9e37_79b9_7f4a_7c15)
            >> (u64::BITS - PRICE_MEMO_LEN.ilog2())) as usize;
        let entry = &mut self.prices[index];
        if entry.0 != key {
            *entry = (key, compute());
        }
        entry.1
    }

    fn context_index(scorer: u64, own: u128) -> usize {
        let hash = mix64(scorer ^ mix64(own as u64) ^ mix64((own >> 64) as u64).rotate_left(32));
        hash as usize & (CONTEXT_MEMO_SETS - 1)
    }
}

/// Bit 48 is above every price key's u32 serial, vertex and base/site tag.
pub(super) fn bound_key(serial: u32, candidate: Vertex, table_path: bool) -> u64 {
    price_key(serial, candidate, u8::from(table_path)) | (1 << 48)
}

pub(super) fn base_tag(seat: u8, grant: bool) -> u8 {
    debug_assert!(seat < 64, "base keys reserve six bits for the seat");
    0x80 | (seat << 1) | u8::from(grant)
}

pub(super) fn price_key(serial: u32, candidate: Vertex, tag: u8) -> u64 {
    (u64::from(serial) << 16) | (u64::from(candidate) << 8) | u64::from(tag)
}

thread_local! {
    static LAST_REACH: std::cell::RefCell<Option<(Vec<VertexLinks>, Arc<ReachTable>)>> =
        const { std::cell::RefCell::new(None) };
    pub(super) static PRICE_MEMO: std::cell::RefCell<PriceMemo> =
        std::cell::RefCell::new(PriceMemo::default());
}

/// Rows need the sites' value alone, so first-edge road comparisons can be omitted.
pub(super) fn row_value(
    scorer: &AppFormulaScorer,
    holdings: &Holdings,
    candidate: Vertex,
    occupancy: &Occupancy,
    memo: &mut PriceMemo,
    serial: Option<u32>,
) -> f64 {
    if scorer.weights().expansion_weight == 0.0 {
        return 0.0;
    }
    #[cfg(test)]
    ROW_VALUE_CALLS.with(|calls| calls.set(calls.get() + 1));

    let sites = if scorer.reach.table_path(candidate, occupancy) {
        #[cfg(test)]
        FAST_PATH_CALLS.with(|calls| calls.set(calls.get() + 1));

        scorer.reach.sites(candidate, occupancy, &mut memo.sites)
    } else {
        memo.walks.sites(scorer, occupancy, candidate)
    };
    let mut rest = sites[0] | sites[1] | sites[2];
    if rest == 0 {
        return 0.0;
    }
    let remembered = serial.map(|serial| {
        let entry = ValueEntry::new(serial, candidate, sites);
        (entry.index(), entry)
    });
    if let Some((index, entry)) = &remembered {
        if memo.values[*index].same_key(entry) {
            return memo.values[*index].value;
        }
    }
    let mut pricer = None;
    let mut first = f64::NEG_INFINITY;
    let mut second = f64::NEG_INFINITY;
    while rest != 0 {
        let site = rest.trailing_zeros() as Vertex;
        let bit = 1 << site;
        rest &= rest - 1;
        let cost = if sites[0] & bit != 0 {
            0
        } else if sites[1] & bit != 0 {
            1
        } else {
            2
        };
        let mut price_site = || {
            pricer.get_or_insert_with(|| {
                let mut with_candidate = *holdings;
                scorer.add_to_holdings(&mut with_candidate, candidate);
                SitePricer::new(scorer, with_candidate)
            }).price(site)
        };
        let price = if let Some(serial) = serial {
            let key = price_key(serial, candidate, site);
            memo.price(key, price_site)
        } else {
            price_site()
        };
        let value = price * scorer.decay_pow[cost];
        if value > first {
            second = first;
            first = value;
        } else if value > second {
            second = value;
        }
    }
    let total = if first == f64::NEG_INFINITY {
        0.0
    } else if second == f64::NEG_INFINITY {
        first
    } else {
        first + second
    };
    let value = scorer.weights().expansion_weight * total;
    if let Some((index, mut entry)) = remembered {
        entry.value = value;
        memo.values[index] = entry;
    }
    value
}

/// Reuse the row's site prices while retaining each first edge's own cheapest reach.
pub(super) fn row_road(
    scorer: &AppFormulaScorer,
    vertex_owner: &[u8],
    edge_owner: &[u8],
    seat: u8,
    candidate: Vertex,
    occupancy: Option<&Occupancy>,
) -> Option<Edge> {
    if scorer.weights().expansion_weight == 0.0 {
        return None;
    }
    let fresh;
    let occupancy = match occupancy {
        Some(occupancy) => occupancy,
        None => {
            fresh = Occupancy::new(scorer, vertex_owner, edge_owner, seat);
            &fresh
        }
    };
    let mut firsts = [(0, 0); VERTEX_FANOUT];
    let mut len = 0;
    for (edge, to) in scorer.steps(candidate) {
        if occupancy.rival_edges & (1 << edge) == 0 {
            firsts[len] = (edge, to);
            len += 1;
        }
    }
    firsts[..len].sort_unstable();
    let road = PRICE_MEMO.with(|memo| {
        let Ok(mut memo) = memo.try_borrow_mut() else {
            return scorer.expansion_road(vertex_owner, edge_owner, seat, candidate);
        };
        let table_path = scorer.reach.table_path(candidate, occupancy);
        let serial = memo.serial(scorer.id, occupancy.own_vertices);
        let mut pricer = None;
        let mut road = None;
        let mut best_site = f64::NEG_INFINITY;
        let mut best_pair = f64::NEG_INFINITY;
        for (first_edge, to) in &firsts[..len] {
            let mut sources = [0; 2];
            sources[usize::from(occupancy.own_edges & (1 << first_edge) == 0)] = 1 << to;
            let sites = if table_path {
                let sites = scorer.reach.road_sites(candidate, *first_edge, occupancy);
                #[cfg(any(test, debug_assertions))]
                assert_eq!(sites, mask_walk(scorer, occupancy, candidate, sources));
                sites
            } else {
                mask_walk(scorer, occupancy, candidate, sources)
            };
            let mut rest = sites[0] | sites[1] | sites[2];
            if rest == 0 {
                continue;
            }
            let mut best = f64::NEG_INFINITY;
            let mut first = f64::NEG_INFINITY;
            let mut second = f64::NEG_INFINITY;
            while rest != 0 {
                let site = rest.trailing_zeros() as Vertex;
                let bit = 1 << site;
                rest &= rest - 1;
                let cost = if sites[0] & bit != 0 {
                    0
                } else if sites[1] & bit != 0 {
                    1
                } else {
                    2
                };
                let key = price_key(serial, candidate, site);
                let price = memo.price(key, || {
                    pricer.get_or_insert_with(|| {
                        let mut holdings = scorer.holdings_for_owner(vertex_owner, seat);
                        scorer.add_to_holdings(&mut holdings, candidate);
                        SitePricer::new(scorer, holdings)
                    }).price(site)
                });
                let value = price * scorer.decay_pow[cost];
                best = js_max(best, value);
                if value > first {
                    second = first;
                    first = value;
                } else if value > second {
                    second = value;
                }
            }
            let pair = if first == f64::NEG_INFINITY {
                0.0
            } else if second == f64::NEG_INFINITY {
                first
            } else {
                first + second
            };
            if road.is_none()
                || best > best_site
                || (best == best_site && pair > best_pair)
                || (best == best_site && pair == best_pair && Some(*first_edge) < road)
            {
                road = Some(*first_edge);
                best_site = best;
                best_pair = pair;
            }
        }
        road
    });
    #[cfg(any(test, debug_assertions))]
    assert_eq!(road, scorer.expansion_road(vertex_owner, edge_owner, seat, candidate));
    road
}

// Separate reference walks from row valuations, which may hit tables or memos.
// Thread-local because tests run in parallel.
#[cfg(test)]
thread_local! {
    static ROW_VALUE_CALLS: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
    static WALK_CALLS: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
    static FAST_PATH_CALLS: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}

#[cfg(test)]
pub(super) fn walk_calls() -> usize {
    WALK_CALLS.with(std::cell::Cell::get)
}

#[cfg(test)]
pub(super) fn row_value_calls() -> usize {
    ROW_VALUE_CALLS.with(std::cell::Cell::get)
}

/// One walk state: a vertex, and whether the free setup road has been spent getting there.
#[derive(Clone, Copy)]
struct Reached {
    vertex: Vertex,
    road_used: bool,
}

/// The walk's and the term's working memory, reused across calls so neither allocates once the
/// buffers have grown. Per thread, not global: workers run the setup phase in parallel and would
/// otherwise share one buffer, and a thread only ever reads what its own call just wrote.
///
/// Adoption is what made this necessary. While `expansionWeight` shipped at 0 the walk was never
/// entered in a measured run, so allocating freshly inside it cost nothing; M-66 put the term in
/// the field, and `cli/tests/alloc.rs` pins the setup hot loop at zero steady-state allocations.
#[derive(Default)]
struct Scratch {
    /// The candidate's own passable incident edges, sorted, which fixes the walk's order.
    firsts: Vec<(Edge, Vertex)>,
    /// One queue per paid-build count, drained cheapest first.
    bands: [Vec<Reached>; MAX_PAID_BUILDS + 1],
    /// Sites, flat and grouped by first edge; `edges` holds each edge and its `[start, end)` span.
    sites: Vec<ExpansionSite>,
    edges: Vec<(Edge, usize, usize)>,
    /// Per `term` call, indexed by vertex: a site's undiscounted score, and its cheapest reach.
    scores: Vec<Option<f64>>,
    cheapest: Vec<Option<(u32, f64)>>,
    /// One discounted value per site of the first edge being folded.
    values: Vec<f64>,
}

thread_local! {
    static SCRATCH: std::cell::RefCell<Scratch> =
        std::cell::RefCell::new(Scratch::default());
}

/// Every site the candidate opens through one of its own incident edges, written into `scratch`
/// grouped by that edge and listed in ascending edge order, which is ascending edge id and so the
/// order the TypeScript walk takes its sorted incident edges in.
///
/// The walk leaves `candidate` along each first edge and spreads outward. A rival's road is
/// impassable and a vertex a rival holds is a dead end, because a settlement stops a road network
/// even though a road may be laid right up to it. The seat's own roads are free to travel, the
/// first unowned edge on a path is free as well (it is the setup road the settlement comes with),
/// and every unowned edge after that costs one paid build. Reach ends at `MAX_PAID_BUILDS`.
///
/// A site is a vertex at least two edges out that would be legal once the candidate is built:
/// unoccupied, with no occupied neighbour, and not adjacent to the candidate.
fn walk(
    scratch: &mut Scratch,
    scorer: &AppFormulaScorer,
    vertex_owner: &[u8],
    edge_owner: &[u8],
    seat: u8,
    candidate: Vertex,
) {
    #[cfg(test)]
    WALK_CALLS.with(|calls| calls.set(calls.get() + 1));

    let occupied = |vertex: Vertex| vertex_owner[usize::from(vertex)] != EMPTY;
    let rival = |vertex: Vertex| {
        let owner = vertex_owner[usize::from(vertex)];
        owner != EMPTY && owner != seat
    };
    let neighbours_candidate = |vertex: Vertex| scorer.vertex_adjacent(candidate).contains(&vertex);
    let is_site = |vertex: Vertex| {
        !occupied(vertex)
            && vertex != candidate
            && !neighbours_candidate(vertex)
            && scorer
                .vertex_adjacent(vertex)
                .iter()
                .all(|neighbour| !occupied(*neighbour))
    };

    scratch.firsts.clear();
    scratch.firsts.extend(scorer.steps(candidate).filter(|(edge, _)| {
        let owner = edge_owner[usize::from(*edge)];
        owner == EMPTY || owner == seat
    }));
    scratch.firsts.sort_unstable();

    scratch.sites.clear();
    scratch.edges.clear();
    for index in 0..scratch.firsts.len() {
        let (first_edge, first_vertex) = scratch.firsts[index];
        // Cheapest-first: a free step joins the band being drained, a paid one the next band, so a
        // state is settled at its minimum paid-build count the first time it is popped.
        let bands = &mut scratch.bands;
        for band in bands.iter_mut() {
            band.clear();
        }
        // The free setup road is spent only on an edge nobody owns; travelling the seat's own road
        // keeps it in hand for later on the same path.
        bands[0].push(Reached {
            vertex: first_vertex,
            road_used: edge_owner[usize::from(first_edge)] == EMPTY,
        });
        // One bit per (vertex, road spent) state. `extension6`, the widest layout, has 80
        // vertices; a wider one would shift past the mask's end, which is a silent wrong answer in
        // release rather than a panic.
        debug_assert!(
            vertex_owner.len() <= 128,
            "the expansion walk's state bitmask is 128 bits wide"
        );
        let mut settled = [0_u128; 2];
        // The two road-spent lanes settle a vertex separately, so one site can be popped twice:
        // once over the seat's own roads and once over the free setup road. Bands drain
        // cheapest-first, so the first pop is the cheapest one; recording the repeat would let
        // `top_two` pair a site with itself. One bit per vertex, unlike `settled`'s two lanes.
        let mut recorded = 0_u128;
        let span_start = scratch.sites.len();
        for cost in 0..=MAX_PAID_BUILDS {
            let mut head = 0;
            while head < bands[cost].len() {
                let state = bands[cost][head];
                head += 1;
                let lane = usize::from(state.road_used);
                let bit = 1_u128 << state.vertex;
                if settled[lane] & bit != 0 {
                    continue;
                }
                settled[lane] |= bit;
                // Every vertex past the first step is at least two edges out; the adjacency test
                // in `is_site` drops the ones that are two edges out but still touch the candidate.
                if state.vertex != first_vertex && recorded & bit == 0 && is_site(state.vertex) {
                    recorded |= bit;
                    scratch.sites.push(ExpansionSite {
                        vertex: state.vertex,
                        paid_builds: cost as u32,
                    });
                }
                if rival(state.vertex) {
                    continue;
                }
                for (edge, to) in scorer.steps(state.vertex) {
                    let owner = edge_owner[usize::from(edge)];
                    if owner != EMPTY && owner != seat {
                        continue;
                    }
                    let unowned = owner == EMPTY;
                    let next_cost = cost + usize::from(unowned && state.road_used);
                    if next_cost > MAX_PAID_BUILDS {
                        continue;
                    }
                    let road_used = state.road_used || unowned;
                    if settled[usize::from(road_used)] & (1 << to) != 0 {
                        continue;
                    }
                    bands[next_cost].push(Reached {
                        vertex: to,
                        road_used,
                    });
                }
            }
        }
        if scratch.sites.len() > span_start {
            scratch
                .edges
                .push((first_edge, span_start, scratch.sites.len()));
        }
    }
}

/// `walk`'s sites in the shape the tests read them: one owned vector per first edge.
#[cfg(test)]
pub(super) fn sites_by_edge(
    scorer: &AppFormulaScorer,
    vertex_owner: &[u8],
    edge_owner: &[u8],
    seat: u8,
    candidate: Vertex,
) -> Vec<(Edge, Vec<ExpansionSite>)> {
    SCRATCH.with_borrow_mut(|scratch| {
        walk(scratch, scorer, vertex_owner, edge_owner, seat, candidate);
        scratch
            .edges
            .iter()
            .map(|(edge, start, end)| (*edge, scratch.sites[*start..*end].to_vec()))
            .collect()
    })
}

/// What the candidate is worth as a place to expand *from*, and the road that goes there.
///
/// A site is priced by what settling it would be worth to this pair: the ordinary formula's
/// marginal score of the site given the holdings plus the candidate, with no setup grant and with
/// the expansion component itself left out, so the term cannot recurse. That value decays by one
/// factor of `expansionDecay` per paid road-build, and the term is the weight times the sum of the
/// two best sites, because a pair only ever settles a handful of them.
///
/// The road is the first edge of the cheapest path to the best site, ties broken by the larger
/// top-two sum still reachable through that edge, then by the lower edge id.
pub(super) fn term(
    scorer: &AppFormulaScorer,
    holdings: &Holdings,
    vertex_owner: &[u8],
    edge_owner: &[u8],
    seat: u8,
    candidate: Vertex,
) -> ExpansionValue {
    let weights = scorer.weights();
    if weights.expansion_weight == 0.0 {
        return NO_EXPANSION;
    }
    let mut with_candidate = *holdings;
    scorer.add_to_holdings(&mut with_candidate, candidate);
    SCRATCH.with_borrow_mut(|scratch| {
        walk(scratch, scorer, vertex_owner, edge_owner, seat, candidate);
        if scratch.edges.is_empty() {
            return NO_EXPANSION;
        }
        // One score per site, shared by every first edge that reaches it: a site's worth depends
        // on the site and the pair, never on the road taken to get there.
        scratch.scores.clear();
        scratch.scores.resize(vertex_owner.len(), None);
        // Each site at the cheapest paid-build count any first edge reaches it for, matching
        // `ExpansionSite`'s own definition. Folding on the larger *value* instead would pick the
        // dearest path for a site the pair scores below zero, decay shrinking a negative toward 0.
        // `expansion.ts::expansionTerm` folds the same way.
        scratch.cheapest.clear();
        scratch.cheapest.resize(vertex_owner.len(), None);
        let Scratch {
            sites,
            edges,
            scores,
            cheapest,
            values,
            ..
        } = scratch;

        let mut road: Option<Edge> = None;
        let mut best_site = f64::NEG_INFINITY;
        let mut best_pair = f64::NEG_INFINITY;
        let holdings_total = scorer.holdings_diversity_total(&with_candidate);
        for (first_edge, start, end) in edges.iter() {
            let span = &sites[*start..*end];
            values.clear();
            for site in span {
                let index = usize::from(site.vertex);
                let score = match scores[index] {
                    Some(score) => score,
                    None => {
                        // Unscaled by any draft slot: a site is a settlement some later turn buys,
                        // so what the pair's *current* pick position leans on says nothing about
                        // it. SP4's scales price this whole term instead, through the `expansion`
                        // scale its caller applies. `expansion.ts::expansionTerm` matches.
                        let score = scorer.site_total_with_holdings(
                            with_candidate,
                            site.vertex,
                            holdings_total,
                        );
                        scores[index] = Some(score);
                        score
                    }
                };
                // `powf`, not `powi`: JavaScript's `**` is `Math.pow`, and the two Rust intrinsics
                // are free to round differently.
                values.push(score * weights.expansion_decay.powf(f64::from(site.paid_builds)));
            }
            let best = values
                .iter()
                .fold(f64::NEG_INFINITY, |held, value| js_max(held, *value));
            let pair = top_two(values);
            if road.is_none()
                || best > best_site
                || (best == best_site && pair > best_pair)
                || (best == best_site && pair == best_pair && Some(*first_edge) < road)
            {
                road = Some(*first_edge);
                best_site = best;
                best_pair = pair;
            }
            for (site, value) in span.iter().zip(values.iter()) {
                let held = &mut cheapest[usize::from(site.vertex)];
                if held.is_none_or(|(paid_builds, _)| site.paid_builds < paid_builds) {
                    *held = Some((site.paid_builds, *value));
                }
            }
        }
        // Folded in vertex order, which is the order the collected vector carried, and `top_two`
        // reads the same two numbers out of any order in any case.
        values.clear();
        values.extend(cheapest.iter().flatten().map(|(_, value)| *value));
        ExpansionValue {
            value: weights.expansion_weight * top_two(values),
            road,
        }
    })
}

/// Sum of the two largest values, or of the one there is, or 0 for none. A NaN never wins a
/// comparison here, exactly as it never wins one in the TypeScript original.
fn top_two(values: &[f64]) -> f64 {
    let mut first = f64::NEG_INFINITY;
    let mut second = f64::NEG_INFINITY;
    for value in values {
        if *value > first {
            second = first;
            first = *value;
        } else if *value > second {
            second = *value;
        }
    }
    if first == f64::NEG_INFINITY {
        return 0.0;
    }
    if second == f64::NEG_INFINITY {
        first
    } else {
        first + second
    }
}

#[cfg(test)]
pub(super) mod tests {
    use std::fs;
    use std::path::PathBuf;

    use super::*;
    use crate::board::{ConversionOptions, SimBoard};
    use crate::placement::app_formula::{EngineWeights, ResourceValues};
    use crate::rules::RuleConfig;
    use crate::topology::{Layout, Topology};
    use crate::wire::WireBoard;

    fn fixture() -> (Topology, SimBoard) {
        let relative = PathBuf::from("src/parser/__tests__/expected/board-draft-empty.json");
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .ancestors()
            .map(|root| root.join(&relative))
            .find(|candidate| candidate.is_file())
            .expect("board fixture must be reachable from the worktree or sweep root");
        let wire = WireBoard::parse_str(&fs::read_to_string(path).unwrap()).unwrap();
        let topology = Topology::load(Layout::Extension6).unwrap();
        let board = SimBoard::try_from_wire(
            wire,
            &topology,
            &RuleConfig::base(Layout::Extension6),
            ConversionOptions::default(),
        )
        .unwrap();
        (topology, board)
    }

    /// Bound keys distinguish both reach paths and never overlap any base or site price.
    #[test]
    fn bound_keys_are_disjoint_from_price_keys() {
        for serial in [1, u32::MAX] {
            for candidate in 0..128 {
                let fast = bound_key(serial, candidate, true);
                let general = bound_key(serial, candidate, false);
                assert_ne!(fast, general);
                for tag in 0..=u8::MAX {
                    let price = price_key(serial, candidate, tag);
                    assert_ne!(fast, price);
                    assert_ne!(general, price);
                }
            }
        }
    }

    /// Value entries retain every mask bit and cannot survive reuse of a context serial.
    #[test]
    fn value_memo_checks_full_keys_and_clears_on_wrap() {
        assert_eq!(std::mem::size_of::<ValueEntry>(), 64);
        assert_eq!(std::mem::align_of::<ValueEntry>(), 64);
        let mut memo = PriceMemo::default();
        let serial = memo.serial(1, 0);
        let entry = ValueEntry::new(serial, 7, [1, 2, 3]);
        assert!(!ValueEntry::default().same_key(&entry));
        for mask in 0..3 {
            for bit in 0..128 {
                let mut sites = [1, 2, 3];
                sites[mask] ^= 1 << bit;
                assert!(!entry.same_key(&ValueEntry::new(serial, 7, sites)));
            }
        }
        assert!(!entry.same_key(&ValueEntry::new(serial + 1, 7, [1, 2, 3])));
        assert!(!entry.same_key(&ValueEntry::new(serial, 8, [1, 2, 3])));
        memo.values[entry.index()] = entry;
        memo.next_serial = u32::MAX;
        memo.serial(2, 1);
        assert!(memo.values.iter().all(|held| held.key == 0));
    }

    /// A hero's second row neither reads nor evicts the rivals' remembered values.
    #[test]
    fn value_memo_can_be_bypassed_without_reading_or_writing() {
        let (topology, board) = fixture();
        let scorer = AppFormulaScorer::new(&board, &topology, default_weights());
        let vertices = vec![EMPTY; topology.vertex_count()];
        let edges = vec![EMPTY; topology.edge_count()];
        let occupancy = Occupancy::new(&scorer, &vertices, &edges, 0);
        let holdings = Holdings::empty();
        let mut memo = PriceMemo::default();
        let serial = memo.serial(scorer.id, 0);
        let direct = row_value(
            &scorer, &holdings, 0, &occupancy, &mut memo, None,
        );
        assert!(memo.values.iter().all(|entry| entry.key == 0));
        let cached = row_value(
            &scorer, &holdings, 0, &occupancy, &mut memo, Some(serial),
        );
        assert_eq!(cached.to_bits(), direct.to_bits());
        let index = memo.values.iter().position(|entry| entry.key != 0).unwrap();
        memo.values[index].value = -9999.0;
        let bypassed = row_value(
            &scorer, &holdings, 0, &occupancy, &mut memo, None,
        );
        assert_eq!(bypassed.to_bits(), direct.to_bits());
        assert_eq!(memo.values[index].value, -9999.0);
    }

    /// A one-use hero row neither reads nor evicts prices cached for the rivals.
    #[test]
    fn bypassed_rows_leave_site_prices_untouched() {
        let (topology, board) = fixture();
        let scorer = AppFormulaScorer::new(&board, &topology, default_weights());
        let vertices = vec![EMPTY; topology.vertex_count()];
        let edges = vec![EMPTY; topology.edge_count()];
        let occupancy = Occupancy::new(&scorer, &vertices, &edges, 0);
        let holdings = Holdings::empty();
        let mut memo = PriceMemo::default();
        let serial = memo.serial(scorer.id, 0);
        for site in 0..topology.vertex_count() as Vertex {
            memo.price(price_key(serial, 0, site), || -9999.0);
        }
        let before = memo.prices.clone();
        let value = row_value(&scorer, &holdings, 0, &occupancy, &mut memo, None);
        assert_eq!(value.to_bits(), term(&scorer, &holdings, &vertices, &edges, 0, 0).value.to_bits());
        assert_eq!(memo.prices, before);
    }

    /// The open-board shortcut observes every site, intermediate vertex and edge obstruction.
    #[test]
    fn open_reach_matches_entries_with_each_obstruction() {
        let mut memo = PriceMemo::default();
        let (topology, board) = fixture();
        let scorer = AppFormulaScorer::new(&board, &topology, default_weights());
        for candidate in 0..topology.vertex_count() as Vertex {
            for bit in 0..128 {
                for occupancy in [
                    Occupancy::default(),
                    Occupancy { blocked: 1 << bit, ..Occupancy::default() },
                    Occupancy { rival_edges: 1 << bit, ..Occupancy::default() },
                    Occupancy { rival_vertices: 1 << bit, ..Occupancy::default() },
                ] {
                    let expected = scorer.reach.scan_sites(candidate, &occupancy);
                    assert_eq!(scorer.reach.sites(candidate, &occupancy, &mut memo.sites), expected);
                }
            }
        }
    }

    /// Base keys preserve the seat and grant and cannot match any site's price key.
    #[test]
    fn base_totals_and_site_prices_have_disjoint_keys() {
        let mut memo = PriceMemo::default();
        let serial = memo.serial(1, 0);
        let mut keys = Vec::new();
        for seat in 0_u8..64 {
            for grant in [false, true] {
                let key = price_key(serial, 3, base_tag(seat, grant));
                assert!(!keys.contains(&key));
                keys.push(key);
                for site in 0..128 {
                    let site_key = price_key(serial, 3, site);
                    assert_ne!(key, site_key);
                    memo.price(site_key, || -1.0);
                }
                let expected = f64::from(seat) + f64::from(grant);
                assert_eq!(memo.price(key, || expected).to_bits(), expected.to_bits());
                assert_eq!(memo.price(key, || panic!("base total missed")).to_bits(), expected.to_bits());
            }
        }
    }

    /// Hoisted coverage and port operands preserve every site's bits, including fallback weights.
    #[test]
    fn holdings_pricer_matches_site_totals_on_the_fixture() {
        let (topology, board) = fixture();
        let mut recipe = default_weights();
        recipe.recipe_cap = recipe.diversity_cap + 1.0;
        let mut deficit = default_weights();
        deficit.port_coverage_deficit_weight = 0.7;
        let mut concentration = default_weights();
        concentration.robber_concentration_weight = 0.8;
        let mut negative = default_weights();
        negative.resource_value.wood = -1.0;
        negative.diversity_weight = -0.5;
        let mut nan = negative.clone();
        nan.resource_value.wheat = f64::NAN;
        for (vector, weights) in [default_weights(), recipe, deficit, concentration, negative, nan]
            .into_iter()
            .enumerate()
        {
            let scorer = AppFormulaScorer::new(&board, &topology, weights);
            let mut holdings = vec![Holdings::empty()];
            for first in 0..topology.vertex_count() as Vertex {
                let mut single = Holdings::empty();
                scorer.add_to_holdings(&mut single, first);
                holdings.push(single);
                // Every pair is 104 million comparisons; a stride keeps pairs near and far.
                for second in (first + 1..topology.vertex_count() as Vertex).step_by(37) {
                    let mut pair = single;
                    scorer.add_to_holdings(&mut pair, second);
                    holdings.push(pair);
                }
            }
            for (held, holdings) in holdings.into_iter().enumerate() {
                for candidate in 0..topology.vertex_count() as Vertex {
                    let mut with_candidate = holdings;
                    scorer.add_to_holdings(&mut with_candidate, candidate);
                    let total = scorer.holdings_diversity_total(&with_candidate);
                    let pricer = SitePricer::new(&scorer, with_candidate);
                    for site in 0..topology.vertex_count() as Vertex {
                        assert_eq!(
                            pricer.price(site).to_bits(),
                            scorer.site_total_with_holdings(with_candidate, site, total).to_bits(),
                            "vector {vector} holding {held} candidate {candidate} site {site}"
                        );
                    }
                }
            }
        }
    }

    /// Scorers share immutable reach only while the thread's last adjacency still matches.
    #[test]
    fn reach_tables_share_adjacency_across_weights_and_clones() {
        let mut memo = PriceMemo::default();
        fn send_and_sync<T: Send + Sync>() {}
        send_and_sync::<AppFormulaScorer>();
        let [(small_topology, small_board), (large_topology, large_board)] = walk_fixtures();
        let first = AppFormulaScorer::new(&small_board, &small_topology, default_weights());
        let mut weights = default_weights();
        weights.expansion_decay = 0.2;
        let second = AppFormulaScorer::new(&small_board, &small_topology, weights);
        assert!(Arc::ptr_eq(&first.reach, &second.reach));
        assert!(Arc::ptr_eq(&first.reach, &first.clone().reach));
        let large = AppFormulaScorer::new(&large_board, &large_topology, default_weights());
        assert!(!Arc::ptr_eq(&first.reach, &large.reach));
        let rebuilt = AppFormulaScorer::new(&small_board, &small_topology, default_weights());
        assert!(!Arc::ptr_eq(&first.reach, &rebuilt.reach));
        for vertex in 0..small_topology.vertex_count() as Vertex {
            assert_eq!(
                first.reach.sites(vertex, &Occupancy::default(), &mut memo.sites),
                rebuilt.reach.sites(vertex, &Occupancy::default(), &mut memo.sites)
            );
        }
    }

    /// Projected occupancy keys remain exact when one thread alternates between adjacencies.
    #[test]
    fn fast_sites_memo_matches_entries_across_boards_and_layouts() {
        let mut memo = PriceMemo::default();
        let cases: Vec<_> = walk_fixtures().into_iter().map(|(topology, board)| {
            let scorer = AppFormulaScorer::new(&board, &topology, default_weights());
            (scorer, scrambled_owners(&topology))
        }).collect();
        assert_ne!(cases[0].0.reach.id, cases[1].0.reach.id);
        for board in 0..20 {
            for (scorer, boards) in &cases {
                let (vertices, edges) = &boards[board];
                for seat in 0..6 {
                    let occupancy = Occupancy::new(scorer, vertices, edges, seat);
                    for candidate in 0..scorer.reach.spans.len() as Vertex {
                        let expected = scorer.reach.scan_sites(candidate, &occupancy);
                        for _ in 0..2 {
                            assert_eq!(scorer.reach.sites(candidate, &occupancy, &mut memo.sites), expected);
                        }
                    }
                }
            }
        }
    }

    /// One memo remains exact across changed boards, own-road chains and both adjacencies.
    #[test]
    fn general_sites_memo_matches_fresh_walks_on_scrambled_boards() {
        let mut memo = WalkMemo::default();
        for (topology, board) in walk_fixtures() {
            let scorer = AppFormulaScorer::new(&board, &topology, default_weights());
            for (vertices, edges) in scrambled_owners(&topology) {
                for seat in 0..6 {
                    let occupancy = Occupancy::new(&scorer, &vertices, &edges, seat);
                    for candidate in 0..topology.vertex_count() as Vertex {
                        let mut sources = [0; 2];
                        for (edge, to) in scorer.steps(candidate) {
                            if occupancy.rival_edges & (1 << edge) == 0 {
                                sources[usize::from(occupancy.own_edges & (1 << edge) == 0)] |= 1 << to;
                            }
                        }
                        let expected = mask_walk(&scorer, &occupancy, candidate, sources);
                        assert_eq!(memo.sites(&scorer, &occupancy, candidate), expected);
                        let next = memo.next[usize::from(candidate)];
                        assert_eq!(memo.sites(&scorer, &occupancy, candidate), expected);
                        assert_eq!(memo.next[usize::from(candidate)], next);
                    }
                }
            }
        }
    }

    /// Every occupancy bit the walk read participates in validation, even on rejected edges.
    #[test]
    fn general_sites_memo_rejects_each_changed_read_bit() {
        let (topology, board) = fixture();
        let scorer = AppFormulaScorer::new(&board, &topology, default_weights());
        let vertices = vec![EMPTY; topology.vertex_count()];
        let mut edges = vec![EMPTY; topology.edge_count()];
        for (edge, to) in scorer.steps(0) {
            edges[usize::from(edge)] = 0;
            for (edge, _) in scorer.steps(to) {
                edges[usize::from(edge)] = 0;
            }
        }
        let occupancy = Occupancy::new(&scorer, &vertices, &edges, 0);
        let mut memo = WalkMemo::default();
        memo.sites(&scorer, &occupancy, 0);
        let entry = memo.entries[0][0];
        assert_ne!(entry.walk.vertices, 0);
        assert_ne!(entry.walk.edges, 0);
        assert!(entry.matches(scorer.reach.id, &occupancy));
        assert!(!entry.matches(scorer.reach.id + 1, &occupancy));
        for field in 0..4 {
            let mask = if field < 2 { entry.walk.vertices } else { entry.walk.edges };
            for bit in 0..128 {
                let mut changed = occupancy;
                let target = match field {
                    0 => &mut changed.blocked,
                    1 => &mut changed.rival_vertices,
                    2 => &mut changed.own_edges,
                    _ => &mut changed.rival_edges,
                };
                *target ^= 1 << bit;
                assert_eq!(entry.matches(scorer.reach.id, &changed), mask & (1 << bit) == 0);
            }
        }
    }

    /// Word skips and partial words preserve the bytewise masks, including padded owner arrays.
    #[test]
    fn occupancy_word_scan_matches_each_owner_byte() {
        for (topology, board) in walk_fixtures() {
            let scorer = AppFormulaScorer::new(&board, &topology, default_weights());
            for (vertices, edges) in scrambled_owners(&topology).into_iter().take(20) {
                for padding in 0..8 {
                    let mut vertices = vertices.clone();
                    let mut edges = edges.clone();
                    vertices.extend(std::iter::repeat_n(0, padding));
                    edges.extend(std::iter::repeat_n(0, padding));
                    for seat in 0..6 {
                        let mut expected = Occupancy::default();
                        for (vertex, owner) in vertices.iter().take(topology.vertex_count()).enumerate() {
                            if *owner == EMPTY {
                                continue;
                            }
                            let bit = 1 << vertex;
                            if *owner == seat {
                                expected.own_vertices |= bit;
                            } else {
                                expected.rival_vertices |= bit;
                            }
                            expected.blocked |= bit;
                            for adjacent in scorer.vertex_adjacent(vertex as Vertex) {
                                expected.blocked |= 1 << adjacent;
                            }
                        }
                        for (edge, owner) in edges.iter().enumerate() {
                            if *owner == seat {
                                expected.own_edges |= 1 << edge;
                            } else if *owner != EMPTY {
                                expected.rival_edges |= 1 << edge;
                            }
                        }
                        assert_eq!(Occupancy::new(&scorer, &vertices, &edges, seat), expected);
                    }
                }
            }
        }
    }

    pub(in crate::placement) fn walk_fixtures() -> [(Topology, SimBoard); 2] {
        let cases: serde_json::Value =
            serde_json::from_str(include_str!("../../../../fixtures/advice-parity.json")).unwrap();
        let wire =
            WireBoard::parse_value(cases["cases"][0]["request"]["game"]["board"].clone()).unwrap();
        let topology = Topology::load(Layout::Standard4).unwrap();
        let board = SimBoard::try_from_wire(
            wire,
            &topology,
            &RuleConfig::base(Layout::Standard4),
            ConversionOptions::default(),
        )
        .unwrap();
        [(topology, board), fixture()]
    }

    pub(in crate::placement) fn scrambled_owners(topology: &Topology) -> Vec<(Vec<u8>, Vec<u8>)> {
        let mut state = 0x9e37_79b9_7f4a_7c15_u64;
        let mut draw = |bound: usize| {
            state = state
                .wrapping_mul(6_364_136_223_846_793_005)
                .wrapping_add(1_442_695_040_888_963_407);
            ((state >> 33) as usize) % bound
        };
        (0..120)
            .map(|_| {
                let mut vertices = vec![EMPTY; topology.vertex_count()];
                let mut edges = vec![EMPTY; topology.edge_count()];
                for _ in 0..draw(11) {
                    let seat = draw(6) as u8;
                    let legal: Vec<Vertex> = (0..topology.vertex_count() as Vertex)
                        .filter(|vertex| {
                            crate::game::can_place_settlement(topology, &vertices, *vertex)
                        })
                        .collect();
                    if legal.is_empty() {
                        break;
                    }
                    let vertex = legal[draw(legal.len())];
                    vertices[usize::from(vertex)] = seat;
                    let mut end = vertex;
                    for _ in 0..draw(8) {
                        let incident = topology.vertex_edges(end);
                        let edge = incident[draw(incident.len())];
                        if edges[usize::from(edge)] != EMPTY {
                            break;
                        }
                        edges[usize::from(edge)] = seat;
                        let endpoints = topology.edge_endpoints(edge);
                        end = if endpoints[0] == end {
                            endpoints[1]
                        } else {
                            endpoints[0]
                        };
                    }
                }
                (vertices, edges)
            })
            .collect()
    }

    /// The blocked mask is exactly settlement illegality, regardless of the scoring seat.
    #[test]
    fn mask_legality_matches_settlement_legality_on_scrambled_boards() {
        for (topology, board) in walk_fixtures() {
            let scorer = AppFormulaScorer::new(&board, &topology, default_weights());
            for (vertices, edges) in scrambled_owners(&topology) {
                for seat in 0..6 {
                    let occupancy = Occupancy::new(&scorer, &vertices, &edges, seat);
                    for vertex in 0..topology.vertex_count() as Vertex {
                        assert_eq!(
                            occupancy.blocked & (1 << vertex) == 0,
                            crate::game::can_place_settlement(&topology, &vertices, vertex),
                        );
                    }
                }
            }
        }
    }

    /// Multi-source masks retain each site's cheapest reach through own-road chains and rivals.
    #[test]
    fn mask_walk_matches_the_folded_walk_on_scrambled_boards() {
        for (topology, board) in walk_fixtures() {
            let scorer = AppFormulaScorer::new(&board, &topology, default_weights());
            let mut scratch = Scratch::default();
            for (board_index, (vertices, edges)) in scrambled_owners(&topology).iter().enumerate() {
                for seat in 0..6 {
                    let occupancy = Occupancy::new(&scorer, vertices, edges, seat);
                    for candidate in 0..topology.vertex_count() as Vertex {
                        let mut sources = [0; 2];
                        for (edge, to) in scorer.steps(candidate) {
                            let owner = edges[usize::from(edge)];
                            if owner == EMPTY || owner == seat {
                                sources[usize::from(owner == EMPTY)] |= 1 << to;
                            }
                        }
                        walk(&mut scratch, &scorer, vertices, edges, seat, candidate);
                        let mut cheapest = [None; 128];
                        for site in &scratch.sites {
                            let held = &mut cheapest[usize::from(site.vertex)];
                            *held =
                                Some(held.map_or(site.paid_builds, |cost: u32| {
                                    cost.min(site.paid_builds)
                                }));
                        }
                        let mut expected = SiteMasks::default();
                        for (site, cost) in cheapest.iter().enumerate() {
                            if let Some(cost) = cost {
                                expected[*cost as usize] |= 1 << site;
                            }
                        }
                        assert_eq!(
                            mask_walk(&scorer, &occupancy, candidate, sources),
                            expected,
                            "board {board_index} seat {seat} candidate {candidate}"
                        );
                    }
                }
            }
        }
    }

    /// Memo-backed roads preserve the reference's ties and NaN comparisons on every candidate.
    #[test]
    fn row_roads_match_the_reference_on_scrambled_boards() {
        for (topology, board) in walk_fixtures() {
            let mut far = default_weights();
            far.expansion_decay = 0.35;
            far.expansion_weight = 0.4;
            let mut degenerate = default_weights();
            degenerate.resource_value = ResourceValues {
                wood: -1.0,
                sheep: -0.5,
                wheat: -2.0,
                brick: -1.5,
                ore: -3.0,
            };
            degenerate.expansion_decay = f64::NAN;
            let mut negative = degenerate.clone();
            negative.expansion_decay = 0.3;
            let scorers = [
                AppFormulaScorer::new(&board, &topology, default_weights()),
                AppFormulaScorer::new(&board, &topology, far),
                AppFormulaScorer::new(&board, &topology, degenerate),
                AppFormulaScorer::new(&board, &topology, negative),
            ];
            for (board_index, (vertices, edges)) in scrambled_owners(&topology).iter().enumerate() {
                for (scorer_index, scorer) in scorers.iter().enumerate() {
                    for seat in 0..6 {
                        for candidate in 0..topology.vertex_count() as Vertex {
                            assert_eq!(
                                row_road(scorer, vertices, edges, seat, candidate, None),
                                scorer.expansion_road(vertices, edges, seat, candidate),
                                "board {board_index} scorer {scorer_index} seat {seat} candidate {candidate}"
                            );
                        }
                    }
                }
            }
        }
    }

    /// Table reach preserves the walk's cheapest sites through rival roads and settlements.
    #[test]
    fn table_reach_matches_walk_without_own_roads() {
        let mut memo = PriceMemo::default();
        let (topology, board) = fixture();
        let scorer = AppFormulaScorer::new(&board, &topology, default_weights());
        let mut scratch = Scratch::default();
        for state in 0..32 {
            let mut vertices = vec![EMPTY; topology.vertex_count()];
            let mut edges = vec![EMPTY; topology.edge_count()];
            if state != 0 {
                for (index, owner) in vertices.iter_mut().enumerate() {
                    if (index * 17 + state * 11) % 23 < 2 {
                        *owner = (index % 3) as u8;
                    }
                }
                for (index, owner) in edges.iter_mut().enumerate() {
                    if (index * 13 + state * 7) % 19 < 3 {
                        *owner = 1;
                    }
                }
            }
            let occupancy = Occupancy::new(&scorer, &vertices, &edges, 0);
            for candidate in 0..topology.vertex_count() as Vertex {
                walk(&mut scratch, &scorer, &vertices, &edges, 0, candidate);
                let mut expected = SiteMasks::default();
                for site in 0..topology.vertex_count() as Vertex {
                    if let Some(cost) = scratch
                        .sites
                        .iter()
                        .filter(|entry| entry.vertex == site)
                        .map(|entry| entry.paid_builds)
                        .min()
                    {
                        expected[cost as usize] |= 1 << site;
                    }
                }
                assert_eq!(
                    scorer.reach.sites(candidate, &occupancy, &mut memo.sites),
                    expected,
                    "state {state} candidate {candidate}"
                );
            }
        }
    }

    /// An own road in reach selects general reach, including free travel over long chains.
    #[test]
    fn row_expansion_uses_walk_for_nearby_own_roads() {
        let (topology, board) = fixture();
        let scorer = AppFormulaScorer::new(&board, &topology, default_weights());
        let vertices = vec![EMPTY; topology.vertex_count()];
        let mut edges = vec![EMPTY; topology.edge_count()];
        let holdings = Holdings::empty();
        let mut memo = PriceMemo::default();
        let serial = memo.serial(scorer.id, 0);
        for candidate in 0..topology.vertex_count() as Vertex {
            edges.fill(EMPTY);
            for (edge, next) in scorer.steps(candidate) {
                edges[usize::from(edge)] = 0;
                for (edge, _) in scorer.steps(next) {
                    edges[usize::from(edge)] = 0;
                }
            }
            let occupancy = Occupancy::new(&scorer, &vertices, &edges, 0);
            assert_ne!(
                occupancy.own_edges & scorer.reach.near_edges[usize::from(candidate)],
                0
            );
            let fast_before = FAST_PATH_CALLS.with(std::cell::Cell::get);
            let value = row_value(
                &scorer, &holdings, candidate, &occupancy, &mut memo, Some(serial),
            );
            assert_eq!(FAST_PATH_CALLS.with(std::cell::Cell::get), fast_before);
            let direct = term(&scorer, &holdings, &vertices, &edges, 0, candidate).value;
            assert_eq!(value.to_bits(), direct.to_bits());
        }
    }

    /// A memo hit retains direct price bits and never crosses scorer or holdings identities.
    #[test]
    fn price_memo_separates_scorers_and_holdings() {
        let (topology, board) = fixture();
        let mut different = default_weights();
        different.resource_value.wheat *= -2.0;
        let scorers = [
            AppFormulaScorer::new(&board, &topology, default_weights()),
            AppFormulaScorer::new(&board, &topology, different),
        ];
        assert_ne!(scorers[0].id, scorers[1].id);
        assert_eq!(scorers[0].id, scorers[0].clone().id);
        let mut memo = PriceMemo::default();
        for scorer in &scorers {
            for own in [0, 1_u128 << 9, (1_u128 << 9) | (1_u128 << 60)] {
                let serial = memo.serial(scorer.id, own);
                assert_eq!(memo.serial(scorer.id, own), serial);
                let mut holdings = Holdings::empty();
                for vertex in 0..topology.vertex_count() as Vertex {
                    if own & (1 << vertex) != 0 {
                        scorer.add_to_holdings(&mut holdings, vertex);
                    }
                }
                scorer.add_to_holdings(&mut holdings, 3);
                let total = scorer.holdings_diversity_total(&holdings);
                for site in 0..topology.vertex_count() as Vertex {
                    let direct = scorer.site_total_with_holdings(holdings, site, total);
                    let key = price_key(serial, 3, site);
                    assert_eq!(memo.price(key, || direct).to_bits(), direct.to_bits());
                    assert_eq!(
                        memo.price(key, || panic!("expected a memo hit")).to_bits(),
                        direct.to_bits()
                    );
                }
            }
        }
    }

    /// Serial rollover clears prices before reusing an identity, including set evictions.
    #[test]
    fn price_memo_clears_on_serial_rollover() {
        let mut memo = PriceMemo::default();
        assert_eq!(memo.serial(1, 0), 1);
        let key = price_key(1, 3, 4);
        assert_eq!(memo.price(key, || 17.0), 17.0);
        let collisions: Vec<_> = (2..).filter(|id| {
            PriceMemo::context_index(*id, 0) == PriceMemo::context_index(1, 0)
        }).take(4).collect();
        for (index, id) in collisions.iter().enumerate() {
            assert_eq!(memo.serial(*id, 0), index as u32 + 2);
        }
        assert_eq!(memo.serial(1, 0), 6);
        memo.next_serial = u32::MAX;
        assert_eq!(memo.serial(collisions[3] + 1, 0), 1);
        assert_eq!(memo.price(key, || -23.0), -23.0);
    }

    /// Four colliding contexts retain their identities; a fifth replaces only the oldest way.
    #[test]
    fn four_contexts_share_a_set_without_reminting_serials() {
        let ids: Vec<_> = (1..).filter(|id| {
            PriceMemo::context_index(*id, 0) == PriceMemo::context_index(1, 0)
        }).take(5).collect();
        let mut memo = PriceMemo::default();
        for _ in 0..8 {
            for (index, id) in ids[..4].iter().enumerate() {
                assert_eq!(memo.serial(*id, 0), index as u32 + 1);
            }
        }
        assert_eq!(memo.serial(ids[4], 0), 5);
        for (index, id) in ids[1..4].iter().enumerate() {
            assert_eq!(memo.serial(*id, 0), index as u32 + 2);
        }
        assert_eq!(memo.serial(ids[0], 0), 6);
    }

    /// Rollover invalidates contexts too, so an old identity cannot reclaim a reissued serial.
    #[test]
    fn serial_rollover_invalidates_contexts_before_reissuing_serials() {
        let slot = PriceMemo::context_index;
        let old = 1;
        let near_wrap = (2..).find(|id| slot(*id, 0) != slot(old, 0)).unwrap();
        let new = (near_wrap + 1..).find(|id| {
            slot(*id, 0) != slot(old, 0) && slot(*id, 0) != slot(near_wrap, 0)
        }).unwrap();
        let mut memo = PriceMemo::default();
        let serial = memo.serial(old, 0);
        let key = price_key(serial, 7, 9);
        assert_eq!(memo.price(key, || 17.0), 17.0);
        let mut value = ValueEntry::new(serial, 7, [0, 1 << 9, 0]);
        value.value = 19.0;
        memo.values[value.index()] = value;

        memo.next_serial = u32::MAX - 1;
        assert_eq!(memo.serial(near_wrap, 0), u32::MAX - 1);
        assert_eq!(memo.serial(new, 0), serial);
        assert_eq!(memo.price(key, || -23.0), -23.0);
        assert!(!memo.values[value.index()].same_key(&value));

        let renewed = memo.serial(old, 0);
        assert_ne!(renewed, serial);
        memo.price(price_key(renewed, 7, 9), || 17.0);
        let mut renewed_value = ValueEntry::new(renewed, 7, [0, 1 << 9, 0]);
        renewed_value.value = 19.0;
        memo.values[renewed_value.index()] = renewed_value;
        assert_eq!(memo.serial(new, 0), serial);
        assert_eq!(memo.price(key, || -23.0), -23.0);
        assert!(!memo.values[value.index()].same_key(&value));
    }

    /// Cached decays keep runtime powf's bits even when release optimizes integer exponents.
    #[test]
    fn cached_decays_match_runtime_powers() {
        let (topology, board) = fixture();
        let decays = (0..=4093).map(|i| 0.125 + 0.875 * (f64::from(i) / 4093.0));
        for decay in decays.chain([
            -1.0, -0.7, -0.3, -0.125, -0.0, 0.0, f64::NEG_INFINITY,
            f64::INFINITY, f64::NAN,
        ]) {
            let mut weights = default_weights();
            weights.expansion_decay = decay;
            let scorer = AppFormulaScorer::new(&board, &topology, weights);
            for (k, cached) in scorer.decay_pow.iter().enumerate() {
                let direct = std::hint::black_box(decay).powf(std::hint::black_box(k as f64));
                assert_eq!(cached.to_bits(), direct.to_bits(), "decay {decay:?} exponent {k}");
            }
        }
    }

    fn default_weights() -> EngineWeights {
        serde_json::from_str(include_str!("../../../../placement/default-weights.json")).unwrap()
    }

    /// A weight of 0 skips the walk entirely, which is what keeps a zeroed vector on the rollout
    /// hot path it was on before the term existed. The shipped weight is 0.1 since M-66, the SP6
    /// gate, so the shipped vector walks: that is asserted here too, because the whole adoption
    /// is worthless if the term the gate measured is skipped in the field.
    #[test]
    fn a_zero_weight_never_reaches_the_walk_and_the_shipped_one_does() {
        let (topology, board) = fixture();
        let shipped = default_weights();
        assert_eq!(shipped.expansion_weight, 0.1, "the shipped weight is the adopted 0.1");
        let mut zeroed = shipped.clone();
        zeroed.expansion_weight = 0.0;
        let scorer = AppFormulaScorer::new(&board, &topology, zeroed);
        let vertex_owner = vec![EMPTY; topology.vertex_count()];
        let edge_owner = vec![EMPTY; topology.edge_count()];

        let before = walk_calls();
        for vertex in 0..topology.vertex_count() {
            scorer.score_for_owner(&vertex_owner, &edge_owner, 0, vertex as Vertex, true);
            scorer.breakdown_for_owner(&vertex_owner, &edge_owner, 0, vertex as Vertex, false);
        }
        assert_eq!(walk_calls(), before, "weight 0 must not walk");

        let scorer = AppFormulaScorer::new(&board, &topology, shipped);
        let score = scorer.score_for_owner(&vertex_owner, &edge_owner, 0, 0, false);
        assert!(walk_calls() > before, "the shipped weight must walk");
        assert!(score.is_finite());
    }

    /// The two boxing walks find the same sites.
    ///
    /// `cli::expansion::reachable_expansion_sites` counts what a seat's *existing* road network
    /// reaches in two more builds; this walk counts what a candidate would open with its free
    /// setup road plus two. Give the CLI walk the seat's settlement on the candidate and a road
    /// out of every one of its edges, which is the setup road in each direction at once, and the
    /// two horizons coincide: three edges of open board either way.
    #[test]
    fn the_walk_reaches_what_the_boxing_walk_reaches() {
        let (topology, board) = fixture();
        let mut weights = default_weights();
        weights.expansion_weight = 0.3;
        let scorer = AppFormulaScorer::new(&board, &topology, weights);
        let candidate: Vertex = 24;
        let rivals: [Vertex; 2] = [40, 55];

        let mut vertex_owner = vec![EMPTY; topology.vertex_count()];
        let mut edge_owner = vec![EMPTY; topology.edge_count()];
        for rival in rivals {
            vertex_owner[usize::from(rival)] = 1;
        }
        // One rival road well away from the candidate, so both walks have a wall to respect.
        edge_owner[usize::from(topology.vertex_edges(rivals[0])[0])] = 1;

        let mut walked: Vec<Vertex> = sites_by_edge(&scorer, &vertex_owner, &edge_owner, 0, candidate)
            .into_iter()
            .flat_map(|(_, sites)| sites.into_iter().map(|site| site.vertex))
            .collect();
        walked.sort_unstable();
        walked.dedup();

        let mut boxed_owner = vertex_owner.clone();
        boxed_owner[usize::from(candidate)] = 0;
        let mut boxed_edges = edge_owner.clone();
        for edge in topology.vertex_edges(candidate) {
            boxed_edges[usize::from(*edge)] = 0;
        }
        let counted = boxing_sites(&topology, &boxed_owner, &boxed_edges, 0);
        assert!(!walked.is_empty(), "the candidate must open something");
        assert_eq!(walked, counted);

        // The pieces have to be doing something, or the two walks agree on an empty board and the
        // comparison above proves nothing about the stop rules.
        let open = sites_by_edge(
            &scorer,
            &vec![EMPTY; topology.vertex_count()],
            &vec![EMPTY; topology.edge_count()],
            0,
            candidate,
        );
        let open: Vec<Vertex> = open
            .into_iter()
            .flat_map(|(_, sites)| sites.into_iter().map(|site| site.vertex))
            .collect();
        assert!(
            walked.iter().all(|vertex| open.contains(vertex)) && walked.len() < open.len(),
            "the rivals must close sites the open board offers"
        );
    }

    /// The road is the first edge of the cheapest path to the best site, ties on the larger
    /// top-two sum and then on the lower edge index.
    ///
    /// Recomputed here from the per-edge walk on every candidate the board offers, which is what
    /// `src/engine/__tests__/expansion.test.ts` did to the TypeScript rule. The analysis corpus
    /// pins the road only on the boards it holds, so this is what pins the rule itself.
    #[test]
    fn the_road_goes_to_the_best_site_and_ties_fall_to_the_lower_edge() {
        let (topology, board) = fixture();
        let mut weights = default_weights();
        weights.expansion_weight = 0.3;
        let decay = weights.expansion_decay;
        let scorer = AppFormulaScorer::new(&board, &topology, weights);
        let vertex_owner = vec![EMPTY; topology.vertex_count()];
        let edge_owner = vec![EMPTY; topology.edge_count()];
        let holdings = Holdings::empty();

        let mut roads = 0;
        for vertex in 0..topology.vertex_count() {
            let candidate = vertex as Vertex;
            let by_edge = sites_by_edge(&scorer, &vertex_owner, &edge_owner, 0, candidate);
            let road = term(&scorer, &holdings, &vertex_owner, &edge_owner, 0, candidate).road;
            if by_edge.is_empty() {
                assert_eq!(road, None, "vertex {vertex} opens nothing");
                continue;
            }
            let mut with_candidate = holdings;
            scorer.add_to_holdings(&mut with_candidate, candidate);
            // (best, pair, edge), ranked the way the rule ranks them: best and pair descending,
            // edge ascending. `f64::total_cmp` only orders the keys here; the rule's own
            // comparisons are the ones under test.
            let mut ranked: Vec<(f64, f64, Edge)> = by_edge
                .iter()
                .map(|(first_edge, sites)| {
                    let mut values: Vec<f64> = sites
                        .iter()
                        .map(|site| {
                            scorer.total_with_holdings(with_candidate, site.vertex, false)
                                * decay.powf(f64::from(site.paid_builds))
                        })
                        .collect();
                    values.sort_by(|left, right| right.total_cmp(left));
                    // `top_two` of one value is that value, not the value plus negative infinity.
                    let best = values[0];
                    let pair = values.get(1).map_or(best, |second| best + second);
                    (best, pair, *first_edge)
                })
                .collect();
            ranked.sort_by(|left, right| {
                right
                    .0
                    .total_cmp(&left.0)
                    .then(right.1.total_cmp(&left.1))
                    .then(left.2.cmp(&right.2))
            });
            assert_eq!(road, Some(ranked[0].2), "vertex {vertex} road");
            roads += 1;
        }
        assert!(roads > 0, "no candidate on the fixture board opens a site");
    }

    /// Every site of one call is priced against the same holdings, so the holdings' own diversity
    /// total is scored once per call and each site adds only its own.
    #[test]
    fn a_term_scores_the_holdings_diversity_once() {
        use crate::placement::app_formula::diversity_score_calls;

        let (topology, board) = fixture();
        let scorer = AppFormulaScorer::new(&board, &topology, default_weights());
        let vertex_owner = vec![EMPTY; topology.vertex_count()];
        let edge_owner = vec![EMPTY; topology.edge_count()];
        let distinct_sites = |candidate: Vertex| {
            let mut sites: Vec<Vertex> =
                sites_by_edge(&scorer, &vertex_owner, &edge_owner, 0, candidate)
                    .into_iter()
                    .flat_map(|(_, sites)| sites.into_iter().map(|site| site.vertex))
                    .collect();
            sites.sort_unstable();
            sites.dedup();
            sites.len()
        };
        let candidate = (0..topology.vertex_count() as Vertex)
            .find(|candidate| distinct_sites(*candidate) >= 3)
            .expect("an empty board opens at least three sites from some vertex");
        let sites = distinct_sites(candidate);

        let before = diversity_score_calls();
        let value = term(&scorer, &Holdings::empty(), &vertex_owner, &edge_owner, 0, candidate);
        assert!(value.road.is_some());
        assert_eq!(
            diversity_score_calls() - before,
            sites + 1,
            "one total per site plus one for the holdings"
        );
    }

    /// A site is listed once per first edge, at the cheapest cost the walk reaches it for.
    ///
    /// A chain of the seat's own roads out of the candidate leaves both road-spent lanes live: the
    /// far end is reached over own roads with the setup road still in hand, and again a ring around
    /// with the road spent. The lanes settle separately, so without the per-vertex guard the walk
    /// lists that one site twice, at two costs, and `top_two` pairs it with itself. Mirrors
    /// `src/engine/__tests__/expansion.test.ts`.
    #[test]
    fn a_site_is_listed_once_per_first_edge() {
        let (topology, board) = fixture();
        let mut weights = default_weights();
        weights.expansion_weight = 0.3;
        let scorer = AppFormulaScorer::new(&board, &topology, weights);
        let candidate: Vertex = 24;
        let near = topology.vertex_edges(candidate)[0];
        let neighbour = topology
            .edge_endpoints(near)
            .into_iter()
            .find(|vertex| *vertex != candidate)
            .unwrap();
        let far = *topology
            .vertex_edges(neighbour)
            .iter()
            .find(|edge| **edge != near)
            .unwrap();
        let far_end = topology
            .edge_endpoints(far)
            .into_iter()
            .find(|vertex| *vertex != neighbour)
            .unwrap();

        let vertex_owner = vec![EMPTY; topology.vertex_count()];
        let mut edge_owner = vec![EMPTY; topology.edge_count()];
        edge_owner[usize::from(near)] = 0;
        edge_owner[usize::from(far)] = 0;

        let by_edge = sites_by_edge(&scorer, &vertex_owner, &edge_owner, 0, candidate);
        let sites = by_edge
            .iter()
            .find(|(edge, _)| *edge == near)
            .map(|(_, sites)| sites)
            .expect("the own-road direction must open sites");
        let listed: Vec<&ExpansionSite> =
            sites.iter().filter(|site| site.vertex == far_end).collect();
        assert_eq!(
            listed,
            vec![&ExpansionSite {
                vertex: far_end,
                paid_builds: 0
            }],
            "the far end of the own-road chain is one site, reached free"
        );
        for (edge, sites) in &by_edge {
            let mut seen: Vec<Vertex> = sites.iter().map(|site| site.vertex).collect();
            let listed = seen.len();
            seen.sort_unstable();
            seen.dedup();
            assert_eq!(seen.len(), listed, "edge {edge} listed a site twice");
        }
    }

    /// With every direction worth the same, the rule has nothing left but the edge index, and it
    /// must take the lower one.
    ///
    /// The tie is built by flattening the site scores rather than the board: every weight that
    /// feeds a vertex's value is zeroed, so each site is worth exactly 0 and each edge out of a
    /// candidate reaches the same best and the same pair. The app shows the road by its edge *id*,
    /// and `topology.rs::pack_edges_are_listed_in_edge_id_order` is what makes the lower index
    /// the lower id.
    #[test]
    fn equal_directions_fall_to_the_lower_edge() {
        let (topology, board) = fixture();
        let mut weights = default_weights();
        weights.expansion_weight = 0.3;
        weights.expansion_decay = 1.0;
        weights.resource_value = ResourceValues {
            wood: 0.0,
            sheep: 0.0,
            wheat: 0.0,
            brick: 0.0,
            ore: 0.0,
        };
        weights.hand_value_weight = 0.0;
        weights.scarcity_weight = 0.0;
        weights.diversity_weight = 0.0;
        weights.coverage_scarcity_weight = 0.0;
        weights.duplicate_number_penalty = 0.0;
        weights.recipe_road_bonus = 0.0;
        weights.recipe_city_bonus = 0.0;
        weights.recipe_settlement_bonus = 0.0;
        weights.recipe_dev_card_bonus = 0.0;
        weights.port_weight = 0.0;
        weights.port_coverage_deficit_weight = 0.0;
        weights.robber_discount = 0.0;
        weights.robber_concentration_weight = 0.0;
        let scorer = AppFormulaScorer::new(&board, &topology, weights);
        let vertex_owner = vec![EMPTY; topology.vertex_count()];
        let edge_owner = vec![EMPTY; topology.edge_count()];
        let holdings = Holdings::empty();

        let mut ties = 0;
        for vertex in 0..topology.vertex_count() {
            let candidate = vertex as Vertex;
            assert_eq!(
                scorer.total_with_holdings(holdings, candidate, false),
                0.0,
                "vertex {vertex} must be worth nothing, or the directions are not tied"
            );
            let by_edge = sites_by_edge(&scorer, &vertex_owner, &edge_owner, 0, candidate);
            if by_edge.len() < 2 {
                continue;
            }
            let road = term(&scorer, &holdings, &vertex_owner, &edge_owner, 0, candidate).road;
            let lowest = by_edge.iter().map(|(edge, _)| *edge).min();
            assert_eq!(road, lowest, "vertex {vertex} must fall to the lower edge");
            ties += 1;
        }
        assert!(ties > 0, "no candidate reached the edge tie-break");
    }

    /// `cli::expansion::reachable_expansion_sites` as a set rather than a count. The CLI crate
    /// depends on the engine, not the other way round, so the walk under test is compared against
    /// a transcription of it kept here; `crates/cli/src/expansion.rs` is the original.
    fn boxing_sites(
        topology: &Topology,
        vertex_owner: &[u8],
        edge_owner: &[u8],
        seat: u8,
    ) -> Vec<Vertex> {
        let mut reached = 0_u128;
        for edge in 0..topology.edge_count() {
            if edge_owner[edge] == seat {
                for vertex in topology.edge_endpoints(edge as Edge) {
                    reached |= 1 << vertex;
                }
            }
        }
        let mut frontier = reached;
        for _ in 0..MAX_PAID_BUILDS {
            let mut next = 0_u128;
            for vertex in 0..topology.vertex_count() {
                if frontier & (1 << vertex) == 0 {
                    continue;
                }
                let owner = vertex_owner[vertex];
                if owner != EMPTY && owner != seat {
                    continue;
                }
                for adjacent in topology.vertex_adjacent(vertex as Vertex) {
                    let Some(edge) = topology.edge_between(vertex as Vertex, *adjacent) else {
                        continue;
                    };
                    if edge_owner[usize::from(edge)] != EMPTY || reached & (1 << adjacent) != 0 {
                        continue;
                    }
                    next |= 1 << adjacent;
                }
            }
            reached |= next;
            frontier = next;
        }
        (0..topology.vertex_count())
            .map(|vertex| vertex as Vertex)
            .filter(|vertex| {
                reached & (1 << vertex) != 0
                    && crate::game::can_place_settlement(topology, vertex_owner, *vertex)
            })
            .collect()
    }
}

#[cfg(test)]
pub(super) mod speed_tests {
    use super::*;
    use crate::board::{ConversionOptions, SimBoard};
    use crate::placement::app_formula::EngineWeights;
    use crate::rules::RuleConfig;
    use crate::topology::{Layout, Topology};
    use crate::wire::WireBoard;

    pub(in crate::placement) fn corpus_boards() -> Vec<(Topology, SimBoard)> {
        let corpus: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../fixtures/analysis-parity.json"
        )).unwrap();
        let boards: Vec<_> = corpus["cases"].as_array().unwrap().iter().filter_map(|case| {
            let value = &case["request"]["board"];
            let layout = if value["layout"] == "standard4" {
                Layout::Standard4
            } else {
                Layout::Extension6
            };
            let topology = Topology::load(layout).unwrap();
            let wire = WireBoard::parse_value(value.clone()).unwrap();
            let board = SimBoard::try_from_wire(
                wire, &topology, &RuleConfig::base(layout),
                ConversionOptions { allow_unofficial: true },
            ).ok()?;
            Some((topology, board))
        }).collect();
        assert!(boards.len() >= 10);
        boards
    }

    #[test]
    fn road_table_matches_each_first_edge_and_reference_road() {
        let mut fast = 0;
        let mut fallback = 0;
        for (topology, board) in corpus_boards() {
            let weights: EngineWeights = serde_json::from_str(include_str!(
                "../../../../placement/default-weights.json"
            )).unwrap();
            let scorer = AppFormulaScorer::new(&board, &topology, weights);
            for (vertices, edges) in tests::scrambled_owners(&topology).into_iter().take(12) {
                for seat in 0..6 {
                    let occupancy = Occupancy::new(&scorer, &vertices, &edges, seat);
                    for candidate in 0..topology.vertex_count() as Vertex {
                        if scorer.reach.table_path(candidate, &occupancy) {
                            fast += 1;
                            for (edge, to) in scorer.steps(candidate) {
                                let expected = mask_walk(&scorer, &occupancy, candidate, [0, 1 << to]);
                                if occupancy.rival_edges & (1 << edge) == 0 {
                                    assert_eq!(scorer.reach.road_sites(candidate, edge, &occupancy), expected);
                                }
                            }
                        } else {
                            fallback += 1;
                        }
                        assert_eq!(
                            row_road(&scorer, &vertices, &edges, seat, candidate, Some(&occupancy)),
                            scorer.expansion_road(&vertices, &edges, seat, candidate),
                        );
                    }
                }
            }
        }
        assert!(fast > 1_000 && fallback > 100, "fast={fast} fallback={fallback}");
    }

    #[test]
    fn road_uses_reference_when_price_memo_is_borrowed() {
        let (topology, board) = tests::walk_fixtures().into_iter().next().unwrap();
        let weights = serde_json::from_str(include_str!(
            "../../../../placement/default-weights.json"
        )).unwrap();
        let scorer = AppFormulaScorer::new(&board, &topology, weights);
        let vertices = vec![EMPTY; topology.vertex_count()];
        let edges = vec![EMPTY; topology.edge_count()];
        PRICE_MEMO.with_borrow_mut(|_| {
            for candidate in 0..topology.vertex_count() as Vertex {
                assert_eq!(
                    row_road(&scorer, &vertices, &edges, 0, candidate, None),
                    scorer.expansion_road(&vertices, &edges, 0, candidate),
                );
            }
        });
    }
}
