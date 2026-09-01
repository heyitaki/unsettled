//! SP0-D1: the pip-matched pair construction, the tie discard, and the preregistered SP2c gate.
//!
//! The board here is built by hand rather than generated, so every candidate's hex count and pip
//! total is known in advance and the runner-up each pick should draw is a fact of the fixture
//! rather than a restatement of the code under test.

use unsettled_engine::board::{ConversionOptions, SimBoard};
use unsettled_engine::game::{SetupPick, can_place_settlement};
use unsettled_engine::placement::{PlacementKind, vertex_production};
use unsettled_engine::rules::RuleConfig;
use unsettled_engine::state::EMPTY;
use unsettled_engine::topology::{Hex, Layout, Topology, Vertex};
use unsettled_engine::wire::{Coord, TileKind, WireBoard, WireHex, WirePlayer, WirePort};
use unsettled_sim::coastal::{
    CoastalPick, PickComparison, coastal_selection, compare_pick, game_comparisons,
};
use unsettled_sim::stats::clustered_mean;

const SEATS: usize = 4;
/// The z the diagnostic uses at its default alpha of 0.05.
const Z: f64 = 1.959_963_984_540_054;

/// A standard4 board carrying exactly the tokens given: every hex with a token is wood, every hex
/// without one is desert and produces nothing.
fn board_with_tokens(topology: &Topology, tokens: &[Option<u8>]) -> SimBoard {
    let hexes = (0..topology.hex_count())
        .map(|hex| {
            let (q, r) = topology.hex_key(hex as Hex).split_once(',').unwrap();
            WireHex {
                coord: Coord {
                    q: q.parse().unwrap(),
                    r: r.parse().unwrap(),
                },
                tile: Some(match tokens[hex] {
                    Some(_) => TileKind::Wood,
                    None => TileKind::Desert,
                }),
                number_token: tokens[hex].map(f64::from),
            }
        })
        .collect();
    let ports = topology
        .default_port_edges()
        .iter()
        .map(|edge| WirePort {
            edge_id: topology.edge_id(*edge).to_string(),
            resource: None,
            rate: 3.0,
        })
        .collect();
    let players = (0..SEATS)
        .map(|seat| WirePlayer {
            id: format!("p{seat}"),
            name: format!("P{seat}"),
            color: "#c23f38".to_string(),
        })
        .collect();
    let wire = WireBoard {
        schema_version: 1,
        layout: Layout::Standard4,
        hexes,
        ports,
        robber: None,
        roads: Vec::new(),
        buildings: Vec::new(),
        players,
        me_player_id: None,
    };
    wire.validate().unwrap();
    SimBoard::try_from_wire(
        wire,
        topology,
        &RuleConfig::base(Layout::Standard4),
        ConversionOptions::default(),
    )
    .unwrap()
}

/// A coastal vertex on two hexes and an interior vertex on three, chosen so that no hex of one is
/// a hex or a hex-neighbour of the other. Keeping the two neighbourhoods apart is what makes the
/// fixture's pip totals exhaustive: no third vertex can touch hexes from both sides.
fn isolated_pair(topology: &Topology) -> (Vertex, [Hex; 2], Vertex, [Hex; 3]) {
    let neighbourhood = |hexes: &[Hex]| {
        let mut all: Vec<Hex> = hexes.to_vec();
        for hex in hexes {
            all.extend_from_slice(topology.hex_neighbors(*hex));
        }
        all
    };
    for coastal in 0..topology.vertex_count() as Vertex {
        let coastal_hexes = topology.vertex_hexes(coastal);
        if coastal_hexes.len() != 2 {
            continue;
        }
        let coastal_zone = neighbourhood(coastal_hexes);
        for interior in 0..topology.vertex_count() as Vertex {
            let interior_hexes = topology.vertex_hexes(interior);
            if interior_hexes.len() != 3
                || topology.vertex_adjacent(coastal).contains(&interior)
                || interior_hexes.iter().any(|hex| coastal_zone.contains(hex))
            {
                continue;
            }
            return (
                coastal,
                [coastal_hexes[0], coastal_hexes[1]],
                interior,
                [interior_hexes[0], interior_hexes[1], interior_hexes[2]],
            );
        }
    }
    panic!("standard4 must contain a coastal vertex isolated from some interior vertex");
}

