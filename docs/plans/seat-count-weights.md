# Seat-count weights

Branch `seat-count-weights`, worktree `.claude/worktrees/seat-count-weights`. Goal: five seat-count weight sets, each adopted on `gate3` at 0.5pp or left at today's vector with the M entry that says why. The rules every run follows are in [seat-count-programme.md](../../.claude/specs/simulator/seat-count-programme.md); this file is only the queue. Do not push or merge.

Run helper (not committed): `sc.py` in the session scratchpad builds each `evaluate` command and prints the tables an M entry quotes. Run every measurement from `simulator/`, one CPU-heavy job at a time, with `uptime` before and after.

## Queue

| # | Item | State |
| --- | --- | --- |
| 1 | Seat-count selection in both scorers, third seed generation, `sc_*` arms and pins (Codex packet) | done |
| 2 | Review the packet's diff, run all gates, commit | done |
| 3 | Commit the programme file and spec index entry | done |
| 4 | 4 seats: prereg, pilot, screen, retry or combine if earned, M entry | in progress |
| 5 | 4 seats: `eval3` then `gate3` if earned, each preregistered, M entries, adoption if `better` | not started |
| 6 | 2 seats: same as 4 and 5 | not started |
| 7 | 3 seats: same | not started |
| 8 | 5 seats: same | not started |
| 9 | 6 seats: same | not started |
| 10 | Spend ledger in `programme.md`, outcome table in the programme file, `CLAUDE.md`, `simulator/README.md`, memory | not started |
| 11 | Three passes checking every quoted number against its run output | not started |
| 12 | Final gates: `npm test`, `npm run typecheck`, `npm run lint`, `cargo test` in both profiles; `/selfreview`; final commit | not started |
| 13 | Move this file to `docs/plans/completed/` | not started |

## Per-seat state

Filled as runs complete: sized `B`, survivors, verdicts, M numbers.
