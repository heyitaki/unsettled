//! The J2 stage signal (`policy::stage::Stage`) and its consumers: the settlement
//! expansion damping and the city boost in `vertex_score_with`, plus the gated ETW
//! urgency input.

use std::fs;
use std::path::PathBuf;

use unsettled_engine::board::{ConversionOptions, SimBoard};
use unsettled_engine::game::{GameArena, GameConfig};
use unsettled_engine::policy::PolicyScratch;
use unsettled_engine::policy::denial::{self, DenialParams};
use unsettled_engine::policy::heuristic_v1::{self, BUILD_BAND, BuildKind, HeuristicParams};
use unsettled_engine::policy::stage::Stage;
use unsettled_engine::rng::Xoshiro256StarStar;
use unsettled_engine::rules::{Buildable, RESOURCE_COUNT, RuleConfig};
use unsettled_engine::topology::{Layout, Topology};
use unsettled_engine::view::{Action, DecisionPhase, pips};
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

/// A vertex's production pips with the robber skip `vertex_score` applies.
fn local_production(board: &SimBoard, topology: &Topology, vertex: u8) -> [u16; RESOURCE_COUNT] {
    let mut production = [0_u16; RESOURCE_COUNT];
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

// Forwarded arguments of `Stage::derive` and the `vertex_score_with` stage adjustments, one
// observing test each:
// - observer settlement/city pieces remaining (via `view`):
//   the_lateness_matches_the_piece_supply_closed_form (and its other-seat probe)
// - piece limits (via `view.piece_limit`): the_lateness_matches_the_piece_supply_closed_form
//   (asserts the limits and the /9 closed form against literals)
// - open expansion sites (via `view.is_expansion_target`):
//   the_site_channel_binds_when_open_sites_run_out
// - `urgency_weight`: the_urgency_input_is_weighted_and_clamped (weight forwarding, the
//   zero-weight identity, and the clamp)
// - `top_danger` and its gating (denial context only):
//   the_urgency_rides_the_denial_context_only
// - `params.stage_expansion_weight` and the candidate's expansion count:
//   the_settlement_damping_and_city_boost_match_the_closed_form (0.5 and the overdamp floor)
// - `params.stage_city_weight`: the_settlement_damping_and_city_boost_match_the_closed_form
// - `kind` (damping only settlements, boost only cities): both closed forms above cross-check
// - the derived stage reaching the build candidates:
//   the_urgency_rides_the_denial_context_only (city candidates against the derived closed
//   form) and zero_stage_weights_restore_the_pre_stage_scores_bit_for_bit
// - the derived stage reaching the goal chooser: the_goal_chooser_reads_the_stage
// - the road and pair expansion credits:
//   the_road_and_pair_expansion_credits_price_targets_through_the_stage in `heuristic_v1`
// - the trial labels: the_stage_labels_select_their_trial_weights in `policy::mod`

#[test]
fn the_lateness_matches_the_piece_supply_closed_form() {
    let (topology, board, _rules, mut arena) = fixture();
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    assert_eq!(view.piece_limit(Buildable::Settlement), 5);
    assert_eq!(view.piece_limit(Buildable::City), 4);
    // Fresh supply on an empty board: both channels are full, lateness is exactly zero.
    assert_eq!(Stage::derive(&view, 0.0, None).lateness, 0.0);

    // One settlement and one city piece left out of the 5 + 4 supply; the open board keeps
    // the site channel at 1, so the piece channel binds.
    arena.state.players[0].pieces[Buildable::Settlement.index()] = 1;
    arena.state.players[0].pieces[Buildable::City.index()] = 1;
    // Another seat's depleted supply must not leak into the observer's stage.
    arena.state.players[1].pieces[Buildable::Settlement.index()] = 0;
    arena.state.players[1].pieces[Buildable::City.index()] = 0;
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    assert_eq!(
        Stage::derive(&view, 0.0, None).lateness,
        1.0 - 2.0_f32 / 9.0
    );
}

#[test]
fn the_site_channel_binds_when_open_sites_run_out() {
    let (topology, board, _rules, mut arena) = fixture();
    // A rival owns every vertex except one isolated pocket: the pocket vertex keeps all its
    // neighbors unowned so it is the single distance-rule-open site left, while each
    // neighbor sits next to an owned vertex and is closed.
    let pocket = 0_u8;
    for vertex in (0..topology.vertex_count()).map(|vertex| vertex as u8) {
        if vertex == pocket || topology.vertex_adjacent(pocket).contains(&vertex) {
            continue;
        }
        arena.state.vertex_owner[usize::from(vertex)] = 1;
        arena.state.vertex_tier[usize::from(vertex)] = 1;
    }
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let open = (0..topology.vertex_count())
        .filter(|vertex| view.is_expansion_target(*vertex as u8))
        .count();
    assert_eq!(open, 1, "the fixture must leave exactly one open site");
    // The observer's piece supply is untouched (fraction 1), so the site channel binds:
    // 1 open site against the settlement supply of 5.
    assert_eq!(
        Stage::derive(&view, 0.0, None).lateness,
        1.0 - 1.0_f32 / 5.0
    );
}

#[test]
fn the_urgency_input_is_weighted_and_clamped() {
    let (topology, board, _rules, mut arena) = fixture();
    arena.state.players[0].pieces[Buildable::Settlement.index()] = 1;
    arena.state.players[0].pieces[Buildable::City.index()] = 1;
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let base = Stage::derive(&view, 0.0, None).lateness;
    assert!(base > 0.0 && base < 1.0);
    // The weight scales the danger; the closed form repeats the derivation's arithmetic.
    let expected = (base + 0.25_f32 * 0.4_f32).clamp(0.0, 1.0);
    assert_eq!(
        Stage::derive(&view, 0.25, Some(0.4)).lateness.to_bits(),
        expected.to_bits()
    );
    // A different weight forwards differently.
    assert_ne!(
        Stage::derive(&view, 0.5, Some(0.4)).lateness.to_bits(),
        Stage::derive(&view, 0.25, Some(0.4)).lateness.to_bits()
    );
    // Zero weight and an absent danger both leave the primary signal untouched.
    assert_eq!(Stage::derive(&view, 0.0, Some(0.9)).lateness, base);
    assert_eq!(Stage::derive(&view, 5.0, None).lateness, base);
    // The sum clamps at one.
    assert_eq!(Stage::derive(&view, 10.0, Some(0.5)).lateness, 1.0);
}

/// One decision state where city build candidates exist: the observer holds exactly the
/// city cost and an upgradeable settlement on a producing vertex. Returns the owned vertex.
fn city_candidate_fixture(arena: &mut GameArena, board: &SimBoard, topology: &Topology) -> u8 {
    let owned = (0..topology.vertex_count() as u8)
        .find(|vertex| {
            local_production(board, topology, *vertex)
                .iter()
                .sum::<u16>()
                > 0
        })
        .unwrap();
    arena.state.vertex_owner[usize::from(owned)] = 0;
    arena.state.vertex_tier[usize::from(owned)] = 1;
    arena.state.players[0].resources = [0, 0, 2, 0, 3];
    owned
}

#[test]
fn the_urgency_rides_the_denial_context_only() {
    let (topology, board, _rules, mut arena) = fixture();
    let owned = city_candidate_fixture(&mut arena, &board, &topology);
    // A rival with board presence and public points keeps its expected turns to win finite,
    // so the shared danger model reports a positive top danger for the gated path to read.
    let rival_vertex = (0..topology.vertex_count() as u8)
        .find(|vertex| {
            *vertex != owned
                && !topology.vertex_adjacent(owned).contains(vertex)
                && local_production(&board, &topology, *vertex)
                    .iter()
                    .sum::<u16>()
                    > 0
        })
        .unwrap();
    arena.state.vertex_owner[usize::from(rival_vertex)] = 1;
    arena.state.vertex_tier[usize::from(rival_vertex)] = 1;
    arena.state.players[1].vp_public = 8;
    // Late pieces so the boost has a base to move.
    arena.state.players[0].pieces[Buildable::Settlement.index()] = 1;
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);

    let city_score = |params: &HeuristicParams| {
        let mut scratch = PolicyScratch::default();
        let mut rng = Xoshiro256StarStar::from_seed(9);
        heuristic_v1::action(&view, &mut scratch, params, &mut rng);
        scratch
            .actions
            .as_slice()
            .iter()
            .find_map(|candidate| match candidate.action {
                Action::UpgradeCity(vertex) => {
                    assert_eq!(vertex, owned);
                    Some(candidate.score)
                }
                _ => None,
            })
            .expect("the fixture must offer a city build")
    };

    let ungated = HeuristicParams {
        stage_city_weight: 0.75,
        stage_urgency_weight: 0.5,
        ..HeuristicParams::default()
    };
    let expected_ungated = BUILD_BAND
        + heuristic_v1::vertex_score_with(
            &view,
            owned,
            &ungated,
            BuildKind::City,
            None,
            Some(&Stage::derive(&view, 0.5, None)),
            None,
        );
    assert_eq!(city_score(&ungated).to_bits(), expected_ungated.to_bits());

    let gated = HeuristicParams {
        denial: Some(DenialParams::default()),
        ..ungated.clone()
    };
    let ctx = denial::context(&view, &DenialParams::default());
    assert!(
        ctx.top_danger() > 0.0,
        "the rival must register on the danger model"
    );
    let expected_gated = BUILD_BAND
        + heuristic_v1::vertex_score_with(
            &view,
            owned,
            &gated,
            BuildKind::City,
            None,
            Some(&Stage::derive(&view, 0.5, Some(ctx.top_danger()))),
            None,
        );
    let actual_gated = city_score(&gated);
    assert_eq!(actual_gated.to_bits(), expected_gated.to_bits());
    assert_ne!(
        actual_gated.to_bits(),
        city_score(&ungated).to_bits(),
        "the urgency input must move the gated score"
    );
}

