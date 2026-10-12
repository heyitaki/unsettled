//! What the placement formula promises, each promise asserted on a board or a context built for
//! it.
//!
//! These carry the tests the TypeScript formula had when it was deleted, with the same numbers:
//! `valuation.test.ts` and `expansion.test.ts` of `src/engine/__tests__` at commit `8107fc15`.
//! The tests of those files that are not here were already asserted by `expansion.rs`'s own
//! tests, by `tests/placement_parity.rs` and by `analysis/behaviour.rs`.

use std::collections::BTreeMap;

use super::*;
use crate::placement::expansion;
use crate::rules::Resource::{Brick, Ore, Sheep, Wheat, Wood};
use crate::state::EMPTY;
use crate::topology::Layout;

const TOKENS: [u8; 10] = [2, 3, 4, 5, 6, 8, 9, 10, 11, 12];

fn topology() -> &'static Topology {
    Topology::shared(Layout::Standard4).unwrap()
}

fn default_weights() -> EngineWeights {
    serde_json::from_str(include_str!("../../../../../placement/default-weights.json")).unwrap()
}

/// A scorer over a `standard4` board with `tiles` laid by hex and every other hex blank.
fn board(
    weights: EngineWeights,
    tiles: &[(Hex, Resource, u8)],
    ports: &[SimPort],
    seats: usize,
) -> AppFormulaScorer {
    let topology = topology();
    let mut kinds = vec![None; topology.hex_count()];
    let mut tokens = vec![None; topology.hex_count()];
    for (hex, resource, token) in tiles {
        kinds[usize::from(*hex)] = Some(*resource);
        tokens[usize::from(*hex)] = Some(*token);
    }
    AppFormulaScorer::from_parts(
        ScorerBoard {
            tiles: &kinds,
            tokens: &tokens,
            robber: None,
            ports,
            seats,
        },
        topology,
        weights,
    )
}

/// Every hex producing, no robber and no port: the resource and the token follow the hex index.
fn complete_board(weights: EngineWeights, seats: usize) -> AppFormulaScorer {
    let tiles: Vec<(Hex, Resource, u8)> = (0..topology().hex_count())
        .map(|hex| {
            (
                hex as Hex,
                Resource::ALL[hex % RESOURCE_COUNT],
                TOKENS[hex % TOKENS.len()],
            )
        })
        .collect();
    board(weights, &tiles, &[], seats)
}

/// One vertex's stats set by hand, where a real board could not isolate the term under test.
#[derive(Clone, Default)]
struct Site {
    pips: [f64; RESOURCE_COUNT],
    robbed: [f64; RESOURCE_COUNT],
    /// The resource (`None` for a generic port), the rate, and the reach: 1 on the port itself,
    /// less for one a road-build away.
    ports: Vec<(Option<Resource>, u32, f64)>,
    /// The producing hexes the vertex touches, each with its pips, for the concentration term.
    hexes: Vec<(usize, f64)>,
}

fn site(pips: &[(Resource, f64)]) -> Site {
    let mut site = Site::default();
    for (resource, amount) in pips {
        site.pips[resource.index()] = *amount;
    }
    site
}

impl Site {
    fn port(mut self, resource: Option<Resource>, rate: u32, reach: f64) -> Self {
        self.ports.push((resource, rate, reach));
        self
    }

    fn robbed(mut self, resource: Resource, amount: f64) -> Self {
        self.robbed[resource.index()] = amount;
        self
    }

    fn hexes(mut self, hexes: &[(usize, f64)]) -> Self {
        self.hexes = hexes.to_vec();
        self
    }
}

/// A scorer over a board with nothing on it, with `sites[i]` written over vertex `i` and the
/// board scarcity set by hand: 1 for a resource `scarcity` does not name. Twin of the `context`
/// helper of `valuation.test.ts`.
fn context(
    weights: EngineWeights,
    scarcity: &[(Resource, f64)],
    sites: &[Site],
) -> AppFormulaScorer {
    let mut scorer = board(weights, &[], &[], 2);
    scorer.scarcity = [1.0; RESOURCE_COUNT];
    for (resource, value) in scarcity {
        scorer.scarcity[resource.index()] = *value;
    }
    for resource in Resource::ALL {
        let index = resource.index();
        scorer.coverage_value[index] = scorer.weights.resource_value.get(resource)
            * js_max(
                0.0,
                1.0 + scorer.weights.coverage_scarcity_weight * (scorer.scarcity[index] - 1.0),
            );
    }
    for (vertex, site) in sites.iter().enumerate() {
        for (hex, pips) in &site.hexes {
            scorer.hex_pips[*hex] = *pips;
        }
        let mut port_factors = [0.0; RESOURCE_COUNT];
        let mut generic = 0.0;
        for (resource, rate, reach) in &site.ports {
            let factor = port_factor(*rate) * reach;
            match resource {
                Some(resource) => {
                    port_factors[resource.index()] = js_max(port_factors[resource.index()], factor)
                }
                None => generic = js_max(generic, factor),
            }
        }
        for factor in &mut port_factors {
            *factor = js_max(*factor, scorer.weights.generic_port_factor * generic);
        }
        let (production, scarcity_value, robber) =
            base_parts(&scorer.weights, &scorer.scarcity, &site.pips, &site.robbed);
        let discount = scorer.weights.robber_discount;
        let stats = &mut scorer.vertices[vertex];
        stats.pips = site.pips;
        stats.robbed_pips = site.robbed;
        stats.has_ports = !site.ports.is_empty();
        stats.hex_mask = site.hexes.iter().fold(0, |mask, (hex, _)| mask | 1 << hex);
        stats.precompute.adjusted =
            std::array::from_fn(|index| site.pips[index] - site.robbed[index] * discount);
        stats.precompute.base = production + scarcity_value + robber;
        stats.precompute.port_factors = port_factors;
    }
    scorer
}

