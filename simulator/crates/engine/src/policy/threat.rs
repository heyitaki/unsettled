use serde::{Deserialize, Serialize};

use crate::etw::{self, EtwInputs};
use crate::rules::RESOURCE_COUNT;
use crate::state::MAX_SEATS;
use crate::view::{DecisionView, pips};

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ThreatParams {
    /// Finite weight on the fractional ETW delay a block imposes on an opponent.
    pub delay_weight: f64,
    /// Finite weight on blocked production matching the opponent's nearest-build shortfall.
    pub need_weight: f64,
    /// Finite weight on raw blocked production, independent of danger.
    pub block_weight: f64,
    /// Finite weight on the best available victim rank.
    pub steal_weight: f64,
    /// Finite weight on victim hand size inside the victim rank.
    pub victim_hand_weight: f64,
    /// Positive, finite turns added before ETW is inverted into danger.
    pub danger_floor: f64,
    /// Non-negative, finite upper bound on fractional delay, in horizons.
    pub delay_cap: f64,
    /// Positive, finite hand size at which the victim hand term saturates.
    pub hand_cap: f64,
}

impl Default for ThreatParams {
    fn default() -> Self {
        Self {
            delay_weight: 1.0,
            need_weight: 0.35,
            block_weight: 0.25,
            steal_weight: 0.02,
            victim_hand_weight: 0.15,
            danger_floor: 1.0,
            delay_cap: 4.0,
            hand_cap: 8.0,
        }
    }
}