#[test]
fn the_settlement_damping_and_city_boost_match_the_closed_form() {
    let (topology, board, _rules, arena) = fixture();
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let vertex = (0..topology.vertex_count() as u8)
        .find(|vertex| {
            local_production(&board, &topology, *vertex)
                .iter()
                .sum::<u16>()
                > 0
        })
        .unwrap();
    let params = HeuristicParams {
        expansion_weight: 0.4,
        stage_expansion_weight: 0.5,
        stage_city_weight: 0.75,
        ..HeuristicParams::default()
    };
    let stage = Stage { lateness: 0.6 };
    let expansion = topology
        .vertex_adjacent(vertex)
        .iter()
        .filter(|adjacent| view.vertex_owner(**adjacent).is_none())
        .count() as f32;
    assert!(expansion > 0.0, "the candidate must have an expansion term");

    // Settlement: only the expansion term moves, scaled by (1 - 0.5 * 0.6).
    let base = heuristic_v1::vertex_score(&view, vertex, &params, BuildKind::Settlement);
    let scale = (1.0_f32 - 0.5 * 0.6).max(0.0);
    let expected = base + expansion * 0.4 * (scale - 1.0);
    let actual =
        heuristic_v1::vertex_score_with(&view, vertex, &params, BuildKind::Settlement, None, Some(&stage), None);
    assert_eq!(actual.to_bits(), expected.to_bits());

    // Overdamping floors the term at zero instead of going negative.
    let overdamped = HeuristicParams {
        stage_expansion_weight: 5.0,
        ..params.clone()
    };
    let floored = base + expansion * 0.4 * (0.0 - 1.0);
    let actual = heuristic_v1::vertex_score_with(
        &view,
        vertex,
        &overdamped,
        BuildKind::Settlement,
        None,
        Some(&stage),
        None,
    );
    assert_eq!(actual.to_bits(), floored.to_bits());

    // City: the whole score is boosted by (1 + 0.75 * 0.6), and the settlement damping
    // weight plays no part.
    let city_base = heuristic_v1::vertex_score(&view, vertex, &params, BuildKind::City);
    let expected = city_base * (1.0_f32 + 0.75 * 0.6);
    let actual =
        heuristic_v1::vertex_score_with(&view, vertex, &params, BuildKind::City, None, Some(&stage), None);
    assert_eq!(actual.to_bits(), expected.to_bits());
    let city_overdamped = heuristic_v1::vertex_score_with(
        &view,
        vertex,
        &overdamped,
        BuildKind::City,
        None,
        Some(&stage),
        None,
    );
    assert_eq!(city_overdamped.to_bits(), actual.to_bits());
}

