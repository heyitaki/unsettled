pub mod greedy_no_trade;
pub mod heuristic_v1;
pub mod priority_trader;
pub mod random_legal;

use serde::{Deserialize, Serialize};

use crate::rng::Xoshiro256StarStar;
use crate::rules::{Buildable, PortAction, PortRule, PortSelector};
use crate::view::{Action, DecisionView, DevPlay};

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum PolicyKind {
    RandomLegal,
    GreedyNoTrade,
    PriorityTrader,
    HeuristicV1,
    HeuristicV1Noports,
}

/// Disables every owned port, so the seat trades at the base bank rate.
const NO_PORTS: [PortRule; 1] = [PortRule {
    selector: PortSelector::All,
    action: PortAction::Disable,
}];

impl PolicyKind {
    /// Rule-level effects the policy itself implies, applied when the seat's rules are flattened.
    ///
    /// The no-ports ablation has to forgo port *rates*, not merely stop valuing ports when
    /// scoring locations: a policy that still trades at 2:1 keeps the entire mechanical benefit,
    /// which would make the `port_synergy` ranking-stability result circular. Expressing it as a
    /// port rule also exercises the same hook a future "ports removed" curse will use.
    pub const fn port_rules(self) -> &'static [PortRule] {
        match self {
            Self::HeuristicV1Noports => &NO_PORTS,
            _ => &[],
        }
    }

    pub fn parse(name: &str) -> Option<Self> {
        match name {
            "random-legal" => Some(Self::RandomLegal),
            "greedy-no-trade" => Some(Self::GreedyNoTrade),
            "priority-trader" => Some(Self::PriorityTrader),
            "heuristic-v1" => Some(Self::HeuristicV1),
            "heuristic-v1-noports" => Some(Self::HeuristicV1Noports),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Debug, Default)]
pub struct PolicyScratch {
    pub goal: Option<Buildable>,
}

pub fn pre_roll(
    kind: PolicyKind,
    view: &DecisionView<'_>,
    scratch: &mut PolicyScratch,
    rng: &mut Xoshiro256StarStar,
) -> Option<DevPlay> {
    match kind {
        PolicyKind::RandomLegal => random_legal::pre_roll(view, rng),
        PolicyKind::GreedyNoTrade => greedy_no_trade::pre_roll(view),
        PolicyKind::PriorityTrader => priority_trader::pre_roll(view, scratch),
        PolicyKind::HeuristicV1 => {
            heuristic_v1::pre_roll(view, scratch, &heuristic_v1::HeuristicParams::default())
        }
        PolicyKind::HeuristicV1Noports => {
            let mut params = heuristic_v1::HeuristicParams::default();
            params.port_weight = 0.0;
            heuristic_v1::pre_roll(view, scratch, &params)
        }
    }
}

pub fn action(
    kind: PolicyKind,
    view: &DecisionView<'_>,
    scratch: &mut PolicyScratch,
    rng: &mut Xoshiro256StarStar,
) -> Action {
    match kind {
        PolicyKind::RandomLegal => random_legal::action(view, rng),
        PolicyKind::GreedyNoTrade => greedy_no_trade::action(view),
        PolicyKind::PriorityTrader => priority_trader::action(view, scratch),
        PolicyKind::HeuristicV1 => heuristic_v1::action(
            view,
            scratch,
            &heuristic_v1::HeuristicParams::default(),
            rng,
        ),
        PolicyKind::HeuristicV1Noports => {
            let mut params = heuristic_v1::HeuristicParams::default();
            params.port_weight = 0.0;
            heuristic_v1::action(view, scratch, &params, rng)
        }
    }
}

pub fn discard(
    kind: PolicyKind,
    view: &DecisionView<'_>,
    count: u8,
    scratch: &mut PolicyScratch,
    rng: &mut Xoshiro256StarStar,
) -> [u8; 5] {
    match kind {
        PolicyKind::RandomLegal => random_legal::discard(view, count, rng),
        PolicyKind::GreedyNoTrade => greedy_no_trade::discard(view, count),
        PolicyKind::PriorityTrader => priority_trader::discard(view, count, scratch),
        PolicyKind::HeuristicV1 | PolicyKind::HeuristicV1Noports => {
            heuristic_v1::discard(view, count, scratch)
        }
    }
}

pub fn robber(
    kind: PolicyKind,
    view: &DecisionView<'_>,
    rng: &mut Xoshiro256StarStar,
) -> (u8, Option<u8>) {
    match kind {
        PolicyKind::RandomLegal => random_legal::robber(view, rng),
        PolicyKind::GreedyNoTrade => greedy_no_trade::robber(view),
        PolicyKind::PriorityTrader => priority_trader::robber(view),
        PolicyKind::HeuristicV1 | PolicyKind::HeuristicV1Noports => heuristic_v1::robber(view),
    }
}
