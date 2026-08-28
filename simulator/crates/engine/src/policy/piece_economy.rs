//! The J3 settlement-slot return model (SIM-GAP-29, first half): what upgrading a
//! settlement to a city hands back to the piece supply.
//!
//! A city returns a settlement piece, and that return is worth more the closer the observer
//! is to the settlement cap and the more open sites remain to spend the freed piece on. One
//! derivation per decision serves every consumer (the same one-model rule the programme
//! applies to opponent threat, hand exposure, goal need, and the stage signal): today that
//! is the `vertex_score` city term, which — being pure state, like the J2 stage — also
//! reaches the goal chooser. The second half of SIM-GAP-29, cost pressure, lives on the
//! shared goal-need model (`goal_need::GoalNeed::cost_term`).

use crate::rules::Buildable;
use crate::view::DecisionView;

/// The per-decision settlement-slot return value.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SlotReturn {
    /// 0.0 with a full settlement supply or a saturated board, rising to 1.0 at the
    /// settlement cap with at least a supply's worth of open sites left.
    pub value: f32,
}

impl SlotReturn {
    /// Derives the slot-return value: proximity to the settlement cap (placed pieces over
    /// the supply) times open-site availability (distance-rule-open sites board-wide over
    /// the supply, capped at 1). Board-wide sites, not the observer's road-connected legal
    /// set, for the same reason the J2 stage reads them: the connected set is near zero for
    /// most of a game and exactly zero at the cap, where this term matters most.
    pub fn derive(view: &DecisionView<'_>) -> Self {
        let limit = f32::from(view.piece_limit(Buildable::Settlement));
        if limit == 0.0 {
            return Self { value: 0.0 };
        }
        let left = f32::from(view.pieces(view.observer(), Buildable::Settlement));
        let proximity = 1.0 - (left / limit).min(1.0);
        let open = (0..view.topology().vertex_count())
            .filter(|vertex| view.is_expansion_target(*vertex as u8))
            .count() as f32;
        let sites = (open / limit).min(1.0);
        Self {
            value: proximity * sites,
        }
    }
}
