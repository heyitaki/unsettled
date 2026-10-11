use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;

use serde_json::Value;

const LAYOUTS: [&str; 2] = ["standard4", "extension6"];

// Snake-draft slots: `first` is slot 0, `middle` the slot halfway through round one, `turn` the
// first pick of round two and `last` the final pick. The draft-aware kind only looks ahead on a
// first settlement, so it has no round-two scenario.
const PLACEMENT: [&str; 9] = [
    "prepare",
    "score_all",
    "greedy/first",
    "greedy/middle",
    "greedy/turn",
    "greedy/last",
    "draft/first",
    "draft/middle",
    "full_draft",
];
const DECISION_KINDS: [&str; 6] = [
    "pre_roll",
    "action",
    "discard",
    "robber",
    "respond_trade",
    "select_counterparty",
];
const STAGES: [&str; 3] = ["early", "mid", "late"];
const ACTION_STRESS: [&str; 2] = ["long_road", "full_hand"];
const END_TO_END: [&str; 2] = ["single_core", "all_cores"];

fn simulator_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn expected_ids() -> BTreeSet<String> {
    let mut ids = BTreeSet::new();
    for layout in LAYOUTS {
        for name in PLACEMENT {
            ids.insert(format!("placement/{layout}/{name}"));
        }
        for kind in DECISION_KINDS {
            for stage in STAGES {
                ids.insert(format!("decision/{layout}/{kind}/{stage}"));
            }
        }
        for stress in ACTION_STRESS {
            ids.insert(format!("decision/{layout}/action/{stress}"));
        }
        for name in END_TO_END {
            ids.insert(format!("e2e/{layout}/{name}"));
        }
    }
    ids
}

fn bench(name: &str, arguments: &[&str]) -> Value {
    let out = Path::new(env!("CARGO_TARGET_TMPDIR")).join(format!("bench-cli-{name}.json"));
    // A run that exits 0 without writing must not be read as the previous run's document.
    let _ = fs::remove_file(&out);
    let threads: &[&str] = if arguments.contains(&"--threads") {
        &[]
    } else {
        &["--threads", "1"]
    };
    let output = Command::new(env!("CARGO_BIN_EXE_unsettled-sim"))
        .current_dir(simulator_root())
        .args(["bench", "--quick", "--json"])
        .arg(&out)
        .args(threads)
        .args(arguments)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "bench {arguments:?} failed:\n{}",
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_str(&fs::read_to_string(out).unwrap()).unwrap()
}

fn reference() -> &'static Value {
    static REFERENCE: OnceLock<Value> = OnceLock::new();
    REFERENCE.get_or_init(|| bench("reference", &[]))
}

fn scenarios(document: &Value) -> &Vec<Value> {
    document["scenarios"].as_array().unwrap()
}

fn id(scenario: &Value) -> &str {
    scenario["id"].as_str().unwrap()
}

fn measured(scenario: &Value) -> bool {
    scenario["status"] == "measured"
}

fn hashes(document: &Value, field: &str) -> BTreeMap<String, String> {
    scenarios(document)
        .iter()
        .filter(|scenario| measured(scenario))
        .map(|scenario| {
            (
                id(scenario).to_string(),
                scenario[field].as_str().unwrap().to_string(),
            )
        })
        .collect()
}

fn is_hash(value: &Value) -> bool {
    value.as_str().is_some_and(|text| {
        text.len() == 16
            && text
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    })
}

