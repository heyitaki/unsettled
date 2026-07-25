#[derive(Clone, Copy, Debug)]
pub struct ScheduleEntry {
    pub board: usize,
    pub rep: usize,
    pub rotation: usize,
}

pub fn tournament_schedule(
    boards: usize,
    reps: usize,
    heuristic_count: usize,
) -> Vec<ScheduleEntry> {
    let mut schedule = Vec::with_capacity(boards * reps * heuristic_count);
    for board in 0..boards {
        for rep in 0..reps {
            for rotation in 0..heuristic_count {
                schedule.push(ScheduleEntry {
                    board,
                    rep,
                    rotation,
                });
            }
        }
    }
    schedule
}

pub fn simulate_schedule(games: usize, heuristic_count: usize) -> Vec<ScheduleEntry> {
    (0..games)
        .map(|game| ScheduleEntry {
            board: 0,
            rep: game / heuristic_count,
            rotation: game % heuristic_count,
        })
        .collect()
}
