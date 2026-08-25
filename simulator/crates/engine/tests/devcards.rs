use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;

use unsettled_engine::board::{ConversionOptions, SimBoard};
use unsettled_engine::etw::{self, EtwInputs};
use unsettled_engine::game::{GameArena, GameConfig};
use unsettled_engine::policy::PolicyScratch;
use unsettled_engine::policy::denial::{self, DenialParams};
use unsettled_engine::policy::devcards::{
    self, DevCardContext, DevCardParams, DevOffers, ScoredDevPlay,
};
use unsettled_engine::policy::heuristic_v1::{self, HeuristicParams, LegacyValuation};
use unsettled_engine::policy::threat;
use unsettled_engine::rules::{Buildable, RESOURCE_COUNT, Resource, RuleConfig};
use unsettled_engine::topology::{Layout, Topology};
use unsettled_engine::view::{DecisionPhase, DevPlay, can_pay, pips};
use unsettled_engine::wire::WireBoard;

fn fixture() -> (Topology, SimBoard, RuleConfig, GameConfig, GameArena) {
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
    let config = GameConfig::default();
    let mut arena = GameArena::default();
    arena.prepare(&board, &topology, &rules, &config);
    (topology, board, rules, config, arena)
}

fn set_belief_and_hand(arena: &mut GameArena, seat: usize, cards: [u16; RESOURCE_COUNT]) {
    arena.state.players[seat].resources = cards.map(|count| i16::try_from(count).unwrap());
    for (resource, count) in cards.into_iter().enumerate() {
        if count > 0 {
            arena.state.belief.gain(seat, resource, count);
        }
    }
}

fn give_resource_production(
    arena: &mut GameArena,
    board: &SimBoard,
    topology: &Topology,
    seat: usize,
    resource: Resource,
    target: u16,
) {
    let mut total = 0_u16;
    for vertex in 0..topology.vertex_count() {
        if arena.state.vertex_owner[vertex] < board.seats() as u8 {
            continue;
        }
        let contribution = topology
            .vertex_hexes(vertex as u8)
            .iter()
            .filter(|hex| {
                **hex != board.robber() && board.tiles()[usize::from(**hex)] == Some(resource)
            })
            .map(|hex| u16::from(board.tokens()[usize::from(*hex)].map_or(0, pips)))
            .sum::<u16>();
        if contribution == 0 {
            continue;
        }
        arena.state.vertex_owner[vertex] = seat as u8;
        arena.state.vertex_tier[vertex] = 1;
        total += contribution;
        if total >= target {
            return;
        }
    }
    panic!("fixture could only provide {total} pips of {resource:?}");
}

fn give_exact_production(
    arena: &mut GameArena,
    board: &SimBoard,
    topology: &Topology,
    seat: usize,
    target: [u16; RESOURCE_COUNT],
) {
    let mut paths = BTreeMap::from([([0_u16; RESOURCE_COUNT], Vec::<usize>::new())]);
    for vertex in 0..topology.vertex_count() {
        let mut contribution = [0_u16; RESOURCE_COUNT];
        for hex in topology.vertex_hexes(vertex as u8) {
            if *hex == board.robber() {
                continue;
            }
            if let (Some(resource), Some(token)) = (
                board.tiles()[usize::from(*hex)],
                board.tokens()[usize::from(*hex)],
            ) {
                contribution[resource.index()] += u16::from(pips(token));
            }
        }
        let snapshot: Vec<_> = paths
            .iter()
            .map(|(sum, path)| (*sum, path.clone()))
            .collect();
        for (sum, mut path) in snapshot {
            let next = std::array::from_fn(|resource| sum[resource] + contribution[resource]);
            if (0..RESOURCE_COUNT).any(|resource| next[resource] > target[resource]) {
                continue;
            }
            path.push(vertex);
            paths.entry(next).or_insert(path);
        }
    }
    for vertex in paths.get(&target).expect("fixture needs exact production") {
        arena.state.vertex_owner[*vertex] = seat as u8;
        arena.state.vertex_tier[*vertex] = 1;
    }
}

fn inputs(hand: [f64; RESOURCE_COUNT]) -> EtwInputs {
    EtwInputs {
        win_vp: 10,
        public_vp: 5,
        dev_count: 1,
        all_seats_dev_count_sum: 5,
        dev_deck_remaining: 20,
        dev_victory_points: 5,
        production_pips: [8, 5, 9, 6, 4],
        pieces_settlement: 3,
        pieces_city: 3,
        settlements_on_board: 2,
        settlement_cost: Some([1, 1, 1, 1, 0]),
        city_cost: Some([0, 0, 2, 0, 3]),
        road_cost: Some([1, 0, 0, 1, 0]),
        dev_cost: Some([0, 1, 1, 0, 1]),
        settlement_vp: 1,
        city_vp: 2,
        trade_rates: [4; RESOURCE_COUNT],
        belief_expected: hand,
        hand_total: hand.iter().sum::<f64>() as u32,
    }
}

fn synthetic_context(hand: [f64; RESOURCE_COUNT]) -> DevCardContext {
    let inputs = inputs(hand);
    DevCardContext {
        etw_now: etw::expected_turns_to_win(&inputs),
        inputs,
        own: hand,
        own_round_income: [8.0, 5.0, 9.0, 6.0, 4.0].map(|pips| pips / 9.0),
        haul_expected: [0.0; RESOURCE_COUNT],
        haul_sound: [0.0; RESOURCE_COUNT],
        haul_round_growth: [0.0; RESOURCE_COUNT],
    }
}

fn score_for_live_view(
    arena: &GameArena,
    board: &SimBoard,
    topology: &Topology,
    offers: DevOffers,
    goal_cost: Option<[u8; RESOURCE_COUNT]>,
    params: &DevCardParams,
) -> unsettled_engine::policy::devcards::DevCandidates {
    let view = arena.decision_view(board, topology, 0, DecisionPhase::PreRoll);
    devcards::score_candidates(&view, params, offers, goal_cost)
}

/// The seven-exposure charge zeroed, for tests whose subject (candidate ordering, belief
/// choice, cost-variant scope) is orthogonal to hand-size risk; the charge itself is pinned
/// in exposure.rs.
fn exposure_free() -> DevCardParams {
    DevCardParams {
        exposure_weight: 0.0,
        ..DevCardParams::default()
    }
}

fn monopoly(play: Option<DevPlay>) -> Option<Resource> {
    match play {
        Some(DevPlay::Monopoly { resource }) => Some(resource),
        _ => None,
    }
}

fn heuristic_choices(
    view: &unsettled_engine::view::DecisionView<'_>,
) -> (Option<DevPlay>, Option<DevPlay>) {
    heuristic_choices_with(view, DevCardParams::default())
}

fn heuristic_choices_with(
    view: &unsettled_engine::view::DecisionView<'_>,
    cards: DevCardParams,
) -> (Option<DevPlay>, Option<DevPlay>) {
    let mut baseline_scratch = PolicyScratch::default();
    let baseline = heuristic_v1::pre_roll(view, &mut baseline_scratch, &HeuristicParams::default());
    let mut devcards_scratch = PolicyScratch::default();
    let devcards = heuristic_v1::pre_roll(
        view,
        &mut devcards_scratch,
        &HeuristicParams {
            dev_cards: Some(cards),
            ..HeuristicParams::default()
        },
    );
    (baseline, devcards)
}

#[test]
fn monopoly_prefers_the_belief_holding_over_the_production_proxy() {
    let (topology, board, _rules, _config, mut arena) = fixture();
    set_belief_and_hand(&mut arena, 1, [0, 0, 6, 0, 0]);
    set_belief_and_hand(&mut arena, 2, [0, 0, 2, 0, 0]);
    arena.state.players[0].playable_dev[4] = 1;
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::PreRoll);
    let choice = devcards::pre_roll_choice(
        &view,
        &exposure_free(),
        DevOffers {
            monopoly: true,
            ..DevOffers::default()
        },
        None,
    );
    assert_eq!(monopoly(choice), Some(Resource::Wheat));
    let (baseline, arm) = heuristic_choices_with(&view, exposure_free());
    assert!(
        baseline.is_none()
            || matches!(
                baseline,
                Some(DevPlay::Monopoly {
                    resource: Resource::Ore
                })
            )
    );
    assert_eq!(monopoly(arm), Some(Resource::Wheat));
}

