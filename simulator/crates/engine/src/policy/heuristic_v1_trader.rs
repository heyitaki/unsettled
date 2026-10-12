use crate::etw::EtwInputs;
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
    if params.trading.is_some() && can_score_offers(view) {
        view.with_etw_cache(|view| action_inner(view, scratch, params, rng))
    } else {
        action_inner(view, scratch, params, rng)
    }
}

fn action_inner(
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
    collect: impl FnMut(ScoredAction),
) {
    if !can_score_offers(view) {
        return;
    }
    view.with_etw_cache(|view| score_offers_inner(view, trading_params, collect));
}

fn can_score_offers(view: &DecisionView<'_>) -> bool {
    // Mirrors legal_offer_trade's offer-independent clauses to avoid unused ETW preparation.
    view.phase() == DecisionPhase::Action
        && view.trade_config().is_some()
        && view.offers_remaining_this_turn() > 0
        && view.seats() >= 2
        && view.own_hand().iter().any(|held| *held > 0)
}

fn score_offers_inner(
    view: &DecisionView<'_>,
    trading_params: &trading::TradeParams,
    mut collect: impl FnMut(ScoredAction),
) {
    let mut recipients: [Option<EtwInputs>; MAX_SEATS] = [const { None }; MAX_SEATS];
    for seat in 0..view.seats() {
        if seat == view.observer() || trade::embargoed(view, seat) {
            continue;
        }
        recipients[seat] = Some(view.etw_inputs(seat));
    }
    let own = trading::own_inputs(view);
    let own_estimate = view.etw_estimate(view.observer());
    let own_base = own_estimate.with_hand(&own.belief_expected);
    let own_value = trading::TradeValue::new(&own, trading_params, own_estimate, own_base);
    let mut values: [Option<trading::TradeValue<'_>>; MAX_SEATS] = [const { None }; MAX_SEATS];
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
                let mine = own_value.benefit(
                    &trading::proposer_delta(offer),
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
                    let value = values[seat].get_or_insert_with(|| trading::TradeValue::new(
                        inputs, trading_params, view.etw_estimate(seat), view.etw_for_seat(seat),
                    ));
                    let score = value.counterparty_score(&responder);
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
    if let Some(trading_params) = params.trading.as_ref() {
        // ETW prices the offer independently of which building goal ranks first.
        return heuristic_v1::has_goal(view, params)
            .then(|| trading::acceptance_margin(view, trading_params, &config, offer));
    }
    let denial_context = params
        .denial
        .as_ref()
        .map(|denial_params| denial::context(view, denial_params));
    let gated = denial_context.as_ref().zip(params.denial.as_ref());
    let Some(goal) = heuristic_v1::best_goal(view, params, gated) else {
        return None;
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
    Some(mine - config.opponent_gain_weight * theirs)
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
    use super::{score_offers, score_offers_inner, trading};
    use crate::view::{DecisionPhase, DecisionView};
    use crate::board::{ConversionOptions, SimBoard};
    use crate::game::{GameArena, GameConfig};
    use crate::rules::{RuleConfig, TradeConfig};
    use crate::topology::{Layout, Topology};
    use crate::wire::WireBoard;

    #[test]
    fn offer_preflight_matches_direct_score_bits() {
        let topology = Topology::load(Layout::Extension6).unwrap();
        let mut rules = RuleConfig::base(Layout::Extension6);
        let wire = WireBoard::parse_str(include_str!(
            "../../../../../src/parser/__tests__/expected/board-draft-empty.json"
        )).unwrap();
        let board = SimBoard::try_from_wire(
            wire, &topology, &rules, ConversionOptions::default(),
        ).unwrap();
        let mut arena = GameArena::default();
        let config = GameConfig::default();
        let params = trading::TradeParams::default();
        let mut outcomes = [0; 2];
        for trading in [None, Some(TradeConfig::default())] {
            rules.player_trading = trading;
            arena.play(&board, &topology, &rules, &config);
            for hand in [[0; 5], [1; 5], [3, 0, 1, 2, 4], [0, 0, 0, 0, 2]] {
                arena.state.players[0].resources = hand;
                for remaining in [0, 1, 2] {
                    for phase in [
                        DecisionPhase::Action,
                        DecisionPhase::SpecialBuild,
                        DecisionPhase::TradeResponse,
                    ] {
                        let all_rules = std::array::from_fn(|seat| *arena.flattened_rules(seat));
                        let view = DecisionView::new(
                            &arena.state, &board, &topology, arena.flattened_rules(0),
                            &all_rules,
                            0, board.seats(), 10, false, remaining, phase,
                        );
                        let mut direct = Vec::new();
                        score_offers_inner(&view, &params, |candidate| {
                            direct.push((candidate.action, candidate.score.to_bits()));
                        });
                        let mut actual = Vec::new();
                        score_offers(&view, &params, |candidate| {
                            actual.push((candidate.action, candidate.score.to_bits()));
                        });
                        outcomes[usize::from(!direct.is_empty())] += 1;
                        assert_eq!(actual, direct);
                    }
                }
            }
        }
        assert!(outcomes.into_iter().all(|count| count > 0));
    }
}

#[cfg(test)]
mod cache_tests {
    use super::*;

    #[test]
    fn action_etw_cache_matches_direct_bits() {
        let (topology, board, mut arena) = crate::etw::tests::fixture();
        let params = HeuristicParams {
            trading: Some(trading::TradeParams::default()),
            denial: Some(denial::DenialParams::default()),
            ..HeuristicParams::default()
        };
        for held in 0..6 {
            arena.state.players[0].resources = [held; crate::rules::RESOURCE_COUNT];
            for seat in 0..board.seats() {
                arena.state.players[seat].vp_public = (held as u8 + seat as u8) % 8;
            }
            for phase in [DecisionPhase::Action, DecisionPhase::SpecialBuild] {
                let view = arena.decision_view(&board, &topology, 0, phase);
                let mut actual = PolicyScratch::default();
                let mut direct = PolicyScratch::default();
                let mut rng = Xoshiro256StarStar::from_seed(held as u64);
                let mut direct_rng = rng.clone();
                assert_eq!(action(&view, &mut actual, &params, &mut rng),
                    action_inner(&view, &mut direct, &params, &mut direct_rng));
                assert_eq!(actual.actions.as_slice().len(), direct.actions.as_slice().len());
                for (a, b) in actual.actions.as_slice().iter().zip(direct.actions.as_slice()) {
                    assert_eq!(a.action, b.action);
                    assert_eq!(a.score.to_bits(), b.score.to_bits());
                }
            }
        }
    }
}
