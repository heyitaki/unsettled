use serde_json::{Value, json};
use unsettled_engine::advice::advise;
use unsettled_engine::board::{ConversionOptions, SimBoard};
use unsettled_engine::game::{GameArena, GameConfig};
use unsettled_engine::rng::Xoshiro256StarStar;
use unsettled_engine::rules::{Resource, RuleConfig};
use unsettled_engine::topology::{Layout, Topology};
use unsettled_engine::wire::WireBoard;

fn draft(layout: Layout, seats: usize) -> Value {
    let topology = Topology::load(layout).unwrap();
    let rules = RuleConfig::base(layout);
    let mut wire: Value = serde_json::from_str(include_str!(
        "../../../../src/parser/__tests__/expected/board-draft-empty.json"
    )).unwrap();
    let mut rng = Xoshiro256StarStar::from_seed(37);
    let mut tiles = Vec::new();
    for (resource, count) in ["wood", "sheep", "wheat", "brick", "ore", "desert"]
        .into_iter().zip(topology.resource_counts())
    {
        tiles.extend(std::iter::repeat_n(resource, usize::from(count)));
    }
    let mut tokens = Vec::new();
    for (token, count) in topology.token_counts().into_iter().enumerate() {
        tokens.extend(std::iter::repeat_n(token, usize::from(count)));
    }
    rng.shuffle(&mut tiles);
    rng.shuffle(&mut tokens);
    wire["layout"] = json!(layout);
    wire["hexes"] = json!((0..topology.hex_count() as u8).map(|hex| {
        let (q, r) = topology.hex_key(hex).split_once(',').unwrap();
        let tile = tiles[usize::from(hex)];
        json!({"coord":{"q":q.parse::<i64>().unwrap(),"r":r.parse::<i64>().unwrap()},
            "tile":tile,"numberToken":if tile == "desert" {None} else {tokens.pop()}})
    }).collect::<Vec<_>>());
    wire["ports"] = json!(topology.default_port_edges().iter().enumerate().map(|(index, edge)| {
        json!({"edgeId":topology.edge_id(*edge),"resource":Resource::ALL.get(index),
            "rate":if index < 5 {2} else {3}})
    }).collect::<Vec<_>>());
    wire["players"] = json!((0..seats).map(|seat| {
        json!({"id":format!("p{seat}"),"name":format!("Player {seat}"),"color":"#c23f38"})
    }).collect::<Vec<_>>());
    wire["mePlayerId"] = json!("p0");
    wire["robber"] = Value::Null;
    let board = SimBoard::try_from_wire(WireBoard::parse_value(wire.clone()).unwrap(),
        &topology, &rules, ConversionOptions::default()).unwrap();
    let mut arena = GameArena::default();
    let config = GameConfig::default();
    arena.prepare(&board, &topology, &rules, &config);
    let mut buildings = Vec::new();
    for seat in (0..seats).chain((0..seats).rev()) {
        let grant = buildings.len() >= seats;
        let vertex = arena.setup_pick_for_test(&board, &topology, &rules, &config, seat, grant).unwrap();
        buildings.push(json!({"vertexId":topology.vertex_id(vertex),
            "playerId":format!("p{seat}"),"tier":"settlement"}));
    }
    wire["buildings"] = json!(buildings);
    wire["roads"] = json!((0..topology.edge_count() as u8).filter_map(|edge| {
        let seat = arena.state.edge_owner[usize::from(edge)];
        (usize::from(seat) < seats).then(|| json!({"edgeId":topology.edge_id(edge),"playerId":format!("p{seat}")}))
    }).collect::<Vec<_>>());
    json!({"game":{"schemaVersion":1,"board":wire,"stats":{}},
        "observer":"ignored","decision":{"kind":"recap","games":20,"batch":0}})
}

fn response(request: &Value) -> Value {
    serde_json::from_str(&advise(&request.to_string())).unwrap()
}

fn assert_counts(output: &Value, seats: usize, games: u64) {
    assert_eq!(output["kind"], "recap", "{output}");
    assert_eq!(output["games"], games);
    let wins = output["wins"].as_object().unwrap();
    assert_eq!(wins.len(), seats);
    for seat in 0..seats {
        assert!(wins[&format!("p{seat}")].is_u64());
    }
    assert_eq!(wins.values().map(|n| n.as_u64().unwrap()).sum::<u64>()
        + output["draws"].as_u64().unwrap(), games);
}

#[test]
fn recap_counts_every_game() {
    assert_counts(&response(&draft(Layout::Standard4, 4)), 4, 20);
}

#[test]
fn recap_is_repeatable() {
    let mut request = draft(Layout::Standard4, 4);
    let first = advise(&request.to_string());
    assert_eq!(first, advise(&request.to_string()));
    request["decision"]["batch"] = json!(1);
    assert_ne!(serde_json::from_str::<Value>(&first).unwrap()["wins"], response(&request)["wins"]);
}

