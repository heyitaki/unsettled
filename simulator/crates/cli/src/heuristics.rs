use std::fs;
use std::path::Path;

use unsettled_engine::placement::app_formula::EngineWeights;
use unsettled_engine::placement::{PlacementKind, register_app_formula};

pub fn parse_heuristic(name: &str) -> Result<PlacementKind, String> {
    let Some(path) = name.strip_prefix("app_formula:") else {
        return PlacementKind::parse(name).ok_or_else(|| format!("unknown heuristic {name}"));
    };
    if path.is_empty() {
        return Err("app_formula requires a weights JSON path".into());
    }
    let path = Path::new(path);
    let stem = path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .filter(|stem| !stem.is_empty())
        .ok_or_else(|| format!("app formula weights path has no UTF-8 file stem: {path:?}"))?;
    let source = fs::read_to_string(path)
        .map_err(|error| format!("failed to read app formula weights {path:?}: {error}"))?;
    let weights: EngineWeights = serde_json::from_str(&source)
        .map_err(|error| format!("invalid app formula weights {path:?}: {error}"))?;
    weights
        .validate()
        .map_err(|error| format!("invalid app formula weights {path:?}: {error}"))?;
    register_app_formula(format!("app_formula:{stem}"), weights)
}

#[cfg(test)]
mod tests {
    use super::parse_heuristic;

    /// The CLI boundary must reject an out-of-domain weights file, not just fail to
    /// build a formula later: dropping the `validate()` call in `parse_heuristic` would
    /// silently load placement weights outside their contract.
    #[test]
    fn an_out_of_domain_weights_file_is_rejected_at_parse() {
        let mut weights: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../../placement/default-weights.json"
            ))
            .expect("committed weights"),
        )
        .expect("valid JSON");
        weights["genericPortFactor"] = serde_json::Value::from(-0.1);
        let path = std::env::temp_dir().join(format!(
            "unsettled-sim-bad-weights-{}.json",
            std::process::id()
        ));
        std::fs::write(&path, weights.to_string()).expect("write temp weights");
        let error = parse_heuristic(&format!("app_formula:{}", path.display()))
            .expect_err("out-of-domain weights must not parse");
        assert!(error.contains("genericPortFactor >= 0"), "{error}");
        std::fs::remove_file(path).expect("cleanup");
    }
}
