use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

pub type Edge = u8;
pub type Hex = u8;
pub type Vertex = u8;

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Layout {
    Standard4,
    Extension6,
}

impl Layout {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Standard4 => "standard4",
            Self::Extension6 => "extension6",
        }
    }
}

/// A vertex sits on at most three hexes, three edges and three neighbouring vertices.
const VERTEX_FANOUT: usize = 3;
/// A hex borders at most six others.
const HEX_FANOUT: usize = 6;
/// An edge shares each endpoint with at most two further edges.
const EDGE_FANOUT: usize = 4;
/// Vertex degree, which `RoadNetwork` also relies on when sizing its incidence slots.
const MAX_VERTEX_DEGREE: usize = 3;

/// A fixed-capacity list stored inline.
///
/// Board geometry bounds every one of these, and the scoring loops walk them once per vertex and
/// once per edge, so holding them here rather than in a `Vec<Vec<_>>` takes a pointer chase out of
/// the innermost iteration.
#[derive(Clone, Copy, Debug)]
struct SmallList<T, const N: usize> {
    values: [T; N],
    len: u8,
}

impl<T: Copy + Default, const N: usize> SmallList<T, N> {
    fn new(values: &[T], what: &str) -> Result<Self, String> {
        if values.len() > N {
            return Err(format!("{what} has {} members, over the {N} cap", values.len()));
        }
        let mut list = Self {
            values: [T::default(); N],
            len: values.len() as u8,
        };
        list.values[..values.len()].copy_from_slice(values);
        Ok(list)
    }

    fn as_slice(&self) -> &[T] {
        &self.values[..usize::from(self.len)]
    }
}

#[derive(Debug)]
pub struct Topology {
    layout: Layout,
    hex_keys: Vec<String>,
    vertex_ids: Vec<String>,
    edge_ids: Vec<String>,
    hex_vertices: Vec<[Vertex; 6]>,
    hex_edges: Vec<[Edge; 6]>,
    hex_neighbors: Vec<SmallList<Hex, HEX_FANOUT>>,
    vertex_hexes: Vec<SmallList<Hex, VERTEX_FANOUT>>,
    vertex_edges: Vec<SmallList<Edge, VERTEX_FANOUT>>,
    vertex_adjacent: Vec<SmallList<Vertex, VERTEX_FANOUT>>,
    edge_endpoints: Vec<[Vertex; 2]>,
    /// Edges sharing an endpoint with each edge, ascending and excluding the edge itself. The
    /// scoring passes that weigh a road and a follow-on road used to rescan the whole board for
    /// this; the answer is fixed by geometry.
    edge_neighbors: Vec<SmallList<Edge, EDGE_FANOUT>>,
    coastal_edges: Vec<Edge>,
    default_port_edges: Vec<Edge>,
    resource_counts: [u8; 6],
    token_counts: [u8; 13],
    hex_by_key: HashMap<String, Hex>,
    vertex_by_id: HashMap<String, Vertex>,
    edge_by_id: HashMap<String, Edge>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawPack {
    layout: Layout,
    hex_count: usize,
    vertex_count: usize,
    edge_count: usize,
    hex_keys: Vec<String>,
    vertex_ids: Vec<String>,
    edge_ids: Vec<String>,
    hex_vertices: Vec<Vec<String>>,
    hex_edges: Vec<Vec<String>>,
    hex_neighbors: Vec<Vec<usize>>,
    vertex_hexes: Vec<Vec<String>>,
    vertex_edges: Vec<Vec<String>>,
    vertex_adjacent: Vec<Vec<String>>,
    edge_endpoints: Vec<Vec<String>>,
    coastal_edges: Vec<String>,
    default_port_edges: Vec<String>,
    resource_counts: HashMap<String, u8>,
    token_counts: HashMap<String, u8>,
}

impl Topology {
    pub fn load(layout: Layout) -> Result<Self, String> {
        let json = match layout {
            Layout::Standard4 => include_str!("../../../topology/standard4.json"),
            Layout::Extension6 => include_str!("../../../topology/extension6.json"),
        };
        let raw: RawPack = serde_json::from_str(json).map_err(|error| error.to_string())?;
        Self::from_raw(raw)
    }

