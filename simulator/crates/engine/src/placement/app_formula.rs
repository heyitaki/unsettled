use serde::Deserialize;

use crate::board::SimBoard;
use crate::rules::{RESOURCE_COUNT, Resource};
use crate::topology::{Topology, Vertex};
use crate::view::pips;

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
    pub recipe_cap: f64,
    pub port_weight: f64,
    pub generic_port_factor: f64,
    pub port_surplus_threshold: f64,
    pub near_port_radius: f64,
    pub near_port_decay: f64,
    pub robber_discount: f64,
    pub opponent_top_k: f64,
    pub softmax_temperature: f64,
    pub rollout_budget: f64,
    pub rollouts_min: f64,
    pub rollouts_max: f64,
    pub max_results: f64,
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
            ("recipeCap", self.recipe_cap),
            ("portWeight", self.port_weight),
            ("genericPortFactor", self.generic_port_factor),
            ("portSurplusThreshold", self.port_surplus_threshold),
            ("nearPortRadius", self.near_port_radius),
            ("nearPortDecay", self.near_port_decay),
            ("robberDiscount", self.robber_discount),
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
        Ok(())
    }
}

#[derive(Clone, Copy, Debug)]
pub struct ScoreBreakdown {
    pub production: f64,
    pub scarcity: f64,
    pub robber: f64,
    pub diversity: f64,
    pub port: f64,
    pub hand_value: f64,
}

impl ScoreBreakdown {
    pub fn total(self) -> f64 {
        self.production + self.scarcity + self.robber + self.diversity + self.port + self.hand_value
    }
}

pub fn hand_value(weights: &EngineWeights, counts: &[f64; RESOURCE_COUNT]) -> f64 {
    let mut value = 0.0;
    for resource in Resource::ALL {
        value += counts[resource.index()] * weights.resource_value.get(resource);
    }
    weights.hand_value_weight * value
}

#[derive(Clone, Debug)]
pub struct AppFormulaScorer {
    weights: EngineWeights,
    scarcity: [f64; RESOURCE_COUNT],
    coverage_value: [f64; RESOURCE_COUNT],
    vertices: Vec<VertexStats>,
}

#[derive(Clone, Debug)]
struct VertexStats {
    pips: [f64; RESOURCE_COUNT],
    robbed_pips: [f64; RESOURCE_COUNT],
    token_pips: [f64; 13],
    has_ports: bool,
    setup_grant: [f64; RESOURCE_COUNT],
    precompute: VertexPrecompute,
}

#[derive(Clone, Copy, Debug)]
struct VertexPrecompute {
    adjusted: [f64; RESOURCE_COUNT],
    base: f64,
    port_factors: [f64; RESOURCE_COUNT],
    setup_grant_value: f64,
}

#[derive(Clone, Copy, Debug)]
struct Holdings {
    pips: [f64; RESOURCE_COUNT],
    token_pips: [f64; 13],
    has_ports: bool,
    port_factors: [f64; RESOURCE_COUNT],
}

impl Holdings {
    const fn empty() -> Self {
        Self {
            pips: [0.0; RESOURCE_COUNT],
            token_pips: [0.0; 13],
            has_ports: false,
            port_factors: [0.0; RESOURCE_COUNT],
        }
    }
}

