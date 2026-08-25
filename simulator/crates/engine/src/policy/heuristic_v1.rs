use serde::{Deserialize, Serialize};

use crate::policy::PolicyScratch;
use crate::policy::denial::{self, DenialContext, DenialParams};
use crate::policy::devcards::{self, DevCardParams};
use crate::policy::exposure;
use crate::policy::goal_need::GoalNeed;
use crate::policy::piece_economy::SlotReturn;
use crate::policy::stage::Stage;
use crate::policy::threat::{self, ThreatParams};
use crate::policy::trading::TradeParams;
use crate::rng::Xoshiro256StarStar;
use crate::rules::{Buildable, RESOURCE_COUNT, Resource};
use crate::state::{DEV_KNIGHT, DEV_MONOPOLY, DEV_ROAD_BUILDING, DEV_VP, DEV_YEAR_OF_PLENTY};
use crate::view::{
    Action, ActionBuf, DecisionPhase, DecisionView, DevPlay, ScoredAction, can_pay, pips,
};

pub(crate) type Gated<'a> = Option<(&'a DenialContext, &'a DenialParams)>;

#[cfg(test)]
std::thread_local! {
    static HOLDER_DEFEND_OBSERVATION: std::cell::Cell<Option<bool>> =
        const { std::cell::Cell::new(None) };
    static BEST_GOAL_CALLS: std::cell::Cell<u32> = const { std::cell::Cell::new(0) };
    static PAIR_CONTEST: std::cell::Cell<f32> = const { std::cell::Cell::new(0.0) };
    static PAIR_ROAD_BONUS: std::cell::Cell<f32> = const { std::cell::Cell::new(0.0) };
    static PAIR_EXPANSION: std::cell::Cell<f32> = const { std::cell::Cell::new(f32::NEG_INFINITY) };
    static CROSSING_CENSUS: std::cell::RefCell<Vec<CensusCrossing>> =
        const { std::cell::RefCell::new(Vec::new()) };
    static DECISION_TRACE: std::cell::RefCell<Vec<DecisionTrace>> =
        const { std::cell::RefCell::new(Vec::new()) };
}

#[cfg(test)]
#[allow(dead_code)]
#[derive(Clone, Debug)]
pub(crate) struct CensusCrossing {
    pub action: Action,
    pub action_score: f32,
    pub old_settlement_score: f32,
}

