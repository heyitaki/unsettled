use unsettled_engine::topology::{Layout, Topology};

#[test]
fn known_pack_counts_match_the_app() {
    let standard = Topology::load(Layout::Standard4).unwrap();
    assert_eq!(
        (
            standard.hex_count(),
            standard.vertex_count(),
            standard.edge_count()
        ),
        (19, 54, 72)
    );
    assert_eq!(standard.coastal_edges().len(), 30);
    assert_eq!(standard.default_port_edges().len(), 9);

    let extension = Topology::load(Layout::Extension6).unwrap();
    assert_eq!(
        (
            extension.hex_count(),
            extension.vertex_count(),
            extension.edge_count()
        ),
        (30, 80, 109)
    );
    assert_eq!(extension.coastal_edges().len(), 38);
    assert_eq!(extension.default_port_edges().len(), 11);
}

#[test]
fn pack_graph_invariants_hold() {
    for layout in [Layout::Standard4, Layout::Extension6] {
        let pack = Topology::load(layout).unwrap();
        assert!(pack.validate().is_ok());
        for edge in 0..pack.edge_count() {
            let [a, b] = pack.edge_endpoints(edge as u8);
            assert!(pack.vertex_adjacent(a).contains(&b));
            assert!(pack.vertex_adjacent(b).contains(&a));
        }
        for vertex in 0..pack.vertex_count() {
            assert!((2..=3).contains(&pack.vertex_edges(vertex as u8).len()));
        }
    }
}
