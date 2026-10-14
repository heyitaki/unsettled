use std::collections::VecDeque;

use crate::board::SimBoard;
use crate::rules::Resource;
use crate::topology::{Topology, Vertex};
use crate::view::pips;

pub const TERRAIN_NAMES: [&str; 4] = ["roadPips", "roadPipsMin", "spotFalloff", "topCrowding"];
pub const UNIT_COLUMNS: [&str; 10] = [
    "board", "slot", "rep", "roadPips", "roadPipsMin", "spotFalloff", "topCrowding",
    "heroReady", "readyAhead", "readyAheadTrade",
];

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TerrainFeatures {
    pub road_pips: u16,
    pub road_pips_min: u16,
    pub spot_falloff: f64,
    pub top_crowding: u16,
}

impl TerrainFeatures {
    pub fn read(topology: &Topology, tiles: &[Option<Resource>], tokens: &[Option<u8>], seats: usize) -> Self {
        let mut brick = 0_u16;
        let mut wood = 0_u16;
        for (tile, token) in tiles.iter().zip(tokens) {
            let value = token.map_or(0, |token| u16::from(pips(token)));
            match tile {
                Some(Resource::Brick) => brick += value,
                Some(Resource::Wood) => wood += value,
                _ => {}
            }
        }
        let mut vertices = (0..topology.vertex_count()).map(|vertex| {
            let value = topology.vertex_hexes(vertex as Vertex).iter().map(|hex| {
                tokens[usize::from(*hex)].map_or(0, |token| u16::from(pips(token)))
            }).sum::<u16>();
            (vertex as Vertex, value)
        }).collect::<Vec<_>>();
        vertices.sort_by(|(a, x), (b, y)| y.cmp(x).then_with(|| a.cmp(b)));
        let top = &vertices[..2 * seats];
        let mut top_crowding = 0;
        for (index, (vertex, _)) in top.iter().enumerate() {
            let distances = distances(topology, *vertex);
            for (other, _) in &top[index + 1..] {
                if matches!(distances[usize::from(*other)], 2 | 3) {
                    top_crowding += 1;
                }
            }
        }
        Self {
            road_pips: brick + wood,
            road_pips_min: brick.min(wood),
            spot_falloff: f64::from(top.last().unwrap().1) / f64::from(top[0].1),
            top_crowding,
        }
    }

    pub fn values(self) -> [f64; 4] {
        [f64::from(self.road_pips), f64::from(self.road_pips_min), self.spot_falloff,
            f64::from(self.top_crowding)]
    }
}

fn distances(topology: &Topology, start: Vertex) -> Vec<usize> {
    let mut result = vec![usize::MAX; topology.vertex_count()];
    let mut queue = VecDeque::from([start]);
    result[usize::from(start)] = 0;
    while let Some(vertex) = queue.pop_front() {
        for adjacent in topology.vertex_adjacent(vertex) {
            if result[usize::from(*adjacent)] == usize::MAX {
                result[usize::from(*adjacent)] = result[usize::from(vertex)] + 1;
                queue.push_back(*adjacent);
            }
        }
    }
    result
}