#[cfg(test)]
#[allow(dead_code)]
#[derive(Clone, Debug)]
pub(crate) struct DecisionTrace {
    pub observer: usize,
    pub selected: Action,
    pub candidates: Vec<ScoredAction>,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct LegacyValuation {
    pub local_port_production: bool,
    pub pip_settlement_goal: bool,
    pub flat_city_goal: bool,
    pub settlement_shaped_city_terms: bool,
    pub band_ladder: bool,
    /// Restores the narrow card-play scope: Year of Plenty offered only when the hand is
    /// exactly two short of the goal, picked in index order, and Monopoly reading only the
    /// goal's first cost variant.
    pub narrow_card_plays: bool,
    /// Restores the composition-blind development-card buy score: a flat base plus the
    /// Largest Army contest bonus, regardless of what the remaining deck can still contain.
    pub deck_blind_buying: bool,
    /// Restores exposure-blind hand handling: the goal-cost-only greedy discard ranking, no
    /// pre-emptive shedding trade, and no pre-roll seven-exposure penalty on card plays.
    pub exposure_blind: bool,
    /// Restores the bounded race scope: exact Longest Road race checks capped at two rivals
    /// and the blocking-blind contest term.
    pub bounded_race: bool,
    /// Restores the VP-estimate embargo thresholds: trades refused at one
    /// conservatively-estimated point below the win threshold, or two with an imminent
    /// award swing, instead of the shared ETW danger model.
    pub vp_embargo: bool,
    /// Restores the pre-SIM-GAP-32 road-building pair credit: the second edge's endpoints
    /// only, ungated on `is_expansion_target`, so it prices vertices nobody can settle.
    pub ungated_pair: bool,
    /// Restores the frozen knight action score G1 shipped: contested-card and progress terms
    /// at a flat pressure of one, the raw capped-hand-size steal term, and play/hold priced at
    /// the self-regarding robber choice even when the threat gate plays another destination.
    pub frozen_knight: bool,
}

/// How the special building phase is scored (the SIM-GAP-19 measurement seam). `Uniform` is
/// the shipped behavior: SpecialBuild decisions run the ordinary action scorer, with the
/// phase's narrower legality (no trades, no dev plays) doing all the differentiating. The
/// other variants exist only as composite measurement labels for the M-30 A/B and are never
/// a default.
#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum SpecialBuildScoring {
    #[default]
    Uniform,
    /// Pass every SpecialBuild decision. Ablates the surface entirely, bounding how much
    /// outcome weight any SpecialBuild rescoring could carry.
    Mute,
    /// Refuse any SpecialBuild spend that moves the current goal further away: a candidate
    /// survives only if some payable cost variant leaves the goal's closest-variant shortfall
    /// unchanged. With no goal, or an affordable one, this is identical to `Uniform`.
    HoldGoal,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct HeuristicParams {
    pub production_weight: f32,
    pub scarcity_weight: f32,
    pub diversity_bonus: f32,
    pub port_weight: f32,
    pub expansion_weight: f32,
    pub robber_block_threshold: u8,
    /// Multiplier turning a shedding trade's net value (expected cards saved from the next
    /// seven minus cards paid with certainty) into an action score. Zero disables the shed
    /// candidate entirely; an unswept Phase-H placeholder.
    pub shed_weight: f32,
    /// Weight of the J1 goal-need vertex term: a build candidate's production pips weighted
    /// by the shared `goal_need` model's outstanding need for the decision's selected goal.
    /// Zero (the default) never constructs the model and restores the pre-J1 expression
    /// bit-for-bit; the `-goalneedlo`/`-goalneedhi` trial values are Phase-H sweep
    /// candidates, not tuned values.
    pub goal_need_weight: f32,
    /// Damping of the settlement expansion term by the J2 stage signal: the term is scaled
    /// by `(1 - weight * lateness).max(0)`. Zero (the default) never derives the stage and
    /// restores the pre-J2 expression bit-for-bit; the `-stagelo`/`-stagehi` trial values
    /// are Phase-H sweep candidates, not tuned values.
    pub stage_expansion_weight: f32,
    /// Boost of the city vertex score by the J2 stage signal: the score is scaled by
    /// `1 + weight * lateness`. Zero-default, same trial labels as above.
    pub stage_city_weight: f32,
    /// Weight of the gated ETW urgency input on the stage signal: the denial context's top
    /// rival danger raises `lateness` by `weight * danger` (clamped to 1). Read only when
    /// the denial gate supplies a context; setup and ungated paths carry no belief.
    /// Zero-default, same trial labels.
    pub stage_urgency_weight: f32,
    /// Weight of the J3 settlement-slot return term on city value: upgrading frees one of
    /// the capped settlement pieces, worth more near the settlement cap and with open sites
    /// left to spend the freed piece on (`policy::piece_economy::SlotReturn`). Zero (the
    /// default) never derives the model and restores the pre-J3 expression bit-for-bit; the
    /// `-econlo`/`-econhi` trial values are Phase-H sweep candidates, not tuned values.
    pub slot_return_weight: f32,
    /// Weight of the J3 cost-pressure term: each build candidate's score is charged for the
    /// overlap between its cost (at the variant the payment path would spend) and the
    /// shared goal-need model's outstanding need for the decision's selected goal
    /// (`goal_need::GoalNeed::cost_term`). Zero-default, same trial labels.
    pub cost_pressure_weight: f32,
    /// The J4 goal-hysteresis margin (SIM-GAP-25): a challenger goal must beat the seat's
    /// incumbent goal (`DecisionView::incumbent_goal`, the goal committed at the previous
    /// decision) by this much in the chooser's comparisons, implemented as a selection-only
    /// boost on the incumbent's candidate — the chosen goal always keeps its true score.
    /// Zero (the default) never reads the incumbent and restores the pre-J4 selection
    /// bit-for-bit; the `-hystlo`/`-hysthi` trial values are Phase-H sweep candidates, not
    /// tuned values.
    pub goal_hysteresis_margin: f32,
    /// `None` keeps the self-regarding robber rule. `Some` selects the threat model in
    /// `policy::threat`; these weights are Phase-H sweep targets, not tuned values.
    pub threat: Option<ThreatParams>,
    /// `None` keeps the fixed pre-roll ladder and production-share Monopoly proxy. `Some`
    /// selects the belief-and-ETW comparison in `policy::devcards`.
    pub dev_cards: Option<DevCardParams>,
    /// `None` keeps the offer-independent VP-ratio acceptance rule and the lexicographic
    /// counterparty ladder. `Some` selects the shared opponent-value model in `policy::trading`.
    pub trading: Option<TradeParams>,
    /// `None` keeps self-regarding contested-card and expansion scoring. `Some` selects the
    /// denial and positional-competition model in `policy::denial`; these weights are Phase-H
    /// sweep targets, not tuned values.
    pub denial: Option<DenialParams>,
    /// Measurement-only restoration of one or more pre-SIM-BATCH1 valuation expressions.
    /// Default policies never set this field.
    pub legacy_valuation: Option<LegacyValuation>,
    /// Measurement-only SpecialBuild treatment. Default policies keep `Uniform`.
    pub special_build: SpecialBuildScoring,
}

impl Default for HeuristicParams {
    fn default() -> Self {
        Self {
            production_weight: 1.0,
            scarcity_weight: 0.35,
            diversity_bonus: 1.4,
            port_weight: 0.1,
            expansion_weight: 0.15,
            robber_block_threshold: 4,
            shed_weight: 10.0,
            goal_need_weight: 0.0,
            stage_expansion_weight: 0.0,
            stage_city_weight: 0.0,
            stage_urgency_weight: 0.0,
            slot_return_weight: 0.0,
            cost_pressure_weight: 0.0,
            goal_hysteresis_margin: 0.0,
            threat: None,
            dev_cards: None,
            trading: None,
            denial: None,
            legacy_valuation: None,
            special_build: SpecialBuildScoring::Uniform,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BuildKind {
    Settlement,
    City,
}

pub const BUILD_BAND: f32 = 10_000.0;

/// Trial values behind the J1 measurement labels (`-goalneedlo`/`-goalneedhi`): a term
/// comparable to the raw-production term, and one that dominates it. Phase-H sweep
/// candidates only; the shipped default weight stays zero.
pub const GOAL_NEED_TRIAL_LO: f32 = 0.5;
pub const GOAL_NEED_TRIAL_HI: f32 = 2.0;

/// One trial setting of the three J2 stage weights, behind a measurement label.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct StageTrial {
    pub expansion: f32,
    pub city: f32,
    pub urgency: f32,
}

/// Trial values behind the J2 measurement labels (`-stagelo`/`-stagehi`): a moderate setting
/// (halved expansion, +50% city value at full lateness) and an aggressive one (expansion
/// eliminated, city value tripled at full lateness, danger weighted whole). Phase-H sweep
/// candidates only; the shipped default weights stay zero.
pub const STAGE_TRIAL_LO: StageTrial = StageTrial {
    expansion: 0.5,
    city: 0.5,
    urgency: 0.5,
};
pub const STAGE_TRIAL_HI: StageTrial = StageTrial {
    expansion: 1.0,
    city: 2.0,
    urgency: 1.0,
};

/// One trial setting of the two J3 piece-economy weights, behind a measurement label.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct EconTrial {
    pub slot_return: f32,
    pub cost_pressure: f32,
}

/// Trial values behind the J3 measurement labels (`-econlo`/`-econhi`): a moderate setting
/// (up to +2 on city value at the cap, half a card of score per card of need spent) and an
/// aggressive one (up to +8, two per card — the slot term then rivals a strong vertex's
/// production term). Phase-H sweep candidates only; the shipped default weights stay zero.
pub const ECON_TRIAL_LO: EconTrial = EconTrial {
    slot_return: 2.0,
    cost_pressure: 0.5,
};
pub const ECON_TRIAL_HI: EconTrial = EconTrial {
    slot_return: 8.0,
    cost_pressure: 2.0,
};

/// Trial values behind the J4 measurement labels (`-hystlo`/`-hysthi`). Goal scores are
/// value per turn: an affordable goal floors at 0.25 turns (a settlement-shaped vertex
/// prices around `(1 + score/20) * 4`, the road base at 1.4), so 0.25 absorbs sub-road-base
/// score wobble while 1.0 spans the typical gap between an affordable goal and a mid-horizon
/// challenger. Phase-H sweep candidates only; the shipped default margin stays zero.
pub const HYSTERESIS_TRIAL_LO: f32 = 0.25;
pub const HYSTERESIS_TRIAL_HI: f32 = 1.0;

pub fn action(
    view: &DecisionView<'_>,
    scratch: &mut PolicyScratch,
    params: &HeuristicParams,
    rng: &mut Xoshiro256StarStar,
) -> Action {
    action_with_goal(view, scratch, params, rng).0
}

/// The denial params a decision actually runs with. `bounded_race` restores the pre-SIM-GAP-07/08
/// scope purely through param values (a two-rival race-check budget and no blocking bonus), so
/// `denial.rs` never reads the legacy flag itself.
fn effective_denial(params: &HeuristicParams) -> Option<DenialParams> {
    let mut denial = params.denial?;
    if params
        .legacy_valuation
        .is_some_and(|legacy| legacy.bounded_race)
    {
        denial.race_check_cap = 2;
        denial.contest_block_bonus = 0.0;
    }
    Some(denial)
}

/// The J2 stage a decision actually runs with: derived once per decision, `None` whenever
/// both consuming weights are zero so default arms never compute it (and the pre-J2 scores
/// stay bit-identical). The ETW urgency input rides the denial context's shared danger
/// model, so it exists only under gated policies.
fn stage_for(view: &DecisionView<'_>, params: &HeuristicParams, gated: Gated<'_>) -> Option<Stage> {
    (params.stage_expansion_weight != 0.0 || params.stage_city_weight != 0.0).then(|| {
        Stage::derive(
            view,
            params.stage_urgency_weight,
            gated.map(|(ctx, _)| ctx.top_danger()),
        )
    })
}

/// The J3 slot-return model a decision actually runs with: derived once per decision, `None`
/// at the zero default so shipped arms never compute it (and the pre-J3 scores stay
/// bit-identical). Like the J2 stage — and unlike the goal-need term — it is pure state, so
/// it also reaches the goal chooser's city pricing.
fn slot_return_for(view: &DecisionView<'_>, params: &HeuristicParams) -> Option<SlotReturn> {
    (params.slot_return_weight != 0.0).then(|| SlotReturn::derive(view))
}

pub(crate) fn action_with_goal(
    view: &DecisionView<'_>,
    scratch: &mut PolicyScratch,
    params: &HeuristicParams,
    rng: &mut Xoshiro256StarStar,
) -> (Action, Option<Goal>) {
    let denial_params = effective_denial(params);
    let denial_context = denial_params
        .as_ref()
        .map(|denial_params| denial::context(view, denial_params));
    let gated = denial_context.as_ref().zip(denial_params.as_ref());
    let stage = stage_for(view, params, gated);
    let stage = stage.as_ref();
    let slot = slot_return_for(view, params);
    let slot = slot.as_ref();
    let road = best_road(view, params, gated, stage);
    let selected_goal = best_goal_with(view, params, road, stage, slot);
    let PolicyScratch { goal, actions } = scratch;
    score_actions_with(view, params, actions, road, selected_goal, gated, stage, slot);
    *goal = selected_goal.map(|goal| goal.kind);
    let best_score = actions
        .as_slice()
        .iter()
        .map(|action| action.score)
        .fold(f32::NEG_INFINITY, f32::max);
    let mut selected = Action::Pass;
    let mut ties = 0;
    for candidate in actions
        .as_slice()
        .iter()
        .filter(|candidate| candidate.score == best_score)
    {
        ties += 1;
        if rng.range(ties) == 0 {
            selected = candidate.action;
        }
    }
    #[cfg(test)]
    DECISION_TRACE.with(|trace| {
        trace.borrow_mut().push(DecisionTrace {
            observer: view.observer(),
            selected,
            candidates: actions.as_slice().to_vec(),
        });
    });
    (selected, selected_goal)
}

pub fn score_actions(view: &DecisionView<'_>, params: &HeuristicParams, out: &mut ActionBuf) {
    let denial_params = effective_denial(params);
    let denial_context = denial_params
        .as_ref()
        .map(|denial_params| denial::context(view, denial_params));
    let gated = denial_context.as_ref().zip(denial_params.as_ref());
    let stage = stage_for(view, params, gated);
    let stage = stage.as_ref();
    let slot = slot_return_for(view, params);
    let slot = slot.as_ref();
    let road = best_road(view, params, gated, stage);
    let goal = best_goal_with(view, params, road, stage, slot);
    score_actions_with(view, params, out, road, goal, gated, stage, slot);
}

#[allow(clippy::too_many_arguments)]
fn score_actions_with(
    view: &DecisionView<'_>,
    params: &HeuristicParams,
    out: &mut ActionBuf,
    road: Option<RoadGoal>,
    goal: Option<Goal>,
    gated: Gated<'_>,
    stage: Option<&Stage>,
    slot: Option<&SlotReturn>,
) {
    out.clear();
    let special_build = view.phase() == DecisionPhase::SpecialBuild;
    if special_build && params.special_build == SpecialBuildScoring::Mute {
        out.push(ScoredAction {
            action: Action::Pass,
            score: 0.0,
        });
        return;
    }
    // The J1 goal-need term prices build candidates against the decision's already-selected
    // goal, and the J3 cost-pressure term charges their costs against the same need; both
    // weights zero (the default) skips the derivation entirely so the pre-J1 scores stay
    // bit-identical, and each consumer additionally gates on its own weight.
    let goal_need = (params.goal_need_weight != 0.0 || params.cost_pressure_weight != 0.0)
        .then(|| goal.map(|goal| GoalNeed::derive(view, goal.kind)))
        .flatten();
    let vertex_need = goal_need
        .as_ref()
        .filter(|_| params.goal_need_weight != 0.0);
    // `None` rather than 0.0 when disabled keeps the subtraction out of the expression, so
    // the zero-default arms never touch the pushed scores. An affordable goal has zero need
    // by construction, so a build can never be charged for its own goal's cost.
    let cost_pressure = |kind: Buildable| {
        goal_need
            .as_ref()
            .filter(|_| params.cost_pressure_weight != 0.0)
            .map(|need| params.cost_pressure_weight * need.cost_term(view, kind))
    };
    if view.can_afford(Buildable::City) {
        let pressure = cost_pressure(Buildable::City);
        for vertex in 0..view.topology().vertex_count() {
            let vertex = vertex as u8;
            if view.legal_city(vertex) {
                let mut score = BUILD_BAND
                    + vertex_score_with(view, vertex, params, BuildKind::City, vertex_need, stage, slot);
                if let Some(pressure) = pressure {
                    score -= pressure;
                }
                out.push(ScoredAction {
                    action: Action::UpgradeCity(vertex),
                    score,
                });
            }
        }
    }
    if view.can_afford(Buildable::Settlement) {
        let pressure = cost_pressure(Buildable::Settlement);
        for vertex in 0..view.topology().vertex_count() {
            let vertex = vertex as u8;
            if view.legal_settlement(vertex) {
                let mut score = if params
                    .legacy_valuation
                    .is_some_and(|legacy| legacy.band_ladder)
                {
                    500.0
                } else {
                    BUILD_BAND
                } + vertex_score_with(
                    view,
                    vertex,
                    params,
                    BuildKind::Settlement,
                    vertex_need,
                    stage,
                    slot,
                );
                if let Some(pressure) = pressure {
                    score -= pressure;
                }
                out.push(ScoredAction {
                    action: Action::BuildSettlement(vertex),
                    score,
                });
            }
        }
    }
    if view.can_afford(Buildable::Road)
        && let Some(road) = road
    {
        let mut score = road.action_score;
        if let Some(pressure) = cost_pressure(Buildable::Road) {
            score -= pressure;
        }
        out.push(ScoredAction {
            action: Action::BuildRoad(road.edge),
            score,
        });
    }
    if let Some(goal) = goal
        && !view.can_afford(goal.kind)
    {
        for trade in completing_or_improving_trades(view, goal.kind) {
            out.push(ScoredAction {
                action: trade,
                score: if trade_completes(view, goal.kind, trade) {
                    400.0 + goal.score
                } else {
                    300.0 + goal.score
                },
            });
        }
    }
    if let Some(shed) = shed_trade(view, params, goal) {
        out.push(shed);
    }
    let dev_score = dev_card_score(view, params, gated);
    if view.dev_deck_remaining() > 0 && !view.can_buy_dev() {
        for give in Resource::ALL {
            for get in Resource::ALL {
                let trade = Action::TradeBank {
                    give,
                    get,
                    count: 1,
                };
                if view.legal_trade(give, get, 1)
                    && trade_completes_cost(view, view.dev_cost(), trade)
                {
                    out.push(ScoredAction {
                        action: trade,
                        score: 350.0 + dev_score - 45.0,
                    });
                }
            }
        }
    }
    if view.can_buy_dev() {
        out.push(ScoredAction {
            action: Action::BuyDev,
            score: dev_score,
        });
    }
    // Only evaluate the knight when there is a motive: it takes Largest Army, it unblocks our own
    // production, or we hold a spare. Choosing the robber target scans every hex against every
    // seat, so doing it on turns where a lone knight is simply being held costs throughput for a
    // move that would not be played anyway. (The old gate required a spare knight outright, which
    // made Largest Army unreachable.)
    if view.can_play_dev(0)
        && (view.knight_takes_largest_army()
            || view.hex_touches_seat(view.robber(), view.observer())
            || view.own_playable_dev()[0] >= 2)
    {
        if params
            .legacy_valuation
            .is_some_and(|legacy| legacy.frozen_knight)
        {
            let (off_destination, off_victim) = self_regarding_robber(view);
            let (destination, victim) = match params.threat.as_ref() {
                Some(threat_params) => threat::robber(view, threat_params),
                None => (off_destination, off_victim),
            };
            out.push(ScoredAction {
                action: Action::PlayDev(DevPlay::Knight {
                    destination,
                    victim,
                }),
                // The G1 freeze: play/hold priced at the baseline choice so the robber A/B
                // stayed placement-only.
                score: frozen_knight_action_score(view, off_destination, off_victim),
            });
        } else {
            let choice = params
                .threat
                .as_ref()
                .map(|threat_params| (threat_params, threat::robber_choice(view, threat_params)));
            let (destination, victim) = match choice.as_ref() {
                Some((_, choice)) => (choice.destination, choice.victim),
                None => self_regarding_robber(view),
            };
            out.push(ScoredAction {
                action: Action::PlayDev(DevPlay::Knight {
                    destination,
                    victim,
                }),
                score: knight_action_score(
                    view,
                    gated,
                    destination,
                    victim,
                    choice.as_ref().map(|(params, choice)| (*params, choice)),
                ),
            });
        }
    }
    out.push(ScoredAction {
        action: Action::Pass,
        score: 0.0,
    });
    if special_build && params.special_build == SpecialBuildScoring::HoldGoal {
        hold_goal_filter(view, out, goal);
    }
    #[cfg(test)]
    record_crossings(view, params, out);
}

/// The `SpecialBuildScoring::HoldGoal` prune: drops already-scored SpecialBuild candidates
/// whose every payable cost variant increases the goal's closest-variant shortfall. Scores are
/// never touched, so a surviving candidate is bit-identical to its `Uniform` spelling.
fn hold_goal_filter(view: &DecisionView<'_>, out: &mut ActionBuf, goal: Option<Goal>) {
    let Some(goal) = goal else {
        return;
    };
    let hand = *view.own_hand();
    let missing_now = goal_shortfall(view, goal.kind, &hand);
    if missing_now == 0 {
        return;
    }
    out.retain(|candidate| {
        let variants: &[[u8; RESOURCE_COUNT]] = match candidate.action {
            Action::BuildRoad(_) => view.costs(Buildable::Road),
            Action::BuildSettlement(_) => view.costs(Buildable::Settlement),
            Action::UpgradeCity(_) => view.costs(Buildable::City),
            Action::BuyDev => std::slice::from_ref(view.dev_cost()),
            // Pass spends nothing; trades and dev plays are illegal in SpecialBuild and
            // never reach the buffer there.
            _ => return true,
        };
        variants.iter().any(|cost| {
            if !can_pay(&hand, cost) {
                return false;
            }
            let mut after = hand;
            for resource in 0..RESOURCE_COUNT {
                after[resource] -= i16::from(cost[resource]);
            }
            goal_shortfall(view, goal.kind, &after) == missing_now
        })
    });
}

/// Units missing for the goal's closest cost variant from the given hand: the same
/// closest-variant rule `closest_variant_missing` applies, evaluated on hypothetical hands.
fn goal_shortfall(view: &DecisionView<'_>, goal: Buildable, hand: &[i16; RESOURCE_COUNT]) -> u16 {
    view.costs(goal)
        .iter()
        .map(|cost| missing_units(hand, cost))
        .min()
        .unwrap_or(0)
}

#[cfg(test)]
pub(crate) fn old_band_settlement_score(
    view: &DecisionView<'_>,
    params: &HeuristicParams,
    actions: &ActionBuf,
) -> Option<f32> {
    actions
        .as_slice()
        .iter()
        .filter_map(|candidate| match candidate.action {
            Action::BuildSettlement(vertex) => {
                Some(500.0 + vertex_score(view, vertex, params, BuildKind::Settlement))
            }
            _ => None,
        })
        .fold(None, |best: Option<f32>, score| {
            Some(best.map_or(score, |current| current.max(score)))
        })
}

#[cfg(test)]
fn record_crossings(view: &DecisionView<'_>, params: &HeuristicParams, actions: &ActionBuf) {
    let Some(old_settlement_score) = old_band_settlement_score(view, params, actions) else {
        return;
    };
    CROSSING_CENSUS.with(|crossings| {
        let mut crossings = crossings.borrow_mut();
        for candidate in actions.as_slice() {
            if !matches!(
                candidate.action,
                Action::UpgradeCity(_) | Action::BuildSettlement(_)
            ) && candidate.score > old_settlement_score
            {
                crossings.push(CensusCrossing {
                    action: candidate.action,
                    action_score: candidate.score,
                    old_settlement_score,
                });
            }
        }
    });
}

pub fn recommend(view: &DecisionView<'_>, params: &HeuristicParams) -> Vec<ScoredAction> {
    // Boxed to keep the buffer out of this frame; this is the entry point the app calls, and the
    // engine is meant to stay wasm-portable. Not a hard guarantee -- `Box::new` may still build the
    // value in place first -- so `MAX_ACTIONS` growing by orders of magnitude would need revisiting.
    let mut out = Box::new(ActionBuf::new());
    score_actions(view, params, &mut out);
    out.as_slice().to_vec()
}

pub fn pre_roll(
    view: &DecisionView<'_>,
    scratch: &mut PolicyScratch,
    params: &HeuristicParams,
) -> Option<DevPlay> {
    let denial_params = effective_denial(params);
    let denial_context = denial_params
        .as_ref()
        .map(|denial_params| denial::context(view, denial_params));
    let gated = denial_context.as_ref().zip(denial_params.as_ref());
    let blocked_pips = if view.hex_touches_seat(view.robber(), view.observer()) {
        view.board().tokens()[usize::from(view.robber())].map_or(0, pips)
    } else {
        0
    };
    if view.can_play_dev(0)
        && (view.knight_takes_largest_army() || blocked_pips >= params.robber_block_threshold)
    {
        let (destination, victim) = robber(view, params);
        return Some(DevPlay::Knight {
            destination,
            victim,
        });
    }
    let stage = stage_for(view, params, gated);
    let stage = stage.as_ref();
    let slot = slot_return_for(view, params);
    let slot = slot.as_ref();
    let road = best_road(view, params, gated, stage);
    let goal = best_goal_with(view, params, road, stage, slot);
    scratch.goal = goal.map(|value| value.kind);
    match params.dev_cards.as_ref() {
        None => ladder_pre_roll(view, params, goal, gated, stage),
        Some(cards) => devcards_pre_roll(view, params, cards, goal, gated, stage),
    }
}

fn ladder_pre_roll(
    view: &DecisionView<'_>,
    params: &HeuristicParams,
    goal: Option<Goal>,
    gated: Gated<'_>,
    stage: Option<&Stage>,
) -> Option<DevPlay> {
    if view.can_play_dev(3)
        && let Some((first, second)) = plenty_offer(view, goal.map(|value| value.kind), params)
    {
        return Some(DevPlay::YearOfPlenty { first, second });
    }
    if view.can_play_dev(4)
        && let Some(resource) =
            goal.and_then(|value| monopoly_for_goal(view, value.kind, params))
    {
        return Some(DevPlay::Monopoly { resource });
    }
    if view.can_play_dev(2) {
        let (first, second) = best_road_building_pair(view, params, gated, stage);
        if first.is_some() {
            return Some(DevPlay::RoadBuilding { first, second });
        }
    }
    None
}

fn devcards_pre_roll(
    view: &DecisionView<'_>,
    params: &HeuristicParams,
    cards: &DevCardParams,
    goal: Option<Goal>,
    gated: Gated<'_>,
    stage: Option<&Stage>,
) -> Option<DevPlay> {
    // Zeroing the weight restores the exposure-blind comparison exactly: the penalty is a
    // weighted product subtracted from each candidate, and `x - 0.0` is `x` in IEEE arithmetic.
    let exposure_blind_cards;
    let cards = if params
        .legacy_valuation
        .is_some_and(|legacy| legacy.exposure_blind)
    {
        exposure_blind_cards = DevCardParams {
            exposure_weight: 0.0,
            ..*cards
        };
        &exposure_blind_cards
    } else {
        cards
    };
    let offers = devcards::DevOffers {
        plenty: view
            .can_play_dev(3)
            .then(|| plenty_offer(view, goal.map(|value| value.kind), params))
            .flatten(),
        monopoly: view.can_play_dev(4),
        road: view
            .can_play_dev(2)
            .then(|| best_road_building_pair(view, params, gated, stage))
            .filter(|pair| pair.0.is_some()),
    };
    let goal_cost = goal.and_then(|value| view.costs(value.kind).first().copied());
    let choice = devcards::pre_roll_choice(view, cards, offers, goal_cost);
    #[cfg(test)]
    record_devcards_outcome(view, cards, offers, goal_cost, choice);
    choice
}

#[cfg(test)]
static DEVCARDS_COUNTS: [std::sync::atomic::AtomicUsize; 4] =
    [const { std::sync::atomic::AtomicUsize::new(0) }; 4];

#[cfg(test)]
static DEVCARDS_TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[cfg(test)]
std::thread_local! {
    static M21_LIVE_FLIPS: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
    static M21_REVIEW_STATE_FLIPS: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}

#[cfg(test)]
fn record_devcards_outcome(
    view: &DecisionView<'_>,
    params: &DevCardParams,
    offers: devcards::DevOffers,
    goal_cost: Option<[u8; RESOURCE_COUNT]>,
    choice: Option<DevPlay>,
) {
    use std::sync::atomic::Ordering;

    if !(view.can_play_dev(2) || view.can_play_dev(3) || view.can_play_dev(4)) {
        return;
    }
    DEVCARDS_COUNTS[3].fetch_add(1, Ordering::Relaxed);
    if offers == devcards::DevOffers::default() {
        DEVCARDS_COUNTS[2].fetch_add(1, Ordering::Relaxed);
        return;
    }
    let candidates = devcards::score_candidates(view, params, offers, goal_cost);
    let any_play = candidates
        .scored
        .iter()
        .flatten()
        .any(|candidate| candidate.play.is_some());
    if !any_play {
        DEVCARDS_COUNTS[2].fetch_add(1, Ordering::Relaxed);
    } else if choice.is_some() {
        DEVCARDS_COUNTS[0].fetch_add(1, Ordering::Relaxed);
    } else {
        DEVCARDS_COUNTS[1].fetch_add(1, Ordering::Relaxed);
    }

    let Some(_) = candidates.scored[2] else {
        return;
    };
    let context = &candidates.context;
    let projected_own =
        std::array::from_fn(|resource| context.own[resource] + context.own_round_income[resource]);
    let mut projected_inputs = context.inputs.clone();
    projected_inputs.belief_expected = projected_own;
    let projected_etw = crate::etw::expected_turns_to_win(&projected_inputs);
    let projected_haul = std::array::from_fn(|resource| {
        context.haul_expected[resource] + params.haul_growth * context.haul_round_growth[resource]
    });
    let mutant_hold = devcards::monopoly_resource(
        context,
        params,
        &context.own,
        projected_etw,
        &projected_haul,
    )
    .map_or(0.0, |(_, score)| params.hold_discount * score);
    let mut mutant_scored = candidates.scored;
    mutant_scored[0].as_mut().unwrap().score = mutant_hold;
    let mut mutant_best = None;
    for candidate in mutant_scored.iter().flatten() {
        if candidate.score.is_finite()
            && mutant_best
                .is_none_or(|current: devcards::ScoredDevPlay| candidate.score > current.score)
        {
            mutant_best = Some(*candidate);
        }
    }
    let mutant_choice = mutant_best.and_then(|winner| winner.play);
    if choice != mutant_choice {
        M21_LIVE_FLIPS.with(|count| count.set(count.get() + 1));
        if *view.own_hand() == [1, 1, 1, 0, 0] && view.public_vp(view.observer()) == 2 {
            M21_REVIEW_STATE_FLIPS.with(|count| count.set(count.get() + 1));
        }
    }
}

pub fn discard(
    view: &DecisionView<'_>,
    count: u8,
    scratch: &mut PolicyScratch,
    params: &HeuristicParams,
) -> [u8; RESOURCE_COUNT] {
    // The fallback recomputes the goal with the caller's params, denial gate included, so a gated
    // arm keeps its gates when discarding before its first action of the game (SIM-GAP-26).
    let goal = scratch.goal.or_else(|| {
        let denial_params = effective_denial(params);
        let denial_context = denial_params
            .as_ref()
            .map(|denial_params| denial::context(view, denial_params));
        let gated = denial_context.as_ref().zip(denial_params.as_ref());
        best_goal(view, params, gated).map(|value| value.kind)
    });
    let cost = goal
        .and_then(|kind| view.costs(kind).first())
        .copied()
        .unwrap_or([0; RESOURCE_COUNT]);
    let exposure_blind = params
        .legacy_valuation
        .is_some_and(|legacy| legacy.exposure_blind);
    let base_rate = Resource::ALL
        .iter()
        .map(|resource| view.trade_rate(*resource))
        .max()
        .unwrap_or(4);
    let mut remaining = *view.own_hand();
    let mut discarded = [0; RESOURCE_COUNT];
    for _ in 0..count {
        // A discard costs conversion value, not just goal distance (SIM-GAP-15): among cards
        // the goal does not need, shed the one whose discrete port-aware marginal is lowest
        // (dead spares before bundle-breakers, unported spares before ported ones). Goal need
        // still dominates on disagreement — a needed card is never taken while any surplus
        // exists — and an all-needed hand keeps the original greedy least-damage rule.
        let scored = (!exposure_blind)
            .then(|| {
                (0..RESOURCE_COUNT)
                    .filter(|index| remaining[*index] > i16::from(cost[*index]))
                    .max_by_key(|index| {
                        (
                            std::cmp::Reverse(exposure::marginal_conversion_scaled(
                                remaining[*index],
                                view.trade_rate(Resource::ALL[*index]),
                                base_rate,
                            )),
                            remaining[*index] - i16::from(cost[*index]),
                            *index,
                        )
                    })
            })
            .flatten();
        let resource = scored.unwrap_or_else(|| {
            (0..RESOURCE_COUNT)
                .max_by_key(|index| remaining[*index] - i16::from(cost[*index]))
                .unwrap_or(0)
        });
        if remaining[resource] == 0 {
            break;
        }
        remaining[resource] -= 1;
        discarded[resource] += 1;
    }
    discarded
}

/// A pre-emptive hand-shedding bank/port trade (SIM-GAP-16): once the hand is exposed to a
/// seven, a trade that pays `rate` cards for one prices its certain loss of `rate - 1` cards
/// against the expected cards the next seven no longer takes. Offered only when that nets
/// positive — a 2:1 trade from eight cards to seven pays one card against roughly two expected
/// — and never out of the goal's own cost. The received resource is the most goal-needed one,
/// then the hardest to produce, then the scarcest in the bank.
fn shed_trade(
    view: &DecisionView<'_>,
    params: &HeuristicParams,
    goal: Option<Goal>,
) -> Option<ScoredAction> {
    if params.shed_weight <= 0.0
        || params
            .legacy_valuation
            .is_some_and(|legacy| legacy.exposure_blind)
    {
        return None;
    }
    let hand_total = view.hand_total(view.observer());
    let threshold = view.discard_threshold();
    let rolls = view.seats() as u32;
    let now = exposure::expected_seven_loss(hand_total, threshold, rolls);
    if now <= 0.0 {
        return None;
    }
    let cost = goal
        .and_then(|goal| view.costs(goal.kind).first())
        .copied()
        .unwrap_or([0; RESOURCE_COUNT]);
    let hand = view.own_hand();
    let base_rate = Resource::ALL
        .iter()
        .map(|resource| view.trade_rate(*resource))
        .max()
        .unwrap_or(4);
    // Ties on value keep the earlier candidate, so equal-rate gives resolve to the one whose
    // marginal conversion loss is lowest, then the lowest index.
    let mut best: Option<(f64, u32, Resource)> = None;
    for give in Resource::ALL {
        let rate = view.trade_rate(give);
        if rate < 2 {
            continue;
        }
        let surplus = i64::from(hand[give.index()]) - i64::from(cost[give.index()]);
        if surplus < i64::from(rate) {
            continue;
        }
        let paid = rate - 1;
        let after = exposure::expected_seven_loss(
            hand_total.saturating_sub(paid),
            threshold,
            rolls,
        );
        let value = (now - after) - f64::from(paid);
        if value <= 0.0 {
            continue;
        }
        let marginal = exposure::marginal_conversion_scaled(hand[give.index()], rate, base_rate);
        let better = match best {
            None => true,
            Some((best_value, best_marginal, _)) => {
                value > best_value || (value == best_value && marginal < best_marginal)
            }
        };
        if better {
            best = Some((value, marginal, give));
        }
    }
    let (value, _, give) = best?;
    let own_pips = view.production_pips(view.observer());
    let get = Resource::ALL
        .into_iter()
        .filter(|get| view.legal_trade(give, *get, 1))
        .max_by_key(|get| {
            let index = get.index();
            (
                (i16::from(cost[index]) - hand[index]).max(0),
                std::cmp::Reverse(own_pips[index]),
                std::cmp::Reverse(view.bank(*get)),
                index,
            )
        })?;
    Some(ScoredAction {
        action: Action::TradeBank {
            give,
            get,
            count: 1,
        },
        score: params.shed_weight * value as f32,
    })
}

pub fn robber(view: &DecisionView<'_>, params: &HeuristicParams) -> (u8, Option<u8>) {
    match params.threat.as_ref() {
        Some(params) => threat::robber(view, params),
        None => self_regarding_robber(view),
    }
}

pub(crate) fn self_regarding_robber(view: &DecisionView<'_>) -> (u8, Option<u8>) {
    let mut best = view.robber();
    let mut best_score = i32::MIN;
    for hex in 0..view.topology().hex_count() {
        let hex = hex as u8;
        if hex == view.robber() || view.hex_touches_seat(hex, view.observer()) {
            continue;
        }
        let token_pips = i32::from(view.board().tokens()[usize::from(hex)].map_or(0, pips));
        // Blocking production is the main motive and must dominate: an unscaled hand-size term is
        // commensurate with the block value, which would send the robber to a desert next to a fat
        // hand over a 5-pip hex. Divided down, it only breaks ties between comparable blocks.
        let score = (0..view.seats())
            .filter(|seat| *seat != view.observer() && view.victim_on_hex(hex, *seat))
            .map(|seat| {
                token_pips * (1 + i32::from(view.public_vp(seat)))
                    + i32::from(view.hand_size(seat).min(12)) / 3
            })
            .sum();
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
    // Only a seat holding cards is worth naming -- targeting an empty-handed leader wastes the
    // steal entirely. Among those, still prefer the VP leader (denying the player closest to
    // winning outranks taking the largest hand), breaking ties toward the richer hand.
    let victim = (0..view.seats())
        .filter(|seat| *seat != view.observer() && view.stealable_on_hex(best, *seat))
        .max_by_key(|seat| (view.public_vp(*seat), view.hand_size(*seat)))
        .map(|seat| seat as u8);
    (best, victim)
}

pub fn turns_to_afford(view: &DecisionView<'_>, buildable: Buildable) -> f32 {
    view.costs(buildable)
        .iter()
        .map(|cost| turns_for_cost(view, cost))
        .fold(f32::INFINITY, f32::min)
}

pub fn vertex_score(
    view: &DecisionView<'_>,
    vertex: u8,
    params: &HeuristicParams,
    kind: BuildKind,
) -> f32 {
    vertex_score_with(view, vertex, params, kind, None, None, None)
}

/// `vertex_score` plus the optional J1 goal-need term, J2 stage adjustments, and J3
/// slot-return term. The goal chooser prices vertices without the need term (the goal is
/// what is being chosen there, so feeding a candidate goal's own need back into the scores
/// that pick it would be a fixed point, and roads are scored before any goal exists); only
/// the decision's already-selected goal reaches the build candidates in
/// `score_actions_with`. The stage and the slot return, by contrast, are pure state and
/// reach the chooser too (the slot return is City-only, so the settlement-kind road and
/// pair credit paths pass `None` for it). `None` for all three leaves the expression
/// bit-identical to the pre-J1 scorer.
pub fn vertex_score_with(
    view: &DecisionView<'_>,
    vertex: u8,
    params: &HeuristicParams,
    kind: BuildKind,
    need: Option<&GoalNeed>,
    stage: Option<&Stage>,
    slot: Option<&SlotReturn>,
) -> f32 {
    let board_totals = view.board_resource_pips();
    let own = view.production_pips(view.observer());
    let mut production = [0_u16; RESOURCE_COUNT];
    for hex in view.topology().vertex_hexes(vertex) {
        if *hex == view.robber() {
            continue;
        }
        if let (Some(resource), Some(token)) = (
            view.board().tiles()[usize::from(*hex)],
            view.board().tokens()[usize::from(*hex)],
        ) {
            production[resource.index()] += u16::from(pips(token));
        }
    }
    let raw: u16 = production.iter().sum();
    let scarcity = production
        .iter()
        .enumerate()
        .map(|(resource, value)| f32::from(*value) / f32::from(board_totals[resource].max(1)))
        .sum::<f32>();
    let settlement_shaped_city_terms = params
        .legacy_valuation
        .is_some_and(|legacy| legacy.settlement_shaped_city_terms);
    // No legacy flag restores a city diversity term because there was never one to restore:
    // `legal_city` requires the observer to already own the vertex, and `production_pips` sums
    // owned vertices with the same robber skip, so `production[r] > 0` implies `own[r] > 0` and
    // the filter is unsatisfiable. Only the expansion half of `SIM-GAP-03` was a live term.
    let diversity = match kind {
        BuildKind::Settlement => production
            .iter()
            .enumerate()
            .filter(|(resource, value)| **value > 0 && own[*resource] == 0)
            .count() as f32,
        BuildKind::City => 0.0,
    };
    let local_port_production = params
        .legacy_valuation
        .is_some_and(|legacy| legacy.local_port_production);
    let port_synergy = view
        .board()
        .ports_at(vertex)
        .map(|port| {
            Resource::ALL
                .iter()
                .map(|resource| {
                    let current = view.trade_rate(*resource);
                    let prospective = view.prospective_trade_rate(*port, *resource);
                    if prospective < current {
                        let production = if local_port_production {
                            production[resource.index()]
                        } else {
                            own[resource.index()].saturating_add(production[resource.index()])
                        };
                        f32::from(production) * (1.0 / prospective as f32 - 1.0 / current as f32)
                    } else {
                        0.0
                    }
                })
                .sum::<f32>()
        })
        .sum::<f32>();
    let settlement_expansion = || {
        view.topology()
            .vertex_adjacent(vertex)
            .iter()
            .filter(|adjacent| view.vertex_owner(**adjacent).is_none())
            .count() as f32
    };
    let expansion = match kind {
        BuildKind::Settlement => settlement_expansion(),
        BuildKind::City if settlement_shaped_city_terms => settlement_expansion(),
        BuildKind::City => 0.0,
    };
    let base = f32::from(raw) * params.production_weight
        + scarcity * params.scarcity_weight * 10.0
        + diversity * params.diversity_bonus
        + port_synergy * params.port_weight
        + expansion * params.expansion_weight;
    // Both adjustments below are branches rather than unconditional arithmetic (`+ 0.0`
    // would rewrite a negative-zero base), so the zero-default arms keep the pre-J1/J2
    // expression bit-for-bit.
    let base = match stage {
        None => base,
        // The J2 stage: damp the settlement expansion term (there is less room and time to
        // use the opened vertices) and boost the whole city value (immediate points matter
        // more) as the game runs out of pieces and open sites.
        Some(stage) => match kind {
            BuildKind::Settlement => {
                let scale = (1.0 - params.stage_expansion_weight * stage.lateness).max(0.0);
                base + expansion * params.expansion_weight * (scale - 1.0)
            }
            BuildKind::City => base * (1.0 + params.stage_city_weight * stage.lateness),
        },
    };
    // The J3 slot return: a city upgrade frees one of the capped settlement pieces, and
    // that return is worth more near the cap with open sites still available. Additive
    // after the stage scaling so the two seams stay independently zero-restorable.
    let base = match (kind, slot) {
        (BuildKind::City, Some(slot)) => base + params.slot_return_weight * slot.value,
        _ => base,
    };
    match need {
        None => base,
        Some(need) => base + params.goal_need_weight * need.production_term(&production),
    }
}

#[derive(Clone, Copy)]
pub(crate) struct Goal {
    pub(crate) kind: Buildable,
    pub(crate) score: f32,
}

#[derive(Clone, Copy)]
struct RoadGoal {
    edge: u8,
    action_score: f32,
    goal_score: f32,
}

pub(crate) fn best_goal(
    view: &DecisionView<'_>,
    params: &HeuristicParams,
    gated: Gated<'_>,
) -> Option<Goal> {
    let stage = stage_for(view, params, gated);
    let stage = stage.as_ref();
    let slot = slot_return_for(view, params);
    let slot = slot.as_ref();
    best_goal_with(view, params, best_road(view, params, gated, stage), stage, slot)
}

/// `best_road` scans every legal edge and, when the Longest Road card is in reach, runs an
/// exponential trail search per candidate. Callers that already have its result pass it in rather
/// than paying for it again -- a decision used to repeat that search three times over.
fn best_goal_with(
    view: &DecisionView<'_>,
    params: &HeuristicParams,
    road: Option<RoadGoal>,
    stage: Option<&Stage>,
    slot: Option<&SlotReturn>,
) -> Option<Goal> {
    #[cfg(test)]
    BEST_GOAL_CALLS.with(|calls| calls.set(calls.get() + 1));

    best_goal_uncounted(view, params, road, stage, slot)
}

/// The body, split out so the timing fixture can measure it without the call counter above. That
/// counter is test-only scaffolding pinning the once-per-decision dedup; a thread-local write
/// inside a timed loop would bias a figure whose whole purpose is to describe release cost.
fn best_goal_uncounted(
    view: &DecisionView<'_>,
    params: &HeuristicParams,
    road: Option<RoadGoal>,
    stage: Option<&Stage>,
    slot: Option<&SlotReturn>,
) -> Option<Goal> {
    // The J4 hysteresis margin: the incumbent's candidate is boosted in the comparisons
    // below, so a challenger must beat it by the margin, while every stored and returned
    // score stays the true one. Zero (the default) never reads the incumbent, and an
    // incumbent with no legal candidate boosts nothing, so it dies on its own.
    let incumbent = (params.goal_hysteresis_margin != 0.0)
        .then(|| view.incumbent_goal())
        .flatten();
    let boost = |kind: Buildable| {
        if incumbent == Some(kind) {
            params.goal_hysteresis_margin
        } else {
            0.0
        }
    };
    let mut best = None;
    if let Some((_, vertex_term)) = best_scored_vertex(view, params, BuildKind::City, stage, slot) {
        let numerator = if params
            .legacy_valuation
            .is_some_and(|legacy| legacy.flat_city_goal)
        {
            2.0
        } else {
            goal_value(vertex_term)
        };
        best = Some(Goal {
            kind: Buildable::City,
            score: numerator / turns_to_afford(view, Buildable::City).max(0.25),
        });
    }
    let settlement = if params
        .legacy_valuation
        .is_some_and(|legacy| legacy.pip_settlement_goal)
    {
        view.best_legal_settlement().map(|vertex| {
            (
                vertex,
                vertex_score_with(view, vertex, params, BuildKind::Settlement, None, stage, None),
            )
        })
    } else {
        best_scored_vertex(view, params, BuildKind::Settlement, stage, slot)
    };
    if let Some((_, vertex_term)) = settlement {
        let candidate = Goal {
            kind: Buildable::Settlement,
            score: goal_value(vertex_term) / turns_to_afford(view, Buildable::Settlement).max(0.25),
        };
        if best.is_none_or(|current: Goal| {
            candidate.score + boost(candidate.kind) > current.score + boost(current.kind)
        }) {
            best = Some(candidate);
        }
    }
    if let Some(road) = road {
        let candidate = Goal {
            kind: Buildable::Road,
            score: road.goal_score / turns_to_afford(view, Buildable::Road).max(0.25),
        };
        if best.is_none_or(|current: Goal| {
            candidate.score + boost(candidate.kind) > current.score + boost(current.kind)
        }) {
            best = Some(candidate);
        }
    }
    best
}

fn best_scored_vertex(
    view: &DecisionView<'_>,
    params: &HeuristicParams,
    kind: BuildKind,
    stage: Option<&Stage>,
    slot: Option<&SlotReturn>,
) -> Option<(u8, f32)> {
    let mut best = None;
    for vertex in (0..view.topology().vertex_count()).map(|vertex| vertex as u8) {
        let legal = match kind {
            BuildKind::Settlement => view.legal_settlement(vertex),
            BuildKind::City => view.legal_city(vertex),
        };
        if !legal {
            continue;
        }
        let score = vertex_score_with(view, vertex, params, kind, None, stage, slot);
        if score.is_finite() && best.is_none_or(|(_, current)| score > current) {
            best = Some((vertex, score));
        }
    }
    best
}

fn goal_value(vertex_term: f32) -> f32 {
    1.0 + vertex_term / 20.0
}

fn best_road(
    view: &DecisionView<'_>,
    params: &HeuristicParams,
    gated: Gated<'_>,
    stage: Option<&Stage>,
) -> Option<RoadGoal> {
    let mut best = None;
    // The trail search is the dominant cost of a decision, so the graph it walks is built once
    // here and probed per candidate -- and not at all when the card is out of reach.
    let mut network = longest_road_reachable(view, 1, gated).then(|| view.road_network());
    let cap = road_length_cap(view, gated);
    for edge in 0..view.topology().edge_count() {
        let edge = edge as u8;
        if !view.legal_road(edge) {
            continue;
        }
        let expansion_score = expansion_road_score(view, edge, params, stage);
        let new_length = network
            .as_mut()
            .map_or(0, |network| view.road_length_on(network, edge, None, cap));
        let contest = gated.map_or(0.0, |(ctx, denial_params)| {
            denial::contest_term(view, ctx, denial_params, edge)
        });
        let contest_goal = gated.map_or(0.0, |(_, denial_params)| {
            denial_params.contest_goal_share * contest / denial_params.contest_cap.max(f32::EPSILON)
        });
        let Some((action_bonus, goal_bonus)) = longest_road_value(view, new_length, gated) else {
            if expansion_score.is_none() {
                continue;
            }
            let candidate = RoadGoal {
                edge,
                action_score: 40.0 + expansion_score.unwrap_or_default() + contest,
                goal_score: 0.35 + contest_goal,
            };
            if best.is_none_or(|current: RoadGoal| candidate.action_score > current.action_score) {
                best = Some(candidate);
            }
            continue;
        };
        let candidate = RoadGoal {
            edge,
            action_score: action_bonus + expansion_score.unwrap_or_default() + contest,
            goal_score: 0.35 + goal_bonus + contest_goal,
        };
        if best.is_none_or(|current: RoadGoal| candidate.action_score > current.action_score) {
            best = Some(candidate);
        }
    }
    best
}

fn expansion_road_score(
    view: &DecisionView<'_>,
    first: u8,
    params: &HeuristicParams,
    stage: Option<&Stage>,
) -> Option<f32> {
    let mut best_score = None;
    for target in view.topology().edge_endpoints(first) {
        if view.is_expansion_target(target) {
            let score =
                vertex_score_with(view, target, params, BuildKind::Settlement, None, stage, None)
                    + 0.25;
            if best_score.is_none_or(|best| score > best) {
                best_score = Some(score);
            }
        }
    }
    for second in view.topology().edge_neighbors(first) {
        let second = *second;
        if !view.legal_road_after(first, second) {
            continue;
        }
        for target in view.topology().edge_endpoints(second) {
            if view.is_expansion_target(target) {
                let score = vertex_score_with(
                    view,
                    target,
                    params,
                    BuildKind::Settlement,
                    None,
                    stage,
                    None,
                );
                if best_score.is_none_or(|best| score > best) {
                    best_score = Some(score);
                }
            }
        }
    }
    best_score
}

/// Whether laying `added` more segments could possibly earn any Longest Road bonus.
///
/// `road_length_after` runs an exponential edge-simple-trail search, and the scoring loops call it
/// once per candidate road (and once per *pair* for road building), so evaluating it
/// unconditionally dominates the hot loop. This bounds the achievable trail by the number of
/// segments the observer would own, which is sound because a trail cannot reuse edges.
///
/// The bound is deliberately NOT `current_length + added`: one edge can bridge two disconnected
/// components into `a + b + 1`, and every seat starts setup with two separate road stubs, so that
/// tighter-looking bound is false and would skip roads that win the card outright. The slack of 2
/// keeps the near-miss progress branch of `longest_road_value` reachable.
fn longest_road_reachable(view: &DecisionView<'_>, added: u8, gated: Gated<'_>) -> bool {
    if view.longest_road_holder() == Some(view.observer()) {
        return gated.is_some_and(|(ctx, _)| denial::should_defend(ctx).is_some());
    }
    let target = longest_road_target(view);
    view.own_road_count().saturating_add(added) >= target.saturating_sub(PROGRESS_SLACK)
}

/// The trail length that would take the Longest Road card.
fn longest_road_target(view: &DecisionView<'_>) -> u8 {
    let opponent_best = (0..view.seats())
        .filter(|seat| *seat != view.observer())
        .map(|seat| view.longest_road_len(seat))
        .max()
        .unwrap_or_default();
    view.longest_road_min().max(opponent_best.saturating_add(1))
}

/// The longest trail worth measuring exactly when scoring a prospective road.
///
/// `longest_road_value` reads a trail through two thresholds only: it is worthless at or below the
/// seat's current length, and it wins the card at or above the target. Every length beyond the
/// target scores the same, so the search may stop there -- which is precisely where a long
/// late-game network gets expensive to walk.
fn road_length_cap(view: &DecisionView<'_>, gated: Gated<'_>) -> u8 {
    let current = view.longest_road_len(view.observer());
    let base = longest_road_target(view).max(current.saturating_add(1));
    match gated {
        Some((_, params)) if view.longest_road_holder() == Some(view.observer()) => {
            base.max(denial::defend_probe_cap(current, params))
        }
        _ => base,
    }
}

/// How far below the card's threshold `longest_road_value` still pays a progress bonus.
const PROGRESS_SLACK: u8 = 2;

fn longest_road_value(
    view: &DecisionView<'_>,
    new_length: u8,
    gated: Gated<'_>,
) -> Option<(f32, f32)> {
    let observer = view.observer();
    if view.longest_road_holder() == Some(observer) {
        let (ctx, params) = gated?;
        let defender = denial::should_defend(ctx);
        #[cfg(test)]
        HOLDER_DEFEND_OBSERVATION.with(|observed| observed.set(Some(defender.is_some())));
        let _ = defender?;
        if new_length <= view.longest_road_len(observer) {
            return None;
        }
        return denial::defend_term(view, ctx, params, new_length);
    }
    let target = longest_road_target(view);
    let current = view.longest_road_len(observer);
    if new_length <= current {
        return None;
    }
    if new_length >= target {
        let pressure = gated.map_or(1.0, |(ctx, params)| {
            denial::pressure(ctx, params, view.longest_road_holder())
        });
        return Some((
            contested_card_score(
                view,
                view.longest_road_vp(),
                view.longest_road_holder().is_some(),
                pressure,
            ),
            (30.0 + 10.0 * win_proximity(view)) * pressure,
        ));
    }
    let before = target.saturating_sub(current);
    let after = target.saturating_sub(new_length);
    if after >= before || after > 2 {
        return None;
    }
    let progress = f32::from(before - after);
    let proximity = win_proximity(view);
    Some((
        40.0 + progress * (35.0 + 65.0 * proximity) / f32::from(after.max(1)),
        progress * (0.5 + 1.5 * proximity) / f32::from(after.max(1)),
    ))
}

fn contested_card_score(
    view: &DecisionView<'_>,
    vp: u8,
    denies_holder: bool,
    pressure: f32,
) -> f32 {
    if view.own_total_vp().saturating_add(vp) >= view.win_vp() {
        return 100_000.0 + f32::from(vp) * 100.0;
    }
    // Scale with the VP the card actually carries rather than sitting on a flat floor above the
    // city band: a variant that makes a bonus card worth 1 VP must not outrank a 2-VP city. At the
    // base-rules value of 2 this is the same 11_000 as before.
    (5_500.0 * f32::from(vp)
        + f32::from(vp) * 250.0
        + win_proximity(view) * 2_000.0
        + if denies_holder { 250.0 } else { 0.0 })
        * pressure
}

/// Test-facing entry to the development-card buy score, deriving the gated denial context the
/// same way `score_actions` does.
pub fn dev_buy_score(view: &DecisionView<'_>, params: &HeuristicParams) -> f32 {
    let denial_params = effective_denial(params);
    let denial_context = denial_params
        .as_ref()
        .map(|denial_params| denial::context(view, denial_params));
    let gated = denial_context.as_ref().zip(denial_params.as_ref());
    dev_card_score(view, params, gated)
}

fn dev_card_score(view: &DecisionView<'_>, params: &HeuristicParams, gated: Gated<'_>) -> f32 {
    if params
        .legacy_valuation
        .is_some_and(|legacy| legacy.deck_blind_buying)
    {
        return deck_blind_dev_card_score(view, gated);
    }
    let deck = view.deck_belief();
    let remaining = f32::from(deck.total());
    if remaining <= 0.0 {
        // Every consumer already gates on a non-empty deck; guard the divisions anyway.
        return 0.0;
    }
    let initial = view.dev_deck_initial();
    let initial_total = initial.iter().map(|count| f32::from(*count)).sum::<f32>();
    if initial_total <= 0.0 {
        return 0.0;
    }
    // Shares of the remaining deck, taken relative to the configured mix: an untouched deck
    // scores exactly like the old flat base, and a kind's factor rises above 1 only when draws
    // have enriched what is left.
    let expected = deck.expected();
    let share = |kind: usize| expected[kind] as f32 / remaining;
    let relative = |kinds: &[usize]| {
        let configured = kinds
            .iter()
            .map(|kind| f32::from(initial[*kind]))
            .sum::<f32>()
            / initial_total;
        if configured <= 0.0 {
            0.0
        } else {
            kinds.iter().map(|kind| share(*kind)).sum::<f32>() / configured
        }
    };
    let vp_rel = relative(&[DEV_VP]);
    let knight_rel = relative(&[DEV_KNIGHT]);
    let progress_rel = relative(&[DEV_ROAD_BUILDING, DEV_YEAR_OF_PLENTY, DEV_MONOPOLY]);
    // The old flat 45 base splits across what a blind draw can actually be: the certain point of
    // a victory-point card carries most of it, progress tempo the rest, and a thin knight slice
    // keeps a knight-only deck from pricing robber relief at zero. The chase term prices the
    // hidden points a draw still offers, growing as the observer closes on the win.
    let base = 45.0 * (0.55 * vp_rel + 0.35 * progress_rel + 0.10 * knight_rel);
    let vp_chase = share(DEV_VP) * 300.0 * win_proximity(view);
    if view.largest_army_holder() == Some(view.observer()) {
        // Defending Largest Army needs an actual knight draw, so the defend term scales with
        // knight enrichment.
        return base
            + vp_chase
            + gated
                .and_then(|(ctx, denial_params)| denial::army_defend_term(ctx, denial_params))
                .map_or(0.0, |term| term * knight_rel);
    }
    let holder_count = view
        .largest_army_holder()
        .map_or(0, |holder| view.knights_played(holder));
    let target = view
        .largest_army_min()
        .max(holder_count.saturating_add(u8::from(view.largest_army_holder().is_some())));
    let gap = target.saturating_sub(view.knights_played(view.observer()));
    let contest_bonus = match gap {
        0 | 1 => 160.0,
        2 => 80.0,
        3 => 25.0,
        _ => 0.0,
    };
    let pressure = gated.map_or(1.0, |(ctx, denial_params)| {
        denial::pressure(ctx, denial_params, view.largest_army_holder())
    });
    // Only a knight draw can advance the contest, so the bonus scales with knight enrichment.
    base + vp_chase + contest_bonus * (0.5 + win_proximity(view)) * pressure * knight_rel
}

/// The pre-SIM-GAP-17 composition-blind score, preserved bit-for-bit as the measurement
/// reference behind `LegacyValuation::deck_blind_buying`.
fn deck_blind_dev_card_score(view: &DecisionView<'_>, gated: Gated<'_>) -> f32 {
    if view.largest_army_holder() == Some(view.observer()) {
        return gated
            .and_then(|(ctx, params)| denial::army_defend_term(ctx, params))
            .map_or(45.0, |term| 45.0 + term);
    }
    let holder_count = view
        .largest_army_holder()
        .map_or(0, |holder| view.knights_played(holder));
    let target = view
        .largest_army_min()
        .max(holder_count.saturating_add(u8::from(view.largest_army_holder().is_some())));
    let gap = target.saturating_sub(view.knights_played(view.observer()));
    let contest_bonus = match gap {
        0 | 1 => 160.0,
        2 => 80.0,
        3 => 25.0,
        _ => 0.0,
    };
    let pressure = gated.map_or(1.0, |(ctx, params)| {
        denial::pressure(ctx, params, view.largest_army_holder())
    });
    45.0 + contest_bonus * (0.5 + win_proximity(view)) * pressure
}

/// The knight's play/hold price. Contested-card and progress terms scale with denial pressure
/// toward the Largest Army holder (SIM-GAP-05/06); under the threat gate the steal term prices
/// the victim through belief and the shared danger model, and the placement term rejoins play
/// timing to the robber placement value the chooser maximized (SIM-GAP-09). With every gate
/// off this is bit-identical to `frozen_knight_action_score`: the pressure multiplier is
/// exactly 1.0, the steal arm is the same expression, and the placement term is literal zero.
fn knight_action_score(
    view: &DecisionView<'_>,
    gated: Gated<'_>,
    destination: u8,
    victim: Option<u8>,
    threat: Option<(&ThreatParams, &threat::RobberChoice)>,
) -> f32 {
    let pressure = gated.map_or(1.0, |(ctx, denial_params)| {
        denial::pressure(ctx, denial_params, view.largest_army_holder())
    });
    if view.knight_takes_largest_army() {
        return contested_card_score(
            view,
            view.largest_army_vp(),
            view.largest_army_holder().is_some(),
            pressure,
        );
    }
    let next = view
        .knights_played(view.observer())
        .saturating_add(1)
        .min(view.largest_army_min());
    let progress = f32::from(next) / f32::from(view.largest_army_min().max(1))
        * (45.0 + 35.0 * win_proximity(view))
        * pressure;
    let blocked = if view.hex_touches_seat(view.robber(), view.observer()) {
        f32::from(view.board().tokens()[usize::from(view.robber())].map_or(0, pips)) * 12.0
    } else {
        0.0
    };
    let (steal, placement) = match threat {
        Some((threat_params, choice)) => (
            (threat_params.knight_steal_weight * choice.steal_value) as f32,
            (threat_params.knight_placement_weight * choice.placement_score) as f32,
        ),
        None => (
            victim.map_or(0.0, |seat| {
                f32::from(view.hand_size(usize::from(seat)).min(12)) * 2.0
            }),
            0.0,
        ),
    };
    20.0 + progress
        + blocked
        + steal
        + placement
        + if destination != view.robber() {
            1.0
        } else {
            0.0
        }
}

/// The pre-SIM-GAP-05/06/09 knight score, preserved bit-for-bit as the measurement reference
/// behind `LegacyValuation::frozen_knight`.
fn frozen_knight_action_score(view: &DecisionView<'_>, destination: u8, victim: Option<u8>) -> f32 {
    if view.knight_takes_largest_army() {
        return contested_card_score(
            view,
            view.largest_army_vp(),
            view.largest_army_holder().is_some(),
            1.0,
        );
    }
    let next = view
        .knights_played(view.observer())
        .saturating_add(1)
        .min(view.largest_army_min());
    let progress = f32::from(next) / f32::from(view.largest_army_min().max(1))
        * (45.0 + 35.0 * win_proximity(view));
    let blocked = if view.hex_touches_seat(view.robber(), view.observer()) {
        f32::from(view.board().tokens()[usize::from(view.robber())].map_or(0, pips)) * 12.0
    } else {
        0.0
    };
    let steal = victim.map_or(0.0, |seat| {
        f32::from(view.hand_size(usize::from(seat)).min(12)) * 2.0
    });
    20.0 + progress
        + blocked
        + steal
        + if destination != view.robber() {
            1.0
        } else {
            0.0
        }
}

pub(crate) fn win_proximity(view: &DecisionView<'_>) -> f32 {
    f32::from(view.own_total_vp()) / f32::from(view.win_vp().max(1))
}

fn best_road_building_pair(
    view: &DecisionView<'_>,
    params: &HeuristicParams,
    gated: Gated<'_>,
    stage: Option<&Stage>,
) -> (Option<u8>, Option<u8>) {
    let mut best = (None, None);
    let mut best_score = f32::NEG_INFINITY;
    // Road building lays two segments, so the card is reachable from two further out.
    let mut network = longest_road_reachable(view, 2, gated).then(|| view.road_network());
    let cap = road_length_cap(view, gated);
    let ungated_pair = params
        .legacy_valuation
        .is_some_and(|legacy| legacy.ungated_pair);
    #[cfg(test)]
    PAIR_PROBE_CAP.with(|recorded| recorded.set(Some(cap)));
    for first in 0..view.topology().edge_count() {
        let first = first as u8;
        if !view.legal_road(first) {
            continue;
        }
        let mut found_second = false;
        for second in view.topology().edge_neighbors(first) {
            let second = *second;
            if !view.legal_road_after(first, second) {
                continue;
            }
            found_second = true;
            let expansion_score = if ungated_pair {
                view.topology()
                    .edge_endpoints(second)
                    .iter()
                    .map(|vertex| {
                        vertex_score_with(
                            view,
                            *vertex,
                            params,
                            BuildKind::Settlement,
                            None,
                            stage,
                            None,
                        )
                    })
                    .fold(f32::NEG_INFINITY, f32::max)
            } else {
                // Mirror `expansion_road_score`'s gate over both laid edges; the `Option` fold
                // keeps a pair laid purely for Longest Road at zero credit instead of poisoning
                // its whole score to `NEG_INFINITY`.
                [first, second]
                    .into_iter()
                    .flat_map(|edge| view.topology().edge_endpoints(edge))
                    .filter(|vertex| view.is_expansion_target(*vertex))
                    .map(|vertex| {
                        vertex_score_with(
                            view,
                            vertex,
                            params,
                            BuildKind::Settlement,
                            None,
                            stage,
                            None,
                        )
                    })
                    .fold(None, |best: Option<f32>, score| {
                        Some(best.map_or(score, |best| best.max(score)))
                    })
                    .unwrap_or(0.0)
            };
            #[cfg(test)]
            PAIR_EXPANSION.with(|recorded| recorded.set(recorded.get().max(expansion_score)));
            let road_bonus = network.as_mut().map_or(0.0, |network| {
                let length = view.road_length_on(network, first, Some(second), cap);
                longest_road_value(view, length, gated)
                    .map_or(0.0, |(action_score, _)| action_score)
            });
            #[cfg(test)]
            PAIR_ROAD_BONUS.with(|recorded| recorded.set(recorded.get().max(road_bonus)));
            let contest = gated.map_or(0.0, |(ctx, denial_params)| {
                denial::contest_term(view, ctx, denial_params, first).max(denial::contest_term(
                    view,
                    ctx,
                    denial_params,
                    second,
                ))
            });
            #[cfg(test)]
            PAIR_CONTEST.with(|recorded| recorded.set(recorded.get().max(contest)));
            let score = expansion_score + road_bonus + contest;
            if score > best_score {
                best = (Some(first), Some(second));
                best_score = score;
            }
        }
        if !found_second && best.0.is_none() {
            best = (Some(first), None);
        }
    }
    best
}

#[cfg(test)]
std::thread_local! {
    static PAIR_PROBE_CAP: std::cell::Cell<Option<u8>> = const { std::cell::Cell::new(None) };
}

#[cfg(test)]
pub(crate) fn reset_pair_probe_cap() {
    PAIR_PROBE_CAP.with(|recorded| recorded.set(None));
}

#[cfg(test)]
pub(crate) fn pair_probe_cap() -> Option<u8> {
    PAIR_PROBE_CAP.with(std::cell::Cell::get)
}

#[cfg(test)]
pub(crate) fn reset_holder_defend_observation() {
    HOLDER_DEFEND_OBSERVATION.with(|observed| observed.set(None));
}

#[cfg(test)]
pub(crate) fn holder_defend_observation() -> Option<bool> {
    HOLDER_DEFEND_OBSERVATION.with(std::cell::Cell::get)
}

#[cfg(test)]
pub(crate) fn reset_pair_road_bonus() {
    PAIR_ROAD_BONUS.with(|recorded| recorded.set(0.0));
}

#[cfg(test)]
pub(crate) fn reset_pair_expansion() {
    PAIR_EXPANSION.with(|recorded| recorded.set(f32::NEG_INFINITY));
}

#[cfg(test)]
pub(crate) fn pair_expansion() -> f32 {
    PAIR_EXPANSION.with(std::cell::Cell::get)
}

#[cfg(test)]
pub(crate) fn pair_road_bonus() -> f32 {
    PAIR_ROAD_BONUS.with(std::cell::Cell::get)
}

#[cfg(test)]
pub(crate) fn reset_pair_contest() {
    PAIR_CONTEST.with(|recorded| recorded.set(0.0));
}

#[cfg(test)]
pub(crate) fn pair_contest() -> f32 {
    PAIR_CONTEST.with(std::cell::Cell::get)
}

#[cfg(test)]
pub(crate) fn reset_best_goal_calls() {
    BEST_GOAL_CALLS.with(|calls| calls.set(0));
}

#[cfg(test)]
pub(crate) fn best_goal_calls() -> u32 {
    BEST_GOAL_CALLS.with(std::cell::Cell::get)
}

#[cfg(test)]
#[allow(dead_code)]
pub(crate) fn reset_crossing_census() {
    CROSSING_CENSUS.with(|crossings| crossings.borrow_mut().clear());
}

#[cfg(test)]
#[allow(dead_code)]
pub(crate) fn crossing_census() -> Vec<CensusCrossing> {
    CROSSING_CENSUS.with(|crossings| crossings.borrow().clone())
}

#[cfg(test)]
#[allow(dead_code)]
pub(crate) fn reset_decision_trace() {
    DECISION_TRACE.with(|trace| trace.borrow_mut().clear());
}

#[cfg(test)]
#[allow(dead_code)]
pub(crate) fn decision_trace() -> Vec<DecisionTrace> {
    DECISION_TRACE.with(|trace| trace.borrow().clone())
}

#[cfg(test)]
pub(crate) fn replace_last_trace_selected(selected: Action) {
    DECISION_TRACE.with(|trace| {
        if let Some(last) = trace.borrow_mut().last_mut() {
            last.selected = selected;
        }
    });
}

fn turns_for_cost(view: &DecisionView<'_>, cost: &[u8; RESOURCE_COUNT]) -> f32 {
    let income = view.production_pips(view.observer());
    let mut turns = 0.0_f32;
    for resource in Resource::ALL {
        let missing =
            (i16::from(cost[resource.index()]) - view.own_hand()[resource.index()]).max(0);
        if missing == 0 {
            continue;
        }
        let direct = f32::from(income[resource.index()]) / 36.0;
        let trade_income = Resource::ALL
            .iter()
            .filter(|other| **other != resource)
            .map(|other| f32::from(income[other.index()]) / 36.0 / view.trade_rate(*other) as f32)
            .sum::<f32>();
        let rate = direct + trade_income;
        turns = turns.max(if rate > 0.0 {
            f32::from(missing) / rate
        } else {
            100.0
        });
    }
    turns.max(0.25)
}

fn completing_or_improving_trades<'a>(
    view: &'a DecisionView<'a>,
    goal: Buildable,
) -> impl Iterator<Item = Action> + 'a {
    Resource::ALL.into_iter().flat_map(move |give| {
        Resource::ALL.into_iter().filter_map(move |get| {
            if give == get || !view.legal_trade(give, get, 1) {
                return None;
            }
            let before = view
                .costs(goal)
                .iter()
                .map(|cost| missing_units(view.own_hand(), cost))
                .min()
                .unwrap_or(u16::MAX);
            let mut hand = *view.own_hand();
            hand[give.index()] -= view.trade_rate(give) as i16;
            hand[get.index()] += 1;
            let improves = view
                .costs(goal)
                .iter()
                .any(|cost| can_pay(&hand, cost) || missing_units(&hand, cost) < before);
            improves.then_some(Action::TradeBank {
                give,
                get,
                count: 1,
            })
        })
    })
}

pub(crate) fn missing_units(hand: &[i16; RESOURCE_COUNT], cost: &[u8; RESOURCE_COUNT]) -> u16 {
    (0..RESOURCE_COUNT)
        .map(|index| u16::try_from((i16::from(cost[index]) - hand[index]).max(0)).unwrap_or(0))
        .sum()
}

fn trade_completes(view: &DecisionView<'_>, goal: Buildable, trade: Action) -> bool {
    view.costs(goal)
        .iter()
        .any(|cost| trade_completes_cost(view, cost, trade))
}

fn trade_completes_cost(
    view: &DecisionView<'_>,
    cost: &[u8; RESOURCE_COUNT],
    trade: Action,
) -> bool {
    let Action::TradeBank { give, get, count } = trade else {
        return false;
    };
    let mut hand = *view.own_hand();
    hand[give.index()] -= (view.trade_rate(give) * u32::from(count)) as i16;
    hand[get.index()] += i16::from(count);
    can_pay(&hand, cost)
}

/// Two Year of Plenty picks, chosen by value rather than index order.
///
/// Goal need dominates: the closest cost variant's missing resources are taken first, and a
/// resource missing twice may be taken twice. Once need is exhausted the remaining picks are
/// spares, ranked by how hard the resource is to obtain otherwise — fewest own production pips
/// first, then scarcest bank stock, then the highest index (this module's `max_by_key` ties
/// already resolve high). Every pick respects remaining bank stock, so a bank-blocked need
/// degrades to a spare pick instead of cancelling the offer, and with no goal (or an already
/// affordable one) the card still banks the two most valuable spares. The returned pair is in
/// index order because the picks are interchangeable at apply time.
pub fn plenty_offer(
    view: &DecisionView<'_>,
    goal: Option<Buildable>,
    params: &HeuristicParams,
) -> Option<(Resource, Resource)> {
    if params
        .legacy_valuation
        .is_some_and(|legacy| legacy.narrow_card_plays)
    {
        return goal.and_then(|goal| narrow_plenty_for_goal(view, goal));
    }
    let missing = goal.map_or([0; RESOURCE_COUNT], |goal| {
        closest_variant_missing(view, goal)
    });
    let own_pips = view.production_pips(view.observer());
    let mut taken = [0_u16; RESOURCE_COUNT];
    let mut pair = [Resource::Wood; 2];
    for slot in &mut pair {
        let choice = Resource::ALL
            .into_iter()
            .filter(|resource| view.bank(*resource) > taken[resource.index()])
            .max_by_key(|resource| {
                let index = resource.index();
                (
                    u16::from(missing[index]).saturating_sub(taken[index]),
                    std::cmp::Reverse(own_pips[index]),
                    std::cmp::Reverse(view.bank(*resource)),
                    index,
                )
            })?;
        taken[choice.index()] += 1;
        *slot = choice;
    }
    if pair[1].index() < pair[0].index() {
        pair.swap(0, 1);
    }
    Some((pair[0], pair[1]))
}

/// The missing-resource vector of the goal's closest cost variant, or all zeros when the goal
/// is already affordable (the card owes it nothing). Ties between equally close variants keep
/// the earlier variant, matching the payment path's variant order. Shared with the J1
/// goal-need model (`goal_need::GoalNeed::derive`) so "what the goal is short of" has one
/// spelling.
pub(crate) fn closest_variant_missing(
    view: &DecisionView<'_>,
    goal: Buildable,
) -> [u8; RESOURCE_COUNT] {
    if view.can_afford(goal) {
        return [0; RESOURCE_COUNT];
    }
    let mut best: Option<(u16, [u8; RESOURCE_COUNT])> = None;
    for cost in view.costs(goal) {
        let mut missing = [0_u8; RESOURCE_COUNT];
        let mut total = 0_u16;
        for resource in 0..RESOURCE_COUNT {
            missing[resource] =
                u8::try_from((i16::from(cost[resource]) - view.own_hand()[resource]).max(0))
                    .unwrap_or(u8::MAX);
            total += u16::from(missing[resource]);
        }
        if best.is_none_or(|(least, _)| total < least) {
            best = Some((total, missing));
        }
    }
    best.map_or([0; RESOURCE_COUNT], |(_, missing)| missing)
}

/// The measurement-only pre-widening offer: exactly two short of the goal, index-order picks.
fn narrow_plenty_for_goal(view: &DecisionView<'_>, goal: Buildable) -> Option<(Resource, Resource)> {
    for cost in view.costs(goal) {
        let mut missing = [0_u8; RESOURCE_COUNT];
        let mut total = 0;
        for resource in 0..RESOURCE_COUNT {
            missing[resource] =
                u8::try_from((i16::from(cost[resource]) - view.own_hand()[resource]).max(0))
                    .unwrap_or(0);
            total += missing[resource];
        }
        if total == 2 {
            let first = (0..RESOURCE_COUNT).find(|index| missing[*index] > 0)?;
            missing[first] -= 1;
            let second = (0..RESOURCE_COUNT)
                .find(|index| missing[*index] > 0)
                .unwrap_or(first);
            let first = Resource::ALL[first];
            let second = Resource::ALL[second];
            let needed = u16::from(first == second) + 1;
            if view.bank(first) > 0 && view.bank(second) >= needed {
                return Some((first, second));
            }
        }
    }
    None
}

/// The monopoly pick considers a resource missing under any cost variant of the goal, not just
/// the first; ranking among candidates stays the expected-haul proxy.
pub fn monopoly_for_goal(
    view: &DecisionView<'_>,
    goal: Buildable,
    params: &HeuristicParams,
) -> Option<Resource> {
    let costs = view.costs(goal);
    let costs = if params
        .legacy_valuation
        .is_some_and(|legacy| legacy.narrow_card_plays)
    {
        &costs[..costs.len().min(1)]
    } else {
        costs
    };
    Resource::ALL
        .into_iter()
        .filter(|resource| {
            costs
                .iter()
                .any(|cost| view.own_hand()[resource.index()] < i16::from(cost[resource.index()]))
        })
        .max_by_key(|resource| expected_monopoly(view, *resource))
        .filter(|resource| expected_monopoly(view, *resource) > 0)
}

fn expected_monopoly(view: &DecisionView<'_>, resource: Resource) -> u32 {
    (0..view.seats())
        .filter(|seat| *seat != view.observer())
        .map(|seat| {
            let production = view.production_pips(seat);
            let total: u16 = production.iter().sum();
            if total == 0 {
                0
            } else {
                u32::from(view.hand_size(seat)) * u32::from(production[resource.index()])
                    / u32::from(total)
            }
        })
        .sum()
}

#[cfg(test)]
mod devcards_rate_tests {
    use std::fs;
    use std::path::PathBuf;

