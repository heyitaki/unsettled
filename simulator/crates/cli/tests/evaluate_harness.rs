use std::collections::BTreeSet;

use unsettled_engine::placement::app_formula::EngineWeights;
use unsettled_engine::placement::{PlacementKind, register_app_formula};
use unsettled_engine::policy::PolicyKind;
use unsettled_engine::rng::{derive_evaluation_seed, mix64};
use unsettled_engine::topology::Layout;
use unsettled_sim::boardgen::generate_board;
use unsettled_sim::evaluate::{
    EVAL_SEED, EvaluateRequest, EvaluationDomain, TUNING_SEED, evaluate, evaluation_schedule,
    summarize_arm,
};

fn policy_name(policy: PolicyKind) -> &'static str {
    match policy {
        PolicyKind::RandomLegal => "random-legal",
        PolicyKind::GreedyNoTrade => "greedy-no-trade",
        PolicyKind::PriorityTrader => "priority-trader",
        PolicyKind::HeuristicV1 => "heuristic-v1",
        PolicyKind::HeuristicV1Noports => "heuristic-v1-noports",
        PolicyKind::HeuristicV1Threat => "heuristic-v1-threat",
        PolicyKind::HeuristicV1Trader => "heuristic-v1-trader",
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
    let tuning = (0..5)
        .flat_map(|board| {
            (0..3).flat_map(move |rep| {
                (0..4).map(move |hero_seat| {
                    derive_evaluation_seed(TUNING_SEED, board, rep, hero_seat)
                })
            })
        })
        .collect::<BTreeSet<_>>();
    let evaluation = (0..5)
        .flat_map(|board| {
            (0..3).flat_map(move |rep| {
                (0..4)
                    .map(move |hero_seat| derive_evaluation_seed(EVAL_SEED, board, rep, hero_seat))
            })
        })
        .collect::<BTreeSet<_>>();
    assert!(tuning.is_disjoint(&evaluation));

    let tuning_boards = (0..5)
        .map(|board| {
            let board = generate_board(Layout::Standard4, 4, mix64(TUNING_SEED ^ board)).unwrap();
            (board.tiles().to_vec(), board.tokens().to_vec())
        })
        .collect::<Vec<_>>();
    let evaluation_boards = (0..5)
        .map(|board| {
            let board = generate_board(Layout::Standard4, 4, mix64(EVAL_SEED ^ board)).unwrap();
            (board.tiles().to_vec(), board.tokens().to_vec())
        })
        .collect::<Vec<_>>();
    assert_ne!(tuning_boards, evaluation_boards);
}
