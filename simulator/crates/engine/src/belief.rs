use serde::{Deserialize, Serialize};

use crate::rules::RESOURCE_COUNT;
use crate::state::MAX_SEATS;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BeliefState {
    totals: [u32; MAX_SEATS],
    lo: [[u16; RESOURCE_COUNT]; MAX_SEATS],
    hi: [[u16; RESOURCE_COUNT]; MAX_SEATS],
}

impl BeliefState {
    pub const fn new() -> Self {
        Self {
            totals: [0; MAX_SEATS],
            lo: [[0; RESOURCE_COUNT]; MAX_SEATS],
            hi: [[0; RESOURCE_COUNT]; MAX_SEATS],
        }
    }

    pub const fn total(&self, seat: usize) -> u32 {
        self.totals[seat]
    }

    pub const fn lo(&self, seat: usize) -> &[u16; RESOURCE_COUNT] {
        &self.lo[seat]
    }

    pub const fn hi(&self, seat: usize) -> &[u16; RESOURCE_COUNT] {
        &self.hi[seat]
    }

    pub fn is_exact(&self, seat: usize) -> bool {
        self.lo[seat] == self.hi[seat]
    }

    pub fn contains(&self, seat: usize, hand: &[i16; RESOURCE_COUNT]) -> bool {
        let total = self.totals[seat];
        let lo = &self.lo[seat];
        let hi = &self.hi[seat];
        let sum_lo = lo.iter().map(|value| u32::from(*value)).sum::<u32>();
        let sum_hi = hi.iter().map(|value| u32::from(*value)).sum::<u32>();
        if lo
            .iter()
            .zip(hi)
            .any(|(lower, upper)| lower > upper || u32::from(*upper) > total)
            || sum_lo > total
            || sum_hi < total
        {
            return false;
        }
        let mut hand_total = 0_u32;
        for resource in 0..RESOURCE_COUNT {
            let Ok(count) = u16::try_from(hand[resource]) else {
                return false;
            };
            if count < lo[resource] || count > hi[resource] {
                return false;
            }
            hand_total = hand_total.saturating_add(u32::from(count));
        }
        hand_total == total
    }

    pub fn expected(&self, seat: usize) -> [f64; RESOURCE_COUNT] {
        let lo = &self.lo[seat];
        let hi = &self.hi[seat];
        let sum_lo = lo.iter().map(|value| u32::from(*value)).sum::<u32>();
        let unknown = self.totals[seat].saturating_sub(sum_lo);
        let spread = (0..RESOURCE_COUNT)
            .map(|resource| u32::from(hi[resource].saturating_sub(lo[resource])))
            .sum::<u32>();
        if spread == 0 {
            return lo.map(f64::from);
        }
        std::array::from_fn(|resource| {
            f64::from(lo[resource])
                + f64::from(unknown) * f64::from(hi[resource].saturating_sub(lo[resource]))
                    / f64::from(spread)
        })
    }

    pub fn gain(&mut self, seat: usize, resource: usize, n: u16) {
        self.lo[seat][resource] = self.lo[seat][resource].saturating_add(n);
        self.hi[seat][resource] = self.hi[seat][resource].saturating_add(n);
        self.totals[seat] = self.totals[seat].saturating_add(u32::from(n));
        self.repair(seat);
    }

    pub fn lose(&mut self, seat: usize, resource: usize, n: u16) {
        self.lo[seat][resource] = self.lo[seat][resource].saturating_sub(n);
        self.hi[seat][resource] = self.hi[seat][resource].saturating_sub(n);
        self.totals[seat] = self.totals[seat].saturating_sub(u32::from(n));
        self.normalize(seat);
        self.repair(seat);
    }

    pub fn reveal_exact(&mut self, seat: usize, resource: usize, n: u16) {
        self.lo[seat][resource] = n;
        self.hi[seat][resource] = n;
        self.normalize(seat);
        self.repair(seat);
    }

    pub fn steal(&mut self, thief: usize, victim: usize) {
        let mut possible: [bool; RESOURCE_COUNT] =
            std::array::from_fn(|resource| self.hi[victim][resource] > 0);
        let possible_count = possible.iter().filter(|value| **value).count();
        if possible_count == 0 {
            possible = [true; RESOURCE_COUNT];
        }

        self.totals[victim] = self.totals[victim].saturating_sub(1);
        for resource in 0..RESOURCE_COUNT {
            if possible[resource] {
                self.lo[victim][resource] = self.lo[victim][resource].saturating_sub(1);
            }
        }
        self.normalize(victim);
        self.repair(victim);

        self.totals[thief] = self.totals[thief].saturating_add(1);
        for resource in 0..RESOURCE_COUNT {
            if possible[resource] {
                self.hi[thief][resource] = self.hi[thief][resource].saturating_add(1);
            }
        }
        if possible_count == 1 {
            let resource = possible
                .iter()
                .position(|value| *value)
                .expect("singleton possible set");
            self.lo[thief][resource] = self.lo[thief][resource].saturating_add(1);
        }
        self.normalize(thief);
        self.repair(thief);
    }

    fn normalize(&mut self, seat: usize) {
        let total = self.totals[seat];
        for resource in 0..RESOURCE_COUNT {
            let other_lo = (0..RESOURCE_COUNT)
                .filter(|other| *other != resource)
                .map(|other| u32::from(self.lo[seat][other]))
                .sum::<u32>();
            let ceiling = total.saturating_sub(other_lo).min(u32::from(u16::MAX)) as u16;
            self.hi[seat][resource] = self.hi[seat][resource].min(ceiling);
        }
        for resource in 0..RESOURCE_COUNT {
            let other_hi = (0..RESOURCE_COUNT)
                .filter(|other| *other != resource)
                .map(|other| u32::from(self.hi[seat][other]))
                .sum::<u32>();
            let floor = total.saturating_sub(other_hi).min(u32::from(u16::MAX)) as u16;
            self.lo[seat][resource] = self.lo[seat][resource].max(floor);
        }
    }

    fn repair(&mut self, seat: usize) {
        let total = self.totals[seat];
        let sum_lo = self.lo[seat]
            .iter()
            .map(|value| u32::from(*value))
            .sum::<u32>();
        let sum_hi = self.hi[seat]
            .iter()
            .map(|value| u32::from(*value))
            .sum::<u32>();
        if self.lo[seat]
            .iter()
            .zip(self.hi[seat])
            .any(|(lower, upper)| *lower > upper)
            || self.hi[seat].iter().any(|upper| u32::from(*upper) > total)
            || sum_lo > total
            || sum_hi < total
        {
            // A real i16 hand totals at most 163835, below this representable cap. Clamping
            // therefore cannot newly make a desynced belief total match a real hand total.
            self.totals[seat] = self.totals[seat].min(RESOURCE_COUNT as u32 * u32::from(u16::MAX));
            let total = self.totals[seat];
            self.lo[seat] = [0; RESOURCE_COUNT];
            self.hi[seat] = [total.min(u32::from(u16::MAX)) as u16; RESOURCE_COUNT];
        }
    }
}

impl Default for BeliefState {
    fn default() -> Self {
        Self::new()
    }
}
