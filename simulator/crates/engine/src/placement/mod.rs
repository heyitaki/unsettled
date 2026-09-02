use std::sync::Mutex;

use serde::{Deserialize, Serialize};

pub mod app_formula;
mod expansion;

use crate::board::SimBoard;
use crate::rng::Xoshiro256StarStar;
use crate::rules::{RESOURCE_COUNT, Resource};
use crate::state::EMPTY;
use crate::topology::{Edge, Topology, Vertex};
use crate::view::pips;

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PlacementKind {
    Random,
    MaxPips,
    PipDiversity,
    PipScarcity,
    PortSynergy,
    CityFocus,
    AppFormula(u8),
}

struct AppFormulaDefinition {
    name: &'static str,
    weights: app_formula::EngineWeights,
}

static APP_FORMULAS: Mutex<Vec<&'static AppFormulaDefinition>> = Mutex::new(Vec::new());

impl PlacementKind {
    pub const ALL: [Self; 6] = [
        Self::Random,
        Self::MaxPips,
        Self::PipDiversity,
        Self::PipScarcity,
        Self::PortSynergy,
        Self::CityFocus,
    ];

    pub fn parse(name: &str) -> Option<Self> {
        match name {
            "random" => Some(Self::Random),
            "max_pips" => Some(Self::MaxPips),
            "pip_diversity" => Some(Self::PipDiversity),
            "pip_scarcity" => Some(Self::PipScarcity),
            "port_synergy" => Some(Self::PortSynergy),
            "city_focus" => Some(Self::CityFocus),
            _ => None,
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            Self::Random => "random",
            Self::MaxPips => "max_pips",
            Self::PipDiversity => "pip_diversity",
            Self::PipScarcity => "pip_scarcity",
            Self::PortSynergy => "port_synergy",
            Self::CityFocus => "city_focus",
            Self::AppFormula(index) => app_formula_definition(index).name,
        }
    }
}

pub fn register_app_formula(
    name: String,
    weights: app_formula::EngineWeights,
) -> Result<PlacementKind, String> {
    let mut formulas = APP_FORMULAS
        .lock()
        .map_err(|_| "app formula registry is poisoned".to_string())?;
    let index = u8::try_from(formulas.len())
        .map_err(|_| "at most 256 app formula arms may be registered".to_string())?;
    let name = Box::leak(name.into_boxed_str());
    let definition = Box::leak(Box::new(AppFormulaDefinition { name, weights }));
    formulas.push(definition);
    Ok(PlacementKind::AppFormula(index))
}

pub fn prepare_app_formula_boards(
    boards: &mut [SimBoard],
    topology: &Topology,
    kinds: &[PlacementKind],
) {
    for kind in kinds {
        let PlacementKind::AppFormula(index) = *kind else {
            continue;
        };
        let definition = app_formula_definition(index);
        for board in &mut *boards {
            board.prepare_app_formula(index, topology, definition.weights.clone());
        }
    }
}

fn app_formula_definition(index: u8) -> &'static AppFormulaDefinition {
    APP_FORMULAS
        .lock()
        .expect("app formula registry is poisoned")
        .get(usize::from(index))
        .copied()
        .unwrap_or_else(|| panic!("app formula index {index} is not registered"))
}

pub fn choose(
    kind: PlacementKind,
    board: &SimBoard,
    topology: &Topology,
    vertex_owner: &[u8],
    edge_owner: &[u8],
    seat: u8,
    own_production: &[u16; 5],
    grant: bool,
    rng: &mut Xoshiro256StarStar,
) -> Option<(Vertex, Edge)> {
    if let PlacementKind::AppFormula(index) = kind {
        return choose_app_formula(
            index,
            board,
            topology,
            vertex_owner,
            edge_owner,
            seat,
            grant,
            rng,
        );
    }
    let mut selected = None;
    let mut selected_score = f32::NEG_INFINITY;
    let mut ties = 0_u32;
    for vertex_index in 0..topology.vertex_count() {
        let vertex = vertex_index as Vertex;
        if vertex_owner[vertex_index] != EMPTY
            || topology
                .vertex_adjacent(vertex)
                .iter()
                .any(|adjacent| vertex_owner[usize::from(*adjacent)] != EMPTY)
        {
            continue;
        }
        let score = vertex_score(kind, board, topology, vertex, own_production);
        if score > selected_score {
            selected = Some(vertex);
            selected_score = score;
            ties = 1;
        } else if score == selected_score {
            ties += 1;
            if rng.range(ties) == 0 {
                selected = Some(vertex);
            }
        }
    }
    let vertex = selected?;
    let edges = topology.vertex_edges(vertex);
    let edge = if kind == PlacementKind::Random {
        edges[rng.range(edges.len() as u32) as usize]
    } else {
        let mut selected_edge = edges[0];
        let mut selected_edge_score = f32::NEG_INFINITY;
        let mut edge_ties = 0_u32;
        for edge in edges {
            let endpoints = topology.edge_endpoints(*edge);
            let destination = if endpoints[0] == vertex {
                endpoints[1]
            } else {
                endpoints[0]
            };
            let score = vertex_score(kind, board, topology, destination, own_production);
            if score > selected_edge_score {
                selected_edge = *edge;
                selected_edge_score = score;
                edge_ties = 1;
            } else if score == selected_edge_score {
                edge_ties += 1;
                if rng.range(edge_ties) == 0 {
                    selected_edge = *edge;
                }
            }
        }
        selected_edge
    };
    Some((vertex, edge))
}

