use std::cell::RefCell;

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
    view.with_etw_cache(|view| cached_score_offers(view, trading_params, collect));
}

struct OfferInputs {
    own: EtwInputs,
    recipients: [Option<EtwInputs>; MAX_SEATS],
}

impl OfferInputs {
    fn new(view: &DecisionView<'_>) -> Self {
        let mut recipients = [const { None }; MAX_SEATS];
        for seat in 0..view.seats() {
            if seat != view.observer() && !trade::embargoed(view, seat) {
                recipients[seat] = Some(view.etw_inputs(seat));
            }
        }
        Self { own: trading::own_inputs(view), recipients }
    }

    fn same(&self, other: &Self) -> bool {
        let same = |a: &EtwInputs, b: &EtwInputs| {
            a == b && a.belief_expected.map(f64::to_bits) == b.belief_expected.map(f64::to_bits)
        };
        same(&self.own, &other.own) && self.recipients.iter().zip(&other.recipients)
            .all(|(a, b)| match (a, b) {
                (Some(a), Some(b)) => same(a, b),
                (None, None) => true,
                _ => false,
            })
    }
}

struct OfferMemo {
    inputs: OfferInputs,
    parameters: [u64; 13],
    observer: usize,
    scores: [ScoredAction; 40],
    len: usize,
}

std::thread_local! {
    static OFFER_MEMO: RefCell<Option<OfferMemo>> = const { RefCell::new(None) };
}

fn cached_score_offers(
    view: &DecisionView<'_>,
    params: &trading::TradeParams,
    mut collect: impl FnMut(ScoredAction),
) {
    let inputs = OfferInputs::new(view);
    // Destructured with no rest pattern, so a parameter added to the struct cannot be left out of the key.
    let trading::TradeParams {
        etw_weight, etw_floor, gain_cap, tempo_weight, tempo_half, scarcity_floor, danger_floor,
        danger_weight, benefit_weight, margin_scale, offer_gain_weight, offer_base, offer_span,
    } = *params;
    let parameters = [
        etw_weight.to_bits(), etw_floor.to_bits(), gain_cap.to_bits(),
        tempo_weight.to_bits(), tempo_half.to_bits(), scarcity_floor.to_bits(),
        danger_floor.to_bits(), danger_weight.to_bits(), benefit_weight.to_bits(),
        margin_scale.to_bits(), offer_gain_weight.to_bits(),
        u64::from(offer_base.to_bits()), u64::from(offer_span.to_bits()),
    ];
    let mut memo = OFFER_MEMO.with(|cell| cell.borrow_mut().take());
    if memo.as_ref().is_none_or(|cached| {
        cached.observer != view.observer() || cached.parameters != parameters
            || !cached.inputs.same(&inputs)
    }) {
        let mut scores = [ScoredAction { action: Action::Pass, score: 0.0 }; 40];
        let mut len = 0;
        score_offers_prepared(view, params, &inputs, |score| {
            scores[len] = score;
            len += 1;
        });
        memo = Some(OfferMemo { inputs, parameters, observer: view.observer(), scores, len });
    }
    let cached = memo.as_ref().unwrap();
    #[cfg(any(debug_assertions, test))]
    {
        let mut index = 0;
        score_offers_inner(view, params, |score| {
            assert_eq!(cached.scores[index].action, score.action);
            assert_eq!(cached.scores[index].score.to_bits(), score.score.to_bits());
            index += 1;
        });
        assert_eq!(cached.len, index);
    }
    for score in &cached.scores[..cached.len] {
        collect(*score);
    }
    OFFER_MEMO.with(|cell| *cell.borrow_mut() = memo);
}

fn can_score_offers(view: &DecisionView<'_>) -> bool {
    // Mirrors legal_offer_trade's offer-independent clauses to avoid unused ETW preparation.
    view.phase() == DecisionPhase::Action
        && view.trade_config().is_some()
        && view.offers_remaining_this_turn() > 0
        && view.seats() >= 2
        && view.own_hand().iter().any(|held| *held > 0)
}

#[cfg(any(debug_assertions, test))]
fn score_offers_inner(
    view: &DecisionView<'_>,
    trading_params: &trading::TradeParams,
    collect: impl FnMut(ScoredAction),
) {
    let inputs = OfferInputs::new(view);
    score_offers_prepared(view, trading_params, &inputs, collect);
}

