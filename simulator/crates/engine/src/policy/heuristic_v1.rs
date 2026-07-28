use serde::{Deserialize, Serialize};

use crate::policy::PolicyScratch;
use crate::policy::devcards::{self, DevCardParams};
use crate::policy::threat::{self, ThreatParams};
use crate::policy::trading::TradeParams;
use crate::rng::Xoshiro256StarStar;
use crate::rules::{Buildable, RESOURCE_COUNT, Resource};
use crate::view::{Action, ActionBuf, DecisionView, DevPlay, ScoredAction, can_pay, pips};

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct HeuristicParams {
    pub production_weight: f32,
    pub scarcity_weight: f32,
    pub diversity_bonus: f32,
    pub port_weight: f32,
    pub expansion_weight: f32,
    pub robber_block_threshold: u8,
    /// `None` keeps the self-regarding robber rule. `Some` selects the threat model in
    /// `policy::threat`; these weights are Phase-H sweep targets, not tuned values.
    pub threat: Option<ThreatParams>,
    /// `None` keeps the fixed pre-roll ladder and production-share Monopoly proxy. `Some`
    /// selects the belief-and-ETW comparison in `policy::devcards`.
    pub dev_cards: Option<DevCardParams>,
    /// `None` keeps the offer-independent VP-ratio acceptance rule and the lexicographic
    /// counterparty ladder. `Some` selects the shared opponent-value model in `policy::trading`.
    pub trading: Option<TradeParams>,
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
            threat: None,
            dev_cards: None,
            trading: None,
        }
    }
}

pub fn action(
    view: &DecisionView<'_>,
    scratch: &mut PolicyScratch,
    params: &HeuristicParams,
    rng: &mut Xoshiro256StarStar,
) -> Action {
    action_with_goal(view, scratch, params, rng).0
}

pub(crate) fn action_with_goal(
    view: &DecisionView<'_>,
    scratch: &mut PolicyScratch,
    params: &HeuristicParams,
    rng: &mut Xoshiro256StarStar,
) -> (Action, Option<Goal>) {
    let road = best_road(view, params);
    let PolicyScratch { goal, actions } = scratch;
    score_actions_with(view, params, actions, road);
    let selected_goal = best_goal_with(view, params, road);
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
    (selected, selected_goal)
}

pub fn score_actions(view: &DecisionView<'_>, params: &HeuristicParams, out: &mut ActionBuf) {
    score_actions_with(view, params, out, best_road(view, params));
}

fn score_actions_with(
    view: &DecisionView<'_>,
    params: &HeuristicParams,
    out: &mut ActionBuf,
    road: Option<RoadGoal>,
) {
    out.clear();
    if view.can_afford(Buildable::City) {
        for vertex in 0..view.topology().vertex_count() {
            let vertex = vertex as u8;
            if view.legal_city(vertex) {
                out.push(ScoredAction {
                    action: Action::UpgradeCity(vertex),
                    score: 10_000.0 + vertex_score(view, vertex, params),
                });
            }
        }
    }
    if view.can_afford(Buildable::Settlement) {
        for vertex in 0..view.topology().vertex_count() {
            let vertex = vertex as u8;
            if view.legal_settlement(vertex) {
                out.push(ScoredAction {
                    action: Action::BuildSettlement(vertex),
                    score: 500.0 + vertex_score(view, vertex, params),
                });
            }
        }
    }
    if view.can_afford(Buildable::Road)
        && let Some(road) = road
    {
        out.push(ScoredAction {
            action: Action::BuildRoad(road.edge),
            score: road.action_score,
        });
    }
    if let Some(goal) = best_goal_with(view, params, road)
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
    let dev_score = dev_card_score(view);
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
            // Keep play/hold on the baseline choice so this arm varies placement only.
            score: knight_action_score(view, off_destination, off_victim),
        });
    }
    out.push(ScoredAction {
        action: Action::Pass,
        score: 0.0,
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
    let goal = best_goal(view, params);
    scratch.goal = goal.map(|value| value.kind);
    match params.dev_cards.as_ref() {
        None => ladder_pre_roll(view, params, goal),
        Some(cards) => devcards_pre_roll(view, params, cards, goal),
    }
}

fn ladder_pre_roll(
    view: &DecisionView<'_>,
    params: &HeuristicParams,
    goal: Option<Goal>,
) -> Option<DevPlay> {
    if view.can_play_dev(3)
        && let Some((first, second)) = goal.and_then(|value| plenty_for_goal(view, value.kind))
    {
        return Some(DevPlay::YearOfPlenty { first, second });
    }
    if view.can_play_dev(4)
        && let Some(resource) = goal.and_then(|value| monopoly_for_goal(view, value.kind))
    {
        return Some(DevPlay::Monopoly { resource });
    }
    if view.can_play_dev(2) {
        let (first, second) = best_road_building_pair(view, params);
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
) -> Option<DevPlay> {
    let offers = devcards::DevOffers {
        plenty: view
            .can_play_dev(3)
            .then(|| goal.and_then(|value| plenty_for_goal(view, value.kind)))
            .flatten(),
        monopoly: view.can_play_dev(4),
        road: view
            .can_play_dev(2)
            .then(|| best_road_building_pair(view, params))
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
) -> [u8; RESOURCE_COUNT] {
    let goal = scratch
        .goal
        .or_else(|| best_goal(view, &HeuristicParams::default()).map(|value| value.kind));
    let cost = goal
        .and_then(|kind| view.costs(kind).first())
        .copied()
        .unwrap_or([0; RESOURCE_COUNT]);
    let mut remaining = *view.own_hand();
    let mut discarded = [0; RESOURCE_COUNT];
    for _ in 0..count {
        let resource = (0..RESOURCE_COUNT)
            .max_by_key(|index| remaining[*index] - i16::from(cost[*index]))
            .unwrap_or(0);
        if remaining[resource] == 0 {
            break;
        }
        remaining[resource] -= 1;
        discarded[resource] += 1;
    }
    discarded
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

pub fn vertex_score(view: &DecisionView<'_>, vertex: u8, params: &HeuristicParams) -> f32 {
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
    let diversity = production
        .iter()
        .enumerate()
        .filter(|(resource, value)| **value > 0 && own[*resource] == 0)
        .count() as f32;
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
                        f32::from(production[resource.index()])
                            * (1.0 / prospective as f32 - 1.0 / current as f32)
                    } else {
                        0.0
                    }
                })
                .sum::<f32>()
        })
        .sum::<f32>();
    let expansion = view
        .topology()
        .vertex_adjacent(vertex)
        .iter()
        .filter(|adjacent| view.vertex_owner(**adjacent).is_none())
        .count() as f32;
    f32::from(raw) * params.production_weight
        + scarcity * params.scarcity_weight * 10.0
        + diversity * params.diversity_bonus
        + port_synergy * params.port_weight
        + expansion * params.expansion_weight
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