#[test]
fn every_scenario_is_reported_and_none_goes_missing_silently() {
    let document = reference();
    let ids = scenarios(document)
        .iter()
        .map(|scenario| id(scenario).to_string())
        .collect::<Vec<_>>();
    assert_eq!(ids.iter().cloned().collect::<BTreeSet<_>>(), expected_ids());
    assert_eq!(ids.len(), expected_ids().len(), "duplicate scenario id");

    for scenario in scenarios(document) {
        let id = id(scenario);
        let group = id.split('/').next().unwrap();
        assert_eq!(scenario["group"], group, "{id}");
        assert_eq!(scenario["layout"], id.split('/').nth(1).unwrap(), "{id}");
        if measured(scenario) {
            assert!(scenario["calls"].as_u64().unwrap() > 0, "{id}");
            // A single cheap call can read as zero at the clock's resolution.
            assert!(scenario["nsPerCallMin"].as_f64().unwrap() >= 0.0, "{id}");
            assert!(scenario["nsPerCallMedian"].as_f64().unwrap() >= 0.0, "{id}");
            assert!(is_hash(&scenario["stateHash"]), "{id}");
            assert!(is_hash(&scenario["decisionHash"]), "{id}");
        } else {
            // Only a decision the sampled games never presented may be skipped, and it says why.
            assert_eq!(scenario["status"], "skipped", "{id}");
            assert_eq!(group, "decision", "{id} may not be skipped");
            assert!(!scenario["reason"].as_str().unwrap().is_empty(), "{id}");
        }
    }

    let measured_ids = hashes(document, "stateHash");
    for layout in LAYOUTS {
        for kind in DECISION_KINDS {
            assert!(
                STAGES.iter().any(|stage| {
                    measured_ids.contains_key(&format!("decision/{layout}/{kind}/{stage}"))
                }),
                "decision/{layout}/{kind} is skipped at every stage"
            );
        }
        for name in STAGES.iter().chain(&ACTION_STRESS) {
            assert!(
                measured_ids.contains_key(&format!("decision/{layout}/action/{name}")),
                "decision/{layout}/action/{name} must be measured"
            );
        }
    }
}

// The fixture is what ties runs and build profiles together: the same literals have to hold on
// every run, under `cargo test` and under `cargo test --release`.
#[test]
fn hashes_match_the_committed_fixture() {
    let fixture: BTreeMap<String, BTreeMap<String, String>> = serde_json::from_str(
        &fs::read_to_string(simulator_root().join("fixtures/bench-hashes.json")).unwrap(),
    )
    .unwrap();
    let state = hashes(reference(), "stateHash");
    let decision = hashes(reference(), "decisionHash");
    assert_eq!(
        fixture.keys().collect::<Vec<_>>(),
        state.keys().collect::<Vec<_>>()
    );
    for (id, pinned) in &fixture {
        assert_eq!(pinned["stateHash"], state[id], "{id} stateHash");
        assert_eq!(pinned["decisionHash"], decision[id], "{id} decisionHash");
    }
}

// Both end-to-end rows play the same games, so the worker count may move neither their hashes nor
// the agreement between them. `--quick` alone plays one game, which one worker takes whatever
// `--threads` says, so two games are what puts a second worker to work.
#[test]
fn end_to_end_hashes_do_not_depend_on_the_worker_count() {
    let threaded = bench(
        "threads",
        &[
            "--filter",
            "e2e/standard4/",
            "--threads",
            "2",
            "--games",
            "2",
        ],
    );
    assert_eq!(scenarios(&threaded).len(), END_TO_END.len());
    for field in ["stateHash", "decisionHash"] {
        let reference = hashes(reference(), field);
        let threaded = hashes(&threaded, field);
        assert_eq!(threaded.len(), END_TO_END.len());
        for (id, hash) in &threaded {
            assert_eq!(&reference[id], hash, "{id} {field}");
        }
        assert_eq!(
            threaded["e2e/standard4/single_core"], threaded["e2e/standard4/all_cores"],
            "{field}"
        );
    }
}

