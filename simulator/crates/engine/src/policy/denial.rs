//! Threat-aware denial and positional competition.
//!
//! The parameter defaults are unswept Phase-H placeholders.

use std::cell::Cell;

use serde::{Deserialize, Serialize};

use crate::etw;
use crate::policy::params_file::check;
use crate::policy::threat;
use crate::rules::Buildable;
use crate::state::MAX_SEATS;
use crate::view::DecisionView;

/// Upper bound on exact Longest Road race checks per decision: every rival in the largest
/// layout. The budget a decision actually spends is `DenialParams::race_check_cap`.
pub const MAX_RACE_CHECKS: u8 = (MAX_SEATS - 1) as u8;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct DenialParams {
    pub danger_floor: f64,
    pub pressure_floor: f32,
    pub pressure_span: f32,
    pub race_bonus: f32,
    pub race_danger_min: f64,
    /// Exact `road_takes_longest_road` checks allowed per decision, spent in danger order. The
    /// default covers every rival in the largest layout; two restores the pre-SIM-GAP-07 budget
    /// whose third-rival blind spot that gap recorded.
    pub race_check_cap: u8,
    pub defend_weight: f32,
    pub defend_headroom_half: f32,
    pub defend_probe_slack: u8,
    pub contest_weight: f32,
    pub contest_cap: f32,
    /// Multiplier on a rival's contest contribution when the candidate edge is that rival's only
    /// remaining approach to the contested vertex, so the block itself is priced and not just the
    /// race to settle first (SIM-GAP-08). Zero restores blocking-blind contesting.
    pub contest_block_bonus: f32,
    pub contest_goal_share: f32,
    pub army_defend_weight: f32,
    pub army_gap_half: f32,
}

impl Default for DenialParams {
    fn default() -> Self {
        Self {
            danger_floor: 1.0,
            pressure_floor: 0.55,
            pressure_span: 0.85,
            race_bonus: 0.5,
            race_danger_min: 0.25,
            race_check_cap: MAX_RACE_CHECKS,
            defend_weight: 12_000.0,
            defend_headroom_half: 1.0,
            defend_probe_slack: 2,
            contest_weight: 60.0,
            contest_cap: 120.0,
            contest_block_bonus: 0.5,
            contest_goal_share: 0.5,
            army_defend_weight: 80.0,
            army_gap_half: 1.0,
        }
    }
}

pub struct DenialContext {
    danger: [f64; MAX_SEATS],
    top_danger: f64,
    lr_challenger: Cell<Option<Option<(usize, f64)>>>,
    race_checks: Cell<u8>,
    la_challenger: Option<(usize, f64, u8)>,
    one_step: [Cell<Option<u128>>; MAX_SEATS],
}

impl DenialContext {
    pub fn danger(&self, seat: usize) -> f64 {
        self.danger[seat]
    }

    pub fn largest_army_challenger(&self) -> Option<(usize, f64, u8)> {
        self.la_challenger
    }

    pub fn longest_road_challenger(&self) -> Option<(usize, f64)> {
        self.lr_challenger.get().flatten()
    }

    pub fn race_checks(&self) -> u8 {
        self.race_checks.get()
    }

    pub fn top_danger(&self) -> f64 {
        self.top_danger
    }

    fn one_step(&self, view: &DecisionView<'_>, seat: usize) -> u128 {
        if let Some(cached) = self.one_step[seat].get() {
            return cached;
        }
        #[cfg(test)]
        record_one_step_scan(seat);
        let computed = view.compute_one_step(seat);
        self.one_step[seat].set(Some(computed));
        computed
    }
}

pub fn army_defend_term(ctx: &DenialContext, params: &DenialParams) -> Option<f32> {
    assert_params(params);
    let (_, danger, gap) = ctx.la_challenger?;
    let headroom = params.army_gap_half / (params.army_gap_half + f32::from(gap));
    Some(
        params.army_defend_weight
            * (params.pressure_floor + params.pressure_span * danger as f32)
            * headroom,
    )
}