    use crate::board::{ConversionOptions, SimBoard};
    use crate::game::{GameArena, GameConfig};
    use crate::policy::{PolicyKind, PolicyScratch};
    use crate::rng::Xoshiro256StarStar;
    use crate::rules::{Buildable, Resource, RuleConfig};
    use crate::topology::{Layout, Topology};
    use crate::view::{Action, DecisionPhase};
    use crate::wire::{Coord, TileKind, WireBoard, WireHex, WirePlayer};

    fn standard_board(topology: &Topology, rules: &RuleConfig) -> SimBoard {
        let mut tiles = vec![
            TileKind::Wood,
            TileKind::Wood,
            TileKind::Wood,
            TileKind::Wood,
            TileKind::Sheep,
            TileKind::Sheep,
            TileKind::Sheep,
            TileKind::Sheep,
            TileKind::Wheat,
            TileKind::Wheat,
            TileKind::Wheat,
            TileKind::Wheat,
            TileKind::Brick,
            TileKind::Brick,
            TileKind::Brick,
            TileKind::Ore,
            TileKind::Ore,
            TileKind::Ore,
            TileKind::Desert,
        ];
        let mut tokens =
            vec![5, 2, 6, 3, 8, 10, 9, 12, 11, 4, 8, 10, 9, 4, 5, 6, 3, 11].into_iter();
        let hexes = (0..topology.hex_count())
            .map(|hex| {
                let key = topology.hex_key(hex as u8);
                let (q, r) = key.split_once(',').unwrap();
                let tile = tiles.remove(0);
                WireHex {
                    coord: Coord {
                        q: q.parse().unwrap(),
                        r: r.parse().unwrap(),
                    },
                    number_token: (tile != TileKind::Desert)
                        .then(|| f64::from(tokens.next().unwrap())),
                    tile: Some(tile),
                }
            })
            .collect();
        let wire = WireBoard {
            schema_version: 1,
            layout: Layout::Standard4,
            hexes,
            ports: Vec::new(),
            robber: None,
            roads: Vec::new(),
            buildings: Vec::new(),
            players: (0..4)
                .map(|seat| WirePlayer {
                    id: format!("p{seat}"),
                    name: format!("P{seat}"),
                    color: "red".into(),
                })
                .collect(),
            me_player_id: None,
        };
        SimBoard::try_from_wire(wire, topology, rules, ConversionOptions::default()).unwrap()
    }

