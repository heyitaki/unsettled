# M-95 preregistration: the 4-seat picks reading and blind pilot of the cut-off arms on `tuning4`

Date: 2026-10-13. Committed before either invocation executes.

**Why these runs exist.** [cut-off-programme.md](../../../.claude/specs/simulator/cut-off-programme.md) measures whether pricing a contested expansion site lower (`contestWeight`) or re-pricing the first pick after the intervening picks (`repriceFirstExpansion`) wins games. Before any outcome is read at a seat count, requirement 27 drops the arms that barely change a draft there, and requirement 28 sizes the screen from a pilot read blind. This file covers both steps at 4 seats, the first seat count in the programme's order 4, 2, 3, 5, 6.

**Spend.** The picks reading plays no game and reads no outcome, so it leaves `tuning4` unspent at 4 seats. **The pilot spends `tuning4` at 4 seats**, whatever it reads. `tuning4` is this programme's screening domain; `eval4` and `gate5` are not touched here.

**Arms.** Four files under `simulator/placement/arms/`, each the 4-seat vector as it stood before this programme with one leaf moved, pinned by `CO_ARMS` and `CO_ANCHORS` in `params_file.rs`: `co_flat_25_s4.json`, `co_flat_50_s4.json` and `co_flat_75_s4.json` (`contestWeight` 0.25, 0.5, 0.75) and `co_reprice_only_s4.json` (`repriceFirstExpansion` 1). Each moves the hero's formula alone; its opponent path is pinned to the field's weights.

**Design.** `evaluate`, `standard4`, 4 seats, `--domain tuning4`, every seat on `heuristic-v1-trader-aware-threat-devcards-denial` with `--player-trading`, field and reference arm `base` both `app_formula_draft:placement/seat-weights/seats-{seats}.json@placement/seat-weights/seats-{seats}.json`, 400 boards, `--reps 2 --threshold 0.005 --alpha 0.05 --threads 0`, run from `simulator/`.

**Commands.** The release binary is rebuilt first in its own command block. Each invocation then runs alone on the machine's simulator workload, with `uptime` recorded before and after.

Picks reading:

```text
target/release/unsettled-sim evaluate --picks-only --layout standard4 --seats 4 --domain tuning4 --field 'app_formula_draft:placement/seat-weights/seats-{seats}.json@placement/seat-weights/seats-{seats}.json' --arm 'base=app_formula_draft:placement/seat-weights/seats-{seats}.json@placement/seat-weights/seats-{seats}.json' --arm 'flat_25=app_formula_draft:placement/arms/co_flat_25_s{seats}.json@placement/seat-weights/seats-{seats}.json' --arm 'flat_50=app_formula_draft:placement/arms/co_flat_50_s{seats}.json@placement/seat-weights/seats-{seats}.json' --arm 'flat_75=app_formula_draft:placement/arms/co_flat_75_s{seats}.json@placement/seat-weights/seats-{seats}.json' --arm 'reprice_only=app_formula_draft:placement/arms/co_reprice_only_s{seats}.json@placement/seat-weights/seats-{seats}.json' --reference base --boards 400 --reps 2 --policy heuristic-v1-trader-aware-threat-devcards-denial --threads 0 --player-trading --threshold 0.005 --alpha 0.05 --out runs/m95-seats4-picks
```

Blind pilot: the same command without `--picks-only`, with `--out runs/m95-seats4-pilot`, and with the `--arm` list cut to `base` plus every arm the rule below keeps, in the order above.

**Decision rule for the picks reading (requirement 27).** From `picks.json`, an arm whose `changedPickShare` is under 0.02 is not piloted or screened at 4 seats and is recorded as inert there. If no arm remains, 4 seats closes with both keys at 0, no pilot runs, and `tuning4` stays unspent at 4 seats.

**What is read from the pilot, and nothing else.** `jq .elapsedSeconds meta.json`, and `jq '{illegalActions, arms: [.pairs[] | {arm, halfWidth: ((.interval[1] - .interval[0]) / 2), discordant: ((.b + .c) / .n)}]}' evaluation.json`. For the stop condition below, the `base` arm's `wins`, `games` and `draws` from `arms.base`. Estimates, interval endpoints, the other arms' win rates and verdicts are not read, recorded or cited.

**Sizing rule (requirement 28).** `B` is the smallest multiple of 500 at which the widest arm's predicted half-width, its pilot half-width times `sqrt(400 / B)`, is at most 0.0035. `B` is at most the largest multiple of 500 whose predicted wall time, the pilot's `elapsedSeconds` scaled by boards, stays under 30 minutes, and is never below 500. If the cap or the floor sets `B`, the entry says what half-width that predicts. `B` is then fixed for every later run at 4 seats: the screen at `B`, a retry, the confirm and the gate at `4B`.

**Stop conditions.** `illegalActions` above 0, or a `base` arm that misses the symmetric corner: with `c = (1 - draws / games) / 4`, a miss is `abs(wins / games - c) > 3.29 * sqrt(c * (1 - c) / games)`. Either stops 4 seats at the pilot with both keys at 0, and the entry records why.

**Prediction (recorded before the runs).** The contest classifier fires on most drafts once a rival's road is down, so I expect each flat arm to change between 5% and 30% of drafts, rising with the weight, and `reprice_only` to change the fewest, possibly under the 2% line. I make no prediction of any outcome, since the pilot's outcomes are not read.

**Scope.** One layout, one seat count, one policy, one field. Nothing read here changes a command at another seat count.

**Numbering.** M-94 is the last entry in `.claude/specs/simulator/measurements.md` at this commit (main holds an M-92 this branch has not merged yet). The five picks-and-pilot entries take M-95 to M-99 in the order 4, 2, 3, 5, 6, so this one is M-95.
