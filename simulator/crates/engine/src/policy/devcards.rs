//! Belief-driven pre-roll development-card valuation.
//!
//! Every candidate uses one commensurate scalar:
//! `etw_weight * gain + tempo_weight * tempo + completion`. `gain` is the fractional
//! improvement in the observer's own expected turns to win, while `tempo` is a bounded,
//! strictly monotone measure of trade-adjusted useful cards. This is the same shape of two
//! weighted terms in one scalar used by `threat::seat_terms`.
//!
//! Both terms are necessary on the pinned reference. `etw::route_etw` caps resource credit at
//! `cards_per_vp`. On ten realistic mid-game hands at public VP 5, five produced bit-identical
//! ETW gains across all five candidate deltas: four at exactly `0.0`, one at exactly
//! `0.018947368421052633`. An ETW-only scalar therefore recreates the ladder through source
//! order. Tempo ranks candidates on that plateau, including an eight-card monopoly above a
//! two-card Year of Plenty when ETW cannot distinguish them.
//!
//! Defaults assume a four-seat `standard4` mid-game under base rules, with ETW roughly in the
//! 5-35 turn band. Outside the plateau, ETW leads: from an empty hand, Year of Plenty
//! (sheep+wheat, two cards) scores `0.1071` against Road Building (four cards) at `0.0723`.
//! Inside the plateau, tempo orders larger deltas above smaller ones. With `tempo_weight` 0.20
//! and `tempo_half` 4.0, tempo can also flip an ETW-preferred order when the ETW gap is below
//! about 0.01 and the card gap is at least two: at `[1,1,1,1,0]`, ETW alone prefers Year of
//! Plenty (`0.0429` versus `0.0343`), while the combined score prefers Road Building (`0.0743`
//! versus `0.0651`). Both regimes are intentional.
//!
//! Only Monopoly can be held, structurally. Year of Plenty always yields two cards and Road
//! Building always yields two roads, while Monopoly's yield grows with opponent holdings.
//! Round 2 measured 629 of 75,000 states where a weight-based version deferred a fixed-size
//! card by margins near 1e-5; this rule makes that count zero by construction.
//!
//! Gain always uses the deciding turn's fixed `etw_now + etw_floor` denominator. It is never
//! recomputed from a projected hand, so deferral cannot win because its denominator shrank.
//!
//! With `hold_discount` 0.95 and opponent growth `pips / 36 * seats`, Hold never won outside
//! the ETW plateau over sixteen measured cells on `[1,1,1,1,0]`. It won fifteen of sixteen
//! cells on each of `[0,0,2,0,3]` and `[2,2,2,2,2]`, where gain is zero and tempo values trade
//! currency. Hold still has to beat every current offer: on `[0,0,2,0,3]`, haul 1, and 12
//! opponent pips, Monopoly scores `0.011764706`, Hold `0.017924528`, and Road Building
//! `0.040000000`, so Road Building is played. The plateau ends when the affordable build is
//! taken.
//!
//! Hand-size risk is priced through the shared exposure model (`policy::exposure`): a play
//! resolves before the dice, so every card it adds faces the observer's own imminent roll. Each
//! candidate is charged `exposure_weight` times the growth in expected seven loss over that one
//! roll — Monopoly generally adds far more cards than Year of Plenty, so it is deferred more
//! often, which is the asymmetry the exposure-blind model conceded. Hold and Road Building add
//! no cards and carry no charge.
//!
//! The soundness split is: the belief estimate ranks, the belief lower bound gates.
//! `belief.expected` apportions the unknown pool, while only `belief.lo` is guaranteed. A
//! Monopoly is offered only when its guaranteed haul clears `monopoly_sound_floor`, and only
//! guaranteed cards can claim same-turn completion, while candidate ordering uses the estimate.
//!
//! Knights deliberately remain outside this comparison. Holding preserves the turn's single
//! development-card play for the action-phase knight branch, so knight availability is part of
//! the timing decision being measured.
//!
//! Completion is card-specific. Only Year of Plenty and Monopoly add cards to hand. Road
//! Building lays roads and cannot make a settlement or city payable.
//!
//! All weights are unswept Phase-H placeholders.

use serde::{Deserialize, Serialize};

