pub mod devcards;
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
    HeuristicV1Threat,
    HeuristicV1Devcards,
    HeuristicV1ThreatDevcards,
    HeuristicV1Trader,
    HeuristicV1TraderThreat,
    HeuristicV1TraderDevcards,
    HeuristicV1TraderThreatDevcards,
    HeuristicV1TraderAware,
    HeuristicV1TraderAwareThreat,
    HeuristicV1TraderAwareDevcards,
    HeuristicV1TraderAwareThreatDevcards,
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
            | Self::HeuristicV1Threat
            | Self::HeuristicV1Devcards
            | Self::HeuristicV1ThreatDevcards
            | Self::HeuristicV1Trader
            | Self::HeuristicV1TraderThreat
            | Self::HeuristicV1TraderDevcards
            | Self::HeuristicV1TraderThreatDevcards
            | Self::HeuristicV1TraderAware
            | Self::HeuristicV1TraderAwareThreat
            | Self::HeuristicV1TraderAwareDevcards
            | Self::HeuristicV1TraderAwareThreatDevcards => &[],
        }
    }

    pub fn parse(name: &str) -> Option<Self> {
        match name {
            "random-legal" => Some(Self::RandomLegal),
            "greedy-no-trade" => Some(Self::GreedyNoTrade),
            "priority-trader" => Some(Self::PriorityTrader),
            "heuristic-v1" => Some(Self::HeuristicV1),
            "heuristic-v1-noports" => Some(Self::HeuristicV1Noports),
            "heuristic-v1-threat" => Some(Self::HeuristicV1Threat),
            "heuristic-v1-devcards" => Some(Self::HeuristicV1Devcards),
            "heuristic-v1-threat-devcards" => Some(Self::HeuristicV1ThreatDevcards),
            "heuristic-v1-trader" => Some(Self::HeuristicV1Trader),
            "heuristic-v1-trader-threat" => Some(Self::HeuristicV1TraderThreat),
            "heuristic-v1-trader-devcards" => Some(Self::HeuristicV1TraderDevcards),
            "heuristic-v1-trader-threat-devcards" => Some(Self::HeuristicV1TraderThreatDevcards),
            "heuristic-v1-trader-aware" => Some(Self::HeuristicV1TraderAware),
            "heuristic-v1-trader-aware-threat" => Some(Self::HeuristicV1TraderAwareThreat),
            "heuristic-v1-trader-aware-devcards" => Some(Self::HeuristicV1TraderAwareDevcards),
            "heuristic-v1-trader-aware-threat-devcards" => {
                Some(Self::HeuristicV1TraderAwareThreatDevcards)
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
        | PolicyKind::HeuristicV1Threat
        | PolicyKind::HeuristicV1Devcards
        | PolicyKind::HeuristicV1ThreatDevcards => {
            heuristic_v1::pre_roll(view, scratch, &heuristic_params(kind))
        }
        PolicyKind::HeuristicV1Trader
        | PolicyKind::HeuristicV1TraderThreat
        | PolicyKind::HeuristicV1TraderDevcards
        | PolicyKind::HeuristicV1TraderThreatDevcards
        | PolicyKind::HeuristicV1TraderAware
        | PolicyKind::HeuristicV1TraderAwareThreat
        | PolicyKind::HeuristicV1TraderAwareDevcards
        | PolicyKind::HeuristicV1TraderAwareThreatDevcards => {
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
        | PolicyKind::HeuristicV1Threat
        | PolicyKind::HeuristicV1Devcards
        | PolicyKind::HeuristicV1ThreatDevcards => {
            heuristic_v1::action(view, scratch, &heuristic_params(kind), rng)
        }
        PolicyKind::HeuristicV1Trader
        | PolicyKind::HeuristicV1TraderThreat
        | PolicyKind::HeuristicV1TraderDevcards
        | PolicyKind::HeuristicV1TraderThreatDevcards
        | PolicyKind::HeuristicV1TraderAware
        | PolicyKind::HeuristicV1TraderAwareThreat
        | PolicyKind::HeuristicV1TraderAwareDevcards
        | PolicyKind::HeuristicV1TraderAwareThreatDevcards => {
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
        | PolicyKind::HeuristicV1Threat
        | PolicyKind::HeuristicV1Devcards
        | PolicyKind::HeuristicV1ThreatDevcards
        | PolicyKind::HeuristicV1Trader
        | PolicyKind::HeuristicV1TraderThreat
        | PolicyKind::HeuristicV1TraderDevcards
        | PolicyKind::HeuristicV1TraderThreatDevcards
        | PolicyKind::HeuristicV1TraderAware
        | PolicyKind::HeuristicV1TraderAwareThreat
        | PolicyKind::HeuristicV1TraderAwareDevcards
        | PolicyKind::HeuristicV1TraderAwareThreatDevcards => {
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
        PolicyKind::HeuristicV1
        | PolicyKind::HeuristicV1Noports
        | PolicyKind::HeuristicV1Threat
        | PolicyKind::HeuristicV1Devcards
        | PolicyKind::HeuristicV1ThreatDevcards
        | PolicyKind::HeuristicV1Trader
        | PolicyKind::HeuristicV1TraderThreat
        | PolicyKind::HeuristicV1TraderDevcards
        | PolicyKind::HeuristicV1TraderThreatDevcards
        | PolicyKind::HeuristicV1TraderAware
        | PolicyKind::HeuristicV1TraderAwareThreat
        | PolicyKind::HeuristicV1TraderAwareDevcards
        | PolicyKind::HeuristicV1TraderAwareThreatDevcards => {
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
        | PolicyKind::HeuristicV1TraderThreat
        | PolicyKind::HeuristicV1TraderDevcards
        | PolicyKind::HeuristicV1TraderThreatDevcards
        | PolicyKind::HeuristicV1TraderAware
        | PolicyKind::HeuristicV1TraderAwareThreat
        | PolicyKind::HeuristicV1TraderAwareDevcards
        | PolicyKind::HeuristicV1TraderAwareThreatDevcards => {
            heuristic_v1_trader::respond_trade(view, offer, &heuristic_params(kind), rng)
        }
        PolicyKind::RandomLegal
        | PolicyKind::GreedyNoTrade
        | PolicyKind::PriorityTrader
        | PolicyKind::HeuristicV1
        | PolicyKind::HeuristicV1Noports
        | PolicyKind::HeuristicV1Threat
        | PolicyKind::HeuristicV1Devcards
        | PolicyKind::HeuristicV1ThreatDevcards => false,
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
        PolicyKind::HeuristicV1Noports => heuristic_v1::HeuristicParams {
            port_weight: 0.0,
            ..heuristic_v1::HeuristicParams::default()
        },
        PolicyKind::HeuristicV1Threat => heuristic_v1::HeuristicParams {
            threat: Some(threat::ThreatParams::default()),
            ..heuristic_v1::HeuristicParams::default()
        },
        PolicyKind::HeuristicV1Devcards => heuristic_v1::HeuristicParams {
            dev_cards: Some(devcards::DevCardParams::default()),
            ..heuristic_v1::HeuristicParams::default()
        },
        PolicyKind::HeuristicV1ThreatDevcards => heuristic_v1::HeuristicParams {
            threat: Some(threat::ThreatParams::default()),
            dev_cards: Some(devcards::DevCardParams::default()),
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
        PolicyKind::HeuristicV1TraderAwareThreat => heuristic_v1::HeuristicParams {
            threat: Some(threat::ThreatParams::default()),
            trading: Some(trading::TradeParams::default()),
            ..heuristic_v1::HeuristicParams::default()
        },
        PolicyKind::HeuristicV1TraderAwareDevcards => heuristic_v1::HeuristicParams {
            dev_cards: Some(devcards::DevCardParams::default()),
            trading: Some(trading::TradeParams::default()),
            ..heuristic_v1::HeuristicParams::default()
        },
        PolicyKind::HeuristicV1TraderAwareThreatDevcards => heuristic_v1::HeuristicParams {
            threat: Some(threat::ThreatParams::default()),
            dev_cards: Some(devcards::DevCardParams::default()),
            trading: Some(trading::TradeParams::default()),
            ..heuristic_v1::HeuristicParams::default()
        },
        PolicyKind::RandomLegal
        | PolicyKind::GreedyNoTrade
        | PolicyKind::PriorityTrader
        | PolicyKind::HeuristicV1
        | PolicyKind::HeuristicV1Trader => heuristic_v1::HeuristicParams::default(),
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
    fn heuristic_params_maps_every_variant_to_the_intended_gate_triplet() {
        for (kind, threat, dev_cards, trading) in gate_table() {
            let params = heuristic_params(kind);
            assert_eq!(params.threat.is_some(), threat, "{kind:?}");
            assert_eq!(params.dev_cards.is_some(), dev_cards, "{kind:?}");
            assert_eq!(params.trading.is_some(), trading, "{kind:?}");
        }
    }

    #[test]
    fn each_gate_is_enabled_by_exactly_its_intended_variants() {
        let actual = |index: usize| {
            gate_table()
                .into_iter()
                .filter_map(|(kind, threat, dev_cards, trading)| {
                    match index {
                        1 => threat,
                        2 => dev_cards,
                        3 => trading,
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
                PolicyKind::HeuristicV1ThreatDevcards,
                PolicyKind::HeuristicV1TraderThreat,
                PolicyKind::HeuristicV1TraderThreatDevcards,
                PolicyKind::HeuristicV1TraderAwareThreat,
                PolicyKind::HeuristicV1TraderAwareThreatDevcards,
            ]
        );
        assert_eq!(
            actual(2),
            vec![
                PolicyKind::HeuristicV1Devcards,
                PolicyKind::HeuristicV1ThreatDevcards,
                PolicyKind::HeuristicV1TraderDevcards,
                PolicyKind::HeuristicV1TraderThreatDevcards,
                PolicyKind::HeuristicV1TraderAwareDevcards,
                PolicyKind::HeuristicV1TraderAwareThreatDevcards,
            ]
        );
        assert_eq!(
            actual(3),
            vec![
                PolicyKind::HeuristicV1TraderAware,
                PolicyKind::HeuristicV1TraderAwareThreat,
                PolicyKind::HeuristicV1TraderAwareDevcards,
                PolicyKind::HeuristicV1TraderAwareThreatDevcards,
            ]
        );
    }

    #[test]
    fn gate_table_contains_every_policy_kind_exactly_once() {
        let table = gate_table();
        assert_eq!(table.len(), POLICY_KIND_COUNT);
        let mut seen = [false; POLICY_KIND_COUNT];
        for (kind, _, _, _) in table {
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

    fn gate_table() -> [(PolicyKind, bool, bool, bool); 16] {
        [
            (PolicyKind::RandomLegal, false, false, false),
            (PolicyKind::GreedyNoTrade, false, false, false),
            (PolicyKind::PriorityTrader, false, false, false),
            (PolicyKind::HeuristicV1, false, false, false),
            (PolicyKind::HeuristicV1Noports, false, false, false),
            (PolicyKind::HeuristicV1Threat, true, false, false),
            (PolicyKind::HeuristicV1Devcards, false, true, false),
            (PolicyKind::HeuristicV1ThreatDevcards, true, true, false),
            (PolicyKind::HeuristicV1Trader, false, false, false),
            (PolicyKind::HeuristicV1TraderThreat, true, false, false),
            (PolicyKind::HeuristicV1TraderDevcards, false, true, false),
            (
                PolicyKind::HeuristicV1TraderThreatDevcards,
                true,
                true,
                false,
            ),
            (PolicyKind::HeuristicV1TraderAware, false, false, true),
            (PolicyKind::HeuristicV1TraderAwareThreat, true, false, true),
            (
                PolicyKind::HeuristicV1TraderAwareDevcards,
                false,
                true,
                true,
            ),
            (
                PolicyKind::HeuristicV1TraderAwareThreatDevcards,
                true,
                true,
                true,
            ),
        ]
    }

    const POLICY_KIND_COUNT: usize = 16;

    const fn kind_index(kind: PolicyKind) -> usize {
        match kind {
            PolicyKind::RandomLegal => 0,
            PolicyKind::GreedyNoTrade => 1,
            PolicyKind::PriorityTrader => 2,
            PolicyKind::HeuristicV1 => 3,
            PolicyKind::HeuristicV1Noports => 4,
            PolicyKind::HeuristicV1Threat => 5,
            PolicyKind::HeuristicV1Devcards => 6,
            PolicyKind::HeuristicV1ThreatDevcards => 7,
            PolicyKind::HeuristicV1Trader => 8,
            PolicyKind::HeuristicV1TraderThreat => 9,
            PolicyKind::HeuristicV1TraderDevcards => 10,
            PolicyKind::HeuristicV1TraderThreatDevcards => 11,
            PolicyKind::HeuristicV1TraderAware => 12,
            PolicyKind::HeuristicV1TraderAwareThreat => 13,
            PolicyKind::HeuristicV1TraderAwareDevcards => 14,
            PolicyKind::HeuristicV1TraderAwareThreatDevcards => 15,
        }
    }
}
