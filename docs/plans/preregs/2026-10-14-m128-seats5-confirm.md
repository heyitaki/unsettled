# M-128 preregistration: the confirm at 5 seats on `eval5`

Date: 2026-10-14. Committed before the invocation executes.

**Why this run exists.** Requirement 25 of [board-strategies-programme.md](../../../.claude/specs/simulator/board-strategies-programme.md). The exploration at 5 seats (M-126) named `flat_reprice` on `slot>=1&topCrowding>=10` as the candidate: fired on 55% of units, +0.57pp (+0.50pp to +0.64pp). This run reads that rule once on boards no earlier run saw.

**Spend.** **This run spends `eval5` at 5 seats, whatever it reads**, unless it ends with requirement 13's no-fired-unit error, which spends nothing. `eval5` folds the seat count into its seed. The domain is spent when `evaluation.json` exists in the run's `out/` on the laptop or in the bucket.

**Arms.** `base` and `flat_reprice` (`placement/arms/co_flat_reprice_s5.json`: the 5-seat vector with `contestWeight` 0.5 and `repriceFirstExpansion` 1), the arm's opponent path pinned to the field's weights. `base` and the field are the shipped 5-seat vector.

**Design.** `evaluate --where 'slot>=1&topCrowding>=10'`, `extension6`, 5 seats, **`--domain eval5`**, every seat on `heuristic-v1-trader-aware-threat-devcards-denial` with `--player-trading`, **870,000 boards** x 2 reps (8,700,000 units scheduled, about 4,800,000 fired), `--threshold 0.005 --alpha 0.05 --threads 0`. One invocation, on the box, on one `BUILD_GENERAL1_2XLARGE` machine.

**Command.** From `simulator/`:

```text
AWS_PROFILE=pixie-dev box run box/evaluate --ref run=e99c847fadda3cfd0533cd143e37431e085630a5 --compute-type BUILD_GENERAL1_2XLARGE --cap-minutes 180 --node none -- --seats 5 --domain eval5 --boards 870000 --arms flat_reprice --where 'slot>=1&topCrowding>=10'
```

`simulator/box/evaluate/job.sh` at that commit turns those arguments into this command, run from the commit's `simulator/`:

```text
target/release/unsettled-sim evaluate --layout extension6 --seats 5 --domain eval5 --field 'app_formula_draft:placement/seat-weights/seats-{seats}.json@placement/seat-weights/seats-{seats}.json' --arm 'base=app_formula_draft:placement/seat-weights/seats-{seats}.json@placement/seat-weights/seats-{seats}.json' --arm 'flat_reprice=app_formula_draft:placement/arms/co_flat_reprice_s{seats}.json@placement/seat-weights/seats-{seats}.json' --reference base --boards 870000 --reps 2 --policy heuristic-v1-trader-aware-threat-devcards-denial --threads 0 --player-trading --threshold 0.005 --alpha 0.05 --where 'slot>=1&topCrowding>=10' --out <scratch>/run
```

**Build and files.** The binary is built on the box from commit `e99c847f`, whose tree has no uncommitted change under `simulator/`. Its checksum is recorded in `done.json`; every launch from that commit so far built `657103e535942d72b4a6769020ea7165601bc536b2aa9f0acb32bdb28f4d7e3e` with `rustc 1.99.0`. Weights files at that commit, `shasum -a 256`:

- `placement/seat-weights/seats-5.json`: `20d911984fad96fbafc0ef1565c52c3c575ca48eb1dc84b30e66de21c7308720`
- `placement/arms/co_flat_reprice_s5.json`: `a8d31c83aaeca3c43e08d3dbf78a407d2bf36b7ac9fd07f0bb3915e8248260e8`

**Sizing, by requirement 24.** From M-126's `slices.json`, the candidate row's interval is 0.005004 to 0.006446, so `h` = 0.000721 and `E` = 150,000. `H0 = 10,000 * ceil(150,000 * (0.000721 / 0.0003)^2 / 10,000)` = 870,000, which lies between `E` and 2,000,000, so `H1` = 870,000. `P` is the `elapsedSeconds` of this command with `--domain perf --boards 20000` on the box (run `20261014T115912Z-948ffe3d`, Xeon Platinum 8223CL, from `e99c847f`): 90.02 seconds, at a peak of 360 MB (368,352 KiB), with the rule firing on 110,344 of 200,000 units (0.552, `floorMet` true). `T(870,000)` = 90.02 * 870,000 / 20,000 = 3,916 seconds, under 10,800, so `H` = 870,000 for this confirm and for the gate. The predicted fired-gain half-width is `h * sqrt(E / H)` = 0.030pp.

**Predicted wall time and memory.** 3,916 seconds (65 minutes) of play, plus about 8 minutes for provisioning, the build and the job's two `perf` readings; machines of this compute type have differed by up to 1.7 times in speed. Predicted peak memory about 0.7 GB: one chunk's boards, plus the schedule and flags for 8,700,000 units. The cap is 180 minutes.

**Decision rule (fixed before the run).** The run passes when its pair's `verdict` is `better` (the whole fired-gain interval above +0.005) and `config.floorMet` is `true`. A pass sends the same command to the gate on `gate6`. Anything else, including `inconclusive` whatever the estimate, stops 5 seats on its shipped vector with `gate6` unspent there. A run that ends with requirement 13's no-fired-unit error is a fail of the floor, final, and leaves `eval5` unspent. There is no retry.

**Admissibility and stop conditions.** The run must report domain `eval5` at seed `3197586571723816237`. A `--where` run checks `illegalActions` only, because a rule on `slot` plays some seats and not others: `illegalActions` above 0 is a stop that closes 5 seats for the rest of the programme on today's vector, and the fault goes to the owner. A launch that leaves no `evaluation.json` spends nothing and follows requirement 4's table.

**Prediction (recorded before the run).** The candidate is the best of 194 kept rows and its lower end sat on the bar, so I expect it to read lower here: an estimate between +0.42pp and +0.62pp, centred near +0.52pp, with `firedShare` between 0.54 and 0.56. With a half-width of 0.030pp, `better` needs an estimate above about +0.53pp. I put `better` at about 35% and `inconclusive` at about 65%.

**Scope.** One rule, one contrast, one layout, one seat count, one policy, one domain, one spend. The arm moves the hero's formula alone against four seats on the shipped vector.
