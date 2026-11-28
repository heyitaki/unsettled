use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::PathBuf;

use serde_json::{Value, json};
use unsettled_engine::advice::advise;
use unsettled_engine::board::{ConversionOptions, SimBoard};
use unsettled_engine::game::{GameArena, GameConfig};
use unsettled_engine::placement::PlacementKind;
use unsettled_engine::rng::Xoshiro256StarStar;
use unsettled_engine::rules::{Resource, RuleConfig};
use unsettled_engine::state::{EMPTY, MAX_SEATS};
use unsettled_engine::topology::{Layout, Topology};
use unsettled_engine::view::{Action, DecisionPhase};
use unsettled_engine::wire::WireBoard;

const DECISIONS: [&str; 6] = [
    "turn",
    "preRoll",
    "discard",
    "robber",
    "tradeResponse",
    "produce",
];
const ACTIONS: [&str; 8] = [
    "buildRoad",
    "buildSettlement",
    "upgradeCity",
    "buyDev",
    "playKnight",
    "tradeBank",
    "offerTrade",
    "pass",
];

fn fixture_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/advice-parity.json")
}

fn read_fixture() -> Value {
    serde_json::from_str(&fs::read_to_string(fixture_path()).unwrap()).unwrap()
}

fn response(request: &Value) -> Value {
    let response: Value = serde_json::from_str(&advise(&request.to_string())).unwrap();
    assert!(response.get("error").is_none(), "{response}");
    response
}

#[test]
fn fixture_matches_native_advice() {
    for case in read_fixture()["cases"].as_array().unwrap() {
        assert_eq!(
            response(&case["request"]),
            case["response"],
            "{}",
            case["name"]
        );
    }
}

#[test]
fn fixture_covers_every_decision_and_edge() {
    assert_coverage(&read_fixture());
}

