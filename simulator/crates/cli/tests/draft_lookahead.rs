//! SP5's draft-aware placement kind: the opponent model must reproduce the field, the second pick
//! must stay the plain formula argmax, and M-61's accuracy statistic must count both.
//!
//! The boards and seeds are the `tuning` domain's own, so the games the model is held against are
//! games the measurement runs would actually play, not a hand-built arrangement chosen to suit it.
//! The one exception is the statistic's arithmetic, which is pinned against a trace built by hand
//! so a deliberate mismatch can be put in a known position.

use unsettled_engine::board::SimBoard;
use unsettled_engine::game::{GameArena, GameConfig, SetupPick, can_place_settlement, setup_order};
use unsettled_engine::placement::app_formula::EngineWeights;
use unsettled_engine::placement::{
    PlacementKind, choose, prepare_app_formula_boards, production_pips, register_app_formula,
    register_app_formula_draft, setup_candidate_score, setup_lookahead_plan,
};
use unsettled_engine::rng::{Xoshiro256StarStar, derive_evaluation_seed, mix64};
use unsettled_engine::rules::RuleConfig;
use unsettled_engine::state::EMPTY;
use unsettled_engine::topology::{Layout, Topology, Vertex};
use unsettled_sim::boardgen::generate_board;
use unsettled_sim::evaluate::TUNING_SEED;
use unsettled_sim::lookahead::{game_lookahead, lookahead_accuracy};

const SEATS: usize = 4;
/// Traced games the opponent-model test wants, and how many boards it may look at to find them.
const TIE_FREE_GAMES: usize = 10;
const BOARD_LIMIT: u64 = 60;

fn default_weights() -> EngineWeights {
    serde_json::from_str(include_str!("../../../placement/default-weights.json"))
        .expect("committed weights")
}

/// The field formula and a draft kind whose hero and opponent are both that same formula, which
/// is the pairing M-59 measures: only the lookahead differs between the two.
fn kinds(label: &str) -> (PlacementKind, PlacementKind) {
    let field = register_app_formula(format!("app_formula:{label}-field"), default_weights())
        .expect("registry has room");
    let draft = register_app_formula_draft(
        format!("app_formula_draft:{label}-hero@{label}-opponent"),
        default_weights(),
        default_weights(),
    )
    .expect("registry has room");
    (field, draft)
}

/// `kinds` with the expansion walk off on both sides, for the one test below that rebuilds the
/// replay by hand. The walk is the only component that reads the board past the scoring seat's
/// own holdings, and a rebuild cannot see the setup roads `Lookahead::replay` lays for the hero
/// and for each intervening rival. Zeroed, the rebuild is exact. The shipped weight is 0.1 since
/// M-66 adopted it, so this is a deliberately zeroed vector rather than the field.
fn kinds_without_expansion(label: &str) -> (PlacementKind, PlacementKind, EngineWeights) {
    let mut weights = default_weights();
    weights.expansion_weight = 0.0;
    let field = register_app_formula(format!("app_formula:{label}-field"), weights.clone())
        .expect("registry has room");
    let draft = register_app_formula_draft(
        format!("app_formula_draft:{label}-hero@{label}-opponent"),
        weights.clone(),
        weights.clone(),
    )
    .expect("registry has room");
    (field, draft, weights)
}

fn prepared_board(board_index: u64, kinds: &[PlacementKind]) -> (Topology, SimBoard) {
    let topology = Topology::load(Layout::Standard4).expect("committed topology");
    let mut board = generate_board(Layout::Standard4, SEATS, mix64(TUNING_SEED ^ board_index))
        .expect("standard4 board");
    prepare_app_formula_boards(std::slice::from_mut(&mut board), &topology, kinds);
    (topology, board)
}

fn traced_game(
    topology: &Topology,
    board: &SimBoard,
    field: PlacementKind,
    board_index: u64,
) -> Vec<SetupPick> {
    let mut config = GameConfig::default();
    for seat in 0..SEATS {
        config.placements[seat] = field;
    }
    config.seed = derive_evaluation_seed(TUNING_SEED, board_index, 0, 0);
    let rules = RuleConfig::base(Layout::Standard4);
    let mut arena = GameArena::default();
    let mut trace = Vec::new();
    arena.play_traced(board, topology, &rules, &config, &mut trace);
    trace
}

