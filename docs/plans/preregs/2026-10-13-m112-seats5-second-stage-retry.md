# M-112 preregistration: the 5-seat retry of `flat_reprice` on `tuning4`

Date: 2026-10-13. Committed before the invocation executes.

**Why this run exists.** The 5-seat second-stage screen (M-109) read `flat_reprice` as `inconclusive` at +0.549pp, at or above the 0.0025 line, which requirement 29 of [cut-off-programme.md](../../../.claude/specs/simulator/cut-off-programme.md) answers with one retry at four times the boards. `tuning4` is already spent at 5 seats; `eval4` and `gate5` are not touched here.

**Design.** M-109's command at **14,000 boards** x 2 reps: `base` and `co_flat_reprice_s5.json` (`contestWeight` 0.5 with `repriceFirstExpansion` 1), run from `simulator/` alone on the machine's simulator workload with `uptime` recorded before and after.

**Command.**

```text
target/release/unsettled-sim evaluate --layout extension6 --seats 5 --domain tuning4 --field 'app_formula_draft:placement/seat-weights/seats-{seats}.json@placement/seat-weights/seats-{seats}.json' --arm 'base=app_formula_draft:placement/seat-weights/seats-{seats}.json@placement/seat-weights/seats-{seats}.json' --arm 'flat_reprice=app_formula_draft:placement/arms/co_flat_reprice_s{seats}.json@placement/seat-weights/seats-{seats}.json' --reference base --boards 14000 --reps 2 --policy heuristic-v1-trader-aware-threat-devcards-denial --threads 0 --player-trading --threshold 0.005 --alpha 0.05 --out runs/m112-seats5-second-stage-retry
```

**Decision rule (fixed before the run).** `better` makes `flat_reprice` the 5-seat candidate, since no other arm read `better` there, and it goes to the confirm on `eval4` at 14,000 boards under its own preregistration. Anything else drops it: there is no second retry, 5 seats closes with both keys at 0, and `eval4` and `gate5` stay unspent there.

**Stop conditions.** `illegalActions` above 0, or a `base` arm that misses the symmetric corner: with `c = (1 - draws / games) / 5`, a miss is `abs(wins / games - c) > 3.29 * sqrt(c * (1 - c) / games)`. Either stops 5 seats at this run with both keys at 0.

**Prediction (recorded before the run).** The flat part alone held near +0.45pp to +0.5pp on its retry at 4 and 6 seats and fell to about +0.2pp at 5, and re-pricing alone added nothing measurable. For `better` the whole interval must sit above +0.5pp, so the estimate has to land near +0.7pp or higher at this size. I expect an estimate between +0.2pp and +0.6pp and put `better` at about 10%.

**Scope.** One layout, one seat count, one policy, one field, the hero's formula alone. Nothing read here changes a command at another seat count.
