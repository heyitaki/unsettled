use std::cell::{Cell, OnceCell};

use crate::rules::{Buildable, RESOURCE_COUNT, Resource};
use crate::view::DecisionView;

/// Returned when a seat has no income or no victory-point route.
pub const ETW_CAP: f64 = 500.0;
/// Roads bought per new settlement site, on average.
pub const ROAD_ALLOWANCE: f64 = 1.0;
/// Production mix rarely matches cost vectors, so raw card counts understate cost.
pub const MIX_PENALTY: f64 = 1.25;

/// Public inputs to the pinned closed-form reference implementation.
///
/// Largest Army and Longest Road proximity are deliberately excluded. They need an
/// opponent-relative race model owned by the later goal-switching phase.
#[derive(Clone, Debug, PartialEq)]
pub struct EtwInputs {
    pub win_vp: u8,
    pub public_vp: u8,
    pub dev_count: u8,
    pub all_seats_dev_count_sum: u16,
    pub dev_deck_remaining: u8,
    pub dev_victory_points: u8,
    pub production_pips: [u16; RESOURCE_COUNT],
    pub pieces_settlement: u8,
    pub pieces_city: u8,
    pub settlements_on_board: u8,
    pub settlement_cost: Option<[u8; RESOURCE_COUNT]>,
    pub city_cost: Option<[u8; RESOURCE_COUNT]>,
    pub road_cost: Option<[u8; RESOURCE_COUNT]>,
    pub dev_cost: Option<[u8; RESOURCE_COUNT]>,
    pub settlement_vp: u8,
    pub city_vp: u8,
    pub trade_rates: [u32; RESOURCE_COUNT],
    pub belief_expected: [f64; RESOURCE_COUNT],
    pub hand_total: u32,
}

/// Cached values are valid for the borrowed state of one view.
pub(crate) struct EtwCache {
    inputs: [OnceCell<EtwInputs>; crate::state::MAX_SEATS],
    estimates: [OnceCell<EtwEstimate>; crate::state::MAX_SEATS],
    bases: [Cell<Option<f64>>; crate::state::MAX_SEATS],
}

impl EtwCache {
    pub(crate) const fn new() -> Self {
        Self {
            inputs: [const { OnceCell::new() }; crate::state::MAX_SEATS],
            estimates: [const { OnceCell::new() }; crate::state::MAX_SEATS],
            bases: [const { Cell::new(None) }; crate::state::MAX_SEATS],
        }
    }

    pub(crate) fn inputs(&self, view: &DecisionView<'_>, seat: usize) -> &EtwInputs {
        self.inputs[seat].get_or_init(|| compute_inputs_for_seat(view, seat))
    }

    pub(crate) fn estimate(&self, view: &DecisionView<'_>, seat: usize) -> &EtwEstimate {
        self.estimates[seat].get_or_init(|| EtwEstimate::new(self.inputs(view, seat)))
    }

    pub(crate) fn base(&self, view: &DecisionView<'_>, seat: usize) -> f64 {
        if let Some(base) = self.bases[seat].get() {
            return base;
        }
        let base = self.estimate(view, seat).with_hand(&self.inputs(view, seat).belief_expected);
        self.bases[seat].set(Some(base));
        base
    }
}

pub fn inputs_for_seat(view: &DecisionView<'_>, seat: usize) -> EtwInputs {
    view.etw_inputs(seat)
}

pub(crate) fn compute_inputs_for_seat(view: &DecisionView<'_>, seat: usize) -> EtwInputs {
    let rules = view.rules_for(seat);
    let settlements_on_board = (0..view.topology().vertex_count())
        .filter(|vertex| {
            view.vertex_owner(*vertex as u8) == Some(seat as u8)
                && view.vertex_tier(*vertex as u8) == 1
        })
        .count() as u8;
    EtwInputs {
        win_vp: rules.win_vp(),
        public_vp: view.public_vp(seat),
        dev_count: view.dev_count(seat),
        all_seats_dev_count_sum: (0..view.seats())
            .map(|other| u16::from(view.dev_count(other)))
            .sum(),
        dev_deck_remaining: view.dev_deck_remaining(),
        dev_victory_points: rules.dev_victory_points(),
        production_pips: view.production_pips(seat),
        pieces_settlement: view.pieces(seat, Buildable::Settlement),
        pieces_city: view.pieces(seat, Buildable::City),
        settlements_on_board,
        settlement_cost: minimum_cost(rules.costs(Buildable::Settlement)),
        city_cost: minimum_cost(rules.costs(Buildable::City)),
        road_cost: minimum_cost(rules.costs(Buildable::Road)),
        dev_cost: Some(*rules.dev_cost()),
        settlement_vp: rules.vp(Buildable::Settlement),
        city_vp: rules.vp(Buildable::City),
        trade_rates: Resource::ALL.map(|resource| view.trade_rate_for(seat, resource)),
        belief_expected: view.belief().expected(seat),
        hand_total: view.hand_total(seat),
    }
}

