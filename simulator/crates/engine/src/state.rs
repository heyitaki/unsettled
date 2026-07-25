use crate::longest_road::RoadCard;
use crate::rules::RESOURCE_COUNT;
use crate::topology::Hex;

pub const MAX_HEXES: usize = 30;
pub const MAX_VERTICES: usize = 80;
pub const MAX_EDGES: usize = 109;
pub const MAX_SEATS: usize = 6;
pub const EMPTY: u8 = u8::MAX;

impl PlayerState {
    /// Cards in hand. Clamps per resource so a negative count (which `invariants_hold` forbids)
    /// can never be cancelled out by another resource into a false "has cards" answer.
    pub fn hand_size(&self) -> u16 {
        self.resources
            .iter()
            .map(|count| u16::try_from(*count).unwrap_or(0))
            .sum()
    }
}

#[derive(Clone, Copy, Debug)]
pub struct PlayerState {
    pub resources: [i16; RESOURCE_COUNT],
    pub trade_rate: [u32; RESOURCE_COUNT],
    pub pieces: [u8; 4],
    pub playable_dev: [u8; 5],
    pub bought_dev: [u8; 5],
    pub knights_played: u8,
    pub vp_public: u8,
    pub vp_dev: u8,
    pub longest_road_len: u8,
}

impl Default for PlayerState {
    fn default() -> Self {
        Self {
            resources: [0; RESOURCE_COUNT],
            trade_rate: [4; RESOURCE_COUNT],
            pieces: [15, 5, 4, 0],
            playable_dev: [0; 5],
            bought_dev: [0; 5],
            knights_played: 0,
            vp_public: 0,
            vp_dev: 0,
            longest_road_len: 0,
        }
    }
}

#[derive(Clone, Debug)]
pub struct GameState {
    pub vertex_owner: [u8; MAX_VERTICES],
    pub vertex_tier: [u8; MAX_VERTICES],
    pub edge_owner: [u8; MAX_EDGES],
    pub players: [PlayerState; MAX_SEATS],
    pub bank: [u16; RESOURCE_COUNT],
    pub robber: Hex,
    pub longest_road: RoadCard,
    pub largest_army: Option<usize>,
    pub round: u16,
    pub current_seat: u8,
}

impl Default for GameState {
    fn default() -> Self {
        Self {
            vertex_owner: [EMPTY; MAX_VERTICES],
            vertex_tier: [0; MAX_VERTICES],
            edge_owner: [EMPTY; MAX_EDGES],
            players: [PlayerState::default(); MAX_SEATS],
            bank: [0; RESOURCE_COUNT],
            robber: 0,
            longest_road: RoadCard::default(),
            largest_army: None,
            round: 0,
            current_seat: 0,
        }
    }
}
