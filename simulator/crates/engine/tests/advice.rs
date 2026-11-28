use std::fs;
use std::path::PathBuf;

use serde_json::{Value, json};
use unsettled_engine::advice::advise;
use unsettled_engine::board::{ConversionOptions, SimBoard};
use unsettled_engine::game::{GameArena, GameConfig};
use unsettled_engine::policy::heuristic_v1::{BuildKind, HeuristicParams};
use unsettled_engine::policy::{self, PolicyKind, PolicyScratch, heuristic_v1};
use unsettled_engine::rng::Xoshiro256StarStar;
use unsettled_engine::rules::{Buildable, RESOURCE_COUNT, Resource, RuleConfig, TradeConfig};
use unsettled_engine::state::{EMPTY, MAX_SEATS};
use unsettled_engine::topology::{Layout, Topology};
use unsettled_engine::view::{Action, DecisionPhase, DecisionView, pips};
use unsettled_engine::wire::WireBoard;

const POLICY: PolicyKind = PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenial;

fn fixture() -> (Value, Topology) {
    let relative = PathBuf::from("src/parser/__tests__/expected/board-draft-empty.json");
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .map(|root| root.join(&relative))
        .find(|candidate| candidate.is_file())
        .expect("board fixture must be reachable from the worktree or sweep root");
    let mut board: Value = serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap();
    board["mePlayerId"] = board["players"][0]["id"].clone();
    (
        json!({"schemaVersion": 1, "board": board, "stats": {}}),
        Topology::load(Layout::Extension6).unwrap(),
    )
}

fn resources(cards: [i16; 5]) -> Value {
    json!({"wood":cards[0], "sheep":cards[1], "wheat":cards[2], "brick":cards[3], "ore":cards[4]})
}

fn id(game: &Value, seat: usize) -> String {
    game["board"]["players"][seat]["id"]
        .as_str()
        .unwrap()
        .into()
}

fn stats(game: &mut Value, seat: usize, cards: [i16; 5]) {
    let player = id(game, seat);
    game["stats"][player] = json!({"hand": resources(cards), "handUnknown": 0,
        "devCards": 0, "knights": 0, "vpCards": 0});
}

fn dev_hand(game: &mut Value, playable: u8, bought: u8) {
    game["devHand"] = json!({"playerId": id(game, 0),
        "playable": {"knight":playable,"roadBuilding":0,"yearOfPlenty":0,"monopoly":0},
        "bought": {"knight":bought,"roadBuilding":0,"yearOfPlenty":0,"monopoly":0}});
}

fn set_turn(game: &mut Value, dev_played: bool, progress_played: [u32; 3]) {
    game["turn"] = json!({"playerId": id(game, 0), "rolled":null,
        "devPlayed":dev_played, "progressPlayed":{"roadBuilding":progress_played[0],"yearOfPlenty":progress_played[1],"monopoly":progress_played[2]}});
}

fn building(game: &mut Value, topology: &Topology, seat: usize, vertex: u8, tier: &str) {
    let value =
        json!({"playerId":id(game, seat),"vertexId":topology.vertex_id(vertex),"tier":tier});
    game["board"]["buildings"]
        .as_array_mut()
        .unwrap()
        .push(value);
}

fn independent_vertices(topology: &Topology, count: usize) -> Vec<u8> {
    let mut vertices = Vec::new();
    for vertex in 0..topology.vertex_count() as u8 {
        if vertices
            .iter()
            .all(|other| !topology.vertex_adjacent(vertex).contains(other))
        {
            vertices.push(vertex);
            if vertices.len() == count {
                return vertices;
            }
        }
    }
    panic!("not enough independent vertices");
}

fn response(game: &Value, decision: Value) -> Value {
    request_response(json!({"game":game,"decision":decision}))
}

fn response_for(game: &Value, decision: Value, observer: &str) -> Value {
    request_response(json!({"game":game,"decision":decision,"observer":observer}))
}

fn request_response(request: Value) -> Value {
    let output: Value = serde_json::from_str(&advise(&request.to_string())).unwrap();
    assert!(output.get("error").is_none(), "{output}");
    output
}

fn turn(game: &Value) -> Value {
    response(game, json!({"kind":"turn"}))
}

