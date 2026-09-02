use std::collections::BTreeSet;

use serde::Deserialize;
use serde_json::Value;
use unsettled_engine::board::{ConversionError, ConversionOptions, SimBoard};
use unsettled_engine::placement::app_formula::{
    AppFormulaScorer, EngineWeights, ResourceValues, ScoreBreakdown, SlotScale, SlotScales,
    neutral_slot_scales,
};
use unsettled_engine::rules::RuleConfig;
use unsettled_engine::state::EMPTY;
use unsettled_engine::topology::{Topology, Vertex};
use unsettled_engine::wire::WireBoard;

const TOLERANCE: f64 = 1e-9;
const REQUIRED_CLASSES: [&str; 43] = [
    "W1", "W2", "W3", "W4", "W5", "W6", "W7", "W8", "W9", "W10", "W11", "W12", "W13", "W14", "W15",
    "B1", "B2", "B3", "B4", "B5", "B6", "B7", "B8", "B9", "B10", "B11", "P1", "P2", "P3", "P4",
    "P5", "H1", "H2", "H3", "H4", "F1", "F2", "G1", "G2", "G3", "G4", "G5", "G6",
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
    /// The draft slot the TypeScript side scored the case at, or `None` for an unscaled score.
    slot: Option<FixtureSlot>,
    components: FixtureBreakdown,
    marginal_total: FixtureNumber,
    breakdown_total: FixtureNumber,
    ingestion: Ingestion,
    degenerate: bool,
}

