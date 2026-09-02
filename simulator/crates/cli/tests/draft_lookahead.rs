//! SP5's draft-aware placement kind: the opponent model must reproduce the field, and the second
//! pick must stay the plain formula argmax.
//!
//! The boards and seeds are the `tuning` domain's own, so the games the model is held against are
//! games the measurement runs would actually play, not a hand-built arrangement chosen to suit it.

use unsettled_engine::board::SimBoard;
use unsettled_engine::game::{GameArena, GameConfig, SetupPick, can_place_settlement, setup_order};
use unsettled_engine::placement::app_formula::EngineWeights;
use unsettled_engine::placement::{
    PlacementKind, choose, draft_replay, prepare_app_formula_boards, production_pips,
    register_app_formula, register_app_formula_draft, setup_candidate_score,
};
use unsettled_engine::rng::{Xoshiro256StarStar, derive_evaluation_seed, mix64};
use unsettled_engine::rules::RuleConfig;
use unsettled_engine::state::EMPTY;
use unsettled_engine::topology::{Layout, Topology, Vertex};
use unsettled_sim::boardgen::generate_board;
use unsettled_sim::evaluate::TUNING_SEED;

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
            let predicted = draft_replay(
                draft,
                &board,
                &topology,
                vertex_owner,
                edge_owner,
                hero,
                trace[first].vertex,
            );
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
    let (field, draft) = kinds("denial");
    let mut hero = default_weights();
    hero.setup_denial_weight = 1.0;
    let credited = register_app_formula_draft(
        "app_formula_draft:denial-credited@denial-opponent".to_string(),
        hero,
        default_weights(),
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
            // tell: only the `expansion` component reads edges and the committed weights ship it
            // at 0.
            let mut replayed = vertex_owner.clone();
            replayed[usize::from(candidate)] = hero;
            for (seat, vertex) in draft_replay(
                draft,
                &board,
                &topology,
                vertex_owner,
                edge_owner,
                hero,
                candidate,
            ) {
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
