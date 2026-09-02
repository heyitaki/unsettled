//! SP0-D1, the coastal-selection statistic.
//!
//! Every recorded setup pick is replayed against the board state that stood immediately before
//! it, every legal candidate is re-scored with the scorer the pick used, and the chosen vertex is
//! paired with the best-scoring unchosen candidate whose pip total is within one of its own.
//! Holding pip strength fixed that way makes hex count the only thing left to compare, so a
//! scorer with no coastal preference lands at a 50% share and 50% is the null.

use serde::Serialize;
use unsettled_engine::board::SimBoard;
use unsettled_engine::game::{SetupPick, can_place_settlement};
use unsettled_engine::placement::{PlacementKind, setup_candidate_score, vertex_production};
use unsettled_engine::state::EMPTY;
use unsettled_engine::topology::{Topology, Vertex};

use crate::stats::clustered_mean;

/// The largest pip gap that still counts as pip-matched. One pip apart is the coarsest a token
/// swap can be, so anything wider would stop holding pip strength fixed.
const PIP_TOLERANCE: u16 = 1;

/// How one recorded pick compared with its pip-matched runner-up.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PickComparison {
    /// No legal unchosen candidate sat within `PIP_TOLERANCE` of the chosen vertex's pip total.
    NoAlternative,
    /// The runner-up had the same hex count, so the pair carries no signal and is discarded.
    Tied,
    /// A usable pair. `chose_lower` is true when the chosen vertex had the lower hex count.
    Pair { chose_lower: bool },
}

/// One comparison joined to the game it came from: the board it was played on, so the interval
/// can cluster on it, and whether the picking seat went on to win.
#[derive(Clone, Copy, Debug)]
pub struct CoastalPick {
    pub board: usize,
    pub seat: u8,
    pub comparison: PickComparison,
    pub seat_won: bool,
}

/// Compare one recorded pick against the best pip-matched alternative available at `owners` and
/// `edge_owners`, the owner arrays as they stood immediately before the pick.
pub fn compare_pick(
    board: &SimBoard,
    topology: &Topology,
    placement: PlacementKind,
    owners: &[u8],
    edge_owners: &[u8],
    pick: &SetupPick,
) -> PickComparison {
    let (chosen_hexes, chosen_pips) = vertex_production(board, topology, pick.vertex);
    let mut best: Option<(f64, u8)> = None;
    for index in 0..topology.vertex_count() {
        let vertex = index as Vertex;
        if vertex == pick.vertex || !can_place_settlement(topology, owners, vertex) {
            continue;
        }
        let (hexes, candidate_pips) = vertex_production(board, topology, vertex);
        if candidate_pips.abs_diff(chosen_pips) > PIP_TOLERANCE {
            continue;
        }
        let score = setup_candidate_score(
            placement,
            board,
            topology,
            owners,
            edge_owners,
            pick.seat,
            vertex,
            pick.grant,
        );
        // Lowest vertex index wins a tie. The diagnostic ranks candidates rather than picking
        // one, so it has no RNG stream to break ties with and must not invent one, and an
        // artifact that has to be byte-identical on a repeat could not take one anyway.
        if best.is_none_or(|(best_score, _)| score > best_score) {
            best = Some((score, hexes));
        }
    }
    match best {
        None => PickComparison::NoAlternative,
        Some((_, hexes)) if hexes == chosen_hexes => PickComparison::Tied,
        Some((_, hexes)) => PickComparison::Pair {
            chose_lower: chosen_hexes < hexes,
        },
    }
}

/// Replay one game's setup picks in order, comparing each against its runner-up. `owners` and
/// `edge_owners` are reusable scratch, both replayed because a setup pick lays a road stub as
/// well as a settlement; `out` receives one comparison per pick, in pick order.
pub fn game_comparisons(
    board: &SimBoard,
    topology: &Topology,
    placement: PlacementKind,
    picks: &[SetupPick],
    owners: &mut Vec<u8>,
    edge_owners: &mut Vec<u8>,
    out: &mut Vec<PickComparison>,
) {
    owners.clear();
    owners.resize(topology.vertex_count(), EMPTY);
    edge_owners.clear();
    edge_owners.resize(topology.edge_count(), EMPTY);
    out.clear();
    for pick in picks {
        out.push(compare_pick(
            board, topology, placement, owners, edge_owners, pick,
        ));
        owners[usize::from(pick.vertex)] = pick.seat;
        edge_owners[usize::from(pick.edge)] = pick.seat;
    }
}