/// What settling `first` and then `second` scores, with no board around them.
fn pair_score(scorer: &AppFormulaScorer, first: Vertex, second: Vertex) -> f64 {
    scorer.marginal_total(&[], first, false) + scorer.marginal_total(&[first], second, false)
}

/// Equal to twelve decimal places, which is as far as the hand arithmetic below is exact.
fn close(actual: f64, expected: f64) -> bool {
    (actual - expected).abs() < 5e-13
}

/// The vertices that touch exactly one hex, each with that hex.
fn single_hex_vertices() -> Vec<(Vertex, Hex)> {
    let topology = topology();
    (0..topology.vertex_count() as Vertex)
        .filter_map(|vertex| match topology.vertex_hexes(vertex) {
            [hex] => Some((vertex, *hex)),
            _ => None,
        })
        .collect()
}

/// A default port edge and an end of it that touches two hexes.
fn port_corner() -> (Edge, Vertex, [Hex; 2]) {
    let topology = topology();
    topology
        .default_port_edges()
        .iter()
        .find_map(|edge| {
            topology.edge_endpoints(*edge).into_iter().find_map(|vertex| {
                match topology.vertex_hexes(vertex) {
                    [first, second] => Some((*edge, vertex, [*first, *second])),
                    _ => None,
                }
            })
        })
        .expect("some port edge ends on a corner of two hexes")
}

fn bare() -> (Vec<u8>, Vec<u8>) {
    (
        vec![EMPTY; topology().vertex_count()],
        vec![EMPTY; topology().edge_count()],
    )
}

/// An interior vertex on three hexes, so every direction out of it is open board.
fn interior() -> Vertex {
    topology().vertex_by_id("v:-1,0;-1,1;0,0").unwrap()
}

/// The vertices two steps out, which ring the vertex without touching it.
fn second_ring(vertex: Vertex) -> Vec<Vertex> {
    let topology = topology();
    let first = topology.vertex_adjacent(vertex);
    let mut ring: Vec<Vertex> = first
        .iter()
        .flat_map(|neighbour| topology.vertex_adjacent(*neighbour).iter().copied())
        .filter(|other| *other != vertex && !first.contains(other))
        .collect();
    ring.sort_unstable();
    ring.dedup();
    ring
}

/// Every site the candidate opens, at the fewest paid road-builds any first edge reaches it for.
fn cheapest_sites(
    scorer: &AppFormulaScorer,
    vertex_owner: &[u8],
    edge_owner: &[u8],
    seat: u8,
    candidate: Vertex,
) -> BTreeMap<Vertex, u32> {
    let mut cheapest = BTreeMap::new();
    for (_, sites) in expansion::sites_by_edge(scorer, vertex_owner, edge_owner, seat, candidate) {
        for site in sites {
            let held = cheapest.entry(site.vertex).or_insert(site.paid_builds);
            *held = (*held).min(site.paid_builds);
        }
    }
    cheapest
}

/// Every component of the two breakdowns but `skip`, bit for bit.
fn assert_same_but(left: ScoreBreakdown, right: ScoreBreakdown, skip: &[&str], what: &str) {
    for (name, left, right) in [
        ("production", left.production, right.production),
        ("scarcity", left.scarcity, right.scarcity),
        ("robber", left.robber, right.robber),
        ("diversity", left.diversity, right.diversity),
        ("port", left.port, right.port),
        ("handValue", left.hand_value, right.hand_value),
        ("expansion", left.expansion, right.expansion),
    ] {
        if !skip.contains(&name) {
            assert_eq!(left.to_bits(), right.to_bits(), "{what}: {name} {left} against {right}");
        }
    }
}

#[test]
fn equal_pips_are_worth_more_on_the_board_scarce_resource() {
    let scorer = context(
        default_weights(),
        &[(Wood, 0.5), (Brick, 2.0)],
        &[site(&[(Wood, 5.0)]), site(&[(Brick, 5.0)])],
    );
    assert!(scorer.marginal_total(&[], 1, false) > scorer.marginal_total(&[], 0, false));
}