    fn valuation_fixture() -> (Topology, SimBoard, GameArena) {
        let topology = Topology::load(Layout::Standard4).unwrap();
        let rules = RuleConfig::base(Layout::Standard4);
        let board = standard_board(&topology, &rules);
        let mut arena = GameArena::default();
        arena.prepare(&board, &topology, &rules, &GameConfig::default());
        (topology, board, arena)
    }

    #[test]
    fn old_band_settlement_maximum_uses_direct_vertex_score() {
        let (topology, board, mut arena) = valuation_fixture();
        let target = 0_u8;
        arena.state.edge_owner[usize::from(topology.vertex_edges(target)[0])] = 0;
        let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
        arena.state.players[0].resources = view.costs(Buildable::Settlement)[0].map(i16::from);
        let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
        let params = super::HeuristicParams::default();
        let mut actions = crate::view::ActionBuf::new();
        super::score_actions(&view, &params, &mut actions);

        let direct = actions
            .as_slice()
            .iter()
            .filter_map(|candidate| match candidate.action {
                Action::BuildSettlement(vertex) => Some(
                    500.0
                        + super::vertex_score(&view, vertex, &params, super::BuildKind::Settlement),
                ),
                _ => None,
            })
            .fold(f32::NEG_INFINITY, f32::max);
        let rebased = actions
            .as_slice()
            .iter()
            .filter(|candidate| matches!(candidate.action, Action::BuildSettlement(_)))
            .map(|candidate| candidate.score - super::BUILD_BAND + 500.0)
            .fold(f32::NEG_INFINITY, f32::max);
        let actual = super::old_band_settlement_score(&view, &params, &actions).unwrap();

        assert_ne!(
            direct.to_bits(),
            rebased.to_bits(),
            "fixture must expose the lossy building-band rebase"
        );
        assert_eq!(actual.to_bits(), direct.to_bits());
    }