/// The owner arrays as they stood before each pick in the trace, or `None` when any pick in the
/// game was a tie.
///
/// A tie is where the field's random tie-break decides and the lookahead's lowest-index rule
/// decides differently, so a game holding one says nothing about whether the opponent model
/// matches the field. Re-scoring every legal candidate at every pick is what finds them.
fn tie_free_states(
    topology: &Topology,
    board: &SimBoard,
    field: PlacementKind,
    trace: &[SetupPick],
) -> Option<Vec<(Vec<u8>, Vec<u8>)>> {
    let mut vertex_owner = vec![EMPTY; topology.vertex_count()];
    let mut edge_owner = vec![EMPTY; topology.edge_count()];
    let mut states = Vec::with_capacity(trace.len());
    for pick in trace {
        let mut best = f64::NEG_INFINITY;
        let mut ties = 0;
        for vertex_index in 0..topology.vertex_count() {
            let vertex = vertex_index as Vertex;
            if !can_place_settlement(topology, &vertex_owner, vertex) {
                continue;
            }
            let score = setup_candidate_score(
                field,
                board,
                topology,
                &vertex_owner,
                &edge_owner,
                pick.seat,
                vertex,
                pick.grant,
            );
            if score > best {
                best = score;
                ties = 1;
            } else if score == best {
                ties += 1;
            }
        }
        if ties != 1 {
            return None;
        }
        states.push((vertex_owner.clone(), edge_owner.clone()));
        vertex_owner[usize::from(pick.vertex)] = pick.seat;
        edge_owner[usize::from(pick.edge)] = pick.seat;
    }
    Some(states)
}

/// Every tie-free traced game the first `BOARD_LIMIT` tuning boards yield, with its board.
fn tie_free_games(
    field: PlacementKind,
    drafts: &[PlacementKind],
) -> Vec<(Topology, SimBoard, Vec<SetupPick>, Vec<(Vec<u8>, Vec<u8>)>)> {
    let mut prepared = vec![field];
    prepared.extend_from_slice(drafts);
    let mut games = Vec::new();
    for board_index in 0..BOARD_LIMIT {
        if games.len() == TIE_FREE_GAMES {
            break;
        }
        let (topology, board) = prepared_board(board_index, &prepared);
        let trace = traced_game(&topology, &board, field, board_index);
        if trace.len() != 2 * SEATS {
            continue;
        }
        let Some(states) = tie_free_states(&topology, &board, field, &trace) else {
            continue;
        };
        games.push((topology, board, trace, states));
    }
    assert_eq!(
        games.len(),
        TIE_FREE_GAMES,
        "the first {BOARD_LIMIT} tuning boards must yield {TIE_FREE_GAMES} tie-free games"
    );
    games
}

/// `SIM-GAP-20`'s closing condition: the lookahead's model of the picks between the hero's two
/// settlements is the field, exactly, not an approximation of it.
#[test]
fn the_lookahead_predicts_the_picks_the_field_actually_made() {
    let (field, draft) = kinds("replay");
    let order = setup_order(SEATS);
    let mut checked = 0;
    for (topology, board, trace, states) in tie_free_games(field, &[draft]) {
        for hero in 0..SEATS as u8 {
            let first = order
                .iter()
                .position(|seat| *seat == hero)
                .expect("every seat picks");
            let last = order
                .iter()
                .rposition(|seat| *seat == hero)
                .expect("every seat picks twice");
            let (vertex_owner, edge_owner) = &states[first];
            let predicted = setup_lookahead_plan(
                draft,
                &board,
                &topology,
                vertex_owner,
                edge_owner,
                hero,
                trace[first].vertex,
            )
            .expect("a draft kind always has a formula to replay with")
            .picks;
            let played: Vec<(u8, Vertex)> = trace[first + 1..last]
                .iter()
                .map(|pick| (pick.seat, pick.vertex))
                .collect();
            assert_eq!(predicted, played, "hero seat {hero}");
            checked += 1;
        }
    }
    assert_eq!(checked, TIE_FREE_GAMES * SEATS);
}

