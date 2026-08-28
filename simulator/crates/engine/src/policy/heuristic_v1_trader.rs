use crate::etw::{self, EtwInputs};
use crate::policy::PolicyScratch;
use crate::policy::denial;
use crate::policy::heuristic_v1::{self, HeuristicParams, missing_units};
use crate::policy::trading;
use crate::rng::Xoshiro256StarStar;
use crate::rules::Resource;
use crate::state::MAX_SEATS;
use crate::trade::{self, TradeOffer, softened_accept, vp_estimate};
use crate::view::{Action, DecisionPhase, DecisionView};

#[cfg(test)]
#[derive(Clone, Copy, Debug)]
pub(crate) struct AwareOfferObservation {
    pub offer: TradeOffer,
    pub score: f32,
    pub old_settlement_score: f32,
}

#[cfg(test)]
std::thread_local! {
    static AWARE_OFFER_PROBE: std::cell::RefCell<Vec<AwareOfferObservation>> =
        const { std::cell::RefCell::new(Vec::new()) };
}

pub fn action(
    view: &DecisionView<'_>,
    scratch: &mut PolicyScratch,
    params: &HeuristicParams,
    rng: &mut Xoshiro256StarStar,
) -> Action {
    if let Some(trading_params) = params.trading.as_ref() {
        trading::assert_params(trading_params);
    }
    let (base_action, goal) = heuristic_v1::action_with_goal(view, scratch, params, rng);
    let base_score = scratch
        .actions
        .as_slice()
        .iter()
        .map(|candidate| candidate.score)
        .fold(f32::NEG_INFINITY, f32::max);
    #[cfg(test)]
    let old_settlement_score =
        heuristic_v1::old_band_settlement_score(view, params, &scratch.actions);
    if let Some(trading_params) = params.trading.as_ref() {
        let legacy_embargo = params
            .legacy_valuation
            .is_some_and(|legacy| legacy.vp_embargo);
        let mut recipients: [Option<EtwInputs>; MAX_SEATS] = [const { None }; MAX_SEATS];
        for seat in 0..view.seats() {
            if seat == view.observer() || trade::embargoed(view, seat, legacy_embargo) {
                continue;
            }
            recipients[seat] = Some(etw::inputs_for_seat(view, seat));
        }
        let own = trading::own_inputs(view);
        let own_base = etw::expected_turns_to_win(&own);
        let mut best = None;
        for give in Resource::ALL {
            for get in Resource::ALL {
                for count in [1, 2] {
                    if !view.legal_offer_trade(give, get, count) {
                        continue;
                    }
                    let offer = TradeOffer {
                        proposer: view.observer(),
                        give,
                        get,
                        count,
                    };
                    let mine = trading::trade_benefit_with_base(
                        &own,
                        trading_params,
                        &trading::proposer_delta(offer),
                        own_base,
                    );
                    if mine <= 0.0 {
                        continue;
                    }
                    let responder = trading::responder_delta(offer);
                    let mut theirs = None;
                    for seat in 0..view.seats() {
                        let Some(inputs) = recipients[seat].as_ref() else {
                            continue;
                        };
                        if inputs.belief_expected[get.index()] < 1.0 {
                            continue;
                        }
                        let score = trading::counterparty_score(inputs, trading_params, &responder);
                        if !score.is_finite() {
                            continue;
                        }
                        if theirs.is_none_or(|current| score < current) {
                            theirs = Some(score);
                        }
                    }
                    let Some(theirs) = theirs else {
                        continue;
                    };
                    let net = mine - trading_params.offer_gain_weight * theirs;
                    let score = trading_params.offer_base + trading_params.offer_span * net as f32;
                    #[cfg(test)]
                    if let Some(old_settlement_score) = old_settlement_score {
                        AWARE_OFFER_PROBE.with(|observations| {
                            observations.borrow_mut().push(AwareOfferObservation {
                                offer,
                                score,
                                old_settlement_score,
                            });
                        });
                    }
                    if score > base_score && best.is_none_or(|(_, best_score)| score > best_score) {
                        best = Some((Action::OfferTrade { give, get, count }, score));
                    }
                }
            }
        }
        let selected = best.map_or(base_action, |(offer, _)| offer);
        #[cfg(test)]
        heuristic_v1::replace_last_trace_selected(selected);
        return selected;
    }
    let Some(goal) = goal else {
        return base_action;
    };
    let before = best_missing(view, goal.kind, view.own_hand());
    let mut best = None;
    for give in Resource::ALL {
        for get in Resource::ALL {
            for count in [1, 2] {
                if !view.legal_offer_trade(give, get, count) {
                    continue;
                }
                let mut hand = *view.own_hand();
                hand[give.index()] -= i16::from(count);
                hand[get.index()] += 1;
                let after = best_missing(view, goal.kind, &hand);
                if after >= before {
                    continue;
                }
                let score = if after == 0 {
                    450.0 + goal.score
                } else {
                    350.0 + goal.score
                };
                if score > base_score && best.is_none_or(|(_, best_score)| score > best_score) {
                    best = Some((Action::OfferTrade { give, get, count }, score));
                }
            }
        }
    }
    let selected = best.map_or(base_action, |(offer, _)| offer);
    #[cfg(test)]
    heuristic_v1::replace_last_trace_selected(selected);
    selected
}