pub(crate) fn best_goal(view: &DecisionView<'_>, params: &HeuristicParams) -> Option<Goal> {
    best_goal_with(view, params, best_road(view, params))
}

/// `best_road` scans every legal edge and, when the Longest Road card is in reach, runs an
/// exponential trail search per candidate. Callers that already have its result pass it in rather
/// than paying for it again -- a decision used to repeat that search three times over.
fn best_goal_with(
    view: &DecisionView<'_>,
    params: &HeuristicParams,
    road: Option<RoadGoal>,
) -> Option<Goal> {
    let mut best = None;
    if (0..view.topology().vertex_count())
        .map(|vertex| vertex as u8)
        .any(|vertex| view.legal_city(vertex))
    {
        best = Some(Goal {
            kind: Buildable::City,
            score: 2.0 / turns_to_afford(view, Buildable::City).max(0.25),
        });
    }
    if let Some(vertex) = view.best_legal_settlement() {
        let candidate = Goal {
            kind: Buildable::Settlement,
            score: (1.0 + vertex_score(view, vertex, params) / 20.0)
                / turns_to_afford(view, Buildable::Settlement).max(0.25),
        };
        if best.is_none_or(|current| candidate.score > current.score) {
            best = Some(candidate);
        }
    }
    if let Some(road) = road {
        let candidate = Goal {
            kind: Buildable::Road,
            score: road.goal_score / turns_to_afford(view, Buildable::Road).max(0.25),
        };
        if best.is_none_or(|current| candidate.score > current.score) {
            best = Some(candidate);
        }
    }
    best
}

