use unsettled_engine::board::{ConversionOptions, SimBoard};
use unsettled_engine::rng::Xoshiro256StarStar;
use unsettled_engine::rules::{Resource, RuleConfig};
use unsettled_engine::topology::{Hex, Layout, Topology};
use unsettled_engine::wire::{Coord, TileKind, WireBoard, WireHex, WirePlayer, WirePort};

pub fn generate_board(layout: Layout, seats: usize, seed: u64) -> Result<SimBoard, String> {
    let topology = Topology::load(layout)?;
    let mut rng = Xoshiro256StarStar::from_seed(seed);
    let mut tile_pool = Vec::with_capacity(topology.hex_count());
    for (index, count) in topology.resource_counts().into_iter().enumerate() {
        let tile = match index {
            0 => TileKind::Wood,
            1 => TileKind::Sheep,
            2 => TileKind::Wheat,
            3 => TileKind::Brick,
            4 => TileKind::Ore,
            _ => TileKind::Desert,
        };
        tile_pool.extend(std::iter::repeat_n(tile, usize::from(count)));
    }
    rng.shuffle(&mut tile_pool);

    let mut token_pool = Vec::with_capacity(topology.hex_count());
    for (token, count) in topology.token_counts().into_iter().enumerate() {
        token_pool.extend(std::iter::repeat_n(token as u8, usize::from(count)));
    }
    let mut red_tokens: Vec<_> = token_pool
        .iter()
        .copied()
        .filter(|token| matches!(token, 6 | 8))
        .collect();
    let mut other_tokens: Vec<_> = token_pool
        .iter()
        .copied()
        .filter(|token| !matches!(token, 6 | 8))
        .collect();
    rng.shuffle(&mut red_tokens);
    rng.shuffle(&mut other_tokens);
    let mut candidates: Vec<Hex> = tile_pool
        .iter()
        .enumerate()
        .filter_map(|(hex, tile)| (*tile != TileKind::Desert).then_some(hex as Hex))
        .collect();
    rng.shuffle(&mut candidates);
    let mut red_hexes = Vec::with_capacity(red_tokens.len());
    if !select_independent_reds(&topology, &candidates, 0, red_tokens.len(), &mut red_hexes) {
        return Err("topology has no independent placement for red tokens".into());
    }
    let mut numbers = vec![None; topology.hex_count()];
    for (hex, token) in red_hexes.iter().zip(red_tokens) {
        numbers[usize::from(*hex)] = Some(token);
    }
    let mut other_cursor = 0;
    for (hex, tile) in tile_pool.iter().enumerate() {
        if *tile != TileKind::Desert && numbers[hex].is_none() {
            numbers[hex] = Some(other_tokens[other_cursor]);
            other_cursor += 1;
        }
    }
    let hexes = (0..topology.hex_count())
        .map(|hex| {
            let coord = parse_coord(topology.hex_key(hex as Hex))?;
            Ok(WireHex {
                coord,
                tile: Some(tile_pool[hex]),
                number_token: numbers[hex].map(f64::from),
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    let desert = tile_pool
        .iter()
        .position(|tile| *tile == TileKind::Desert)
        .ok_or_else(|| "generated board has no desert".to_string())?;

    let mut port_pool = if layout == Layout::Standard4 {
        vec![
            None,
            None,
            None,
            None,
            Some(Resource::Wood),
            Some(Resource::Sheep),
            Some(Resource::Wheat),
            Some(Resource::Brick),
            Some(Resource::Ore),
        ]
    } else {
        vec![
            None,
            None,
            None,
            None,
            None,
            Some(Resource::Wood),
            Some(Resource::Sheep),
            Some(Resource::Sheep),
            Some(Resource::Wheat),
            Some(Resource::Brick),
            Some(Resource::Ore),
        ]
    };
    rng.shuffle(&mut port_pool);
    let ports = topology
        .default_port_edges()
        .iter()
        .zip(port_pool)
        .map(|(edge, resource)| WirePort {
            edge_id: topology.edge_id(*edge).to_string(),
            resource,
            rate: if resource.is_some() { 2.0 } else { 3.0 },
        })
        .collect();
    let players = (0..seats)
        .map(|seat| WirePlayer {
            id: format!("p{}", seat + 1),
            name: format!("P{}", seat + 1),
            color: [
                "#c23f38", "#3063ba", "#e58331", "#ffffff", "#5d9e52", "#7a5230",
            ][seat % 6]
                .to_string(),
        })
        .collect();
    let wire = WireBoard {
        schema_version: 1,
        layout,
        hexes,
        ports,
        robber: Some(parse_coord(topology.hex_key(desert as Hex))?),
        roads: Vec::new(),
        buildings: Vec::new(),
        players,
        me_player_id: None,
    };
    wire.validate().map_err(|error| error.to_string())?;
    SimBoard::try_from_wire(
        wire,
        &topology,
        &RuleConfig::base(layout),
        ConversionOptions {
            allow_unofficial: true,
        },
    )
    .map_err(|error| error.to_string())
}

fn select_independent_reds(
    topology: &Topology,
    candidates: &[Hex],
    cursor: usize,
    needed: usize,
    selected: &mut Vec<Hex>,
) -> bool {
    if selected.len() == needed {
        return true;
    }
    if candidates.len().saturating_sub(cursor) < needed - selected.len() {
        return false;
    }
    for index in cursor..candidates.len() {
        let candidate = candidates[index];
        if selected
            .iter()
            .all(|hex| !topology.hex_neighbors(candidate).contains(hex))
        {
            selected.push(candidate);
            if select_independent_reds(topology, candidates, index + 1, needed, selected) {
                return true;
            }
            selected.pop();
        }
    }
    false
}

fn parse_coord(key: &str) -> Result<Coord, String> {
    let (q, r) = key
        .split_once(',')
        .ok_or_else(|| format!("invalid topology coordinate {key}"))?;
    Ok(Coord {
        q: q.parse().map_err(|_| format!("invalid q coordinate {q}"))?,
        r: r.parse().map_err(|_| format!("invalid r coordinate {r}"))?,
    })
}