struct Fixture {
    topology: Topology,
    board: SimBoard,
    coastal: Vertex,
    interior: Vertex,
}

/// The coastal vertex sits on two 5-pip hexes for 10 pips over 2 hexes. The interior vertex sits
/// on two 5-pip hexes and one 1-pip hex for 11 pips over 3 hexes, so it is pip-matched with the
/// coastal vertex and outscores it under `max_pips`. `interior_pip` turns the third interior hex
/// up to 5 pips, which lifts the interior vertex to 15 and takes it out of the matched band.
fn fixture(interior_pip_token: u8) -> Fixture {
    let topology = Topology::load(Layout::Standard4).unwrap();
    let (coastal, coastal_hexes, interior, interior_hexes) = isolated_pair(&topology);
    let mut tokens = vec![None; topology.hex_count()];
    for hex in coastal_hexes {
        tokens[usize::from(hex)] = Some(6);
    }
    tokens[usize::from(interior_hexes[0])] = Some(6);
    tokens[usize::from(interior_hexes[1])] = Some(6);
    tokens[usize::from(interior_hexes[2])] = Some(interior_pip_token);
    let board = board_with_tokens(&topology, &tokens);
    Fixture {
        topology,
        board,
        coastal,
        interior,
    }
}

fn pick(vertex: Vertex, seat: u8) -> SetupPick {
    SetupPick {
        seat,
        pick: 0,
        grant: false,
        vertex,
        edge: topology_edge(vertex),
    }
}

/// Any incident edge: SP0-D1 never reads the road, so the fixture takes the first one.
fn topology_edge(vertex: Vertex) -> u8 {
    let topology = Topology::load(Layout::Standard4).unwrap();
    topology.vertex_edges(vertex)[0]
}

#[test]
fn the_fixture_carries_the_pip_totals_the_pairs_are_built_from() {
    let fixture = fixture(12);
    let coastal = vertex_production(&fixture.board, &fixture.topology, fixture.coastal);
    let interior = vertex_production(&fixture.board, &fixture.topology, fixture.interior);
    assert_eq!(coastal, (2, 10));
    assert_eq!(interior, (3, 11));
}

#[test]
fn a_pip_matched_runner_up_with_more_hexes_records_the_coastal_choice() {
    let fixture = fixture(12);
    let owners = vec![EMPTY; fixture.topology.vertex_count()];
    assert_eq!(
        compare_pick(
            &fixture.board,
            &fixture.topology,
            PlacementKind::MaxPips,
            &owners,
            &pick(fixture.coastal, 0),
        ),
        PickComparison::Pair { chose_lower: true }
    );
}

#[test]
fn the_same_fixture_read_from_the_interior_vertex_records_the_opposite_choice() {
    let fixture = fixture(12);
    let owners = vec![EMPTY; fixture.topology.vertex_count()];
    assert_eq!(
        compare_pick(
            &fixture.board,
            &fixture.topology,
            PlacementKind::MaxPips,
            &owners,
            &pick(fixture.interior, 0),
        ),
        PickComparison::Pair { chose_lower: false }
    );
}

/// With the third interior hex lifted to 5 pips the interior vertex reaches 15 and leaves the
/// matched band, so every remaining pip-matched candidate is another two-hex vertex at 10.
#[test]
fn an_equal_hex_count_runner_up_is_discarded_as_a_tie() {
    let fixture = fixture(6);
    let owners = vec![EMPTY; fixture.topology.vertex_count()];
    assert_eq!(
        vertex_production(&fixture.board, &fixture.topology, fixture.interior),
        (3, 15)
    );
    assert_eq!(
        compare_pick(
            &fixture.board,
            &fixture.topology,
            PlacementKind::MaxPips,
            &owners,
            &pick(fixture.coastal, 0),
        ),
        PickComparison::Tied
    );
}

