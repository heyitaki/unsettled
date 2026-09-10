use serde::{Deserialize, Serialize};

use crate::topology::Layout;

pub const RESOURCE_COUNT: usize = 5;

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Resource {
    Wood,
    Sheep,
    Wheat,
    Brick,
    Ore,
}

impl Resource {
    pub const ALL: [Self; RESOURCE_COUNT] =
        [Self::Wood, Self::Sheep, Self::Wheat, Self::Brick, Self::Ore];

    pub const fn index(self) -> usize {
        match self {
            Self::Wood => 0,
            Self::Sheep => 1,
            Self::Wheat => 2,
            Self::Brick => 3,
            Self::Ore => 4,
        }
    }

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Wood => "wood",
            Self::Sheep => "sheep",
            Self::Wheat => "wheat",
            Self::Brick => "brick",
            Self::Ore => "ore",
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Buildable {
    Road,
    Settlement,
    City,
    SuperCity,
}

impl Buildable {
    pub const ALL: [Self; 4] = [Self::Road, Self::Settlement, Self::City, Self::SuperCity];

    pub const fn index(self) -> usize {
        match self {
            Self::Road => 0,
            Self::Settlement => 1,
            Self::City => 2,
            Self::SuperCity => 3,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildableSpec {
    pub kind: Buildable,
    pub costs: Vec<[u8; RESOURCE_COUNT]>,
    pub per_player_limit: u8,
    pub vp: u8,
    pub yield_multiplier: u8,
    pub upgrades_from: Option<Buildable>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DevDeckConfig {
    pub knight: u8,
    pub victory_point: u8,
    pub road_building: u8,
    pub year_of_plenty: u8,
    pub monopoly: u8,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct TradeConfig {
    pub opponent_gain_weight: f32,
    pub acceptance_temperature: f32,
    pub max_offers_per_turn: u8,
    pub hidden_vp_confidence: f64,
    /// Positive, finite turns added before ETW is inverted into embargo danger. Defaults
    /// together with the threat and trading danger floors.
    pub embargo_danger_floor: f64,
    /// Finite standing danger at or above which a seat is refused all player trades.
    pub embargo_danger: f64,
    /// Finite standing danger at or above which a seat holding an imminent Largest Army or
    /// Longest Road takeover is refused; the softer threshold exists because the ETW closed
    /// form deliberately excludes award proximity.
    pub embargo_takeover_danger: f64,
}

impl Default for TradeConfig {
    fn default() -> Self {
        // The embargo thresholds are unswept Phase-H placeholders sized to the legacy
        // VP-estimate trigger surfaces at danger floor 1.0: 0.125 is ETW <= 7 turns
        // (roughly one point from winning on endgame income), 0.0625 is ETW <= 15
        // (roughly two points out, gated on the award swing).
        Self {
            opponent_gain_weight: 1.0,
            acceptance_temperature: 0.5,
            max_offers_per_turn: 2,
            hidden_vp_confidence: 0.9,
            embargo_danger_floor: 1.0,
            embargo_danger: 0.125,
            embargo_takeover_danger: 0.0625,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuleConfig {
    pub win_vp: u8,
    pub discard_threshold: u8,
    pub bank_trade_rate: u32,
    pub bank_supply: [u16; RESOURCE_COUNT],
    pub dev_cost: [u8; RESOURCE_COUNT],
    pub dev_deck: DevDeckConfig,
    pub buildables: Vec<BuildableSpec>,
    pub special_building_phase: Option<bool>,
    pub longest_road_min: u8,
    pub longest_road_vp: u8,
    pub largest_army_min: u8,
    pub largest_army_vp: u8,
    pub turn_cap: u16,
    #[serde(default)]
    pub player_trading: Option<TradeConfig>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum PortSelector {
    All,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum PortAction {
    Disable,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct PortRule {
    pub selector: PortSelector,
    pub action: PortAction,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerModifiers {
    pub extra_cost_alternatives: Vec<(Buildable, [u8; RESOURCE_COUNT])>,
    pub bank_rate_override: Option<u32>,
    pub port_rules: Vec<PortRule>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct OwnedPort {
    pub resource: Option<Resource>,
    pub rate: u32,
}

// Two base variants plus a modifier alternative need three slots. Keep one spare slot.
const MAX_COST_ALTERNATIVES: usize = 4;

#[derive(Clone, Copy, Debug)]
pub struct CostAlternatives {
    values: [[u8; RESOURCE_COUNT]; MAX_COST_ALTERNATIVES],
    len: u8,
}

impl Default for CostAlternatives {
    fn default() -> Self {
        Self {
            values: [[0; RESOURCE_COUNT]; MAX_COST_ALTERNATIVES],
            len: 0,
        }
    }
}

impl CostAlternatives {
    pub fn as_slice(&self) -> &[[u8; RESOURCE_COUNT]] {
        &self.values[..usize::from(self.len)]
    }

    fn push(&mut self, cost: [u8; RESOURCE_COUNT]) {
        assert!(
            usize::from(self.len) < MAX_COST_ALTERNATIVES,
            "too many cost alternatives"
        );
        self.values[usize::from(self.len)] = cost;
        self.len += 1;
    }
}

#[derive(Clone, Copy, Debug, Default)]
pub struct FlattenedRules {
    costs: [CostAlternatives; 4],
    trade_rate: [u32; RESOURCE_COUNT],
    limits: [u8; 4],
    vp: [u8; 4],
    yield_multiplier: [u8; 4],
    dev_cost: [u8; RESOURCE_COUNT],
    port_rule: Option<PortRule>,
    win_vp: u8,
    longest_road_min: u8,
    longest_road_vp: u8,
    largest_army_min: u8,
    largest_army_vp: u8,
    dev_victory_points: u8,
    /// Initial dev-deck composition in `state::DEV_*` index order, so a policy can derive the
    /// remaining deck's bounds from public plays and card counts.
    dev_deck_initial: [u8; 5],
    /// Hand size above which a seven forces a discard, so a policy can price hand exposure.
    discard_threshold: u8,
    player_trading: Option<TradeConfig>,
}

impl RuleConfig {
    pub fn base(layout: Layout) -> Self {
        let extension = layout == Layout::Extension6;
        Self {
            win_vp: 10,
            discard_threshold: 7,
            bank_trade_rate: 4,
            bank_supply: [if extension { 24 } else { 19 }; RESOURCE_COUNT],
            dev_cost: [0, 1, 1, 0, 1],
            dev_deck: DevDeckConfig {
                knight: if extension { 20 } else { 14 },
                victory_point: 5,
                road_building: if extension { 3 } else { 2 },
                year_of_plenty: if extension { 3 } else { 2 },
                monopoly: if extension { 3 } else { 2 },
            },
            buildables: vec![
                BuildableSpec {
                    kind: Buildable::Road,
                    costs: vec![[1, 0, 0, 1, 0]],
                    per_player_limit: 15,
                    vp: 0,
                    yield_multiplier: 0,
                    upgrades_from: None,
                },
                BuildableSpec {
                    kind: Buildable::Settlement,
                    costs: vec![[1, 1, 1, 1, 0]],
                    per_player_limit: 5,
                    vp: 1,
                    yield_multiplier: 1,
                    upgrades_from: None,
                },
                BuildableSpec {
                    kind: Buildable::City,
                    costs: vec![[0, 0, 2, 0, 3]],
                    per_player_limit: 4,
                    vp: 2,
                    yield_multiplier: 2,
                    upgrades_from: Some(Buildable::Settlement),
                },
                BuildableSpec {
                    kind: Buildable::SuperCity,
                    costs: Vec::new(),
                    per_player_limit: 0,
                    vp: 3,
                    yield_multiplier: 3,
                    upgrades_from: Some(Buildable::City),
                },
            ],
            special_building_phase: None,
            longest_road_min: 5,
            longest_road_vp: 2,
            largest_army_min: 3,
            largest_army_vp: 2,
            turn_cap: 500,
            player_trading: None,
        }
    }

    pub fn special_building_phase(&self, seats: usize) -> bool {
        self.special_building_phase.unwrap_or(seats >= 5)
    }

    pub fn flatten(
        &self,
        modifiers: &[PlayerModifiers],
        owned_ports: &[Vec<OwnedPort>],
    ) -> Vec<FlattenedRules> {
        modifiers
            .iter()
            .enumerate()
            .map(|(seat, modifier)| {
                self.flatten_player(modifier, owned_ports.get(seat).map_or(&[], Vec::as_slice))
            })
            .collect()
    }

    pub fn flatten_player(
        &self,
        modifier: &PlayerModifiers,
        owned_ports: &[OwnedPort],
    ) -> FlattenedRules {
        self.flatten_player_with(modifier, owned_ports, &[])
    }

    /// As [`Self::flatten_player`], plus port rules contributed by something other than the
    /// player's own modifiers (currently the seat's policy; see `PolicyKind::port_rules`).
    pub fn flatten_player_with(
        &self,
        modifier: &PlayerModifiers,
        owned_ports: &[OwnedPort],
        extra_port_rules: &[PortRule],
    ) -> FlattenedRules {
        let mut flattened = FlattenedRules {
            trade_rate: [modifier.bank_rate_override.unwrap_or(self.bank_trade_rate);
                RESOURCE_COUNT],
            dev_cost: self.dev_cost,
            win_vp: self.win_vp,
            longest_road_min: self.longest_road_min,
            longest_road_vp: self.longest_road_vp,
            largest_army_min: self.largest_army_min,
            largest_army_vp: self.largest_army_vp,
            dev_victory_points: self.dev_deck.victory_point,
            dev_deck_initial: [
                self.dev_deck.knight,
                self.dev_deck.victory_point,
                self.dev_deck.road_building,
                self.dev_deck.year_of_plenty,
                self.dev_deck.monopoly,
            ],
            discard_threshold: self.discard_threshold,
            player_trading: self.player_trading,
            ..FlattenedRules::default()
        };
        for spec in &self.buildables {
            for cost in &spec.costs {
                flattened.costs[spec.kind.index()].push(*cost);
            }
            flattened.limits[spec.kind.index()] = spec.per_player_limit;
            flattened.vp[spec.kind.index()] = spec.vp;
            flattened.yield_multiplier[spec.kind.index()] = spec.yield_multiplier;
        }
        for (kind, alternative) in &modifier.extra_cost_alternatives {
            flattened.costs[kind.index()].push(*alternative);
        }
        flattened.port_rule = modifier
            .port_rules
            .iter()
            .chain(extra_port_rules)
            .next()
            .copied();
        for port in owned_ports {
            for resource in Resource::ALL {
                if (port.resource.is_none() || port.resource == Some(resource))
                    && let Some(rate) =
                        transformed_port_rate(*port, flattened.port_rule)
                {
                    flattened.trade_rate[resource.index()] =
                        flattened.trade_rate[resource.index()].min(rate);
                }
            }
        }
        flattened
    }
}

impl FlattenedRules {
    pub fn costs(&self, buildable: Buildable) -> &[[u8; RESOURCE_COUNT]] {
        self.costs[buildable.index()].as_slice()
    }

    pub const fn trade_rate(&self, resource: Resource) -> u32 {
        self.trade_rate[resource.index()]
    }

    pub const fn trade_config(&self) -> Option<TradeConfig> {
        self.player_trading
    }

    pub const fn limit(&self, buildable: Buildable) -> u8 {
        self.limits[buildable.index()]
    }

    /// Widen a piece limit to cover pieces an imported board already carries.
    ///
    /// A board may legally hold more of a kind than the active rule set allows -- the app's format
    /// has a `superCity` tier that base Catan caps at zero. The board is authoritative for what is
    /// already on it, so the limit absorbs those pieces and the seat simply has none of that kind
    /// left to build. Without this the piece pool and the placed count disagree permanently and
    /// `invariants_hold` fails for the whole game.
    pub const fn raise_limit(&mut self, buildable: Buildable, floor: u8) {
        if self.limits[buildable.index()] < floor {
            self.limits[buildable.index()] = floor;
        }
    }

    pub const fn vp(&self, buildable: Buildable) -> u8 {
        self.vp[buildable.index()]
    }

    pub const fn yield_multiplier(&self, buildable: Buildable) -> u8 {
        self.yield_multiplier[buildable.index()]
    }

    pub const fn dev_cost(&self) -> &[u8; RESOURCE_COUNT] {
        &self.dev_cost
    }

    pub const fn dev_victory_points(&self) -> u8 {
        self.dev_victory_points
    }

    pub const fn dev_deck_initial(&self) -> &[u8; 5] {
        &self.dev_deck_initial
    }

    pub const fn discard_threshold(&self) -> u8 {
        self.discard_threshold
    }

    pub const fn win_vp(&self) -> u8 {
        self.win_vp
    }

    pub const fn longest_road_min(&self) -> u8 {
        self.longest_road_min
    }

    pub const fn longest_road_vp(&self) -> u8 {
        self.longest_road_vp
    }

    pub const fn largest_army_min(&self) -> u8 {
        self.largest_army_min
    }

    pub const fn largest_army_vp(&self) -> u8 {
        self.largest_army_vp
    }

    pub fn prospective_trade_rate(&self, port: OwnedPort, resource: Resource) -> u32 {
        let current = self.trade_rate(resource);
        if port.resource.is_some() && port.resource != Some(resource) {
            return current;
        }
        transformed_port_rate(port, self.port_rule)
            .map_or(current, |rate| current.min(rate))
    }
}

fn transformed_port_rate(port: OwnedPort, rule: Option<PortRule>) -> Option<u32> {
    match rule {
        Some(PortRule {
            selector: PortSelector::All,
            action: PortAction::Disable,
        }) => None,
        None => Some(port.rate),
    }
}
