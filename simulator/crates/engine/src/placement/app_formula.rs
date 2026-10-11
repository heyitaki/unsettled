use std::cell::Cell;
use std::collections::BTreeMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use serde::Deserialize;

use super::expansion;
use crate::board::SimBoard;
use crate::rules::{RESOURCE_COUNT, Resource};
use crate::topology::{Edge, Topology, Vertex};
use crate::view::pips;

const COVERAGE_MEMO_BITS: u32 = 6;
static NEXT_SCORER_ID: AtomicU64 = AtomicU64::new(1);

// An opaque exponent preserves the reference's libm rounding under release optimization.
#[inline(never)]
fn decay_power(decay: f64, paid_builds: usize) -> f64 {
    decay.powf(std::hint::black_box(paid_builds as f64))
}

thread_local! {
    /// Per-thread direct-mapped memo for coverage powers. Both operand bit patterns key the
    /// stored `powf` result, so hits are exact and entries need no invalidation. Every slot
    /// starts as the true entry for `powf(+0.0, +0.0)`.
    static COVERAGE_POWF_MEMO: [Cell<((u64, u64), f64)>; 1 << COVERAGE_MEMO_BITS] = const {
        [const { Cell::new(((0, 0), 1.0)) }; 1 << COVERAGE_MEMO_BITS]
    };
}

// Times this thread scored a diversity total and ran `coverage`'s `powf`, so tests can pin how
// often each happens. Thread-local for the reason `expansion.rs`'s walk counter is.
#[cfg(test)]
thread_local! {
    static DIVERSITY_SCORE_CALLS: Cell<usize> = const { Cell::new(0) };
    static COVERAGE_POWF_CALLS: Cell<usize> = const { Cell::new(0) };
}

#[cfg(test)]
pub(super) fn diversity_score_calls() -> usize {
    DIVERSITY_SCORE_CALLS.with(Cell::get)
}

#[cfg(test)]
fn coverage_powf_calls() -> usize {
    COVERAGE_POWF_CALLS.with(Cell::get)
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResourceValues {
    pub wood: f64,
    pub sheep: f64,
    pub wheat: f64,
    pub brick: f64,
    pub ore: f64,
}

impl ResourceValues {
    fn get(&self, resource: Resource) -> f64 {
        match resource {
            Resource::Wood => self.wood,
            Resource::Sheep => self.sheep,
            Resource::Wheat => self.wheat,
            Resource::Brick => self.brick,
            Resource::Ore => self.ore,
        }
    }
}

/// How much a draft slot leans on the two position-sensitive components.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SlotScale {
    pub expansion: f64,
    pub diversity: f64,
}

impl SlotScale {
    /// The scales an unkeyed score uses: both components pass through untouched.
    pub const NEUTRAL: Self = Self {
        expansion: 1.0,
        diversity: 1.0,
    };
}

/// Seat counts `slotScales` carries a row for. A board outside this range is scored unscaled.
pub const SLOT_SCALE_SEATS: [usize; 4] = [3, 4, 5, 6];

/// Seat count (`"3"` to `"6"`) to draft slot (`"0"` to seats minus one) to that slot's scales.
///
/// A `BTreeMap` rather than a `HashMap` so `validate`'s error messages name the same key on every
/// run: the exact-key check is the only reader, and a nondeterministic one would make a bad
/// weights file report a different rule each time it was loaded.
pub type SlotScales = BTreeMap<String, BTreeMap<String, SlotScale>>;