fn best_road(view: &DecisionView<'_>, params: &HeuristicParams) -> Option<RoadGoal> {
    let mut best = None;
    // The trail search is the dominant cost of a decision, so the graph it walks is built once
    // here and probed per candidate -- and not at all when the card is out of reach.
    let mut network = longest_road_reachable(view, 1).then(|| view.road_network());
    let cap = road_length_cap(view);
    for edge in 0..view.topology().edge_count() {
        let edge = edge as u8;
        if !view.legal_road(edge) {
            continue;
        }
        let expansion_score = expansion_road_score(view, edge, params);
        let new_length = network
            .as_mut()
            .map_or(0, |network| view.road_length_on(network, edge, None, cap));
        let Some((action_bonus, goal_bonus)) = longest_road_value(view, new_length) else {
            if expansion_score.is_none() {
                continue;
            }
            let candidate = RoadGoal {
                edge,
                action_score: 40.0 + expansion_score.unwrap_or_default(),
                goal_score: 0.35,
            };
            if best.is_none_or(|current: RoadGoal| candidate.action_score > current.action_score) {
                best = Some(candidate);
            }
            continue;
        };
        let candidate = RoadGoal {
            edge,
            action_score: action_bonus + expansion_score.unwrap_or_default(),
            goal_score: 0.35 + goal_bonus,
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
) -> Option<f32> {
    let mut best_score = None;
    for target in view.topology().edge_endpoints(first) {
        if view.is_expansion_target(target) {
            let score = vertex_score(view, target, params) + 0.25;
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
                let score = vertex_score(view, target, params);
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
fn longest_road_reachable(view: &DecisionView<'_>, added: u8) -> bool {
    if view.longest_road_holder() == Some(view.observer()) {
        return false;
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
fn road_length_cap(view: &DecisionView<'_>) -> u8 {
    longest_road_target(view).max(view.longest_road_len(view.observer()).saturating_add(1))
}

/// How far below the card's threshold `longest_road_value` still pays a progress bonus.
const PROGRESS_SLACK: u8 = 2;

fn longest_road_value(view: &DecisionView<'_>, new_length: u8) -> Option<(f32, f32)> {
    let observer = view.observer();
    if view.longest_road_holder() == Some(observer) {
        return None;
    }
    let target = longest_road_target(view);
    let current = view.longest_road_len(observer);
    if new_length <= current {
        return None;
    }
    if new_length >= target {
        return Some((
            contested_card_score(
                view,
                view.longest_road_vp(),
                view.longest_road_holder().is_some(),
            ),
            30.0 + 10.0 * win_proximity(view),
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

fn contested_card_score(view: &DecisionView<'_>, vp: u8, denies_holder: bool) -> f32 {
    if view.own_total_vp().saturating_add(vp) >= view.win_vp() {
        return 100_000.0 + f32::from(vp) * 100.0;
    }
    // Scale with the VP the card actually carries rather than sitting on a flat floor above the
    // city band: a variant that makes a bonus card worth 1 VP must not outrank a 2-VP city. At the
    // base-rules value of 2 this is the same 11_000 as before.
    5_500.0 * f32::from(vp)
        + f32::from(vp) * 250.0
        + win_proximity(view) * 2_000.0
        + if denies_holder { 250.0 } else { 0.0 }
}

fn dev_card_score(view: &DecisionView<'_>) -> f32 {
    if view.largest_army_holder() == Some(view.observer()) {
        return 45.0;
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
    45.0 + contest_bonus * (0.5 + win_proximity(view))
}

fn knight_action_score(view: &DecisionView<'_>, destination: u8, victim: Option<u8>) -> f32 {
    if view.knight_takes_largest_army() {
        return contested_card_score(
            view,
            view.largest_army_vp(),
            view.largest_army_holder().is_some(),
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

fn win_proximity(view: &DecisionView<'_>) -> f32 {
    f32::from(view.own_total_vp()) / f32::from(view.win_vp().max(1))
}

fn best_road_building_pair(
    view: &DecisionView<'_>,
    params: &HeuristicParams,
) -> (Option<u8>, Option<u8>) {
    let mut best = (None, None);
    let mut best_score = f32::NEG_INFINITY;
    // Road building lays two segments, so the card is reachable from two further out.
    let mut network = longest_road_reachable(view, 2).then(|| view.road_network());
    let cap = road_length_cap(view);
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
            let expansion_score = view
                .topology()
                .edge_endpoints(second)
                .iter()
                .map(|vertex| vertex_score(view, *vertex, params))
                .fold(f32::NEG_INFINITY, f32::max);
            let road_bonus = network.as_mut().map_or(0.0, |network| {
                let length = view.road_length_on(network, first, Some(second), cap);
                longest_road_value(view, length).map_or(0.0, |(action_score, _)| action_score)
            });
            let score = expansion_score + road_bonus;
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

fn plenty_for_goal(view: &DecisionView<'_>, goal: Buildable) -> Option<(Resource, Resource)> {
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

fn monopoly_for_goal(view: &DecisionView<'_>, goal: Buildable) -> Option<Resource> {
    let cost = view.costs(goal).first()?;
    Resource::ALL
        .into_iter()
        .filter(|resource| view.own_hand()[resource.index()] < i16::from(cost[resource.index()]))
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
    use crate::policy::PolicyKind;
    use crate::rules::RuleConfig;
    use crate::topology::{Layout, Topology};
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
                let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                    .join("../../../src/parser/__tests__/expected/board-draft-empty.json");
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
        arena.play(
            &board,
            &topology,
            &rules,
            &GameConfig {
                policies: [PolicyKind::HeuristicV1Devcards; 6],
                seed: 182,
                ..GameConfig::default()
            },
        );
        let flips = super::M21_LIVE_FLIPS.with(std::cell::Cell::get);
        let review_state_flips = super::M21_REVIEW_STATE_FLIPS.with(std::cell::Cell::get);
        eprintln!("legal M21 flip seed=182 flips={flips} reviewStateFlips={review_state_flips}");
        assert!(flips > 0);
        assert!(review_state_flips > 0);
    }
}
