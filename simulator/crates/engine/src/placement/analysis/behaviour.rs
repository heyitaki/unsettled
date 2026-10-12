//! What Best picks promises, each promise asserted on a board built for it.
//!
//! These carry the tests the TypeScript analysis had when this engine replaced it, on the same
//! boards: `analyze.test.ts`, `targetPick.test.ts`, `likelyGoneParity.test.ts`, `fixture.test.ts`
//! and `secondSettlementGrant.test.ts` of `src/engine/__tests__` at commit `4f911f77`.

use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;

use serde_json::{Value, json};

use super::rank::{PreWindow, rank_candidates};
use super::window::{Context, PAIR_TIE, Turn};
use super::*;
use crate::placement::expansion;
use crate::topology::Layout;

const RESOURCES: [&str; 5] = ["wood", "sheep", "wheat", "brick", "ore"];
const TOKENS: [u64; 10] = [6, 8, 5, 9, 4, 10, 3, 11, 2, 12];
/// A coastal edge and the end of it that touches one land hex, `-2,0`.
const PORT_EDGE: &str = "e:-3,0;-2,0";
const PORT_VERTEX: &str = "v:-3,0;-2,-1;-2,0";
/// Two vertices a road apart on one hex ring: legal together, each inside the other's reach.
const RING_VERTEX: &str = "v:-1,-1;-1,0;0,-1";
const RING_NEIGHBOUR: &str = "v:-1,0;-1,1;0,0";

fn topology() -> &'static Topology {
    Topology::shared(Layout::Standard4).unwrap()
}

fn vertex(id: &str) -> Vertex {
    topology()
        .vertex_by_id(id)
        .unwrap_or_else(|| panic!("no vertex {id}"))
}

fn vertex_id(vertex: Vertex) -> &'static str {
    topology().vertex_id(vertex)
}

/// The app's `createBoard('standard4')` with `seats` players: `aki` first and claimed, then `p2`
/// and up, every tile blank, no robber, and a 3:1 port on each default port edge.
fn blank_board(seats: usize) -> Value {
    let topology = topology();
    let hexes: Vec<Value> = (0..topology.hex_count())
        .map(|hex| {
            let (q, r) = topology.hex_key(hex as Hex).split_once(',').unwrap();
            let coord = json!({ "q": q.parse::<i64>().unwrap(), "r": r.parse::<i64>().unwrap() });
            json!({ "coord": coord, "tile": null, "numberToken": null })
        })
        .collect();
    let ports: Vec<Value> = topology
        .default_port_edges()
        .iter()
        .map(|edge| json!({ "edgeId": topology.edge_id(*edge), "resource": null, "rate": 3 }))
        .collect();
    let players: Vec<Value> = (1..=seats)
        .map(|seat| {
            let id = if seat == 1 {
                "aki".to_owned()
            } else {
                format!("p{seat}")
            };
            json!({ "id": id, "name": id, "color": "#333333" })
        })
        .collect();
    json!({
        "schemaVersion": 1,
        "layout": "standard4",
        "hexes": hexes,
        "ports": ports,
        "robber": null,
        "roads": [],
        "buildings": [],
        "players": players,
        "mePlayerId": "aki",
    })
}

/// `board.hexes` is in the topology's hex order, so a hex index is its place in the list.
fn set_tile(board: &mut Value, hex: usize, tile: &str, token: u64) {
    board["hexes"][hex]["tile"] = tile.into();
    board["hexes"][hex]["numberToken"] = token.into();
}

fn set_tile_at(board: &mut Value, (q, r): (i64, i64), tile: &str, token: u64) {
    let hex = topology().hex_by_key(&format!("{q},{r}")).unwrap();
    set_tile(board, usize::from(hex), tile, token);
}

/// A board with every hex producing: the resource and the token follow the hex index, shifted by
/// `pattern`, so each pattern is another map.
fn filled_board(seats: usize, pattern: usize) -> Value {
    let mut board = blank_board(seats);
    for hex in 0..topology().hex_count() {
        let resource = RESOURCES[(hex * 3 + pattern * 7 + hex / 3) % RESOURCES.len()];
        set_tile(
            &mut board,
            hex,
            resource,
            TOKENS[(hex * 7 + pattern * 3) % TOKENS.len()],
        );
    }
    board
}

/// A two-seat board with no port but a 2:1 for `resource` on `PORT_EDGE`, and only `tiles` laid.
fn port_board(resource: &str, tiles: &[((i64, i64), &str, u64)]) -> Value {
    let mut board = blank_board(2);
    for (coord, tile, token) in tiles {
        set_tile_at(&mut board, *coord, tile, *token);
    }
    board["ports"] = json!([{ "edgeId": PORT_EDGE, "resource": resource, "rate": 2 }]);
    board
}

fn with_me(mut board: Value, player: &str) -> Value {
    board["mePlayerId"] = player.into();
    board
}

fn with_settlement(mut board: Value, vertex_id: &str, player: &str) -> Value {
    board["buildings"].as_array_mut().unwrap().push(json!({
        "vertexId": vertex_id,
        "playerId": player,
        "tier": "settlement",
    }));
    board
}

/// The board with every `takenBeforeFirstPick` entry of `taken` played as a settlement.
fn play_out(board: &Value, taken: &[Value]) -> Value {
    taken.iter().fold(board.clone(), |next, entry| {
        with_settlement(next, text(&entry["vertexId"]), text(&entry["playerId"]))
    })
}

fn weights_file(name: &str) -> Value {
    let path = format!("{}/../../placement/{name}.json", env!("CARGO_MANIFEST_DIR"));
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

/// `default-weights.json` with `changes` laid over it.
fn default_weights_with(changes: Value) -> Value {
    let mut weights = weights_file("default-weights");
    for (key, value) in changes.as_object().unwrap() {
        weights[key] = value.clone();
    }
    weights
}

fn engine_weights(weights: &Value) -> EngineWeights {
    serde_json::from_value(weights.clone()).unwrap()
}

/// The engine's response for `board`, beside every progress fraction it reported.
fn analysis_with_progress(
    board: &Value,
    target_pick: Option<u64>,
    options: Value,
) -> (Value, Vec<f64>) {
    let request = json!({ "board": board, "targetPick": target_pick, "options": options });
    let mut fractions = Vec::new();
    let response: Value = serde_json::from_str(&analyze(&request.to_string(), &mut |fraction| {
        fractions.push(fraction)
    }))
    .unwrap();
    assert!(response.get("error").is_none(), "{response}");
    (response, fractions)
}

fn analysis(board: &Value, target_pick: Option<u64>, options: Value) -> Value {
    analysis_with_progress(board, target_pick, options).0
}

/// A ranking with one rollout, which is the modal line alone, and every candidate listed.
fn modal_analysis(board: &Value) -> Value {
    analysis(board, None, json!({ "rollouts": 1, "maxResults": 54 }))
}

fn list<'a>(value: &'a Value, key: &str) -> &'a [Value] {
    value[key]
        .as_array()
        .unwrap_or_else(|| panic!("no list {key} in {value}"))
}

fn text(value: &Value) -> &str {
    value
        .as_str()
        .unwrap_or_else(|| panic!("{value} is not text"))
}

fn number(value: &Value) -> f64 {
    value
        .as_f64()
        .unwrap_or_else(|| panic!("{value} is not a number"))
}

fn recommendations(analysis: &Value) -> &[Value] {
    list(analysis, "recommendations")
}

fn recommendation<'a>(analysis: &'a Value, vertex_id: &str) -> Option<&'a Value> {
    recommendations(analysis)
        .iter()
        .find(|entry| entry["firstPick"] == vertex_id)
}

fn taken(analysis: &Value) -> &[Value] {
    list(analysis, "takenBeforeFirstPick")
}

fn has_warning(analysis: &Value, warning: &str) -> bool {
    list(analysis, "warnings")
        .iter()
        .any(|entry| entry == warning)
}

/// The remaining pick indices that fall to `player`.
fn remaining_picks_of(analysis: &Value, player: &str) -> Vec<u64> {
    let draft = &analysis["draft"];
    list(draft, "remainingPickIndices")
        .iter()
        .map(|index| index.as_u64().unwrap())
        .filter(|index| draft["sequence"][*index as usize] == player)
        .collect()
}

fn close(actual: f64, expected: f64, tolerance: f64) -> bool {
    (actual - expected).abs() <= tolerance
}

