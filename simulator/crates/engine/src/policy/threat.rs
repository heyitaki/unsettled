use serde::{Deserialize, Serialize};

use crate::etw::{self, EtwInputs};
use crate::policy::params_file::check;
use crate::policy::trading;
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
    /// Non-negative, finite scale turning `RobberChoice::steal_value` (the belief-derived
    /// own-need hit plus the shared victim rank) into knight action-score points. An unswept
    /// Phase-H placeholder, not a tuned value.
    pub knight_steal_weight: f64,
    /// Non-negative, finite scale turning `RobberChoice::placement_score` into knight
    /// action-score points, rejoining knight play timing to the robber placement value the
    /// chooser maximized. An unswept Phase-H placeholder, not a tuned value.
    pub knight_placement_weight: f64,
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
            knight_steal_weight: 12.0,
            knight_placement_weight: 30.0,
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
    let choice = robber_choice(view, params);
    (choice.destination, choice.victim)
}

/// The robber decision plus the two quantities the knight action score consumes, so choosing
/// and pricing the same move never recomputes the threat context.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RobberChoice {
    pub destination: u8,
    pub victim: Option<u8>,
    /// The hex score `robber` maximized at `destination`: summed delay/need/block terms over
    /// every rival plus the best available steal rank. Zero when the fallback hex was taken
    /// because no candidate hex was scoreable.
    pub placement_score: f64,
    /// Value of stealing from `victim`: the belief-derived probability the stolen card fills
    /// the observer's own cheapest-route shortfall, plus the victim's rank under the shared
    /// danger model. Zero with no victim.
    pub steal_value: f64,
}

/// One `(hex, victim)` pair the robber search considers, and the value it maximizes.
struct RobberPair {
    hex: u8,
    victim: Option<u8>,
    /// The hex terms every pair on this hex shares, plus this victim's steal term.
    score: f64,
    /// This victim's rank, the tie-break inside a hex. Unused on a declining pair.
    rank: f64,
}

/// One joint maximum over `(hex, victim)` pairs. The hex terms do not depend on the victim, so
/// the pair score splits into a shared part and the victim's steal term; enumerating the pairs
/// anyway is what lets a victim-scoped term reach the hex choice as well as the victim choice.
///
/// Equivalent to the two-stage search this replaced (a hex loop maximizing the shared terms plus
/// the best available steal, then a victim loop re-picking that same victim on the winning hex)
/// wherever the steal term is non-negative, which covers every declared bound and every shipped
/// default. `tests/threat_robber.rs::robber_choice_matches_the_two_stage_search_it_replaced`
/// pins that against a reference implementation of the old search.
pub fn robber_choice(view: &DecisionView<'_>, params: &ThreatParams) -> RobberChoice {
    let context = context(view, params);
    let mut best: Option<RobberPair> = None;
    for hex in 0..view.topology().hex_count() {
        let hex = hex as u8;
        if hex == view.robber() || view.hex_touches_seat(hex, view.observer()) {
            continue;
        }
        let mut shared = 0.0;
        for seat in 0..view.seats() {
            if seat == view.observer() {
                continue;
            }
            let terms = seat_terms(view, params, &context, hex, seat);
            shared += terms.delay + terms.need + terms.block;
        }
        let Some(pair) = best_pair_on_hex(view, params, &context, hex, shared) else {
            continue;
        };
        // Ties across hexes go to the lower hex index, as the hex loop's strict `>` did.
        if best.as_ref().is_none_or(|current| pair.score > current.score) {
            best = Some(pair);
        }
    }
    let (destination, victim, placement_score) = match best {
        Some(pair) => (pair.hex, pair.victim, pair.score),
        None => {
            // No pair was scoreable: fall back to the first hex that is not the robber's own,
            // price the placement at zero, and name whatever victim that hex offers.
            let hex = (0..view.topology().hex_count())
                .map(|hex| hex as u8)
                .find(|hex| *hex != view.robber())
                .expect("board has another hex");
            let victim =
                best_pair_on_hex(view, params, &context, hex, 0.0).and_then(|pair| pair.victim);
            (hex, victim, 0.0)
        }
    };
    RobberChoice {
        destination,
        victim,
        placement_score,
        steal_value: victim.map_or(0.0, |seat| {
            let seat = usize::from(seat);
            victim_rank(view, params, &context, seat) + own_need_hit(view, seat)
        }),
    }
}