    pub const fn layout(&self) -> Layout {
        self.layout
    }

    pub fn hex_count(&self) -> usize {
        self.hex_keys.len()
    }

    pub fn vertex_count(&self) -> usize {
        self.vertex_ids.len()
    }

    pub fn edge_count(&self) -> usize {
        self.edge_ids.len()
    }

    pub fn hex_key(&self, hex: Hex) -> &str {
        &self.hex_keys[usize::from(hex)]
    }

    pub fn hex_by_key(&self, key: &str) -> Option<Hex> {
        self.hex_by_key.get(key).copied()
    }

    pub fn vertex_id(&self, vertex: Vertex) -> &str {
        &self.vertex_ids[usize::from(vertex)]
    }

    pub fn vertex_by_id(&self, id: &str) -> Option<Vertex> {
        self.vertex_by_id.get(id).copied()
    }

    pub fn edge_id(&self, edge: Edge) -> &str {
        &self.edge_ids[usize::from(edge)]
    }

    pub fn edge_by_id(&self, id: &str) -> Option<Edge> {
        self.edge_by_id.get(id).copied()
    }

    pub fn hex_vertices(&self, hex: Hex) -> &[Vertex; 6] {
        &self.hex_vertices[usize::from(hex)]
    }

    pub fn hex_edges(&self, hex: Hex) -> &[Edge; 6] {
        &self.hex_edges[usize::from(hex)]
    }

    pub fn hex_neighbors(&self, hex: Hex) -> &[Hex] {
        self.hex_neighbors[usize::from(hex)].as_slice()
    }

    pub fn vertex_hexes(&self, vertex: Vertex) -> &[Hex] {
        self.vertex_hexes[usize::from(vertex)].as_slice()
    }

    pub fn vertex_edges(&self, vertex: Vertex) -> &[Edge] {
        self.vertex_edges[usize::from(vertex)].as_slice()
    }

    pub fn vertex_adjacent(&self, vertex: Vertex) -> &[Vertex] {
        self.vertex_adjacent[usize::from(vertex)].as_slice()
    }

    pub fn edge_endpoints(&self, edge: Edge) -> [Vertex; 2] {
        self.edge_endpoints[usize::from(edge)]
    }

    /// Edges sharing an endpoint with `edge`, ascending. Iterating these is equivalent to scanning
    /// every edge and keeping the ones that touch `edge`, and preserves that scan's order.
    pub fn edge_neighbors(&self, edge: Edge) -> &[Edge] {
        self.edge_neighbors[usize::from(edge)].as_slice()
    }

    pub fn coastal_edges(&self) -> &[Edge] {
        &self.coastal_edges
    }

    pub fn default_port_edges(&self) -> &[Edge] {
        &self.default_port_edges
    }

    pub const fn resource_counts(&self) -> [u8; 6] {
        self.resource_counts
    }

    pub const fn token_counts(&self) -> [u8; 13] {
        self.token_counts
    }