/// Twin of the app's `vertexProduction`: pips by resource over the tiled hexes the vertex touches.
fn production(board: &Value, vertex_id: &str) -> BTreeMap<String, u64> {
    let touching: Vec<&str> = vertex_id["v:".len()..].split(';').collect();
    let mut result = BTreeMap::new();
    for hex in list(board, "hexes") {
        let key = format!("{},{}", hex["coord"]["q"], hex["coord"]["r"]);
        let Some(tile) = hex["tile"].as_str().filter(|tile| *tile != "desert") else {
            continue;
        };
        if touching.contains(&key.as_str()) {
            let pips = hex["numberToken"]
                .as_u64()
                .map_or(0, |token| 6 - token.abs_diff(7));
            *result.entry(tile.to_owned()).or_insert(0) += pips;
        }
    }
    result
}

fn parse(board: &Value) -> Board {
    Board::from_wire(&WireBoard::parse_value(board.clone()).unwrap()).unwrap()
}

/// Owner tags with each listed vertex under its seat and nothing else standing.
fn owners(settled: &[(Vertex, u8)]) -> Vec<u8> {
    let mut vertex_owner = vec![EMPTY; topology().vertex_count()];
    for (vertex, seat) in settled {
        vertex_owner[usize::from(*vertex)] = *seat;
    }
    vertex_owner
}

/// Twin of `blockedVertices`: every vertex the distance rule bars once `settled` stand.
fn barred(settled: &[Vertex]) -> Vec<bool> {
    let mut blocked = vec![false; topology().vertex_count()];
    for vertex in settled {
        window::block_vertex(topology(), &mut blocked, *vertex);
    }
    blocked
}

fn all_barred_but(open: &[Vertex]) -> Vec<bool> {
    (0..topology().vertex_count())
        .map(|vertex| !open.contains(&(vertex as Vertex)))
        .collect()
}

/// None of these boards has a road.
fn no_roads() -> Vec<u8> {
    vec![EMPTY; topology().edge_count()]
}

fn holding(scorer: &AppFormulaScorer, vertices: &[Vertex]) -> Holdings {
    let mut holdings = Holdings::empty();
    for vertex in vertices {
        scorer.add_to_holdings(&mut holdings, *vertex);
    }
    holdings
}

/// What `candidate` scores for `seat` on the scorer's reference path, among the settlements in
/// `vertex_owner`.
fn total(
    scorer: &AppFormulaScorer,
    holdings: &Holdings,
    vertex_owner: &[u8],
    seat: u8,
    candidate: Vertex,
    receives_grant: bool,
) -> f64 {
    scorer
        .marginal_parts(
            holdings,
            vertex_owner,
            &no_roads(),
            seat,
            candidate,
            receives_grant,
        )
        .1
}

fn walk(
    scorer: &AppFormulaScorer,
    holdings: &Holdings,
    vertex_owner: &[u8],
    seat: u8,
    candidate: Vertex,
) -> expansion::ExpansionValue {
    expansion::term(scorer, holdings, vertex_owner, &no_roads(), seat, candidate)
}

/// Plays `turns` with every uniform 0, which is the modal line, and returns the vertices taken.
fn modal_window(
    context: &Context<'_>,
    turns: &[Turn],
    holdings: &[Holdings],
    mut blocked: Vec<bool>,
    mut vertex_owner: Vec<u8>,
) -> Vec<Vertex> {
    context
        .simulate_window(
            turns,
            holdings,
            &mut blocked,
            &mut vertex_owner,
            &mut || 0.0,
            None,
        )
        .taken
}

fn first_pick(seat: u8) -> Turn {
    Turn {
        seat,
        receives_grant: false,
        has_later_pick: true,
    }
}

/// A pre-window as `rank_candidates` reads one: the board's pieces and holdings with `taken` on
/// top, each pick under its seat, and every uniform 0.
fn pre_window(
    board: &Board,
    scorer: &AppFormulaScorer,
    blocked: Vec<bool>,
    taken: &[(Vertex, u8)],
) -> PreWindow {
    let (mut vertex_owner, _) = board.owners();
    let mut holdings = board.holdings(scorer);
    for (vertex, seat) in taken {
        vertex_owner[usize::from(*vertex)] = *seat;
        scorer.add_to_holdings(&mut holdings[usize::from(*seat)], *vertex);
    }
    PreWindow {
        blocked,
        vertex_owner,
        holdings,
        taken: taken.iter().map(|(vertex, _)| *vertex).collect(),
        pickers: taken.iter().map(|(_, seat)| *seat).collect(),
        uniforms: vec![0.0; 2 * board.player_ids.len()],
    }
}

/// `rank_candidates` over hand-built pre-windows, with every candidate listed.
fn rank_windows(
    board: &Board,
    scorer: &AppFormulaScorer,
    draft: &DraftState,
    pre_windows: &[PreWindow],
) -> (Vec<Recommendation>, Vec<TakenVertex>) {
    let context = Context::new(board, scorer);
    let legal = board.legal_vertices();
    rank_candidates(
        &context,
        board,
        draft,
        &legal,
        pre_windows,
        54.0,
        0,
        &mut |_| {},
    )
}

fn ranked<'a>(recommendations: &'a [Recommendation], candidate: Vertex) -> &'a Recommendation {
    recommendations
        .iter()
        .find(|entry| entry.first_pick == vertex_id(candidate))
        .unwrap_or_else(|| panic!("{} is not listed", vertex_id(candidate)))
}

struct PairPick {
    pick: Vertex,
    /// The partner the pick is priced with, `None` when no legal vertex is clear of it.
    mate: Option<Vertex>,
    /// The vertex that scores highest alone.
    greedy: Vertex,
    /// Every vertex's score alone, by vertex index.
    own: Vec<f64>,
}

/// The pair rule `opponent_pick` prices a first settlement by, written out against the scorer's
/// reference entries: a candidate's own score plus the best legal partner's, the partner read
/// without its expansion component holding the candidate and with its expansion against the
/// standing settlements; of two candidates that are each other's best partner only the one worth
/// more alone is a candidate, unless the grant makes one orientation of the pair worth more than
/// the other, in which case that orientation is. Ties fall to index order.
fn pair_aware_pick(
    scorer: &AppFormulaScorer,
    seat: u8,
    blocked: &[bool],
    vertex_owner: &[u8],
) -> PairPick {
    let topology = topology();
    let empty = Holdings::empty();
    let scale = scorer.slot_scale(seat);
    let legal: Vec<Vertex> = (0..topology.vertex_count())
        .filter(|vertex| !blocked[*vertex])
        .map(|vertex| vertex as Vertex)
        .collect();
    let own: Vec<f64> = legal
        .iter()
        .map(|candidate| total(scorer, &empty, vertex_owner, seat, *candidate, false))
        .collect();
    let expansion: Vec<f64> = legal
        .iter()
        .map(|candidate| {
            scale.expansion * walk(scorer, &empty, vertex_owner, seat, *candidate).value
        })
        .collect();
    let plans: Vec<(Option<usize>, f64)> = legal
        .iter()
        .enumerate()
        .map(|(index, candidate)| {
            let holdings = holding(scorer, &[*candidate]);
            let holdings_total = scorer.holdings_diversity_total(&holdings);
            let mut mate = None;
            let mut best = f64::NEG_INFINITY;
            for (other, partner) in legal.iter().enumerate() {
                if other == index || topology.vertex_adjacent(*candidate).contains(partner) {
                    continue;
                }
                let value = scorer.scaled_total_with_diversity(
                    holdings,
                    *partner,
                    true,
                    scale.diversity,
                    holdings_total,
                ) + expansion[other];
                if value > best {
                    best = value;
                    mate = Some(other);
                }
            }
            (
                mate,
                if mate.is_some() {
                    own[index] + best
                } else {
                    own[index]
                },
            )
        })
        .collect();
    let mut candidates: Vec<usize> = (0..legal.len())
        .filter(|index| {
            let (mate, score) = plans[*index];
            let Some(mate) = mate.filter(|mate| plans[*mate].0 == Some(*index)) else {
                return true;
            };
            let gap = score - plans[mate].1;
            if gap.abs() > PAIR_TIE {
                return gap > 0.0;
            }
            own[mate] < own[*index] || (own[mate] == own[*index] && *index < mate)
        })
        .collect();
    // Stable, so equal scores stay in index order.
    candidates.sort_by(|a, b| plans[*b].1.partial_cmp(&plans[*a].1).unwrap());
    let top = candidates[0];
    let highest = own.iter().copied().fold(f64::NEG_INFINITY, f64::max);
    let mut by_vertex = vec![f64::NAN; topology.vertex_count()];
    for (candidate, score) in legal.iter().zip(&own) {
        by_vertex[usize::from(*candidate)] = *score;
    }
    PairPick {
        pick: legal[top],
        mate: plans[top].0.map(|mate| legal[mate]),
        greedy: legal[own.iter().position(|score| *score == highest).unwrap()],
        own: by_vertex,
    }
}