// A candidate is timed on the reference states, so it may move decisions and never states. The
// decision half is what shows the candidate reached the measured call at all.
#[test]
fn a_candidate_policy_moves_decisions_and_never_states() {
    let candidate = bench(
        "policy",
        &["--filter", "decision/", "--policy", "random-legal"],
    );
    let states = hashes(&candidate, "stateHash");
    let reference_states = hashes(reference(), "stateHash");
    assert!(!states.is_empty());
    for (id, hash) in &states {
        assert!(id.starts_with("decision/"), "{id}");
        assert_eq!(&reference_states[id], hash, "{id}");
    }
    let reference_decisions = hashes(reference(), "decisionHash");
    let decisions = hashes(&candidate, "decisionHash");
    // Each of these kinds has its own call site, so each has to show the candidate arriving. The
    // other three are left to `bench/unit.rs`: on most sampled states a random policy answers a
    // pre-roll, a trade response or a counterparty choice the way the reference does.
    for kind in ["action", "discard", "robber"] {
        assert!(
            decisions
                .iter()
                .any(|(id, hash)| id.contains(&format!("/{kind}/"))
                    && &reference_decisions[id] != hash),
            "--policy never reached a measured {kind} call"
        );
    }
}

// Weights belong to placement. If they moved a move-ranking row, they reached the reference games
// that the row's state was sampled from.
#[test]
fn candidate_weights_never_reach_move_ranking() {
    let candidate = bench(
        "weights-decision",
        &[
            "--filter",
            "decision/standard4/robber/",
            "--weights",
            "placement/arms/flat_swamp.json",
        ],
    );
    for field in ["stateHash", "decisionHash"] {
        let reference = hashes(reference(), field);
        let candidate = hashes(&candidate, field);
        assert_eq!(candidate.len(), STAGES.len());
        for (id, hash) in &candidate {
            assert_eq!(&reference[id], hash, "{id} {field}");
        }
    }
}

#[test]
fn candidate_weights_move_placements_and_never_states() {
    let prefix = "placement/standard4/";
    let candidate = bench(
        "weights",
        &[
            "--filter",
            prefix,
            "--weights",
            "placement/arms/flat_swamp.json",
        ],
    );
    assert_eq!(scenarios(&candidate).len(), PLACEMENT.len());
    let states = hashes(&candidate, "stateHash");
    let reference_states = hashes(reference(), "stateHash");
    assert_eq!(states.len(), PLACEMENT.len());
    for (id, hash) in &states {
        assert!(id.starts_with(prefix), "{id}");
        assert_eq!(&reference_states[id], hash, "{id}");
    }
    let decisions = hashes(&candidate, "decisionHash");
    let reference_decisions = hashes(reference(), "decisionHash");
    // Scores are folded into these two bit for bit, so any other weights vector moves them.
    for name in ["prepare", "score_all"] {
        let id = format!("{prefix}{name}");
        assert_ne!(decisions[&id], reference_decisions[&id], "{id}");
    }
    // `full_draft` plays the draft-aware kind in every seat, so it counts toward that chooser.
    for (chooser, names) in [
        ("greedy", vec!["greedy/"]),
        ("draft-aware", vec!["draft/", "full_draft"]),
    ] {
        assert!(
            decisions.iter().any(|(id, hash)| {
                names
                    .iter()
                    .any(|name| id.starts_with(&format!("{prefix}{name}")))
                    && &reference_decisions[id] != hash
            }),
            "--weights never reached the {chooser} chooser"
        );
    }
}

// A state hash covers the inputs alone, so two rows of one decision kind that sampled the same
// position would share it: a game that ended before a later stage's cap, or a stress state that
// is only a stage state under another name.
#[test]
fn rows_of_one_decision_kind_measure_distinct_states() {
    let states = hashes(reference(), "stateHash");
    for layout in LAYOUTS {
        for kind in DECISION_KINDS {
            let prefix = format!("decision/{layout}/{kind}/");
            let mut seen = BTreeMap::new();
            for (id, hash) in states.iter().filter(|(id, _)| id.starts_with(&prefix)) {
                if let Some(other) = seen.insert(hash, id) {
                    panic!("{id} and {other} measure the same state");
                }
            }
        }
    }
}
