# M-29 preregistration — road-building pair gating and the M-22 attribution re-run (SIM-GAP-32)

Date: 2026-08-25. Committed before the run.

**Change under test.** `heuristic_v1.rs::best_road_building_pair` now gates its expansion credit on `DecisionView::is_expansion_target` and reads both laid edges' endpoints, folding through `Option` with `unwrap_or(0.0)` so a pair laid purely for Longest Road keeps a zero credit instead of a `NEG_INFINITY`-poisoned score. This is the verified reproduction recorded in SIM-GAP-32: the old expression priced vertices nobody can settle (including ones permanently blocked by the distance rule) and read only the second edge's endpoints, unlike its sibling `expansion_road_score`, which applies both gates. Pre-change behavior is preserved behind `LegacyValuation::ungated_pair`, exposed as the composite label `heuristic-v1-trader-aware-threat-devcards-denial-legacypair`.

**Design.** SIM-GAP-32 assigns whoever fixes it the M-22 re-run, so this is the M-22 attribution schedule at the corrected full-composite corner with one added leave-one-out arm: `evaluate`, standard4, 4 seats, `--domain tuning`, field `pip_diversity` placement, field policy `heuristic-v1-trader`, player trading on, 400 boards x 10 reps, threads 0, reference = the post-change full composite (`fixed`). The six M-22 arms re-measure the SIM-BATCH1 leave-one-out marginals against the corrected corner (record-only; their M-22 readings stand as history); the new `legacypair` arm is the gap-fix A/B for this change, oriented fixed-minus-legacy as in M-22.

**Command.**

```text
cargo run --release -p unsettled-sim -- evaluate --layout standard4 --seats 4 --domain tuning --field pip_diversity --arm fixed=pip_diversity --arm legacyall=pip_diversity --arm legacyport=pip_diversity --arm legacychooser=pip_diversity --arm legacycityterms=pip_diversity --arm legacyband=pip_diversity --arm legacycitygoal=pip_diversity --arm legacypair=pip_diversity --arm-policy fixed=heuristic-v1-trader-aware-threat-devcards-denial --arm-policy legacyall=heuristic-v1-trader-aware-threat-devcards-denial-legacyall --arm-policy legacyport=heuristic-v1-trader-aware-threat-devcards-denial-legacyport --arm-policy legacychooser=heuristic-v1-trader-aware-threat-devcards-denial-legacychooser --arm-policy legacycityterms=heuristic-v1-trader-aware-threat-devcards-denial-legacycityterms --arm-policy legacyband=heuristic-v1-trader-aware-threat-devcards-denial-legacyband --arm-policy legacycitygoal=heuristic-v1-trader-aware-threat-devcards-denial-legacycitygoal --arm-policy legacypair=heuristic-v1-trader-aware-threat-devcards-denial-legacypair --reference fixed --boards 400 --reps 10 --policy heuristic-v1-trader --threads 0 --player-trading --out runs/m29-pair-attribution
```

**Decision rule (fixed before the run).** Gap-fix A/B on the `legacypair` row only: the fix ships unless fixed-minus-legacypair comes back `worse` (selected interval strictly below -1pp in the fixed-minus-legacy orientation, i.e. the harness's reference-oriented `legacypair` row strictly above +1pp). `better`, `equivalent`, or `inconclusive` all keep the fix with the reading recorded. A `worse` verdict stops the task and records the evidence per the plan's gap-fix rule. The six re-measured M-22 rows are record-only and carry no decision.

**Threshold and alpha.** +-1pp practical threshold, interval selection as in prior M entries (McNemar vs clustered, whichever the harness selects).

**Admissibility.** `uptime` load recorded before and after; zero illegal actions required; single invocation (128,000 games) expected well under 5 minutes.