fn cached_rankings() -> usize {
    NESTED_RANKINGS.with(|cache| cache.borrow().len())
}

/// Runs `action` with the nested-ranking cache borrowed, which is the cache switched off.
fn without_cache<T>(action: impl FnOnce() -> T) -> T {
    NESTED_RANKINGS.with(|cache| {
        let _held = cache.borrow_mut();
        action()
    })
}

#[test]
fn the_roster_size_picks_the_weights() {
    let with = |board: &Value, weights: Option<Value>| {
        let mut options = json!({ "rollouts": 2 });
        if let Some(weights) = weights {
            options["weights"] = weights;
        }
        analysis(board, None, options)
    };
    // Three seats ship their own vector, and it is not the default one.
    let board = filled_board(3, 0);
    let shipped = with(&board, None);
    assert_eq!(
        shipped,
        with(&board, Some(weights_file("seat-weights/seats-3")))
    );
    assert_ne!(shipped, with(&board, Some(weights_file("default-weights"))));
    // A roster size with no vector of its own takes the defaults.
    let solo = filled_board(1, 0);
    assert_eq!(
        with(&solo, None),
        with(&solo, Some(weights_file("default-weights")))
    );

    // The length of the list is one of the weights.
    assert!(recommendations(&shipped).len() > 1);
    let mut one = weights_file("seat-weights/seats-3");
    one["maxResults"] = 1.into();
    assert_eq!(recommendations(&with(&board, Some(one))).len(), 1);
}

#[test]
fn survival_aware_ranking_beats_the_naive_top_two_plan() {
    // Some map has to show it: the vertex scoring highest alone is not the top recommendation,
    // because the rival takes the second half of the naive plan once the first stands.
    let witness = (0..80).any(|pattern| {
        let json = filled_board(2, pattern);
        let board = parse(&json);
        let scorer = board.scorer(weights_for_seats(2).clone());
        let nobody = owners(&[]);
        let mut singles: Vec<(Vertex, f64)> = board
            .legal_vertices()
            .into_iter()
            .map(|candidate| {
                (
                    candidate,
                    total(&scorer, &Holdings::empty(), &nobody, 0, candidate, false),
                )
            })
            .collect();
        singles.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());
        let (first, second) = (singles[0], singles[1]);
        let context = Context::new(&board, &scorer);
        let rival_takes = modal_window(
            &context,
            &[
                first_pick(1),
                Turn {
                    seat: 1,
                    receives_grant: true,
                    has_later_pick: false,
                },
            ],
            &board.holdings(&scorer),
            barred(&[first.0]),
            owners(&[(first.0, 0)]),
        );
        let analysis = modal_analysis(&json);
        let top = &recommendations(&analysis)[0];
        let Some(naive) = recommendation(&analysis, vertex_id(first.0)) else {
            return false;
        };
        top["firstPick"] != naive["firstPick"]
            && number(&top["rankScore"]) > number(&naive["rankScore"]) + 0.5
            && rival_takes.contains(&second.0)
            && number(&naive["score"]) < first.1 + second.1
    });
    assert!(witness, "no map of 80 has the ranking beat the naive plan");
}

#[test]
fn a_ranking_is_deterministic_and_one_rollout_is_the_greedy_line() {
    let board = with_me(filled_board(3, 4), "p2");
    let first = analysis(&board, None, json!({ "seed": 41 }));
    assert_eq!(recommendations(&first).len(), 8);
    // Ranked again from nothing, not read back from the nested rankings the first call kept.
    forget_nested_rankings();
    assert_eq!(analysis(&board, None, json!({ "seed": 41 })), first);

    let greedy = analysis(&board, None, json!({ "seed": 41, "rollouts": 1 }));
    assert!(!recommendations(&greedy).is_empty() && !taken(&greedy).is_empty());
    assert!(
        recommendations(&greedy)
            .iter()
            .all(|entry| entry["survival"] == 1.0)
    );
    assert!(taken(&greedy).iter().all(|entry| entry["frequency"] == 1.0));
}

#[test]
fn mirror_image_candidates_score_alike_under_common_random_numbers() {
    // Every hex the same and no port, so the two ends of the board's long axis are one spot.
    let mut board = blank_board(2);
    board["ports"] = json!([]);
    for hex in 0..topology().hex_count() {
        set_tile(&mut board, hex, "wood", 6);
    }
    let analysis = analysis(&board, None, json!({ "maxResults": 54 }));
    let left = recommendation(&analysis, PORT_VERTEX).unwrap();
    let right = recommendation(&analysis, "v:2,0;2,1;3,0").unwrap();
    assert!(close(
        number(&left["survival"]),
        number(&right["survival"]),
        5e-13
    ));
    assert!(close(
        number(&left["score"]),
        number(&right["score"]),
        5e-13
    ));
}

#[test]
fn production_and_diversity_beat_a_port_monopoly_and_a_matched_port_still_counts() {
    // Strong, balanced production across the map beside a wood 2:1 port on a wood hex. A port
    // supplements production and never replaces a hex of it.
    let balanced = port_board(
        "wood",
        &[
            ((-2, 0), "wood", 6),
            ((1, -2), "brick", 6),
            ((2, -2), "sheep", 8),
            ((-2, 2), "wheat", 6),
            ((-1, 2), "ore", 8),
        ],
    );
    let analysis = modal_analysis(&balanced);
    let pair_resources = |entry: &Value| -> BTreeSet<String> {
        let second = list(entry, "plannedSecond").first();
        std::iter::once(&entry["firstPick"])
            .chain(second)
            .flat_map(|vertex_id| production(&balanced, text(vertex_id)).into_keys())
            .collect()
    };
    let top = &recommendations(&analysis)[0];
    let wood_only = BTreeSet::from(["wood".to_owned()]);
    assert!(pair_resources(top).len() >= 2);
    assert!(number(&top["breakdown"]["production"]) > number(&top["breakdown"]["port"]));
    for entry in recommendations(&analysis) {
        if pair_resources(entry) == wood_only {
            assert!(number(&top["rankScore"]) > number(&entry["rankScore"]));
        }
    }

    // A matched 2:1 port earns credit when real surplus production feeds it.
    let matched = port_board(
        "wheat",
        &[
            ((-2, 0), "wheat", 6),
            ((1, -2), "brick", 5),
            ((2, -2), "sheep", 4),
            ((-1, 2), "ore", 5),
        ],
    );
    let analysis = modal_analysis(&matched);
    let on_port = recommendation(&analysis, PORT_VERTEX).unwrap();
    assert!(number(&on_port["breakdown"]["port"]) > 0.0);
}

#[test]
fn strong_production_near_a_matching_port_beats_sitting_on_it() {
    // Three wheat hexes inland of a wheat 2:1 port. The port vertex touches one of them, so the
    // strong spot is two road-builds away.
    let json = port_board(
        "wheat",
        &[
            ((-2, 0), "wheat", 6),
            ((-1, 0), "wheat", 8),
            ((-1, 1), "wheat", 5),
            ((1, -2), "brick", 4),
            ((2, -2), "sheep", 10),
            ((-1, 2), "ore", 4),
        ],
    );
    let (inland, on_port, one_road) = ("v:-2,0;-1,-1;-1,0", PORT_VERTEX, "v:-2,-1;-2,0;-1,-1");
    // The production these ids are assumed to carry, so a grid re-key fails here.
    let wheat = |pips| BTreeMap::from([("wheat".to_owned(), pips)]);
    assert_eq!(production(&json, inland), wheat(10));
    assert_eq!(production(&json, on_port), wheat(5));
    assert_eq!(production(&json, one_road), wheat(5));

    let board = parse(&json);
    let scorer = board.scorer(weights_for_seats(2).clone());
    let nobody = owners(&[]);
    let score = |id: &str| total(&scorer, &Holdings::empty(), &nobody, 0, vertex(id), false);
    let port = |id: &str| {
        let empty = Holdings::empty();
        scorer
            .marginal_breakdown(&empty, &nobody, &no_roads(), 0, vertex(id), false)
            .port
    };
    // The port reaches the inland spot, and production wins: double the wheat beats holding the
    // port outright.
    assert!(port(inland) > 0.0);
    assert!(score(inland) > score(on_port));
    // Reach decays with distance, so equal production prefers the closer access.
    assert!(port(on_port) > port(one_road));
    assert!(score(on_port) > score(one_road));
}