pub fn road_readiness(board: &SimBoard, topology: &Topology, vertex: Vertex) -> u8 {
    let mut cards = 0;
    let mut brick = false;
    let mut wood = false;
    for hex in topology.vertex_hexes(vertex) {
        if let Some(resource) = board.tiles()[usize::from(*hex)] {
            cards += 1;
            brick |= resource == Resource::Brick;
            wood |= resource == Resource::Wood;
        }
    }
    if brick && wood { 2 } else if (brick || wood) && cards >= 2 { 1 } else { 0 }
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct RaceReadings {
    pub hero_ready: u8,
    pub ready_ahead: u8,
    pub ready_ahead_trade: u8,
}

impl RaceReadings {
    pub fn from_levels(levels: &[u8], hero: usize) -> Self {
        Self {
            hero_ready: levels[hero],
            ready_ahead: levels[..hero].iter().filter(|level| **level == 2).count() as u8,
            ready_ahead_trade: levels[..hero].iter().filter(|level| **level >= 1).count() as u8,
        }
    }

    pub fn values(self) -> [u8; 3] {
        [self.hero_ready, self.ready_ahead, self.ready_ahead_trade]
    }
}

#[derive(Clone, Debug)]
pub struct Rule {
    predicates: Vec<Predicate>,
}

#[derive(Clone, Debug)]
struct Predicate {
    feature: usize,
    at_least: bool,
    cutoff: f64,
}

impl Rule {
    pub fn parse(text: &str) -> Result<Self, String> {
        if text == "always" {
            return Ok(Self { predicates: Vec::new() });
        }
        if text.chars().any(char::is_whitespace) {
            return Err(format!("rule {text:?} must have no spaces"));
        }
        let parts = text.split('&').collect::<Vec<_>>();
        if parts.len() > 2 {
            return Err(format!("third predicate {:?} in rule {text:?}", parts[2]));
        }
        let mut predicates = Vec::new();
        for part in parts {
            if part.is_empty() {
                return Err(format!("empty predicate {part:?} in rule {text:?}"));
            }
            let end = part.find(|c: char| !c.is_ascii_alphanumeric()).unwrap_or(part.len());
            let name = &part[..end];
            if ["heroReady", "readyAhead", "readyAheadTrade"].contains(&name) {
                return Err(format!("{name} is a diagnostic no rule may use: {part}"));
            }
            let feature = if name == "slot" { 4 } else {
                TERRAIN_NAMES.iter().position(|value| *value == name)
                    .ok_or_else(|| format!("unknown feature {name} in {part}"))?
            };
            let rest = &part[end..];
            let (at_least, number) = if let Some(number) = rest.strip_prefix(">=") {
                (true, number)
            } else if let Some(number) = rest.strip_prefix('<') {
                (false, number)
            } else {
                return Err(format!("invalid operator in {part}: expected >= or <"));
            };
            if number.starts_with(['=', '<', '>']) {
                return Err(format!("invalid operator in {part}: expected >= or <"));
            }
            let cutoff = number.parse::<f64>().ok().filter(|value| value.is_finite())
                .ok_or_else(|| format!("invalid finite number {number:?} in {part}"))?;
            predicates.push(Predicate { feature, at_least, cutoff });
        }
        Ok(Self { predicates })
    }

    pub fn matches(&self, terrain: TerrainFeatures, slot: usize) -> bool {
        self.predicates.iter().all(|predicate| {
            let value = if predicate.feature == 4 { slot as f64 } else { terrain.values()[predicate.feature] };
            if predicate.at_least { value >= predicate.cutoff } else { value < predicate.cutoff }
        })
    }

    pub fn predicate_count(&self) -> usize {
        self.predicates.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::board::ConversionOptions;
    use crate::rules::RuleConfig;
    use crate::topology::Layout;
    use crate::wire::WireBoard;

    fn fixture() -> (WireBoard, Topology) {
        let mut wire = WireBoard::parse_str(include_str!(
            "../../../../../src/parser/__tests__/expected/board-draft-empty.json"
        )).unwrap();
        wire.players.truncate(4);
        (wire, Topology::load(Layout::Extension6).unwrap())
    }

    fn board(wire: WireBoard, topology: &Topology) -> SimBoard {
        SimBoard::try_from_wire(wire, topology, &RuleConfig::base(topology.layout()),
            ConversionOptions { allow_unofficial: true }).unwrap()
    }

    #[test]
    fn terrain_features_match_hand_computed_values_on_the_empty_draft_board() {
        let (wire, topology) = fixture();

        // Brick: 3+3+2+3+2=13; wood: 5+5+4+1+4+3=22.
        // Top vertices: 29(13), 3/14/15/47(12), 1/9/21(11).
        // Distance-2 pairs: 29:14, 3:14, 3:1, 14:1. Distance-3:
        // 3:15, 15:1, 47:1, 47:9, 9:21. Thus falloff=11/13, crowding=9.
        let board = board(wire, &topology);
        assert_eq!(TerrainFeatures::read(&topology, board.tiles(), board.tokens(), board.seats()), TerrainFeatures {
            road_pips: 35, road_pips_min: 13, spot_falloff: 11.0 / 13.0, top_crowding: 9,
        });
    }

    #[test]
    fn top_crowding_counts_pairs_at_distance_two_and_three_only() {
        let (mut wire, topology) = fixture();
        wire.players.truncate(2);
        for hex in &mut wire.hexes {
            if hex.number_token.is_some() { hex.number_token = Some(2.0); }
        }
        wire.hexes[7].number_token = Some(6.0);
        wire.hexes[14].number_token = Some(6.0);
        let board = board(wire, &topology);

        // Two five-pip hexes give vertices 0, 6, 7 and 14 seven pips each.
        // Their six pair distances are 2, 1, 3, 1, 5 and 4.
        let mut ranked = (0..topology.vertex_count()).map(|vertex| {
            let total = topology.vertex_hexes(vertex as Vertex).iter()
                .map(|hex| board.tokens()[*hex as usize].map_or(0, |token| pips(token) as u16)).sum::<u16>();
            (vertex, total)
        }).collect::<Vec<_>>();
        ranked.sort_by_key(|(vertex, total)| (std::cmp::Reverse(*total), *vertex));
        assert_eq!(&ranked[..4], &[(0, 7), (6, 7), (7, 7), (14, 7)]);
        for (a, b, distance) in [(0, 6, 2), (0, 7, 1), (0, 14, 3),
            (6, 7, 1), (6, 14, 5), (7, 14, 4)] {
            assert_eq!(distances(&topology, a)[b], distance);
        }
        assert_eq!(TerrainFeatures::read(&topology, board.tiles(), board.tokens(), board.seats()).top_crowding, 2);
    }

    #[test]
    fn road_readiness_follows_the_cards_a_second_settlement_is_paid() {
        let (wire, topology) = fixture();
        let original = board(wire.clone(), &topology);
        for (vertex, expected) in [(3, 2), (1, 1), (8, 1), (5, 0), (27, 0), (0, 0)] {
            assert_eq!(road_readiness(&original, &topology, vertex), expected, "{vertex}");
        }
        let resources = topology.vertex_hexes(0).iter()
            .filter_map(|hex| original.tiles()[*hex as usize]).collect::<Vec<_>>();
        assert_eq!(resources, [Resource::Sheep, Resource::Sheep, Resource::Ore]);
        let swap = |wire: &mut WireBoard, a: usize, b: usize| {
            let (tile, token) = (wire.hexes[a].tile, wire.hexes[a].number_token);
            wire.hexes[a].tile = wire.hexes[b].tile;
            wire.hexes[a].number_token = wire.hexes[b].number_token;
            wire.hexes[b].tile = tile;
            wire.hexes[b].number_token = token;
        };
        let mut two_cards = wire.clone();
        swap(&mut two_cards, 0, 4);
        swap(&mut two_cards, 3, 9);
        assert_eq!(road_readiness(&board(two_cards, &topology), &topology, 4), 1);
        let mut desert = wire;
        swap(&mut desert, 0, 4);
        swap(&mut desert, 3, 18);
        assert_eq!(road_readiness(&board(desert, &topology), &topology, 4), 0);
    }

    #[test]
    fn ready_ahead_counts_only_seats_that_move_before_the_hero() {
        let levels = [1, 2, 0, 2];
        for (hero, expected) in [[1, 0, 0], [2, 0, 1], [0, 1, 2], [2, 1, 2]].iter().enumerate() {
            assert_eq!(RaceReadings::from_levels(&levels, hero).values(), *expected);
        }
    }
}
