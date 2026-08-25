use std::fs;
use std::path::PathBuf;

use unsettled_engine::belief::{BeliefState, DeckBelief};
use unsettled_engine::board::{ConversionOptions, SimBoard};
use unsettled_engine::game::{GameArena, GameConfig};
use unsettled_engine::policy::PolicyKind;
use unsettled_engine::rules::{Buildable, RESOURCE_COUNT, Resource, RuleConfig, TradeConfig};
use unsettled_engine::state::{EMPTY, MAX_SEATS};
use unsettled_engine::topology::{Hex, Layout, Topology, Vertex};
use unsettled_engine::view::{Action, DecisionPhase, DevPlay};
use unsettled_engine::wire::WireBoard;

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

fn assert_exact(arena: &GameArena, seats: usize) {
    for seat in 0..seats {
        assert!(arena.state.belief.is_exact(seat), "seat={seat}");
        assert_eq!(
            arena.state.belief.lo(seat),
            &arena.state.players[seat]
                .resources
                .map(|count| u16::try_from(count).unwrap()),
            "seat={seat}"
        );
    }
}

fn assert_valid(belief: &BeliefState, seat: usize) {
    let total = belief.total(seat);
    let lo = belief.lo(seat);
    let hi = belief.hi(seat);
    assert!(lo.iter().zip(hi).all(|(lo, hi)| lo <= hi));
    assert!(hi.iter().all(|hi| u32::from(*hi) <= total));
    assert!(lo.iter().map(|value| u32::from(*value)).sum::<u32>() <= total);
    assert!(hi.iter().map(|value| u32::from(*value)).sum::<u32>() >= total);
}

fn other_hex(topology: &Topology, robber: Hex) -> Hex {
    (0..topology.hex_count())
        .map(|hex| hex as Hex)
        .find(|hex| *hex != robber)
        .unwrap()
}

fn place_settlement(arena: &mut GameArena, seat: usize, vertex: Vertex) {
    assert_eq!(arena.state.vertex_owner[usize::from(vertex)], EMPTY);
    arena.state.vertex_owner[usize::from(vertex)] = seat as u8;
    arena.state.vertex_tier[usize::from(vertex)] = 1;
    arena.state.players[seat].pieces[Buildable::Settlement.index()] -= 1;
    arena.state.players[seat].vp_public += 1;
}

fn first_productive_hex(board: &SimBoard, topology: &Topology, robber: Hex) -> (Hex, u8, Resource) {
    (0..topology.hex_count())
        .map(|hex| hex as Hex)
        .find_map(|hex| {
            if hex == robber {
                return None;
            }
            Some((
                hex,
                board.tokens()[usize::from(hex)]?,
                board.tiles()[usize::from(hex)]?,
            ))
        })
        .unwrap()
}