#[test]
fn a_seat_ahead_prices_its_first_settlement_as_a_pair() {
    let json = with_me(filled_board(5, 3), "p4");
    let analysis = modal_analysis(&json);
    assert_eq!(analysis["status"], "ready");
    let board = parse(&json);
    let scorer = board.scorer(weights_for_seats(5).clone());
    let expected = pair_aware_pick(&scorer, 0, &barred(&[]), &owners(&[]));
    // aki picks first and again last, so its first settlement is worth the pair it leads to. On
    // this board that is not the vertex that scores best alone, which is what makes the case bite.
    assert_ne!(expected.pick, expected.greedy);
    // Asked of the window itself: the likely-gone line takes aki's own ranking, not this shortcut.
    let context = Context::new(&board, &scorer);
    let window = modal_window(
        &context,
        &[first_pick(0)],
        &board.holdings(&scorer),
        barred(&[]),
        owners(&[]),
    );
    assert_eq!(window, [expected.pick]);
    assert_eq!(taken(&analysis)[0]["playerId"], "aki");
    assert!(
        recommendations(&analysis)
            .iter()
            .all(|entry| number(&entry["survival"]) > 0.0)
    );
}

#[test]
fn every_first_settlement_of_a_window_is_priced_as_a_pair() {
    let board = parse(&filled_board(4, 3));
    let scorer = board.scorer(weights_for_seats(4).clone());
    let context = Context::new(&board, &scorer);
    let turns: Vec<Turn> = (0..3).map(first_pick).collect();
    let window = modal_window(
        &context,
        &turns,
        &board.holdings(&scorer),
        barred(&[]),
        owners(&[]),
    );
    assert_eq!(window.len(), 3);
    let mut standing: Vec<(Vertex, u8)> = Vec::new();
    for (turn, vertex) in window.iter().enumerate() {
        let settled: Vec<Vertex> = standing.iter().map(|(vertex, _)| *vertex).collect();
        let expected = pair_aware_pick(&scorer, turn as u8, &barred(&settled), &owners(&standing));
        assert_eq!(*vertex, expected.pick, "turn {turn}");
        // The half of the pair the pick leaves for later is the one worth less alone.
        assert!(expected.mate.is_some(), "turn {turn}");
        if turn == 0 {
            assert_ne!(expected.pick, expected.greedy);
        }
        standing.push((*vertex, turn as u8));
    }
}

#[test]
fn a_priced_grant_picks_the_orientation_of_a_pair_worth_more() {
    // The second settlement receives the setup grant, so with the grant priced the pair is worth
    // more in one order than the other, and that order wins over the half worth more alone.
    let board = parse(&with_me(filled_board(2, 1), "p2"));
    let weights = default_weights_with(json!({ "handValueWeight": 0.4 }));
    let scorer = board.scorer(engine_weights(&weights));
    let expected = pair_aware_pick(&scorer, 0, &barred(&[]), &owners(&[]));
    let mate = expected.mate.unwrap();
    assert!(expected.own[usize::from(expected.pick)] < expected.own[usize::from(mate)]);
    let context = Context::new(&board, &scorer);
    let window = modal_window(
        &context,
        &[first_pick(0)],
        &board.holdings(&scorer),
        barred(&[]),
        owners(&[]),
    );
    assert_eq!(window[0], expected.pick);
}

#[test]
fn a_last_pick_is_scored_on_the_settlement_already_standing() {
    let base = filled_board(2, 5);
    let scorer = parse(&base).scorer(weights_for_seats(2).clone());
    let nobody = owners(&[]);
    // My first settlement: the vertex scoring highest alone, the lowest index among equals.
    let mut existing = (0, f64::NEG_INFINITY);
    for candidate in parse(&base).legal_vertices() {
        let score = total(&scorer, &Holdings::empty(), &nobody, 0, candidate, false);
        if score > existing.1 {
            existing = (candidate, score);
        }
    }
    let json = with_settlement(base, vertex_id(existing.0), "aki");
    let analysis = modal_analysis(&json);
    assert_eq!(analysis["status"], "ready");
    assert!(
        recommendations(&analysis)
            .iter()
            .all(|entry| list(entry, "plannedSecond").is_empty())
    );
    // Seats pick ahead of this last one, so the settlements standing when it is made are the
    // board's own beside the ones the rollout took, and that is what it is scored against.
    assert!(!taken(&analysis).is_empty());
    let mut standing = vec![(existing.0, 0)];
    for entry in taken(&analysis) {
        assert_eq!(entry["playerId"], "p2");
        standing.push((vertex(text(&entry["vertexId"])), 1));
    }
    let top = &recommendations(&analysis)[0];
    let expected = total(
        &scorer,
        &holding(&scorer, &[existing.0]),
        &owners(&standing),
        0,
        vertex(text(&top["firstPick"])),
        true,
    );
    assert!(close(number(&top["score"]), expected, 1e-9));
}

#[test]
fn a_pick_i_placed_early_is_not_simulated_as_a_rivals() {
    let base = with_me(filled_board(2, 6), "p2");
    let existing = parse(&base).legal_vertices()[0];
    let json = with_settlement(base, vertex_id(existing), "p2");
    let analysis = modal_analysis(&json);
    assert!(has_warning(&analysis, "snake-inconsistent"));
    assert_eq!(analysis["draft"]["myRemainingPickIndices"], json!([2]));
    assert!(taken(&analysis).is_empty());
    // The one pick left is my second: scored on the settlement standing, with the grant.
    let scorer = parse(&json).scorer(weights_for_seats(2).clone());
    let top = &recommendations(&analysis)[0];
    let expected = total(
        &scorer,
        &holding(&scorer, &[existing]),
        &owners(&[(existing, 1)]),
        1,
        vertex(text(&top["firstPick"])),
        true,
    );
    assert!(close(number(&top["score"]), expected, 1e-9));
}

#[test]
fn a_rival_who_placed_early_has_one_pick_left_ahead_of_mine() {
    let base = filled_board(2, 6);
    let existing = parse(&base).legal_vertices()[0];
    let json = with_settlement(base, vertex_id(existing), "p2");
    let analysis = analysis(&json, None, json!({ "rollouts": 8, "maxResults": 54 }));
    assert!(has_warning(&analysis, "snake-inconsistent"));
    assert_eq!(remaining_picks_of(&analysis, "p2"), [2]);
    // The modal pre-window gives that one pick to p2, with the share of the rollouts in which
    // the same spot led the window.
    let ahead = taken(&analysis);
    assert_eq!(ahead.len(), 1);
    assert_eq!(ahead[0]["playerId"], "p2");
    let frequency = number(&ahead[0]["frequency"]);
    assert!(frequency > 0.0 && frequency <= 1.0);
}

#[test]
fn a_rival_who_placed_early_has_one_pick_left_between_mine() {
    let base = with_me(filled_board(3, 7), "p2");
    let existing = parse(&base).legal_vertices()[0];
    let json = with_settlement(base, vertex_id(existing), "p3");
    let analysis = modal_analysis(&json);
    assert!(has_warning(&analysis, "snake-inconsistent"));
    assert_eq!(remaining_picks_of(&analysis, "p3"), [3]);
    assert_eq!(analysis["draft"]["myRemainingPickIndices"], json!([1, 4]));
    assert!(!recommendations(&analysis).is_empty());

    // The window between my two picks holds p3's one remaining pick and nothing else.
    let board = parse(&json);
    let scorer = board.scorer(weights_for_seats(3).clone());
    let context = Context::new(&board, &scorer);
    let between = [Turn {
        seat: 2,
        receives_grant: true,
        has_later_pick: false,
    }];
    for entry in recommendations(&analysis) {
        let first = vertex(text(&entry["firstPick"]));
        let window = modal_window(
            &context,
            &between,
            &board.holdings(&scorer),
            barred(&[existing, first]),
            owners(&[(existing, 2), (first, 1)]),
        );
        assert_eq!(window.len(), 1);
    }
}

