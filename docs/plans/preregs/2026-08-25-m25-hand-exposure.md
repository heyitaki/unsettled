# M-25 preregistration — shared hand-size exposure term (SIM-GAP-14/15/16/18)

Date: 2026-08-25. Committed before the run.

**Change under test.** One shared exposure model (`policy::exposure`: what a rolled seven costs this hand) now feeds three consumers. The forced discard ranks cards by port-aware discrete marginal conversion value among goal-surplus cards (dead spares before bundle-breakers, unported spares before ported ones; bundle protection only at rates strictly better than the observer's base rate, since bank-rate four-stack protection measured as a strength regression during development); goal need still dominates on disagreement and all-needed hands keep the greedy rule. The action phase gains a pre-emptive shedding bank/port trade that prices the certain loss of `rate - 1` cards against the expected cards the next seven takes, never shedding into the goal's cost. The gated pre-roll dev-card comparison charges each candidate for the cards it adds ahead of the observer's own imminent roll (`DevCardParams::exposure_weight`, an unswept Phase-H placeholder like `shed_weight`). Pre-change behavior is preserved behind `LegacyValuation::exposure_blind`, exposed as the composite label `heuristic-v1-trader-aware-threat-devcards-denial-legacyexposure`.

**Design.** Standard gap-fix A/B per the programme's measurement protocol: `evaluate`, standard4, 4 seats, `--domain tuning`, field `pip_diversity` placement, field policy `heuristic-v1-trader`, player trading on, 400 boards x 10 reps, threads 0. Reference arm = pre-change composite (`-legacyexposure`); test arm = post-change composite (`heuristic-v1-trader-aware-threat-devcards-denial`, current defaults).

**Command.**

```text
cargo run --release -p unsettled-sim -- evaluate --layout standard4 --seats 4 --domain tuning --field pip_diversity --arm base=pip_diversity --arm exposure=pip_diversity --arm-policy base=heuristic-v1-trader-aware-threat-devcards-denial-legacyexposure --arm-policy exposure=heuristic-v1-trader-aware-threat-devcards-denial --reference base --boards 400 --reps 10 --policy heuristic-v1-trader --threads 0 --player-trading --out runs/m25-exposure
```

**Decision rule (fixed before the run).** This is a record-and-regression A/B, not an adoption gate: the fix ships unless the `exposure` arm's verdict is `worse` (selected interval strictly below -1pp). `better`, `equivalent`, or `inconclusive` all keep the fix with the reading recorded. A `worse` verdict stops the task and records the evidence per the plan's gap-fix rule.

**Threshold and alpha.** +-1pp practical threshold, interval selection as in prior M entries (McNemar vs clustered, whichever the harness selects).

**Admissibility.** `uptime` load recorded before and after; zero illegal actions required; single invocation expected well under 5 minutes.
