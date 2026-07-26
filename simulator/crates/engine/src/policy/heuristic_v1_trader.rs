use crate::policy::PolicyScratch;
use crate::policy::heuristic_v1::{self, HeuristicParams, missing_units};
use crate::rng::Xoshiro256StarStar;
use crate::rules::Resource;
use crate::trade::{TradeOffer, softened_accept, vp_estimate};
use crate::view::{Action, DecisionPhase, DecisionView};

pub fn action(
    view: &DecisionView<'_>,
    scratch: &mut PolicyScratch,
    rng: &mut Xoshiro256StarStar,
) -> Action {
    let params = HeuristicParams::default();
    let (base_action, goal) = heuristic_v1::action_with_goal(view, scratch, &params, rng);
    let base_score = scratch
        .actions
        .as_slice()
        .iter()
        .map(|candidate| candidate.score)
        .fold(f32::NEG_INFINITY, f32::max);
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
    best.map_or(base_action, |(offer, _)| offer)
}

pub fn respond_trade(
    view: &DecisionView<'_>,
    offer: TradeOffer,
    rng: &mut Xoshiro256StarStar,
) -> bool {
    let Some(config) = view.trade_config() else {
        return false;
    };
    if view.phase() != DecisionPhase::TradeResponse
        || offer.proposer == view.observer()
        || view.own_hand()[offer.get.index()] < 1
    {
        return false;
    }
    let params = HeuristicParams::default();
    let Some(goal) = heuristic_v1::best_goal(view, &params) else {
        return false;
    };
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
    let margin = mine - config.opponent_gain_weight * theirs;
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