#[test]
fn the_first_road_is_reported_only_while_the_walk_is_on() {
    let json = filled_board(3, 4);
    let ranked_with = |weights: &Value| {
        analysis(
            &json,
            None,
            json!({ "rollouts": 1, "maxResults": 54, "weights": weights }),
        )
    };
    let silent = ranked_with(&default_weights_with(json!({ "expansionWeight": 0 })));
    assert!(!recommendations(&silent).is_empty());
    assert!(
        recommendations(&silent)
            .iter()
            .all(|entry| entry["firstRoad"].is_null())
    );

    // The shipped weight is 0.1, so the walk is on by default.
    let topology = topology();
    for weights in [
        weights_file("default-weights"),
        default_weights_with(json!({ "expansionWeight": 0.3 })),
    ] {
        let analysis = ranked_with(&weights);
        let scorer = parse(&json).scorer(engine_weights(&weights));
        // The road comes off the modal rollout, the one `takenBeforeFirstPick` is drawn from.
        // Nobody picks ahead of the first seat, so that is the bare board.
        assert!(taken(&analysis).is_empty());
        let mut with_roads = 0;
        for entry in recommendations(&analysis) {
            let Some(road) = entry["firstRoad"].as_str() else {
                continue;
            };
            with_roads += 1;
            let first = vertex(text(&entry["firstPick"]));
            let edge = topology.edge_by_id(road).unwrap();
            assert!(topology.vertex_edges(first).contains(&edge));
            assert_eq!(
                walk(&scorer, &Holdings::empty(), &owners(&[]), 0, first).road,
                Some(edge)
            );
        }
        assert!(with_roads > 0);
    }
}

/// The one-seat board the two occupancy tests below rank, its weights and its top recommendation.
fn solo_top_pick() -> (Value, Value, Value) {
    let board = filled_board(1, 0);
    let weights = default_weights_with(json!({ "expansionWeight": 0.5 }));
    let analysis = analysis(
        &board,
        None,
        json!({ "rollouts": 1, "maxResults": 54, "weights": weights }),
    );
    // A solo roster drafts alone, so nothing is taken between its two picks.
    assert_eq!(analysis["draft"]["sequence"], json!(["aki", "aki"]));
    let top = recommendations(&analysis)[0].clone();
    (board, weights, top)
}

// A rollout's `blocked` is closed under the distance rule, so it carries the neighbours of my own
// first pick beside the pick itself. Read as the occupancy, those neighbours would look like
// rivals' settlements, and the expansion walk stops dead at a rival.
#[test]
fn the_second_pick_is_priced_against_the_settlements_standing_not_the_barred_vertices() {
    let (json, weights, top) = solo_top_pick();
    let scorer = parse(&json).scorer(engine_weights(&weights));
    let first = vertex(text(&top["firstPick"]));
    let second = vertex(text(&top["plannedSecond"][0]));
    let held = holding(&scorer, &[first]);
    let settled = owners(&[(first, 0)]);
    // The other reading: my first pick's neighbours standing as a rival's.
    let mut closed = settled.clone();
    for neighbour in topology().vertex_adjacent(first) {
        closed[usize::from(*neighbour)] = 1;
    }
    let sites = |vertex_owner: &[u8]| -> BTreeSet<Vertex> {
        expansion::sites_by_edge(&scorer, vertex_owner, &no_roads(), 0, second)
            .into_iter()
            .flat_map(|(_, sites)| sites)
            .map(|site| site.vertex)
            .collect()
    };
    // Sites the walk reaches only once my own settlement's neighbours stop reading as rivals.
    assert!(sites(&settled).difference(&sites(&closed)).count() > 0);

    let first_term = walk(&scorer, &Holdings::empty(), &owners(&[]), 0, first).value;
    let second_term = walk(&scorer, &held, &settled, 0, second).value;
    assert!(second_term > walk(&scorer, &held, &closed, 0, second).value);
    assert!(close(
        number(&top["breakdown"]["expansion"]),
        first_term + second_term,
        5e-11
    ));
}

#[test]
fn both_picks_read_one_occupancy_when_the_rollout_took_nothing() {
    let (json, weights, top) = solo_top_pick();
    let scorer = parse(&json).scorer(engine_weights(&weights));
    let first = text(&top["firstPick"]);
    // The same board with my first pick standing on it, where the one pick left is scored as a
    // first pick off the board's own pieces. The second pick has to read exactly that.
    let placed = analysis(
        &with_settlement(json.clone(), first, "aki"),
        None,
        json!({ "rollouts": 1, "maxResults": 54, "weights": weights }),
    );
    let as_first_pick = recommendation(&placed, text(&top["plannedSecond"][0])).unwrap();
    let as_first_pick = number(&as_first_pick["breakdown"]["expansion"]);
    let first_term = walk(&scorer, &Holdings::empty(), &owners(&[]), 0, vertex(first)).value;
    assert!(first_term > 0.0 && as_first_pick > 0.0);
    assert!(close(
        number(&top["breakdown"]["expansion"]),
        first_term + as_first_pick,
        5e-11
    ));
}

// The next two boards have more than one seat, which is where the two occupancy readings can
// part: a solo roster takes nothing between its picks, so every set is the same set.
#[test]
fn the_first_pick_is_priced_against_the_settlements_the_rollout_took_before_it() {
    let board = parse(&filled_board(2, 0));
    let draft = infer_draft_state(&board);
    let scorer = board.scorer(engine_weights(&default_weights_with(
        json!({ "expansionWeight": 1 }),
    )));
    // The take sits inside the candidate's expansion range, so the walk has to see it.
    let (candidate, rival_take) = (vertex(RING_VERTEX), vertex(RING_NEIGHBOUR));
    let under = |vertex_owner: &[u8]| {
        total(
            &scorer,
            &Holdings::empty(),
            vertex_owner,
            0,
            candidate,
            false,
        )
    };
    assert!(under(&owners(&[(rival_take, 1)])) < under(&owners(&[])));

    // Everything else barred, so the pick has no legal second and its score is the first alone.
    let window = pre_window(
        &board,
        &scorer,
        all_barred_but(&[candidate]),
        &[(rival_take, 1)],
    );
    let (recommendations, _) = rank_windows(&board, &scorer, &draft, &[window]);
    let entry = ranked(&recommendations, candidate);
    assert!(entry.planned_second.is_empty());
    assert!(close(entry.score, under(&owners(&[(rival_take, 1)])), 1e-9));
}

// A rollout bars a vertex by the distance rule but occupies only the vertex itself. Reading the
// barred set as the occupancy would make a rival's neighbours look like rivals; forgetting to
// occupy a pick would let the next seat in the window walk straight through it.
#[test]
fn each_rollout_pick_is_scanned_against_the_settlements_standing_not_the_barred_vertices() {
    let board = parse(&filled_board(3, 0));
    let scorer = board.scorer(engine_weights(&default_weights_with(
        json!({ "expansionWeight": 1 }),
    )));
    let context = Context::new(&board, &scorer);
    let argmax = |seat: u8, blocked: &[bool], vertex_owner: &[u8]| {
        let mut best = (None, f64::NEG_INFINITY);
        for candidate in (0..topology().vertex_count()).filter(|vertex| !blocked[*vertex]) {
            let candidate = candidate as Vertex;
            let score = total(
                &scorer,
                &Holdings::empty(),
                vertex_owner,
                seat,
                candidate,
                false,
            );
            if score > best.1 {
                best = (Some(candidate), score);
            }
        }
        best.0
    };
    // Tags every barred vertex as a settlement of `seat`.
    let as_settlements = |blocked: &[bool], seat: u8| -> Vec<u8> {
        blocked
            .iter()
            .map(|barred| if *barred { seat } else { EMPTY })
            .collect()
    };

    let centre = vertex("v:0,0;1,-1;1,0");
    let before = barred(&[centre]);
    let turns = [1, 2].map(|seat| Turn {
        seat,
        receives_grant: false,
        has_later_pick: false,
    });
    let window = modal_window(
        &context,
        &turns,
        &board.holdings(&scorer),
        before.clone(),
        owners(&[]),
    );
    assert_eq!(window.len(), 2);

    // The first seat scans against an empty occupancy: nothing is settled yet, however much the
    // distance rule has barred.
    assert_eq!(Some(window[0]), argmax(1, &before, &owners(&[])));
    assert_ne!(
        Some(window[0]),
        argmax(1, &before, &as_settlements(&before, 0))
    );

    // The second seat scans against the first seat's settlement, and only that one vertex.
    let after = barred(&[centre, window[0]]);
    assert_eq!(
        Some(window[1]),
        argmax(2, &after, &owners(&[(window[0], 1)]))
    );
    assert_ne!(Some(window[1]), argmax(2, &after, &owners(&[])));
}

