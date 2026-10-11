use std::cell::RefCell;

use super::*;

#[derive(Debug, PartialEq)]
pub(super) struct DecisionCall {
    pub policy: PolicyKind,
    pub seat: usize,
    pub phase: DecisionPhase,
    pub goal: Option<Buildable>,
    pub rng: u64,
}

thread_local! {
    pub(super) static E2E_PASSES: RefCell<Vec<(String, usize)>> = const { RefCell::new(Vec::new()) };
    pub(super) static PRIMING: RefCell<Vec<u64>> = const { RefCell::new(Vec::new()) };
    pub(super) static DECISIONS: RefCell<Vec<DecisionCall>> = const { RefCell::new(Vec::new()) };
    pub(super) static STRESS: RefCell<Vec<(Layout, &'static str, u64, u16, u32)>> = const { RefCell::new(Vec::new()) };
    pub(super) static SAMPLES: RefCell<Vec<(Layout, u16, u64, u16, Option<u8>)>> = const { RefCell::new(Vec::new()) };
}

fn request() -> BenchRequest<'static> {
    let weights = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../placement/default-weights.json"
    );
    BenchRequest {
        filter: None,
        quick: true,
        calls: Some(1),
        min_pass: Duration::from_millis(20),
        repeats: 1,
        games: 1,
        threads: 1,
        policy: PolicyKind::PriorityTrader,
        policy_name: "priority-trader",
        weights,
        greedy: parse_heuristic(&format!("app_formula:{weights}"), 0).unwrap(),
        draft: parse_heuristic(&format!("app_formula_draft:{weights}@{weights}"), 0).unwrap(),
    }
}

fn prepared_board(layout: Layout, kind: PlacementKind) -> (SimBoard, Topology) {
    let seats = match layout {
        Layout::Standard4 => 4,
        Layout::Extension6 => 6,
    };
    let topology = Topology::load(layout).unwrap();
    let mut board = generate_board(layout, seats, mix64(PERF_SEED)).unwrap();
    prepare_app_formula_boards(std::slice::from_mut(&mut board), &topology, &[kind]);
    (board, topology)
}

fn result() -> BenchResult {
    BenchResult {
        seed: format!("{PERF_SEED:016x}"),
        policy: String::new(),
        weights: String::new(),
        scenarios: Vec::new(),
    }
}

#[test]
fn reference_stages_are_live_distinct_and_cached() {
    let request = request();
    for (layout, seats) in [(Layout::Standard4, 4), (Layout::Extension6, 6)] {
        let (board, topology) = prepared_board(layout, request.greedy);
        let mut samples = ReferenceSamples::new(&board, &topology, request.greedy);
        SAMPLES.with_borrow_mut(Vec::clear);
        for offset in SEARCH_SEED_OFFSETS {
            let caps = STAGES.map(|(_, fraction)| samples.stage_cap(fraction, offset));
            assert!(caps[0] < caps[1] && caps[1] < caps[2]);
            let mut seen = Vec::new();
            for cap in caps {
                let DecisionSample { arena, input, .. } = normalized_sample(
                    DecisionKind::Action,
                    samples.get(cap, offset),
                    &board,
                    &topology,
                )
                .unwrap();
                let hash = view_hash(&arena.decision_view(
                    &board,
                    &topology,
                    input.seat,
                    DecisionPhase::Action,
                ))
                .0;
                assert!(!seen.contains(&hash));
                seen.push(hash);
                samples.get(cap, offset);
            }
            assert_eq!(
                caps,
                STAGES.map(|(_, fraction)| samples.stage_cap(fraction, offset))
            );
            let turns = samples
                .lengths
                .iter()
                .find(|(seed, _)| *seed == offset)
                .unwrap()
                .1;
            println!(
                "{} seed offset {offset}: {turns} seat turns, caps {caps:?}",
                layout.as_str()
            );
        }
        SAMPLES.with_borrow(|plays| {
            assert_eq!(plays.len(), SEARCH_SEED_OFFSETS.len() * (1 + STAGES.len()));
            for (played_layout, cap, _, turns, winner) in plays {
                assert_eq!(*played_layout, layout);
                if *cap != rules(layout).turn_cap {
                    assert_eq!(*winner, None);
                    assert_eq!(usize::from(*turns), usize::from(*cap) * seats);
                }
            }
        });
    }
}