    pub fn validate(&self) -> Result<(), String> {
        if self
            .edge_endpoints
            .iter()
            .any(|endpoints| endpoints[0] == endpoints[1])
        {
            return Err("edge endpoint pair is degenerate".into());
        }
        for (vertex, adjacent) in self.vertex_adjacent.iter().enumerate() {
            let adjacent = adjacent.as_slice();
            if !(2..=3).contains(&adjacent.len()) {
                return Err(format!(
                    "vertex {vertex} has off-board degree {}",
                    adjacent.len()
                ));
            }
            for other in adjacent {
                if !self
                    .vertex_adjacent(*other)
                    .contains(&(vertex as Vertex))
                {
                    return Err(format!("adjacency is asymmetric at vertex {vertex}"));
                }
            }
        }
        // Legality and scoring read vertex-edge incidence from both directions -- `edge_neighbors`
        // and `vertex_edges` one way, `RoadNetwork` and port incidence the other -- so the two must
        // agree. A pack where they drift would not fail; it would quietly stop offering some legal
        // roads and settlements. Vertex degree is checked here for the same reason: `RoadNetwork`
        // stores incidence in fixed-width slots and would otherwise panic mid-simulation.
        for (edge, endpoints) in self.edge_endpoints.iter().enumerate() {
            for vertex in endpoints {
                if !self.vertex_edges(*vertex).contains(&(edge as Edge)) {
                    return Err(format!("edge {edge} is missing from vertex {vertex}'s edges"));
                }
            }
        }
        for (vertex, edges) in self.vertex_edges.iter().enumerate() {
            if edges.as_slice().len() > MAX_VERTEX_DEGREE {
                return Err(format!("vertex {vertex} has degree above {MAX_VERTEX_DEGREE}"));
            }
            for edge in edges.as_slice() {
                if !self.edge_endpoints[usize::from(*edge)].contains(&(vertex as Vertex)) {
                    return Err(format!("vertex {vertex} claims unrelated edge {edge}"));
                }
            }
        }
        let coastal: HashSet<Edge> = self.coastal_edges.iter().copied().collect();
        if self
            .default_port_edges
            .iter()
            .any(|edge| !coastal.contains(edge))
        {
            return Err("default port is not coastal".into());
        }
        let token_total: usize = self
            .token_counts
            .iter()
            .map(|count| usize::from(*count))
            .sum();
        let deserts = usize::from(self.resource_counts[5]);
        if token_total != self.hex_count() - deserts {
            return Err("number token multiset does not match non-desert count".into());
        }
        Ok(())
    }

