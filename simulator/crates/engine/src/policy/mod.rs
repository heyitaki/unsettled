pub mod denial;
pub mod devcards;
pub mod exposure;
pub mod greedy_no_trade;
pub mod heuristic_v1;
pub mod heuristic_v1_trader;
pub mod params_file;
pub mod priority_trader;
pub mod random_legal;
pub mod threat;
pub mod trading;

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
    HeuristicV1Denial,
    HeuristicV1Threat,
    HeuristicV1ThreatDenial,
    HeuristicV1Devcards,
    HeuristicV1DevcardsDenial,
    HeuristicV1ThreatDevcards,
    HeuristicV1ThreatDevcardsDenial,
    HeuristicV1Trader,
    HeuristicV1TraderDenial,
    HeuristicV1TraderThreat,
    HeuristicV1TraderThreatDenial,
    HeuristicV1TraderDevcards,
    HeuristicV1TraderDevcardsDenial,
    HeuristicV1TraderThreatDevcards,
    HeuristicV1TraderThreatDevcardsDenial,
    HeuristicV1TraderAware,
    HeuristicV1TraderAwareDenial,
    HeuristicV1TraderAwareThreat,
    HeuristicV1TraderAwareThreatDenial,
    HeuristicV1TraderAwareDevcards,
    HeuristicV1TraderAwareDevcardsDenial,
    HeuristicV1TraderAwareThreatDevcards,
    HeuristicV1TraderAwareThreatDevcardsDenial,
    /// A params-file policy registered through `params_file::register_custom_policy` (the
    /// H0 seam): every parameter comes from the file, and the base kind it was registered
    /// against contributes only its dispatch family. Process-local handle, so it is
    /// excluded from serde and from the static name roster.
    #[serde(skip)]
    Custom(u8),
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
            // A params file cannot carry port rules, and registration rejects the one base
            // kind that has them.
            Self::Custom(_) => &[],
            Self::RandomLegal
            | Self::GreedyNoTrade
            | Self::PriorityTrader
            | Self::HeuristicV1
            | Self::HeuristicV1Denial
            | Self::HeuristicV1Threat
            | Self::HeuristicV1ThreatDenial
            | Self::HeuristicV1Devcards
            | Self::HeuristicV1DevcardsDenial
            | Self::HeuristicV1ThreatDevcards
            | Self::HeuristicV1ThreatDevcardsDenial
            | Self::HeuristicV1Trader
            | Self::HeuristicV1TraderDenial
            | Self::HeuristicV1TraderThreat
            | Self::HeuristicV1TraderThreatDenial
            | Self::HeuristicV1TraderDevcards
            | Self::HeuristicV1TraderDevcardsDenial
            | Self::HeuristicV1TraderThreatDevcards
            | Self::HeuristicV1TraderThreatDevcardsDenial
            | Self::HeuristicV1TraderAware
            | Self::HeuristicV1TraderAwareDenial
            | Self::HeuristicV1TraderAwareThreat
            | Self::HeuristicV1TraderAwareThreatDenial
            | Self::HeuristicV1TraderAwareDevcards
            | Self::HeuristicV1TraderAwareDevcardsDenial
            | Self::HeuristicV1TraderAwareThreatDevcards
            | Self::HeuristicV1TraderAwareThreatDevcardsDenial => &[],
        }
    }

    pub fn parse(name: &str) -> Option<Self> {
        match name {
            "random-legal" => Some(Self::RandomLegal),
            "greedy-no-trade" => Some(Self::GreedyNoTrade),
            "priority-trader" => Some(Self::PriorityTrader),
            "heuristic-v1" => Some(Self::HeuristicV1),
            "heuristic-v1-noports" => Some(Self::HeuristicV1Noports),
            "heuristic-v1-denial" => Some(Self::HeuristicV1Denial),
            "heuristic-v1-threat" => Some(Self::HeuristicV1Threat),
            "heuristic-v1-threat-denial" => Some(Self::HeuristicV1ThreatDenial),
            "heuristic-v1-devcards" => Some(Self::HeuristicV1Devcards),
            "heuristic-v1-devcards-denial" => Some(Self::HeuristicV1DevcardsDenial),
            "heuristic-v1-threat-devcards" => Some(Self::HeuristicV1ThreatDevcards),
            "heuristic-v1-threat-devcards-denial" => Some(Self::HeuristicV1ThreatDevcardsDenial),
            "heuristic-v1-trader" => Some(Self::HeuristicV1Trader),
            "heuristic-v1-trader-denial" => Some(Self::HeuristicV1TraderDenial),
            "heuristic-v1-trader-threat" => Some(Self::HeuristicV1TraderThreat),
            "heuristic-v1-trader-threat-denial" => Some(Self::HeuristicV1TraderThreatDenial),
            "heuristic-v1-trader-devcards" => Some(Self::HeuristicV1TraderDevcards),
            "heuristic-v1-trader-devcards-denial" => Some(Self::HeuristicV1TraderDevcardsDenial),
            "heuristic-v1-trader-threat-devcards" => Some(Self::HeuristicV1TraderThreatDevcards),
            "heuristic-v1-trader-threat-devcards-denial" => {
                Some(Self::HeuristicV1TraderThreatDevcardsDenial)
            }
            "heuristic-v1-trader-aware" => Some(Self::HeuristicV1TraderAware),
            "heuristic-v1-trader-aware-denial" => Some(Self::HeuristicV1TraderAwareDenial),
            "heuristic-v1-trader-aware-threat" => Some(Self::HeuristicV1TraderAwareThreat),
            "heuristic-v1-trader-aware-threat-denial" => {
                Some(Self::HeuristicV1TraderAwareThreatDenial)
            }
            "heuristic-v1-trader-aware-devcards" => Some(Self::HeuristicV1TraderAwareDevcards),
            "heuristic-v1-trader-aware-devcards-denial" => {
                Some(Self::HeuristicV1TraderAwareDevcardsDenial)
            }
            "heuristic-v1-trader-aware-threat-devcards" => {
                Some(Self::HeuristicV1TraderAwareThreatDevcards)
            }
            "heuristic-v1-trader-aware-threat-devcards-denial" => {
                Some(Self::HeuristicV1TraderAwareThreatDevcardsDenial)
            }
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
        PolicyKind::Custom(_) => heuristic_v1::pre_roll(view, scratch, &heuristic_params(kind)),
        PolicyKind::HeuristicV1
        | PolicyKind::HeuristicV1Denial
        | PolicyKind::HeuristicV1Threat
        | PolicyKind::HeuristicV1ThreatDenial
        | PolicyKind::HeuristicV1Devcards
        | PolicyKind::HeuristicV1DevcardsDenial
        | PolicyKind::HeuristicV1ThreatDevcards
        | PolicyKind::HeuristicV1ThreatDevcardsDenial => {
            heuristic_v1::pre_roll(view, scratch, &heuristic_params(kind))
        }
        PolicyKind::HeuristicV1Trader
        | PolicyKind::HeuristicV1TraderDenial
        | PolicyKind::HeuristicV1TraderThreat
        | PolicyKind::HeuristicV1TraderThreatDenial
        | PolicyKind::HeuristicV1TraderDevcards
        | PolicyKind::HeuristicV1TraderDevcardsDenial
        | PolicyKind::HeuristicV1TraderThreatDevcards
        | PolicyKind::HeuristicV1TraderThreatDevcardsDenial
        | PolicyKind::HeuristicV1TraderAware
        | PolicyKind::HeuristicV1TraderAwareDenial
        | PolicyKind::HeuristicV1TraderAwareThreat
        | PolicyKind::HeuristicV1TraderAwareThreatDenial
        | PolicyKind::HeuristicV1TraderAwareDevcards
        | PolicyKind::HeuristicV1TraderAwareDevcardsDenial
        | PolicyKind::HeuristicV1TraderAwareThreatDevcards
        | PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenial => {
            heuristic_v1::pre_roll(view, scratch, &heuristic_params(kind))
        }
        PolicyKind::HeuristicV1Noports => {
            heuristic_v1::pre_roll(view, scratch, &heuristic_params(kind))
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
        PolicyKind::Custom(index) => {
            if params_file::custom_trades(index) {
                heuristic_v1_trader::action(view, scratch, &heuristic_params(kind), rng)
            } else {
                heuristic_v1::action(view, scratch, &heuristic_params(kind), rng)
            }
        }
        PolicyKind::HeuristicV1
        | PolicyKind::HeuristicV1Denial
        | PolicyKind::HeuristicV1Threat
        | PolicyKind::HeuristicV1ThreatDenial
        | PolicyKind::HeuristicV1Devcards
        | PolicyKind::HeuristicV1DevcardsDenial
        | PolicyKind::HeuristicV1ThreatDevcards
        | PolicyKind::HeuristicV1ThreatDevcardsDenial => {
            heuristic_v1::action(view, scratch, &heuristic_params(kind), rng)
        }
        PolicyKind::HeuristicV1Trader
        | PolicyKind::HeuristicV1TraderDenial
        | PolicyKind::HeuristicV1TraderThreat
        | PolicyKind::HeuristicV1TraderThreatDenial
        | PolicyKind::HeuristicV1TraderDevcards
        | PolicyKind::HeuristicV1TraderDevcardsDenial
        | PolicyKind::HeuristicV1TraderThreatDevcards
        | PolicyKind::HeuristicV1TraderThreatDevcardsDenial
        | PolicyKind::HeuristicV1TraderAware
        | PolicyKind::HeuristicV1TraderAwareDenial
        | PolicyKind::HeuristicV1TraderAwareThreat
        | PolicyKind::HeuristicV1TraderAwareThreatDenial
        | PolicyKind::HeuristicV1TraderAwareDevcards
        | PolicyKind::HeuristicV1TraderAwareDevcardsDenial
        | PolicyKind::HeuristicV1TraderAwareThreatDevcards
        | PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenial => {
            heuristic_v1_trader::action(view, scratch, &heuristic_params(kind), rng)
        }
        PolicyKind::HeuristicV1Noports => {
            heuristic_v1::action(view, scratch, &heuristic_params(kind), rng)
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
        PolicyKind::Custom(_) => {
            heuristic_v1::discard(view, count, scratch, &heuristic_params(kind))
        }
        PolicyKind::HeuristicV1
        | PolicyKind::HeuristicV1Noports
        | PolicyKind::HeuristicV1Denial
        | PolicyKind::HeuristicV1Threat
        | PolicyKind::HeuristicV1ThreatDenial
        | PolicyKind::HeuristicV1Devcards
        | PolicyKind::HeuristicV1DevcardsDenial
        | PolicyKind::HeuristicV1ThreatDevcards
        | PolicyKind::HeuristicV1ThreatDevcardsDenial
        | PolicyKind::HeuristicV1Trader
        | PolicyKind::HeuristicV1TraderDenial
        | PolicyKind::HeuristicV1TraderThreat
        | PolicyKind::HeuristicV1TraderThreatDenial
        | PolicyKind::HeuristicV1TraderDevcards
        | PolicyKind::HeuristicV1TraderDevcardsDenial
        | PolicyKind::HeuristicV1TraderThreatDevcards
        | PolicyKind::HeuristicV1TraderThreatDevcardsDenial
        | PolicyKind::HeuristicV1TraderAware
        | PolicyKind::HeuristicV1TraderAwareDenial
        | PolicyKind::HeuristicV1TraderAwareThreat
        | PolicyKind::HeuristicV1TraderAwareThreatDenial
        | PolicyKind::HeuristicV1TraderAwareDevcards
        | PolicyKind::HeuristicV1TraderAwareDevcardsDenial
        | PolicyKind::HeuristicV1TraderAwareThreatDevcards
        | PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenial => {
            heuristic_v1::discard(view, count, scratch, &heuristic_params(kind))
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
        PolicyKind::Custom(_) => heuristic_v1::robber(view, &heuristic_params(kind)),
        PolicyKind::HeuristicV1
        | PolicyKind::HeuristicV1Noports
        | PolicyKind::HeuristicV1Denial
        | PolicyKind::HeuristicV1Threat
        | PolicyKind::HeuristicV1ThreatDenial
        | PolicyKind::HeuristicV1Devcards
        | PolicyKind::HeuristicV1DevcardsDenial
        | PolicyKind::HeuristicV1ThreatDevcards
        | PolicyKind::HeuristicV1ThreatDevcardsDenial
        | PolicyKind::HeuristicV1Trader
        | PolicyKind::HeuristicV1TraderDenial
        | PolicyKind::HeuristicV1TraderThreat
        | PolicyKind::HeuristicV1TraderThreatDenial
        | PolicyKind::HeuristicV1TraderDevcards
        | PolicyKind::HeuristicV1TraderDevcardsDenial
        | PolicyKind::HeuristicV1TraderThreatDevcards
        | PolicyKind::HeuristicV1TraderThreatDevcardsDenial
        | PolicyKind::HeuristicV1TraderAware
        | PolicyKind::HeuristicV1TraderAwareDenial
        | PolicyKind::HeuristicV1TraderAwareThreat
        | PolicyKind::HeuristicV1TraderAwareThreatDenial
        | PolicyKind::HeuristicV1TraderAwareDevcards
        | PolicyKind::HeuristicV1TraderAwareDevcardsDenial
        | PolicyKind::HeuristicV1TraderAwareThreatDevcards
        | PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenial => {
            heuristic_v1::robber(view, &heuristic_params(kind))
        }
    }
}

pub fn respond_trade(
    kind: PolicyKind,
    view: &DecisionView<'_>,
    offer: TradeOffer,
    rng: &mut Xoshiro256StarStar,
) -> bool {
    match kind {
        PolicyKind::Custom(index) => {
            params_file::custom_trades(index)
                && heuristic_v1_trader::respond_trade(view, offer, &heuristic_params(kind), rng)
        }
        PolicyKind::HeuristicV1Trader
        | PolicyKind::HeuristicV1TraderDenial
        | PolicyKind::HeuristicV1TraderThreat
        | PolicyKind::HeuristicV1TraderThreatDenial
        | PolicyKind::HeuristicV1TraderDevcards
        | PolicyKind::HeuristicV1TraderDevcardsDenial
        | PolicyKind::HeuristicV1TraderThreatDevcards
        | PolicyKind::HeuristicV1TraderThreatDevcardsDenial
        | PolicyKind::HeuristicV1TraderAware
        | PolicyKind::HeuristicV1TraderAwareDenial
        | PolicyKind::HeuristicV1TraderAwareThreat
        | PolicyKind::HeuristicV1TraderAwareThreatDenial
        | PolicyKind::HeuristicV1TraderAwareDevcards
        | PolicyKind::HeuristicV1TraderAwareDevcardsDenial
        | PolicyKind::HeuristicV1TraderAwareThreatDevcards
        | PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenial => {
            heuristic_v1_trader::respond_trade(view, offer, &heuristic_params(kind), rng)
        }
        PolicyKind::RandomLegal
        | PolicyKind::GreedyNoTrade
        | PolicyKind::PriorityTrader
        | PolicyKind::HeuristicV1
        | PolicyKind::HeuristicV1Noports
        | PolicyKind::HeuristicV1Denial
        | PolicyKind::HeuristicV1Threat
        | PolicyKind::HeuristicV1ThreatDenial
        | PolicyKind::HeuristicV1Devcards
        | PolicyKind::HeuristicV1DevcardsDenial
        | PolicyKind::HeuristicV1ThreatDevcards
        | PolicyKind::HeuristicV1ThreatDevcardsDenial => false,
    }
}

pub fn select_counterparty(
    kind: PolicyKind,
    view: &DecisionView<'_>,
    delta: &[f64; crate::rules::RESOURCE_COUNT],
    acceptors: &[usize],
) -> usize {
    match heuristic_params(kind).trading {
        None => farthest_from_winning(view, acceptors),
        Some(params) => trading::select_counterparty(view, &params, delta, acceptors),
    }
}

/// Per-kind heuristic parameters. Non-heuristic kinds receive defaults with every gate disabled.
fn heuristic_params(kind: PolicyKind) -> heuristic_v1::HeuristicParams {
    match kind {
        PolicyKind::Custom(index) => params_file::custom_params(index),
        PolicyKind::HeuristicV1Noports => heuristic_v1::HeuristicParams {
            port_weight: 0.0,
            ..heuristic_v1::HeuristicParams::default()
        },
        PolicyKind::HeuristicV1Denial | PolicyKind::HeuristicV1TraderDenial => {
            heuristic_v1::HeuristicParams {
                denial: Some(denial::DenialParams::default()),
                ..heuristic_v1::HeuristicParams::default()
            }
        }
        PolicyKind::HeuristicV1Threat => heuristic_v1::HeuristicParams {
            threat: Some(threat::ThreatParams::default()),
            ..heuristic_v1::HeuristicParams::default()
        },
        PolicyKind::HeuristicV1ThreatDenial | PolicyKind::HeuristicV1TraderThreatDenial => {
            heuristic_v1::HeuristicParams {
                threat: Some(threat::ThreatParams::default()),
                denial: Some(denial::DenialParams::default()),
                ..heuristic_v1::HeuristicParams::default()
            }
        }
        PolicyKind::HeuristicV1Devcards => heuristic_v1::HeuristicParams {
            dev_cards: Some(devcards::DevCardParams::default()),
            ..heuristic_v1::HeuristicParams::default()
        },
        PolicyKind::HeuristicV1DevcardsDenial | PolicyKind::HeuristicV1TraderDevcardsDenial => {
            heuristic_v1::HeuristicParams {
                dev_cards: Some(devcards::DevCardParams::default()),
                denial: Some(denial::DenialParams::default()),
                ..heuristic_v1::HeuristicParams::default()
            }
        }
        PolicyKind::HeuristicV1ThreatDevcards => heuristic_v1::HeuristicParams {
            threat: Some(threat::ThreatParams::default()),
            dev_cards: Some(devcards::DevCardParams::default()),
            ..heuristic_v1::HeuristicParams::default()
        },
        PolicyKind::HeuristicV1ThreatDevcardsDenial
        | PolicyKind::HeuristicV1TraderThreatDevcardsDenial => heuristic_v1::HeuristicParams {
            threat: Some(threat::ThreatParams::default()),
            dev_cards: Some(devcards::DevCardParams::default()),
            denial: Some(denial::DenialParams::default()),
            ..heuristic_v1::HeuristicParams::default()
        },
        PolicyKind::HeuristicV1TraderThreat => heuristic_v1::HeuristicParams {
            threat: Some(threat::ThreatParams::default()),
            ..heuristic_v1::HeuristicParams::default()
        },
        PolicyKind::HeuristicV1TraderDevcards => heuristic_v1::HeuristicParams {
            dev_cards: Some(devcards::DevCardParams::default()),
            ..heuristic_v1::HeuristicParams::default()
        },
        PolicyKind::HeuristicV1TraderThreatDevcards => heuristic_v1::HeuristicParams {
            threat: Some(threat::ThreatParams::default()),
            dev_cards: Some(devcards::DevCardParams::default()),
            ..heuristic_v1::HeuristicParams::default()
        },
        PolicyKind::HeuristicV1TraderAware => heuristic_v1::HeuristicParams {
            trading: Some(trading::TradeParams::default()),
            ..heuristic_v1::HeuristicParams::default()
        },
        PolicyKind::HeuristicV1TraderAwareDenial => heuristic_v1::HeuristicParams {
            trading: Some(trading::TradeParams::default()),
            denial: Some(denial::DenialParams::default()),
            ..heuristic_v1::HeuristicParams::default()
        },
        PolicyKind::HeuristicV1TraderAwareThreat => heuristic_v1::HeuristicParams {
            threat: Some(threat::ThreatParams::default()),
            trading: Some(trading::TradeParams::default()),
            ..heuristic_v1::HeuristicParams::default()
        },
        PolicyKind::HeuristicV1TraderAwareThreatDenial => heuristic_v1::HeuristicParams {
            threat: Some(threat::ThreatParams::default()),
            trading: Some(trading::TradeParams::default()),
            denial: Some(denial::DenialParams::default()),
            ..heuristic_v1::HeuristicParams::default()
        },
        PolicyKind::HeuristicV1TraderAwareDevcards => heuristic_v1::HeuristicParams {
            dev_cards: Some(devcards::DevCardParams::default()),
            trading: Some(trading::TradeParams::default()),
            ..heuristic_v1::HeuristicParams::default()
        },
        PolicyKind::HeuristicV1TraderAwareDevcardsDenial => heuristic_v1::HeuristicParams {
            dev_cards: Some(devcards::DevCardParams::default()),
            trading: Some(trading::TradeParams::default()),
            denial: Some(denial::DenialParams::default()),
            ..heuristic_v1::HeuristicParams::default()
        },
        PolicyKind::HeuristicV1TraderAwareThreatDevcards => heuristic_v1::HeuristicParams {
            threat: Some(threat::ThreatParams::default()),
            dev_cards: Some(devcards::DevCardParams::default()),
            trading: Some(trading::TradeParams::default()),
            ..heuristic_v1::HeuristicParams::default()
        },
        PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenial => heuristic_v1::HeuristicParams {
            threat: Some(threat::ThreatParams::default()),
            dev_cards: Some(devcards::DevCardParams::default()),
            trading: Some(trading::TradeParams::default()),
            denial: Some(denial::DenialParams::default()),
            ..heuristic_v1::HeuristicParams::default()
        },
        PolicyKind::RandomLegal
        | PolicyKind::GreedyNoTrade
        | PolicyKind::PriorityTrader
        | PolicyKind::HeuristicV1
        | PolicyKind::HeuristicV1Trader => heuristic_v1::HeuristicParams::default(),
    }
}

/// The dispatch family a params-file policy inherits from the base kind it registers
/// against: `Ok(true)` for the trader family (the seat makes and answers player-trade
/// offers), `Ok(false)` for the plain heuristic family. Everything else a base kind
/// carries is params, which the file replaces wholesale. Non-heuristic kinds have no
/// params to replace, and `heuristic-v1-noports` acts through a port *rule* a params file
/// cannot carry. The wildcard arm covers the trader roster;
/// `custom_base_family_matches_the_roster` cross-checks every kind against its name so a
/// future non-trader variant cannot land there silently.
pub(crate) fn custom_base_trades(base: PolicyKind) -> Result<bool, String> {
    match base {
        PolicyKind::RandomLegal | PolicyKind::GreedyNoTrade | PolicyKind::PriorityTrader => {
            Err("policy params files require a heuristic-family base policy".into())
        }
        PolicyKind::Custom(_) => {
            Err("a custom params policy cannot base another params file".into())
        }
        PolicyKind::HeuristicV1Noports => Err(
            "heuristic-v1-noports cannot base a params file: its no-ports effect is a port \
             rule, not a parameter"
                .into(),
        ),
        PolicyKind::HeuristicV1
        | PolicyKind::HeuristicV1Denial
        | PolicyKind::HeuristicV1Threat
        | PolicyKind::HeuristicV1ThreatDenial
        | PolicyKind::HeuristicV1Devcards
        | PolicyKind::HeuristicV1DevcardsDenial
        | PolicyKind::HeuristicV1ThreatDevcards
        | PolicyKind::HeuristicV1ThreatDevcardsDenial => Ok(false),
        _ => Ok(true),
    }
}

fn farthest_from_winning(view: &DecisionView<'_>, acceptors: &[usize]) -> usize {
    let confidence = view.trade_config().unwrap_or_default().hidden_vp_confidence;
    acceptors
        .iter()
        .copied()
        .min_by_key(|seat| {
            let rotation_rank = (*seat + view.seats() - view.observer()) % view.seats();
            (
                vp_estimate(view, *seat, confidence),
                view.seats() - rotation_rank,
            )
        })
        .expect("counterparty selection requires an acceptor")
}

#[cfg(test)]
mod gate_tests {
    use super::{PolicyKind, heuristic_params};

    #[test]
    fn heuristic_params_maps_every_variant_to_the_intended_gate_quadruple() {
        for (kind, threat, dev_cards, trading, denial) in gate_table() {
            let params = heuristic_params(kind);
            assert_eq!(params.threat.is_some(), threat, "{kind:?}");
            assert_eq!(params.dev_cards.is_some(), dev_cards, "{kind:?}");
            assert_eq!(params.trading.is_some(), trading, "{kind:?}");
            assert_eq!(params.denial.is_some(), denial, "{kind:?}");
        }
    }

    #[test]
    fn each_gate_is_enabled_by_exactly_its_intended_variants() {
        let actual = |index: usize| {
            gate_table()
                .into_iter()
                .filter_map(|(kind, threat, dev_cards, trading, denial)| {
                    match index {
                        1 => threat,
                        2 => dev_cards,
                        3 => trading,
                        4 => denial,
                        _ => unreachable!(),
                    }
                    .then_some(kind)
                })
                .collect::<Vec<_>>()
        };
        assert_eq!(
            actual(1),
            vec![
                PolicyKind::HeuristicV1Threat,
                PolicyKind::HeuristicV1ThreatDenial,
                PolicyKind::HeuristicV1ThreatDevcards,
                PolicyKind::HeuristicV1ThreatDevcardsDenial,
                PolicyKind::HeuristicV1TraderThreat,
                PolicyKind::HeuristicV1TraderThreatDenial,
                PolicyKind::HeuristicV1TraderThreatDevcards,
                PolicyKind::HeuristicV1TraderThreatDevcardsDenial,
                PolicyKind::HeuristicV1TraderAwareThreat,
                PolicyKind::HeuristicV1TraderAwareThreatDenial,
                PolicyKind::HeuristicV1TraderAwareThreatDevcards,
                PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenial,
            ]
        );
        assert_eq!(
            actual(2),
            vec![
                PolicyKind::HeuristicV1Devcards,
                PolicyKind::HeuristicV1DevcardsDenial,
                PolicyKind::HeuristicV1ThreatDevcards,
                PolicyKind::HeuristicV1ThreatDevcardsDenial,
                PolicyKind::HeuristicV1TraderDevcards,
                PolicyKind::HeuristicV1TraderDevcardsDenial,
                PolicyKind::HeuristicV1TraderThreatDevcards,
                PolicyKind::HeuristicV1TraderThreatDevcardsDenial,
                PolicyKind::HeuristicV1TraderAwareDevcards,
                PolicyKind::HeuristicV1TraderAwareDevcardsDenial,
                PolicyKind::HeuristicV1TraderAwareThreatDevcards,
                PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenial,
            ]
        );
        assert_eq!(
            actual(3),
            vec![
                PolicyKind::HeuristicV1TraderAware,
                PolicyKind::HeuristicV1TraderAwareDenial,
                PolicyKind::HeuristicV1TraderAwareThreat,
                PolicyKind::HeuristicV1TraderAwareThreatDenial,
                PolicyKind::HeuristicV1TraderAwareDevcards,
                PolicyKind::HeuristicV1TraderAwareDevcardsDenial,
                PolicyKind::HeuristicV1TraderAwareThreatDevcards,
                PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenial,
            ]
        );
        assert_eq!(
            actual(4),
            vec![
                PolicyKind::HeuristicV1Denial,
                PolicyKind::HeuristicV1ThreatDenial,
                PolicyKind::HeuristicV1DevcardsDenial,
                PolicyKind::HeuristicV1ThreatDevcardsDenial,
                PolicyKind::HeuristicV1TraderDenial,
                PolicyKind::HeuristicV1TraderThreatDenial,
                PolicyKind::HeuristicV1TraderDevcardsDenial,
                PolicyKind::HeuristicV1TraderThreatDevcardsDenial,
                PolicyKind::HeuristicV1TraderAwareDenial,
                PolicyKind::HeuristicV1TraderAwareThreatDenial,
                PolicyKind::HeuristicV1TraderAwareDevcardsDenial,
                PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenial,
            ]
        );
    }

    #[test]
    fn gate_table_contains_every_policy_kind_exactly_once() {
        let table = gate_table();
        assert_eq!(table.len(), POLICY_KIND_COUNT);
        let mut seen = [false; POLICY_KIND_COUNT];
        for (kind, _, _, _, _) in table {
            let index = kind_index(kind);
            assert!(!seen[index], "duplicate {kind:?}");
            seen[index] = true;
        }
        assert!(seen.into_iter().all(|present| present));
    }

    #[test]
    fn ungated_trader_uses_the_exact_default_params() {
        assert_eq!(
            heuristic_params(PolicyKind::HeuristicV1Trader),
            super::heuristic_v1::HeuristicParams::default()
        );
    }

    #[test]
    fn every_policy_kind_round_trips_through_parse() {
        for (kind, name) in policy_names() {
            assert_eq!(PolicyKind::parse(name), Some(kind), "{name}");
        }
    }

    /// Guards `custom_base_trades`'s wildcard arm: every roster kind's dispatch family
    /// must match what its name says, so a future non-trader variant cannot silently
    /// land in the trader family.
    #[test]
    fn custom_base_family_matches_the_roster() {
        for (kind, name) in policy_names() {
            let family = super::custom_base_trades(kind);
            if matches!(
                kind,
                PolicyKind::RandomLegal | PolicyKind::GreedyNoTrade | PolicyKind::PriorityTrader
            ) || name.ends_with("-noports")
            {
                assert!(family.is_err(), "{name} must be rejected as a base");
            } else if name.contains("-trader") {
                assert_eq!(family, Ok(true), "{name}");
            } else {
                assert_eq!(family, Ok(false), "{name}");
            }
        }
        assert!(super::custom_base_trades(PolicyKind::Custom(255)).is_err());
    }

    fn gate_table() -> [(PolicyKind, bool, bool, bool, bool); POLICY_KIND_COUNT] {
        [
            (PolicyKind::RandomLegal, false, false, false, false),
            (PolicyKind::GreedyNoTrade, false, false, false, false),
            (PolicyKind::PriorityTrader, false, false, false, false),
            (PolicyKind::HeuristicV1, false, false, false, false),
            (PolicyKind::HeuristicV1Noports, false, false, false, false),
            (PolicyKind::HeuristicV1Denial, false, false, false, true),
            (PolicyKind::HeuristicV1Threat, true, false, false, false),
            (
                PolicyKind::HeuristicV1ThreatDenial,
                true,
                false,
                false,
                true,
            ),
            (PolicyKind::HeuristicV1Devcards, false, true, false, false),
            (
                PolicyKind::HeuristicV1DevcardsDenial,
                false,
                true,
                false,
                true,
            ),
            (
                PolicyKind::HeuristicV1ThreatDevcards,
                true,
                true,
                false,
                false,
            ),
            (
                PolicyKind::HeuristicV1ThreatDevcardsDenial,
                true,
                true,
                false,
                true,
            ),
            (PolicyKind::HeuristicV1Trader, false, false, false, false),
            (
                PolicyKind::HeuristicV1TraderDenial,
                false,
                false,
                false,
                true,
            ),
            (
                PolicyKind::HeuristicV1TraderThreat,
                true,
                false,
                false,
                false,
            ),
            (
                PolicyKind::HeuristicV1TraderThreatDenial,
                true,
                false,
                false,
                true,
            ),
            (
                PolicyKind::HeuristicV1TraderDevcards,
                false,
                true,
                false,
                false,
            ),
            (
                PolicyKind::HeuristicV1TraderDevcardsDenial,
                false,
                true,
                false,
                true,
            ),
            (
                PolicyKind::HeuristicV1TraderThreatDevcards,
                true,
                true,
                false,
                false,
            ),
            (
                PolicyKind::HeuristicV1TraderThreatDevcardsDenial,
                true,
                true,
                false,
                true,
            ),
            (
                PolicyKind::HeuristicV1TraderAware,
                false,
                false,
                true,
                false,
            ),
            (
                PolicyKind::HeuristicV1TraderAwareDenial,
                false,
                false,
                true,
                true,
            ),
            (
                PolicyKind::HeuristicV1TraderAwareThreat,
                true,
                false,
                true,
                false,
            ),
            (
                PolicyKind::HeuristicV1TraderAwareThreatDenial,
                true,
                false,
                true,
                true,
            ),
            (
                PolicyKind::HeuristicV1TraderAwareDevcards,
                false,
                true,
                true,
                false,
            ),
            (
                PolicyKind::HeuristicV1TraderAwareDevcardsDenial,
                false,
                true,
                true,
                true,
            ),
            (
                PolicyKind::HeuristicV1TraderAwareThreatDevcards,
                true,
                true,
                true,
                false,
            ),
            (
                PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenial,
                true,
                true,
                true,
                true,
            ),
        ]
    }

    fn policy_names() -> [(PolicyKind, &'static str); POLICY_KIND_COUNT] {
        [
            (PolicyKind::RandomLegal, "random-legal"),
            (PolicyKind::GreedyNoTrade, "greedy-no-trade"),
            (PolicyKind::PriorityTrader, "priority-trader"),
            (PolicyKind::HeuristicV1, "heuristic-v1"),
            (PolicyKind::HeuristicV1Noports, "heuristic-v1-noports"),
            (PolicyKind::HeuristicV1Denial, "heuristic-v1-denial"),
            (PolicyKind::HeuristicV1Threat, "heuristic-v1-threat"),
            (
                PolicyKind::HeuristicV1ThreatDenial,
                "heuristic-v1-threat-denial",
            ),
            (PolicyKind::HeuristicV1Devcards, "heuristic-v1-devcards"),
            (
                PolicyKind::HeuristicV1DevcardsDenial,
                "heuristic-v1-devcards-denial",
            ),
            (
                PolicyKind::HeuristicV1ThreatDevcards,
                "heuristic-v1-threat-devcards",
            ),
            (
                PolicyKind::HeuristicV1ThreatDevcardsDenial,
                "heuristic-v1-threat-devcards-denial",
            ),
            (PolicyKind::HeuristicV1Trader, "heuristic-v1-trader"),
            (
                PolicyKind::HeuristicV1TraderDenial,
                "heuristic-v1-trader-denial",
            ),
            (
                PolicyKind::HeuristicV1TraderThreat,
                "heuristic-v1-trader-threat",
            ),
            (
                PolicyKind::HeuristicV1TraderThreatDenial,
                "heuristic-v1-trader-threat-denial",
            ),
            (
                PolicyKind::HeuristicV1TraderDevcards,
                "heuristic-v1-trader-devcards",
            ),
            (
                PolicyKind::HeuristicV1TraderDevcardsDenial,
                "heuristic-v1-trader-devcards-denial",
            ),
            (
                PolicyKind::HeuristicV1TraderThreatDevcards,
                "heuristic-v1-trader-threat-devcards",
            ),
            (
                PolicyKind::HeuristicV1TraderThreatDevcardsDenial,
                "heuristic-v1-trader-threat-devcards-denial",
            ),
            (
                PolicyKind::HeuristicV1TraderAware,
                "heuristic-v1-trader-aware",
            ),
            (
                PolicyKind::HeuristicV1TraderAwareDenial,
                "heuristic-v1-trader-aware-denial",
            ),
            (
                PolicyKind::HeuristicV1TraderAwareThreat,
                "heuristic-v1-trader-aware-threat",
            ),
            (
                PolicyKind::HeuristicV1TraderAwareThreatDenial,
                "heuristic-v1-trader-aware-threat-denial",
            ),
            (
                PolicyKind::HeuristicV1TraderAwareDevcards,
                "heuristic-v1-trader-aware-devcards",
            ),
            (
                PolicyKind::HeuristicV1TraderAwareDevcardsDenial,
                "heuristic-v1-trader-aware-devcards-denial",
            ),
            (
                PolicyKind::HeuristicV1TraderAwareThreatDevcards,
                "heuristic-v1-trader-aware-threat-devcards",
            ),
            (
                PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenial,
                "heuristic-v1-trader-aware-threat-devcards-denial",
            ),
        ]
    }

    const POLICY_KIND_COUNT: usize = 28;

    const fn kind_index(kind: PolicyKind) -> usize {
        match kind {
            PolicyKind::RandomLegal => 0,
            PolicyKind::GreedyNoTrade => 1,
            PolicyKind::PriorityTrader => 2,
            PolicyKind::HeuristicV1 => 3,
            PolicyKind::HeuristicV1Noports => 4,
            PolicyKind::HeuristicV1Denial => 5,
            PolicyKind::HeuristicV1Threat => 6,
            PolicyKind::HeuristicV1ThreatDenial => 7,
            PolicyKind::HeuristicV1Devcards => 8,
            PolicyKind::HeuristicV1DevcardsDenial => 9,
            PolicyKind::HeuristicV1ThreatDevcards => 10,
            PolicyKind::HeuristicV1ThreatDevcardsDenial => 11,
            PolicyKind::HeuristicV1Trader => 12,
            PolicyKind::HeuristicV1TraderDenial => 13,
            PolicyKind::HeuristicV1TraderThreat => 14,
            PolicyKind::HeuristicV1TraderThreatDenial => 15,
            PolicyKind::HeuristicV1TraderDevcards => 16,
            PolicyKind::HeuristicV1TraderDevcardsDenial => 17,
            PolicyKind::HeuristicV1TraderThreatDevcards => 18,
            PolicyKind::HeuristicV1TraderThreatDevcardsDenial => 19,
            PolicyKind::HeuristicV1TraderAware => 20,
            PolicyKind::HeuristicV1TraderAwareDenial => 21,
            PolicyKind::HeuristicV1TraderAwareThreat => 22,
            PolicyKind::HeuristicV1TraderAwareThreatDenial => 23,
            PolicyKind::HeuristicV1TraderAwareDevcards => 24,
            PolicyKind::HeuristicV1TraderAwareDevcardsDenial => 25,
            PolicyKind::HeuristicV1TraderAwareThreatDevcards => 26,
            PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenial => 27,
            PolicyKind::Custom(_) => panic!("custom params policies are outside the roster"),
        }
    }
}