#[test]
fn a_six_and_an_eight_beat_two_sixes() {
    // Four corners of one wood hex each, on four hexes: three under a 6 and one under an 8, so
    // the two pairs differ in nothing but the number they share.
    let mut corners: Vec<(Vertex, Hex)> = Vec::new();
    for (vertex, hex) in single_hex_vertices() {
        if corners.iter().all(|(_, used)| *used != hex) {
            corners.push((vertex, hex));
        }
    }
    corners.truncate(4);
    assert_eq!(corners.len(), 4);
    let tiles: Vec<(Hex, Resource, u8)> = corners
        .iter()
        .enumerate()
        .map(|(index, (_, hex))| (*hex, Wood, if index == 3 { 8 } else { 6 }))
        .collect();
    let scorer = board(default_weights(), &tiles, &[], 2);
    let duplicate = pair_score(&scorer, corners[0].0, corners[1].0);
    let varied = pair_score(&scorer, corners[2].0, corners[3].0);
    assert!(varied > duplicate, "{varied} against {duplicate}");
    assert!(close(
        scorer.marginal_total(&[corners[0].0], corners[1].0, false),
        scorer.breakdown(&[corners[0].0], corners[1].0, false).total(),
    ));
}

#[test]
fn a_high_worth_resource_beats_equal_pips_of_a_low_worth_one() {
    let scorer = context(
        default_weights(),
        &[],
        &[site(&[(Wheat, 5.0)]), site(&[(Sheep, 5.0)])],
    );
    assert!(scorer.marginal_total(&[], 0, false) > scorer.marginal_total(&[], 1, false));
}

#[test]
fn a_port_is_credited_only_for_a_real_surplus_of_its_resource() {
    let port_at = |pips: f64| {
        let scorer = context(
            default_weights(),
            &[],
            &[site(&[(Wood, pips)]).port(Some(Wood), 2, 1.0)],
        );
        scorer.breakdown(&[], 0, false).port
    };
    assert_eq!(port_at(3.0), 0.0);
    assert!(port_at(8.0) > 0.0);
}

/// Pins the curve's shape, not just its direction: a linear curve would make 1 pip worth exactly
/// a quarter of 4, so this fails if the shipped exponent falls to 1. The spread and the recipes
/// both scale with the coverage of the gating resource, so the ratio isolates the curve.
#[test]
fn coverage_is_strongly_sub_linear_in_pips() {
    let weights = default_weights();
    let cap = weights.diversity_cap;
    let sheep_credit = |pips: f64| {
        let scorer = context(
            weights.clone(),
            &[],
            &[
                site(&[(Wood, cap), (Brick, cap), (Wheat, cap), (Ore, cap)]),
                site(&[(Sheep, pips)]),
            ],
        );
        scorer.breakdown(&[0], 1, false).diversity
    };
    let token = sheep_credit(1.0);
    let full = sheep_credit(cap);
    assert!(full > 0.0);
    assert!(token / full < 0.2, "{token} of {full}");
}

/// The scorer's own scarcity, read off the tiles, not one set by hand.
#[test]
fn a_pip_of_a_board_scarce_resource_beats_one_of_an_abundant_resource() {
    let corners = single_hex_vertices();
    let (brick_corner, brick_hex) = corners[0];
    let (wood_corner, _) = *corners
        .iter()
        .find(|(_, hex)| *hex != brick_hex)
        .expect("a second coastal hex");
    // Wood everywhere, one lone brick hex, equal tokens.
    let tiles: Vec<(Hex, Resource, u8)> = (0..topology().hex_count() as Hex)
        .map(|hex| (hex, if hex == brick_hex { Brick } else { Wood }, 6))
        .collect();
    let scorer = board(default_weights(), &tiles, &[], 2);
    assert!(scorer.scarcity[Brick.index()] > scorer.scarcity[Wood.index()]);
    // Both corners are 5 pips of one resource, so only the scarcity term can separate them.
    let value = |vertex: Vertex| {
        let breakdown = scorer.breakdown(&[], vertex, false);
        breakdown.production + breakdown.scarcity
    };
    assert!(value(brick_corner) > value(wood_corner));
}

/// When a pair has to be broken up, the board decides which half to keep: the abundant one is
/// the cheaper skip, because rivals will trade it away.
#[test]
fn skipping_the_resource_the_board_is_flush_with_costs_less() {
    let weights = default_weights();
    assert_eq!(weights.resource_value.wood, weights.resource_value.brick);
    let scorer = context(
        weights,
        &[(Wood, 0.5), (Brick, 2.0)],
        &[
            site(&[(Wheat, 4.0), (Sheep, 4.0), (Ore, 4.0)]),
            // Keeps wood and skips the scarce brick.
            site(&[(Wood, 4.0)]),
            // Keeps brick and skips the abundant wood.
            site(&[(Brick, 4.0)]),
        ],
    );
    let skip_brick = scorer.breakdown(&[0], 1, false).diversity;
    let skip_wood = scorer.breakdown(&[0], 2, false).diversity;
    assert!(skip_wood > skip_brick);
}

#[test]
fn a_fifth_resource_on_a_lone_2_or_12_is_barely_rewarded() {
    let scorer = context(
        default_weights(),
        &[],
        &[
            site(&[(Wood, 4.0), (Brick, 4.0), (Wheat, 4.0), (Ore, 4.0)]),
            // A lone 2 or 12, which nearly never rolls.
            site(&[(Sheep, 1.0)]),
            // A real source, a 4 or a 10.
            site(&[(Sheep, 3.0)]),
        ],
    );
    let token = scorer.breakdown(&[0], 1, false).diversity;
    let real = scorer.breakdown(&[0], 2, false).diversity;
    assert!(real > token * 2.0);
}