#[test]
fn steal_free_scripted_game_reconstructs_every_hand_exactly() {
    let (topology, board, mut rules, mut config, mut arena) = fixture();
    rules.player_trading = Some(TradeConfig {
        opponent_gain_weight: 0.0,
        acceptance_temperature: 0.0,
        max_offers_per_turn: 8,
        ..TradeConfig::default()
    });
    rules.dev_cost = [0; RESOURCE_COUNT];
    config.policies = [PolicyKind::HeuristicV1Trader; MAX_SEATS];
    arena.prepare(&board, &topology, &rules, &config);
    arena.setup_for_test(&board, &topology, &rules, &config);
    assert_exact(&arena, board.seats());

    for roll in 2..=12 {
        arena.produce_for_test(&board, &topology, &config, roll, board.seats());
        assert_exact(&arena, board.seats());
    }

    let mut traded_with_bank = false;
    for seat in 0..board.seats() {
        for give in Resource::ALL {
            for get in Resource::ALL {
                let action = Action::TradeBank {
                    give,
                    get,
                    count: 1,
                };
                if arena.validate_action(&board, &topology, seat, action, DecisionPhase::Action) {
                    assert!(arena.apply_action_for_test(
                        &board,
                        &topology,
                        &rules,
                        &config,
                        seat,
                        action,
                        DecisionPhase::Action,
                    ));
                    traded_with_bank = true;
                    break;
                }
            }
            if traded_with_bank {
                break;
            }
        }
        if traded_with_bank {
            break;
        }
    }
    assert!(traded_with_bank);
    assert_exact(&arena, board.seats());

    let mut traded_with_player = false;
    for proposer in 0..board.seats() {
        for give in Resource::ALL {
            for get in Resource::ALL {
                let action = Action::OfferTrade {
                    give,
                    get,
                    count: 1,
                };
                if !arena.validate_action(
                    &board,
                    &topology,
                    proposer,
                    action,
                    DecisionPhase::Action,
                ) {
                    continue;
                }
                let before = std::array::from_fn::<_, MAX_SEATS, _>(|seat| {
                    arena.state.players[seat].resources
                });
                let mut candidate = arena.clone();
                assert!(candidate.apply_action_for_test(
                    &board,
                    &topology,
                    &rules,
                    &config,
                    proposer,
                    action,
                    DecisionPhase::Action,
                ));
                let after = std::array::from_fn::<_, MAX_SEATS, _>(|seat| {
                    candidate.state.players[seat].resources
                });
                if after != before {
                    arena = candidate;
                    traded_with_player = true;
                    break;
                }
            }
            if traded_with_player {
                break;
            }
        }
        if traded_with_player {
            break;
        }
    }
    assert!(traded_with_player);
    assert_exact(&arena, board.seats());

    let mut built = false;
    for seat in 0..board.seats() {
        for edge in 0..topology.edge_count() {
            let action = Action::BuildRoad(edge as u8);
            if arena.validate_action(&board, &topology, seat, action, DecisionPhase::Action) {
                assert!(arena.apply_action_for_test(
                    &board,
                    &topology,
                    &rules,
                    &config,
                    seat,
                    action,
                    DecisionPhase::Action,
                ));
                built = true;
                break;
            }
        }
        if built {
            break;
        }
    }
    assert!(built);
    assert_exact(&arena, board.seats());

    let dev_seat = 0;
    for kind in [3, 4] {
        arena.set_next_dev_for_test(kind);
        assert!(arena.apply_action_for_test(
            &board,
            &topology,
            &rules,
            &config,
            dev_seat,
            Action::BuyDev,
            DecisionPhase::Action,
        ));
    }
    arena.promote_dev_for_test(dev_seat);
    let first = Resource::Wood;
    let second = Resource::Sheep;
    assert!(arena.apply_action_for_test(
        &board,
        &topology,
        &rules,
        &config,
        dev_seat,
        Action::PlayDev(DevPlay::YearOfPlenty { first, second }),
        DecisionPhase::Action,
    ));
    assert_exact(&arena, board.seats());
    config.policies[dev_seat] = PolicyKind::GreedyNoTrade;
    assert!(!arena.begin_turn_for_test(&board, &topology, &rules, &config, dev_seat));
    assert!(arena.apply_action_for_test(
        &board,
        &topology,
        &rules,
        &config,
        dev_seat,
        Action::PlayDev(DevPlay::Monopoly {
            resource: Resource::Ore,
        }),
        DecisionPhase::Action,
    ));
    assert_exact(&arena, board.seats());

    let (topology, board, rules, config, mut arena) = fixture();
    let (hex, roll, _) = first_productive_hex(&board, &topology, arena.state.robber);
    let vertex = topology.hex_vertices(hex)[0];
    place_settlement(&mut arena, 0, vertex);
    arena.state.vertex_tier[usize::from(vertex)] = 3;
    for _ in 0..3 {
        arena.produce_for_test(&board, &topology, &config, roll, board.seats());
        assert_exact(&arena, board.seats());
    }
    arena.resolve_seven_for_test(&board, &topology, &rules, &config, 0);
    assert_exact(&arena, board.seats());
}

