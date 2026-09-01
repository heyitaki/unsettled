//! SP0-D2: the two-road reach set, the zero-site case, the blockability share, and the quartile
//! split.
//!
//! The positions here are built by hand and pinned by topology id rather than by index, so what
//! each assertion expects is a fact of the fixture. The reach counts are checked twice: once
//! against a number derived from the fixture's geometry in the comment above it, and once against
//! an exhaustive search over pairs of road builds the engine's own `can_build_road` accepts,
//! which is an independent implementation of the same question.

use std::collections::BTreeSet;

use unsettled_engine::board::{ConversionOptions, SimBoard};
use unsettled_engine::game::{SetupPick, can_build_road, can_place_settlement};
use unsettled_engine::rules::RuleConfig;
use unsettled_engine::state::EMPTY;
use unsettled_engine::topology::{Edge, Hex, Layout, Topology, Vertex};
use unsettled_engine::wire::{Coord, TileKind, WireBoard, WireHex, WirePlayer, WirePort};
use unsettled_sim::expansion::{
    PairOutcome, PairReading, blockability_share, expansion_reading, game_pairs,
    reachable_expansion_sites,
};

const SEATS: usize = 4;
/// Road pieces the reference search is allowed to spend. Any value above two leaves the two-road
/// horizon, not the piece count, as the binding constraint.
const ROAD_PIECES: u8 = 15;

/// The seat's own settlement, deep enough inside the board that every vertex within three steps
/// has three neighbours. That is what makes the open-board reach count a fact of the geometry.
const SETTLEMENT: &str = "v:0,0;0,1;1,0";
/// The far end of the seat's setup road.
const ROAD_END: &str = "v:-1,1;0,0;0,1";
/// A rival settlement one step beyond the seat's road end, on the side away from its settlement.
const RIVAL_BEHIND_ROAD: &str = "v:-1,0;-1,1;0,0";
/// Four rival settlements, pairwise non-adjacent and none adjacent to the seat's own settlement,
/// placed so that every site within two road builds is either taken or neighbours a taken one.
const BOXING_RIVALS: [&str; 4] = [
    "v:-1,0;0,-1;0,0",
    "v:-1,2;0,1;0,2",
    "v:-2,1;-2,2;-1,1",
    "v:1,0;2,-1;2,0",
];

struct Position {
    topology: Topology,
    vertex_owner: Vec<u8>,
    edge_owner: Vec<u8>,
}

impl Position {
    /// The seat's single setup settlement and its road, on an otherwise empty board.
    fn open() -> Self {
        let topology = Topology::load(Layout::Standard4).unwrap();
        let mut vertex_owner = vec![EMPTY; topology.vertex_count()];
        let mut edge_owner = vec![EMPTY; topology.edge_count()];
        let settlement = vertex(&topology, SETTLEMENT);
        vertex_owner[usize::from(settlement)] = 0;
        edge_owner[usize::from(
            topology
                .edge_between(settlement, vertex(&topology, ROAD_END))
                .unwrap(),
        )] = 0;
        Self {
            topology,
            vertex_owner,
            edge_owner,
        }
    }

    fn with_rivals(mut self, rivals: &[&str]) -> Self {
        for rival in rivals {
            let target = vertex(&self.topology, rival);
            assert!(
                can_place_settlement(&self.topology, &self.vertex_owner, target),
                "the fixture must be a position a game could reach"
            );
            self.vertex_owner[usize::from(target)] = 1;
        }
        self
    }

    fn sites(&self) -> u32 {
        reachable_expansion_sites(&self.topology, &self.vertex_owner, &self.edge_owner, 0)
    }

    /// Every vertex the seat can touch by laying at most two roads, found by exhaustive search
    /// over the engine's own road legality rather than by a frontier walk.
    fn reference_reach(&self) -> BTreeSet<Vertex> {
        let mut reached = BTreeSet::new();
        for edge in 0..self.topology.edge_count() {
            if self.edge_owner[edge] == 0 {
                reached.extend(self.topology.edge_endpoints(edge as Edge));
            }
        }
        for first in 0..self.topology.edge_count() {
            let first = first as Edge;
            if !can_build_road(
                &self.topology,
                &self.vertex_owner,
                &self.edge_owner,
                0,
                first,
                ROAD_PIECES,
            ) {
                continue;
            }
            reached.extend(self.topology.edge_endpoints(first));
            let mut laid = self.edge_owner.clone();
            laid[usize::from(first)] = 0;
            for second in 0..self.topology.edge_count() {
                let second = second as Edge;
                if can_build_road(
                    &self.topology,
                    &self.vertex_owner,
                    &laid,
                    0,
                    second,
                    ROAD_PIECES,
                ) {
                    reached.extend(self.topology.edge_endpoints(second));
                }
            }
        }
        reached
    }