/// Fixed seat inputs prepare route costs and income; only the hand varies across evaluations.
#[derive(Clone)]
pub(crate) struct EtwEstimate {
    routes: [Option<EtwRoute>; 3],
    income: f64,
    trade_rates: [u32; RESOURCE_COUNT],
    ceiling: f64,
}

#[derive(Clone)]
struct EtwRoute {
    cost: [f64; RESOURCE_COUNT],
    cards_per_vp: f64,
    required: f64,
}

impl EtwEstimate {
    pub(crate) fn new(inputs: &EtwInputs) -> Self {
        let mut estimate = Self {
            routes: [None, None, None],
            income: 0.0,
            trade_rates: inputs.trade_rates,
            ceiling: ETW_CAP,
        };
        let unseen_pool =
            u32::from(inputs.dev_deck_remaining) + u32::from(inputs.all_seats_dev_count_sum);
        let hidden_dev_vp = if unseen_pool == 0 {
            0.0
        } else {
            f64::from(inputs.dev_count) * f64::from(inputs.dev_victory_points) / f64::from(unseen_pool)
        };
        let deficit = f64::from(inputs.win_vp) - f64::from(inputs.public_vp) - hidden_dev_vp;
        if deficit <= 0.0 {
            estimate.ceiling = 0.0;
            return estimate;
        }
        estimate.income = inputs.production_pips.iter()
            .map(|pips| f64::from(*pips)).sum::<f64>() / 36.0;
        if estimate.income == 0.0 {
            return estimate;
        }
        let route = |cost, cards_per_vp| Some(EtwRoute {
            cost, cards_per_vp, required: deficit * cards_per_vp * MIX_PENALTY,
        });
        if inputs.pieces_city > 0
            && inputs.settlements_on_board > 0
            && inputs.city_vp > inputs.settlement_vp
            && let Some(cost) = inputs.city_cost
        {
            let cost = cost.map(f64::from);
            let cards_per_vp = sum_cost(&cost) / f64::from(inputs.city_vp - inputs.settlement_vp);
            estimate.routes[0] = route(cost, cards_per_vp);
        }
        if inputs.pieces_settlement > 0
            && inputs.settlement_vp > 0
            && let (Some(settlement), Some(road)) = (inputs.settlement_cost, inputs.road_cost)
        {
            let cost = std::array::from_fn(|resource| {
                f64::from(settlement[resource]) + ROAD_ALLOWANCE * f64::from(road[resource])
            });
            let cards_per_vp = sum_cost(&cost) / f64::from(inputs.settlement_vp);
            estimate.routes[1] = route(cost, cards_per_vp);
        }
        if inputs.dev_deck_remaining > 0
            && unseen_pool > 0
            && inputs.dev_victory_points > 0
            && let Some(cost) = inputs.dev_cost
        {
            let cost = cost.map(f64::from);
            let expected_vp_per_draw = f64::from(inputs.dev_victory_points) / f64::from(unseen_pool);
            let cards_per_vp = sum_cost(&cost) / expected_vp_per_draw;
            estimate.routes[2] = route(cost, cards_per_vp);
        }
        estimate
    }

    // expected_turns_to_win is the reference; prepared_hand_estimate_matches_direct_bits pins equality.
    pub(crate) fn with_hand(&self, hand: &[f64; RESOURCE_COUNT]) -> f64 {
        if hand.iter().any(|expected| !expected.is_finite()) {
            return ETW_CAP;
        }
        let mut best = self.ceiling;
        for route in self.routes.iter().flatten() {
            let mut direct = 0.0;
            let mut surplus = 0.0;
            for resource in 0..RESOURCE_COUNT {
                direct += hand[resource].min(route.cost[resource]);
                let surplus_amount = (hand[resource] - route.cost[resource]).max(0.0);
                if surplus_amount == 0.0 {
                    continue;
                }

                // Positive surplus at rate zero has unbounded trade credit.
                if self.trade_rates[resource] == 0 {
                    surplus = f64::INFINITY;
                } else {
                    surplus += surplus_amount / f64::from(self.trade_rates[resource]);
                }
            }
            let credit = (direct + surplus).min(route.cards_per_vp);
            let value = (route.required - credit).max(0.0) / self.income;
            best = best.min(if value.is_finite() { value } else { ETW_CAP });
        }
        best
    }
}