impl AppFormulaScorer {
    pub fn new(board: &SimBoard, topology: &Topology, weights: EngineWeights) -> Self {
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
        let mut vertices = Vec::with_capacity(topology.vertex_count());
        for vertex_index in 0..topology.vertex_count() {
            let vertex = vertex_index as Vertex;
            let mut raw_pips = [0.0; RESOURCE_COUNT];
            let mut robbed_pips = [0.0; RESOURCE_COUNT];
            let mut setup_grant = [0.0; RESOURCE_COUNT];
            let mut token_pips = [0.0; 13];
            for hex in topology.vertex_hexes(vertex) {
                let index = usize::from(*hex);
                if let (Some(resource), Some(token)) = (board.tiles()[index], board.tokens()[index])
                {
                    let amount = f64::from(pips(token));
                    raw_pips[resource.index()] += amount;
                    token_pips[usize::from(token)] += amount;
                    if amount > 0.0 {
                        setup_grant[resource.index()] += 1.0;
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
            vertices.push(VertexStats {
                pips: raw_pips,
                robbed_pips,
                token_pips,
                has_ports: has_ports[vertex_index],
                setup_grant,
                precompute: VertexPrecompute {
                    adjusted,
                    base: production + scarcity_value + robber,
                    port_factors: port_factors[vertex_index],
                    setup_grant_value: hand_value(&weights, &setup_grant),
                },
            });
        }
        Self {
            weights,
            scarcity,
            coverage_value,
            vertices,
        }
    }

    pub fn breakdown(
        &self,
        holdings: &[Vertex],
        candidate: Vertex,
        receives_grant: bool,
    ) -> ScoreBreakdown {
        let holdings = self.build_holdings(holdings.iter().copied());
        self.breakdown_with_holdings(holdings, candidate, receives_grant)
    }

    pub fn marginal_total(
        &self,
        holdings: &[Vertex],
        candidate: Vertex,
        receives_grant: bool,
    ) -> f64 {
        let holdings = self.build_holdings(holdings.iter().copied());
        self.total_with_holdings(holdings, candidate, receives_grant)
    }

    pub(crate) fn score_for_owner(
        &self,
        vertex_owner: &[u8],
        seat: u8,
        candidate: Vertex,
        receives_grant: bool,
    ) -> f64 {
        let holdings = self.build_holdings(
            vertex_owner
                .iter()
                .enumerate()
                .filter_map(|(vertex, owner)| (*owner == seat).then_some(vertex as Vertex)),
        );
        self.total_with_holdings(holdings, candidate, receives_grant)
    }

    fn add_to_holdings(&self, holdings: &mut Holdings, vertex: Vertex) {
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
        for resource in Resource::ALL {
            let index = resource.index();
            holdings.port_factors[index] = js_max(
                holdings.port_factors[index],
                stats.precompute.port_factors[index],
            );
        }
    }

    fn base_breakdown(&self, stats: &VertexStats) -> (f64, f64, f64) {
        base_parts(
            &self.weights,
            &self.scarcity,
            &stats.pips,
            &stats.robbed_pips,
        )
    }

    fn breakdown_with_holdings(
        &self,
        holdings: Holdings,
        candidate: Vertex,
        receives_grant: bool,
    ) -> ScoreBreakdown {
        let stats = &self.vertices[usize::from(candidate)];
        let precompute = stats.precompute;
        let (production, scarcity, robber) = self.base_breakdown(stats);
        ScoreBreakdown {
            production,
            scarcity,
            robber,
            diversity: self.diversity_delta(&holdings, stats, precompute),
            port: self.port_delta(&holdings, stats, precompute),
            hand_value: if receives_grant {
                hand_value(&self.weights, &stats.setup_grant)
            } else {
                0.0
            },
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
        ) - self.diversity_score(wood, sheep, wheat, brick, ore)
            - self.duplicate_number_penalty(holdings, stats)
    }

    fn diversity_score(&self, wood: f64, sheep: f64, wheat: f64, brick: f64, ore: f64) -> f64 {
        let weights = &self.weights;
        let cap = weights.diversity_cap;
        let wood_cover = coverage(weights, wood, cap);
        let sheep_cover = coverage(weights, sheep, cap);
        let wheat_cover = coverage(weights, wheat, cap);
        let brick_cover = coverage(weights, brick, cap);
        let ore_cover = coverage(weights, ore, cap);
        let spread = weights.diversity_weight
            * (self.coverage_value[Resource::Wood.index()] * wood_cover
                + self.coverage_value[Resource::Sheep.index()] * sheep_cover
                + self.coverage_value[Resource::Wheat.index()] * wheat_cover
                + self.coverage_value[Resource::Brick.index()] * brick_cover
                + self.coverage_value[Resource::Ore.index()] * ore_cover);
        let recipe_cap = weights.recipe_cap;
        let same_cap = recipe_cap == cap;
        let wood_recipe = if same_cap {
            wood_cover
        } else {
            coverage(weights, wood, recipe_cap)
        };
        let sheep_recipe = if same_cap {
            sheep_cover
        } else {
            coverage(weights, sheep, recipe_cap)
        };
        let wheat_recipe = if same_cap {
            wheat_cover
        } else {
            coverage(weights, wheat, recipe_cap)
        };
        let brick_recipe = if same_cap {
            brick_cover
        } else {
            coverage(weights, brick, recipe_cap)
        };
        let ore_recipe = if same_cap {
            ore_cover
        } else {
            coverage(weights, ore, recipe_cap)
        };
        let road = weights.recipe_road_bonus * js_min(wood_recipe, brick_recipe);
        let city = weights.recipe_city_bonus * js_min(ore_recipe, wheat_recipe);
        let settlement = weights.recipe_settlement_bonus
            * js_min(
                js_min(js_min(wood_recipe, brick_recipe), wheat_recipe),
                sheep_recipe,
            );
        spread + road + city + settlement
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
        weights.port_weight
            * (port_surplus(weights, wood + precompute.adjusted[Resource::Wood.index()])
                * js_max(held[Resource::Wood.index()], gained[Resource::Wood.index()])
                - port_surplus(weights, wood) * held[Resource::Wood.index()]
                + port_surplus(
                    weights,
                    sheep + precompute.adjusted[Resource::Sheep.index()],
                ) * js_max(
                    held[Resource::Sheep.index()],
                    gained[Resource::Sheep.index()],
                )
                - port_surplus(weights, sheep) * held[Resource::Sheep.index()]
                + port_surplus(
                    weights,
                    wheat + precompute.adjusted[Resource::Wheat.index()],
                ) * js_max(
                    held[Resource::Wheat.index()],
                    gained[Resource::Wheat.index()],
                )
                - port_surplus(weights, wheat) * held[Resource::Wheat.index()]
                + port_surplus(
                    weights,
                    brick + precompute.adjusted[Resource::Brick.index()],
                ) * js_max(
                    held[Resource::Brick.index()],
                    gained[Resource::Brick.index()],
                )
                - port_surplus(weights, brick) * held[Resource::Brick.index()]
                + port_surplus(weights, ore + precompute.adjusted[Resource::Ore.index()])
                    * js_max(held[Resource::Ore.index()], gained[Resource::Ore.index()])
                - port_surplus(weights, ore) * held[Resource::Ore.index()])
    }

    fn total_with_holdings(
        &self,
        holdings: Holdings,
        candidate: Vertex,
        receives_grant: bool,
    ) -> f64 {
        let stats = &self.vertices[usize::from(candidate)];
        let precompute = stats.precompute;
        precompute.base
            + self.diversity_delta(&holdings, stats, precompute)
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
    js_max(0.0, js_min(pips, cap) / cap).powf(weights.coverage_exponent)
}

fn js_clamp(value: f64, min: f64, max: f64) -> f64 {
    js_max(min, js_min(max, value))
}

fn js_max(left: f64, right: f64) -> f64 {
    if left.is_nan() || right.is_nan() {
        f64::NAN
    } else {
        left.max(right)
    }
}

fn js_min(left: f64, right: f64) -> f64 {
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

fn port_surplus(weights: &EngineWeights, pips: f64) -> f64 {
    js_max(0.0, pips - weights.port_surplus_threshold)
}