fn assert_coverage(fixture: &Value) {
    let mut positions = BTreeMap::<String, BTreeSet<String>>::new();
    let mut names = BTreeSet::new();
    let mut layouts = [0; 2];
    let mut actions = BTreeSet::new();
    let mut pre_roll = [false; 2];
    let mut robber = [false; 2];
    let mut accept = [false; 2];
    let mut null_margin = false;
    let mut discards = false;
    let mut observers = 0;
    let mut unknown = 0;
    let mut super_city = false;
    let mut awards = [false; 2];
    let mut turns = [false; 2];
    let mut dev_hands = [false; 2];
    let mut monopoly = false;
    let mut unclaimed = false;
    let mut unicode_name = false;
    let mut production = false;
    let mut progress = false;
    let mut rival_vp = false;
    let mut narrowed = false;
    for case in fixture["cases"].as_array().unwrap() {
        assert!(names.insert(case["name"].as_str().unwrap()));
        let request = &case["request"];
        let game = &request["game"];
        let result = &case["response"];
        let kind = request["decision"]["kind"].as_str().unwrap();
        assert_eq!(result["kind"], kind);
        let key = json!({"game":game,"observer":request["observer"]}).to_string();
        assert!(positions.entry(key).or_default().insert(kind.into()));
        match kind {
            "turn" => {
                for entry in result["actions"].as_array().unwrap() {
                    actions.insert(entry["action"]["type"].as_str().unwrap());
                }
                let board = &game["board"];
                let extension = board["layout"] == "extension6";
                layouts[usize::from(extension)] += 1;
                let seats = board["players"].as_array().unwrap().len();
                assert!(if extension {
                    (5..=6).contains(&seats)
                } else {
                    seats == 4
                });
                let observer = request.get("observer").unwrap_or(&board["mePlayerId"]);
                unclaimed |= board["mePlayerId"].is_null() && request["observer"].is_string();
                unicode_name |= board["players"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|player| !player["name"].as_str().unwrap().is_ascii());
                progress |= ["roadBuilding", "yearOfPlenty", "monopoly"]
                    .iter()
                    .all(|kind| game["turn"]["progressPlayed"][kind].as_u64().unwrap_or(0) > 0);
                rival_vp |= game["stats"]
                    .as_object()
                    .unwrap()
                    .iter()
                    .any(|(id, stats)| observer != id && stats["vpCards"].as_u64().unwrap() > 0);
                observers += usize::from(observer != &board["mePlayerId"]);
                unknown += usize::from(game["stats"].as_object().unwrap().iter().any(
                    |(id, stats)| observer != id && stats["handUnknown"].as_u64().unwrap() > 0,
                ));
                narrowed |= game["stats"].as_object().unwrap().iter().any(|(id, stats)| {
                    observer != id && stats.get("handUnknownAmong").is_some()
                });
                super_city |= board["buildings"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|b| b["tier"] == "superCity");
                awards[usize::from(game.get("awards").is_some())] = true;
                turns[usize::from(game.get("turn").is_some())] = true;
                dev_hands[usize::from(game.get("devHand").is_some())] = true;
                assert_midgame(board);
            }
            "preRoll" => {
                pre_roll[usize::from(!result["play"].is_null())] = true;
                monopoly |= result["play"]["type"] == "monopoly";
            }
            "discard" => discards |= result["count"].as_u64().unwrap() > 0,
            "robber" => robber[usize::from(!result["victim"].is_null())] = true,
            "tradeResponse" => {
                accept[usize::from(result["accept"].as_bool().unwrap())] = true;
                null_margin |= result["margin"].is_null();
            }
            "produce" => {
                production |= result["gains"].as_object().unwrap().values().any(|hand| {
                    hand.as_object()
                        .unwrap()
                        .values()
                        .any(|count| count.as_u64().unwrap() > 0)
                })
            }
            _ => panic!("unexpected decision {kind}"),
        }
    }
    assert!(layouts.iter().all(|count| *count >= 12), "{layouts:?}");
    for decisions in positions.values() {
        assert_eq!(
            decisions,
            &DECISIONS.map(String::from).into_iter().collect()
        );
    }
    assert_eq!(actions, ACTIONS.into_iter().collect());
    assert_eq!(pre_roll, [true; 2]);
    assert_eq!(robber, [true; 2]);
    assert_eq!(accept, [true; 2]);
    assert!(null_margin && discards && super_city);
    assert!(
        observers >= 6 && unknown >= 6,
        "observers {observers}, unknown {unknown}"
    );
    assert_eq!(awards, [true; 2]);
    assert_eq!(turns, [true; 2]);
    assert_eq!(dev_hands, [true; 2]);
    assert!(monopoly, "missing a pre-roll Monopoly");
    assert!(
        unclaimed,
        "missing an explicit observer on an unclaimed board"
    );
    assert!(unicode_name, "missing a non-ASCII player name");
    assert!(production, "missing non-zero production");
    assert!(
        progress,
        "missing played counts for all three progress kinds"
    );
    assert!(rival_vp, "missing rival VP cards");
    assert!(narrowed, "missing a rival's narrowed unseen cards");
}

fn assert_midgame(board: &Value) {
    let wire = WireBoard::parse_value(board.clone()).unwrap();
    let topology = Topology::load(wire.layout).unwrap();
    let rules = RuleConfig::base(wire.layout);
    let board =
        SimBoard::try_from_wire(wire, &topology, &rules, ConversionOptions::default()).unwrap();
    let mut arena = GameArena::default();
    arena.prepare(&board, &topology, &rules, &GameConfig::default());
    for building in board.buildings() {
        for adjacent in topology.vertex_adjacent(building.vertex) {
            assert_eq!(arena.state.vertex_owner[usize::from(*adjacent)], EMPTY);
        }
        assert!(
            topology
                .vertex_edges(building.vertex)
                .iter()
                .any(|edge| { arena.state.edge_owner[usize::from(*edge)] == building.seat })
        );
    }
    for seat in 0..board.seats() as u8 {
        let buildings: Vec<_> = board
            .buildings()
            .iter()
            .filter(|b| b.seat == seat)
            .collect();
        assert!(
            buildings.len() >= 3,
            "seat {seat} has {} buildings",
            buildings.len()
        );
        assert!(
            buildings
                .iter()
                .any(|b| arena.state.vertex_tier[usize::from(b.vertex)] >= 2)
        );
        let roads: BTreeSet<_> = board
            .roads()
            .iter()
            .filter(|r| r.seat == seat)
            .map(|r| r.edge)
            .collect();
        assert!(roads.len() >= 4);
        let mut reached = BTreeSet::new();
        let mut frontier: Vec<_> = buildings.iter().map(|b| b.vertex).collect();
        while let Some(vertex) = frontier.pop() {
            // A rival can have settled on the road after it was built.
            for edge in topology.vertex_edges(vertex) {
                if roads.contains(edge) && reached.insert(*edge) {
                    frontier.extend(topology.edge_endpoints(*edge));
                }
            }
        }
        assert_eq!(reached, roads, "disconnected road for seat {seat}");
    }
}