pub fn expected_turns_to_win(inputs: &EtwInputs) -> f64 {
    if inputs
        .belief_expected
        .iter()
        .any(|expected| !expected.is_finite())
    {
        return ETW_CAP;
    }
    let unseen_pool =
        u32::from(inputs.dev_deck_remaining) + u32::from(inputs.all_seats_dev_count_sum);
    let hidden_dev_vp = if unseen_pool == 0 {
        0.0
    } else {
        f64::from(inputs.dev_count) * f64::from(inputs.dev_victory_points) / f64::from(unseen_pool)
    };
    let deficit = f64::from(inputs.win_vp) - f64::from(inputs.public_vp) - hidden_dev_vp;
    if deficit <= 0.0 {
        return 0.0;
    }

    let income = inputs
        .production_pips
        .iter()
        .map(|pips| f64::from(*pips))
        .sum::<f64>()
        / 36.0;
    if income == 0.0 {
        return ETW_CAP;
    }

    let mut best = ETW_CAP;
    let mut available = false;
    if inputs.pieces_city > 0
        && inputs.settlements_on_board > 0
        && inputs.city_vp > inputs.settlement_vp
        && let Some(cost) = inputs.city_cost
    {
        available = true;
        let cost = cost.map(f64::from);
        let cards_per_vp = sum_cost(&cost) / f64::from(inputs.city_vp - inputs.settlement_vp);
        best = best.min(route_etw(inputs, deficit, income, &cost, cards_per_vp));
    }
    if inputs.pieces_settlement > 0
        && inputs.settlement_vp > 0
        && let (Some(settlement), Some(road)) = (inputs.settlement_cost, inputs.road_cost)
    {
        available = true;
        let cost = std::array::from_fn(|resource| {
            f64::from(settlement[resource]) + ROAD_ALLOWANCE * f64::from(road[resource])
        });
        let cards_per_vp = sum_cost(&cost) / f64::from(inputs.settlement_vp);
        best = best.min(route_etw(inputs, deficit, income, &cost, cards_per_vp));
    }
    if inputs.dev_deck_remaining > 0
        && unseen_pool > 0
        && inputs.dev_victory_points > 0
        && let Some(cost) = inputs.dev_cost
    {
        available = true;
        let cost = cost.map(f64::from);
        let expected_vp_per_draw = f64::from(inputs.dev_victory_points) / f64::from(unseen_pool);
        let cards_per_vp = sum_cost(&cost) / expected_vp_per_draw;
        best = best.min(route_etw(inputs, deficit, income, &cost, cards_per_vp));
    }
    if !available || !best.is_finite() {
        ETW_CAP
    } else {
        best.min(ETW_CAP)
    }
}

pub fn etw_for_seat(view: &DecisionView<'_>, seat: usize) -> f64 {
    view.etw_for_seat(seat)
}

fn minimum_cost(costs: &[[u8; RESOURCE_COUNT]]) -> Option<[u8; RESOURCE_COUNT]> {
    costs
        .iter()
        .min_by_key(|cost| cost.iter().map(|value| u16::from(*value)).sum::<u16>())
        .copied()
}

fn route_etw(
    inputs: &EtwInputs,
    deficit: f64,
    income: f64,
    cost: &[f64; RESOURCE_COUNT],
    cards_per_vp: f64,
) -> f64 {
    let mut direct = 0.0;
    let mut surplus = 0.0;
    for resource in 0..RESOURCE_COUNT {
        direct += inputs.belief_expected[resource].min(cost[resource]);
        let surplus_amount = (inputs.belief_expected[resource] - cost[resource]).max(0.0);
        if surplus_amount == 0.0 {
            continue;
        }

        // A positive surplus at rate zero has unbounded trade credit, the rate-to-zero limit.
        if inputs.trade_rates[resource] == 0 {
            surplus = f64::INFINITY;
        } else {
            surplus += surplus_amount / f64::from(inputs.trade_rates[resource]);
        }
    }
    let credit = (direct + surplus).min(cards_per_vp);
    let value = (deficit * cards_per_vp * MIX_PENALTY - credit).max(0.0) / income;
    if value.is_finite() { value } else { ETW_CAP }
}

