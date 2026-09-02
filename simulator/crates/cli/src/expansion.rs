//! SP0-D2, expansion boxing and blockability.
//!
//! Both quantities are read at the moment a seat's second setup settlement goes down, which is
//! when its pair is complete and before any of its own play can change it. Reading them later
//! would fold the policy's whole game into a number the placement scorer is supposed to answer
//! for on its own.
//!
//! **Boxing** counts the legal expansion sites the pair can reach by adding at most two roads to
//! its own road network. **Blockability** is the share of the pair's pips sitting on its single
//! highest-pip hex, which is what a robber has to take away to hurt it most.
//!
//! Each is joined to the game's outcome through the same construction: the top quarter's win
//! rate minus the bottom quarter's. Identical construction is what lets the two magnitudes be
//! compared, which is the whole point of the `robberAttractionRevisit` branch.
//!
//! Blockability is also read a second time, stratified by how many distinct producing hexes the
//! pair touches. A pair on few hexes concentrates its pips by arithmetic, so the pooled gap cannot
//! tell concentration apart from hex count; the stratified table holds that count fixed and asks
//! whether concentration still costs wins inside a stratum.

use std::collections::BTreeMap;

use serde::Serialize;
use unsettled_engine::board::SimBoard;
use unsettled_engine::game::{SetupPick, can_place_settlement};
use unsettled_engine::state::EMPTY;
use unsettled_engine::topology::{Edge, Topology, Vertex};
use unsettled_engine::view::pips;

/// How many roads a pair may lay for the boxing count. Two is what a single build turn's wood and
/// brick buys, so it is the horizon a fresh pair actually plans over.
const BOXING_ROADS: usize = 2;

/// Pairs a hex-count stratum must hold before its gap counts toward the concentration decision.
/// Below the floor a quartile gap is noise, and a run has many thin strata at the ends of the
/// hex-count range.
const CONCENTRATION_STRATUM_PAIRS: usize = 1000;

/// The most the pair-count-weighted mean gap may be for the concentration term to be indicated, as
/// a win-rate difference: 3 percentage points against the concentrated end.
const CONCENTRATION_MEAN_GAP: f64 = -0.03;

/// The SP0-D2 quantities for one seat's completed pair, plus the hex count the stratified
/// blockability reading controls for.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PairReading {
    pub seat: u8,
    /// Legal expansion sites the pair reaches within `BOXING_ROADS` road builds.
    pub expansion_sites: u32,
    /// Share of the pair's total pips carried by its single highest-pip hex, or 0 with no
    /// producing hexes.
    pub blockability: f64,
    /// Distinct producing hexes the pair touches, which is the quantity the stratified
    /// blockability reading controls for.
    pub producing_hexes: u32,
}

/// One reading joined to the game it came from.
#[derive(Clone, Copy, Debug)]
pub struct PairOutcome {
    pub reading: PairReading,
    pub seat_won: bool,
}

/// Legal expansion sites the seat reaches by adding at most `BOXING_ROADS` roads to its own road
/// network, counting distances 0, 1 and 2.
///
/// A site is what `policy::frontier::opened` treats as an expansion target and what
/// `can_place_settlement` accepts: a vertex nobody owns whose neighbours nobody owns. The walk
/// differs from `opened` only in where it starts: from every vertex the seat's roads already
/// touch rather than from one candidate vertex.
///
/// Road legality is `can_build_road`'s: a road needs an unowned edge, and continuing past a
/// vertex needs that vertex to be the seat's own or nobody's, because a rival settlement stops a
/// road network dead even though a road may still be laid up to it.
pub fn reachable_expansion_sites(
    topology: &Topology,
    vertex_owner: &[u8],
    edge_owner: &[u8],
    seat: u8,
) -> u32 {
    // Distance 0: every vertex the seat's existing roads touch. A vertex bitmask matches the
    // engine's own `own_roads` summary and keeps the walk allocation-free. `extension6`, the
    // widest layout, has 80 vertices; a wider one would shift past the mask's end, which is a
    // silent wrong answer in release rather than a panic.
    debug_assert!(
        topology.vertex_count() <= 128,
        "the reach walk's vertex bitmask is 128 bits wide"
    );
    let mut reached = 0_u128;
    for edge in 0..topology.edge_count() {
        if edge_owner[edge] == seat {
            for vertex in topology.edge_endpoints(edge as Edge) {
                reached |= 1 << vertex;
            }
        }
    }
    let mut frontier = reached;
    for _ in 0..BOXING_ROADS {
        let mut next = 0_u128;
        for vertex in 0..topology.vertex_count() {
            if frontier & (1 << vertex) == 0 {
                continue;
            }
            let owner = vertex_owner[vertex];
            if owner != EMPTY && owner != seat {
                continue;
            }
            for &adjacent in topology.vertex_adjacent(vertex as Vertex) {
                let Some(edge) = topology.edge_between(vertex as Vertex, adjacent) else {
                    continue;
                };
                if edge_owner[usize::from(edge)] != EMPTY || reached & (1 << adjacent) != 0 {
                    continue;
                }
                next |= 1 << adjacent;
            }
        }
        reached |= next;
        frontier = next;
    }
    (0..topology.vertex_count())
        .filter(|vertex| {
            reached & (1 << vertex) != 0
                && can_place_settlement(topology, vertex_owner, *vertex as Vertex)
        })
        .count() as u32
}

