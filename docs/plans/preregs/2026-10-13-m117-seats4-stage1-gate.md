# M-117 preregistration: stage 1 at 4 seats, always-on `flat_reprice` on `gate5`

Date: 2026-10-13. Committed before the invocation executes.

**Why this run exists.** Requirement 7 of [board-strategies-programme.md](../../../.claude/specs/simulator/board-strategies-programme.md). At 4 seats the combined arm read `better` on its `tuning4` retry (M-111, +0.64pp, interval +0.47pp to +0.82pp), a selected estimate on a screening domain, and the cut-off programme closed without a held-out reading there. This run is that reading, sized so the interval cannot straddle the bar by sampling alone.

**Spend.** **This run spends `gate5` at 4 seats, whatever it reads.** `gate5` folds the seat count into its seed, so no other seat count's boards or game seeds are touched. The domain is spent when `evaluation.json` exists in the run's `out/` on the laptop or in the bucket.

**Arm.** `simulator/placement/arms/co_flat_reprice_s4.json`: the 4-seat vector with `contestWeight` 0.75 and `repriceFirstExpansion` 1, pinned to exactly those two leaves by its `CO_ARMS` row. The opponent path is pinned to the field's weights.

**Design.** `evaluate`, `standard4`, 4 seats, **`--domain gate5`**, every seat on `heuristic-v1-trader-aware-threat-devcards-denial` with `--player-trading`, field and reference `base` both the shipped 4-seat vector, **1,000,000 boards** x 2 reps (8,000,000 units, 16,000,000 games), `--threshold 0.005 --alpha 0.05 --threads 0`. One invocation, on the box, on one `BUILD_GENERAL1_2XLARGE` machine (72 vCPU).

**Command.** From `simulator/`:

```text
AWS_PROFILE=pixie-dev box run box/evaluate --ref run=4e953d4729eb9966392c37b1e21467dfc6088a33 --compute-type BUILD_GENERAL1_2XLARGE --cap-minutes 150 --node none -- --seats 4 --domain gate5 --boards 1000000 --arms flat_reprice
```

`simulator/box/evaluate/job.sh` at that commit turns those arguments into this command, run from the commit's `simulator/`:

```text
target/release/unsettled-sim evaluate --layout standard4 --seats 4 --domain gate5 --field 'app_formula_draft:placement/seat-weights/seats-{seats}.json@placement/seat-weights/seats-{seats}.json' --arm 'base=app_formula_draft:placement/seat-weights/seats-{seats}.json@placement/seat-weights/seats-{seats}.json' --arm 'flat_reprice=app_formula_draft:placement/arms/co_flat_reprice_s{seats}.json@placement/seat-weights/seats-{seats}.json' --reference base --boards 1000000 --reps 2 --policy heuristic-v1-trader-aware-threat-devcards-denial --threads 0 --player-trading --threshold 0.005 --alpha 0.05 --out <scratch>/run
```

**Build and files.** The binary is built on the box from commit `4e953d47`, whose tree has no uncommitted change. Its checksum cannot be known before the launch; the job records it in `done.json` with the compiler version and the processor, and the entry copies them. A `perf` launch of this job from the same commit (run `20261013T200940Z-180deee5`) built `115b18c77aab791f8f68644ec6fab80d0c7ebf5269355136f32a2eca954ddad0` with `rustc 1.99.0`. Weights files at that commit, `shasum -a 256`:

- `placement/seat-weights/seats-4.json`: `5089bbb91d3e5a789a1d4b0fcb7a1336b8fa35aefd589e696ff764420176f9fe`
- `placement/arms/co_flat_reprice_s4.json`: `d7158480d132fe4c1b7120e33543bf93853aa906d695454c6bb4d35f63cd8d8e`

**Readings on `perf` (never evidence).** The same command with `--domain perf`:

| Where                                | Boards | Wall seconds |        Peak resident |
| ------------------------------------ | -----: | -----------: | -------------------: |
| Laptop, shared with other sessions   |  2,000 |         11.8 |               261 MB |
| Laptop, shared with other sessions   | 20,000 |        150.0 |               274 MB |
| Box, run `20261013T200940Z-180deee5` | 20,000 |         55.1 | 352 MB (360,716 KiB) |

Peak memory at 20,000 boards is 1.05 times the peak at 2,000 on the laptop, inside requirement 7's 1.5. The box's `evaluation.json` for the 20,000-board run is byte-identical to the laptop's. The job repeats both readings on its own machine before the first `gate5` game and ends with status 3, nothing spent, when the ratio is over 1.5 or the predicted time is over three quarters of what the cap leaves.

**Predicted wall time and memory.** 55.1 seconds scaled by 50 is 46 minutes of play, plus about 5 for provisioning, the build and the two `perf` readings. Predicted peak memory is about 0.65 GB: one chunk's boards as in the 20,000-board reading, plus 192 MB of schedule, 32 MB of win and draw flags and 64 MB of `board_of_unit` for 8,000,000 units. The cap is 150 minutes.

**Decision rule (fixed before the run).** `better`, the whole interval above +0.005, adopts at 4 seats by requirement 34 of the cut-off spec: `contestWeight` 0.75 and `repriceFirstExpansion` 1 in `seat-weights/seats-4.json` with its `SEAT_ADOPTIONS` row. Any other verdict, `worse`, `equivalent` or `inconclusive` whatever the estimate, changes nothing in the shipped vector, and 4 seats goes on to the rule search of items 5 to 9. There is no retry and no second `gate5` invocation at 4 seats.

**Admissibility and stop conditions.** The run must report domain `gate5` at seed `1882428495990014522`. `illegalActions` above 0, or a `base` arm that misses the symmetric corner (with `c = (1 - draws / games) / 4`, a miss is `abs(wins / games - c) > 3.29 * sqrt(c * (1 - c) / games)`), is a stop: it closes 4 seats for the rest of the programme on today's vector, and the fault goes to the owner. The domain is spent at 4 seats either way. A launch that leaves no `evaluation.json` spends nothing and follows requirement 4's table: the identical line is launched once more at most.

**Prediction (recorded before the run).** Predicted half-width 0.026pp, so `better` needs an estimate of about +0.53pp or more. The `tuning4` estimate was the best of several arms and read twice, so I expect regression: a point estimate between +0.40pp and +0.70pp, centred near +0.55pp. I put `better` at about 55% and `inconclusive` at about 45%.

**Scope.** One contrast, one layout, one seat count, one policy, one domain, one spend. The arm moves the hero's formula alone against three seats on today's vector, so nothing here observes the field an adoption would create.