#[test]
fn zero_stage_weights_restore_the_pre_stage_scores_bit_for_bit() {
    let (topology, board, _rules, mut arena) = fixture();
    // A lone urgency weight must not construct a stage: both consuming weights are zero.
    let params = HeuristicParams {
        stage_urgency_weight: 3.0,
        ..HeuristicParams::default()
    };
    let target = topology.vertex_adjacent(0)[0];
    arena.state.edge_owner[usize::from(topology.vertex_edges(target)[0])] = 0;
    // Late pieces, so a constructed stage would have a non-zero lateness to apply.
    arena.state.players[0].pieces[Buildable::Settlement.index()] = 2;
    arena.state.players[0].pieces[Buildable::City.index()] = 1;
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    arena.state.players[0].resources = view.costs(Buildable::Settlement)[0].map(i16::from);
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let mut scratch = PolicyScratch::default();
    let mut rng = Xoshiro256StarStar::from_seed(5);
    heuristic_v1::action(&view, &mut scratch, &params, &mut rng);
    let mut settlements = 0;
    for candidate in scratch.actions.as_slice() {
        let Action::BuildSettlement(vertex) = candidate.action else {
            continue;
        };
        settlements += 1;
        let expected =
            BUILD_BAND + heuristic_v1::vertex_score(&view, vertex, &params, BuildKind::Settlement);
        assert_eq!(candidate.score.to_bits(), expected.to_bits());
    }
    assert!(settlements > 0, "the fixture must offer settlement builds");
}