/// One pair read over the distinct hexes its settlements touch. A hex both settlements touch is
/// counted once: the robber takes it once too.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PairHexes {
    /// The share of the pair's pips sitting on its single highest-pip hex, or 0 with no producing
    /// hexes.
    pub blockability: f64,
    /// How many of those hexes produce, meaning they carry both a tile and a token. The desert and
    /// any untokened hex are touched but never blocked, so neither counts.
    pub producing: u32,
}

/// Read both hex quantities of a completed pair in one walk over the seat's settlements.
pub fn pair_hexes(
    board: &SimBoard,
    topology: &Topology,
    vertex_owner: &[u8],
    seat: u8,
) -> PairHexes {
    // `extension6` has 30 hexes; see the vertex-mask note in `reachable_expansion_sites`.
    debug_assert!(
        topology.hex_count() <= 64,
        "the producing-hex bitmask is 64 bits wide"
    );
    let mut seen = 0_u64;
    let mut total = 0_u16;
    let mut highest = 0_u16;
    let mut producing = 0_u32;
    for vertex in 0..topology.vertex_count() {
        if vertex_owner[vertex] != seat {
            continue;
        }
        for hex in topology.vertex_hexes(vertex as Vertex) {
            let index = usize::from(*hex);
            if seen & (1 << index) != 0 {
                continue;
            }
            seen |= 1 << index;
            if let (Some(_), Some(token)) = (board.tiles()[index], board.tokens()[index]) {
                let hex_pips = u16::from(pips(token));
                total += hex_pips;
                highest = highest.max(hex_pips);
                producing += 1;
            }
        }
    }
    PairHexes {
        blockability: if total == 0 {
            0.0
        } else {
            f64::from(highest) / f64::from(total)
        },
        producing,
    }
}

/// Replay one game's setup picks in order, reading both quantities the moment each seat's second
/// pick lands. `vertex_owner` and `edge_owner` are reusable scratch; `out` receives one reading
/// per completed pair, in the order the pairs completed.
pub fn game_pairs(
    board: &SimBoard,
    topology: &Topology,
    picks: &[SetupPick],
    vertex_owner: &mut Vec<u8>,
    edge_owner: &mut Vec<u8>,
    out: &mut Vec<PairReading>,
) {
    vertex_owner.clear();
    vertex_owner.resize(topology.vertex_count(), EMPTY);
    edge_owner.clear();
    edge_owner.resize(topology.edge_count(), EMPTY);
    out.clear();
    for pick in picks {
        vertex_owner[usize::from(pick.vertex)] = pick.seat;
        edge_owner[usize::from(pick.edge)] = pick.seat;
        if pick.pick != 1 {
            continue;
        }
        let hexes = pair_hexes(board, topology, vertex_owner, pick.seat);
        out.push(PairReading {
            seat: pick.seat,
            expansion_sites: reachable_expansion_sites(
                topology,
                vertex_owner,
                edge_owner,
                pick.seat,
            ),
            blockability: hexes.blockability,
            producing_hexes: hexes.producing,
        });
    }
}

/// One arm of a quantity's split, summarized over the pairs it holds.
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuartileArm {
    pub pairs: usize,
    pub wins: usize,
    pub win_rate: f64,
    pub mean: f64,
    pub min: f64,
    pub max: f64,
}

/// A quantity's outcome contrast: the top quarter's win rate minus the bottom quarter's.
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuartileGap {
    pub observations: usize,
    /// The quarter cut values the two arms are defined by.
    pub bottom_cut: f64,
    pub top_cut: f64,
    pub bottom: QuartileArm,
    pub top: QuartileArm,
    pub gap: f64,
    /// True when the two cuts coincide, so the arms overlap and the contrast separates nothing.
    pub degenerate: bool,
}