#[cfg(test)]
pub(crate) fn reset_aware_offer_probe() {
    AWARE_OFFER_PROBE.with(|observations| observations.borrow_mut().clear());
}

#[cfg(test)]
pub(crate) fn aware_offer_probe() -> Vec<AwareOfferObservation> {
    AWARE_OFFER_PROBE.with(|observations| observations.borrow().clone())
}

pub fn respond_trade(
    view: &DecisionView<'_>,
    offer: TradeOffer,
    params: &HeuristicParams,
    rng: &mut Xoshiro256StarStar,
) -> bool {
    if let Some(trading_params) = params.trading.as_ref() {
        trading::assert_params(trading_params);
    }
    let Some(config) = view.trade_config() else {
        return false;
    };
    if view.phase() != DecisionPhase::TradeResponse
        || offer.proposer == view.observer()
        || view.own_hand()[offer.get.index()] < 1
    {
        return false;
    }
    let denial_context = params
        .denial
        .as_ref()
        .map(|denial_params| denial::context(view, denial_params));
    let gated = denial_context.as_ref().zip(params.denial.as_ref());
    let Some(goal) = heuristic_v1::best_goal(view, params, gated) else {
        return false;
    };
    let margin = match &params.trading {
        None => {
            let before = best_missing(view, goal.kind, view.own_hand());
            let mut hand = *view.own_hand();
            hand[offer.give.index()] += i16::from(offer.count);
            hand[offer.get.index()] -= 1;
            let after = best_missing(view, goal.kind, &hand);
            let mine = f32::from(before.saturating_sub(after));
            let theirs = (f32::from(vp_estimate(
                view,
                offer.proposer,
                config.hidden_vp_confidence,
            )) / f32::from(view.win_vp()))
            .clamp(0.0, 1.0);
            mine - config.opponent_gain_weight * theirs
        }
        Some(trading_params) => trading::acceptance_margin(view, trading_params, &config, offer),
    };
    softened_accept(margin, config.acceptance_temperature, rng)
}