#[test]
fn stress_search_is_complete_distinct_and_filter_independent() {
    let base = request();
    for layout in [Layout::Standard4, Layout::Extension6] {
        let (board, topology) = prepared_board(layout, base.greedy);
        let mut full_hand = String::new();
        for filter in ["/action/", "/action/full_hand"] {
            let request = BenchRequest {
                filter: Some(filter),
                ..base
            };
            let mut result = result();
            SAMPLES.with_borrow_mut(Vec::clear);
            STRESS.with_borrow_mut(Vec::clear);
            decision_scenarios(&mut result, &request, &board, &topology, base.greedy);
            let mut seen = Vec::new();
            for row in &result.scenarios {
                let Outcome::Measured { measurement, .. } = &row.outcome else {
                    panic!("skipped action")
                };
                assert!(!seen.contains(&measurement.state_hash));
                seen.push(measurement.state_hash.clone());
                if row.id.ends_with("/full_hand") {
                    if full_hand.is_empty() {
                        full_hand = measurement.state_hash.clone();
                    } else {
                        assert_eq!(full_hand, measurement.state_hash);
                    }
                }
            }
            SAMPLES.with_borrow(|plays| {
                assert_eq!(plays.len(), SEARCH_SEED_OFFSETS.len() * (1 + STAGES.len()))
            });
            STRESS.with_borrow(|samples| {
                assert_eq!(samples.len(), 2);
                for (sample_layout, name, offset, cap, score) in samples {
                    assert_eq!(*sample_layout, layout);
                    let stress = STRESS_SCENARIOS
                        .iter()
                        .find(|stress| stress.name == *name)
                        .unwrap();
                    assert!(*score >= (stress.minimum)(&rules(layout)));
                    assert_ne!(*offset, 0);
                    println!(
                        "{} {name}: seed offset {offset}, cap {cap}, score {score}",
                        layout.as_str()
                    );
                }
            });
        }
    }
}

#[test]
fn state_hash_depends_only_on_inputs() {
    let hashes: Vec<_> = ["test/first", "test/second"]
        .into_iter()
        .map(|id| {
            let Outcome::Measured { measurement, .. } = measure(
                &request(),
                id,
                Fingerprint(42),
                |_| (),
                |_, _| (),
                |_, _, _| {},
            ) else {
                panic!("skipped")
            };
            measurement.state_hash
        })
        .collect();
    assert_eq!(hashes[0], hashes[1]);
}

#[test]
fn passes_reset_setup_and_rng_and_hash_only_the_first_result() {
    let mut request = request();
    request.calls = Some(3);
    request.repeats = 2;
    let seed = scenario_seed("test/pass");
    let expected = Xoshiro256StarStar::from_seed(seed).next_u64();
    for quick in [false, true] {
        request.quick = quick;
        let mut setups = 0;
        let mut calls = 0_usize;
        let mut folds = 0;
        let outcome = measure(
            &request,
            "test/pass",
            Fingerprint(0),
            |_| {
                setups += 1;
                0
            },
            |scratch, rng| {
                calls += 1;
                let value = (*scratch, rng.next_u64());
                if *scratch == 0 {
                    assert_eq!(
                        value.1,
                        expected,
                        "first RNG draw of pass {}",
                        calls.div_ceil(3)
                    );
                }
                *scratch += 1;
                value
            },
            |hash, first, scratch| {
                folds += 1;
                assert_eq!(first, (0, expected));
                assert_eq!(*scratch, request.calls.unwrap());
                hash.value(&first);
            },
        );
        assert_eq!(setups, request.repeats + usize::from(!quick));
        assert_eq!(calls, setups * request.calls.unwrap());
        assert_eq!(folds, 1);
        let mut expected_hash = Fingerprint(seed);
        expected_hash.value(&(0_usize, expected));
        let Outcome::Measured { measurement, .. } = outcome else {
            panic!("skipped")
        };
        assert_eq!(
            measurement.decision_hash,
            format!("{:016x}", expected_hash.0)
        );
    }
}

