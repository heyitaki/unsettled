use crate::policy::PolicyScratch;
use crate::rules::{Buildable, Resource};
use crate::view::{Action, DecisionView, DevPlay, can_pay};

pub fn pre_roll(view: &DecisionView<'_>, scratch: &mut PolicyScratch) -> Option<DevPlay> {
    scratch.goal = top_goal(view).map(|goal| goal.kind);
    if view.can_play_dev(0)
        && (view.knight_takes_largest_army()
            || view.hex_touches_seat(view.robber(), view.observer()))
    {
        let (destination, victim) = robber(view);
        return Some(DevPlay::Knight {
            destination,
            victim,
        });
    }
    if view.can_play_dev(3)
        && let Some((first, second)) = plenty_for_goal(view, scratch.goal)
    {
        return Some(DevPlay::YearOfPlenty { first, second });
    }
    if view.can_play_dev(4)
        && let Some(resource) = monopoly_for_goal(view, scratch.goal)
    {
        return Some(DevPlay::Monopoly { resource });
    }
    if view.can_play_dev(2) {
        let (first, second) = view.best_road_building_pair();
        if first.is_some() {
            return Some(DevPlay::RoadBuilding { first, second });
        }
    }
    None
}

pub fn action(view: &DecisionView<'_>, scratch: &mut PolicyScratch) -> Action {
    let city = city_goal(view);
    let settlement = settlement_goal(view);
    scratch.goal = city.or(settlement).map(|value| value.kind);
    // Largest Army is worth more than any single build, so a knight that takes it outranks the
    // build queue. Gating knights on holding a spare (below) would otherwise make the card
    // unreachable, and this policy is the independent comparator -- if it shared that blind spot
    // it could not police heuristic-v1.
    if view.can_play_dev(0) && view.knight_takes_largest_army() {
        let (destination, victim) = robber(view);
        return Action::PlayDev(DevPlay::Knight {
            destination,
            victim,
        });
    }
    if let Some(goal) = city
        && view.can_afford(goal.kind)
    {
        return goal.action;
    }
    if let Some(goal) = settlement
        && view.can_afford(goal.kind)
    {
        return goal.action;
    }
    for goal in [city, settlement].into_iter().flatten() {
        if let Some(trade) = purchase_completing_trade(view, goal.kind) {
            return trade;
        }
    }
    if view.dev_deck_remaining() > 0
        && let Some(trade) = completing_trade_for_cost(view, view.dev_cost())
    {
        return trade;
    }
    let hand = view.own_hand();
    if hand[Resource::Wood.index()] >= 1
        && hand[Resource::Brick.index()] >= 1
        && view.can_afford(Buildable::Road)
        && let Some(edge) = view.best_expansion_road()
    {
        return Action::BuildRoad(edge);
    }
    if view.can_buy_dev()
        && hand[Resource::Ore.index()] >= 1
        && hand[Resource::Wheat.index()] >= 1
        && hand[Resource::Sheep.index()] >= 1
    {
        return Action::BuyDev;
    }
    if view.can_play_dev(0) && view.own_playable_dev()[0] >= 2 {
        let (destination, victim) = robber(view);
        return Action::PlayDev(DevPlay::Knight {
            destination,
            victim,
        });
    }
    Action::Pass
}

pub fn discard(view: &DecisionView<'_>, count: u8, scratch: &mut PolicyScratch) -> [u8; 5] {
    let goal = scratch
        .goal
        .or_else(|| top_goal(view).map(|value| value.kind));
    let cost = goal
        .and_then(|kind| view.costs(kind).first())
        .copied()
        .unwrap_or([0; 5]);
    let mut remaining = *view.own_hand();
    let mut result = [0; 5];
    for _ in 0..count {
        let resource = (0..5)
            .max_by_key(|index| remaining[*index] - i16::from(cost[*index]))
            .unwrap_or(0);
        if remaining[resource] == 0 {
            break;
        }
        remaining[resource] -= 1;
        result[resource] += 1;
    }
    result
}