#[derive(Clone, Copy, Deserialize)]
struct FixtureSlot {
    seats: usize,
    slot: u8,
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
    expansion: FixtureNumber,
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

/// The owner arrays a fixture case's board stands for, and the seat whose holdings it lists.
struct CaseOccupancy {
    vertex_owner: Vec<u8>,
    edge_owner: Vec<u8>,
    seat: u8,
}

/// A case's occupancy, built from the ingested board's own buildings and roads.
///
/// The seat is the owner of the case's first holding, so that player's roads on the board are the
/// seat's own roads and SP3's expansion walk starts from real stubs; a case with no holdings, or
/// whose first holding sits on an empty vertex, gets a fresh seat past every player on the board.
/// Either way the case's `holdings` list is the seat's whole holding, so any *other* building the
/// board records for that player goes to a spare seat: it stays occupied, exactly as the
/// TypeScript side's `occupancyFromBoard` leaves it, without joining the holdings the case pins.
/// `generate-placement-parity.ts::scoreCase` carries the same rule.
fn case_occupancy(wire: &WireBoard, topology: &Topology, holdings: &[Vertex]) -> CaseOccupancy {
    let owner_of = |id: &str| {
        let index = wire
            .players
            .iter()
            .position(|player| player.id == id)
            .expect("a piece's player is on the board");
        u8::try_from(index).expect("board player count fits a seat index")
    };
    let fresh = u8::try_from(wire.players.len()).expect("board player count fits a seat index");
    let spare = fresh + 1;
    let mut vertex_owner = vec![EMPTY; topology.vertex_count()];
    let mut edge_owner = vec![EMPTY; topology.edge_count()];
    for building in &wire.buildings {
        let vertex = topology
            .vertex_by_id(&building.vertex_id)
            .expect("fixture vertex");
        vertex_owner[usize::from(vertex)] = owner_of(&building.player_id);
    }
    for road in &wire.roads {
        let edge = topology.edge_by_id(&road.edge_id).expect("fixture edge");
        edge_owner[usize::from(edge)] = owner_of(&road.player_id);
    }
    let seat = holdings
        .first()
        .map(|vertex| vertex_owner[usize::from(*vertex)])
        .filter(|owner| *owner != EMPTY)
        .unwrap_or(fresh);
    for owner in vertex_owner.iter_mut() {
        if *owner == seat {
            *owner = spare;
        }
    }
    for vertex in holdings {
        vertex_owner[usize::from(*vertex)] = seat;
    }
    CaseOccupancy {
        vertex_owner,
        edge_owner,
        seat,
    }
}

/// Every number the TypeScript scorer wrote into the fixture, read back out of the Rust scorer.
///
/// Both totals come from the occupancy-aware entries, because SP3's expansion component reads the
/// board around the candidate and the holdings entries price none of it. `breakdownTotal` sums
/// `breakdown_for_owner`'s components and `marginalTotal` comes from `marginal_total_for_owner`,
/// the fused path, so the fixture pins the two code paths separately, exactly as it does on the
/// TypeScript side.
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
        let holdings = case
            .holdings
            .iter()
            .map(|vertex| topology.vertex_by_id(vertex).unwrap())
            .collect::<Vec<_>>();
        let occupancy = case_occupancy(&wire, &topology, &holdings);
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
                // The Rust entries key SP4's scales off the seat they are already given and the
                // board's own seat count, where the TypeScript ones are handed the slot. Nothing
                // else ties the two readings together, so a case that names a slot pins them as
                // the same pair, and a case that names none pins its derived pair as unscaled.
                match case.slot {
                    Some(slot) => {
                        assert_eq!(
                            (board.seats(), occupancy.seat),
                            (slot.seats, slot.slot),
                            "case {} was scored at a different slot on each side",
                            case.id
                        );
                    }
                    None => assert_eq!(
                        scorer.slot_scale(occupancy.seat),
                        SlotScale::NEUTRAL,
                        "case {} names no slot, so its derived slot must scale nothing",
                        case.id
                    ),
                }
                let candidate = topology.vertex_by_id(&case.candidate).unwrap();
                let actual = scorer.breakdown_for_owner(
                    &occupancy.vertex_owner,
                    &occupancy.edge_owner,
                    occupancy.seat,
                    candidate,
                    case.receives_grant,
                );
                compare_breakdown(&case, actual, &mut maximum);
                compare(
                    &case.id,
                    "marginalTotal",
                    case.marginal_total.value(),
                    scorer.marginal_total_for_owner(
                        &occupancy.vertex_owner,
                        &occupancy.edge_owner,
                        occupancy.seat,
                        candidate,
                        case.receives_grant,
                    ),
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
            // The walk steps by `(edge, vertex)` pairs, so the pairing is what has to match, not
            // just the two lists side by side: a copy that kept the right edges against the wrong
            // neighbours would walk the board along edges that do not join what it thinks.
            let steps: Vec<(u8, u8)> = scorer.steps(vertex).collect();
            let expected: Vec<(u8, u8)> = topology
                .vertex_adjacent(vertex)
                .iter()
                .map(|neighbour| {
                    (
                        topology
                            .edge_between(vertex, *neighbour)
                            .expect("adjacent vertices share an edge"),
                        *neighbour,
                    )
                })
                .collect();
            assert_eq!(steps, expected, "vertex {index} steps");
        }
    }
    assert_eq!(
        layouts,
        ["extension6", "standard4"].into_iter().collect(),
        "the fixture must cover both layouts"
    );
}

