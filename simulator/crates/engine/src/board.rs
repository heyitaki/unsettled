use std::collections::HashMap;
use std::fmt;

use crate::rules::{RESOURCE_COUNT, Resource, RuleConfig};
use crate::state::MAX_VERTICES;
use crate::topology::{Edge, Hex, Layout, Topology, Vertex};
use crate::wire::{BuildingTier, TileKind, WireBoard};

/// `port_vertices` addresses vertices by bit, as the caches in `view` and `longest_road` also do.
const _: () = assert!(MAX_VERTICES <= u128::BITS as usize);

#[derive(Clone, Copy, Debug, Default)]
pub struct ConversionOptions {
    pub allow_unofficial: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ConversionError {
    LayoutMismatch,
    NullTile { hex: String },
    MissingToken { hex: String },
    NoRobberPlacement,
    OccupiedOverlap,
    UnofficialConfig { layout: Layout, seats: usize },
    UnknownOwner(String),
}

#[derive(Clone, Copy, Debug)]
pub struct SimPort {
    pub edge: Edge,
    pub resource: Option<Resource>,
    pub rate: u32,
}

#[derive(Clone, Copy, Debug)]
pub struct InitialRoad {
    pub edge: Edge,
    pub seat: u8,
}

#[derive(Clone, Copy, Debug)]
pub struct InitialBuilding {
    pub vertex: Vertex,
    pub seat: u8,
    pub tier: BuildingTier,
}

#[derive(Clone, Debug)]
pub struct SimBoard {
    layout: Layout,
    tiles: Vec<Option<Resource>>,
    tokens: Vec<Option<u8>>,
    ports: Vec<SimPort>,
    robber: Hex,
    roads: Vec<InitialRoad>,
    buildings: Vec<InitialBuilding>,
    player_ids: Vec<String>,
    saturated_rates: usize,
    /// Total pips per resource across the whole board. A fixed property of the tiles, yet the
    /// scarcity term of every vertex score wants it, so it is derived once here.
    resource_pips: [u16; RESOURCE_COUNT],
    /// Per port, the vertices its edge touches, as a bitset aligned with `ports`. Vertex scoring
    /// asks "is this port on one of my edges" for every port at every vertex it weighs.
    port_vertices: Vec<u128>,
}

impl SimBoard {
    pub fn try_from_wire(
        wire: WireBoard,
        topology: &Topology,
        _rules: &RuleConfig,
        options: ConversionOptions,
    ) -> Result<Self, ConversionError> {
        if wire.layout != topology.layout() {
            return Err(ConversionError::LayoutMismatch);
        }
        let seats = wire.players.len();
        let official = match wire.layout {
            Layout::Standard4 => (3..=4).contains(&seats),
            Layout::Extension6 => (5..=6).contains(&seats),
        };
        if (!official && !options.allow_unofficial) || !(2..=6).contains(&seats) {
            return Err(ConversionError::UnofficialConfig {
                layout: wire.layout,
                seats,
            });
        }
        let mut tiles = vec![None; topology.hex_count()];
        let mut tokens = vec![None; topology.hex_count()];
        let mut first_desert = None;
        for item in &wire.hexes {
            let hex = topology
                .hex_by_key(&item.coord.key())
                .expect("wire validation mapped hex");
            let tile = item.tile.ok_or_else(|| ConversionError::NullTile {
                hex: item.coord.key(),
            })?;
            if tile == TileKind::Desert {
                first_desert = Some(first_desert.map_or(hex, |current: Hex| current.min(hex)));
            } else {
                let token = item
                    .number_token
                    .ok_or_else(|| ConversionError::MissingToken {
                        hex: item.coord.key(),
                    })?;
                tokens[usize::from(hex)] = Some(token as u8);
                tiles[usize::from(hex)] = tile.resource();
            }
        }
        let robber = match wire.robber {
            Some(coord) => topology
                .hex_by_key(&coord.key())
                .ok_or(ConversionError::NoRobberPlacement)?,
            None => first_desert.ok_or(ConversionError::NoRobberPlacement)?,
        };
        let players: HashMap<_, _> = wire
            .players
            .iter()
            .enumerate()
            .map(|(seat, player)| (player.id.as_str(), seat as u8))
            .collect();
        let mut saturated_rates = 0;
        let ports: Vec<SimPort> = wire
            .ports
            .iter()
            .map(|port| {
                let rate = if port.rate > f64::from(u32::MAX) {
                    saturated_rates += 1;
                    u32::MAX
                } else {
                    port.rate as u32
                };
                SimPort {
                    edge: topology
                        .edge_by_id(&port.edge_id)
                        .expect("wire validation mapped port"),
                    resource: port.resource,
                    rate,
                }
            })
            .collect();
        let roads = wire
            .roads
            .iter()
            .map(|road| {
                Ok(InitialRoad {
                    edge: topology
                        .edge_by_id(&road.edge_id)
                        .expect("wire validation mapped road"),
                    seat: *players
                        .get(road.player_id.as_str())
                        .ok_or_else(|| ConversionError::UnknownOwner(road.player_id.clone()))?,
                })
            })
            .collect::<Result<_, _>>()?;
        let buildings: Vec<InitialBuilding> = wire
            .buildings
            .iter()
            .map(|building| {
                Ok(InitialBuilding {
                    vertex: topology
                        .vertex_by_id(&building.vertex_id)
                        .expect("wire validation mapped building"),
                    seat: *players
                        .get(building.player_id.as_str())
                        .ok_or_else(|| ConversionError::UnknownOwner(building.player_id.clone()))?,
                    tier: building.tier,
                })
            })
            .collect::<Result<_, _>>()?;
        if buildings.iter().any(|building| {
            topology
                .vertex_adjacent(building.vertex)
                .iter()
                .any(|adjacent| buildings.iter().any(|other| other.vertex == *adjacent))
        }) {
            return Err(ConversionError::OccupiedOverlap);
        }
        let port_vertices = ports
            .iter()
            .map(|port| {
                topology
                    .edge_endpoints(port.edge)
                    .iter()
                    .fold(0_u128, |set, vertex| set | 1 << vertex)
            })
            .collect();
        let mut resource_pips = [0_u16; RESOURCE_COUNT];
        for (tile, token) in tiles.iter().zip(&tokens) {
            if let (Some(resource), Some(token)) = (tile, token) {
                resource_pips[resource.index()] += u16::from(crate::view::pips(*token));
            }
        }
        Ok(Self {
            layout: wire.layout,
            tiles,
            tokens,
            ports,
            robber,
            roads,
            buildings,
            player_ids: wire.players.into_iter().map(|player| player.id).collect(),
            saturated_rates,
            resource_pips,
            port_vertices,
        })
    }