use crate::etw::{self, EtwInputs};
use crate::policy::{exposure, threat};
use crate::rules::{RESOURCE_COUNT, Resource};
use crate::view::{DecisionView, DevPlay, can_pay};

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct DevCardParams {
    /// Finite weight on the fractional own-ETW improvement a play buys.
    pub etw_weight: f64,
    /// Positive, finite turns added to own ETW before an improvement is turned into a fraction.
    pub etw_floor: f64,
    /// Non-negative, finite cap on the fractional ETW gain one play may claim.
    pub gain_cap: f64,
    /// Finite bonus for a play that makes the current goal affordable this turn on cards the
    /// belief lower bound guarantees.
    pub completion_weight: f64,
    /// Non-negative, finite multiplier on the Monopoly candidate deferred one full round.
    pub hold_discount: f64,
    /// Non-negative, finite share of one round of opponent production credited to a monopoly
    /// deferred one round.
    pub haul_growth: f64,
    /// Non-negative, finite guaranteed haul below which a monopoly is not offered.
    pub monopoly_sound_floor: f64,
    /// Finite weight on the bounded tempo term.
    pub tempo_weight: f64,
    /// Positive, finite useful-card value at which tempo reaches half its maximum.
    pub tempo_half: f64,
    /// Non-negative, finite charge per expected card the observer's own imminent roll would
    /// take from the hand a play leaves behind. Zero restores the exposure-blind comparison.
    pub exposure_weight: f64,
}

impl Default for DevCardParams {
    fn default() -> Self {
        Self {
            etw_weight: 1.0,
            etw_floor: 1.0,
            gain_cap: 4.0,
            completion_weight: 0.35,
            hold_discount: 0.95,
            haul_growth: 0.5,
            monopoly_sound_floor: 1.0,
            tempo_weight: 0.20,
            tempo_half: 4.0,
            exposure_weight: 0.05,
        }
    }
}

/// Fixed-size state precomputed once per pre-roll decision. No heap fields.
#[derive(Clone, Debug)]
pub struct DevCardContext {
    /// Observer ETW inputs with belief hand replaced by the exact own hand.
    pub inputs: EtwInputs,
    /// Own ETW as things stand.
    pub etw_now: f64,
    /// Own exact hand as non-negative floating-point counts.
    pub own: [f64; RESOURCE_COUNT],
    /// Own expected cards gained over one full round.
    pub own_round_income: [f64; RESOURCE_COUNT],
    /// Estimated total opponent holding per resource. Ranks, never gates.
    pub haul_expected: [f64; RESOURCE_COUNT],
    /// Guaranteed total opponent holding per resource. Gates, never ranks.
    pub haul_sound: [f64; RESOURCE_COUNT],
    /// Estimated opponent production per resource over one full round.
    pub haul_round_growth: [f64; RESOURCE_COUNT],
}

/// What the caller may legally play this turn, with concrete proposed plays.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct DevOffers {
    pub plenty: Option<(Resource, Resource)>,
    pub monopoly: bool,
    pub road: Option<(Option<u8>, Option<u8>)>,
}

/// One candidate's play and its full production score. `None` is Hold.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ScoredDevPlay {
    pub play: Option<DevPlay>,
    pub score: f64,
}

/// Everything one pre-roll decision computed. Slot zero is always Hold.
#[derive(Clone, Debug)]
pub struct DevCandidates {
    pub context: DevCardContext,
    pub scored: [Option<ScoredDevPlay>; 4],
}

pub fn context(view: &DecisionView<'_>, params: &DevCardParams) -> DevCardContext {
    assert_params(params);
    let mut inputs = etw::inputs_for_seat(view, view.observer());
    let own = std::array::from_fn(|resource| f64::from(view.own_hand()[resource].max(0)));
    inputs.belief_expected = own;
    let etw_now = etw::expected_turns_to_win(&inputs);
    let rolls = view.seats() as f64;
    let own_pips = view.production_pips(view.observer());
    let own_round_income =
        std::array::from_fn(|resource| f64::from(own_pips[resource]) / 36.0 * rolls);
    let mut haul_expected = [0.0; RESOURCE_COUNT];
    let mut haul_sound = [0.0; RESOURCE_COUNT];
    let mut haul_round_growth = [0.0; RESOURCE_COUNT];
    for seat in 0..view.seats() {
        if seat == view.observer() {
            continue;
        }
        let expected = view.belief().expected(seat);
        let sound = view.belief().lo(seat);
        let pips = view.production_pips(seat);
        for resource in 0..RESOURCE_COUNT {
            haul_expected[resource] += expected[resource];
            haul_sound[resource] += f64::from(sound[resource]);
            haul_round_growth[resource] += f64::from(pips[resource]) / 36.0 * rolls;
        }
    }
    DevCardContext {
        inputs,
        etw_now,
        own,
        own_round_income,
        haul_expected,
        haul_sound,
        haul_round_growth,
    }
}

