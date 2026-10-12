//! The scorer's entries against each other, on the boards of the analysis corpus.
//!
//! This file once checked the scorer against the TypeScript formula through a fixture the
//! TypeScript wrote. That formula is deleted, and what the scorer returns is pinned by
//! `analysis_parity.rs`. What stays here is every comparison of one Rust path with another.

use std::collections::BTreeSet;

use serde_json::Value;
use unsettled_engine::board::{ConversionOptions, SimBoard};
use unsettled_engine::placement::analysis::weights_for_seats;
use unsettled_engine::placement::app_formula::{
    AppFormulaScorer, EngineWeights, ScoreBreakdown, neutral_slot_scales,
};
use unsettled_engine::rules::RuleConfig;
use unsettled_engine::state::EMPTY;
use unsettled_engine::topology::{Topology, Vertex};
use unsettled_engine::wire::WireBoard;

const TOLERANCE: f64 = 1e-9;

/// A corpus board `SimBoard` accepts, with the weights its case ranks under and its pieces as
/// the owner arrays the scorer reads: each building and road under its player's seat.
struct Case {
    name: String,
    topology: Topology,
    board: SimBoard,
    weights: EngineWeights,
    vertex_owner: Vec<u8>,
    edge_owner: Vec<u8>,
}

/// Every corpus case whose board the simulator can hold. The corpus also carries boards only the
/// analysis accepts (a blank tile, a hex with no number, one player, adjacent buildings), and
/// those are left out here.
fn corpus_cases() -> Vec<Case> {
    let fixture: Value =
        serde_json::from_str(include_str!("../../../fixtures/analysis-parity.json")).unwrap();
    let mut cases = Vec::new();
    for case in fixture["cases"].as_array().unwrap() {
        let request = &case["request"];
        let wire = WireBoard::parse_value(request["board"].clone()).unwrap();
        let topology = Topology::load(wire.layout).unwrap();
        let seat_of = |id: &str| {
            wire.players
                .iter()
                .position(|player| player.id == id)
                .expect("a piece's player is on the board") as u8
        };
        let mut vertex_owner = vec![EMPTY; topology.vertex_count()];
        for building in &wire.buildings {
            let vertex = topology.vertex_by_id(&building.vertex_id).unwrap();
            vertex_owner[usize::from(vertex)] = seat_of(&building.player_id);
        }
        let mut edge_owner = vec![EMPTY; topology.edge_count()];
        for road in &wire.roads {
            let edge = topology.edge_by_id(&road.edge_id).unwrap();
            edge_owner[usize::from(edge)] = seat_of(&road.player_id);
        }
        let weights = match request["options"].get("weights") {
            Some(weights) => serde_json::from_value(weights.clone()).unwrap(),
            None => weights_for_seats(wire.players.len()).clone(),
        };
        let Ok(board) = SimBoard::try_from_wire(
            wire,
            &topology,
            &RuleConfig::base(topology.layout()),
            ConversionOptions {
                allow_unofficial: true,
            },
        ) else {
            continue;
        };
        cases.push(Case {
            name: case["name"].as_str().unwrap().to_owned(),
            topology,
            board,
            weights,
            vertex_owner,
            edge_owner,
        });
    }
    assert!(cases.len() >= 20, "only {} corpus boards convert", cases.len());
    cases
}

/// The scorer's adjacency copy answers exactly what `Topology` answers, on both layouts.
///
/// SP3's expansion walk runs off the copy, not off a topology handle, so a copy that lost an edge
/// or reordered a neighbour list would silently walk a different board and still look plausible.
#[test]
fn the_scorer_adjacency_copy_matches_the_topology_it_was_built_from() {
    let mut layouts = BTreeSet::new();
    for case in corpus_cases() {
        let topology = &case.topology;
        if !layouts.insert(topology.layout().as_str()) {
            continue;
        }
        let scorer = AppFormulaScorer::new(&case.board, topology, case.weights);
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
        "the corpus must cover both layouts"
    );
}

/// The weight vectors every board is scored under: the case's own, then one per term that ships
/// switched off, so the comparison below also runs with that term live.
fn weight_variants(weights: &EngineWeights) -> Vec<(&'static str, EngineWeights)> {
    let own = weights.clone();
    let mut concentrated = weights.clone();
    concentrated.robber_concentration_weight = 3.0;
    let mut witnessed = weights.clone();
    witnessed.port_coverage_deficit_weight = 1.0;
    witnessed.recipe_dev_card_bonus = 2.0;
    witnessed.hand_value_weight = 0.4;
    witnessed.recipe_cap = 3.0;
    let mut closed = weights.clone();
    closed.expansion_weight = 0.0;
    vec![
        ("the case's weights", own),
        ("a live concentration term", concentrated),
        ("live port deficit, dev-card recipe and grant", witnessed),
        ("no expansion term", closed),
    ]
}