    fn reference_sites(&self) -> Vec<Vertex> {
        self.reference_reach()
            .into_iter()
            .filter(|target| can_place_settlement(&self.topology, &self.vertex_owner, *target))
            .collect()
    }
}

fn vertex(topology: &Topology, id: &str) -> Vertex {
    topology
        .vertex_by_id(id)
        .unwrap_or_else(|| panic!("standard4 must carry {id}"))
}

/// On an empty board the seat's settlement and its road end reach 2 vertices at distance 0, their
/// 4 remaining neighbours at distance 1, and 8 more at distance 2, all distinct because the vertex
/// graph has girth six. Of those 14, the settlement is owned and its three neighbours all touch
/// it, so the sites are the 2 distance-1 vertices behind the road end plus all 8 at distance 2.
#[test]
fn an_open_pair_reaches_every_site_within_two_road_builds() {
    let position = Position::open();
    let reach = position.reference_reach();
    assert_eq!(reach.len(), 14);
    assert!(
        reach
            .iter()
            .all(|target| position.topology.vertex_adjacent(*target).len() == 3),
        "the fixture is only interior if every vertex it reaches has three neighbours"
    );
    assert_eq!(position.sites(), 10);
    assert_eq!(position.reference_sites().len(), 10);
}

/// A road may be laid up to a rival settlement but not past it, so the rival costs the seat its
/// own vertex as a site and the two vertices behind it, which are both unreachable and neighbours
/// of an owned vertex.
#[test]
fn a_rival_settlement_stops_the_walk_at_its_own_vertex() {
    let position = Position::open().with_rivals(&[RIVAL_BEHIND_ROAD]);
    assert_eq!(position.sites(), 7);
    assert_eq!(position.reference_sites().len(), 7);
    assert!(
        position
            .reference_reach()
            .contains(&vertex(&position.topology, RIVAL_BEHIND_ROAD)),
        "the rival's own vertex is still reachable, it just cannot be built on or built past"
    );
}

#[test]
fn a_boxed_in_pair_reaches_no_expansion_site() {
    let position = Position::open().with_rivals(&BOXING_RIVALS);
    assert_eq!(position.sites(), 0);
    assert_eq!(position.reference_sites(), Vec::<Vertex>::new());
}