/// Nothing the hero cares about follows its second settlement, so the lookahead has nothing to
/// look ahead over and the pick is the plain formula argmax the field would have taken.
#[test]
fn the_second_pick_is_the_plain_formula_argmax() {
    let (field, draft) = kinds("second");
    let order = setup_order(SEATS);
    let mut checked = 0;
    for (topology, board, trace, states) in tie_free_games(field, &[draft]) {
        for hero in 0..SEATS as u8 {
            let last = order
                .iter()
                .rposition(|seat| *seat == hero)
                .expect("every seat picks twice");
            let (vertex_owner, edge_owner) = &states[last];
            let production = production_pips(&board, &topology, vertex_owner, None, hero);
            let mut rng = Xoshiro256StarStar::from_seed(1);
            let (vertex, edge) = choose(
                draft,
                &board,
                &topology,
                vertex_owner,
                edge_owner,
                hero,
                &production,
                true,
                &mut rng,
            )
            .expect("a second settlement is always legal at four seats");
            // The game was screened tie-free, so the field's recorded pick is the argmax itself.
            assert_eq!(vertex, trace[last].vertex, "hero seat {hero}");
            assert!(
                topology.vertex_edges(vertex).contains(&edge),
                "the setup road must touch the settlement"
            );
            checked += 1;
        }
    }
    assert_eq!(checked, TIE_FREE_GAMES * SEATS);
}

/// The lookahead never prunes, so its cost is a fact worth pinning: seat 0 on an empty board is
/// the worst case, with six intervening picks between the hero's two settlements.
///
/// Release only, because the budget is a release budget. The fastest of three boards is what the
/// assertion reads: a loaded machine inflates any single timing, and this test is here to catch a
/// change of algorithm, not a busy laptop.
#[cfg(not(debug_assertions))]
#[test]
fn a_standard4_first_pick_stays_within_its_budget() {
    let (field, draft) = kinds("budget");
    let mut fastest = f64::INFINITY;
    for board_index in 0..3 {
        let (topology, board) = prepared_board(board_index, &[field, draft]);
        let vertex_owner = vec![EMPTY; topology.vertex_count()];
        let edge_owner = vec![EMPTY; topology.edge_count()];
        let production = production_pips(&board, &topology, &vertex_owner, None, 0);
        let mut rng = Xoshiro256StarStar::from_seed(1);
        let started = std::time::Instant::now();
        let pick = choose(
            draft,
            &board,
            &topology,
            &vertex_owner,
            &edge_owner,
            0,
            &production,
            false,
            &mut rng,
        );
        let elapsed = started.elapsed().as_secs_f64() * 1000.0;
        assert!(pick.is_some());
        fastest = fastest.min(elapsed);
    }
    assert!(
        fastest < 50.0,
        "a standard4 first pick took {fastest:.1}ms, over the 50ms budget"
    );
}

/// The shipped `setupDenialWeight` of 0 leaves the lookahead ranking exactly what it ranked before
/// the credit existed: a candidate is worth its own marginal plus the best second settlement that
/// survives the replay, and nothing else is added.
///
/// The comparison is rebuilt here from the field formula and the replayed picks rather than read
/// from a remembered number, so it holds whatever these boards happen to score. A second kind at a
/// weight of 1 is registered to show the pin bites: a credit that is switched on has to move the
/// value the pin says is untouched at 0.
#[test]
fn the_shipped_weight_adds_no_denial_credit() {
    let (field, draft, weights) = kinds_without_expansion("denial");
    let mut hero = weights.clone();
    hero.setup_denial_weight = 1.0;
    let credited = register_app_formula_draft(
        "app_formula_draft:denial-credited@denial-opponent".to_string(),
        hero,
        weights,
    )
    .expect("registry has room");
    let order = setup_order(SEATS);
    let mut checked = 0;
    let mut moved = 0;
    for (topology, board, trace, states) in tie_free_games(field, &[draft, credited]) {
        for hero in 0..SEATS as u8 {
            let first = order
                .iter()
                .position(|seat| *seat == hero)
                .expect("every seat picks");
            let (vertex_owner, edge_owner) = &states[first];
            let candidate = trace[first].vertex;

            // The replayed board carries no roads, which the second settlement's score cannot
            // tell: only the `expansion` component reads edges, and these kinds run with it
            // zeroed for exactly that reason. See `kinds_without_expansion`.
            let mut replayed = vertex_owner.clone();
            replayed[usize::from(candidate)] = hero;
            for (seat, vertex) in setup_lookahead_plan(
                draft,
                &board,
                &topology,
                vertex_owner,
                edge_owner,
                hero,
                candidate,
            )
            .expect("a draft kind always has a formula to replay with")
            .picks
            {
                replayed[usize::from(vertex)] = seat;
            }
            let mut second: Option<f64> = None;
            for vertex_index in 0..topology.vertex_count() {
                let vertex = vertex_index as Vertex;
                if !can_place_settlement(&topology, &replayed, vertex) {
                    continue;
                }
                let score = setup_candidate_score(
                    field, &board, &topology, &replayed, edge_owner, hero, vertex, true,
                );
                if second.is_none_or(|held| score > held) {
                    second = Some(score);
                }
            }
            let expected = setup_candidate_score(
                field,
                &board,
                &topology,
                vertex_owner,
                edge_owner,
                hero,
                candidate,
                false,
            ) + second.unwrap_or(0.0);

            let scored = setup_candidate_score(
                draft,
                &board,
                &topology,
                vertex_owner,
                edge_owner,
                hero,
                candidate,
                false,
            );
            assert_eq!(scored, expected, "hero seat {hero}");

            let paid = setup_candidate_score(
                credited,
                &board,
                &topology,
                vertex_owner,
                edge_owner,
                hero,
                candidate,
                false,
            );
            assert!(
                paid >= scored,
                "the credit is never a charge, hero seat {hero}"
            );
            if paid > scored {
                moved += 1;
            }
            checked += 1;
        }
    }
    assert_eq!(checked, TIE_FREE_GAMES * SEATS);
    assert!(
        moved > 0,
        "a weight of 1 must move some candidate, or the pin at 0 proves nothing"
    );
}

