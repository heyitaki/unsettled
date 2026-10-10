# Seat-count weights

Branch `seat-count-weights`, worktree `.claude/worktrees/seat-count-weights`. Goal: five seat-count weight sets, each adopted on `gate3` at 0.5pp or left at today's vector with the M entry that says why. The rules every run follows are in [seat-count-programme.md](../../.claude/specs/simulator/seat-count-programme.md); this file is only the queue. Do not push or merge.

Run helper (not committed): `sc.py` in the session scratchpad builds each `evaluate` command and prints the tables an M entry quotes. Run every measurement from `simulator/`, one CPU-heavy job at a time, with `uptime` before and after.

## Queue

| # | Item | State |
| --- | --- | --- |
| 1 | Seat-count selection in both scorers, third seed generation, `sc_*` arms and pins (Codex packet) | done |
| 2 | Review the packet's diff, run all gates, commit | done |
| 3 | Commit the programme file and spec index entry | done |
| 4 | 4 seats: prereg, pilot, screen, retry or combine if earned, M entry | done |
| 5 | 4 seats: `eval3` then `gate3` if earned, each preregistered, M entries, adoption if `better` | done |
| 6 | 2 seats: same as 4 and 5 | in progress |
| 7 | 3 seats: same | not started |
| 8 | 5 seats: same | not started |
| 9 | 6 seats: same | not started |
| 10 | Spend ledger in `programme.md`, outcome table in the programme file, `CLAUDE.md`, `simulator/README.md`, memory | not started |
| 11 | Three passes checking every quoted number against its run output | not started |
| 12 | Final gates: `npm test`, `npm run typecheck`, `npm run lint`, `cargo test` in both profiles; `/selfreview`; final commit | not started |
| 13 | Move this file to `docs/plans/completed/` | not started |

## Per-seat state

Filled as runs complete: sized `B`, survivors, verdicts, M numbers. Run logs and `sc.py report` output for each run sit in the session scratchpad as `m<N>-*.log` and `m<N>-*.report`; artifacts are under `simulator/runs/` in the worktree.

- **4 seats, M-67.** Pilot 150.426s for 41,600 games (276.5 games/s), widest pilot half-width 1.5784pp (`port_hi`), cap binds, `B` = 4500. Screen: 1601.185s, zero illegal actions, `base` 8843 of 36000 (z -1.911, pass). `coverage_lo` `better` (survivor). `diversity_hi` `inconclusive` at +0.667pp, retried at 18000 boards and `inconclusive` again (+0.565pp), dropped. Every other arm dropped. Candidate: `sc_coverage_lo.json`. M-68 `eval3` at 18000 boards: `better`, +0.977pp. M-69 `gate3` at 18000 boards: `better`, +0.844pp. **Adopted**: `SEAT_WEIGHT_OVERRIDES[4] = { coverageExponent: 1.0 }`. `eval3` and `gate3` are spent at four seats.
- **2 seats, M-70.** Screen prereg written (`docs/plans/preregs/2026-10-10-m70-seats2-screen.md`); it must be committed before the pilot. Pilot is 400 boards, read blind with `sc.py blind`.
