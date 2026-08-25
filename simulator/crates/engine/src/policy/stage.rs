//! The J2 stage signal: how late the game is for expansion purposes.
//!
//! One derivation serves every consumer (the same one-model rule the programme applies to
//! opponent threat, hand exposure, and goal need): the settlement expansion damping and the
//! city boost both read the same `lateness`. Two channels feed it — the observer's remaining
//! settlement/city piece supply against the rule set's limits, and the count of
//! distance-rule-open settlement sites on the board against the settlement supply — combined
//! by taking the binding (smaller) fraction. Under gated policies an ETW-derived urgency
//! raises the lateness further: the denial context's top rival danger (the shared danger
//! model the denial and embargo terms already read) scaled by
//! `HeuristicParams::stage_urgency_weight`. Setup and ungated paths carry no belief and read
//! the piece/site channels alone.

use crate::rules::Buildable;
use crate::view::DecisionView;

/// The per-decision stage value.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Stage {
    /// 0.0 with a fresh piece supply and an open board, 1.0 when depleted settlement/city
    /// pieces, exhausted open sites, or (gated) a rival's win threat leave no room to expand.
    pub lateness: f32,
}

impl Stage {
    /// Derives the stage from the observer's piece supply and the board's open sites, plus
    /// the gated urgency. `top_danger` is `None` on ungated paths; a zero `urgency_weight`
    /// leaves the primary signal untouched.
    pub fn derive(view: &DecisionView<'_>, urgency_weight: f32, top_danger: Option<f64>) -> Self {
        debug_assert!(urgency_weight.is_finite() && urgency_weight >= 0.0);
        let settlement_limit = f32::from(view.piece_limit(Buildable::Settlement));
        let supply = settlement_limit + f32::from(view.piece_limit(Buildable::City));
        let left = f32::from(view.pieces(view.observer(), Buildable::Settlement))
            + f32::from(view.pieces(view.observer(), Buildable::City));
        let piece_frac = if supply > 0.0 { left / supply } else { 0.0 };
        // Distance-rule-open sites board-wide, not the observer's road-connected legal set:
        // the channel measures board saturation, and connectivity would leave it near zero
        // for most of a game. It binds only once open sites drop below the settlement supply.
        let open = (0..view.topology().vertex_count())
            .filter(|vertex| view.is_expansion_target(*vertex as u8))
            .count() as f32;
        let site_frac = if settlement_limit > 0.0 {
            (open / settlement_limit).min(1.0)
        } else {
            0.0
        };
        let lateness = 1.0 - piece_frac.min(site_frac);
        let urgency = urgency_weight * top_danger.unwrap_or(0.0) as f32;
        Self {
            lateness: (lateness + urgency).clamp(0.0, 1.0),
        }
    }
}