#[test]
fn the_goal_chooser_reads_the_stage() {
    let (topology, board, _rules, mut arena) = fixture();
    let owned = city_candidate_fixture(&mut arena, &board, &topology);
    // An empty hand: neither goal is affordable, so the chosen goal is observable without
    // a build resolving it, and no road pieces removes the road goal.
    arena.state.players[0].resources = [0; RESOURCE_COUNT];
    arena.state.players[0].pieces[Buildable::Road.index()] = 0;
    // A legal settlement target through an owned edge, away from the owned vertex.
    let (edge, _target) = (0..topology.edge_count() as u8)
        .find_map(|edge| {
            let [first, second] = topology.edge_endpoints(edge);
            let clear = |vertex: u8| {
                vertex != owned
                    && !topology.vertex_adjacent(vertex).contains(&owned)
                    && local_production(&board, &topology, vertex)
                        .iter()
                        .sum::<u16>()
                        > 0
            };
            (clear(first) && clear(second)).then_some((edge, first))
        })
        .expect("fixture board offers a detached edge");
    arena.state.edge_owner[usize::from(edge)] = 0;
    // Late pieces: one settlement and one city left, lateness 7/9.
    arena.state.players[0].pieces[Buildable::Settlement.index()] = 1;
    arena.state.players[0].pieces[Buildable::City.index()] = 1;
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);

    let chosen_goal = |params: &HeuristicParams| {
        let mut scratch = PolicyScratch::default();
        let mut rng = Xoshiro256StarStar::from_seed(13);
        heuristic_v1::action(&view, &mut scratch, params, &mut rng);
        scratch.goal
    };

    let flat = HeuristicParams::default();
    assert_eq!(
        chosen_goal(&flat),
        Some(Buildable::Settlement),
        "the unstaged chooser must prefer the settlement goal on this fixture"
    );
    // The staged chooser prices the city through the boost (and the settlement targets
    // through the damping), flipping the goal late in the game.
    let staged = HeuristicParams {
        stage_expansion_weight: 1.0,
        stage_city_weight: 25.0,
        ..HeuristicParams::default()
    };
    assert_eq!(chosen_goal(&staged), Some(Buildable::City));
}
