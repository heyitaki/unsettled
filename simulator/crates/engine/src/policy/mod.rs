pub mod denial;
pub mod devcards;
pub mod exposure;
pub mod greedy_no_trade;
pub mod heuristic_v1;
pub mod heuristic_v1_trader;
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
    HeuristicV1TraderAwareThreatDevcardsDenialLegacyall,
    HeuristicV1TraderAwareThreatDevcardsDenialLegacyport,
    HeuristicV1TraderAwareThreatDevcardsDenialLegacychooser,
    HeuristicV1TraderAwareThreatDevcardsDenialLegacycityterms,
    HeuristicV1TraderAwareThreatDevcardsDenialLegacyband,
    HeuristicV1TraderAwareThreatDevcardsDenialLegacycitygoal,
    HeuristicV1TraderAwareThreatDevcardsDenialLegacycards,
    HeuristicV1TraderAwareThreatDevcardsDenialLegacydeck,
    HeuristicV1TraderAwareThreatDevcardsDenialLegacyexposure,
    HeuristicV1TraderAwareThreatDevcardsDenialLegacyrace,
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
            | Self::HeuristicV1TraderAwareThreatDevcardsDenial
            | Self::HeuristicV1TraderAwareThreatDevcardsDenialLegacyall
            | Self::HeuristicV1TraderAwareThreatDevcardsDenialLegacyport
            | Self::HeuristicV1TraderAwareThreatDevcardsDenialLegacychooser
            | Self::HeuristicV1TraderAwareThreatDevcardsDenialLegacycityterms
            | Self::HeuristicV1TraderAwareThreatDevcardsDenialLegacyband
            | Self::HeuristicV1TraderAwareThreatDevcardsDenialLegacycitygoal
            | Self::HeuristicV1TraderAwareThreatDevcardsDenialLegacycards
            | Self::HeuristicV1TraderAwareThreatDevcardsDenialLegacydeck
            | Self::HeuristicV1TraderAwareThreatDevcardsDenialLegacyexposure
            | Self::HeuristicV1TraderAwareThreatDevcardsDenialLegacyrace => &[],
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
            "heuristic-v1-trader-aware-threat-devcards-denial-legacyall" => {
                Some(Self::HeuristicV1TraderAwareThreatDevcardsDenialLegacyall)
            }
            "heuristic-v1-trader-aware-threat-devcards-denial-legacyport" => {
                Some(Self::HeuristicV1TraderAwareThreatDevcardsDenialLegacyport)
            }
            "heuristic-v1-trader-aware-threat-devcards-denial-legacychooser" => {
                Some(Self::HeuristicV1TraderAwareThreatDevcardsDenialLegacychooser)
            }
            "heuristic-v1-trader-aware-threat-devcards-denial-legacycityterms" => {
                Some(Self::HeuristicV1TraderAwareThreatDevcardsDenialLegacycityterms)
            }
            "heuristic-v1-trader-aware-threat-devcards-denial-legacyband" => {
                Some(Self::HeuristicV1TraderAwareThreatDevcardsDenialLegacyband)
            }
            "heuristic-v1-trader-aware-threat-devcards-denial-legacycitygoal" => {
                Some(Self::HeuristicV1TraderAwareThreatDevcardsDenialLegacycitygoal)
            }
            "heuristic-v1-trader-aware-threat-devcards-denial-legacycards" => {
                Some(Self::HeuristicV1TraderAwareThreatDevcardsDenialLegacycards)
            }
            "heuristic-v1-trader-aware-threat-devcards-denial-legacydeck" => {
                Some(Self::HeuristicV1TraderAwareThreatDevcardsDenialLegacydeck)
            }
            "heuristic-v1-trader-aware-threat-devcards-denial-legacyexposure" => {
                Some(Self::HeuristicV1TraderAwareThreatDevcardsDenialLegacyexposure)
            }
            "heuristic-v1-trader-aware-threat-devcards-denial-legacyrace" => {
                Some(Self::HeuristicV1TraderAwareThreatDevcardsDenialLegacyrace)
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
        | PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenial
        | PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacyall
        | PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacyport
        | PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacychooser
        | PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacycityterms
        | PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacyband
        | PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacycitygoal
        | PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacycards
        | PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacydeck
        | PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacyexposure
        | PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacyrace => {
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
        | PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenial
        | PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacyall
        | PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacyport
        | PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacychooser
        | PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacycityterms
        | PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacyband
        | PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacycitygoal
        | PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacycards
        | PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacydeck
        | PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacyexposure
        | PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacyrace => {
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
        | PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenial
        | PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacyall
        | PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacyport
        | PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacychooser
        | PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacycityterms
        | PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacyband
        | PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacycitygoal
        | PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacycards
        | PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacydeck
        | PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacyexposure
        | PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacyrace => {
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
        | PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenial
        | PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacyall
        | PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacyport
        | PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacychooser
        | PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacycityterms
        | PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacyband
        | PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacycitygoal
        | PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacycards
        | PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacydeck
        | PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacyexposure
        | PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacyrace => {
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
        | PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenial
        | PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacyall
        | PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacyport
        | PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacychooser
        | PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacycityterms
        | PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacyband
        | PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacycitygoal
        | PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacycards
        | PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacydeck
        | PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacyexposure
        | PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacyrace => {
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
    let params = match kind {
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
        PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenial => composite_params(None),
        PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacyall => {
            composite_params(Some(heuristic_v1::LegacyValuation {
                local_port_production: true,
                pip_settlement_goal: true,
                flat_city_goal: true,
                settlement_shaped_city_terms: true,
                band_ladder: true,
                ..heuristic_v1::LegacyValuation::default()
            }))
        }
        PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacyport => {
            composite_params(Some(heuristic_v1::LegacyValuation {
                local_port_production: true,
                ..heuristic_v1::LegacyValuation::default()
            }))
        }
        PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacychooser => {
            composite_params(Some(heuristic_v1::LegacyValuation {
                pip_settlement_goal: true,
                ..heuristic_v1::LegacyValuation::default()
            }))
        }
        PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacycityterms => {
            composite_params(Some(heuristic_v1::LegacyValuation {
                settlement_shaped_city_terms: true,
                ..heuristic_v1::LegacyValuation::default()
            }))
        }
        PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacyband => {
            composite_params(Some(heuristic_v1::LegacyValuation {
                band_ladder: true,
                ..heuristic_v1::LegacyValuation::default()
            }))
        }
        PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacycitygoal => {
            composite_params(Some(heuristic_v1::LegacyValuation {
                flat_city_goal: true,
                ..heuristic_v1::LegacyValuation::default()
            }))
        }
        PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacycards => {
            composite_params(Some(heuristic_v1::LegacyValuation {
                narrow_card_plays: true,
                ..heuristic_v1::LegacyValuation::default()
            }))
        }
        PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacydeck => {
            composite_params(Some(heuristic_v1::LegacyValuation {
                deck_blind_buying: true,
                ..heuristic_v1::LegacyValuation::default()
            }))
        }
        PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacyexposure => {
            composite_params(Some(heuristic_v1::LegacyValuation {
                exposure_blind: true,
                ..heuristic_v1::LegacyValuation::default()
            }))
        }
        PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacyrace => {
            composite_params(Some(heuristic_v1::LegacyValuation {
                bounded_race: true,
                ..heuristic_v1::LegacyValuation::default()
            }))
        }
        PolicyKind::RandomLegal
        | PolicyKind::GreedyNoTrade
        | PolicyKind::PriorityTrader
        | PolicyKind::HeuristicV1
        | PolicyKind::HeuristicV1Trader => heuristic_v1::HeuristicParams::default(),
    };
    #[cfg(test)]
    let mut params = params;
    #[cfg(test)]
    CENSUS_LEGACY_OVERRIDE.with(|enabled| {
        if enabled.get() {
            params.legacy_valuation = Some(heuristic_v1::LegacyValuation {
                local_port_production: true,
                pip_settlement_goal: true,
                flat_city_goal: true,
                settlement_shaped_city_terms: true,
                band_ladder: true,
                ..heuristic_v1::LegacyValuation::default()
            });
        }
    });
    params
}

#[cfg(test)]
std::thread_local! {
    static CENSUS_LEGACY_OVERRIDE: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

#[cfg(test)]
fn set_census_legacy_override(enabled: bool) {
    CENSUS_LEGACY_OVERRIDE.with(|value| value.set(enabled));
}

/// Clears the override on unwind as well as on normal exit: with
/// `--test-threads=1` libtest reuses the calling thread, so a leaked flag would
/// silently switch every later test in the binary to the legacy valuation.
#[cfg(test)]
struct CensusLegacyOverrideGuard;

#[cfg(test)]
impl CensusLegacyOverrideGuard {
    fn set(enabled: bool) -> Self {
        set_census_legacy_override(enabled);
        Self
    }
}

#[cfg(test)]
impl Drop for CensusLegacyOverrideGuard {
    fn drop(&mut self) {
        set_census_legacy_override(false);
    }
}

fn composite_params(
    legacy_valuation: Option<heuristic_v1::LegacyValuation>,
) -> heuristic_v1::HeuristicParams {
    heuristic_v1::HeuristicParams {
        threat: Some(threat::ThreatParams::default()),
        dev_cards: Some(devcards::DevCardParams::default()),
        trading: Some(trading::TradeParams::default()),
        denial: Some(denial::DenialParams::default()),
        legacy_valuation,
        ..heuristic_v1::HeuristicParams::default()
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
    use std::fs::File;
    use std::io::{BufWriter, Write};

    use crate::board::{ConversionOptions, SimBoard};
    use crate::game::{GameArena, GameConfig};
    use crate::placement::PlacementKind;
    use crate::policy::heuristic_v1::{self, BUILD_BAND, BuildKind, LegacyValuation};
    use crate::policy::heuristic_v1_trader;
    use crate::rng::{derive_game_seed, mix64};
    use crate::rules::{Buildable, Resource, RuleConfig, TradeConfig};
    use crate::topology::{Layout, Topology};
    use crate::view::{Action, DecisionPhase, ScoredAction, pips};
    use crate::wire::{Coord, TileKind, WireBoard, WireHex, WirePlayer, WirePort};

    use super::{CensusLegacyOverrideGuard, PolicyKind, heuristic_params};

    mod corpus_boardgen {
        use crate as unsettled_engine;

        include!("../../../cli/src/boardgen.rs");
    }

    fn wire_board(topology: &Topology) -> WireBoard {
        let mut tiles = vec![
            TileKind::Wood,
            TileKind::Wood,
            TileKind::Wood,
            TileKind::Wood,
            TileKind::Sheep,
            TileKind::Sheep,
            TileKind::Sheep,
            TileKind::Sheep,
            TileKind::Wheat,
            TileKind::Wheat,
            TileKind::Wheat,
            TileKind::Wheat,
            TileKind::Brick,
            TileKind::Brick,
            TileKind::Brick,
            TileKind::Ore,
            TileKind::Ore,
            TileKind::Ore,
            TileKind::Desert,
        ];
        let mut tokens =
            vec![5, 2, 6, 3, 8, 10, 9, 12, 11, 4, 8, 10, 9, 4, 5, 6, 3, 11].into_iter();
        let hexes = (0..topology.hex_count())
            .map(|hex| {
                let key = topology.hex_key(hex as u8);
                let (q, r) = key.split_once(',').unwrap();
                let tile = tiles.remove(0);
                WireHex {
                    coord: Coord {
                        q: q.parse().unwrap(),
                        r: r.parse().unwrap(),
                    },
                    number_token: (tile != TileKind::Desert)
                        .then(|| f64::from(tokens.next().unwrap())),
                    tile: Some(tile),
                }
            })
            .collect();
        WireBoard {
            schema_version: 1,
            layout: Layout::Standard4,
            hexes,
            ports: Vec::new(),
            robber: None,
            roads: Vec::new(),
            buildings: Vec::new(),
            players: (0..4)
                .map(|seat| WirePlayer {
                    id: format!("p{seat}"),
                    name: format!("P{seat}"),
                    color: "red".into(),
                })
                .collect(),
            me_player_id: None,
        }
    }

    fn valuation_fixture() -> (Topology, SimBoard, GameArena) {
        let topology = Topology::load(Layout::Standard4).unwrap();
        let rules = RuleConfig::base(Layout::Standard4);
        let board = SimBoard::try_from_wire(
            wire_board(&topology),
            &topology,
            &rules,
            ConversionOptions::default(),
        )
        .unwrap();
        let mut arena = GameArena::default();
        arena.prepare(&board, &topology, &rules, &GameConfig::default());
        (topology, board, arena)
    }

    fn local_production(board: &SimBoard, topology: &Topology, vertex: u8) -> [u16; 5] {
        let mut production = [0; 5];
        for hex in topology.vertex_hexes(vertex) {
            if let (Some(resource), Some(token)) = (
                board.tiles()[usize::from(*hex)],
                board.tokens()[usize::from(*hex)],
            ) {
                production[resource.index()] += u16::from(pips(token));
            }
        }
        production
    }

    fn port_fixture() -> (Topology, SimBoard, GameArena, u8, u8, Resource, u16) {
        let topology = Topology::load(Layout::Standard4).unwrap();
        let rules = RuleConfig::base(Layout::Standard4);
        let wire = wire_board(&topology);
        let base = SimBoard::try_from_wire(
            wire.clone(),
            &topology,
            &rules,
            ConversionOptions::default(),
        )
        .unwrap();
        let (edge, target, resource, local) = topology
            .coastal_edges()
            .iter()
            .find_map(|edge| {
                topology
                    .edge_endpoints(*edge)
                    .into_iter()
                    .find_map(|vertex| {
                        Resource::ALL.into_iter().find_map(|resource| {
                            let local =
                                local_production(&base, &topology, vertex)[resource.index()];
                            (local > 0).then_some((*edge, vertex, resource, local))
                        })
                    })
            })
            .unwrap();
        let mut wire = wire;
        wire.ports.push(WirePort {
            edge_id: topology.edge_id(edge).to_string(),
            resource: Some(resource),
            rate: 2.0,
        });
        let board =
            SimBoard::try_from_wire(wire, &topology, &rules, ConversionOptions::default()).unwrap();
        let owned = (0..topology.vertex_count())
            .map(|vertex| vertex as u8)
            .find(|vertex| {
                *vertex != target
                    && !topology.vertex_adjacent(target).contains(vertex)
                    && local_production(&board, &topology, *vertex)[resource.index()] > 0
            })
            .unwrap();
        let mut arena = GameArena::default();
        arena.prepare(&board, &topology, &rules, &GameConfig::default());
        (topology, board, arena, target, owned, resource, local)
    }

    fn score_for(actions: &[ScoredAction], predicate: impl Fn(Action) -> bool) -> f32 {
        actions
            .iter()
            .find(|candidate| predicate(candidate.action))
            .map(|candidate| candidate.score)
            .unwrap()
    }

    #[test]
    fn capture_census_and_trace_when_requested() {
        let Ok(prefix) = std::env::var("SIM_BATCH1_CAPTURE_PREFIX") else {
            return;
        };
        let stage = std::env::var("SIM_BATCH1_CAPTURE_STAGE").unwrap();
        assert!(matches!(stage.as_str(), "stage1" | "stage2"));
        let _census_legacy = CensusLegacyOverrideGuard::set(stage == "stage1");
        let mut census = BufWriter::new(File::create(format!("{prefix}-census.txt")).unwrap());
        let mut trace = BufWriter::new(File::create(format!("{prefix}-trace.txt")).unwrap());
        let mut games = BufWriter::new(File::create(format!("{prefix}-games.txt")).unwrap());
        let placements = [
            PlacementKind::MaxPips,
            PlacementKind::PipDiversity,
            PlacementKind::PipScarcity,
            PlacementKind::PortSynergy,
        ];
        let policies = [
            (PolicyKind::HeuristicV1, false),
            (PolicyKind::HeuristicV1Threat, false),
            (PolicyKind::HeuristicV1Devcards, false),
            (PolicyKind::HeuristicV1Trader, true),
            (PolicyKind::HeuristicV1TraderAwareThreatDevcards, false),
            (PolicyKind::PriorityTrader, false),
            (PolicyKind::HeuristicV1Denial, true),
            (PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenial, true),
        ];
        for (layout, seats) in [(Layout::Standard4, 4), (Layout::Extension6, 6)] {
            let topology = Topology::load(layout).unwrap();
            let boards = (0..6)
                .map(|board| {
                    corpus_boardgen::generate_board(layout, seats, mix64(20_260_728 ^ board as u64))
                        .unwrap()
                })
                .collect::<Vec<_>>();
            for (policy, player_trading) in policies {
                let mut rules = RuleConfig::base(layout);
                rules.player_trading = player_trading.then(TradeConfig::default);
                for (board_index, board) in boards.iter().enumerate() {
                    for rep in 0..2 {
                        for rotation in 0..placements.len() {
                            heuristic_v1::reset_crossing_census();
                            heuristic_v1::reset_decision_trace();
                            heuristic_v1_trader::reset_aware_offer_probe();
                            let mut config = GameConfig::default();
                            for seat in 0..seats {
                                config.placements[seat] =
                                    placements[(seat + rotation) % placements.len()];
                                config.policies[seat] = policy;
                            }
                            config.seed =
                                derive_game_seed(20_260_728, board_index as u64, rep as u64);
                            let mut arena = GameArena::default();
                            let result = arena.play(board, &topology, &rules, &config);
                            writeln!(
                                games,
                                "stage={stage} layout={layout:?} policy={policy:?} board={board_index} rep={rep} rotation={rotation} result={result:?}"
                            )
                            .unwrap();
                            for crossing in heuristic_v1::crossing_census() {
                                writeln!(
                                    census,
                                    "stage={stage} layout={layout:?} policy={policy:?} board={board_index} rep={rep} rotation={rotation} variant=base action={:?} score={} old_settlement_score={}",
                                    crossing.action,
                                    crossing.action_score,
                                    crossing.old_settlement_score
                                )
                                .unwrap();
                            }
                            for observation in heuristic_v1_trader::aware_offer_probe() {
                                if observation.score > observation.old_settlement_score {
                                    writeln!(
                                        census,
                                        "stage={stage} layout={layout:?} policy={policy:?} board={board_index} rep={rep} rotation={rotation} variant=aware_offer score={} old_settlement_score={}",
                                        observation.score,
                                        observation.old_settlement_score
                                    )
                                    .unwrap();
                                }
                            }
                            if board_index == 0 && rep == 0 && rotation == 0 {
                                for (decision, observation) in
                                    heuristic_v1::decision_trace().into_iter().enumerate()
                                {
                                    writeln!(
                                        trace,
                                        "stage={stage} layout={layout:?} policy={policy:?} board={board_index} rep={rep} rotation={rotation} decision={decision} seat={} selected={:?} candidates={:?}",
                                        observation.observer,
                                        observation.selected,
                                        observation.candidates
                                    )
                                    .unwrap();
                                }
                            }
                        }
                    }
                }
            }
        }
    }

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
    fn legacy_valuation_maps_every_ablation_kind() {
        let all = LegacyValuation {
            local_port_production: true,
            pip_settlement_goal: true,
            flat_city_goal: true,
            settlement_shaped_city_terms: true,
            band_ladder: true,
            ..LegacyValuation::default()
        };
        for (kind, expected) in [
            (
                PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacyall,
                all,
            ),
            (
                PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacyport,
                LegacyValuation {
                    local_port_production: true,
                    ..LegacyValuation::default()
                },
            ),
            (
                PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacychooser,
                LegacyValuation {
                    pip_settlement_goal: true,
                    ..LegacyValuation::default()
                },
            ),
            (
                PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacycityterms,
                LegacyValuation {
                    settlement_shaped_city_terms: true,
                    ..LegacyValuation::default()
                },
            ),
            (
                PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacyband,
                LegacyValuation {
                    band_ladder: true,
                    ..LegacyValuation::default()
                },
            ),
            (
                PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacycitygoal,
                LegacyValuation {
                    flat_city_goal: true,
                    ..LegacyValuation::default()
                },
            ),
            (
                PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacycards,
                LegacyValuation {
                    narrow_card_plays: true,
                    ..LegacyValuation::default()
                },
            ),
            (
                PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacydeck,
                LegacyValuation {
                    deck_blind_buying: true,
                    ..LegacyValuation::default()
                },
            ),
            (
                PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacyexposure,
                LegacyValuation {
                    exposure_blind: true,
                    ..LegacyValuation::default()
                },
            ),
            (
                PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacyrace,
                LegacyValuation {
                    bounded_race: true,
                    ..LegacyValuation::default()
                },
            ),
        ] {
            assert_eq!(
                heuristic_params(kind).legacy_valuation,
                Some(expected),
                "{kind:?}"
            );
        }

        for (kind, _) in policy_names() {
            if !matches!(
                kind,
                PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacyall
                    | PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacyport
                    | PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacychooser
                    | PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacycityterms
                    | PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacyband
                    | PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacycitygoal
                    | PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacycards
                    | PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacydeck
                    | PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacyexposure
                    | PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacyrace
            ) {
                assert_eq!(
                    heuristic_params(kind).legacy_valuation,
                    None,
                    "{kind:?} must use the shipped valuation"
                );
            }
        }
    }

    #[test]
    fn legacy_valuation_reaches_the_production_scorers() {
        let (topology, board, mut arena, target, owned, resource, local) = port_fixture();
        arena.state.vertex_owner[usize::from(owned)] = 0;
        arena.state.vertex_tier[usize::from(owned)] = 1;
        let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
        for kind in [
            PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacyport,
            PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacyall,
        ] {
            let mut params = heuristic_params(kind);
            params.production_weight = 0.0;
            params.scarcity_weight = 0.0;
            params.diversity_bonus = 0.0;
            params.port_weight = 7.0;
            params.expansion_weight = 0.0;
            let actual = heuristic_v1::vertex_score(&view, target, &params, BuildKind::Settlement);
            let expected = f32::from(local) * (1.0 / 2.0 - 1.0 / 4.0) * params.port_weight;
            assert_eq!(actual.to_bits(), expected.to_bits(), "{kind:?}");
            assert!(view.production_pips(0)[resource.index()] > 0);
        }

        let (topology, board, mut arena) = valuation_fixture();
        let mut vertices = (0..topology.vertex_count())
            .map(|vertex| vertex as u8)
            .collect::<Vec<_>>();
        vertices.sort_by_key(|vertex| {
            local_production(&board, &topology, *vertex)
                .iter()
                .sum::<u16>()
        });
        let score_max = vertices[0];
        let pips_max = *vertices.last().unwrap();
        arena.state.edge_owner[usize::from(topology.vertex_edges(score_max)[0])] = 0;
        arena.state.edge_owner[usize::from(topology.vertex_edges(pips_max)[0])] = 0;
        arena.state.players[0].pieces[Buildable::Road.index()] = 0;
        let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
        let settlement_cost = view.costs(Buildable::Settlement)[0];
        let get = Resource::ALL
            .into_iter()
            .find(|resource| settlement_cost[resource.index()] > 0)
            .unwrap();
        let give = Resource::ALL
            .into_iter()
            .find(|resource| *resource != get)
            .unwrap();
        arena.state.players[0].resources = settlement_cost.map(i16::from);
        arena.state.players[0].resources[get.index()] -= 1;
        arena.state.players[0].resources[give.index()] += 4;
        let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
        let mut chooser =
            heuristic_params(PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacychooser);
        chooser.production_weight = -10.0;
        chooser.scarcity_weight = 0.0;
        chooser.diversity_bonus = 0.0;
        chooser.port_weight = 0.0;
        chooser.expansion_weight = 0.0;
        let chosen = heuristic_v1::vertex_score(&view, pips_max, &chooser, BuildKind::Settlement);
        let expected = 400.0
            + (1.0 + chosen / 20.0)
                / heuristic_v1::turns_to_afford(&view, Buildable::Settlement).max(0.25);
        let actual = score_for(&heuristic_v1::recommend(&view, &chooser), |action| {
            action
                == Action::TradeBank {
                    give,
                    get,
                    count: 1,
                }
        });
        assert_eq!(actual.to_bits(), expected.to_bits());

        let (topology, board, mut arena) = valuation_fixture();
        let low = vertices[0];
        let high = *vertices
            .iter()
            .rev()
            .find(|vertex| !topology.vertex_adjacent(low).contains(vertex))
            .unwrap();
        for vertex in [low, high] {
            arena.state.vertex_owner[usize::from(vertex)] = 0;
            arena.state.vertex_tier[usize::from(vertex)] = 1;
        }
        arena.state.players[0].pieces[Buildable::Settlement.index()] = 0;
        for edge in &mut arena.state.edge_owner {
            *edge = 1;
        }
        let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
        let city_cost = view.costs(Buildable::City)[0];
        let get = Resource::ALL
            .into_iter()
            .find(|resource| city_cost[resource.index()] > 0)
            .unwrap();
        let give = Resource::ALL
            .into_iter()
            .find(|resource| *resource != get)
            .unwrap();
        arena.state.players[0].resources = city_cost.map(i16::from);
        arena.state.players[0].resources[get.index()] -= 1;
        arena.state.players[0].resources[give.index()] += 4;
        let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
        let mut city_goal =
            heuristic_params(PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacycitygoal);
        city_goal.production_weight = 10.0;
        city_goal.scarcity_weight = 0.0;
        city_goal.diversity_bonus = 0.0;
        city_goal.port_weight = 0.0;
        city_goal.expansion_weight = 0.0;
        let expected =
            400.0 + 2.0 / heuristic_v1::turns_to_afford(&view, Buildable::City).max(0.25);
        let actual = score_for(&heuristic_v1::recommend(&view, &city_goal), |action| {
            action
                == Action::TradeBank {
                    give,
                    get,
                    count: 1,
                }
        });
        assert_eq!(actual.to_bits(), expected.to_bits());

        let (topology, board, mut arena) = valuation_fixture();
        let city = (0..topology.vertex_count())
            .map(|vertex| vertex as u8)
            .find(|vertex| topology.vertex_adjacent(*vertex).len() == 3)
            .unwrap();
        arena.state.vertex_owner[usize::from(city)] = 0;
        arena.state.vertex_tier[usize::from(city)] = 1;
        let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
        arena.state.players[0].resources = view.costs(Buildable::City)[0].map(i16::from);
        let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
        let mut city_terms =
            heuristic_params(PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacycityterms);
        city_terms.production_weight = 0.0;
        city_terms.scarcity_weight = 0.0;
        city_terms.diversity_bonus = 0.0;
        city_terms.port_weight = 0.0;
        city_terms.expansion_weight = 100.0;
        let actual = score_for(&heuristic_v1::recommend(&view, &city_terms), |action| {
            action == Action::UpgradeCity(city)
        });
        assert_eq!(actual.to_bits(), (BUILD_BAND + 300.0).to_bits());

        let (topology, board, mut arena) = valuation_fixture();
        let target = 0_u8;
        arena.state.edge_owner[usize::from(topology.vertex_edges(target)[0])] = 0;
        let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
        arena.state.players[0].resources = view.costs(Buildable::Settlement)[0].map(i16::from);
        let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
        let mut band =
            heuristic_params(PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacyband);
        band.production_weight = 0.0;
        band.scarcity_weight = 0.0;
        band.diversity_bonus = 0.0;
        band.port_weight = 0.0;
        band.expansion_weight = 0.0;
        let actual = score_for(&heuristic_v1::recommend(&view, &band), |action| {
            action == Action::BuildSettlement(target)
        });
        assert_eq!(actual.to_bits(), 500.0_f32.to_bits());
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
                PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacyall,
                PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacyport,
                PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacychooser,
                PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacycityterms,
                PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacyband,
                PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacycitygoal,
                PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacycards,
                PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacydeck,
                PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacyexposure,
                PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacyrace,
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
                PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacyall,
                PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacyport,
                PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacychooser,
                PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacycityterms,
                PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacyband,
                PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacycitygoal,
                PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacycards,
                PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacydeck,
                PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacyexposure,
                PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacyrace,
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
                PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacyall,
                PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacyport,
                PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacychooser,
                PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacycityterms,
                PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacyband,
                PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacycitygoal,
                PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacycards,
                PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacydeck,
                PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacyexposure,
                PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacyrace,
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
                PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacyall,
                PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacyport,
                PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacychooser,
                PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacycityterms,
                PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacyband,
                PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacycitygoal,
                PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacycards,
                PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacydeck,
                PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacyexposure,
                PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacyrace,
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

    fn gate_table() -> [(PolicyKind, bool, bool, bool, bool); 38] {
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
            (
                PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacyall,
                true,
                true,
                true,
                true,
            ),
            (
                PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacyport,
                true,
                true,
                true,
                true,
            ),
            (
                PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacychooser,
                true,
                true,
                true,
                true,
            ),
            (
                PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacycityterms,
                true,
                true,
                true,
                true,
            ),
            (
                PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacyband,
                true,
                true,
                true,
                true,
            ),
            (
                PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacycitygoal,
                true,
                true,
                true,
                true,
            ),
            (
                PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacycards,
                true,
                true,
                true,
                true,
            ),
            (
                PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacydeck,
                true,
                true,
                true,
                true,
            ),
            (
                PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacyexposure,
                true,
                true,
                true,
                true,
            ),
            (
                PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacyrace,
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
            (
                PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacyall,
                "heuristic-v1-trader-aware-threat-devcards-denial-legacyall",
            ),
            (
                PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacyport,
                "heuristic-v1-trader-aware-threat-devcards-denial-legacyport",
            ),
            (
                PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacychooser,
                "heuristic-v1-trader-aware-threat-devcards-denial-legacychooser",
            ),
            (
                PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacycityterms,
                "heuristic-v1-trader-aware-threat-devcards-denial-legacycityterms",
            ),
            (
                PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacyband,
                "heuristic-v1-trader-aware-threat-devcards-denial-legacyband",
            ),
            (
                PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacycitygoal,
                "heuristic-v1-trader-aware-threat-devcards-denial-legacycitygoal",
            ),
            (
                PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacycards,
                "heuristic-v1-trader-aware-threat-devcards-denial-legacycards",
            ),
            (
                PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacydeck,
                "heuristic-v1-trader-aware-threat-devcards-denial-legacydeck",
            ),
            (
                PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacyexposure,
                "heuristic-v1-trader-aware-threat-devcards-denial-legacyexposure",
            ),
            (
                PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacyrace,
                "heuristic-v1-trader-aware-threat-devcards-denial-legacyrace",
            ),
        ]
    }

    const POLICY_KIND_COUNT: usize = 38;

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
            PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacyall => 28,
            PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacyport => 29,
            PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacychooser => 30,
            PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacycityterms => 31,
            PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacyband => 32,
            PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacycitygoal => 33,
            PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacycards => 34,
            PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacydeck => 35,
            PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacyexposure => 36,
            PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenialLegacyrace => 37,
        }
    }
}
