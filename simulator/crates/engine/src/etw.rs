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

pub fn inputs_for_seat(view: &DecisionView<'_>, seat: usize) -> EtwInputs {
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
        hand_total: u32::from(view.hand_size(seat)),
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
    expected_turns_to_win(&inputs_for_seat(view, seat))
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