fn best_missing(
    view: &DecisionView<'_>,
    goal: crate::rules::Buildable,
    hand: &[i16; crate::rules::RESOURCE_COUNT],
) -> u16 {
    view.costs(goal)
        .iter()
        .map(|cost| missing_units(hand, cost))
        .min()
        .unwrap_or(u16::MAX)
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;

    use crate::board::{ConversionOptions, SimBoard};
    use crate::game::{GameArena, GameConfig};
    use crate::policy::PolicyScratch;
    use crate::policy::heuristic_v1::{self, BuildKind, HeuristicParams};
    use crate::policy::trading::{self, TradeParams};
    use crate::rng::Xoshiro256StarStar;
    use crate::rules::{Buildable, Resource, RuleConfig, TradeConfig};
    use crate::topology::{Layout, Topology};
    use crate::trade::{self, TradeOffer};
    use crate::view::DecisionPhase;
    use crate::wire::WireBoard;

    #[test]
    fn aware_offer_probe_records_the_production_score_and_old_settlement_maximum() {
        let topology = Topology::load(Layout::Extension6).unwrap();
        let mut rules = RuleConfig::base(Layout::Extension6);
        rules.player_trading = Some(TradeConfig {
            acceptance_temperature: 0.0,
            ..TradeConfig::default()
        });
        let relative = PathBuf::from("src/parser/__tests__/expected/board-draft-empty.json");
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .ancestors()
            .map(|root| root.join(&relative))
            .find(|candidate| candidate.is_file())
            .expect("board fixture must be reachable from the worktree or sweep root");
        let wire = WireBoard::parse_str(&fs::read_to_string(path).unwrap()).unwrap();
        let board =
            SimBoard::try_from_wire(wire, &topology, &rules, ConversionOptions::default()).unwrap();
        let mut arena = GameArena::default();
        arena.prepare(&board, &topology, &rules, &GameConfig::default());
        let target = topology.vertex_adjacent(0)[0];
        arena.state.edge_owner[usize::from(topology.vertex_edges(target)[0])] = 0;
        let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
        arena.state.players[0].resources = view.costs(Buildable::Settlement)[0].map(i16::from);
        arena.state.players[0].resources[Resource::Wood.index()] += 3;
        for resource in Resource::ALL {
            arena.state.players[1].resources[resource.index()] = 2;
            arena.state.belief.gain(1, resource.index(), 2);
        }
        let params = HeuristicParams {
            trading: Some(TradeParams {
                offer_base: 731.0,
                offer_span: 19.0,
                ..TradeParams::default()
            }),
            ..HeuristicParams::default()
        };
        let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
        super::reset_aware_offer_probe();
        let mut scratch = PolicyScratch::default();
        let mut rng = Xoshiro256StarStar::from_seed(11);
        super::action(&view, &mut scratch, &params, &mut rng);
        let observations = super::aware_offer_probe();
        assert!(!observations.is_empty());

        let expected_settlement = (0..topology.vertex_count())
            .map(|vertex| vertex as u8)
            .filter(|vertex| view.legal_settlement(*vertex))
            .map(|vertex| {
                500.0 + heuristic_v1::vertex_score(&view, vertex, &params, BuildKind::Settlement)
            })
            .fold(f32::NEG_INFINITY, f32::max);
        let trade_params = params.trading.as_ref().unwrap();
        let own = trading::own_inputs(&view);
        let own_base = crate::etw::expected_turns_to_win(&own);
        for observation in observations {
            let TradeOffer { get, .. } = observation.offer;
            let mine = trading::trade_benefit_with_base(
                &own,
                trade_params,
                &trading::proposer_delta(observation.offer),
                own_base,
            );
            let responder = trading::responder_delta(observation.offer);
            let theirs = (0..view.seats())
                .filter(|seat| *seat != view.observer() && !trade::embargoed(&view, *seat, false))
                .map(|seat| crate::etw::inputs_for_seat(&view, seat))
                .filter(|inputs| inputs.belief_expected[get.index()] >= 1.0)
                .map(|inputs| trading::counterparty_score(&inputs, trade_params, &responder))
                .filter(|score| score.is_finite())
                .fold(f64::INFINITY, f64::min);
            let net = mine - trade_params.offer_gain_weight * theirs;
            let expected_score = trade_params.offer_base + trade_params.offer_span * net as f32;
            assert_eq!(observation.score.to_bits(), expected_score.to_bits());
            assert_eq!(
                observation.old_settlement_score.to_bits(),
                expected_settlement.to_bits()
            );
        }
    }
}
