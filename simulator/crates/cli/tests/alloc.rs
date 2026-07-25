use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

use unsettled_engine::game::{GameArena, GameConfig};
use unsettled_engine::rules::RuleConfig;
use unsettled_engine::topology::{Layout as BoardLayout, Topology};
use unsettled_sim::boardgen::generate_board;

struct CountingAllocator;

static COUNTING: AtomicBool = AtomicBool::new(false);
static ALLOCATIONS: AtomicUsize = AtomicUsize::new(0);

unsafe impl GlobalAlloc for CountingAllocator {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        if COUNTING.load(Ordering::Relaxed) {
            ALLOCATIONS.fetch_add(1, Ordering::Relaxed);
        }
        unsafe { System.alloc(layout) }
    }

    unsafe fn dealloc(&self, pointer: *mut u8, layout: Layout) {
        unsafe { System.dealloc(pointer, layout) }
    }
}

#[global_allocator]
static ALLOCATOR: CountingAllocator = CountingAllocator;

#[test]
fn game_hot_loop_has_zero_steady_state_allocations() {
    let topology = Topology::load(BoardLayout::Standard4).unwrap();
    let board = generate_board(BoardLayout::Standard4, 4, 7).unwrap();
    let rules = RuleConfig::base(BoardLayout::Standard4);
    let mut arena = GameArena::default();
    let mut config = GameConfig::default();
    for seed in 0..50 {
        config.seed = seed;
        arena.play(&board, &topology, &rules, &config);
    }
    ALLOCATIONS.store(0, Ordering::Relaxed);
    COUNTING.store(true, Ordering::SeqCst);
    for seed in 50..250 {
        config.seed = seed;
        arena.play(&board, &topology, &rules, &config);
    }
    COUNTING.store(false, Ordering::SeqCst);
    assert_eq!(ALLOCATIONS.load(Ordering::Relaxed), 0);
}
