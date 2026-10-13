use std::collections::{BTreeMap, BTreeSet};
use std::fs::{self, OpenOptions};
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};
use std::process::Command;

use serde_json::Value;
use unsettled_engine::rng::{derive_evaluation_seed, mix64};
use unsettled_engine::topology::Layout;
use unsettled_sim::boardgen::generate_board;
use unsettled_sim::evaluate::{
    EVAL_SEED, EVAL2_SEED, EVAL3_SEED, EvaluationDomain, GATE_SEED, GATE2_SEED, GATE3_SEED,
    PERF_SEED, TUNING_SEED, TUNING2_SEED, TUNING3_SEED,
};

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn bench(name: &str, args: &[&str]) -> Value {
    let path = Path::new(env!("CARGO_TARGET_TMPDIR")).join(format!("bench-contract-{name}.json"));
    let _ = fs::remove_file(&path);
    let threads: &[&str] = if args.contains(&"--threads") {
        &[]
    } else {
        &["--threads", "1"]
    };
    let output = Command::new(env!("CARGO_BIN_EXE_unsettled-sim"))
        .current_dir(root())
        .args(["bench", "--json"])
        .arg(&path)
        .args(threads)
        .args(args)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&fs::read(path).unwrap()).unwrap()
}

fn rejected_bench(args: &[&str]) -> String {
    let output = Command::new(env!("CARGO_BIN_EXE_unsettled-sim"))
        .current_dir(root())
        .args(["bench", "--quick"])
        .args(args)
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(2), "{args:?}");
    String::from_utf8(output.stderr).unwrap()
}

fn hashes(document: &Value) -> BTreeMap<String, BTreeMap<String, String>> {
    document["scenarios"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|row| row["status"] == "measured")
        .map(|row| {
            (
                row["id"].as_str().unwrap().to_owned(),
                ["stateHash", "decisionHash"]
                    .into_iter()
                    .map(|key| (key.to_owned(), row[key].as_str().unwrap().to_owned()))
                    .collect(),
            )
        })
        .collect()
}

#[test]
fn performance_domain_extends_the_pairwise_seed_and_board_disjointness_guard() {
    let mut domains = vec![
        TUNING_SEED,
        EVAL_SEED,
        GATE_SEED,
        TUNING2_SEED,
        EVAL2_SEED,
        GATE2_SEED,
        TUNING3_SEED,
        EVAL3_SEED,
        GATE3_SEED,
        PERF_SEED,
    ];
    // Generations four through six and perf fold in the seat count, giving 45 seat-derived seeds.
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
        domains.extend((2..=6).map(|seats| domain.seed(seats)));
    }
    let seeds = |domain| {
        (0..5)
            .flat_map(move |board| {
                (0..3).flat_map(move |rep| {
                    (0..4).map(move |seat| derive_evaluation_seed(domain, board, rep, seat))
                })
            })
            .collect::<BTreeSet<_>>()
    };
    for (index, left) in domains.iter().enumerate() {
        for right in &domains[index + 1..] {
            assert_ne!(left, right);
            assert!(seeds(*left).is_disjoint(&seeds(*right)));
            for (layout, seats) in [(Layout::Standard4, 4), (Layout::Extension6, 6)] {
                let boards = |domain| {
                    (0..5)
                        .map(|index| {
                            let board =
                                generate_board(layout, seats, mix64(domain ^ index)).unwrap();
                            (
                                board.tiles().to_vec(),
                                board.tokens().to_vec(),
                                board.robber(),
                            )
                        })
                        .collect::<Vec<_>>()
                };
                let left_boards = boards(*left);
                let right_boards = boards(*right);
                assert!(
                    left_boards
                        .iter()
                        .all(|board| !right_boards.contains(board))
                );
            }
        }
    }
}