/// The shipped block: every entry 1, so no slot is scaled. Mirrors `weights.ts::neutralSlotScales`.
pub fn neutral_slot_scales() -> SlotScales {
    SLOT_SCALE_SEATS
        .iter()
        .map(|seats| {
            (
                seats.to_string(),
                (0..*seats)
                    .map(|slot| (slot.to_string(), SlotScale::NEUTRAL))
                    .collect(),
            )
        })
        .collect()
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EngineWeights {
    pub resource_value: ResourceValues,
    pub hand_value_weight: f64,
    pub scarcity_weight: f64,
    pub scarcity_clamp_min: f64,
    pub scarcity_clamp_max: f64,
    pub diversity_weight: f64,
    pub diversity_cap: f64,
    pub coverage_exponent: f64,
    pub coverage_scarcity_weight: f64,
    pub duplicate_number_penalty: f64,
    pub recipe_road_bonus: f64,
    pub recipe_city_bonus: f64,
    pub recipe_settlement_bonus: f64,
    pub recipe_dev_card_bonus: f64,
    pub recipe_cap: f64,
    pub port_weight: f64,
    pub generic_port_factor: f64,
    pub port_surplus_threshold: f64,
    pub port_coverage_deficit_weight: f64,
    pub near_port_radius: f64,
    pub near_port_decay: f64,
    pub expansion_weight: f64,
    pub expansion_decay: f64,
    pub robber_discount: f64,
    pub robber_concentration_weight: f64,
    /// What taking a settlement away from the rivals who pick before the hero's second one is
    /// worth. Read only by `placement::draft`, which knows the pick order; `AppFormula` never
    /// looks at it, the mirror image of the search-control fields below that only the app reads.
    pub setup_denial_weight: f64,
    pub opponent_top_k: f64,
    pub softmax_temperature: f64,
    pub rollout_budget: f64,
    pub rollouts_min: f64,
    pub rollouts_max: f64,
    pub max_results: f64,
    /// Per-draft-slot multipliers on the two components a pick's position in the snake draft
    /// moves: what is left to complement (diversity) and what is left to open (expansion). Ships
    /// at 1 everywhere, where every product is the unscaled component.
    pub slot_scales: SlotScales,
}

impl EngineWeights {
    /// Load-time domain guard for weights files. Every field must be finite, and
    /// `genericPortFactor` carries the placement programme's standing hard bound: the
    /// factor discounts 3:1 ports relative to matching 2:1s, and a negative value turns
    /// generic ports into penalties, which the programme has ruled out of the candidate
    /// space (`genericPortFactor >= 0`).
    pub fn validate(&self) -> Result<(), String> {
        let scalars = [
            ("resourceValue.wood", self.resource_value.wood),
            ("resourceValue.sheep", self.resource_value.sheep),
            ("resourceValue.wheat", self.resource_value.wheat),
            ("resourceValue.brick", self.resource_value.brick),
            ("resourceValue.ore", self.resource_value.ore),
            ("handValueWeight", self.hand_value_weight),
            ("scarcityWeight", self.scarcity_weight),
            ("scarcityClampMin", self.scarcity_clamp_min),
            ("scarcityClampMax", self.scarcity_clamp_max),
            ("diversityWeight", self.diversity_weight),
            ("diversityCap", self.diversity_cap),
            ("coverageExponent", self.coverage_exponent),
            ("coverageScarcityWeight", self.coverage_scarcity_weight),
            ("duplicateNumberPenalty", self.duplicate_number_penalty),
            ("recipeRoadBonus", self.recipe_road_bonus),
            ("recipeCityBonus", self.recipe_city_bonus),
            ("recipeSettlementBonus", self.recipe_settlement_bonus),
            ("recipeDevCardBonus", self.recipe_dev_card_bonus),
            ("recipeCap", self.recipe_cap),
            ("portWeight", self.port_weight),
            ("genericPortFactor", self.generic_port_factor),
            ("portSurplusThreshold", self.port_surplus_threshold),
            (
                "portCoverageDeficitWeight",
                self.port_coverage_deficit_weight,
            ),
            ("nearPortRadius", self.near_port_radius),
            ("nearPortDecay", self.near_port_decay),
            ("expansionWeight", self.expansion_weight),
            ("expansionDecay", self.expansion_decay),
            ("robberDiscount", self.robber_discount),
            (
                "robberConcentrationWeight",
                self.robber_concentration_weight,
            ),
            ("setupDenialWeight", self.setup_denial_weight),
            ("opponentTopK", self.opponent_top_k),
            ("softmaxTemperature", self.softmax_temperature),
            ("rolloutBudget", self.rollout_budget),
            ("rolloutsMin", self.rollouts_min),
            ("rolloutsMax", self.rollouts_max),
            ("maxResults", self.max_results),
        ];
        for (name, value) in scalars {
            if !value.is_finite() {
                return Err(format!("weights violate: {name} is finite"));
            }
        }
        if self.generic_port_factor < 0.0 {
            return Err("weights violate: genericPortFactor >= 0".into());
        }
        // `port_deficit_factor` is `1 + w * d` with `d` in [0, 1], so a weight below -1 turns the
        // whole port term negative and the scorer starts preferring portless vertices. The bound
        // is 0 rather than -1 for the same reason `genericPortFactor` carries one: a port that
        // penalises is outside the candidate space, and `sweep-bounds.json` declares min 0.
        if self.port_coverage_deficit_weight < 0.0 {
            return Err("weights violate: portCoverageDeficitWeight >= 0".into());
        }
        // The term is `weight * top-two of the sites the candidate opens`, so a negative weight
        // pays a candidate for opening nothing: a boxed vertex scores 0 where an open one scores
        // below it, which inverts what SP3 measures. `sweep-bounds.json` declares 0 to 1.2.
        if self.expansion_weight < 0.0 {
            return Err("weights violate: expansionWeight >= 0".into());
        }
        // The decay is applied once per paid road-build, so above 1 a site three roads out is
        // worth more than the same site next door, and below 0 the sign of the term alternates
        // with distance. Neither is a placement policy anyone would ship, and `sweep-bounds.json`
        // declares 0.125 to 1.
        if !(0.0..=1.0).contains(&self.expansion_decay) {
            return Err("weights violate: expansionDecay in [0, 1]".into());
        }
        // The term charges for a rise in the top hex's share, so a negative weight would pay a
        // pair for concentrating its income on one blockable hex, which is the opposite of what
        // M-56 read. `sweep-bounds.json` declares 0 to 16.
        if self.robber_concentration_weight < 0.0 {
            return Err("weights violate: robberConcentrationWeight >= 0".into());
        }
        // The credit pays the hero for what a candidate costs the rivals who pick before its
        // second settlement, and that cost is floored at 0, so a negative weight would pay the
        // hero to hand rivals the sites they want most. `sweep-bounds.json` declares 0 to 4.
        if self.setup_denial_weight < 0.0 {
            return Err("weights violate: setupDenialWeight >= 0".into());
        }
        self.validate_slot_scales()?;
        Ok(())
    }

    /// The `slotScales` block's exact-key rule and its domain.
    ///
    /// A missing seat count or slot cannot fall back to 1: a file that dropped the four-seat row
    /// would silently score every measured run unscaled and read as the reference arm. An extra
    /// key is the same failure seen from the other side, an entry nothing will ever look up. The
    /// scales multiply components rather than adding to them, so a negative one flips the sign of
    /// a whole term and is outside the candidate space `sweep-bounds.json` declares (0.25 to 4).
    fn validate_slot_scales(&self) -> Result<(), String> {
        let expected: Vec<String> = SLOT_SCALE_SEATS.iter().map(usize::to_string).collect();
        let found: Vec<String> = self.slot_scales.keys().cloned().collect();
        if found != expected {
            return Err(format!(
                "weights violate: slotScales carries seat counts {expected:?}, found {found:?}"
            ));
        }
        for seats in SLOT_SCALE_SEATS {
            let row = &self.slot_scales[&seats.to_string()];
            let expected: Vec<String> = (0..seats).map(|slot| slot.to_string()).collect();
            let found: Vec<String> = row.keys().cloned().collect();
            if found != expected {
                return Err(format!(
                    "weights violate: slotScales.{seats} carries slots {expected:?}, found {found:?}"
                ));
            }
            for (slot, scale) in row {
                for (component, value) in [
                    ("expansion", scale.expansion),
                    ("diversity", scale.diversity),
                ] {
                    if !value.is_finite() || value < 0.0 {
                        return Err(format!(
                            "weights violate: slotScales.{seats}.{slot}.{component} >= 0 and finite"
                        ));
                    }
                }
            }
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug)]
pub struct ScoreBreakdown {
    pub production: f64,
    pub scarcity: f64,
    /// The robbed-hex discount, plus the concentration delta. See `concentration_delta`.
    pub robber: f64,
    pub diversity: f64,
    pub port: f64,
    pub hand_value: f64,
    /// What the sites this vertex opens are worth. See `placement/expansion.rs::term`. Only the
    /// occupancy-aware entries price it; the holdings-list entries leave it at 0.
    pub expansion: f64,
}

impl ScoreBreakdown {
    pub fn total(self) -> f64 {
        self.production
            + self.scarcity
            + self.robber
            + self.diversity
            + self.port
            + self.hand_value
            + self.expansion
    }
}

pub fn hand_value(weights: &EngineWeights, counts: &[f64; RESOURCE_COUNT]) -> f64 {
    let mut value = 0.0;
    for resource in Resource::ALL {
        value += counts[resource.index()] * weights.resource_value.get(resource);
    }
    weights.hand_value_weight * value
}

/// A vertex sits on at most three edges and three neighbouring vertices, in every layout.
pub(super) const VERTEX_FANOUT: usize = 3;

#[derive(Clone, Debug)]
pub struct AppFormulaScorer {
    /// Immutable scorer identity, deliberately shared by clones for memo reuse.
    pub(super) id: u64,
    /// Reach depends only on adjacency and is shared across matching scorers.
    pub(super) reach: Arc<expansion::ReachTable>,
    /// Runtime libm powers indexed by paid builds, preserving the reference's bits.
    pub(super) decay_pow: [f64; expansion::MAX_PAID_BUILDS + 1],
    weights: EngineWeights,
    scarcity: [f64; RESOURCE_COUNT],
    coverage_value: [f64; RESOURCE_COUNT],
    vertices: Vec<VertexStats>,
    links: Vec<VertexLinks>,
    /// Raw pips per hex index, 0 for a hex that produces nothing. The concentration term takes
    /// its share over these, so a hex two settlements share is read once rather than twice.
    hex_pips: Vec<f64>,
    /// This board's row of `slotScales`, resolved once and indexed by slot, so the hot path costs
    /// an array read rather than two keyed lookups. Empty when the board's seat count is outside
    /// the block's 3 to 6, which scores every seat unscaled.
    slot_scales: Vec<SlotScale>,
}

/// The scorer's own copy of the board graph around one vertex.
///
/// The scorer keeps no `Topology` handle after `new`, and SP3's expansion term has to walk
/// outward from a candidate at score time, so the walk's adjacency is copied once here rather
/// than threaded through every scoring call. The orders match `Topology`'s, so a walk over this
/// copy visits vertices and edges in exactly the order a walk over the topology would.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) struct VertexLinks {
    adjacent: [Vertex; VERTEX_FANOUT],
    adjacent_len: u8,
    /// `edge_to[slot]` joins the vertex to `adjacent[slot]`, which is `Topology::edge_between`.
    edge_to: [Edge; VERTEX_FANOUT],
}

impl VertexLinks {
    pub(super) fn adjacent(&self) -> &[Vertex] {
        &self.adjacent[..usize::from(self.adjacent_len)]
    }

    pub(super) fn steps(&self) -> impl Iterator<Item = (Edge, Vertex)> + '_ {
        self.edge_to
            .iter()
            .copied()
            .zip(self.adjacent().iter().copied())
    }
}

