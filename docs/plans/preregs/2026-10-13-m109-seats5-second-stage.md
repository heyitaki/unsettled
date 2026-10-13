# M-109 preregistration: the 5-seat second-stage screen of `flat_reprice` on `tuning4`

Date: 2026-10-13. Committed, with the arm file and its pin row, before the invocation executes.

**Why this run exists.** Requirement 30 of [cut-off-programme.md](../../../.claude/specs/simulator/cut-off-programme.md): at 5 seats some flat arm and `reprice_only` each have a positive estimate at their last reading and neither read `worse` (M-106), so one combined arm is screened. `tuning4` is already spent at 5 seats; `eval4` and `gate5` are not touched here.

**Arm.** `simulator/placement/arms/co_flat_reprice_s5.json`: the 5-seat vector as it stood before this programme with `contestWeight` 0.5, the weight of the flat arm whose last-reading estimate is highest at 5 seats, and `repriceFirstExpansion` 1. It is pinned to exactly those two leaves by its own `CO_ARMS` row. The opponent path is pinned to the field's weights.

**Design.** The screen's design with `base` and that arm alone: `evaluate`, `extension6`, 5 seats, `--domain tuning4`, **3,500 boards** x 2 reps, the `B` the pilot fixed, run from `simulator/` alone on the machine's simulator workload with `uptime` recorded before and after.

**Command.**

```text
target/release/unsettled-sim evaluate --layout extension6 --seats 5 --domain tuning4 --field 'app_formula_draft:placement/seat-weights/seats-{seats}.json@placement/seat-weights/seats-{seats}.json' --arm 'base=app_formula_draft:placement/seat-weights/seats-{seats}.json@placement/seat-weights/seats-{seats}.json' --arm 'flat_reprice=app_formula_draft:placement/arms/co_flat_reprice_s{seats}.json@placement/seat-weights/seats-{seats}.json' --reference base --boards 3500 --reps 2 --policy heuristic-v1-trader-aware-threat-devcards-denial --threads 0 --player-trading --threshold 0.005 --alpha 0.05 --out runs/m109-seats5-second-stage
```

**Decision rule (requirements 29 to 31, fixed before the run).** `better` makes `flat_reprice` the 5-seat candidate, since no other arm read `better` there, and it goes to the confirm on `eval4` at 14,000 boards. `worse` or `equivalent` drops it. `inconclusive` with `estimate` at or above 0.0025 buys one retry at 14,000 boards under its own preregistration, after which `better` survives and anything else is dropped; any other `inconclusive` drops it unresolved. If it is dropped, 5 seats closes with both keys at 0, and `eval4` and `gate5` stay unspent there.

**Stop conditions.** `illegalActions` above 0, or a `base` arm that misses the symmetric corner: with `c = (1 - draws / games) / 5`, a miss is `abs(wins / games - c) > 3.29 * sqrt(c * (1 - c) / games)`. Either stops 5 seats at this run with both keys at 0.

**Prediction (recorded before the run).** `reprice_only` alone read `equivalent` at every seat count, with estimates between -0.06pp and +0.16pp, so I expect the combined arm to read about what its flat part read, within noise: an estimate between +0.1pp and +0.6pp, `inconclusive`, and a retry bought at about 60%. I put `better` here or on a retry at about 10%.

**Scope.** One layout, one seat count, one policy, one field, the hero's formula alone. Nothing read here changes a command at another seat count.