pub fn contest_term(
    view: &DecisionView<'_>,
    ctx: &DenialContext,
    params: &DenialParams,
    edge: u8,
) -> f32 {
    assert_params(params);
    let mut maximum = 0.0_f64;
    for target in view.topology().edge_endpoints(edge) {
        if !view.is_expansion_target(target) {
            continue;
        }
        for seat in 0..view.seats() {
            if seat == view.observer()
                || view.pieces(seat, Buildable::Settlement) == 0
                || ctx.one_step(view, seat) & (1 << target) == 0
            {
                continue;
            }
            // Blocking is priced, not just the race to settle first (SIM-GAP-08): a one-road
            // approach to `target` must come through an edge incident to it, so when every other
            // incident edge is illegal for this rival, building the candidate removes the vertex
            // from their one-road *build* reach. A rival that already owns an incident edge is
            // never blocked: its road network touches the vertex, so it settles there with no
            // new road whatever the observer builds. An owned edge is not legal to build, so
            // that rival would otherwise pass the legality half of the predicate.
            let blocks = view.topology().vertex_edges(target).iter().all(|approach| {
                view.edge_owner(*approach) != Some(seat as u8)
                    && (*approach == edge || !view.legal_road_for(seat, *approach))
            });
            let scale = if blocks {
                1.0 + f64::from(params.contest_block_bonus)
            } else {
                1.0
            };
            maximum = maximum.max(ctx.danger[seat] * scale);
        }
    }
    (params.contest_weight * maximum as f32).min(params.contest_cap)
}

pub fn context(view: &DecisionView<'_>, params: &DenialParams) -> DenialContext {
    assert_params(params);
    let mut danger = [0.0; MAX_SEATS];
    let mut top_danger = 0.0_f64;
    for (seat, seat_danger) in danger.iter_mut().enumerate().take(view.seats()) {
        if seat == view.observer() {
            continue;
        }
        *seat_danger = threat::danger_from_etw(etw::etw_for_seat(view, seat), params.danger_floor);
        top_danger = top_danger.max(*seat_danger);
    }
    let la_challenger = largest_army_challenger(view, params, &danger);
    let result = DenialContext {
        danger,
        top_danger,
        lr_challenger: Cell::new(None),
        race_checks: Cell::new(0),
        la_challenger,
        one_step: [const { Cell::new(None) }; MAX_SEATS],
    };
    let challenger = resolve_longest_road_challenger(view, &result, params);
    result.lr_challenger.set(Some(challenger));
    result
}

pub fn defend_term(
    view: &DecisionView<'_>,
    ctx: &DenialContext,
    params: &DenialParams,
    new_length: u8,
) -> Option<(f32, f32)> {
    assert_params(params);
    let (_, danger) = should_defend(ctx)?;
    let current = view.longest_road_len(view.observer());
    let gain = new_length
        .min(defend_probe_cap(current, params))
        .saturating_sub(current);
    if gain == 0 {
        return None;
    }
    let gain = f32::from(gain);
    let headroom = gain / (gain + params.defend_headroom_half);
    let pressure =
        (params.pressure_floor + params.pressure_span * danger as f32) * (1.0 + params.race_bonus);
    Some((
        params.defend_weight * pressure * headroom,
        (30.0 + 10.0 * crate::policy::heuristic_v1::win_proximity(view)) * pressure * headroom,
    ))
}

pub fn defend_probe_cap(current: u8, params: &DenialParams) -> u8 {
    assert_params(params);
    current.saturating_add(params.defend_probe_slack)
}

pub fn pressure(ctx: &DenialContext, params: &DenialParams, holder: Option<usize>) -> f32 {
    assert_params(params);
    let target_danger = holder.map_or(ctx.top_danger, |seat| ctx.danger[seat]);
    let race = if ctx.longest_road_challenger().is_some() {
        1.0 + params.race_bonus
    } else {
        1.0
    };
    (params.pressure_floor + params.pressure_span * target_danger as f32) * race
}

pub fn should_defend(ctx: &DenialContext) -> Option<(usize, f64)> {
    ctx.longest_road_challenger()
}

