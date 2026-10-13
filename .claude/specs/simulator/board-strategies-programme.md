# Board-specific strategies programme

Status: draft 2026-10-13, not vetted, not approved. Next step: `/vet .claude/specs/simulator/board-strategies-programme.md`.

## Summary

The cut-off programme ([`cut-off-programme.md`](cut-off-programme.md)) measured two placement weights as blanket settings and adopted nothing: the best arm gained about +0.6pp of win rate at four and six seats against a +0.5pp bar. The owner's decision (2026-10-13) is to keep both weights at 0 and apply a strategy only in the situations where it helps, and to treat this as the first of several board-specific strategies. This programme builds the measurement that finds those situations, picks one rule per seat count from a fixed family, and tests that rule once on boards never used. A rule that passes ships; a seat count with no passing rule stays on today's vector.

A situation is what is known before a pick is chosen: the seat count, the picking seat's draft position, and features of the board's terrain. A rule is a condition on a situation plus the weight leaves to apply when it holds. A strategy is one arm and one rule.

The saved runs already show the gain depends on draft position (percentage points against today's weights, by first-round draft position, first picker on the left; the last column is the mean half-width of one position's interval):

| Seats | Run            | Arm                              | Boards | By draft position                        | Half-width |
| ----- | -------------- | -------------------------------- | ------ | ---------------------------------------- | ---------- |
| 2     | M-101          | `flat_75`                        | 6,500  | -0.35, -0.34                             | not read   |
| 3     | M-102          | `flat_75`                        | 7,500  | -0.59, +0.07, +0.51                      | 0.57       |
| 4     | M-105          | `flat_75`                        | 22,000 | -0.19, +0.34, +0.85, +1.00               | 0.33       |
| 4     | M-111          | `flat_reprice` (0.75)            | 22,000 | +0.13, +0.60, +0.85, +1.00               | 0.35       |
| 5     | M-106          | `flat_75`                        | 14,000 | -0.12, -0.23, +0.20, +0.61, +0.63        | 0.38       |
| 5     | M-112          | `flat_reprice` (0.5)             | 14,000 | +0.29, +0.17, +0.76, +0.49, +0.48        | 0.39       |
| 6     | M-107          | `flat_75`                        | 12,000 | +0.10, +0.15, +0.38, +0.14, +1.20, +0.84 | 0.40       |
| 6     | M-113          | `flat_reprice` (0.75)            | 12,000 | +0.68, +0.69, +0.87, +0.53, +1.23, +0.84 | 0.42       |
| 6     | M-114, `eval4` | `flat_reprice` (0.75)            | 12,000 | +0.19, +0.72, +0.71, +0.92, +0.87, +0.41 | 0.42       |

The discount does little or harm for the seats that pick first and about +0.5pp to +1.0pp for the seats that pick late, at three, four and five seats; the re-pricing switch mostly helps the early seats. At three seats the two ends cancel, which is why the blanket arm read zero. This is exploratory: runs on one domain share boards (M-105 and M-111 played the same 22,000), every position was read after the fact, and no rule was fixed in advance. It is the reason draft position is in the rule family, and it is not evidence for adoption.

Everything here builds on branch `cut-off-programme` (worktree `.claude/worktrees/cut-off`), which holds both weights, the `co_*` arms, `gate5` and `evaluate --picks-only`. Paths and names below were read at its commit `723e2f65`. Those runs took 64, 113 and 147 seconds at four, five and six seats for two arms, so this programme's runs are sized generously.

## Queue

Proposed; becomes the working queue when the owner approves the spec.

| #   | Item                                                                                                              | State       |
| --- | ----------------------------------------------------------------------------------------------------------------- | ----------- |
| 1   | Merge `main` into `cut-off-programme`: renumber the colliding measurement entry, rebuild the wasm, run every gate | not started |
| 2   | Evaluator: `tuning5` and `eval5`, the features, `--units`, `--where`, the `slice` subcommand, the three-seat arm  | not started |
| 3   | Explore on `tuning5` at four, three, five and six seats, slice, name each seat count's candidate strategy         | not started |
| 4   | Confirm each candidate on `eval5`                                                                                 | not started |
| 5   | Gate each confirmed candidate on `gate5`                                                                          | not started |
| 6   | Adopt passing rules in the engine and the app, or close with none; ledger and Outcome section                     | not started |

## Requirements

### Terms

