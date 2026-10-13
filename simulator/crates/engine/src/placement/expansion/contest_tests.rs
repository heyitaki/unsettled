use super::*;
use crate::placement::app_formula::EngineWeights;

fn weights() -> EngineWeights {
    serde_json::from_str(include_str!("../../../../../placement/default-weights.json")).unwrap()
}

fn witness_weights() -> EngineWeights {
    let mut weights = weights();
    weights.contest_weight = 0.5;
    weights
}

#[test]
fn contest_weights_validate_their_domains() {
    for value in [0.0, 0.5, 1.0] {
        let mut weights = weights();
        weights.contest_weight = value;
        assert!(weights.validate().is_ok());
    }
    for value in [-0.1, 1.1, f64::NAN, f64::INFINITY] {
        let mut weights = weights();
        weights.contest_weight = value;
        assert!(weights.validate().unwrap_err().contains("contestWeight"));
    }
    for value in [0.0, 1.0] {
        let mut weights = weights();
        weights.reprice_first_expansion = value;
        assert!(weights.validate().is_ok());
    }
    for value in [-1.0, 0.5, 2.0, f64::NAN, f64::INFINITY] {
        let mut weights = weights();
        weights.reprice_first_expansion = value;
        assert!(weights.validate().unwrap_err().contains("repriceFirstExpansion"));
    }
}

#[test]
fn contest_discount_preserves_the_fixed_arithmetic_bits() {
    let (topology, board) = tests::walk_fixtures().into_iter().next().unwrap();
    let scorer = AppFormulaScorer::new(&board, &topology, witness_weights());
    for (price, value, tier, expected) in [
        (12.0, 3.0, 1, 1.5_f64), (12.0, 3.0, 2, 2.25), (12.0, 3.0, 0, 3.0),
        (0.0, -0.0, 1, -0.0), (-12.0, -3.0, 2, -3.0),
        (f64::from_bits(0x7ff8_0000_0000_0012), 3.0, 1, 3.0),
    ] {
        assert_eq!(contest_discount(&scorer, price, value, tier).to_bits(), expected.to_bits());
    }
}

#[test]
fn contest_masks_match_reference_on_scrambled_boards() {
    let mut detached = 0;
    let mut own = 0;
    let mut rival = 0;
    for (topology, board) in tests::walk_fixtures() {
        let scorer = AppFormulaScorer::new(&board, &topology, witness_weights());
        for (vertices, mut edges) in tests::scrambled_owners(&topology) {
            let edge = (0..topology.edge_count() as Edge).find(|edge| {
                topology.edge_endpoints(*edge).iter().all(|v| vertices[usize::from(*v)] == EMPTY)
            }).unwrap();
            edges[usize::from(edge)] = 1;
            detached += 1;
            for seat in 0..6 {
                let occupancy = Occupancy::new(&scorer, &vertices, &edges, seat);
                own += occupancy.own_edges.count_ones();
                rival += occupancy.rival_edges.count_ones();
                let tiers = contest_tiers(&scorer, &occupancy);
                assert_eq!(tiers[0] & tiers[1], 0);
                assert_eq!(contest_tiers(&scorer, &Occupancy { blocked: !occupancy.blocked, ..occupancy }), tiers);
                for vertex in 0..topology.vertex_count() as Vertex {
                    let tier = if tiers[0] & (1 << vertex) != 0 { 1 }
                        else if tiers[1] & (1 << vertex) != 0 { 2 } else { 0 };
                    assert_eq!(tier, contest_tier(&scorer, &vertices, &edges, seat, vertex));
                }
            }
        }
    }
    assert!(detached > 0 && own > 0 && rival > 0);
}