/// Fixed-size state precomputed once per robber decision.
#[derive(Clone, Debug)]
pub struct ThreatContext {
    pub inputs: [Option<EtwInputs>; MAX_SEATS],
    pub free_pips: [[u16; RESOURCE_COUNT]; MAX_SEATS],
    pub etw_free: [f64; MAX_SEATS],
    /// Normalized to the most dangerous opponent in this decision.
    pub danger: [f64; MAX_SEATS],
    pub need: [[f64; RESOURCE_COUNT]; MAX_SEATS],
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ThreatTerms {
    pub delay: f64,
    pub need: f64,
    pub block: f64,
    pub steal: f64,
}

impl ThreatTerms {
    const ZERO: Self = Self {
        delay: 0.0,
        need: 0.0,
        block: 0.0,
        steal: 0.0,
    };
}

pub fn robber(view: &DecisionView<'_>, params: &ThreatParams) -> (u8, Option<u8>) {
    let context = context(view, params);
    let mut best = view.robber();
    let mut best_score = f64::NEG_INFINITY;
    for hex in 0..view.topology().hex_count() {
        let hex = hex as u8;
        if hex == view.robber() || view.hex_touches_seat(hex, view.observer()) {
            continue;
        }
        let mut score = 0.0;
        let mut best_steal = 0.0_f64;
        for seat in 0..view.seats() {
            if seat == view.observer() {
                continue;
            }
            let terms = seat_terms(view, params, &context, hex, seat);
            score += terms.delay + terms.need + terms.block;
            best_steal = best_steal.max(terms.steal);
        }
        score += best_steal;
        if !score.is_finite() {
            continue;
        }
        if score > best_score {
            best = hex;
            best_score = score;
        }
    }
    if best == view.robber() {
        best = (0..view.topology().hex_count())
            .map(|hex| hex as u8)
            .find(|hex| *hex != view.robber())
            .expect("board has another hex");
    }

    let mut victim = None;
    let mut best_rank = f64::NEG_INFINITY;
    for seat in 0..view.seats() {
        if seat == view.observer() || !view.stealable_on_hex(best, seat) {
            continue;
        }
        let rank = victim_rank(view, params, &context, seat);
        if rank > best_rank {
            victim = Some(seat as u8);
            best_rank = rank;
        }
    }
    (best, victim)
}

/// Tier-weighted production pips a seat earns from one unblocked hex.
pub fn hex_contribution(view: &DecisionView<'_>, hex: u8, seat: usize) -> [u16; RESOURCE_COUNT] {
    let mut contribution = [0; RESOURCE_COUNT];
    let (Some(resource), Some(token)) = (
        view.board().tiles()[usize::from(hex)],
        view.board().tokens()[usize::from(hex)],
    ) else {
        return contribution;
    };
    for vertex in view.topology().hex_vertices(hex) {
        if view.vertex_owner(*vertex) == Some(seat as u8) {
            contribution[resource.index()] +=
                u16::from(pips(token)) * u16::from(view.vertex_tier(*vertex).max(1));
        }
    }
    contribution
}

pub fn context(view: &DecisionView<'_>, params: &ThreatParams) -> ThreatContext {
    assert_params(params);
    let mut result = ThreatContext {
        inputs: [const { None }; MAX_SEATS],
        free_pips: [[0; RESOURCE_COUNT]; MAX_SEATS],
        etw_free: [0.0; MAX_SEATS],
        danger: [0.0; MAX_SEATS],
        need: [[0.0; RESOURCE_COUNT]; MAX_SEATS],
    };
    let mut raw = [0.0; MAX_SEATS];
    let mut maximum = 0.0_f64;
    for seat in 0..view.seats() {
        if seat == view.observer() {
            continue;
        }
        let mut inputs = etw::inputs_for_seat(view, seat);
        let free_pips = robber_free_production_pips(view, seat);
        inputs.production_pips = free_pips;
        let etw_free = etw::expected_turns_to_win(&inputs);
        raw[seat] = raw_danger(etw_free, params);
        maximum = maximum.max(raw[seat]);
        result.need[seat] = need_share(&inputs);
        result.free_pips[seat] = free_pips;
        result.etw_free[seat] = etw_free;
        result.inputs[seat] = Some(inputs);
    }
    for seat in 0..view.seats() {
        if seat != view.observer() {
            result.danger[seat] = raw[seat] / maximum;
        }
    }
    result
}

pub fn seat_terms(
    view: &DecisionView<'_>,
    params: &ThreatParams,
    context: &ThreatContext,
    hex: u8,
    seat: usize,
) -> ThreatTerms {
    assert_params(params);
    if seat == view.observer() || seat >= view.seats() || !view.victim_on_hex(hex, seat) {
        return ThreatTerms::ZERO;
    }
    let Some(mut inputs) = context.inputs[seat].clone() else {
        return ThreatTerms::ZERO;
    };
    let blocked = hex_contribution(view, hex, seat);
    let mut hypothetical = context.free_pips[seat];
    for resource in 0..RESOURCE_COUNT {
        debug_assert!(hypothetical[resource] >= blocked[resource]);
        hypothetical[resource] -= blocked[resource];
    }
    inputs.production_pips = hypothetical;
    let etw_hypothetical = etw::expected_turns_to_win(&inputs);
    let mut delay = (etw_hypothetical - context.etw_free[seat])
        / (context.etw_free[seat] + params.danger_floor);
    if !delay.is_finite() {
        delay = 0.0;
    } else {
        delay = delay.clamp(0.0, params.delay_cap);
    }
    let block_share = f64::from(blocked.iter().sum::<u16>()) / 36.0;
    let need_share = (0..RESOURCE_COUNT)
        .map(|resource| context.need[seat][resource] * f64::from(blocked[resource]))
        .sum::<f64>()
        / 36.0;
    ThreatTerms {
        delay: context.danger[seat] * params.delay_weight * delay,
        need: context.danger[seat] * params.need_weight * need_share,
        block: params.block_weight * block_share,
        steal: if view.stealable_on_hex(hex, seat) {
            params.steal_weight * victim_rank(view, params, context, seat)
        } else {
            0.0
        },
    }
}

pub fn robber_free_production_pips(view: &DecisionView<'_>, seat: usize) -> [u16; RESOURCE_COUNT] {
    let mut production = view.production_pips(seat);
    let restored = hex_contribution(view, view.robber(), seat);
    for resource in 0..RESOURCE_COUNT {
        production[resource] += restored[resource];
    }
    production
}

pub fn hypothetical_production_pips(
    view: &DecisionView<'_>,
    candidate: u8,
    seat: usize,
) -> [u16; RESOURCE_COUNT] {
    let mut production = robber_free_production_pips(view, seat);
    let blocked = hex_contribution(view, candidate, seat);
    for resource in 0..RESOURCE_COUNT {
        debug_assert!(production[resource] >= blocked[resource]);
        production[resource] -= blocked[resource];
    }
    production
}

fn raw_danger(etw_free: f64, params: &ThreatParams) -> f64 {
    params.danger_floor / (etw_free + params.danger_floor)
}

fn assert_params(params: &ThreatParams) {
    debug_assert!(params.delay_weight.is_finite());
    debug_assert!(params.need_weight.is_finite());
    debug_assert!(params.block_weight.is_finite());
    debug_assert!(params.steal_weight.is_finite());
    debug_assert!(params.victim_hand_weight.is_finite());
    debug_assert!(params.danger_floor.is_finite() && params.danger_floor > 0.0);
    debug_assert!(params.delay_cap.is_finite() && params.delay_cap >= 0.0);
    debug_assert!(params.hand_cap.is_finite() && params.hand_cap > 0.0);
}

fn need_share(inputs: &EtwInputs) -> [f64; RESOURCE_COUNT] {
    let shortfall = cheapest_route_shortfall(inputs);
    let total = shortfall.iter().sum::<f64>();
    if total == 0.0 || !total.is_finite() {
        return [0.0; RESOURCE_COUNT];
    }
    shortfall.map(|value| value / total)
}

/// Raw per-resource shortfall of the route with the smallest total shortfall, over the same
/// three routes `etw::expected_turns_to_win` considers. Zero when no route is available.
pub fn cheapest_route_shortfall(inputs: &EtwInputs) -> [f64; RESOURCE_COUNT] {
    let mut best = None;
    if inputs.pieces_city > 0
        && inputs.settlements_on_board > 0
        && inputs.city_vp > inputs.settlement_vp
        && let Some(cost) = inputs.city_cost
    {
        consider_shortfall(inputs, cost.map(f64::from), &mut best);
    }
    if inputs.pieces_settlement > 0
        && inputs.settlement_vp > 0
        && let (Some(settlement), Some(road)) = (inputs.settlement_cost, inputs.road_cost)
    {
        let cost = std::array::from_fn(|resource| {
            f64::from(settlement[resource]) + etw::ROAD_ALLOWANCE * f64::from(road[resource])
        });
        consider_shortfall(inputs, cost, &mut best);
    }
    if inputs.dev_deck_remaining > 0
        && inputs.dev_victory_points > 0
        && let Some(cost) = inputs.dev_cost
    {
        consider_shortfall(inputs, cost.map(f64::from), &mut best);
    }
    best.map_or([0.0; RESOURCE_COUNT], |(_, shortfall)| shortfall)
}

fn consider_shortfall(
    inputs: &EtwInputs,
    cost: [f64; RESOURCE_COUNT],
    best: &mut Option<(f64, [f64; RESOURCE_COUNT])>,
) {
    let shortfall = std::array::from_fn(|resource| {
        (cost[resource] - inputs.belief_expected[resource]).max(0.0)
    });
    let total = shortfall.iter().sum();
    if best
        .as_ref()
        .is_none_or(|(best_total, _)| total < *best_total)
    {
        *best = Some((total, shortfall));
    }
}

fn victim_rank(
    view: &DecisionView<'_>,
    params: &ThreatParams,
    context: &ThreatContext,
    seat: usize,
) -> f64 {
    context.danger[seat]
        + params.victim_hand_weight * f64::from(view.hand_total(seat)).min(params.hand_cap)
            / params.hand_cap
}
