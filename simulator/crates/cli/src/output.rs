use std::collections::BTreeMap;
use std::fs::{self, File};
use std::io::{BufWriter, Write};
use std::path::Path;

use serde::Serialize;

use crate::stats::HeuristicStats;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResultConfig {
    pub layout: String,
    pub policy: String,
    pub seed: u64,
    pub schedule_size: usize,
    pub allow_unofficial: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Results {
    pub config: ResultConfig,
    pub heuristics: BTreeMap<String, HeuristicStats>,
    pub head_to_head: BTreeMap<String, BTreeMap<String, u64>>,
    pub illegal_actions: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Meta {
    pub elapsed_seconds: f64,
    pub games_per_second: f64,
    pub threads: usize,
    pub rust_version: String,
    pub simulator_version: String,
}

pub fn write_outputs(directory: &Path, results: &Results, meta: &Meta) -> Result<(), String> {
    fs::create_dir_all(directory).map_err(|error| error.to_string())?;
    let json = serde_json::to_vec_pretty(results).map_err(|error| error.to_string())?;
    fs::write(
        directory.join("results.json"),
        [json.as_slice(), b"\n"].concat(),
    )
    .map_err(|error| error.to_string())?;
    let meta_json = serde_json::to_vec_pretty(meta).map_err(|error| error.to_string())?;
    fs::write(
        directory.join("meta.json"),
        [meta_json.as_slice(), b"\n"].concat(),
    )
    .map_err(|error| error.to_string())?;
    let file = File::create(directory.join("results.csv")).map_err(|error| error.to_string())?;
    let mut writer = BufWriter::new(file);
    writeln!(
        writer,
        "heuristic,games,wins,winRate,wilsonLo,wilsonHi,meanVp,meanTurns,draws"
    )
    .map_err(|error| error.to_string())?;
    for (name, stats) in &results.heuristics {
        writeln!(
            writer,
            "{},{},{},{:.12},{:.12},{:.12},{:.12},{:.12},{}",
            name,
            stats.games,
            stats.wins,
            stats.win_rate,
            stats.wilson95[0],
            stats.wilson95[1],
            stats.mean_vp,
            stats.mean_turns,
            stats.draws
        )
        .map_err(|error| error.to_string())?;
    }
    writer.flush().map_err(|error| error.to_string())
}
