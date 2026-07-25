use crate::rng::Xoshiro256StarStar;
use crate::rules::{Buildable, Resource};
use crate::view::{Action, ActionBuf, DecisionView, DevPlay, ScoredAction};

pub fn pre_roll(view: &DecisionView<'_>, rng: &mut Xoshiro256StarStar) -> Option<DevPlay> {
    let mut selected = None;
    let mut candidates = 1_u32;
    if view.can_play_dev(0) {
        for destination in 0..view.topology().hex_count() {
            let destination = destination as u8;
            if destination == view.robber() {
                continue;
            }
            // Declining the steal is only legal when nobody on the hex is worth robbing.
            if !has_stealable_victim(view, destination) {
                consider(
                    DevPlay::Knight {
                        destination,
                        victim: None,
                    },
                    rng,
                    &mut selected,
                    &mut candidates,
                );
            }
            for victim in 0..view.seats() {
                if victim != view.observer() && view.stealable_on_hex(destination, victim) {
                    consider(
                        DevPlay::Knight {
                            destination,
                            victim: Some(victim as u8),
                        },
                        rng,
                        &mut selected,
                        &mut candidates,
                    );
                }
            }
        }
    }
    if view.can_play_dev(2) {
        for first in 0..view.topology().edge_count() {
            let first = first as u8;
            if !view.legal_road(first) {
                continue;
            }
            let mut has_second = false;
            for second in 0..view.topology().edge_count() {
                let second = second as u8;
                if view.legal_road_after(first, second) {
                    has_second = true;
                    consider(
                        DevPlay::RoadBuilding {
                            first: Some(first),
                            second: Some(second),
                        },
                        rng,
                        &mut selected,
                        &mut candidates,
                    );
                }
            }
            if !has_second {
                consider(
                    DevPlay::RoadBuilding {
                        first: Some(first),
                        second: None,
                    },
                    rng,
                    &mut selected,
                    &mut candidates,
                );
            }
        }
    }
    if view.can_play_dev(3) {
        for first in Resource::ALL {
            for second in Resource::ALL {
                let needed = u16::from(first == second) + 1;
                if view.bank(first) > 0 && view.bank(second) >= needed {
                    consider(
                        DevPlay::YearOfPlenty { first, second },
                        rng,
                        &mut selected,
                        &mut candidates,
                    );
                }
            }
        }
    }
    if view.can_play_dev(4) {
        for resource in Resource::ALL {
            consider(
                DevPlay::Monopoly { resource },
                rng,
                &mut selected,
                &mut candidates,
            );
        }
    }
    selected
}

pub fn action(view: &DecisionView<'_>, rng: &mut Xoshiro256StarStar) -> Action {
    let mut out = ActionBuf::new();
    legal_actions(view, rng, &mut out);
    let actions = out.as_slice();
    if actions.len() == 1 {
        return Action::Pass;
    }
    let non_pass = actions.len() - 1;
    let pick = rng.range((non_pass + 3) as u32) as usize;
    if pick >= non_pass {
        Action::Pass
    } else {
        actions[pick % non_pass].action
    }
}

