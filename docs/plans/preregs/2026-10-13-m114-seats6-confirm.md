# M-114 preregistration: the 6-seat confirm of `flat_reprice` on `eval4`

Date: 2026-10-13. Committed before the invocation executes.

**Why this run exists.** Requirement 32 of [cut-off-programme.md](../../../.claude/specs/simulator/cut-off-programme.md). At 6 seats the combined arm read `better` on its `tuning4` retry (M-113, +0.805pp, interval +0.634pp to +0.975pp). It was the best of five arms tried on that domain, two of them read twice, so that estimate is selected and a held-out reading is needed before anything ships.

**Spend.** **This run spends `eval4` at 6 seats, whatever it reads.** `eval4` is a held-out domain, unspent at every seat count until now, with the seat count folded into its seed, so no other seat count's boards or game seeds are touched. `gate5` is not touched here.

**Arm.** `simulator/placement/arms/co_flat_reprice_s6.json`: the 6-seat vector as it stood before this programme with `contestWeight` 0.75 and `repriceFirstExpansion` 1, pinned to exactly those two leaves by its `CO_ARMS` row. The opponent path is pinned to the field's weights.

**Design.** `evaluate`, `extension6`, 6 seats, **`--domain eval4`**, every seat on `heuristic-v1-trader-aware-threat-devcards-denial` with `--player-trading`, field and reference `base` both the 6-seat vector, **12,000 boards** x 2 reps, four times the `B` the pilot fixed in M-99 before any outcome was read, `--threshold 0.005 --alpha 0.05 --threads 0`. One invocation, run from `simulator/` alone on the machine's simulator workload with `uptime` recorded before and after.

**Command.**

```text
target/release/unsettled-sim evaluate --layout extension6 --seats 6 --domain eval4 --field 'app_formula_draft:placement/seat-weights/seats-{seats}.json@placement/seat-weights/seats-{seats}.json' --arm 'base=app_formula_draft:placement/seat-weights/seats-{seats}.json@placement/seat-weights/seats-{seats}.json' --arm 'flat_reprice=app_formula_draft:placement/arms/co_flat_reprice_s{seats}.json@placement/seat-weights/seats-{seats}.json' --reference base --boards 12000 --reps 2 --policy heuristic-v1-trader-aware-threat-devcards-denial --threads 0 --player-trading --threshold 0.005 --alpha 0.05 --out runs/m114-seats6-confirm
```

**Decision rule (fixed before the run).** `better`, the whole interval above +0.005, proceeds to the gate on `gate5` at 12,000 boards under its own preregistration. Anything else, `worse`, `equivalent` or `inconclusive` whatever the estimate, stops 6 seats on today's vector with both keys at 0 and leaves `gate5` unspent there. There is no retry and no second `eval4` invocation at 6 seats.

**Admissibility and stop conditions.** The run must report domain `eval4` at seed `4610476946749721033`, which is `mix64(0xe7a4_5eed_2026_1010 ^ 6)`. `illegalActions` above 0, or a `base` arm that misses the symmetric corner (with `c = (1 - draws / games) / 6`, a miss is `abs(wins / games - c) > 3.29 * sqrt(c * (1 - c) / games)`), stops 6 seats on today's vector; the domain is spent at 6 seats either way.

**Prediction (recorded before the run).** The `tuning4` estimate was picked as the best of several, so I expect regression: a point estimate between +0.45pp and +0.85pp, centred near +0.65pp. The retry's half-width was 0.17pp at this size, so `better` needs an estimate of about +0.67pp or more. I put `better` at about 45% and `inconclusive` at about 55%.

**Scope.** One contrast, one layout, one seat count, one policy, one domain, one spend. The arm moves the hero's formula alone against five seats on today's vector, so nothing here observes the field an adoption would create, where every seat carries the new weights.
