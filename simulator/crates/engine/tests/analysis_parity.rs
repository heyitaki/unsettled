use std::collections::BTreeSet;
use std::fs;
use std::path::PathBuf;

use serde_json::Value;
use unsettled_engine::placement::analysis::{
    AnalysisRequest, analyze, mulberry32, weights_for_seats,
};
use unsettled_engine::placement::app_formula::EngineWeights;

fn simulator_path(relative: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join(relative)
}

fn read_fixture() -> Value {
    let path = simulator_path("fixtures/analysis-parity.json");
    serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap()
}

fn run(request: &Value) -> Value {
    serde_json::from_str(&analyze(&request.to_string(), &mut |_| {})).unwrap()
}

/// The fixture's comparison: order, names, strings and nulls exactly, numbers within `1e-9`. A
/// non-finite number is a string on both sides, so it compares exactly too.
fn assert_close(actual: &Value, expected: &Value, path: &str) {
    match (actual, expected) {
        (Value::Number(actual), Value::Number(expected)) => {
            let (actual, expected) = (actual.as_f64().unwrap(), expected.as_f64().unwrap());
            assert!((actual - expected).abs() <= 1e-9, "{path}: {actual} != {expected}");
        }
        (Value::Array(actual), Value::Array(expected)) => {
            assert_eq!(actual.len(), expected.len(), "{path}: length");
            for (index, (actual, expected)) in actual.iter().zip(expected).enumerate() {
                assert_close(actual, expected, &format!("{path}[{index}]"));
            }
        }
        (Value::Object(actual), Value::Object(expected)) => {
            assert!(actual.keys().eq(expected.keys()), "{path}: keys");
            for (key, actual) in actual {
                assert_close(actual, &expected[key], &format!("{path}.{key}"));
            }
        }
        _ => assert_eq!(actual, expected, "{path}"),
    }
}

#[test]
fn draft_and_warnings_match_the_fixture() {
    let fixture = read_fixture();
    for case in fixture["cases"].as_array().unwrap() {
        let response = run(&case["request"]);
        assert_eq!(response["draft"], case["response"]["draft"], "{}", case["name"]);
        assert_eq!(response["warnings"], case["response"]["warnings"], "{}", case["name"]);
    }
}

#[test]
fn unranked_statuses_match_the_fixture() {
    let fixture = read_fixture();
    let mut seen = BTreeSet::new();
    for case in fixture["cases"].as_array().unwrap() {
        let expected = &case["response"];
        let status = expected["status"].as_str().unwrap();
        let response = run(&case["request"]);
        if status == "ready" {
            // Nothing is ranked yet, so a case that passed the positive-score check stops at the
            // status for a ranking that came back empty.
            assert_eq!(response["status"], "no-availability", "{}", case["name"]);
            continue;
        }
        seen.insert(status);
        assert_close(&response, expected, case["name"].as_str().unwrap());
    }
    // The corpus holds no `no-availability` case: see the plan's note on the class.
    assert_eq!(seen, BTreeSet::from(["complete", "me-done", "no-me", "no-production"]));
}

#[test]
fn a_malformed_request_is_an_error() {
    let only_error = |response: Value, what: &str| {
        assert!(response["error"].is_string(), "{what}: {response}");
        assert_eq!(response.as_object().unwrap().len(), 1, "{what}");
    };
    for request in ["", "[]", r#"{"board":{}}"#, r#"{"board":null,"targetPick":"x"}"#] {
        let response = serde_json::from_str(&analyze(request, &mut |_| {})).unwrap();
        only_error(response, request);
    }
    // Boards the app's `validateBoard` refuses.
    let fixture = read_fixture();
    let request = &fixture["cases"][0]["request"];
    let mut no_players = request.clone();
    no_players["board"]["players"] = Value::Array(Vec::new());
    only_error(run(&no_players), "no players");
    let mut unknown_me = request.clone();
    unknown_me["board"]["mePlayerId"] = "nobody".into();
    only_error(run(&unknown_me), "unknown me");
    let mut unknown_option = request.clone();
    unknown_option["options"]["rolouts"] = 3.into();
    only_error(run(&unknown_option), "unknown option");
}

#[test]
fn mulberry32_reproduces_the_typescript_stream() {
    let fixture = read_fixture();
    let streams = fixture["mulberry32"].as_object().unwrap();
    for seed in ["7", "12345"] {
        let expected = streams[seed].as_array().unwrap();
        assert_eq!(expected.len(), 16);
        let mut random = mulberry32(seed.parse().unwrap());
        for (index, value) in expected.iter().enumerate() {
            // Outputs are multiples of 2^-32, about 2.3e-10 apart, so this tolerance admits only
            // the exact value while allowing for the JSON parser's last-bit rounding.
            let actual = random.next_f64();
            assert!(
                (actual - value.as_f64().unwrap()).abs() < 1e-12,
                "seed {seed} value {index}: {actual} != {value}"
            );
        }
    }
}

#[test]
fn weights_for_seats_reads_the_committed_files() {
    let file = |relative: &str| {
        let weights: EngineWeights =
            serde_json::from_str(&fs::read_to_string(simulator_path(relative)).unwrap()).unwrap();
        // `EngineWeights` has no `PartialEq`; its debug text prints every float exactly.
        format!("{weights:?}")
    };
    for seats in 2..=6 {
        assert_eq!(
            format!("{:?}", weights_for_seats(seats)),
            file(&format!("placement/seat-weights/seats-{seats}.json")),
            "{seats} seats"
        );
    }
    for seats in [1, 7] {
        assert_eq!(
            format!("{:?}", weights_for_seats(seats)),
            file("placement/default-weights.json"),
            "{seats} seats"
        );
    }
}

#[test]
fn every_corpus_request_reads_as_a_request() {
    let fixture = read_fixture();
    let mut with_weights = 0;
    for case in fixture["cases"].as_array().unwrap() {
        let request: AnalysisRequest = serde_json::from_value(case["request"].clone())
            .unwrap_or_else(|error| panic!("{}: {error}", case["name"]));
        with_weights += usize::from(request.options.weights.is_some());
    }
    assert!(with_weights > 0, "no corpus case carries its own weights");
}