/// A full setup trace over `setup_order` from the vertices given in pick order. The pick index and
/// the setup grant follow the round, exactly as `game.rs::setup` records them, and each road is the
/// settlement's first incident edge, which no part of the accuracy statistic reads.
fn hand_built_trace(topology: &Topology, vertices: &[Vertex]) -> Vec<SetupPick> {
    let order = setup_order(SEATS);
    assert_eq!(vertices.len(), order.len(), "a trace covers every setup pick");
    order
        .iter()
        .zip(vertices)
        .enumerate()
        .map(|(position, (seat, vertex))| SetupPick {
            seat: *seat,
            pick: u8::from(position >= SEATS),
            grant: position >= SEATS,
            vertex: *vertex,
            edge: topology.vertex_edges(*vertex)[0],
        })
        .collect()
}

/// The lowest-index vertex legal on `owners` that is not `avoid`, which is how the deviating trace
/// takes a settlement the lookahead did not name.
fn other_legal(topology: &Topology, owners: &[u8], avoid: Option<Vertex>) -> Vertex {
    (0..topology.vertex_count())
        .map(|index| index as Vertex)
        .find(|vertex| Some(*vertex) != avoid && can_place_settlement(topology, owners, *vertex))
        .expect("a standard4 setup always leaves a legal vertex")
}

