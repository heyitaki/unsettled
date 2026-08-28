use serde::Serialize;

use crate::etw;
use crate::policy::{threat, trading};
use crate::rng::Xoshiro256StarStar;
use crate::rules::Resource;
use crate::view::DecisionView;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TradeOffer {
    pub proposer: usize,
    pub give: Resource,
    pub get: Resource,
    pub count: u8,
}

pub fn expected_hidden_vp(target_cards: u8, unknown_vp: u8, unknown_pool: u8) -> f64 {
    if unknown_pool == 0 {
        0.0
    } else {
        f64::from(target_cards) * f64::from(unknown_vp) / f64::from(unknown_pool)
    }
}

pub fn conservative_hidden_vp(
    target_cards: u8,
    unknown_vp: u8,
    unknown_pool: u8,
    confidence: f64,
) -> u8 {
    if unknown_pool == 0 {
        return 0;
    }
    let pool = u32::from(unknown_pool);
    let successes = u32::from(unknown_vp).min(pool);
    let draws = u32::from(target_cards).min(pool);
    let upper = draws.min(successes);
    let confidence = confidence.clamp(0.0, 1.0);
    let denominator = combinations(pool, draws);
    let mut cdf = 0.0;
    for hidden in 0..=upper {
        if hidden <= successes && draws - hidden <= pool - successes {
            cdf += combinations(successes, hidden) * combinations(pool - successes, draws - hidden)
                / denominator;
        }
        if cdf >= confidence {
            return hidden as u8;
        }
    }
    upper as u8
}

pub fn expected_hidden_vp_for(view: &DecisionView<'_>, target: usize) -> f64 {
    let own_hidden = view
        .own_total_vp()
        .saturating_sub(view.public_vp(view.observer()));
    if target == view.observer() {
        return f64::from(own_hidden);
    }
    let (pool, victory_points) = posterior_pool(view, own_hidden);
    expected_hidden_vp(view.dev_count(target), victory_points, pool)
}

pub fn conservative_hidden_vp_for(view: &DecisionView<'_>, target: usize, confidence: f64) -> u8 {
    let own_hidden = view
        .own_total_vp()
        .saturating_sub(view.public_vp(view.observer()));
    if target == view.observer() {
        return own_hidden;
    }
    let (pool, victory_points) = posterior_pool(view, own_hidden);
    conservative_hidden_vp(view.dev_count(target), victory_points, pool, confidence)
}

pub fn vp_estimate(view: &DecisionView<'_>, target: usize, confidence: f64) -> u8 {
    view.public_vp(target)
        .saturating_add(conservative_hidden_vp_for(view, target, confidence))
}

/// Whether the table refuses to trade with `seat`.
///
/// The threshold runs on the shared ETW danger model (`threat::danger_from_etw`), the same
/// standing-danger function the robber and trading policies use: a seat expected to win soon
/// is embargoed outright, and a slower one only while it holds an imminent Largest Army or
/// Longest Road swing, which the ETW closed form deliberately excludes. `legacy_vp` restores
/// the pre-danger VP-estimate thresholds for the `-legacyembargo` reference arm.
pub fn embargoed(view: &DecisionView<'_>, seat: usize, legacy_vp: bool) -> bool {
    let Some(config) = view.trade_config() else {
        return false;
    };
    if legacy_vp {
        let estimate = vp_estimate(view, seat, config.hidden_vp_confidence);
        if estimate >= view.win_vp().saturating_sub(1) {
            return true;
        }
        return estimate >= view.win_vp().saturating_sub(2)
            && (view.knight_takes_largest_army_for(seat) || view.road_takes_longest_road(seat));
    }
    debug_assert!(config.embargo_danger_floor.is_finite() && config.embargo_danger_floor > 0.0);
    debug_assert!(config.embargo_danger.is_finite());
    debug_assert!(config.embargo_takeover_danger.is_finite());
    // A seat prices its own embargo from its real hand (the engine's per-seat eligibility
    // pass observes the seat itself); a rival's stands on the belief-derived expectation.
    let inputs = if seat == view.observer() {
        trading::own_inputs(view)
    } else {
        etw::inputs_for_seat(view, seat)
    };
    let danger = threat::danger_from_etw(
        etw::expected_turns_to_win(&inputs),
        config.embargo_danger_floor,
    );
    if danger >= config.embargo_danger {
        return true;
    }
    danger >= config.embargo_takeover_danger
        && (view.knight_takes_largest_army_for(seat) || view.road_takes_longest_road(seat))
}

pub fn acceptance_probability(margin: f32, temperature: f32) -> f32 {
    if temperature <= 0.0 {
        return f32::from(margin > 0.0);
    }
    1.0 / (1.0 + (-margin / temperature).exp())
}

pub fn softened_accept(margin: f32, temperature: f32, rng: &mut Xoshiro256StarStar) -> bool {
    if temperature <= 0.0 {
        return margin > 0.0;
    }
    next_f32(rng) < acceptance_probability(margin, temperature)
}

fn combinations(total: u32, chosen: u32) -> f64 {
    if chosen > total {
        return 0.0;
    }
    let chosen = chosen.min(total - chosen);
    (1..=chosen).fold(1.0, |value, index| {
        value * f64::from(total - chosen + index) / f64::from(index)
    })
}

fn posterior_pool(view: &DecisionView<'_>, own_hidden: u8) -> (u8, u8) {
    let other_cards = (0..view.seats())
        .filter(|seat| *seat != view.observer())
        .map(|seat| view.dev_count(seat))
        .fold(0_u8, u8::saturating_add);
    (
        view.dev_deck_remaining().saturating_add(other_cards),
        view.dev_victory_points().saturating_sub(own_hidden),
    )
}

fn next_f32(rng: &mut Xoshiro256StarStar) -> f32 {
    (rng.next_u64() >> 40) as f32 / 16_777_216.0
}
