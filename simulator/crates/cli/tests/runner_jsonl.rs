use std::fs;

use unsettled_engine::placement::PlacementKind;
use unsettled_engine::policy::PolicyKind;
use unsettled_engine::topology::{Layout, Topology};
use unsettled_sim::boardgen::generate_board;
use unsettled_sim::runner::{RunRequest, run};
use unsettled_sim::schedule::tournament_schedule;

#[test]
fn jsonl_is_created_inside_a_fresh_output_directory() {
    let topology = Topology::load(Layout::Standard4).unwrap();
    let board = generate_board(Layout::Standard4, 4, 19).unwrap();
    let schedule = tournament_schedule(1, 1, 1);
    let heuristics = [PlacementKind::MaxPips];
    let out =
        std::env::temp_dir().join(format!("unsettled-sim-jsonl-fresh-{}", std::process::id()));
    if out.exists() {
        fs::remove_dir_all(&out).unwrap();
    }
    let jsonl = out.join("games.jsonl");

    run(RunRequest {
        boards: std::slice::from_ref(&board),
        topology: &topology,
        schedule: &schedule,
        heuristics: &heuristics,
        policy: PolicyKind::HeuristicV1,
        policy_name: "heuristic-v1",
        player_trading: None,
        seed: 7,
        threads: 1,
        allow_unofficial: false,
        out: &out,
        jsonl: Some(&jsonl),
    })
    .unwrap();

    assert!(jsonl.is_file());
    assert_eq!(fs::read_to_string(&jsonl).unwrap().lines().count(), 1);
    fs::remove_dir_all(out).unwrap();
}