fn empty_board(layout: Layout, seats: usize, rng: &mut Xoshiro256StarStar) -> Value {
    let relative = PathBuf::from("src/parser/__tests__/expected/board-draft-empty.json");
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .map(|root| root.join(&relative))
        .find(|path| path.is_file())
        .unwrap();
    let mut board: Value = serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap();
    let topology = Topology::load(layout).unwrap();
    let mut tiles = Vec::new();
    for (resource, count) in ["wood", "sheep", "wheat", "brick", "ore", "desert"]
        .into_iter()
        .zip(topology.resource_counts())
    {
        tiles.extend(std::iter::repeat_n(resource, usize::from(count)));
    }
    let mut tokens = Vec::new();
    for (token, count) in topology.token_counts().into_iter().enumerate() {
        tokens.extend(std::iter::repeat_n(token, usize::from(count)));
    }
    rng.shuffle(&mut tiles);
    rng.shuffle(&mut tokens);
    board["layout"] = json!(layout);
    board["hexes"] = json!(
        (0..topology.hex_count() as u8)
            .map(|hex| {
                let (q, r) = topology.hex_key(hex).split_once(',').unwrap();
                let tile = tiles[usize::from(hex)];
                json!({"coord":{"q":q.parse::<i64>().unwrap(),"r":r.parse::<i64>().unwrap()},
            "tile":tile,"numberToken":if tile == "desert" {None} else {tokens.pop()}})
            })
            .collect::<Vec<_>>()
    );
    board["ports"] = json!(
        topology
            .default_port_edges()
            .iter()
            .enumerate()
            .map(|(index, edge)| {
                json!({"edgeId":topology.edge_id(*edge),"resource":Resource::ALL.get(index),
            "rate":if index < 5 {2} else {3}})
            })
            .collect::<Vec<_>>()
    );
    board["players"]
        .as_array_mut()
        .unwrap()
        .push(json!({"id":"p6","name":"Brown","color":"brown"}));
    board["players"].as_array_mut().unwrap().truncate(seats);
    board["players"][1]["name"] = json!("Ágata");
    board["mePlayerId"] = board["players"][0]["id"].clone();
    board["robber"] =
        board["hexes"][rng.range(topology.hex_count() as u32) as usize]["coord"].clone();
    board
}

