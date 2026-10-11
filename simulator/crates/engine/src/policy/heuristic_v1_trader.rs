use crate::etw::{self, EtwInputs};
use crate::policy::PolicyScratch;
use crate::policy::denial;
use crate::policy::heuristic_v1::{self, HeuristicParams, missing_units};
use crate::policy::trading;
use crate::rng::Xoshiro256StarStar;
use crate::rules::Resource;
use crate::state::MAX_SEATS;
use crate::trade::{self, TradeOffer, softened_accept, vp_estimate};
use crate::view::{Action, DecisionPhase, DecisionView, ScoredAction};

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
    if let Some(trading_params) = params.trading.as_ref() {
        let mut best = None;
        score_offers(view, trading_params, |candidate| {
            if candidate.score > base_score
                && best.is_none_or(|(_, best_score)| candidate.score > best_score)
            {
                best = Some((candidate.action, candidate.score));
            }
        });
        return best.map_or(base_action, |(offer, _)| offer);
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
    selected
}

pub(crate) fn score_offers(
    view: &DecisionView<'_>,
    trading_params: &trading::TradeParams,
    mut collect: impl FnMut(ScoredAction),
) {
    let mut recipients: [Option<EtwInputs>; MAX_SEATS] = [const { None }; MAX_SEATS];
    for seat in 0..view.seats() {
        if seat == view.observer() || trade::embargoed(view, seat) {
            continue;
        }
        recipients[seat] = Some(etw::inputs_for_seat(view, seat));
    }
    let own = trading::own_inputs(view);
    let own_base = etw::expected_turns_to_win(&own);
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
                collect(ScoredAction {
                    action: Action::OfferTrade { give, get, count },
                    score,
                });
            }
        }
    }
}

pub fn respond_trade(
    view: &DecisionView<'_>,
    offer: TradeOffer,
    params: &HeuristicParams,
    rng: &mut Xoshiro256StarStar,
) -> bool {
    response_margin(view, offer, params)
        .zip(view.trade_config())
        .is_some_and(|(margin, config)| softened_accept(margin, config.acceptance_temperature, rng))
}

pub(crate) fn response_margin(
    view: &DecisionView<'_>,
    offer: TradeOffer,
    params: &HeuristicParams,
) -> Option<f32> {
    if let Some(trading_params) = params.trading.as_ref() {
        trading::assert_params(trading_params);
    }
    let Some(config) = view.trade_config() else {
        return None;
    };
    if view.phase() != DecisionPhase::TradeResponse
        || offer.proposer == view.observer()
        || view.own_hand()[offer.get.index()] < 1
    {
        return None;
    }
    let denial_context = params
        .denial
        .as_ref()
        .map(|denial_params| denial::context(view, denial_params));
    let gated = denial_context.as_ref().zip(params.denial.as_ref());
    let Some(goal) = heuristic_v1::best_goal(view, params, gated) else {
        return None;
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
    Some(margin)
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