#[test]
fn sampling_counts_do_not_change_hashes() {
    for filter in [
        "placement/standard4/",
        "decision/standard4/",
        "e2e/standard4/",
        "advise/",
    ] {
        let quick = bench("counts-quick", &["--quick", "--filter", filter]);
        for row in quick["scenarios"].as_array().unwrap() {
            if row["status"] == "measured" {
                assert_eq!(row["calls"], 1);
                assert_eq!(row["repeats"], 1);
            }
        }
        let counted = bench(
            "counts-explicit",
            &[
                "--calls",
                "2",
                "--repeats",
                "2",
                "--games",
                "2",
                "--threads",
                "3",
                "--filter",
                filter,
            ],
        );
        assert_eq!(hashes(&quick), hashes(&counted));
        for row in counted["scenarios"].as_array().unwrap() {
            if row["status"] == "skipped" {
                continue;
            }
            assert_eq!(row["calls"], 2);
            assert_eq!(row["repeats"], 2);
        }
        let calibrated = bench(
            "counts-calibrated",
            &[
                "--min-pass-ms",
                "1",
                "--repeats",
                "2",
                "--games",
                "2",
                "--filter",
                filter,
            ],
        );
        assert_eq!(hashes(&quick), hashes(&calibrated));
        for row in calibrated["scenarios"].as_array().unwrap() {
            if row["status"] == "skipped" {
                continue;
            }
            let calls = row["calls"].as_u64().unwrap();
            if row["group"] == "e2e" {
                assert_eq!(calls, 2);
            } else {
                assert!(calls.is_power_of_two() && calls <= 65_536);
            }
            assert_eq!(row["repeats"], 2);
        }
    }
}

#[test]
fn min_pass_ms_reaches_calibration() {
    for (duration, calls) in [("0", 1), ("18446744073709551615", 65_536)] {
        let document = bench(
            "calibration-duration",
            &[
                "--filter",
                "decision/standard4/select_counterparty/early",
                "--min-pass-ms",
                duration,
                "--repeats",
                "1",
            ],
        );
        assert_eq!(document["scenarios"][0]["calls"], calls);
    }
}

#[test]
fn e2e_defaults_to_twenty_games() {
    let document = bench(
        "e2e-default-games",
        &["--filter", "e2e/standard4/single_core", "--repeats", "1"],
    );
    assert_eq!(document["scenarios"][0]["calls"], 20);
}

#[test]
fn policy_params_and_a_non_prefix_filter_reach_both_layouts() {
    let policy =
        "heuristic-v1-trader-aware-threat-devcards-denial@placement/policy-default-params.json";
    let document = bench(
        "params",
        &["--quick", "--filter", "action/early", "--policy", policy],
    );
    assert_eq!(document["policy"], policy);
    assert_eq!(document["seed"], format!("{PERF_SEED:016x}"));
    assert_eq!(document["weights"], "placement/default-weights.json");
    let rows = document["scenarios"].as_array().unwrap();
    assert_eq!(rows.len(), 2);
    for row in rows {
        assert!(row["id"].as_str().unwrap().ends_with("/action/early"));
        assert_eq!(row["status"], "measured");
    }
}

#[test]
fn candidate_policy_and_weights_reach_e2e_games() {
    let args = ["--quick", "--filter", "e2e/standard4/single_core"];
    let reference = bench("e2e-reference", &args);
    for (name, flag, value) in [
        ("e2e-policy", "--policy", "random-legal"),
        ("e2e-weights", "--weights", "placement/arms/flat_swamp.json"),
    ] {
        let mut arguments = args.to_vec();
        arguments.extend([flag, value]);
        let candidate = bench(name, &arguments);
        let reference = &reference["scenarios"][0];
        let candidate = &candidate["scenarios"][0];
        assert_eq!(reference["stateHash"], candidate["stateHash"], "{flag}");
        assert_ne!(
            reference["decisionHash"], candidate["decisionHash"],
            "{flag}"
        );
    }
}

