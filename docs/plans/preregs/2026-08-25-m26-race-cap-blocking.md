# M-26 preregistration — race-check cap and approach blocking (SIM-GAP-07/08)

Date: 2026-08-25. Committed before the run.

**Change under test.** Two denial-scope fixes land together. The exact Longest Road race-check budget moves from the fixed two-rival cap onto `DenialParams::race_check_cap`, defaulting to every rival in the largest layout (5), so a six-seat game's third-ranked live challenger is no longer invisible; checks are still spent in danger order behind the sound `road_count + 1 >= required` prefilter. The contest term now prices blocking: when the candidate edge is a rival's only remaining one-road approach to the contested vertex, that rival's danger contribution is scaled by `1 + contest_block_bonus` (default 0.5, an unswept Phase-H placeholder), bounded to the edges incident to the vertex and reusing the memoized one-road reach. Fixed-state per-decision cost of the raised budget (M-22's form, worst-case state with three prefilter survivors and a succeeding third check): ~180 ns/decision at cap 2 vs ~330 ns at cap 5. Pre-change behavior is preserved behind `LegacyValuation::bounded_race`, exposed as the composite label `heuristic-v1-trader-aware-threat-devcards-denial-legacyrace`.

**Design.** Standard gap-fix A/B per the programme's measurement protocol: `evaluate`, standard4, 4 seats, `--domain tuning`, field `pip_diversity` placement, field policy `heuristic-v1-trader`, player trading on, 400 boards x 10 reps, threads 0. Reference arm = pre-change composite (`-legacyrace`); test arm = post-change composite (`heuristic-v1-trader-aware-threat-devcards-denial`, current defaults).

**Command.**

```text
cargo run --release -p unsettled-sim -- evaluate --layout standard4 --seats 4 --domain tuning --field pip_diversity --arm base=pip_diversity --arm race=pip_diversity --arm-policy base=heuristic-v1-trader-aware-threat-devcards-denial-legacyrace --arm-policy race=heuristic-v1-trader-aware-threat-devcards-denial --reference base --boards 400 --reps 10 --policy heuristic-v1-trader --threads 0 --player-trading --out runs/m26-race
```

**Decision rule (fixed before the run).** This is a record-and-regression A/B, not an adoption gate: the fix ships unless the `race` arm's verdict is `worse` (selected interval strictly below -1pp). `better`, `equivalent`, or `inconclusive` all keep the fix with the reading recorded. A `worse` verdict stops the task and records the evidence per the plan's gap-fix rule.

**Threshold and alpha.** +-1pp practical threshold, interval selection as in prior M entries (McNemar vs clustered, whichever the harness selects).

**Admissibility.** `uptime` load recorded before and after; zero illegal actions required; single invocation expected well under 5 minutes.