    #[test]
    fn action_with_goal_uses_the_hoisted_goal() {
        let (topology, board, mut arena) = valuation_fixture();
        let target = 0_u8;
        arena.state.edge_owner[usize::from(topology.vertex_edges(target)[0])] = 0;
        arena.state.players[0].pieces[Buildable::Road.index()] = 0;
        let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
        let cost = view.costs(Buildable::Settlement)[0];
        let get = Resource::ALL
            .into_iter()
            .find(|resource| cost[resource.index()] > 0)
            .unwrap();
        let give = Resource::ALL
            .into_iter()
            .find(|resource| *resource != get)
            .unwrap();
        arena.state.players[0].resources = cost.map(i16::from);
        arena.state.players[0].resources[get.index()] -= 1;
        arena.state.players[0].resources[give.index()] += 4;
        let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
        let mut scratch = PolicyScratch::default();
        let mut rng = Xoshiro256StarStar::from_seed(3);
        let (action, goal) = super::action_with_goal(
            &view,
            &mut scratch,
            &super::HeuristicParams::default(),
            &mut rng,
        );
        assert_eq!(goal.map(|goal| goal.kind), Some(Buildable::Settlement));
        assert_eq!(
            action,
            Action::TradeBank {
                give,
                get,
                count: 1,
            }
        );
    }

