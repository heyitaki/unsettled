use serde::{Deserialize, Serialize};

use crate::board::SimBoard;
use crate::longest_road::{RoadNetwork, leading_holder, update_road_card};
use crate::placement::{self, PlacementKind, choose};
use crate::policy::{self, PolicyKind, PolicyScratch};
use crate::rng::Streams;
use crate::rules::{
    Buildable, FlattenedRules, OwnedPort, PlayerModifiers, RESOURCE_COUNT, Resource,
    RuleConfig,
};
use crate::state::{
    DEV_KNIGHT, DEV_MONOPOLY, DEV_ROAD_BUILDING, DEV_VP, DEV_YEAR_OF_PLENTY, EMPTY, GameState,
    MAX_SEATS,
};
use crate::topology::{Edge, Hex, Topology, Vertex};
use crate::trade::{TradeOffer, embargoed};
use crate::view::{Action, DecisionPhase, DecisionView, DevPlay, can_pay};

/// One slot per resource-specific port plus one for the generic (3:1) port. A seat can touch any
/// number of ports, but only the best rate in each slot is ever consulted.
const MAX_PORTS: usize = RESOURCE_COUNT + 1;

#[derive(Clone, Debug)]
pub struct GameConfig {
    pub placements: [PlacementKind; MAX_SEATS],
    pub policies: [PolicyKind; MAX_SEATS],
    pub modifiers: [PlayerModifiers; MAX_SEATS],
    pub seed: u64,
}

impl Default for GameConfig {
    fn default() -> Self {
        Self {
            placements: [PlacementKind::MaxPips; MAX_SEATS],
            policies: [PolicyKind::HeuristicV1; MAX_SEATS],
            modifiers: std::array::from_fn(|_| PlayerModifiers::default()),
            seed: 0,
        }
    }
}

/// One settlement-and-road placement made during setup, recorded in the order `setup_order`
/// produces. Observation only: nothing in the engine reads a `SetupPick` back.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupPick {
    pub seat: u8,
    /// 0 for the first settlement, 1 for the second.
    pub pick: u8,
    /// Whether this pick took the setup resource grant, which only the second round does.
    pub grant: bool,
    pub vertex: Vertex,
    pub edge: Edge,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameResult {
    pub winner: Option<u8>,
    pub vp: [u8; MAX_SEATS],
    pub turns: u16,
    pub draw: bool,
    pub illegal_actions: u32,
}

#[derive(Clone)]
pub struct GameArena {
    pub state: GameState,
    streams: Streams,
    flattened: [FlattenedRules; MAX_SEATS],
    /// Mirrors the config's per-seat policies so rule flattening can honour the rule-level effects
    /// a policy implies (see `PolicyKind::port_rules`) without threading the config through.
    policies: [PolicyKind; MAX_SEATS],
    scratch: [PolicyScratch; MAX_SEATS],
    dev_deck: [u8; 40],
    dev_len: usize,
    dev_cursor: usize,
    dev_played_this_turn: bool,
    offers_this_turn: u8,
    illegal_actions: u32,
}

impl Default for GameArena {
    fn default() -> Self {
        Self {
            state: GameState::default(),
            streams: Streams::new(0),
            flattened: [FlattenedRules::default(); MAX_SEATS],
            policies: [PolicyKind::HeuristicV1; MAX_SEATS],
            scratch: std::array::from_fn(|_| PolicyScratch::default()),
            dev_deck: [0; 40],
            dev_len: 0,
            dev_cursor: 0,
            dev_played_this_turn: false,
            offers_this_turn: 0,
            illegal_actions: 0,
        }
    }
}

impl GameArena {
    pub fn play(
        &mut self,
        board: &SimBoard,
        topology: &Topology,
        rules: &RuleConfig,
        config: &GameConfig,
    ) -> GameResult {
        self.play_inner(board, topology, rules, config, None)
    }

    /// Plays a game and appends every setup pick to `trace`, in `setup_order` order. Identical to
    /// `play` in every other respect: the trace only observes, so a traced and an untraced game on
    /// the same seed play out the same. `play` passes `None`, which keeps the hot path
    /// allocation-free.
    pub fn play_traced(
        &mut self,
        board: &SimBoard,
        topology: &Topology,
        rules: &RuleConfig,
        config: &GameConfig,
        trace: &mut Vec<SetupPick>,
    ) -> GameResult {
        self.play_inner(board, topology, rules, config, Some(trace))
    }

