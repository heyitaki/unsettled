# M-126 preregistration: the explore run at 5 seats on `tuning6`

Date: 2026-10-14. Committed before the invocation executes.

**Why this run exists.** Requirement 23 of [board-strategies-programme.md](../../../.claude/specs/simulator/board-strategies-programme.md): one exploration a seat count on `tuning6`, with requirement 16's arms and board counts (the race arms were dropped on 2026-10-14). The diagnostic (M-122) read `flat_reprice` at +0.52pp always-on and `better` on `slot>=1` at +0.56pp. This is the exploration that names 5 seats' candidate, on boards the diagnostic did not see.

**Spend.** **This run spends `tuning6` at 5 seats, whatever it reads.** `tuning6` folds the seat count into its seed, so no other seat count's boards or game seeds are touched. The domain is spent when `evaluation.json` exists in the run's `out/` on the laptop or in the bucket.

**Arms.** `base`, `flat_75`, `flat_reprice`, each arm's opponent path pinned to the field's weights. `base` and the field are the shipped 5-seat vector.

**Design.** `evaluate --units`, `extension6`, 5 seats, **`--domain tuning6`**, every seat on `heuristic-v1-trader-aware-threat-devcards-denial` with `--player-trading`, **150,000 boards** x 2 reps (1,500,000 units, 4,500,000 games), `--threshold 0.005 --alpha 0.05 --threads 0`. One invocation, on the box, on one `BUILD_GENERAL1_2XLARGE` machine. Then `slice` once on the delivered run, on the laptop; `slice` plays no game.

**Command.** From `simulator/`:

```text
AWS_PROFILE=pixie-dev box run box/evaluate --ref run=e99c847fadda3cfd0533cd143e37431e085630a5 --compute-type BUILD_GENERAL1_2XLARGE --cap-minutes 120 --node none -- --seats 5 --domain tuning6 --boards 150000 --arms flat_75,flat_reprice --units
```

`simulator/box/evaluate/job.sh` at that commit turns those arguments into this command, run from the commit's `simulator/`:

```text
target/release/unsettled-sim evaluate --layout extension6 --seats 5 --domain tuning6 --field 'app_formula_draft:placement/seat-weights/seats-{seats}.json@placement/seat-weights/seats-{seats}.json' --arm 'base=app_formula_draft:placement/seat-weights/seats-{seats}.json@placement/seat-weights/seats-{seats}.json' --arm 'flat_75=app_formula_draft:placement/arms/co_flat_75_s{seats}.json@placement/seat-weights/seats-{seats}.json' --arm 'flat_reprice=app_formula_draft:placement/arms/co_flat_reprice_s{seats}.json@placement/seat-weights/seats-{seats}.json' --reference base --boards 150000 --reps 2 --policy heuristic-v1-trader-aware-threat-devcards-denial --threads 0 --player-trading --threshold 0.005 --alpha 0.05 --units --out <scratch>/run
```

The delivered `out/` is copied to `simulator/runs/m126-seats5-explore/`, and then, from `simulator/`: `target/release/unsettled-sim slice --run runs/m126-seats5-explore`.

**Build and files.** The binary is built on the box from commit `e99c847f`, whose tree has no uncommitted change under `simulator/`. Its checksum cannot be known before the launch; the job records it in `done.json` with the compiler version and the processor, and the entry copies them. The `perf` launches of this job from that commit built `657103e535942d72b4a6769020ea7165601bc536b2aa9f0acb32bdb28f4d7e3e` with `rustc 1.99.0`. Weights files at that commit, `shasum -a 256`:

- `placement/seat-weights/seats-5.json`: `20d911984fad96fbafc0ef1565c52c3c575ca48eb1dc84b30e66de21c7308720`
- `placement/arms/co_flat_75_s5.json`: `69f7d3350f13ddba7b92571c1f637f99966494c1e5fcf59bd608eebfaadf7337`
- `placement/arms/co_flat_reprice_s5.json`: `a8d31c83aaeca3c43e08d3dbf78a407d2bf36b7ac9fd07f0bb3915e8248260e8`

**Readings on `perf` (never evidence).** The same job with `--domain perf --boards 20000` and the same arms and `--units` (run `20261013T224012Z-f3753745`, commit `e99c847f`, whose evaluator source is the same): 241.2 seconds at a peak of 549 MB (562,140 KiB). The job repeats readings at 2,000 and 20,000 boards on its own machine before the first `tuning6` game and ends with status 3, nothing spent, when the peak grows by more than 1.5 times or the predicted time is over three quarters of what the cap leaves.

**Predicted wall time and memory.** 241.2 seconds scaled by 7.5, 1,809 seconds (30 minutes) of play, plus about 6 minutes for provisioning, the build and the two `perf` readings; machines of this compute type have differed by up to 1.7 times in speed today. Predicted peak memory about 0.6 GB. The cap is 120 minutes.

**Decision rule (fixed before the run).** `slices.json`'s `candidate` is this seat count's strategy, whichever arm it carries: the row reading `better` with the largest `b - c`, ties to fewer predicates, then the earlier arm, then the earlier rule. A `null` candidate closes the seat count on its shipped vector with `eval5` and `gate6` unspent there. A candidate goes to the confirm on `eval5`, sized by requirement 24 from its row's half-width and a `perf` reading of the confirm's own command. The entry records the stop readings, the candidate's row, the ten rows with the highest total gain, the by-position rows for every arm and the race table.

**Admissibility and stop conditions.** The run must report domain `tuning6` at seed `9901259806954877661`. `illegalActions` above 0, or a `base` arm that misses the symmetric corner (with `c = (1 - draws / games) / 5`, a miss is `abs(wins / games - c) > 3.29 * sqrt(c * (1 - c) / games)`), is a stop: it closes 5 seats for the rest of the programme on today's vector, and the fault goes to the owner. The domain is spent at 5 seats either way. A launch that leaves no `evaluation.json` spends nothing and follows requirement 4's table: the identical line is launched once more at most. A run whose `evaluation.json` arrives without a whole `units.csv` has spent the domain and cannot be sliced; that goes to the owner.

**Prediction (recorded before the run).** `flat_reprice` between +0.40pp and +0.65pp over the whole run. I put a non-`null` candidate at about 75%: `slot>=1` on `flat_reprice` at about 45%, `always` on `flat_reprice` at about 25%, another row at about 5%.

**Scope.** One layout, one seat count, one policy, one domain, one spend. Each arm moves the hero's formula alone against 4 seats on the shipped vector.