/// A standard4 board carrying exactly the tokens given, keyed by hex. Every hex with a token is
/// wood and every hex without one is desert, so a hex produces if and only if it is named here.
fn board_with_tokens(topology: &Topology, tokens: &[(&str, u8)]) -> SimBoard {
    let token_of = |hex: Hex| {
        let key = topology.hex_key(hex);
        tokens
            .iter()
            .find(|(named, _)| *named == key)
            .map(|(_, token)| *token)
    };
    let hexes = (0..topology.hex_count())
        .map(|hex| {
            let token = token_of(hex as Hex);
            let (q, r) = topology.hex_key(hex as Hex).split_once(',').unwrap();
            WireHex {
                coord: Coord {
                    q: q.parse().unwrap(),
                    r: r.parse().unwrap(),
                },
                tile: Some(match token {
                    Some(_) => TileKind::Wood,
                    None => TileKind::Desert,
                }),
                number_token: token.map(f64::from),
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

/// The two settlements share the hex `0,0`, so the pair touches five distinct producing hexes at
/// 5, 4, 1, 2 and 2 pips. That is 14 pips with 5 on the largest, and counting the shared hex twice
/// would make it 19 instead.
const PAIR_TOKENS: [(&str, u8); 5] = [
    ("0,0", 6),
    ("0,1", 5),
    ("1,0", 2),
    ("-1,0", 3),
    ("-1,1", 11),
];

#[test]
fn blockability_is_the_top_hex_share_over_the_distinct_hexes_of_the_pair() {
    let topology = Topology::load(Layout::Standard4).unwrap();
    let board = board_with_tokens(&topology, &PAIR_TOKENS);
    let mut vertex_owner = vec![EMPTY; topology.vertex_count()];
    vertex_owner[usize::from(vertex(&topology, SETTLEMENT))] = 0;
    vertex_owner[usize::from(vertex(&topology, RIVAL_BEHIND_ROAD))] = 0;
    assert_eq!(
        blockability_share(&board, &topology, &vertex_owner, 0),
        5.0 / 14.0
    );
}

#[test]
fn a_pair_with_no_producing_hexes_reports_no_concentration() {
    let topology = Topology::load(Layout::Standard4).unwrap();
    let board = board_with_tokens(&topology, &[]);
    let mut vertex_owner = vec![EMPTY; topology.vertex_count()];
    vertex_owner[usize::from(vertex(&topology, SETTLEMENT))] = 0;
    assert_eq!(blockability_share(&board, &topology, &vertex_owner, 0), 0.0);
}

fn setup_pick(
    topology: &Topology,
    seat: u8,
    pick: u8,
    settlement: &str,
    road_end: &str,
) -> SetupPick {
    let vertex_index = vertex(topology, settlement);
    SetupPick {
        seat,
        pick,
        grant: pick == 1,
        vertex: vertex_index,
        edge: topology
            .edge_between(vertex_index, vertex(topology, road_end))
            .unwrap(),
    }
}

/// Setup runs 0, 1, then 1, 0, so seat 1's pair completes while seat 0 still has one settlement
/// down. Seat 0's last pick lands inside seat 1's two-road reach, so reading seat 1 at the end of
/// setup instead of at its own second pick would report a smaller number.
#[test]
fn each_pair_is_read_at_its_own_second_pick_rather_than_at_the_end_of_setup() {
    let topology = Topology::load(Layout::Standard4).unwrap();
    let board = board_with_tokens(&topology, &PAIR_TOKENS);
    let picks = vec![
        setup_pick(&topology, 0, 0, SETTLEMENT, ROAD_END),
        setup_pick(&topology, 1, 0, "v:-1,-1;-1,0;0,-1", "v:-1,-1;0,-2;0,-1"),
        setup_pick(&topology, 1, 1, "v:-1,-2;-1,-1;0,-2", "v:-1,-1;0,-2;0,-1"),
        setup_pick(&topology, 0, 1, "v:-2,1;-1,0;-1,1", "v:-1,0;-1,1;0,0"),
    ];
    let mut vertex_owner = Vec::new();
    let mut edge_owner = Vec::new();
    let mut pairs = Vec::new();
    game_pairs(
        &board,
        &topology,
        &picks,
        &mut vertex_owner,
        &mut edge_owner,
        &mut pairs,
    );

    // The pairs come out in completion order, which is the reverse of the draft.
    assert_eq!(pairs.len(), 2);
    assert_eq!(pairs[0].seat, 1);
    assert_eq!(pairs[1].seat, 0);

    // The scratch arrays hold the end of setup, where seat 1 is worse off than it was when its
    // own pair completed.
    assert_eq!(
        reachable_expansion_sites(&topology, &vertex_owner, &edge_owner, 1),
        6
    );
    assert_eq!(pairs[0].expansion_sites, 8);
    assert_eq!(pairs[1].expansion_sites, 9);
    assert_eq!(
        pairs[1].blockability,
        blockability_share(&board, &topology, &vertex_owner, 0)
    );
}

fn outcome(seat: u8, expansion_sites: u32, blockability: f64, seat_won: bool) -> PairOutcome {
    PairOutcome {
        reading: PairReading {
            seat,
            expansion_sites,
            blockability,
        },
        seat_won,
    }
}

/// Eight pairs with expansion sites running 0 through 7 and blockability running the other way.
/// The quarter cuts fall on the values at sorted positions 2 and 5, so each arm holds three
/// pairs, and the three winners are exactly the three highest-site pairs.
fn opposed_pairs() -> Vec<PairOutcome> {
    (0..8_u32)
        .map(|index| {
            outcome(
                (index % 4) as u8,
                index,
                f64::from(7 - index) / 10.0,
                index >= 5,
            )
        })
        .collect()
}

#[test]
fn the_quartile_gap_contrasts_the_two_ends_of_the_value_range() {
    let reading = expansion_reading(&opposed_pairs(), SEATS);
    let boxing = &reading.overall.boxing;
    assert_eq!(reading.overall.pairs, 8);
    assert_eq!(boxing.observations, 8);
    assert_eq!(boxing.bottom_cut, 2.0);
    assert_eq!(boxing.top_cut, 5.0);
    assert_eq!(boxing.bottom.pairs, 3);
    assert_eq!(boxing.top.pairs, 3);
    assert_eq!(boxing.bottom.max, 2.0);
    assert_eq!(boxing.top.min, 5.0);
    assert_eq!(boxing.bottom.win_rate, 0.0);
    assert_eq!(boxing.top.win_rate, 1.0);
    assert_eq!(boxing.gap, 1.0);
    assert!(!boxing.degenerate);

    // Blockability runs the other way over the same eight games, so its gap is the mirror image
    // and the two magnitudes tie.
    let blockability = &reading.overall.blockability;
    assert_eq!(blockability.bottom.pairs, 3);
    assert_eq!(blockability.top.pairs, 3);
    assert_eq!(blockability.gap, -1.0);
    assert!(!reading.robber_attraction_revisit);
}

/// The same eight pairs with every expansion-site count set to the same value.
fn flat_boxing() -> Vec<PairOutcome> {
    opposed_pairs()
        .into_iter()
        .map(|pair| {
            outcome(
                pair.reading.seat,
                3,
                pair.reading.blockability,
                pair.seat_won,
            )
        })
        .collect()
}

/// A quantity taking one value cuts both arms at the same place, so the arms are the whole sample
/// and the contrast is exactly zero rather than an artifact of how the tie was broken.
#[test]
fn a_single_valued_quantity_reads_a_zero_gap_and_flags_itself() {
    let boxing = expansion_reading(&flat_boxing(), SEATS).overall.boxing;
    assert_eq!(boxing.bottom.pairs, 8);
    assert_eq!(boxing.top.pairs, 8);
    assert_eq!(boxing.gap, 0.0);
    assert!(boxing.degenerate);
}

/// The branch compares magnitudes, so it fires when blockability carries a gap that boxing has
/// flattened away, and stays quiet when the same sample is read the other way round.
#[test]
fn the_revisit_branch_fires_when_blockability_separates_more_sharply() {
    let reading = expansion_reading(&flat_boxing(), SEATS);
    assert_eq!(reading.overall.boxing.gap, 0.0);
    assert_eq!(reading.overall.blockability.gap, -1.0);
    assert!(reading.robber_attraction_revisit);

    let mirrored: Vec<PairOutcome> = flat_boxing()
        .into_iter()
        .map(|pair| {
            outcome(
                pair.reading.seat,
                (pair.reading.blockability * 10.0) as u32,
                0.25,
                pair.seat_won,
            )
        })
        .collect();
    let reading = expansion_reading(&mirrored, SEATS);
    assert_eq!(reading.overall.blockability.gap, 0.0);
    assert_eq!(reading.overall.boxing.gap, -1.0);
    assert!(!reading.robber_attraction_revisit);
}

#[test]
fn zero_site_pairs_are_counted_alongside_the_boxing_gap() {
    let pairs = vec![
        outcome(0, 0, 0.5, false),
        outcome(0, 0, 0.5, true),
        outcome(1, 4, 0.5, true),
        outcome(2, 9, 0.5, false),
    ];
    let reading = expansion_reading(&pairs, SEATS);
    assert_eq!(reading.overall.zero_site_pairs, 2);
    assert_eq!(reading.overall.zero_site_share, 0.5);

    // Per-slot rows carry the seat index and partition the overall row.
    assert_eq!(reading.per_slot.len(), SEATS);
    assert_eq!(reading.per_slot[0].slot, Some(0));
    assert_eq!(reading.per_slot[0].pairs, 2);
    assert_eq!(reading.per_slot[0].zero_site_share, 1.0);
    assert_eq!(reading.per_slot[3].pairs, 0);
    assert!(reading.per_slot[3].boxing.degenerate);
    assert_eq!(
        reading
            .per_slot
            .iter()
            .map(|slot| slot.pairs)
            .sum::<usize>(),
        reading.overall.pairs
    );
}