fn knight_score(output: &Value) -> f64 {
    output["actions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|entry| entry["action"]["type"] == "playKnight")
        .unwrap()["score"]
        .as_f64()
        .unwrap()
}

#[test]
fn winning_build_ranks_first() {
    let (mut game, topology) = fixture();
    let vertices = independent_vertices(&topology, 5);
    for vertex in &vertices[..4] {
        building(&mut game, &topology, 0, *vertex, "city");
    }
    building(&mut game, &topology, 0, vertices[4], "settlement");
    let target = independent_vertices(&topology, 6)[5];
    let road = topology.vertex_edges(target)[0];
    game["board"]["roads"] = json!([{"playerId":id(&game,0),"edgeId":topology.edge_id(road)}]);
    game["board"]["players"]
        .as_array_mut()
        .unwrap()
        .push(json!({
            "id":"p6", "name":"P6", "color":"brown"
        }));
    stats(&mut game, 0, [5, 1, 1, 2, 1]);
    let rules = RuleConfig::base(Layout::Extension6);
    let vp = |kind| {
        rules
            .buildables
            .iter()
            .find(|spec| spec.kind == kind)
            .unwrap()
            .vp
    };
    let before = 4 * vp(Buildable::City) + vp(Buildable::Settlement);
    assert_eq!(before, rules.win_vp - 1);
    let output = turn(&game);
    for kind in ["buildRoad", "buyDev", "tradeBank"] {
        assert!(
            output["actions"]
                .as_array()
                .unwrap()
                .iter()
                .any(|entry| entry["action"]["type"] == kind),
            "missing {kind}: {output}"
        );
    }
    assert_eq!(before + vp(Buildable::Settlement), rules.win_vp);
    assert_eq!(
        output["actions"][0]["action"],
        json!({"type":"buildSettlement","vertexId":topology.vertex_id(target)})
    );
    assert_eq!(
        output["actions"][0]["handDelta"],
        resources([-1, -1, -1, -1, 0])
    );
}

#[test]
fn pre_roll_knight_takes_largest_army_and_wins() {
    let (mut game, topology) = fixture();
    for vertex in independent_vertices(&topology, 4) {
        building(&mut game, &topology, 0, vertex, "city");
    }
    stats(&mut game, 0, [0; 5]);
    let player_id = id(&game, 0);
    game["stats"][player_id]["knights"] = json!(2);
    dev_hand(&mut game, 1, 0);
    let output = response(&game, json!({"kind":"preRoll"}));
    assert_eq!(output["play"]["type"], "playKnight");
    assert_eq!(output["reason"], "Wins the game: Takes Largest Army");
    assert!(knight_score(&turn(&game)) > 1000.0);
}

#[test]
fn empty_hand_ranks_pass_first() {
    let (game, _) = fixture();
    let output = turn(&game);
    assert_eq!(output["actions"][0]["action"]["type"], "pass");
    assert_eq!(output["actions"][0]["handDelta"], resources([0; 5]));
}

#[test]
fn discard_is_half_the_hand_rounded_down() {
    let (mut game, _) = fixture();
    for (hand, count) in [
        ([2, 2, 2, 1, 1], 4),
        ([2, 2, 2, 2, 1], 4),
        ([3; 5], 7),
        ([2, 2, 1, 1, 1], 0),
    ] {
        stats(&mut game, 0, hand);
        let output = response(&game, json!({"kind":"discard"}));
        assert_eq!(output["count"], count);
        let cards = output["cards"].as_object().unwrap();
        assert_eq!(
            cards.values().map(|n| n.as_i64().unwrap()).sum::<i64>(),
            count
        );
        for (resource, held) in resources(hand).as_object().unwrap() {
            assert!(cards[resource].as_i64().unwrap() <= held.as_i64().unwrap());
        }
    }
}

#[test]
fn robber_never_stays_put() {
    let (mut game, _) = fixture();
    dev_hand(&mut game, 2, 0);
    for index in 0..5 {
        game["board"]["robber"] = game["board"]["hexes"][index]["coord"].clone();
        let output = response(&game, json!({"kind":"robber"}));
        assert_ne!(output["hex"], game["board"]["robber"]);
        let output = turn(&game);
        let knights: Vec<_> = output["actions"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|entry| entry["action"]["type"] == "playKnight")
            .collect();
        assert!(!knights.is_empty());
        for knight in knights {
            assert_ne!(knight["action"]["hex"], game["board"]["robber"]);
        }
    }
}

#[test]
fn trade_response_reports_margin_and_accept() {
    let (mut game, topology) = fixture();
    building(&mut game, &topology, 0, 0, "settlement");
    let decision =
        json!({"kind":"tradeResponse","proposer":id(&game,1),"give":"ore","get":"wood","count":1});
    let output = response(&game, decision.clone());
    assert_eq!(output["accept"], false);
    assert!(output["margin"].is_null());
    stats(&mut game, 0, [1, 0, 2, 0, 2]);
    let output = response(&game, decision);
    let margin = output["margin"].as_f64().unwrap();
    assert_eq!(output["accept"], margin > 0.0);
}

#[test]
fn offers_join_the_ranked_list() {
    let (mut game, topology) = fixture();
    let vertices = independent_vertices(&topology, 2);
    building(&mut game, &topology, 0, vertices[0], "settlement");
    building(&mut game, &topology, 1, vertices[1], "settlement");
    stats(&mut game, 0, [2, 0, 2, 0, 2]);
    stats(&mut game, 1, [0, 0, 0, 0, 2]);
    let output = turn(&game);
    let actions = output["actions"].as_array().unwrap();
    assert!(
        actions
            .iter()
            .any(|entry| entry["action"]["type"] == "offerTrade"),
        "{output}"
    );
    assert!(
        actions
            .windows(2)
            .all(|pair| pair[0]["score"].as_f64() >= pair[1]["score"].as_f64())
    );
}

#[test]
fn bought_dev_cards_are_not_playable() {
    let (mut game, _) = fixture();
    stats(&mut game, 0, [0; 5]);
    let player_id = id(&game, 0);
    game["stats"][player_id]["knights"] = json!(2);
    for (playable, bought, played) in [(0, 1, false), (1, 0, true)] {
        dev_hand(&mut game, playable, bought);
        set_turn(&mut game, played, [0; 3]);
        assert!(response(&game, json!({"kind":"preRoll"}))["play"].is_null());
        assert!(
            turn(&game)["actions"]
                .as_array()
                .unwrap()
                .iter()
                .all(|entry| entry["action"]["type"] != "playKnight")
        );
    }
}

#[test]
fn super_city_counts_but_is_never_built() {
    let (mut game, topology) = fixture();
    let vertices = independent_vertices(&topology, 5);
    for (vertex, tier) in
        vertices
            .iter()
            .zip(["superCity", "city", "city", "settlement", "settlement"])
    {
        building(&mut game, &topology, 0, *vertex, tier);
    }
    stats(&mut game, 0, [0, 0, 2, 0, 3]);
    let output = turn(&game);
    assert_eq!(output["actions"][0]["action"]["type"], "upgradeCity");
    for action in output["actions"].as_array().unwrap() {
        assert_ne!(
            action["action"]["vertexId"],
            topology.vertex_id(vertices[0])
        );
    }
    // At eight VP, the army award wins only if the super city supplies all three points.
    game["board"]["buildings"].as_array_mut().unwrap().pop();
    let player = id(&game, 0);
    game["stats"][&player]["knights"] = json!(2);
    dev_hand(&mut game, 1, 0);
    assert_eq!(knight_score(&turn(&game)), 100_200.0);
    game["board"]["buildings"][0]["tier"] = json!("city");
    assert!(knight_score(&turn(&game)) < 100_000.0);
}

#[test]
fn production_follows_tier_and_robber() {
    let (mut game, topology) = fixture();
    for hex in game["board"]["hexes"].as_array_mut().unwrap() {
        hex["tile"] = json!("desert");
        hex["numberToken"] = Value::Null;
    }
    let hex = 0;
    let coord: Vec<i64> = topology
        .hex_key(hex)
        .split(',')
        .map(|v| v.parse().unwrap())
        .collect();
    let target = game["board"]["hexes"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|entry| entry["coord"] == json!({"q":coord[0],"r":coord[1]}))
        .unwrap();
    target["tile"] = json!("wood");
    target["numberToken"] = json!(6);
    for (seat, tier) in ["settlement", "city", "superCity"].into_iter().enumerate() {
        building(
            &mut game,
            &topology,
            seat,
            topology.hex_vertices(hex)[seat * 2],
            tier,
        );
    }
    game["board"]["robber"] = Value::Null;
    let output = response(&game, json!({"kind":"produce","total":6}));
    for seat in 0..game["board"]["players"].as_array().unwrap().len() {
        assert_eq!(
            output["gains"][id(&game, seat)],
            resources([if seat < 3 { seat as i16 + 1 } else { 0 }, 0, 0, 0, 0])
        );
    }
    for (total, robber) in [(7, Value::Null), (6, json!({"q":coord[0],"r":coord[1]}))] {
        game["board"]["robber"] = robber;
        let output = response(&game, json!({"kind":"produce","total":total}));
        assert!(
            output["gains"]
                .as_object()
                .unwrap()
                .values()
                .all(|gain| *gain == resources([0; 5]))
        );
    }
}

#[test]
fn unknown_rival_cards_keep_the_hand_total() {
    let (mut game, topology) = fixture();
    building(&mut game, &topology, 1, 0, "city");
    stats(&mut game, 1, [4, 0, 0, 0, 0]);
    let before = response(&game, json!({"kind":"robber"}));
    assert_eq!(before["victim"], id(&game, 1));
    let player_id = id(&game, 1);
    game["stats"][player_id]["hand"] = resources([0; 5]);
    let player_id = id(&game, 1);
    game["stats"][player_id]["handUnknown"] = json!(4);
    let after = response(&game, json!({"kind":"robber"}));
    assert_eq!(after["victim"], id(&game, 1));
}

#[test]
fn awards_field_overrides_the_derived_holder() {
    let (mut game, topology) = fixture();
    // Disjoint hex rims give equal six-road trails with no next-road takeover.
    let first = 0;
    let second = (1..topology.hex_count() as u8)
        .find(|hex| {
            topology
                .hex_vertices(*hex)
                .iter()
                .all(|vertex| !topology.hex_vertices(first).contains(vertex))
        })
        .unwrap();
    for (seat, hex) in [(0, first), (1, second)] {
        let rim = topology.hex_vertices(hex);
        for edge in 0..topology.edge_count() as u8 {
            if topology
                .edge_endpoints(edge)
                .iter()
                .all(|vertex| rim.contains(vertex))
            {
                let road = json!({"playerId":id(&game,seat),"edgeId":topology.edge_id(edge)});
                game["board"]["roads"].as_array_mut().unwrap().push(road);
            }
        }
    }
    for vertex in independent_vertices(&topology, 3) {
        building(&mut game, &topology, 0, vertex, "city");
    }
    stats(&mut game, 0, [0; 5]);
    let player_id = id(&game, 0);
    game["stats"][player_id]["knights"] = json!(2);
    dev_hand(&mut game, 1, 0);
    let absent = turn(&game);
    game["awards"] = json!({"longestRoad":null,"largestArmy":null});
    assert_eq!(turn(&game), absent);
    game["awards"]["longestRoad"] = json!(id(&game, 0));
    let held = turn(&game);
    assert!(knight_score(&held) > knight_score(&absent));
    game["awards"]["longestRoad"] = json!(id(&game, 1));
    assert!(knight_score(&turn(&game)) < knight_score(&held));
    let me = id(&game, 0);
    game["board"]["roads"]
        .as_array_mut()
        .unwrap()
        .retain(|road| road["playerId"] == me);
    game.as_object_mut().unwrap().remove("awards");
    let sole_road = turn(&game);
    game["awards"] = json!({"longestRoad":me,"largestArmy":null});
    assert_eq!(turn(&game), sole_road);
    assert_eq!(knight_score(&sole_road), 100_200.0);

    let (mut game, topology) = fixture();
    for vertex in independent_vertices(&topology, 3) {
        building(&mut game, &topology, 0, vertex, "city");
    }
    let roads: Vec<_> = topology.hex_edges(0)[..4]
        .iter()
        .map(|edge| json!({"playerId":id(&game,0),"edgeId":topology.edge_id(*edge)}))
        .collect();
    game["board"]["roads"] = json!(roads);
    stats(&mut game, 0, [1, 0, 0, 1, 0]);
    let me = id(&game, 0);
    game["stats"][&me]["knights"] = json!(3);
    let sole_army = turn(&game);
    assert_eq!(sole_army["actions"][0]["action"]["type"], "buildRoad");
    assert!(sole_army["actions"][0]["score"].as_f64().unwrap() >= 100_200.0);
    game["awards"] = json!({"longestRoad":null,"largestArmy":me});
    assert_eq!(turn(&game), sole_army);
    game["awards"]["largestArmy"] = Value::Null;
    assert!(turn(&game)["actions"][0]["score"].as_f64().unwrap() < 100_000.0);
    stats(&mut game, 1, [0; 5]);
    let rival = id(&game, 1);
    game["stats"][&rival]["knights"] = json!(3);
    game["awards"]["largestArmy"] = json!(me);
    assert!(turn(&game)["actions"][0]["score"].as_f64().unwrap() >= 100_200.0);
    game["awards"]["largestArmy"] = json!(rival);
    assert!(turn(&game)["actions"][0]["score"].as_f64().unwrap() < 100_000.0);
}

#[test]
fn bad_input_returns_an_error() {
    let (game, _) = fixture();
    let mut cases = vec!["{bad".to_string()];
    for bad in [Value::Null, json!("missing")] {
        let mut game = game.clone();
        game["board"]["mePlayerId"] = bad;
        cases.push(json!({"game":game,"decision":{"kind":"turn"}}).to_string());
    }
    let mut untiled = game.clone();
    untiled["board"]["hexes"][0]["tile"] = Value::Null;
    cases.push(json!({"game":untiled,"decision":{"kind":"turn"}}).to_string());
    for source in cases {
        let output: Value = serde_json::from_str(&advise(&source)).unwrap();
        assert_eq!(output.as_object().unwrap().len(), 1);
        assert!(output["error"].is_string());
    }
}

#[test]
fn output_is_deterministic() {
    let (mut game, topology) = fixture();
    building(&mut game, &topology, 0, 0, "settlement");
    stats(&mut game, 0, [4, 1, 2, 0, 2]);
    stats(&mut game, 1, [0, 0, 0, 2, 2]);
    dev_hand(&mut game, 2, 1);
    for decision in [
        json!({"kind":"turn"}),
        json!({"kind":"preRoll"}),
        json!({"kind":"discard"}),
        json!({"kind":"robber"}),
        json!({"kind":"tradeResponse","proposer":id(&game,1),"give":"ore","get":"wood","count":1}),
        json!({"kind":"produce","total":6}),
    ] {
        let source = json!({"game":game,"decision":decision}).to_string();
        let first = advise(&source);
        assert_eq!(first, advise(&source));
        let parsed: Value = serde_json::from_str(&first).unwrap();
        assert_eq!(parsed["kind"], decision["kind"]);
    }
}

fn snapshot(game: &Value, arena: &GameArena, topology: &Topology, observer: usize) -> Value {
    let mut game = game.clone();
    game["board"]["roads"] = json!([]);
    game["board"]["buildings"] = json!([]);
    game["board"]["mePlayerId"] = json!(id(&game, observer));
    for edge in 0..topology.edge_count() as u8 {
        let seat = arena.state.edge_owner[usize::from(edge)];
        if seat != EMPTY {
            let road =
                json!({"edgeId":topology.edge_id(edge),"playerId":id(&game,usize::from(seat))});
            game["board"]["roads"].as_array_mut().unwrap().push(road);
        }
    }
    for vertex in 0..topology.vertex_count() as u8 {
        let seat = arena.state.vertex_owner[usize::from(vertex)];
        if seat != EMPTY {
            let tier = match arena.state.vertex_tier[usize::from(vertex)] {
                1 => "settlement",
                2 => "city",
                3 => "superCity",
                _ => panic!("bad tier"),
            };
            building(&mut game, topology, usize::from(seat), vertex, tier);
        }
    }
    let coord: Vec<i64> = topology
        .hex_key(arena.state.robber)
        .split(',')
        .map(|v| v.parse().unwrap())
        .collect();
    game["board"]["robber"] = json!({"q":coord[0],"r":coord[1]});
    for seat in 0..game["board"]["players"].as_array().unwrap().len() {
        let player = arena.state.players[seat];
        stats(&mut game, seat, player.resources);
        let player_id = id(&game, seat);
        game["stats"][player_id]["devCards"] = json!(
            player.playable_dev.iter().sum::<u8>()
                + player.bought_dev.iter().sum::<u8>()
                + player.vp_dev
        );
        let player_id = id(&game, seat);
        game["stats"][player_id]["vpCards"] = json!(player.vp_dev);
        let player_id = id(&game, seat);
        game["stats"][player_id]["knights"] = json!(player.knights_played);
    }
    let cards = |cards: [u8; 5]| json!({"knight":cards[0],"roadBuilding":cards[2],"yearOfPlenty":cards[3],"monopoly":cards[4]});
    game["devHand"] = json!({"playerId":id(&game,observer),"playable":cards(arena.state.players[observer].playable_dev),
        "bought":cards(arena.state.players[observer].bought_dev)});
    game["awards"] = json!({"longestRoad":arena.state.longest_road.holder.map(|seat|id(&game,seat)),
        "largestArmy":arena.state.largest_army.map(|seat|id(&game,seat))});
    game
}

#[test]
fn trader_action_is_unchanged() {
    let (game, topology) = fixture();
    let wire = WireBoard::parse_value(game["board"].clone()).unwrap();
    let mut rules = RuleConfig::base(wire.layout);
    rules.player_trading = Some(TradeConfig::default());
    let board =
        SimBoard::try_from_wire(wire, &topology, &rules, ConversionOptions::default()).unwrap();
    let params = heuristic_v1::HeuristicParams {
        trading: Some(policy::trading::TradeParams::default()),
        threat: Some(policy::threat::ThreatParams::default()),
        dev_cards: Some(policy::devcards::DevCardParams::default()),
        denial: Some(policy::denial::DenialParams::default()),
        ..heuristic_v1::HeuristicParams::default()
    };
    let mut checked = 0;
    let mut offer_positions = 0;
    for seed in 0..5 {
        let config = GameConfig {
            seed,
            policies: [POLICY; MAX_SEATS],
            ..GameConfig::default()
        };
        let mut arena = GameArena::default();
        arena.prepare(&board, &topology, &rules, &config);
        arena.setup_for_test(&board, &topology, &rules, &config);
        for turn_index in 0..12 {
            let seat = turn_index % board.seats();
            arena.begin_turn_for_test(&board, &topology, &rules, &config, seat);
            arena.produce_for_test(&board, &topology, 6, board.seats());
            arena.produce_for_test(&board, &topology, 8, board.seats());
            let view = arena.decision_view(&board, &topology, seat, DecisionPhase::Action);
            let mut base_rng = Xoshiro256StarStar::from_seed(73);
            let mut trader_rng = base_rng.clone();
            let mut scratch = PolicyScratch::default();
            let base = heuristic_v1::action(&view, &mut scratch, &params, &mut base_rng);
            let base_score = scratch
                .actions
                .as_slice()
                .iter()
                .map(|candidate| candidate.score)
                .fold(f32::NEG_INFINITY, f32::max);
            let selected = policy::heuristic_v1_trader::action(
                &view,
                &mut PolicyScratch::default(),
                &params,
                &mut trader_rng,
            );
            let output = turn(&snapshot(&game, &arena, &topology, seat));
            let best_offer = output["actions"]
                .as_array()
                .unwrap()
                .iter()
                .find(|entry| entry["action"]["type"] == "offerTrade");
            let expected = match best_offer
                .filter(|entry| entry["score"].as_f64().unwrap() > f64::from(base_score))
            {
                Some(entry) => {
                    offer_positions += 1;
                    Action::OfferTrade {
                        give: serde_json::from_value(entry["action"]["give"].clone()).unwrap(),
                        get: serde_json::from_value(entry["action"]["get"].clone()).unwrap(),
                        count: entry["action"]["count"].as_u64().unwrap() as u8,
                    }
                }
                None => base,
            };
            assert_eq!(selected, expected, "seed {seed} turn {turn_index}");
            assert_eq!(base_rng.next_u64(), trader_rng.next_u64());
            checked += 1;
            // Keep the sample free of hidden draws so the JSON snapshot has the same beliefs and deck.
            let action = match selected {
                Action::BuyDev | Action::PlayDev(_) => Action::Pass,
                action => action,
            };
            assert!(arena.apply_action_for_test(
                &board,
                &topology,
                &rules,
                &config,
                seat,
                action,
                DecisionPhase::Action
            ));
        }
    }
    assert!(checked >= 50);
    assert!(offer_positions > 0);
}

#[test]
fn derived_state_uses_known_cards_and_claimed_dev_hand() {
    let (mut game, _) = fixture();
    stats(&mut game, 0, [1, 2, 3, 4, 5]);
    stats(&mut game, 1, [2, 1, 0, 0, 25]);
    let me = id(&game, 0);
    let rival = id(&game, 1);
    game["stats"][&me]["handUnknown"] = json!(100);
    game["stats"][&me]["devCards"] = json!(9);
    game["stats"][&me]["vpCards"] = json!(1);
    game["stats"][&me]["knights"] = json!(2);
    game["stats"][&rival]["handUnknown"] = json!(10);
    game["stats"][&rival]["devCards"] = json!(3);
    game["stats"][&rival]["knights"] = json!(1);
    dev_hand(&mut game, 1, 2);
    let output = turn(&game);
    assert_eq!(output["derived"]["bank"], resources([21, 21, 21, 20, 0]));
    assert_eq!(output["derived"]["devDeckRemaining"], 24);
    let discard = response(&game, json!({"kind":"discard"}));
    assert_eq!(discard["count"], 57);
    assert_eq!(discard["cards"], resources([1, 2, 3, 4, 5]));
    assert_eq!(discard["derived"]["unknownOwnCards"], 100);
    game.as_object_mut().unwrap().remove("devHand");
    let absent = turn(&game);
    assert_eq!(absent["derived"]["devDeckRemaining"], 18);
    game["devHand"] = json!({"playerId":rival,"playable":"ignored"});
    assert_eq!(turn(&game), absent);
    game["stats"][&me]["devCards"] = json!(100);
    assert_eq!(turn(&game)["derived"]["devDeckRemaining"], 0);
}

#[test]
fn standard_board_and_unofficial_roster_use_base_rules() {
    let (mut game, _) = fixture();
    let topology = Topology::load(Layout::Standard4).unwrap();
    let hexes: Vec<_> = (0..topology.hex_count() as u8).map(|hex| {
        let (q,r) = topology.hex_key(hex).split_once(',').unwrap();
        json!({"coord":{"q":q.parse::<i64>().unwrap(),"r":r.parse::<i64>().unwrap()},
            "tile":if hex == 0 {"desert"} else {"wood"},"numberToken":if hex == 0 {None} else {Some(6)}})
    }).collect();
    game["board"]["layout"] = json!("standard4");
    game["board"]["hexes"] = json!(hexes);
    game["board"]["ports"] = json!([]);
    game["board"]["robber"] = Value::Null;
    game["board"]["players"].as_array_mut().unwrap().truncate(2);
    let output = turn(&game);
    assert_eq!(output["derived"]["bank"], resources([19; 5]));
    assert_eq!(output["derived"]["devDeckRemaining"], 25);
    assert_eq!(output["actions"][0]["action"]["type"], "pass");
}

#[test]
fn bank_shortage_uses_the_engine_production_rule() {
    let (mut game, topology) = fixture();
    for hex in game["board"]["hexes"].as_array_mut().unwrap() {
        hex["tile"] = json!("wood");
        hex["numberToken"] = json!(6);
    }
    game["board"]["robber"] = game["board"]["hexes"][0]["coord"].clone();
    for (seat, vertex) in independent_vertices(&topology, 2).into_iter().enumerate() {
        building(&mut game, &topology, seat, vertex, "city");
    }
    stats(&mut game, 2, [23, 0, 0, 0, 0]);
    let output = response(&game, json!({"kind":"produce","total":6}));
    assert!(
        output["gains"]
            .as_object()
            .unwrap()
            .values()
            .all(|gain| *gain == resources([0; 5]))
    );
}

#[test]
fn malformed_counters_and_decisions_return_errors() {
    let (mut game, topology) = fixture();
    building(&mut game, &topology, 0, 0, "settlement");
    stats(&mut game, 0, [0; 5]);
    let me = id(&game, 0);
    for (path, value) in [
        ("/stats/p1/hand/wood", json!(-1)),
        ("/stats/p1/hand/wood", json!(1.5)),
        ("/stats/p1/hand/wood", json!(65535)),
        ("/stats/p1/devCards", json!(256)),
        ("/stats/p1/knights", json!(-1)),
        ("/stats/p1/vpCards", json!(255)),
        ("/schemaVersion", json!(2)),
    ] {
        let mut invalid = game.clone();
        *invalid.pointer_mut(path).unwrap() = value;
        let output: Value = serde_json::from_str(&advise(
            &json!({"game":invalid,"decision":{"kind":"turn"}}).to_string(),
        ))
        .unwrap();
        assert!(output["error"].is_string(), "{path}: {output}");
    }
    dev_hand(&mut game, 255, 1);
    let output: Value = serde_json::from_str(&advise(
        &json!({"game":game,"decision":{"kind":"turn"}}).to_string(),
    ))
    .unwrap();
    assert!(output["error"].is_string());
    game.as_object_mut().unwrap().remove("devHand");
    for decision in [
        json!({"kind":"produce","total":1}),
        json!({"kind":"produce","total":13}),
        json!({"kind":"unknown"}),
        json!({"kind":"tradeResponse","proposer":"missing","give":"wood","get":"ore","count":1}),
        json!({"kind":"tradeResponse","proposer":id(&game,1),"give":"wood","get":"ore","count":3}),
    ] {
        let output: Value = serde_json::from_str(&advise(
            &json!({"game":game,"decision":decision}).to_string(),
        ))
        .unwrap();
        assert!(output["error"].is_string(), "{output}");
    }
    game["stats"][&me]["hand"]["wood"] = json!(512);
    let output: Value = serde_json::from_str(&advise(
        &json!({"game":game,"decision":{"kind":"discard"}}).to_string(),
    ))
    .unwrap();
    assert!(output["error"].is_string());
}

#[test]
fn bank_trades_and_dev_purchases_report_hand_costs() {
    let (mut game, topology) = fixture();
    building(&mut game, &topology, 0, 0, "settlement");
    stats(&mut game, 0, [4, 1, 2, 0, 2]);
    let output = turn(&game);
    let actions = output["actions"].as_array().unwrap();
    let buy = actions
        .iter()
        .find(|entry| entry["action"]["type"] == "buyDev")
        .unwrap();
    assert_eq!(buy["handDelta"], resources([0, -1, -1, 0, -1]));
    let trade = actions
        .iter()
        .find(|entry| entry["action"]["type"] == "tradeBank")
        .unwrap();
    let give = trade["action"]["give"].as_str().unwrap();
    let get = trade["action"]["get"].as_str().unwrap();
    let count = trade["action"]["count"].as_i64().unwrap();
    assert_eq!(
        trade["handDelta"][give].as_i64().unwrap(),
        -count * trade["action"]["rate"].as_i64().unwrap()
    );
    assert_eq!(trade["handDelta"][get], count);
}

#[test]
fn oversized_production_returns_an_error_without_panicking() {
    let (mut game, topology) = fixture();
    for hex in game["board"]["hexes"].as_array_mut().unwrap() {
        hex["tile"] = json!("wood");
        hex["numberToken"] = json!(6);
    }
    game["board"]["robber"] = game["board"]["hexes"][0]["coord"].clone();
    let mut side = vec![None; topology.vertex_count()];
    side[0] = Some(false);
    let mut pending = vec![0];
    while let Some(vertex) = pending.pop() {
        for adjacent in topology.vertex_adjacent(vertex) {
            if side[usize::from(*adjacent)].is_none() {
                side[usize::from(*adjacent)] = side[usize::from(vertex)].map(|value| !value);
                pending.push(*adjacent);
            }
        }
    }
    for (vertex, side) in side.into_iter().enumerate() {
        if side == Some(false) {
            building(&mut game, &topology, 0, vertex as u8, "superCity");
        }
    }
    let output: Value = serde_json::from_str(&advise(
        &json!({"game":game,"decision":{"kind":"produce","total":6}}).to_string(),
    ))
    .unwrap();
    assert!(output["error"].as_str().unwrap().contains("production"));
}

#[test]
fn observer_selects_the_deciding_seat() {
    let (mut game, topology) = fixture();
    for (seat, vertex) in independent_vertices(&topology, 2).into_iter().enumerate() {
        building(&mut game, &topology, seat, vertex, "settlement");
    }
    stats(&mut game, 0, [0, 0, 2, 0, 3]);
    let me = response_for(&game, json!({"kind":"turn"}), &id(&game, 0));
    let rival = response_for(&game, json!({"kind":"turn"}), &id(&game, 1));
    assert_eq!(me["actions"][0]["action"]["type"], "upgradeCity");
    assert_eq!(rival["actions"][0]["action"]["type"], "pass");
    assert_ne!(me["actions"], rival["actions"]);
    assert_eq!(me["derived"]["bank"], rival["derived"]["bank"]);
}

#[test]
fn observer_defaults_to_the_claimed_player() {
    let (mut game, topology) = fixture();
    building(&mut game, &topology, 0, 0, "settlement");
    stats(&mut game, 0, [0, 0, 2, 0, 3]);
    let observer = id(&game, 0);
    assert_eq!(
        turn(&game),
        response_for(&game, json!({"kind":"turn"}), &observer)
    );
    game["board"]["mePlayerId"] = Value::Null;
    assert_eq!(
        response_for(&game, json!({"kind":"turn"}), &observer)["actions"][0]["action"]["type"],
        "upgradeCity"
    );
}

#[test]
fn rival_observer_uses_known_cards_only() {
    let (mut game, _) = fixture();
    stats(&mut game, 1, [0; 5]);
    let rival = id(&game, 1);
    game["stats"][&rival]["handUnknown"] = json!(5);
    let output = response_for(&game, json!({"kind":"turn"}), &rival);
    assert_eq!(output["actions"][0]["action"]["type"], "pass");
    assert_eq!(output["derived"]["unknownOwnCards"], 5);
}

#[test]
fn rival_discard_counts_unknown_cards() {
    let (mut game, _) = fixture();
    stats(&mut game, 1, [1, 1, 1, 0, 0]);
    let rival = id(&game, 1);
    game["stats"][&rival]["handUnknown"] = json!(6);
    let output = response_for(&game, json!({"kind":"discard"}), &rival);
    assert_eq!(output["count"], 4);
    assert_eq!(output["cards"], resources([1, 1, 1, 0, 0]));
    assert_eq!(
        output["cards"]
            .as_object()
            .unwrap()
            .values()
            .map(|card| card.as_u64().unwrap())
            .sum::<u64>(),
        3
    );
    assert_eq!(output["derived"]["unknownOwnCards"], 6);
    assert_eq!(output["derived"]["tradeRates"], resources([4; 5]));
}

#[test]
fn turn_dev_played_blocks_a_second_dev_card() {
    let (mut game, _) = fixture();
    stats(&mut game, 0, [0; 5]);
    let me = id(&game, 0);
    game["stats"][&me]["knights"] = json!(2);
    dev_hand(&mut game, 1, 0);
    assert_eq!(
        response(&game, json!({"kind":"preRoll"}))["play"]["type"],
        "playKnight"
    );
    set_turn(&mut game, true, [0; 3]);
    game["turn"]["rolled"] = json!(6);
    assert!(response(&game, json!({"kind":"preRoll"}))["play"].is_null());
    assert!(
        turn(&game)["actions"]
            .as_array()
            .unwrap()
            .iter()
            .all(|entry| entry["action"]["type"] != "playKnight")
    );
    game["turn"]["devPlayed"] = json!(false);
    assert_eq!(
        response(&game, json!({"kind":"preRoll"}))["play"]["type"],
        "playKnight"
    );
    game["devHand"]["played"] = json!(false);
    let output: Value = serde_json::from_str(&advise(
        &json!({"game":game,"decision":{"kind":"turn"}}).to_string(),
    ))
    .unwrap();
    assert!(output["error"].is_string());
}

#[test]
fn progress_played_leaves_the_deck() {
    let (mut game, _) = fixture();
    stats(&mut game, 0, [0; 5]);
    stats(&mut game, 1, [0; 5]);
    let me = id(&game, 0);
    let rival = id(&game, 1);
    game["stats"][&me]["devCards"] = json!(7);
    game["stats"][&me]["vpCards"] = json!(1);
    game["stats"][&me]["knights"] = json!(3);
    game["stats"][&rival]["devCards"] = json!(4);
    game["stats"][&rival]["knights"] = json!(2);
    for observer in [&me, &rival] {
        assert_eq!(
            response_for(&game, json!({"kind":"turn"}), observer)["derived"]["devDeckRemaining"],
            17
        );
    }
    dev_hand(&mut game, 1, 1);
    for (progress, remaining) in [([0; 3], 22), ([1; 3], 19), ([u32::MAX; 3], 0)] {
        set_turn(&mut game, false, progress);
        for observer in [&me, &rival] {
            let output = response_for(&game, json!({"kind":"turn"}), observer);
            assert_eq!(output["derived"]["devDeckRemaining"], remaining);
        }
    }
}

#[test]
fn dev_hand_of_another_player_is_ignored() {
    let (mut game, _) = fixture();
    stats(&mut game, 1, [0; 5]);
    let rival = id(&game, 1);
    game["stats"][&rival]["knights"] = json!(2);
    game["stats"][&rival]["devCards"] = json!(1);
    let before = response_for(&game, json!({"kind":"turn"}), &rival);
    dev_hand(&mut game, 1, 0);
    game["devHand"]["playerId"] = json!(rival);
    assert_eq!(response_for(&game, json!({"kind":"turn"}), &rival), before);
    assert!(response_for(&game, json!({"kind":"preRoll"}), &rival)["play"].is_null());
}

#[test]
fn trade_rates_follow_ports() {
    let (mut game, topology) = fixture();
    let observer = id(&game, 1);
    let ports = game["board"]["ports"].as_array().unwrap();
    let specific = ports
        .iter()
        .find(|port| port["resource"].is_string() && port["rate"] == 2)
        .unwrap();
    let resource: Resource = serde_json::from_value(specific["resource"].clone()).unwrap();
    let edge = topology
        .edge_by_id(specific["edgeId"].as_str().unwrap())
        .unwrap();
    let first = topology.edge_endpoints(edge)[0];
    let second = ports
        .iter()
        .filter(|port| port["resource"].is_null() && port["rate"] == 3)
        .flat_map(|port| {
            topology.edge_endpoints(
                topology
                    .edge_by_id(port["edgeId"].as_str().unwrap())
                    .unwrap(),
            )
        })
        .find(|vertex| *vertex != first && !topology.vertex_adjacent(first).contains(vertex))
        .unwrap();
    building(&mut game, &topology, 1, first, "settlement");
    building(&mut game, &topology, 1, second, "settlement");
    let mut rates = [3; 5];
    rates[resource.index()] = 2;
    assert_eq!(
        response_for(&game, json!({"kind":"turn"}), &observer)["derived"]["tradeRates"],
        resources(rates)
    );
    game["board"]["buildings"].as_array_mut().unwrap().pop();
    let mut rates = [4; 5];
    rates[resource.index()] = 2;
    assert_eq!(
        response_for(&game, json!({"kind":"turn"}), &observer)["derived"]["tradeRates"],
        resources(rates)
    );
    game["board"]["buildings"] = json!([]);
    assert_eq!(
        response_for(&game, json!({"kind":"turn"}), &observer)["derived"]["tradeRates"],
        resources([4; 5])
    );
}

#[test]
fn unknown_observer_returns_an_error() {
    let (mut game, _) = fixture();
    let output: Value = serde_json::from_str(&advise(
        &json!({"game":game,"observer":"unknown-player","decision":{"kind":"turn"}}).to_string(),
    ))
    .unwrap();
    assert!(output["error"].is_string());
    game["board"]["mePlayerId"] = Value::Null;
    let output: Value = serde_json::from_str(&advise(
        &json!({"game":game,"decision":{"kind":"turn"}}).to_string(),
    ))
    .unwrap();
    assert!(output["error"].is_string());
}

fn original_vertex_score(
    view: &DecisionView<'_>,
    vertex: u8,
    params: &HeuristicParams,
    kind: BuildKind,
) -> (f32, [f32; 5]) {
    let board_totals = view.board_resource_pips();
    let own = view.production_pips(view.observer());
    let mut production = [0_u16; RESOURCE_COUNT];
    for hex in view.topology().vertex_hexes(vertex) {
        if *hex == view.robber() {
            continue;
        }
        if let (Some(resource), Some(token)) = (
            view.board().tiles()[usize::from(*hex)],
            view.board().tokens()[usize::from(*hex)],
        ) {
            production[resource.index()] += u16::from(pips(token));
        }
    }
    let raw: u16 = production.iter().sum();
    let scarcity = production
        .iter()
        .enumerate()
        .map(|(resource, value)| f32::from(*value) / f32::from(board_totals[resource].max(1)))
        .sum::<f32>();
    let diversity = match kind {
        BuildKind::Settlement => production
            .iter()
            .enumerate()
            .filter(|(resource, value)| **value > 0 && own[*resource] == 0)
            .count() as f32,
        BuildKind::City => 0.0,
    };
    let port_synergy = view
        .board()
        .ports_at(vertex)
        .map(|port| {
            Resource::ALL
                .iter()
                .map(|resource| {
                    let current = view.trade_rate(*resource);
                    let prospective = view.prospective_trade_rate(*port, *resource);
                    if prospective < current {
                        let production =
                            own[resource.index()].saturating_add(production[resource.index()]);
                        f32::from(production) * (1.0 / prospective as f32 - 1.0 / current as f32)
                    } else {
                        0.0
                    }
                })
                .sum::<f32>()
        })
        .sum::<f32>();
    let expansion = match kind {
        BuildKind::Settlement => view
            .topology()
            .vertex_adjacent(vertex)
            .iter()
            .filter(|adjacent| view.vertex_owner(**adjacent).is_none())
            .count() as f32,
        BuildKind::City => 0.0,
    };
    (
        f32::from(raw) * params.production_weight
            + scarcity * params.scarcity_weight * 10.0
            + diversity * params.diversity_bonus
            + port_synergy * params.port_weight
            + expansion * params.expansion_weight,
        [
            f32::from(raw) * params.production_weight,
            scarcity * params.scarcity_weight * 10.0,
            diversity * params.diversity_bonus,
            port_synergy * params.port_weight,
            expansion * params.expansion_weight,
        ],
    )
}

fn reason_position(layout: Layout, variation: usize) -> (Value, Topology) {
    let (mut game, _) = fixture();
    let topology = Topology::load(layout).unwrap();
    if layout == Layout::Standard4 {
        game["board"]["layout"] = json!("standard4");
        game["board"]["ports"] = json!([]);
        game["board"]["players"].as_array_mut().unwrap().truncate(4);
    }
    let tokens = [2, 3, 4, 5, 6, 8, 9, 10, 11, 12];
    game["board"]["hexes"] = json!(
        (0..topology.hex_count() as u8)
            .map(|hex| {
                let (q, r) = topology.hex_key(hex).split_once(',').unwrap();
                json!({"coord":{"q":q.parse::<i64>().unwrap(),"r":r.parse::<i64>().unwrap()},
            "tile":Resource::ALL[(usize::from(hex) + variation) % 5],
            "numberToken":tokens[(usize::from(hex) + variation) % tokens.len()]})
            })
            .collect::<Vec<_>>()
    );
    game["board"]["robber"] =
        game["board"]["hexes"][variation % topology.hex_count()]["coord"].clone();
    let vertices = independent_vertices(&topology, 4);
    for (seat, vertex) in vertices.iter().copied().enumerate() {
        building(
            &mut game,
            &topology,
            seat,
            vertex,
            if (variation + seat) % 3 == 0 {
                "city"
            } else {
                "settlement"
            },
        );
        stats(
            &mut game,
            seat,
            std::array::from_fn(|resource| ((variation + seat * 3 + resource) % 7) as i16),
        );
        game["board"]["players"][seat]["name"] = json!(["Blue", "Orange", "Red", "Green"][seat]);
    }
    let edge = topology.vertex_edges(vertices[0])[0];
    game["board"]["roads"] = json!([{"playerId":id(&game,0),"edgeId":topology.edge_id(edge)}]);
    (game, topology)
}

fn reason_arena(game: &Value, topology: &Topology) -> (SimBoard, GameArena) {
    let wire = WireBoard::parse_value(game["board"].clone()).unwrap();
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
    .unwrap();
    let mut arena = GameArena::default();
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
    for (seat, player) in board.player_ids().iter().enumerate() {
        for resource in Resource::ALL {
            arena.state.players[seat].resources[resource.index()] =
                game["stats"][player]["hand"][resource.as_str()]
                    .as_i64()
                    .unwrap_or(0) as i16;
        }
    }
    (board, arena)
}

#[test]
fn vertex_terms_sum_to_the_vertex_score_bit_for_bit() {
    for layout in [Layout::Standard4, Layout::Extension6] {
        for variation in 0..30 {
            let (game, topology) = reason_position(layout, variation);
            let (board, arena) = reason_arena(&game, &topology);
            let view = arena.decision_view(&board, &topology, variation % 4, DecisionPhase::Action);
            let params = HeuristicParams {
                production_weight: 0.73 + variation as f32 * 0.03,
                scarcity_weight: 0.37,
                diversity_bonus: 1.23,
                port_weight: 0.13,
                expansion_weight: 0.17,
                ..HeuristicParams::default()
            };
            for vertex in 0..topology.vertex_count() as u8 {
                for kind in [BuildKind::Settlement, BuildKind::City] {
                    // vertex_score delegates directly to the crate-private terms.total().
                    assert_eq!(
                        heuristic_v1::vertex_score(&view, vertex, &params, kind).to_bits(),
                        original_vertex_score(&view, vertex, &params, kind)
                            .0
                            .to_bits(),
                        "{layout:?} variation {variation}, vertex {vertex}"
                    );
                }
            }
        }
    }
}

fn check_reason(reason: &Value, game: &Value) {
    let reason = reason.as_str().unwrap();
    assert!(!reason.is_empty());
    assert!(reason.chars().count() <= 100, "{reason}");
    assert!(!reason.ends_with('.'), "{reason}");
    assert!(!reason.contains(['\n', '\r', '—', '–']), "{reason}");
    for player in game["board"]["players"].as_array().unwrap() {
        if player["id"] != player["name"] {
            assert!(!reason.contains(player["id"].as_str().unwrap()), "{reason}");
        }
    }
}

#[test]
fn every_recommendation_has_a_reason() {
    let mut plays = std::collections::BTreeSet::new();
    let mut actions = std::collections::BTreeSet::new();
    for variation in 0..30 {
        let (mut game, _) = reason_position(Layout::Extension6, variation);
        let me = id(&game, 0);
        game["stats"][&me]["knights"] = json!(2);
        for card in ["knight", "roadBuilding", "yearOfPlenty", "monopoly"] {
            dev_hand(&mut game, 0, 0);
            game["devHand"]["playable"][card] = json!(1);
            for decision in [
                json!({"kind":"turn"}),
                json!({"kind":"preRoll"}),
                json!({"kind":"discard"}),
                json!({"kind":"robber"}),
                json!({"kind":"tradeResponse","proposer":id(&game,1),"give":"ore","get":"wood","count":1}),
            ] {
                let output = response(&game, decision);
                if let Some(list) = output["actions"].as_array() {
                    for entry in list {
                        check_reason(&entry["reason"], &game);
                        actions.insert(entry["action"]["type"].as_str().unwrap().to_string());
                    }
                } else {
                    check_reason(&output["reason"], &game);
                    if let Some(kind) = output["play"]["type"].as_str() {
                        plays.insert(kind.to_string());
                    }
                }
            }
        }
    }
    for kind in [
        "pass",
        "upgradeCity",
        "buildRoad",
        "buyDev",
        "tradeBank",
        "offerTrade",
        "playKnight",
    ] {
        assert!(actions.contains(kind), "missing {kind}: {actions:?}");
    }
    for kind in ["playKnight", "roadBuilding", "yearOfPlenty", "monopoly"] {
        assert!(plays.contains(kind), "missing {kind}: {plays:?}");
    }
    let (game, _) = fixture();
    assert_eq!(
        response(&game, json!({"kind":"preRoll"}))["reason"],
        "No dev card is worth playing yet"
    );
    assert_eq!(
        response(&game, json!({"kind":"discard"}))["reason"],
        "Nothing to discard"
    );
    assert_eq!(
        turn(&game)["actions"][0]["reason"],
        "Nothing else is worth doing"
    );
}

#[test]
fn a_winning_action_says_so() {
    let (mut game, topology) = fixture();
    let vertices = independent_vertices(&topology, 6);
    for vertex in &vertices[..4] {
        building(&mut game, &topology, 0, *vertex, "city");
    }
    building(&mut game, &topology, 0, vertices[4], "settlement");
    let edge = topology.vertex_edges(vertices[5])[0];
    game["board"]["roads"] = json!([{"playerId":id(&game,0),"edgeId":topology.edge_id(edge)}]);
    game["board"]["players"]
        .as_array_mut()
        .unwrap()
        .push(json!({"id":"p6","name":"Brown","color":"brown"}));
    stats(&mut game, 0, [5, 1, 1, 2, 1]);
    let output = turn(&game);
    assert_eq!(output["actions"][0]["action"]["type"], "buildSettlement");
    assert!(
        output["actions"][0]["reason"]
            .as_str()
            .unwrap()
            .starts_with("Wins the game")
    );
    for entry in output["actions"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|entry| entry["action"]["type"] != "buildSettlement")
    {
        assert!(
            !entry["reason"]
                .as_str()
                .unwrap()
                .starts_with("Wins the game")
        );
    }
    game["board"]["buildings"].as_array_mut().unwrap().remove(0);
    assert!(
        turn(&game)["actions"]
            .as_array()
            .unwrap()
            .iter()
            .all(|entry| !entry["reason"]
                .as_str()
                .unwrap()
                .starts_with("Wins the game"))
    );
}

#[test]
fn settlement_reason_lists_its_largest_terms() {
    let (mut game, topology) = fixture();
    let target = independent_vertices(&topology, 1)[0];
    let edge = topology.vertex_edges(target)[0];
    game["board"]["roads"] = json!([{"playerId":id(&game,0),"edgeId":topology.edge_id(edge)}]);
    stats(&mut game, 0, [1; 5]);
    let (board, arena) = reason_arena(&game, &topology);
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let output = turn(&game);
    let mut checked = 0;
    for entry in output["actions"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|entry| entry["action"]["type"] == "buildSettlement")
    {
        let vertex = topology
            .vertex_by_id(entry["action"]["vertexId"].as_str().unwrap())
            .unwrap();
        let (_, terms) = original_vertex_score(
            &view,
            vertex,
            &HeuristicParams::default(),
            BuildKind::Settlement,
        );
        let mut named: Vec<_> = ["Production", "scarcity", "diversity", "port", "expansion"]
            .into_iter()
            .zip(terms)
            .filter(|(_, v)| *v != 0.0)
            .collect();
        named.sort_by(|a, b| b.1.total_cmp(&a.1));
        if let Some((name, value)) = named.first() {
            let expected = format!("{} {value:+.1}", name[..1].to_uppercase() + &name[1..]);
            assert!(
                entry["reason"].as_str().unwrap().starts_with(&expected),
                "{entry}"
            );
            checked += 1;
        }
    }
    assert!(checked > 0);
}

#[test]
fn robber_reason_names_the_victim_by_name() {
    let (mut game, topology) = fixture();
    building(&mut game, &topology, 1, 0, "city");
    stats(&mut game, 1, [4, 0, 0, 0, 0]);
    game["board"]["players"][1]["name"] = json!("Orange");
    let output = response(&game, json!({"kind":"robber"}));
    assert_eq!(output["victim"], id(&game, 1));
    assert!(output["reason"].as_str().unwrap().contains("Orange"));
    check_reason(&output["reason"], &game);
    let vertex = independent_vertices(&topology, 2)[1];
    building(&mut game, &topology, 0, vertex, "settlement");
    let hex = topology.vertex_hexes(vertex)[0];
    let (q, r) = topology.hex_key(hex).split_once(',').unwrap();
    let coord = json!({"q":q.parse::<i64>().unwrap(), "r":r.parse::<i64>().unwrap()});
    for hex in game["board"]["hexes"].as_array_mut().unwrap() {
        if hex["coord"] == coord {
            hex["tile"] = json!("wheat");
            hex["numberToken"] = json!(6);
        }
    }
    game["board"]["robber"] = coord;
    let output = response(&game, json!({"kind":"robber"}));
    assert!(
        output["reason"]
            .as_str()
            .unwrap()
            .contains("Frees your wheat 6")
    );
    game["board"]["players"][1]["name"] = json!("Orange\n".repeat(30));
    check_reason(&response(&game, json!({"kind":"robber"}))["reason"], &game);
}

#[test]
fn trade_response_reason_follows_the_margin_sign() {
    let mut signs = [false; 2];
    for variation in 0..20 {
        let (game, _) = reason_position(Layout::Extension6, variation);
        for give in Resource::ALL {
            for get in Resource::ALL
                .into_iter()
                .filter(|resource| *resource != give)
            {
                let output = response(
                    &game,
                    json!({"kind":"tradeResponse","proposer":id(&game,1),"give":give,"get":get,"count":1}),
                );
                if let Some(margin) = output["margin"].as_f64() {
                    let accepts = margin > 0.0;
                    signs[usize::from(accepts)] = true;
                    assert_eq!(output["accept"], accepts);
                    assert_eq!(
                        output["reason"],
                        if accepts {
                            "Helps you more than it helps Orange"
                        } else {
                            "Helps Orange more than it helps you"
                        }
                    );
                } else if game["stats"][id(&game, 0)]["hand"][get.as_str()] == 0 {
                    assert_eq!(
                        output["reason"],
                        format!("You have no {} to give", get.as_str())
                    );
                }
            }
        }
    }
    assert_eq!(signs, [true, true]);
}

#[test]
fn reasons_are_deterministic() {
    let (mut game, _) = reason_position(Layout::Standard4, 5);
    dev_hand(&mut game, 2, 0);
    for decision in [
        json!({"kind":"turn"}),
        json!({"kind":"preRoll"}),
        json!({"kind":"discard"}),
        json!({"kind":"robber"}),
        json!({"kind":"tradeResponse","proposer":id(&game,1),"give":"ore","get":"wood","count":1}),
    ] {
        let request = json!({"game":game,"decision":decision}).to_string();
        let first = advise(&request);
        assert_eq!(first, advise(&request));
        let parsed: Value = serde_json::from_str(&first).unwrap();
        assert!(parsed.get("error").is_none());
    }
}

#[test]
fn a_rivals_vp_cards_leave_the_deck() {
    let (mut game, _) = fixture();
    stats(&mut game, 1, [0; 5]);
    let rival = id(&game, 1);
    let before = turn(&game)["derived"]["devDeckRemaining"].as_u64().unwrap();
    game["stats"][&rival]["vpCards"] = json!(1);
    for observer in [id(&game, 0), rival] {
        assert_eq!(
            response_for(&game, json!({"kind":"turn"}), &observer)["derived"]["devDeckRemaining"],
            before - 1
        );
    }
}

#[test]
fn a_rival_observer_wins_with_its_vp_cards() {
    let (mut game, topology) = fixture();
    for (index, vertex) in independent_vertices(&topology, 5).into_iter().enumerate() {
        building(
            &mut game,
            &topology,
            1,
            vertex,
            if index < 3 { "city" } else { "settlement" },
        );
    }
    stats(&mut game, 1, [0, 0, 2, 0, 3]);
    let rival = id(&game, 1);
    game["stats"][&rival]["vpCards"] = json!(1);
    let output = response_for(&game, json!({"kind":"turn"}), &rival);
    assert_eq!(output["actions"][0]["action"]["type"], "upgradeCity");
    assert!(
        output["actions"][0]["reason"]
            .as_str()
            .unwrap()
            .starts_with("Wins the game"),
        "{output}"
    );
    game["stats"][&rival]["vpCards"] = json!(0);
    assert!(
        !response_for(&game, json!({"kind":"turn"}), &rival)["actions"][0]["reason"]
            .as_str()
            .unwrap()
            .starts_with("Wins the game")
    );
}

#[test]
fn another_players_dev_play_does_not_block_the_observer() {
    let (mut game, _) = fixture();
    stats(&mut game, 0, [0; 5]);
    let me = id(&game, 0);
    game["stats"][&me]["knights"] = json!(2);
    dev_hand(&mut game, 1, 0);
    set_turn(&mut game, false, [0; 3]);
    game["turn"]["playerId"] = json!(id(&game, 1));
    let before = response(&game, json!({"kind":"preRoll"}));
    assert_eq!(before["play"]["type"], "playKnight");
    game["turn"]["devPlayed"] = json!(true);
    assert_eq!(
        response(&game, json!({"kind":"preRoll"}))["play"],
        before["play"]
    );
}

#[test]
fn pass_reason_depends_on_its_rank() {
    let (mut game, topology) = fixture();
    assert_eq!(
        turn(&game)["actions"][0]["reason"],
        "Nothing else is worth doing"
    );
    building(&mut game, &topology, 0, 0, "settlement");
    stats(&mut game, 0, [0, 0, 2, 0, 3]);
    let output = turn(&game);
    assert_eq!(output["actions"][0]["action"]["type"], "upgradeCity");
    let pass = output["actions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|entry| entry["action"]["type"] == "pass")
        .unwrap();
    assert_eq!(pass["reason"], "Ends the turn");
}

#[test]
fn card_only_actions_get_cards_for_a_build() {
    let (mut game, topology) = fixture();
    let edge = topology.vertex_edges(0)[0];
    game["board"]["roads"] = json!([{"playerId":id(&game,0),"edgeId":topology.edge_id(edge)}]);
    stats(&mut game, 0, [5, 1, 1, 0, 0]);
    let output = turn(&game);
    let trade = output["actions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|entry| entry["action"]["type"] == "tradeBank" && entry["action"]["get"] == "brick")
        .unwrap();
    assert_eq!(trade["reason"], "Gets you the cards for a settlement");
    stats(&mut game, 0, [1, 1, 0, 0, 0]);
    dev_hand(&mut game, 0, 0);
    game["devHand"]["playable"]["yearOfPlenty"] = json!(1);
    let output = response(&game, json!({"kind":"preRoll"}));
    assert_eq!(output["play"]["type"], "yearOfPlenty");
    assert_eq!(output["reason"], "Gets you the cards for a settlement");
}

#[test]
fn offer_reason_names_the_safest_partner() {
    let (mut game, topology) = fixture();
    for (seat, vertex) in independent_vertices(&topology, 2).into_iter().enumerate() {
        building(&mut game, &topology, seat, vertex, "settlement");
    }
    stats(&mut game, 0, [2, 0, 2, 0, 2]);
    stats(&mut game, 1, [0, 0, 0, 0, 2]);
    game["board"]["players"][1]["name"] = json!("Orange");
    let output = turn(&game);
    let offers: Vec<_> = output["actions"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|entry| entry["action"]["type"] == "offerTrade")
        .collect();
    assert!(!offers.is_empty());
    for offer in offers {
        assert_eq!(
            offer["reason"],
            "Moves you closer to a win; Orange is the safest partner"
        );
    }
}

#[test]
fn played_progress_cards_leave_the_composition() {
    use unsettled_engine::state::{DEV_MONOPOLY, DEV_ROAD_BUILDING, DEV_YEAR_OF_PLENTY};
    let (mut game, topology) = reason_position(Layout::Standard4, 0);
    for seat in 0..4 {
        stats(&mut game, seat, [0; 5]);
    }
    stats(&mut game, 0, [0, 1, 1, 0, 1]);
    set_turn(&mut game, false, [2; 3]);
    let (board, mut arena) = reason_arena(&game, &topology);
    for resource in Resource::ALL {
        let count = arena.state.players[0].resources[resource.index()];
        arena.state.bank[resource.index()] -= count as u16;
        arena.state.belief.gain(0, resource.index(), count as u16);
    }
    for (seat, kind) in [DEV_ROAD_BUILDING, DEV_YEAR_OF_PLENTY, DEV_MONOPOLY]
        .into_iter()
        .enumerate()
    {
        arena.state.players[seat].dev_plays_revealed[kind] = 2;
    }
    arena.drain_dev_deck_for_test(6);
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let mut scratch = PolicyScratch::default();
    policy::action(
        POLICY,
        &view,
        &mut scratch,
        &mut Xoshiro256StarStar::from_seed(0),
    );
    let native = scratch
        .actions
        .as_slice()
        .iter()
        .find(|entry| entry.action == Action::BuyDev)
        .unwrap()
        .score;
    let output = turn(&game);
    assert_eq!(output["derived"]["devDeckRemaining"], 19);
    let buy = output["actions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|entry| entry["action"]["type"] == "buyDev")
        .unwrap();
    assert_eq!(
        (buy["score"].as_f64().unwrap() as f32).to_bits(),
        native.to_bits()
    );
}

#[test]
fn progress_played_requires_exact_kind_counts() {
    let (mut game, _) = fixture();
    set_turn(&mut game, false, [0; 3]);
    for bad in [
        json!(0),
        json!({"roadBuilding":0,"yearOfPlenty":0}),
        json!({"roadBuilding":0,"yearOfPlenty":0,"monopoly":0,"knight":0}),
        json!({"roadBuilding":0,"yearOfPlenty":-1,"monopoly":0}),
    ] {
        game["turn"]["progressPlayed"] = bad;
        let output: Value = serde_json::from_str(&advise(
            &json!({"game":game,"decision":{"kind":"turn"}}).to_string(),
        ))
        .unwrap();
        assert!(output["error"].is_string(), "{output}");
    }
}

#[test]
fn an_ore_trade_needs_a_rival_who_could_hold_ore() {
    let (mut game, topology) = fixture();
    let vertices = independent_vertices(&topology, 3);
    for (seat, vertex) in vertices.into_iter().enumerate() {
        building(&mut game, &topology, seat, vertex, "settlement");
    }
    stats(&mut game, 0, [0, 0, 2, 0, 2]);
    let rivals = [id(&game, 1), id(&game, 2)];
    for (seat, rival) in [1, 2].into_iter().zip(&rivals) {
        stats(&mut game, seat, [0; 5]);
        game["stats"][rival]["handUnknown"] = json!(6);
    }
    let offer = turn(&game)["actions"][0].clone();
    assert_eq!(offer["action"]["type"], "offerTrade", "{offer}");
    assert_eq!(offer["action"]["get"], "ore", "{offer}");
    // Every unseen card was stolen from hands without ore, so no rival can give one.
    for rival in &rivals {
        game["stats"][rival]["handUnknownAmong"] = json!([["wood", "sheep", "wheat", "brick"]].repeat(6));
    }
    let actions = turn(&game)["actions"].clone();
    assert!(
        actions.as_array().unwrap().iter().all(|entry| entry["action"]["get"] != "ore" || entry["action"]["type"] != "offerTrade"),
        "{actions}"
    );
}

#[test]
fn narrowed_unseen_cards_must_fit_the_count() {
    let (mut game, _) = fixture();
    stats(&mut game, 1, [0; 5]);
    let rival = id(&game, 1);
    game["stats"][&rival]["handUnknown"] = json!(1);
    game["stats"][&rival]["handUnknownAmong"] = json!([["wood", "brick"], ["wood", "brick"]]);
    let output: Value = serde_json::from_str(&advise(&json!({"game":game,"decision":{"kind":"turn"}}).to_string())).unwrap();
    assert!(output["error"].as_str().unwrap().contains("narrowed unseen cards"), "{output}");
}