fn score_offers_prepared(
    view: &DecisionView<'_>,
    trading_params: &trading::TradeParams,
    inputs: &OfferInputs,
    mut collect: impl FnMut(ScoredAction),
) {
    let own = &inputs.own;
    let recipients = &inputs.recipients;
    let own_estimate = view.etw_estimate(view.observer());
    let own_base = own_estimate.with_hand(&own.belief_expected);
    let own_value = trading::TradeValue::new(own, trading_params, own_estimate, own_base);
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
    fn offer_scores_match_direct_bits_with_distinct_hands_and_rivals() {
        let (topology, board, mut arena) = crate::etw::tests::fixture();
        let params = trading::TradeParams::default();
        for resource in Resource::ALL {
            for held in [3, 6, 9] {
                arena.state.players[0].resources = [0; crate::rules::RESOURCE_COUNT];
                arena.state.players[0].resources[resource.index()] = held;
                for seat in 0..board.seats() {
                    arena.state.players[seat].vp_public = seat as u8 + 2;
                    arena.state.players[seat].playable_dev = [0; crate::state::DEV_KIND_COUNT];
                    arena.state.players[seat].bought_dev = [0; crate::state::DEV_KIND_COUNT];
                    arena.state.players[seat].pieces[1] = 4;
                    arena.state.players[seat].pieces[2] = 4;
                    arena.state.belief.set_known_hand(seat, [1; crate::rules::RESOURCE_COUNT], seat as u16);
                }
                arena.state.belief.set_known_hand(0, [0; crate::rules::RESOURCE_COUNT], held as u16);
                let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
                let mut own = crate::etw::compute_inputs_for_seat(&view, view.observer());
                let belief = own.belief_expected;
                own.belief_expected = view.own_hand().map(|amount| f64::from(amount.max(0)));
                assert_ne!(own.belief_expected, belief);
                assert_ne!(view.public_vp(1), view.public_vp(2));
                let base = crate::etw::expected_turns_to_win(&own);
                let recipients: Vec<_> = (0..view.seats()).map(|seat| {
                    if seat == view.observer() || trade::embargoed(&view, seat) {
                        None
                    } else {
                        Some(crate::etw::compute_inputs_for_seat(&view, seat))
                    }
                }).collect();
                let mut direct = Vec::new();
                let mut priced = [false; MAX_SEATS];
                for give in Resource::ALL {
                    for get in Resource::ALL {
                        for count in [1, 2] {
                            if !view.legal_offer_trade(give, get, count) { continue; }
                            let offer = TradeOffer { proposer: view.observer(), give, get, count };
                            let mine = trading::trade_benefit_with_base(
                                &own, &params, &trading::proposer_delta(offer), base,
                            );
                            if mine <= 0.0 { continue; }
                            let mut theirs = None;
                            for (seat, inputs) in recipients.iter().enumerate() {
                                let Some(inputs) = inputs else { continue; };
                                if inputs.belief_expected[get.index()] < 1.0 { continue; }
                                let score = trading::counterparty_score(
                                    inputs, &params, &trading::responder_delta(offer),
                                );
                                priced[seat] = true;
                                if !score.is_finite() { continue; }
                                if theirs.is_none_or(|current| score < current) {
                                    theirs = Some(score);
                                }
                            }
                            let Some(theirs) = theirs else { continue; };
                            let net = mine - params.offer_gain_weight * theirs;
                            direct.push((Action::OfferTrade { give, get, count },
                                (params.offer_base + params.offer_span * net as f32).to_bits()));
                        }
                    }
                }
                let mut actual = Vec::new();
                score_offers(&view, &params, |scored| {
                    actual.push((scored.action, scored.score.to_bits()));
                });
                assert!(!actual.is_empty(), "resource={resource:?} held={held}");
                assert!(priced[1..view.seats()].iter().filter(|priced| **priced).count() >= 2);
                assert_eq!(actual, direct, "resource={resource:?} held={held}");
            }
        }
    }
}

#[cfg(test)]
mod offer_memo_tests {
    use super::*;

    #[test]
    fn offer_memo_tracks_hands_recipients_parameters_and_observer() {
        let (topology, board, mut arena) = crate::etw::tests::fixture();
        let mut params = trading::TradeParams::default();
        let mut nonempty = 0;
        for seat in 0..board.seats() {
            arena.state.players[seat].vp_public = 2;
            arena.state.players[seat].pieces[1] = 4;
            arena.state.players[seat].pieces[2] = 4;
            arena.state.players[seat].resources = [3; 5];
            arena.state.belief.set_known_hand(seat, [2; 5], 3);
        }
        for variant in 0..48 {
            let seat = variant % board.seats();
            match variant % 4 {
                0 => arena.state.players[seat].resources[variant % 5] = (variant % 7) as i16,
                1 => arena.state.belief.gain(seat, variant % 5, 1),
                2 => params.offer_span += 0.25,
                _ => arena.state.players[seat].vp_public = (variant % 10) as u8,
            }
            for observer in [0, 1, 0] {
                let view = arena.decision_view(&board, &topology, observer, DecisionPhase::Action);
                for _ in 0..2 {
                    let mut expected = Vec::new();
                    score_offers_inner(&view, &params, |offer| {
                        expected.push((offer.action, offer.score.to_bits()));
                    });
                    let mut actual = Vec::new();
                    score_offers(&view, &params, |offer| {
                        actual.push((offer.action, offer.score.to_bits()));
                    });
                    nonempty += usize::from(!actual.is_empty());
                    assert_eq!(actual, expected);
                }
            }
        }
        assert!(nonempty > 0);
    }
}
