use std::collections::BTreeSet;

use unsettled_engine::placement::app_formula::EngineWeights;
use unsettled_engine::placement::{PlacementKind, register_app_formula, register_app_formula_draft};
use unsettled_engine::policy::PolicyKind;
use unsettled_engine::rng::{derive_evaluation_seed, mix64};
use unsettled_engine::topology::Layout;
use unsettled_sim::boardgen::generate_board;
use unsettled_sim::evaluate::{
    EVAL2_SEED, EVAL3_SEED, EVAL4_SEED, EVAL5_SEED, EVAL_SEED, EvaluateRequest, EvaluationDomain,
    GATE2_SEED, GATE3_SEED, GATE4_SEED, GATE5_SEED, GATE6_SEED, GATE_SEED, PERF_SEED, TUNING2_SEED, TUNING3_SEED, TUNING4_SEED,
    TUNING5_SEED, TUNING6_SEED, TUNING_SEED, evaluate, evaluate_in_chunks, evaluation_schedule,
    summarize_arm,
};

fn policy_name(policy: PolicyKind) -> &'static str {
    match policy {
        // The harness sweeps the static roster; params-file policies register at runtime
        // and carry their own spec string.
        PolicyKind::Custom(_) => unreachable!("custom params policies are outside the roster"),
        PolicyKind::RandomLegal => "random-legal",
        PolicyKind::GreedyNoTrade => "greedy-no-trade",
        PolicyKind::PriorityTrader => "priority-trader",
        PolicyKind::HeuristicV1 => "heuristic-v1",
        PolicyKind::HeuristicV1Noports => "heuristic-v1-noports",
        PolicyKind::HeuristicV1Denial => "heuristic-v1-denial",
        PolicyKind::HeuristicV1Threat => "heuristic-v1-threat",
        PolicyKind::HeuristicV1ThreatDenial => "heuristic-v1-threat-denial",
        PolicyKind::HeuristicV1Devcards => "heuristic-v1-devcards",
        PolicyKind::HeuristicV1DevcardsDenial => "heuristic-v1-devcards-denial",
        PolicyKind::HeuristicV1ThreatDevcards => "heuristic-v1-threat-devcards",
        PolicyKind::HeuristicV1ThreatDevcardsDenial => "heuristic-v1-threat-devcards-denial",
        PolicyKind::HeuristicV1Trader => "heuristic-v1-trader",
        PolicyKind::HeuristicV1TraderDenial => "heuristic-v1-trader-denial",
        PolicyKind::HeuristicV1TraderThreat => "heuristic-v1-trader-threat",
        PolicyKind::HeuristicV1TraderThreatDenial => "heuristic-v1-trader-threat-denial",
        PolicyKind::HeuristicV1TraderDevcards => "heuristic-v1-trader-devcards",
        PolicyKind::HeuristicV1TraderDevcardsDenial => "heuristic-v1-trader-devcards-denial",
        PolicyKind::HeuristicV1TraderThreatDevcards => "heuristic-v1-trader-threat-devcards",
        PolicyKind::HeuristicV1TraderThreatDevcardsDenial => {
            "heuristic-v1-trader-threat-devcards-denial"
        }
        PolicyKind::HeuristicV1TraderAware => "heuristic-v1-trader-aware",
        PolicyKind::HeuristicV1TraderAwareDenial => "heuristic-v1-trader-aware-denial",
        PolicyKind::HeuristicV1TraderAwareThreat => "heuristic-v1-trader-aware-threat",
        PolicyKind::HeuristicV1TraderAwareThreatDenial => "heuristic-v1-trader-aware-threat-denial",
        PolicyKind::HeuristicV1TraderAwareDevcards => "heuristic-v1-trader-aware-devcards",
        PolicyKind::HeuristicV1TraderAwareDevcardsDenial => {
            "heuristic-v1-trader-aware-devcards-denial"
        }
        PolicyKind::HeuristicV1TraderAwareThreatDevcards => {
            "heuristic-v1-trader-aware-threat-devcards"
        }
        PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenial => {
            "heuristic-v1-trader-aware-threat-devcards-denial"
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn run(
    layout: Layout,
    seats: usize,
    field_spec: &str,
    field: PlacementKind,
    arms: &[(String, PlacementKind)],
    arm_specs: &[String],
    reference: Option<&str>,
    boards: usize,
    reps: usize,
    threads: usize,
    policy: PolicyKind,
    allow_unofficial: bool,
) -> unsettled_sim::evaluate::Evaluation {
    let arm_policies = vec![None; arms.len()];
    let arm_policy_names = vec![None; arms.len()];
    evaluate(EvaluateRequest {
        layout,
        seats,
        domain: EvaluationDomain::Tuning,
        field_spec,
        field,
        arms,
        arm_specs,
        arm_policies: &arm_policies,
        arm_policy_names: &arm_policy_names,
        reference,
        units: None,
        where_rule: None,
        boards,
        reps,
        policy,
        policy_name: policy_name(policy),
        player_trading: None,
        threshold: 0.01,
        alpha: 0.05,
        threads,
        allow_unofficial,
    })
    .unwrap()
}

#[test]
fn identical_arms_remain_exactly_concordant_under_common_random_numbers() {
    let weights: EngineWeights =
        serde_json::from_str(include_str!("../../../placement/default-weights.json")).unwrap();
    let alpha =
        register_app_formula("app_formula:default-weights".into(), weights.clone()).unwrap();
    let beta = register_app_formula("app_formula:default-weights".into(), weights).unwrap();
    assert_ne!(alpha, beta);
    let arms = vec![("alpha".to_string(), alpha), ("beta".to_string(), beta)];
    let specs = vec![
        "app_formula:placement/default-weights.json".to_string(),
        "app_formula:placement/default-weights.json".to_string(),
    ];
    let evaluation = run(
        Layout::Standard4,
        4,
        "max_pips",
        PlacementKind::MaxPips,
        &arms,
        &specs,
        Some("alpha"),
        2,
        2,
        1,
        PolicyKind::HeuristicV1,
        false,
    );
    let pair = &evaluation.pairs[0];

    assert_eq!(pair.stats.b, 0);
    assert_eq!(pair.stats.c, 0);
    assert_eq!(pair.stats.estimate, 0.0);
    assert_eq!(pair.stats.mcnemar, [0.0, 0.0]);
    assert_eq!(pair.stats.clustered, [0.0, 0.0]);
    assert_eq!(evaluation.arms["alpha"].wins, evaluation.arms["beta"].wins);
    assert_eq!(evaluation.illegal_actions, 0);
}

#[test]
fn a_single_arm_reports_a_marginal_without_a_reference_or_verdict() {
    let arms = vec![("only".to_string(), PlacementKind::MaxPips)];
    let specs = vec!["max_pips".to_string()];
    let evaluation = run(
        Layout::Standard4,
        4,
        "max_pips",
        PlacementKind::MaxPips,
        &arms,
        &specs,
        None,
        2,
        1,
        1,
        PolicyKind::HeuristicV1,
        false,
    );

    assert_eq!(evaluation.config.reference, None);
    assert_eq!(
        evaluation.arms["only"].games,
        evaluation.config.units as u64
    );
    assert_eq!(
        evaluation.arms["only"].win_rate,
        evaluation.arms["only"].wins as f64 / evaluation.arms["only"].games as f64
    );
    assert!(evaluation.pairs.is_empty());
    assert_eq!(evaluation.illegal_actions, 0);
}

#[test]
fn the_per_hero_seat_table_partitions_the_pooled_comparison() {
    let boards = 3;
    let reps = 2;
    let seats = 4;
    let arms = vec![
        ("base".to_string(), PlacementKind::MaxPips),
        ("candidate".to_string(), PlacementKind::PipDiversity),
    ];
    let specs = vec!["max_pips".to_string(), "pip_diversity".to_string()];
    let single = run(
        Layout::Standard4,
        seats,
        "max_pips",
        PlacementKind::MaxPips,
        &arms,
        &specs,
        Some("base"),
        boards,
        reps,
        1,
        PolicyKind::HeuristicV1,
        false,
    );
    let all_cores = run(
        Layout::Standard4,
        seats,
        "max_pips",
        PlacementKind::MaxPips,
        &arms,
        &specs,
        Some("base"),
        boards,
        reps,
        0,
        PolicyKind::HeuristicV1,
        false,
    );

    let pair = &single.pairs[0];
    assert_eq!(pair.per_hero_seat.len(), seats);
    assert_eq!(
        pair.per_hero_seat.iter().map(|seat| seat.as_ref().unwrap()).map(|seat| seat.n).sum::<usize>(),
        pair.stats.n
    );
    assert_eq!(
        pair.per_hero_seat
            .iter()
            .map(|seat| seat.as_ref().unwrap())
            .map(|seat| seat.b + seat.c)
            .sum::<u64>(),
        pair.stats.b + pair.stats.c
    );
    // Every board contributes `reps` units to each seat, so a seat's slice keeps the
    // full cluster count and only its cluster size shrinks.
    assert!(
        pair.per_hero_seat
            .iter()
            .map(|seat| seat.as_ref().unwrap())
            .all(|seat| seat.clusters == boards && seat.n == boards * reps)
    );

    assert_eq!(
        serde_json::to_vec_pretty(&single).unwrap(),
        serde_json::to_vec_pretty(&all_cores).unwrap()
    );
    assert_eq!(single.illegal_actions, 0);
    assert_eq!(all_cores.illegal_actions, 0);
}

#[test]
fn evaluation_json_is_byte_identical_at_one_and_all_threads() {
    let arms = vec![
        ("base".to_string(), PlacementKind::MaxPips),
        ("candidate".to_string(), PlacementKind::PipDiversity),
    ];
    let specs = vec!["max_pips".to_string(), "pip_diversity".to_string()];
    let one = run(
        Layout::Standard4,
        4,
        "max_pips",
        PlacementKind::MaxPips,
        &arms,
        &specs,
        Some("base"),
        2,
        2,
        1,
        PolicyKind::HeuristicV1,
        false,
    );
    let all = run(
        Layout::Standard4,
        4,
        "max_pips",
        PlacementKind::MaxPips,
        &arms,
        &specs,
        Some("base"),
        2,
        2,
        0,
        PolicyKind::HeuristicV1,
        false,
    );

    assert_eq!(
        serde_json::to_vec_pretty(&one).unwrap(),
        serde_json::to_vec_pretty(&all).unwrap()
    );
    assert_eq!(one.illegal_actions, 0);
    assert_eq!(all.illegal_actions, 0);
}

#[test]
fn chunked_evaluation_matches_a_single_pass() {
    let weights: EngineWeights =
        serde_json::from_str(include_str!("../../../placement/default-weights.json")).unwrap();
    let field_spec = "app_formula_draft:default-weights@default-weights";
    let candidate_spec = "app_formula_draft:chunk-witness@default-weights";
    let field = register_app_formula_draft(
        field_spec.into(), weights.clone(), weights.clone(),
    ).unwrap();
    let base = register_app_formula_draft(
        field_spec.into(), weights.clone(), weights.clone(),
    ).unwrap();
    let mut candidate_weights = weights.clone();
    candidate_weights.expansion_weight = 0.3;
    let candidate = register_app_formula_draft(
        candidate_spec.into(), candidate_weights, weights,
    ).unwrap();
    let arms = vec![("base".to_string(), base), ("candidate".to_string(), candidate)];
    let specs = vec![field_spec.to_string(), candidate_spec.to_string()];
    let arm_policies = vec![None; arms.len()];
    let arm_policy_names = vec![None; arms.len()];
    let run_chunked = |chunk_boards| {
        let evaluation = evaluate_in_chunks(EvaluateRequest {
            layout: Layout::Standard4,
            seats: 4,
            domain: EvaluationDomain::Tuning,
            field_spec,
            field,
            arms: &arms,
            arm_specs: &specs,
            arm_policies: &arm_policies,
            arm_policy_names: &arm_policy_names,
            reference: Some("base"),
            units: None,
            where_rule: None,
            boards: 5,
            reps: 2,
            policy: PolicyKind::HeuristicV1,
            policy_name: policy_name(PolicyKind::HeuristicV1),
            player_trading: None,
            threshold: 0.01,
            alpha: 0.05,
            threads: 1,
            allow_unofficial: false,
        }, chunk_boards).unwrap();
        assert_eq!(evaluation.config.units, 40);
        assert_eq!(evaluation.arms["base"].games, 40);
        assert_eq!(evaluation.arms["candidate"].games, 40);
        assert_eq!(evaluation.illegal_actions, 0);
        serde_json::to_vec_pretty(&evaluation).unwrap()
    };

    let single_pass = run_chunked(5);
    assert_eq!(run_chunked(1), single_pass);
    assert_eq!(run_chunked(2), single_pass);
}

#[test]
fn paired_comparisons_are_ordered_by_arm_label() {
    let arms = vec![
        ("reference".to_string(), PlacementKind::MaxPips),
        ("zeta".to_string(), PlacementKind::PipDiversity),
        ("alpha".to_string(), PlacementKind::PipScarcity),
    ];
    let specs = vec![
        "max_pips".to_string(),
        "pip_diversity".to_string(),
        "pip_scarcity".to_string(),
    ];
    let evaluation = run(
        Layout::Standard4,
        4,
        "max_pips",
        PlacementKind::MaxPips,
        &arms,
        &specs,
        Some("reference"),
        2,
        1,
        1,
        PolicyKind::HeuristicV1,
        false,
    );

    assert_eq!(
        evaluation
            .pairs
            .iter()
            .map(|pair| pair.arm.as_str())
            .collect::<Vec<_>>(),
        ["alpha", "zeta"]
    );
    assert_eq!(evaluation.illegal_actions, 0);
}

#[test]
fn official_seat_counts_receive_a_full_hero_rotation() {
    for (layout, seats) in [
        (Layout::Standard4, 3),
        (Layout::Standard4, 4),
        (Layout::Extension6, 5),
        (Layout::Extension6, 6),
    ] {
        let schedule = evaluation_schedule(2, 3, seats);
        let covered = schedule
            .iter()
            .map(|unit| unit.hero_seat)
            .collect::<BTreeSet<_>>();
        assert_eq!(covered, (0..seats).collect());
        for hero_seat in 0..seats {
            assert_eq!(
                schedule
                    .iter()
                    .filter(|unit| unit.hero_seat == hero_seat)
                    .count(),
                6
            );
        }

        let arms = vec![("only".to_string(), PlacementKind::MaxPips)];
        let specs = vec!["max_pips".to_string()];
        let evaluation = run(
            layout,
            seats,
            "max_pips",
            PlacementKind::MaxPips,
            &arms,
            &specs,
            None,
            1,
            1,
            1,
            PolicyKind::HeuristicV1,
            false,
        );
        assert_eq!(evaluation.config.hero_seats, seats);
        assert_eq!(evaluation.config.units, seats);
        assert_eq!(evaluation.illegal_actions, 0);
    }
}

#[test]
fn a_field_spec_equal_to_an_arm_spec_is_accepted() {
    let weights: EngineWeights =
        serde_json::from_str(include_str!("../../../placement/default-weights.json")).unwrap();
    let field =
        register_app_formula("app_formula:default-weights".into(), weights.clone()).unwrap();
    let arm = register_app_formula("app_formula:default-weights".into(), weights).unwrap();
    assert_ne!(field, arm);
    let spec = "app_formula:placement/default-weights.json";
    let arms = vec![("same".to_string(), arm)];
    let specs = vec![spec.to_string()];
    let evaluation = run(
        Layout::Standard4,
        4,
        spec,
        field,
        &arms,
        &specs,
        None,
        2,
        1,
        1,
        PolicyKind::HeuristicV1,
        false,
    );

    assert_eq!(evaluation.config.field, evaluation.arms["same"].spec);
    assert!(evaluation.arms.contains_key("same"));
    assert_eq!(evaluation.illegal_actions, 0);
}

#[test]
fn draws_are_reported_without_leaving_the_denominator() {
    let synthetic = summarize_arm(
        "max_pips",
        "max_pips",
        &[false, true, false],
        &[true, false, false],
        1.959_963_984_540_054,
    )
    .unwrap();
    assert_eq!(synthetic.games, 3);
    assert_eq!(synthetic.wins, 1);
    assert_eq!(synthetic.draws, 1);
    assert_eq!(synthetic.win_rate, 1.0 / 3.0);

    let arms = vec![("only".to_string(), PlacementKind::Random)];
    let specs = vec!["random".to_string()];
    let evaluation = run(
        Layout::Standard4,
        4,
        "random",
        PlacementKind::Random,
        &arms,
        &specs,
        None,
        4,
        2,
        1,
        PolicyKind::GreedyNoTrade,
        false,
    );
    let arm = &evaluation.arms["only"];

    eprintln!("greedy-no-trade random field draws: {}", arm.draws);
    assert!(arm.draws > 0);
    assert_eq!(arm.games, evaluation.config.units as u64);
    assert_eq!(arm.win_rate, arm.wins as f64 / arm.games as f64);
    assert_eq!(evaluation.illegal_actions, 0);
}

#[test]
fn symmetric_field_calibration_matches_the_draw_corrected_target() {
    let boards = 20;
    let reps = 5;
    let seats = 4;
    let arms = vec![("same".to_string(), PlacementKind::MaxPips)];
    let specs = vec!["max_pips".to_string()];
    let schedule = evaluation_schedule(boards, reps, seats);
    for hero_seat in 0..seats {
        assert_eq!(
            schedule
                .iter()
                .filter(|unit| unit.hero_seat == hero_seat)
                .count(),
            boards * reps
        );
    }
    let evaluation = run(
        Layout::Standard4,
        seats,
        "max_pips",
        PlacementKind::MaxPips,
        &arms,
        &specs,
        None,
        boards,
        reps,
        0,
        PolicyKind::HeuristicV1,
        false,
    );
    let arm = &evaluation.arms["same"];
    let draw_rate = arm.draws as f64 / arm.games as f64;
    let target = (1.0 - draw_rate) / seats as f64;
    eprintln!(
        "symmetric field win rate = {:.6}, draw-corrected target = {:.6}",
        arm.win_rate, target
    );

    // At n=400 and p near 0.25, SE is about 0.0217. A 0.05 tolerance is about 2.3 SE.
    assert!((arm.win_rate - target).abs() <= 0.05);
    assert_eq!(arm.games, 400);
    assert_eq!(evaluation.illegal_actions, 0);
}

#[test]
fn tuning_and_evaluation_domains_have_disjoint_seeds_and_boards() {
    let seeds = |domain| {
        (0..5)
            .flat_map(move |board| {
                (0..3).flat_map(move |rep| {
                    (0..4)
                        .map(move |hero_seat| derive_evaluation_seed(domain, board, rep, hero_seat))
                })
            })
            .collect::<BTreeSet<_>>()
    };
    let boards = |domain, layout, seats| {
        (0..5)
            .map(|board| {
                let board = generate_board(layout, seats, mix64(domain ^ board)).unwrap();
                (board.tiles().to_vec(), board.tokens().to_vec())
            })
            .collect::<Vec<_>>()
    };

    // Compare the nine old domains, PERF_SEED and all 45 seat-derived seeds on both
    // layouts, including boards at different indices that a bare seat xor would overlap.
    let mut domains = [
        ("tuning", TUNING_SEED),
        ("eval", EVAL_SEED),
        ("gate", GATE_SEED),
        ("tuning2", TUNING2_SEED),
        ("eval2", EVAL2_SEED),
        ("gate2", GATE2_SEED),
        ("tuning3", TUNING3_SEED),
        ("eval3", EVAL3_SEED),
        ("gate3", GATE3_SEED),
        ("perf", PERF_SEED),
    ]
    .into_iter()
    .map(|(name, seed)| (name.to_string(), seed))
    .collect::<Vec<_>>();
    for domain in [
        EvaluationDomain::Tuning4,
        EvaluationDomain::Eval4,
        EvaluationDomain::Gate4,
        EvaluationDomain::Gate5,
        EvaluationDomain::Tuning5,
        EvaluationDomain::Tuning6,
        EvaluationDomain::Eval5,
        EvaluationDomain::Gate6,
        EvaluationDomain::Perf,
    ] {
        for seats in 2..=6 {
            domains.push((format!("{}-{seats}", domain.name()), domain.seed(seats)));
        }
    }
    assert_eq!(domains.len(), 55);
    let layouts = [(Layout::Standard4, 4), (Layout::Extension6, 6)];
    for (index, (left_name, left)) in domains.iter().enumerate() {
        for (right_name, right) in &domains[index + 1..] {
            assert!(
                (*left ^ *right) >= 1 << 21,
                "{left_name} and {right_name} overlap within 2^21 board indices"
            );
            assert!(
                seeds(*left).is_disjoint(&seeds(*right)),
                "{left_name} and {right_name} share evaluation seeds"
            );
            for (layout, seats) in layouts {
                let left_boards = boards(*left, layout, seats);
                let right_boards = boards(*right, layout, seats);
                assert!(
                    left_boards.iter().all(|board| !right_boards.contains(board)),
                    "{left_name} and {right_name} share {layout:?} boards"
                );
            }
        }
    }
}

/// An old domain is held out per layout, not per seat count: seats only set the player
/// list, so board `i` has the same tiles and tokens at every seat count on one layout.
#[test]
fn seat_count_does_not_change_a_domains_boards() {
    let layouts: [(Layout, &[usize]); 2] =
        [(Layout::Standard4, &[2, 3, 4]), (Layout::Extension6, &[5, 6])];
    for (layout, seat_counts) in layouts {
        let board = |seats| {
            let board = generate_board(layout, seats, mix64(TUNING_SEED ^ 3)).unwrap();
            (board.tiles().to_vec(), board.tokens().to_vec())
        };
        for &seats in seat_counts {
            assert_eq!(board(seats), board(seat_counts[0]), "{layout:?} at {seats} seats");
        }
    }
}

#[test]
fn seat_count_changes_a_fourth_generation_domains_boards() {
    let layouts: [(Layout, &[usize]); 2] =
        [(Layout::Standard4, &[2, 3, 4]), (Layout::Extension6, &[5, 6])];
    for (layout, seat_counts) in layouts {
        let board = |seats| {
            let seed = EvaluationDomain::Gate4.seed(seats);
            let board = generate_board(layout, seats, mix64(seed ^ 3)).unwrap();
            (board.tiles().to_vec(), board.tokens().to_vec())
        };
        for (index, &left) in seat_counts.iter().enumerate() {
            for &right in &seat_counts[index + 1..] {
                assert_ne!(board(left), board(right), "{layout:?} at {left} and {right} seats");
            }
        }
    }
}

/// The eighteen spellings the CLI parses, and the one it must not.
///
/// `EvaluationDomain::seed` is the only place a run's whole seed stream is chosen, so a
/// domain that parses to the wrong constant would silently spend a held-out set. The
/// unknown case is pinned too: a typo like `tuning7` has to fail rather than fall back.
#[test]
fn every_evaluation_domain_parses_to_its_own_named_seed() {
    let expected = [
        ("tuning", EvaluationDomain::Tuning, TUNING_SEED),
        ("eval", EvaluationDomain::Eval, EVAL_SEED),
        ("gate", EvaluationDomain::Gate, GATE_SEED),
        ("tuning2", EvaluationDomain::Tuning2, TUNING2_SEED),
        ("eval2", EvaluationDomain::Eval2, EVAL2_SEED),
        ("gate2", EvaluationDomain::Gate2, GATE2_SEED),
        ("tuning3", EvaluationDomain::Tuning3, TUNING3_SEED),
        ("eval3", EvaluationDomain::Eval3, EVAL3_SEED),
        ("gate3", EvaluationDomain::Gate3, GATE3_SEED),
    ];
    for (spelling, domain, seed) in expected {
        assert_eq!(EvaluationDomain::parse(spelling), Ok(domain));
        assert_eq!(domain.name(), spelling);
        for seats in 2..=6 {
            assert_eq!(domain.seed(seats), seed);
        }
    }

    for (spelling, domain, seed) in [
        ("tuning4", EvaluationDomain::Tuning4, TUNING4_SEED),
        ("eval4", EvaluationDomain::Eval4, EVAL4_SEED),
        ("gate4", EvaluationDomain::Gate4, GATE4_SEED),
        ("gate5", EvaluationDomain::Gate5, GATE5_SEED),
        ("tuning5", EvaluationDomain::Tuning5, TUNING5_SEED),
        ("tuning6", EvaluationDomain::Tuning6, TUNING6_SEED),
        ("eval5", EvaluationDomain::Eval5, EVAL5_SEED),
        ("gate6", EvaluationDomain::Gate6, GATE6_SEED),
        ("perf", EvaluationDomain::Perf, PERF_SEED),
    ] {
        assert_eq!(EvaluationDomain::parse(spelling), Ok(domain));
        assert_eq!(domain.name(), spelling);
        let mut seeds = BTreeSet::new();
        for seats in 2..=6 {
            assert_eq!(domain.seed(seats), mix64(seed ^ seats as u64));
            seeds.insert(domain.seed(seats));
        }
        assert_eq!(seeds.len(), 5, "{spelling} must have a distinct seed per seat count");
    }

    // The gate seeds the M-82 to M-86 preregistrations name, in decimal as a run reports them.
    let gate4 = [
        16890014424357517501,
        9339080276862700003,
        16013495161676280900,
        15970491955241482323,
        4584976607990361878_u64,
    ];
    for (seats, seed) in (2..=6).zip(gate4) {
        assert_eq!(EvaluationDomain::Gate4.seed(seats), seed);
    }

    assert_eq!(
        EvaluationDomain::parse("tuning7"),
        Err("unknown evaluation domain tuning7".to_string())
    );
}

#[test]
fn gate5_seeds_are_pinned_and_boards_depend_only_on_index_and_seats() {
    let seeds = [
        5927599046091062298,
        17878949590863306731,
        1882428495990014522,
        1303817596113500737,
        18002440845045093778_u64,
    ];
    for (seats, seed) in (2..=6).zip(seeds) {
        assert_eq!(EvaluationDomain::Gate5.seed(seats), seed);
        let layout = if seats <= 4 { Layout::Standard4 } else { Layout::Extension6 };
        let boards = (0..5).map(|index| {
            generate_board(layout, seats, mix64(seed ^ index)).unwrap()
        }).collect::<Vec<_>>();
        for index in [4, 0, 2, 1, 3] {
            let board = generate_board(
                layout, seats, mix64(EvaluationDomain::Gate5.seed(seats) ^ index as u64),
            ).unwrap();
            assert_eq!(board.tiles(), boards[index].tiles());
            assert_eq!(board.tokens(), boards[index].tokens());
            let ports = |board: &unsettled_engine::board::SimBoard| {
                board.ports().iter().map(|port| (port.edge, port.resource, port.rate))
                    .collect::<Vec<_>>()
            };
            assert_eq!(ports(&board), ports(&boards[index]));
            assert_eq!(board.seats(), seats);
        }
    }
}

#[test]
fn the_fifth_and_sixth_generation_seeds_are_pinned_and_boards_depend_only_on_index_and_seats() {
    for (domain, seeds) in [
        (EvaluationDomain::Tuning5, [
            9749611205506466981,
            6585542083186182294,
            10047352188316269934,
            10106711019344858928,
            9141560125848139032_u64,
        ]),
        (EvaluationDomain::Tuning6, [
            6987785089044613290,
            3891242770353448390,
            10216551319237103558,
            9901259806954877661,
            2767015885771881090_u64,
        ]),
        (EvaluationDomain::Eval5, [
            17534200639746944500,
            11873229744119493496,
            17487792558230500384,
            3197586571723816237,
            2123246737809549434_u64,
        ]),
        (EvaluationDomain::Gate6, [
            1851724665474058977,
            6375351681707477482,
            9829167109056116078,
            4024240259393574906,
            3354919913705565985_u64,
        ]),
    ] {
        for (seats, seed) in (2..=6).zip(seeds) {
            assert_eq!(domain.seed(seats), seed);
            let layout = if seats <= 4 { Layout::Standard4 } else { Layout::Extension6 };
            let boards = (0..5).map(|index| {
                generate_board(layout, seats, mix64(seed ^ index)).unwrap()
            }).collect::<Vec<_>>();
            for index in [4, 0, 2, 1, 3] {
                let board = generate_board(
                    layout, seats, mix64(domain.seed(seats) ^ index as u64),
                ).unwrap();
                assert_eq!(board.tiles(), boards[index].tiles());
                assert_eq!(board.tokens(), boards[index].tokens());
                let ports = |board: &unsettled_engine::board::SimBoard| {
                    board.ports().iter().map(|port| (port.edge, port.resource, port.rate))
                        .collect::<Vec<_>>()
                };
                assert_eq!(ports(&board), ports(&boards[index]));
                assert_eq!(board.seats(), seats);
            }
        }
    }
}

/// SP3's expansion term and SP5's draft kind, played rather than scored.
///
/// Every other placement kind reaches `GameArena::play` through some harness test; these two did
/// not. `expansionWeight` above 0 sends `choose_app_formula` down its road-rule return instead of
/// the far-endpoint scoring, which draws differently from the policy RNG, and the draft kind
/// leaves that stream alone entirely. A draft arm carrying a nonzero expansion weight is also the
/// only way `ScoreRows` takes its uncached scratch path through a whole replay. Legality and
/// one-versus-all-threads byte identity are what a played game can say about all of that.
#[test]
fn the_expansion_term_and_the_draft_kind_play_legal_deterministic_games() {
    let shipped: EngineWeights =
        serde_json::from_str(include_str!("../../../placement/default-weights.json")).unwrap();
    assert_eq!(
        shipped.expansion_weight, 0.1,
        "the shipped weight is the adopted 0.1"
    );
    // The plain draft arm is here to leave the policy RNG stream alone, which needs the walk off,
    // and the shipped vector stopped supplying that when M-66 adopted the term. So the contrast
    // is spelled out: one draft kind with the walk closed, one with it opened wide.
    let mut closed = shipped.clone();
    closed.expansion_weight = 0.0;
    let mut opened = shipped;
    opened.expansion_weight = 0.3;
    opened.validate().expect("the witness weight is admissible");

    let expansion =
        register_app_formula("app_formula:expansion-witness".into(), opened.clone()).unwrap();
    let draft = register_app_formula_draft(
        "app_formula_draft:walk-off@walk-off".into(),
        closed.clone(),
        closed,
    )
    .unwrap();
    let draft_expansion = register_app_formula_draft(
        "app_formula_draft:expansion-witness@expansion-witness".into(),
        opened.clone(),
        opened,
    )
    .unwrap();
    let arms = vec![
        ("expansion".to_string(), expansion),
        ("draft".to_string(), draft),
        ("draft_expansion".to_string(), draft_expansion),
    ];
    let specs = vec![
        "app_formula:expansion-witness".to_string(),
        "app_formula_draft:walk-off@walk-off".to_string(),
        "app_formula_draft:expansion-witness@expansion-witness".to_string(),
    ];

    let single = run(
        Layout::Standard4,
        4,
        "app_formula:expansion-witness",
        expansion,
        &arms,
        &specs,
        Some("draft"),
        2,
        1,
        1,
        PolicyKind::HeuristicV1,
        false,
    );
    let all_cores = run(
        Layout::Standard4,
        4,
        "app_formula:expansion-witness",
        expansion,
        &arms,
        &specs,
        Some("draft"),
        2,
        1,
        0,
        PolicyKind::HeuristicV1,
        false,
    );

    assert_eq!(single.illegal_actions, 0);
    assert_eq!(all_cores.illegal_actions, 0);
    assert_eq!(
        serde_json::to_vec_pretty(&single).unwrap(),
        serde_json::to_vec_pretty(&all_cores).unwrap()
    );
    for arm in ["expansion", "draft", "draft_expansion"] {
        assert!(single.arms[arm].games > 0, "{arm} played no games");
    }
}

#[test]
fn units_are_identical_across_chunk_sizes_and_thread_counts() {
    let arms = [("base".into(), PlacementKind::MaxPips), ("other".into(), PlacementKind::PipDiversity)];
    let specs = ["max_pips".into(), "pip_diversity".into()];
    let path = std::path::Path::new(env!("CARGO_TARGET_TMPDIR")).join("units-chunks.csv");
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    let mut expected = None;
    for threads in [1, 3] {
        for chunk in [1, 2, 5] {
            let evaluation = evaluate_in_chunks(EvaluateRequest {
                layout: Layout::Standard4, seats: 4, domain: EvaluationDomain::Tuning,
                field_spec: "max_pips", field: PlacementKind::MaxPips, arms: &arms, arm_specs: &specs,
                arm_policies: &[None, None], arm_policy_names: &[None, None], reference: Some("base"),
                boards: 5, reps: 1, policy: PolicyKind::RandomLegal, policy_name: "random-legal",
                player_trading: None, threshold: 0.005, alpha: 0.05, threads, allow_unofficial: false,
                units: Some(&path), where_rule: None,
            }, chunk).unwrap();
            let csv = std::fs::read(&path).unwrap();
            let text = std::str::from_utf8(&csv).unwrap();
            let rows = text.lines().skip(1).map(|line| line.split(',').collect::<Vec<_>>()).collect::<Vec<_>>();
            assert_eq!(rows.len(), 20);
            assert!((0..4).any(|seat| (1..5).any(|board| rows[seat][7..10] != rows[4 * board + seat][7..10])),
                "race readings must differ between boards at the same seat");
            let actual = (csv, serde_json::to_vec_pretty(&evaluation).unwrap());
            if let Some(expected) = &expected {
                assert_eq!(&actual, expected, "chunk {chunk}, threads {threads}");
            } else {
                expected = Some(actual);
            }
        }
    }
    std::fs::remove_file(path).unwrap();
}

fn filtered_chunks(rule: &str, chunk: usize) -> Result<unsettled_sim::evaluate::Evaluation, String> {
    let weights: EngineWeights =
        serde_json::from_str(include_str!("../../../placement/default-weights.json")).unwrap();
    let base = register_app_formula_draft("where-base".into(), weights.clone(), weights.clone()).unwrap();
    let mut changed = weights.clone();
    changed.contest_weight = 0.75;
    let other = register_app_formula_draft("where-other".into(), changed, weights).unwrap();
    let arms = [("base".into(), base), ("other".into(), other)];
    evaluate_in_chunks(EvaluateRequest {
        layout: Layout::Standard4, seats: 4, domain: EvaluationDomain::Tuning,
        field_spec: "where-base", field: base, arms: &arms,
        arm_specs: &["where-base".into(), "where-other".into()],
        arm_policies: &[None, None], arm_policy_names: &[None, None], reference: Some("base"),
        boards: 6, reps: 2, policy: PolicyKind::HeuristicV1, policy_name: "heuristic-v1",
        player_trading: None, threshold: 0.005, alpha: 0.05, threads: 1, allow_unofficial: false,
        units: None, where_rule: Some(rule),
    }, chunk)
}

#[test]
fn a_where_run_is_the_same_at_every_chunk_size() {
    let topology = unsettled_engine::topology::Topology::load(Layout::Standard4).unwrap();
    let mut values = (0..6).map(|index| {
        let board = generate_board(Layout::Standard4, 4, mix64(TUNING_SEED ^ index)).unwrap();
        unsettled_engine::placement::features::TerrainFeatures::read(&topology, board.tiles(), board.tokens(), board.seats()).road_pips
    }).collect::<Vec<_>>();
    values.sort_unstable();
    assert!(values.iter().any(|value| *value < values[3]));
    let rule = format!("roadPips>={}", values[3]);
    let single = filtered_chunks(&rule, 1).unwrap();
    let whole = filtered_chunks(&rule, 6).unwrap();
    for evaluation in [&single, &whole] {
        let fired = evaluation.config.fired_units.unwrap();
        assert!(fired > 0 && fired < evaluation.config.units);
    }
    assert_eq!(serde_json::to_vec_pretty(&single).unwrap(),
        serde_json::to_vec_pretty(&whole).unwrap());
}

#[test]
fn a_where_rule_that_fires_nowhere_is_an_error() {
    for chunk in [1, 6] {
        let error = filtered_chunks("roadPips<0", chunk).unwrap_err();
        assert!(error.contains("roadPips<0"), "{error}");
        assert!(error.contains("no unit"), "{error}");
    }
}

#[test]
fn shipped_selection_is_the_seat_vector_where_no_strategy_fires() {
    use std::process::Command;
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let temporary = std::env::temp_dir().join(format!("unsettled-shipped-selection-{}", std::process::id()));
    for seats in [2, 3, 4, 6] {
        let explicit = "app_formula_draft:placement/seat-weights/seats-{seats}.json@placement/seat-weights/seats-{seats}.json";
        let mut expected = None;
        for spec in ["app_formula_shipped", explicit] {
            let out = temporary.join(format!("{seats}-{}", if spec == explicit { "explicit" } else { "shipped" }));
            let output = Command::new(env!("CARGO_BIN_EXE_unsettled-sim"))
                .current_dir(&root)
                .args(["evaluate", "--layout", if seats == 6 { "extension6" } else { "standard4" }, "--seats", &seats.to_string(), "--domain", "perf",
                    "--field", spec, "--arm", &format!("base={spec}"), "--reference", "base", "--boards", "6", "--reps", "1",
                    "--policy", "heuristic-v1-trader-aware-threat-devcards-denial", "--threads", "1", "--allow-unofficial", "--out"])
                .arg(&out).output().unwrap();
            assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
            let mut json: serde_json::Value = serde_json::from_slice(&std::fs::read(out.join("evaluation.json")).unwrap()).unwrap();
            let heuristic = if spec == explicit { format!("app_formula_draft:seats-{seats}@seats-{seats}") } else { spec.into() };
            for (pointer, spelling) in [("/config/field", spec), ("/config/fieldHeuristic", heuristic.as_str()),
                ("/arms/base/spec", spec), ("/arms/base/heuristic", heuristic.as_str())] {
                let field = json.pointer_mut(pointer).unwrap();
                assert_eq!(field.as_str(), Some(spelling), "{seats} {pointer}");
                *field = "same spelling".into();
            }
            if let Some(expected) = &expected {
                assert_eq!(&json, expected, "{seats} seats");
            } else {
                expected = Some(json);
            }
        }
    }
    std::fs::remove_dir_all(temporary).unwrap();
}