#[test]
fn a_two_for_one_port_beats_a_three_for_one_and_a_four_for_one_is_worth_nothing() {
    let (edge, corner, hexes) = port_corner();
    let tiles = [(hexes[0], Wood, 6), (hexes[1], Wood, 8)];
    let port_at = |rate: u32| {
        let ports = [SimPort {
            edge,
            resource: Some(Wood),
            rate,
        }];
        board(default_weights(), &tiles, &ports, 2)
            .breakdown(&[], corner, false)
            .port
    };
    assert!(port_at(2) > port_at(3));
    assert!(port_at(3) > port_at(4));
    assert_eq!(port_at(4), 0.0);
}

/// A vertex one road out cannot settle the end of the port edge it neighbours, so it pays the
/// same two roads as a vertex two out.
#[test]
fn a_port_costs_two_roads_from_anywhere_off_its_edge() {
    let topology = topology();
    let weights = default_weights();
    let decay = weights.near_port_decay;
    let edge = topology.default_port_edges()[0];
    let ports = [SimPort {
        edge,
        resource: Some(Wood),
        rate: 2,
    }];
    let scorer = board(weights, &[], &ports, 2);
    // A 2:1 port's factor is 1, so a vertex's wood factor is its reach.
    let reach = |vertex: Vertex| scorer.vertices[usize::from(vertex)].precompute.port_factors[Wood.index()];
    let ends = topology.edge_endpoints(edge);
    for end in ends {
        assert_eq!(reach(end), 1.0);
    }
    let off_edge: Vec<Vertex> = (0..topology.vertex_count() as Vertex)
        .filter(|vertex| !ends.contains(vertex) && scorer.vertices[usize::from(*vertex)].has_ports)
        .collect();
    assert!(off_edge.len() > 2, "the port reaches past the neighbours of its ends");
    for vertex in &off_edge {
        assert_eq!(reach(*vertex), decay.powf(2.0), "vertex {vertex}");
    }
    for end in ends {
        for neighbour in topology.vertex_adjacent(end) {
            assert!(ends.contains(neighbour) || off_edge.contains(neighbour));
        }
    }
}

#[test]
fn port_reach_decays_with_each_road_build_of_distance() {
    let weights = default_weights();
    let decay = weights.near_port_decay;
    let port_at = |reach: f64| {
        let scorer = context(
            weights.clone(),
            &[],
            &[site(&[(Wood, 8.0)]).port(Some(Wood), 2, reach)],
        );
        scorer.breakdown(&[], 0, false).port
    };
    let on_port = port_at(1.0);
    let one_road = port_at(decay);
    let two_roads = port_at(decay.powf(2.0));
    assert!(on_port > one_road);
    assert!(one_road > two_roads);
    assert!(two_roads > 0.0);
}

/// One port that two settlements reach is held once, at the closer reach of the two.
#[test]
fn a_port_two_settlements_reach_is_held_once_at_its_closest_reach() {
    for reach in [0.25, 1.0] {
        let scorer = context(
            default_weights(),
            &[],
            &[
                site(&[(Ore, 4.0)]).port(Some(Ore), 2, reach),
                site(&[(Ore, 4.0)]).port(Some(Ore), 2, 1.0),
            ],
        );
        for order in [[0, 1], [1, 0]] {
            let holdings = scorer.build_holdings(order.into_iter());
            assert!(holdings.has_ports);
            assert_eq!(holdings.port_factors[Ore.index()], 1.0, "reach {reach}");
        }
    }
}

#[test]
fn a_second_port_for_a_resource_already_ported_adds_nothing() {
    let first = site(&[(Wood, 6.0)]).port(Some(Wood), 2, 1.0);
    let second = site(&[(Wood, 2.0)]);
    let port_with = |second: Site| {
        let scorer = context(default_weights(), &[], &[first.clone(), second]);
        scorer.breakdown(&[0], 1, false).port
    };
    let plain = port_with(second.clone());
    assert!(plain > 0.0);
    assert!(close(port_with(second.clone().port(Some(Wood), 2, 1.0)), plain));
    assert!(close(port_with(second.port(None, 3, 1.0)), plain));
}

#[test]
fn a_generic_port_hedges_every_resource_at_a_discount() {
    let (edge, corner, hexes) = port_corner();
    let port_of = |tiles: [(Hex, Resource, u8); 2], resource: Option<Resource>, rate: u32| {
        let ports = [SimPort {
            edge,
            resource,
            rate,
        }];
        board(default_weights(), &tiles, &ports, 2)
            .breakdown(&[], corner, false)
            .port
    };
    // 4 pips of wood and 4 of ore on a 3:1, against 8 pips of wood on its own 2:1.
    let generic = port_of([(hexes[0], Wood, 5), (hexes[1], Ore, 9)], None, 3);
    let dedicated = port_of([(hexes[0], Wood, 5), (hexes[1], Wood, 9)], Some(Wood), 2);
    assert!(generic > 0.0);
    assert!(dedicated > generic);
}