pub fn gain(
    context: &DevCardContext,
    params: &DevCardParams,
    base_hand: &[f64; RESOURCE_COUNT],
    base_etw: f64,
    delta: &[f64; RESOURCE_COUNT],
) -> f64 {
    assert_params(params);
    let mut inputs = context.inputs.clone();
    inputs.belief_expected = std::array::from_fn(|resource| base_hand[resource] + delta[resource]);
    let after = etw::expected_turns_to_win(&inputs);
    let raw = (base_etw - after) / (context.etw_now + params.etw_floor);
    if !raw.is_finite() {
        0.0
    } else {
        raw.clamp(0.0, params.gain_cap)
    }
}

pub fn tempo(
    context: &DevCardContext,
    params: &DevCardParams,
    base_hand: &[f64; RESOURCE_COUNT],
    delta: &[f64; RESOURCE_COUNT],
) -> f64 {
    assert_params(params);
    let mut inputs = context.inputs.clone();
    inputs.belief_expected = *base_hand;
    let need = threat::cheapest_route_shortfall(&inputs);
    let mut useful = 0.0;
    for resource in 0..RESOURCE_COUNT {
        let direct = delta[resource].min(need[resource]);
        let surplus = (delta[resource] - need[resource]).max(0.0);
        let rate = context.inputs.trade_rates[resource];
        useful += direct
            + if rate == 0 {
                surplus
            } else {
                surplus / f64::from(rate)
            };
    }
    useful / (useful + params.tempo_half)
}

pub fn monopoly_resource(
    context: &DevCardContext,
    params: &DevCardParams,
    base_hand: &[f64; RESOURCE_COUNT],
    base_etw: f64,
    haul: &[f64; RESOURCE_COUNT],
) -> Option<(Resource, f64)> {
    assert_params(params);
    let mut best = None;
    for resource in Resource::ALL {
        let index = resource.index();
        if context.haul_sound[index] < params.monopoly_sound_floor {
            continue;
        }
        let mut delta = [0.0; RESOURCE_COUNT];
        delta[index] = haul[index];
        let score = params.etw_weight * gain(context, params, base_hand, base_etw, &delta)
            + params.tempo_weight * tempo(context, params, base_hand, &delta);
        if !score.is_finite() {
            continue;
        }
        if best.is_none_or(|(_, best_score)| score > best_score) {
            best = Some((resource, score));
        }
    }
    best
}

