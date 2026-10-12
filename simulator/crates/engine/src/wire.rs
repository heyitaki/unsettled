use std::fmt;
use std::marker::PhantomData;

use serde::de::{MapAccess, Visitor, value::MapAccessDeserializer};
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::{Map, Value};

use crate::rules::Resource;
use crate::topology::{Layout, Topology};

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Coord {
    pub q: i64,
    pub r: i64,
}

impl Coord {
    pub fn key(&self) -> String {
        format!("{},{}", self.q, self.r)
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WireHex {
    #[serde(deserialize_with = "object")]
    pub coord: Coord,
    #[serde(deserialize_with = "required_nullable")]
    pub tile: Option<TileKind>,
    #[serde(deserialize_with = "required_nullable")]
    pub number_token: Option<f64>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum TileKind {
    Wood,
    Sheep,
    Wheat,
    Brick,
    Ore,
    Desert,
}

impl TileKind {
    pub const fn resource(self) -> Option<Resource> {
        match self {
            Self::Wood => Some(Resource::Wood),
            Self::Sheep => Some(Resource::Sheep),
            Self::Wheat => Some(Resource::Wheat),
            Self::Brick => Some(Resource::Brick),
            Self::Ore => Some(Resource::Ore),
            Self::Desert => None,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WirePort {
    pub edge_id: String,
    #[serde(deserialize_with = "required_nullable")]
    pub resource: Option<Resource>,
    pub rate: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WireRoad {
    pub edge_id: String,
    pub player_id: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum BuildingTier {
    Settlement,
    City,
    SuperCity,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WireBuilding {
    pub vertex_id: String,
    pub player_id: String,
    pub tier: BuildingTier,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct WirePlayer {
    pub id: String,
    pub name: String,
    pub color: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WireBoard {
    pub schema_version: u8,
    pub layout: Layout,
    #[serde(deserialize_with = "objects")]
    pub hexes: Vec<WireHex>,
    #[serde(deserialize_with = "objects")]
    pub ports: Vec<WirePort>,
    #[serde(deserialize_with = "nullable_object")]
    pub robber: Option<Coord>,
    #[serde(deserialize_with = "objects")]
    pub roads: Vec<WireRoad>,
    #[serde(deserialize_with = "objects")]
    pub buildings: Vec<WireBuilding>,
    #[serde(deserialize_with = "objects")]
    pub players: Vec<WirePlayer>,
    #[serde(deserialize_with = "required_nullable")]
    pub me_player_id: Option<String>,
}

// Rejects the JSON array form that derived structs also accept; `presence_pass` requires objects.
pub(crate) struct Object<T>(T);

impl Object<WireBoard> {
    pub(crate) fn validated(self) -> Result<WireBoard, WireError> {
        self.0.validate()?;
        Ok(self.0)
    }
}

impl<'de, T: Deserialize<'de>> Deserialize<'de> for Object<T> {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct ObjectVisitor<T>(PhantomData<T>);

        impl<'de, T: Deserialize<'de>> Visitor<'de> for ObjectVisitor<T> {
            type Value = Object<T>;

            fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter.write_str("an object")
            }

            fn visit_map<M: MapAccess<'de>>(self, map: M) -> Result<Self::Value, M::Error> {
                T::deserialize(MapAccessDeserializer::new(map)).map(Object)
            }
        }

        deserializer.deserialize_map(ObjectVisitor(PhantomData))
    }
}

fn object<'de, D: Deserializer<'de>, T: Deserialize<'de>>(deserializer: D) -> Result<T, D::Error> {
    Object::deserialize(deserializer).map(|value| value.0)
}

fn objects<'de, D: Deserializer<'de>, T: Deserialize<'de>>(
    deserializer: D,
) -> Result<Vec<T>, D::Error> {
    Vec::<Object<T>>::deserialize(deserializer)
        .map(|values| values.into_iter().map(|value| value.0).collect())
}

fn nullable_object<'de, D: Deserializer<'de>, T: Deserialize<'de>>(
    deserializer: D,
) -> Result<Option<T>, D::Error> {
    required_nullable::<D, Object<T>>(deserializer).map(|value| value.map(|value| value.0))
}

// Identity on purpose: serde treats a missing `Option` field as `None` only when the field has no `deserialize_with`, so naming this function makes the key required.
fn required_nullable<'de, D: Deserializer<'de>, T: Deserialize<'de>>(
    deserializer: D,
) -> Result<Option<T>, D::Error> {
    Option::<T>::deserialize(deserializer)
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WireError(String);

impl WireBoard {
    pub fn parse_str(source: &str) -> Result<Self, WireError> {
        let value: Value = serde_json::from_str(source)
            .map_err(|error| WireError(format!("invalid JSON: {error}")))?;
        Self::parse_value(value)
    }

    pub fn parse_value(value: Value) -> Result<Self, WireError> {
        presence_pass(&value)?;
        let board: Self = serde_json::from_value(value)
            .map_err(|error| WireError(format!("invalid Board value: {error}")))?;
        board.validate()?;
        Ok(board)
    }

    pub fn validate(&self) -> Result<(), WireError> {
        if self.schema_version != 1 {
            return Err(WireError("unsupported schemaVersion".into()));
        }
        let topology = Topology::shared(self.layout).map_err(WireError)?;
        let mut hexes = [false; 256];
        if self.hexes.len() != topology.hex_count()
            || self.hexes.iter().any(|hex| {
                topology.hex_by_key(&hex.coord.key()).is_none_or(|hex| {
                    std::mem::replace(&mut hexes[usize::from(hex)], true)
                })
            })
        {
            return Err(WireError("hex set does not match layout".into()));
        }
        for hex in &self.hexes {
            if hex.tile == Some(TileKind::Desert) && hex.number_token.is_some() {
                return Err(WireError("desert cannot carry a number token".into()));
            }
            if let Some(number) = hex.number_token {
                if !number.is_finite()
                    || number.trunc() != number
                    || !(2.0..=12.0).contains(&number)
                    || number == 7.0
                {
                    return Err(WireError("invalid number token".into()));
                }
            }
        }
        let mut port_edges = [false; 256];
        for port in &self.ports {
            let edge = topology
                .edge_by_id(&port.edge_id)
                .ok_or_else(|| WireError(format!("unknown port edge {}", port.edge_id)))?;
            if !topology.coastal_edges().contains(&edge)
                || std::mem::replace(&mut port_edges[usize::from(edge)], true)
            {
                return Err(WireError("ports must be unique and coastal".into()));
            }
            if !port.rate.is_finite() || port.rate.trunc() != port.rate || port.rate < 2.0 {
                return Err(WireError(
                    "port rate must be an integer of at least 2".into(),
                ));
            }
        }
        if self.players.is_empty()
            || self.players.len() > 6
            || self.players.iter().enumerate().any(|(index, player)| {
                self.players[..index].iter().any(|other| other.id == player.id)
            })
        {
            return Err(WireError(
                "Board must contain one to six unique players".into(),
            ));
        }
        if self
            .me_player_id
            .as_ref()
            .is_some_and(|id| !self.players.iter().any(|player| player.id == *id))
        {
            return Err(WireError("mePlayerId is not in the roster".into()));
        }
        let mut road_edges = [false; 256];
        for road in &self.roads {
            let edge = topology
                .edge_by_id(&road.edge_id)
                .ok_or_else(|| WireError(format!("unknown road edge {}", road.edge_id)))?;
            if std::mem::replace(&mut road_edges[usize::from(edge)], true) {
                return Err(WireError("duplicate road edge".into()));
            }
            if !self.players.iter().any(|player| player.id == road.player_id) {
                return Err(WireError("unknown road owner".into()));
            }
        }
        let mut building_vertices = [false; 256];
        for building in &self.buildings {
            let vertex = topology.vertex_by_id(&building.vertex_id).ok_or_else(|| {
                WireError(format!("unknown building vertex {}", building.vertex_id))
            })?;
            if std::mem::replace(&mut building_vertices[usize::from(vertex)], true) {
                return Err(WireError("duplicate building vertex".into()));
            }
            if !self.players.iter().any(|player| player.id == building.player_id) {
                return Err(WireError("unknown building owner".into()));
            }
        }
        if let Some(robber) = &self.robber
            && topology.hex_by_key(&robber.key()).is_none()
        {
            return Err(WireError("robber is not on land".into()));
        }
        Ok(())
    }
}

impl fmt::Display for WireError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for WireError {}

fn presence_pass(value: &Value) -> Result<(), WireError> {
    let board = object_with_keys(
        value,
        &[
            "schemaVersion",
            "layout",
            "hexes",
            "ports",
            "robber",
            "roads",
            "buildings",
            "players",
            "mePlayerId",
        ],
        "board",
    )?;
    for item in array(board.get("hexes"), "hexes")? {
        let hex = object_with_keys(item, &["coord", "tile", "numberToken"], "hex")?;
        object_with_keys(required(hex, "coord")?, &["q", "r"], "coord")?;
    }
    for item in array(board.get("ports"), "ports")? {
        object_with_keys(item, &["edgeId", "resource", "rate"], "port")?;
    }
    if let Some(robber) = board.get("robber")
        && !robber.is_null()
    {
        object_with_keys(robber, &["q", "r"], "robber coord")?;
    }
    for item in array(board.get("roads"), "roads")? {
        object_with_keys(item, &["edgeId", "playerId"], "road")?;
    }
    for item in array(board.get("buildings"), "buildings")? {
        object_with_keys(item, &["vertexId", "playerId", "tier"], "building")?;
    }
    for item in array(board.get("players"), "players")? {
        object_with_keys(item, &["id", "name", "color"], "player")?;
    }
    Ok(())
}

fn object_with_keys<'a>(
    value: &'a Value,
    expected: &[&str],
    kind: &str,
) -> Result<&'a Map<String, Value>, WireError> {
    let object = value
        .as_object()
        .ok_or_else(|| WireError(format!("{kind} must be an object")))?;
    if object.len() != expected.len() || expected.iter().any(|key| !object.contains_key(*key)) {
        return Err(WireError(format!("{kind} does not contain the exact keys")));
    }
    Ok(object)
}

fn array<'a>(value: Option<&'a Value>, kind: &str) -> Result<&'a Vec<Value>, WireError> {
    value
        .and_then(Value::as_array)
        .ok_or_else(|| WireError(format!("{kind} must be an array")))
}

fn required<'a>(object: &'a Map<String, Value>, key: &str) -> Result<&'a Value, WireError> {
    object
        .get(key)
        .ok_or_else(|| WireError(format!("missing {key}")))
}