#[test]
fn steal_bounds_stay_sound_and_recover_exactness() {
    let mut belief = BeliefState::new();
    belief.gain(1, Resource::Wood.index(), 3);
    belief.steal(0, 1);
    assert!(belief.contains(0, &[1, 0, 0, 0, 0]));
    assert!(belief.contains(1, &[2, 0, 0, 0, 0]));
    assert!(belief.is_exact(0));
    assert!(belief.is_exact(1));
    belief.lose(1, Resource::Wood.index(), 2);
    assert!(belief.is_exact(1));
    assert_eq!(belief.total(1), 0);

    let (topology, board, rules, config, mut arena) = fixture();
    let destination = other_hex(&topology, arena.state.robber);
    let victim = 1;
    place_settlement(&mut arena, victim, topology.hex_vertices(destination)[0]);
    arena.state.players[0].playable_dev[0] = 1;
    arena.state.players[victim].resources[Resource::Ore.index()] = 1;
    arena.state.bank[Resource::Ore.index()] -= 1;
    assert!(arena.apply_action_for_test(
        &board,
        &topology,
        &rules,
        &config,
        0,
        Action::PlayDev(DevPlay::Knight {
            destination,
            victim: Some(victim as u8),
        }),
        DecisionPhase::PreRoll,
    ));
    for seat in [0, victim] {
        assert!(
            arena
                .state
                .belief
                .contains(seat, &arena.state.players[seat].resources),
            "seat={seat}"
        );
    }
}

#[test]
fn belief_ignores_hidden_composition_of_identical_public_streams() {
    let (topology, board, rules, config, mut first) = fixture();
    let destination = other_hex(&topology, first.state.robber);
    let victim = 1;
    place_settlement(&mut first, victim, topology.hex_vertices(destination)[0]);
    let mut second = first.clone();
    first.state.players[0].playable_dev[0] = 1;
    second.state.players[0].playable_dev[0] = 1;
    first.state.players[victim].resources = [1, 0, 0, 0, 0];
    second.state.players[victim].resources = [0, 0, 0, 0, 1];
    let action = Action::PlayDev(DevPlay::Knight {
        destination,
        victim: Some(victim as u8),
    });

    assert!(first.apply_action_for_test(
        &board,
        &topology,
        &rules,
        &config,
        0,
        action,
        DecisionPhase::PreRoll,
    ));
    assert!(second.apply_action_for_test(
        &board,
        &topology,
        &rules,
        &config,
        0,
        action,
        DecisionPhase::PreRoll,
    ));
    assert_eq!(first.state.belief, second.state.belief);
    assert_eq!(
        first
            .decision_view(&board, &topology, 2, DecisionPhase::Action)
            .to_owned(),
        second
            .decision_view(&board, &topology, 2, DecisionPhase::Action)
            .to_owned()
    );
}

#[test]
fn monopoly_reveals_exact_counts_including_zero() {
    let (topology, board, rules, config, mut arena) = fixture();
    arena.setup_for_test(&board, &topology, &rules, &config);
    for roll in 2..=12 {
        arena.produce_for_test(&board, &topology, &config, roll, board.seats());
    }
    let resource = Resource::ALL
        .into_iter()
        .find(|resource| {
            let mut counts = (1..board.seats())
                .map(|seat| arena.state.players[seat].resources[resource.index()]);
            counts.clone().any(|count| count == 0) && counts.any(|count| count > 0)
        })
        .expect("fixture has a resource held by some but not all opponents");
    let expected: i16 = arena.state.players[0].resources[resource.index()]
        + (1..board.seats())
            .map(|seat| arena.state.players[seat].resources[resource.index()])
            .sum::<i16>();
    arena.state.players[0].playable_dev[4] = 1;
    assert!(arena.apply_action_for_test(
        &board,
        &topology,
        &rules,
        &config,
        0,
        Action::PlayDev(DevPlay::Monopoly { resource }),
        DecisionPhase::Action,
    ));
    for seat in 1..board.seats() {
        assert_eq!(arena.state.belief.lo(seat)[resource.index()], 0);
        assert_eq!(arena.state.belief.hi(seat)[resource.index()], 0);
    }
    assert_eq!(
        arena.state.belief.lo(0)[resource.index()],
        u16::try_from(arena.state.players[0].resources[resource.index()]).unwrap()
    );
    assert_eq!(arena.state.players[0].resources[resource.index()], expected);

    let (topology, board, rules, config, mut arena) = fixture();
    arena.state.belief.gain(1, Resource::Wood.index(), 1);
    arena.state.belief.gain(1, Resource::Ore.index(), 1);
    arena.state.belief.steal(3, 1);
    arena.state.players[1].resources[Resource::Wood.index()] = 1;
    arena.state.players[3].resources[Resource::Ore.index()] = 1;
    arena.state.bank[Resource::Wood.index()] -= 1;
    arena.state.bank[Resource::Ore.index()] -= 1;
    assert_eq!(arena.state.belief.hi(1)[Resource::Ore.index()], 1);
    arena.state.players[0].playable_dev[4] = 1;
    assert!(arena.apply_action_for_test(
        &board,
        &topology,
        &rules,
        &config,
        0,
        Action::PlayDev(DevPlay::Monopoly {
            resource: Resource::Ore,
        }),
        DecisionPhase::Action,
    ));
    assert_eq!(arena.state.belief.lo(1)[Resource::Ore.index()], 0);
    assert_eq!(arena.state.belief.hi(1)[Resource::Ore.index()], 0);
}