fn choose_app_formula(
    index: u8,
    board: &SimBoard,
    topology: &Topology,
    vertex_owner: &[u8],
    edge_owner: &[u8],
    seat: u8,
    grant: bool,
    rng: &mut Xoshiro256StarStar,
) -> Option<(Vertex, Edge)> {
    let name = app_formula_definition(index).name;
    let scorer = board
        .app_formula_scorer(index)
        .unwrap_or_else(|| panic!("app formula arm {name} has no prepared context for this board"));
    let mut selected = None;
    let mut selected_score = f64::NEG_INFINITY;
    let mut ties = 0_u32;
    for vertex_index in 0..topology.vertex_count() {
        let vertex = vertex_index as Vertex;
        if vertex_owner[vertex_index] != EMPTY
            || topology
                .vertex_adjacent(vertex)
                .iter()
                .any(|adjacent| vertex_owner[usize::from(*adjacent)] != EMPTY)
        {
            continue;
        }
        let score = scorer.score_for_owner(vertex_owner, edge_owner, seat, vertex, grant);
        if score > selected_score {
            selected = Some(vertex);
            selected_score = score;
            ties = 1;
        } else if score == selected_score {
            ties += 1;
            if rng.range(ties) == 0 {
                selected = Some(vertex);
            }
        }
    }
    let vertex = selected?;
    // SP3's road rule, whenever the term is switched on: the road is the first edge of the
    // cheapest path to the best site the settlement opens, which is the direction the score just
    // paid for. A boxed settlement opens nothing and has no such direction, so it falls through to
    // the far-endpoint scoring below. At weight 0 the walk is skipped outright and that scoring is
    // all there is, so the shipped formula's picks, and its whole draw on the RNG stream, are what
    // they always were.
    if let Some(edge) = scorer.expansion_road(vertex_owner, edge_owner, seat, vertex) {
        return Some((vertex, edge));
    }
    let mut selected_edge = topology.vertex_edges(vertex)[0];
    let mut selected_edge_score = f64::NEG_INFINITY;
    let mut edge_ties = 0_u32;
    for edge in topology.vertex_edges(vertex) {
        let endpoints = topology.edge_endpoints(*edge);
        let destination = if endpoints[0] == vertex {
            endpoints[1]
        } else {
            endpoints[0]
        };
        // The road points toward a future expansion site, not a settlement
        // being placed now, so setup cards do not belong in this score.
        let score = scorer.score_for_owner(vertex_owner, edge_owner, seat, destination, false);
        if score > selected_edge_score {
            selected_edge = *edge;
            selected_edge_score = score;
            edge_ties = 1;
        } else if score == selected_edge_score {
            edge_ties += 1;
            if rng.range(edge_ties) == 0 {
                selected_edge = *edge;
            }
        }
    }
    Some((vertex, selected_edge))
}

/// The producing hexes adjacent to `vertex`: those carrying both a resource and a token, which
/// are the hexes the setup grant pays on. Returns their count and their pip total, the two
/// quantities the SP0 diagnostics compare candidates on.
pub fn vertex_production(board: &SimBoard, topology: &Topology, vertex: Vertex) -> (u8, u16) {
    let mut hexes = 0_u8;
    let mut total = 0_u16;
    for hex in topology.vertex_hexes(vertex) {
        if let (Some(_), Some(token)) = (
            board.tiles()[usize::from(*hex)],
            board.tokens()[usize::from(*hex)],
        ) {
            hexes += 1;
            total += u16::from(pips(token));
        }
    }
    (hexes, total)
}