#[test]
fn monopoly_gates_on_the_sound_bound_but_ranks_on_the_estimate() {
    let mut context = synthetic_context([0.0; RESOURCE_COUNT]);
    context.haul_expected = [0.6, 0.0, 0.0, 0.0, 0.0];
    context.haul_sound = [0.0, 0.0, 2.0, 0.0, 0.0];
    let ranked = [30.0, 0.0, 2.0, 0.0, 0.0];
    assert_eq!(
        devcards::monopoly_resource(
            &context,
            &DevCardParams::default(),
            &context.own,
            context.etw_now,
            &ranked
        )
        .map(|value| value.0),
        Some(Resource::Wheat)
    );
    let params = DevCardParams {
        monopoly_sound_floor: 0.0,
        ..DevCardParams::default()
    };
    assert_eq!(
        devcards::monopoly_resource(&context, &params, &context.own, context.etw_now, &ranked)
            .map(|value| value.0),
        Some(Resource::Wood)
    );
}

#[test]
fn monopoly_completion_uses_only_the_guaranteed_haul() {
    let (topology, board, _rules, _config, mut arena) = fixture();
    arena.state.vertex_owner[0] = 0;
    arena.state.vertex_tier[0] = 1;
    set_belief_and_hand(&mut arena, 0, [0, 0, 2, 0, 1]);
    set_belief_and_hand(&mut arena, 1, [0, 0, 0, 0, 1]);
    set_belief_and_hand(&mut arena, 2, [1, 0, 0, 0, 1]);
    set_belief_and_hand(&mut arena, 3, [1, 0, 0, 0, 1]);
    arena.state.belief.steal(4, 2);
    arena.state.players[2].resources[Resource::Wood.index()] -= 1;
    arena.state.players[4].resources[Resource::Wood.index()] += 1;
    arena.state.belief.steal(5, 3);
    arena.state.players[3].resources[Resource::Wood.index()] -= 1;
    arena.state.players[5].resources[Resource::Wood.index()] += 1;
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::PreRoll);
    let offers = DevOffers {
        monopoly: true,
        ..DevOffers::default()
    };
    let goal = [0, 0, 2, 0, 3];
    let weighted = devcards::score_candidates(&view, &DevCardParams::default(), offers, Some(goal));
    let zero = devcards::score_candidates(
        &view,
        &DevCardParams {
            completion_weight: 0.0,
            ..DevCardParams::default()
        },
        offers,
        Some(goal),
    );
    let expected = weighted.context.haul_expected[Resource::Ore.index()].floor() as i16;
    let sound = weighted.context.haul_sound[Resource::Ore.index()].floor() as i16;
    assert_eq!((sound, expected), (1, 2));
    let mut with_sound = *view.own_hand();
    with_sound[Resource::Ore.index()] += sound;
    let mut with_expected = *view.own_hand();
    with_expected[Resource::Ore.index()] += expected;
    assert!(!can_pay(&with_sound, &goal));
    assert!(can_pay(&with_expected, &goal));
    assert_eq!(
        weighted.scored[2].unwrap().play,
        Some(DevPlay::Monopoly {
            resource: Resource::Ore
        })
    );
    assert_eq!(
        weighted.scored[2].unwrap().score.to_bits(),
        zero.scored[2].unwrap().score.to_bits()
    );
}

#[test]
fn monopoly_haul_sums_every_opponent_and_excludes_the_observer() {
    let (topology, board, _rules, _config, mut arena) = fixture();
    set_belief_and_hand(&mut arena, 0, [0, 0, 0, 0, 9]);
    for seat in 1..4 {
        set_belief_and_hand(&mut arena, seat, [0, 0, 0, 0, 1]);
    }
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::PreRoll);
    let context = devcards::context(&view, &DevCardParams::default());
    assert_eq!(context.haul_expected[Resource::Ore.index()], 3.0);
    assert_eq!(context.haul_sound[Resource::Ore.index()], 3.0);
}

#[test]
fn small_opponent_shares_do_not_floor_to_zero() {
    let (topology, board, _rules, _config, mut arena) = fixture();
    set_belief_and_hand(&mut arena, 1, [0, 0, 0, 1, 0]);
    arena.state.players[0].playable_dev[4] = 1;
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::PreRoll);
    let context = devcards::context(&view, &DevCardParams::default());
    let production = view.production_pips(1);
    let total: u16 = production.iter().sum();
    let old_proxy = if total == 0 {
        0
    } else {
        view.hand_total(1) * u32::from(production[Resource::Brick.index()]) / u32::from(total)
    };
    assert_eq!(old_proxy, 0);
    assert_eq!(context.haul_expected[Resource::Brick.index()], 1.0);
    assert!(
        devcards::monopoly_resource(
            &context,
            &DevCardParams::default(),
            &context.own,
            context.etw_now,
            &context.haul_expected
        )
        .is_some()
    );
    let (baseline, arm) = heuristic_choices(&view);
    assert_eq!(baseline, None);
    assert_eq!(monopoly(arm), Some(Resource::Brick));
}

#[test]
fn hold_beats_a_marginal_monopoly_whose_haul_is_still_growing() {
    let (topology, board, _rules, _config, mut arena) = fixture();
    arena.state.players[0].vp_public = 5;
    give_exact_production(&mut arena, &board, &topology, 0, [8, 5, 9, 6, 4]);
    set_belief_and_hand(&mut arena, 0, [0, 0, 2, 0, 3]);
    set_belief_and_hand(&mut arena, 1, [0, 0, 0, 0, 1]);
    give_resource_production(&mut arena, &board, &topology, 1, Resource::Ore, 12);
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::PreRoll);
    let offers = DevOffers {
        monopoly: true,
        ..DevOffers::default()
    };
    let held = devcards::pre_roll_choice(&view, &DevCardParams::default(), offers, None);
    assert_eq!(held, None);
    let play_params = DevCardParams {
        hold_discount: 0.0,
        ..DevCardParams::default()
    };
    assert!(matches!(
        devcards::pre_roll_choice(&view, &play_params, offers, None),
        Some(DevPlay::Monopoly { .. })
    ));
}

#[test]
fn a_large_monopoly_beats_a_goal_completing_year_of_plenty() {
    let (topology, board, _rules, _config, mut arena) = fixture();
    arena.state.vertex_owner[0] = 0;
    arena.state.vertex_tier[0] = 1;
    set_belief_and_hand(&mut arena, 0, [0, 0, 2, 0, 1]);
    set_belief_and_hand(&mut arena, 1, [0, 0, 0, 0, 8]);
    arena.state.players[0].playable_dev[3] = 1;
    arena.state.players[0].playable_dev[4] = 1;
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::PreRoll);
    let choice = devcards::pre_roll_choice(
        &view,
        &DevCardParams::default(),
        DevOffers {
            plenty: Some((Resource::Ore, Resource::Ore)),
            monopoly: true,
            road: None,
        },
        Some([0, 0, 2, 0, 3]),
    );
    assert!(matches!(choice, Some(DevPlay::Monopoly { .. })));
    let (baseline, arm) = heuristic_choices(&view);
    assert!(
        matches!(baseline, Some(DevPlay::YearOfPlenty { .. })),
        "baseline={baseline:?}"
    );
    assert!(matches!(arm, Some(DevPlay::Monopoly { .. })), "arm={arm:?}");
}

#[test]
fn a_goal_completing_year_of_plenty_beats_a_trivial_monopoly() {
    let (topology, board, _rules, _config, mut arena) = fixture();
    arena.state.vertex_owner[0] = 0;
    arena.state.vertex_tier[0] = 1;
    set_belief_and_hand(&mut arena, 0, [0, 0, 2, 0, 1]);
    set_belief_and_hand(&mut arena, 1, [0, 0, 0, 0, 1]);
    arena.state.players[0].playable_dev[3] = 1;
    arena.state.players[0].playable_dev[4] = 1;
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::PreRoll);
    let choice = devcards::pre_roll_choice(
        &view,
        &DevCardParams::default(),
        DevOffers {
            plenty: Some((Resource::Wood, Resource::Brick)),
            monopoly: true,
            road: None,
        },
        Some([1, 1, 1, 1, 0]),
    );
    assert!(matches!(choice, Some(DevPlay::YearOfPlenty { .. })));
    let (baseline, arm) = heuristic_choices(&view);
    assert!(matches!(baseline, Some(DevPlay::YearOfPlenty { .. })));
    assert!(matches!(arm, Some(DevPlay::YearOfPlenty { .. })));
}

