//! One hand-size exposure model: what a rolled seven costs this hand.
//!
//! Three consumers share it so the concept cannot drift into independent spellings
//! (the same one-model rule the programme applies to opponent threat):
//!
//! - the discard choice prices which card a forced discard should give up through
//!   [`marginal_conversion_scaled`] (`heuristic_v1::discard`);
//! - the action phase prices a pre-emptive shedding bank/port trade against
//!   [`expected_seven_loss`] over the rolls before the observer acts again
//!   (`heuristic_v1::shed_trade`);
//! - the gated pre-roll development-card comparison prices the cards a play would
//!   add to hand before the observer's own imminent roll
//!   (`devcards::score_candidates`).
//!
//! Only the first seven in a window is priced: it halves the hand to at or below
//! the discard threshold, so later sevens in the same window cost nothing further.
//! The model is deliberately myopic one step — shedding from nine to eight cards
//! prices at zero because both hands discard four — which matches the discrete
//! rule a seven actually applies.

/// Cards a seven forces this hand to discard right now: half, rounded down, once
/// the hand exceeds the rules threshold.
pub fn discard_count(hand_total: u32, discard_threshold: u8) -> u32 {
    if hand_total > u32::from(discard_threshold) {
        hand_total / 2
    } else {
        0
    }
}

/// Probability that at least one seven appears in `rolls` independent two-die rolls.
pub fn seven_chance(rolls: u32) -> f64 {
    1.0 - (5.0_f64 / 6.0).powi(rolls.min(10_000) as i32)
}

/// Expected cards this hand loses to the first seven over the next `rolls` rolls.
pub fn expected_seven_loss(hand_total: u32, discard_threshold: u8, rolls: u32) -> f64 {
    seven_chance(rolls) * f64::from(discard_count(hand_total, discard_threshold))
}

/// Scale of [`marginal_conversion_scaled`]: divisible by every base trade rate
/// (2, 3, 4), so the discrete marginal stays in integers and float ordering never
/// reaches a decision.
pub const CONVERSION_SCALE: u32 = 12;

/// Discrete marginal conversion value of the last card of a resource held `count`
/// times at bank/port `rate`, scaled by [`CONVERSION_SCALE`]. `base_rate` is the
/// observer's worst rate across resources — the rate a card trades at with no
/// port advantage.
///
/// Conversion value is a port phenomenon: at the base rate every card carries the
/// same flat `CONVERSION_SCALE / rate`, so a portless hand ranks purely by goal
/// surplus and bank-rate four-stacks earn no bundle protection (protecting them
/// trades away hand diversity for a marginal trade, which measured as a strength
/// regression). Where a port beats the base rate the discrete marginal applies
/// and oscillates rather than sitting at `1 / rate`: removing a card that
/// completes a full bundle (`rate` divides `count`) destroys a whole trade and
/// prices at the full scale, while a spare sheds only partial progress — so a
/// ported spare outranks an unported spare, and the ported resource is the last
/// thing to shed rather than the first.
pub fn marginal_conversion_scaled(count: i16, rate: u32, base_rate: u32) -> u32 {
    if count <= 0 {
        return 0;
    }
    let rate = rate.max(1);
    if rate < base_rate && count as u32 % rate == 0 {
        CONVERSION_SCALE
    } else {
        CONVERSION_SCALE / rate
    }
}
