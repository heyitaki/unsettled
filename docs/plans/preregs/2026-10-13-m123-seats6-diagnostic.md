# M-123 preregistration: the diagnostic run at 6 seats on `tuning5`

Date: 2026-10-13. Committed before the invocation executes.

**Why this run exists.** Requirement 16 of [board-strategies-programme.md](../../../.claude/specs/simulator/board-strategies-programme.md): one run a seat count that records every unit's result beside its board's features, so the rule family can be sliced afterwards. Stage 1 adopted the always-on setting at 6 seats (M-118), so the question here is where switching it off helps: the arm is `off`, the vector the adoption replaced.

**Spend.** **This run spends `tuning5` at 6 seats, whatever it reads.** `tuning5` folds the seat count into its seed, so no other seat count's boards or game seeds are touched. The domain is spent when `evaluation.json` exists in the run's `out/` on the laptop or in the bucket.

**Arms.** `base`, `off`, each arm's opponent path pinned to the field's weights. `base` and the field are the shipped 6-seat vector.

**Design.** `evaluate --units`, `extension6`, 6 seats, **`--domain tuning5`**, every seat on `heuristic-v1-trader-aware-threat-devcards-denial` with `--player-trading`, **150,000 boards** x 2 reps (1,800,000 units, 3,600,000 games), `--threshold 0.005 --alpha 0.05 --threads 0`. One invocation, on the box, on one `BUILD_GENERAL1_2XLARGE` machine. Then `slice` once on the delivered run, on the laptop; `slice` plays no game.

**Command.** From `simulator/`:

```text
AWS_PROFILE=pixie-dev box run box/evaluate --ref run=e99c847fadda3cfd0533cd143e37431e085630a5 --compute-type BUILD_GENERAL1_2XLARGE --cap-minutes 120 --node none -- --seats 6 --domain tuning5 --boards 150000 --arms off --units
```

`simulator/box/evaluate/job.sh` at that commit turns those arguments into this command, run from the commit's `simulator/`:

```text
target/release/unsettled-sim evaluate --layout extension6 --seats 6 --domain tuning5 --field 'app_formula_draft:placement/seat-weights/seats-{seats}.json@placement/seat-weights/seats-{seats}.json' --arm 'base=app_formula_draft:placement/seat-weights/seats-{seats}.json@placement/seat-weights/seats-{seats}.json' --arm 'off=app_formula_draft:placement/arms/co_off_s{seats}.json@placement/seat-weights/seats-{seats}.json' --reference base --boards 150000 --reps 2 --policy heuristic-v1-trader-aware-threat-devcards-denial --threads 0 --player-trading --threshold 0.005 --alpha 0.05 --units --out <scratch>/run
```

The delivered `out/` is copied to `simulator/runs/m123-seats6-diagnostic/`, and then, from `simulator/`: `target/release/unsettled-sim slice --run runs/m123-seats6-diagnostic`.

**Build and files.** The binary is built on the box from commit `e99c847f`, whose tree has no uncommitted change under `simulator/`. Its checksum cannot be known before the launch; the job records it in `done.json` with the compiler version and the processor, and the entry copies them. The `perf` launches of this job from that commit built `657103e535942d72b4a6769020ea7165601bc536b2aa9f0acb32bdb28f4d7e3e` with `rustc 1.99.0`. Weights files at that commit, `shasum -a 256`:

- `placement/seat-weights/seats-6.json`: `d7158480d132fe4c1b7120e33543bf93853aa906d695454c6bb4d35f63cd8d8e`
- `placement/arms/co_off_s6.json`: `5089bbb91d3e5a789a1d4b0fcb7a1336b8fa35aefd589e696ff764420176f9fe`

**Readings on `perf` (never evidence).** The same job with `--domain perf --boards 20000` and the same arms and `--units` (run `20261013T224012Z-b253a09a`, commit `e99c847f`, whose evaluator source is the same): 240.6 seconds at a peak of 506 MB (518,092 KiB). The job repeats readings at 2,000 and 20,000 boards on its own machine before the first `tuning5` game and ends with status 3, nothing spent, when the peak grows by more than 1.5 times or the predicted time is over three quarters of what the cap leaves.

**Predicted wall time and memory.** 240.6 seconds scaled by 7.5, 1,804 seconds (30 minutes) of play, plus about 6 minutes for provisioning, the build and the two `perf` readings; machines of this compute type have differed by up to 1.7 times in speed today. Predicted peak memory about 0.6 GB. The cap is 120 minutes.

**Decision rule (fixed before the run).** This run names no candidate, whatever `slices.json` says: its rule table is a first look. Its race table decides item 6 by requirement 17: the race-aware discount is built when, for some arm, the two intervals of one pair of sets do not overlap at two or more `slot` values with the same side higher each time; a pair with a `null` side does not count. When no seat count's table meets that, the owner decides between building the race rule anyway and dropping it. The entry records the stop readings, the ten rule rows with the highest total gain, each pair's by-position rows and the whole race table.

**Admissibility and stop conditions.** The run must report domain `tuning5` at seed `9141560125848139032`. `illegalActions` above 0, or a `base` arm that misses the symmetric corner (with `c = (1 - draws / games) / 6`, a miss is `abs(wins / games - c) > 3.29 * sqrt(c * (1 - c) / games)`), is a stop: it closes 6 seats for the rest of the programme on today's vector, and the fault goes to the owner. The domain is spent at 6 seats either way. A launch that leaves no `evaluation.json` spends nothing and follows requirement 4's table: the identical line is launched once more at most. A run whose `evaluation.json` arrives without a whole `units.csv` has spent the domain and cannot be sliced; that goes to the owner.

**Prediction (recorded before the run).** `off` is the reverse of M-118's contrast on new boards, so I expect its whole-run estimate between -0.85pp and -0.60pp with a half-width near 0.05pp, and every seat's row negative. I put the chance that some kept rule row for `off` reads `better` at under 3%, and the chance that the race table meets requirement 17's test at about 30%.

**Scope.** One layout, one seat count, one policy, one domain, one spend. Each arm moves the hero's formula alone against 5 seats on the shipped vector.