    fn play_inner(
        &mut self,
        board: &SimBoard,
        topology: &Topology,
        rules: &RuleConfig,
        config: &GameConfig,
        setup_trace: Option<&mut Vec<SetupPick>>,
    ) -> GameResult {
        self.prepare(board, topology, rules, config);
        self.setup(board, topology, rules, config, setup_trace);
        debug_assert!(self.invariants_hold(board, topology, rules));
        let seats = board.seats();
        let mut turns = 0_u16;
        let mut winner = None;
        'rounds: for round in 0..rules.turn_cap {
            self.state.round = round;
            for seat in 0..seats {
                self.state.current_seat = seat as u8;
                turns = turns.saturating_add(1);
                if self.begin_turn(board, topology, rules, config, seat) {
                    winner = Some(seat as u8);
                    break 'rounds;
                }
                let roll = self.streams.dice.range(6) + self.streams.dice.range(6) + 2;
                if roll == 7 {
                    self.resolve_seven(board, topology, rules, config, seat);
                } else {
                    self.produce(board, topology, roll as u8, seats);
                }
                loop {
                    let action =
                        self.ask_action(board, topology, config, seat, DecisionPhase::Action);
                    if action == Action::Pass {
                        break;
                    }
                    if !self.apply_action_internal(
                        board,
                        topology,
                        rules,
                        config,
                        seat,
                        action,
                        DecisionPhase::Action,
                    ) {
                        break;
                    }
                    if self.total_vp(seat) >= rules.win_vp {
                        winner = Some(seat as u8);
                        break 'rounds;
                    }
                }
                if rules.special_building_phase(seats) {
                    for offset in 1..seats {
                        let builder = (seat + offset) % seats;
                        loop {
                            let action = self.ask_action(
                                board,
                                topology,
                                config,
                                builder,
                                DecisionPhase::SpecialBuild,
                            );
                            if action == Action::Pass {
                                break;
                            }
                            if !self.apply_action_internal(
                                board,
                                topology,
                                rules,
                                config,
                                builder,
                                action,
                                DecisionPhase::SpecialBuild,
                            ) {
                                break;
                            }
                        }
                    }
                }
                debug_assert!(self.invariants_hold(board, topology, rules));
            }
        }
        let mut vp = [0; MAX_SEATS];
        for (seat, value) in vp.iter_mut().enumerate().take(seats) {
            *value = self.total_vp(seat);
        }
        GameResult {
            winner,
            vp,
            turns,
            draw: winner.is_none(),
            illegal_actions: self.illegal_actions,
        }
    }

    pub fn prepare(
        &mut self,
        board: &SimBoard,
        topology: &Topology,
        rules: &RuleConfig,
        config: &GameConfig,
    ) {
        self.state = GameState::default();
        self.state.bank = rules.bank_supply;
        self.state.robber = board.robber();
        self.streams = Streams::new(config.seed);
        for scratch in &mut self.scratch {
            scratch.reset();
        }
        self.illegal_actions = 0;
        self.dev_played_this_turn = false;
        self.offers_this_turn = 0;
        for road in board.roads() {
            self.state.edge_owner[usize::from(road.edge)] = road.seat;
        }
        for building in board.buildings() {
            self.state.vertex_owner[usize::from(building.vertex)] = building.seat;
            self.state.vertex_tier[usize::from(building.vertex)] = match building.tier {
                crate::wire::BuildingTier::Settlement => 1,
                crate::wire::BuildingTier::City => 2,
                crate::wire::BuildingTier::SuperCity => 3,
            };
        }
        self.policies = config.policies;
        self.flattened = [FlattenedRules::default(); MAX_SEATS];
        // Count what the board already carries before deriving the pools, so a board holding more
        // pieces of a kind than the rule set allows widens the limit instead of underflowing it
        // (see `FlattenedRules::raise_limit`).
        let mut placed = [[0_u8; 4]; MAX_SEATS];
        for road in board.roads() {
            placed[usize::from(road.seat)][Buildable::Road.index()] += 1;
        }
        for building in board.buildings() {
            placed[usize::from(building.seat)][buildable_for(building.tier).index()] += 1;
        }
        for seat in 0..board.seats() {
            self.refresh_player_rules(board, topology, rules, seat, &config.modifiers[seat]);
            for buildable in Buildable::ALL {
                let owned = placed[seat][buildable.index()];
                self.flattened[seat].raise_limit(buildable, owned);
                self.state.players[seat].pieces[buildable.index()] =
                    self.flattened[seat].limit(buildable) - owned;
            }
        }
        for building in board.buildings() {
            let seat = usize::from(building.seat);
            self.state.players[seat].vp_public +=
                self.flattened[seat].vp(buildable_for(building.tier));
        }
        self.dev_len = 0;
        for (kind, count) in [
            (DEV_KNIGHT, rules.dev_deck.knight),
            (DEV_VP, rules.dev_deck.victory_point),
            (DEV_ROAD_BUILDING, rules.dev_deck.road_building),
            (DEV_YEAR_OF_PLENTY, rules.dev_deck.year_of_plenty),
            (DEV_MONOPOLY, rules.dev_deck.monopoly),
        ] {
            for _ in 0..count {
                self.dev_deck[self.dev_len] = kind as u8;
                self.dev_len += 1;
            }
        }
        self.streams
            .deck
            .shuffle(&mut self.dev_deck[..self.dev_len]);
        self.dev_cursor = 0;
    }

    pub fn decision_view<'a>(
        &'a self,
        board: &'a SimBoard,
        topology: &'a Topology,
        seat: usize,
        phase: DecisionPhase,
    ) -> DecisionView<'a> {
        DecisionView::new(
            &self.state,
            board,
            topology,
            &self.flattened[seat],
            &self.flattened,
            seat,
            board.seats(),
            (self.dev_len - self.dev_cursor) as u8,
            self.dev_played_this_turn,
            self.offers_remaining(seat),
            phase,
        )
    }

    pub const fn flattened_rules(&self, seat: usize) -> &FlattenedRules {
        &self.flattened[seat]
    }

    pub fn refresh_player_rules(
        &mut self,
        board: &SimBoard,
        topology: &Topology,
        rules: &RuleConfig,
        seat: usize,
        modifier: &PlayerModifiers,
    ) {
        // Only the best rate per resource can ever matter, plus the best generic port, so collapse
        // owned ports into one slot each. That bounds the array by construction: a board carrying
        // a port on every coastal edge (structurally legal in the app's format) used to run off
        // the end of a fixed 11-entry array.
        let mut best = [u32::MAX; MAX_PORTS];
        for port in board.ports() {
            let endpoints = topology.edge_endpoints(port.edge);
            if endpoints
                .iter()
                .any(|vertex| self.state.vertex_owner[usize::from(*vertex)] == seat as u8)
            {
                let slot = port
                    .resource
                    .map_or(RESOURCE_COUNT, |resource| resource.index());
                best[slot] = best[slot].min(port.rate);
            }
        }
        let mut ports = [OwnedPort {
            resource: None,
            rate: u32::MAX,
        }; MAX_PORTS];
        let mut len = 0;
        for (slot, rate) in best.iter().enumerate() {
            if *rate == u32::MAX {
                continue;
            }
            ports[len] = OwnedPort {
                resource: Resource::ALL.get(slot).copied(),
                rate: *rate,
            };
            len += 1;
        }
        self.flattened[seat] =
            rules.flatten_player_with(modifier, &ports[..len], self.policies[seat].port_rules());
        for resource in Resource::ALL {
            self.state.players[seat].trade_rate[resource.index()] =
                self.flattened[seat].trade_rate(resource);
        }
    }

    pub fn validate_action(
        &self,
        board: &SimBoard,
        topology: &Topology,
        seat: usize,
        action: Action,
        phase: DecisionPhase,
    ) -> bool {
        let view = self.decision_view(board, topology, seat, phase);
        match action {
            Action::BuildRoad(edge) => view.legal_road(edge) && view.can_afford(Buildable::Road),
            Action::BuildSettlement(vertex) => {
                view.legal_settlement(vertex) && view.can_afford(Buildable::Settlement)
            }
            Action::UpgradeCity(vertex) => {
                view.legal_city(vertex) && view.can_afford(Buildable::City)
            }
            Action::BuyDev => view.can_buy_dev(),
            Action::TradeBank { give, get, count } => view.legal_trade(give, get, count),
            Action::OfferTrade { give, get, count } => view.legal_offer_trade(give, get, count),
            Action::PlayDev(play) => self.validate_dev_play(&view, play),
            Action::Pass => true,
        }
    }

    pub fn apply_action_for_test(
        &mut self,
        board: &SimBoard,
        topology: &Topology,
        rules: &RuleConfig,
        config: &GameConfig,
        seat: usize,
        action: Action,
        phase: DecisionPhase,
    ) -> bool {
        self.apply_action_internal(board, topology, rules, config, seat, action, phase)
    }

    #[doc(hidden)]
    pub fn ask_action_for_test(
        &mut self,
        board: &SimBoard,
        topology: &Topology,
        config: &GameConfig,
        seat: usize,
        phase: DecisionPhase,
    ) -> Action {
        self.ask_action(board, topology, config, seat, phase)
    }

    #[doc(hidden)]
    pub fn begin_turn_for_test(
        &mut self,
        board: &SimBoard,
        topology: &Topology,
        rules: &RuleConfig,
        config: &GameConfig,
        seat: usize,
    ) -> bool {
        self.begin_turn(board, topology, rules, config, seat)
    }

    #[doc(hidden)]
    pub fn dice_trace_for_test<const N: usize>(&self) -> [u8; N] {
        let mut dice = self.streams.dice.clone();
        std::array::from_fn(|_| (dice.range(6) + dice.range(6) + 2) as u8)
    }

    #[doc(hidden)]
    pub fn trade_trace_for_test<const N: usize>(&self) -> [u64; N] {
        let mut trade = self.streams.trade.clone();
        std::array::from_fn(|_| trade.next_u64())
    }

    #[doc(hidden)]
    pub fn promote_dev_for_test(&mut self, seat: usize) {
        self.promote_dev(seat);
    }

    #[doc(hidden)]
    pub fn recompute_roads_for_test(
        &mut self,
        topology: &Topology,
        rules: &RuleConfig,
        seats: usize,
    ) {
        self.recompute_all_roads(topology, rules, seats);
    }

    #[doc(hidden)]
    pub fn resolve_seven_for_test(
        &mut self,
        board: &SimBoard,
        topology: &Topology,
        rules: &RuleConfig,
        config: &GameConfig,
        seat: usize,
    ) {
        self.resolve_seven(board, topology, rules, config, seat);
    }

    #[doc(hidden)]
    pub fn produce_for_test(
        &mut self,
        board: &SimBoard,
        topology: &Topology,
        roll: u8,
        seats: usize,
    ) {
        self.produce(board, topology, roll, seats);
    }

    /// Advances the deck cursor as if `count` cards had been drawn, without crediting them to a
    /// seat. Callers building deck-composition states must place the drawn cards themselves
    /// (`dev_plays_revealed`, `playable_dev`, `vp_dev`, ...) to keep the state consistent.
    #[doc(hidden)]
    pub fn drain_dev_deck_for_test(&mut self, count: usize) {
        self.dev_cursor = (self.dev_cursor + count).min(self.dev_len);
    }

    #[doc(hidden)]
    pub fn set_next_dev_for_test(&mut self, kind: usize) {
        let index = (self.dev_cursor..self.dev_len)
            .find(|index| usize::from(self.dev_deck[*index]) == kind)
            .expect("requested card remains in deck");
        self.dev_deck.swap(self.dev_cursor, index);
    }

    #[doc(hidden)]
    pub fn setup_for_test(
        &mut self,
        board: &SimBoard,
        topology: &Topology,
        rules: &RuleConfig,
        config: &GameConfig,
    ) {
        self.setup(board, topology, rules, config, None);
    }

    #[doc(hidden)]
    pub fn setup_pick_for_test(
        &mut self,
        board: &SimBoard,
        topology: &Topology,
        rules: &RuleConfig,
        config: &GameConfig,
        seat: usize,
        grant: bool,
    ) -> Option<Vertex> {
        self.setup_pick(
            board,
            topology,
            rules,
            config,
            seat,
            grant,
            u8::from(grant),
            None,
        )
    }

    pub fn invariants_hold(
        &self,
        board: &SimBoard,
        topology: &Topology,
        rules: &RuleConfig,
    ) -> bool {
        let seats = board.seats();
        for resource in 0..RESOURCE_COUNT {
            let hands: i64 = self.state.players[..seats]
                .iter()
                .map(|player| i64::from(player.resources[resource]))
                .sum();
            if hands < 0
                || hands + i64::from(self.state.bank[resource])
                    != i64::from(rules.bank_supply[resource])
            {
                return false;
            }
        }
        for seat in 0..seats {
            if self.state.players[seat]
                .resources
                .iter()
                .any(|count| *count < 0)
            {
                return false;
            }
            let roads = self.state.edge_owner[..topology.edge_count()]
                .iter()
                .filter(|owner| **owner == seat as u8)
                .count();
            if roads + usize::from(self.state.players[seat].pieces[Buildable::Road.index()])
                != usize::from(self.flattened[seat].limit(Buildable::Road))
            {
                return false;
            }
            let mut buildings = [0_usize; 4];
            let mut public_vp = 0_u16;
            for vertex in 0..topology.vertex_count() {
                if self.state.vertex_owner[vertex] != seat as u8 {
                    continue;
                }
                let buildable = match self.state.vertex_tier[vertex] {
                    1 => Buildable::Settlement,
                    2 => Buildable::City,
                    3 => Buildable::SuperCity,
                    _ => return false,
                };
                buildings[buildable.index()] += 1;
                public_vp += u16::from(self.flattened[seat].vp(buildable));
            }
            for buildable in [Buildable::Settlement, Buildable::City, Buildable::SuperCity] {
                if buildings[buildable.index()]
                    + usize::from(self.state.players[seat].pieces[buildable.index()])
                    != usize::from(self.flattened[seat].limit(buildable))
                {
                    return false;
                }
            }
            if self.state.longest_road.holder == Some(seat) {
                public_vp += u16::from(rules.longest_road_vp);
            }
            if self.state.largest_army == Some(seat) {
                public_vp += u16::from(rules.largest_army_vp);
            }
            if public_vp != u16::from(self.state.players[seat].vp_public) {
                return false;
            }
        }
        // Belief soundness is gated because tests may poke hands without producing public events.
        // A test that pokes a hand should keep its total distinct or use the public test seams.
        if (0..seats)
            .all(|seat| self.state.belief.total(seat) == self.state.players[seat].hand_total())
        {
            for seat in 0..seats {
                if !self
                    .state
                    .belief
                    .contains(seat, &self.state.players[seat].resources)
                {
                    return false;
                }
            }
        }
        true
    }

    fn setup(
        &mut self,
        board: &SimBoard,
        topology: &Topology,
        rules: &RuleConfig,
        config: &GameConfig,
        mut trace: Option<&mut Vec<SetupPick>>,
    ) {
        if !board.buildings().is_empty() {
            self.recompute_all_roads(topology, rules, board.seats());
            return;
        }
        let seats = board.seats();
        for pick in 0..2_u8 {
            if pick == 0 {
                for seat in 0..seats {
                    let _ = self.setup_pick(
                        board,
                        topology,
                        rules,
                        config,
                        seat,
                        false,
                        pick,
                        trace.as_deref_mut(),
                    );
                }
            } else {
                for seat in (0..seats).rev() {
                    let _ = self.setup_pick(
                        board,
                        topology,
                        rules,
                        config,
                        seat,
                        true,
                        pick,
                        trace.as_deref_mut(),
                    );
                }
            }
        }
        // Seed every seat's trail length from the placed stubs so policies never read a stale 0
        // before the game's first road build. Two stubs cannot reach the award minimum, so this
        // can only set lengths, never move the card.
        self.recompute_all_roads(topology, rules, seats);
    }

    fn setup_pick(
        &mut self,
        board: &SimBoard,
        topology: &Topology,
        rules: &RuleConfig,
        config: &GameConfig,
        seat: usize,
        grant: bool,
        pick: u8,
        trace: Option<&mut Vec<SetupPick>>,
    ) -> Option<Vertex> {
        let production = self.production_pips(board, topology, seat);
        let Some((vertex, edge)) = choose(
            config.placements[seat],
            board,
            topology,
            &self.state.vertex_owner,
            &self.state.edge_owner,
            seat as u8,
            &production,
            grant,
            &mut self.streams.policy[seat],
        ) else {
            return None;
        };
        if let Some(trace) = trace {
            trace.push(SetupPick {
                seat: seat as u8,
                pick,
                grant,
                vertex,
                edge,
            });
        }
        self.state.vertex_owner[usize::from(vertex)] = seat as u8;
        self.state.vertex_tier[usize::from(vertex)] = 1;
        self.state.edge_owner[usize::from(edge)] = seat as u8;
        self.state.players[seat].pieces[Buildable::Settlement.index()] -= 1;
        self.state.players[seat].pieces[Buildable::Road.index()] -= 1;
        self.state.players[seat].vp_public += self.flattened[seat].vp(Buildable::Settlement);
        self.refresh_player_rules(board, topology, rules, seat, &config.modifiers[seat]);
        if grant {
            for hex in topology.vertex_hexes(vertex) {
                if let Some(resource) = board.tiles()[usize::from(*hex)] {
                    let index = resource.index();
                    if self.state.bank[index] > 0 {
                        self.state.bank[index] -= 1;
                        self.state.players[seat].resources[index] += 1;
                        self.state.belief.gain(seat, index, 1);
                    }
                }
            }
        }
        Some(vertex)
    }

    fn ask_action(
        &mut self,
        board: &SimBoard,
        topology: &Topology,
        config: &GameConfig,
        seat: usize,
        phase: DecisionPhase,
    ) -> Action {
        let view = DecisionView::new(
            &self.state,
            board,
            topology,
            &self.flattened[seat],
            &self.flattened,
            seat,
            board.seats(),
            (self.dev_len - self.dev_cursor) as u8,
            self.dev_played_this_turn,
            self.offers_remaining(seat),
            phase,
        );
        let selected = policy::action(
            config.policies[seat],
            &view,
            &mut self.scratch[seat],
            &mut self.streams.policy[seat],
        );
        selected
    }

    fn begin_turn(
        &mut self,
        board: &SimBoard,
        topology: &Topology,
        rules: &RuleConfig,
        config: &GameConfig,
        seat: usize,
    ) -> bool {
        self.promote_dev(seat);
        self.dev_played_this_turn = false;
        self.offers_this_turn = 0;
        if self.total_vp(seat) >= rules.win_vp {
            return true;
        }
        self.run_pre_roll(board, topology, rules, config, seat);
        self.total_vp(seat) >= rules.win_vp
    }

    fn offers_remaining(&self, seat: usize) -> u8 {
        self.flattened[seat].trade_config().map_or(0, |config| {
            config
                .max_offers_per_turn
                .saturating_sub(self.offers_this_turn)
        })
    }

    fn run_pre_roll(
        &mut self,
        board: &SimBoard,
        topology: &Topology,
        rules: &RuleConfig,
        config: &GameConfig,
        seat: usize,
    ) {
        let play = {
            let view = DecisionView::new(
                &self.state,
                board,
                topology,
                &self.flattened[seat],
                &self.flattened,
                seat,
                board.seats(),
                (self.dev_len - self.dev_cursor) as u8,
                self.dev_played_this_turn,
                self.offers_remaining(seat),
                DecisionPhase::PreRoll,
            );
            policy::pre_roll(
                config.policies[seat],
                &view,
                &mut self.scratch[seat],
                &mut self.streams.policy[seat],
            )
        };
        if let Some(play) = play {
            self.apply_action_internal(
                board,
                topology,
                rules,
                config,
                seat,
                Action::PlayDev(play),
                DecisionPhase::PreRoll,
            );
        }
    }

    fn resolve_seven(
        &mut self,
        board: &SimBoard,
        topology: &Topology,
        rules: &RuleConfig,
        config: &GameConfig,
        seat: usize,
    ) {
        for player in 0..board.seats() {
            let hand_size: i16 = self.state.players[player].resources.iter().sum();
            if hand_size <= i16::from(rules.discard_threshold) {
                continue;
            }
            let count = (hand_size / 2) as u8;
            let mut discard = {
                let view = DecisionView::new(
                    &self.state,
                    board,
                    topology,
                    &self.flattened[player],
                    &self.flattened,
                    player,
                    board.seats(),
                    (self.dev_len - self.dev_cursor) as u8,
                    self.dev_played_this_turn,
                    self.offers_remaining(player),
                    DecisionPhase::Action,
                );
                policy::discard(
                    config.policies[player],
                    &view,
                    count,
                    &mut self.scratch[player],
                    &mut self.streams.policy[player],
                )
            };
            if !valid_discard(&self.state.players[player].resources, &discard, count) {
                self.illegal_decision("illegal discard");
                discard = legal_default_discard(&self.state.players[player].resources, count);
            }
            for resource in 0..RESOURCE_COUNT {
                self.state.players[player].resources[resource] -= i16::from(discard[resource]);
                self.state.bank[resource] += u16::from(discard[resource]);
                self.state
                    .belief
                    .lose(player, resource, u16::from(discard[resource]));
            }
        }
        let (destination, victim) = {
            let view = DecisionView::new(
                &self.state,
                board,
                topology,
                &self.flattened[seat],
                &self.flattened,
                seat,
                board.seats(),
                (self.dev_len - self.dev_cursor) as u8,
                self.dev_played_this_turn,
                self.offers_remaining(seat),
                DecisionPhase::Action,
            );
            policy::robber(config.policies[seat], &view, &mut self.streams.policy[seat])
        };
        if !self.valid_robber(topology, board.seats(), seat, destination, victim) {
            self.illegal_decision("illegal robber decision");
            // The recovery move must obey the same mandatory-steal rule it just enforced, so name
            // some adjacent victim on the fallback hex (any adjacent seat is nameable) rather than
            // declining the steal outright.
            let fallback = (0..topology.hex_count())
                .map(|hex| hex as u8)
                .find(|hex| *hex != self.state.robber)
                .expect("board has another hex");
            let fallback_victim = (0..board.seats())
                .find(|candidate| self.nameable_victim(topology, seat, fallback, *candidate as u8));
            self.move_robber_and_steal(topology, seat, fallback, fallback_victim);
        } else {
            self.move_robber_and_steal(topology, seat, destination, victim.map(usize::from));
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn resolve_player_trade(
        &mut self,
        board: &SimBoard,
        topology: &Topology,
        rules: &RuleConfig,
        config: &GameConfig,
        proposer: usize,
        give: Resource,
        get: Resource,
        count: u8,
    ) {
        let mut embargoes = [false; MAX_SEATS];
        for (seat, value) in embargoes.iter_mut().enumerate().take(board.seats()) {
            let view = DecisionView::new(
                &self.state,
                board,
                topology,
                &self.flattened[seat],
                &self.flattened,
                seat,
                board.seats(),
                (self.dev_len - self.dev_cursor) as u8,
                self.dev_played_this_turn,
                self.offers_remaining(seat),
                DecisionPhase::TradeResponse,
            );
            *value = embargoed(&view, seat);
        }
        if embargoes[proposer] {
            return;
        }

        let offer = TradeOffer {
            proposer,
            give,
            get,
            count,
        };
        let mut acceptors = [0_usize; MAX_SEATS];
        let mut acceptor_count = 0;
        for responder in 0..board.seats() {
            if responder == proposer
                || embargoes[responder]
                || self.state.players[responder].resources[get.index()] < 1
            {
                continue;
            }
            let accepted = {
                let view = DecisionView::new(
                    &self.state,
                    board,
                    topology,
                    &self.flattened[responder],
                    &self.flattened,
                    responder,
                    board.seats(),
                    (self.dev_len - self.dev_cursor) as u8,
                    self.dev_played_this_turn,
                    self.offers_remaining(responder),
                    DecisionPhase::TradeResponse,
                );
                policy::respond_trade(
                    config.policies[responder],
                    &view,
                    offer,
                    &mut self.streams.trade,
                )
            };
            if accepted {
                acceptors[acceptor_count] = responder;
                acceptor_count += 1;
            }
        }
        if acceptor_count == 0 {
            return;
        }
        let selection_view = DecisionView::new(
            &self.state,
            board,
            topology,
            &self.flattened[proposer],
            &self.flattened,
            proposer,
            board.seats(),
            (self.dev_len - self.dev_cursor) as u8,
            self.dev_played_this_turn,
            self.offers_remaining(proposer),
            DecisionPhase::TradeResponse,
        );
        let delta = policy::trading::responder_delta(offer);
        let selected = policy::select_counterparty(
            config.policies[proposer],
            &selection_view,
            &delta,
            &acceptors[..acceptor_count],
        );
        let (proposer_hand, responder_hand) = if proposer < selected {
            let (left, right) = self.state.players.split_at_mut(selected);
            (&mut left[proposer].resources, &mut right[0].resources)
        } else {
            let (left, right) = self.state.players.split_at_mut(proposer);
            (&mut right[0].resources, &mut left[selected].resources)
        };
        let applied = trade_players(proposer_hand, responder_hand, give, get, count);
        debug_assert!(applied);
        self.state
            .belief
            .lose(proposer, give.index(), u16::from(count));
        self.state.belief.gain(proposer, get.index(), 1);
        self.state
            .belief
            .gain(selected, give.index(), u16::from(count));
        self.state.belief.lose(selected, get.index(), 1);
        debug_assert!(self.invariants_hold(board, topology, rules));
    }

    #[allow(clippy::too_many_arguments)]
    fn apply_action_internal(
        &mut self,
        board: &SimBoard,
        topology: &Topology,
        rules: &RuleConfig,
        config: &GameConfig,
        seat: usize,
        action: Action,
        phase: DecisionPhase,
    ) -> bool {
        if !self.validate_action(board, topology, seat, action, phase) {
            self.illegal_decision("illegal policy action");
            return false;
        }
        match action {
            Action::BuildRoad(edge) => {
                self.pay_cost(seat, Buildable::Road);
                self.build_road(topology, rules, board.seats(), seat, edge);
            }
            Action::BuildSettlement(vertex) => {
                self.pay_cost(seat, Buildable::Settlement);
                self.build_settlement(board, topology, rules, config, seat, vertex);
            }
            Action::UpgradeCity(vertex) => {
                self.pay_cost(seat, Buildable::City);
                self.upgrade_city(seat, vertex);
            }
            Action::BuyDev => self.buy_dev(seat),
            Action::TradeBank { give, get, count } => {
                let rate = self.flattened[seat].trade_rate(give);
                let applied = trade_bank(
                    &mut self.state.players[seat].resources,
                    &mut self.state.bank,
                    give,
                    get,
                    rate,
                    count,
                );
                debug_assert!(applied);
                let given = rate
                    .saturating_mul(u32::from(count))
                    .min(u32::from(u16::MAX)) as u16;
                self.state.belief.lose(seat, give.index(), given);
                self.state.belief.gain(seat, get.index(), u16::from(count));
            }
            Action::OfferTrade { give, get, count } => {
                self.offers_this_turn = self.offers_this_turn.saturating_add(1);
                self.resolve_player_trade(board, topology, rules, config, seat, give, get, count);
            }
            Action::PlayDev(play) => {
                self.apply_dev_play(board, topology, rules, config, seat, play);
            }
            Action::Pass => return false,
        }
        true
    }

    fn validate_dev_play(&self, view: &DecisionView<'_>, play: DevPlay) -> bool {
        if !view.can_play_dev(play.kind_index()) {
            return false;
        }
        match play {
            DevPlay::Knight {
                destination,
                victim,
            } => self.valid_robber(
                view.topology(),
                view.seats(),
                view.observer(),
                destination,
                victim,
            ),
            DevPlay::RoadBuilding { first, second } => {
                first.is_none_or(|edge| view.legal_road(edge))
                    && second.is_none_or(|edge| {
                        first.is_some_and(|first| view.legal_road_after(first, edge))
                    })
            }
            DevPlay::YearOfPlenty { first, second } => {
                let first_available = view.bank(first) > 0;
                let second_needed = u16::from(first == second) + 1;
                first_available && view.bank(second) >= second_needed
            }
            DevPlay::Monopoly { .. } => true,
        }
    }

    fn apply_dev_play(
        &mut self,
        board: &SimBoard,
        topology: &Topology,
        rules: &RuleConfig,
        config: &GameConfig,
        seat: usize,
        play: DevPlay,
    ) {
        let kind = play.kind_index();
        self.state.players[seat].playable_dev[kind] -= 1;
        self.state.players[seat].dev_plays_revealed[kind] += 1;
        self.dev_played_this_turn = true;
        match play {
            DevPlay::Knight {
                destination,
                victim,
            } => {
                self.state.players[seat].knights_played += 1;
                self.move_robber_and_steal(topology, seat, destination, victim.map(usize::from));
                let before = self.state.largest_army;
                let armies: [u8; MAX_SEATS] =
                    std::array::from_fn(|index| self.state.players[index].knights_played);
                update_largest_army(
                    &mut self.state.largest_army,
                    &armies,
                    rules.largest_army_min,
                );
                if before != self.state.largest_army {
                    self.adjust_holder_vp(before, self.state.largest_army, rules.largest_army_vp);
                }
            }
            DevPlay::RoadBuilding { first, second } => {
                for edge in [first, second].into_iter().flatten() {
                    if self.state.players[seat].pieces[Buildable::Road.index()] == 0 {
                        break;
                    }
                    if can_build_road(
                        topology,
                        &self.state.vertex_owner,
                        &self.state.edge_owner,
                        seat as u8,
                        edge,
                        self.state.players[seat].pieces[Buildable::Road.index()],
                    ) {
                        self.build_road(topology, rules, board.seats(), seat, edge);
                    }
                }
            }
            DevPlay::YearOfPlenty { first, second } => {
                for resource in [first, second] {
                    let index = resource.index();
                    if self.state.bank[index] > 0 {
                        self.state.bank[index] -= 1;
                        self.state.players[seat].resources[index] += 1;
                        self.state.belief.gain(seat, index, 1);
                    }
                }
            }
            DevPlay::Monopoly { resource } => {
                let index = resource.index();
                let mut total_taken = 0_u16;
                for other in 0..board.seats() {
                    if other == seat {
                        continue;
                    }
                    let count = self.state.players[other].resources[index];
                    let public_count = u16::try_from(count).unwrap_or(0);
                    self.state.belief.reveal_exact(other, index, public_count);
                    self.state.players[other].resources[index] = 0;
                    self.state.players[seat].resources[index] += count;
                    if public_count > 0 {
                        self.state.belief.lose(other, index, public_count);
                    }
                    total_taken = total_taken.saturating_add(public_count);
                }
                self.state.belief.gain(seat, index, total_taken);
            }
        }
        let _ = config;
    }

    fn buy_dev(&mut self, seat: usize) {
        let cost = *self.flattened[seat].dev_cost();
        self.pay_vector(seat, &cost);
        let kind = usize::from(self.dev_deck[self.dev_cursor]);
        self.dev_cursor += 1;
        if kind == DEV_VP {
            self.state.players[seat].vp_dev += 1;
        } else {
            self.state.players[seat].bought_dev[kind] += 1;
        }
    }

    fn promote_dev(&mut self, seat: usize) {
        let player = &mut self.state.players[seat];
        for kind in 0..player.playable_dev.len() {
            player.playable_dev[kind] += player.bought_dev[kind];
            player.bought_dev[kind] = 0;
        }
    }

    fn produce(
        &mut self,
        board: &SimBoard,
        topology: &Topology,
        roll: u8,
        seats: usize,
    ) {
        let mut demand = [[0_u8; RESOURCE_COUNT]; MAX_SEATS];
        for hex_index in 0..topology.hex_count() {
            let hex = hex_index as Hex;
            if hex == self.state.robber || board.tokens()[hex_index] != Some(roll) {
                continue;
            }
            let Some(resource) = board.tiles()[hex_index] else {
                continue;
            };
            for vertex in topology.hex_vertices(hex) {
                let owner = self.state.vertex_owner[usize::from(*vertex)];
                if owner != EMPTY {
                    let buildable = match self.state.vertex_tier[usize::from(*vertex)] {
                        1 => Buildable::Settlement,
                        2 => Buildable::City,
                        3 => Buildable::SuperCity,
                        _ => continue,
                    };
                    demand[usize::from(owner)][resource.index()] +=
                        self.flattened[usize::from(owner)].yield_multiplier(buildable);
                }
            }
        }
        let mut hands = std::array::from_fn(|seat| self.state.players[seat].resources);
        apply_production(&mut self.state.bank, &mut hands, &demand, seats);
        for (seat, hand) in hands.into_iter().enumerate().take(seats) {
            for resource in 0..RESOURCE_COUNT {
                let delta = hand[resource] - self.state.players[seat].resources[resource];
                if let Ok(delta) = u16::try_from(delta) {
                    if delta > 0 {
                        self.state.belief.gain(seat, resource, delta);
                    }
                }
            }
            self.state.players[seat].resources = hand;
        }
    }

    fn valid_robber(
        &self,
        topology: &Topology,
        seats: usize,
        seat: usize,
        destination: Hex,
        victim: Option<u8>,
    ) -> bool {
        if usize::from(destination) >= topology.hex_count() || destination == self.state.robber {
            return false;
        }
        match victim {
            Some(victim) => {
                usize::from(victim) < seats
                    && self.nameable_victim(topology, seat, destination, victim)
            }
            // Stealing is mandatory when the destination touches anyone holding a card; declining
            // outright is legal only when nobody adjacent could yield one. Naming an adjacent
            // empty-handed seat is always legal and steals nothing -- that is how the rules let a
            // player decline a steal.
            None => !(0..seats).any(|candidate| {
                self.nameable_victim(topology, seat, destination, candidate as u8)
                    && self.state.players[candidate].hand_size() > 0
            }),
        }
    }

    /// Whether `candidate` can be named as the robber victim at `destination`: a different seat,
    /// present on the hex. Hand size is deliberately not checked -- naming an empty-handed seat is
    /// the rules' decline mechanism. This is the single definition of "nameable"; the policies'
    /// `DecisionView::victim_on_hex` must agree with it, and `DecisionView::stealable_on_hex` must
    /// agree with the mandatory-steal clause above, or a legal decision becomes an illegal action.
    fn nameable_victim(
        &self,
        topology: &Topology,
        seat: usize,
        destination: Hex,
        candidate: u8,
    ) -> bool {
        usize::from(candidate) != seat
            && topology
                .hex_vertices(destination)
                .iter()
                .any(|vertex| self.state.vertex_owner[usize::from(*vertex)] == candidate)
    }

    fn move_robber_and_steal(
        &mut self,
        topology: &Topology,
        seat: usize,
        destination: Hex,
        victim: Option<usize>,
    ) {
        self.state.robber = destination;
        let Some(victim) = victim else {
            return;
        };
        debug_assert!(
            topology
                .hex_vertices(destination)
                .iter()
                .any(|vertex| { self.state.vertex_owner[usize::from(*vertex)] == victim as u8 })
        );
        let total: i16 = self.state.players[victim].resources.iter().sum();
        if total <= 0 {
            return;
        }
        self.state.belief.steal(seat, victim);
        let mut draw = self.streams.chance.range(total as u32) as i16;
        for resource in 0..RESOURCE_COUNT {
            let count = self.state.players[victim].resources[resource];
            if draw < count {
                self.state.players[victim].resources[resource] -= 1;
                self.state.players[seat].resources[resource] += 1;
                return;
            }
            draw -= count;
        }
    }

    fn build_road(
        &mut self,
        topology: &Topology,
        rules: &RuleConfig,
        seats: usize,
        seat: usize,
        edge: Edge,
    ) {
        self.state.edge_owner[usize::from(edge)] = seat as u8;
        self.state.players[seat].pieces[Buildable::Road.index()] -= 1;
        // A road cannot shorten a rival's trail and setup() seeds every seat's length, so
        // recomputing only the builder would be sound; narrowing this all-seat recompute is a
        // pure performance change, deliberately not bundled with a behavior fix.
        self.recompute_all_roads(topology, rules, seats);
    }

    fn build_settlement(
        &mut self,
        board: &SimBoard,
        topology: &Topology,
        rules: &RuleConfig,
        config: &GameConfig,
        seat: usize,
        vertex: Vertex,
    ) {
        self.state.vertex_owner[usize::from(vertex)] = seat as u8;
        self.state.vertex_tier[usize::from(vertex)] = 1;
        self.state.players[seat].pieces[Buildable::Settlement.index()] -= 1;
        self.state.players[seat].vp_public += self.flattened[seat].vp(Buildable::Settlement);
        self.refresh_player_rules(board, topology, rules, seat, &config.modifiers[seat]);
        self.recompute_all_roads(topology, rules, board.seats());
    }

    fn upgrade_city(&mut self, seat: usize, vertex: Vertex) {
        self.state.vertex_tier[usize::from(vertex)] = 2;
        self.state.players[seat].pieces[Buildable::City.index()] -= 1;
        self.state.players[seat].pieces[Buildable::Settlement.index()] += 1;
        self.state.players[seat].vp_public += self.flattened[seat]
            .vp(Buildable::City)
            .saturating_sub(self.flattened[seat].vp(Buildable::Settlement));
    }

    fn pay_cost(&mut self, seat: usize, buildable: Buildable) {
        let cost = self.flattened[seat]
            .costs(buildable)
            .iter()
            .find(|cost| can_pay(&self.state.players[seat].resources, cost))
            .copied()
            .expect("affordability checked");
        self.pay_vector(seat, &cost);
    }

    fn pay_vector(&mut self, seat: usize, cost: &[u8; RESOURCE_COUNT]) {
        for resource in 0..RESOURCE_COUNT {
            self.state.players[seat].resources[resource] -= i16::from(cost[resource]);
            self.state.bank[resource] += u16::from(cost[resource]);
            self.state
                .belief
                .lose(seat, resource, u16::from(cost[resource]));
        }
    }

    fn production_pips(
        &self,
        board: &SimBoard,
        topology: &Topology,
        seat: usize,
    ) -> [u16; RESOURCE_COUNT] {
        placement::production_pips(
            board,
            topology,
            &self.state.vertex_owner,
            Some(&self.state.vertex_tier),
            seat as u8,
        )
    }

    fn recompute_all_roads(&mut self, topology: &Topology, rules: &RuleConfig, seats: usize) {
        for seat in 0..seats {
            self.state.players[seat].longest_road_len = self.road_length(topology, seat);
        }
        self.award_road_card(rules, seats);
    }

    fn road_length(&self, topology: &Topology, seat: usize) -> u8 {
        RoadNetwork::for_seat(
            topology,
            &self.state.vertex_owner,
            &self.state.edge_owner,
            seat as u8,
        )
        .base_length()
    }

    fn award_road_card(&mut self, rules: &RuleConfig, seats: usize) {
        let before = self.state.longest_road.holder;
        let lengths: [u8; MAX_SEATS] =
            std::array::from_fn(|seat| self.state.players[seat].longest_road_len);
        update_road_card(
            &mut self.state.longest_road,
            &lengths[..seats],
            rules.longest_road_min,
        );
        let after = self.state.longest_road.holder;
        if before != after {
            self.adjust_holder_vp(before, after, rules.longest_road_vp);
        }
    }

    fn adjust_holder_vp(&mut self, before: Option<usize>, after: Option<usize>, amount: u8) {
        if let Some(seat) = before {
            self.state.players[seat].vp_public =
                self.state.players[seat].vp_public.saturating_sub(amount);
        }
        if let Some(seat) = after {
            self.state.players[seat].vp_public += amount;
        }
    }

    fn total_vp(&self, seat: usize) -> u8 {
        self.state.players[seat].vp_public + self.state.players[seat].vp_dev
    }

    fn illegal_decision(&mut self, message: &str) {
        if cfg!(debug_assertions) {
            panic!("{message}");
        }
        self.illegal_actions += 1;
    }
}

pub fn setup_order(seats: usize) -> Vec<u8> {
    (0..seats)
        .chain((0..seats).rev())
        .map(|seat| seat as u8)
        .collect()
}

pub fn can_place_settlement(topology: &Topology, owners: &[u8], vertex: Vertex) -> bool {
    owners[usize::from(vertex)] == EMPTY
        && topology
            .vertex_adjacent(vertex)
            .iter()
            .all(|adjacent| owners[usize::from(*adjacent)] == EMPTY)
}

pub fn can_build_road(
    topology: &Topology,
    vertex_owner: &[u8],
    edge_owner: &[u8],
    seat: u8,
    edge: Edge,
    pieces_left: u8,
) -> bool {
    if edge_owner[usize::from(edge)] != EMPTY || pieces_left == 0 {
        return false;
    }
    topology.edge_endpoints(edge).iter().any(|endpoint| {
        let owner = vertex_owner[usize::from(*endpoint)];
        owner == seat
            || (owner == EMPTY
                && topology
                    .vertex_edges(*endpoint)
                    .iter()
                    .any(|incident| edge_owner[usize::from(*incident)] == seat))
    })
}

pub fn apply_production(
    bank: &mut [u16; RESOURCE_COUNT],
    hands: &mut [[i16; RESOURCE_COUNT]; MAX_SEATS],
    demand: &[[u8; RESOURCE_COUNT]; MAX_SEATS],
    seats: usize,
) {
    for resource in 0..RESOURCE_COUNT {
        let entitled = (0..seats)
            .filter(|seat| demand[*seat][resource] > 0)
            .count();
        let total: u16 = (0..seats)
            .map(|seat| u16::from(demand[seat][resource]))
            .sum();
        if entitled > 1 && total > bank[resource] {
            continue;
        }
        if entitled == 1 && total > bank[resource] {
            let seat = (0..seats)
                .find(|seat| demand[*seat][resource] > 0)
                .expect("one entitled player");
            hands[seat][resource] += bank[resource] as i16;
            bank[resource] = 0;
            continue;
        }
        for seat in 0..seats {
            let amount = u16::from(demand[seat][resource]);
            hands[seat][resource] += i16::from(demand[seat][resource]);
            bank[resource] -= amount;
        }
    }
}

pub fn trade_bank(
    hand: &mut [i16; RESOURCE_COUNT],
    bank: &mut [u16; RESOURCE_COUNT],
    give: Resource,
    get: Resource,
    rate: u32,
    count: u8,
) -> bool {
    if give == get || count == 0 {
        return false;
    }
    let offered = u64::from(rate) * u64::from(count);
    if offered > i16::MAX as u64
        || i64::from(hand[give.index()]) < offered as i64
        || bank[get.index()] < u16::from(count)
    {
        return false;
    }
    hand[give.index()] -= offered as i16;
    hand[get.index()] += i16::from(count);
    bank[give.index()] = bank[give.index()].saturating_add(offered.min(u64::from(u16::MAX)) as u16);
    bank[get.index()] -= u16::from(count);
    true
}

pub fn trade_players(
    proposer: &mut [i16; RESOURCE_COUNT],
    responder: &mut [i16; RESOURCE_COUNT],
    give: Resource,
    get: Resource,
    count: u8,
) -> bool {
    if give == get
        || (count != 1 && count != 2)
        || proposer[give.index()] < i16::from(count)
        || responder[get.index()] < 1
    {
        return false;
    }
    proposer[give.index()] -= i16::from(count);
    responder[give.index()] += i16::from(count);
    responder[get.index()] -= 1;
    proposer[get.index()] += 1;
    true
}

pub fn update_largest_army(holder: &mut Option<usize>, armies: &[u8], minimum: u8) {
    // Same rule as Longest Road, so it shares the same implementation: previously `max_by_key`
    // handed the card to whichever tied seat sorted last instead of leaving it unheld.
    *holder = leading_holder(*holder, armies, minimum);
}

fn valid_discard(hand: &[i16; RESOURCE_COUNT], discard: &[u8; RESOURCE_COUNT], count: u8) -> bool {
    discard.iter().sum::<u8>() == count
        && discard
            .iter()
            .enumerate()
            .all(|(resource, value)| i16::from(*value) <= hand[resource])
}

fn legal_default_discard(hand: &[i16; RESOURCE_COUNT], count: u8) -> [u8; RESOURCE_COUNT] {
    let mut remaining = *hand;
    let mut discard = [0; RESOURCE_COUNT];
    for _ in 0..count {
        let resource = (0..RESOURCE_COUNT)
            .max_by_key(|resource| remaining[*resource])
            .expect("resource set is non-empty");
        remaining[resource] -= 1;
        discard[resource] += 1;
    }
    discard
}

const fn buildable_for(tier: crate::wire::BuildingTier) -> Buildable {
    match tier {
        crate::wire::BuildingTier::Settlement => Buildable::Settlement,
        crate::wire::BuildingTier::City => Buildable::City,
        crate::wire::BuildingTier::SuperCity => Buildable::SuperCity,
    }
}
