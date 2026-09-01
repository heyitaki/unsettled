use std::collections::BTreeSet;

use serde::Deserialize;
use serde_json::Value;
use unsettled_engine::board::{ConversionError, ConversionOptions, SimBoard};
use unsettled_engine::placement::app_formula::{
    AppFormulaScorer, EngineWeights, ResourceValues, ScoreBreakdown,
};
use unsettled_engine::rules::RuleConfig;
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