#[test]
fn pre_roll_is_unplayed_and_winning_turns_are_unusable() {
    let request = request();
    let (board, topology) = prepared_board(Layout::Standard4, request.greedy);
    let (mut arena, _) = reference_game(&board, &topology, request.greedy, 5, 0);
    arena.state.players[0].bought_dev[0] = 2;
    arena.state.players[0].knights_played = 2;
    arena.state.players[0].vp_public = 8;
    arena.state.players[0].vp_dev = 0;
    arena.state.largest_army = None;
    for player in &mut arena.state.players[1..] {
        player.knights_played = 0;
    }
    let DecisionSample {
        arena: pre_roll,
        input,
        ..
    } = normalized_sample(DecisionKind::PreRoll, &arena, &board, &topology).unwrap();
    let view = pre_roll.decision_view(&board, &topology, input.seat, DecisionPhase::PreRoll);
    assert!(
        view.can_play_dev(0),
        "the pre-roll view must not have played its promoted knight"
    );
    let mut begun = arena.clone();
    assert!(begun.begin_turn_for_test(
        &board,
        &topology,
        &rules(Layout::Standard4),
        &reference_config(),
        0
    ));
    assert!(normalized_sample(DecisionKind::Action, &arena, &board, &topology).is_none());
}

// The reference's pre-roll returns a knight play before it records a goal, and a discard with no
// goal takes a fallback a real game only meets before a seat's first pre-roll.
#[test]
fn discard_rows_carry_a_goal() {
    for layout in [Layout::Standard4, Layout::Extension6] {
        let mut request = request();
        request.policy = REFERENCE_POLICY;
        request.filter = Some("/discard/");
        let (board, topology) = prepared_board(layout, request.greedy);
        DECISIONS.with_borrow_mut(Vec::clear);
        let mut result = result();
        decision_scenarios(&mut result, &request, &board, &topology, request.greedy);
        DECISIONS.with_borrow(|calls| {
            assert_eq!(calls.len(), STAGES.len(), "{layout:?}");
            for call in calls {
                assert!(call.goal.is_some(), "{layout:?} seat {}", call.seat);
            }
        });
    }
}

#[test]
fn filtered_decision_samples_only_its_requested_stage() {
    let mut request = request();
    request.filter = Some("decision/standard4/action/early");
    let (board, topology) = prepared_board(Layout::Standard4, request.greedy);
    SAMPLES.with_borrow_mut(Vec::clear);
    let mut result = result();
    decision_scenarios(&mut result, &request, &board, &topology, request.greedy);
    assert_eq!(result.scenarios.len(), 1);
    SAMPLES.with_borrow(|samples| {
        assert_eq!(
            samples,
            &[
                (
                    Layout::Standard4,
                    rules(Layout::Standard4).turn_cap,
                    0,
                    93,
                    Some(0)
                ),
                (Layout::Standard4, 5, 0, 20, None),
            ]
        );
    });
}