#[test]
fn production_bank_shortfall_keeps_belief_exact() {
    let (topology, board, _rules, config, mut arena) = fixture();
    let (hex, roll, resource) = first_productive_hex(&board, &topology, arena.state.robber);
    let vertices = topology.hex_vertices(hex);
    place_settlement(&mut arena, 0, vertices[0]);
    place_settlement(&mut arena, 1, vertices[1]);
    arena.state.bank[resource.index()] = 1;
    arena.produce_for_test(&board, &topology, &config, roll, board.seats());
    assert_exact(&arena, board.seats());
    assert_eq!(arena.state.players[0].resources[resource.index()], 0);
    assert_eq!(arena.state.players[1].resources[resource.index()], 0);

    let (topology, board, _rules, config, mut arena) = fixture();
    let (hex, roll, resource) = first_productive_hex(&board, &topology, arena.state.robber);
    let vertex = topology.hex_vertices(hex)[0];
    place_settlement(&mut arena, 0, vertex);
    arena.state.vertex_tier[usize::from(vertex)] = 2;
    arena.state.bank[resource.index()] = 1;
    arena.produce_for_test(&board, &topology, &config, roll, board.seats());
    assert_exact(&arena, board.seats());
    assert_eq!(arena.state.players[0].resources[resource.index()], 1);
}

#[test]
fn poked_one_card_steal_keeps_the_gated_invariant_quiet() {
    let (topology, board, rules, config, mut arena) = fixture();
    let destination = other_hex(&topology, arena.state.robber);
    place_settlement(&mut arena, 1, topology.hex_vertices(destination)[0]);
    arena.state.players[1].resources[Resource::Ore.index()] = 1;
    arena.state.bank[Resource::Ore.index()] -= 1;
    arena.state.players[0].playable_dev[0] = 1;
    assert!(arena.apply_action_for_test(
        &board,
        &topology,
        &rules,
        &config,
        0,
        Action::PlayDev(DevPlay::Knight {
            destination,
            victim: Some(1),
        }),
        DecisionPhase::PreRoll,
    ));
    assert!(arena.invariants_hold(&board, &topology, &rules));
}

#[test]
fn invariant_gate_survives_hands_beyond_u16() {
    let (topology, board, mut rules, config, mut arena) = fixture();
    rules.bank_supply = [30_000; RESOURCE_COUNT];
    arena.prepare(&board, &topology, &rules, &config);
    // Move 29,000 of three resources from the bank to seat 0, preserving conservation.
    // The 87,000-card hand exceeds u16::MAX, so the soundness gate must not total it through u16.
    for resource in 0..3 {
        arena.state.bank[resource] -= 29_000;
        arena.state.players[0].resources[resource] += 29_000;
    }
    assert!(arena.invariants_hold(&board, &topology, &rules));
}

#[test]
fn belief_bounds_survive_supplies_beyond_u8() {
    let mut belief = BeliefState::new();
    belief.gain(1, Resource::Ore.index(), 300);
    assert_eq!(belief.total(1), 300);
    assert_eq!(belief.lo(1)[Resource::Ore.index()], 300);
    assert!(belief.contains(1, &[0, 0, 0, 0, 300]));
    belief.steal(0, 1);
    assert!(belief.contains(0, &[0, 0, 0, 0, 1]));
    assert!(belief.contains(1, &[0, 0, 0, 0, 299]));
    belief.lose(1, Resource::Ore.index(), 44);
    assert!(belief.contains(1, &[0, 0, 0, 0, 255]));
    assert!(belief.is_exact(1));
}