    pub fn layout(&self) -> Layout {
        self.layout
    }

    pub fn seats(&self) -> usize {
        self.player_ids.len()
    }

    pub fn tiles(&self) -> &[Option<Resource>] {
        &self.tiles
    }

    pub fn tokens(&self) -> &[Option<u8>] {
        &self.tokens
    }

    pub fn ports(&self) -> &[SimPort] {
        &self.ports
    }

    pub fn robber(&self) -> Hex {
        self.robber
    }

    pub fn roads(&self) -> &[InitialRoad] {
        &self.roads
    }

    pub fn buildings(&self) -> &[InitialBuilding] {
        &self.buildings
    }

    pub fn player_ids(&self) -> &[String] {
        &self.player_ids
    }

    pub fn saturated_rates(&self) -> usize {
        self.saturated_rates
    }

    pub const fn resource_pips(&self) -> &[u16; RESOURCE_COUNT] {
        &self.resource_pips
    }

    /// The ports on edges incident to `vertex`, in the same order as [`Self::ports`].
    pub fn ports_at(&self, vertex: Vertex) -> impl Iterator<Item = &SimPort> {
        self.ports
            .iter()
            .zip(&self.port_vertices)
            .filter(move |(_, vertices)| *vertices & (1 << vertex) != 0)
            .map(|(port, _)| port)
    }
}

impl fmt::Display for ConversionError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{self:?}")
    }
}

impl std::error::Error for ConversionError {}