#[derive(Clone, Debug)]
struct VertexStats {
    pips: [f64; RESOURCE_COUNT],
    robbed_pips: [f64; RESOURCE_COUNT],
    token_pips: [f64; 13],
    token_numbers: [u8; 3],
    token_numbers_len: u8,
    has_ports: bool,
    setup_grant: [f64; RESOURCE_COUNT],
    /// The producing hexes this vertex touches, one bit per hex index. Mirrors
    /// `valuation.ts::VertexStats.hexPips`, whose map keys do the same de-duplication job.
    hex_mask: u64,
    precompute: VertexPrecompute,
}

#[derive(Clone, Copy, Debug)]
struct VertexPrecompute {
    adjusted: [f64; RESOURCE_COUNT],
    base: f64,
    port_factors: [f64; RESOURCE_COUNT],
    setup_grant_value: f64,
}

/// One player's settled vertices, folded into the quantities the score reads. `pub(super)` for
/// SP3's expansion walk, which prices every site it finds against the holdings plus the candidate.
#[derive(Clone, Copy, Debug)]
pub(super) struct Holdings {
    pips: [f64; RESOURCE_COUNT],
    token_pips: [f64; 13],
    has_ports: bool,
    port_factors: [f64; RESOURCE_COUNT],
    /// The union of the settlements' `hex_mask`es, so a shared hex is one bit either way.
    hexes: u64,
}

impl Holdings {
    pub(super) const fn empty() -> Self {
        Self {
            pips: [0.0; RESOURCE_COUNT],
            token_pips: [0.0; 13],
            has_ports: false,
            port_factors: [0.0; RESOURCE_COUNT],
            hexes: 0,
        }
    }
}

/// Fixed-holdings pricing mirrors `site_total_with_holdings`, reusing only whole operands.
/// The `* 1.0`, `1.0 *` and `+ 0.0` preserve its bits, including -0.0 becoming +0.0.
pub(super) struct SitePricer<'a> {
    scorer: &'a AppFormulaScorer,
    holdings: Holdings,
    covers: [f64; RESOURCE_COUNT],
    total: f64,
    port_products: [f64; RESOURCE_COUNT],
    /// Separate recipe caps or port coverage deficits require the full reference calculation.
    fallback: bool,
}

impl<'a> SitePricer<'a> {
    pub(super) fn new(scorer: &'a AppFormulaScorer, holdings: Holdings) -> Self {
        let weights = &scorer.weights;
        let fallback = weights.recipe_cap != weights.diversity_cap
            || weights.port_coverage_deficit_weight != 0.0;
        let covers = if fallback {
            [0.0; RESOURCE_COUNT]
        } else {
            scorer.diversity_coverage(holdings.pips, weights.diversity_cap)
        };
        let total = if fallback {
            scorer.holdings_diversity_total(&holdings)
        } else {
            scorer.diversity_combine(covers, covers)
        };
        Self {
            scorer,
            holdings,
            covers,
            total,
            port_products: std::array::from_fn(|i| {
                port_surplus(weights, holdings.pips[i]) * holdings.port_factors[i] * 1.0
            }),
            fallback,
        }
    }

    pub(super) fn price(&self, site: Vertex) -> f64 {
        if self.fallback {
            return self.scorer.site_total_with_holdings(self.holdings, site, self.total);
        }
        let scorer = self.scorer;
        let stats = &scorer.vertices[usize::from(site)];
        let precompute = stats.precompute;
        let next: [f64; RESOURCE_COUNT] = std::array::from_fn(|i| {
            self.holdings.pips[i] + precompute.adjusted[i]
        });
        let covers = std::array::from_fn(|i| {
            if next[i].to_bits() == self.holdings.pips[i].to_bits() {
                self.covers[i]
            } else {
                coverage(&scorer.weights, next[i], scorer.weights.diversity_cap)
            }
        });
        let diversity = scorer.diversity_combine(covers, covers)
            - self.total
            - scorer.sparse_duplicate_number_penalty(&self.holdings, stats);
        let port = if !self.holdings.has_ports && !stats.has_ports {
            0.0
        } else {
            let post = |i: usize| {
                port_surplus(&scorer.weights, next[i])
                    * js_max(self.holdings.port_factors[i], precompute.port_factors[i])
                    * 1.0
            };
            scorer.weights.port_weight
                * (post(0) - self.port_products[0]
                    + post(1) - self.port_products[1]
                    + post(2) - self.port_products[2]
                    + post(3) - self.port_products[3]
                    + post(4) - self.port_products[4])
        };
        precompute.base
            + scorer.concentration_delta(&self.holdings, stats)
            + 1.0 * diversity
            + port
            + 0.0
    }
}