- **Unit:** one board, one hero seat, one rep, as `evaluation_schedule` (`simulator/crates/cli/src/evaluate.rs`) lists them. Every arm plays each unit with the same seeds, so two arms whose hero drafts the same pieces play the same game.
- **Draft position (`slot`):** the hero seat's index, 0 for the first picker. `setup_order` (`simulator/crates/engine/src/game.rs`) gives seat `i` pick `i` of the first round and pick `2n - 1 - i` overall for its second.
- **Fired unit:** a unit whose situation satisfies a rule. On every other unit a strategy's hero uses the reference weights, so the unit is an exact tie.
- **Fired gain:** the paired win-rate difference over fired units only. **Total gain:** the fired gain times the share of units that fire.

### Merge (item 1)

1. `main` is merged into `cut-off-programme` before any new code. `main` gained two engine speed commits (`9a08c79a`, `59a6bcac`) that touch `placement/draft.rs` and `placement/expansion.rs`, and its `measurements.md` gained an entry headed M-93, the number the branch gave its own first entry.
   - The branch's M-93 (the item 1 speed proof, which has no preregistration file) takes the next free number after M-114, with "(recorded as M-93 before the merge)" in its heading, and the one reference to it in `cut-off-programme.md` follows. M-94 to M-114 and their preregistration files keep their numbers.
   - After the merge: `simulator/tools/build-wasm.sh`, `cargo test` from `simulator/` in both profiles, `npm test`, `npm run typecheck`, `npm run lint`. `simulator/fixtures/analysis-parity.json` and `bench-hashes.json` must be byte-identical to `main`'s, since both weights are 0.
   - A box speed run with `main`'s tip as `base` and the merge as `cand` shows no scenario's instruction ratio above 1.01.

### Evaluator (item 2)

2. Two domains are minted with the seat count folded into the seed as in generation four: `tuning5` (exploration) and `eval5` (confirm). Each gets a seed constant in the pattern of `GATE5_SEED`, an entry in the compile-time disjointness array, an `EvaluationDomain` variant and its arms in `parse`, `name` and `seed`. `gate5` already exists and is unspent at every seat count.
   - The two tests that pin `tuning5` as an unknown domain (`crates/cli/tests/evaluate_cli.rs` 127, `evaluate_harness.rs` 639) move to `tuning6`.
   - Tests and docs follow requirement 24 of the cut-off spec: the generation loops and spelling table gain both names, the ten new seat-derived seeds are pinned in decimal, and `simulator/README.md`, `contracts.md`, `programme.md` and `CLAUDE.md` gain the names.
3. Features live in one new file, `simulator/crates/cli/src/features.rs`, and read the board through `SimBoard`'s existing accessors (`tiles`, `tokens`) and the topology. No file under `simulator/crates/engine/src` changes in items 2 to 5, so the wasm is not rebuilt. A vertex's pips are the sum of `pips(token)` (`simulator/crates/engine/src/view.rs`) over the hexes it touches. Four terrain features, each a function of the tiles and tokens alone:
   - `roadPips`: total pips on brick hexes plus total pips on wood hexes.
   - `roadPipsMin`: the smaller of those two totals.
   - `spotFalloff`: with every vertex's pips sorted from high to low, the value at rank `2 * seats` divided by the value at rank 1.
   - `topCrowding`: among the `2 * seats` vertices with the most pips (ties to the lower vertex index), the number of unordered pairs two or three edges apart.
   - The fifth feature is `slot`. Ports, pieces and the robber are not read, so a board's terrain features are the same at every pick of its draft.
4. `evaluate --units` writes `units.csv` beside `evaluation.json`: one row per unit in schedule order with `board`, `slot`, `rep`, the four terrain features, and one column per arm holding 1 when that arm's hero won the unit and 0 otherwise. Two runs of one command write the same bytes.
5. `evaluate --where <rule>` plays only fired units. A rule is one to two predicates joined by `&`; a predicate is a feature name, `>=` or `<`, and a number (`slot>=1&roadPips<38`). `--boards` still counts boards drawn from the domain, so the boards a run spends are plain from its command. `evaluation.json` reports its pairs over fired units and adds `where`, `firedUnits` and `firedShare` to its config block. An unknown feature, a third predicate or a rule that fires on no unit is an error.
6. `unsettled-sim slice --units <file> --seats <n> --out <dir>` reads one `units.csv` and writes `slices.json`. It plays no game and takes no domain.
   - Cut points: for each terrain feature, with one value per board sorted ascending, `c1` is the value at index `floor(m / 3)` and `c2` the value at index `floor(2m / 3)`.
   - The rule family, in this order: no condition (`always`); `slot>=k` for `k` from 1 to `n - 1`, then `slot<k` for `k` from 1 to `n - 1`; for each terrain feature in requirement 3's order, `f<c1`, `f>=c1`, `f<c2`, `f>=c2`; then every slot predicate joined with every terrain predicate. At four seats that is 119 rules. A rule whose fired set equals an earlier rule's is dropped, and so is a rule that fires on under 20% of units.
   - For every arm other than the reference and every rule it reports the fired share, the fired gain with the interval `evaluate` computes for a pair (`try_paired_stats`, clustered by board, `--alpha 0.05`), and the total gain.
   - The candidate strategy is chosen among the rows whose fired-gain interval lies wholly above `--threshold 0.005`: the row with the highest total gain. Ties go to fewer predicates, then to the arm listed first in the file, then to family order. With no such row the file says so and names no candidate.