#[test]
fn completion_bonus_reaches_the_scorer_through_heuristic_pre_roll() {
    let (topology, board, _rules, _config, mut arena) = fixture();
    arena.state.vertex_owner[0] = 0;
    arena.state.vertex_tier[0] = 1;
    set_belief_and_hand(&mut arena, 0, [0, 0, 2, 0, 1]);
    set_belief_and_hand(&mut arena, 1, [4, 0, 0, 0, 0]);
    arena.state.players[0].playable_dev[3] = 1;
    arena.state.players[0].playable_dev[4] = 1;
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::PreRoll);
    let params = DevCardParams::default();
    let offers = DevOffers {
        plenty: Some((Resource::Ore, Resource::Ore)),
        monopoly: true,
        road: None,
    };
    let with_goal = devcards::score_candidates(&view, &params, offers, Some([0, 0, 2, 0, 3]));
    let without_goal = devcards::score_candidates(&view, &params, offers, None);

    // Measured on this live fixture: with the inferred goal, YoP 0.406696725 beats
    // Monopoly 0.057237252; without goal_cost, YoP 0.056696725 loses to Monopoly
    // 0.057237252. Completion is therefore decisive rather than the only offered outcome.
    eprintln!(
        "M20 fixture withGoalYoP={:.9} withGoalMonopoly={:.9} withoutGoalYoP={:.9} withoutGoalMonopoly={:.9}",
        with_goal.scored[1].unwrap().score,
        with_goal.scored[2].unwrap().score,
        without_goal.scored[1].unwrap().score,
        without_goal.scored[2].unwrap().score,
    );
    assert_eq!(
        devcards::pre_roll_choice(&view, &params, offers, None),
        Some(DevPlay::Monopoly {
            resource: Resource::Wood
        })
    );
    let mut scratch = PolicyScratch::default();
    assert_eq!(
        heuristic_v1::pre_roll(
            &view,
            &mut scratch,
            &HeuristicParams {
                dev_cards: Some(params),
                ..HeuristicParams::default()
            },
        ),
        Some(DevPlay::YearOfPlenty {
            first: Resource::Ore,
            second: Resource::Ore,
        })
    );
}

#[test]
fn devcards_pre_roll_forwards_non_default_card_params() {
    let (topology, board, _rules, _config, mut arena) = fixture();
    arena.state.vertex_owner[0] = 0;
    arena.state.vertex_tier[0] = 1;
    set_belief_and_hand(&mut arena, 0, [0, 0, 2, 0, 1]);
    set_belief_and_hand(&mut arena, 1, [4, 0, 0, 0, 0]);
    arena.state.players[0].playable_dev[3] = 1;
    arena.state.players[0].playable_dev[4] = 1;
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::PreRoll);
    let mut default_scratch = PolicyScratch::default();
    let default_choice = heuristic_v1::pre_roll(
        &view,
        &mut default_scratch,
        &HeuristicParams {
            dev_cards: Some(DevCardParams::default()),
            ..HeuristicParams::default()
        },
    );
    assert_eq!(
        default_choice,
        Some(DevPlay::YearOfPlenty {
            first: Resource::Ore,
            second: Resource::Ore,
        })
    );
    let mut custom_scratch = PolicyScratch::default();
    let custom_choice = heuristic_v1::pre_roll(
        &view,
        &mut custom_scratch,
        &HeuristicParams {
            dev_cards: Some(DevCardParams {
                completion_weight: 0.0,
                ..DevCardParams::default()
            }),
            ..HeuristicParams::default()
        },
    );
    assert_eq!(
        custom_choice,
        Some(DevPlay::Monopoly {
            resource: Resource::Wood,
        })
    );
}

#[test]
fn road_building_is_compared_on_value_not_taken_last() {
    let (topology, board, mut rules, config, mut arena) = fixture();
    set_belief_and_hand(&mut arena, 0, [2, 2, 2, 2, 2]);
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::PreRoll);
    let choice = devcards::pre_roll_choice(
        &view,
        &DevCardParams::default(),
        DevOffers {
            plenty: Some((Resource::Sheep, Resource::Wheat)),
            monopoly: false,
            road: Some((Some(0), Some(1))),
        },
        None,
    );
    assert!(matches!(choice, Some(DevPlay::RoadBuilding { .. })));

    rules
        .buildables
        .iter_mut()
        .find(|buildable| buildable.kind == Buildable::City)
        .unwrap()
        .costs
        .push([1, 0, 0, 1, 0]);
    arena.prepare(&board, &topology, &rules, &config);
    arena.state.vertex_owner[0] = 0;
    arena.state.vertex_tier[0] = 1;
    set_belief_and_hand(&mut arena, 0, [0, 0, 2, 0, 3]);
    arena.state.players[0].playable_dev[2] = 1;
    arena.state.players[0].playable_dev[3] = 1;
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::PreRoll);
    let (baseline, arm) = heuristic_choices(&view);
    assert!(matches!(baseline, Some(DevPlay::YearOfPlenty { .. })));
    assert!(matches!(arm, Some(DevPlay::RoadBuilding { .. })));
}

#[test]
fn year_of_plenty_never_names_a_pair_the_bank_cannot_cover() {
    let (topology, board, mut rules, config, mut arena) = fixture();
    let city = rules
        .buildables
        .iter_mut()
        .find(|spec| spec.kind == Buildable::City)
        .unwrap();
    city.costs = vec![[0, 2, 0, 0, 0], [2, 0, 0, 0, 0]];
    arena.prepare(&board, &topology, &rules, &config);
    arena.state.vertex_owner[0] = 0;
    arena.state.vertex_tier[0] = 1;
    arena.state.players[0].pieces[Buildable::Road.index()] = 0;
    arena.state.players[0].pieces[Buildable::Settlement.index()] = 0;
    arena.state.players[0].playable_dev[3] = 1;
    arena.state.bank[Resource::Sheep.index()] = 0;
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::PreRoll);
    let params = HeuristicParams {
        dev_cards: Some(DevCardParams::default()),
        ..HeuristicParams::default()
    };
    let mut scratch = PolicyScratch::default();
    let choice = heuristic_v1::pre_roll(&view, &mut scratch, &params);
    let Some(DevPlay::YearOfPlenty { first, second }) = choice else {
        panic!("expected a bank-legal Year of Plenty pair, got {choice:?}");
    };
    assert_ne!(first, Resource::Sheep);
    assert_ne!(second, Resource::Sheep);
    assert!(!matches!(
        Some(DevPlay::YearOfPlenty { first, second }),
        Some(DevPlay::YearOfPlenty {
            first: Resource::Sheep,
            ..
        })
    ));
}

#[test]
fn gain_is_zero_for_an_empty_delta_and_strictly_increases_in_a_needed_resource() {
    let context = synthetic_context([0.0; RESOURCE_COUNT]);
    let params = DevCardParams::default();
    let empty = devcards::gain(&context, &params, &context.own, context.etw_now, &[0.0; 5]);
    let needed = devcards::gain(
        &context,
        &params,
        &context.own,
        context.etw_now,
        &[0.0, 1.0, 0.0, 0.0, 0.0],
    );
    assert_eq!(empty, 0.0);
    assert!(needed > empty);
}

#[test]
fn gain_rejects_non_finite_caller_supplied_base_etw() {
    let (topology, board, _rules, _config, arena) = fixture();
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::PreRoll);
    let context = devcards::context(&view, &DevCardParams::default());
    let delta = [1.0, 0.0, 0.0, 0.0, 0.0];
    for base_etw in [f64::NAN, f64::INFINITY] {
        assert_eq!(
            devcards::gain(
                &context,
                &DevCardParams::default(),
                &context.own,
                base_etw,
                &delta,
            ),
            0.0
        );
    }
}