#[test]
fn recap_ignores_recorded_hands() {
    let mut request = draft(Layout::Standard4, 4);
    let first = advise(&request.to_string());
    request["game"]["stats"]["p0"] = json!({"hand":{"wood":4,"sheep":2,"wheat":3,"brick":1,"ore":5},
        "handUnknown":2,"devCards":3,"knights":2,"vpCards":1});
    request["game"]["awards"] = json!({"longestRoad":"p0","largestArmy":"p1"});
    request["game"]["turn"] = json!({"playerId":"p2","rolled":8,"devPlayed":true,
        "progressPlayed":{"roadBuilding":1,"yearOfPlenty":0,"monopoly":0}});
    request["game"]["devHand"] = json!({"playerId":"p0",
        "playable":{"knight":1,"roadBuilding":0,"yearOfPlenty":0,"monopoly":0},
        "bought":{"knight":0,"roadBuilding":0,"yearOfPlenty":0,"monopoly":0}});
    assert_eq!(first, advise(&request.to_string()));
}

#[test]
fn recap_refuses_bad_requests() {
    let request = draft(Layout::Standard4, 4);
    for games in [0, 1001] {
        let mut invalid = request.clone();
        invalid["decision"]["games"] = json!(games);
        assert!(response(&invalid)["error"].is_string());
    }
    let mut short = request.clone();
    short["game"]["board"]["buildings"].as_array_mut().unwrap().pop();
    assert!(response(&short)["error"].is_string());
    let mut city = request.clone();
    city["game"]["board"]["buildings"][7]["tier"] = json!("city");
    assert!(response(&city)["error"].is_string());
    let mut extra = request.clone();
    let topology = Topology::load(Layout::Standard4).unwrap();
    let buildings = extra["game"]["board"]["buildings"].as_array_mut().unwrap();
    let occupied: Vec<_> = buildings.iter().map(|building| {
        topology.vertex_by_id(building["vertexId"].as_str().unwrap()).unwrap()
    }).collect();
    let vertex = (0..topology.vertex_count() as u8).find(|vertex| {
        !occupied.contains(vertex) && topology.vertex_adjacent(*vertex).iter().all(|adjacent| !occupied.contains(adjacent))
    }).unwrap();
    buildings.push(json!({"vertexId":topology.vertex_id(vertex),"playerId":"p0","tier":"settlement"}));
    assert_eq!(response(&extra)["error"], "recap requires exactly two settlements for player p0");
    let mut blank = request.clone();
    blank["game"]["board"]["hexes"][0]["tile"] = Value::Null;
    assert!(response(&blank)["error"].is_string());
    let mut unknown = request;
    unknown["game"]["unexpected"] = json!(true);
    assert!(response(&unknown)["error"].is_string());
}

#[test]
fn recap_runs_on_six_seats() {
    let mut request = draft(Layout::Extension6, 6);
    request["decision"]["games"] = json!(5);
    assert_counts(&response(&request), 6, 5);
}

#[test]
fn play_from_draft_deals_second_settlement_grants() {
    let request = draft(Layout::Standard4, 4);
    let topology = Topology::load(Layout::Standard4).unwrap();
    let mut rules = RuleConfig::base(Layout::Standard4);
    let board = SimBoard::try_from_wire(WireBoard::parse_value(request["game"]["board"].clone()).unwrap(),
        &topology, &rules, ConversionOptions::default()).unwrap();
    let mut arena = GameArena::default();
    let config = GameConfig::default();
    arena.prepare_from_draft_for_test(&board, &topology, &rules, &config);
    let mut differs_from_first = false;
    for seat in 0..board.seats() {
        let buildings: Vec<_> = board.buildings().iter().filter(|b| usize::from(b.seat) == seat).collect();
        let grant = |vertex| {
            let mut cards = [0_i16; 5];
            for hex in topology.vertex_hexes(vertex) {
                if let Some(resource) = board.tiles()[usize::from(*hex)] {
                    cards[resource.index()] += 1;
                }
            }
            cards
        };
        let second = grant(buildings[1].vertex);
        let first = grant(buildings[0].vertex);
        differs_from_first |= arena.state.players[seat].resources != first;
        assert!(first.iter().sum::<i16>() > 0);
        assert_eq!(arena.state.players[seat].resources, second);
        assert_eq!(*arena.state.belief.lo(seat), second.map(|n| n as u16));
        assert_eq!(*arena.state.belief.hi(seat), second.map(|n| n as u16));
    }
    assert!(differs_from_first, "the dealt hand must distinguish the second building from the first");
    assert!(arena.invariants_hold(&board, &topology, &rules));

    // A scarce bank makes the reverse-seat dealing order observable.
    rules.bank_supply = [1; 5];
    arena.prepare_from_draft_for_test(&board, &topology, &rules, &config);
    let mut remaining = [1_i16; 5];
    for seat in (0..board.seats()).rev() {
        let second = board.buildings().iter().filter(|b| usize::from(b.seat) == seat).nth(1).unwrap();
        let mut expected = [0; 5];
        for hex in topology.vertex_hexes(second.vertex) {
            if let Some(resource) = board.tiles()[usize::from(*hex)] {
                let index = resource.index();
                if remaining[index] > 0 {
                    remaining[index] -= 1;
                    expected[index] += 1;
                }
            }
        }
        assert_eq!(arena.state.players[seat].resources, expected);
    }
}