    #[test]
    fn the_chooser_returns_none_when_every_candidate_is_non_finite() {
        let (topology, board, mut arena) = valuation_fixture();
        arena.state.edge_owner[usize::from(topology.vertex_edges(0)[0])] = 0;
        arena.state.players[0].pieces[Buildable::Road.index()] = 0;
        let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
        let params = super::HeuristicParams {
            production_weight: f32::INFINITY,
            scarcity_weight: f32::INFINITY,
            diversity_bonus: f32::INFINITY,
            port_weight: f32::INFINITY,
            expansion_weight: f32::INFINITY,
            ..super::HeuristicParams::default()
        };
        assert_eq!(
            super::best_scored_vertex(&view, &params, super::BuildKind::Settlement, None, None),
            None
        );
    }

    #[test]
    fn the_goal_is_computed_once_per_action_decision() {
        let (topology, board, arena) = valuation_fixture();
        let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
        let mut scratch = PolicyScratch::default();
        let mut rng = Xoshiro256StarStar::from_seed(4);
        super::reset_best_goal_calls();
        super::action_with_goal(
            &view,
            &mut scratch,
            &super::HeuristicParams::default(),
            &mut rng,
        );
        assert_eq!(super::best_goal_calls(), 1);
    }

    #[test]
    fn the_scored_chooser_breaks_ties_by_lowest_vertex_index() {
        let (topology, board, mut arena) = valuation_fixture();
        let first = 0_u8;
        let second = (1..topology.vertex_count())
            .map(|vertex| vertex as u8)
            .find(|vertex| !topology.vertex_adjacent(first).contains(vertex))
            .unwrap();
        for vertex in [first, second] {
            arena.state.edge_owner[usize::from(topology.vertex_edges(vertex)[0])] = 0;
        }
        arena.state.players[0].pieces[Buildable::Road.index()] = 0;
        let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
        let params = super::HeuristicParams {
            production_weight: 0.0,
            scarcity_weight: 0.0,
            diversity_bonus: 0.0,
            port_weight: 0.0,
            expansion_weight: 0.0,
            ..super::HeuristicParams::default()
        };
        assert_eq!(
            super::best_scored_vertex(&view, &params, super::BuildKind::Settlement, None, None)
                .map(|(vertex, _)| vertex),
            Some(first.min(second))
        );
    }

    #[test]
    fn building_scores_stay_below_the_contested_card_band_under_default_weights() {
        let (topology, board, arena) = valuation_fixture();
        let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
        let params = super::HeuristicParams::default();
        let building = (0..topology.vertex_count())
            .map(|vertex| vertex as u8)
            .map(|vertex| {
                super::BUILD_BAND
                    + super::vertex_score(&view, vertex, &params, super::BuildKind::Settlement)
            })
            .fold(f32::NEG_INFINITY, f32::max);
        let contested = super::contested_card_score(&view, 2, false, 1.0);
        assert!(
            building < contested,
            "{building} must stay below {contested}"
        );
    }