#[test]
fn gain_is_clamped_by_gain_cap_on_an_interior_fixture() {
    let context = synthetic_context([1.0, 1.0, 1.0, 1.0, 0.0]);
    let params = DevCardParams {
        gain_cap: 0.001,
        ..DevCardParams::default()
    };
    assert_eq!(
        devcards::gain(
            &context,
            &params,
            &context.own,
            context.etw_now,
            &[0.0, 0.0, 0.0, 0.0, 1.0]
        ),
        0.001
    );
    let mut stalled = synthetic_context([0.0; RESOURCE_COUNT]);
    stalled.inputs.production_pips = [0; RESOURCE_COUNT];
    stalled.etw_now = etw::expected_turns_to_win(&stalled.inputs);
    let stalled_gain = devcards::gain(
        &stalled,
        &DevCardParams::default(),
        &stalled.own,
        stalled.etw_now,
        &[1.0; RESOURCE_COUNT],
    );
    assert_eq!(stalled_gain, 0.0);
    assert!(stalled_gain.is_finite());
    let mut won = synthetic_context([0.0; RESOURCE_COUNT]);
    won.inputs.public_vp = won.inputs.win_vp;
    won.etw_now = etw::expected_turns_to_win(&won.inputs);
    let won_gain = devcards::gain(
        &won,
        &DevCardParams::default(),
        &won.own,
        won.etw_now,
        &[1.0; RESOURCE_COUNT],
    );
    assert_eq!(won_gain, 0.0);
    assert!(won_gain.is_finite());
}

#[cfg(debug_assertions)]
#[test]
#[should_panic]
fn params_domain_guard_panics_in_debug_from_context() {
    let (topology, board, _rules, _config, arena) = fixture();
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::PreRoll);
    devcards::context(
        &view,
        &DevCardParams {
            etw_floor: 0.0,
            ..DevCardParams::default()
        },
    );
}

#[cfg(debug_assertions)]
#[test]
#[should_panic]
fn params_domain_guard_panics_in_debug_from_gain() {
    let context = synthetic_context([0.0; 5]);
    devcards::gain(
        &context,
        &DevCardParams {
            etw_floor: 0.0,
            ..DevCardParams::default()
        },
        &context.own,
        context.etw_now,
        &[0.0; 5],
    );
}

#[cfg(debug_assertions)]
#[test]
#[should_panic]
fn params_domain_guard_panics_in_debug_from_tempo() {
    let context = synthetic_context([0.0; 5]);
    devcards::tempo(
        &context,
        &DevCardParams {
            tempo_half: 0.0,
            ..DevCardParams::default()
        },
        &context.own,
        &[0.0; 5],
    );
}

#[cfg(debug_assertions)]
#[test]
#[should_panic]
fn params_domain_guard_panics_in_debug_from_monopoly_resource() {
    let context = synthetic_context([0.0; 5]);
    devcards::monopoly_resource(
        &context,
        &DevCardParams {
            etw_floor: 0.0,
            ..DevCardParams::default()
        },
        &context.own,
        context.etw_now,
        &[0.0; 5],
    );
}

#[cfg(debug_assertions)]
#[test]
#[should_panic]
fn params_domain_guard_panics_in_debug_from_score_candidates() {
    let (topology, board, _rules, _config, arena) = fixture();
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::PreRoll);
    devcards::score_candidates(
        &view,
        &DevCardParams {
            etw_floor: 0.0,
            ..DevCardParams::default()
        },
        DevOffers::default(),
        None,
    );
}

#[cfg(debug_assertions)]
#[test]
#[should_panic]
fn params_domain_guard_panics_in_debug_from_pre_roll_choice() {
    let (topology, board, _rules, _config, arena) = fixture();
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::PreRoll);
    devcards::pre_roll_choice(
        &view,
        &DevCardParams {
            etw_floor: 0.0,
            ..DevCardParams::default()
        },
        DevOffers::default(),
        None,
    );
}

#[test]
fn devcards_ignores_hidden_composition_of_identical_public_streams() {
    let (topology, board, rules, config, mut first) = fixture();
    let mut second = GameArena::default();
    second.prepare(&board, &topology, &rules, &config);
    first.state.players[1].resources = [5, 0, 0, 0, 0];
    second.state.players[1].resources = [0, 0, 0, 0, 5];
    let offers = DevOffers {
        monopoly: true,
        ..DevOffers::default()
    };
    let first_view = first.decision_view(&board, &topology, 0, DecisionPhase::PreRoll);
    let second_view = second.decision_view(&board, &topology, 0, DecisionPhase::PreRoll);
    assert_eq!(first_view.to_owned(), second_view.to_owned());
    assert_eq!(
        devcards::pre_roll_choice(&first_view, &DevCardParams::default(), offers, None),
        devcards::pre_roll_choice(&second_view, &DevCardParams::default(), offers, None)
    );
}

#[test]
fn ties_break_first_in_source_order_and_hold_wins_an_exact_tie() {
    let mut context = synthetic_context([2.0; 5]);
    context.haul_expected = [2.0, 2.0, 0.0, 0.0, 0.0];
    context.haul_sound = [2.0, 2.0, 0.0, 0.0, 0.0];
    assert_eq!(
        devcards::monopoly_resource(
            &context,
            &DevCardParams::default(),
            &context.own,
            context.etw_now,
            &context.haul_expected
        )
        .map(|value| value.0),
        Some(Resource::Wood)
    );
    let (topology, board, _rules, _config, mut arena) = fixture();
    arena.state.players[0].vp_public = 5;
    set_belief_and_hand(&mut arena, 0, [0, 0, 2, 0, 3]);
    set_belief_and_hand(&mut arena, 1, [0, 0, 0, 0, 1]);
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::PreRoll);
    let tie_params = DevCardParams {
        hold_discount: 1.0,
        haul_growth: 0.0,
        ..DevCardParams::default()
    };
    assert_eq!(
        devcards::pre_roll_choice(
            &view,
            &tie_params,
            DevOffers {
                monopoly: true,
                ..DevOffers::default()
            },
            None,
        ),
        None
    );
}

#[test]
fn the_devcards_arm_does_not_change_scratch_goal() {
    let (topology, board, _rules, _config, arena) = fixture();
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::PreRoll);
    let mut off = PolicyScratch::default();
    let mut on = PolicyScratch::default();
    heuristic_v1::pre_roll(&view, &mut off, &HeuristicParams::default());
    heuristic_v1::pre_roll(
        &view,
        &mut on,
        &HeuristicParams {
            dev_cards: Some(DevCardParams::default()),
            ..HeuristicParams::default()
        },
    );
    assert_eq!(off.goal, on.goal);
}

#[test]
fn monopoly_considers_resources_outside_the_current_goal() {
    let mut context = synthetic_context([0.0; 5]);
    context.haul_expected[Resource::Brick.index()] = 9.0;
    context.haul_sound[Resource::Brick.index()] = 9.0;
    assert_eq!(
        devcards::monopoly_resource(
            &context,
            &DevCardParams::default(),
            &context.own,
            context.etw_now,
            &context.haul_expected
        )
        .map(|value| value.0),
        Some(Resource::Brick)
    );

    let (topology, board, _rules, _config, mut arena) = fixture();
    arena.state.vertex_owner[0] = 0;
    arena.state.vertex_tier[0] = 1;
    set_belief_and_hand(&mut arena, 0, [0, 0, 1, 0, 3]);
    set_belief_and_hand(&mut arena, 1, [0, 0, 0, 9, 0]);
    arena.state.players[0].playable_dev[4] = 1;
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::PreRoll);
    let (baseline, arm) = heuristic_choices_with(&view, exposure_free());
    assert!(!matches!(baseline, Some(DevPlay::Monopoly { .. })));
    assert_eq!(monopoly(arm), Some(Resource::Brick));
}