#[test]
fn a_pick_with_no_legal_alternative_is_skipped() {
    let fixture = fixture(12);
    // Occupy everything two or more steps away from the coastal vertex. Its own neighbours then
    // all touch an occupied vertex, leaving it the only legal site on the board.
    let mut owners = vec![1_u8; fixture.topology.vertex_count()];
    owners[usize::from(fixture.coastal)] = EMPTY;
    for adjacent in fixture.topology.vertex_adjacent(fixture.coastal) {
        owners[usize::from(*adjacent)] = EMPTY;
    }
    let legal: Vec<Vertex> = (0..fixture.topology.vertex_count() as Vertex)
        .filter(|vertex| can_place_settlement(&fixture.topology, &owners, *vertex))
        .collect();
    assert_eq!(legal, vec![fixture.coastal]);
    assert_eq!(
        compare_pick(
            &fixture.board,
            &fixture.topology,
            PlacementKind::MaxPips,
            &owners,
            &pick(fixture.coastal, 0),
        ),
        PickComparison::NoAlternative
    );
}

/// Replaying a game applies each pick before comparing the next, so an earlier pick removes its
/// vertex and that vertex's neighbours from the later pick's candidate set.
#[test]
fn replay_applies_each_pick_before_comparing_the_next() {
    let fixture = fixture(12);
    let picks = vec![pick(fixture.interior, 0), pick(fixture.coastal, 1)];
    let mut owners = Vec::new();
    let mut comparisons = Vec::new();
    game_comparisons(
        &fixture.board,
        &fixture.topology,
        PlacementKind::MaxPips,
        &picks,
        &mut owners,
        &mut comparisons,
    );
    assert_eq!(owners[usize::from(fixture.interior)], 0);
    assert_eq!(owners[usize::from(fixture.coastal)], 1);
    assert_eq!(comparisons.len(), 2);
    // Seat 0 took the interior vertex first, so seat 1's coastal pick can no longer be answered
    // by that vertex and falls back to a two-hex runner-up at the same hex count.
    assert_eq!(comparisons[0], PickComparison::Pair { chose_lower: false });
    assert_eq!(comparisons[1], PickComparison::Tied);
}

fn pair(board: usize, seat: u8, chose_lower: bool, seat_won: bool) -> CoastalPick {
    CoastalPick {
        board,
        seat,
        comparison: PickComparison::Pair { chose_lower },
        seat_won,
    }
}

/// `lower` pairs chose the lower hex count and `higher` pairs did not, spread one per board so
/// the clustered interval has clusters to work with. `lower_wins` and `higher_wins` say how many
/// of each went on to win.
fn gate_picks(
    lower: usize,
    higher: usize,
    lower_wins: usize,
    higher_wins: usize,
) -> Vec<CoastalPick> {
    let mut picks = Vec::new();
    for index in 0..lower {
        picks.push(pair(picks.len(), 0, true, index < lower_wins));
    }
    for index in 0..higher {
        picks.push(pair(picks.len(), 1, false, index < higher_wins));
    }
    picks
}

#[test]
fn the_gate_needs_both_the_share_and_the_win_rate_gap() {
    let boards = 1000;
    // 90% of pairs chose the lower hex count, and those picks won 40 points less often.
    let both = gate_picks(900, 100, 360, 100);
    assert!(coastal_selection(&both, SEATS, boards, Z).sp2c_gate_passed);

    // Same share, but the lower-hex picks win only half a point less often.
    let share_only = gate_picks(900, 100, 355, 40);
    let selection = coastal_selection(&share_only, SEATS, boards, Z);
    assert!(selection.overall.clustered[0] > 0.5);
    assert!(selection.overall.win_rate_gap < 0.01);
    assert!(!selection.sp2c_gate_passed);

    // A wide win-rate gap cannot carry a share that sits on the null.
    let gap_only = gate_picks(500, 500, 100, 400);
    let selection = coastal_selection(&gap_only, SEATS, boards, Z);
    assert!(selection.overall.clustered[0] <= 0.5);
    assert!(selection.overall.win_rate_gap >= 0.01);
    assert!(!selection.sp2c_gate_passed);
}

