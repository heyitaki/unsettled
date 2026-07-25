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

pub fn wilson95(wins: u64, games: u64) -> [f64; 2] {
    if games == 0 {
        return [0.0, 0.0];
    }
    let n = games as f64;
    let p = wins as f64 / n;
    let z = 1.959_963_984_540_054;
    let denominator = 1.0 + z * z / n;
    let center = (p + z * z / (2.0 * n)) / denominator;
    let margin = z * ((p * (1.0 - p) / n + z * z / (4.0 * n * n)).sqrt()) / denominator;
    [center - margin, center + margin]
}