/// One hex-count stratum of the stratified blockability reading.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HexCountStratum {
    /// Distinct producing hexes every pair in this stratum touches.
    pub producing_hexes: u32,
    pub pairs: usize,
    /// True when the stratum reached `CONCENTRATION_STRATUM_PAIRS`, which is what makes it part of
    /// the weighted mean and of the sign test.
    pub counted: bool,
    pub blockability: QuartileGap,
}

/// Blockability read within hex-count strata, and the preregistered condition read off it.
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockabilityByHexCount {
    /// One row per hex count present, ascending, so the table's order is a fact of the data rather
    /// than of the worker count.
    pub strata: Vec<HexCountStratum>,
    /// Pairs held by the counted strata, which is what the mean below is weighted over.
    pub counted_pairs: usize,
    /// The counted strata's gaps averaged by pair count, 0 when no stratum is counted. A
    /// degenerate stratum contributes 0: its two arms overlap, so its gap contrasts a set with a
    /// superset of itself and is an artifact rather than a magnitude, exactly as
    /// `robber_attraction_revisit` treats one.
    pub weighted_mean_gap: f64,
    /// The preregistered condition, read off the overall row: the weighted mean is at most 3
    /// percentage points against concentration *and* every counted stratum's gap is negative. The
    /// mean guards magnitude, the sign test guards against one stratum carrying the whole reading.
    /// The per-slot rows carry the same boolean computed over their own pairs and are record-only.
    pub concentration_term_indicated: bool,
}

