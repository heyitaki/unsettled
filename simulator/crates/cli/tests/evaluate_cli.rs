use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

fn simulator_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn output_dir(name: &str) -> PathBuf {
    Path::new(env!("CARGO_TARGET_TMPDIR")).join(name)
}

fn evaluate(arguments: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_unsettled-sim"))
        .current_dir(simulator_root())
        .arg("evaluate")
        .args(arguments)
        .output()
        .unwrap()
}

fn valid_arguments(out: &Path) -> Vec<String> {
    vec![
        "--domain".into(),
        "tuning".into(),
        "--field".into(),
        "max_pips".into(),
        "--arm".into(),
        "base=max_pips".into(),
        "--boards".into(),
        "1".into(),
        "--reps".into(),
        "1".into(),
        "--threads".into(),
        "1".into(),
        "--out".into(),
        out.display().to_string(),
    ]
}

fn assert_named_error(arguments: &[String], expected: &str) -> String {
    let arguments = arguments.iter().map(String::as_str).collect::<Vec<_>>();
    let output = evaluate(&arguments);
    assert_eq!(output.status.code(), Some(2));
    let stderr = String::from_utf8(output.stderr).unwrap();
    assert!(
        stderr.contains(expected),
        "expected {expected:?} in stderr:\n{stderr}"
    );
    assert!(!stderr.contains("panicked"));
    stderr
}

#[test]
fn duplicate_arm_labels_are_rejected() {
    let out = output_dir("evaluate-cli-duplicate-label");
    let mut arguments = valid_arguments(&out);
    arguments.splice(
        6..6,
        ["--arm".to_string(), "base=pip_diversity".to_string()],
    );
    assert_named_error(&arguments, "duplicate arm label base");
}

#[test]
fn empty_and_malformed_arm_labels_are_rejected() {
    let out = output_dir("evaluate-cli-malformed-label");
    let mut empty = valid_arguments(&out);
    empty[5] = "=max_pips".into();
    assert_named_error(&empty, "arm label must not be empty");

    let mut missing_equals = valid_arguments(&out);
    missing_equals[5] = "max_pips".into();
    assert_named_error(&missing_equals, "arm must be label=spec");
}

#[test]
fn a_missing_weights_file_is_a_named_error() {
    let out = output_dir("evaluate-cli-missing-weights");
    let mut arguments = valid_arguments(&out);
    arguments[5] = "base=app_formula:placement/not-present.json".into();
    assert_named_error(&arguments, "failed to read app formula weights");
}

#[test]
fn a_malformed_weights_file_is_a_named_error() {
    let out = output_dir("evaluate-cli-malformed-weights");
    let weights = output_dir("evaluate-cli-invalid-weights.json");
    fs::write(&weights, b"{not valid json").unwrap();
    let mut arguments = valid_arguments(&out);
    arguments[5] = format!("base=app_formula:{}", weights.display());
    assert_named_error(&arguments, "invalid app formula weights");
}

#[test]
fn domain_is_required_by_the_command_line_parser() {
    let out = output_dir("evaluate-cli-missing-domain");
    let mut arguments = valid_arguments(&out);
    arguments.drain(0..2);
    assert_named_error(&arguments, "--domain <DOMAIN>");
}

/// The SP6 domains reach the binary, and a near miss does not.
///
/// `EvaluationDomain::parse` is unit-pinned beside the seed constants; this checks the
/// spelling survives the command line, since a domain the parser accepts but the CLI
/// rejects would be discovered only by a failed measurement run.
#[test]
fn the_second_generation_domains_are_accepted_and_a_typo_is_not() {
    for domain in ["tuning2", "eval2", "gate2", "perf"] {
        let out = output_dir(&format!("evaluate-cli-domain-{domain}"));
        let mut arguments = valid_arguments(&out);
        arguments[1] = domain.into();
        let arguments = arguments.iter().map(String::as_str).collect::<Vec<_>>();
        let output = evaluate(&arguments);
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8(output.stderr).unwrap()
        );
        let artifact: serde_json::Value =
            serde_json::from_slice(&fs::read(out.join("evaluation.json")).unwrap()).unwrap();
        assert_eq!(artifact["config"]["domain"], domain);
    }

    let out = output_dir("evaluate-cli-domain-typo");
    let mut arguments = valid_arguments(&out);
    arguments[1] = "tuning7".into();
    assert_named_error(&arguments, "unknown evaluation domain tuning7");
}