/// Expansion is the only component the occupancy moves, for every seat and open vertex of every
/// corpus board.
///
/// The seat's holdings are its own buildings, while every rival building and every road stays
/// where the board put it. That is what SP3's walk reads, and no other component may notice it:
/// each of the others is a function of the seat's own holdings alone, so an occupancy that moved
/// one would mean a term had quietly started reading the rest of the board. The comparison is on
/// raw bits because the two entries run the same arithmetic in the same order: `breakdown` folds
/// the holdings list left to right and the owner walk folds them in ascending vertex order, and
/// the list is built ascending here.
#[test]
fn occupancy_moves_the_expansion_component_and_nothing_else() {
    let mut scored = 0;
    let mut expanded = 0;
    for case in corpus_cases() {
        let topology = &case.topology;
        for (variant, mut weights) in weight_variants(&case.weights) {
            // The slot scale is not occupancy, and the holdings entry has no seat to look one up
            // with, so it is held at 1 here and the two entries are compared on the occupancy
            // alone. `app_formula/behaviour.rs` drives the scales.
            weights.slot_scales = neutral_slot_scales();
            let concentration_weight = weights.robber_concentration_weight;
            let expansion_weight = weights.expansion_weight;
            let scorer = AppFormulaScorer::new(&case.board, topology, weights);
            for seat in 0..case.board.seats() as u8 {
                let holdings: Vec<Vertex> = (0..topology.vertex_count() as Vertex)
                    .filter(|vertex| case.vertex_owner[usize::from(*vertex)] == seat)
                    .collect();
                for candidate in 0..topology.vertex_count() as Vertex {
                    if case.vertex_owner[usize::from(candidate)] != EMPTY {
                        continue;
                    }
                    for receives_grant in [false, true] {
                        let what = format!(
                            "case {} under {variant}, seat {seat}, vertex {candidate}, grant {receives_grant}",
                            case.name
                        );
                        let expected = scorer.breakdown(&holdings, candidate, receives_grant);
                        let actual = scorer.breakdown_for_owner(
                            &case.vertex_owner,
                            &case.edge_owner,
                            seat,
                            candidate,
                            receives_grant,
                        );
                        for (component, expected, actual) in [
                            ("production", expected.production, actual.production),
                            ("scarcity", expected.scarcity, actual.scarcity),
                            ("robber", expected.robber, actual.robber),
                            ("diversity", expected.diversity, actual.diversity),
                            ("port", expected.port, actual.port),
                            ("handValue", expected.hand_value, actual.hand_value),
                            // Zeroing the component rather than subtracting it: `total` folds
                            // expansion last, so subtracting a nonzero one back off is a rounding
                            // step and reads a one-ULP difference where there is none. Zeroed,
                            // the six remaining components fold in the same order as the holdings
                            // entry's.
                            (
                                "total less expansion",
                                expected.total(),
                                ScoreBreakdown {
                                    expansion: 0.0,
                                    ..actual
                                }
                                .total(),
                            ),
                        ] {
                            assert_eq!(
                                expected.to_bits(),
                                actual.to_bits(),
                                "{what} {component}: breakdown gave {expected:.17e}, the occupancy entry gave {actual:.17e}"
                            );
                        }
                        assert_eq!(
                            expected.expansion, 0.0,
                            "{what}: the holdings entry carries no occupancy, so it prices no expansion"
                        );
                        // The fused total is what `score_for_owner` runs in every game, and the
                        // summed breakdown is what the analysis reports, so the two have to be
                        // the same number or the measured formula is not the reported one.
                        //
                        // Bit-exact only while `robberConcentrationWeight` is 0, which is every
                        // shipped run: the breakdown folds the concentration delta into its
                        // `robber` component and sums `(production + scarcity) + (robber +
                        // delta)`, where the fused path adds the delta to the precomputed
                        // `production + scarcity + robber`. Same addends, different association,
                        // so a nonzero delta may leave the two an ulp apart.
                        let fused = scorer.marginal_total_for_owner(
                            &case.vertex_owner,
                            &case.edge_owner,
                            seat,
                            candidate,
                            receives_grant,
                        );
                        let summed = actual.total();
                        let agree = if concentration_weight == 0.0 {
                            fused.to_bits() == summed.to_bits()
                        } else {
                            (fused - summed).abs() <= TOLERANCE * summed.abs().max(1.0)
                        };
                        assert!(
                            agree || (fused.is_nan() && summed.is_nan()),
                            "{what}: the fused total gave {fused:.17e}, the summed breakdown gave {summed:.17e}"
                        );
                        // At a weight of 0 nothing reads the occupancy, so a board full of
                        // pieces scores bit for bit what the holdings alone score.
                        if expansion_weight == 0.0 {
                            assert_eq!(actual.expansion.to_bits(), 0.0_f64.to_bits(), "{what}");
                            assert_eq!(
                                fused.to_bits(),
                                scorer
                                    .marginal_total(&holdings, candidate, receives_grant)
                                    .to_bits(),
                                "{what}: a zero expansion weight moved the total"
                            );
                        }
                        if actual.expansion != 0.0 {
                            expanded += 1;
                        }
                        scored += 1;
                    }
                }
            }
        }
    }
    assert!(scored > 0, "no corpus board reached the scorer");
    assert!(
        expanded > 0,
        "no corpus board moved the expansion component, so the occupancy reaches nothing"
    );
}