/// The D1 reading over one group of picks: the whole run, or one draft slot of it.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoastalGroup {
    /// `null` on the overall row; the picking seat's index, which is its draft slot, otherwise.
    pub slot: Option<usize>,
    pub picks: usize,
    pub no_alternative: usize,
    pub ties: usize,
    pub pairs: usize,
    /// The share of pairs in which the chosen vertex had the lower hex count. 50% is the null.
    pub share: f64,
    pub clustered: [f64; 2],
    pub clusters: usize,
    pub clustered_degenerate: bool,
    pub lower_hex_pairs: usize,
    pub lower_hex_wins: usize,
    pub lower_hex_win_rate: f64,
    pub higher_hex_pairs: usize,
    pub higher_hex_wins: usize,
    pub higher_hex_win_rate: f64,
    /// How much less often the picking seat won after taking the lower hex count. Positive means
    /// the coastal choice cost the seat games.
    pub win_rate_gap: f64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoastalSelection {
    pub overall: CoastalGroup,
    pub per_slot: Vec<CoastalGroup>,
    /// The preregistered SP2c gate, read off the overall row: the share must clear 50% by more
    /// than its clustered interval *and* the lower-hex-count picks must win at least one
    /// percentage point less often. Both conditions, not either.
    pub sp2c_gate_passed: bool,
}

/// How much less often, in win rate, the lower-hex-count picks must win than the higher-hex-count
/// ones for the gate's second condition to hold. It reads `win_rate_gap`, a contrast between the
/// two arms, not either arm against 50%.
const GATE_WIN_RATE_GAP: f64 = 0.01;

pub fn coastal_selection(
    picks: &[CoastalPick],
    seats: usize,
    boards: usize,
    z: f64,
) -> CoastalSelection {
    let overall = group(None, picks, boards, z);
    let per_slot = (0..seats)
        .map(|slot| group(Some(slot), picks, boards, z))
        .collect();
    let sp2c_gate_passed = overall.pairs > 0
        && !overall.clustered_degenerate
        && overall.clustered[0] > 0.5
        && overall.win_rate_gap >= GATE_WIN_RATE_GAP;
    CoastalSelection {
        overall,
        per_slot,
        sp2c_gate_passed,
    }
}

fn group(slot: Option<usize>, picks: &[CoastalPick], boards: usize, z: f64) -> CoastalGroup {
    let mut counted = CoastalGroup {
        slot,
        picks: 0,
        no_alternative: 0,
        ties: 0,
        pairs: 0,
        share: 0.0,
        clustered: [0.0, 1.0],
        clusters: 0,
        clustered_degenerate: true,
        lower_hex_pairs: 0,
        lower_hex_wins: 0,
        lower_hex_win_rate: 0.0,
        higher_hex_pairs: 0,
        higher_hex_wins: 0,
        higher_hex_win_rate: 0.0,
        win_rate_gap: 0.0,
    };
    let mut values = Vec::new();
    let mut clusters = Vec::new();
    for pick in picks {
        if slot.is_some_and(|slot| usize::from(pick.seat) != slot) {
            continue;
        }
        counted.picks += 1;
        let chose_lower = match pick.comparison {
            PickComparison::NoAlternative => {
                counted.no_alternative += 1;
                continue;
            }
            PickComparison::Tied => {
                counted.ties += 1;
                continue;
            }
            PickComparison::Pair { chose_lower } => chose_lower,
        };
        counted.pairs += 1;
        values.push(f64::from(u8::from(chose_lower)));
        clusters.push(pick.board);
        if chose_lower {
            counted.lower_hex_pairs += 1;
            counted.lower_hex_wins += usize::from(pick.seat_won);
        } else {
            counted.higher_hex_pairs += 1;
            counted.higher_hex_wins += usize::from(pick.seat_won);
        }
    }
    let interval = clustered_mean(&values, &clusters, boards, z, [0.0, 1.0]);
    counted.share = interval.mean;
    counted.clustered = interval.interval;
    counted.clusters = interval.clusters;
    counted.clustered_degenerate = interval.degenerate;
    counted.lower_hex_win_rate = rate(counted.lower_hex_wins, counted.lower_hex_pairs);
    counted.higher_hex_win_rate = rate(counted.higher_hex_wins, counted.higher_hex_pairs);
    counted.win_rate_gap = counted.higher_hex_win_rate - counted.lower_hex_win_rate;
    counted
}

fn rate(wins: usize, total: usize) -> f64 {
    if total == 0 {
        0.0
    } else {
        wins as f64 / total as f64
    }
}