7. One arm file is added: `placement/arms/co_flat_reprice_s3.json`, the three-seat vector with `contestWeight` 0.75 and `repriceFirstExpansion` 1, with its `CO_ARMS` row in `params_file.rs`. The arm count pin moves from 100 to 101.

### Runs (items 3 to 5)

8. The field statement is requirement 22 of the cut-off spec, unchanged: every seat on `heuristic-v1-trader-aware-threat-devcards-denial`, field and `base` on `app_formula_draft:placement/seat-weights/seats-{seats}.json@placement/seat-weights/seats-{seats}.json`, each arm's opponent path pinned to the field's weights, three and four seats on `standard4`, five and six on `extension6`, trading on, `--reps 2 --threshold 0.005 --alpha 0.05 --threads 0`. Seat counts run in the order 4, 3, 5, 6, and nothing read at one changes a command at another.
9. Every invocation has a preregistration file under `docs/plans/preregs/`, named and committed as requirement 26 of the cut-off spec says, carrying the literal command and the decision rule. The main session runs every command that carries a domain; none is delegated.
10. Explore: one invocation per seat count on `tuning5` with `--units`, arms `base`, `flat_75` and `flat_reprice`, at 120,000 boards for three seats, 88,000 for four, 56,000 for five and 48,000 for six (sixteen times the cut-off screens). Predicted from the cut-off retries: about 7, 11 and 15 minutes at four, five and six seats.
    - Stop conditions, read before anything else: `illegalActions` above 0, or `base` missing the symmetric corner by more than 3.29 binomial standard errors, as requirement 28 of the cut-off spec defines it. Either closes the seat count.
    - Then `slice` runs once on the file. Its candidate is that seat count's strategy. No candidate closes the seat count with `eval5` and `gate5` unspent there.
    - The measurement entry records the stop readings, the candidate's row, the ten rows with the highest total gain, and the by-position rows for both arms.
11. Sizing: `H` is the smallest multiple of 1,000 boards at which the candidate's predicted fired-gain half-width, its exploration half-width times `sqrt(exploration boards / H)`, is at most 0.0015. `H` is at least 4,000 and at most the largest multiple of 1,000 whose predicted wall time stays under 30 minutes. `H` is fixed here for the confirm and the gate.
12. Confirm: `base` and the candidate's arm on `eval5` at `H` boards with `--where` set to the candidate's rule (no flag for `always`), one invocation. `pair_verdict` reads the fired gain: `better` proceeds, anything else stops the seat count on today's vector with `gate5` unspent there.
13. Gate: the same command on `gate5`, one invocation. `better` adopts. Neither held-out domain has a retry, and nothing read on one changes a command run on it.
14. The only stop condition on a `--where` run is `illegalActions` above 0. The corner check does not apply, because a rule on `slot` plays some seats and not others.
15. Ledger afterwards: `tuning5` is spent at each seat count explored; `eval5` and `gate5` are spent at each seat count where their run executed, whatever it read; `tuning4`, `eval4` and `gate4` stand as the cut-off programme left them. It is written into `programme.md`, `contracts.md` and `CLAUDE.md` at the close.
16. Every reading goes in `.claude/specs/simulator/measurements.md` under the next free number.

### Adoption (item 6)

17. No engine or app code is written before a rule passes its gate. When one does, this spec gains a line-level amendment that the owner approves before the build. It must meet these requirements:
    - The rule and its leaves live in one JSON file per seat count under `simulator/placement/`, embedded in the engine and pinned by a test, as the seat vectors are.
    - `features.rs` moves into the engine crate, so the app and the simulator compute a feature with one implementation.
    - The analysis chooses weights per ranking from the seat count, the analysed player's draft position and the board's terrain. A nested ranking chooses by its own picker, so the `Likely gone` line still matches the list that player is shown. The `setup_road` export chooses by the placing player.
    - The simulator can play the shipped selection, so a later programme's `base` is what the app ships.
    - `analysis-parity.json` and `bench-hashes.json` are regenerated and re-verified, the wasm is rebuilt, and `analysisPerf.test.ts` holds its bounds with the rule firing.