#[test]
fn desynced_public_events_always_leave_valid_intervals() {
    let (topology, board, mut rules, mut config, mut arena) = fixture();
    rules.player_trading = Some(TradeConfig {
        opponent_gain_weight: 0.0,
        acceptance_temperature: 0.0,
        max_offers_per_turn: 1,
        ..TradeConfig::default()
    });
    config.policies = [PolicyKind::HeuristicV1Trader; MAX_SEATS];
    arena.prepare(&board, &topology, &rules, &config);
    arena.state.players[0].resources[Resource::Wood.index()] = 1;
    arena.state.bank[Resource::Wood.index()] -= 1;
    arena.state.players[1].resources[Resource::Ore.index()] = 1;
    arena.state.bank[Resource::Ore.index()] -= 1;
    let edge = 10;
    arena.state.edge_owner[edge] = 1;
    arena.state.players[1].pieces[Buildable::Road.index()] -= 1;
    assert!(arena.apply_action_for_test(
        &board,
        &topology,
        &rules,
        &config,
        0,
        Action::OfferTrade {
            give: Resource::Wood,
            get: Resource::Ore,
            count: 1,
        },
        DecisionPhase::Action,
    ));
    assert_eq!(arena.state.players[1].resources[Resource::Wood.index()], 1);
    for seat in 0..board.seats() {
        assert_valid(&arena.state.belief, seat);
    }

    let (topology, board, rules, config, mut arena) = fixture();
    arena.state.players[1].resources[Resource::Ore.index()] = 1;
    arena.state.bank[Resource::Ore.index()] -= 1;
    arena.state.players[0].playable_dev[4] = 1;
    assert!(arena.apply_action_for_test(
        &board,
        &topology,
        &rules,
        &config,
        0,
        Action::PlayDev(DevPlay::Monopoly {
            resource: Resource::Ore,
        }),
        DecisionPhase::Action,
    ));
    for seat in 0..board.seats() {
        assert_valid(&arena.state.belief, seat);
    }
}

#[test]
fn fix2_repeated_maximum_gains_repair_to_a_representable_valid_total() {
    let mut belief = BeliefState::new();
    for _ in 0..6 {
        belief.gain(0, Resource::Wood.index(), u16::MAX);
    }
    assert_valid(&belief, 0);
}

#[test]
fn fix2_hostile_deserialized_upper_bound_is_repaired_by_a_public_update() {
    let mut belief: BeliefState = serde_json::from_str(
        r#"{
            "totals": [1, 0, 0, 0, 0, 0],
            "lo": [
                [0, 0, 0, 0, 0],
                [0, 0, 0, 0, 0],
                [0, 0, 0, 0, 0],
                [0, 0, 0, 0, 0],
                [0, 0, 0, 0, 0],
                [0, 0, 0, 0, 0]
            ],
            "hi": [
                [2, 0, 0, 0, 0],
                [0, 0, 0, 0, 0],
                [0, 0, 0, 0, 0],
                [0, 0, 0, 0, 0],
                [0, 0, 0, 0, 0],
                [0, 0, 0, 0, 0]
            ]
        }"#,
    )
    .unwrap();
    belief.gain(0, Resource::Wood.index(), 0);
    assert_valid(&belief, 0);
}

// Remaining-deck composition (SIM-GAP-17). `DeckBelief::derive` takes the configured deck,
// public plays, the observer's own held cards, the opponents' hidden card total, and the
// undrawn count; `DecisionView::deck_belief` assembles those from game state.
//
// Forwarded arguments of `DeckBelief::derive`, one observing test each:
// - `initial` (configured mix drives the bounds): deck_belief_pins_a_fresh_deck_exactly
// - `revealed_played`: deck_belief_bounds_track_plays_holds_and_hidden_opponents
// - `own_held` (incl. own victory-point draws): deck_belief_bounds_track_plays_holds_and_hidden_opponents
// - `opponent_hidden` (widens lo under hi): deck_belief_bounds_track_plays_holds_and_hidden_opponents
// - `remaining` (caps hi, defends lo <= hi): deck_belief_defends_against_a_desynced_state
//
// Forwarded state behind `DecisionView::deck_belief`, observed by
// view_deck_belief_reads_plays_holds_counts_and_the_configured_deck: every seat's
// `dev_plays_revealed`, the observer's `playable_dev`/`bought_dev`/`vp_dev`, opponents'
// public card counts, the undrawn deck size, and the rules' configured deck.