/// The best pair on one hex, given `shared`, the hex terms every pair on it carries. Declining
/// (`victim: None`) is a pair only where no seat is stealable, since `view::stealable_on_hex` is
/// also what makes declining legal. Ties go to the higher-ranked victim and then to the lower
/// seat, which is the victim the two-stage search re-picked on its chosen hex. A pair scoring
/// non-finite is no candidate, as a non-finite hex score was not.
fn best_pair_on_hex(
    view: &DecisionView<'_>,
    params: &ThreatParams,
    context: &ThreatContext,
    hex: u8,
    shared: f64,
) -> Option<RobberPair> {
    let mut best: Option<RobberPair> = None;
    let mut stealable = false;
    for seat in 0..view.seats() {
        if seat == view.observer() || !view.stealable_on_hex(hex, seat) {
            continue;
        }
        stealable = true;
        let rank = victim_rank(view, params, context, seat);
        let score = shared + params.steal_weight * rank;
        if !score.is_finite() {
            continue;
        }
        if best.as_ref().is_none_or(|current| {
            score > current.score || (score == current.score && rank > current.rank)
        }) {
            best = Some(RobberPair {
                hex,
                victim: Some(seat as u8),
                score,
                rank,
            });
        }
    }
    if stealable {
        return best;
    }
    shared.is_finite().then_some(RobberPair {
        hex,
        victim: None,
        score: shared,
        rank: f64::NEG_INFINITY,
    })
}

/// Belief-derived probability that a uniformly random card from `victim`'s believed hand fills
/// the observer's own cheapest-route shortfall. The observer's shortfall prices the real hand,
/// mirroring `trading::own_inputs`; the victim's composition stands on belief.
fn own_need_hit(view: &DecisionView<'_>, victim: usize) -> f64 {
    let expected = view.belief().expected(victim);
    let total = expected.iter().sum::<f64>();
    if total <= 0.0 {
        return 0.0;
    }
    let need = need_share(&trading::own_inputs(view));
    (0..RESOURCE_COUNT)
        .map(|resource| need[resource] * expected[resource])
        .sum::<f64>()
        / total
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
        raw[seat] = danger_from_etw(etw_free, params.danger_floor);
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

/// Standing danger of a seat, from its expected turns to win. This is the single
/// opponent-threat function used by robber and trading policy decisions.
///
/// `danger_floor` must be positive and finite. Both callers guard that domain.
pub fn danger_from_etw(etw: f64, danger_floor: f64) -> f64 {
    danger_floor / (etw + danger_floor)
}

/// The `assert_params` domain, spelled as load-time errors (JSON field names) so the H0
/// params-file loader rejects a bad vector instead of tripping a debug assert mid-run.
pub(crate) fn validate(params: &ThreatParams) -> Result<(), String> {
    check(
        "threat.delayWeight is finite",
        params.delay_weight.is_finite(),
    )?;
    check(
        "threat.needWeight is finite",
        params.need_weight.is_finite(),
    )?;
    check(
        "threat.blockWeight is finite",
        params.block_weight.is_finite(),
    )?;
    check(
        "threat.stealWeight is finite",
        params.steal_weight.is_finite(),
    )?;
    check(
        "threat.victimHandWeight is finite",
        params.victim_hand_weight.is_finite(),
    )?;
    check(
        "threat.dangerFloor is positive and finite",
        params.danger_floor.is_finite() && params.danger_floor > 0.0,
    )?;
    check(
        "threat.delayCap is non-negative and finite",
        params.delay_cap.is_finite() && params.delay_cap >= 0.0,
    )?;
    check(
        "threat.handCap is positive and finite",
        params.hand_cap.is_finite() && params.hand_cap > 0.0,
    )?;
    check(
        "threat.knightStealWeight is non-negative and finite",
        params.knight_steal_weight.is_finite() && params.knight_steal_weight >= 0.0,
    )?;
    check(
        "threat.knightPlacementWeight is non-negative and finite",
        params.knight_placement_weight.is_finite() && params.knight_placement_weight >= 0.0,
    )
}

fn assert_params(params: &ThreatParams) {
    debug_assert_eq!(validate(params), Ok(()));
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