/// M-61's arithmetic, read off two traces that differ in one known place: one the lookahead named
/// exactly, and one where the last intervening pick and the hero's second settlement both went
/// somewhere else. Five of six named picks, one exact sequence of two, and one matched second is
/// what the statistic must report, per slot and pooled.
#[test]
fn the_accuracy_statistic_counts_a_hand_built_trace_both_ways() {
    let draft = register_app_formula_draft(
        "app_formula_draft:arithmetic-hero@arithmetic-opponent".to_string(),
        default_weights(),
        default_weights(),
    )
    .expect("registry has room");
    let (topology, board) = prepared_board(0, &[draft]);
    let vertex_owner = vec![EMPTY; topology.vertex_count()];
    let edge_owner = vec![EMPTY; topology.edge_count()];
    // Vertex 0 is legal on an empty board, and which candidate the hero holds does not matter: the
    // statistic reads the plan that candidate produces, whatever it is.
    let candidate: Vertex = 0;
    let plan = setup_lookahead_plan(
        draft,
        &board,
        &topology,
        &vertex_owner,
        &edge_owner,
        0,
        candidate,
    )
    .expect("a draft kind always has a formula to replay with");
    assert_eq!(
        plan.picks.len(),
        2 * SEATS - 2,
        "seat 0 looks past every other seat's two picks"
    );

    let mut named: Vec<Vertex> = vec![candidate];
    named.extend(plan.picks.iter().map(|(_, vertex)| *vertex));
    named.push(plan.second.expect("the replay leaves seat 0 a second site"));

    // The deviation goes at the end, so every pick before it stands where the exact trace put it
    // and the two traces differ in exactly two known places.
    let order = setup_order(SEATS);
    let last_intervening = 2 * SEATS - 2;
    let mut deviating = named.clone();
    let mut owners = vertex_owner.clone();
    for (seat, vertex) in order.iter().zip(&deviating).take(last_intervening) {
        owners[usize::from(*vertex)] = *seat;
    }
    deviating[last_intervening] = other_legal(&topology, &owners, Some(named[last_intervening]));
    owners[usize::from(deviating[last_intervening])] = order[last_intervening];
    deviating[last_intervening + 1] = other_legal(&topology, &owners, plan.second);

    let mut scratch_vertices = Vec::new();
    let mut scratch_edges = Vec::new();
    let mut readings = Vec::new();
    let mut collected = Vec::new();
    for vertices in [&named, &deviating] {
        game_lookahead(
            &board,
            &topology,
            draft,
            &hand_built_trace(&topology, vertices),
            &mut scratch_vertices,
            &mut scratch_edges,
            &mut readings,
        );
        assert_eq!(readings.len(), SEATS, "every seat completes a pair");
        assert_eq!(
            readings[SEATS - 1].intervening,
            0,
            "the seat picking last in the first round has nothing to look past"
        );
        collected.push(readings[0]);
    }

    let (exact, deviated) = (collected[0], collected[1]);
    assert_eq!(exact.intervening, 6);
    assert_eq!(exact.matched, 6);
    assert!(exact.sequence_exact);
    assert!(exact.second_matched);
    assert_eq!(deviated.intervening, 6);
    assert_eq!(deviated.matched, 5);
    assert!(!deviated.sequence_exact);
    assert!(!deviated.second_matched);

    let accuracy = lookahead_accuracy(&collected, SEATS);
    assert_eq!(accuracy.overall.first_picks, 2);
    assert_eq!(accuracy.overall.predicting_first_picks, 2);
    assert_eq!(accuracy.overall.intervening_picks, 12);
    assert_eq!(accuracy.overall.matched_picks, 11);
    assert_eq!(accuracy.overall.pick_share, 11.0 / 12.0);
    assert_eq!(accuracy.overall.exact_sequences, 1);
    assert_eq!(accuracy.overall.sequence_share, 0.5);
    assert_eq!(accuracy.overall.second_matches, 1);
    assert_eq!(accuracy.overall.second_share, 0.5);
    // Both readings are seat 0's, so slot 0 carries the whole run and every other slot is empty.
    assert_eq!(accuracy.per_slot.len(), SEATS);
    assert_eq!(accuracy.per_slot[0].intervening_picks, 12);
    assert_eq!(accuracy.per_slot[0].pick_share, 11.0 / 12.0);
    for slot in &accuracy.per_slot[1..] {
        assert_eq!(slot.first_picks, 0);
        assert_eq!(slot.pick_share, 0.0);
        assert_eq!(slot.sequence_share, 0.0);
        assert_eq!(slot.second_share, 0.0);
    }

    // A seat with nothing between its picks is exact by having nothing to get wrong, so it is left
    // out of the sequence share rather than counted as a success.
    let vacuous = lookahead_accuracy(&readings[SEATS - 1..], SEATS);
    assert_eq!(vacuous.overall.first_picks, 1);
    assert_eq!(vacuous.overall.predicting_first_picks, 0);
    assert_eq!(vacuous.overall.sequence_share, 0.0);
}

/// The statistic's control, and the condition M-61's preregistration reads it under: against a
/// greedy field with no tie anywhere, the lookahead's opponent model is the field itself, so every
/// share must read exactly 1. Anything else says the statistic is broken rather than that the
/// model is.
#[test]
fn a_tie_free_greedy_field_is_predicted_exactly() {
    let field = register_app_formula("app_formula:control-field".to_string(), default_weights())
        .expect("registry has room");
    let mut scratch_vertices = Vec::new();
    let mut scratch_edges = Vec::new();
    let mut game = Vec::new();
    let mut readings = Vec::new();
    for (topology, board, trace, _) in tie_free_games(field, &[]) {
        game_lookahead(
            &board,
            &topology,
            field,
            &trace,
            &mut scratch_vertices,
            &mut scratch_edges,
            &mut game,
        );
        readings.extend_from_slice(&game);
    }
    let accuracy = lookahead_accuracy(&readings, SEATS);
    assert_eq!(accuracy.overall.first_picks, TIE_FREE_GAMES * SEATS);
    assert!(accuracy.overall.intervening_picks > 0);
    assert_eq!(accuracy.overall.pick_share, 1.0);
    assert_eq!(accuracy.overall.sequence_share, 1.0);
    assert_eq!(accuracy.overall.second_share, 1.0);
}