impl AppFormulaScorer {
    pub fn new(board: &SimBoard, topology: &Topology, weights: EngineWeights) -> Self {
        debug_assert!(topology.vertex_count() <= 128, "vertex masks are 128 bits wide");
        debug_assert!(topology.edge_count() <= 128, "edge masks are 128 bits wide");
        let mut board_pips = [0.0; RESOURCE_COUNT];
        for resource in Resource::ALL {
            board_pips[resource.index()] = f64::from(board.resource_pips()[resource.index()]);
        }
        let mean_pips = Resource::ALL
            .iter()
            .fold(0.0, |sum, resource| sum + board_pips[resource.index()])
            / Resource::ALL.len() as f64;
        let mut scarcity = [0.0; RESOURCE_COUNT];
        for resource in Resource::ALL {
            let index = resource.index();
            scarcity[index] = js_clamp(
                mean_pips / js_max(board_pips[index], 1.0),
                weights.scarcity_clamp_min,
                weights.scarcity_clamp_max,
            );
        }
        let mut coverage_value = [0.0; RESOURCE_COUNT];
        for resource in Resource::ALL {
            let index = resource.index();
            coverage_value[index] = weights.resource_value.get(resource)
                * js_max(
                    0.0,
                    1.0 + weights.coverage_scarcity_weight * (scarcity[index] - 1.0),
                );
        }
        let (has_ports, port_factors) = port_precompute(board, topology, &weights);
        // One bit per hex in `Holdings::hexes` and `VertexStats::hex_mask`; `extension6` has 30.
        // The same width `expansion.rs::pair_hexes` asserts on the diagnostics side.
        debug_assert!(
            topology.hex_count() <= 64,
            "the producing-hex bitmask is 64 bits wide"
        );
        let mut hex_pips = vec![0.0; topology.hex_count()];
        for (index, slot) in hex_pips.iter_mut().enumerate() {
            if let (Some(_), Some(token)) = (board.tiles()[index], board.tokens()[index]) {
                *slot = f64::from(pips(token));
            }
        }
        let mut vertices = Vec::with_capacity(topology.vertex_count());
        for vertex_index in 0..topology.vertex_count() {
            let vertex = vertex_index as Vertex;
            let mut raw_pips = [0.0; RESOURCE_COUNT];
            let mut robbed_pips = [0.0; RESOURCE_COUNT];
            let mut setup_grant = [0.0; RESOURCE_COUNT];
            let mut token_pips = [0.0; 13];
            let mut hex_mask = 0_u64;
            for hex in topology.vertex_hexes(vertex) {
                let index = usize::from(*hex);
                if let (Some(resource), Some(token)) = (board.tiles()[index], board.tokens()[index])
                {
                    let amount = f64::from(pips(token));
                    raw_pips[resource.index()] += amount;
                    token_pips[usize::from(token)] += amount;
                    if amount > 0.0 {
                        setup_grant[resource.index()] += 1.0;
                        hex_mask |= 1 << index;
                    }
                }
            }
            if topology.vertex_hexes(vertex).contains(&board.robber())
                && let (Some(resource), Some(token)) = (
                    board.tiles()[usize::from(board.robber())],
                    board.tokens()[usize::from(board.robber())],
                )
            {
                robbed_pips[resource.index()] = f64::from(pips(token));
            }
            let mut adjusted = [0.0; RESOURCE_COUNT];
            for resource in Resource::ALL {
                let index = resource.index();
                adjusted[index] = raw_pips[index] - robbed_pips[index] * weights.robber_discount;
            }
            let (production, scarcity_value, robber) =
                base_parts(&weights, &scarcity, &raw_pips, &robbed_pips);
            let mut token_numbers = [0; 3];
            let mut token_numbers_len = 0;
            for (number, pips) in token_pips.iter().enumerate() {
                if *pips != 0.0 {
                    token_numbers[usize::from(token_numbers_len)] = number as u8;
                    token_numbers_len += 1;
                }
            }
            vertices.push(VertexStats {
                pips: raw_pips,
                robbed_pips,
                token_pips,
                token_numbers,
                token_numbers_len,
                has_ports: has_ports[vertex_index],
                setup_grant,
                hex_mask,
                precompute: VertexPrecompute {
                    adjusted,
                    base: production + scarcity_value + robber,
                    port_factors: port_factors[vertex_index],
                    setup_grant_value: hand_value(&weights, &setup_grant),
                },
            });
        }
        let mut links = Vec::with_capacity(topology.vertex_count());
        for vertex_index in 0..topology.vertex_count() {
            let vertex = vertex_index as Vertex;
            let adjacent = topology.vertex_adjacent(vertex);
            let mut entry = VertexLinks {
                adjacent: [0; VERTEX_FANOUT],
                adjacent_len: adjacent.len() as u8,
                edge_to: [0; VERTEX_FANOUT],
            };
            for (slot, neighbor) in adjacent.iter().enumerate() {
                entry.adjacent[slot] = *neighbor;
                entry.edge_to[slot] = topology
                    .edge_between(vertex, *neighbor)
                    .expect("adjacent vertices share an edge");
            }
            links.push(entry);
        }
        // `game.rs::setup_order` runs `0..seats` and then the reverse, so a seat index *is* its
        // draft slot in both directions of the snake, which is what lets `score_for_owner` key the
        // scales off the seat it is already given.
        let slot_scales = weights
            .slot_scales
            .get(&board.seats().to_string())
            .map(|row| {
                (0..board.seats())
                    .map(|slot| {
                        row.get(&slot.to_string())
                            .copied()
                            .unwrap_or(SlotScale::NEUTRAL)
                    })
                    .collect()
            })
            .unwrap_or_default();
        Self {
            id: NEXT_SCORER_ID.fetch_add(1, Ordering::Relaxed),
            reach: expansion::ReachTable::shared(&links),
            decay_pow: std::array::from_fn(|k| decay_power(weights.expansion_decay, k)),
            weights,
            scarcity,
            coverage_value,
            vertices,
            links,
            hex_pips,
            slot_scales,
        }
    }

    /// The scales this board's `slotScales` row gives a seat, or 1 everywhere for a seat count the
    /// block carries no row for and for a seat past the row's last slot.
    pub fn slot_scale(&self, seat: u8) -> SlotScale {
        self.slot_scales
            .get(usize::from(seat))
            .copied()
            .unwrap_or(SlotScale::NEUTRAL)
    }

    /// The scorer's copy of `Topology::vertex_adjacent`.
    pub fn vertex_adjacent(&self, vertex: Vertex) -> &[Vertex] {
        self.links[usize::from(vertex)].adjacent()
    }

