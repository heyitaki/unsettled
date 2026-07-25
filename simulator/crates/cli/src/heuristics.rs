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
    register_app_formula(format!("app_formula:{stem}"), weights)
}
