//! The J4 goal-hysteresis margin (SIM-GAP-25): the incumbent goal carried on `GameState`
//! and the swept margin a challenger goal must clear in `heuristic_v1`'s goal chooser.

use std::fs;
use std::path::PathBuf;

use unsettled_engine::board::{ConversionOptions, SimBoard};
use unsettled_engine::game::{GameArena, GameConfig};
use unsettled_engine::policy::PolicyScratch;
use unsettled_engine::policy::heuristic_v1::{self, BuildKind, HeuristicParams};
use unsettled_engine::rng::Xoshiro256StarStar;
use unsettled_engine::rules::{Buildable, RuleConfig};
use unsettled_engine::topology::{Layout, Topology};
use unsettled_engine::view::{DecisionPhase, pips};
use unsettled_engine::wire::WireBoard;

fn fixture() -> (Topology, SimBoard, RuleConfig, GameArena) {
    let topology = Topology::load(Layout::Extension6).unwrap();
    let rules = RuleConfig::base(Layout::Extension6);
    let relative = PathBuf::from("src/parser/__tests__/expected/board-draft-empty.json");
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .map(|root| root.join(&relative))
        .find(|candidate| candidate.is_file())
        .expect("board fixture must be reachable from the worktree or sweep root");
    let wire = WireBoard::parse_str(&fs::read_to_string(path).unwrap()).unwrap();
    let board =
        SimBoard::try_from_wire(wire, &topology, &rules, ConversionOptions::default()).unwrap();
    let mut arena = GameArena::default();
    arena.prepare(&board, &topology, &rules, &GameConfig::default());
    (topology, board, rules, arena)
}

/// A vertex's production pips with the same robber skip `vertex_score` applies.
fn local_production(board: &SimBoard, topology: &Topology, vertex: u8) -> [u16; 5] {
    let mut production = [0_u16; 5];
    for hex in topology.vertex_hexes(vertex) {
        if *hex == board.robber() {
            continue;
        }
        if let (Some(resource), Some(token)) = (
            board.tiles()[usize::from(*hex)],
            board.tokens()[usize::from(*hex)],
        ) {
            production[resource.index()] += u16::from(pips(token));
        }
    }
    production
}

// Forwarded arguments of the J4 hysteresis seam, one observing test each:
// - the incumbent goal (`DecisionView::incumbent_goal`, read by the chooser):
//   the_margin_keeps_the_incumbent_within_the_gap_and_switches_past_it (City incumbent on
//   both sides of the computed gap), an_incumbent_without_a_legal_candidate_boosts_nothing
//   (Road incumbent with no road pieces)
// - `params.goal_hysteresis_margin`: the same test (margins at half and double the
//   closed-form score gap), a_zero_margin_never_reads_the_incumbent (0.0 with an incumbent
//   set), and the_hysteresis_labels_select_their_trial_margins in `policy::mod` (the trial
//   labels)
// - the engine write at the action site (`GameArena::ask_action` -> `PlayerState`):
//   the_action_decision_records_the_incumbent
// - the engine write at the pre-roll site, and the reset in `GameArena::prepare` (a fresh
//   `GameState`): the_pre_roll_decision_records_the_incumbent_and_prepare_resets_it

/// The chooser fixture, adapted from the J3 slot-return chooser probe: the observer owns a
/// weak productive tier-1 vertex (the city candidate) and one detached edge whose endpoints
/// are strong legal settlement targets, holds the settlement and city costs at once (both
/// goals floor at 0.25 turns), and has no road pieces (no road goal). The baseline chooser
/// picks the settlement; City is the runner-up at a closed-form score gap.
fn chooser_fixture() -> (Topology, SimBoard, GameArena) {
    let (topology, board, _rules, mut arena) = fixture();
    let placement = (0..topology.vertex_count() as u8)
        .filter(|vertex| {
            let total: u16 = local_production(&board, &topology, *vertex).iter().sum();
            (1..=4).contains(&total)
        })
        .find_map(|owned| {
            (0..topology.edge_count() as u8).find_map(|edge| {
                let [first, second] = topology.edge_endpoints(edge);
                let strong = |vertex: u8| {
                    vertex != owned
                        && !topology.vertex_adjacent(vertex).contains(&owned)
                        && local_production(&board, &topology, vertex)
                            .iter()
                            .sum::<u16>()
                            > local_production(&board, &topology, owned)
                                .iter()
                                .sum::<u16>()
                                + 5
                };
                (strong(first) && strong(second)).then_some((owned, edge))
            })
        });
    let (owned, edge) = placement.expect("fixture board offers a qualifying placement");
    arena.state.vertex_owner[usize::from(owned)] = 0;
    arena.state.vertex_tier[usize::from(owned)] = 1;
    arena.state.edge_owner[usize::from(edge)] = 0;
    arena.state.players[0].pieces[Buildable::Road.index()] = 0;
    arena.state.players[0].resources = [1, 1, 3, 1, 3];
    (topology, board, arena)
}

fn goal_for(
    arena: &GameArena,
    board: &SimBoard,
    topology: &Topology,
    margin: f32,
) -> Option<Buildable> {
    let view = arena.decision_view(board, topology, 0, DecisionPhase::Action);
    let params = HeuristicParams {
        goal_hysteresis_margin: margin,
        ..HeuristicParams::default()
    };
    let mut scratch = PolicyScratch::default();
    let mut rng = Xoshiro256StarStar::from_seed(7);
    heuristic_v1::action(&view, &mut scratch, &params, &mut rng);
    scratch.goal
}

