use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

fn simulator_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn output_dir(name: &str) -> PathBuf {
    Path::new(env!("CARGO_TARGET_TMPDIR")).join(name)
}

fn diagnose(arguments: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_unsettled-sim"))
        .current_dir(simulator_root())
        .arg("diagnose")
        .args(arguments)
        .output()
        .unwrap()
}

fn valid_arguments(out: &Path) -> Vec<String> {
    vec![
        "--domain".into(),
        "tuning".into(),
        "--placement".into(),
        "max_pips".into(),
        "--boards".into(),
        "6".into(),
        "--reps".into(),
        "2".into(),
        "--threads".into(),
        "1".into(),
        "--out".into(),
        out.display().to_string(),
    ]
}

fn run(arguments: &[String]) -> Output {
    let arguments = arguments.iter().map(String::as_str).collect::<Vec<_>>();
    diagnose(&arguments)
}

fn assert_named_error(arguments: &[String], expected: &str) {
    let output = run(arguments);
    assert_eq!(output.status.code(), Some(2));
    let stderr = String::from_utf8(output.stderr).unwrap();
    assert!(
        stderr.contains(expected),
        "expected {expected:?} in stderr:\n{stderr}"
    );
    assert!(!stderr.contains("panicked"));
}

#[test]
fn domain_is_required_by_the_command_line_parser() {
    let out = output_dir("diagnose-cli-missing-domain");
    let mut arguments = valid_arguments(&out);
    arguments.drain(0..2);
    assert_named_error(&arguments, "--domain <DOMAIN>");
}

#[test]
fn unofficial_seat_counts_require_the_gate() {
    let out = output_dir("diagnose-cli-unofficial-seats");
    let mut arguments = valid_arguments(&out);
    arguments.extend(["--seats".into(), "5".into()]);
    assert_named_error(
        &arguments,
        "non-official layout and seat combinations require --allow-unofficial",
    );
}

/// The artifact carries no elapsed time and no worker count, so the same run at a different
/// worker count must produce the same bytes. Aggregating out of schedule order is exactly the
/// defect this catches.
#[test]
fn diagnostics_are_byte_identical_across_worker_counts() {
    let single = output_dir("diagnose-cli-threads-1");
    let many = output_dir("diagnose-cli-threads-4");
    for (out, threads) in [(&single, "1"), (&many, "4")] {
        let mut arguments = valid_arguments(out);
        arguments[9] = threads.into();
        let output = run(&arguments);
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8(output.stderr).unwrap()
        );
    }
    let single_json = fs::read(single.join("diagnostics.json")).unwrap();
    assert_eq!(
        single_json,
        fs::read(many.join("diagnostics.json")).unwrap()
    );

    let diagnostics: serde_json::Value = serde_json::from_slice(&single_json).unwrap();
    assert_eq!(diagnostics["config"]["games"], 12);
    assert_eq!(diagnostics["config"]["domain"], "tuning");
    assert_eq!(diagnostics["observations"]["games"], 12);
    // Four seats, two settlements each, over twelve games.
    assert_eq!(diagnostics["observations"]["setupPicks"], 96);
    assert_eq!(diagnostics["illegalActions"], 0);
    assert!(
        diagnostics["config"].get("playerTrading").is_none(),
        "default-off trading must stay out of the artifact"
    );
    assert!(
        fs::read(single.join("meta.json")).is_ok(),
        "meta.json is written alongside diagnostics.json"
    );
}