    /// Every step out of `vertex`: the edge taken and the vertex it lands on, in adjacency order.
    /// This and `vertex_adjacent` are the whole of the graph the expansion walk reads, so the
    /// parity test pins both against the topology the scorer was built from.
    pub fn steps(&self, vertex: Vertex) -> impl Iterator<Item = (Edge, Vertex)> + '_ {
        self.links[usize::from(vertex)].steps()
    }

    pub(super) fn weights(&self) -> &EngineWeights {
        &self.weights
    }

    /// The breakdown over a holdings list alone, with no board around it. The expansion component
    /// is 0 here: pricing it needs the occupancy, which only the `_for_owner` entries carry.
    pub fn breakdown(
        &self,
        holdings: &[Vertex],
        candidate: Vertex,
        receives_grant: bool,
    ) -> ScoreBreakdown {
        let holdings = self.build_holdings(holdings.iter().copied());
        self.breakdown_with_holdings(holdings, candidate, receives_grant)
    }

    /// `breakdown`'s total without the breakdown, and without the expansion component for the
    /// same reason.
    pub fn marginal_total(
        &self,
        holdings: &[Vertex],
        candidate: Vertex,
        receives_grant: bool,
    ) -> f64 {
        let holdings = self.build_holdings(holdings.iter().copied());
        self.total_with_holdings(holdings, candidate, receives_grant)
    }

    /// `breakdown` read from the engine's owner arrays rather than a holdings list: `seat`'s own
    /// buildings are its holdings, every other seat's are the occupancy around them, and
    /// `edge_owner` carries the roads.
    ///
    /// The expansion component is the one that reads that occupancy; every other component is a
    /// function of the seat's own holdings alone, so at `expansionWeight` 0 and a neutral
    /// `slotScales` block this agrees bit-for-bit with `breakdown` over the same holdings.
    ///
    /// The seat is also the draft slot SP4's scales are keyed by, which is why only the owner
    /// entries scale: `breakdown` is handed a holdings list with no seat behind it, so it has no
    /// slot to look one up with and scores unscaled, exactly as the TypeScript entries do when
    /// their caller names no slot.
    pub fn breakdown_for_owner(
        &self,
        vertex_owner: &[u8],
        edge_owner: &[u8],
        seat: u8,
        candidate: Vertex,
        receives_grant: bool,
    ) -> ScoreBreakdown {
        let holdings = self.holdings_for_owner(vertex_owner, seat);
        let scale = self.slot_scale(seat);
        let mut breakdown = self.breakdown_with_holdings(holdings, candidate, receives_grant);
        breakdown.diversity *= scale.diversity;
        breakdown.expansion = scale.expansion
            * expansion::term(self, &holdings, vertex_owner, edge_owner, seat, candidate).value;
        breakdown
    }

    /// `marginal_total` read from the owner arrays, which is `breakdown_for_owner`'s total taken
    /// without building the breakdown. The two share every term, so they cannot disagree.
    pub fn marginal_total_for_owner(
        &self,
        vertex_owner: &[u8],
        edge_owner: &[u8],
        seat: u8,
        candidate: Vertex,
        receives_grant: bool,
    ) -> f64 {
        let holdings = self.holdings_for_owner(vertex_owner, seat);
        let scale = self.slot_scale(seat);
        self.scaled_total_with_holdings(holdings, candidate, receives_grant, scale.diversity)
            + scale.expansion
                * expansion::term(self, &holdings, vertex_owner, edge_owner, seat, candidate).value
    }

    /// The setup road SP3's road rule points at: the first edge of the cheapest path to the best
    /// site the candidate opens, or `None` when it opens nothing or the term is switched off.
    pub(super) fn expansion_road(
        &self,
        vertex_owner: &[u8],
        edge_owner: &[u8],
        seat: u8,
        candidate: Vertex,
    ) -> Option<Edge> {
        if self.weights.expansion_weight == 0.0 {
            return None;
        }
        let holdings = self.holdings_for_owner(vertex_owner, seat);
        expansion::term(self, &holdings, vertex_owner, edge_owner, seat, candidate).road
    }

    pub(crate) fn score_for_owner(
        &self,
        vertex_owner: &[u8],
        edge_owner: &[u8],
        seat: u8,
        candidate: Vertex,
        receives_grant: bool,
    ) -> f64 {
        self.marginal_total_for_owner(vertex_owner, edge_owner, seat, candidate, receives_grant)
    }

    /// The seat's own buildings, folded in ascending vertex order, which is the order the
    /// TypeScript scorer's callers list them in.
    pub(super) fn holdings_for_owner(&self, vertex_owner: &[u8], seat: u8) -> Holdings {
        self.build_holdings(
            vertex_owner
                .iter()
                .enumerate()
                .filter_map(|(vertex, owner)| (*owner == seat).then_some(vertex as Vertex)),
        )
    }

    pub(super) fn add_to_holdings(&self, holdings: &mut Holdings, vertex: Vertex) {
        let stats = &self.vertices[usize::from(vertex)];
        for resource in Resource::ALL {
            let index = resource.index();
            let amount = stats.precompute.adjusted[index];
            if amount != 0.0 {
                holdings.pips[index] += amount;
            }
        }
        for (held, amount) in holdings.token_pips.iter_mut().zip(stats.token_pips) {
            *held += amount;
        }
        holdings.has_ports |= stats.has_ports;
        holdings.hexes |= stats.hex_mask;
        for resource in Resource::ALL {
            let index = resource.index();
            holdings.port_factors[index] = js_max(
                holdings.port_factors[index],
                stats.precompute.port_factors[index],
            );
        }
    }

    pub(super) fn holdings_diversity_total(&self, holdings: &Holdings) -> f64 {
        self.diversity_score(
            holdings.pips[Resource::Wood.index()],
            holdings.pips[Resource::Sheep.index()],
            holdings.pips[Resource::Wheat.index()],
            holdings.pips[Resource::Brick.index()],
            holdings.pips[Resource::Ore.index()],
        )
    }

    /// What SP3's walk prices a site by: `total_with_holdings` with no setup grant, handed the
    /// holdings' own diversity total so one call pricing many sites scores that total once.
    pub(super) fn site_total_with_holdings(
        &self,
        holdings: Holdings,
        candidate: Vertex,
        holdings_total: f64,
    ) -> f64 {
        self.scaled_total_with_diversity(holdings, candidate, false, 1.0, holdings_total)
    }

    /// The largest single hex's share of all the pips these hexes produce, which is the quantity
    /// M-56 measured as `blockability`: 1 when every pip comes off one hex, and as low as
    /// `1 / hexes` when they are spread evenly. 0 for an empty mask, so a pair touching nothing
    /// is not a special case anywhere. Mirrors `valuation.ts::topHexShare`.
    fn top_hex_share(&self, hexes: u64) -> f64 {
        let mut total = 0.0;
        let mut highest = 0.0;
        let mut rest = hexes;
        while rest != 0 {
            let index = rest.trailing_zeros() as usize;
            rest &= rest - 1;
            let amount = self.hex_pips[index];
            total += amount;
            if amount > highest {
                highest = amount;
            }
        }
        if total == 0.0 { 0.0 } else { highest / total }
    }

    /// What adding this vertex does to the pair's exposure to one blocked hex, as a penalty on the
    /// robber component. A candidate that piles more pips onto the hex the holding already leans
    /// on raises the share and is charged for it; one that spreads the pair out lowers it and is
    /// paid.
    ///
    /// The share is over *raw* hex pips, matching the diagnostic this term comes from, so it is a
    /// property of the board rather than of where the robber happens to sit today, which is what
    /// `robber_discount` already prices. At weight 0 no share is taken and the delta is exactly 0.
    /// Mirrors `valuation.ts::concentrationDelta`.
    fn concentration_delta(&self, holdings: &Holdings, stats: &VertexStats) -> f64 {
        if self.weights.robber_concentration_weight == 0.0 {
            return 0.0;
        }
        -self.weights.robber_concentration_weight
            * (self.top_hex_share(holdings.hexes | stats.hex_mask)
                - self.top_hex_share(holdings.hexes))
    }

    fn base_breakdown(&self, stats: &VertexStats) -> (f64, f64, f64) {
        base_parts(
            &self.weights,
            &self.scarcity,
            &stats.pips,
            &stats.robbed_pips,
        )
    }

    /// The unscaled breakdown over a resolved holdings set. Callers holding a seat scale the
    /// diversity component afterwards; the expansion component is always 0 here, because pricing
    /// it needs the occupancy.
    fn breakdown_with_holdings(
        &self,
        holdings: Holdings,
        candidate: Vertex,
        receives_grant: bool,
    ) -> ScoreBreakdown {
        let stats = &self.vertices[usize::from(candidate)];
        let precompute = stats.precompute;
        let (production, scarcity, robber) = self.base_breakdown(stats);
        let holdings_total = self.holdings_diversity_total(&holdings);
        ScoreBreakdown {
            production,
            scarcity,
            robber: robber + self.concentration_delta(&holdings, stats),
            diversity: self.diversity_delta(&holdings, stats, precompute, holdings_total),
            port: self.port_delta(&holdings, stats, precompute),
            hand_value: if receives_grant {
                hand_value(&self.weights, &stats.setup_grant)
            } else {
                0.0
            },
            expansion: 0.0,
        }
    }

    fn build_holdings(&self, vertices: impl Iterator<Item = Vertex>) -> Holdings {
        let mut holdings = Holdings::empty();
        for vertex in vertices {
            self.add_to_holdings(&mut holdings, vertex);
        }
        holdings
    }

    fn diversity_delta(
        &self,
        holdings: &Holdings,
        stats: &VertexStats,
        precompute: VertexPrecompute,
        holdings_total: f64,
    ) -> f64 {
        let wood = holdings.pips[Resource::Wood.index()];
        let sheep = holdings.pips[Resource::Sheep.index()];
        let wheat = holdings.pips[Resource::Wheat.index()];
        let brick = holdings.pips[Resource::Brick.index()];
        let ore = holdings.pips[Resource::Ore.index()];
        self.diversity_score(
            wood + precompute.adjusted[Resource::Wood.index()],
            sheep + precompute.adjusted[Resource::Sheep.index()],
            wheat + precompute.adjusted[Resource::Wheat.index()],
            brick + precompute.adjusted[Resource::Brick.index()],
            ore + precompute.adjusted[Resource::Ore.index()],
        ) - holdings_total
            - self.duplicate_number_penalty(holdings, stats)
    }

    fn diversity_score(&self, wood: f64, sheep: f64, wheat: f64, brick: f64, ore: f64) -> f64 {
        #[cfg(test)]
        DIVERSITY_SCORE_CALLS.with(|calls| calls.set(calls.get() + 1));
        let pips = [wood, sheep, wheat, brick, ore];
        let covers = self.diversity_coverage(pips, self.weights.diversity_cap);
        let recipes = if self.weights.recipe_cap == self.weights.diversity_cap {
            covers
        } else {
            self.diversity_coverage(pips, self.weights.recipe_cap)
        };
        self.diversity_combine(covers, recipes)
    }

    fn diversity_coverage(&self, pips: [f64; RESOURCE_COUNT], cap: f64) -> [f64; RESOURCE_COUNT] {
        pips.map(|pips| coverage(&self.weights, pips, cap))
    }

    fn diversity_combine(
        &self,
        [wood_cover, sheep_cover, wheat_cover, brick_cover, ore_cover]: [f64; RESOURCE_COUNT],
        [wood_recipe, sheep_recipe, wheat_recipe, brick_recipe, ore_recipe]: [f64; RESOURCE_COUNT],
    ) -> f64 {
        let weights = &self.weights;
        let spread = weights.diversity_weight
            * (self.coverage_value[Resource::Wood.index()] * wood_cover
                + self.coverage_value[Resource::Sheep.index()] * sheep_cover
                + self.coverage_value[Resource::Wheat.index()] * wheat_cover
                + self.coverage_value[Resource::Brick.index()] * brick_cover
                + self.coverage_value[Resource::Ore.index()] * ore_cover);
        let road = weights.recipe_road_bonus * js_min(wood_recipe, brick_recipe);
        let city = weights.recipe_city_bonus * js_min(ore_recipe, wheat_recipe);
        let settlement = weights.recipe_settlement_bonus
            * js_min(
                js_min(js_min(wood_recipe, brick_recipe), wheat_recipe),
                sheep_recipe,
            );
        let dev_card =
            weights.recipe_dev_card_bonus * js_min(js_min(ore_recipe, wheat_recipe), sheep_recipe);
        spread + road + city + settlement + dev_card
    }

    fn duplicate_number_penalty(&self, holdings: &Holdings, candidate: &VertexStats) -> f64 {
        let mut overlap = 0.0;
        for number in 0..candidate.token_pips.len() {
            if candidate.token_pips[number] != 0.0 {
                overlap += js_min(holdings.token_pips[number], candidate.token_pips[number]);
            }
        }
        overlap * self.weights.duplicate_number_penalty
    }

    /// Same terms and order as the dense loop, which stays on the reference path for x86-64 speed.
    fn sparse_duplicate_number_penalty(&self, holdings: &Holdings, candidate: &VertexStats) -> f64 {
        let mut overlap = 0.0;
        for number in &candidate.token_numbers[..usize::from(candidate.token_numbers_len)] {
            let number = usize::from(*number);
            overlap += js_min(holdings.token_pips[number], candidate.token_pips[number]);
        }
        overlap * self.weights.duplicate_number_penalty
    }

    fn port_delta(
        &self,
        holdings: &Holdings,
        stats: &VertexStats,
        precompute: VertexPrecompute,
    ) -> f64 {
        if !holdings.has_ports && !stats.has_ports {
            return 0.0;
        }
        let weights = &self.weights;
        let held = &holdings.port_factors;
        let gained = &precompute.port_factors;
        let wood = holdings.pips[Resource::Wood.index()];
        let sheep = holdings.pips[Resource::Sheep.index()];
        let wheat = holdings.pips[Resource::Wheat.index()];
        let brick = holdings.pips[Resource::Brick.index()];
        let ore = holdings.pips[Resource::Ore.index()];
        // Each half of each difference carries its own state's deficit, so the term stays
        // a true delta rather than repricing the holding's existing ports at the post-move
        // spread. Left at 1 unless the weight asks for the ten fractional `coverage`
        // powers below, which sit in every rollout scan.
        let mut wood_pre = 1.0;
        let mut sheep_pre = 1.0;
        let mut wheat_pre = 1.0;
        let mut brick_pre = 1.0;
        let mut ore_pre = 1.0;
        let mut wood_post = 1.0;
        let mut sheep_post = 1.0;
        let mut wheat_post = 1.0;
        let mut brick_post = 1.0;
        let mut ore_post = 1.0;
        if weights.port_coverage_deficit_weight != 0.0 {
            let cap = weights.recipe_cap;
            let wood_cover = coverage(weights, wood, cap);
            let sheep_cover = coverage(weights, sheep, cap);
            let wheat_cover = coverage(weights, wheat, cap);
            let brick_cover = coverage(weights, brick, cap);
            let ore_cover = coverage(weights, ore, cap);
            let total = wood_cover + sheep_cover + wheat_cover + brick_cover + ore_cover;
            wood_pre = port_deficit_factor(weights, total, wood_cover);
            sheep_pre = port_deficit_factor(weights, total, sheep_cover);
            wheat_pre = port_deficit_factor(weights, total, wheat_cover);
            brick_pre = port_deficit_factor(weights, total, brick_cover);
            ore_pre = port_deficit_factor(weights, total, ore_cover);
            let wood_next = coverage(
                weights,
                wood + precompute.adjusted[Resource::Wood.index()],
                cap,
            );
            let sheep_next = coverage(
                weights,
                sheep + precompute.adjusted[Resource::Sheep.index()],
                cap,
            );
            let wheat_next = coverage(
                weights,
                wheat + precompute.adjusted[Resource::Wheat.index()],
                cap,
            );
            let brick_next = coverage(
                weights,
                brick + precompute.adjusted[Resource::Brick.index()],
                cap,
            );
            let ore_next = coverage(
                weights,
                ore + precompute.adjusted[Resource::Ore.index()],
                cap,
            );
            let next_total = wood_next + sheep_next + wheat_next + brick_next + ore_next;
            wood_post = port_deficit_factor(weights, next_total, wood_next);
            sheep_post = port_deficit_factor(weights, next_total, sheep_next);
            wheat_post = port_deficit_factor(weights, next_total, wheat_next);
            brick_post = port_deficit_factor(weights, next_total, brick_next);
            ore_post = port_deficit_factor(weights, next_total, ore_next);
        }
        weights.port_weight
            * (port_surplus(weights, wood + precompute.adjusted[Resource::Wood.index()])
                * js_max(held[Resource::Wood.index()], gained[Resource::Wood.index()])
                * wood_post
                - port_surplus(weights, wood) * held[Resource::Wood.index()] * wood_pre
                + port_surplus(
                    weights,
                    sheep + precompute.adjusted[Resource::Sheep.index()],
                ) * js_max(
                    held[Resource::Sheep.index()],
                    gained[Resource::Sheep.index()],
                ) * sheep_post
                - port_surplus(weights, sheep) * held[Resource::Sheep.index()] * sheep_pre
                + port_surplus(
                    weights,
                    wheat + precompute.adjusted[Resource::Wheat.index()],
                ) * js_max(
                    held[Resource::Wheat.index()],
                    gained[Resource::Wheat.index()],
                ) * wheat_post
                - port_surplus(weights, wheat) * held[Resource::Wheat.index()] * wheat_pre
                + port_surplus(
                    weights,
                    brick + precompute.adjusted[Resource::Brick.index()],
                ) * js_max(
                    held[Resource::Brick.index()],
                    gained[Resource::Brick.index()],
                ) * brick_post
                - port_surplus(weights, brick) * held[Resource::Brick.index()] * brick_pre
                + port_surplus(weights, ore + precompute.adjusted[Resource::Ore.index()])
                    * js_max(held[Resource::Ore.index()], gained[Resource::Ore.index()])
                    * ore_post
                - port_surplus(weights, ore) * held[Resource::Ore.index()] * ore_pre)
    }

    /// The formula without its expansion component. Mirrors
    /// `valuation.ts::marginalWithoutExpansion`.
    pub(super) fn total_with_holdings(
        &self,
        holdings: Holdings,
        candidate: Vertex,
        receives_grant: bool,
    ) -> f64 {
        self.scaled_total_with_holdings(holdings, candidate, receives_grant, 1.0)
    }

    /// `total_with_holdings` with SP4's diversity scale folded in at the one place the component
    /// enters the sum, so the fused total and the summed breakdown scale the same product rather
    /// than two differently rounded ones. A scale of 1 multiplies the delta by exactly 1, which
    /// is the identity on every finite float and on NaN's payload alike, so the shipped block
    /// leaves this path bit-identical to the unscaled one.
    fn scaled_total_with_holdings(
        &self,
        holdings: Holdings,
        candidate: Vertex,
        receives_grant: bool,
        diversity_scale: f64,
    ) -> f64 {
        let holdings_total = self.holdings_diversity_total(&holdings);
        self.scaled_total_with_diversity(
            holdings,
            candidate,
            receives_grant,
            diversity_scale,
            holdings_total,
        )
    }

    pub(super) fn scaled_total_with_diversity(
        &self,
        holdings: Holdings,
        candidate: Vertex,
        receives_grant: bool,
        diversity_scale: f64,
        holdings_total: f64,
    ) -> f64 {
        let stats = &self.vertices[usize::from(candidate)];
        let precompute = stats.precompute;
        precompute.base
            + self.concentration_delta(&holdings, stats)
            + diversity_scale * self.diversity_delta(&holdings, stats, precompute, holdings_total)
            + self.port_delta(&holdings, stats, precompute)
            + if receives_grant {
                precompute.setup_grant_value
            } else {
                0.0
            }
    }
}