fn sum_cost(cost: &[f64; RESOURCE_COUNT]) -> f64 {
    cost.iter().sum()
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::board::{ConversionOptions, SimBoard};
    use crate::game::{GameArena, GameConfig};
    use crate::rules::{RuleConfig, TradeConfig};
    use crate::topology::{Layout, Topology};
    use crate::view::DecisionPhase;
    use crate::wire::WireBoard;

    pub(crate) fn fixture() -> (Topology, SimBoard, GameArena) {
        let topology = Topology::load(Layout::Extension6).unwrap();
        let mut rules = RuleConfig::base(Layout::Extension6);
        rules.player_trading = Some(TradeConfig::default());
        let wire = WireBoard::parse_str(include_str!(
            "../../../../src/parser/__tests__/expected/board-draft-empty.json"
        )).unwrap();
        let board = SimBoard::try_from_wire(
            wire, &topology, &rules, ConversionOptions::default(),
        ).unwrap();
        let mut arena = GameArena::default();
        arena.play(&board, &topology, &rules, &GameConfig::default());
        (topology, board, arena)
    }

    #[test]
    fn prepared_hand_estimate_matches_direct_bits() {
        let (topology, board, arena) = fixture();
        let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
        for seat in 0..view.seats() {
            for variant in 0..32 {
                let mut inputs = compute_inputs_for_seat(&view, seat);
                inputs.public_vp = variant % 12;
                inputs.dev_count = variant % 5;
                inputs.all_seats_dev_count_sum = u16::from(variant % 7);
                inputs.dev_deck_remaining = variant % 4;
                inputs.dev_victory_points = variant % 6;
                inputs.pieces_city = variant % 3;
                inputs.pieces_settlement = variant % 2;
                inputs.settlements_on_board = variant % 4;
                inputs.city_vp = variant % 4;
                inputs.settlement_vp = variant % 3;
                inputs.production_pips = [u16::from(variant); RESOURCE_COUNT];
                inputs.trade_rates = std::array::from_fn(|r| (r as u32 + u32::from(variant)) % 5);
                if variant % 5 == 0 { inputs.city_cost = None; }
                if variant % 7 == 0 { inputs.road_cost = None; }
                if variant % 11 == 0 { inputs.dev_cost = None; }
                let estimate = EtwEstimate::new(&inputs);
                for amount in [0.0, 0.25, 1.0, 2.5, 9.0, -1.0, f64::INFINITY, f64::NAN] {
                    for resource in 0..RESOURCE_COUNT {
                        inputs.belief_expected = [1.5; RESOURCE_COUNT];
                        inputs.belief_expected[resource] = amount;
                        let direct = expected_turns_to_win(&inputs).to_bits();
                        assert_eq!(estimate.with_hand(&inputs.belief_expected).to_bits(), direct);
                    }
                }
            }
        }
    }

    #[test]
    fn seat_inputs_and_base_follow_each_view() {
        let (topology, board, mut arena) = fixture();
        for variant in 0..12 {
            arena.state.players[0].resources = [variant; RESOURCE_COUNT];
            arena.state.players[1].pieces[1] = variant as u8 % 5;
            arena.state.players[1].pieces[2] = variant as u8 % 4;
            arena.state.players[1].vp_public = variant as u8 % 9;
            arena.state.players[1].playable_dev[0] = variant as u8 % 4;
            arena.state.players[1].trade_rate = [variant as u32 % 5; RESOURCE_COUNT];
            arena.set_dev_state(variant as usize, false);
            arena.state.vertex_owner[0] = variant as u8 % board.seats() as u8;
            arena.state.vertex_tier[0] = variant as u8 % 3;
            arena.state.belief.gain(1, variant as usize % RESOURCE_COUNT, 1);
            for observer in 0..board.seats() {
                let view = arena.decision_view(&board, &topology, observer, DecisionPhase::Action);
                view.with_etw_cache(|cached| {
                    for _ in 0..2 {
                        for seat in 0..board.seats() {
                            let direct = compute_inputs_for_seat(&view, seat);
                            assert_eq!(inputs_for_seat(cached, seat), direct);
                            let expected = expected_turns_to_win(&direct).to_bits();
                            assert_eq!(etw_for_seat(&view, seat).to_bits(), expected);
                            assert_eq!(etw_for_seat(cached, seat).to_bits(), expected);
                            assert_eq!(cached.etw_estimate(seat)
                                .with_hand(&direct.belief_expected).to_bits(), expected);
                        }
                    }
                });
            }
        }
    }
}