#[test]
fn decision_rows_forward_normalized_views_policy_scratch_and_rng() {
    let base = request();
    let (board, topology) = prepared_board(Layout::Standard4, base.greedy);
    let mut samples = ReferenceSamples::new(&board, &topology, base.greedy);
    let params = policy::heuristic_v1::HeuristicParams {
        trading: Some(policy::trading::TradeParams {
            danger_weight: -1.0,
            benefit_weight: 0.0,
            ..policy::trading::TradeParams::default()
        }),
        ..policy::heuristic_v1::HeuristicParams::default()
    };
    let counterparty = policy::params_file::register_custom_policy(
        PolicyKind::HeuristicV1TraderAware,
        "bench-counterparty-forwarding".into(),
        &serde_json::to_string(&params).unwrap(),
    )
    .unwrap();
    for (kind, stage, fraction, candidate) in [
        (
            DecisionKind::PreRoll,
            "mid",
            MID_FRACTION,
            PolicyKind::RandomLegal,
        ),
        (DecisionKind::Action, "early", EARLY_FRACTION, base.policy),
        (DecisionKind::Action, "mid", MID_FRACTION, base.policy),
        (DecisionKind::Discard, "mid", MID_FRACTION, base.policy),
        (DecisionKind::Robber, "early", EARLY_FRACTION, base.policy),
        (
            DecisionKind::RespondTrade,
            "early",
            EARLY_FRACTION,
            PolicyKind::HeuristicV1Trader,
        ),
        (
            DecisionKind::SelectCounterparty,
            "early",
            EARLY_FRACTION,
            counterparty,
        ),
    ] {
        let id = decision_id(Layout::Standard4, kind, stage);
        let request = BenchRequest {
            filter: Some(&id),
            policy: candidate,
            ..base
        };
        DECISIONS.with_borrow_mut(Vec::clear);
        PRIMING.with_borrow_mut(Vec::clear);
        let mut result = result();
        decision_scenarios(&mut result, &request, &board, &topology, request.greedy);
        let Outcome::Measured { measurement, .. } = &result.scenarios[0].outcome else {
            panic!("{id} skipped")
        };

        // Build the expected view independently of the production normalization path.
        let phase = match kind {
            DecisionKind::PreRoll => DecisionPhase::PreRoll,
            DecisionKind::RespondTrade | DecisionKind::SelectCounterparty => {
                DecisionPhase::TradeResponse
            }
            _ => DecisionPhase::Action,
        };
        let mut selected = None;
        for offset in SEARCH_SEED_OFFSETS {
            let cap = samples.stage_cap(fraction, offset);
            let mut reset = samples.get(cap, offset).clone();
            reset.reset_turn_for_test(0);
            let mut arena = reset.clone();
            if !matches!(kind, DecisionKind::PreRoll)
                && arena.begin_turn_for_test(
                    &board,
                    &topology,
                    &rules(Layout::Standard4),
                    &reference_config(),
                    0,
                )
            {
                continue;
            }
            let input = match kind {
                DecisionKind::Discard => (0..board.seats()).find_map(|seat| {
                    let view = arena.decision_view(&board, &topology, seat, phase);
                    (view.hand_total(seat) > u32::from(view.discard_threshold())).then(|| {
                        DecisionInput {
                            count: (view.hand_total(seat) / 2) as u8,
                            ..DecisionInput::for_seat(seat)
                        }
                    })
                }),
                DecisionKind::RespondTrade | DecisionKind::SelectCounterparty => {
                    trade_input(kind, &arena, &board, &topology)
                }
                _ => Some(DecisionInput::for_seat(0)),
            };
            if let Some(input) = input {
                selected = Some((arena, reset, input));
                break;
            }
        }
        let (arena, reset, input) = selected.unwrap();
        let view = arena.decision_view(&board, &topology, input.seat, phase);
        let seed = scenario_seed(&id);
        let mut state = view_hash(&view);
        state.value(&(
            input.count,
            input.offer,
            &input.acceptors,
            input.delta.map(f64::to_bits),
        ));
        assert_eq!(measurement.state_hash, format!("{:016x}", state.0), "{id}");
        let mut scratch = PolicyScratch::default();
        if matches!(kind, DecisionKind::Action | DecisionKind::Discard) {
            let mut primer = reset.clone();
            if matches!(kind, DecisionKind::Discard) {
                primer.begin_turn_for_test(
                    &board,
                    &topology,
                    &rules(Layout::Standard4),
                    &reference_config(),
                    input.seat,
                );
            }
            let pre_roll_view =
                primer.decision_view(&board, &topology, input.seat, DecisionPhase::PreRoll);
            PRIMING.with_borrow(|views| assert_eq!(views, &[view_hash(&pre_roll_view).0], "{id}"));
            policy::pre_roll(
                request.policy,
                &pre_roll_view,
                &mut scratch,
                &mut Xoshiro256StarStar::from_seed(seed),
            );
            if stage == "early" || matches!(kind, DecisionKind::Discard) {
                assert!(scratch.goal.is_some(), "{id} must exercise warmed scratch");
            }
        }
        DECISIONS.with_borrow(|calls| {
            assert_eq!(
                calls,
                &[DecisionCall {
                    policy: request.policy,
                    seat: input.seat,
                    phase,
                    goal: scratch.goal,
                    rng: Xoshiro256StarStar::from_seed(seed).next_u64(),
                }],
                "{id}"
            )
        });
        let mut rng = Xoshiro256StarStar::from_seed(seed);
        let decision = match kind {
            DecisionKind::PreRoll => Decision::PreRoll(policy::pre_roll(
                request.policy,
                &view,
                &mut scratch,
                &mut rng,
            )),
            DecisionKind::Action => Decision::Action(policy::action(
                request.policy,
                &view,
                &mut scratch,
                &mut rng,
            )),
            DecisionKind::Discard => Decision::Discard(policy::discard(
                request.policy,
                &view,
                input.count,
                &mut scratch,
                &mut rng,
            )),
            DecisionKind::Robber => {
                Decision::Robber(policy::robber(request.policy, &view, &mut rng))
            }
            DecisionKind::RespondTrade => Decision::RespondTrade(policy::respond_trade(
                request.policy,
                &view,
                input.offer.unwrap(),
                &mut rng,
            )),
            DecisionKind::SelectCounterparty => Decision::SelectCounterparty(
                policy::select_counterparty(request.policy, &view, &input.delta, &input.acceptors),
            ),
        };
        let mut reference_rng = Xoshiro256StarStar::from_seed(seed);
        let reference = match kind {
            DecisionKind::PreRoll => Some(Decision::PreRoll(policy::pre_roll(
                REFERENCE_POLICY,
                &view,
                &mut PolicyScratch::default(),
                &mut reference_rng,
            ))),
            DecisionKind::RespondTrade => Some(Decision::RespondTrade(policy::respond_trade(
                REFERENCE_POLICY,
                &view,
                input.offer.unwrap(),
                &mut reference_rng,
            ))),
            DecisionKind::SelectCounterparty => {
                Some(Decision::SelectCounterparty(policy::select_counterparty(
                    REFERENCE_POLICY,
                    &view,
                    &input.delta,
                    &input.acceptors,
                )))
            }
            _ => None,
        };
        if let Some(reference) = reference {
            assert_ne!(
                serde_json::to_value(&decision).unwrap(),
                serde_json::to_value(reference).unwrap(),
                "{id} must distinguish the candidate from the reference"
            );
        }
        let mut hash = Fingerprint(seed);
        hash.value(&decision);
        assert_eq!(
            measurement.decision_hash,
            format!("{:016x}", hash.0),
            "{id}"
        );
    }
}

