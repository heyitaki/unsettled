use std::cell::Cell;

use serde::{Deserialize, Serialize};

use crate::board::{SimBoard, SimPort};
use crate::longest_road::RoadNetwork;
use crate::rules::{Buildable, FlattenedRules, OwnedPort, RESOURCE_COUNT, Resource};
use crate::state::{EMPTY, GameState, MAX_EDGES, MAX_SEATS, MAX_VERTICES};
use crate::topology::{Edge, Hex, Topology, Vertex};

pub const MAX_ACTIONS: usize = 4096;

/// The cached legality sets below address vertices and edges by bit, so a layout can hold no more
/// of either than a `u128` has room for.
const _: () = assert!(MAX_VERTICES <= u128::BITS as usize);
const _: () = assert!(MAX_EDGES <= u128::BITS as usize);

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DevPlay {
    Knight {
        destination: Hex,
        victim: Option<u8>,
    },
    RoadBuilding {
        first: Option<Edge>,
        second: Option<Edge>,
    },
    YearOfPlenty {
        first: Resource,
        second: Resource,
    },
    Monopoly {
        resource: Resource,
    },
}

impl DevPlay {
    pub const fn kind_index(self) -> usize {
        match self {
            Self::Knight { .. } => 0,
            Self::RoadBuilding { .. } => 2,
            Self::YearOfPlenty { .. } => 3,
            Self::Monopoly { .. } => 4,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Action {
    BuildRoad(Edge),
    BuildSettlement(Vertex),
    UpgradeCity(Vertex),
    BuyDev,
    PlayDev(DevPlay),
    TradeBank {
        give: Resource,
        get: Resource,
        count: u8,
    },
    Pass,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
pub struct ScoredAction {
    pub action: Action,
    pub score: f32,
}

const EMPTY_ACTION: ScoredAction = ScoredAction {
    action: Action::Pass,
    score: f32::NEG_INFINITY,
};

#[derive(Clone, Debug)]
pub struct ActionBuf {
    values: [ScoredAction; MAX_ACTIONS],
    len: usize,
}

impl ActionBuf {
    pub const fn new() -> Self {
        Self {
            values: [EMPTY_ACTION; MAX_ACTIONS],
            len: 0,
        }
    }

    pub fn clear(&mut self) {
        self.len = 0;
    }

    pub fn push(&mut self, action: ScoredAction) {
        assert!(self.len < MAX_ACTIONS, "legal action buffer overflow");
        self.values[self.len] = action;
        self.len += 1;
    }

    pub fn as_slice(&self) -> &[ScoredAction] {
        &self.values[..self.len]
    }
}

impl Default for ActionBuf {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DecisionPhase {
    PreRoll,
    Action,
    SpecialBuild,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DecisionSnapshot {
    pub observer: u8,
    pub seats: u8,
    pub vertex_owner: Vec<u8>,
    pub vertex_tier: Vec<u8>,
    pub edge_owner: Vec<u8>,
    pub robber: Hex,
    pub ports: Vec<SimPortSnapshot>,
    pub bank: [u16; RESOURCE_COUNT],
    pub public_vp: [u8; MAX_SEATS],
    pub hand_sizes: [u16; MAX_SEATS],
    pub dev_counts: [u8; MAX_SEATS],
    pub knights_played: [u8; MAX_SEATS],
    pub longest_road_len: [u8; MAX_SEATS],
    pub pieces: [[u8; 4]; MAX_SEATS],
    pub trade_rates: [[u32; RESOURCE_COUNT]; MAX_SEATS],
    pub own_hand: [i16; RESOURCE_COUNT],
    pub own_playable_dev: [u8; 5],
    pub own_bought_dev: [u8; 5],
    pub dev_deck_remaining: u8,
    pub largest_army_holder: Option<usize>,
    pub longest_road_holder: Option<usize>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct SimPortSnapshot {
    pub edge: Edge,
    pub resource: Option<Resource>,
    pub rate: u32,
}

/// The observer's road segments, summarised for the legality checks that run per vertex and edge.
#[derive(Clone, Copy)]
struct OwnRoads {
    /// One bit per vertex the observer's network reaches.
    vertices: u128,
    count: u8,
}

/// Facts derived from the borrowed `GameState` that several scoring passes need.
///
/// The state cannot change while the view lives, so a value computed once is good for the whole
/// decision. Without this, board-wide sums are recomputed inside loops that already run once per
/// vertex and once per edge -- `vertex_score` alone re-derived the observer's entire production
/// on every call.
struct ViewCache {
    production: [Cell<Option<[u16; RESOURCE_COUNT]>>; MAX_SEATS],
    own_roads: Cell<Option<OwnRoads>>,
    /// Legal placements as vertex and edge bitsets. Several passes ask for these across the whole
    /// board within one decision, so they are derived as a set rather than tested one at a time.
    settlements: Cell<Option<u128>>,
    roads: Cell<Option<u128>>,
    sites: Cell<Option<u128>>,
}

impl ViewCache {
    const fn new() -> Self {
        Self {
            production: [const { Cell::new(None) }; MAX_SEATS],
            own_roads: Cell::new(None),
            settlements: Cell::new(None),
            roads: Cell::new(None),
            sites: Cell::new(None),
        }
    }
}

pub struct DecisionView<'a> {
    state: &'a GameState,
    board: &'a SimBoard,
    topology: &'a Topology,
    rules: &'a FlattenedRules,
    observer: usize,
    seats: usize,
    dev_deck_remaining: u8,
    dev_played_this_turn: bool,
    phase: DecisionPhase,
    cache: ViewCache,
}

impl<'a> DecisionView<'a> {
    #[allow(clippy::too_many_arguments)]
    pub const fn new(
        state: &'a GameState,
        board: &'a SimBoard,
        topology: &'a Topology,
        rules: &'a FlattenedRules,
        observer: usize,
        seats: usize,
        dev_deck_remaining: u8,
        dev_played_this_turn: bool,
        phase: DecisionPhase,
    ) -> Self {
        Self {
            state,
            board,
            topology,
            rules,
            observer,
            seats,
            dev_deck_remaining,
            dev_played_this_turn,
            phase,
            cache: ViewCache::new(),
        }
    }

    pub const fn observer(&self) -> usize {
        self.observer
    }

    pub const fn seats(&self) -> usize {
        self.seats
    }

    pub const fn phase(&self) -> DecisionPhase {
        self.phase
    }

    pub fn topology(&self) -> &Topology {
        self.topology
    }

    pub fn board(&self) -> &SimBoard {
        self.board
    }

    pub fn own_hand(&self) -> &[i16; RESOURCE_COUNT] {
        &self.state.players[self.observer].resources
    }

    pub fn own_playable_dev(&self) -> &[u8; 5] {
        &self.state.players[self.observer].playable_dev
    }

    pub fn own_bought_dev(&self) -> &[u8; 5] {
        &self.state.players[self.observer].bought_dev
    }

    pub fn hand_size(&self, seat: usize) -> u16 {
        self.state.players[seat].hand_size()
    }

    pub const fn public_vp(&self, seat: usize) -> u8 {
        self.state.players[seat].vp_public
    }

    pub const fn own_total_vp(&self) -> u8 {
        self.state.players[self.observer].vp_public + self.state.players[self.observer].vp_dev
    }

    pub fn dev_count(&self, seat: usize) -> u8 {
        self.state.players[seat].playable_dev.iter().sum::<u8>()
            + self.state.players[seat].bought_dev.iter().sum::<u8>()
            + self.state.players[seat].vp_dev
    }

    pub const fn knights_played(&self, seat: usize) -> u8 {
        self.state.players[seat].knights_played
    }

    pub const fn longest_road_len(&self, seat: usize) -> u8 {
        self.state.players[seat].longest_road_len
    }

    pub const fn pieces(&self, seat: usize, buildable: Buildable) -> u8 {
        self.state.players[seat].pieces[buildable.index()]
    }

    pub const fn trade_rate_for(&self, seat: usize, resource: Resource) -> u32 {
        self.state.players[seat].trade_rate[resource.index()]
    }

    pub const fn trade_rate(&self, resource: Resource) -> u32 {
        self.rules.trade_rate(resource)
    }

    pub fn prospective_trade_rate(&self, port: SimPort, resource: Resource) -> u32 {
        self.rules.prospective_trade_rate(
            OwnedPort {
                resource: port.resource,
                rate: port.rate,
            },
            resource,
        )
    }

    pub const fn bank(&self, resource: Resource) -> u16 {
        self.state.bank[resource.index()]
    }

    pub const fn robber(&self) -> Hex {
        self.state.robber
    }

    pub const fn vertex_owner(&self, vertex: Vertex) -> Option<u8> {
        let owner = self.state.vertex_owner[vertex as usize];
        if owner == EMPTY { None } else { Some(owner) }
    }

    pub const fn vertex_tier(&self, vertex: Vertex) -> u8 {
        self.state.vertex_tier[vertex as usize]
    }

    pub const fn edge_owner(&self, edge: Edge) -> Option<u8> {
        let owner = self.state.edge_owner[edge as usize];
        if owner == EMPTY { None } else { Some(owner) }
    }

    pub fn ports(&self) -> &[crate::board::SimPort] {
        self.board.ports()
    }

    pub const fn dev_deck_remaining(&self) -> u8 {
        self.dev_deck_remaining
    }

    pub const fn largest_army_holder(&self) -> Option<usize> {
        self.state.largest_army
    }

    pub const fn longest_road_holder(&self) -> Option<usize> {
        self.state.longest_road.holder
    }

    pub const fn win_vp(&self) -> u8 {
        self.rules.win_vp()
    }

    pub const fn longest_road_min(&self) -> u8 {
        self.rules.longest_road_min()
    }

    pub const fn longest_road_vp(&self) -> u8 {
        self.rules.longest_road_vp()
    }

    pub const fn largest_army_min(&self) -> u8 {
        self.rules.largest_army_min()
    }

    /// Whether playing one more knight would take the Largest Army card. A derived fact about the
    /// game state rather than a policy preference, so every policy agrees on it.
    pub fn knight_takes_largest_army(&self) -> bool {
        if self.largest_army_holder() == Some(self.observer) {
            return false;
        }
        let next = self.knights_played(self.observer).saturating_add(1);
        if next < self.largest_army_min() {
            return false;
        }
        match self.largest_army_holder() {
            Some(holder) => next > self.knights_played(holder),
            None => (0..self.seats())
                .filter(|seat| *seat != self.observer)
                .all(|seat| next > self.knights_played(seat)),
        }
    }

    pub const fn largest_army_vp(&self) -> u8 {
        self.rules.largest_army_vp()
    }

    fn own_roads(&self) -> OwnRoads {
        if let Some(cached) = self.cache.own_roads.get() {
            return cached;
        }
        let mut summary = OwnRoads {
            vertices: 0,
            count: 0,
        };
        for edge in 0..self.topology.edge_count() {
            if self.state.edge_owner[edge] == self.observer as u8 {
                for vertex in self.topology.edge_endpoints(edge as Edge) {
                    summary.vertices |= 1 << vertex;
                }
                summary.count = summary.count.saturating_add(1);
            }
        }
        self.cache.own_roads.set(Some(summary));
        summary
    }

    /// How many roads the observer owns. A trail cannot use more edges than exist, so this is a
    /// sound upper bound on any achievable road length -- unlike the current longest trail, which
    /// a single edge can raise by much more than one (it may bridge two separate components, or
    /// close a cycle and unlock an Euler trail).
    pub fn own_road_count(&self) -> u8 {
        self.own_roads().count
    }

    /// The observer's road graph, ready to be probed with prospective segments. Scoring passes that
    /// weigh many candidate roads build this once and call [`Self::road_length_on`] per candidate.
    pub fn road_network(&self) -> RoadNetwork {
        RoadNetwork::for_seat(
            self.topology,
            &self.state.vertex_owner,
            &self.state.edge_owner,
            self.observer as u8,
        )
    }

    pub fn road_length_after(&self, first: Edge, second: Option<Edge>) -> u8 {
        self.road_length_on(&mut self.road_network(), first, second, u8::MAX)
    }

    /// As [`Self::road_length_after`], but over a network the caller already built and bounded by
    /// `cap` -- see [`RoadNetwork::probe`] for what capping does and does not promise.
    pub fn road_length_on(
        &self,
        network: &mut RoadNetwork,
        first: Edge,
        second: Option<Edge>,
        cap: u8,
    ) -> u8 {
        let mut segments = [self.topology.edge_endpoints(first); 2];
        let count = match second {
            Some(second) => {
                segments[1] = self.topology.edge_endpoints(second);
                2
            }
            None => 1,
        };
        network.probe(&segments[..count], cap)
    }

    pub fn costs(&self, buildable: Buildable) -> &[[u8; RESOURCE_COUNT]] {
        self.rules.costs(buildable)
    }

    pub fn can_afford(&self, buildable: Buildable) -> bool {
        self.costs(buildable)
            .iter()
            .any(|cost| can_pay(self.own_hand(), cost))
    }

    pub fn affordable_city(&self) -> Option<Vertex> {
        if !self.can_afford(Buildable::City) || self.pieces(self.observer, Buildable::City) == 0 {
            return None;
        }
        (0..self.topology.vertex_count())
            .map(|vertex| vertex as Vertex)
            .filter(|vertex| {
                self.vertex_owner(*vertex) == Some(self.observer as u8)
                    && self.vertex_tier(*vertex) == 1
            })
            .max_by_key(|vertex| self.vertex_pips(*vertex, true))
    }

    pub fn affordable_settlement(&self) -> Option<Vertex> {
        if !self.can_afford(Buildable::Settlement)
            || self.pieces(self.observer, Buildable::Settlement) == 0
        {
            return None;
        }
        self.best_legal_settlement()
    }

    pub fn affordable_road(&self) -> Option<Edge> {
        if !self.can_afford(Buildable::Road) {
            return None;
        }
        self.best_legal_road()
    }

    pub fn best_legal_settlement(&self) -> Option<Vertex> {
        (0..self.topology.vertex_count())
            .map(|vertex| vertex as Vertex)
            .filter(|vertex| self.legal_settlement(*vertex))
            .max_by_key(|vertex| self.vertex_pips(*vertex, true))
    }

    pub fn best_legal_road(&self) -> Option<Edge> {
        (0..self.topology.edge_count())
            .map(|edge| edge as Edge)
            .filter(|edge| self.legal_road(*edge))
            .max_by_key(|edge| {
                self.topology
                    .edge_endpoints(*edge)
                    .iter()
                    .map(|vertex| self.vertex_pips(*vertex, true))
                    .max()
                    .unwrap_or(0)
            })
    }

    pub fn best_road_building_pair(&self) -> (Option<Edge>, Option<Edge>) {
        let mut best = (None, None);
        let mut best_score = 0_u16;
        for first in 0..self.topology.edge_count() {
            let first = first as Edge;
            if !self.legal_road(first) {
                continue;
            }
            let first_score = self
                .topology
                .edge_endpoints(first)
                .iter()
                .map(|vertex| self.vertex_pips(*vertex, true))
                .max()
                .unwrap_or(0);
            let mut found_second = false;
            for second in self.topology.edge_neighbors(first) {
                let second = *second;
                if !self.legal_road_after(first, second) {
                    continue;
                }
                found_second = true;
                let score = first_score
                    + self
                        .topology
                        .edge_endpoints(second)
                        .iter()
                        .map(|vertex| self.vertex_pips(*vertex, true))
                        .max()
                        .unwrap_or(0);
                if best.0.is_none() || score > best_score {
                    best = (Some(first), Some(second));
                    best_score = score;
                }
            }
            if !found_second && best.0.is_none() {
                best = (Some(first), None);
                best_score = first_score;
            }
        }
        best
    }

    pub fn best_expansion_road(&self) -> Option<Edge> {
        let mut best = None;
        let mut best_score = 0_u16;
        for first in 0..self.topology.edge_count() {
            let first = first as Edge;
            if !self.legal_road(first) {
                continue;
            }
            for target in self.topology.edge_endpoints(first) {
                if self.is_expansion_target(target) {
                    let score = self.vertex_pips(target, true) * 2 + 1;
                    if best.is_none() || score > best_score {
                        best = Some(first);
                        best_score = score;
                    }
                }
            }
            for second in self.topology.edge_neighbors(first) {
                let second = *second;
                if !self.legal_road_after(first, second) {
                    continue;
                }
                for target in self.topology.edge_endpoints(second) {
                    if self.is_expansion_target(target) {
                        let score = self.vertex_pips(target, true) * 2;
                        if best.is_none() || score > best_score {
                            best = Some(first);
                            best_score = score;
                        }
                    }
                }
            }
        }
        best
    }

    pub fn legal_settlement(&self, vertex: Vertex) -> bool {
        self.legal_settlements() & (1 << vertex) != 0
    }

    /// Every vertex the observer may settle. Only vertices their roads already reach can qualify,
    /// so this walks that handful rather than the whole board.
    fn legal_settlements(&self) -> u128 {
        if let Some(cached) = self.cache.settlements.get() {
            return cached;
        }
        let mut legal = 0_u128;
        if self.pieces(self.observer, Buildable::Settlement) > 0 {
            let mut rest = self.own_roads().vertices;
            while rest != 0 {
                let vertex = rest.trailing_zeros() as Vertex;
                rest &= rest - 1;
                if self.vertex_owner(vertex).is_none()
                    && self
                        .topology
                        .vertex_adjacent(vertex)
                        .iter()
                        .all(|adjacent| self.vertex_owner(*adjacent).is_none())
                {
                    legal |= 1 << vertex;
                }
            }
        }
        self.cache.settlements.set(Some(legal));
        legal
    }

    pub fn legal_road(&self, edge: Edge) -> bool {
        self.legal_roads() & (1 << edge) != 0
    }

    /// Every edge the observer may build on: unowned, and touching a vertex they hold or an empty
    /// vertex their network already reaches.
    fn legal_roads(&self) -> u128 {
        if let Some(cached) = self.cache.roads.get() {
            return cached;
        }
        let mut legal = 0_u128;
        if self.pieces(self.observer, Buildable::Road) > 0 {
            let sites = self.build_sites();
            for edge in 0..self.topology.edge_count() {
                if self.state.edge_owner[edge] == EMPTY
                    && self
                        .topology
                        .edge_endpoints(edge as Edge)
                        .iter()
                        .any(|endpoint| sites & (1 << endpoint) != 0)
                {
                    legal |= 1 << edge;
                }
            }
        }
        self.cache.roads.set(Some(legal));
        legal
    }

    /// Vertices the observer can extend a road from.
    fn build_sites(&self) -> u128 {
        if let Some(cached) = self.cache.sites.get() {
            return cached;
        }
        let computed = self.compute_build_sites();
        self.cache.sites.set(Some(computed));
        computed
    }

    fn compute_build_sites(&self) -> u128 {
        let reached = self.own_roads().vertices;
        let mut sites = 0_u128;
        for vertex in 0..self.topology.vertex_count() {
            let owner = self.state.vertex_owner[vertex];
            if owner == self.observer as u8 || (owner == EMPTY && reached & (1 << vertex) != 0) {
                sites |= 1 << vertex;
            }
        }
        sites
    }

    pub fn legal_road_after(&self, first: Edge, second: Edge) -> bool {
        if first == second
            || self.edge_owner(second).is_some()
            || self.pieces(self.observer, Buildable::Road) < 2
        {
            return false;
        }
        // `first` is prospective, so it is not among the build sites yet: an empty endpoint shared
        // with `first` is reachable through it.
        let laid = self.topology.edge_endpoints(first);
        let sites = self.build_sites();
        self.topology
            .edge_endpoints(second)
            .iter()
            .any(|endpoint| {
                sites & (1 << endpoint) != 0
                    || (self.vertex_owner(*endpoint).is_none() && laid.contains(endpoint))
            })
    }

    pub fn legal_city(&self, vertex: Vertex) -> bool {
        self.pieces(self.observer, Buildable::City) > 0
            && self.vertex_owner(vertex) == Some(self.observer as u8)
            && self.vertex_tier(vertex) == 1
    }

    pub fn is_expansion_target(&self, vertex: Vertex) -> bool {
        self.vertex_owner(vertex).is_none()
            && self
                .topology
                .vertex_adjacent(vertex)
                .iter()
                .all(|adjacent| self.vertex_owner(*adjacent).is_none())
    }

    pub fn can_buy_dev(&self) -> bool {
        self.dev_deck_remaining > 0
            && self.phase != DecisionPhase::PreRoll
            && can_pay(self.own_hand(), self.rules.dev_cost())
    }

    pub const fn dev_cost(&self) -> &[u8; RESOURCE_COUNT] {
        self.rules.dev_cost()
    }

    pub fn can_play_dev(&self, kind: usize) -> bool {
        self.phase != DecisionPhase::SpecialBuild
            && !self.dev_played_this_turn
            && kind != 1
            && self.own_playable_dev()[kind] > 0
    }

    pub fn legal_trade(&self, give: Resource, get: Resource, count: u8) -> bool {
        if self.phase != DecisionPhase::Action || give == get || count == 0 {
            return false;
        }
        let offered = u64::from(self.trade_rate(give)) * u64::from(count);
        offered <= i16::MAX as u64
            && i64::from(self.own_hand()[give.index()]) >= offered as i64
            && self.bank(get) >= u16::from(count)
    }

    pub fn vertex_pips(&self, vertex: Vertex, robber_aware: bool) -> u16 {
        self.topology
            .vertex_hexes(vertex)
            .iter()
            .filter(|hex| !robber_aware || **hex != self.robber())
            .filter_map(|hex| self.board.tokens()[usize::from(*hex)])
            .map(pips)
            .map(u16::from)
            .sum()
    }

    pub fn production_pips(&self, seat: usize) -> [u16; RESOURCE_COUNT] {
        if let Some(cached) = self.cache.production[seat].get() {
            return cached;
        }
        let computed = self.compute_production_pips(seat);
        self.cache.production[seat].set(Some(computed));
        computed
    }

    fn compute_production_pips(&self, seat: usize) -> [u16; RESOURCE_COUNT] {
        let mut result = [0; RESOURCE_COUNT];
        for vertex_index in 0..self.topology.vertex_count() {
            let vertex = vertex_index as Vertex;
            if self.vertex_owner(vertex) != Some(seat as u8) {
                continue;
            }
            for hex in self.topology.vertex_hexes(vertex) {
                if *hex == self.robber() {
                    continue;
                }
                if let (Some(resource), Some(token)) = (
                    self.board.tiles()[usize::from(*hex)],
                    self.board.tokens()[usize::from(*hex)],
                ) {
                    result[resource.index()] +=
                        u16::from(pips(token)) * u16::from(self.vertex_tier(vertex).max(1));
                }
            }
        }
        result
    }

    pub const fn board_resource_pips(&self) -> [u16; RESOURCE_COUNT] {
        *self.board.resource_pips()
    }

    pub fn hex_touches_seat(&self, hex: Hex, seat: usize) -> bool {
        self.topology
            .hex_vertices(hex)
            .iter()
            .any(|vertex| self.vertex_owner(*vertex) == Some(seat as u8))
    }

    pub fn victim_on_hex(&self, hex: Hex, seat: usize) -> bool {
        self.topology
            .hex_vertices(hex)
            .iter()
            .any(|vertex| self.vertex_owner(*vertex) == Some(seat as u8))
    }

    /// A victim worth naming: adjacent to the hex *and* holding at least one card. Stealing from
    /// an empty hand moves nothing, so the rules treat only these seats as eligible.
    pub fn stealable_on_hex(&self, hex: Hex, seat: usize) -> bool {
        self.victim_on_hex(hex, seat) && self.hand_size(seat) > 0
    }

    pub fn to_owned(&self) -> DecisionSnapshot {
        DecisionSnapshot {
            observer: self.observer as u8,
            seats: self.seats as u8,
            vertex_owner: self.state.vertex_owner[..self.topology.vertex_count()].to_vec(),
            vertex_tier: self.state.vertex_tier[..self.topology.vertex_count()].to_vec(),
            edge_owner: self.state.edge_owner[..self.topology.edge_count()].to_vec(),
            robber: self.state.robber,
            ports: self
                .board
                .ports()
                .iter()
                .map(|port| SimPortSnapshot {
                    edge: port.edge,
                    resource: port.resource,
                    rate: port.rate,
                })
                .collect(),
            bank: self.state.bank,
            public_vp: std::array::from_fn(|seat| self.state.players[seat].vp_public),
            hand_sizes: std::array::from_fn(|seat| self.hand_size(seat)),
            dev_counts: std::array::from_fn(|seat| self.dev_count(seat)),
            knights_played: std::array::from_fn(|seat| self.state.players[seat].knights_played),
            longest_road_len: std::array::from_fn(|seat| self.state.players[seat].longest_road_len),
            pieces: std::array::from_fn(|seat| self.state.players[seat].pieces),
            trade_rates: std::array::from_fn(|seat| self.state.players[seat].trade_rate),
            own_hand: *self.own_hand(),
            own_playable_dev: *self.own_playable_dev(),
            own_bought_dev: *self.own_bought_dev(),
            dev_deck_remaining: self.dev_deck_remaining,
            largest_army_holder: self.state.largest_army,
            longest_road_holder: self.state.longest_road.holder,
        }
    }
}

pub fn can_pay(hand: &[i16; RESOURCE_COUNT], cost: &[u8; RESOURCE_COUNT]) -> bool {
    hand.iter()
        .zip(cost)
        .all(|(held, needed)| *held >= i16::from(*needed))
}

pub const fn pips(token: u8) -> u8 {
    6_u8.saturating_sub(7_u8.abs_diff(token))
}
