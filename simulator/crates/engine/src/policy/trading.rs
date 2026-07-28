//! Shared opponent-value model for player trading.
//!
//! The parameter defaults are unswept Phase-H placeholders.

use serde::{Deserialize, Serialize};

use crate::etw::{self, EtwInputs};
use crate::policy::threat;
use crate::rules::{RESOURCE_COUNT, TradeConfig};
use crate::trade::TradeOffer;
use crate::view::DecisionView;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct TradeParams {
    /// Finite weight on the fractional ETW improvement a resource delta buys a seat.
    pub etw_weight: f64,
    /// Positive, finite turns added before an ETW improvement becomes a fraction.
    pub etw_floor: f64,
    /// Non-negative, finite bound on the fractional ETW term in both directions.
    pub gain_cap: f64,
    /// Finite weight on the bounded marginal-value term.
    pub tempo_weight: f64,
    /// Positive, finite marginal value at which the tempo term reaches half its bound.
    pub tempo_half: f64,
    /// Positive, finite per-roll income floor used to price scarce resources.
    pub scarcity_floor: f64,
    /// Positive, finite turns added before ETW is inverted into standing danger.
    pub danger_floor: f64,
    /// Finite weight on a counterparty's standing danger.
    pub danger_weight: f64,
    /// Finite weight on what the offer buys the counterparty.
    pub benefit_weight: f64,
    /// Positive, finite multiplier on the whole acceptance margin.
    pub margin_scale: f64,
    /// Finite weight on recipient gain when the proposer scores offers.
    pub offer_gain_weight: f64,
    /// Finite score a neutral gated offer competes with other actions at.
    pub offer_base: f32,
    /// Finite action-score span for one unit of net offer value.
    pub offer_span: f32,
}

impl Default for TradeParams {
    fn default() -> Self {
        Self {
            etw_weight: 1.0,
            etw_floor: 1.0,
            gain_cap: 4.0,
            tempo_weight: 0.20,
            tempo_half: 4.0,
            scarcity_floor: 0.25,
            danger_floor: 1.0,
            danger_weight: 0.5,
            benefit_weight: 0.5,
            margin_scale: 6.0,
            offer_gain_weight: 1.0,
            offer_base: 350.0,
            offer_span: 100.0,
        }
    }
}

pub fn acceptance_margin(
    view: &DecisionView<'_>,
    params: &TradeParams,
    config: &TradeConfig,
    offer: TradeOffer,
) -> f32 {
    assert_params(params);
    let own = own_inputs(view);
    let proposer = etw::inputs_for_seat(view, offer.proposer);
    let mine = trade_benefit(&own, params, &responder_delta(offer));
    let theirs = counterparty_score(&proposer, params, &proposer_delta(offer));
    (params.margin_scale * (mine - f64::from(config.opponent_gain_weight) * theirs)) as f32
}

pub fn counterparty_score(
    inputs: &EtwInputs,
    params: &TradeParams,
    delta: &[f64; RESOURCE_COUNT],
) -> f64 {
    assert_params(params);
    let base = etw::expected_turns_to_win(inputs);
    params.danger_weight * threat::danger_from_etw(base, params.danger_floor)
        + params.benefit_weight * trade_benefit_with_base(inputs, params, delta, base)
}

pub fn own_inputs(view: &DecisionView<'_>) -> EtwInputs {
    let mut inputs = etw::inputs_for_seat(view, view.observer());
    inputs.belief_expected =
        std::array::from_fn(|resource| f64::from(view.own_hand()[resource].max(0)));
    inputs
}

pub fn proposer_delta(offer: TradeOffer) -> [f64; RESOURCE_COUNT] {
    let mut delta = [0.0; RESOURCE_COUNT];
    delta[offer.give.index()] -= f64::from(offer.count);
    delta[offer.get.index()] += 1.0;
    delta
}

pub fn responder_delta(offer: TradeOffer) -> [f64; RESOURCE_COUNT] {
    let mut delta = [0.0; RESOURCE_COUNT];
    delta[offer.give.index()] += f64::from(offer.count);
    delta[offer.get.index()] -= 1.0;
    delta
}

pub fn select_counterparty(
    view: &DecisionView<'_>,
    params: &TradeParams,
    delta: &[f64; RESOURCE_COUNT],
    acceptors: &[usize],
) -> usize {
    assert_params(params);
    let mut best = *acceptors
        .first()
        .expect("counterparty selection requires an acceptor");
    let mut best_score = f64::INFINITY;
    for seat in acceptors {
        let score = counterparty_score(&etw::inputs_for_seat(view, *seat), params, delta);
        if !score.is_finite() {
            continue;
        }
        if score < best_score {
            best_score = score;
            best = *seat;
        }
    }
    best
}