#[test]
fn calibration_doubles_to_the_cap_and_reuses_its_last_pass_as_warmup() {
    let mut request = request();
    request.quick = false;
    request.calls = None;
    request.min_pass = Duration::MAX;
    request.repeats = 2;
    let mut sizes = Vec::new();
    let mut folds = 0;
    let outcome = measure(
        &request,
        "test/calibration",
        Fingerprint(0),
        |calls| {
            sizes.push(calls);
            0
        },
        |scratch, _| {
            let first = *scratch;
            *scratch += 1;
            first
        },
        |hash, first, scratch| {
            folds += 1;
            assert_eq!(first, 0);
            assert_eq!(*scratch, 1);
            hash.value(&first);
        },
    );
    let expected: Vec<_> = (0..=16)
        .map(|shift| 1 << shift)
        .chain([65_536; 2])
        .collect();
    assert_eq!(sizes, expected);
    assert_eq!(folds, 1);
    let Outcome::Measured { measurement, .. } = outcome else {
        panic!("skipped")
    };
    assert_eq!(measurement.calls, 65_536);
    assert_eq!(measurement.repeats, 2);
}

#[test]
fn calibration_stops_at_the_target_and_quick_uses_one_call_once() {
    for quick in [false, true] {
        let mut request = request();
        request.quick = quick;
        request.calls = None;
        request.min_pass = if quick { Duration::MAX } else { Duration::ZERO };
        let mut sizes = Vec::new();
        measure(
            &request,
            "test/calibration",
            Fingerprint(0),
            |calls| {
                sizes.push(calls);
            },
            |_, _| (),
            |hash, first, _| hash.value(&first),
        );
        assert_eq!(sizes, vec![1; if quick { 1 } else { 2 }]);
    }
}

#[test]
fn e2e_uses_only_the_requested_repeats_without_warmup_or_calibration() {
    let mut request = request();
    request.quick = false;
    request.calls = None;
    request.min_pass = Duration::MAX;
    request.repeats = 2;
    let (board, topology) = prepared_board(Layout::Standard4, request.draft);
    E2E_PASSES.with_borrow_mut(Vec::clear);
    e2e_scenarios(&mut result(), &request, &board, &topology).unwrap();
    E2E_PASSES.with_borrow(|passes| {
        assert_eq!(
            passes,
            &[
                ("e2e/standard4/single_core".to_owned(), 1),
                ("e2e/standard4/single_core".to_owned(), 1),
                ("e2e/standard4/all_cores".to_owned(), 1),
                ("e2e/standard4/all_cores".to_owned(), 1),
            ]
        )
    });
}