/// The `assert_params` domain, spelled as load-time errors (JSON field names) so the H0
/// params-file loader rejects a bad vector instead of tripping a debug assert mid-run.
pub(crate) fn validate(params: &DenialParams) -> Result<(), String> {
    check(
        "denial.dangerFloor is positive and finite",
        params.danger_floor.is_finite() && params.danger_floor > 0.0,
    )?;
    check(
        "denial.pressureFloor is non-negative and finite",
        params.pressure_floor.is_finite() && params.pressure_floor >= 0.0,
    )?;
    check(
        "denial.pressureSpan is non-negative and finite",
        params.pressure_span.is_finite() && params.pressure_span >= 0.0,
    )?;
    check(
        "denial.raceBonus is non-negative and finite",
        params.race_bonus.is_finite() && params.race_bonus >= 0.0,
    )?;
    check(
        "denial.raceDangerMin lies in [0, 1]",
        params.race_danger_min.is_finite() && (0.0..=1.0).contains(&params.race_danger_min),
    )?;
    check(
        "denial.raceCheckCap lies in 1..=5",
        (1..=MAX_RACE_CHECKS).contains(&params.race_check_cap),
    )?;
    check(
        "denial.defendWeight is non-negative and finite",
        params.defend_weight.is_finite() && params.defend_weight >= 0.0,
    )?;
    check(
        "denial.defendHeadroomHalf is positive and finite",
        params.defend_headroom_half.is_finite() && params.defend_headroom_half > 0.0,
    )?;
    check(
        "denial.defendProbeSlack lies in 1..=4",
        (1..=4).contains(&params.defend_probe_slack),
    )?;
    check(
        "denial.contestWeight is non-negative and finite",
        params.contest_weight.is_finite() && params.contest_weight >= 0.0,
    )?;
    check(
        "denial.contestCap is non-negative and finite",
        params.contest_cap.is_finite() && params.contest_cap >= 0.0,
    )?;
    check(
        "denial.contestBlockBonus is non-negative and finite",
        params.contest_block_bonus.is_finite() && params.contest_block_bonus >= 0.0,
    )?;
    check(
        "denial.contestGoalShare is non-negative and finite",
        params.contest_goal_share.is_finite() && params.contest_goal_share >= 0.0,
    )?;
    check(
        "denial.armyDefendWeight is non-negative and finite",
        params.army_defend_weight.is_finite() && params.army_defend_weight >= 0.0,
    )?;
    check(
        "denial.armyGapHalf is positive and finite",
        params.army_gap_half.is_finite() && params.army_gap_half > 0.0,
    )
}

pub fn assert_params(params: &DenialParams) {
    debug_assert_eq!(validate(params), Ok(()));
}

fn largest_army_challenger(
    view: &DecisionView<'_>,
    params: &DenialParams,
    danger: &[f64; MAX_SEATS],
) -> Option<(usize, f64, u8)> {
    if view.largest_army_holder() != Some(view.observer()) {
        return None;
    }
    let observer_count = view.knights_played(view.observer());
    let mut best = None;
    let mut best_contribution = f32::NEG_INFINITY;
    for (seat, seat_danger) in danger.iter().copied().enumerate().take(view.seats()) {
        if seat == view.observer() {
            continue;
        }
        let target = view
            .largest_army_min()
            .max(observer_count.saturating_add(1));
        let gap = target.saturating_sub(view.knights_played(seat));
        let headroom = params.army_gap_half / (params.army_gap_half + f32::from(gap));
        let contribution =
            (params.pressure_floor + params.pressure_span * seat_danger as f32) * headroom;
        if contribution > best_contribution {
            best = Some((seat, seat_danger, gap));
            best_contribution = contribution;
        }
    }
    best
}

fn resolve_longest_road_challenger(
    view: &DecisionView<'_>,
    ctx: &DenialContext,
    params: &DenialParams,
) -> Option<(usize, f64)> {
    let mut ranked = [usize::MAX; MAX_SEATS];
    let mut count = 0;
    for seat in 0..view.seats() {
        if seat == view.observer() || view.longest_road_holder() == Some(seat) {
            continue;
        }
        let mut position = count;
        while position > 0 && ctx.danger[ranked[position - 1]] < ctx.danger[seat] {
            ranked[position] = ranked[position - 1];
            position -= 1;
        }
        ranked[position] = seat;
        count += 1;
    }
    for seat in ranked.into_iter().take(count) {
        if ctx.danger[seat] < params.race_danger_min {
            continue;
        }
        let best_other_len = (0..view.seats())
            .filter(|other| *other != seat)
            .map(|other| view.longest_road_len(other))
            .max()
            .unwrap_or_default();
        let required = view
            .longest_road_min()
            .max(best_other_len.saturating_add(1));
        if view.compute_road_count(seat).saturating_add(1) < required {
            continue;
        }
        if ctx.race_checks.get() >= params.race_check_cap {
            break;
        }
        ctx.race_checks.set(ctx.race_checks.get().saturating_add(1));
        #[cfg(test)]
        record_exact_check();
        if view.road_takes_longest_road(seat) {
            return Some((seat, ctx.danger[seat]));
        }
    }
    None
}

#[cfg(test)]
thread_local! {
    static EXACT_CHECKS: Cell<u8> = const { Cell::new(0) };
    static ONE_STEP_SCANS: Cell<[u8; MAX_SEATS]> = const { Cell::new([0; MAX_SEATS]) };
    static ROAD_NETWORK_BUILDS: Cell<u32> = const { Cell::new(0) };
}

