use std::collections::BTreeSet;

use unsettled_engine::placement::app_formula::EngineWeights;
use unsettled_engine::placement::{PlacementKind, register_app_formula, register_app_formula_draft};
use unsettled_engine::policy::PolicyKind;
use unsettled_engine::rng::{derive_evaluation_seed, mix64};
use unsettled_engine::topology::Layout;
use unsettled_sim::boardgen::generate_board;
use unsettled_sim::evaluate::{
    EVAL2_SEED, EVAL_SEED, EvaluateRequest, EvaluationDomain, GATE2_SEED, GATE_SEED,
    TUNING2_SEED, TUNING_SEED, evaluate, evaluation_schedule,
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
        PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacyall => {
            "heuristic-v1-trader-aware-threat-devcards-denial-legacyall"
        }
        PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacyport => {
            "heuristic-v1-trader-aware-threat-devcards-denial-legacyport"
        }
        PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacychooser => {
            "heuristic-v1-trader-aware-threat-devcards-denial-legacychooser"
        }
        PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacycityterms => {
            "heuristic-v1-trader-aware-threat-devcards-denial-legacycityterms"
        }
        PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacyband => {
            "heuristic-v1-trader-aware-threat-devcards-denial-legacyband"
        }
        PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacycitygoal => {
            "heuristic-v1-trader-aware-threat-devcards-denial-legacycitygoal"
        }
        PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacycards => {
            "heuristic-v1-trader-aware-threat-devcards-denial-legacycards"
        }
        PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacydeck => {
            "heuristic-v1-trader-aware-threat-devcards-denial-legacydeck"
        }
        PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacyexposure => {
            "heuristic-v1-trader-aware-threat-devcards-denial-legacyexposure"
        }
        PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacyrace => {
            "heuristic-v1-trader-aware-threat-devcards-denial-legacyrace"
        }
        PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacyembargo => {
            "heuristic-v1-trader-aware-threat-devcards-denial-legacyembargo"
        }
        PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacypair => {
            "heuristic-v1-trader-aware-threat-devcards-denial-legacypair"
        }
        PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacyknight => {
            "heuristic-v1-trader-aware-threat-devcards-denial-legacyknight"
        }
        PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialSbmute => {
            "heuristic-v1-trader-aware-threat-devcards-denial-sbmute"
        }
        PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialSbhold => {
            "heuristic-v1-trader-aware-threat-devcards-denial-sbhold"
        }
        PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialGoalneedlo => {
            "heuristic-v1-trader-aware-threat-devcards-denial-goalneedlo"
        }
        PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialGoalneedhi => {
            "heuristic-v1-trader-aware-threat-devcards-denial-goalneedhi"
        }
        PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialStagelo => {
            "heuristic-v1-trader-aware-threat-devcards-denial-stagelo"
        }
        PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialStagehi => {
            "heuristic-v1-trader-aware-threat-devcards-denial-stagehi"
        }
        PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialEconlo => {
            "heuristic-v1-trader-aware-threat-devcards-denial-econlo"
        }
        PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialEconhi => {
            "heuristic-v1-trader-aware-threat-devcards-denial-econhi"
        }
        PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialHystlo => {
            "heuristic-v1-trader-aware-threat-devcards-denial-hystlo"
        }
        PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialHysthi => {
            "heuristic-v1-trader-aware-threat-devcards-denial-hysthi"
        }
        PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialFrontierlo => {
            "heuristic-v1-trader-aware-threat-devcards-denial-frontierlo"
        }
        PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialFrontierhi => {
            "heuristic-v1-trader-aware-threat-devcards-denial-frontierhi"
        }
        PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialJall => {
            "heuristic-v1-trader-aware-threat-devcards-denial-jall"
        }
        PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialJnohyst => {
            "heuristic-v1-trader-aware-threat-devcards-denial-jnohyst"
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
        pair.per_hero_seat.iter().map(|seat| seat.n).sum::<usize>(),
        pair.stats.n
    );
    assert_eq!(
        pair.per_hero_seat
            .iter()
            .map(|seat| seat.b + seat.c)
            .sum::<u64>(),
        pair.stats.b + pair.stats.c
    );
    // Every board contributes `reps` units to each seat, so a seat's slice keeps the
    // full cluster count and only its cluster size shrinks.
    assert!(
        pair.per_hero_seat
            .iter()
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

    // Every domain the CLI accepts, pairwise, on both layouts: the seed stream a run
    // consumes and the board set it generates must both be new to a held-out domain.
    let domains = [
        ("tuning", TUNING_SEED),
        ("eval", EVAL_SEED),
        ("gate", GATE_SEED),
        ("tuning2", TUNING2_SEED),
        ("eval2", EVAL2_SEED),
        ("gate2", GATE2_SEED),
    ];
    let layouts = [(Layout::Standard4, 4), (Layout::Extension6, 6)];
    for (index, (left_name, left)) in domains.iter().enumerate() {
        for (right_name, right) in &domains[index + 1..] {
            assert!(
                seeds(*left).is_disjoint(&seeds(*right)),
                "{left_name} and {right_name} share evaluation seeds"
            );
            for (layout, seats) in layouts {
                assert_ne!(
                    boards(*left, layout, seats),
                    boards(*right, layout, seats),
                    "{left_name} and {right_name} generate the same {layout:?} boards"
                );
            }
        }
    }
}

/// The six spellings the CLI parses, and the one it must not.
///
/// `EvaluationDomain::seed` is the only place a run's whole seed stream is chosen, so a
/// domain that parses to the wrong constant would silently spend a held-out set. The
/// unknown case is pinned too: a typo like `tuning3` has to fail rather than fall back.
#[test]
fn every_evaluation_domain_parses_to_its_own_named_seed() {
    let expected = [
        ("tuning", EvaluationDomain::Tuning, TUNING_SEED),
        ("eval", EvaluationDomain::Eval, EVAL_SEED),
        ("gate", EvaluationDomain::Gate, GATE_SEED),
        ("tuning2", EvaluationDomain::Tuning2, TUNING2_SEED),
        ("eval2", EvaluationDomain::Eval2, EVAL2_SEED),
        ("gate2", EvaluationDomain::Gate2, GATE2_SEED),
    ];
    for (spelling, domain, seed) in expected {
        assert_eq!(EvaluationDomain::parse(spelling), Ok(domain));
        assert_eq!(domain.name(), spelling);
        assert_eq!(domain.seed(), seed);
    }

    assert_eq!(
        EvaluationDomain::parse("tuning3"),
        Err("unknown evaluation domain tuning3".to_string())
    );
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
