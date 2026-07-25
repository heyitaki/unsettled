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

fn assert_named_error(arguments: &[String], expected: &str) {
    let arguments = arguments.iter().map(String::as_str).collect::<Vec<_>>();
    let output = evaluate(&arguments);
    assert_eq!(output.status.code(), Some(2));
    let stderr = String::from_utf8(output.stderr).unwrap();
    assert!(
        stderr.contains(expected),
        "expected {expected:?} in stderr:\n{stderr}"
    );
    assert!(!stderr.contains("panicked"));
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

#[test]
fn alpha_endpoints_are_rejected() {
    for alpha in ["0", "1"] {
        let out = output_dir(&format!("evaluate-cli-alpha-{alpha}"));
        let mut arguments = valid_arguments(&out);
        arguments.extend(["--alpha".into(), alpha.into()]);
        assert_named_error(&arguments, "alpha must be greater than 0 and less than 1");
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