#[cfg(test)]
pub(crate) fn record_road_network_build() {
    ROAD_NETWORK_BUILDS.with(|count| count.set(count.get().saturating_add(1)));
}

#[cfg(test)]
fn record_exact_check() {
    EXACT_CHECKS.with(|count| count.set(count.get().saturating_add(1)));
}

#[cfg(test)]
fn record_one_step_scan(seat: usize) {
    ONE_STEP_SCANS.with(|counts| {
        let mut next = counts.get();
        next[seat] = next[seat].saturating_add(1);
        counts.set(next);
    });
}

#[cfg(test)]
mod tests {
    use std::cell::Cell;
    use std::collections::HashSet;
    use std::fs;
    use std::path::PathBuf;
    use std::sync::Mutex;

    use super::{
        DenialParams, EXACT_CHECKS, MAX_RACE_CHECKS, ONE_STEP_SCANS, ROAD_NETWORK_BUILDS,
        contest_term, context, pressure,
    };
    use crate::board::{ConversionOptions, SimBoard};
    use crate::game::{GameArena, GameConfig};
    use crate::longest_road::RoadCard;
    use crate::policy::heuristic_v1::{self, HeuristicParams};
    use crate::policy::{PolicyKind, PolicyScratch};
    use crate::rules::{Buildable, RuleConfig};
    use crate::topology::{Edge, Layout, Topology, Vertex};
    use crate::view::DecisionPhase;
    use crate::wire::WireBoard;

    static DENIAL_TEST_LOCK: Mutex<()> = Mutex::new(());

    fn denial_test_lock() -> std::sync::MutexGuard<'static, ()> {
        DENIAL_TEST_LOCK
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    fn fixture() -> (Topology, SimBoard, RuleConfig, GameConfig, GameArena) {
        let topology = Topology::load(Layout::Extension6).unwrap();
        let rules = RuleConfig::base(Layout::Extension6);
        let relative = PathBuf::from("src/parser/__tests__/expected/board-draft-empty.json");
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .ancestors()
            .map(|root| root.join(&relative))
            .find(|candidate| candidate.is_file())
            .expect("board fixture must be reachable from the worktree or sweep root");
        let wire = WireBoard::parse_str(&fs::read_to_string(path).unwrap()).unwrap();
        let board =
            SimBoard::try_from_wire(wire, &topology, &rules, ConversionOptions::default()).unwrap();
        let config = GameConfig::default();
        let mut arena = GameArena::default();
        arena.prepare(&board, &topology, &rules, &config);
        (topology, board, rules, config, arena)
    }

    fn simple_path(
        topology: &Topology,
        edge_count: usize,
        excluded: &HashSet<Edge>,
    ) -> (Vec<Vertex>, Vec<Edge>) {
        fn visit(
            topology: &Topology,
            edge_count: usize,
            excluded: &HashSet<Edge>,
            vertices: &mut Vec<Vertex>,
            edges: &mut Vec<Edge>,
        ) -> bool {
            if edges.len() == edge_count {
                return true;
            }
            let current = *vertices.last().unwrap();
            for edge in topology.vertex_edges(current) {
                if excluded.contains(edge) || edges.contains(edge) {
                    continue;
                }
                let [left, right] = topology.edge_endpoints(*edge);
                let next = if left == current { right } else { left };
                if vertices.contains(&next) {
                    continue;
                }
                edges.push(*edge);
                vertices.push(next);
                if visit(topology, edge_count, excluded, vertices, edges) {
                    return true;
                }
                vertices.pop();
                edges.pop();
            }
            false
        }

        for start in 0..topology.vertex_count() {
            let mut vertices = vec![start as Vertex];
            let mut edges = Vec::new();
            if visit(topology, edge_count, excluded, &mut vertices, &mut edges) {
                return (vertices, edges);
            }
        }
        panic!("topology has no simple path of length {edge_count}");
    }

    fn give_path(arena: &mut GameArena, seat: usize, edges: &[Edge]) {
        for edge in edges {
            arena.state.edge_owner[usize::from(*edge)] = seat as u8;
            arena.state.players[seat].pieces[Buildable::Road.index()] -= 1;
        }
    }

    fn reset() {
        EXACT_CHECKS.with(|count| count.set(0));
        ONE_STEP_SCANS.with(|counts| counts.set([0; crate::state::MAX_SEATS]));
        ROAD_NETWORK_BUILDS.with(|count| count.set(0));
        heuristic_v1::reset_holder_defend_observation();
        heuristic_v1::reset_pair_contest();
        heuristic_v1::reset_pair_road_bonus();
    }