/// Hand arithmetic at the default weights on a vertex with no wood and no brick, so the road and
/// settlement recipes are both 0 and only the spread, the city recipe and the dev-card recipe are
/// left. `recipeCap` and `diversityCap` are both 4, so coverage is `(min(pips, 4) / 4) ** 1.5`:
/// ore and wheat saturate at 1 and sheep, at 3 pips, sits at `0.75 ** 1.5`. Board scarcity is
/// flat, so each resource's coverage value is its `resourceValue`.
#[test]
fn the_dev_card_recipe_ships_at_zero_and_is_priced_only_at_a_nonzero_bonus() {
    let sheep_cover = 0.75_f64.powf(1.5);
    let spread = 1.6 * (1.3 * 1.0 + 1.35 * 1.0 + 0.75 * sheep_cover);
    let city = 2.0 * 1.0;
    let diversity_at = |weights: EngineWeights| {
        let scorer = context(
            weights,
            &[],
            &[site(&[(Ore, 4.0), (Wheat, 4.0), (Sheep, 3.0)])],
        );
        scorer.breakdown(&[], 0, false).diversity
    };
    let shipped = default_weights();
    assert_eq!(shipped.recipe_dev_card_bonus, 0.0);
    let mut on = shipped.clone();
    on.recipe_dev_card_bonus = 2.0;
    assert!(close(diversity_at(shipped), spread + city));
    assert!(close(diversity_at(on), spread + city + 2.0 * sheep_cover));
}

/// Hand arithmetic at the default weights plus the witness weight. A 2:1 port has factor 1 and
/// empty holdings carry no port, so the whole delta is the half after the move: `portWeight`
/// (0.55) times the surplus of 8 pips (8 - 3) times `1 + weight * deficit`. Four pips saturate a
/// resource's coverage, so the narrow vertex covers none of the other four (deficit 1) and the
/// broad one covers all four (deficit 0).
#[test]
fn a_port_pays_a_narrow_spread_more_than_a_broad_one_at_equal_production() {
    let mut weights = default_weights();
    weights.port_coverage_deficit_weight = 1.0;
    let port_of = |pips: &[(Resource, f64)]| {
        let scorer = context(
            weights.clone(),
            &[],
            &[site(pips).port(Some(Wood), 2, 1.0)],
        );
        scorer.breakdown(&[], 0, false).port
    };
    assert!(close(port_of(&[(Wood, 8.0)]), 0.55 * 5.0 * 2.0));
    assert!(close(
        port_of(&[(Wood, 8.0), (Sheep, 4.0), (Wheat, 4.0), (Brick, 4.0), (Ore, 4.0)]),
        0.55 * 5.0 * 1.0,
    ));
}

/// The holding sits on the port with 6 wood and nothing else, so before the move wood's deficit
/// is 1 and its factor 2. The candidate adds 4 wood and 4 sheep, so after the move sheep is
/// saturated too: one of the other four is covered, the deficit is 0.75 and the factor 1.75. A
/// true delta is `0.55 * (surplus(10) * 1.75 - surplus(6) * 2)`; repricing the holding's port at
/// either single factor gives 3.85 or 4.4. At the shipped weight of 0 every factor is 1.
#[test]
fn each_half_of_the_port_delta_is_priced_at_its_own_coverage_deficit() {
    let port_at = |weights: EngineWeights| {
        let scorer = context(
            weights,
            &[],
            &[
                site(&[(Wood, 4.0), (Sheep, 4.0)]),
                site(&[(Wood, 6.0)]).port(Some(Wood), 2, 1.0),
            ],
        );
        scorer.breakdown(&[1], 0, false).port
    };
    let shipped = default_weights();
    assert_eq!(shipped.port_coverage_deficit_weight, 0.0);
    let mut witness = shipped.clone();
    witness.port_coverage_deficit_weight = 1.0;
    assert!(close(port_at(witness), 0.55 * (7.0 * 1.75 - 3.0 * 2.0)));
    assert!(close(port_at(shipped), 0.55 * (7.0 - 3.0)));
}

#[test]
fn the_robber_discount_moves_the_robber_component_alone() {
    let mut weights = default_weights();
    weights.scarcity_weight = 0.0;
    weights.diversity_weight = 0.0;
    weights.recipe_road_bonus = 0.0;
    weights.recipe_city_bonus = 0.0;
    weights.recipe_settlement_bonus = 0.0;
    weights.port_weight = 0.0;
    let discount = weights.robber_discount;
    let mut undiscounted = weights.clone();
    undiscounted.robber_discount = 0.0;
    let robbed = [site(&[(Wood, 5.0)]).robbed(Wood, 5.0)];
    let discounted = context(weights, &[], &robbed).breakdown(&[], 0, false);
    let ignored = context(undiscounted, &[], &robbed).breakdown(&[], 0, false);
    assert_eq!(discounted.robber, -5.0 * discount);
    assert_eq!(ignored.robber, 0.0);
    for (left, right) in [
        (discounted.production, ignored.production),
        (discounted.scarcity, ignored.scarcity),
        (discounted.diversity, ignored.diversity),
        (discounted.port, ignored.port),
        (discounted.hand_value, ignored.hand_value),
        (discounted.expansion, ignored.expansion),
    ] {
        assert_eq!(left, right);
    }
}

