use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

fn simulator_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn run_tournament(out: &Path, threads: &str) {
    let output = Command::new(env!("CARGO_BIN_EXE_unsettled-sim"))
        .current_dir(simulator_root())
        .args([
            "tournament",
            "--random-boards",
            "2",
            "--reps",
            "2",
            "--heuristics",
            "max_pips,pip_diversity",
            "--policy",
            "heuristic-v1-trader",
            "--player-trading",
            "--opponent-gain-weight",
            "1.25",
            "--acceptance-temperature",
            "0",
            "--max-offers-per-turn",
            "1",
            "--hidden-vp-confidence",
            "0.8",
            "--seed",
            "91",
            "--threads",
            threads,
            "--out",
            out.to_str().unwrap(),
        ])
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8(output.stderr).unwrap()
    );
}

#[test]
fn trading_results_are_byte_identical_at_one_and_all_cli_threads() {
    let root = Path::new(env!("CARGO_TARGET_TMPDIR"));
    let one = root.join("trading-cli-one");
    let all = root.join("trading-cli-all");
    for out in [&one, &all] {
        if out.exists() {
            fs::remove_dir_all(out).unwrap();
        }
    }

    run_tournament(&one, "1");
    run_tournament(&all, "0");
    let one_results = fs::read(one.join("results.json")).unwrap();
    let all_results = fs::read(all.join("results.json")).unwrap();
    assert_eq!(one_results, all_results);

    let artifact: serde_json::Value = serde_json::from_slice(&one_results).unwrap();
    assert_eq!(
        artifact["config"]["playerTrading"]["opponentGainWeight"],
        1.25
    );
    assert_eq!(
        artifact["config"]["playerTrading"]["acceptanceTemperature"],
        0.0
    );
    assert_eq!(
        artifact["config"]["playerTrading"]["maxOffersPerTurn"],
        1
    );
    assert_eq!(
        artifact["config"]["playerTrading"]["hiddenVpConfidence"],
        0.8
    );
    assert_eq!(artifact["illegalActions"], 0);
}