#[test]
fn free_roads_never_claim_a_completion_bonus() {
    let (topology, board, _rules, _config, arena) = fixture();
    let offers = DevOffers {
        plenty: Some((Resource::Wood, Resource::Brick)),
        monopoly: false,
        road: Some((Some(0), Some(1))),
    };
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::PreRoll);
    let zero = devcards::score_candidates(
        &view,
        &DevCardParams {
            completion_weight: 0.0,
            ..DevCardParams::default()
        },
        offers,
        Some([1, 0, 0, 1, 0]),
    );
    let high = devcards::score_candidates(
        &view,
        &DevCardParams {
            completion_weight: 100.0,
            ..DevCardParams::default()
        },
        offers,
        Some([1, 0, 0, 1, 0]),
    );
    assert_eq!(zero.scored[3].unwrap().score, high.scored[3].unwrap().score);
    assert_ne!(zero.scored[1].unwrap().score, high.scored[1].unwrap().score);
}

#[test]
fn plateau_states_are_still_ranked_by_the_tempo_term() {
    for hand in [[0.0, 0.0, 2.0, 0.0, 3.0], [2.0; 5]] {
        let (topology, board, _rules, _config, mut arena) = fixture();
        set_belief_and_hand(&mut arena, 0, hand.map(|value| value as u16));
        set_belief_and_hand(&mut arena, 1, [8, 0, 0, 0, 0]);
        arena.state.vertex_owner[0] = 0;
        arena.state.vertex_tier[0] = 1;
        let candidates = score_for_live_view(
            &arena,
            &board,
            &topology,
            DevOffers {
                plenty: Some((Resource::Sheep, Resource::Wheat)),
                monopoly: true,
                road: Some((Some(0), Some(1))),
            },
            None,
            &exposure_free(),
        );
        let context = &candidates.context;
        let params = DevCardParams::default();
        let yop = [0.0, 1.0, 1.0, 0.0, 0.0];
        let road = [2.0, 0.0, 0.0, 2.0, 0.0];
        let mono = [8.0, 0.0, 0.0, 0.0, 0.0];
        let gains = [
            road,
            yop,
            [2.0, 0.0, 0.0, 0.0, 0.0],
            mono,
            [0.0, 0.0, 0.0, 0.0, 8.0],
        ]
        .map(|delta| devcards::gain(context, &params, &hand, context.etw_now, &delta));
        assert!(
            gains
                .iter()
                .all(|gain| gain.to_bits() == gains[0].to_bits())
        );
        let scores = [
            candidates.scored[1].unwrap().score,
            candidates.scored[3].unwrap().score,
            candidates.scored[2].unwrap().score,
        ];
        eprintln!("plateau hand={hand:?} gains={gains:?} scores={scores:?}");
        assert!(scores[0] < scores[1] && scores[1] < scores[2]);
    }
}

#[test]
fn observer_scores_from_its_exact_hand_after_being_stolen_from() {
    let (topology, board, _rules, _config, mut arena) = fixture();
    set_belief_and_hand(&mut arena, 0, [1, 1, 1, 1, 1]);
    set_belief_and_hand(&mut arena, 1, [1, 0, 0, 0, 0]);
    arena.state.belief.steal(1, 0);
    arena.state.players[0].resources[Resource::Wood.index()] -= 1;
    arena.state.players[1].resources[Resource::Wood.index()] += 1;
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::PreRoll);
    assert_ne!(view.belief().expected(0), view.own_hand().map(f64::from));
    assert_eq!(
        devcards::context(&view, &DevCardParams::default())
            .inputs
            .belief_expected,
        view.own_hand().map(|value| f64::from(value.max(0)))
    );
    let mut exact_context = synthetic_context([0.0, 0.0, 2.0, 0.0, 3.0]);
    exact_context.haul_sound = [1.0; RESOURCE_COUNT];
    let belief_hand = [0.0; RESOURCE_COUNT];
    let mut differing = None;
    'outer: for first in 1..=12 {
        for second in 1..=12 {
            let haul = [f64::from(first), f64::from(second), 1.0, 1.0, 1.0];
            let exact = devcards::monopoly_resource(
                &exact_context,
                &DevCardParams::default(),
                &exact_context.own,
                exact_context.etw_now,
                &haul,
            )
            .unwrap()
            .0;
            let belief_etw = etw::expected_turns_to_win(&inputs(belief_hand));
            let belief = devcards::monopoly_resource(
                &exact_context,
                &DevCardParams::default(),
                &belief_hand,
                belief_etw,
                &haul,
            )
            .unwrap()
            .0;
            if exact != belief {
                differing = Some((
                    DevPlay::Monopoly { resource: exact },
                    DevPlay::Monopoly { resource: belief },
                ));
                break 'outer;
            }
        }
    }
    let (exact_play, belief_play) = differing.expect("fixture needs exact/belief disagreement");
    assert_ne!(exact_play, belief_play);
}

#[test]
fn a_fixed_size_card_is_never_worth_deferring() {
    let (topology, board, rules, config, arena) = fixture();
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::PreRoll);
    for offers in [
        DevOffers {
            plenty: Some((Resource::Sheep, Resource::Wheat)),
            ..DevOffers::default()
        },
        DevOffers {
            road: Some((Some(0), Some(1))),
            ..DevOffers::default()
        },
    ] {
        let candidates = devcards::score_candidates(&view, &DevCardParams::default(), offers, None);
        assert_eq!(candidates.scored[0].unwrap().score, 0.0);
        assert!(
            devcards::pre_roll_choice(&view, &DevCardParams::default(), offers, None).is_some()
        );
    }

    let mut with_monopoly = GameArena::default();
    with_monopoly.prepare(&board, &topology, &rules, &config);
    set_belief_and_hand(&mut with_monopoly, 1, [0, 0, 0, 0, 1]);
    let view = with_monopoly.decision_view(&board, &topology, 0, DecisionPhase::PreRoll);
    let first_offers = DevOffers {
        plenty: Some((Resource::Sheep, Resource::Wheat)),
        monopoly: true,
        road: Some((Some(0), Some(1))),
    };
    let second_offers = DevOffers {
        plenty: Some((Resource::Brick, Resource::Brick)),
        ..first_offers
    };
    let first = devcards::score_candidates(&view, &DevCardParams::default(), first_offers, None);
    let second = devcards::score_candidates(&view, &DevCardParams::default(), second_offers, None);
    let road_changed = devcards::score_candidates(
        &view,
        &DevCardParams::default(),
        DevOffers {
            road: Some((Some(4), None)),
            ..first_offers
        },
        None,
    );
    let projected_yop = first.scored[1].unwrap().score;
    let projected_monopoly = first.scored[2].unwrap().score;
    eprintln!(
        "M33 fixture projectedYoP={projected_yop:.9} projectedMonopoly={projected_monopoly:.9}"
    );
    assert!(
        projected_yop > projected_monopoly,
        "M33 bracket requires projected YoP > projected Monopoly"
    );
    assert_eq!(
        first.scored[0].unwrap().score.to_bits(),
        second.scored[0].unwrap().score.to_bits()
    );
    assert_eq!(
        first.scored[0].unwrap().score.to_bits(),
        road_changed.scored[0].unwrap().score.to_bits()
    );
}

#[test]
fn a_needed_card_outranks_a_surplus_card_of_equal_count() {
    let context = synthetic_context([0.0; 5]);
    let params = DevCardParams::default();
    let needed = devcards::tempo(&context, &params, &context.own, &[0.0, 1.0, 0.0, 0.0, 0.0]);
    let surplus = devcards::tempo(&context, &params, &context.own, &[1.0, 0.0, 0.0, 0.0, 0.0]);
    assert!(needed > surplus);
}

#[test]
fn cheapest_route_shortfall_returns_raw_magnitudes_not_shares() {
    let first = threat::cheapest_route_shortfall(&inputs([0.0; 5]));
    assert_eq!(first, [0.0, 1.0, 1.0, 0.0, 1.0]);
    assert_eq!(first.iter().sum::<f64>(), 3.0);
    let mut no_dev = inputs([0.0; 5]);
    no_dev.dev_deck_remaining = 0;
    let second = threat::cheapest_route_shortfall(&no_dev);
    assert_eq!(second, [0.0, 0.0, 2.0, 0.0, 3.0]);
    assert_eq!(second.iter().sum::<f64>(), 5.0);
}