#[test]
fn unmatched_filter_fails_before_board_preparation() {
    let mut request = request();
    request.filter = Some("absent-scenario");
    request.greedy = PlacementKind::AppFormula(u8::MAX);
    request.draft = PlacementKind::AppFormulaDraft(u8::MAX);
    SAMPLES.with_borrow_mut(Vec::clear);
    let error = benchmark(&request)
        .err()
        .expect("unmatched filter must fail");
    assert!(error.contains("absent-scenario") && error.contains("no scenario"));
    SAMPLES.with_borrow(|samples| assert!(samples.is_empty()));
}

#[test]
fn timed_pass_contains_no_clock_reads_and_returns_the_first_result() {
    let source = include_str!("../../src/bench.rs");
    let body = source
        .split("fn timed_pass<T>")
        .nth(1)
        .unwrap()
        .split("fn measure<")
        .next()
        .unwrap();
    assert!(!body.contains("Instant") && !body.contains("elapsed"));
    let mut calls = 0;
    assert_eq!(
        timed_pass(3, || {
            calls += 1;
            calls
        }),
        1
    );
    assert_eq!(calls, 3);
}

#[test]
fn stress_minimums_follow_rules() {
    let mut rules = rules(Layout::Standard4);
    rules.longest_road_min = 11;
    rules.discard_threshold = 12;
    assert_eq!(
        STRESS_SCENARIOS.map(|stress| (stress.name, (stress.minimum)(&rules))),
        [("long_road", 11), ("full_hand", 13)]
    );
}

#[test]
fn only_the_turn_owner_is_advanced() {
    let request = request();
    let (board, topology) = prepared_board(Layout::Standard4, request.greedy);
    let (mut arena, _) = reference_game(&board, &topology, request.greedy, 5, 0);
    arena.state.players[0].playable_dev = [0; 5];
    arena.state.players[0].bought_dev = [0; 5];
    arena.state.players[0].resources = [0; 5];
    arena.state.players[1].resources = [16; 5];
    arena.state.players[1].bought_dev = [1; 5];
    let discard = normalized_sample(DecisionKind::Discard, &arena, &board, &topology).unwrap();
    assert_eq!(discard.input.seat, 1);
    assert_eq!(discard.arena.state.players[1].bought_dev, [1; 5]);
    arena.state.players[0].resources = [1, 0, 0, 0, 0];
    for kind in [
        DecisionKind::Action,
        DecisionKind::Robber,
        DecisionKind::RespondTrade,
        DecisionKind::SelectCounterparty,
    ] {
        let sample = normalized_sample(kind, &arena, &board, &topology).unwrap();
        assert_eq!(
            sample.input.seat,
            usize::from(matches!(kind, DecisionKind::RespondTrade))
        );
        assert_eq!(sample.arena.state.players[1].bought_dev, [1; 5]);
        if let Some(offer) = sample.input.offer {
            assert_eq!(offer.proposer, 0);
        }
    }
}

#[test]
fn insufficient_stress_samples_are_skipped() {
    let request = request();
    let topology = Topology::load(Layout::Standard4).unwrap();
    let board = generate_board(Layout::Standard4, 4, mix64(PERF_SEED)).unwrap();
    let mut arena = GameArena::default();
    arena.prepare(
        &board,
        &topology,
        &rules(Layout::Standard4),
        &GameConfig::default(),
    );
    let mut samples = ReferenceSamples {
        board: &board,
        topology: &topology,
        greedy: request.greedy,
        lengths: SEARCH_SEED_OFFSETS
            .into_iter()
            .map(|offset| (offset, 16))
            .collect(),
        games: SEARCH_SEED_OFFSETS
            .into_iter()
            .flat_map(|offset| {
                let arena = &arena;
                (1..=3).map(move |cap| (cap, offset, arena.clone()))
            })
            .collect(),
    };
    let mut result = result();
    stress_scenarios(&mut result, &request, &mut samples);
    assert_eq!(result.scenarios.len(), 2);
    for row in result.scenarios {
        let Outcome::Skipped { reason } = row.outcome else {
            panic!("stress minimum was ignored")
        };
        assert!(reason.contains("below required"));
    }
}