pub fn robber(view: &DecisionView<'_>) -> (u8, Option<u8>) {
    let leader = (0..view.seats())
        .filter(|seat| *seat != view.observer())
        .max_by_key(|seat| view.public_vp(*seat))
        .unwrap_or(view.observer());
    let mut best = view.robber();
    let mut best_score = 0;
    for hex in 0..view.topology().hex_count() {
        let hex = hex as u8;
        if hex == view.robber() || view.hex_touches_seat(hex, view.observer()) {
            continue;
        }
        let token_pips = view.board().tokens()[usize::from(hex)].map_or(0, crate::view::pips);
        let leader_touch = view.victim_on_hex(hex, leader);
        let opponent_touch = (0..view.seats())
            .filter(|seat| *seat != view.observer() && view.victim_on_hex(hex, *seat))
            .count() as u16;
        let score = u16::from(token_pips) * (opponent_touch + if leader_touch { 3 } else { 0 });
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
    let victim = (0..view.seats())
        .filter(|seat| *seat != view.observer() && view.stealable_on_hex(best, *seat))
        .max_by_key(|seat| view.public_vp(*seat))
        .map(|seat| seat as u8);
    (best, victim)
}

#[derive(Clone, Copy)]
struct Goal {
    kind: Buildable,
    action: Action,
}

fn top_goal(view: &DecisionView<'_>) -> Option<Goal> {
    city_goal(view).or_else(|| settlement_goal(view))
}

fn city_goal(view: &DecisionView<'_>) -> Option<Goal> {
    let city = (0..view.topology().vertex_count())
        .map(|vertex| vertex as u8)
        .filter(|vertex| view.legal_city(*vertex))
        .max_by_key(|vertex| view.vertex_pips(*vertex, true));
    city.map(|vertex| Goal {
        kind: Buildable::City,
        action: Action::UpgradeCity(vertex),
    })
}

fn settlement_goal(view: &DecisionView<'_>) -> Option<Goal> {
    view.best_legal_settlement().map(|vertex| Goal {
        kind: Buildable::Settlement,
        action: Action::BuildSettlement(vertex),
    })
}

fn purchase_completing_trade(view: &DecisionView<'_>, goal: Buildable) -> Option<Action> {
    for cost in view.costs(goal) {
        let total_missing: u32 = Resource::ALL
            .iter()
            .map(|resource| {
                u32::try_from(
                    (i16::from(cost[resource.index()]) - view.own_hand()[resource.index()]).max(0),
                )
                .unwrap_or(0)
            })
            .sum();
        let trade_credits: u32 = Resource::ALL
            .iter()
            .map(|resource| {
                let surplus = (view.own_hand()[resource.index()]
                    - i16::from(cost[resource.index()]))
                .max(0) as u32;
                surplus / view.trade_rate(*resource)
            })
            .sum();
        if trade_credits < total_missing {
            continue;
        }
        for get in Resource::ALL {
            let missing =
                u8::try_from((i16::from(cost[get.index()]) - view.own_hand()[get.index()]).max(0))
                    .unwrap_or(0);
            if missing == 0 {
                continue;
            }
            for give in Resource::ALL {
                if give == get {
                    continue;
                }
                let surplus =
                    (view.own_hand()[give.index()] - i16::from(cost[give.index()])).max(0) as u32;
                let available = surplus / view.trade_rate(give);
                let count = u8::try_from(
                    available
                        .min(u32::from(missing))
                        .min(u32::from(view.bank(get))),
                )
                .unwrap_or(0);
                if count > 0 && view.legal_trade(give, get, count) {
                    return Some(Action::TradeBank { give, get, count });
                }
            }
        }
        for give in Resource::ALL {
            for get in Resource::ALL {
                let mut count = 1;
                while give != get && view.legal_trade(give, get, count) {
                    let mut after = *view.own_hand();
                    after[give.index()] -= (view.trade_rate(give) * u32::from(count)) as i16;
                    after[get.index()] += i16::from(count);
                    if can_pay(&after, cost) {
                        return Some(Action::TradeBank { give, get, count });
                    }
                    count += 1;
                }
            }
        }
    }
    None
}

fn completing_trade_for_cost(view: &DecisionView<'_>, cost: &[u8; 5]) -> Option<Action> {
    for give in Resource::ALL {
        for get in Resource::ALL {
            if give == get || view.trade_rate(give) > 3 || !view.legal_trade(give, get, 1) {
                continue;
            }
            let mut after = *view.own_hand();
            after[give.index()] -= view.trade_rate(give) as i16;
            after[get.index()] += 1;
            if can_pay(&after, cost) {
                return Some(Action::TradeBank {
                    give,
                    get,
                    count: 1,
                });
            }
        }
    }
    None
}

fn plenty_for_goal(
    view: &DecisionView<'_>,
    goal: Option<Buildable>,
) -> Option<(Resource, Resource)> {
    let kind = goal?;
    for cost in view.costs(kind) {
        let mut missing = [0_u8; 5];
        let mut total = 0;
        for resource in 0..5 {
            missing[resource] =
                u8::try_from((i16::from(cost[resource]) - view.own_hand()[resource]).max(0))
                    .unwrap_or(0);
            total += missing[resource];
        }
        if total == 2 {
            let first = (0..5).find(|index| missing[*index] > 0)?;
            missing[first] -= 1;
            let second = (0..5).find(|index| missing[*index] > 0).unwrap_or(first);
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

fn monopoly_for_goal(view: &DecisionView<'_>, goal: Option<Buildable>) -> Option<Resource> {
    let kind = goal?;
    let cost = view.costs(kind).first()?;
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