#[test]
fn a_seat_scores_from_its_own_index_in_the_roster() {
    // One slot's diversity is zeroed, so the seat that lands on it is the only one whose
    // recommendations come back with no diversity at all.
    let board = filled_board(3, 4);
    let diversity_of = |player: &str, slot: usize| -> Vec<f64> {
        let mut weights = weights_file("default-weights");
        weights["slotScales"]["3"][slot.to_string()] = json!({ "expansion": 1, "diversity": 0 });
        let options = json!({ "rollouts": 1, "maxResults": 54, "weights": weights });
        recommendations(&analysis(&with_me(board.clone(), player), None, options))
            .iter()
            .map(|entry| number(&entry["breakdown"]["diversity"]))
            .collect()
    };
    for (index, player) in ["aki", "p2", "p3"].into_iter().enumerate() {
        let own = diversity_of(player, index);
        assert!(
            !own.is_empty() && own.iter().all(|value| *value == 0.0),
            "{player}"
        );
        // Silencing any other slot leaves this seat's diversity where it was.
        let other = diversity_of(player, (index + 1) % 3);
        assert!(other.iter().any(|value| *value != 0.0), "{player}");
    }
}

#[test]
fn hostile_boards_report_their_status() {
    // Nothing is tiled, so nothing produces.
    assert_eq!(
        analysis(&blank_board(2), None, json!({}))["status"],
        "no-production"
    );

    let me_done = with_settlement(
        with_settlement(filled_board(3, 0), vertex_id(0), "aki"),
        vertex_id(4),
        "aki",
    );
    assert_eq!(analysis(&me_done, None, json!({}))["status"], "me-done");

    // Settlements on the first legal vertex, seat after seat, until none is legal.
    let mut complete = filled_board(2, 0);
    while let Some(next) = parse(&complete).legal_vertices().first().copied() {
        let player = if list(&complete, "buildings").len() % 2 == 0 {
            "aki"
        } else {
            "p2"
        };
        complete = with_settlement(complete, vertex_id(next), player);
    }
    assert!(list(&complete, "buildings").len() >= 4);
    assert_eq!(analysis(&complete, None, json!({}))["status"], "complete");
}

#[test]
fn a_zero_pip_port_that_feeds_off_a_holding_is_ranked() {
    let topology = topology();
    let mut json = with_me(blank_board(2), "p2");
    json["ports"] = json!([]);
    set_tile_at(&mut json, (0, 0), "wood", 6);
    let centre = topology.hex_vertices(topology.hex_by_key("0,0").unwrap());
    json = with_settlement(json, vertex_id(centre[3]), "aki");
    json = with_settlement(json, vertex_id(centre[0]), "p2");
    let port_edge = topology.coastal_edges()[0];
    let port_vertex = vertex_id(topology.edge_endpoints(port_edge)[0]);
    json["ports"] =
        json!([{ "edgeId": topology.edge_id(port_edge), "resource": "wood", "rate": 2 }]);

    // No legal vertex produces anything.
    let legal = parse(&json).legal_vertices();
    assert!(legal.contains(&vertex(port_vertex)));
    for candidate in legal {
        assert!(
            production(&json, vertex_id(candidate))
                .values()
                .all(|pips| *pips == 0)
        );
    }
    let analysis = modal_analysis(&json);
    assert!(list(&analysis, "warnings").is_empty());
    assert_eq!(analysis["status"], "ready");
    assert!(number(&recommendation(&analysis, port_vertex).unwrap()["score"]) > 0.0);
}

#[test]
fn a_first_pick_with_no_legal_second_is_scored_alone() {
    let board = parse(&filled_board(2, 0));
    let draft = infer_draft_state(&board);
    let scorer = board.scorer(weights_for_seats(2).clone());
    let candidate = 0;
    let window = pre_window(&board, &scorer, all_barred_but(&[candidate]), &[]);
    let (recommendations, _) = rank_windows(&board, &scorer, &draft, &[window]);
    let entry = ranked(&recommendations, candidate);
    assert!(entry.planned_second.is_empty());
    let alone = total(
        &scorer,
        &Holdings::empty(),
        &owners(&[]),
        0,
        candidate,
        false,
    );
    assert!(close(entry.score, alone, 1e-9));
}

// A recommendation needs one surviving window to be listed, and the modal window need not be it.
// Walking such a candidate against the modal occupancy would draw a road out of a vertex the
// window barred, towards a site a rival holds in it.
#[test]
fn the_first_road_comes_from_a_window_the_recommendation_is_placeable_in() {
    let board = parse(&filled_board(2, 0));
    let draft = infer_draft_state(&board);
    let scorer = board.scorer(engine_weights(&default_weights_with(
        json!({ "expansionWeight": 1 }),
    )));
    let candidate = vertex(RING_VERTEX);
    let road_under =
        |vertex_owner: &[u8]| walk(&scorer, &Holdings::empty(), vertex_owner, 0, candidate).road;

    // The modal window takes the far end of the road an unobstructed walk would lay. That bars
    // the candidate by the distance rule and makes a rival settlement of the site the road went
    // to, so the modal reading is both illegal and a different answer.
    let open_road = road_under(&owners(&[])).unwrap();
    let far_end = board
        .topology
        .edge_endpoints(open_road)
        .into_iter()
        .find(|end| *end != candidate)
        .unwrap();
    let modal_blocked = barred(&[far_end]);
    assert!(modal_blocked[usize::from(candidate)]);
    assert_ne!(road_under(&owners(&[(far_end, 1)])), Some(open_road));
    // The second window takes nothing and leaves the candidate the only vertex open, so the pick
    // survives there and nowhere else.
    let windows = [
        pre_window(&board, &scorer, modal_blocked, &[(far_end, 1)]),
        pre_window(&board, &scorer, all_barred_but(&[candidate]), &[]),
    ];
    let (recommendations, _) = rank_windows(&board, &scorer, &draft, &windows);
    let entry = ranked(&recommendations, candidate);
    assert_eq!(entry.survival, 0.5);
    assert_eq!(
        entry.first_road.as_deref(),
        Some(board.topology.edge_id(open_road))
    );
}

#[test]
fn the_modal_takes_keep_their_frequencies_when_nothing_survives() {
    let board = parse(&filled_board(2, 0));
    let draft = infer_draft_state(&board);
    let scorer = board.scorer(weights_for_seats(2).clone());
    let windows = [
        pre_window(&board, &scorer, all_barred_but(&[]), &[(0, 1), (1, 1)]),
        pre_window(&board, &scorer, all_barred_but(&[]), &[(0, 1)]),
    ];
    let (recommendations, taken) = rank_windows(&board, &scorer, &draft, &windows);
    assert!(recommendations.is_empty());
    // The modal window's picks in pick order, each with its picker and its share of the rollouts.
    assert_eq!(
        serde_json::to_value(&taken).unwrap(),
        json!([
            { "vertexId": vertex_id(0), "playerId": "p2", "frequency": 1.0 },
            { "vertexId": vertex_id(1), "playerId": "p2", "frequency": 0.5 },
        ])
    );
}

/// Four seats on a fully tiled board, claimed by `p2`, so the snake runs aki p2 p3 p4 p4 p3 p2
/// aki and `p2` picks at 1 and at 6.
fn second_seat_board() -> Value {
    with_me(filled_board(4, 3), "p2")
}

fn sampled() -> Value {
    json!({ "seed": 5, "rollouts": 4 })
}

fn rises_to_one(fractions: &[f64]) -> bool {
    fractions.windows(2).all(|pair| pair[0] <= pair[1])
        && fractions.first().is_some_and(|first| *first > 0.0)
        && fractions
            .last()
            .is_some_and(|last| close(*last, 1.0, 0.005))
}

#[test]
fn progress_only_rises_and_ends_at_one() {
    let board = second_seat_board();
    for target_pick in [None, Some(6)] {
        // Each target is paced from nothing held, not from the rankings the other left behind.
        forget_nested_rankings();
        let (_, fractions) = analysis_with_progress(&board, target_pick, sampled());
        assert!(
            fractions.len() > 5 && rises_to_one(&fractions),
            "{target_pick:?}: {fractions:?}"
        );
        // Six picks stand before p2's second, each a ranking of its own, so most of the bar is
        // theirs.
        if target_pick.is_some() {
            assert!(fractions.iter().filter(|fraction| **fraction < 0.9).count() > 5);
        }
    }
}

#[test]
fn rankings_already_held_leave_the_whole_bar_to_the_work_still_to_do() {
    let board = second_seat_board();
    let (first, _) = analysis_with_progress(&board, Some(6), sampled());
    let (second, fractions) = analysis_with_progress(&board, Some(6), sampled());
    assert_eq!(second, first);
    assert!(
        fractions[0] < 0.1 && rises_to_one(&fractions),
        "{fractions:?}"
    );
}