fn base_parts(
    weights: &EngineWeights,
    scarcity: &[f64; RESOURCE_COUNT],
    raw_pips: &[f64; RESOURCE_COUNT],
    robbed_pips: &[f64; RESOURCE_COUNT],
) -> (f64, f64, f64) {
    let mut production = 0.0;
    let mut scarcity_value = 0.0;
    let mut robber = 0.0;
    for resource in Resource::ALL {
        let index = resource.index();
        let raw = raw_pips[index];
        let robbed = robbed_pips[index];
        let adjusted = raw - robbed * weights.robber_discount;
        production += raw * weights.resource_value.get(resource);
        scarcity_value += adjusted * weights.scarcity_weight * (scarcity[index] - 1.0);
        robber -= robbed * weights.robber_discount;
    }
    (production, scarcity_value, robber)
}

fn coverage(weights: &EngineWeights, pips: f64, cap: f64) -> f64 {
    let base = js_max(0.0, js_min(pips, cap) / cap);
    let exponent = weights.coverage_exponent;
    let key = (base.to_bits(), exponent.to_bits());
    let mixed = (key.0 ^ key.1.rotate_left(32)).wrapping_mul(0x9e37_79b9_7f4a_7c15);
    let index = (mixed >> (u64::BITS - COVERAGE_MEMO_BITS)) as usize;
    COVERAGE_POWF_MEMO.with(|memo| {
        let slot = &memo[index];
        let (stored, result) = slot.get();
        if stored == key {
            return result;
        }
        #[cfg(test)]
        COVERAGE_POWF_CALLS.with(|calls| calls.set(calls.get() + 1));
        let result = base.powf(exponent);
        slot.set((key, result));
        result
    })
}

