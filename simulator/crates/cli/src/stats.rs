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

pub fn wilson95(wins: u64, games: u64) -> [f64; 2] {
    wilson(wins, games, 1.959_963_984_540_054)
}

pub fn normal_quantile(p: f64) -> f64 {
    const A: [f64; 8] = [
        3.387_132_872_796_366_5,
        133.141_667_891_784_38,
        1_971.590_950_306_551_3,
        13_731.693_765_509_46,
        45_921.953_931_549_87,
        67_265.770_927_008_7,
        33_430.575_583_588_13,
        2_509.080_928_730_122_7,
    ];
    const B: [f64; 8] = [
        1.0,
        42.313_330_701_600_91,
        687.187_007_492_057_9,
        5_394.196_021_424_751,
        21_213.794_301_586_597,
        39_307.895_800_092_71,
        28_729.085_735_721_943,
        5_226.495_278_852_854,
    ];
    const C: [f64; 8] = [
        1.423_437_110_749_683_5,
        4.630_337_846_156_546,
        5.769_497_221_460_691,
        3.647_848_324_763_204_5,
        1.270_458_252_452_368_4,
        0.241_780_725_177_450_6,
        0.022_723_844_989_269_184,
        0.000_774_545_014_278_341_4,
    ];
    const D: [f64; 8] = [
        1.0,
        2.053_191_626_637_759,
        1.676_384_830_183_803_8,
        0.689_767_334_985_1,
        0.148_103_976_427_480_08,
        0.015_198_666_563_616_457,
        0.000_547_593_808_499_534_5,
        1.050_750_071_644_416_8e-9,
    ];
    const E: [f64; 8] = [
        6.657_904_643_501_104,
        5.463_784_911_164_114,
        1.784_826_539_917_291_3,
        0.296_560_571_828_504_87,
        0.026_532_189_526_576_123,
        0.001_242_660_947_388_078_4,
        0.000_027_115_555_687_434_876,
        2.010_334_399_292_288e-7,
    ];
    const F: [f64; 8] = [
        1.0,
        0.599_832_206_555_887_9,
        0.136_929_880_922_735_8,
        0.014_875_361_290_850_615,
        0.000_786_869_131_145_613_3,
        0.000_018_463_183_175_100_547,
        1.421_511_758_316_445_8e-7,
        2.044_263_103_389_94e-15,
    ];

    if p.is_nan() || !(0.0..=1.0).contains(&p) {
        return f64::NAN;
    }
    if p == 0.0 {
        return f64::NEG_INFINITY;
    }
    if p == 1.0 {
        return f64::INFINITY;
    }
    let centered = p - 0.5;
    if centered.abs() <= 0.425 {
        let value = 0.180_625 - centered * centered;
        return centered * polynomial(value, &A) / polynomial(value, &B);
    }
    let tail = if centered < 0.0 { p } else { 1.0 - p };
    let root = (-tail.ln()).sqrt();
    let quantile = if root <= 5.0 {
        let value = root - 1.6;
        polynomial(value, &C) / polynomial(value, &D)
    } else {
        let value = root - 5.0;
        polynomial(value, &E) / polynomial(value, &F)
    };
    if centered < 0.0 { -quantile } else { quantile }
}

fn polynomial(value: f64, coefficients: &[f64; 8]) -> f64 {
    coefficients
        .iter()
        .rev()
        .fold(0.0, |result, coefficient| result * value + coefficient)
}