#[test]
fn unsupported_alphas_are_rejected() {
    for alpha in ["0", "1", "0.025", "NaN", "inf"] {
        let out = output_dir(&format!("evaluate-cli-alpha-{alpha}"));
        let mut arguments = valid_arguments(&out);
        arguments.extend(["--alpha".into(), alpha.into()]);
        assert_named_error(&arguments, "--alpha must be one of 0.10, 0.05, or 0.01");
    }
}

#[test]
fn zero_boards_are_rejected() {
    let out = output_dir("evaluate-cli-zero-boards");
    let mut arguments = valid_arguments(&out);
    arguments[7] = "0".into();
    assert_named_error(&arguments, "boards must be positive");
}

#[test]
fn zero_reps_are_rejected() {
    let out = output_dir("evaluate-cli-zero-reps");
    let mut arguments = valid_arguments(&out);
    arguments[9] = "0".into();
    assert_named_error(&arguments, "reps must be positive");
}

#[test]
fn an_empty_arm_list_is_rejected() {
    let out = output_dir("evaluate-cli-empty-arms");
    let mut arguments = valid_arguments(&out);
    arguments.drain(4..6);
    assert_named_error(&arguments, "at least one arm is required");
}

#[test]
fn multiple_arms_require_a_valid_reference() {
    let out = output_dir("evaluate-cli-reference");
    let mut missing = valid_arguments(&out);
    missing.splice(
        6..6,
        ["--arm".to_string(), "candidate=pip_diversity".to_string()],
    );
    assert_named_error(
        &missing,
        "reference is required when evaluating multiple arms",
    );

    let mut unknown = missing;
    unknown.extend(["--reference".into(), "absent".into()]);
    assert_named_error(&unknown, "reference absent does not name an arm");
}

#[test]
fn negative_thresholds_are_rejected() {
    let out = output_dir("evaluate-cli-negative-threshold");
    let mut arguments = valid_arguments(&out);
    arguments.extend(["--threshold".into(), "-0.01".into()]);
    assert_named_error(&arguments, "threshold must be finite and non-negative");
}

#[test]
fn unofficial_seat_counts_require_the_gate() {
    let out = output_dir("evaluate-cli-unofficial-seats");
    let mut arguments = valid_arguments(&out);
    arguments.extend(["--seats".into(), "5".into()]);
    assert_named_error(
        &arguments,
        "non-official layout and seat combinations require --allow-unofficial",
    );
}

#[test]
fn a_builtin_spelling_is_still_an_arm_label_namespace() {
    let out = output_dir("evaluate-cli-label-namespace");
    let output = evaluate(&[
        "--domain",
        "tuning",
        "--field",
        "max_pips",
        "--arm",
        "max_pips=app_formula:placement/default-weights.json",
        "--boards",
        "1",
        "--reps",
        "1",
        "--threads",
        "1",
        "--out",
        out.to_str().unwrap(),
    ]);
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8(output.stderr).unwrap()
    );
    let artifact: serde_json::Value =
        serde_json::from_slice(&fs::read(out.join("evaluation.json")).unwrap()).unwrap();

    assert!(artifact["arms"]["max_pips"].is_object());
    assert_eq!(
        artifact["arms"]["max_pips"]["heuristic"],
        "app_formula:default-weights"
    );
}

#[test]
fn tournament_plural_heuristic_collisions_still_fail() {
    let out = output_dir("evaluate-cli-tournament-collision");
    let output = Command::new(env!("CARGO_BIN_EXE_unsettled-sim"))
        .current_dir(simulator_root())
        .args([
            "tournament",
            "--random-boards",
            "1",
            "--reps",
            "1",
            "--heuristics",
            "max_pips,max_pips",
            "--threads",
            "1",
            "--out",
            out.to_str().unwrap(),
        ])
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(2));
    assert!(
        String::from_utf8(output.stderr)
            .unwrap()
            .contains("heuristic name collision: max_pips is used by multiple arms")
    );
}

#[test]
fn picks_only_requires_a_reference_and_at_least_two_arms_without_writing_picks() {
    for (name, extra) in [
        ("single-no-reference", vec![]),
        ("single-with-reference", vec!["--reference", "base"]),
        ("multiple-no-reference", vec!["--arm", "candidate=max_pips"]),
    ] {
        let out = output_dir(&format!("evaluate-cli-picks-{name}"));
        if out.exists() {
            fs::remove_dir_all(&out).unwrap();
        }
        let mut arguments = valid_arguments(&out);
        arguments.push("--picks-only".into());
        arguments.extend(extra.into_iter().map(str::to_string));
        assert_named_error(&arguments, "--picks-only requires --reference and at least two arms");
        assert!(!out.join("picks.json").exists());
    }
}