    /// The headroom above only holds for a two-VP card. Merging the settlement rung into
    /// `BUILD_BAND` lifted buildings past the one-VP contested value, which the old `500.0` rung
    /// sat far below, so a rules variant worth one VP now loses to an affordable settlement. No
    /// shipped config sets `longest_road_vp`/`largest_army_vp` to one; this pins the inversion so
    /// a variant that does cannot introduce it silently.
    #[test]
    fn a_one_vp_contested_card_now_falls_inside_the_building_band() {
        let (topology, board, arena) = valuation_fixture();
        let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
        assert_eq!(view.longest_road_vp(), 2, "fixture must use base rules");
        let one_vp = super::contested_card_score(&view, 1, false, 1.0);
        let two_vp = super::contested_card_score(&view, 2, false, 1.0);
        assert!(one_vp < super::BUILD_BAND, "{one_vp} is inside the band");
        assert!(two_vp > super::BUILD_BAND, "{two_vp} must clear the band");
    }

    /// The settlement branch of the chooser is guarded by a negative-weight fixture elsewhere; the
    /// city branch needs its own, because with positive weights pip order and score order agree and
    /// a chooser ranking cities on `vertex_pips` would pass unnoticed.
    #[test]
    fn the_city_chooser_ranks_by_score_not_pips() {
        let (topology, board, mut arena) = valuation_fixture();
        let mut owned = Vec::new();
        for vertex in (0..topology.vertex_count()).map(|vertex| vertex as u8) {
            if owned.len() == 2 {
                break;
            }
            if owned
                .iter()
                .any(|held| topology.vertex_adjacent(vertex).contains(held))
            {
                continue;
            }
            arena.state.vertex_owner[usize::from(vertex)] = 0;
            arena.state.vertex_tier[usize::from(vertex)] = 1;
            owned.push(vertex);
        }
        let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
        let pips: Vec<u16> = owned
            .iter()
            .map(|vertex| view.vertex_pips(*vertex, true))
            .collect();
        assert_ne!(pips[0], pips[1], "fixture must break the pip tie");
        // Negative production inverts the ranking, so score order is the reverse of pip order and
        // the two choosers cannot agree by accident.
        let params = super::HeuristicParams {
            production_weight: -10.0,
            scarcity_weight: 0.0,
            diversity_bonus: 0.0,
            port_weight: 0.0,
            expansion_weight: 0.0,
            ..super::HeuristicParams::default()
        };
        let pip_max = if pips[0] > pips[1] { owned[0] } else { owned[1] };
        let score_max = if pips[0] > pips[1] { owned[1] } else { owned[0] };
        assert_eq!(
            super::best_scored_vertex(&view, &params, super::BuildKind::City, None, None)
                .map(|(vertex, _)| vertex),
            Some(score_max),
            "the city chooser must not rank on pips ({pip_max} is the pip maximum)"
        );
    }

    /// The attribution in M-22 rests on all five flags together reproducing the pre-batch
    /// valuation. Nothing else asserts it, so this freezes the pre-batch expression as a closed
    /// form and checks `legacyall` against it bit-for-bit on every vertex of the fixture.
    #[test]
    fn every_legacy_flag_set_reproduces_the_pre_batch_vertex_score() {
        let (topology, board, mut arena) = valuation_fixture();
        for vertex in (0..topology.vertex_count()).map(|vertex| vertex as u8).take(3) {
            arena.state.vertex_owner[usize::from(vertex)] = 0;
            arena.state.vertex_tier[usize::from(vertex)] = 1;
        }
        let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
        let legacy = super::HeuristicParams {
            legacy_valuation: Some(super::LegacyValuation {
                local_port_production: true,
                pip_settlement_goal: true,
                flat_city_goal: true,
                settlement_shaped_city_terms: true,
                band_ladder: true,
                ..super::LegacyValuation::default()
            }),
            ..super::HeuristicParams::default()
        };
        let params = super::HeuristicParams::default();
        for vertex in (0..topology.vertex_count()).map(|vertex| vertex as u8) {
            // The pre-batch scorer had no build kind: one settlement-shaped expression, with the
            // port term reading vertex-local production only.
            let expected =
                super::vertex_score(&view, vertex, &legacy, super::BuildKind::Settlement);
            for kind in [super::BuildKind::Settlement, super::BuildKind::City] {
                let actual = super::vertex_score(&view, vertex, &legacy, kind);
                assert_eq!(
                    actual.to_bits(),
                    expected.to_bits(),
                    "legacyall must be kind-independent at vertex {vertex}"
                );
            }
            // And it must actually differ from the fixed scorer somewhere, or the check is vacuous.
            let fixed = super::vertex_score(&view, vertex, &params, super::BuildKind::City);
            if fixed.to_bits() != expected.to_bits() {
                return;
            }
        }
        panic!("fixture never separates the legacy and fixed scorers");
    }

    /// Mirrors `best_road_building_pair`'s selection loop so a test can pin the chosen pair
    /// against a closed-form credit; iteration order and the strict `>` tie rule match exactly.
    fn pair_choice(
        view: &crate::view::DecisionView<'_>,
        topology: &Topology,
        credit: impl Fn(u8, u8) -> f32,
    ) -> (Option<u8>, Option<u8>) {
        let mut best = (None, None);
        let mut best_score = f32::NEG_INFINITY;
        for first in 0..topology.edge_count() {
            let first = first as u8;
            if !view.legal_road(first) {
                continue;
            }
            let mut found_second = false;
            for second in topology.edge_neighbors(first) {
                if !view.legal_road_after(first, *second) {
                    continue;
                }
                found_second = true;
                let score = credit(first, *second);
                if score > best_score {
                    best = (Some(first), Some(*second));
                    best_score = score;
                }
            }
            if !found_second && best.0.is_none() {
                best = (Some(first), None);
            }
        }
        best
    }

    // Forwarded arguments of `best_road_building_pair`, one observing test each:
    // - `view` (pair legality and the `is_expansion_target` gate):
    //   the_pair_credit_is_gated_and_reads_both_edges
    // - `params` (vertex-score weights and `legacy_valuation.ungated_pair`):
    //   the_pair_credit_is_gated_and_reads_both_edges, both halves
    // - `gated` (denial contest term and the race budget): road_building_is_aimed_by_the_denial_terms
    //   and the_default_budget_finds_the_third_ranked_challenger in tests/denial.rs
    // - `stage` (the J2 damping on target vertex scores):
    //   the_road_and_pair_expansion_credits_price_targets_through_the_stage
    #[test]
    fn the_pair_credit_is_gated_and_reads_both_edges() {
        let params = super::HeuristicParams {
            production_weight: 2.5,
            scarcity_weight: 0.6,
            diversity_bonus: 0.0,
            port_weight: 0.0,
            expansion_weight: 0.0,
            ..super::HeuristicParams::default()
        };
        let legacy = super::HeuristicParams {
            legacy_valuation: Some(super::LegacyValuation {
                ungated_pair: true,
                ..super::LegacyValuation::default()
            }),
            ..params.clone()
        };
        let (topology, board, mut arena) = valuation_fixture();
        // A distant rival trail parks the Longest Road race out of reach, so the pair choice
        // reads the expansion credit alone and the closed forms below stay road-bonus-free.
        arena.state.players[1].longest_road_len = 10;
        // A settlement plus a two-road spur puts legal pairs both at the settlement (whose
        // surroundings the distance rule blocks) and at the spur tip (whose far endpoints are
        // settleable), so all three candidate credits can disagree.
        (0..topology.vertex_count())
            .find_map(|start| {
                let start = start as u8;
                let first_leg = topology.vertex_edges(start)[0];
                let [near, far] = topology.edge_endpoints(first_leg);
                let anchor = if near == start { far } else { near };
                let second_leg = *topology
                    .vertex_edges(anchor)
                    .iter()
                    .find(|edge| **edge != first_leg)?;
                arena.state.vertex_owner[usize::from(start)] = 0;
                arena.state.vertex_tier[usize::from(start)] = 1;
                arena.state.edge_owner[usize::from(first_leg)] = 0;
                arena.state.edge_owner[usize::from(second_leg)] = 0;
                let view = arena.decision_view(&board, &topology, 0, DecisionPhase::PreRoll);
                let score = |vertex: u8| {
                    super::vertex_score(&view, vertex, &params, super::BuildKind::Settlement)
                };
                let gated_both = pair_choice(&view, &topology, |first, second| {
                    [first, second]
                        .into_iter()
                        .flat_map(|edge| topology.edge_endpoints(edge))
                        .filter(|vertex| view.is_expansion_target(*vertex))
                        .map(score)
                        .fold(None, |best: Option<f32>, value| {
                            Some(best.map_or(value, |best| best.max(value)))
                        })
                        .unwrap_or(0.0)
                });
                let gated_second_only = pair_choice(&view, &topology, |_, second| {
                    topology
                        .edge_endpoints(second)
                        .into_iter()
                        .filter(|vertex| view.is_expansion_target(*vertex))
                        .map(score)
                        .fold(None, |best: Option<f32>, value| {
                            Some(best.map_or(value, |best| best.max(value)))
                        })
                        .unwrap_or(0.0)
                });
                let ungated_second_only = pair_choice(&view, &topology, |_, second| {
                    topology
                        .edge_endpoints(second)
                        .into_iter()
                        .map(score)
                        .fold(f32::NEG_INFINITY, f32::max)
                });
                let separated =
                    gated_both != ungated_second_only && gated_both != gated_second_only;
                if separated {
                    assert_eq!(
                        super::best_road_building_pair(&view, &params, None, None),
                        gated_both,
                        "the credit must gate on expansion targets and read the first edge too"
                    );
                    assert_eq!(
                        super::best_road_building_pair(&view, &legacy, None, None),
                        ungated_second_only,
                        "the legacy flag must restore the ungated second-edge credit"
                    );
                }
                arena.state.vertex_owner[usize::from(start)] = u8::MAX;
                arena.state.vertex_tier[usize::from(start)] = 0;
                arena.state.edge_owner[usize::from(first_leg)] = u8::MAX;
                arena.state.edge_owner[usize::from(second_leg)] = u8::MAX;
                separated.then_some(())
            })
            .expect("fixture must separate the gated both-edge credit from both alternatives");
    }

    /// The J2 stage argument of the road expansion paths: the credit's target vertex scores
    /// must run through `vertex_score_with` with the caller's stage, damping the expansion
    /// term. The maximum pair credit is observed through the `PAIR_EXPANSION` probe and must
    /// equal the staged closed-form mirror bit-for-bit while differing from the unstaged one;
    /// the single-road credit is checked directly against both spellings.
    #[test]
    fn the_road_and_pair_expansion_credits_price_targets_through_the_stage() {
        let params = super::HeuristicParams {
            production_weight: 1.0,
            scarcity_weight: 0.0,
            diversity_bonus: 0.0,
            port_weight: 0.0,
            expansion_weight: 40.0,
            stage_expansion_weight: 0.75,
            ..super::HeuristicParams::default()
        };
        let stage = crate::policy::stage::Stage { lateness: 1.0 };
        let (topology, board, mut arena) = valuation_fixture();
        // Park the Longest Road race out of reach so both credits are expansion-only.
        arena.state.players[1].longest_road_len = 10;
        let start = 0_u8;
        arena.state.vertex_owner[usize::from(start)] = 0;
        arena.state.vertex_tier[usize::from(start)] = 1;
        let view = arena.decision_view(&board, &topology, 0, DecisionPhase::PreRoll);
        let mirror_max = |stage: Option<&crate::policy::stage::Stage>| {
            let mut best = f32::NEG_INFINITY;
            for first in 0..topology.edge_count() {
                let first = first as u8;
                if !view.legal_road(first) {
                    continue;
                }
                for second in topology.edge_neighbors(first) {
                    if !view.legal_road_after(first, *second) {
                        continue;
                    }
                    let credit = [first, *second]
                        .into_iter()
                        .flat_map(|edge| topology.edge_endpoints(edge))
                        .filter(|vertex| view.is_expansion_target(*vertex))
                        .map(|vertex| {
                            super::vertex_score_with(
                                &view,
                                vertex,
                                &params,
                                super::BuildKind::Settlement,
                                None,
                                stage,
                                None,
                            )
                        })
                        .fold(None, |best: Option<f32>, value| {
                            Some(best.map_or(value, |best| best.max(value)))
                        })
                        .unwrap_or(0.0);
                    best = best.max(credit);
                }
            }
            best
        };
        let staged_mirror = mirror_max(Some(&stage));
        let unstaged_mirror = mirror_max(None);
        assert_ne!(
            staged_mirror.to_bits(),
            unstaged_mirror.to_bits(),
            "the damping must move some pair credit on this fixture"
        );
        super::reset_pair_expansion();
        super::best_road_building_pair(&view, &params, None, Some(&stage));
        assert_eq!(
            super::pair_expansion().to_bits(),
            staged_mirror.to_bits(),
            "the pair credit must price its targets through the caller's stage"
        );
        super::reset_pair_expansion();
        super::best_road_building_pair(&view, &params, None, None);
        assert_eq!(super::pair_expansion().to_bits(), unstaged_mirror.to_bits());
        // The single-road credit prices its targets through the same stage.
        let moved = (0..topology.edge_count())
            .map(|edge| edge as u8)
            .filter(|edge| view.legal_road(*edge))
            .filter(|edge| {
                let staged = super::expansion_road_score(&view, *edge, &params, Some(&stage));
                let unstaged = super::expansion_road_score(&view, *edge, &params, None);
                match (staged, unstaged) {
                    (Some(staged), Some(unstaged)) => staged.to_bits() != unstaged.to_bits(),
                    _ => false,
                }
            })
            .count();
        assert!(
            moved > 0,
            "some legal road's expansion credit must move under the stage"
        );
    }

    #[test]
    fn a_pair_opening_no_expansion_target_is_not_poisoned() {
        let params = super::HeuristicParams {
            production_weight: 4.0,
            ..super::HeuristicParams::default()
        };
        let (topology, board, mut arena) = valuation_fixture();
        let start = 0_u8;
        arena.state.vertex_owner[usize::from(start)] = 0;
        arena.state.vertex_tier[usize::from(start)] = 1;
        // Rivals own every vertex two steps out, so no legal pair opens a settleable site: the
        // distance rule blocks the ring around the settlement and ownership blocks the rest.
        for adjacent in topology.vertex_adjacent(start) {
            for vertex in topology.vertex_adjacent(*adjacent) {
                if *vertex != start && !topology.vertex_adjacent(start).contains(vertex) {
                    arena.state.vertex_owner[usize::from(*vertex)] = 1;
                    arena.state.vertex_tier[usize::from(*vertex)] = 1;
                }
            }
        }
        let view = arena.decision_view(&board, &topology, 0, DecisionPhase::PreRoll);
        for first in 0..topology.edge_count() {
            let first = first as u8;
            if !view.legal_road(first) {
                continue;
            }
            for second in topology.edge_neighbors(first) {
                if view.legal_road_after(first, *second) {
                    assert!(
                        [first, *second]
                            .into_iter()
                            .flat_map(|edge| topology.edge_endpoints(edge))
                            .all(|vertex| !view.is_expansion_target(vertex)),
                        "fixture must leave no pair an expansion target"
                    );
                }
            }
        }
        // Every credit is zero, so the selection must still yield a full pair (the first legal
        // one) instead of collapsing to (None, None) through a NEG_INFINITY fold.
        let expected = pair_choice(&view, &topology, |_, _| 0.0);
        let actual = super::best_road_building_pair(&view, &params, None, None);
        assert_eq!(actual, expected);
        assert!(
            actual.0.is_some() && actual.1.is_some(),
            "a pair laid purely for Longest Road must survive the gate"
        );
    }