    fn exact_checks() -> u8 {
        EXACT_CHECKS.with(Cell::get)
    }

    fn one_step_scans() -> [u8; crate::state::MAX_SEATS] {
        ONE_STEP_SCANS.with(Cell::get)
    }

    fn road_network_builds() -> u32 {
        ROAD_NETWORK_BUILDS.with(Cell::get)
    }

    fn challenger_fixture() -> (Topology, SimBoard, RuleConfig, GameConfig, GameArena) {
        let (topology, board, rules, config, mut arena) = fixture();
        let (_, observer) = simple_path(&topology, 5, &HashSet::new());
        let excluded = observer.iter().copied().collect::<HashSet<_>>();
        let (_, challenger) = simple_path(&topology, 5, &excluded);
        give_path(&mut arena, 0, &observer);
        give_path(&mut arena, 1, &challenger);
        arena.recompute_roads_for_test(&topology, &rules, board.seats());
        arena.state.longest_road = RoadCard {
            holder: Some(0),
            retired: false,
        };
        (topology, board, rules, config, arena)
    }

    fn contest_fixture() -> (Topology, SimBoard, GameArena) {
        let (topology, board, _rules, _config, mut arena) = fixture();
        for target in 0..topology.vertex_count() {
            let target = target as Vertex;
            let incident = topology.vertex_edges(target);
            if incident.len() < 2 {
                continue;
            }
            for observer_approach in incident {
                let observer_source = topology
                    .edge_endpoints(*observer_approach)
                    .into_iter()
                    .find(|vertex| *vertex != target)
                    .unwrap();
                let Some(observer_base) = topology
                    .vertex_edges(observer_source)
                    .iter()
                    .copied()
                    .find(|edge| *edge != *observer_approach && !incident.contains(edge))
                else {
                    continue;
                };
                for opponent_approach in incident {
                    if opponent_approach == observer_approach {
                        continue;
                    }
                    let opponent_source = topology
                        .edge_endpoints(*opponent_approach)
                        .into_iter()
                        .find(|vertex| *vertex != target)
                        .unwrap();
                    let Some(opponent_base) = topology
                        .vertex_edges(opponent_source)
                        .iter()
                        .copied()
                        .find(|edge| *edge != *opponent_approach && !incident.contains(edge))
                    else {
                        continue;
                    };
                    if observer_base == opponent_base {
                        continue;
                    }
                    arena.state.edge_owner[usize::from(observer_base)] = 0;
                    arena.state.edge_owner[usize::from(opponent_base)] = 1;
                    arena.state.players[0].playable_dev[2] = 1;
                    arena.state.players[1].vp_public = 9;
                    return (topology, board, arena);
                }
            }
        }
        panic!("fixture needs two independent approaches to one vertex");
    }