/// The closed-form gap between the settlement goal and the city goal in the chooser
/// fixture: both goals are affordable, so each scores `(1 + vertex_term / 20) / 0.25`.
fn goal_score_gap(arena: &GameArena, board: &SimBoard, topology: &Topology) -> f32 {
    let view = arena.decision_view(board, topology, 0, DecisionPhase::Action);
    let params = HeuristicParams::default();
    let city_term = (0..topology.vertex_count() as u8)
        .filter(|vertex| view.legal_city(*vertex))
        .map(|vertex| heuristic_v1::vertex_score(&view, vertex, &params, BuildKind::City))
        .fold(f32::NEG_INFINITY, f32::max);
    let settlement_term = (0..topology.vertex_count() as u8)
        .filter(|vertex| view.legal_settlement(*vertex))
        .map(|vertex| heuristic_v1::vertex_score(&view, vertex, &params, BuildKind::Settlement))
        .fold(f32::NEG_INFINITY, f32::max);
    assert!(city_term.is_finite() && settlement_term.is_finite());
    (1.0 + settlement_term / 20.0) / 0.25 - (1.0 + city_term / 20.0) / 0.25
}

#[test]
fn the_margin_keeps_the_incumbent_within_the_gap_and_switches_past_it() {
    let (topology, board, mut arena) = chooser_fixture();
    let gap = goal_score_gap(&arena, &board, &topology);
    assert!(
        gap > 0.01,
        "the settlement goal must outscore the city goal by a usable gap, got {gap}"
    );
    assert_eq!(goal_for(&arena, &board, &topology, 0.0), Some(Buildable::Settlement));
    arena.state.players[0].incumbent_goal = Some(Buildable::City);
    // A margin wider than the gap keeps the incumbent; a narrower one lets the challenger
    // through. The boost is selection-only, so the same true scores decide both.
    assert_eq!(
        goal_for(&arena, &board, &topology, gap * 2.0),
        Some(Buildable::City)
    );
    assert_eq!(
        goal_for(&arena, &board, &topology, gap * 0.5),
        Some(Buildable::Settlement)
    );
}

#[test]
fn a_zero_margin_never_reads_the_incumbent() {
    let (topology, board, mut arena) = chooser_fixture();
    let scored = |arena: &GameArena| {
        let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
        let mut scratch = PolicyScratch::default();
        let mut rng = Xoshiro256StarStar::from_seed(7);
        heuristic_v1::action(&view, &mut scratch, &HeuristicParams::default(), &mut rng);
        let scores: Vec<(_, u32)> = scratch
            .actions
            .as_slice()
            .iter()
            .map(|candidate| (candidate.action, candidate.score.to_bits()))
            .collect();
        (scratch.goal, scores)
    };
    let baseline = scored(&arena);
    assert_eq!(baseline.0, Some(Buildable::Settlement));
    // An incumbent that a non-zero margin would keep (see the test above) changes nothing
    // at the zero default: same goal, bit-identical candidate scores.
    arena.state.players[0].incumbent_goal = Some(Buildable::City);
    assert_eq!(scored(&arena), baseline);
}

#[test]
fn an_incumbent_without_a_legal_candidate_boosts_nothing() {
    let (topology, board, mut arena) = chooser_fixture();
    // The fixture has no road pieces, so a stale Road incumbent has no candidate to boost
    // and the chooser falls back to the plain argmax at any margin.
    arena.state.players[0].incumbent_goal = Some(Buildable::Road);
    assert_eq!(
        goal_for(&arena, &board, &topology, 1.0e6),
        Some(Buildable::Settlement)
    );
}

#[test]
fn the_action_decision_records_the_incumbent() {
    let (topology, board, mut arena) = chooser_fixture();
    let config = GameConfig::default();
    assert_eq!(arena.state.players[0].incumbent_goal, None);
    let expected = {
        let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
        let mut scratch = PolicyScratch::default();
        let mut rng = Xoshiro256StarStar::from_seed(7);
        heuristic_v1::action(&view, &mut scratch, &HeuristicParams::default(), &mut rng);
        scratch.goal
    };
    assert_eq!(expected, Some(Buildable::Settlement));
    // Asking for the decision (without applying it) must persist the chosen goal.
    let _ = arena.ask_action_for_test(&board, &topology, &config, 0, DecisionPhase::Action);
    assert_eq!(arena.state.players[0].incumbent_goal, expected);
}

#[test]
fn the_pre_roll_decision_records_the_incumbent_and_prepare_resets_it() {
    let (topology, board, rules, mut arena) = fixture();
    let config = GameConfig::default();
    arena.setup_for_test(&board, &topology, &rules, &config);
    for seat in 0..board.seats() {
        assert_eq!(arena.state.players[seat].incumbent_goal, None);
    }
    let won = arena.begin_turn_for_test(&board, &topology, &rules, &config, 0);
    assert!(!won);
    // The freshly-set-up seat holds no dev cards, so the pre-roll decision mutated nothing
    // but the incumbent record and a recompute on the same state must agree with it.
    let expected = {
        let view = arena.decision_view(&board, &topology, 0, DecisionPhase::PreRoll);
        let mut scratch = PolicyScratch::default();
        heuristic_v1::pre_roll(&view, &mut scratch, &HeuristicParams::default());
        scratch.goal
    };
    assert!(expected.is_some(), "a drafted seat must have a goal");
    assert_eq!(arena.state.players[0].incumbent_goal, expected);
    arena.prepare(&board, &topology, &rules, &config);
    assert_eq!(arena.state.players[0].incumbent_goal, None);
}