pub fn trade_benefit(
    inputs: &EtwInputs,
    params: &TradeParams,
    delta: &[f64; RESOURCE_COUNT],
) -> f64 {
    assert_params(params);
    trade_benefit_with_base(inputs, params, delta, etw::expected_turns_to_win(inputs))
}

pub fn trade_benefit_with_base(
    inputs: &EtwInputs,
    params: &TradeParams,
    delta: &[f64; RESOURCE_COUNT],
    base: f64,
) -> f64 {
    assert_params(params);
    let mut probe = inputs.clone();
    probe.belief_expected = std::array::from_fn(|resource| {
        (inputs.belief_expected[resource] + delta[resource]).max(0.0)
    });
    let after = etw::expected_turns_to_win(&probe);
    let raw = (base - after) / (base + params.etw_floor);
    let gain = if raw.is_finite() {
        raw.clamp(-params.gain_cap, params.gain_cap)
    } else {
        0.0
    };

    let need = threat::cheapest_route_shortfall(inputs);
    let mut useful = 0.0;
    for resource in 0..RESOURCE_COUNT {
        let income = f64::from(inputs.production_pips[resource]) / 36.0;
        useful += delta[resource] * (1.0 + need[resource]) / (income + params.scarcity_floor);
    }
    let tempo = if useful.is_finite() {
        useful / (useful.abs() + params.tempo_half)
    } else {
        0.0
    };

    params.etw_weight * gain + params.tempo_weight * tempo
}

pub(crate) fn assert_params(params: &TradeParams) {
    debug_assert!(params.etw_weight.is_finite());
    debug_assert!(params.etw_floor.is_finite() && params.etw_floor > 0.0);
    debug_assert!(params.gain_cap.is_finite() && params.gain_cap >= 0.0);
    debug_assert!(params.tempo_weight.is_finite());
    debug_assert!(params.tempo_half.is_finite() && params.tempo_half > 0.0);
    debug_assert!(params.scarcity_floor.is_finite() && params.scarcity_floor > 0.0);
    debug_assert!(params.danger_floor.is_finite() && params.danger_floor > 0.0);
    debug_assert!(params.danger_weight.is_finite());
    debug_assert!(params.benefit_weight.is_finite());
    debug_assert!(params.margin_scale.is_finite() && params.margin_scale > 0.0);
    debug_assert!(params.offer_gain_weight.is_finite());
    debug_assert!(params.offer_base.is_finite());
    debug_assert!(params.offer_span.is_finite());
}

#[cfg(test)]
mod tests {
    use super::{TradeParams, counterparty_score, trade_benefit, trade_benefit_with_base};
    use crate::etw::{self, EtwInputs};
    use crate::policy::threat::{self, ThreatParams};
    use crate::rules::RESOURCE_COUNT;

    fn inputs(hand: [f64; RESOURCE_COUNT]) -> EtwInputs {
        EtwInputs {
            win_vp: 10,
            public_vp: 5,
            dev_count: 1,
            all_seats_dev_count_sum: 5,
            dev_deck_remaining: 20,
            dev_victory_points: 5,
            production_pips: [8, 5, 9, 6, 4],
            pieces_settlement: 3,
            pieces_city: 3,
            settlements_on_board: 2,
            settlement_cost: Some([1, 1, 1, 1, 0]),
            city_cost: Some([0, 0, 2, 0, 3]),
            road_cost: Some([1, 0, 0, 1, 0]),
            dev_cost: Some([0, 1, 1, 0, 1]),
            settlement_vp: 1,
            city_vp: 2,
            trade_rates: [4; RESOURCE_COUNT],
            belief_expected: hand,
            hand_total: hand.iter().sum::<f64>() as u32,
        }
    }

    #[test]
    fn danger_extraction_is_bit_identical_to_the_previous_expression() {
        let mut state = 0x6a09_e667_f3bc_c909_u64;
        for index in 0..200_000 {
            state = state
                .wrapping_mul(6_364_136_223_846_793_005)
                .wrapping_add(1_442_695_040_888_963_407);
            let etw = match index % 10_000 {
                0 => f64::INFINITY,
                1 => f64::NAN,
                2 => 0.0,
                _ => (state >> 11) as f64 / (1_u64 << 53) as f64 * 1.0e12,
            };
            state = state
                .wrapping_mul(6_364_136_223_846_793_005)
                .wrapping_add(1_442_695_040_888_963_407);
            let floor =
                ((state >> 11) as f64 / (1_u64 << 53) as f64).max(f64::MIN_POSITIVE) * 1.0e6;
            let previous = floor / (etw + floor);
            assert_eq!(
                threat::danger_from_etw(etw, floor).to_bits(),
                previous.to_bits(),
                "index={index}"
            );
        }
    }