    #[test]
    #[ignore = "single-state timing observation; run deliberately"]
    fn vertex_valuation_per_decision_cost_is_reported() {
        let topology = Topology::load(Layout::Standard4).unwrap();
        let mut rules = RuleConfig::base(Layout::Standard4);
        rules.turn_cap = 20;
        let board = standard_board(&topology, &rules);
        let mut arena = GameArena::default();
        arena.play(
            &board,
            &topology,
            &rules,
            &GameConfig {
                policies: [PolicyKind::HeuristicV1; 6],
                seed: 8795844940285355527,
                ..GameConfig::default()
            },
        );
        let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
        let params = super::HeuristicParams::default();
        const DECISIONS: u64 = 50_000;
        for run in 1..=5 {
            let started = std::time::Instant::now();
            for _ in 0..DECISIONS {
                std::hint::black_box(super::best_goal_uncounted(&view, &params, None, None, None));
            }
            eprintln!(
                "path=best_goal_uncounted run={run} decisions={DECISIONS} nsPerDecision={:.3}",
                started.elapsed().as_nanos() as f64 / DECISIONS as f64
            );
        }
        for run in 1..=5 {
            let started = std::time::Instant::now();
            for _ in 0..DECISIONS {
                for edge in 0..topology.edge_count() {
                    let edge = edge as u8;
                    if view.legal_road(edge) {
                        std::hint::black_box(super::expansion_road_score(&view, edge, &params, None));
                    }
                }
                std::hint::black_box(super::best_road_building_pair(&view, &params, None, None));
            }
            eprintln!(
                "path=road_vertex_consumers run={run} decisions={DECISIONS} nsPerDecision={:.3}",
                started.elapsed().as_nanos() as f64 / DECISIONS as f64
            );
        }
    }

    #[test]
    fn devcards_arm_hold_and_decline_rates_are_reported() {
        use std::sync::atomic::Ordering;

        let _guard = super::DEVCARDS_TEST_LOCK.lock().unwrap();
        for layout in [Layout::Standard4, Layout::Extension6] {
            let topology = Topology::load(layout).unwrap();
            let rules = RuleConfig::base(layout);
            let board = if layout == Layout::Standard4 {
                standard_board(&topology, &rules)
            } else {
                let relative =
                    PathBuf::from("src/parser/__tests__/expected/board-draft-empty.json");
                let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                    .ancestors()
                    .map(|root| root.join(&relative))
                    .find(|candidate| candidate.is_file())
                    .expect("board fixture must be reachable from the worktree or sweep root");
                let wire = WireBoard::parse_str(&fs::read_to_string(path).unwrap()).unwrap();
                SimBoard::try_from_wire(wire, &topology, &rules, ConversionOptions::default())
                    .unwrap()
            };
            for counter in &super::DEVCARDS_COUNTS {
                counter.store(0, Ordering::Relaxed);
            }
            let mut arena = GameArena::default();
            for seed in 0..100 {
                arena.play(
                    &board,
                    &topology,
                    &rules,
                    &GameConfig {
                        policies: [PolicyKind::HeuristicV1Devcards; 6],
                        seed,
                        ..GameConfig::default()
                    },
                );
            }
            let played = super::DEVCARDS_COUNTS[0].load(Ordering::Relaxed);
            let hold_won = super::DEVCARDS_COUNTS[1].load(Ordering::Relaxed);
            let no_offer = super::DEVCARDS_COUNTS[2].load(Ordering::Relaxed);
            let playable = super::DEVCARDS_COUNTS[3].load(Ordering::Relaxed);
            let ratio = hold_won as f64 / (hold_won + played) as f64;
            eprintln!(
                "layout={layout:?} played={played} hold_won={hold_won} no_offer={no_offer} playable={playable} ratio={ratio:.9}"
            );
            assert_eq!(played + hold_won + no_offer, playable);
            assert!(hold_won + played > 0);
            assert!(
                [played, hold_won, no_offer]
                    .into_iter()
                    .filter(|count| *count > 0)
                    .count()
                    > 1,
                "three buckets must be distinguishable"
            );
        }
    }

    #[test]
    fn m21_projection_flip_is_reachable_in_legal_play() {
        let _guard = super::DEVCARDS_TEST_LOCK.lock().unwrap();
        let layout = Layout::Standard4;
        let topology = Topology::load(layout).unwrap();
        let rules = RuleConfig::base(layout);
        let board = standard_board(&topology, &rules);
        super::M21_LIVE_FLIPS.with(|count| count.set(0));
        super::M21_REVIEW_STATE_FLIPS.with(|count| count.set(0));
        let mut arena = GameArena::default();
        let seed = std::env::var("M21_FLIP_SEED_SCAN")
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(SEED);
        arena.play(
            &board,
            &topology,
            &rules,
            &GameConfig {
                policies: [PolicyKind::HeuristicV1Devcards; 6],
                seed,
                ..GameConfig::default()
            },
        );
        let flips = super::M21_LIVE_FLIPS.with(std::cell::Cell::get);
        let review_state_flips = super::M21_REVIEW_STATE_FLIPS.with(std::cell::Cell::get);
        eprintln!("legal M21 flip seed={seed} flips={flips} reviewStateFlips={review_state_flips}");
        assert!(flips > 0);
        assert!(review_state_flips > 0);
    }

    /// A seed whose game reaches the M-21 review state and flips there; re-found by scan
    /// (`M21_FLIP_SEED_SCAN`) whenever a behavior change moves the trajectories.
    const SEED: u64 = 200;

    // Forwarded-argument table for the SpecialBuild scoring seam (`score_actions_with`'s phase
    // gate, `hold_goal_filter`, and its `goal_shortfall` helper):
    //
    // | argument                          | observed by                                         |
    // | --------------------------------- | --------------------------------------------------- |
    // | `view.phase()`                    | `mute_passes_only_the_special_build_phase`,         |
    // |                                   | `hold_goal_drops_goal_conflicting_spends` (the      |
    // |                                   | Action-phase contrast in each)                      |
    // | `params.special_build`            | `mute_passes_only_the_special_build_phase`,         |
    // |                                   | `hold_goal_drops_goal_conflicting_spends` (Mute /   |
    // |                                   | HoldGoal vs Uniform on the same view)               |
    // | `goal`                            | `hold_goal_drops_goal_conflicting_spends` (chooser  |
    // |                                   | goal), `hold_goal_keeps_disjoint_spends` (direct)   |
    // | `view.own_hand()` / cost variants | `hold_goal_keeps_disjoint_spends`,                  |
    // |                                   | `hold_goal_is_uniform_once_the_goal_is_affordable`  |
    //
    // The label dispatch (`PolicyKind` reaching `params.special_build`) is pinned by
    // `the_special_build_labels_select_their_scoring` in `policy/mod.rs`.

    fn action_bits(buf: &crate::view::ActionBuf) -> Vec<(Action, u32)> {
        buf.as_slice()
            .iter()
            .map(|candidate| (candidate.action, candidate.score.to_bits()))
            .collect()
    }

    #[test]
    fn mute_passes_only_the_special_build_phase() {
        let (topology, board, mut arena) = valuation_fixture();
        let target = 0_u8;
        arena.state.edge_owner[usize::from(topology.vertex_edges(target)[0])] = 0;
        let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
        arena.state.players[0].resources = view.costs(Buildable::Settlement)[0].map(i16::from);
        let mute = super::HeuristicParams {
            production_weight: 3.0,
            special_build: super::SpecialBuildScoring::Mute,
            ..super::HeuristicParams::default()
        };
        let special = arena.decision_view(&board, &topology, 0, DecisionPhase::SpecialBuild);
        let mut actions = crate::view::ActionBuf::new();
        super::score_actions(&special, &mute, &mut actions);
        assert_eq!(action_bits(&actions), vec![(Action::Pass, 0.0_f32.to_bits())]);
        // The same params still build on the seat's own turn ...
        let ordinary = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
        super::score_actions(&ordinary, &mute, &mut actions);
        assert!(
            actions
                .as_slice()
                .iter()
                .any(|candidate| candidate.action == Action::BuildSettlement(target))
        );
        // ... and Uniform still builds in the special building phase.
        let uniform = super::HeuristicParams {
            special_build: super::SpecialBuildScoring::Uniform,
            ..mute.clone()
        };
        super::score_actions(&special, &uniform, &mut actions);
        assert!(
            actions
                .as_slice()
                .iter()
                .any(|candidate| candidate.action == Action::BuildSettlement(target))
        );
    }

    #[test]
    fn hold_goal_drops_goal_conflicting_spends() {
        let (topology, board, mut arena) = valuation_fixture();
        // One owned settlement and no road pieces: upgrading it is the only goal the chooser
        // can select, so the prune's goal argument is controlled exactly.
        arena.state.vertex_owner[0] = 0;
        arena.state.vertex_tier[0] = 1;
        arena.state.players[0].pieces[Buildable::Road.index()] = 0;
        let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
        let city_cost = view.costs(Buildable::City)[0];
        let dev_cost = *view.dev_cost();
        // The city cost short one unit of its heaviest resource, plus the dev-cost resources
        // the city does not need: the dev buy is affordable but spends into the shortfall.
        let mut hand = city_cost.map(i16::from);
        let heavy = (0..crate::rules::RESOURCE_COUNT)
            .max_by_key(|index| city_cost[*index])
            .unwrap();
        hand[heavy] -= 1;
        for index in 0..crate::rules::RESOURCE_COUNT {
            if dev_cost[index] > 0 && city_cost[index] == 0 {
                hand[index] += i16::from(dev_cost[index]);
            }
        }
        arena.state.players[0].resources = hand;
        let hold = super::HeuristicParams {
            production_weight: 3.0,
            special_build: super::SpecialBuildScoring::HoldGoal,
            ..super::HeuristicParams::default()
        };
        let special = arena.decision_view(&board, &topology, 0, DecisionPhase::SpecialBuild);
        assert_eq!(
            super::best_goal(&special, &hold, None).map(|goal| goal.kind),
            Some(Buildable::City),
            "fixture precondition: the chooser goal must be the city upgrade"
        );
        assert_eq!(
            super::goal_shortfall(&special, Buildable::City, &hand),
            1,
            "fixture precondition: the city must be exactly one unit short"
        );
        assert!(
            special.can_buy_dev(),
            "fixture precondition: the conflicting dev buy must be affordable"
        );
        let mut actions = crate::view::ActionBuf::new();
        super::score_actions(&special, &hold, &mut actions);
        assert_eq!(action_bits(&actions), vec![(Action::Pass, 0.0_f32.to_bits())]);
        // The ordinary action phase is untouched: bit-identical to Uniform, dev buy kept.
        let uniform = super::HeuristicParams {
            special_build: super::SpecialBuildScoring::Uniform,
            ..hold.clone()
        };
        let ordinary = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
        let mut held = crate::view::ActionBuf::new();
        let mut plain = crate::view::ActionBuf::new();
        super::score_actions(&ordinary, &hold, &mut held);
        super::score_actions(&ordinary, &uniform, &mut plain);
        assert_eq!(action_bits(&held), action_bits(&plain));
        assert!(
            plain
                .as_slice()
                .iter()
                .any(|candidate| candidate.action == Action::BuyDev)
        );
        // And Uniform keeps the buy in the special building phase itself.
        super::score_actions(&special, &uniform, &mut plain);
        assert!(
            plain
                .as_slice()
                .iter()
                .any(|candidate| candidate.action == Action::BuyDev)
        );
    }

    #[test]
    fn hold_goal_keeps_disjoint_spends() {
        let (topology, board, mut arena) = valuation_fixture();
        arena.state.vertex_owner[0] = 0;
        arena.state.vertex_tier[0] = 1;
        let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
        let city_cost = view.costs(Buildable::City)[0];
        let road_cost = view.costs(Buildable::Road)[0];
        let dev_cost = *view.dev_cost();
        // City cost short one unit of its heaviest resource, plus a full road cost and the
        // dev-cost resources the city does not need: the road spend leaves the city shortfall
        // unchanged, the dev spend raises it.
        let mut hand = city_cost.map(i16::from);
        let heavy = (0..crate::rules::RESOURCE_COUNT)
            .max_by_key(|index| city_cost[*index])
            .unwrap();
        hand[heavy] -= 1;
        for index in 0..crate::rules::RESOURCE_COUNT {
            hand[index] += i16::from(road_cost[index]);
            if dev_cost[index] > 0 && city_cost[index] == 0 {
                hand[index] += i16::from(dev_cost[index]);
            }
        }
        arena.state.players[0].resources = hand;
        let params = super::HeuristicParams {
            production_weight: 3.0,
            ..super::HeuristicParams::default()
        };
        let special = arena.decision_view(&board, &topology, 0, DecisionPhase::SpecialBuild);
        let mut actions = crate::view::ActionBuf::new();
        super::score_actions(&special, &params, &mut actions);
        let before = action_bits(&actions);
        assert!(
            before
                .iter()
                .any(|(action, _)| matches!(action, Action::BuildRoad(_))),
            "fixture precondition: a road candidate must be affordable"
        );
        assert!(before.iter().any(|(action, _)| *action == Action::BuyDev));
        super::hold_goal_filter(
            &special,
            &mut actions,
            Some(super::Goal {
                kind: Buildable::City,
                score: 1.0,
            }),
        );
        // Exactly the conflicting dev buy is dropped; survivors keep order and score bits.
        let expected: Vec<(Action, u32)> = before
            .into_iter()
            .filter(|(action, _)| *action != Action::BuyDev)
            .collect();
        assert_eq!(action_bits(&actions), expected);
    }

    #[test]
    fn hold_goal_is_uniform_once_the_goal_is_affordable() {
        let (topology, board, mut arena) = valuation_fixture();
        arena.state.vertex_owner[0] = 0;
        arena.state.vertex_tier[0] = 1;
        arena.state.players[0].pieces[Buildable::Road.index()] = 0;
        let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
        arena.state.players[0].resources = view.costs(Buildable::City)[0].map(i16::from);
        let hold = super::HeuristicParams {
            production_weight: 3.0,
            special_build: super::SpecialBuildScoring::HoldGoal,
            ..super::HeuristicParams::default()
        };
        let special = arena.decision_view(&board, &topology, 0, DecisionPhase::SpecialBuild);
        assert_eq!(
            super::goal_shortfall(&special, Buildable::City, special.own_hand()),
            0,
            "fixture precondition: the city goal must be affordable"
        );
        let uniform = super::HeuristicParams {
            special_build: super::SpecialBuildScoring::Uniform,
            ..hold.clone()
        };
        let mut held = crate::view::ActionBuf::new();
        let mut plain = crate::view::ActionBuf::new();
        super::score_actions(&special, &hold, &mut held);
        super::score_actions(&special, &uniform, &mut plain);
        assert_eq!(action_bits(&held), action_bits(&plain));
        assert!(
            plain
                .as_slice()
                .iter()
                .any(|candidate| candidate.action == Action::UpgradeCity(0))
        );
    }
}