    #[test]
    fn the_cheap_race_prefilter_is_sound_memoized_and_actually_fires() {
        let _guard = denial_test_lock();
        let (topology, board, mut rules, mut config, mut arena) = fixture();
        rules.turn_cap = 8;
        for game in 0..200_u64 {
            config.seed = game;
            arena.play(&board, &topology, &rules, &config);
            for observer in 0..board.seats() {
                let view = arena.decision_view(&board, &topology, observer, DecisionPhase::Action);
                for seat in 0..view.seats() {
                    if seat == observer || view.longest_road_holder() == Some(seat) {
                        continue;
                    }
                    if view.road_takes_longest_road(seat) {
                        let best_other_len = (0..view.seats())
                            .filter(|other| *other != seat)
                            .map(|other| view.longest_road_len(other))
                            .max()
                            .unwrap_or_default();
                        let required = view
                            .longest_road_min()
                            .max(best_other_len.saturating_add(1));
                        assert!(
                            view.compute_road_count(seat).saturating_add(1) >= required,
                            "game={game} observer={observer} seat={seat}"
                        );
                    }
                }
                let context = context(&view, &DenialParams::default());
                assert!(context.race_checks() <= MAX_RACE_CHECKS);
            }
        }

        let (topology, board, _rules, _config, quiet) = fixture();
        let view = quiet.decision_view(&board, &topology, 0, DecisionPhase::Action);
        reset();
        let quiet_params = DenialParams {
            race_danger_min: 1.0,
            ..DenialParams::default()
        };
        let quiet_context = context(&view, &quiet_params);
        assert_eq!(quiet_context.race_checks(), 0);
        assert_eq!(exact_checks(), 0);

        let (topology, board, rules, _config, mut budget_arena) = fixture();
        let mut excluded = HashSet::new();
        for seat in 1..=3 {
            let (_, roads) = simple_path(&topology, 5, &excluded);
            excluded.extend(roads.iter().copied());
            give_path(&mut budget_arena, seat, &roads);
            budget_arena.state.players[seat].pieces[Buildable::Road.index()] = 0;
        }
        budget_arena.recompute_roads_for_test(&topology, &rules, board.seats());
        budget_arena.state.longest_road = RoadCard {
            holder: Some(0),
            retired: false,
        };
        let budget_view = budget_arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
        reset();
        // Three rivals survive the prefilter. The default budget covers them all (SIM-GAP-07's
        // blind spot closed), while a non-default `race_check_cap` is forwarded and binds.
        let budget_context = context(
            &budget_view,
            &DenialParams {
                race_danger_min: 0.0,
                ..DenialParams::default()
            },
        );
        assert_eq!(budget_context.race_checks(), 3);
        assert_eq!(exact_checks(), 3);
        reset();
        let capped_context = context(
            &budget_view,
            &DenialParams {
                race_danger_min: 0.0,
                race_check_cap: 2,
                ..DenialParams::default()
            },
        );
        assert_eq!(capped_context.race_checks(), 2);
        assert_eq!(exact_checks(), 2);

        let (topology, board, _rules, _config, arena) = challenger_fixture();
        let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
        let params = DenialParams {
            race_danger_min: 0.0,
            ..DenialParams::default()
        };
        reset();
        let positive = context(&view, &params);
        let after_context = exact_checks();
        assert_eq!(after_context, 1);
        assert!(positive.longest_road_challenger().is_some());
        assert!(positive.longest_road_challenger().is_some());
        assert_eq!(exact_checks(), after_context);
        let fresh_positive = context(&view, &params);
        assert_eq!(fresh_positive.race_checks(), 1);
        assert!(fresh_positive.longest_road_challenger().is_some());

        let (_, _, _, _, mut negative_arena) = challenger_fixture();
        negative_arena.state.players[1].pieces[Buildable::Road.index()] = 0;
        let negative_view =
            negative_arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
        reset();
        let negative = context(&negative_view, &params);
        let after_negative = exact_checks();
        assert_eq!(negative.longest_road_challenger(), None);
        assert_eq!(negative.longest_road_challenger(), None);
        assert_eq!(exact_checks(), after_negative);

        let leaked = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            reset();
            let _ = context(&view, &params);
            panic!("counter reset probe");
        }));
        assert!(leaked.is_err());
        reset();
        let fresh = context(&negative_view, &quiet_params);
        assert_eq!(fresh.race_checks(), 0);
        assert_eq!(exact_checks(), 0);
    }

    #[test]
    fn the_default_budget_finds_the_third_ranked_challenger() {
        let _guard = denial_test_lock();
        let (topology, board, rules, _config, mut arena) = fixture();
        let mut excluded = HashSet::new();
        for seat in 1..=3 {
            let (_, roads) = simple_path(&topology, 5, &excluded);
            excluded.extend(roads.iter().copied());
            give_path(&mut arena, seat, &roads);
        }
        // Seats 1 and 2 outrank seat 3 on danger but cannot lay another road, so their exact
        // checks fail; seat 3 is the live challenger sitting third in the ranking -- exactly the
        // rival the old two-check budget never reached (SIM-GAP-07).
        for seat in 1..=2 {
            arena.state.players[seat].pieces[Buildable::Road.index()] = 0;
            arena.state.players[seat].vp_public = 9;
        }
        arena.recompute_roads_for_test(&topology, &rules, board.seats());
        arena.state.longest_road = RoadCard {
            holder: Some(0),
            retired: false,
        };
        let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
        let params = DenialParams {
            race_danger_min: 0.0,
            ..DenialParams::default()
        };
        reset();
        let capped = context(
            &view,
            &DenialParams {
                race_check_cap: 2,
                ..params
            },
        );
        assert_eq!(capped.longest_road_challenger(), None);
        assert_eq!(capped.race_checks(), 2);
        reset();
        let full = context(&view, &params);
        let (challenger, _) = full.longest_road_challenger().unwrap();
        assert_eq!(challenger, 3);
        assert_eq!(full.race_checks(), 3);

        // `LegacyValuation::bounded_race` restores the two-check budget through the real
        // decision path, without `denial.rs` ever reading the flag itself.
        let fixed_params = HeuristicParams {
            denial: Some(params),
            ..HeuristicParams::default()
        };
        let legacy_params = HeuristicParams {
            legacy_valuation: Some(heuristic_v1::LegacyValuation {
                bounded_race: true,
                ..heuristic_v1::LegacyValuation::default()
            }),
            ..fixed_params.clone()
        };
        let mut actions = Box::new(crate::view::ActionBuf::new());
        reset();
        heuristic_v1::score_actions(&view, &fixed_params, &mut actions);
        assert_eq!(exact_checks(), 3);
        reset();
        heuristic_v1::score_actions(&view, &legacy_params, &mut actions);
        assert_eq!(exact_checks(), 2);
    }

    #[test]
    #[ignore = "single-state timing observation; run deliberately"]
    fn race_check_budget_per_decision_cost_is_reported() {
        let _guard = denial_test_lock();
        let (topology, board, rules, _config, mut arena) = fixture();
        let mut excluded = HashSet::new();
        for seat in 1..=3 {
            let (_, roads) = simple_path(&topology, 5, &excluded);
            excluded.extend(roads.iter().copied());
            give_path(&mut arena, seat, &roads);
        }
        for seat in 1..=2 {
            arena.state.players[seat].pieces[Buildable::Road.index()] = 0;
            arena.state.players[seat].vp_public = 9;
        }
        arena.recompute_roads_for_test(&topology, &rules, board.seats());
        arena.state.longest_road = RoadCard {
            holder: Some(0),
            retired: false,
        };
        let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
        const DECISIONS: u64 = 20_000;
        for cap in [2, MAX_RACE_CHECKS] {
            let params = DenialParams {
                race_danger_min: 0.0,
                race_check_cap: cap,
                ..DenialParams::default()
            };
            for run in 1..=5 {
                let started = std::time::Instant::now();
                for _ in 0..DECISIONS {
                    std::hint::black_box(context(&view, &params));
                }
                eprintln!(
                    "path=denial_context raceCheckCap={cap} run={run} decisions={DECISIONS} nsPerDecision={:.3}",
                    started.elapsed().as_nanos() as f64 / DECISIONS as f64
                );
            }
        }
    }

    #[test]
    fn pressure_is_not_uniform_within_one_decision() {
        let _guard = denial_test_lock();
        let (topology, board, _rules, _config, mut arena) = fixture();
        let high = topology.hex_vertices(0)[0];
        let low = topology.hex_vertices(1)[3];
        arena.state.vertex_owner[usize::from(high)] = 1;
        arena.state.vertex_tier[usize::from(high)] = 1;
        arena.state.players[1].vp_public = 9;
        arena.state.vertex_owner[usize::from(low)] = 2;
        arena.state.vertex_tier[usize::from(low)] = 1;
        arena.state.players[2].vp_public = 2;
        let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
        let params = DenialParams::default();
        let context = context(&view, &params);
        assert_ne!(context.danger(1).to_bits(), context.danger(2).to_bits());
        assert_ne!(
            pressure(&context, &params, Some(2)).to_bits(),
            pressure(&context, &params, None).to_bits()
        );
    }

    #[test]
    fn the_gated_holder_builds_no_road_network_without_a_challenger() {
        let _guard = denial_test_lock();
        let (topology, board, rules, _config, mut arena) = fixture();
        let (_, roads) = simple_path(&topology, 5, &HashSet::new());
        give_path(&mut arena, 0, &roads);
        arena.recompute_roads_for_test(&topology, &rules, board.seats());
        arena.state.longest_road = RoadCard {
            holder: Some(0),
            retired: false,
        };
        arena.state.players[0].resources = [1, 0, 0, 1, 0];
        let params = HeuristicParams {
            denial: Some(DenialParams {
                race_danger_min: 0.0,
                defend_weight: 1_000_000.0,
                ..DenialParams::default()
            }),
            ..HeuristicParams::default()
        };

        reset();
        let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
        let mut actions = Box::new(crate::view::ActionBuf::new());
        heuristic_v1::score_actions(&view, &params, &mut actions);
        assert_eq!(road_network_builds(), 0);
        assert_eq!(heuristic_v1::holder_defend_observation(), Some(false));

        arena.state.players[0].playable_dev[2] = 1;
        reset();
        let view = arena.decision_view(&board, &topology, 0, DecisionPhase::PreRoll);
        let mut scratch = PolicyScratch::default();
        heuristic_v1::pre_roll(&view, &mut scratch, &params);
        assert_eq!(road_network_builds(), 0);
    }

    #[test]
    fn the_gated_holder_pair_builds_a_road_network_with_a_challenger() {
        let _guard = denial_test_lock();
        let (topology, board, _rules, _config, mut arena) = challenger_fixture();
        arena.state.players[0].playable_dev[2] = 1;
        let params = HeuristicParams {
            denial: Some(DenialParams {
                race_danger_min: 0.0,
                defend_weight: 1_000_000.0,
                ..DenialParams::default()
            }),
            ..HeuristicParams::default()
        };
        reset();
        let view = arena.decision_view(&board, &topology, 0, DecisionPhase::PreRoll);
        let mut scratch = PolicyScratch::default();
        heuristic_v1::pre_roll(&view, &mut scratch, &params);
        assert_eq!(
            road_network_builds(),
            4,
            "two exact challenger checks plus the goal and pair observer networks"
        );
        assert!(heuristic_v1::pair_road_bonus() > 100_000.0);
    }

    #[test]
    fn the_pair_path_forwards_nondefault_contest_params() {
        let _guard = denial_test_lock();
        let (topology, board, mut arena) = contest_fixture();
        arena.state.players[0].playable_dev[2] = 1;
        let denial_params = DenialParams {
            contest_weight: 100_000.0,
            contest_cap: 777.0,
            ..DenialParams::default()
        };
        let params = HeuristicParams {
            denial: Some(denial_params),
            ..HeuristicParams::default()
        };
        let view = arena.decision_view(&board, &topology, 0, DecisionPhase::PreRoll);
        let context = context(&view, &denial_params);
        let mut expected = 0.0_f32;
        for first in 0..topology.edge_count() {
            let first = first as Edge;
            if !view.legal_road(first) {
                continue;
            }
            for second in topology.edge_neighbors(first) {
                if view.legal_road_after(first, *second) {
                    expected = expected.max(
                        contest_term(&view, &context, &denial_params, first).max(contest_term(
                            &view,
                            &context,
                            &denial_params,
                            *second,
                        )),
                    );
                }
            }
        }
        assert!(expected > DenialParams::default().contest_cap);

        reset();
        let mut scratch = PolicyScratch::default();
        heuristic_v1::pre_roll(&view, &mut scratch, &params);
        assert_eq!(heuristic_v1::pair_contest().to_bits(), expected.to_bits());
    }

    #[test]
    fn the_contest_term_scans_each_seat_at_most_once_per_decision() {
        let _guard = denial_test_lock();
        let (topology, board, arena) = contest_fixture();
        let params = HeuristicParams {
            denial: Some(DenialParams::default()),
            ..HeuristicParams::default()
        };
        reset();
        let view = arena.decision_view(&board, &topology, 0, DecisionPhase::PreRoll);
        let mut scratch = PolicyScratch::default();
        heuristic_v1::pre_roll(&view, &mut scratch, &params);
        let scans = one_step_scans();
        assert_eq!(scans[0], 0);
        for (seat, scans) in scans.iter().enumerate().take(view.seats()).skip(1) {
            assert_eq!(*scans, 1, "seat={seat}");
        }
    }

    #[test]
    fn the_pair_path_forwards_nondefault_probe_slack() {
        let _guard = denial_test_lock();
        let (topology, board, _rules, _config, mut arena) = challenger_fixture();
        arena.state.players[0].playable_dev[2] = 1;
        let params = HeuristicParams {
            denial: Some(DenialParams {
                race_danger_min: 0.0,
                defend_probe_slack: 3,
                ..DenialParams::default()
            }),
            ..HeuristicParams::default()
        };
        heuristic_v1::reset_pair_probe_cap();
        let view = arena.decision_view(&board, &topology, 0, DecisionPhase::PreRoll);
        let mut scratch = PolicyScratch::default();
        heuristic_v1::pre_roll(&view, &mut scratch, &params);
        assert_eq!(
            heuristic_v1::pair_probe_cap(),
            Some(view.longest_road_len(0).saturating_add(3))
        );
    }

    #[test]
    #[ignore = "single-threaded trail-search observation; run deliberately"]
    fn denial_arm_road_network_heat_is_reported() {
        let _guard = denial_test_lock();
        let (topology, board, rules, mut config, mut arena) = fixture();
        for policy in [PolicyKind::HeuristicV1, PolicyKind::HeuristicV1Denial] {
            reset();
            let mut decisions = 0_u64;
            config.policies = [policy; crate::state::MAX_SEATS];
            for seed in 0..200_u64 {
                config.seed = seed;
                let result = arena.play(&board, &topology, &rules, &config);
                decisions += u64::from(result.turns) * board.seats() as u64;
            }
            let builds = road_network_builds();
            eprintln!(
                "policy={policy:?} decisions={decisions} roadNetworkBuilds={builds} buildsPerDecision={:.6}",
                f64::from(builds) / decisions as f64
            );
        }
    }
}