#[test]
fn candidate_policy_reaches_pre_roll_and_trade_choices() {
    let params_path = Path::new(env!("CARGO_TARGET_TMPDIR")).join("bench-counterparty-params.json");
    let params = unsettled_engine::policy::heuristic_v1::HeuristicParams {
        trading: Some(unsettled_engine::policy::trading::TradeParams {
            danger_weight: -1.0,
            benefit_weight: 0.0,
            ..unsettled_engine::policy::trading::TradeParams::default()
        }),
        ..unsettled_engine::policy::heuristic_v1::HeuristicParams::default()
    };
    fs::write(&params_path, serde_json::to_vec(&params).unwrap()).unwrap();
    let custom = format!("heuristic-v1-trader-aware@{}", params_path.display());
    for (suffix, policy) in [
        ("pre_roll/mid", "random-legal"),
        ("respond_trade/early", "heuristic-v1-trader"),
        ("select_counterparty/early", custom.as_str()),
    ] {
        let filter = format!("decision/standard4/{suffix}");
        let reference = bench("forward-reference", &["--quick", "--filter", &filter]);
        let candidate = bench(
            "forward-candidate",
            &["--quick", "--filter", &filter, "--policy", policy],
        );
        let reference = &reference["scenarios"][0];
        let candidate = &candidate["scenarios"][0];
        assert_eq!(reference["status"], "measured", "{suffix}");
        assert_eq!(candidate["status"], "measured", "{suffix}");
        assert_eq!(reference["stateHash"], candidate["stateHash"], "{suffix}");
        assert_ne!(
            reference["decisionHash"], candidate["decisionHash"],
            "{suffix}"
        );
    }
}

#[test]
fn policies_with_rule_effects_are_rejected() {
    for policy in [
        "heuristic-v1-noports",
        "heuristic-v1-noports@placement/policy-default-params.json",
    ] {
        let error = rejected_bench(&["--policy", policy]);
        assert!(error.contains("heuristic-v1-noports"), "{error}");
        assert!(error.contains("rule"), "{error}");
    }
}

// The seat-count weights are spelled with a placeholder elsewhere in the CLI. Here it would
// resolve to one seat count for both layouts, so it is refused instead.
#[test]
fn a_per_seat_weights_path_is_rejected() {
    let error = rejected_bench(&["--weights", "placement/seat-weights/seats-{seats}.json"]);
    assert!(error.contains("{seats} is not supported"), "{error}");
}

#[test]
fn zero_counts_are_rejected() {
    for flag in ["--calls", "--repeats", "--games"] {
        let error = rejected_bench(&[flag, "0"]);
        assert!(
            error.contains(flag) && error.contains("positive"),
            "{flag}: {error}"
        );
    }
}

#[test]
fn unmatched_filter_is_rejected() {
    let filter = "decision/standard4/not-a-kind";
    let error = rejected_bench(&["--filter", filter]);
    assert!(
        error.contains(filter) && error.contains("no scenario"),
        "{error}"
    );
}

#[test]
#[ignore = "publishes fixtures/bench-hashes.json with create-new; run deliberately"]
fn generate_bench_hashes() {
    let mut encoded =
        serde_json::to_string_pretty(&hashes(&bench("fixture", &["--quick"]))).unwrap();
    encoded.push('\n');
    let target = root().join("fixtures/bench-hashes.json");
    match OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&target)
    {
        Ok(mut file) => {
            file.write_all(encoded.as_bytes()).unwrap();
            file.sync_all().unwrap();
            println!("PUBLISHED {}", target.display());
        }
        Err(error) if error.kind() == ErrorKind::AlreadyExists => {
            assert_eq!(
                fs::read(&target).unwrap(),
                encoded.as_bytes(),
                "REFUSED: existing fixture differs or is empty"
            );
            println!("IDENTICAL {}", target.display());
        }
        Err(error) => panic!("REFUSED: {error}"),
    }
}

#[test]
fn advise_fixture_is_embedded() {
    let directory = Path::new(env!("CARGO_TARGET_TMPDIR")).join("bench-advise-embedded");
    fs::create_dir_all(directory.join("placement")).unwrap();
    fs::copy(
        root().join("placement/default-weights.json"),
        directory.join("placement/default-weights.json"),
    )
    .unwrap();
    assert!(!directory.join("fixtures").exists());
    let output_path = directory.join("result.json");
    let _ = fs::remove_file(&output_path);
    let output = Command::new(env!("CARGO_BIN_EXE_unsettled-sim"))
        .current_dir(&directory)
        .args(["bench", "--quick", "--filter", "advise/", "--json"])
        .arg(&output_path)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let document: Value = serde_json::from_slice(&fs::read(output_path).unwrap()).unwrap();
    let reference = bench("embedded-reference", &["--quick", "--filter", "advise/"]);
    assert_eq!(hashes(&document), hashes(&reference));
    assert_eq!(document["scenarios"].as_array().unwrap().len(), 12);
}
