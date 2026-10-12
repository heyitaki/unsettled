use std::cell::Cell;
use std::collections::BTreeMap;

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::board::{ConversionOptions, SimBoard};
use crate::game::{GameArena, GameConfig, update_largest_army};
use crate::policy::{self, PolicyKind, PolicyScratch, heuristic_v1, heuristic_v1_trader};
use crate::rng::Xoshiro256StarStar;
use crate::rules::{Buildable, RESOURCE_COUNT, Resource, RuleConfig, TradeConfig};
use crate::state::{DEV_KNIGHT, DEV_MONOPOLY, DEV_ROAD_BUILDING, DEV_YEAR_OF_PLENTY, MAX_SEATS};
use crate::topology::{Hex, Topology};
use crate::trade::TradeOffer;
use crate::view::{Action, DecisionPhase, DecisionView, DevPlay};
use crate::wire::{BuildingTier, Object, WireBoard, WireError};

const POLICY: PolicyKind = PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenial;

thread_local! {
    static WORK: Cell<Option<Box<(GameArena, PolicyScratch)>>> = const { Cell::new(None) };
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Request<B> {
    game: Game<B>,
    decision: Decision,
    observer: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Game<B> {
    schema_version: u8,
    board: B,
    stats: BTreeMap<String, Stats>,
    awards: Option<Awards>,
    dev_hand: Option<Value>,
    turn: Option<Turn>,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Stats {
    hand: Resources<u16>,
    hand_unknown: u16,
    dev_cards: u8,
    knights: u8,
    vp_cards: u8,
}

#[derive(Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Resources<T> {
    wood: T,
    sheep: T,
    wheat: T,
    brick: T,
    ore: T,
}

impl<T: Copy> Resources<T> {
    fn array(&self) -> [T; RESOURCE_COUNT] {
        [self.wood, self.sheep, self.wheat, self.brick, self.ore]
    }
}

impl<T> From<[T; RESOURCE_COUNT]> for Resources<T> {
    fn from([wood, sheep, wheat, brick, ore]: [T; RESOURCE_COUNT]) -> Self {
        Self {
            wood,
            sheep,
            wheat,
            brick,
            ore,
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Awards {
    longest_road: Option<String>,
    largest_army: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DevHand {
    #[serde(rename = "playerId")]
    _player_id: String,
    playable: DevCards,
    bought: DevCards,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Turn {
    player_id: String,
    #[serde(rename = "rolled")]
    _rolled: Option<f64>,
    dev_played: bool,
    progress_played: ProgressPlayed,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ProgressPlayed {
    road_building: u32,
    year_of_plenty: u32,
    monopoly: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DevCards {
    knight: u8,
    road_building: u8,
    year_of_plenty: u8,
    monopoly: u8,
}

impl DevCards {
    fn array(&self) -> [u8; 5] {
        let mut cards = [0; 5];
        cards[DEV_KNIGHT] = self.knight;
        cards[DEV_ROAD_BUILDING] = self.road_building;
        cards[DEV_YEAR_OF_PLENTY] = self.year_of_plenty;
        cards[DEV_MONOPOLY] = self.monopoly;
        cards
    }
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
enum Decision {
    Turn,
    PreRoll,
    Discard,
    Robber,
    TradeResponse {
        proposer: String,
        give: Resource,
        get: Resource,
        count: u8,
    },
    Produce {
        total: u8,
    },
}

/// Runs the reference turn policy on an app game without changing the input game.
pub fn advise(request_json: &str) -> String {
    let response = match parse_request(request_json, Object::<WireBoard>::validated) {
        Ok(request) => advise_value(request),

        // The typed parse rejects duplicate keys and words errors differently; the untyped path defines accepted input and error text.
        Err(_) => advise_untyped(request_json),
    };
    render(response)
}

fn render(response: Result<Value, String>) -> String {
    match response {
        Ok(response) => response.to_string(),
        Err(error) => json!({"error": error}).to_string(),
    }
}

fn advise_untyped(source: &str) -> Result<Value, String> {
    let request = parse_request(source, WireBoard::parse_value)?;
    advise_value(request)
}

fn parse_request<B: DeserializeOwned>(
    source: &str,
    parse_board: impl FnOnce(B) -> Result<WireBoard, WireError>,
) -> Result<Request<WireBoard>, String> {
    let request: Request<B> = serde_json::from_str(source).map_err(|error| error.to_string())?;
    let game = request.game;
    if game.schema_version != 1 {
        return Err("unsupported game schemaVersion".into());
    }
    let board = parse_board(game.board).map_err(|error| error.to_string())?;
    Ok(Request {
        game: Game {
            schema_version: game.schema_version,
            board,
            stats: game.stats,
            awards: game.awards,
            dev_hand: game.dev_hand,
            turn: game.turn,
        },
        decision: request.decision,
        observer: request.observer,
    })
}

fn advise_value(request: Request<WireBoard>) -> Result<Value, String> {
    // Taken out for the call, so a WebAssembly call that traps leaves nothing half-borrowed.
    let mut work = WORK.take().unwrap_or_default();
    let response = advise_game(request, &mut work.0, &mut work.1);
    WORK.set(Some(work));
    response
}

fn advise_game(
    request: Request<WireBoard>,
    arena: &mut GameArena,
    scratch: &mut PolicyScratch,
) -> Result<Value, String> {
    let game = request.game;
    let wire = game.board;
    let claimed = wire
        .me_player_id
        .as_ref()
        .and_then(|id| wire.players.iter().position(|player| &player.id == id));
    let observer = match request.observer {
        Some(id) => wire.players.iter().position(|player| player.id == id),
        None => claimed,
    }
    .ok_or("game must specify an observer in the roster")?;
    let names: Vec<_> = wire
        .players
        .iter()
        .map(|player| player.name.clone())
        .collect();
    let topology = Topology::shared(wire.layout)?;
    let mut rules = RuleConfig::base(wire.layout);
    rules.player_trading = Some(TradeConfig::default());
    let board = SimBoard::try_from_wire(
        wire,
        topology,
        &rules,
        ConversionOptions {
            allow_unofficial: true,
        },
    )
    .map_err(|error| error.to_string())?;
    let dev_hand = game
        .dev_hand
        .filter(|value| {
            claimed.is_some_and(|seat| {
                value.get("playerId").and_then(Value::as_str) == Some(&board.player_ids()[seat])
            })
        })
        .map(serde_json::from_value::<DevHand>)
        .transpose()
        .map_err(|error| error.to_string())?;
    arena.prepare(
        &board,
        topology,
        &rules,
        &GameConfig {
            policies: [POLICY; MAX_SEATS],
            seed: 0,
            ..GameConfig::default()
        },
    );
    let mut removed = 0_usize;
    for (seat, id) in board.player_ids().iter().enumerate() {
        let empty = Stats::default();
        let stats = game.stats.get(id).unwrap_or(&empty);
        let known = stats.hand.array();
        let unknown = if seat == observer {
            0
        } else {
            stats.hand_unknown
        };
        let total = known.iter().map(|count| u32::from(*count)).sum::<u32>() + u32::from(unknown);
        // Leave room for production and hypothetical trades in the engine's i16 hands.
        if total > (i16::MAX as u32 - u32::from(u8::MAX)) {
            return Err(format!("hand is too large for player {id}"));
        }
        let player = &mut arena.state.players[seat];
        player.resources = known.map(|count| count as i16);
        if seat != observer {
            // DecisionView exposes only a rival's total; resource estimates use belief bounds.
            player.resources[0] += unknown as i16;
        }
        player.knights_played = stats.knights;
        player.dev_plays_revealed[DEV_KNIGHT] = stats.knights;
        player.vp_dev = stats.vp_cards;
        let held = if Some(seat) == claimed {
            if let Some(dev_hand) = dev_hand.as_ref() {
                player.playable_dev = dev_hand.playable.array();
                player.bought_dev = dev_hand.bought.array();
                player
                    .playable_dev
                    .iter()
                    .chain(&player.bought_dev)
                    .map(|count| usize::from(*count))
                    .sum::<usize>()
            } else {
                player.bought_dev[DEV_KNIGHT] = stats.dev_cards;
                usize::from(stats.dev_cards)
            }
        } else {
            player.bought_dev[DEV_KNIGHT] = stats.dev_cards;
            usize::from(stats.dev_cards)
        };
        let view_count = player
            .playable_dev
            .iter()
            .chain(&player.bought_dev)
            .map(|count| u16::from(*count))
            .sum::<u16>()
            + u16::from(player.vp_dev);
        if view_count > u16::from(u8::MAX) {
            return Err(format!("dev card count is too large for player {id}"));
        }
        removed += held + usize::from(stats.vp_cards) + usize::from(stats.knights);
        arena.state.belief.set_known_hand(seat, known, unknown);
        for resource in 0..RESOURCE_COUNT {
            arena.state.bank[resource] = arena.state.bank[resource].saturating_sub(known[resource]);
        }
    }
    if let Some(turn) = &game.turn {
        for (kind, count) in [
            (DEV_ROAD_BUILDING, turn.progress_played.road_building),
            (DEV_YEAR_OF_PLENTY, turn.progress_played.year_of_plenty),
            (DEV_MONOPOLY, turn.progress_played.monopoly),
        ] {
            removed = removed.saturating_add(count as usize);

            // Progress reveals are read only as a deck-wide sum; knight counts stay per player.
            arena.state.players[observer].dev_plays_revealed[kind] =
                count.min(u32::from(u8::MAX)) as u8;
        }
    }
    arena.set_dev_state(
        removed,
        game.turn
            .as_ref()
            .is_some_and(|turn| turn.dev_played && turn.player_id == board.player_ids()[observer]),
    );
    arena.recompute_all_roads(topology, &rules, board.seats());
    if let Some(awards) = game.awards {
        let road = awards
            .longest_road
            .as_deref()
            .map(|id| seat_for(&board, id))
            .transpose()?;
        let army = awards
            .largest_army
            .as_deref()
            .map(|id| seat_for(&board, id))
            .transpose()?;
        arena.adjust_holder_vp(arena.state.longest_road.holder, road, rules.longest_road_vp);
        arena.state.longest_road.holder = road;
        arena.state.longest_road.retired = road.is_none();
        arena.state.largest_army = army;
    } else {
        let armies: Vec<_> = arena.state.players[..board.seats()]
            .iter()
            .map(|player| player.knights_played)
            .collect();
        update_largest_army(
            &mut arena.state.largest_army,
            &armies,
            rules.largest_army_min,
        );
    }
    arena.adjust_holder_vp(None, arena.state.largest_army, rules.largest_army_vp);
    let own = &arena.state.players[observer];
    if u16::from(own.vp_public) + u16::from(own.vp_dev) > u16::from(u8::MAX) {
        return Err("total VP is too large".into());
    }
    if let Decision::Produce { total } = request.decision {
        if !(2..=12).contains(&total) {
            return Err("produce total must be between 2 and 12".into());
        }
        let before = arena.state.players.map(|player| player.resources);
        if total != 7 {
            let mut demand = [[0_u16; RESOURCE_COUNT]; MAX_SEATS];
            for building in board.buildings() {
                let seat = usize::from(building.seat);
                let kind = match building.tier {
                    BuildingTier::Settlement => Buildable::Settlement,
                    BuildingTier::City => Buildable::City,
                    BuildingTier::SuperCity => Buildable::SuperCity,
                };
                for hex in topology.vertex_hexes(building.vertex) {
                    if *hex != arena.state.robber
                        && board.tokens()[usize::from(*hex)] == Some(total)
                        && let Some(resource) = board.tiles()[usize::from(*hex)]
                    {
                        demand[seat][resource.index()] +=
                            u16::from(arena.flattened_rules(seat).yield_multiplier(kind));
                    }
                }
            }
            // Imported piece counts can exceed the production routine's u8 demand counters.
            if demand
                .iter()
                .flatten()
                .any(|count| *count > u16::from(u8::MAX))
            {
                return Err("production exceeds the engine's 255-card limit".into());
            }
            arena.produce(&board, topology, total, board.seats());
        }
        let gains: BTreeMap<_, _> = board
            .player_ids()
            .iter()
            .enumerate()
            .map(|(seat, id)| {
                let gain = std::array::from_fn(|resource| {
                    arena.state.players[seat].resources[resource] - before[seat][resource]
                });
                (id, Resources::from(gain))
            })
            .collect();
        return Ok(json!({"kind":"produce", "gains":gains}));
    }
    let phase = match request.decision {
        Decision::PreRoll => DecisionPhase::PreRoll,
        Decision::TradeResponse { .. } => DecisionPhase::TradeResponse,
        _ => DecisionPhase::Action,
    };
    let view = arena.decision_view(&board, topology, observer, phase);
    let unknown_own = game
        .stats
        .get(&board.player_ids()[observer])
        .map_or(0, |stats| stats.hand_unknown);
    let derived = json!({"devDeckRemaining":view.dev_deck_remaining(), "bank":Resources::from(arena.state.bank),
        "unknownOwnCards":unknown_own, "tradeRates":Resources::from(Resource::ALL.map(|resource| view.trade_rate(resource)))});
    let params = policy::heuristic_params(POLICY);
    let denial_context = params
        .denial
        .as_ref()
        .map(|params| crate::policy::denial::context(&view, params));
    let gated = denial_context.as_ref().zip(params.denial.as_ref());
    let reasons = Reasons {
        view: &view,
        params: &params,
        names: &names,
        goal: heuristic_v1::best_goal(&view, &params, gated),
        gated,
    };
    let mut rng = Xoshiro256StarStar::from_seed(0);
    scratch.reset();
    match request.decision {
        Decision::Turn => {
            let mut actions = heuristic_v1::recommend(&view, &params);
            if let Some(trading) = &params.trading {
                heuristic_v1_trader::score_offers(&view, trading, |candidate| {
                    actions.push(candidate)
                });
            }
            if actions.iter().any(|candidate| !candidate.score.is_finite()) {
                return Err("policy produced a non-finite score".into());
            }
            actions.sort_by(|a, b| {
                b.score
                    .partial_cmp(&a.score)
                    .unwrap_or(std::cmp::Ordering::Equal)
            });
            let actions: Vec<_> = actions.into_iter().enumerate().map(|(rank, candidate)| json!({
                "action":action_json(candidate.action, &view), "score":candidate.score,
                "reason":reasons.action(candidate, rank == 0), "handDelta":Resources::from(hand_delta(candidate.action, &view))
            })).collect();
            Ok(json!({"kind":"turn", "actions":actions, "derived":derived}))
        }
        Decision::PreRoll => {
            let play = policy::pre_roll(POLICY, &view, scratch, &mut rng);
            let reason = play.map_or_else(
                || "No dev card is worth playing yet".into(),
                |play| reason_line(reasons.play(play), reasons.wins(Action::PlayDev(play))),
            );
            Ok(
                json!({"kind":"preRoll", "play":play.map(|play| play_json(play, &view)), "reason":reason, "derived":derived}),
            )
        }
        Decision::Discard => {
            let known_total = view.hand_total(observer);
            let total = known_total + u32::from(unknown_own);
            let count = if total > u32::from(view.discard_threshold()) {
                u8::try_from(total / 2)
                    .map_err(|_| "discard count exceeds the engine's 255-card limit")?
            } else {
                0
            };
            let known_count = known_total.min(u32::from(count)) as u8;
            let cards = policy::discard(POLICY, &view, known_count, scratch, &mut rng);
            Ok(
                json!({"kind":"discard", "count":count, "cards":Resources::from(cards), "reason":reason_line(reasons.discard(count, cards), false), "derived":derived}),
            )
        }
        Decision::Robber => {
            let (hex, victim) = policy::robber(POLICY, &view, &mut rng);
            Ok(json!({"kind":"robber", "hex":hex_json(hex, topology),
                "victim":victim.map(|seat| &board.player_ids()[usize::from(seat)]), "reason":reason_line(reasons.robber(hex, victim, false), false), "derived":derived}))
        }
        Decision::TradeResponse {
            proposer,
            give,
            get,
            count,
        } => {
            if !(1..=2).contains(&count) || give == get {
                return Err("trade must exchange different resources at a count of 1 or 2".into());
            }
            let offer = TradeOffer {
                proposer: seat_for(&board, &proposer)?,
                give,
                get,
                count,
            };
            let margin = heuristic_v1_trader::response_margin(&view, offer, &params);
            if margin.is_some_and(|value| !value.is_finite()) {
                return Err("policy produced a non-finite margin".into());
            }
            Ok(
                json!({"kind":"tradeResponse", "accept":margin.is_some_and(|value| value > 0.0),
                "margin":margin, "reason":reason_line(reasons.trade_response(offer, margin), false), "derived":derived}),
            )
        }
        Decision::Produce { .. } => Err("production was already handled".into()),
    }
}

fn action_json(action: Action, view: &DecisionView<'_>) -> Value {
    match action {
        Action::BuildRoad(edge) => {
            json!({"type":"buildRoad", "edgeId":view.topology().edge_id(edge)})
        }
        Action::BuildSettlement(vertex) => {
            json!({"type":"buildSettlement", "vertexId":view.topology().vertex_id(vertex)})
        }
        Action::UpgradeCity(vertex) => {
            json!({"type":"upgradeCity", "vertexId":view.topology().vertex_id(vertex)})
        }
        Action::BuyDev => json!({"type":"buyDev"}),
        Action::PlayDev(play) => play_json(play, view),
        Action::TradeBank { give, get, count } => {
            json!({"type":"tradeBank", "give":give, "get":get, "count":count, "rate":view.trade_rate(give)})
        }
        Action::OfferTrade { give, get, count } => {
            json!({"type":"offerTrade", "give":give, "get":get, "count":count})
        }
        Action::Pass => json!({"type":"pass"}),
    }
}

fn hand_delta(action: Action, view: &DecisionView<'_>) -> [i64; RESOURCE_COUNT] {
    let build = match action {
        Action::BuildRoad(_) => Some(Buildable::Road),
        Action::BuildSettlement(_) => Some(Buildable::Settlement),
        Action::UpgradeCity(_) => Some(Buildable::City),
        _ => None,
    };
    if let Some(kind) = build {
        return view
            .costs(kind)
            .first()
            .copied()
            .unwrap_or([0; RESOURCE_COUNT])
            .map(|count| -i64::from(count));
    }
    let mut delta = [0; RESOURCE_COUNT];
    match action {
        Action::BuyDev => delta = view.dev_cost().map(|count| -i64::from(count)),
        Action::TradeBank { give, get, count } => {
            delta[give.index()] = -i64::from(view.trade_rate(give)) * i64::from(count);
            delta[get.index()] = i64::from(count);
        }
        _ => {}
    }
    delta
}

fn hex_json(hex: Hex, topology: &Topology) -> Value {
    let (q, r) = topology.hex_key(hex).split_once(',').unwrap_or(("0", "0"));
    json!({"q":q.parse::<i64>().unwrap_or(0), "r":r.parse::<i64>().unwrap_or(0)})
}

fn play_json(play: DevPlay, view: &DecisionView<'_>) -> Value {
    match play {
        DevPlay::Knight {
            destination,
            victim,
        } => json!({"type":"playKnight", "hex":hex_json(destination, view.topology()),
            "victim":victim.map(|seat| &view.board().player_ids()[usize::from(seat)])}),
        DevPlay::RoadBuilding { first, second } => json!({"type":"roadBuilding",
            "first":first.map(|edge| view.topology().edge_id(edge)), "second":second.map(|edge| view.topology().edge_id(edge))}),
        DevPlay::YearOfPlenty { first, second } => {
            json!({"type":"yearOfPlenty", "first":first, "second":second})
        }
        DevPlay::Monopoly { resource } => json!({"type":"monopoly", "resource":resource}),
    }
}

fn seat_for(board: &SimBoard, id: &str) -> Result<usize, String> {
    board
        .player_ids()
        .iter()
        .position(|player| player == id)
        .ok_or_else(|| format!("unknown player {id}"))
}

struct Reasons<'a, 'v> {
    view: &'a DecisionView<'v>,
    params: &'a heuristic_v1::HeuristicParams,
    names: &'a [String],
    goal: Option<heuristic_v1::Goal>,
    gated: heuristic_v1::Gated<'a>,
}

impl Reasons<'_, '_> {
    fn action(&self, candidate: crate::view::ScoredAction, first: bool) -> String {
        let view = self.view;
        let reason = match candidate.action {
            Action::BuildSettlement(vertex) => {
                self.vertex(vertex, heuristic_v1::BuildKind::Settlement)
            }
            Action::UpgradeCity(vertex) => self.vertex(vertex, heuristic_v1::BuildKind::City),
            Action::BuildRoad(edge) => self.road(edge),
            Action::BuyDev => "Values the remaining VP, progress and knight mix".into(),
            Action::PlayDev(play) => self.play(play),
            Action::TradeBank { .. } => {
                if heuristic_v1::shed_trade(view, self.params, self.goal).is_some_and(|shed| {
                    shed.action == candidate.action
                        && shed.score.to_bits() == candidate.score.to_bits()
                }) {
                    "Sheds cards before a seven".into()
                } else if let Some(goal) = self.goal.filter(|goal| {
                    !view.can_afford(goal.kind)
                        && heuristic_v1::trade_completes(view, goal.kind, candidate.action)
                }) {
                    format!("Gets you the cards for a {}", build_name(goal.kind))
                } else if !view.can_buy_dev()
                    && heuristic_v1::trade_completes_cost(view, view.dev_cost(), candidate.action)
                {
                    "Gets you the cards for a dev card".into()
                } else if let Some(goal) = self.goal {
                    format!("Moves you toward a {}", build_name(goal.kind))
                } else {
                    "Exchanges cards at your bank rate".into()
                }
            }
            Action::OfferTrade { give, get, count } => self.offer(TradeOffer {
                proposer: view.observer(),
                give,
                get,
                count,
            }),
            Action::Pass => if first {
                "Nothing else is worth doing"
            } else {
                "Ends the turn"
            }
            .into(),
        };
        reason_line(reason, self.wins(candidate.action))
    }

    fn discard(&self, count: u8, cards: [u8; RESOURCE_COUNT]) -> String {
        if count == 0 {
            return "Nothing to discard".into();
        }
        let view = self.view;
        if view.hand_total(view.observer()) == 0 {
            return "No known cards are available to discard".into();
        }
        if let Some(goal) = self.goal {
            let kept: Vec<_> = view
                .costs(goal.kind)
                .first()
                .into_iter()
                .flat_map(|cost| {
                    Resource::ALL
                        .into_iter()
                        .filter(|resource| {
                            let index = resource.index();
                            cost[index] > 0 && view.own_hand()[index] > i16::from(cards[index])
                        })
                        .map(Resource::as_str)
                })
                .collect();
            if !kept.is_empty() {
                return format!(
                    "Keeps {} toward a {}",
                    kept.join(" and "),
                    build_name(goal.kind)
                );
            }
            return format!(
                "Discards the least useful cards for a {}",
                build_name(goal.kind)
            );
        }
        "Keeps cards with better bank-trade value".into()
    }

    fn name(&self, seat: usize) -> String {
        let name = self.names[seat]
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .replace(['—', '–'], "-");
        let name: String = name.chars().take(24).collect();
        if name.is_empty() {
            "that player".into()
        } else {
            name
        }
    }

    fn offer(&self, offer: TradeOffer) -> String {
        let Some(params) = self.params.trading.as_ref() else {
            return "Offers cards to another player".into();
        };
        let view = self.view;
        let own = crate::policy::trading::own_inputs(view);
        let benefit = crate::policy::trading::trade_benefit(
            &own,
            params,
            &crate::policy::trading::proposer_delta(offer),
        );
        let recipients: Vec<_> = (0..view.seats())
            .filter(|seat| {
                *seat != view.observer()
                    && !crate::trade::embargoed(view, *seat)
                    && crate::etw::inputs_for_seat(view, *seat).belief_expected[offer.get.index()]
                        >= 1.0
            })
            .collect();
        let benefit_reason = if benefit > 0.0 {
            "Moves you closer to a win"
        } else {
            "Little gain for you"
        };
        if recipients.is_empty() {
            return benefit_reason.into();
        }
        let partner = crate::policy::trading::select_counterparty(
            view,
            params,
            &crate::policy::trading::responder_delta(offer),
            &recipients,
        );
        format!(
            "{benefit_reason}; {} is the safest partner",
            self.name(partner)
        )
    }

    fn play(&self, play: DevPlay) -> String {
        let view = self.view;
        match play {
            DevPlay::Knight {
                destination,
                victim,
            } => self.robber(destination, victim, true),
            DevPlay::RoadBuilding { second, .. } => {
                format!(
                    "Saves the cost of {}",
                    if second.is_some() {
                        "two roads"
                    } else {
                        "one road"
                    }
                )
            }
            DevPlay::YearOfPlenty { first, second } => {
                if let Some(goal) = self.goal {
                    let mut after = *view.own_hand();
                    after[first.index()] += 1;
                    after[second.index()] += 1;
                    if view.costs(goal.kind).first().is_some_and(|cost| {
                        !crate::view::can_pay(view.own_hand(), cost)
                            && crate::view::can_pay(&after, cost)
                    }) {
                        return format!("Gets you the cards for a {}", build_name(goal.kind));
                    }
                }
                if first == second {
                    format!("Adds two {} toward your next builds", first.as_str())
                } else {
                    format!(
                        "Adds {} and {} toward your next builds",
                        first.as_str(),
                        second.as_str()
                    )
                }
            }
            DevPlay::Monopoly { resource } => {
                let expected = self.params.dev_cards.as_ref().map(|params| {
                    crate::policy::devcards::context(view, params).haul_expected[resource.index()]
                });
                match expected {
                    Some(haul) => format!("Collects about {haul:.1} {}", resource.as_str()),
                    None => format!("Collects {} from rival hands", resource.as_str()),
                }
            }
        }
    }

    fn road(&self, edge: u8) -> String {
        let view = self.view;
        if heuristic_v1::longest_road_reachable(view, 1, self.gated) {
            let length = view.road_length_on(
                &mut view.road_network(),
                edge,
                None,
                heuristic_v1::road_length_cap(view, self.gated),
            );
            if heuristic_v1::longest_road_value(view, length, self.gated).is_some() {
                if view.longest_road_holder() == Some(view.observer()) {
                    return "Defends Longest Road".into();
                }
                let mut lengths: Vec<_> = (0..view.seats())
                    .map(|seat| view.longest_road_len(seat))
                    .collect();
                lengths[view.observer()] = length;
                return if crate::longest_road::leading_holder(
                    view.longest_road_holder(),
                    &lengths,
                    view.longest_road_min(),
                ) == Some(view.observer())
                {
                    "Takes Longest Road".into()
                } else {
                    "Moves toward Longest Road".into()
                };
            }
        }
        match heuristic_v1::expansion_road_score(view, edge, self.params) {
            Some(value) => format!("Reaches toward a settlement spot worth {value:+.1}"),
            None => "Extends your road network".into(),
        }
    }

    fn robber(&self, destination: u8, victim: Option<u8>, knight: bool) -> String {
        let view = self.view;
        let mut clauses = Vec::new();
        if knight && view.knight_takes_largest_army() {
            clauses.push("Takes Largest Army".into());
        }
        if destination != view.robber()
            && crate::policy::threat::hex_contribution(view, view.robber(), view.observer())
                .iter()
                .any(|pips| *pips > 0)
            && let (Some(resource), Some(token)) = (
                view.board().tiles()[usize::from(view.robber())],
                view.board().tokens()[usize::from(view.robber())],
            )
        {
            clauses.push(format!("Frees your {} {token}", resource.as_str()));
        }
        if let Some(seat) = victim.map(usize::from) {
            let blocked: u16 = crate::policy::threat::hex_contribution(view, destination, seat)
                .iter()
                .sum();
            clauses.push(if blocked > 0 {
                format!("Blocks {blocked} pips of {}", self.name(seat))
            } else {
                format!("Steals from {}", self.name(seat))
            });
        } else {
            let blocked: u16 = (0..view.seats())
                .filter(|seat| *seat != view.observer())
                .map(|seat| {
                    crate::policy::threat::hex_contribution(view, destination, seat)
                        .iter()
                        .sum::<u16>()
                })
                .sum();
            if blocked > 0 {
                clauses.push(format!("Blocks {blocked} rival production pips"));
            }
        }
        if clauses.is_empty() {
            clauses.push("Moves the robber to an available hex".into());
        }
        clauses.join("; ")
    }

    fn trade_response(&self, offer: TradeOffer, margin: Option<f32>) -> String {
        let view = self.view;
        if let Some(margin) = margin {
            return if margin > 0.0 {
                format!("Helps you more than it helps {}", self.name(offer.proposer))
            } else {
                format!("Helps {} more than it helps you", self.name(offer.proposer))
            };
        }
        if view.trade_config().is_none() {
            return "Player trading is unavailable".into();
        }
        if offer.proposer == view.observer() {
            return "You cannot trade with yourself".into();
        }
        if view.own_hand()[offer.get.index()] < 1 {
            return format!("You have no {} to give", offer.get.as_str());
        }
        "No build goal makes this trade useful".into()
    }

    fn vertex(&self, vertex: u8, kind: heuristic_v1::BuildKind) -> String {
        let terms = heuristic_v1::vertex_terms(self.view, vertex, self.params, kind);
        let mut terms = [
            ("production", terms.production),
            ("scarcity", terms.scarcity),
            ("diversity", terms.diversity),
            ("port", terms.port),
            ("expansion", terms.expansion),
        ];
        terms.sort_by(|a, b| b.1.total_cmp(&a.1));
        let mut parts: Vec<_> = terms
            .into_iter()
            .filter(|(_, value)| *value != 0.0)
            .map(|(name, value)| format!("{name} {value:+.1}"))
            .collect();
        if let Some(first) = parts.first_mut() {
            first[..1].make_ascii_uppercase();
            parts.join(", ")
        } else {
            "Adds building VP toward the win".into()
        }
    }

    fn wins(&self, action: Action) -> bool {
        let view = self.view;
        let observer = view.observer();
        let rules = view.rules_for(observer);
        let mut vp = u16::from(view.own_total_vp());
        let mut road_card = crate::longest_road::RoadCard {
            holder: view.longest_road_holder(),
            retired: view.longest_road_holder().is_none(),
        };
        let mut lengths: Vec<_> = (0..view.seats())
            .map(|seat| view.longest_road_len(seat))
            .collect();
        let mut added_roads = None;
        match action {
            Action::BuildSettlement(vertex) => {
                vp += u16::from(rules.vp(Buildable::Settlement));
                let mut owners: Vec<_> = (0..view.topology().vertex_count())
                    .map(|v| view.vertex_owner(v as u8).unwrap_or(crate::state::EMPTY))
                    .collect();
                owners[usize::from(vertex)] = observer as u8;
                let edges: Vec<_> = (0..view.topology().edge_count())
                    .map(|e| view.edge_owner(e as u8).unwrap_or(crate::state::EMPTY))
                    .collect();
                for seat in 0..view.seats() {
                    lengths[seat] = crate::longest_road::RoadNetwork::for_seat(
                        view.topology(),
                        &owners,
                        &edges,
                        seat as u8,
                    )
                    .base_length();
                }
                crate::longest_road::update_road_card(
                    &mut road_card,
                    &lengths,
                    view.longest_road_min(),
                );
            }
            Action::UpgradeCity(_) => {
                vp += u16::from(
                    rules
                        .vp(Buildable::City)
                        .saturating_sub(rules.vp(Buildable::Settlement)),
                );
            }
            Action::BuildRoad(first) => added_roads = Some((first, None)),
            Action::PlayDev(DevPlay::RoadBuilding {
                first: Some(first),
                second,
            }) => {
                added_roads = Some((first, second));
            }
            Action::PlayDev(DevPlay::Knight { .. }) if view.knight_takes_largest_army() => {
                vp += u16::from(view.largest_army_vp());
            }
            _ => {}
        }
        if let Some((first, second)) = added_roads {
            lengths[observer] = view.road_length_on(
                &mut view.road_network(),
                first,
                second,
                heuristic_v1::road_length_cap(view, self.gated),
            );
            crate::longest_road::update_road_card(
                &mut road_card,
                &lengths,
                view.longest_road_min(),
            );
        }
        if road_card.holder != view.longest_road_holder() {
            if road_card.holder == Some(observer) {
                vp += u16::from(view.longest_road_vp());
            }
            if view.longest_road_holder() == Some(observer) {
                vp = vp.saturating_sub(u16::from(view.longest_road_vp()));
            }
        }
        vp >= u16::from(view.win_vp())
    }
}

fn build_name(kind: Buildable) -> &'static str {
    match kind {
        Buildable::Road => "road",
        Buildable::Settlement => "settlement",
        Buildable::City => "city",
        Buildable::SuperCity => "super city",
    }
}

fn reason_line(reason: String, wins: bool) -> String {
    let mut reason = if wins {
        format!("Wins the game: {reason}")
    } else {
        reason
    };
    while reason.chars().count() > 100 {
        if let Some(end) = reason.rfind([',', ';']) {
            reason.truncate(end);
        } else {
            reason = reason.chars().take(100).collect();
        }
    }
    reason.trim_end_matches(['.', ' ']).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixtures() -> Vec<(String, Value)> {
        let fixture: Value =
            serde_json::from_str(include_str!("../../../fixtures/advice-parity.json")).unwrap();
        fixture["cases"]
            .as_array()
            .unwrap()
            .iter()
            .map(|case| {
                (
                    case["name"].as_str().unwrap().to_owned(),
                    case["request"].clone(),
                )
            })
            .collect()
    }

    fn fixture(name: &str) -> Value {
        fixtures()
            .into_iter()
            .find(|(candidate, _)| candidate == name)
            .unwrap()
            .1
    }

    fn typed(source: &str) -> Result<Request<Object<WireBoard>>, serde_json::Error> {
        serde_json::from_str(source)
    }

    fn assert_equivalent(name: &str, source: &str) -> String {
        let reference = render(advise_untyped(source));
        let actual = advise(source);
        assert_eq!(actual, reference, "{name}");
        actual
    }

    fn fresh_response(source: &str) -> String {
        let source = source.to_owned();
        std::thread::spawn(move || advise(&source)).join().unwrap()
    }

    fn with_raw_literal(request: &Value, path: &str, literal: &str) -> String {
        let mut request = request.clone();
        *request.pointer_mut(path).unwrap() = json!("__raw_advice_test_value__");
        let source = request.to_string();
        let marker = r#""__raw_advice_test_value__""#;
        assert_eq!(source.matches(marker).count(), 1);
        source.replacen(marker, literal, 1)
    }

    #[test]
    fn history_independent_in_both_orders() {
        let cases: Vec<_> = fixtures()
            .into_iter()
            .map(|(name, request)| {
                let source = request.to_string();
                let fresh = fresh_response(&source);
                (name, source, fresh)
            })
            .collect();
        std::thread::spawn(move || {
            for (name, source, fresh) in cases.iter().chain(cases.iter().rev()) {
                assert_eq!(&advise(source), fresh, "{name}");
            }
        })
        .join()
        .unwrap();
    }

    #[test]
    fn history_independent_after_failed_request() {
        let before = fixture("standard4-11-turn");
        let after = fixture("extension6-23-preRoll");
        let mut failure = before.clone();
        failure["game"]["awards"] = json!({
            "longestRoad": "missing-award-holder", "largestArmy": null,
        });
        let failure = failure.to_string();
        let before = before.to_string();
        let after = after.to_string();
        let fresh_before = fresh_response(&before);
        let fresh_after = fresh_response(&after);
        std::thread::spawn(move || {
            assert_eq!(advise(&before), fresh_before);

            // Award holders are checked after prepare and the per-player state writes.
            assert_eq!(
                advise(&failure),
                json!({"error":"unknown player missing-award-holder"}).to_string()
            );
            assert_eq!(
                advise(&after),
                fresh_after,
                "response after a partially applied request"
            );
        })
        .join()
        .unwrap();
    }

    #[test]
    fn scratch_goal_does_not_cross_requests() {
        let pre_roll = fixture("standard4-23-preRoll");
        let discard = fixture("extension6-11-discard");
        assert_ne!(pre_roll["game"]["board"], discard["game"]["board"]);
        let pre_roll = pre_roll.to_string();
        let discard = discard.to_string();
        let fresh_pre_roll = fresh_response(&pre_roll);
        let fresh_discard = fresh_response(&discard);
        let play: Value = serde_json::from_str(&fresh_pre_roll).unwrap();
        let cards: Value = serde_json::from_str(&fresh_discard).unwrap();
        assert_eq!(play["kind"], "preRoll");
        assert!(play["play"].is_null());
        assert!(cards["count"].as_u64().unwrap() > 0);
        std::thread::spawn(move || {
            assert_eq!(advise(&pre_roll), fresh_pre_roll);
            let work = WORK.take().unwrap();
            assert!(work.1.goal.is_some());
            WORK.set(Some(work));
            assert_eq!(advise(&discard), fresh_discard);
        })
        .join()
        .unwrap();
    }

    #[test]
    fn duplicate_keys_use_the_last_value_at_every_board_level() {
        let request = fixture("standard4-11-turn");
        let expected = advise(&request.to_string());
        for (path, key, first) in [
            ("/game/board", "mePlayerId", json!("p2")),
            ("/game/board/hexes/0", "tile", json!("wood")),
            ("/game/board/hexes/0/coord", "q", json!(1)),
            ("/game/board/ports/0", "rate", json!(3)),
            ("/game/board/roads/0", "playerId", json!("p1")),
            ("/game/board/buildings/0", "tier", json!("city")),
            ("/game/board/players/0", "name", json!("X")),
            ("/game/board/robber", "r", json!(0)),
        ] {
            let object = request.pointer(path).unwrap();
            assert_ne!(first, object[key]);
            let mut first_only = request.clone();
            first_only.pointer_mut(path).unwrap()[key] = first.clone();
            assert!(typed(&first_only.to_string()).is_ok());
            let duplicate = format!("{{{}:{first},{}", json!(key), &object.to_string()[1..]);
            let source = with_raw_literal(&request, path, &duplicate);
            let error = typed(&source).err().unwrap();
            assert!(
                error
                    .to_string()
                    .contains(&format!("duplicate field `{key}`")),
                "{path}: {error}"
            );
            let response = assert_equivalent(&format!("duplicate {path}/{key}"), &source);
            assert_eq!(response, expected, "last value at {path}/{key}");
            if key == "mePlayerId" {
                assert_ne!(
                    response,
                    advise(&first_only.to_string()),
                    "the observer must use the last value"
                );
            }
        }
    }

    #[test]
    fn typed_parse_matches_reference_on_raw_literals() {
        let request = fixture("standard4-11-turn");
        for (path, literal) in [
            ("/game/board/hexes/0/tile", r#"{"wood":null}"#),
            ("/game/board/buildings/0/tier", r#"{"city":null}"#),
            ("/game/board/layout", r#"{"standard4":null}"#),
        ] {
            let source = with_raw_literal(&request, path, literal);
            assert_equivalent(&format!("enum object {path}"), &source);
        }
        for path in [
            "/game/schemaVersion",
            "/game/board/schemaVersion",
            "/game/board/hexes/0/numberToken",
            "/game/board/ports/0/rate",
            "/game/board/hexes/0/coord/q",
            "/game/board/hexes/0/coord/r",
            "/game/board/robber/q",
            "/game/board/robber/r",
        ] {
            for literal in ["-0", "6.0", "6e0", "1E1", "18446744073709551616", "1.0"] {
                let source = with_raw_literal(&request, path, literal);
                assert_equivalent(&format!("number {path}: {literal}"), &source);
            }
        }
        let object = request["game"]["board"]["players"][0].to_string();
        let escaped_key = object.replacen(r#""name":"#, r#""\u006eame":"#, 1);
        assert_ne!(object, escaped_key);
        let source = with_raw_literal(&request, "/game/board/players/0", &escaped_key);
        assert_eq!(
            assert_equivalent("escaped key", &source),
            advise(&request.to_string())
        );

        let source = with_raw_literal(&request, "/game/board/players/0/name", r#""R\u0065d""#);
        let mut decoded = request.clone();
        decoded["game"]["board"]["players"][0]["name"] = json!("Red");
        assert_eq!(
            assert_equivalent("escaped string", &source),
            advise(&decoded.to_string())
        );

        let source = with_raw_literal(&request, "/game/board/players/0/name", r#""\ud800""#);
        let response: Value =
            serde_json::from_str(&assert_equivalent("lone surrogate", &source)).unwrap();
        assert!(response["error"].is_string());
    }

    #[test]
    fn board_validation_keeps_error_order() {
        let request = fixture("standard4-11-turn");
        let board = &request["game"]["board"];
        let topology = Topology::shared(crate::topology::Layout::Standard4).unwrap();
        let inland = (0..topology.edge_count())
            .map(|edge| edge as u8)
            .find(|edge| !topology.coastal_edges().contains(edge))
            .unwrap();
        for (path, value, expected) in [
            ("/schemaVersion", json!(2), "unsupported schemaVersion"),
            ("/hexes", json!([]), "hex set does not match layout"),
            (
                "/hexes/0/coord",
                json!({"q":99,"r":99}),
                "hex set does not match layout",
            ),
            (
                "/hexes/0/coord",
                board["hexes"][1]["coord"].clone(),
                "hex set does not match layout",
            ),
            (
                "/ports/0/edgeId",
                json!("missing"),
                "unknown port edge missing",
            ),
            (
                "/ports/0/edgeId",
                json!(topology.edge_id(inland)),
                "ports must be unique and coastal",
            ),
            (
                "/ports/1/edgeId",
                board["ports"][0]["edgeId"].clone(),
                "ports must be unique and coastal",
            ),
            (
                "/players",
                json!([]),
                "Board must contain one to six unique players",
            ),
            (
                "/players",
                json!(vec![board["players"][0].clone(); 7]),
                "Board must contain one to six unique players",
            ),
            (
                "/players/1/id",
                board["players"][0]["id"].clone(),
                "Board must contain one to six unique players",
            ),
            (
                "/mePlayerId",
                json!("missing"),
                "mePlayerId is not in the roster",
            ),
            (
                "/roads/0/edgeId",
                json!("missing"),
                "unknown road edge missing",
            ),
            (
                "/roads/1/edgeId",
                board["roads"][0]["edgeId"].clone(),
                "duplicate road edge",
            ),
            ("/roads/0/playerId", json!("missing"), "unknown road owner"),
            (
                "/buildings/0/vertexId",
                json!("missing"),
                "unknown building vertex missing",
            ),
            (
                "/buildings/1/vertexId",
                board["buildings"][0]["vertexId"].clone(),
                "duplicate building vertex",
            ),
            (
                "/buildings/0/playerId",
                json!("missing"),
                "unknown building owner",
            ),
        ] {
            let mut changed = board.clone();
            *changed.pointer_mut(path).unwrap() = value;

            // A later failure must not replace the first validation error.
            changed["robber"] = json!({"q":99,"r":99});
            assert_eq!(
                WireBoard::parse_value(changed.clone())
                    .unwrap_err()
                    .to_string(),
                expected,
                "{path}"
            );
            assert_eq!(
                WireBoard::parse_str(&changed.to_string())
                    .unwrap_err()
                    .to_string(),
                expected,
                "{path}"
            );
        }
    }

    #[test]
    fn typed_parse_matches_reference_on_fixtures_and_mutations() {
        let levels: [(&str, &[&str]); 8] = [
            (
                "/game/board",
                &[
                    "schemaVersion",
                    "layout",
                    "hexes",
                    "ports",
                    "robber",
                    "roads",
                    "buildings",
                    "players",
                    "mePlayerId",
                ],
            ),
            ("/game/board/hexes/0", &["coord", "tile", "numberToken"]),
            ("/game/board/hexes/0/coord", &["q", "r"]),
            ("/game/board/ports/0", &["edgeId", "resource", "rate"]),
            ("/game/board/robber", &["q", "r"]),
            ("/game/board/roads/0", &["edgeId", "playerId"]),
            ("/game/board/buildings/0", &["vertexId", "playerId", "tier"]),
            ("/game/board/players/0", &["id", "name", "color"]),
        ];
        for (name, request) in fixtures() {
            typed(&request.to_string())
                .unwrap()
                .game
                .board
                .validated()
                .unwrap();
            assert_equivalent(&name, &request.to_string());
            for (path, keys) in levels {
                for &key in keys {
                    let mut changed = request.clone();
                    changed
                        .pointer_mut(path)
                        .unwrap()
                        .as_object_mut()
                        .unwrap()
                        .remove(key);
                    assert_equivalent(
                        &format!("{name}: missing {path}/{key}"),
                        &changed.to_string(),
                    );

                    let mut changed = request.clone();
                    changed.pointer_mut(path).unwrap()[key] = json!(false);
                    assert_equivalent(
                        &format!("{name}: wrong type {path}/{key}"),
                        &changed.to_string(),
                    );
                }
                let mut changed = request.clone();
                changed.pointer_mut(path).unwrap()["unexpected"] = json!(0);
                assert_equivalent(&format!("{name}: unknown key {path}"), &changed.to_string());
            }
            for path in [
                "/game/board/hexes/0/tile",
                "/game/board/hexes/0/numberToken",
                "/game/board/ports/0/resource",
                "/game/board/robber",
                "/game/board/mePlayerId",
                "/game/awards",
                "/game/awards/longestRoad",
                "/game/awards/largestArmy",
                "/game/turn/rolled",
                "/game/devHand",
                "/game/turn",
                "/observer",
            ] {
                let mut changed = request.clone();
                let (parent, key) = path.rsplit_once('/').unwrap();
                let Some(parent) = changed.pointer_mut(parent) else {
                    continue;
                };
                parent[key] = Value::Null;
                assert_equivalent(&format!("{name}: null {path}"), &changed.to_string());
            }
            for path in ["/game/schemaVersion", "/game/board/schemaVersion"] {
                let mut changed = request.clone();
                *changed.pointer_mut(path).unwrap() = json!(2);
                assert_equivalent(&format!("{name}: {path} 2"), &changed.to_string());
            }
            let mut missing = request.clone();
            missing["game"].as_object_mut().unwrap().remove("board");
            assert_equivalent(&format!("{name}: missing game.board"), &missing.to_string());

            for player_id in [
                json!("someone else"),
                request["game"]["board"]["mePlayerId"].clone(),
            ] {
                let mut changed = request.clone();
                changed["game"]["devHand"] = json!({"playerId":player_id,"playable":false});
                assert_equivalent(
                    &format!("{name}: malformed devHand {player_id}"),
                    &changed.to_string(),
                );
            }

            // Derived structs accept sequences, but the board presence check requires objects.
            for (path, keys) in levels {
                let mut changed = request.clone();
                let object = changed.pointer_mut(path).unwrap();
                *object = keys.iter().map(|key| object[*key].clone()).collect();
                assert_equivalent(&format!("{name}: sequence {path}"), &changed.to_string());
            }
        }
        for source in ["not JSON", "", "{", "null", "{}", "[]", "{} trailing"] {
            assert_equivalent(source, source);
        }
    }
}