fn position(layout: Layout, index: usize, seed: u64) -> Value {
    let mut rng = Xoshiro256StarStar::from_seed(seed);
    let seats = if layout == Layout::Standard4 {
        4
    } else {
        5 + index % 2
    };
    let mut wire = empty_board(layout, seats, &mut rng);
    let topology = Topology::load(layout).unwrap();
    let rules = RuleConfig::base(layout);
    let board = SimBoard::try_from_wire(
        WireBoard::parse_value(wire.clone()).unwrap(),
        &topology,
        &rules,
        ConversionOptions::default(),
    )
    .unwrap();
    let config = GameConfig {
        seed,
        placements: [PlacementKind::Random; MAX_SEATS],
        ..GameConfig::default()
    };
    let mut arena = GameArena::default();
    arena.prepare(&board, &topology, &rules, &config);
    arena.setup_for_test(&board, &topology, &rules, &config);
    for seat in 0..seats {
        for _ in 0..14 {
            arena.state.players[seat].resources = [5; 5];
            let view = arena.decision_view(&board, &topology, seat, DecisionPhase::Action);
            let buildings = arena
                .state
                .vertex_owner
                .iter()
                .filter(|owner| **owner == seat as u8)
                .count();
            if buildings >= 3 && view.own_road_count() >= 5 {
                break;
            }
            let action =
                if let Some(vertex) = view.best_legal_settlement().filter(|_| buildings < 3) {
                    Action::BuildSettlement(vertex)
                } else {
                    let edges: Vec<_> = (0..topology.edge_count() as u8)
                        .filter(|edge| view.legal_road(*edge))
                        .collect();
                    let Some(edge) = view.best_expansion_road().or_else(|| {
                        (!edges.is_empty()).then(|| edges[rng.range(edges.len() as u32) as usize])
                    }) else {
                        break;
                    };
                    Action::BuildRoad(edge)
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
        arena.state.players[seat].resources = [5; 5];
        let vertex = arena
            .decision_view(&board, &topology, seat, DecisionPhase::Action)
            .affordable_city()
            .unwrap();
        assert!(arena.apply_action_for_test(
            &board,
            &topology,
            &rules,
            &config,
            seat,
            Action::UpgradeCity(vertex),
            DecisionPhase::Action
        ));
    }
    let ids: Vec<_> = wire["players"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["id"].as_str().unwrap().to_owned())
        .collect();
    wire["roads"] = json!(
        (0..topology.edge_count() as u8)
            .filter_map(|edge| {
                let seat = arena.state.edge_owner[usize::from(edge)];
                (seat != EMPTY).then(
                    || json!({"edgeId":topology.edge_id(edge),"playerId":ids[usize::from(seat)]}),
                )
            })
            .collect::<Vec<_>>()
    );
    wire["buildings"] = json!((0..topology.vertex_count() as u8).filter_map(|vertex| {
        let seat = arena.state.vertex_owner[usize::from(vertex)];
        (seat != EMPTY).then(|| {
            let tier = match arena.state.vertex_tier[usize::from(vertex)] {
                1 => "settlement",
                _ if index == 0 && seat == 0 => "superCity",
                _ => "city",
            };
            json!({"vertexId":topology.vertex_id(vertex),"playerId":ids[usize::from(seat)],"tier":tier})
        })
    }).collect::<Vec<_>>());
    let observer = index % 2;
    let hands = [
        [4, 2, 3, 2, 3],
        [4, 0, 1, 2, 0],
        [0, 2, 1, 1, 2],
        [1, 0, 2, 0, 3],
        [2, 1, 0, 3, 0],
        [0, 0, 0, 0, 0],
    ];
    let mut stats = serde_json::Map::new();
    for (seat, id) in ids.iter().enumerate() {
        let hand = if index == 8 {
            if seat == observer {
                [1, 1, 1, 0, 0]
            } else {
                [0, 0, 0, 1, 0]
            }
        } else if index == 0 && seat != observer {
            [0; 5]
        } else if seat == observer {
            hands[index % hands.len()]
        } else {
            std::array::from_fn(|_| rng.range(4))
        };
        let unknown = if index != 0 && seat != observer && seat != 0 {
            2
        } else {
            0
        };
        let knights = if seat == observer { 2 } else { rng.range(3) };
        stats.insert(id.clone(), json!({"hand":{"wood":hand[0],"sheep":hand[1],"wheat":hand[2],"brick":hand[3],"ore":hand[4]},
            "handUnknown":unknown,"devCards":rng.range(3),"knights":knights,"vpCards":0}));
        // Some unseen cards narrowed to a few types, as after an unseen steal.
        if unknown > 0 && index % 2 == 1 {
            stats[id]["handUnknownAmong"] = json!([json!(["wood", "brick"]), json!(["sheep", "wheat", "ore"])][..seat % 2 + 1]);
        }
    }
    let mut game = json!({"schemaVersion":1,"board":wire,"stats":stats});
    if index == 4 {
        game["stats"][&ids[1]]["vpCards"] = json!(1);
    }
    if index == 11 {
        game["board"]["mePlayerId"] = Value::Null;
    }
    if index % 3 != 1 {
        game["awards"] = json!({"longestRoad":arena.state.longest_road.holder.map(|seat| &ids[seat]),"largestArmy":null});
    }
    if index % 3 != 2 {
        game["turn"] = json!({"playerId":ids[observer],"rolled":if index % 2 == 0 {None} else {Some(8)},
            "devPlayed":index == 10,"progressPlayed":{"roadBuilding":index % 3,"yearOfPlenty":index % 3,"monopoly":index % 3}});
    }
    if index % 4 != 3 {
        game["devHand"] = json!({"playerId":ids[0],
            "playable":{"knight":u8::from(![2,4,6,8].contains(&index)),"roadBuilding":u8::from(index == 2),"yearOfPlenty":u8::from(index == 4),"monopoly":u8::from([6,8].contains(&index))},
            "bought":{"knight":u8::from(index % 3 == 0),"roadBuilding":0,"yearOfPlenty":0,"monopoly":0}});
        game["stats"][&ids[0]]["devCards"] = json!(1 + u8::from(index % 3 == 0));
    }
    let mut request = json!({"game":game});
    if observer != 0 {
        request["observer"] = json!(ids[observer]);
    }
    request
}

fn trade_decision(request: &Value, index: usize) -> Value {
    let board = &request["game"]["board"];
    let observer = request.get("observer").unwrap_or(&board["mePlayerId"]);
    let proposer = board["players"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| &p["id"] != observer)
        .unwrap()["id"]
        .clone();
    let mut trial = request.clone();
    for give in Resource::ALL {
        for get in Resource::ALL {
            if give == get {
                continue;
            }
            for count in [1, 2] {
                trial["decision"] = json!({"kind":"tradeResponse","proposer":proposer,"give":give,"get":get,"count":count});
                let output = response(&trial);
                let matches = match index % 3 {
                    0 => output["accept"] == true,
                    1 => output["accept"] == false && output["margin"].is_number(),
                    _ => output["margin"].is_null(),
                };
                if matches {
                    return trial["decision"].clone();
                }
            }
        }
    }
    trial["decision"].clone()
}

#[test]
#[ignore]
fn regenerate_advice_parity_fixture() {
    let mut cases = Vec::new();
    for layout in [Layout::Standard4, Layout::Extension6] {
        for (index, seed) in [11, 23, 37, 41, 53, 67, 79, 83, 97, 101, 113, 127]
            .into_iter()
            .enumerate()
        {
            let mut request = position(layout, index, seed);
            let trade = trade_decision(&request, index);
            for kind in DECISIONS {
                request["decision"] = match kind {
                    "tradeResponse" => trade.clone(),
                    "produce" => json!({"kind":kind,"total":2 + index % 11}),
                    _ => json!({"kind":kind}),
                };
                let mut output = response(&request);

                // Restore the original f32 values after serde_json's approximate f64 parsing.
                if let Some(actions) = output.get_mut("actions").and_then(Value::as_array_mut) {
                    for entry in actions {
                        entry["score"] = json!(entry["score"].as_f64().unwrap() as f32);
                    }
                }
                if let Some(margin) = output["margin"].as_f64() {
                    output["margin"] = json!(margin as f32);
                }
                cases.push(json!({"name":format!("{}-{seed}-{kind}",layout.as_str()),"request":request,"response":output}));
            }
        }
    }
    let fixture = json!({"cases":cases});
    assert_coverage(&fixture);
    fs::write(
        fixture_path(),
        format!("{}\n", serde_json::to_string_pretty(&fixture).unwrap()),
    )
    .unwrap();
}