#[test]
fn the_hold_option_is_reachable_in_a_plateau_state() {
    let (topology, board, _rules, _config, mut arena) = fixture();
    arena.state.players[0].vp_public = 5;
    set_belief_and_hand(&mut arena, 0, [0, 0, 2, 0, 3]);
    set_belief_and_hand(&mut arena, 1, [0, 0, 0, 0, 1]);
    give_resource_production(&mut arena, &board, &topology, 1, Resource::Ore, 12);
    let offers = DevOffers {
        monopoly: true,
        ..DevOffers::default()
    };
    let candidates =
        score_for_live_view(&arena, &board, &topology, offers, None, &DevCardParams::default());
    assert!(candidates.scored[2].is_some());
    assert!(candidates.scored[0].unwrap().score > candidates.scored[2].unwrap().score);
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::PreRoll);
    assert_eq!(
        devcards::pre_roll_choice(&view, &DevCardParams::default(), offers, None),
        None
    );
}

#[test]
fn the_hold_projection_uses_the_projected_hand_at_the_boundary() {
    let (topology, board, mut rules, config, mut arena) = fixture();
    rules.dev_deck.knight = 12;
    rules.dev_deck.victory_point = 5;
    rules.dev_deck.road_building = 1;
    rules.dev_deck.year_of_plenty = 1;
    rules.dev_deck.monopoly = 1;
    arena.prepare(&board, &topology, &rules, &config);
    give_exact_production(&mut arena, &board, &topology, 0, [8, 5, 9, 6, 4]);
    arena.state.players[0].vp_public = 5;
    arena.state.players[0].pieces[Buildable::Settlement.index()] = 3;
    arena.state.players[0].pieces[Buildable::City.index()] = 3;
    set_belief_and_hand(&mut arena, 0, [1, 1, 1, 1, 0]);
    set_belief_and_hand(&mut arena, 1, [0, 0, 0, 0, 1]);
    arena.state.players[0].playable_dev[4] = 1;
    for seat in 1..5 {
        arena.state.players[seat].playable_dev[0] = 1;
    }
    give_resource_production(&mut arena, &board, &topology, 1, Resource::Ore, 12);
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::PreRoll);
    let offers = DevOffers {
        monopoly: true,
        ..DevOffers::default()
    };
    let candidates = devcards::score_candidates(&view, &DevCardParams::default(), offers, None);
    let play = candidates.scored[2].unwrap();
    let hold = candidates.scored[0].unwrap();
    assert!(matches!(
        devcards::pre_roll_choice(&view, &DevCardParams::default(), offers, None),
        Some(DevPlay::Monopoly { .. })
    ));
    assert!(hold.score < play.score);
    assert!(
        play.score - hold.score >= 0.005,
        "boundary margin={} play={} hold={}",
        play.score - hold.score,
        play.score,
        hold.score
    );
    assert!(
        devcards::monopoly_resource(
            &candidates.context,
            &DevCardParams::default(),
            &candidates.context.own,
            candidates.context.etw_now,
            &candidates.context.haul_expected,
        )
        .is_some()
    );
    assert_eq!(
        devcards::pre_roll_choice(&view, &DevCardParams::default(), offers, None),
        play.play
    );
}

#[test]
fn the_projected_base_hand_decides_whether_to_hold_monopoly() {
    // This is a hand-authored scorer fixture and intentionally does not satisfy
    // GameArena::invariants_hold. That is the established policy-unit convention; the separate
    // fixed-seed GameArena::play test corroborates that the M21 flip is reachable in legal play.
    let (topology, board, mut rules, config, mut arena) = fixture();
    rules.dev_deck.knight = 12;
    rules.dev_deck.victory_point = 5;
    rules.dev_deck.road_building = 1;
    rules.dev_deck.year_of_plenty = 1;
    rules.dev_deck.monopoly = 1;
    arena.prepare(&board, &topology, &rules, &config);
    give_exact_production(&mut arena, &board, &topology, 0, [8, 5, 9, 6, 4]);
    arena.state.players[0].vp_public = 5;
    arena.state.players[0].pieces[Buildable::Settlement.index()] = 3;
    arena.state.players[0].pieces[Buildable::City.index()] = 3;
    set_belief_and_hand(&mut arena, 0, [0; RESOURCE_COUNT]);
    set_belief_and_hand(&mut arena, 1, [0, 0, 0, 0, 1]);
    arena.state.players[0].playable_dev[4] = 1;
    for seat in 1..5 {
        arena.state.players[seat].playable_dev[0] = 1;
    }
    give_resource_production(&mut arena, &board, &topology, 1, Resource::Ore, 12);
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::PreRoll);
    let params = DevCardParams::default();
    let offers = DevOffers {
        monopoly: true,
        ..DevOffers::default()
    };

    assert_eq!(
        devcards::pre_roll_choice(&view, &params, offers, None),
        None
    );

    let candidates = devcards::score_candidates(&view, &params, offers, None);
    let play = candidates.scored[2].unwrap();
    let hold = candidates.scored[0].unwrap();
    assert_eq!(
        play.play,
        Some(DevPlay::Monopoly {
            resource: Resource::Ore
        })
    );
    let context = &candidates.context;
    let projected_own =
        std::array::from_fn(|resource| context.own[resource] + context.own_round_income[resource]);
    let mut projected_inputs = context.inputs.clone();
    projected_inputs.belief_expected = projected_own;
    let projected_etw = etw::expected_turns_to_win(&projected_inputs);
    let projected_haul = std::array::from_fn(|resource| {
        context.haul_expected[resource] + params.haul_growth * context.haul_round_growth[resource]
    });
    let mutant_hold = devcards::monopoly_resource(
        context,
        &params,
        &context.own,
        projected_etw,
        &projected_haul,
    )
    .map_or(0.0, |(_, score)| params.hold_discount * score);

    // Default parameters on this live fixture give correct Hold 0.095889040,
    // Monopoly 0.072374101, and M21 Hold 0.045524752. The projected base hand
    // therefore decides between holding and specifically playing Monopoly for Ore.
    eprintln!(
        "M21 fixture hold={:.9} mutantHold={mutant_hold:.9} monopoly={:.9}",
        hold.score, play.score
    );
    assert!(hold.score > play.score);
    assert!(mutant_hold < play.score);
}

#[test]
fn a_held_monopoly_is_played_once_the_hand_leaves_the_plateau() {
    let (topology, board, _rules, _config, mut arena) = fixture();
    arena.state.players[0].vp_public = 5;
    give_exact_production(&mut arena, &board, &topology, 0, [8, 5, 9, 6, 4]);
    set_belief_and_hand(&mut arena, 0, [1, 1, 1, 1, 0]);
    set_belief_and_hand(&mut arena, 1, [0, 0, 0, 0, 1]);
    give_resource_production(&mut arena, &board, &topology, 1, Resource::Ore, 12);
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::PreRoll);
    assert!(matches!(
        devcards::pre_roll_choice(
            &view,
            &DevCardParams::default(),
            DevOffers {
                monopoly: true,
                ..DevOffers::default()
            },
            None
        ),
        Some(DevPlay::Monopoly { .. })
    ));
}

#[test]
fn gain_normalizes_by_the_contexts_own_etw_not_the_base_etw() {
    let context = synthetic_context([1.0, 1.0, 1.0, 1.0, 0.0]);
    let projected = std::array::from_fn(|r| context.own[r] + context.own_round_income[r]);
    let mut projected_inputs = context.inputs.clone();
    projected_inputs.belief_expected = projected;
    let projected_etw = etw::expected_turns_to_win(&projected_inputs);
    let delta = [0.0, 0.0, 0.0, 0.0, 1.6666666666666665];
    let mut after_now = context.inputs.clone();
    after_now.belief_expected = std::array::from_fn(|r| context.own[r] + delta[r]);
    let n1 = context.etw_now - etw::expected_turns_to_win(&after_now);
    let mut after_projected = context.inputs.clone();
    after_projected.belief_expected = std::array::from_fn(|r| projected[r] + delta[r]);
    let n2 = projected_etw - etw::expected_turns_to_win(&after_projected);
    assert!(n1 != 0.0 && n2 != 0.0 && n1 != n2);
    let g1 = devcards::gain(
        &context,
        &DevCardParams::default(),
        &context.own,
        context.etw_now,
        &delta,
    );
    let g2 = devcards::gain(
        &context,
        &DevCardParams::default(),
        &projected,
        projected_etw,
        &delta,
    );
    assert!(
        g1 > 0.0 && g2 > 0.0,
        "gain must be nonzero or the identity is vacuous: g1={g1} g2={g2}"
    );
    assert!((g1 * n2 - g2 * n1).abs() < 1e-12);
}