/// Expansion is the only component the occupancy moves, on every fixture case.
///
/// Owner arrays come from `case_occupancy`, so the seat holds exactly the case's `holdings` list
/// while every rival building and every road stays where the board put it. That is what SP3's walk
/// reads, and no other component may notice it: each of the others is a function of the seat's own
/// holdings alone, so an occupancy that moved one would mean a term had quietly started reading the
/// rest of the board. The comparison is on raw bits rather than the fixture's tolerance because
/// the two entries run the same arithmetic in the same order: `breakdown` folds the holdings list
/// left to right and the owner walk folds them in ascending vertex order, which the assertion
/// below pins as the same sequence.
#[test]
fn occupancy_moves_the_expansion_component_and_nothing_else() {
    let fixture: FixturePack =
        serde_json::from_str(include_str!("../../../fixtures/placement-parity.json")).unwrap();
    let mut scored = 0;
    let mut expanded = 0;
    for case in fixture.cases {
        if matches!(case.ingestion, Ingestion::Reject { .. }) {
            continue;
        }
        let wire = WireBoard::parse_value(case.board.clone()).unwrap();
        let topology = Topology::load(wire.layout).unwrap();
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
        let occupancy = case_occupancy(&wire, &topology, &holdings);
        let board = SimBoard::try_from_wire(
            wire,
            &topology,
            &RuleConfig::base(topology.layout()),
            ConversionOptions {
                allow_unofficial: true,
            },
        )
        .expect("fixture expected successful conversion");
        // The slot scale is not occupancy, and the holdings entry has no seat to look one up
        // with, so it is held at 1 here and the two entries are compared on the occupancy alone.
        // The main parity test above drives the case's own scales.
        let mut weights = parse_weights(&case.weights);
        weights.slot_scales = neutral_slot_scales();
        let concentration_weight = weights.robber_concentration_weight;
        let scorer = AppFormulaScorer::new(&board, &topology, weights);

        let candidate = topology.vertex_by_id(&case.candidate).unwrap();
        let expected = scorer.breakdown(&holdings, candidate, case.receives_grant);
        let actual = scorer.breakdown_for_owner(
            &occupancy.vertex_owner,
            &occupancy.edge_owner,
            occupancy.seat,
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
            (
                "total less expansion",
                expected.total(),
                actual.total() - actual.expansion,
            ),
        ] {
            assert_eq!(
                expected.to_bits(),
                actual.to_bits(),
                "case {} {component}: breakdown gave {expected:.17e}, the occupancy entry gave {actual:.17e}",
                case.id
            );
        }
        assert_eq!(
            expected.expansion, 0.0,
            "case {}: the holdings entry carries no occupancy, so it prices no expansion",
            case.id
        );
        // The fused total is what `score_for_owner` runs in every game, and the summed breakdown is
        // what the fixture's `breakdownTotal` pins, so the two have to be the same number or the
        // measured formula is not the reported one.
        //
        // Bit-exact only while `robberConcentrationWeight` is 0, which is every shipped run: the
        // breakdown folds the concentration delta into its `robber` component and sums
        // `(production + scarcity) + (robber + delta)`, where the fused path adds the delta to the
        // precomputed `production + scarcity + robber`. Same addends, different association, so a
        // nonzero delta may leave the two an ulp apart. `valuation.ts` groups them the same two
        // ways, so the languages stay in step either way.
        let fused = scorer.marginal_total_for_owner(
            &occupancy.vertex_owner,
            &occupancy.edge_owner,
            occupancy.seat,
            candidate,
            case.receives_grant,
        );
        let summed = actual.total();
        let agree = if concentration_weight == 0.0 {
            fused.to_bits() == summed.to_bits()
        } else {
            (fused - summed).abs() <= TOLERANCE * summed.abs().max(1.0)
        };
        assert!(
            agree || (fused.is_nan() && summed.is_nan()),
            "case {}: the fused total gave {fused:.17e}, the summed breakdown gave {summed:.17e}",
            case.id
        );
        if actual.expansion != 0.0 {
            expanded += 1;
        }
        scored += 1;
    }
    assert!(scored > 0, "no fixture case reached the scorer");
    assert!(
        expanded > 0,
        "no fixture case moved the expansion component, so the occupancy reaches nothing"
    );
}