#[test]
fn deck_belief_pins_a_fresh_deck_exactly() {
    let initial = [20, 5, 3, 3, 3];
    let deck = DeckBelief::derive(&initial, &[0; 5], &[0; 5], 0, 34);
    assert_eq!(deck.total(), 34);
    assert_eq!(deck.lo(), &initial);
    assert_eq!(deck.hi(), &initial);
    assert_eq!(deck.expected(), initial.map(f64::from));
}

#[test]
fn deck_belief_bounds_track_plays_holds_and_hidden_opponents() {
    // standard4 deck, 25 cards: 4 knights and 1 monopoly played publicly, the observer holds a
    // knight and a victory-point card, opponents hold 3 hidden cards, 15 cards undrawn.
    let deck = DeckBelief::derive(&[14, 5, 2, 2, 2], &[4, 0, 0, 0, 1], &[1, 1, 0, 0, 0], 3, 15);
    assert_eq!(deck.total(), 15);
    // Unseen (deck or an opponent's hand): [9, 4, 2, 2, 1]. Any of the 3 hidden opponent cards
    // could be any kind, so each lower bound gives up exactly 3.
    assert_eq!(deck.hi(), &[9, 4, 2, 2, 1]);
    assert_eq!(deck.lo(), &[6, 1, 0, 0, 0]);
    // Same apportioning closed form as the resource belief: sum_lo 7 leaves 8 unknown cards
    // spread over a lo..hi width totalling 11.
    let expected = deck.expected();
    assert_eq!(expected[0], 6.0 + 8.0 * 3.0 / 11.0);
    assert_eq!(expected[1], 1.0 + 8.0 * 3.0 / 11.0);
    assert_eq!(expected[2], 0.0 + 8.0 * 2.0 / 11.0);
    assert_eq!(expected[3], 0.0 + 8.0 * 2.0 / 11.0);
    assert_eq!(expected[4], 0.0 + 8.0 * 1.0 / 11.0);
}

#[test]
fn deck_belief_defends_against_a_desynced_state() {
    // Nothing accounted for, yet only 3 cards claimed undrawn: hi clamps to the total and lo
    // clamps under hi instead of asserting the caller's consistency.
    let deck = DeckBelief::derive(&[14, 5, 2, 2, 2], &[0; 5], &[0; 5], 0, 3);
    assert_eq!(deck.hi(), &[3, 3, 2, 2, 2]);
    for kind in 0..5 {
        assert!(deck.lo()[kind] <= deck.hi()[kind]);
    }
}

#[test]
fn view_deck_belief_reads_plays_holds_counts_and_the_configured_deck() {
    let (topology, board, _rules, _config, mut arena) = fixture();
    // Seat 1 has publicly played 2 knights, the observer 1 monopoly.
    arena.state.players[1].dev_plays_revealed[0] = 2;
    arena.state.players[0].dev_plays_revealed[4] = 1;
    // The observer holds a playable road building, a bought year of plenty, and a VP card.
    arena.state.players[0].playable_dev[2] = 1;
    arena.state.players[0].bought_dev[3] = 1;
    arena.state.players[0].vp_dev = 1;
    // Seat 2 holds two hidden cards (kinds must not leak into the observer's bounds).
    arena.state.players[2].playable_dev[0] = 1;
    arena.state.players[2].bought_dev[1] = 1;
    // Eight cards have left the extension6 deck of 34: 3 plays + 3 own + 2 opponent-held.
    arena.drain_dev_deck_for_test(8);
    let view = arena.decision_view(&board, &topology, 0, DecisionPhase::Action);
    let deck = view.deck_belief();
    assert_eq!(deck.total(), 26);
    // Unseen: knights 20-2, VP 5-1, road building 3-1, year of plenty 3-1, monopoly 3-1.
    assert_eq!(deck.hi(), &[18, 4, 2, 2, 2]);
    // Seat 2's two hidden cards widen every kind's floor by exactly two.
    assert_eq!(deck.lo(), &[16, 2, 0, 0, 0]);
}