#[test]
fn contest_classifier_clauses() {
    for (topology, board) in tests::walk_fixtures() {
        let scorer = AppFormulaScorer::new(&board, &topology, witness_weights());
        let start = 0;
        let (first, middle) = scorer.steps(start).next().unwrap();
        let (second, end) = scorer.steps(middle).find(|(_, v)| *v != start).unwrap();
        let mut vertices = vec![EMPTY; topology.vertex_count() + 8];
        let mut edges = vec![EMPTY; topology.edge_count()];
        let check = |vertices: &[u8], edges: &[u8], vertex, expected| {
            assert_eq!(contest_tier(&scorer, vertices, edges, 0, vertex), expected);
            let occupancy = Occupancy::new(&scorer, vertices, edges, 0);
            let tiers = contest_tiers(&scorer, &occupancy);
            assert_eq!(tiers[0] & (1 << vertex) != 0, expected == 1);
            assert_eq!(tiers[1] & (1 << vertex) != 0, expected == 2);
        };
        vertices[usize::from(start)] = 1;
        check(&vertices, &edges, end, 2);
        for edge in [first, second] {
            edges[usize::from(edge)] = 0;
            check(&vertices, &edges, end, 0);
            edges[usize::from(edge)] = EMPTY;
        }
        edges[usize::from(first)] = 1;
        check(&vertices, &edges, end, 1);
        check(&vertices, &edges, middle, 1);
        edges[usize::from(second)] = 0;
        check(&vertices, &edges, end, 0);
        edges[usize::from(second)] = EMPTY;
        vertices[usize::from(middle)] = 2;
        check(&vertices, &edges, end, 0);
        vertices.fill(EMPTY);
        check(&vertices, &edges, middle, 1);
        check(&vertices, &edges, end, 1);
        edges[usize::from(first)] = 0;
        vertices[usize::from(start)] = 0;
        check(&vertices, &edges, end, 0);
        vertices[topology.vertex_count()..].fill(1);
        check(&vertices, &edges, end, 0);
    }
}

fn assert_term(candidate: Vertex, rival: Vertex, road: Edge, sites: &[(Vertex, usize, u8)], best: [Vertex; 2]) {
    let (topology, board) = tests::walk_fixtures().into_iter().nth(1).unwrap();
    let scorer = AppFormulaScorer::new(&board, &topology, witness_weights());
    let mut vertices = vec![EMPTY; topology.vertex_count()];
    let mut edges = vec![EMPTY; topology.edge_count()];
    vertices[usize::from(rival)] = 1;
    edges[usize::from(road)] = 1;
    let reached = sites_by_edge(&scorer, &vertices, &edges, 0, candidate);
    let mut cheapest = std::collections::BTreeMap::new();
    for (_, row) in reached {
        for site in row {
            let cost = cheapest.entry(site.vertex).or_insert(site.paid_builds as usize);
            *cost = (*cost).min(site.paid_builds as usize);
        }
    }
    assert_eq!(cheapest, sites.iter().map(|(site, cost, _)| (*site, *cost)).collect());
    let mut holdings = Holdings::empty();
    scorer.add_to_holdings(&mut holdings, candidate);
    let pricer = SitePricer::new(&scorer, holdings);
    let values: Vec<_> = sites.iter().map(|(site, cost, tier)| {
        assert_eq!(contest_tier(&scorer, &vertices, &edges, 0, *site), *tier);
        let value = pricer.price(*site) * [1.0, 0.5, 0.25][*cost];
        (*site, match tier { 1 => value * 0.5, 2 => value * 0.75, _ => value })
    }).collect();
    let price = |site| values.iter().find(|(vertex, _)| *vertex == site).unwrap().1;
    assert!(price(best[0]) >= price(best[1]));
    assert!(values.iter().all(|(site, value)| *site == best[0] || *value <= price(best[1])));
    let expected = scorer.weights().expansion_weight * (price(best[0]) + price(best[1]));
    let before = discounted_sites();
    let actual = term(&scorer, &Holdings::empty(), &vertices, &edges, 0, candidate);
    assert_eq!(actual.value.to_bits(), expected.to_bits());
    assert!(discounted_sites() > before);
}

#[test]
fn contest_term_prices_a_tier_one_best_site() {
    assert_term(3, 14, 3, &[
        (0, 2, 0), (1, 1, 1), (5, 1, 0), (16, 1, 2), (49, 2, 0),
        (50, 1, 0), (52, 1, 0), (53, 2, 0), (64, 2, 0), (66, 2, 0),
    ], [1, 50]);
}

#[test]
fn contest_term_prices_a_tier_two_best_site() {
    assert_term(0, 2, 2, &[
        (6, 1, 0), (9, 2, 0), (15, 1, 2), (19, 1, 0), (20, 2, 0), (29, 2, 0),
        (31, 2, 0), (47, 1, 0), (48, 2, 0), (49, 1, 1), (50, 2, 0), (55, 2, 0),
    ], [15, 47]);
}

