pub mod greedy_no_trade;
pub mod heuristic_v1;
pub mod heuristic_v1_trader;
pub mod priority_trader;
pub mod random_legal;

use serde::{Deserialize, Serialize};

use crate::rng::Xoshiro256StarStar;
use crate::rules::{Buildable, PortAction, PortRule, PortSelector};
use crate::trade::{TradeOffer, vp_estimate};
use crate::view::{Action, ActionBuf, DecisionView, DevPlay};

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum PolicyKind {
    RandomLegal,
    GreedyNoTrade,
    PriorityTrader,
    HeuristicV1,
    HeuristicV1Noports,
    HeuristicV1Trader,
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
            Self::RandomLegal
            | Self::GreedyNoTrade
            | Self::PriorityTrader
            | Self::HeuristicV1
            | Self::HeuristicV1Trader => &[],
        }
    }

    pub fn parse(name: &str) -> Option<Self> {
        match name {
            "random-legal" => Some(Self::RandomLegal),
            "greedy-no-trade" => Some(Self::GreedyNoTrade),
            "priority-trader" => Some(Self::PriorityTrader),
            "heuristic-v1" => Some(Self::HeuristicV1),
            "heuristic-v1-noports" => Some(Self::HeuristicV1Noports),
            "heuristic-v1-trader" => Some(Self::HeuristicV1Trader),
            _ => None,
        }
    }
}

/// Per-seat working memory that outlives a single decision.
///
/// It carries the seat's last chosen goal across the phases of a turn, and owns the action buffer
/// so scoring a decision reuses one scratch area instead of zeroing a fresh `MAX_ACTIONS`-wide
/// array every time a policy is asked to move. The buffer is boxed because a seat's worth of them
/// is far too large for a worker thread's stack, and it should stay sizeable enough that new
/// action kinds never have to justify themselves against a bound.
#[derive(Clone, Debug, Default)]
pub struct PolicyScratch {
    pub goal: Option<Buildable>,
    pub actions: Box<ActionBuf>,
}

impl PolicyScratch {
    pub fn reset(&mut self) {
        self.goal = None;
        self.actions.clear();
    }
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
        PolicyKind::HeuristicV1Trader => {
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
        PolicyKind::RandomLegal => random_legal::action(view, scratch, rng),
        PolicyKind::GreedyNoTrade => greedy_no_trade::action(view),
        PolicyKind::PriorityTrader => priority_trader::action(view, scratch),
        PolicyKind::HeuristicV1 => heuristic_v1::action(
            view,
            scratch,
            &heuristic_v1::HeuristicParams::default(),
            rng,
        ),
        PolicyKind::HeuristicV1Trader => heuristic_v1_trader::action(view, scratch, rng),
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
        PolicyKind::HeuristicV1
        | PolicyKind::HeuristicV1Noports
        | PolicyKind::HeuristicV1Trader => heuristic_v1::discard(view, count, scratch),
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
        PolicyKind::HeuristicV1
        | PolicyKind::HeuristicV1Noports
        | PolicyKind::HeuristicV1Trader => heuristic_v1::robber(view),
    }
}

pub fn respond_trade(
    kind: PolicyKind,
    view: &DecisionView<'_>,
    offer: TradeOffer,
    rng: &mut Xoshiro256StarStar,
) -> bool {
    match kind {
        PolicyKind::HeuristicV1Trader => heuristic_v1_trader::respond_trade(view, offer, rng),
        PolicyKind::RandomLegal
        | PolicyKind::GreedyNoTrade
        | PolicyKind::PriorityTrader
        | PolicyKind::HeuristicV1
        | PolicyKind::HeuristicV1Noports => false,
    }
}

pub fn select_counterparty(
    kind: PolicyKind,
    view: &DecisionView<'_>,
    acceptors: &[usize],
) -> usize {
    match kind {
        PolicyKind::RandomLegal
        | PolicyKind::GreedyNoTrade
        | PolicyKind::PriorityTrader
        | PolicyKind::HeuristicV1
        | PolicyKind::HeuristicV1Noports
        | PolicyKind::HeuristicV1Trader => farthest_from_winning(view, acceptors),
    }
}

fn farthest_from_winning(view: &DecisionView<'_>, acceptors: &[usize]) -> usize {
    let confidence = view
        .trade_config()
        .unwrap_or_default()
        .hidden_vp_confidence;
    acceptors
        .iter()
        .copied()
        .min_by_key(|seat| {
            let rotation_rank =
                (*seat + view.seats() - view.observer()) % view.seats();
            (
                vp_estimate(view, *seat, confidence),
                view.seats() - rotation_rank,
            )
        })
        .expect("counterparty selection requires an acceptor")
}
