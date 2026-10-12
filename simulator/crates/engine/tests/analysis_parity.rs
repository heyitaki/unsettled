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

fn fixture_path() -> PathBuf {
    simulator_path("fixtures/analysis-parity.json")
}

fn read_fixture() -> Value {
    serde_json::from_str(&fs::read_to_string(fixture_path()).unwrap()).unwrap()
}

fn run(request: &Value) -> Value {
    serde_json::from_str(&analyze(&request.to_string(), &mut |_| {})).unwrap()
}

#[test]
fn every_corpus_case_matches_the_fixture() {
    let fixture = read_fixture();
    let mut statuses = BTreeSet::new();
    let mut with_picks_ahead = 0;
    for case in fixture["cases"].as_array().unwrap() {
        let expected = &case["response"];
        statuses.insert(expected["status"].as_str().unwrap());
        // A pick ahead of the analysed one is what brings a nested ranking into the response.
        with_picks_ahead +=
            usize::from(!expected["takenBeforeFirstPick"].as_array().unwrap().is_empty());
        assert_eq!(&run(&case["request"]), expected, "{}", case["name"]);
    }
    assert_eq!(
        statuses,
        BTreeSet::from(["complete", "me-done", "no-availability", "no-me", "no-production", "ready"])
    );
    assert!(with_picks_ahead >= 10, "only {with_picks_ahead} corpus cases have a pick ahead");
}

