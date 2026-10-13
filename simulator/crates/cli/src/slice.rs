use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::evaluate::{EvaluationUnit, PairStats, pair_verdict, renumber_boards, try_paired_stats};
use crate::features::{RaceReadings, Rule, TERRAIN_NAMES, TerrainFeatures, UNIT_COLUMNS};
use crate::stats::alpha_z;

pub const THRESHOLD: f64 = 0.005;
pub const ALPHA: f64 = 0.05;
pub const FLOOR_DENOMINATOR: usize = 5;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SliceConfig {
    pub seats: usize,
    pub boards: usize,
    pub reps: usize,
    pub units: usize,
    pub reference: String,
    pub threshold: f64,
    pub alpha: f64,
    pub domain: String,
    pub domain_seed: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct InputConfig {
    seats: usize,
    boards: usize,
    reps: usize,
    units: usize,
    reference: Option<String>,
    domain: String,
    domain_seed: u64,
}

#[derive(Debug)]
struct UnitRow {
    unit: EvaluationUnit,
    terrain: TerrainFeatures,
    race: RaceReadings,
    wins: Vec<bool>,
}

#[derive(Debug)]
pub struct RunData {
    pub config: SliceConfig,
    arms: Vec<String>,
    reference: usize,
    rows: Vec<UnitRow>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuleScore {
    pub arm: String,
    pub rule: String,
    pub predicates: usize,
    pub fired_units: usize,
    pub fired_share: f64,
    #[serde(flatten)]
    pub stats: PairStats,
    pub verdict: String,
    pub total_gain: f64,
}

#[derive(Debug, Serialize)]
pub struct DroppedRule {
    pub rule: String,
    pub reason: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RaceRow {
    pub arm: String,
    pub slot: usize,
    pub rule: String,
    pub fired_units: usize,
    pub stats: Option<PairStats>,
    pub total_gain: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CutPoints {
    pub road_pips: [f64; 2],
    pub road_pips_min: [f64; 2],
    pub spot_falloff: [f64; 2],
    pub top_crowding: [f64; 2],
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Slices {
    pub config: SliceConfig,
    pub cut_points: CutPoints,
    pub rules: Vec<RuleScore>,
    pub dropped: Vec<DroppedRule>,
    pub candidate: Option<RuleScore>,
    pub race_table: Vec<RaceRow>,
}

pub fn read_run(directory: &Path) -> Result<RunData, String> {
    let evaluation = fs::read(directory.join("evaluation.json"))
        .map_err(|error| format!("evaluation.json unavailable, run did not finish: {error}"))?;
    let evaluation: serde_json::Value = serde_json::from_slice(&evaluation)
        .map_err(|error| format!("invalid evaluation.json: {error}"))?;
    let config = &evaluation["config"];
    if config.get("where").is_some() {
        return Err("evaluation.json has config.where; slice requires an unfiltered run".into());
    }
    if config.get("reference").and_then(|value| value.as_str()).is_none() {
        return Err("evaluation.json requires config.reference".into());
    }
    let config: InputConfig = serde_json::from_value(config.clone())
        .map_err(|error| format!("invalid evaluation.json config: {error}"))?;
    let expected_units = config.boards.checked_mul(config.reps).and_then(|n| n.checked_mul(config.seats));
    if config.boards == 0 || config.reps == 0 || !(2..=6).contains(&config.seats)
        || expected_units != Some(config.units)
    {
        return Err("evaluation.json config has an invalid schedule".into());
    }
    let expected_arms = evaluation["arms"].as_object()
        .ok_or("evaluation.json requires arms")?;
    let file = fs::File::open(directory.join("units.csv"))
        .map_err(|error| format!("units.csv missing or unreadable: {error}"))?;
    let mut lines = BufReader::new(file).lines();
    let header = lines.next().ok_or("units.csv missing header")?
        .map_err(|error| format!("units.csv header: {error}"))?;
    let columns = header.split(',').collect::<Vec<_>>();
    if columns.len() < UNIT_COLUMNS.len() || columns[..10] != UNIT_COLUMNS {
        return Err("units.csv header must start with the ten fixed columns".into());
    }
    let labels = columns[10..].iter().copied().collect::<BTreeSet<_>>();
    if labels.len() != columns.len() - 10
        || labels != expected_arms.keys().map(String::as_str).collect()
        || labels.iter().any(|label| UNIT_COLUMNS.contains(label))
    {
        return Err("units.csv arm labels do not match evaluation.json arms without repeats".into());
    }
    let reference_label = config.reference.unwrap();
    let arms = columns[10..].iter().map(|label| label.to_string()).collect::<Vec<_>>();
    let reference = arms.iter().position(|label| *label == reference_label)
        .ok_or("evaluation.json config.reference does not name an arm column")?;
    let mut rows = Vec::new();
    let mut wins = vec![0_u64; arms.len()];
    for (index, line) in lines.enumerate() {
        let line = line.map_err(|error| format!("units.csv row {}: {error}", index + 1))?;
        let cells = line.split(',').collect::<Vec<_>>();
        if cells.len() != columns.len() {
            return Err(format!("units.csv row {} has {} columns, expected {}", index + 1, cells.len(), columns.len()));
        }
        let integer = |column: usize| -> Result<usize, String> {
            cells[column].parse::<usize>().map_err(|_| format!("units.csv row {} invalid {}: {}",
                index + 1, columns[column], cells[column]))
        };
        let small_integer = |column| -> Result<u16, String> {
            u16::try_from(integer(column)?).map_err(|_| format!("units.csv invalid {}: {}", columns[column], cells[column]))
        };
        let board = integer(0)?;
        let slot = integer(1)?;
        let rep = integer(2)?;
        let spot_falloff = cells[5].parse::<f64>().ok().filter(|value| value.is_finite())
            .ok_or_else(|| format!("units.csv invalid spotFalloff: {}", cells[5]))?;
        let terrain = TerrainFeatures {
            road_pips: small_integer(3)?, road_pips_min: small_integer(4)?,
            spot_falloff, top_crowding: small_integer(6)?,
        };
        let levels = [integer(7)?, integer(8)?, integer(9)?];
        if levels[0] > 2 || levels[1] > slot || levels[2] > slot || levels[1] > levels[2] {
            return Err(format!("units.csv row {} invalid race readings", index + 1));
        }
        let race = RaceReadings { hero_ready: levels[0] as u8, ready_ahead: levels[1] as u8,
            ready_ahead_trade: levels[2] as u8 };
        let mut indicators = Vec::with_capacity(arms.len());
        for (arm, cell) in cells[10..].iter().enumerate() {
            let won = match *cell {
                "0" => false,
                "1" => true,
                _ => return Err(format!("units.csv invalid arm cell for {}: {cell}", arms[arm])),
            };
            wins[arm] += u64::from(won);
            indicators.push(won);
        }
        rows.push(UnitRow { unit: EvaluationUnit { board, hero_seat: slot, rep }, terrain, race, wins: indicators });
    }
    if rows.is_empty() {
        return Err("units.csv has a header but no data row".into());
    }
    if rows.len() != config.units {
        return Err(format!("units.csv has {} rows, expected {} from config.units", rows.len(), config.units));
    }
    let per_board = config.reps * config.seats;
    for (index, row) in rows.iter().enumerate() {
        let expected = EvaluationUnit { board: index / per_board,
            rep: index % per_board / config.seats, hero_seat: index % config.seats };
        if row.unit != expected {
            return Err(format!("units.csv schedule mismatch at row {}: {:?}, expected {expected:?}", index + 1, row.unit));
        }
        if row.terrain != rows[expected.board * per_board].terrain {
            return Err(format!("units.csv terrain features disagree on board {}", expected.board));
        }
    }
    for (label, wins) in arms.iter().zip(wins) {
        let expected = expected_arms[label]["wins"].as_u64()
            .ok_or_else(|| format!("evaluation.json invalid arms.{label}.wins"))?;
        if wins != expected {
            return Err(format!("units.csv arm wins for {label}: {wins}, expected {expected}"));
        }
    }
    Ok(RunData {
        config: SliceConfig { seats: config.seats, boards: config.boards, reps: config.reps,
            units: config.units, reference: reference_label, threshold: THRESHOLD, alpha: ALPHA,
            domain: config.domain, domain_seed: config.domain_seed },
        arms, reference, rows,
    })
}

pub fn score_rule(units: &RunData, arm: &str, text: &str) -> Result<RuleScore, String> {
    let arm_index = units.arms.iter().position(|label| label == arm)
        .ok_or_else(|| format!("unknown arm {arm}"))?;
    let rule = Rule::parse(text)?;
    let selected = units.rows.iter().enumerate().filter_map(|(index, row)| {
        rule.matches(row.terrain, row.unit.hero_seat).then_some(index)
    }).collect::<Vec<_>>();
    let stats = score_set(units, arm_index, &selected)
        .map_err(|error| format!("rule {text}: {error}"))?
        .ok_or_else(|| format!("rule {text} fires on no unit"))?;
    Ok(RuleScore {
        arm: arm.to_string(), rule: text.to_string(), predicates: rule.predicate_count(),
        fired_units: selected.len(), fired_share: selected.len() as f64 / units.config.units as f64,
        verdict: pair_verdict(stats.interval, THRESHOLD).into(),
        total_gain: total_gain(&stats, units.config.units), stats,
    })
}

fn score_set(units: &RunData, arm: usize, selected: &[usize]) -> Result<Option<PairStats>, String> {
    if selected.is_empty() { return Ok(None) }
    let mut schedule = selected.iter().map(|index| units.rows[*index].unit).collect::<Vec<_>>();
    let boards = renumber_boards(&mut schedule);
    let board_of_unit = schedule.iter().map(|unit| unit.board).collect::<Vec<_>>();
    let arm = selected.iter().map(|index| units.rows[*index].wins[arm]).collect::<Vec<_>>();
    let reference = selected.iter().map(|index| units.rows[*index].wins[units.reference]).collect::<Vec<_>>();
    try_paired_stats(&arm, &reference, &board_of_unit, boards, alpha_z(ALPHA)?).map(Some)
}

fn total_gain(stats: &PairStats, all_units: usize) -> f64 {
    (stats.b as f64 - stats.c as f64) / all_units as f64
}

fn cut_points(units: &RunData) -> [[f64; 2]; 4] {
    std::array::from_fn(|feature| {
        let mut values = units.rows.iter().step_by(units.config.reps * units.config.seats)
            .map(|row| row.terrain.values()[feature]).collect::<Vec<_>>();
        values.sort_by(f64::total_cmp);
        [values[values.len() / 3], values[2 * values.len() / 3]]
    })
}

fn rule_family(seats: usize, cuts: &[[f64; 2]; 4]) -> Vec<String> {
    let slots = [">=", "<"].into_iter().flat_map(|op| {
        (1..seats).map(move |slot| format!("slot{op}{slot}"))
    }).collect::<Vec<_>>();
    let mut terrain = Vec::new();
    for (feature, points) in TERRAIN_NAMES.iter().zip(cuts) {
        for point in points {
            terrain.push(format!("{feature}<{point}"));
            terrain.push(format!("{feature}>={point}"));
        }
    }
    let mut rules = vec!["always".into()];
    rules.extend(slots.iter().cloned());
    rules.extend(terrain.iter().cloned());
    for slot in slots {
        rules.extend(terrain.iter().map(|terrain| format!("{slot}&{terrain}")));
    }
    rules
}

fn partition_rules(units: &RunData, family: &[String]) -> Result<(Vec<String>, Vec<DroppedRule>), String> {
    let mut seen = BTreeMap::new();
    let mut kept = Vec::new();
    let mut dropped = Vec::new();
    for text in family {
        let rule = Rule::parse(text)?;
        let mut mask = vec![0_u64; units.rows.len().div_ceil(64)];
        let mut count = 0;
        for (index, row) in units.rows.iter().enumerate() {
            if rule.matches(row.terrain, row.unit.hero_seat) {
                mask[index / 64] |= 1 << (index % 64);
                count += 1;
            }
        }
        let reason = if FLOOR_DENOMINATOR as u128 * (count as u128) < units.config.units as u128 {
            Some("below the 20% floor".to_string())
        } else if let Some(earlier) = seen.get(&mask) {
            Some(format!("duplicate fired set of {earlier}"))
        } else { None };
        seen.entry(mask).or_insert_with(|| text.clone());
        if let Some(reason) = reason {
            dropped.push(DroppedRule { rule: text.clone(), reason });
        } else {
            kept.push(text.clone());
        }
    }
    Ok((kept, dropped))
}

fn choose_candidate(rows: &[RuleScore]) -> Option<RuleScore> {
    let mut best: Option<&RuleScore> = None;
    for row in rows.iter().filter(|row| row.verdict == "better") {
        let key = |row: &RuleScore| (i128::from(row.stats.b) - i128::from(row.stats.c),
            std::cmp::Reverse(row.predicates));
        if best.is_none_or(|previous| key(row) > key(previous)) {
            best = Some(row);
        }
    }
    best.cloned()
}

fn race_table(units: &RunData) -> Result<Vec<RaceRow>, String> {
    let mut table = Vec::new();
    for (arm_index, arm) in units.arms.iter().enumerate().filter(|(index, _)| *index != units.reference) {
        for slot in 0..units.config.seats {
            let conditions = [("readyAhead", 1, 1), ("readyAheadTrade", 2, 1), ("heroReady", 0, 2)];
            for (name, feature, cutoff) in conditions {
                if slot == 0 && feature != 0 { continue; }
                for at_least in [true, false] {
                    let text = format!("{name}{}{cutoff}", if at_least { ">=" } else { "<" });
                    let selected = units.rows.iter().enumerate().filter_map(|(index, row)| {
                        let value = row.race.values()[feature];
                        (row.unit.hero_seat == slot && if at_least { value >= cutoff } else { value < cutoff })
                            .then_some(index)
                    }).collect::<Vec<_>>();
                    let stats = score_set(units, arm_index, &selected)
                        .map_err(|error| format!("race table {arm} slot {slot} {text}: {error}"))?;
                    table.push(RaceRow { arm: arm.clone(), slot, rule: text, fired_units: selected.len(),
                        total_gain: stats.as_ref().map_or(0.0, |stats| total_gain(stats, units.config.units)), stats });
                }
            }
        }
    }
    Ok(table)
}

pub fn slice_run(directory: &Path) -> Result<Slices, String> {
    let units = read_run(directory)?;
    let cuts = cut_points(&units);
    let (kept, dropped) = partition_rules(&units, &rule_family(units.config.seats, &cuts))?;
    let mut rules = Vec::new();
    for arm in units.arms.iter().filter(|arm| **arm != units.config.reference) {
        for rule in &kept {
            rules.push(score_rule(&units, arm, rule)?);
        }
    }
    let report = Slices {
        config: units.config.clone(),
        cut_points: CutPoints { road_pips: cuts[0], road_pips_min: cuts[1], spot_falloff: cuts[2], top_crowding: cuts[3] },
        candidate: choose_candidate(&rules), rules, dropped, race_table: race_table(&units)?,
    };
    let mut json = serde_json::to_vec_pretty(&report).map_err(|error| error.to_string())?;
    json.push(b'\n');
    fs::write(directory.join("slices.json"), json).map_err(|error| format!("slices.json: {error}"))?;
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static NEXT: AtomicUsize = AtomicUsize::new(0);

    fn fixture(boards: usize, seats: usize, reps: usize, labels: &[&str],
        won: impl Fn(usize, usize, usize, usize) -> bool) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("unsettled-slice-{}-{}",
            std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed)));
        fs::create_dir_all(&dir).unwrap();
        let mut csv = format!("{},{}\n", UNIT_COLUMNS.join(","), labels.join(","));
        let mut wins = vec![0_u64; labels.len()];
        for board in 0..boards {
            for rep in 0..reps {
                for slot in 0..seats {
                    csv.push_str(&format!("{board},{slot},{rep},{board},{board},{},{board},2,0,0",
                        (board + 1) as f64 / (boards + 1) as f64));
                    for arm in 0..labels.len() {
                        let value = u64::from(won(board, slot, rep, arm));
                        wins[arm] += value;
                        csv.push_str(&format!(",{value}"));
                    }
                    csv.push('\n');
                }
            }
        }
        let arms = labels.iter().zip(wins).map(|(label, wins)| {
            (label.to_string(), json!({"wins": wins}))
        }).collect::<serde_json::Map<_, _>>();
        let evaluation = json!({"config": {"seats": seats, "boards": boards, "reps": reps,
            "units": boards * seats * reps, "reference": "base", "domain": "tuning",
            "domainSeed": 8795845034216596999_u64}, "arms": arms});
        fs::write(dir.join("evaluation.json"), serde_json::to_vec(&evaluation).unwrap()).unwrap();
        fs::write(dir.join("units.csv"), csv).unwrap();
        dir
    }

    fn edit_json(dir: &Path, edit: impl FnOnce(&mut Value)) {
        let path = dir.join("evaluation.json");
        let mut value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        edit(&mut value);
        fs::write(path, serde_json::to_vec(&value).unwrap()).unwrap();
    }

    fn edit_csv(dir: &Path, edit: impl FnOnce(&mut Vec<Vec<String>>)) {
        let path = dir.join("units.csv");
        let mut rows = fs::read_to_string(&path).unwrap().lines()
            .map(|line| line.split(',').map(str::to_string).collect::<Vec<_>>()).collect::<Vec<_>>();
        edit(&mut rows);
        fs::write(path, rows.iter().map(|row| row.join(",") + "\n").collect::<String>()).unwrap();
    }

    #[test]
    fn cut_points_use_board_values_at_one_and_two_thirds() {
        for (boards, expected) in [(3, [1.0, 2.0]), (4, [1.0, 2.0]), (7, [2.0, 4.0])] {
            let dir = fixture(boards, 4, 2, &["base", "arm"], |_, _, _, _| false);
            let run = read_run(&dir).unwrap();
            let cuts = cut_points(&run);
            assert_eq!(cuts[0], expected);
            assert_eq!(cuts[1], expected);
            assert_eq!(cuts[3], expected);
            assert_eq!(cuts[2], [(expected[0] + 1.0) / (boards + 1) as f64,
                (expected[1] + 1.0) / (boards + 1) as f64]);
            fs::remove_dir_all(dir).unwrap();
        }
    }

    #[test]
    fn rule_family_has_the_required_sizes_and_order() {
        for (seats, size) in [(3, 85), (4, 119), (5, 153), (6, 187)] {
            let rules = rule_family(seats, &[[1.0, 2.0]; 4]);
            assert_eq!(rules.len(), size);
            assert_eq!(rules[0], "always");
            assert_eq!(rules[1], "slot>=1");
            assert_eq!(rules[seats - 1], format!("slot>={}", seats - 1));
            assert_eq!(rules[seats], "slot<1");
            assert_eq!(&rules[2 * seats - 1..2 * seats + 3],
                ["roadPips<1", "roadPips>=1", "roadPips<2", "roadPips>=2"]);
            assert_eq!(rules[2 * seats + 15], "slot>=1&roadPips<1");
            assert_eq!(rules.last().unwrap(), &format!("slot<{}&topCrowding>=2", seats - 1));
        }
    }

    #[test]
    fn floor_is_inclusive_at_one_fifth_and_duplicate_sets_are_named() {
        let dir = fixture(5, 5, 1, &["base", "arm"], |_, _, _, _| false);
        let run = read_run(&dir).unwrap();
        let family = ["always", "roadPips>=4", "slot>=1&roadPips>=4", "roadPipsMin>=4",
            "roadPips>=0"].map(str::to_string);
        let (kept, dropped) = partition_rules(&run, &family).unwrap();
        assert_eq!(kept, ["always", "roadPips>=4"]);
        assert_eq!(dropped[0].rule, family[2]);
        assert!(dropped[0].reason.contains("floor"));
        assert!(dropped[1].reason.contains("duplicate"));
        assert!(dropped[1].reason.contains("roadPips>=4"));
        assert!(dropped[2].reason.contains("always"));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn equal_cut_points_drop_empty_and_duplicate_predicates() {
        let dir = fixture(3, 4, 1, &["base", "arm"], |_, _, _, _| false);
        edit_csv(&dir, |rows| for row in &mut rows[1..] { row[3] = "7".into(); });
        let report = slice_run(&dir).unwrap();
        assert_eq!(report.cut_points.road_pips, [7.0, 7.0]);
        assert_eq!(report.dropped.iter().filter(|row| row.rule == "roadPips<7" && row.reason.contains("floor")).count(), 2);
        assert_eq!(report.dropped.iter().filter(|row| row.rule == "roadPips>=7" && row.reason.contains("duplicate")).count(), 2);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn candidate_uses_integer_gain_then_predicates_then_arm_then_rule_order() {
        let dir = fixture(30, 4, 2, &["base", "earlier", "later"], |_, slot, _, arm| arm > 0 && slot < 3);
        let run = read_run(&dir).unwrap();
        let small = score_rule(&run, "earlier", "slot<1").unwrap();
        let large = score_rule(&run, "earlier", "slot<3").unwrap();
        assert_eq!(choose_candidate(&[small, large.clone()]).unwrap().rule, "slot<3");
        let joined = score_rule(&run, "earlier", "slot<3&roadPips>=0").unwrap();
        assert_eq!(choose_candidate(&[joined, large.clone()]).unwrap().predicates, 1);
        let later = score_rule(&run, "later", "slot<3").unwrap();
        assert_eq!(choose_candidate(&[large.clone(), later]).unwrap().arm, "earlier");
        let equivalent = score_rule(&run, "earlier", "slot>=0").unwrap();
        assert_eq!(large.stats.b, equivalent.stats.b);
        assert_eq!(choose_candidate(&[large, equivalent]).unwrap().rule, "slot<3");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn column_order_wins_a_five_arm_tie_even_when_json_keys_are_sorted() {
        let dir = fixture(30, 4, 2, &["base", "flat_75", "flat_reprice", "race_reprice", "race_75"],
            |_, _, _, arm| arm >= 3);
        let report = slice_run(&dir).unwrap();
        assert_eq!(report.candidate.unwrap().arm, "race_reprice");
        assert_eq!(report.rules[0].arm, "flat_75");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn identical_columns_never_pass_and_leave_no_candidate() {
        let dir = fixture(7, 4, 2, &["base", "arm"], |board, slot, _, _| (board + slot) % 2 == 0);
        let report = slice_run(&dir).unwrap();
        assert!(report.candidate.is_none());
        for row in report.rules {
            assert_eq!((row.stats.b, row.stats.c, row.stats.estimate), (0, 0, 0.0));
            assert_eq!(row.stats.interval, [0.0, 0.0]);
            assert_ne!(row.verdict, "better");
        }
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_narrow_rule_that_passes_beats_a_larger_total_that_misses_the_bar() {
        let dir = fixture(10, 5, 2, &["base", "arm"], |board, slot, _, arm| {
            if arm == 0 { board >= 6 && slot < 4 } else { board < 6 || slot == 4 }
        });
        let run = read_run(&dir).unwrap();
        let broad = score_rule(&run, "arm", "always").unwrap();
        let narrow = score_rule(&run, "arm", "slot>=4").unwrap();
        assert!(broad.total_gain > narrow.total_gain);
        assert_ne!(broad.verdict, "better");
        assert_eq!(narrow.verdict, "better");
        assert_eq!(choose_candidate(&[broad, narrow]).unwrap().rule, "slot>=4");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn race_table_keeps_slots_separate_and_empty_sets_have_null_statistics() {
        let dir = fixture(3, 4, 2, &["base", "arm"], |_, _, _, _| false);
        edit_csv(&dir, |rows| {
            for row in &mut rows[1..] {
                let board = row[0].parse::<usize>().unwrap();
                let slot = row[1].parse::<usize>().unwrap();
                row[7] = if slot == 3 { "2".into() } else { board.to_string() };
                row[8] = usize::from(slot > 0 && board == 0).to_string();
                row[9] = usize::from(slot > 0 && board <= 1).to_string();
            }
        });
        let report = slice_run(&dir).unwrap();
        assert_eq!(report.race_table.len(), 20);
        let mut index = 0;
        for slot in 0..4 {
            let expected = if slot == 0 {
                vec![("heroReady>=2", 2), ("heroReady<2", 4)]
            } else {
                vec![("readyAhead>=1", 2), ("readyAhead<1", 4),
                    ("readyAheadTrade>=1", 4), ("readyAheadTrade<1", 2),
                    ("heroReady>=2", if slot == 3 { 6 } else { 2 }),
                    ("heroReady<2", if slot == 3 { 0 } else { 4 })]
            };
            for (rule, count) in expected {
                let row = &report.race_table[index];
                assert_eq!(row.slot, slot);
                assert_eq!(row.rule, rule);
                assert_eq!(row.fired_units, count);
                assert_eq!(row.total_gain, 0.0);
                if count == 0 {
                    assert!(serde_json::to_value(row).unwrap()["stats"].is_null());
                } else {
                    let stats = row.stats.as_ref().unwrap();
                    assert_eq!(stats.n, count);
                    assert_eq!(stats.clusters, count / 2);
                    assert_eq!((stats.b, stats.c), (0, 0));
                }
                index += 1;
            }
        }
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn race_table_reports_unbalanced_repetitions_with_the_row_name() {
        let dir = fixture(3, 4, 2, &["base", "arm"], |_, _, _, _| false);
        edit_csv(&dir, |rows| rows[1][7] = "0".into());
        let error = slice_run(&dir).unwrap_err();
        assert!(error.contains("heroReady>=2"), "{error}");
        assert!(error.contains("balanced board schedule"), "{error}");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn each_bad_input_is_named_and_does_not_touch_slices() {
        for case in 0..13 {
            let dir = fixture(3, 4, 2, &["base", "arm"], |_, _, _, _| false);
            let expected = match case {
                0 => { fs::remove_file(dir.join("evaluation.json")).unwrap(); "run did not finish" }
                1 => { edit_json(&dir, |v| { v["config"].as_object_mut().unwrap().remove("reference"); }); "config.reference" }
                2 => { edit_json(&dir, |v| v["config"]["where"] = json!("slot>=1")); "config.where" }
                3 => { fs::remove_file(dir.join("units.csv")).unwrap(); "units.csv missing" }
                4 => { edit_csv(&dir, |rows| rows.truncate(1)); "no data row" }
                5 => { edit_csv(&dir, |rows| rows[0][3] = "wrong".into()); "header" }
                6 => { edit_csv(&dir, |rows| rows[0][11] = "absent".into()); "arm labels" }
                7 => { edit_csv(&dir, |rows| rows[0][11] = "base".into()); "arm labels" }
                8 => { edit_csv(&dir, |rows| rows.truncate(17)); "16 rows, expected 24" }
                9 => { edit_csv(&dir, |rows| rows.swap(1, 2)); "schedule" }
                10 => { edit_csv(&dir, |rows| rows[2][3] = "9".into()); "terrain" }
                11 => { edit_csv(&dir, |rows| rows[1][11] = "1".into()); "arm wins" }
                _ => { edit_csv(&dir, |rows| rows[1][11] = "2".into()); "arm cell" }
            };
            fs::write(dir.join("slices.json"), "keep").unwrap();
            let error = slice_run(&dir).unwrap_err();
            assert!(error.contains(expected), "case {case}: {error}");
            assert_eq!(fs::read_to_string(dir.join("slices.json")).unwrap(), "keep");
            fs::remove_dir_all(dir).unwrap();
        }
    }

    #[test]
    fn slices_repeat_exactly_and_keep_the_specified_json_key_order() {
        let dir = fixture(7, 4, 2, &["base", "arm"], |_, _, _, arm| arm > 0);
        slice_run(&dir).unwrap();
        let first = fs::read(dir.join("slices.json")).unwrap();
        slice_run(&dir).unwrap();
        assert_eq!(fs::read(dir.join("slices.json")).unwrap(), first);
        let text = String::from_utf8(first).unwrap();
        let mut offset = 0;
        for key in ["config", "cutPoints", "rules", "dropped", "candidate", "raceTable"] {
            let next = text.find(&format!("\n  \"{key}\":")).unwrap();
            assert!(next > offset);
            offset = next;
        }
        fs::remove_dir_all(dir).unwrap();
    }
}
