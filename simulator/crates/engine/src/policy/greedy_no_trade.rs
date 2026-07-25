use crate::view::{Action, DecisionView, DevPlay};

pub fn pre_roll(_view: &DecisionView<'_>) -> Option<DevPlay> {
    None
}

pub fn action(view: &DecisionView<'_>) -> Action {
    view.affordable_city()
        .map(Action::UpgradeCity)
        .or_else(|| view.affordable_settlement().map(Action::BuildSettlement))
        .or_else(|| view.affordable_road().map(Action::BuildRoad))
        .or_else(|| view.can_buy_dev().then_some(Action::BuyDev))
        .unwrap_or(Action::Pass)
}

pub fn discard(view: &DecisionView<'_>, count: u8) -> [u8; 5] {
    let mut remaining = *view.own_hand();
    let mut result = [0; 5];
    for _ in 0..count {
        let resource = remaining
            .iter()
            .enumerate()
            .max_by_key(|(_, held)| **held)
            .map_or(0, |(index, _)| index);
        if remaining[resource] == 0 {
            break;
        }
        remaining[resource] -= 1;
        result[resource] += 1;
    }
    result
}

pub fn robber(view: &DecisionView<'_>) -> (u8, Option<u8>) {
    let mut best = view.robber();
    let mut best_score = 0;
    for hex in 0..view.topology().hex_count() {
        let hex = hex as u8;
        if hex == view.robber() || view.hex_touches_seat(hex, view.observer()) {
            continue;
        }
        let score = (0..view.seats())
            .filter(|seat| *seat != view.observer() && view.victim_on_hex(hex, *seat))
            .map(|seat| u16::from(view.public_vp(seat)))
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
    let victim = (0..view.seats())
        .filter(|seat| *seat != view.observer() && view.stealable_on_hex(best, *seat))
        .max_by_key(|seat| view.public_vp(*seat))
        .map(|seat| seat as u8);
    (best, victim)
}
