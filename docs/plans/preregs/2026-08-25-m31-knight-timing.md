# M-31 preregistration — knight timing rejoin (SIM-GAP-05/06/09)

Date: 2026-08-25. Committed before the run.

**Change under test.** `heuristic_v1.rs::knight_action_score` unfreezes the knight path G1 deliberately froze so its robber A/B stayed placement-only. Three couplings land together: the contested-card term takes the shared denial pressure toward the Largest Army holder instead of a literal `1.0` (SIM-GAP-05); the progress term scales by that same pressure instead of only the observer's own progress (SIM-GAP-06); and under the threat gate the steal term prices the victim through belief (the probability the stolen card fills the observer's own cheapest-route shortfall) plus the shared danger-model victim rank, while a new placement term rejoins play timing to the robber placement value the chooser maximized, priced at the pair the knight actually plays rather than the self-regarding baseline (SIM-GAP-09 and the programme's "knight timing — named but unscheduled" item). The two new scales, `ThreatParams::knight_steal_weight` (12.0) and `knight_placement_weight` (30.0), are unswept Phase-H placeholders. Pre-change behavior is preserved bit-for-bit behind `LegacyValuation::frozen_knight`, exposed as the composite label `heuristic-v1-trader-aware-threat-devcards-denial-legacyknight`. The fully ungated path is bit-identical by construction (pressure multiplier exactly 1.0, same steal expression, literal-zero placement term) and its byte-stability is additionally checked by the corpus diff.

**Design.** Standard gap-fix A/B: `evaluate`, standard4, 4 seats, `--domain tuning`, field `pip_diversity` placement, field policy `heuristic-v1-trader`, player trading on, 400 boards x 10 reps, threads 0. Reference = the pre-change composite behind the `legacyknight` label; test arm = the post-change composite.

**Command.**

```text
cargo run --release -p unsettled-sim -- evaluate --layout standard4 --seats 4 --domain tuning --field pip_diversity --arm base=pip_diversity --arm knight=pip_diversity --arm-policy base=heuristic-v1-trader-aware-threat-devcards-denial-legacyknight --arm-policy knight=heuristic-v1-trader-aware-threat-devcards-denial --reference base --boards 400 --reps 10 --policy heuristic-v1-trader --threads 0 --player-trading --out runs/m31-knight
```

**Decision rule (fixed before the run).** The fix ships unless the knight arm comes back `worse` (selected interval strictly below -1pp against the legacyknight reference). `better`, `equivalent`, or `inconclusive` all keep the fix with the reading recorded; the placeholder scales belong to the H2 sweep either way. A `worse` verdict stops the task and records the evidence per the plan's gap-fix rule.

**Threshold and alpha.** +-1pp practical threshold, interval selection as in prior M entries (McNemar vs clustered, whichever the harness selects).

**Admissibility.** `uptime` load recorded before and after; zero illegal actions required; single invocation (16,000 games) expected well under 5 minutes.
