use std::collections::BTreeSet;

use serde::Deserialize;
use serde_json::Value;
use unsettled_engine::board::{ConversionError, ConversionOptions, SimBoard};
use unsettled_engine::placement::app_formula::{
    AppFormulaScorer, EngineWeights, ResourceValues, ScoreBreakdown,
};
use unsettled_engine::rules::RuleConfig;
use unsettled_engine::state::EMPTY;
use unsettled_engine::topology::Topology;
use unsettled_engine::wire::WireBoard;

const TOLERANCE: f64 = 1e-9;
const REQUIRED_CLASSES: [&str; 40] = [
    "W1", "W2", "W3", "W4", "W5", "W6", "W7", "W8", "W9", "W10", "W11", "W12", "B1", "B2", "B3",
    "B4", "B5", "B6", "B7", "B8", "B9", "B10", "B11", "P1", "P2", "P3", "P4", "P5", "H1", "H2",
    "H3", "H4", "F1", "F2", "G1", "G2", "G3", "G4", "G5", "G6",
];

#[derive(Deserialize)]
struct FixturePack {
    version: u8,
    cases: Vec<FixtureCase>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FixtureCase {
    id: String,
    covers: Vec<String>,
    board: Value,
    weights: Value,
    holdings: Vec<String>,
    candidate: String,
    receives_grant: bool,
    components: FixtureBreakdown,
    marginal_total: FixtureNumber,
    breakdown_total: FixtureNumber,
    ingestion: Ingestion,
    degenerate: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FixtureBreakdown {
    production: FixtureNumber,
    scarcity: FixtureNumber,
    robber: FixtureNumber,
    diversity: FixtureNumber,
    port: FixtureNumber,
    hand_value: FixtureNumber,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum FixtureNumber {
    Finite(f64),
    Special(String),
}

impl FixtureNumber {
    fn value(&self) -> f64 {
        match self {
            Self::Finite(value) => *value,
            Self::Special(value) if value == "NaN" => f64::NAN,
            Self::Special(value) if value == "Infinity" => f64::INFINITY,
            Self::Special(value) if value == "-Infinity" => f64::NEG_INFINITY,
            Self::Special(value) => panic!("unknown encoded number {value}"),
        }
    }
}

#[derive(Deserialize)]
#[serde(tag = "outcome", rename_all = "lowercase")]
enum Ingestion {
    Score,
    Reject { error: String },
}

#[test]
fn typescript_and_rust_placement_formulas_match() {
    let fixture: FixturePack =
        serde_json::from_str(include_str!("../../../fixtures/placement-parity.json")).unwrap();
    assert_eq!(fixture.version, 1);
    let covered: BTreeSet<_> = fixture
        .cases
        .iter()
        .flat_map(|case| case.covers.iter().map(String::as_str))
        .collect();
    assert_eq!(
        covered,
        REQUIRED_CLASSES.into_iter().collect(),
        "fixture case-class coverage changed"
    );

    let mut maximum = (0.0, String::new(), String::new());
    for case in fixture.cases {
        let wire = WireBoard::parse_value(case.board.clone()).unwrap();
        let topology = Topology::load(wire.layout).unwrap();
        let conversion = SimBoard::try_from_wire(
            wire,
            &topology,
            &RuleConfig::base(topology.layout()),
            ConversionOptions {
                allow_unofficial: true,
            },
        );
        match case.ingestion {
            Ingestion::Reject { error } => {
                let actual = conversion.expect_err("fixture expected conversion rejection");
                match (error.as_str(), actual) {
                    ("NullTile", ConversionError::NullTile { .. })
                    | ("MissingToken", ConversionError::MissingToken { .. })
                    | ("NoRobberPlacement", ConversionError::NoRobberPlacement) => {}
                    (_, actual) => panic!(
                        "case {} expected conversion error {error}, got {actual}",
                        case.id
                    ),
                }
            }
            Ingestion::Score => {
                let board = conversion.expect("fixture expected successful conversion");
                let weights = parse_weights(&case.weights);
                let scorer = AppFormulaScorer::new(&board, &topology, weights);
                let holdings = case
                    .holdings
                    .iter()
                    .map(|vertex| topology.vertex_by_id(vertex).unwrap())
                    .collect::<Vec<_>>();
                let candidate = topology.vertex_by_id(&case.candidate).unwrap();
                let actual = scorer.breakdown(&holdings, candidate, case.receives_grant);
                compare_breakdown(&case, actual, &mut maximum);
                compare(
                    &case.id,
                    "marginalTotal",
                    case.marginal_total.value(),
                    scorer.marginal_total(&holdings, candidate, case.receives_grant),
                    case.degenerate,
                    &mut maximum,
                );
                compare(
                    &case.id,
                    "breakdownTotal",
                    case.breakdown_total.value(),
                    actual.total(),
                    case.degenerate,
                    &mut maximum,
                );
            }
        }
    }
    eprintln!(
        "maximum finite deviation: {:.17e} in {} {}",
        maximum.0, maximum.1, maximum.2
    );
}

/// The scorer's adjacency copy answers exactly what `Topology` answers, on both layouts.
///
/// SP3's expansion walk runs off the copy, not off a topology handle, so a copy that lost an edge
/// or reordered a neighbour list would silently walk a different board and still look plausible.
#[test]
fn the_scorer_adjacency_copy_matches_the_topology_it_was_built_from() {
    let fixture: FixturePack =
        serde_json::from_str(include_str!("../../../fixtures/placement-parity.json")).unwrap();
    let mut layouts = BTreeSet::new();
    for case in fixture.cases {
        if matches!(case.ingestion, Ingestion::Reject { .. }) {
            continue;
        }
        let wire = WireBoard::parse_value(case.board.clone()).unwrap();
        if !layouts.insert(wire.layout.as_str()) {
            continue;
        }
        let topology = Topology::load(wire.layout).unwrap();
        let board = SimBoard::try_from_wire(
            wire,
            &topology,
            &RuleConfig::base(topology.layout()),
            ConversionOptions {
                allow_unofficial: true,
            },
        )
        .expect("fixture expected successful conversion");
        let scorer = AppFormulaScorer::new(&board, &topology, parse_weights(&case.weights));
        for index in 0..topology.vertex_count() {
            let vertex = index as u8;
            assert_eq!(
                scorer.vertex_adjacent(vertex),
                topology.vertex_adjacent(vertex),
                "vertex {index} adjacency"
            );
            assert_eq!(
                scorer.vertex_edges(vertex),
                topology.vertex_edges(vertex),
                "vertex {index} edges"
            );
            // Distinct vertices only. `Topology::edge_between` scans incident edges for one
            // holding `b` as an endpoint, so asked for a vertex against itself it answers with
            // that vertex's first incident edge; the scorer answers `None`, because a vertex is
            // not adjacent to itself. No walk asks, since neighbours come out of the adjacency
            // list, and the scorer's contract is the documented one.
            for other in 0..topology.vertex_count() {
                if other == index {
                    continue;
                }
                assert_eq!(
                    scorer.edge_between(vertex, other as u8),
                    topology.edge_between(vertex, other as u8),
                    "edge between {index} and {other}"
                );
            }
        }
    }
    assert_eq!(
        layouts,
        ["extension6", "standard4"].into_iter().collect(),
        "the fixture must cover both layouts"
    );
}

/// The occupancy-aware entry reads the same numbers as `breakdown` on every fixture case, with
/// the case board's own buildings and roads standing around the holdings.
///
/// Owner arrays come from the case board, one seat per player in board order, and the scoring
/// seat is a fresh index past every player on the board, so the vertices it owns are exactly the
/// case's `holdings` list and nothing the board happens to carry leaks into them. Every rival
/// building and every road stays where the board put it, which is the occupancy SP3's expansion
/// term will read; today not one of them may move a number. The comparison is on raw bits rather
/// than the fixture's tolerance because the two entries run the same arithmetic in the same
/// order: `breakdown` folds the holdings list left to right and the owner walk folds them in
/// ascending vertex order, which the assertion below pins as the same sequence.
#[test]
fn the_occupancy_aware_entry_matches_breakdown_on_every_fixture_case() {
    let fixture: FixturePack =
        serde_json::from_str(include_str!("../../../fixtures/placement-parity.json")).unwrap();
    let mut scored = 0;
    for case in fixture.cases {
        if matches!(case.ingestion, Ingestion::Reject { .. }) {
            continue;
        }
        let wire = WireBoard::parse_value(case.board.clone()).unwrap();
        let topology = Topology::load(wire.layout).unwrap();
        let players: Vec<String> = wire.players.iter().map(|player| player.id.clone()).collect();
        let buildings: Vec<(String, String)> = wire
            .buildings
            .iter()
            .map(|building| (building.vertex_id.clone(), building.player_id.clone()))
            .collect();
        let roads: Vec<(String, String)> = wire
            .roads
            .iter()
            .map(|road| (road.edge_id.clone(), road.player_id.clone()))
            .collect();
        let board = SimBoard::try_from_wire(
            wire,
            &topology,
            &RuleConfig::base(topology.layout()),
            ConversionOptions {
                allow_unofficial: true,
            },
        )
        .expect("fixture expected successful conversion");
        let scorer = AppFormulaScorer::new(&board, &topology, parse_weights(&case.weights));

        let seat = u8::try_from(players.len()).expect("board player count fits a seat index");
        let owner_of = |id: &String| {
            let index = players
                .iter()
                .position(|player| player == id)
                .expect("a piece's player is on the board");
            u8::try_from(index).expect("board player count fits a seat index")
        };
        let mut vertex_owner = vec![EMPTY; topology.vertex_count()];
        let mut edge_owner = vec![EMPTY; topology.edge_count()];
        for (vertex_id, player_id) in &buildings {
            let vertex = topology.vertex_by_id(vertex_id).expect("fixture vertex");
            vertex_owner[usize::from(vertex)] = owner_of(player_id);
        }
        for (edge_id, player_id) in &roads {
            let edge = topology.edge_by_id(edge_id).expect("fixture edge");
            edge_owner[usize::from(edge)] = owner_of(player_id);
        }
        let holdings: Vec<_> = case
            .holdings
            .iter()
            .map(|vertex| topology.vertex_by_id(vertex).unwrap())
            .collect();
        assert!(
            holdings.is_sorted(),
            "case {} lists holdings out of vertex order, which would fold the two entries' floats in different orders",
            case.id
        );
        for vertex in &holdings {
            vertex_owner[usize::from(*vertex)] = seat;
        }

        let candidate = topology.vertex_by_id(&case.candidate).unwrap();
        let expected = scorer.breakdown(&holdings, candidate, case.receives_grant);
        let actual = scorer.breakdown_for_owner(
            &vertex_owner,
            &edge_owner,
            seat,
            candidate,
            case.receives_grant,
        );
        for (component, expected, actual) in [
            ("production", expected.production, actual.production),
            ("scarcity", expected.scarcity, actual.scarcity),
            ("robber", expected.robber, actual.robber),
            ("diversity", expected.diversity, actual.diversity),
            ("port", expected.port, actual.port),
            ("handValue", expected.hand_value, actual.hand_value),
            ("total", expected.total(), actual.total()),
        ] {
            assert_eq!(
                expected.to_bits(),
                actual.to_bits(),
                "case {} {component}: breakdown gave {expected:.17e}, the occupancy entry gave {actual:.17e}",
                case.id
            );
        }
        scored += 1;
    }
    assert!(scored > 0, "no fixture case reached the scorer");
}

fn compare(
    case: &str,
    component: &str,
    expected: f64,
    actual: f64,
    degenerate: bool,
    maximum: &mut (f64, String, String),
) {
    if !degenerate {
        assert!(
            expected.is_finite(),
            "benign fixture case {case} expected non-finite {component}"
        );
        assert!(
            actual.is_finite(),
            "benign fixture case {case} produced non-finite {component}"
        );
    }
    if expected.is_nan() {
        assert!(
            actual.is_nan(),
            "case {case} {component}: expected NaN, got {actual}"
        );
        return;
    }
    if expected.is_infinite() {
        assert_eq!(
            actual, expected,
            "case {case} {component}: infinity classification differs"
        );
        return;
    }
    assert!(
        actual.is_finite(),
        "case {case} {component}: expected finite {expected}, got {actual}"
    );
    let deviation = (expected - actual).abs();
    if deviation > maximum.0 {
        *maximum = (deviation, case.to_string(), component.to_string());
    }
    assert!(
        deviation <= TOLERANCE,
        "case {case} {component}: expected {expected:.17e}, got {actual:.17e}, deviation {deviation:.17e}"
    );
}

fn compare_breakdown(
    case: &FixtureCase,
    actual: ScoreBreakdown,
    maximum: &mut (f64, String, String),
) {
    for (name, expected, actual) in [
        (
            "production",
            case.components.production.value(),
            actual.production,
        ),
        (
            "scarcity",
            case.components.scarcity.value(),
            actual.scarcity,
        ),
        ("robber", case.components.robber.value(), actual.robber),
        (
            "diversity",
            case.components.diversity.value(),
            actual.diversity,
        ),
        ("port", case.components.port.value(), actual.port),
        (
            "handValue",
            case.components.hand_value.value(),
            actual.hand_value,
        ),
    ] {
        compare(&case.id, name, expected, actual, case.degenerate, maximum);
    }
}

fn parse_weights(value: &Value) -> EngineWeights {
    let number = |name| fixture_number(&value[name]);
    let resources = &value["resourceValue"];
    EngineWeights {
        resource_value: ResourceValues {
            wood: fixture_number(&resources["wood"]),
            sheep: fixture_number(&resources["sheep"]),
            wheat: fixture_number(&resources["wheat"]),
            brick: fixture_number(&resources["brick"]),
            ore: fixture_number(&resources["ore"]),
        },
        hand_value_weight: number("handValueWeight"),
        scarcity_weight: number("scarcityWeight"),
        scarcity_clamp_min: number("scarcityClampMin"),
        scarcity_clamp_max: number("scarcityClampMax"),
        diversity_weight: number("diversityWeight"),
        diversity_cap: number("diversityCap"),
        coverage_exponent: number("coverageExponent"),
        coverage_scarcity_weight: number("coverageScarcityWeight"),
        duplicate_number_penalty: number("duplicateNumberPenalty"),
        recipe_road_bonus: number("recipeRoadBonus"),
        recipe_city_bonus: number("recipeCityBonus"),
        recipe_settlement_bonus: number("recipeSettlementBonus"),
        recipe_dev_card_bonus: number("recipeDevCardBonus"),
        recipe_cap: number("recipeCap"),
        port_weight: number("portWeight"),
        generic_port_factor: number("genericPortFactor"),
        port_surplus_threshold: number("portSurplusThreshold"),
        port_coverage_deficit_weight: number("portCoverageDeficitWeight"),
        near_port_radius: number("nearPortRadius"),
        near_port_decay: number("nearPortDecay"),
        robber_discount: number("robberDiscount"),
        opponent_top_k: number("opponentTopK"),
        softmax_temperature: number("softmaxTemperature"),
        rollout_budget: number("rolloutBudget"),
        rollouts_min: number("rolloutsMin"),
        rollouts_max: number("rolloutsMax"),
        max_results: number("maxResults"),
    }
}

fn fixture_number(value: &Value) -> f64 {
    if let Some(value) = value.as_f64() {
        return value;
    }
    match value.as_str() {
        Some("NaN") => f64::NAN,
        Some("Infinity") => f64::INFINITY,
        Some("-Infinity") => f64::NEG_INFINITY,
        _ => panic!("fixture number has unsupported encoding {value}"),
    }
}