/// The holding leans on one 5-pip hex out of 6 pips, a share of 5/6. The candidate brings a
/// 4-pip hex and the holding's own 1-pip hex again, so the pair's distinct hexes are 5 + 1 + 4 =
/// 10 pips with 5 on the top one: a share of 1/2.
fn concentration_sites() -> [Site; 2] {
    [
        site(&[(Wood, 6.0)]).hexes(&[(0, 5.0), (1, 1.0)]),
        site(&[(Brick, 5.0)]).hexes(&[(1, 1.0), (2, 4.0)]),
    ]
}

/// The candidate spreads the pair out, so the delta is 1/2 - 5/6 = -1/3 and the term pays
/// 3 * 1/3 = 1. Counting the shared hex twice would make the union 11 pips and pay 1.136.
#[test]
fn the_robber_component_is_charged_for_the_move_in_the_top_hex_share() {
    let mut weights = default_weights();
    weights.robber_concentration_weight = 3.0;
    let scorer = context(weights, &[], &concentration_sites());
    assert!(close(scorer.breakdown(&[0], 1, false).robber, 1.0));
    // A first pick has no holding to concentrate, so its own share is the whole of the move.
    assert!(close(scorer.breakdown(&[], 0, false).robber, -3.0 * (5.0 / 6.0)));
}

#[test]
fn no_hex_share_is_taken_at_the_shipped_concentration_weight() {
    let weights = default_weights();
    assert_eq!(weights.robber_concentration_weight, 0.0);
    let discount = weights.robber_discount;
    let [first, second] = concentration_sites();
    let second = second.robbed(Brick, 2.0);
    let bare = [first.clone().hexes(&[]), second.clone().hexes(&[])];
    let with_hexes = context(weights.clone(), &[], &[first, second]);
    let without_hexes = context(weights, &[], &bare);
    let breakdown = with_hexes.breakdown(&[0], 1, false);
    assert_eq!(breakdown.robber, -2.0 * discount);
    assert_same_but(breakdown, without_hexes.breakdown(&[0], 1, false), &[], "hexes");
    assert_eq!(
        with_hexes.marginal_total(&[0], 1, false).to_bits(),
        without_hexes.marginal_total(&[0], 1, false).to_bits(),
    );
}

/// The four vertices both calibrations rank: a wood pair, the first of it on a 2:1 wood port,
/// against a spread pair.
fn calibration(wood: f64) -> AppFormulaScorer {
    context(
        default_weights(),
        &[],
        &[
            site(&[(Wood, wood)]).port(Some(Wood), 2, 1.0),
            site(&[(Wood, wood)]),
            site(&[(Wood, 2.0), (Brick, 3.0)]),
            site(&[(Wheat, 2.0), (Sheep, 3.0)]),
        ],
    )
}

#[test]
fn a_twelve_pip_wood_port_pair_beats_diversity_by_at_least_one_and_a_half() {
    let scorer = calibration(6.0);
    assert!(pair_score(&scorer, 0, 1) - pair_score(&scorer, 2, 3) >= 1.5);
}

#[test]
fn diversity_beats_an_eight_pip_concentration_by_at_least_one_and_a_half() {
    let scorer = calibration(4.0);
    assert!(pair_score(&scorer, 2, 3) - pair_score(&scorer, 0, 1) >= 1.5);
}

/// The weights of the slot-scale tests: a nonzero expansion weight, or the expansion scale would
/// multiply a term that is 0 whatever it is told, with `scale` written over every slot `named`
/// picks out of the block.
fn scaled_weights(named: impl Fn(&str, &str) -> bool) -> EngineWeights {
    let mut weights = default_weights();
    weights.expansion_weight = 0.3;
    for (seats, row) in &mut weights.slot_scales {
        for (slot, scale) in row {
            if named(seats, slot) {
                // Off 1 in both directions, so a component that took the wrong one is not merely
                // off by a sign.
                *scale = SlotScale {
                    expansion: 2.0,
                    diversity: 0.5,
                };
            }
        }
    }
    weights
}

/// A rival's settlement and road, and nothing of the seat under test.
fn rival_pieces() -> (Vec<u8>, Vec<u8>) {
    let (mut vertex_owner, mut edge_owner) = bare();
    let rival = second_ring(interior())[0];
    vertex_owner[usize::from(rival)] = 0;
    edge_owner[usize::from(topology().vertex_edges(rival)[0])] = 0;
    (vertex_owner, edge_owner)
}