/// The D2 reading over one group of pairs: the whole run, or one draft slot of it.
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExpansionGroup {
    /// `null` on the overall row; the picking seat's index, which is its draft slot, otherwise.
    pub slot: Option<usize>,
    pub pairs: usize,
    pub zero_site_pairs: usize,
    /// How often a completed pair reaches no expansion site at all, which is the extreme the
    /// boxing gap averages over.
    pub zero_site_share: f64,
    pub boxing: QuartileGap,
    pub blockability: QuartileGap,
    pub blockability_by_hex_count: BlockabilityByHexCount,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExpansionReading {
    pub overall: ExpansionGroup,
    pub per_slot: Vec<ExpansionGroup>,
    /// The preregistered branch, read off the overall row: the robber-attraction term SP3 dropped
    /// is worth revisiting when concentration separates outcomes more sharply than expansion room
    /// does. A degenerate quantity counts as separating nothing, which is what it means: its two
    /// arms overlap, so its `gap` contrasts a set with a superset of itself and is an artifact
    /// rather than a magnitude the branch may compare against.
    pub robber_attraction_revisit: bool,
}

pub fn expansion_reading(pairs: &[PairOutcome], seats: usize) -> ExpansionReading {
    let overall = group(None, pairs);
    let per_slot = (0..seats).map(|slot| group(Some(slot), pairs)).collect();
    let separation = |quartile: &QuartileGap| {
        if quartile.degenerate {
            0.0
        } else {
            quartile.gap.abs()
        }
    };
    let robber_attraction_revisit =
        separation(&overall.blockability) > separation(&overall.boxing);
    ExpansionReading {
        overall,
        per_slot,
        robber_attraction_revisit,
    }
}

fn group(slot: Option<usize>, pairs: &[PairOutcome]) -> ExpansionGroup {
    let mut boxing = Vec::new();
    let mut blockability = Vec::new();
    let mut by_hex_count: BTreeMap<u32, Vec<(f64, bool)>> = BTreeMap::new();
    let mut zero_site_pairs = 0;
    for pair in pairs {
        if slot.is_some_and(|slot| usize::from(pair.reading.seat) != slot) {
            continue;
        }
        if pair.reading.expansion_sites == 0 {
            zero_site_pairs += 1;
        }
        boxing.push((f64::from(pair.reading.expansion_sites), pair.seat_won));
        blockability.push((pair.reading.blockability, pair.seat_won));
        by_hex_count
            .entry(pair.reading.producing_hexes)
            .or_default()
            .push((pair.reading.blockability, pair.seat_won));
    }
    let counted = boxing.len();
    ExpansionGroup {
        slot,
        pairs: counted,
        zero_site_pairs,
        zero_site_share: rate(zero_site_pairs, counted),
        boxing: quartile_gap(boxing),
        blockability: quartile_gap(blockability),
        blockability_by_hex_count: blockability_by_hex_count(by_hex_count),
    }
}

/// Contrast blockability inside each hex-count stratum and read the preregistered condition off
/// the result.
///
/// A `BTreeMap` rather than a hash: the strata are summed and serialized in ascending hex-count
/// order, so neither the weighted mean nor the artifact depends on insertion order.
fn blockability_by_hex_count(samples: BTreeMap<u32, Vec<(f64, bool)>>) -> BlockabilityByHexCount {
    let strata: Vec<HexCountStratum> = samples
        .into_iter()
        .map(|(producing_hexes, sample)| HexCountStratum {
            producing_hexes,
            pairs: sample.len(),
            counted: sample.len() >= CONCENTRATION_STRATUM_PAIRS,
            blockability: quartile_gap(sample),
        })
        .collect();
    let counted = || strata.iter().filter(|stratum| stratum.counted);
    let counted_pairs: usize = counted().map(|stratum| stratum.pairs).sum();
    let weighted: f64 = counted()
        .map(|stratum| stratum.pairs as f64 * counted_gap(&stratum.blockability))
        .sum();
    let weighted_mean_gap = if counted_pairs == 0 {
        0.0
    } else {
        weighted / counted_pairs as f64
    };
    let concentration_term_indicated = counted_pairs > 0
        && weighted_mean_gap <= CONCENTRATION_MEAN_GAP
        && counted().all(|stratum| counted_gap(&stratum.blockability) < 0.0);
    BlockabilityByHexCount {
        strata,
        counted_pairs,
        weighted_mean_gap,
        concentration_term_indicated,
    }
}

/// The gap a stratum contributes to the condition. A degenerate split separates nothing, so it
/// contributes 0 and, being no longer negative, also fails the sign test rather than passing it on
/// an artifact.
fn counted_gap(quartile: &QuartileGap) -> f64 {
    if quartile.degenerate {
        0.0
    } else {
        quartile.gap
    }
}

/// Split a sample at its quarter values and contrast the two ends' win rates.
///
/// The arms are cut at values rather than at ranks: everything at or below the lower quarter
/// value against everything at or above the upper one. A rank cut would have to split the run of
/// equal values that straddles the boundary, and the only order available to split it by is the
/// order the pairs were observed in, which runs seat by seat within each game and so would let a
/// draft-slot effect leak into the contrast. Value cuts make the arms uneven instead, which costs
/// nothing here because both quantities are cut the same way and only their two gaps are compared.
///
/// Sorting by value fixes the summation order the arm means accumulate in, and equal values sum
/// alike however the sort orders them, so the result does not depend on the worker count.
fn quartile_gap(mut sample: Vec<(f64, bool)>) -> QuartileGap {
    let observations = sample.len();
    if observations == 0 {
        return QuartileGap {
            degenerate: true,
            ..QuartileGap::default()
        };
    }
    sample.sort_by(|left, right| left.0.total_cmp(&right.0));
    let bottom_cut = sample[observations / 4].0;
    let top_cut = sample[observations - 1 - observations / 4].0;
    let bottom_end = sample.partition_point(|(value, _)| *value <= bottom_cut);
    let top_start = sample.partition_point(|(value, _)| *value < top_cut);
    let bottom = arm(&sample[..bottom_end]);
    let top = arm(&sample[top_start..]);
    QuartileGap {
        observations,
        bottom_cut,
        top_cut,
        gap: top.win_rate - bottom.win_rate,
        bottom,
        top,
        degenerate: bottom_cut >= top_cut,
    }
}

/// Summarize one quarter. `sample` must be sorted ascending, which is where `min` and `max` come
/// from and what pins the summation order the mean is accumulated in.
fn arm(sample: &[(f64, bool)]) -> QuartileArm {
    let pairs = sample.len();
    let wins = sample.iter().filter(|(_, won)| *won).count();
    let total: f64 = sample.iter().map(|(value, _)| *value).sum();
    QuartileArm {
        pairs,
        wins,
        win_rate: rate(wins, pairs),
        mean: if pairs == 0 {
            0.0
        } else {
            total / pairs as f64
        },
        min: sample.first().map_or(0.0, |(value, _)| *value),
        max: sample.last().map_or(0.0, |(value, _)| *value),
    }
}

fn rate(part: usize, total: usize) -> f64 {
    if total == 0 {
        0.0
    } else {
        part as f64 / total as f64
    }
}