/// Production pips per resource for `seat`, summed over the hexes its buildings touch and scaled
/// by each building's tier. `vertex_tier` of `None` treats every owned vertex as a settlement,
/// which is what the setup phase holds and what a diagnostic replaying setup can assume.
pub fn production_pips(
    board: &SimBoard,
    topology: &Topology,
    vertex_owner: &[u8],
    vertex_tier: Option<&[u8]>,
    seat: u8,
) -> [u16; RESOURCE_COUNT] {
    let mut production = [0; RESOURCE_COUNT];
    for vertex_index in 0..topology.vertex_count() {
        if vertex_owner[vertex_index] != seat {
            continue;
        }
        let tier = u16::from(vertex_tier.map_or(1, |tiers| tiers[vertex_index].max(1)));
        for hex in topology.vertex_hexes(vertex_index as Vertex) {
            if let (Some(resource), Some(token)) = (
                board.tiles()[usize::from(*hex)],
                board.tokens()[usize::from(*hex)],
            ) {
                production[resource.index()] += u16::from(pips(token)) * tier;
            }
        }
    }
    production
}

/// Re-score a setup candidate exactly as `choose` ranked it at this owner array. Observation
/// only: this is `choose`'s scoring half without its random tie-break, so a diagnostic replaying
/// a recorded pick reads the same numbers the pick was made from.
pub fn setup_candidate_score(
    kind: PlacementKind,
    board: &SimBoard,
    topology: &Topology,
    vertex_owner: &[u8],
    edge_owner: &[u8],
    seat: u8,
    candidate: Vertex,
    grant: bool,
) -> f64 {
    if let PlacementKind::AppFormula(index) = kind {
        let name = app_formula_definition(index).name;
        let scorer = board.app_formula_scorer(index).unwrap_or_else(|| {
            panic!("app formula arm {name} has no prepared context for this board")
        });
        return scorer.score_for_owner(vertex_owner, edge_owner, seat, candidate, grant);
    }
    // The setup grant never reaches the other heuristics: `choose` scores them from the board and
    // the seat's own production alone.
    let production = production_pips(board, topology, vertex_owner, None, seat);
    f64::from(vertex_score(kind, board, topology, candidate, &production))
}

pub fn vertex_score(
    kind: PlacementKind,
    board: &SimBoard,
    topology: &Topology,
    vertex: Vertex,
    own_production: &[u16; 5],
) -> f32 {
    if kind == PlacementKind::Random {
        return 0.0;
    }
    let mut production = [0_u16; 5];
    let mut pips = 0_u16;
    for hex in topology.vertex_hexes(vertex) {
        if let (Some(resource), Some(token)) = (
            board.tiles()[usize::from(*hex)],
            board.tokens()[usize::from(*hex)],
        ) {
            let value = u16::from(6_u8.saturating_sub(7_u8.abs_diff(token)));
            production[resource.index()] += value;
            pips += value;
        }
    }
    let diversity = production
        .iter()
        .enumerate()
        .filter(|(index, value)| **value > 0 && own_production[*index] == 0)
        .count() as f32;
    let weighted = production
        .iter()
        .enumerate()
        .map(|(index, value)| {
            let scarcity = board
                .tiles()
                .iter()
                .zip(board.tokens())
                .filter_map(|(tile, token)| {
                    (*tile == Some(Resource::ALL[index])).then_some(
                        token.map_or(0, |number| 6_u8.saturating_sub(7_u8.abs_diff(number))),
                    )
                })
                .map(u16::from)
                .sum::<u16>()
                .max(1);
            f32::from(*value) * 30.0 / f32::from(scarcity)
        })
        .sum::<f32>();
    let city =
        f32::from(production[Resource::Wheat.index()] * 2 + production[Resource::Ore.index()] * 3);
    let port = board
        .ports_at(vertex)
        .map(|candidate| {
            let rate = candidate.rate.max(2) as f32;
            match candidate.resource {
                Some(resource) => (2.0 + f32::from(production[resource.index()]) * 0.2) / rate,
                None => 3.0 / rate,
            }
        })
        .sum::<f32>();
    match kind {
        PlacementKind::Random => 0.0,
        PlacementKind::MaxPips => f32::from(pips),
        PlacementKind::PipDiversity => f32::from(pips) + diversity * 1.8,
        PlacementKind::PipScarcity => f32::from(pips) + weighted * 0.7 + diversity * 0.4,
        PlacementKind::PortSynergy => f32::from(pips) + port + diversity,
        PlacementKind::CityFocus => f32::from(pips) + city * 0.01,
        PlacementKind::AppFormula(_) => unreachable!("app formula uses its f64 scorer"),
    }
}