#[test]
fn a_target_that_is_my_next_pick_or_no_pick_of_mine_ranks_my_next_pick() {
    let board = second_seat_board();
    let base = analysis(&board, None, sampled());
    assert_eq!(base["status"], "ready");
    assert_eq!(analysis(&board, Some(1), sampled()), base);
    // A rival's slot, and a slot past the end of the snake.
    assert_eq!(analysis(&board, Some(0), sampled()), base);
    assert_eq!(analysis(&board, Some(99), sampled()), base);
}

#[test]
fn a_later_pick_is_ranked_behind_every_pick_before_it_my_own_included() {
    let analysis = analysis(&second_seat_board(), Some(6), sampled());
    assert_eq!(analysis["status"], "ready");
    let pickers: Vec<&str> = taken(&analysis)
        .iter()
        .map(|entry| text(&entry["playerId"]))
        .collect();
    assert_eq!(pickers, ["aki", "p2", "p3", "p4", "p4", "p3"]);
    assert!(!recommendations(&analysis).is_empty());
    // Nothing follows my last pick.
    assert!(
        recommendations(&analysis)
            .iter()
            .all(|entry| list(entry, "plannedSecond").is_empty())
    );
}

/// `p2`'s second pick ranked off the modal line alone, with every candidate listed.
fn modal_later_pick(board: &Value) -> Value {
    analysis(board, Some(6), json!({ "rollouts": 1, "maxResults": 54 }))
}

#[test]
fn a_later_pick_lists_only_spots_the_modal_line_leaves_standing() {
    let greedy = modal_later_pick(&second_seat_board());
    let line: Vec<Vertex> = taken(&greedy)
        .iter()
        .map(|entry| vertex(text(&entry["vertexId"])))
        .collect();
    let blocked = barred(&line);
    assert!(!recommendations(&greedy).is_empty());
    for entry in recommendations(&greedy) {
        assert_eq!(entry["survival"], 1.0);
        assert!(!blocked[usize::from(vertex(text(&entry["firstPick"])))]);
    }
}

#[test]
fn a_later_pick_scores_as_the_board_would_once_the_modal_line_is_played() {
    let board = second_seat_board();
    let greedy = modal_later_pick(&board);
    // Play the line out for real: it is then p2's turn at slot 6, with nothing left to simulate.
    let direct = modal_analysis(&play_out(&board, taken(&greedy)));
    assert!(taken(&direct).is_empty());
    let scores = |analysis: &Value| -> Vec<(String, f64)> {
        let mut scores: Vec<(String, f64)> = recommendations(analysis)
            .iter()
            .map(|entry| {
                (
                    text(&entry["firstPick"]).to_owned(),
                    number(&entry["score"]),
                )
            })
            .collect();
        scores.sort_by(|a, b| a.0.cmp(&b.0));
        scores
    };
    let (viewed, actual) = (scores(&greedy), scores(&direct));
    assert!(!viewed.is_empty() && viewed.len() == actual.len());
    for (viewed, actual) in viewed.iter().zip(&actual) {
        assert_eq!(viewed.0, actual.0);
        assert!(
            close(viewed.1, actual.1, 5e-10),
            "{}: {} and {}",
            viewed.0,
            viewed.1,
            actual.1
        );
    }
}

#[test]
fn the_modal_line_is_reused_across_calls_whoever_is_claimed() {
    let board = second_seat_board();
    let later = || analysis(&board, Some(6), sampled());
    let cached = later();
    assert!(cached_rankings() > 0);
    assert_eq!(cached, without_cache(later));

    // p3 first picks third: the two rankings ahead of it open the line already held.
    let held = cached_rankings();
    let third = with_me(board.clone(), "p3");
    let as_third = || analysis(&third, None, sampled());
    assert_eq!(as_third(), without_cache(as_third));
    assert_eq!(cached_rankings(), held);
}

// "Likely gone before your turn" names the spot each rival ahead of me is expected to take. The
// panel shows that same rival its own ranked list when I switch to it, so the two have to name the
// same spot: a prediction the rival's own list disagrees with is one the app does not believe.
const LIKELY_GONE_PATTERNS: std::ops::Range<usize> = 0..6;

fn few_rollouts() -> Value {
    json!({ "rollouts": 4 })
}

fn likely_gone(board: &Value, me: &str) -> Vec<Value> {
    taken(&analysis(&with_me(board.clone(), me), None, few_rollouts())).to_vec()
}

fn top_pick(board: &Value, player: &str) -> String {
    let analysis = analysis(&with_me(board.clone(), player), None, few_rollouts());
    text(&recommendations(&analysis)[0]["firstPick"]).to_owned()
}

#[test]
fn the_likely_gone_pick_of_the_seat_on_the_clock_is_its_own_top_recommendation() {
    for pattern in LIKELY_GONE_PATTERNS {
        let board = filled_board(4, pattern);
        let predicted = likely_gone(&board, "p2");
        assert_eq!(predicted.len(), 1, "pattern {pattern}");
        assert_eq!(predicted[0]["playerId"], "aki", "pattern {pattern}");
        assert_eq!(
            predicted[0]["vertexId"],
            top_pick(&board, "aki"),
            "pattern {pattern}"
        );
    }
}

#[test]
fn every_likely_gone_pick_is_its_pickers_top_recommendation_on_the_board_the_earlier_ones_leave() {
    for pattern in LIKELY_GONE_PATTERNS {
        let board = filled_board(4, pattern);
        let predicted = likely_gone(&board, "p4");
        let pickers: Vec<&str> = predicted
            .iter()
            .map(|entry| text(&entry["playerId"]))
            .collect();
        assert_eq!(pickers, ["aki", "p2", "p3"], "pattern {pattern}");
        for (index, entry) in predicted.iter().enumerate() {
            let played = play_out(&board, &predicted[..index]);
            assert_eq!(
                entry["vertexId"],
                top_pick(&played, pickers[index]),
                "pattern {pattern} pick {index}"
            );
        }
    }
}

#[test]
fn a_seat_picking_twice_in_a_row_keeps_the_order_of_its_pair() {
    for pattern in LIKELY_GONE_PATTERNS {
        let board = filled_board(4, pattern);
        let played = play_out(&board, &likely_gone(&board, "p4"));
        let predicted = likely_gone(&played, "aki");
        assert_eq!(predicted[0]["playerId"], "p4", "pattern {pattern}");
        assert_eq!(
            predicted[0]["vertexId"],
            top_pick(&played, "p4"),
            "pattern {pattern}"
        );
    }
}

// The line and the availability beside each of my picks come from the same rollouts. Were the
// sampled ones to draw a rival from some other ranking than the line's, a spot could read as
// likely gone and as my safest pick at once.
#[test]
fn a_pick_only_loses_availability_to_a_spot_on_the_rivals_own_list() {
    for pattern in LIKELY_GONE_PATTERNS {
        let board = filled_board(4, pattern);
        let top_k = weights_for_seats(4).opponent_top_k;
        let rival = analysis(&board, None, json!({ "rollouts": 12, "maxResults": top_k }));
        let rival_list: Vec<Vertex> = recommendations(&rival)
            .iter()
            .map(|entry| vertex(text(&entry["firstPick"])))
            .collect();
        assert_eq!(rival_list.len() as f64, top_k);
        let reach = barred(&rival_list);
        let mine = analysis(
            &with_me(board.clone(), "p2"),
            None,
            json!({ "rollouts": 12, "maxResults": 54 }),
        );
        for entry in recommendations(&mine) {
            if number(&entry["survival"]) < 1.0 {
                let contested = text(&entry["firstPick"]);
                assert!(
                    reach[usize::from(vertex(contested))],
                    "pattern {pattern}: {contested}"
                );
            }
        }
    }
}

#[test]
fn the_imported_draft_board_ranks_with_a_sound_structure() {
    // The parser's expected output for an empty five-player draft: three rivals pick ahead of me.
    let relative = PathBuf::from("src/parser/__tests__/expected/board-draft-empty.json");
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .map(|root| root.join(&relative))
        .find(|candidate| candidate.is_file())
        .expect("board fixture must be reachable from the worktree or sweep root");
    let board: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    let first = analysis(&board, None, json!({ "seed": 7 }));
    assert_eq!(first["status"], "ready");
    assert_eq!(list(&first["draft"], "sequence").len(), 10);
    assert_eq!(first["draft"]["myPickIndices"], json!([3, 6]));
    assert_eq!(first["draft"]["currentPlayerId"], "p1");
    let listed = recommendations(&first);
    assert!(!listed.is_empty());
    let picks: BTreeSet<&str> = listed
        .iter()
        .map(|entry| text(&entry["firstPick"]))
        .collect();
    assert_eq!(picks.len(), listed.len());
    for (index, entry) in listed.iter().enumerate() {
        let parts = &entry["breakdown"];
        let sum: f64 = [
            "production",
            "scarcity",
            "robber",
            "diversity",
            "port",
            "handValue",
            "expansion",
        ]
        .iter()
        .map(|part| number(&parts[*part]))
        .sum();
        assert!(close(sum, number(&entry["score"]), 1e-9));
        if index > 0 {
            assert!(number(&listed[index - 1]["rankScore"]) >= number(&entry["rankScore"]));
        }
    }
    forget_nested_rankings();
    assert_eq!(analysis(&board, None, json!({ "seed": 7 })), first);
}