#[test]
fn picks_only_compares_arms_and_writes_only_repeatable_picks() {
    let out = output_dir("evaluate-cli-identical-picks");
    if out.exists() {
        fs::remove_dir_all(&out).unwrap();
    }
    let base = "app_formula_draft:placement/default-weights.json@placement/default-weights.json";
    let mut arguments = valid_arguments(&out);
    arguments[3] = base.into();
    arguments[5] =
        "candidate=app_formula_draft:placement/arms/sc_coverage_hi.json@placement/default-weights.json".into();
    arguments[9] = "3".into();
    arguments.extend([
        "--picks-only".into(), "--arm".into(), format!("same={base}"),
        "--reference".into(), "base".into(),
        "--arm".into(), format!("base={base}"),
    ]);
    let mut first = None;
    for _ in 0..2 {
        let args = arguments.iter().map(String::as_str).collect::<Vec<_>>();
        let output = evaluate(&args);
        assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
        let bytes = fs::read(out.join("picks.json")).unwrap();
        let artifact: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(artifact["config"]["domain"], "tuning");
        assert_eq!(artifact["config"]["field"], base);
        assert_eq!(artifact["config"]["reference"], "base");
        assert_eq!(artifact["config"]["reps"], 1);
        assert_eq!(artifact["config"]["units"], 4);
        for arm in ["base", "same"] {
            assert_eq!(artifact["arms"][arm]["units"], 4);
            assert_eq!(artifact["arms"][arm]["changed"], 0);
            assert_eq!(artifact["arms"][arm]["changedPickShare"], 0.0);
        }
        assert_eq!(artifact["arms"]["candidate"]["units"], 4);
        assert_eq!(artifact["arms"]["candidate"]["changed"], 1);
        assert_eq!(artifact["arms"]["candidate"]["changedPickShare"], 0.25);
        assert!(!out.join("evaluation.json").exists());
        if let Some(first) = &first {
            assert_eq!(&bytes, first);
        } else {
            first = Some(bytes);
        }
    }
}

fn run_success(arguments: &[String]) {
    let output = evaluate(&arguments.iter().map(String::as_str).collect::<Vec<_>>());
    assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
}

fn read_evaluation(out: &Path) -> serde_json::Value {
    serde_json::from_slice(&fs::read(out.join("evaluation.json")).unwrap()).unwrap()
}

fn units_arguments(out: &Path) -> Vec<String> {
    let mut arguments = valid_arguments(out);
    arguments[7] = "3".into();
    arguments[9] = "2".into();
    arguments.extend(["--reference", "base", "--arm", "other=pip_diversity", "--units"]
        .map(str::to_string));
    arguments
}

#[test]
fn units_writes_one_row_per_unit_in_schedule_order_and_repeats_exactly() {
    let out = output_dir("units-order");
    let mut arguments = units_arguments(&out);
    run_success(&arguments);
    let csv = fs::read_to_string(out.join("units.csv")).unwrap();
    let evaluation = fs::read(out.join("evaluation.json")).unwrap();
    let json = read_evaluation(&out);
    let mut lines = csv.lines();
    assert_eq!(lines.next().unwrap(),
        "board,slot,rep,roadPips,roadPipsMin,spotFalloff,topCrowding,heroReady,readyAhead,readyAheadTrade,base,other");
    let rows = lines.map(|line| line.split(',').collect::<Vec<_>>()).collect::<Vec<_>>();
    assert_eq!(rows.len(), 24);
    for (row, unit) in rows.iter().zip(unsettled_sim::evaluate::evaluation_schedule(3, 2, 4)) {
        assert_eq!(row[0], unit.board.to_string());
        assert_eq!(row[1], unit.hero_seat.to_string());
        assert_eq!(row[2], unit.rep.to_string());
    }
    for (column, arm) in [(10, "base"), (11, "other")] {
        let wins = rows.iter().map(|row| row[column].parse::<u64>().unwrap()).sum::<u64>();
        assert_eq!(json["arms"][arm]["wins"], wins);
    }
    arguments[11] = "0".into();
    run_success(&arguments);
    assert_eq!(fs::read(out.join("units.csv")).unwrap(), csv.as_bytes());
    assert_eq!(fs::read(out.join("evaluation.json")).unwrap(), evaluation);
    arguments.pop();
    run_success(&arguments);
    assert_eq!(fs::read(out.join("evaluation.json")).unwrap(), evaluation);
}

