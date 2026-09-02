use std::fs;
use std::path::Path;

use unsettled_engine::placement::app_formula::EngineWeights;
use unsettled_engine::placement::{
    PlacementKind, register_app_formula, register_app_formula_draft,
};

pub fn parse_heuristic(name: &str) -> Result<PlacementKind, String> {
    if let Some(spec) = name.strip_prefix("app_formula_draft:") {
        // Two paths, hero first: the arm sweeps the hero formula and pins the opponent model the
        // lookahead replays the rest of the field with.
        let Some((hero_path, opponent_path)) = spec.split_once('@') else {
            return Err(format!(
                "app_formula_draft requires <hero weights>@<opponent weights>: {name}"
            ));
        };
        let (hero_stem, hero) = load_weights(hero_path, "app_formula_draft")?;
        let (opponent_stem, opponent) = load_weights(opponent_path, "app_formula_draft")?;
        return register_app_formula_draft(
            format!("app_formula_draft:{hero_stem}@{opponent_stem}"),
            hero,
            opponent,
        );
    }
    let Some(path) = name.strip_prefix("app_formula:") else {
        return PlacementKind::parse(name).ok_or_else(|| format!("unknown heuristic {name}"));
    };
    let (stem, weights) = load_weights(path, "app_formula")?;
    register_app_formula(format!("app_formula:{stem}"), weights)
}

/// Loads one weights file and returns the file stem the registered name is built from. The domain
/// guard runs here rather than at first use, so an inadmissible vector fails at parse.
fn load_weights(path: &str, kind: &str) -> Result<(String, EngineWeights), String> {
    if path.is_empty() {
        return Err(format!("{kind} requires a weights JSON path"));
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
    Ok((stem.to_string(), weights))
}

#[cfg(test)]
mod tests {
    use super::parse_heuristic;

    /// The draft spec's two halves and the one name they register under. That name is what an
    /// evaluation artifact labels the arm with, so its shape is part of the output contract.
    #[test]
    fn the_draft_spec_registers_both_weights_under_one_name() {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../placement/default-weights.json"
        );
        let kind = parse_heuristic(&format!("app_formula_draft:{path}@{path}"))
            .expect("the committed weights load on both sides");
        assert_eq!(
            kind.name(),
            "app_formula_draft:default-weights@default-weights"
        );

        let error = parse_heuristic(&format!("app_formula_draft:{path}"))
            .expect_err("a draft spec with no opponent path must not parse");
        assert!(error.contains("<hero weights>@<opponent weights>"), "{error}");
    }

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
