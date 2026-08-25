# M-24 preregistration — deck-composition-aware dev buying (SIM-GAP-17)

Date: 2026-08-25. Committed before the run.

**Change under test.** The development-card buy score now derives the remaining deck's composition (a `DeckBelief` in the resource belief's lo/hi shape: configured deck minus public plays minus the observer's own held cards, with opponents' hidden cards as the bounded unknown pool) and prices the buy by what a draw can still be: the flat 45 base splits across the victory-point, progress, and knight shares of the remaining deck relative to the configured mix, a new chase term prices the expected hidden points as the observer closes on the win, and the Largest Army contest and defend terms scale with knight enrichment since only a knight draw advances them. The pre-change behavior is preserved bit-for-bit behind `LegacyValuation::deck_blind_buying`, exposed as the composite policy label `heuristic-v1-trader-aware-threat-devcards-denial-legacydeck`.

**Design.** Standard gap-fix A/B per the programme's measurement protocol: `evaluate`, standard4, 4 seats, `--domain tuning`, field `pip_diversity` placement, field policy `heuristic-v1-trader`, player trading on, 400 boards x 10 reps, threads 0. Reference arm = pre-change composite (`-legacydeck`); test arm = post-change composite (`heuristic-v1-trader-aware-threat-devcards-denial`, current defaults).

**Command.**

```text
cargo run --release -p unsettled-sim -- evaluate --layout standard4 --seats 4 --domain tuning --field pip_diversity --arm base=pip_diversity --arm deck=pip_diversity --arm-policy base=heuristic-v1-trader-aware-threat-devcards-denial-legacydeck --arm-policy deck=heuristic-v1-trader-aware-threat-devcards-denial --reference base --boards 400 --reps 10 --policy heuristic-v1-trader --threads 0 --player-trading --out runs/m24-deck
```

**Decision rule (fixed before the run).** This is a record-and-regression A/B, not an adoption gate: the fix ships unless the `deck` arm's verdict is `worse` (selected interval strictly below -1pp). `better`, `equivalent`, or `inconclusive` all keep the fix with the reading recorded. A `worse` verdict stops the task and records the evidence per the plan's gap-fix rule.

**Threshold and alpha.** +-1pp practical threshold, interval selection as in prior M entries (McNemar vs clustered, whichever the harness selects).

**Admissibility.** `uptime` load recorded before and after; zero illegal actions required; single invocation expected well under 5 minutes.