#[test]
fn units_rejects_a_label_that_breaks_the_csv() {
    for label in ["bad,label", "bad\nlabel", "bad\rlabel", "board", "slot", "rep", "roadPips",
        "roadPipsMin", "spotFalloff", "topCrowding", "heroReady", "readyAhead", "readyAheadTrade"] {
        let mut arguments = valid_arguments(&output_dir("units-bad-label"));
        arguments[5] = format!("{label}=max_pips");
        arguments.extend(["--reference".into(), label.into(), "--units".into()]);
        assert_named_error(&arguments, label);
    }
}

#[test]
fn units_and_where_reject_incompatible_flags_and_missing_reference() {
    let out = output_dir("units-invalid-flags");
    let mut arguments = valid_arguments(&out);
    arguments.push("--units".into());
    assert_named_error(&arguments, "--reference");
    for extra in [vec!["--units", "--picks-only"], vec!["--where", "slot>=1", "--picks-only"],
        vec!["--units", "--where", "slot>=1"]] {
        let mut arguments = valid_arguments(&out);
        arguments.extend(["--reference", "base"].map(str::to_string));
        arguments.extend(extra.into_iter().map(str::to_string));
        assert_named_error(&arguments, if arguments.contains(&"--where".into()) { "--where" } else { "--units" });
    }
}

#[test]
fn where_parser_reports_each_invalid_predicate_by_name() {
    for (rule, message) in [
        ("missing>=1", "unknown feature missing"),
        ("heroReady>=1", "heroReady is a diagnostic"),
        ("readyAhead>=1", "readyAhead is a diagnostic"),
        ("readyAheadTrade>=1", "readyAheadTrade is a diagnostic"),
        ("slot>1", "invalid operator in slot>1: expected >= or <"),
        ("slot<=1", "invalid operator in slot<=1: expected >= or <"),
        ("slot=1", "invalid operator in slot=1: expected >= or <"),
        ("slot>=nope", "invalid finite number \"nope\" in slot>=nope"),
        ("slot>=NaN", "invalid finite number \"NaN\" in slot>=NaN"),
        ("slot>=inf", "invalid finite number \"inf\" in slot>=inf"),
        ("", "empty predicate"), ("slot>=1&", "empty predicate"),
        ("slot>=1&roadPips<38&slot<3", "third predicate"),
        ("slot >=1", "spaces"),
    ] {
        let mut arguments = valid_arguments(&output_dir("where-invalid"));
        arguments.extend(["--where".into(), rule.into()]);
        let stderr = assert_named_error(&arguments, message);
        assert!(!stderr.contains("fires on no unit"), "{rule}: {stderr}");
    }
}

#[test]
fn a_where_rule_that_fires_nowhere_fails_and_writes_no_result() {
    let out = output_dir("where-nowhere");
    let mut arguments = valid_arguments(&out);
    arguments.extend(["--where", "roadPips<0"].map(str::to_string));
    assert_named_error(&arguments, "roadPips<0");
    assert!(!out.join("evaluation.json").exists());
}

#[test]
fn floor_met_is_exact_at_one_fifth() {
    for (seats, rule, expected) in [(5, "slot>=4", true), (6, "slot>=5", false)] {
        let out = output_dir(&format!("where-floor-{seats}"));
        let mut arguments = valid_arguments(&out);
        arguments.extend(["--layout".into(), "extension6".into(), "--seats".into(), seats.to_string(),
            "--where".into(), rule.into()]);
        run_success(&arguments);
        let json = read_evaluation(&out);
        assert_eq!(json["config"]["floorMet"], expected);
        assert_eq!(json["config"]["firedUnits"], 1);
        assert_eq!(json["arms"]["base"]["games"], 1);
    }
}

#[test]
fn where_output_is_absent_without_the_flag() {
    let out = output_dir("where-absent");
    run_success(&valid_arguments(&out));
    let json = read_evaluation(&out);
    for key in ["where", "firedUnits", "firedShare", "floorMet"] {
        assert!(json["config"].get(key).is_none(), "{key}");
    }
}

fn slice_command(out: &Path) {
    let output = Command::new(env!("CARGO_BIN_EXE_unsettled-sim"))
        .args(["slice", "--run"]).arg(out).output().unwrap();
    assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
}

