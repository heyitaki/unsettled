use std::collections::BTreeMap;

use serde_json::{Value, json};

use crate::board::{ConversionOptions, SimBoard};
use crate::game::{GameArena, GameConfig};
use crate::policy::PolicyKind;
use crate::rng::derive_game_seed;
use crate::rules::{RuleConfig, TradeConfig};
use crate::state::MAX_SEATS;
use crate::topology::Topology;
use crate::wire::{BuildingTier, WireBoard};

// The app's recap stream spends no simulator seed domain.
const RECAP_SEED: u64 = 0x7265_6361_7000_0001;

pub(crate) fn recap(
    wire: WireBoard,
    games: u32,
    batch: u64,
    policy: PolicyKind,
) -> Result<Value, String> {
    if !(1..=1000).contains(&games) {
        return Err("recap games must be between 1 and 1000".into());
    }
    let topology = Topology::load(wire.layout)?;
    let mut rules = RuleConfig::base(wire.layout);
    rules.player_trading = Some(TradeConfig::default());
    let board = SimBoard::try_from_wire(
        wire, &topology, &rules, ConversionOptions { allow_unofficial: true },
    ).map_err(|error| error.to_string())?;
    for (seat, id) in board.player_ids().iter().enumerate() {
        let tiers = board.buildings().iter()
            .filter(|b| usize::from(b.seat) == seat).map(|b| b.tier);
        if !tiers.eq([BuildingTier::Settlement; 2]) {
            return Err(format!("recap requires exactly two settlements for player {id}"));
        }
    }
    let mut wins = [0_u32; MAX_SEATS];
    let mut draws = 0_u32;
    let mut arena = GameArena::default();
    let mut config = GameConfig { policies: [policy; MAX_SEATS], ..GameConfig::default() };
    for i in 0..games {
        config.seed = derive_game_seed(RECAP_SEED, batch, u64::from(i));
        match arena.play_from_draft(&board, &topology, &rules, &config).winner {
            Some(seat) => wins[usize::from(seat)] += 1,
            None => draws += 1,
        }
    }
    let wins: BTreeMap<_, _> = board.player_ids().iter().zip(wins).collect();
    Ok(json!({"kind":"recap","games":games,"wins":wins,"draws":draws}))
}