/// Both branches of the seat rule, on the two fixture cases that exercise them.
///
/// `real-endgame-pieces` lists holdings on a board whose pieces are already placed, and its first
/// holding belongs to a player holding three more buildings and a stack of roads: the seat has to
/// be that player, so its roads are its own, while its three other buildings stay occupied under
/// the spare seat instead of joining the holdings. `all-resources-held` holds vertices on a bare
/// board, where no player owns anything, so the seat is the fresh index.
#[test]
fn the_case_seat_is_the_owner_of_the_first_holding_and_owns_only_the_listed_holdings() {
    let fixture: FixturePack =
        serde_json::from_str(include_str!("../../../fixtures/placement-parity.json")).unwrap();
    let mut seen = BTreeSet::new();
    for case in fixture.cases {
        if !matches!(case.id.as_str(), "real-endgame-pieces" | "all-resources-held") {
            continue;
        }
        seen.insert(case.id.clone());
        let wire = WireBoard::parse_value(case.board.clone()).unwrap();
        let topology = Topology::load(wire.layout).unwrap();
        let players = wire.players.len();
        let buildings = wire.buildings.len();
        let roads = wire.roads.len();
        let holdings: Vec<_> = case
            .holdings
            .iter()
            .map(|vertex| topology.vertex_by_id(vertex).unwrap())
            .collect();
        let occupancy = case_occupancy(&wire, &topology, &holdings);

        let owned: Vec<_> = occupancy
            .vertex_owner
            .iter()
            .enumerate()
            .filter_map(|(vertex, owner)| (*owner == occupancy.seat).then_some(vertex as Vertex))
            .collect();
        assert_eq!(owned, holdings, "case {} seat holdings", case.id);
        let occupied = occupancy
            .vertex_owner
            .iter()
            .filter(|owner| **owner != EMPTY)
            .count();
        let held_and_placed = holdings
            .iter()
            .filter(|vertex| {
                wire.buildings.iter().any(|building| {
                    topology.vertex_by_id(&building.vertex_id) == Some(**vertex)
                })
            })
            .count();
        assert_eq!(
            occupied,
            buildings + holdings.len() - held_and_placed,
            "case {}: every board building stays occupied and each holding is occupied once",
            case.id
        );
        assert_eq!(
            occupancy
                .edge_owner
                .iter()
                .filter(|owner| **owner != EMPTY)
                .count(),
            roads,
            "case {} roads",
            case.id
        );

        if case.id == "all-resources-held" {
            assert_eq!(buildings, 0, "the bare-board case must carry no buildings");
            assert_eq!(
                occupancy.seat,
                u8::try_from(players).unwrap(),
                "an unowned first holding takes the fresh seat"
            );
        } else {
            let first = wire
                .buildings
                .iter()
                .find(|building| {
                    topology.vertex_by_id(&building.vertex_id) == Some(holdings[0])
                })
                .expect("the endgame case's first holding carries a building");
            let expected = wire
                .players
                .iter()
                .position(|player| player.id == first.player_id)
                .unwrap();
            assert_eq!(
                occupancy.seat,
                u8::try_from(expected).unwrap(),
                "an owned first holding takes its owner's seat"
            );
            assert!(
                occupancy
                    .edge_owner
                    .iter()
                    .any(|owner| *owner == occupancy.seat),
                "the seat keeps the roads that player laid"
            );
        }
    }
    assert_eq!(
        seen,
        ["all-resources-held", "real-endgame-pieces"]
            .into_iter()
            .map(String::from)
            .collect(),
        "both seat-rule cases must be in the fixture"
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
        (
            "expansion",
            case.components.expansion.value(),
            actual.expansion,
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
        expansion_weight: number("expansionWeight"),
        expansion_decay: number("expansionDecay"),
        robber_discount: number("robberDiscount"),
        robber_concentration_weight: number("robberConcentrationWeight"),
        setup_denial_weight: number("setupDenialWeight"),
        opponent_top_k: number("opponentTopK"),
        softmax_temperature: number("softmaxTemperature"),
        rollout_budget: number("rolloutBudget"),
        rollouts_min: number("rolloutsMin"),
        rollouts_max: number("rolloutsMax"),
        max_results: number("maxResults"),
        slot_scales: parse_slot_scales(&value["slotScales"]),
    }
}

fn parse_slot_scales(value: &Value) -> SlotScales {
    let mut scales = SlotScales::new();
    for (seats, row) in value.as_object().expect("slotScales is an object") {
        let mut parsed = std::collections::BTreeMap::new();
        for (slot, scale) in row.as_object().expect("a slotScales row is an object") {
            parsed.insert(
                slot.clone(),
                SlotScale {
                    expansion: fixture_number(&scale["expansion"]),
                    diversity: fixture_number(&scale["diversity"]),
                },
            );
        }
        scales.insert(seats.clone(), parsed);
    }
    scales
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