pub fn legal_actions(view: &DecisionView<'_>, rng: &mut Xoshiro256StarStar, out: &mut ActionBuf) {
    out.clear();
    if view.can_afford(Buildable::Road) {
        for edge in 0..view.topology().edge_count() {
            if view.legal_road(edge as u8) {
                out.push(scored(Action::BuildRoad(edge as u8)));
            }
        }
    }
    if view.can_afford(Buildable::Settlement) {
        for vertex in 0..view.topology().vertex_count() {
            if view.legal_settlement(vertex as u8) {
                out.push(scored(Action::BuildSettlement(vertex as u8)));
            }
        }
    }
    if view.can_afford(Buildable::City) {
        for vertex in 0..view.topology().vertex_count() {
            if view.legal_city(vertex as u8) {
                out.push(scored(Action::UpgradeCity(vertex as u8)));
            }
        }
    }
    for give in Resource::ALL {
        for get in Resource::ALL {
            let mut count = 1;
            while view.legal_trade(give, get, count) {
                out.push(scored(Action::TradeBank { give, get, count }));
                count += 1;
            }
        }
    }
    if view.can_buy_dev() {
        out.push(scored(Action::BuyDev));
    }
    if view.can_play_dev(0) {
        for destination in 0..view.topology().hex_count() {
            let destination = destination as u8;
            if destination == view.robber() {
                continue;
            }
            if !has_stealable_victim(view, destination) {
                out.push(scored(Action::PlayDev(DevPlay::Knight {
                    destination,
                    victim: None,
                })));
            }
            for victim in 0..view.seats() {
                if victim != view.observer() && view.stealable_on_hex(destination, victim) {
                    out.push(scored(Action::PlayDev(DevPlay::Knight {
                        destination,
                        victim: Some(victim as u8),
                    })));
                }
            }
        }
    }
    if view.can_play_dev(2) {
        for first in 0..view.topology().edge_count() {
            let first = first as u8;
            if !view.legal_road(first) {
                continue;
            }
            let mut has_second = false;
            for second in 0..view.topology().edge_count() {
                let second = second as u8;
                if view.legal_road_after(first, second) {
                    has_second = true;
                    out.push(scored(Action::PlayDev(DevPlay::RoadBuilding {
                        first: Some(first),
                        second: Some(second),
                    })));
                }
            }
            if !has_second {
                out.push(scored(Action::PlayDev(DevPlay::RoadBuilding {
                    first: Some(first),
                    second: None,
                })));
            }
        }
    }
    if view.can_play_dev(3) {
        for first in Resource::ALL {
            for second in Resource::ALL {
                let needed = u16::from(first == second) + 1;
                if view.bank(first) > 0 && view.bank(second) >= needed {
                    out.push(scored(Action::PlayDev(DevPlay::YearOfPlenty {
                        first,
                        second,
                    })));
                }
            }
        }
    }
    if view.can_play_dev(4) {
        for resource in Resource::ALL {
            out.push(scored(Action::PlayDev(DevPlay::Monopoly { resource })));
        }
    }
    out.push(scored(Action::Pass));
    let _ = rng;
}

pub fn discard(view: &DecisionView<'_>, count: u8, rng: &mut Xoshiro256StarStar) -> [u8; 5] {
    let mut remaining = *view.own_hand();
    let mut result = [0; 5];
    for _ in 0..count {
        let total: i16 = remaining.iter().sum();
        if total == 0 {
            break;
        }
        let mut pick = rng.range(total as u32) as i16;
        for resource in 0..5 {
            if pick < remaining[resource] {
                remaining[resource] -= 1;
                result[resource] += 1;
                break;
            }
            pick -= remaining[resource];
        }
    }
    result
}

fn has_stealable_victim(view: &DecisionView<'_>, destination: u8) -> bool {
    (0..view.seats())
        .any(|seat| seat != view.observer() && view.stealable_on_hex(destination, seat))
}

pub fn robber(view: &DecisionView<'_>, rng: &mut Xoshiro256StarStar) -> (u8, Option<u8>) {
    let destinations = view.topology().hex_count() - 1;
    let mut destination = rng.range(destinations as u32) as u8;
    if destination >= view.robber() {
        destination += 1;
    }
    let mut victims = [0_u8; 6];
    let mut len = 0;
    for seat in 0..view.seats() {
        // Only loaded seats are eligible; naming an empty-handed one is an illegal decision now
        // that a mandatory steal is enforced.
        if seat != view.observer() && view.stealable_on_hex(destination, seat) {
            victims[len] = seat as u8;
            len += 1;
        }
    }
    let victim = (len > 0).then(|| victims[rng.range(len as u32) as usize]);
    (destination, victim)
}

fn consider(
    play: DevPlay,
    rng: &mut Xoshiro256StarStar,
    selected: &mut Option<DevPlay>,
    candidates: &mut u32,
) {
    *candidates += 1;
    if rng.range(*candidates) == 0 {
        *selected = Some(play);
    }
}

const fn scored(action: Action) -> ScoredAction {
    ScoredAction { action, score: 0.0 }
}