// The second settlement of setup, and only the second, grants one resource card per adjacent
// producing hex. The shipped weight for it is 0, where every assertion on the mechanism is a
// tautology, so these price it at 0.4.
fn grant_weights() -> Value {
    default_weights_with(json!({ "handValueWeight": 0.4 }))
}

/// Two seats on a board with every hex producing, the resource and the token cycling by hex.
fn productive_board() -> Value {
    let mut board = blank_board(2);
    for hex in 0..topology().hex_count() {
        set_tile(
            &mut board,
            hex,
            RESOURCES[hex % RESOURCES.len()],
            TOKENS[hex % TOKENS.len()],
        );
    }
    board
}

/// The recommendations for `aki`'s pick at `turn` of the snake `aki, p2, p2, aki`, on a board with
/// nothing placed and nothing taken ahead: turn 0 is the first pick and turn 3 the second.
fn ranked_at_turn(json: &Value, turn: usize) -> Vec<Recommendation> {
    let board = parse(json);
    let scorer = board.scorer(engine_weights(&grant_weights()));
    let draft = DraftState {
        sequence: ["aki", "p2", "p2", "aki"].map(String::from).to_vec(),
        placed_count: turn,
        turn_index: Some(turn),
        current_player_id: Some("aki".into()),
        my_pick_indices: vec![0, 3],
        my_remaining_pick_indices: vec![turn],
        remaining_pick_indices: vec![turn],
        warnings: Vec::new(),
    };
    let window = pre_window(&board, &scorer, barred(&[]), &[]);
    rank_windows(&board, &scorer, &draft, &[window]).0
}

#[test]
fn the_grant_ships_unpriced() {
    for seats in 1..=6 {
        assert_eq!(
            weights_for_seats(seats).hand_value_weight,
            0.0,
            "{seats} seats"
        );
    }
}

#[test]
fn a_candidate_is_worth_more_as_a_second_pick_than_as_a_first() {
    let board = productive_board();
    let first = &ranked_at_turn(&board, 0)[0];
    let as_second = ranked_at_turn(&board, 3);
    let second = as_second
        .iter()
        .find(|entry| entry.first_pick == first.first_pick)
        .unwrap();
    assert!(second.score > first.score);
}

#[test]
fn the_first_pick_is_granted_nothing() {
    let first = ranked_at_turn(&productive_board(), 0);
    assert!(first.iter().all(|entry| entry.breakdown.hand_value == 0.0));
    // The top score from before the grant existed, as the walk at its shipped 0.1 moves it.
    assert!(
        close(first[0].score, 18.531650153123863, 1e-9),
        "{}",
        first[0].score
    );
}

/// The grant the rules hand out at a vertex, priced through `resourceValue`: one card per adjacent
/// hex that produces. Restated here so the test pins the modelled quantity.
fn expected_hand_value(board: &Value, vertex_id: &str) -> f64 {
    let weights = grant_weights();
    let touching: Vec<&str> = vertex_id["v:".len()..].split(';').collect();
    let mut value = 0.0;
    for hex in list(board, "hexes") {
        let key = format!("{},{}", hex["coord"]["q"], hex["coord"]["r"]);
        let produces = hex["tile"].as_str().is_some_and(|tile| tile != "desert")
            && hex["numberToken"].as_u64().is_some_and(|token| token != 7);
        if produces && touching.contains(&key.as_str()) {
            value += number(&weights["resourceValue"][text(&hex["tile"])]);
        }
    }
    value * number(&weights["handValueWeight"])
}

#[test]
fn the_second_pick_is_granted_one_card_per_adjacent_producing_hex() {
    let board = productive_board();
    let second = ranked_at_turn(&board, 3);
    assert!(!second.is_empty());
    for entry in &second {
        let expected = expected_hand_value(&board, &entry.first_pick);
        assert!(
            close(entry.breakdown.hand_value, expected, 5e-13),
            "{}",
            entry.first_pick
        );
    }
}

#[test]
fn a_desert_neighbour_grants_nothing() {
    let topology = topology();
    let producing = productive_board();
    let three_hex_vertex = (0..topology.vertex_count() as Vertex)
        .find(|vertex| topology.vertex_hexes(*vertex).len() == 3)
        .unwrap();
    let sacrificed = usize::from(topology.vertex_hexes(three_hex_vertex)[0]);
    let lost = text(&producing["hexes"][sacrificed]["tile"]).to_owned();
    let mut with_desert = producing.clone();
    with_desert["hexes"][sacrificed] = json!({ "coord": producing["hexes"][sacrificed]["coord"], "tile": "desert", "numberToken": null });

    let hand_value = |board: &Value| {
        ranked(&ranked_at_turn(board, 3), three_hex_vertex)
            .breakdown
            .hand_value
    };
    let (before, after) = (hand_value(&producing), hand_value(&with_desert));
    // Same vertex, same neighbours, one of them no longer producing: the whole difference is that
    // hex's card.
    let card = number(&grant_weights()["resourceValue"][&lost]) * 0.4;
    assert!(after < before);
    assert!(close(before - after, card, 5e-13));
}

/// Carries the occupancy tests of `valuation.test.ts`, deleted with the TypeScript formula at
/// commit `8107fc15`. The owner tags are that file's `occupancyFromBoard`: the pieces themselves,
/// with no seat in them, so one pair of arrays serves whichever seat is scored.
#[test]
fn the_owner_tags_are_the_boards_buildings_and_roads_and_nothing_else() {
    let relative = PathBuf::from("src/parser/__tests__/expected/board-endgame-pieces.json");
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .map(|root| root.join(&relative))
        .find(|candidate| candidate.is_file())
        .expect("board fixture must be reachable from the worktree or sweep root");
    let json: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    let board = parse(&json);
    let topology = board.topology;
    let (vertex_owner, edge_owner) = board.owners();
    let seat_of = |player: &Value| {
        list(&json, "players")
            .iter()
            .position(|entry| entry["id"] == *player)
            .unwrap() as u8
    };

    let buildings = list(&json, "buildings");
    assert!(!buildings.is_empty());
    assert_eq!(
        vertex_owner.iter().filter(|owner| **owner != EMPTY).count(),
        buildings.len()
    );
    for building in buildings {
        let vertex = topology.vertex_by_id(text(&building["vertexId"])).unwrap();
        assert_eq!(vertex_owner[usize::from(vertex)], seat_of(&building["playerId"]));
    }
    let roads = list(&json, "roads");
    assert!(!roads.is_empty());
    assert_eq!(
        edge_owner.iter().filter(|owner| **owner != EMPTY).count(),
        roads.len()
    );
    for road in roads {
        let edge = topology.edge_by_id(text(&road["edgeId"])).unwrap();
        assert_eq!(edge_owner[usize::from(edge)], seat_of(&road["playerId"]));
    }
    // The vertices a building bars under the distance rule are not tagged: a walk has to be able
    // to tell a settlement apart from its neighbour. `blocked` is where they are.
    let barred = board.blocked();
    assert!(
        barred.iter().filter(|barred| **barred).count() > buildings.len(),
        "the distance rule bars more than the built vertices"
    );
    for (vertex, owner) in vertex_owner.iter().enumerate() {
        assert!(*owner == EMPTY || barred[vertex]);
    }

    // Whoever is claimed, the tags are the same.
    for me in [Value::Null, "p1".into(), "p4".into()] {
        let mut claimed = json.clone();
        claimed["mePlayerId"] = me;
        assert_eq!(parse(&claimed).owners(), (vertex_owner.clone(), edge_owner.clone()));
    }
    // A board with no piece on it tags nothing.
    let (no_buildings, no_roads) = parse(&blank_board(4)).owners();
    assert!(no_buildings.iter().chain(&no_roads).all(|owner| *owner == EMPTY));
}
