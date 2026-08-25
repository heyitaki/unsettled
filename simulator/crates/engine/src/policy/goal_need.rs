//! The single goal-need model (Phase J1): what the current goal still needs once the hand
//! and expected production are counted.
//!
//! One computation serves every consumer, the same one-model rule the programme applies to
//! opponent threat and hand exposure: the `vertex_score` build-target term and the J3
//! piece-economy cost pressure (`cost_term`). The need vector is
//! the goal's closest cost variant's missing cards minus one full round of expected
//! production (`seats` rolls at `pips / 36` cards per roll), clamped at zero: a resource
//! the observer already produces enough of asks nothing from a new building.

use crate::policy::heuristic_v1;
use crate::rules::{Buildable, RESOURCE_COUNT};
use crate::view::{DecisionView, can_pay};

/// Per-resource outstanding need of a goal, in cards.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct GoalNeed {
    pub need: [f32; RESOURCE_COUNT],
}

impl GoalNeed {
    /// Derives the need vector for `goal` from the observer's hand and production. The
    /// closest-variant rule matches the payment path (and `plenty_offer`): an affordable
    /// goal is all zeros because a build owes it nothing.
    pub fn derive(view: &DecisionView<'_>, goal: Buildable) -> Self {
        let missing = heuristic_v1::closest_variant_missing(view, goal);
        let own = view.production_pips(view.observer());
        let rolls = view.seats() as f32;
        let need = std::array::from_fn(|resource| {
            (f32::from(missing[resource]) - f32::from(own[resource]) * rolls / 36.0).max(0.0)
        });
        Self { need }
    }

    /// The J1 vertex term: a candidate building's production pips weighted by outstanding
    /// need, so a vertex producing what the current goal is short of outranks equal pips
    /// of something the goal already has covered.
    pub fn production_term(&self, production: &[u16; RESOURCE_COUNT]) -> f32 {
        (0..RESOURCE_COUNT)
            .map(|resource| f32::from(production[resource]) * self.need[resource])
            .sum()
    }

    /// The J3 cost-pressure term: how many cards of the goal's outstanding need paying for
    /// `buildable` would consume, priced at the variant the payment path would actually
    /// spend (the first affordable one, mirroring the engine's `pay_cost`). Zero when no
    /// variant is payable, which the build-candidate call sites already rule out.
    pub fn cost_term(&self, view: &DecisionView<'_>, buildable: Buildable) -> f32 {
        view.costs(buildable)
            .iter()
            .find(|cost| can_pay(view.own_hand(), cost))
            .map_or(0.0, |cost| {
                (0..RESOURCE_COUNT)
                    .map(|resource| f32::from(cost[resource]) * self.need[resource])
                    .sum()
            })
    }
}