    fn from_raw(raw: RawPack) -> Result<Self, String> {
        if raw.layout.as_str()
            != match raw.layout {
                Layout::Standard4 => "standard4",
                Layout::Extension6 => "extension6",
            }
        {
            return Err("invalid layout".into());
        }
        if raw.hex_count != raw.hex_keys.len()
            || raw.vertex_count != raw.vertex_ids.len()
            || raw.edge_count != raw.edge_ids.len()
        {
            return Err("declared topology count mismatch".into());
        }
        let hex_by_key = index_map::<Hex>(&raw.hex_keys)?;
        let vertex_by_id = index_map::<Vertex>(&raw.vertex_ids)?;
        let edge_by_id = index_map::<Edge>(&raw.edge_ids)?;
        let map_hex = |key: &String| {
            hex_by_key
                .get(key)
                .copied()
                .ok_or_else(|| format!("unknown hex key {key}"))
        };
        let map_vertex = |id: &String| {
            vertex_by_id
                .get(id)
                .copied()
                .ok_or_else(|| format!("unknown vertex id {id}"))
        };
        let map_edge = |id: &String| {
            edge_by_id
                .get(id)
                .copied()
                .ok_or_else(|| format!("unknown edge id {id}"))
        };
        let hex_vertices = map_fixed::<Vertex, 6>(&raw.hex_vertices, map_vertex)?;
        let hex_edges = map_fixed::<Edge, 6>(&raw.hex_edges, map_edge)?;
        let edge_endpoints = map_fixed::<Vertex, 2>(&raw.edge_endpoints, map_vertex)?;
        let hex_neighbors = raw
            .hex_neighbors
            .iter()
            .map(|values| {
                let mapped = values
                    .iter()
                    .map(|value| Hex::try_from(*value).map_err(|_| "hex index overflow".to_string()))
                    .collect::<Result<Vec<_>, _>>()?;
                SmallList::new(&mapped, "hex neighbors")
            })
            .collect::<Result<Vec<_>, _>>()?;
        let vertex_hexes = map_lists(&raw.vertex_hexes, map_hex, "vertex hexes")?;
        let vertex_edges = map_lists(&raw.vertex_edges, map_edge, "vertex edges")?;
        let vertex_adjacent = map_lists(&raw.vertex_adjacent, map_vertex, "vertex adjacency")?;
        let edge_neighbors = derive_edge_neighbors(&edge_endpoints, &vertex_edges)?;
        let coastal_edges = raw
            .coastal_edges
            .iter()
            .map(map_edge)
            .collect::<Result<_, _>>()?;
        let default_port_edges = raw
            .default_port_edges
            .iter()
            .map(map_edge)
            .collect::<Result<_, _>>()?;
        let resource_counts = [
            get_count(&raw.resource_counts, "wood")?,
            get_count(&raw.resource_counts, "sheep")?,
            get_count(&raw.resource_counts, "wheat")?,
            get_count(&raw.resource_counts, "brick")?,
            get_count(&raw.resource_counts, "ore")?,
            get_count(&raw.resource_counts, "desert")?,
        ];
        let mut token_counts = [0; 13];
        for (key, count) in raw.token_counts {
            let token: usize = key.parse().map_err(|_| format!("invalid token {key}"))?;
            if token >= token_counts.len() {
                return Err(format!("invalid token {token}"));
            }
            token_counts[token] = count;
        }
        let pack = Self {
            layout: raw.layout,
            hex_keys: raw.hex_keys,
            vertex_ids: raw.vertex_ids,
            edge_ids: raw.edge_ids,
            hex_vertices,
            hex_edges,
            hex_neighbors,
            vertex_hexes,
            vertex_edges,
            vertex_adjacent,
            edge_endpoints,
            edge_neighbors,
            coastal_edges,
            default_port_edges,
            resource_counts,
            token_counts,
            hex_by_key,
            vertex_by_id,
            edge_by_id,
        };
        pack.validate()?;
        Ok(pack)
    }
}

fn get_count(counts: &HashMap<String, u8>, key: &str) -> Result<u8, String> {
    counts
        .get(key)
        .copied()
        .ok_or_else(|| format!("missing count for {key}"))
}

fn index_map<T>(ids: &[String]) -> Result<HashMap<String, T>, String>
where
    T: TryFrom<usize>,
{
    ids.iter()
        .enumerate()
        .map(|(index, id)| {
            let value = T::try_from(index).map_err(|_| "topology index overflow".to_string())?;
            Ok((id.clone(), value))
        })
        .collect()
}

fn map_fixed<T: Copy, const N: usize>(
    values: &[Vec<String>],
    map: impl Fn(&String) -> Result<T, String>,
) -> Result<Vec<[T; N]>, String> {
    values
        .iter()
        .map(|items| {
            let mapped = items.iter().map(&map).collect::<Result<Vec<_>, _>>()?;
            mapped
                .try_into()
                .map_err(|_| format!("expected {N} members"))
        })
        .collect()
}

fn map_lists<T: Copy + Default, const N: usize>(
    values: &[Vec<String>],
    map: impl Fn(&String) -> Result<T, String>,
    what: &str,
) -> Result<Vec<SmallList<T, N>>, String> {
    values
        .iter()
        .map(|items| {
            let mapped = items.iter().map(&map).collect::<Result<Vec<_>, _>>()?;
            SmallList::new(&mapped, what)
        })
        .collect()
}

fn derive_edge_neighbors(
    edge_endpoints: &[[Vertex; 2]],
    vertex_edges: &[SmallList<Edge, VERTEX_FANOUT>],
) -> Result<Vec<SmallList<Edge, EDGE_FANOUT>>, String> {
    edge_endpoints
        .iter()
        .enumerate()
        .map(|(edge, endpoints)| {
            // Derived before `validate`, so an endpoint naming a vertex the pack never declared has
            // to surface as an error rather than an index panic.
            let mut touching = Vec::new();
            for vertex in endpoints {
                let incident = vertex_edges
                    .get(usize::from(*vertex))
                    .ok_or_else(|| format!("edge {edge} names unknown vertex {vertex}"))?;
                touching.extend(
                    incident
                        .as_slice()
                        .iter()
                        .copied()
                        .filter(|other| usize::from(*other) != edge),
                );
            }
            touching.sort_unstable();
            touching.dedup();
            SmallList::new(&touching, "edge neighbors")
        })
        .collect()
}
