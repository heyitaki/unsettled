# M-125 preregistration: the explore run at 3 seats on `tuning6`

Date: 2026-10-14. Committed before the invocation executes.

**Why this run exists.** Requirement 23 of [board-strategies-programme.md](../../../.claude/specs/simulator/board-strategies-programme.md): one exploration a seat count on `tuning6`, with requirement 16's arms and board counts (the race arms were dropped on 2026-10-14). The diagnostic (M-121) found no row reaching the bar at 3 seats; its best was `flat_reprice` on `slot>=1`, +0.31pp. This is the exploration requirement 23 runs at every seat count, on boards the diagnostic did not see.

**Spend.** **This run spends `tuning6` at 3 seats, whatever it reads.** `tuning6` folds the seat count into its seed, so no other seat count's boards or game seeds are touched. The domain is spent when `evaluation.json` exists in the run's `out/` on the laptop or in the bucket.

**Arms.** `base`, `flat_75`, `flat_reprice`, each arm's opponent path pinned to the field's weights. `base` and the field are the shipped 3-seat vector.

**Design.** `evaluate --units`, `standard4`, 3 seats, **`--domain tuning6`**, every seat on `heuristic-v1-trader-aware-threat-devcards-denial` with `--player-trading`, **300,000 boards** x 2 reps (1,800,000 units, 5,400,000 games), `--threshold 0.005 --alpha 0.05 --threads 0`. One invocation, on the box, on one `BUILD_GENERAL1_2XLARGE` machine. Then `slice` once on the delivered run, on the laptop; `slice` plays no game.

**Command.** From `simulator/`:

```text
AWS_PROFILE=pixie-dev box run box/evaluate --ref run=e99c847fadda3cfd0533cd143e37431e085630a5 --compute-type BUILD_GENERAL1_2XLARGE --cap-minutes 120 --node none -- --seats 3 --domain tuning6 --boards 300000 --arms flat_75,flat_reprice --units
```

`simulator/box/evaluate/job.sh` at that commit turns those arguments into this command, run from the commit's `simulator/`:

```text
target/release/unsettled-sim evaluate --layout standard4 --seats 3 --domain tuning6 --field 'app_formula_draft:placement/seat-weights/seats-{seats}.json@placement/seat-weights/seats-{seats}.json' --arm 'base=app_formula_draft:placement/seat-weights/seats-{seats}.json@placement/seat-weights/seats-{seats}.json' --arm 'flat_75=app_formula_draft:placement/arms/co_flat_75_s{seats}.json@placement/seat-weights/seats-{seats}.json' --arm 'flat_reprice=app_formula_draft:placement/arms/co_flat_reprice_s{seats}.json@placement/seat-weights/seats-{seats}.json' --reference base --boards 300000 --reps 2 --policy heuristic-v1-trader-aware-threat-devcards-denial --threads 0 --player-trading --threshold 0.005 --alpha 0.05 --units --out <scratch>/run
```

The delivered `out/` is copied to `simulator/runs/m125-seats3-explore/`, and then, from `simulator/`: `target/release/unsettled-sim slice --run runs/m125-seats3-explore`.

**Build and files.** The binary is built on the box from commit `e99c847f`, whose tree has no uncommitted change under `simulator/`. Its checksum cannot be known before the launch; the job records it in `done.json` with the compiler version and the processor, and the entry copies them. The `perf` launches of this job from that commit built `657103e535942d72b4a6769020ea7165601bc536b2aa9f0acb32bdb28f4d7e3e` with `rustc 1.99.0`. Weights files at that commit, `shasum -a 256`:

- `placement/seat-weights/seats-3.json`: `20d911984fad96fbafc0ef1565c52c3c575ca48eb1dc84b30e66de21c7308720`
- `placement/arms/co_flat_75_s3.json`: `69f7d3350f13ddba7b92571c1f637f99966494c1e5fcf59bd608eebfaadf7337`
- `placement/arms/co_flat_reprice_s3.json`: `0e66fd6ab4976d60a733a622a854c81ec3271bb52e09fb14b7861c8f9d6aa646`

**Readings on `perf` (never evidence).** The same job with `--domain perf --boards 20000` and the same arms and `--units` (run `20261013T224012Z-d09d50b2`, commit `e99c847f`, whose evaluator source is the same): 38.0 seconds at a peak of 471 MB (481,872 KiB). The job repeats readings at 2,000 and 20,000 boards on its own machine before the first `tuning6` game and ends with status 3, nothing spent, when the peak grows by more than 1.5 times or the predicted time is over three quarters of what the cap leaves.

**Predicted wall time and memory.** 38.0 seconds scaled by 15, 570 seconds (10 minutes) of play, plus about 6 minutes for provisioning, the build and the two `perf` readings; machines of this compute type have differed by up to 1.7 times in speed today. Predicted peak memory about 0.6 GB. The cap is 120 minutes.

**Decision rule (fixed before the run).** `slices.json`'s `candidate` is this seat count's strategy, whichever arm it carries: the row reading `better` with the largest `b - c`, ties to fewer predicates, then the earlier arm, then the earlier rule. A `null` candidate closes the seat count on its shipped vector with `eval5` and `gate6` unspent there. A candidate goes to the confirm on `eval5`, sized by requirement 24 from its row's half-width and a `perf` reading of the confirm's own command. The entry records the stop readings, the candidate's row, the ten rows with the highest total gain, the by-position rows for every arm and the race table.

**Admissibility and stop conditions.** The run must report domain `tuning6` at seed `3891242770353448390`. `illegalActions` above 0, or a `base` arm that misses the symmetric corner (with `c = (1 - draws / games) / 3`, a miss is `abs(wins / games - c) > 3.29 * sqrt(c * (1 - c) / games)`), is a stop: it closes 3 seats for the rest of the programme on today's vector, and the fault goes to the owner. The domain is spent at 3 seats either way. A launch that leaves no `evaluation.json` spends nothing and follows requirement 4's table: the identical line is launched once more at most. A run whose `evaluation.json` arrives without a whole `units.csv` has spent the domain and cannot be sliced; that goes to the owner.

**Prediction (recorded before the run).** Both arms between 0pp and +0.30pp over the whole run, the best row near `slot>=1` at about +0.3pp. I put a `null` candidate at about 85%.

**Scope.** One layout, one seat count, one policy, one domain, one spend. Each arm moves the hero's formula alone against 2 seats on the shipped vector.
