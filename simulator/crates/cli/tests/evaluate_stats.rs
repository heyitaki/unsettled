use unsettled_sim::evaluate::{pair_verdict, paired_stats, parse_arm_spec, try_paired_stats};
use unsettled_sim::stats::{alpha_z, wilson, wilson95};

const Z_95: f64 = 1.959_963_984_540_054;

#[test]
fn arm_specs_split_on_only_the_first_equals_sign() {
    assert_eq!(
        parse_arm_spec("candidate=app_formula:path=variant.json").unwrap(),
        (
            "candidate".to_string(),
            "app_formula:path=variant.json".to_string()
        )
    );
}

#[test]
fn invalid_paired_schedules_return_named_errors() {
    assert_eq!(
        try_paired_stats(&[true], &[], &[0], 1, Z_95).unwrap_err(),
        "paired statistics vectors must have equal lengths"
    );
    assert_eq!(
        try_paired_stats(&[true], &[false], &[0], 0, Z_95).unwrap_err(),
        "paired statistics require at least one board"
    );
    assert_eq!(
        try_paired_stats(&[true], &[false], &[1], 1, Z_95).unwrap_err(),
        "paired statistics board index 1 is outside 1 clusters"
    );
    assert_eq!(
        try_paired_stats(
            &[true, false, true],
            &[false, false, false],
            &[0, 0, 1],
            2,
            Z_95,
        )
        .unwrap_err(),
        "paired statistics require a balanced board schedule"
    );
}

#[test]
fn zero_discordant_units_have_exact_zero_intervals() {
    let stats = paired_stats(
        &[true, false, true, false],
        &[true, false, true, false],
        &[0, 0, 1, 1],
        2,
        Z_95,
    );

    assert_eq!(stats.b, 0);
    assert_eq!(stats.c, 0);
    assert_eq!(stats.estimate, 0.0);
    assert_eq!(stats.mcnemar, [0.0, 0.0]);
    assert_eq!(stats.clustered, [0.0, 0.0]);
    assert!(stats.interval.iter().all(|value| value.is_finite()));
}

#[test]
fn fully_discordant_units_clamp_to_the_bounded_difference_range() {
    let positive = paired_stats(
        &[true, true, true, true],
        &[false, false, false, false],
        &[0, 0, 1, 1],
        2,
        Z_95,
    );
    let negative = paired_stats(
        &[false, false, false, false],
        &[true, true, true, true],
        &[0, 0, 1, 1],
        2,
        Z_95,
    );

    assert_eq!((positive.b, positive.c), (4, 0));
    assert_eq!(positive.mcnemar, [1.0, 1.0]);
    assert_eq!(positive.clustered, [1.0, 1.0]);
    assert_eq!(positive.interval, [1.0, 1.0]);
    assert_eq!((negative.b, negative.c), (0, 4));
    assert_eq!(negative.mcnemar, [-1.0, -1.0]);
    assert_eq!(negative.clustered, [-1.0, -1.0]);
    assert_eq!(negative.interval, [-1.0, -1.0]);
}

#[test]
fn a_single_board_forces_a_maximal_clustered_interval() {
    let stats = paired_stats(
        &[true, true, false, false],
        &[false, true, true, false],
        &[0, 0, 0, 0],
        1,
        Z_95,
    );

    assert_eq!(stats.clustered, [-1.0, 1.0]);
    assert!(stats.clustered_degenerate);
    assert_eq!(stats.interval_used, "clustered");
    assert_eq!(stats.interval, [-1.0, 1.0]);
    assert_eq!(pair_verdict(stats.interval, 0.0), "inconclusive");
}

#[test]
fn the_wider_interval_is_selected_in_both_directions() {
    let mcnemar_wider = paired_stats(
        &[true, false, true, false],
        &[false, true, false, true],
        &[0, 0, 1, 1],
        2,
        1.0,
    );
    let clustered_wider = paired_stats(
        &[true, true, false, false],
        &[false, false, true, true],
        &[0, 0, 1, 1],
        2,
        1.0,
    );

    assert_eq!(mcnemar_wider.interval_used, "mcnemar");
    assert!(
        mcnemar_wider.mcnemar[1] - mcnemar_wider.mcnemar[0]
            > mcnemar_wider.clustered[1] - mcnemar_wider.clustered[0]
    );
    assert_eq!(clustered_wider.interval_used, "clustered");
    assert!(
        clustered_wider.clustered[1] - clustered_wider.clustered[0]
            > clustered_wider.mcnemar[1] - clustered_wider.mcnemar[0]
    );
}

#[test]
fn balanced_cluster_mean_matches_the_unit_estimate() {
    let arm = [true, true, false, false, true, false, true, false, false];
    let reference = [false, true, true, false, false, true, false, false, true];
    let board_of_unit = [0, 0, 0, 1, 1, 1, 2, 2, 2];
    let stats = paired_stats(&arm, &reference, &board_of_unit, 3, Z_95);
    let board_means = (0..3)
        .map(|board| {
            let sum: i64 = arm
                .iter()
                .zip(&reference)
                .zip(&board_of_unit)
                .filter(|(_, candidate)| **candidate == board)
                .map(|((arm_won, reference_won), _)| {
                    i64::from(*arm_won) - i64::from(*reference_won)
                })
                .sum();
            sum as f64 / 3.0
        })
        .collect::<Vec<_>>();
    let clustered_mean = board_means.iter().sum::<f64>() / board_means.len() as f64;

    assert!((clustered_mean - stats.estimate).abs() <= 1e-12);
}

#[test]
fn every_preregistered_verdict_branch_is_reachable() {
    let board_of_unit = [0, 1, 2, 3];
    let better = paired_stats(
        &[true, true, true, false],
        &[false, false, false, false],
        &board_of_unit,
        4,
        0.0,
    );
    let worse = paired_stats(
        &[false, false, false, false],
        &[true, true, true, false],
        &board_of_unit,
        4,
        0.0,
    );
    // A zero-width interval at zero reads `equivalent` against any positive threshold
    // and `inconclusive` against a threshold of zero, which is the only pair of
    // branches that turns on the threshold alone.
    let null = paired_stats(
        &[true, false, true, false],
        &[true, false, true, false],
        &board_of_unit,
        4,
        0.0,
    );

    assert_eq!(pair_verdict(better.interval, 0.25), "better");
    assert_eq!(pair_verdict(worse.interval, 0.25), "worse");
    assert_eq!(pair_verdict(null.interval, 0.25), "equivalent");
    assert_eq!(pair_verdict(null.interval, 0.0), "inconclusive");
}

#[test]
fn supported_alphas_use_reference_quantiles() {
    assert_eq!(alpha_z(0.05).unwrap(), Z_95);
    assert_eq!(alpha_z(0.01).unwrap(), 2.575_829_303_548_900_4);
    assert_eq!(alpha_z(0.10).unwrap(), 1.644_853_626_951_472_2);
}

#[test]
fn unsupported_alphas_are_named_errors() {
    for alpha in [
        0.0,
        1.0,
        0.025,
        -0.05,
        f64::NAN,
        f64::INFINITY,
        f64::NEG_INFINITY,
    ] {
        assert_eq!(
            alpha_z(alpha).unwrap_err(),
            "--alpha must be one of 0.10, 0.05, or 0.01"
        );
    }
}

#[test]
fn wilson95_is_the_exact_legacy_expression() {
    for (wins, games) in [(0, 0), (0, 10), (3, 10), (10, 10), (812, 3_200)] {
        assert_eq!(wilson95(wins, games), wilson(wins, games, Z_95));
    }
}