fn js_clamp(value: f64, min: f64, max: f64) -> f64 {
    js_max(min, js_min(max, value))
}

pub(super) fn js_max(left: f64, right: f64) -> f64 {
    if left.is_nan() || right.is_nan() {
        f64::NAN
    } else {
        left.max(right)
    }
}

pub(super) fn js_min(left: f64, right: f64) -> f64 {
    if left.is_nan() || right.is_nan() {
        f64::NAN
    } else {
        left.min(right)
    }
}

fn port_factor(rate: u32) -> f64 {
    js_max(0.0, 1.0 / f64::from(rate) - 1.0 / 4.0) / (1.0 / 2.0 - 1.0 / 4.0)
}

fn port_precompute(
    board: &SimBoard,
    topology: &Topology,
    weights: &EngineWeights,
) -> (Vec<bool>, Vec<[f64; RESOURCE_COUNT]>) {
    let mut has_ports = vec![false; topology.vertex_count()];
    let mut factors = vec![[0.0; RESOURCE_COUNT]; topology.vertex_count()];
    let mut generic = vec![0.0; topology.vertex_count()];
    let radius = if weights.near_port_radius.is_finite() {
        js_max(0.0, weights.near_port_radius)
    } else {
        0.0
    };
    for port in board.ports() {
        let mut distances = vec![None; topology.vertex_count()];
        let mut queue = Vec::with_capacity(topology.vertex_count());
        for vertex in topology.edge_endpoints(port.edge) {
            if distances[usize::from(vertex)].is_some() {
                continue;
            }
            distances[usize::from(vertex)] = Some(0_u8);
            queue.push(vertex);
        }
        let mut head = 0;
        while head < queue.len() {
            let vertex = queue[head];
            head += 1;
            let distance = distances[usize::from(vertex)].unwrap_or(0);
            if f64::from(distance) >= radius {
                continue;
            }
            for neighbor in topology.vertex_adjacent(vertex) {
                if distances[usize::from(*neighbor)].is_some() {
                    continue;
                }
                distances[usize::from(*neighbor)] = Some(distance + 1);
                queue.push(*neighbor);
            }
        }
        for (vertex_index, distance) in distances.into_iter().enumerate() {
            let Some(distance) = distance else {
                continue;
            };
            let roads = if distance == 1 { 2 } else { distance };
            let decayed = weights.near_port_decay.powf(f64::from(roads));
            let reach = if decayed.is_finite() {
                js_clamp(decayed, 0.0, 1.0)
            } else {
                0.0
            };
            if reach <= 0.0 {
                continue;
            }
            has_ports[vertex_index] = true;
            let factor = port_factor(port.rate) * reach;
            if let Some(resource) = port.resource {
                let index = resource.index();
                factors[vertex_index][index] = js_max(factors[vertex_index][index], factor);
            } else {
                generic[vertex_index] = js_max(generic[vertex_index], factor);
            }
        }
    }
    for vertex in 0..topology.vertex_count() {
        let discounted = weights.generic_port_factor * generic[vertex];
        for resource in Resource::ALL {
            let index = resource.index();
            factors[vertex][index] = js_max(factors[vertex][index], discounted);
        }
    }
    (has_ports, factors)
}