18. A seat count with no passing rule keeps today's vector. Both weights stay in the engine at 0 either way, by the owner's decision of 2026-10-13. This file gains an Outcome section.

## Design

- No strategy needs its own game code to be measured. A strategy's hero plays the reference weights off its rule, so those units are ties by construction, and its result is the arm's result restricted to fired units. Exploration therefore plays each arm once on every unit and `slice` scores every rule from the one file, and the held-out runs play fired units only.
- Selection is by total gain because that is what the rule is worth to a player; the fired-gain condition keeps out rules that would not clear the bar they are about to be tested against.
- The family is small on purpose: with about 120 to 230 rules and two arms per seat count, the best row is partly luck, and the confirm and the gate are what remove it. Deeper rules or more features raise that luck faster than they raise the gain.
- `always` is in the family, so a blanket setting can still adopt if it clears the same bar on the new, larger held-out runs.
- Files: `simulator/crates/cli/src/evaluate.rs` (`EvaluationDomain`, `evaluation_schedule`, `evaluate`, `try_paired_stats`, `pair_verdict`), `simulator/crates/cli/src/main.rs` (flags, the `slice` subcommand), new `simulator/crates/cli/src/features.rs` and `slice.rs`, `simulator/crates/engine/src/policy/params_file.rs` (`CO_ARMS`).

## Edge cases

- A terrain feature whose two cut points are equal yields duplicate predicates; the duplicate-set rule drops them.
- A `--where` rule on `slot` alone plays whole boards for some seats; clustering by board still holds.
- A candidate whose rule is `always` runs the held-out commands with no `--where`, and the corner check applies to it.
- The same board appears in every seat's units, so a terrain predicate fires for all of a board's units or none.
- `spotFalloff` is a ratio of two integers and is written with Rust's shortest round-trip float text; its cut points are compared as `f64`.

## Non-goals

- Two seats: every arm read negative for both positions there, so nothing is explored.
- More than one rule per seat count, different leaves per rule, rules three predicates deep, and features of the pieces already placed. Each opens as a follow-up only after a rule from this family passes a gate.
- New weight values, new discount shapes and the in-game turn policy.
- Re-reading or replaying any spent domain. The by-position table above reads saved output files only.
- Slicing arms from earlier programmes. `--units` and `slice` work for any arm, and that is the reuse the owner's direction names; no such run is part of this spec.
- A measurement of the field an adoption creates, with every seat on the adopted strategy.

## Testing strategy

- Features: each hand-computed on `src/parser/__tests__/expected/board-draft-empty.json` at four seats, and `topCrowding` on a second board where two top vertices are exactly two edges apart.
- `--units` against `--where`: on the long-spent `tuning` domain at a small board count, the fired-unit pair computed by `slice` for one rule equals, field for field, the pair `evaluate --where` reports for that rule. This is the test that the restriction argument holds. It is shown once to fail when `--where` filters on the wrong column.
- `--where` parsing: each error of requirement 5.
- `slice` on hand-built files: the cut points, the family size at four seats, the 20% floor, a duplicate set dropped, the candidate chosen by total gain among rows clearing the threshold, each tie-break, and no candidate when no row clears.
- Domains: board `i` of `tuning5` and of `eval5` is reproducible from its index and seat count, and their seeds are disjoint from every earlier domain's.
- `CO_ARMS` holds the new three-seat file as it holds the others.

## Decisions for the owner

- **The bar.** Default written above: a rule adopts when its fired gain is wholly above +0.5pp on both held-out runs, and it must fire on at least 20% of units. This is the reading of "apply it only where relevant": a rule that fires on a fifth of situations and gains 1pp there passes, though it adds 0.2pp overall. The alternative keeps the old bar on total gain, under which only a rule worth +0.5pp across all boards passes.
- **Three seats in, two seats out.** Three seats is included because its two ends read -0.59 and +0.51; two seats is excluded because both positions read negative.
- **`always` stays in the family.** It lets a blanket setting adopt on a larger held-out sample. Removing it restricts the programme to conditional rules only.

## Decision points deferred to build time

- The two seed literals of requirement 2.
- How `features.rs` reads a vertex's hexes and walks edge distances from the topology; any accessor already public serves. If none exists and one must be added to the engine crate, the wasm is rebuilt in that commit.
- The board count and rule of the `--units` against `--where` test.
