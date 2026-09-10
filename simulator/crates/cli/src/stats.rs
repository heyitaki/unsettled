use std::collections::BTreeMap;

use serde::Serialize;
use unsettled_engine::game::GameResult;
use unsettled_engine::placement::PlacementKind;

use crate::schedule::ScheduleEntry;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PerSeat {
    pub seat: usize,
    pub games: u64,
    pub wins: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HeuristicStats {
    pub games: u64,
    pub wins: u64,
    pub win_rate: f64,
    pub wilson95: [f64; 2],
    pub mean_vp: f64,
    pub mean_turns: f64,
    pub per_seat: Vec<PerSeat>,
    pub draws: u64,
}

#[derive(Default)]
struct Accumulator {
    games: u64,
    wins: u64,
    vp: u64,
    turns: u64,
    draws: u64,
    per_seat: Vec<PerSeat>,
}

pub fn aggregate(
    entries: &[ScheduleEntry],
    games: &[GameResult],
    heuristics: &[PlacementKind],
    seats: usize,
) -> (
    BTreeMap<String, HeuristicStats>,
    BTreeMap<String, BTreeMap<String, u64>>,
) {
    let mut accumulators: BTreeMap<String, Accumulator> = heuristics
        .iter()
        .map(|kind| {
            (
                kind.name().to_string(),
                Accumulator {
                    per_seat: (0..seats)
                        .map(|seat| PerSeat {
                            seat,
                            games: 0,
                            wins: 0,
                        })
                        .collect(),
                    ..Accumulator::default()
                },
            )
        })
        .collect();
    let mut head_to_head: BTreeMap<String, BTreeMap<String, u64>> = heuristics
        .iter()
        .map(|row| {
            (
                row.name().to_string(),
                heuristics
                    .iter()
                    .map(|column| (column.name().to_string(), 0))
                    .collect(),
            )
        })
        .collect();
    for (entry, game) in entries.iter().zip(games) {
        let mut present = vec![false; heuristics.len()];
        for seat in 0..seats {
            let index = (seat + entry.rotation) % heuristics.len();
            present[index] = true;
            let accumulator = accumulators.get_mut(heuristics[index].name()).unwrap();
            accumulator.games += 1;
            accumulator.vp += u64::from(game.vp[seat]);
            accumulator.turns += u64::from(game.turns);
            accumulator.draws += u64::from(game.draw);
            accumulator.per_seat[seat].games += 1;
            if game.winner == Some(seat as u8) {
                accumulator.wins += 1;
                accumulator.per_seat[seat].wins += 1;
            }
        }
        if let Some(winner) = game.winner {
            let row_index = (usize::from(winner) + entry.rotation) % heuristics.len();
            for (column, exists) in present.iter().enumerate() {
                if *exists && column != row_index {
                    *head_to_head
                        .get_mut(heuristics[row_index].name())
                        .unwrap()
                        .get_mut(heuristics[column].name())
                        .unwrap() += 1;
                }
            }
        }
    }
    let stats = accumulators
        .into_iter()
        .map(|(name, accumulator)| {
            let games = accumulator.games.max(1);
            (
                name,
                HeuristicStats {
                    games: accumulator.games,
                    wins: accumulator.wins,
                    win_rate: accumulator.wins as f64 / games as f64,
                    wilson95: wilson95(accumulator.wins, accumulator.games),
                    mean_vp: accumulator.vp as f64 / games as f64,
                    mean_turns: accumulator.turns as f64 / games as f64,
                    per_seat: accumulator.per_seat,
                    draws: accumulator.draws,
                },
            )
        })
        .collect();
    (stats, head_to_head)
}

pub fn wilson(wins: u64, games: u64, z: f64) -> [f64; 2] {
    if games == 0 {
        return [0.0, 0.0];
    }
    let n = games as f64;
    let p = wins as f64 / n;
    let denominator = 1.0 + z * z / n;
    let center = (p + z * z / (2.0 * n)) / denominator;
    let margin = z * ((p * (1.0 - p) / n + z * z / (4.0 * n * n)).sqrt()) / denominator;
    [center - margin, center + margin]
}

const Z_95: f64 = 1.959_963_984_540_054;

pub fn wilson95(wins: u64, games: u64) -> [f64; 2] {
    wilson(wins, games, Z_95)
}

pub fn alpha_z(alpha: f64) -> Result<f64, String> {
    match alpha {
        0.10 => Ok(1.644_853_626_951_472_2),
        0.05 => Ok(Z_95),
        0.01 => Ok(2.575_829_303_548_900_4),
        _ => Err("--alpha must be one of 0.10, 0.05, or 0.01".into()),
    }
}

/// A cluster-robust interval for the mean of a set of values grouped into clusters.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClusteredMean {
    pub mean: f64,
    pub interval: [f64; 2],
    /// Clusters that contributed at least one value.
    pub clusters: usize,
    /// True when fewer than two clusters contributed, leaving no between-cluster variance to
    /// estimate. The interval is then the statistic's full range and says nothing.
    pub degenerate: bool,
}

/// The unbalanced generalization of the board-clustered interval `evaluate::try_paired_stats`
/// builds. Each cluster's total is compared with what the overall mean predicts for a cluster of
/// its size; with equal cluster sizes that is the same estimator as the variance of the cluster
/// means. `bounds` clamps the result to the statistic's range.
///
/// `values` and `cluster_of_value` are consumed in order and clusters are accumulated by index,
/// so the result does not depend on how the values were produced.
pub fn clustered_mean(
    values: &[f64],
    cluster_of_value: &[usize],
    clusters: usize,
    z: f64,
    bounds: [f64; 2],
) -> ClusteredMean {
    let degenerate = ClusteredMean {
        mean: 0.0,
        interval: bounds,
        clusters: 0,
        degenerate: true,
    };
    if values.is_empty() || values.len() != cluster_of_value.len() {
        return degenerate;
    }
    let n = values.len() as f64;
    let mean = values.iter().sum::<f64>() / n;
    let mut sums = vec![0.0; clusters];
    let mut counts = vec![0_usize; clusters];
    for (value, cluster) in values.iter().zip(cluster_of_value) {
        if *cluster >= clusters {
            return degenerate;
        }
        sums[*cluster] += *value;
        counts[*cluster] += 1;
    }
    let contributing = counts.iter().filter(|count| **count > 0).count();
    if contributing < 2 {
        return ClusteredMean {
            mean,
            clusters: contributing,
            ..degenerate
        };
    }
    let residual = sums
        .iter()
        .zip(&counts)
        .filter(|(_, count)| **count > 0)
        .map(|(sum, count)| {
            let centered = sum - *count as f64 * mean;
            centered * centered
        })
        .sum::<f64>();
    let variance = contributing as f64 * residual / ((contributing - 1) as f64 * n * n);
    let margin = z * variance.sqrt();
    ClusteredMean {
        mean,
        interval: [
            (mean - margin).max(bounds[0]),
            (mean + margin).min(bounds[1]),
        ],
        clusters: contributing,
        degenerate: false,
    }
}