/// What a port converts surplus *into*. `total` is the summed recipe-cap coverage of
/// all five resources and `own` the ported resource's own share, so the fraction is the
/// mean coverage of the other four: 0 when they are untouched, 1 when all four are
/// saturated. At weight 0 the factor is exactly 1 and every product it multiplies is
/// bit-for-bit unchanged. Mirrors `valuation.ts::portDeficitFactor`.
fn port_deficit_factor(weights: &EngineWeights, total: f64, own: f64) -> f64 {
    1.0 + weights.port_coverage_deficit_weight * (1.0 - (total - own) / 4.0)
}

fn port_surplus(weights: &EngineWeights, pips: f64) -> f64 {
    js_max(0.0, pips - weights.port_surplus_threshold)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn default_weights() -> EngineWeights {
        serde_json::from_str(include_str!("../../../../placement/default-weights.json")).unwrap()
    }

    /// Sparse token visits keep the dense loop's order and bits for every fixture vertex.
    #[test]
    fn sparse_duplicate_numbers_match_the_dense_sum() {
        use crate::board::ConversionOptions;
        use crate::rules::RuleConfig;
        use crate::topology::Layout;
        use crate::wire::WireBoard;

        let cases: serde_json::Value =
            serde_json::from_str(include_str!("../../../../fixtures/advice-parity.json")).unwrap();
        let wire = WireBoard::parse_value(cases["cases"][0]["request"]["game"]["board"].clone()).unwrap();
        let topology = Topology::load(Layout::Standard4).unwrap();
        let board = SimBoard::try_from_wire(
            wire, &topology, &RuleConfig::base(Layout::Standard4), ConversionOptions::default(),
        ).unwrap();
        let scorer = AppFormulaScorer::new(&board, &topology, default_weights());
        for stats in &scorer.vertices {
            let numbers: Vec<u8> = stats.token_pips.iter().enumerate()
                .filter_map(|(number, pips)| (*pips != 0.0).then_some(number as u8))
                .collect();
            assert_eq!(&stats.token_numbers[..usize::from(stats.token_numbers_len)], numbers);
            for value in [0.0, -0.0, -1.5, 1e-12, 1e20, f64::NAN] {
                let mut holdings = Holdings::empty();
                for (number, held) in holdings.token_pips.iter_mut().enumerate() {
                    *held = if number % 2 == 0 { value } else { number as f64 };
                }
                let mut expected = 0.0;
                for number in 0..stats.token_pips.len() {
                    if stats.token_pips[number] != 0.0 {
                        expected += js_min(holdings.token_pips[number], stats.token_pips[number]);
                    }
                }
                expected *= scorer.weights.duplicate_number_penalty;
                assert_eq!(scorer.duplicate_number_penalty(&holdings, stats).to_bits(), expected.to_bits());
                assert_eq!(scorer.sparse_duplicate_number_penalty(&holdings, stats).to_bits(), expected.to_bits());
            }
        }
    }

    /// The base of `coverage`'s power is a ratio of small pip sums to a cap, so a handful of values
    /// account for nearly every call the setup lookahead makes. A repeated input must not pay for
    /// `powf` again.
    #[test]
    fn a_repeated_coverage_runs_powf_once() {
        let weights = default_weights();
        let first = coverage(&weights, 3.0, 4.0);
        let after_first = coverage_powf_calls();
        for _ in 0..3 {
            assert_eq!(coverage(&weights, 3.0, 4.0).to_bits(), first.to_bits());
        }
        assert_eq!(coverage_powf_calls(), after_first, "a repeat must be remembered");

        // The cap divides out before the power, so an equal ratio is the same input.
        assert_eq!(coverage(&weights, 1.5, 2.0).to_bits(), first.to_bits());
        assert_eq!(coverage_powf_calls(), after_first);
    }

    /// Every slot starts as the entry for `powf(+0.0, +0.0)`, so a fresh thread can be answered
    /// from a slot nothing has written. That answer has to be the real power.
    #[test]
    fn an_untouched_slot_already_holds_a_true_power() {
        std::thread::spawn(|| {
            let mut weights = default_weights();
            weights.coverage_exponent = 0.0;
            let before = coverage_powf_calls();
            assert_eq!(coverage(&weights, 0.0, 4.0).to_bits(), 0.0_f64.powf(0.0).to_bits());
            assert_eq!(coverage_powf_calls(), before, "the seeded entry answers without `powf`");
        })
        .join()
        .unwrap();
    }

    /// Whatever is remembered is the `powf` it stands for, bit for bit, across far more distinct
    /// inputs than any table holds, at the edges of the domain, and at exponents other than the
    /// shipped one. Each input is asked twice in a row and again on a second sweep, so a fresh
    /// answer, an immediate repeat and an entry that was since displaced are all compared.
    #[test]
    fn a_remembered_coverage_is_the_powf_it_stands_for() {
        let edges = [
            0.0,
            -0.0,
            -1.0,
            f64::MIN_POSITIVE,
            1e-300,
            4.0,
            5.0,
            f64::INFINITY,
            f64::NEG_INFINITY,
            f64::NAN,
        ];
        let pips: Vec<f64> = edges
            .into_iter()
            .chain((0..2_000).map(|step| f64::from(step) * 0.003))
            .collect();
        for exponent in [1.5, 1.0, 0.0, 3.0, 0.5, -1.0, f64::NAN] {
            let mut weights = default_weights();
            weights.coverage_exponent = exponent;
            for _sweep in 0..2 {
                for cap in [4.0, 3.0] {
                    for value in &pips {
                        let direct = js_max(0.0, js_min(*value, cap) / cap).powf(exponent);
                        for _ in 0..2 {
                            let remembered = coverage(&weights, *value, cap);
                            assert!(
                                remembered.to_bits() == direct.to_bits()
                                    || (remembered.is_nan() && direct.is_nan()),
                                "pips {value} cap {cap} exponent {exponent}: {remembered} against {direct}"
                            );
                        }
                    }
                }
            }
        }
    }
}
