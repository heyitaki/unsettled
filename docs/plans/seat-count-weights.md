# Seat-count weights

Branch `seat-count-weights`, worktree `.claude/worktrees/seat-count-weights`. Goal: five seat-count weight sets, each adopted on `gate3` at 0.5pp or left at today's vector with the M entry that says why. The rules every run follows are in [seat-count-programme.md](../../.claude/specs/simulator/seat-count-programme.md); this file is only the queue. Do not push or merge.

Run helper (not committed): `sc.py` in the session scratchpad (the session restarted once, so the scratchpad moved; copy the helpers forward if it moves again) builds each `evaluate` command and prints the tables an M entry quotes. Run every measurement from `simulator/`, one CPU-heavy job at a time, with `uptime` before and after.

## Queue

| # | Item | State |
| --- | --- | --- |
| 1 | Seat-count selection in both scorers, third seed generation, `sc_*` arms and pins (Codex packet) | done |
| 2 | Review the packet's diff, run all gates, commit | done |
| 3 | Commit the programme file and spec index entry | done |
| 4 | 4 seats: prereg, pilot, screen, retry or combine if earned, M entry | done |
| 5 | 4 seats: `eval3` then `gate3` if earned, each preregistered, M entries, adoption if `better` | done |
| 6 | 2 seats: same as 4 and 5 | done |
| 7 | 3 seats: same | in progress |
| 8 | 5 seats: same | not started |
| 9 | 6 seats: same | not started |
| 10 | Spend ledger in `programme.md`, outcome table in the programme file, `CLAUDE.md`, `simulator/README.md`, memory | not started |
| 11 | Three passes checking every quoted number against its run output | not started |
| 12 | Final gates: `npm test`, `npm run typecheck`, `npm run lint`, `cargo test` in both profiles; `/selfreview`; final commit | not started |
| 13 | Move this file to `docs/plans/completed/` | not started |

## Per-seat state

Filled as runs complete: sized `B`, survivors, verdicts, M numbers. Run logs and `sc.py report` output for each run sit in the session scratchpad as `m<N>-*.log` and `m<N>-*.report`; artifacts are under `simulator/runs/` in the worktree.

- **4 seats, M-67.** Pilot 150.426s for 41,600 games (276.5 games/s), widest pilot half-width 1.5784pp (`port_hi`), cap binds, `B` = 4500. Screen: 1601.185s, zero illegal actions, `base` 8843 of 36000 (z -1.911, pass). `coverage_lo` `better` (survivor). `diversity_hi` `inconclusive` at +0.667pp, retried at 18000 boards and `inconclusive` again (+0.565pp), dropped. Every other arm dropped. Candidate: `sc_coverage_lo.json`. M-68 `eval3` at 18000 boards: `better`, +0.977pp. M-69 `gate3` at 18000 boards: `better`, +0.844pp. **Adopted**: `SEAT_WEIGHT_OVERRIDES[4] = { coverageExponent: 1.0 }`. `eval3` and `gate3` are spent at four seats.
- **2 seats, M-70.** Pilot 22.810s (911.9 games/s), widest half-width 2.2862pp (`port_hi`), target binds, `B` = 17500. Screen: 998.999s, zero illegal actions, `base` 34995 of 70000 (pass). `coverage_lo` `better` (+0.789pp) and `diversity_hi` `better` (+1.334pp) survive. `port_lo` and `scarcity_lo` earned the retry at 70000 boards and both read `equivalent`, dropped. Combined vector `sc_s2_combined.json` committed (`a0a199fd`); combine pass at 17500 boards with reference `combined` writes `runs/m70-seats2-combine`. Combine pass: both removals `worse`, `base` `worse` at -2.644pp, so the candidate is the combined vector. M-71 `eval3` at 70000 boards: `better`, +2.714pp. M-72 `gate3`: `better`, +2.704pp. **Adopted**: `SEAT_WEIGHT_OVERRIDES[2] = { coverageExponent: 1.0, diversityWeight: 3.2 }`. `eval3` and `gate3` are spent at two seats.
- **3 seats, M-73.** Pilot 67.744s (460.6 games/s), widest half-width 1.9175pp (`expansion_lo`), cap binds, `B` = 10500. Screen: 1797.607s, zero illegal actions, `base` 21011 of 63000 (pass). `coverage_lo` `better` (+1.024pp). `diversity_hi` retried at 42000 boards, `better` (+0.683pp); `port_lo` retried, `equivalent`, dropped. Combine pass against `sc_s2_combined.json` (same vector, reused): both removals `worse`, `base` `worse` at -1.929pp. Candidate: the combined vector. M-73 written. Next: M-74 `eval3` at 42000 boards, then M-75 `gate3` if `better`.
