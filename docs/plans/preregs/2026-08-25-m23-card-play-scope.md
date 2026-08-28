# M-23 preregistration — card-play scope (SIM-GAP-10/11/12)

Date: 2026-08-25. Committed before the run, alongside the implementation.

**Change under test.** Year of Plenty is now offered beyond the exactly-two-short case (one-short-plus-spare, bank-blocked-need degradation, and goalless tempo/banking), its two resources are picked by value (goal need, then fewest own production pips, then scarcest bank stock, then highest index) instead of index order, and `monopoly_for_goal` considers every cost variant of the goal instead of the first. The pre-change behavior is preserved bit-for-bit behind `LegacyValuation::narrow_card_plays`, exposed as the composite policy label `heuristic-v1-trader-aware-threat-devcards-denial-legacycards`.

**Design.** Standard gap-fix A/B per the programme's measurement protocol: `evaluate`, standard4, 4 seats, `--domain tuning`, field `pip_diversity` placement, field policy `heuristic-v1-trader`, player trading on, 400 boards x 10 reps, threads 0. Reference arm = pre-change composite (`-legacycards`); test arm = post-change composite (`heuristic-v1-trader-aware-threat-devcards-denial`, current defaults).

**Command.**

```text
cargo run --release -p unsettled-sim -- evaluate --layout standard4 --seats 4 --domain tuning --field pip_diversity --arm base=pip_diversity --arm cards=pip_diversity --arm-policy base=heuristic-v1-trader-aware-threat-devcards-denial-legacycards --arm-policy cards=heuristic-v1-trader-aware-threat-devcards-denial --reference base --boards 400 --reps 10 --policy heuristic-v1-trader --threads 0 --player-trading --out runs/m23-cards
```

**Decision rule (fixed before the run).** This is a record-and-regression A/B, not an adoption gate: the fix ships unless the `cards` arm's verdict is `worse` (selected interval strictly below -1pp). `better`, `equivalent`, or `inconclusive` all keep the fix with the reading recorded. A `worse` verdict stops the task and records the evidence per the plan's gap-fix rule.

**Threshold and alpha.** +-1pp practical threshold, interval selection as in prior M entries (McNemar vs clustered, whichever the harness selects).

**Admissibility.** `uptime` load recorded before and after; zero illegal actions required; single invocation expected well under 5 minutes.