#[test]
fn a_slot_scale_multiplies_the_diversity_and_expansion_components_and_no_other() {
    let scaled = complete_board(scaled_weights(|seats, slot| seats == "4" && slot == "2"), 4);
    let witness = complete_board(scaled_weights(|_, _| false), 4);
    let (mut vertex_owner, edge_owner) = rival_pieces();
    vertex_owner[0] = 2;
    let mut moved = 0;
    for vertex in 0..topology().vertex_count() as Vertex {
        if vertex_owner[usize::from(vertex)] != EMPTY {
            continue;
        }
        let plain = witness.breakdown_for_owner(&vertex_owner, &edge_owner, 2, vertex, false);
        let actual = scaled.breakdown_for_owner(&vertex_owner, &edge_owner, 2, vertex, false);
        let expected = ScoreBreakdown {
            diversity: plain.diversity * 0.5,
            expansion: plain.expansion * 2.0,
            ..plain
        };
        assert_same_but(actual, expected, &[], "the scaled slot");
        // The fused total scales the same products the breakdown does, so the two entries cannot
        // disagree about what a scaled slot is worth.
        assert_eq!(
            scaled
                .marginal_total_for_owner(&vertex_owner, &edge_owner, 2, vertex, false)
                .to_bits(),
            actual.total().to_bits(),
        );
        // Another seat of the same board is on a slot the block left at 1.
        assert_same_but(
            scaled.breakdown_for_owner(&vertex_owner, &edge_owner, 1, vertex, false),
            witness.breakdown_for_owner(&vertex_owner, &edge_owner, 1, vertex, false),
            &[],
            "an unscaled slot",
        );
        moved += usize::from(plain.expansion != 0.0 && plain.diversity != 0.0);
    }
    assert!(moved > 0);
}

/// A seat count the block has no row for, and a seat past the row's last slot, both score
/// unscaled: the app ranks two-player and solo boards the simulator never drafts. A row of 1s
/// scores bit for bit as no row does.
#[test]
fn a_slot_the_block_does_not_name_and_a_slot_scaled_by_one_score_unscaled() {
    let everywhere = scaled_weights(|_, _| true);
    let nowhere = scaled_weights(|_, _| false);
    let (vertex_owner, edge_owner) = rival_pieces();
    // On four seats, seat 9 is past the row and seat 2 is on it.
    let scaled = complete_board(everywhere.clone(), 4);
    let witness = complete_board(nowhere.clone(), 4);
    assert_eq!(scaled.slot_scale(9), SlotScale::NEUTRAL);
    assert_ne!(scaled.slot_scale(2), SlotScale::NEUTRAL);
    // Two seats have no row at all.
    let scaled_pair = complete_board(everywhere, 2);
    let witness_pair = complete_board(nowhere, 2);
    assert_eq!(scaled_pair.slot_scale(1), SlotScale::NEUTRAL);
    let mut scored = 0;
    for vertex in 0..topology().vertex_count() as Vertex {
        if vertex_owner[usize::from(vertex)] != EMPTY {
            continue;
        }
        let score = |scorer: &AppFormulaScorer, seat: u8| {
            (
                scorer.breakdown_for_owner(&vertex_owner, &edge_owner, seat, vertex, true),
                scorer.marginal_total_for_owner(&vertex_owner, &edge_owner, seat, vertex, true),
            )
        };
        let unnamed = score(&witness, 9);
        for (what, other) in [
            ("a row of 1s", score(&witness, 2)),
            ("a seat past the row", score(&scaled, 9)),
        ] {
            assert_same_but(other.0, unnamed.0, &[], what);
            assert_eq!(other.1.to_bits(), unnamed.1.to_bits(), "{what}");
        }
        let pair = score(&witness_pair, 1);
        let other = score(&scaled_pair, 1);
        assert_same_but(other.0, pair.0, &[], "a seat count with no row");
        assert_eq!(other.1.to_bits(), pair.1.to_bits());
        scored += usize::from(unnamed.0.expansion != 0.0);
    }
    assert!(scored > 0);
}

#[test]
fn the_term_is_the_weight_times_the_two_best_sites_the_candidate_opens() {
    let mut weights = default_weights();
    weights.expansion_weight = 0.3;
    let (weight, decay) = (weights.expansion_weight, weights.expansion_decay);
    let scorer = complete_board(weights, 2);
    let candidate = interior();
    let (open, edge_owner) = bare();
    // Rivals on the whole second ring: every path out of the candidate dies on a settlement
    // before it reaches a legal site, while the candidate's own production is untouched.
    let mut boxed = open.clone();
    for vertex in second_ring(candidate) {
        boxed[usize::from(vertex)] = 1;
    }

    let cheapest = cheapest_sites(&scorer, &open, &edge_owner, 0, candidate);
    assert!(cheapest.len() > 1);
    let mut held = Holdings::empty();
    scorer.add_to_holdings(&mut held, candidate);
    let mut discounted: Vec<f64> = cheapest
        .iter()
        .map(|(vertex, paid_builds)| {
            scorer.total_with_holdings(held, *vertex, false) * decay.powf(f64::from(*paid_builds))
        })
        .collect();
    discounted.sort_by(|left, right| right.total_cmp(left));
    let expected = weight * (discounted[0] + discounted[1]);

    let open_score = scorer.breakdown_for_owner(&open, &edge_owner, 0, candidate, false);
    let boxed_score = scorer.breakdown_for_owner(&boxed, &edge_owner, 0, candidate, false);
    assert_eq!(open_score.expansion.to_bits(), expected.to_bits());
    assert!(expansion::sites_by_edge(&scorer, &boxed, &edge_owner, 0, candidate).is_empty());
    assert_eq!(boxed_score.expansion, 0.0);
    // The two boards differ only in the rivals' pieces, so every other component is untouched
    // and the whole gap is the term.
    assert_same_but(open_score, boxed_score, &["expansion"], "boxed in");
    assert!(open_score.total() > boxed_score.total());
}