#[test]
fn outside_the_plateau_the_etw_term_leads() {
    let context = synthetic_context([0.0; 5]);
    let params = DevCardParams::default();
    let score = |delta| {
        params.etw_weight * devcards::gain(&context, &params, &context.own, context.etw_now, &delta)
            + params.tempo_weight * devcards::tempo(&context, &params, &context.own, &delta)
    };
    assert!(score([0.0, 1.0, 1.0, 0.0, 0.0]) > score([2.0, 0.0, 0.0, 2.0, 0.0]));
}

#[allow(dead_code)]
fn scored(play: Option<DevPlay>, score: f64) -> Option<ScoredDevPlay> {
    Some(ScoredDevPlay { play, score })
}

// Card-play scope: Year of Plenty offered beyond the exactly-two-short case with picks by
// value, and Monopoly reading every cost variant of the goal.
//
// Forwarded arguments of `heuristic_v1::plenty_offer`, one observing test each:
// - `view` (hand vs goal cost): plenty_prefers_the_goal_missing_resource_over_spares
// - `view` (bank stock, ranking and feasibility): plenty_spare_pick_banks_the_scarce_resource,
//   plenty_spare_picks_rank_by_own_production_then_bank
// - `view` (own production pips): plenty_spare_picks_rank_by_own_production_then_bank
// - `view` (cost variants): plenty_uses_the_closest_cost_variant
// - `goal` (`None` still offers): plenty_spare_pick_banks_the_scarce_resource
// - `params` (legacy narrow scope): plenty_legacy_scope_restores_the_two_short_gate
//
// Forwarded arguments of `heuristic_v1::monopoly_for_goal`, one observing test each:
// - `view` (opponent holdings and production): monopoly_prefers_the_belief_holding_over_the_production_proxy
// - `goal` (every cost variant): monopoly_reads_every_cost_variant_of_the_goal
// - `params` (legacy first-variant scope): monopoly_reads_every_cost_variant_of_the_goal

fn narrow_params() -> HeuristicParams {
    HeuristicParams {
        legacy_valuation: Some(LegacyValuation {
            narrow_card_plays: true,
            ..LegacyValuation::default()
        }),
        ..HeuristicParams::default()
    }
}

#[test]
fn plenty_prefers_the_goal_missing_resource_over_spares() {
    let (topology, board, _rules, _config, mut arena) = fixture();
    set_belief_and_hand(&mut arena, 0, [0, 0, 2, 0, 2]);
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::PreRoll);
    // City costs [0,0,2,0,3]: one ore short. The need pick takes the ore; the spare pick then
    // ties on zero own pips and equal banks, and the index tie-break names ore again.
    assert_eq!(
        heuristic_v1::plenty_offer(&view, Some(Buildable::City), &HeuristicParams::default()),
        Some((Resource::Ore, Resource::Ore))
    );
}

#[test]
fn plenty_legacy_scope_restores_the_two_short_gate() {
    let (topology, board, _rules, _config, mut arena) = fixture();
    set_belief_and_hand(&mut arena, 0, [0, 0, 2, 0, 2]);
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::PreRoll);
    // One short of the city was never offered under the narrow scope.
    assert_eq!(
        heuristic_v1::plenty_offer(&view, Some(Buildable::City), &narrow_params()),
        None
    );
    set_belief_and_hand(&mut arena, 0, [0, 0, 2, 0, 1]);
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::PreRoll);
    // Exactly two short still is, in index order.
    assert_eq!(
        heuristic_v1::plenty_offer(&view, Some(Buildable::City), &narrow_params()),
        Some((Resource::Ore, Resource::Ore))
    );
}

#[test]
fn plenty_spare_pick_banks_the_scarce_resource() {
    let (topology, board, _rules, _config, mut arena) = fixture();
    arena.state.bank[Resource::Wood.index()] = 5;
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::PreRoll);
    // No goal at all: the card still banks two spares. With no own production the scarcest
    // bank stock wins both picks; were bank stock ignored the index tie-break would name ore.
    assert_eq!(
        heuristic_v1::plenty_offer(&view, None, &HeuristicParams::default()),
        Some((Resource::Wood, Resource::Wood))
    );
    // The narrow scope had no goalless offer.
    assert_eq!(heuristic_v1::plenty_offer(&view, None, &narrow_params()), None);
}

#[test]
fn plenty_spare_picks_rank_by_own_production_then_bank() {
    let (topology, board, _rules, _config, mut arena) = fixture();
    give_exact_production(&mut arena, &board, &topology, 0, [8, 5, 9, 6, 4]);
    arena.state.bank[Resource::Ore.index()] = 1;
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::PreRoll);
    // Ore has the fewest own pips (4) and one card left in the bank; the first pick takes it
    // and exhausts the stock. The second pick falls to sheep (5 pips), not brick -- the index
    // tie-break would name brick only if own production were ignored.
    assert_eq!(
        heuristic_v1::plenty_offer(&view, None, &HeuristicParams::default()),
        Some((Resource::Sheep, Resource::Ore))
    );
}

#[test]
fn plenty_uses_the_closest_cost_variant() {
    let (topology, board, rules, _config, _arena) = fixture();
    let mut config = GameConfig::default();
    config.modifiers[0]
        .extra_cost_alternatives
        .push((Buildable::Settlement, [0, 0, 0, 4, 0]));
    let mut arena = GameArena::default();
    arena.prepare(&board, &topology, &rules, &config);
    set_belief_and_hand(&mut arena, 0, [0, 0, 0, 3, 0]);
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::PreRoll);
    // The base settlement cost [1,1,1,1,0] is three short; the brick alternative [0,0,0,4,0]
    // is one short and wins. The need pick takes the brick, the spare tie resolves to ore.
    assert_eq!(
        heuristic_v1::plenty_offer(&view, Some(Buildable::Settlement), &HeuristicParams::default()),
        Some((Resource::Brick, Resource::Ore))
    );
}

#[test]
fn plenty_picks_missing_resources_by_value_not_index_order() {
    let (topology, board, _rules, _config, mut arena) = fixture();
    set_belief_and_hand(&mut arena, 0, [0, 0, 0, 3, 0]);
    arena.state.bank[Resource::Wheat.index()] = 2;
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::PreRoll);
    // Three short of the base settlement cost: wood, sheep and wheat all carry need 1, so the
    // scarcer wheat stock and then the index tie-break decide. Index-order picking would have
    // named wood and sheep.
    assert_eq!(
        heuristic_v1::plenty_offer(&view, Some(Buildable::Settlement), &HeuristicParams::default()),
        Some((Resource::Sheep, Resource::Wheat))
    );
}

#[test]
fn plenty_degrades_a_bank_blocked_need_to_a_spare() {
    let (topology, board, _rules, _config, mut arena) = fixture();
    set_belief_and_hand(&mut arena, 0, [0, 0, 2, 0, 0]);
    arena.state.bank[Resource::Ore.index()] = 1;
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::PreRoll);
    // Three ore short of the city with one ore banked: the first pick takes the last ore, and
    // the still-unmet need degrades to a spare pick (index tie-break: brick) instead of
    // cancelling the offer.
    assert_eq!(
        heuristic_v1::plenty_offer(&view, Some(Buildable::City), &HeuristicParams::default()),
        Some((Resource::Brick, Resource::Ore))
    );
}