pub fn score_candidates(
    view: &DecisionView<'_>,
    params: &DevCardParams,
    offers: DevOffers,
    goal_cost: Option<[u8; RESOURCE_COUNT]>,
) -> DevCandidates {
    assert_params(params);
    let context = context(view, params);
    let mut scored = [const { None }; 4];

    // Cards a play adds face the observer's own imminent roll before they can be spent, so
    // each candidate is charged the growth in expected seven loss over that single roll. The
    // charge uses the estimated Monopoly haul because it ranks rather than gates.
    let hand_total = view.hand_total(view.observer());
    let threshold = view.discard_threshold();
    let exposure_now = exposure::expected_seven_loss(hand_total, threshold, 1);
    let seven_charge = |added: u32| {
        params.exposure_weight
            * (exposure::expected_seven_loss(hand_total.saturating_add(added), threshold, 1)
                - exposure_now)
    };

    let monopoly = offers.monopoly.then(|| {
        monopoly_resource(
            &context,
            params,
            &context.own,
            context.etw_now,
            &context.haul_expected,
        )
        .map(|(resource, base_score)| {
            let mut guaranteed = [0_u8; RESOURCE_COUNT];
            guaranteed[resource.index()] = context.haul_sound[resource.index()]
                .floor()
                .clamp(0.0, f64::from(u8::MAX)) as u8;
            let added = context.haul_expected[resource.index()]
                .floor()
                .clamp(0.0, f64::from(u16::MAX)) as u32;
            ScoredDevPlay {
                play: Some(DevPlay::Monopoly { resource }),
                score: base_score + completion(view, params, goal_cost, &guaranteed)
                    - seven_charge(added),
            }
        })
    });
    scored[2] = monopoly.flatten();

    let hold_score = if scored[2].is_some() {
        let projected_own = std::array::from_fn(|resource| {
            context.own[resource] + context.own_round_income[resource]
        });
        let mut projected_inputs = context.inputs.clone();
        projected_inputs.belief_expected = projected_own;
        let projected_etw = etw::expected_turns_to_win(&projected_inputs);
        let projected_haul = std::array::from_fn(|resource| {
            context.haul_expected[resource]
                + params.haul_growth * context.haul_round_growth[resource]
        });
        monopoly_resource(
            &context,
            params,
            &projected_own,
            projected_etw,
            &projected_haul,
        )
        .map_or(0.0, |(_, score)| params.hold_discount * score)
    } else {
        0.0
    };
    scored[0] = Some(ScoredDevPlay {
        play: None,
        score: hold_score,
    });

    if let Some((first, second)) = offers.plenty {
        let mut delta = [0.0; RESOURCE_COUNT];
        let mut delta_int = [0_u8; RESOURCE_COUNT];
        delta[first.index()] += 1.0;
        delta[second.index()] += 1.0;
        delta_int[first.index()] += 1;
        delta_int[second.index()] += 1;
        scored[1] = Some(ScoredDevPlay {
            play: Some(DevPlay::YearOfPlenty { first, second }),
            score: params.etw_weight
                * gain(&context, params, &context.own, context.etw_now, &delta)
                + params.tempo_weight * tempo(&context, params, &context.own, &delta)
                + completion(view, params, goal_cost, &delta_int)
                - seven_charge(2),
        });
    }

    if let Some((first, second)) = offers.road
        && first.is_some()
    {
        let segments = 1 + usize::from(second.is_some());
        let delta = context
            .inputs
            .road_cost
            .map_or([0.0; RESOURCE_COUNT], |cost| {
                cost.map(|value| f64::from(value) * segments as f64)
            });
        scored[3] = Some(ScoredDevPlay {
            play: Some(DevPlay::RoadBuilding { first, second }),
            score: params.etw_weight
                * gain(&context, params, &context.own, context.etw_now, &delta)
                + params.tempo_weight * tempo(&context, params, &context.own, &delta),
        });
    }

    DevCandidates { context, scored }
}

pub fn pre_roll_choice(
    view: &DecisionView<'_>,
    params: &DevCardParams,
    offers: DevOffers,
    goal_cost: Option<[u8; RESOURCE_COUNT]>,
) -> Option<DevPlay> {
    assert_params(params);
    if offers.plenty.is_none() && !offers.monopoly && offers.road.is_none() {
        return None;
    }
    let candidates = score_candidates(view, params, offers, goal_cost);
    let mut best: Option<ScoredDevPlay> = None;
    for slot in candidates.scored.iter().flatten() {
        if !slot.score.is_finite() {
            continue;
        }
        if best.is_none_or(|current| slot.score > current.score) {
            best = Some(*slot);
        }
    }
    best.and_then(|winner| winner.play)
}

fn completion(
    view: &DecisionView<'_>,
    params: &DevCardParams,
    goal_cost: Option<[u8; RESOURCE_COUNT]>,
    delta: &[u8; RESOURCE_COUNT],
) -> f64 {
    let Some(cost) = goal_cost else {
        return 0.0;
    };
    let hand = *view.own_hand();
    let with_delta = std::array::from_fn(|resource| hand[resource] + i16::from(delta[resource]));
    if !can_pay(&hand, &cost) && can_pay(&with_delta, &cost) {
        params.completion_weight
    } else {
        0.0
    }
}

fn assert_params(params: &DevCardParams) {
    debug_assert!(params.etw_weight.is_finite());
    debug_assert!(params.etw_floor.is_finite() && params.etw_floor > 0.0);
    debug_assert!(params.gain_cap.is_finite() && params.gain_cap >= 0.0);
    debug_assert!(params.completion_weight.is_finite());
    debug_assert!(params.hold_discount.is_finite() && params.hold_discount >= 0.0);
    debug_assert!(params.haul_growth.is_finite() && params.haul_growth >= 0.0);
    debug_assert!(params.monopoly_sound_floor.is_finite() && params.monopoly_sound_floor >= 0.0);
    debug_assert!(params.tempo_weight.is_finite());
    debug_assert!(params.tempo_half.is_finite() && params.tempo_half > 0.0);
    debug_assert!(params.exposure_weight.is_finite() && params.exposure_weight >= 0.0);
}