#[test]
fn a_rival_road_is_impassable_and_the_seats_own_is_free() {
    let topology = topology();
    let mut weights = default_weights();
    weights.expansion_weight = 0.3;
    let scorer = complete_board(weights, 2);
    let candidate = interior();
    let (vertex_owner, no_roads) = bare();
    let &[first, second, third] = topology.vertex_edges(candidate) else {
        panic!("an interior vertex has three edges");
    };
    assert!(first < second && second < third);
    let open = cheapest_sites(&scorer, &vertex_owner, &no_roads, 0, candidate);

    let mut two_closed = no_roads.clone();
    two_closed[usize::from(first)] = 1;
    two_closed[usize::from(second)] = 1;
    let narrowed = expansion::sites_by_edge(&scorer, &vertex_owner, &two_closed, 0, candidate);
    let listed: Vec<Edge> = narrowed.iter().map(|(edge, _)| *edge).collect();
    assert_eq!(listed, [third]);
    let reached = cheapest_sites(&scorer, &vertex_owner, &two_closed, 0, candidate);
    assert!(!reached.is_empty() && reached.len() < open.len());
    let through_third =
        expansion::term(&scorer, &Holdings::empty(), &vertex_owner, &two_closed, 0, candidate);
    assert_eq!(through_third.road, Some(third));

    let mut all_closed = two_closed.clone();
    all_closed[usize::from(third)] = 1;
    assert!(expansion::sites_by_edge(&scorer, &vertex_owner, &all_closed, 0, candidate).is_empty());
    let closed =
        expansion::term(&scorer, &Holdings::empty(), &vertex_owner, &all_closed, 0, candidate);
    assert_eq!(closed.value, 0.0);
    assert_eq!(closed.road, None);

    // The same three roads in the seat's own name cost it nothing: they are its network, not a
    // rival's wall.
    let mut own_roads = no_roads.clone();
    for edge in [first, second, third] {
        own_roads[usize::from(edge)] = 0;
    }
    let owned = cheapest_sites(&scorer, &vertex_owner, &own_roads, 0, candidate);
    // Strictly more, not merely no fewer: the free setup road is still in hand after travelling
    // an own road, so the horizon reaches one ring further than it does off the bare board. A
    // walk that spent the road on every first step would tie here, not lose.
    assert!(owned.len() > open.len());
    // And the sites the bare board already reached are reached for no more than they cost there.
    for (vertex, paid_builds) in &open {
        assert!(owned[vertex] <= *paid_builds, "vertex {vertex}");
    }
    // Read as the other seat, the very same roads close the candidate in.
    assert!(expansion::sites_by_edge(&scorer, &vertex_owner, &own_roads, 1, candidate).is_empty());
}

#[test]
fn sites_are_grouped_by_first_edge_and_listed_in_ascending_cost() {
    let scorer = complete_board(default_weights(), 2);
    let candidate = interior();
    let (vertex_owner, edge_owner) = bare();
    let by_edge = expansion::sites_by_edge(&scorer, &vertex_owner, &edge_owner, 0, candidate);
    let mut edges: Vec<Edge> = by_edge.iter().map(|(edge, _)| *edge).collect();
    edges.sort_unstable();
    assert_eq!(edges, topology().vertex_edges(candidate));
    let mut listed = 0;
    for (edge, sites) in &by_edge {
        let mut vertices: Vec<Vertex> = sites.iter().map(|site| site.vertex).collect();
        vertices.sort_unstable();
        vertices.dedup();
        assert_eq!(vertices.len(), sites.len(), "edge {edge} lists a site twice");
        assert!(
            sites.is_sorted_by_key(|site| site.paid_builds),
            "edge {edge} lists a dearer site first"
        );
        listed += sites.len();
    }
    // Some sites are reachable through more than one first edge.
    let distinct = cheapest_sites(&scorer, &vertex_owner, &edge_owner, 0, candidate).len();
    assert!(distinct < listed);
}

/// M-66, the SP6 gate, adopted the term at 0.1, so the walk runs on every score the app takes.
/// An open board opens sites everywhere, so the shipped weight has to move every score.
#[test]
fn the_shipped_expansion_weight_moves_every_score_on_an_open_board() {
    let weights = default_weights();
    assert_eq!(weights.expansion_weight, 0.1);
    let scorer = complete_board(weights, 2);
    let (vertex_owner, edge_owner) = bare();
    for vertex in 0..topology().vertex_count() as Vertex {
        for receives_grant in [false, true] {
            assert_ne!(
                scorer.marginal_total_for_owner(&vertex_owner, &edge_owner, 0, vertex, receives_grant),
                scorer.marginal_total(&[], vertex, receives_grant),
                "vertex {vertex}"
            );
        }
    }
}