#[test]
fn contest_turns_the_setup_road() {
    let (topology, board) = tests::walk_fixtures().into_iter().nth(1).unwrap();
    let plain = AppFormulaScorer::new(&board, &topology, weights());
    let scorer = AppFormulaScorer::new(&board, &topology, witness_weights());
    let mut vertices = vec![EMPTY; topology.vertex_count()];
    let mut edges = vec![EMPTY; topology.edge_count()];
    vertices[2] = 1;
    edges[3] = 1;
    assert_eq!(term(&plain, &Holdings::empty(), &vertices, &edges, 0, 0).road, Some(0));
    let before = discounted_sites();
    assert_eq!(term(&scorer, &Holdings::empty(), &vertices, &edges, 0, 0).road, Some(9));
    assert!(discounted_sites() > before);
}

#[test]
fn contest_row_memo_follows_rival_roads_with_identical_sites() {
    let (topology, board) = tests::walk_fixtures().into_iter().nth(1).unwrap();
    let scorer = AppFormulaScorer::new(&board, &topology, witness_weights());
    let mut vertices = vec![EMPTY; topology.vertex_count()];
    vertices[2] = 1;
    for roads in [[2, 3], [3, 2]] {
        let mut memo = PriceMemo::default();
        let serial = memo.serial(scorer.id, 0);
        let mut previous = None;
        let mut tiers = None;
        let mut values = Vec::new();
        for road in roads {
            let mut edges = vec![EMPTY; topology.edge_count()];
            edges[road] = 1;
            let occupancy = Occupancy::new(&scorer, &vertices, &edges, 0);
            let sites = scorer.reach.sites(0, &occupancy, &mut memo.sites);
            if let Some(previous) = previous { assert_eq!(sites, previous); }
            previous = Some(sites);
            let current_tiers = contest_tiers(&scorer, &occupancy);
            if let Some(tiers) = tiers { assert_ne!(current_tiers, tiers); }
            tiers = Some(current_tiers);
            let mut poison = ValueEntry::new(serial, 0, sites);
            poison.value = -9999.0;
            memo.values[poison.index()] = poison;
            let before = discounted_sites();
            let actual = row_value(&scorer, &Holdings::empty(), 0, &occupancy, &mut memo, Some(serial));
            let expected = term(&scorer, &Holdings::empty(), &vertices, &edges, 0, 0).value;
            assert_eq!(actual.to_bits(), expected.to_bits());
            assert_eq!(memo.values[poison.index()].value, -9999.0);
            assert!(memo.prices.iter().any(|(key, _)| *key != 0));
            assert!(discounted_sites() > before);
            values.push(actual.to_bits());
        }
        assert_ne!(values[0], values[1]);
    }
}

#[test]
fn zero_expansion_never_classifies_and_full_contest_can_zero_the_term() {
    let (topology, board) = tests::walk_fixtures().into_iter().nth(1).unwrap();
    let mut witness = witness_weights();
    witness.expansion_weight = 0.0;
    let scorer = AppFormulaScorer::new(&board, &topology, witness);
    let vertices = vec![EMPTY; topology.vertex_count()];
    let edges = vec![1; topology.edge_count()];
    let occupancy = Occupancy::new(&scorer, &vertices, &edges, 0);
    let before = contest_calls();
    assert_eq!(term(&scorer, &Holdings::empty(), &vertices, &edges, 0, 0).value, 0.0);
    assert_eq!(row_value(&scorer, &Holdings::empty(), 0, &occupancy, &mut PriceMemo::default(), None), 0.0);
    assert_eq!(row_road(&scorer, &vertices, &edges, 0, 0, Some(&occupancy)), None);
    assert_eq!(contest_calls(), before);

    let mut witness = weights();
    witness.contest_weight = 1.0;
    let scorer = AppFormulaScorer::new(&board, &topology, witness);
    let mut edges = vec![1; topology.edge_count()];
    let (first, middle) = scorer.steps(0).next().unwrap();
    let (second, _) = scorer.steps(middle).find(|(_, to)| *to != 0).unwrap();
    edges[usize::from(first)] = EMPTY;
    edges[usize::from(second)] = EMPTY;
    let occupancy = Occupancy::new(&scorer, &vertices, &edges, 0);
    let before = discounted_sites();
    let term = term(&scorer, &Holdings::empty(), &vertices, &edges, 0, 0);
    assert_eq!(term.value, 0.0);
    assert!(discounted_sites() > before);
    assert_eq!(row_value(&scorer, &Holdings::empty(), 0, &occupancy, &mut PriceMemo::default(), None), 0.0);
}