    #[test]
    fn trade_and_threat_danger_floors_default_together() {
        assert_eq!(
            TradeParams::default().danger_floor,
            ThreatParams::default().danger_floor
        );
    }

    #[test]
    fn zero_delta_has_exactly_zero_benefit() {
        assert_eq!(
            trade_benefit(
                &inputs([1.0, 2.0, 3.0, 4.0, 5.0]),
                &TradeParams::default(),
                &[0.0; RESOURCE_COUNT],
            ),
            0.0
        );
    }

    #[test]
    fn tempo_orders_deltas_inside_an_etw_plateau() {
        let inputs = inputs([100.0; RESOURCE_COUNT]);
        let first = [-1.0, 0.0, 0.0, 0.0, 1.0];
        let second = [0.0, -1.0, 0.0, 1.0, 0.0];
        let base = etw::expected_turns_to_win(&inputs);
        for delta in [&first, &second] {
            let mut probe = inputs.clone();
            probe.belief_expected =
                std::array::from_fn(|resource| inputs.belief_expected[resource] + delta[resource]);
            assert_eq!(etw::expected_turns_to_win(&probe), base);
        }
        let first = trade_benefit(&inputs, &TradeParams::default(), &first);
        let second = trade_benefit(&inputs, &TradeParams::default(), &second);
        assert_ne!(first, 0.0);
        assert_ne!(first, second);
    }

    #[test]
    fn strictly_harmful_delta_has_negative_benefit() {
        let params = TradeParams {
            tempo_weight: 0.0,
            ..TradeParams::default()
        };
        let value = trade_benefit(
            &inputs([1.0, 0.0, 0.0, 0.0, 0.0]),
            &params,
            &[-1.0, 0.0, 0.0, 0.0, 0.0],
        );
        assert!(value < 0.0, "value={value}");
    }

    #[test]
    fn overdraft_is_clamped_before_etw() {
        let mut fractional = inputs([0.4, 0.0, 0.0, 0.0, 0.0]);
        fractional.production_pips = [8, 0, 0, 0, 0];
        fractional.pieces_city = 0;
        fractional.city_cost = None;
        fractional.dev_deck_remaining = 0;
        fractional.dev_cost = None;
        fractional.settlement_cost = Some([2, 0, 0, 0, 0]);
        fractional.road_cost = Some([0; RESOURCE_COUNT]);
        let mut empty = fractional.clone();
        empty.belief_expected[0] = 0.0;
        let delta = [-2.0, 0.0, 0.0, 0.0, 0.0];
        let params = TradeParams {
            tempo_weight: 0.0,
            ..TradeParams::default()
        };
        let base = etw::expected_turns_to_win(&empty);
        let first = trade_benefit_with_base(&fractional, &params, &delta, base);
        let second = trade_benefit_with_base(&empty, &params, &delta, base);
        assert!(first.is_finite());
        assert_eq!(first, second);
    }

    #[test]
    fn signed_tempo_map_has_no_negative_pole() {
        let inputs = inputs([100.0; RESOURCE_COUNT]);
        let delta = [-1.0, 0.0, 0.0, 0.0, 0.0];
        let mut params = TradeParams {
            etw_weight: 0.0,
            ..TradeParams::default()
        };
        let need = threat::cheapest_route_shortfall(&inputs);
        let income = f64::from(inputs.production_pips[0]) / 36.0;
        params.tempo_half = (1.0 + need[0]) / (income + params.scarcity_floor);
        let value = trade_benefit(&inputs, &params, &delta);
        assert!(value.is_finite());
        assert!(value < 0.0, "value={value}");
    }

    #[test]
    fn counterparty_score_reads_the_trade_danger_floor() {
        let inputs = inputs([1.0, 2.0, 3.0, 4.0, 5.0]);
        let first = counterparty_score(
            &inputs,
            &TradeParams {
                danger_floor: 1.0,
                ..TradeParams::default()
            },
            &[0.0; RESOURCE_COUNT],
        );
        let second = counterparty_score(
            &inputs,
            &TradeParams {
                danger_floor: 4.0,
                ..TradeParams::default()
            },
            &[0.0; RESOURCE_COUNT],
        );
        assert_ne!(first, second);
    }
}
