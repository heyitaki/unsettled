use std::fs;
use std::path::PathBuf;

use serde_json::Value;
use unsettled_engine::placement::analysis::{AnalysisRequest, mulberry32, weights_for_seats};
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
