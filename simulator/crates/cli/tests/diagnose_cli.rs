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

#[test]
fn a_zero_board_or_rep_count_is_a_named_error() {
    for (flag, value, message) in [
        ("--boards", "0", "boards must be positive"),
        ("--reps", "0", "reps must be positive"),
    ] {
        let out = output_dir(&format!("diagnose-cli-zero{flag}"));
        let mut arguments = valid_arguments(&out);
        let index = arguments.iter().position(|argument| argument == flag).unwrap();
        arguments[index + 1] = value.into();
        assert_named_error(&arguments, message);
    }
}

#[test]
fn an_alpha_outside_the_open_unit_interval_is_a_named_error() {
    for value in ["0", "1", "nan"] {
        let out = output_dir(&format!("diagnose-cli-alpha-{value}"));
        let mut arguments = valid_arguments(&out);
        arguments.extend(["--alpha".into(), value.into()]);
        assert_named_error(
            &arguments,
            "alpha must be greater than 0 and less than 1",
        );
    }
}

/// `--allow-unofficial` widens the layout-and-seat rule, not the engine's own seat range.
#[test]
fn the_unofficial_gate_does_not_admit_a_seat_count_the_engine_cannot_play() {
    let out = output_dir("diagnose-cli-one-seat");
    let mut arguments = valid_arguments(&out);
    arguments.extend([
        "--seats".into(),
        "1".into(),
        "--allow-unofficial".into(),
    ]);
    assert_named_error(&arguments, "seat count must be between 2 and 6");
}

/// The other half of the trading contract: `contracts.md` says `diagnostics.json` carries the
/// block when the mechanism is on, and only the absent direction was pinned.
#[test]
fn player_trading_is_recorded_in_the_artifact_when_it_is_on() {
    let out = output_dir("diagnose-cli-player-trading");
    let mut arguments = valid_arguments(&out);
    arguments.extend(["--player-trading".into()]);
    let output = run(&arguments);
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8(output.stderr).unwrap()
    );
    let diagnostics: serde_json::Value =
        serde_json::from_slice(&fs::read(out.join("diagnostics.json")).unwrap()).unwrap();
    assert!(
        diagnostics["config"]["playerTrading"].is_object(),
        "trading must be recorded when the run enables it"
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
    // One completed pair per seat per game, which is the second half of those picks.
    assert_eq!(diagnostics["expansion"]["overall"]["pairs"], 48);

    // The stratified blockability table rides both the overall row and every slot row, and its
    // strata partition the pairs of the row they sit under.
    let stratified_pairs = |group: &serde_json::Value| {
        group["blockabilityByHexCount"]["strata"]
            .as_array()
            .unwrap()
            .iter()
            .map(|stratum| stratum["pairs"].as_u64().unwrap())
            .sum::<u64>()
    };
    assert_eq!(stratified_pairs(&diagnostics["expansion"]["overall"]), 48);
    let per_slot = diagnostics["expansion"]["perSlot"].as_array().unwrap();
    assert_eq!(per_slot.len(), 4);
    assert_eq!(per_slot.iter().map(stratified_pairs).sum::<u64>(), 48);
    // Twelve games is far under the counting floor, so nothing is indicated off a run this size.
    assert_eq!(
        diagnostics["expansion"]["overall"]["blockabilityByHexCount"]["countedPairs"],
        0
    );
    assert_eq!(
        diagnostics["expansion"]["overall"]["blockabilityByHexCount"]
            ["concentrationTermIndicated"],
        false
    );
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
