//! M-61, how well the draft-aware lookahead's opponent model predicts the field it plays against.
//!
//! The draft kind prices a first settlement by replaying the picks that follow it, and it replays
//! them greedily: every intervening seat takes the argmax the app formula would take. Against a
//! greedy field that replay is exact, which `draft_lookahead.rs` pins. Against a field where every
//! seat is itself draft-aware it is an approximation, and this statistic is what says how good an
//! approximation, rather than leaving it assumed.
//!
//! For each recorded first settlement, the lookahead runs from the board as it stood before that
//! pick, with the vertex the seat actually took, and its plan is held against the trace: the picks
//! the intervening seats actually made, and the second settlement the seat actually took. Nothing
//! is chosen here, the games are already played, so the statistic runs on whatever `--placement`
//! names and the greedy control and the draft-aware reading are two invocations of one code path.

use serde::Serialize;
use unsettled_engine::board::SimBoard;
use unsettled_engine::game::SetupPick;
use unsettled_engine::placement::{PlacementKind, setup_lookahead_plan};
use unsettled_engine::state::EMPTY;
use unsettled_engine::topology::Topology;

/// One recorded first settlement held against what actually followed it.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LookaheadReading {
    /// The picking seat, which is its draft slot.
    pub seat: u8,
    /// Picks recorded between the seat's two settlements, which is what the lookahead predicts.
    pub intervening: u32,
    /// How many of them the lookahead named exactly, seat and vertex alike, in position.
    pub matched: u32,
    /// Whether every intervening pick matched, which is the condition under which the lookahead
    /// valued the candidate against the board the game actually reached.
    pub sequence_exact: bool,
    /// Whether the second settlement the seat took is the one the lookahead planned.
    pub second_matched: bool,
}

/// Read one game's setup trace, one reading per completed pair.
///
/// `vertex_owner` and `edge_owner` are reusable scratch, replayed forward so each first pick is
/// scored against the state that stood immediately before it; `out` receives the readings in the
/// order the first picks were made. A seat whose second settlement is missing from the trace has
/// no span to compare over and is skipped, as is a placement with no formula to replay with.
pub fn game_lookahead(
    board: &SimBoard,
    topology: &Topology,
    placement: PlacementKind,
    picks: &[SetupPick],
    vertex_owner: &mut Vec<u8>,
    edge_owner: &mut Vec<u8>,
    out: &mut Vec<LookaheadReading>,
) {
    vertex_owner.clear();
    vertex_owner.resize(topology.vertex_count(), EMPTY);
    edge_owner.clear();
    edge_owner.resize(topology.edge_count(), EMPTY);
    out.clear();
    for (index, pick) in picks.iter().enumerate() {
        if pick.pick == 0
            && let Some(reading) = first_pick_reading(
                board,
                topology,
                placement,
                picks,
                index,
                vertex_owner,
                edge_owner,
            )
        {
            out.push(reading);
        }
        vertex_owner[usize::from(pick.vertex)] = pick.seat;
        edge_owner[usize::from(pick.edge)] = pick.seat;
    }
}

/// Hold the lookahead's plan for the first pick at `index` against the trace that followed it.
fn first_pick_reading(
    board: &SimBoard,
    topology: &Topology,
    placement: PlacementKind,
    picks: &[SetupPick],
    index: usize,
    vertex_owner: &[u8],
    edge_owner: &[u8],
) -> Option<LookaheadReading> {
    let first = picks[index];
    let second = picks[index + 1..]
        .iter()
        .position(|pick| pick.seat == first.seat)?;
    let intervening = &picks[index + 1..index + 1 + second];
    let plan = setup_lookahead_plan(
        placement,
        board,
        topology,
        vertex_owner,
        edge_owner,
        first.seat,
        first.vertex,
    )?;
    // Positional, and only over the picks the trace holds: a plan longer or shorter than the span
    // is a mismatch on every position it fails to cover rather than an error, because a game that
    // ended early is an observation like any other.
    let matched = intervening
        .iter()
        .zip(&plan.picks)
        .filter(|(pick, (seat, vertex))| pick.seat == *seat && pick.vertex == *vertex)
        .count() as u32;
    let intervening = intervening.len() as u32;
    Some(LookaheadReading {
        seat: first.seat,
        intervening,
        matched,
        sequence_exact: matched == intervening && plan.picks.len() == intervening as usize,
        second_matched: plan.second == Some(picks[index + 1 + second].vertex),
    })
}

/// The M-61 reading over one group of first picks: the whole run, or one draft slot of it.
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LookaheadGroup {
    /// `null` on the overall row; the picking seat's index, which is its draft slot, otherwise.
    pub slot: Option<usize>,
    pub first_picks: usize,
    /// First picks the lookahead had something to predict, meaning at least one seat picks between
    /// the hero's two settlements. The seat picking last in the first round has none, so its
    /// sequence is exact by having nothing in it and is left out of `sequenceShare` rather than
    /// inflating it.
    pub predicting_first_picks: usize,
    pub intervening_picks: usize,
    pub matched_picks: usize,
    /// The headline share: intervening picks the lookahead named exactly, over all of them.
    pub pick_share: f64,
    pub exact_sequences: usize,
    /// Share of predicting first picks whose whole intervening sequence was named exactly, which
    /// is the share of candidates valued against the board the game actually reached.
    pub sequence_share: f64,
    pub second_matches: usize,
    /// Share of second settlements that landed on the site the lookahead planned.
    pub second_share: f64,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LookaheadAccuracy {
    pub overall: LookaheadGroup,
    pub per_slot: Vec<LookaheadGroup>,
}

pub fn lookahead_accuracy(readings: &[LookaheadReading], seats: usize) -> LookaheadAccuracy {
    LookaheadAccuracy {
        overall: group(None, readings),
        per_slot: (0..seats).map(|slot| group(Some(slot), readings)).collect(),
    }
}

/// Sum one group. Every quantity is a count, so the totals do not depend on the order the games
/// were collected in and the shares are exact ratios of them.
fn group(slot: Option<usize>, readings: &[LookaheadReading]) -> LookaheadGroup {
    let mut summed = LookaheadGroup {
        slot,
        ..LookaheadGroup::default()
    };
    for reading in readings {
        if slot.is_some_and(|slot| usize::from(reading.seat) != slot) {
            continue;
        }
        summed.first_picks += 1;
        summed.intervening_picks += reading.intervening as usize;
        summed.matched_picks += reading.matched as usize;
        if reading.intervening > 0 {
            summed.predicting_first_picks += 1;
            if reading.sequence_exact {
                summed.exact_sequences += 1;
            }
        }
        if reading.second_matched {
            summed.second_matches += 1;
        }
    }
    summed.pick_share = rate(summed.matched_picks, summed.intervening_picks);
    summed.sequence_share = rate(summed.exact_sequences, summed.predicting_first_picks);
    summed.second_share = rate(summed.second_matches, summed.first_picks);
    summed
}

fn rate(part: usize, total: usize) -> f64 {
    if total == 0 {
        0.0
    } else {
        part as f64 / total as f64
    }
}