#[test]
fn progress_climbs_to_one_when_a_ranking_ran() {
    let fixture = read_fixture();
    let mut ranked = 0;
    for case in fixture["cases"].as_array().unwrap() {
        let name = case["name"].as_str().unwrap();
        // The second run reads its nested rankings from the cache, which takes them out of the
        // total the bar is paced against.
        for run in 0..2 {
            let mut fractions = Vec::new();
            analyze(&case["request"].to_string(), &mut |fraction| fractions.push(fraction));
            // `no-availability` here is a ranking that ran and kept none of its candidates.
            let status = &case["response"]["status"];
            if status != "ready" && status != "no-availability" {
                assert!(fractions.is_empty(), "{name} run {run}: progress with nothing ranked");
                continue;
            }
            ranked += 1;
            assert!(
                fractions.iter().all(|fraction| (0.0..=1.0).contains(fraction)),
                "{name} run {run}: outside 0 to 1: {fractions:?}"
            );
            assert!(
                fractions.windows(2).all(|pair| pair[0] <= pair[1]),
                "{name} run {run}: decreasing: {fractions:?}"
            );
            let last = fractions.last().copied().unwrap_or(0.0);
            assert!(1.0 - last <= 0.05, "{name} run {run}: ends at {last}");
        }
    }
    assert!(ranked > 0, "no corpus case ranked");
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

/// Indents compact JSON as `serde_json::to_string_pretty` does, copying each number's text as it
/// stands. Reading a response into a `Value` first would not do: `serde_json` can read a 17-digit
/// number one bit off, and the fixture has to hold the digits the engine wrote.
fn indent(compact: &str) -> String {
    let line = |out: &mut String, depth: usize| {
        out.push('\n');
        out.push_str(&"  ".repeat(depth));
    };
    let mut out = String::new();
    let mut depth = 0;
    let mut in_string = false;
    let mut chars = compact.chars().peekable();
    while let Some(c) = chars.next() {
        if in_string {
            out.push(c);
            match c {
                '\\' => out.extend(chars.next()),
                '"' => in_string = false,
                _ => {}
            }
            continue;
        }
        match c {
            '"' => {
                in_string = true;
                out.push(c);
            }
            '{' | '[' => {
                out.push(c);
                if matches!(chars.peek(), Some('}' | ']')) {
                    out.extend(chars.next());
                } else {
                    depth += 1;
                    line(&mut out, depth);
                }
            }
            '}' | ']' => {
                depth -= 1;
                line(&mut out, depth);
                out.push(c);
            }
            ',' => {
                out.push(c);
                line(&mut out, depth);
            }
            ':' => out.push_str(": "),
            _ => out.push(c),
        }
    }
    out
}

/// Road cases are built from fixed corpus boards, keeping fixture edits in this generator.
fn setup_road_cases(fixture: &Value) -> Vec<Value> {
    let request = |name: &str| {
        fixture["cases"].as_array().unwrap().iter()
            .find(|case| case["name"] == name).unwrap()["request"].clone()
    };
    let mut rival = request("empty-first-seat-standard4");
    rival["board"]["mePlayerId"] = "p3".into();
    rival["options"]["rollouts"] = 4.into();
    rival["options"]["maxResults"] = 54.into();
    let mut seconds = request("first-road-null");
    seconds["options"]["maxResults"] = 54.into();
    let topology = unsettled_engine::topology::Topology::shared(
        unsettled_engine::topology::Layout::Standard4,
    ).unwrap();
    seconds["board"]["roads"] = (0..topology.edge_count()).filter(|edge| edge % 3 != 0)
        .map(|edge| serde_json::json!({ "edgeId": topology.edge_id(edge as u8), "playerId": "aki" }))
        .collect();
    let mut drawn = request("blocked-in-modal-window");
    drawn["board"]["mePlayerId"] = "aki".into();
    drawn["options"]["rollouts"] = 12.into();
    drawn["options"]["maxResults"] = 54.into();
    let mut existing = request("mid-first-round");
    for edge in [topology.edge_count() - 2, topology.edge_count() - 1] {
        let edge_id = topology.edge_id(edge as u8);
        let roads = existing["board"]["roads"].as_array_mut().unwrap();
        roads.retain(|road| road["edgeId"] != edge_id);
        roads.push(serde_json::json!({ "edgeId": edge_id, "playerId": "p3" }));
    }
    [
        ("rival-road-reaches-later-pick", rival),
        ("second-road-present-and-null", seconds),
        ("drawn-second-before-frequency", drawn),
        ("roads-already-on-board", existing),
    ].into_iter().map(|(name, request)| serde_json::json!({ "name": name, "request": request })).collect()
}

/// Rewrites every case's response, and the `mulberry32` streams, from this engine. The names and
/// requests are the committed ones plus `setup_road_cases`. Add new requests in the generator,
/// then regenerate. Re-verify the diff against the specification before accepting new responses.
#[test]
#[ignore]
fn regenerate_analysis_parity_fixture() {
    let mut fixture = read_fixture();
    for case in setup_road_cases(&fixture) {
        let cases = fixture["cases"].as_array_mut().unwrap();
        if let Some(existing) = cases.iter_mut().find(|existing| existing["name"] == case["name"]) {
            *existing = case;
        } else {
            cases.push(case);
        }
    }
    let streams: Vec<String> = ["7", "12345"]
        .iter()
        .map(|seed| {
            let mut random = mulberry32(seed.parse().unwrap());
            let values: Vec<f64> = (0..16).map(|_| random.next_f64()).collect();
            format!(r#""{seed}":{}"#, serde_json::to_string(&values).unwrap())
        })
        .collect();
    let cases: Vec<String> = fixture["cases"]
        .as_array()
        .unwrap()
        .iter()
        .map(|case| {
            let (name, request) = (&case["name"], &case["request"]);
            let response = analyze(&request.to_string(), &mut |_| {});
            assert!(!response.starts_with(r#"{"error""#), "{name}: {response}");
            format!(r#"{{"name":{name},"request":{request},"response":{response}}}"#)
        })
        .collect();
    let text = format!(r#"{{"mulberry32":{{{}}},"cases":[{}]}}"#, streams.join(","), cases.join(","));
    fs::write(fixture_path(), format!("{}\n", indent(&text))).unwrap();
}

#[test]
fn the_road_corpus_contains_both_null_and_present_second_roads() {
    let fixture = read_fixture();
    let case = fixture["cases"].as_array().unwrap().iter()
        .find(|case| case["name"] == "second-road-present-and-null").unwrap();
    let response = run(&case["request"]);
    let rows = response["recommendations"].as_array().unwrap();
    assert!(rows.iter().any(|row| row["secondRoad"].is_null()));
    assert!(rows.iter().any(|row| row["secondRoad"].is_string()));
}

#[test]
fn the_drawn_second_case_keeps_the_plan_from_the_first_rollout() {
    let fixture = read_fixture();
    let case = fixture["cases"].as_array().unwrap().iter()
        .find(|case| case["name"] == "drawn-second-before-frequency").unwrap();
    let mut modal = case["request"].clone();
    modal["options"]["rollouts"] = 1.into();
    let modal = run(&modal);
    let sampled = run(&case["request"]);
    let rows = sampled["recommendations"].as_array().unwrap();
    assert!(!rows.is_empty());
    for row in rows {
        let first = modal["recommendations"].as_array().unwrap().iter()
            .find(|first| first["firstPick"] == row["firstPick"]).unwrap();
        assert_eq!(row["plannedSecond"][0], first["plannedSecond"][0], "{}", row["firstPick"]);
        assert_eq!(row["secondRoad"], first["secondRoad"], "{}", row["firstPick"]);
    }
}