#[test]
fn monopoly_reads_every_cost_variant_of_the_goal() {
    let (topology, board, rules, _config, _arena) = fixture();
    let mut config = GameConfig::default();
    config.modifiers[0]
        .extra_cost_alternatives
        .push((Buildable::Settlement, [0, 0, 0, 0, 4]));
    let mut arena = GameArena::default();
    arena.prepare(&board, &topology, &rules, &config);
    set_belief_and_hand(&mut arena, 0, [1, 1, 1, 1, 0]);
    set_belief_and_hand(&mut arena, 1, [0, 0, 0, 0, 6]);
    give_resource_production(&mut arena, &board, &topology, 1, Resource::Ore, 12);
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::PreRoll);
    // The base settlement cost is fully covered, so the first variant alone finds no missing
    // resource; the ore alternative is four short and the opponent's ore holding is takeable.
    assert_eq!(
        heuristic_v1::monopoly_for_goal(&view, Buildable::Settlement, &HeuristicParams::default()),
        Some(Resource::Ore)
    );
    assert_eq!(
        heuristic_v1::monopoly_for_goal(&view, Buildable::Settlement, &narrow_params()),
        None
    );
}

#[test]
fn both_pre_roll_paths_receive_the_widened_offer() {
    let (topology, board, _rules, _config, mut arena) = fixture();
    arena.state.players[0].playable_dev[3] = 1;
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::PreRoll);
    // Empty board and empty hand: no goal exists, so the narrow scope never offered the card.
    // Both paths now bank two spares (equal banks, no own production: index tie-break, ore).
    let (baseline, arm) = heuristic_choices(&view);
    let expected = Some(DevPlay::YearOfPlenty {
        first: Resource::Ore,
        second: Resource::Ore,
    });
    assert_eq!(baseline, expected);
    assert_eq!(arm, expected);
    // The legacy composite restores the pre-widening hold on both paths.
    let mut narrow = narrow_params();
    assert_eq!(
        heuristic_v1::pre_roll(&view, &mut PolicyScratch::default(), &narrow),
        None
    );
    narrow.dev_cards = Some(DevCardParams::default());
    assert_eq!(
        heuristic_v1::pre_roll(&view, &mut PolicyScratch::default(), &narrow),
        None
    );
}

// Deck-composition-aware dev buying (SIM-GAP-17). `heuristic_v1::dev_buy_score` prices a buy by
// what the remaining deck can still contain, via `DecisionView::deck_belief`.
//
// Forwarded arguments of `heuristic_v1::dev_buy_score`, one observing test each:
// - `view` (deck composition: revealed plays, own held cards, undrawn count):
//   vp_rich_small_deck_near_win_boosts_the_buy,
//   knight_only_deck_with_largest_army_held_is_near_worthless
// - `view` (largest-army state: holder, knights played, contest gap):
//   knight_only_deck_with_largest_army_held_is_near_worthless
// - `params` (`legacy_valuation.deck_blind_buying` restores the flat base):
//   deck_blind_legacy_restores_the_composition_blind_score
// - `params` (`denial` gates the contest pressure, non-default `pressure_floor`):
//   the_gated_denial_pressure_reaches_the_buy_score
//
// The derivation itself (bounds, apportioning, the `DeckBelief::derive` argument table) is
// pinned in tests/belief.rs.

/// 29 of extension6's 34 cards accounted for, leaving [2 knights, 3 VP, 0, 0, 0] exactly:
/// 18 knights and all 9 progress cards revealed as plays, 2 VP held by the observer.
/// The observer sits at 8 of 10 VP.
fn vp_rich_near_win_state() -> (Topology, SimBoard, GameArena) {
    let (topology, board, _rules, _config, mut arena) = fixture();
    arena.state.players[1].dev_plays_revealed[0] = 18;
    arena.state.players[1].dev_plays_revealed[2] = 3;
    arena.state.players[1].dev_plays_revealed[3] = 3;
    arena.state.players[1].dev_plays_revealed[4] = 3;
    arena.state.players[0].vp_dev = 2;
    arena.state.players[0].vp_public = 6;
    arena.drain_dev_deck_for_test(29);
    (topology, board, arena)
}

#[test]
fn vp_rich_small_deck_near_win_boosts_the_buy() {
    let (topology, board, arena) = vp_rich_near_win_state();
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let score = heuristic_v1::dev_buy_score(&view, &HeuristicParams::default());
    // Closed form: exact composition [2, 3, 0, 0, 0] of 5 remaining, initial mix 20/5/9 of 34.
    let share_vp = 3.0_f32 / 5.0;
    let share_knight = 2.0_f32 / 5.0;
    let vp_rel = share_vp / (5.0_f32 / 34.0);
    let knight_rel = share_knight / (20.0_f32 / 34.0);
    let progress_rel = 0.0_f32;
    let base = 45.0 * (0.55 * vp_rel + 0.35 * progress_rel + 0.10 * knight_rel);
    let proximity = 8.0_f32 / 10.0;
    let vp_chase = share_vp * 300.0 * proximity;
    // No holder: the contest gap is the full largest-army minimum of 3, ungated pressure 1.
    let contest = 25.0 * (0.5 + proximity) * 1.0 * knight_rel;
    assert_eq!(score, base + vp_chase + contest);
    // The composition-blind score for the same state, for direction: the fix must boost.
    assert!(score > 45.0 + 25.0 * (0.5 + proximity) * 1.0);
}

#[test]
fn knight_only_deck_with_largest_army_held_is_near_worthless() {
    let (topology, board, _rules, _config, mut arena) = fixture();
    // 29 cards accounted, leaving 5 knights exactly: 15 knights revealed (3 by the observer,
    // who holds Largest Army), all 9 progress cards revealed, all 5 VP drawn by the observer.
    arena.state.players[0].dev_plays_revealed[0] = 3;
    arena.state.players[0].knights_played = 3;
    arena.state.players[1].dev_plays_revealed[0] = 12;
    arena.state.players[1].dev_plays_revealed[2] = 3;
    arena.state.players[1].dev_plays_revealed[3] = 3;
    arena.state.players[1].dev_plays_revealed[4] = 3;
    arena.state.players[0].vp_dev = 5;
    arena.state.largest_army = Some(0);
    arena.drain_dev_deck_for_test(29);
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let score = heuristic_v1::dev_buy_score(&view, &HeuristicParams::default());
    // Only the thin knight slice of the base survives; ungated, the defend term is absent.
    let knight_rel = (5.0_f32 / 5.0) / (20.0_f32 / 34.0);
    let base = 45.0 * (0.55 * 0.0 + 0.35 * 0.0 + 0.10 * knight_rel);
    let vp_chase = 0.0_f32 * 300.0 * (5.0_f32 / 10.0);
    assert_eq!(score, base + vp_chase);
    // Direction: far below the composition-blind holder score of 45.
    assert!(score < 45.0 / 4.0);
}

#[test]
fn deck_blind_legacy_restores_the_composition_blind_score() {
    let (topology, board, arena) = vp_rich_near_win_state();
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let legacy = HeuristicParams {
        legacy_valuation: Some(LegacyValuation {
            deck_blind_buying: true,
            ..LegacyValuation::default()
        }),
        ..HeuristicParams::default()
    };
    let proximity = 8.0_f32 / 10.0;
    assert_eq!(
        heuristic_v1::dev_buy_score(&view, &legacy),
        45.0 + 25.0 * (0.5 + proximity) * 1.0
    );
}

#[test]
fn the_gated_denial_pressure_reaches_the_buy_score() {
    let (topology, board, arena) = vp_rich_near_win_state();
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let denial_params = DenialParams {
        pressure_floor: 2.0,
        ..DenialParams::default()
    };
    let gated = HeuristicParams {
        denial: Some(denial_params),
        ..HeuristicParams::default()
    };
    let score = heuristic_v1::dev_buy_score(&view, &gated);
    let pressure = denial::pressure(
        &denial::context(&view, &denial_params),
        &denial_params,
        None,
    );
    assert!(pressure >= 2.0);
    let share_vp = 3.0_f32 / 5.0;
    let share_knight = 2.0_f32 / 5.0;
    let vp_rel = share_vp / (5.0_f32 / 34.0);
    let knight_rel = share_knight / (20.0_f32 / 34.0);
    let base = 45.0 * (0.55 * vp_rel + 0.35 * 0.0 + 0.10 * knight_rel);
    let proximity = 8.0_f32 / 10.0;
    let vp_chase = share_vp * 300.0 * proximity;
    assert_eq!(
        score,
        base + vp_chase + 25.0 * (0.5 + proximity) * pressure * knight_rel
    );
}