#[test]
fn a_where_run_reports_the_pair_score_rule_computes_from_the_units_file() {
    let out = output_dir("where-restriction-units");
    let mut arguments = valid_arguments(&out);
    let field = "app_formula_draft:placement/arms/co_off_s4.json@placement/arms/co_off_s4.json";
    arguments[3] = field.into();
    arguments[5] = format!("base={field}");
    arguments[7] = "15".into();
    arguments[9] = "2".into();
    arguments[11] = "0".into();
    arguments.extend(["--reference", "base", "--arm",
        "flat_reprice=app_formula_draft:placement/arms/co_flat_reprice_s4.json@placement/arms/co_off_s4.json",
        "--policy", "random-legal",
        "--threshold", "0.005", "--units"].map(str::to_string));
    run_success(&arguments);
    slice_command(&out);
    let units = unsettled_sim::slice::read_run(&out).unwrap();
    let slices: serde_json::Value = serde_json::from_slice(&fs::read(out.join("slices.json")).unwrap()).unwrap();
    let full = read_evaluation(&out);
    let assert_pair = |a: &serde_json::Value, b: &serde_json::Value| {
        for field in ["n", "b", "c", "estimate", "mcnemar", "clustered", "clusters",
            "clusteredDegenerate", "intervalUsed", "interval"] {
            assert_eq!(a[field], b[field], "{field}");
        }
    };
    assert_pair(&slices["rules"][0], &full["pairs"][0]);
    let csv = fs::read_to_string(out.join("units.csv")).unwrap();
    let rows = csv.lines().skip(1).map(|line| line.split(',').collect::<Vec<_>>()).collect::<Vec<_>>();
    let mut road_pips = rows.iter().step_by(8)
        .map(|row| row[3].parse::<u16>().unwrap()).collect::<Vec<_>>();
    road_pips.sort_unstable();
    let cutoff = road_pips[3];
    assert!(road_pips.iter().any(|pips| *pips < cutoff));
    assert!(road_pips.iter().any(|pips| *pips >= cutoff));
    let fired_boards = rows.iter().step_by(8).filter(|row| row[3].parse::<u16>().unwrap() >= cutoff)
        .map(|row| row[0].parse::<usize>().unwrap()).collect::<Vec<_>>();
    assert!(fired_boards.iter().enumerate().any(|(renumbered, original)| renumbered != *original),
        "a dropped board must precede a fired board");
    arguments.pop();
    for (i, rule) in ["slot>=2".to_string(), format!("roadPips>={cutoff}"),
        format!("slot>=2&roadPips>={cutoff}")].iter().enumerate() {
        let filtered = output_dir(&format!("where-restriction-{i}"));
        arguments[13] = filtered.display().to_string();
        let mut filtered_args = arguments.clone();
        filtered_args.extend(["--where".into(), rule.clone()]);
        run_success(&filtered_args);
        let result = read_evaluation(&filtered);
        let scored = unsettled_sim::slice::score_rule(&units, "flat_reprice", rule).unwrap();
        if i > 0 {
            assert!(scored.stats.b + scored.stats.c >= 3, "{rule}: {:?}", scored.stats);
            assert_ne!(scored.stats.b, scored.stats.c, "{rule}");
            assert!(fired_boards.iter().enumerate().any(|(renumbered, original)| {
                renumbered != *original && rows.iter().any(|row| {
                    row[0].parse::<usize>().unwrap() == *original && row[10] != row[11]
                        && (i == 1 || row[1].parse::<usize>().unwrap() >= 2)
                })
            }), "{rule}: a discordant unit must belong to a renumbered board");
        }
        let scored_text = serde_json::to_string_pretty(&scored).unwrap();
        let result_text = fs::read_to_string(filtered.join("evaluation.json")).unwrap();
        let field_text = |text: &str, field: &str| {
            let key = format!("\"{field}\": ");
            let value = &text[text.find(&key).unwrap() + key.len()..];
            let end = if value.starts_with('[') { value.find(']').unwrap() + 1 }
                else { value.find('\n').unwrap() };
            value[..end].chars().filter(|c| !c.is_whitespace()).collect::<String>()
        };
        for field in ["n", "b", "c", "estimate", "mcnemar", "clustered", "clusters",
            "clusteredDegenerate", "intervalUsed", "interval"] {
            assert_eq!(field_text(&result_text, field), field_text(&scored_text, field), "{field}");
        }
        let scored: serde_json::Value = serde_json::from_str(&scored_text).unwrap();
        assert_pair(&result["pairs"][0], &scored);
        assert_eq!(result["config"]["firedUnits"], scored["firedUnits"]);
        if rule.contains("slot>=2") {
            assert!(result["pairs"][0]["perHeroSeat"][0].is_null());
            assert!(result["pairs"][0]["perHeroSeat"][1].is_null());
        }
    }
}

#[test]
fn units_rejects_an_unwritable_output_before_writing_a_result() {
    let out = output_dir("units-output-is-a-file");
    fs::write(&out, "occupied").unwrap();
    let arguments = units_arguments(&out);
    assert_named_error(&arguments, "units.csv");
    assert_eq!(fs::read_to_string(&out).unwrap(), "occupied");
    fs::remove_file(out).unwrap();
}