#[test]
fn skipped_and_tied_picks_are_counted_but_never_enter_the_share() {
    let picks = vec![
        pair(0, 0, true, true),
        pair(1, 0, false, false),
        CoastalPick {
            board: 2,
            seat: 0,
            comparison: PickComparison::Tied,
            seat_won: true,
        },
        CoastalPick {
            board: 3,
            seat: 2,
            comparison: PickComparison::NoAlternative,
            seat_won: true,
        },
    ];
    let selection = coastal_selection(&picks, SEATS, 4, Z);
    assert_eq!(selection.overall.picks, 4);
    assert_eq!(selection.overall.ties, 1);
    assert_eq!(selection.overall.no_alternative, 1);
    assert_eq!(selection.overall.pairs, 2);
    assert_eq!(selection.overall.lower_hex_chosen, 1);
    assert_eq!(selection.overall.share, 0.5);
    assert_eq!(selection.overall.lower_hex_win_rate, 1.0);
    assert_eq!(selection.overall.higher_hex_win_rate, 0.0);
    assert_eq!(selection.overall.win_rate_gap, -1.0);

    // Per-slot rows carry the picking seat's index and partition the overall row's picks.
    assert_eq!(selection.per_slot.len(), SEATS);
    assert_eq!(selection.per_slot[0].slot, Some(0));
    assert_eq!(selection.per_slot[0].picks, 3);
    assert_eq!(selection.per_slot[0].pairs, 2);
    assert_eq!(selection.per_slot[2].picks, 1);
    assert_eq!(selection.per_slot[2].no_alternative, 1);
    assert_eq!(selection.per_slot[1].picks, 0);
    assert!(selection.per_slot[1].clustered_degenerate);
    assert_eq!(
        selection
            .per_slot
            .iter()
            .map(|slot| slot.picks)
            .sum::<usize>(),
        selection.overall.picks
    );
}

/// The clustered interval the share is read at is the unbalanced generalization of the balanced
/// one `evaluate` builds. On a balanced input the two must agree.
#[test]
fn clustered_mean_matches_the_balanced_cluster_mean_variance() {
    let boards = 40;
    let per_board = 3;
    let values: Vec<f64> = (0..boards * per_board)
        .map(|index| f64::from(u8::from(index % 5 < 3)))
        .collect();
    let clusters: Vec<usize> = (0..boards * per_board)
        .map(|index| index / per_board)
        .collect();
    let result = clustered_mean(&values, &clusters, boards, Z, [0.0, 1.0]);

    let mean = values.iter().sum::<f64>() / values.len() as f64;
    let board_means: Vec<f64> = (0..boards)
        .map(|board| {
            values[board * per_board..(board + 1) * per_board]
                .iter()
                .sum::<f64>()
                / per_board as f64
        })
        .collect();
    let variance = board_means
        .iter()
        .map(|board_mean| (board_mean - mean) * (board_mean - mean))
        .sum::<f64>()
        / (boards - 1) as f64;
    let margin = Z * (variance / boards as f64).sqrt();

    assert!(!result.degenerate);
    assert_eq!(result.clusters, boards);
    assert!((result.mean - mean).abs() < 1e-12);
    assert!((result.interval[0] - (mean - margin)).abs() < 1e-12);
    assert!((result.interval[1] - (mean + margin)).abs() < 1e-12);
}

#[test]
fn a_single_cluster_leaves_the_interval_degenerate() {
    let values = vec![1.0, 0.0, 1.0];
    let clusters = vec![7, 7, 7];
    let result = clustered_mean(&values, &clusters, 40, Z, [0.0, 1.0]);
    assert!(result.degenerate);
    assert_eq!(result.clusters, 1);
    assert_eq!(result.interval, [0.0, 1.0]);
}
