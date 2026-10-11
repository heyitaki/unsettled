# Simulator bench suite

Approved 2026-10-10. Goal: a speed suite for the Rust engine covering settlement placement and move ranking, shaped so `box` can run it remotely and a later hill-climb can read its output. Accuracy stays with `evaluate`; the hill-climb loop itself is out of scope here.

## Queue

| # | Item | State |
| --- | --- | --- |
| 1 | Scenario corpus: placement, move ranking and end-to-end groups, rebuilt in-process from a dedicated `PERF_SEED` | done, committed on branch `bench-suite`. Sampling defect fixed by a Codex follow-up task (session `01a12826-a429-7bb0-881f-1d63aee10a5f`); 6 + 8 bench tests green in both profiles when re-run by the main session. |
| 2 | `bench` output: nanoseconds per call (fastest and median of N repeats), a state hash and a decision hash per scenario, `--json`, `--filter` | done, committed on branch `bench-suite`. Sampling defect fixed by a Codex follow-up task (session `01a12826-a429-7bb0-881f-1d63aee10a5f`); 6 + 8 bench tests green in both profiles when re-run by the main session. |
| 3 | Candidate `--policy`/`--weights` applied only at the measured call, so a weights candidate is timed on the reference states | done, committed on branch `bench-suite`. Sampling defect fixed by a Codex follow-up task (session `01a12826-a429-7bb0-881f-1d63aee10a5f`); 6 + 8 bench tests green in both profiles when re-run by the main session. |
| 4 | One smoke test running every scenario at a tiny repeat count and pinning the hashes, both profiles; no timing gate in CI | done, committed on branch `bench-suite`. Sampling defect fixed by a Codex follow-up task (session `01a12826-a429-7bb0-881f-1d63aee10a5f`); 6 + 8 bench tests green in both profiles when re-run by the main session. |
| 5 | Box job `simulator/box/bench/`: base ref against candidate ref on one machine, alternating runs, plus callgrind instruction counts; `post.sh` prints per-scenario ratios | verified on the box twice on 2026-10-10: run `20261011T010627Z-4a320978` (snapshot against itself) and run `20261011T014147Z-3651f622` (same snapshot with `--weights placement/arms/flat_swamp.json` as the candidate, after the sampling fix). Both verdict success, 16.5 minutes on `BUILD_GENERAL1_MEDIUM`. README has the `box run` lines. Open: the box items under "Review findings" |
| 6 | Docs: README run instructions and the benchmark section of `contracts.md` | done in the worktree, link check clean |
| 7 | `advise` scenario for the adviser's entry point | done, committed on branch `bench-suite` after a rebase onto main `d8201f8a` (2026-10-11; one `CLAUDE.md` conflict, both sides kept). Twelve rows `advise/<layout>/<kind>` (kinds `turn`, `pre_roll`, `discard`, `robber`, `trade_response`, `produce`), each timing `advice.rs::advise` on one request taken by name from the committed `fixtures/advice-parity.json` (`standard4-11-*`, `extension6-23-*`, the first six-seat extension position), embedded with `include_str!` (the release binary grows from 2.1 MB to 4.5 MB). `stateHash` is the request text, `decisionHash` the response text. Candidates do not reach these rows: the adviser picks its own policy. This is the one group not rebuilt from `PERF_SEED`; rebuilding app JSON in-process would mean moving the parity test's 250-line generator into the library. Codex implemented it (same session, ten mutants caught); the 62 earlier fixture entries are byte-identical. `engine.wasm` was rebuilt for the `game.rs` change and `wasmParity.test.ts` passes against it. Verified by the main session: 601 passed in debug, 573 in release, strict release build. Not yet run on the box, so whether these rows' instruction counts repeat is unknown |

Items 1 to 4 and the README half of 6 go to Codex as one `/delegate` packet. Item 5 follows in the main session.

## Sampling defect found by the box run

Instruction counts were identical between rows that should differ: on extension6 `mid` equals `late` for all six decision kinds, and on standard4 `action/long_road` equals `action/late` and `action/full_hand` equals `action/mid`. Likely cause: the reference game ends before the later turn cap, and the stress rows are picked from the same three samples. Sent to Codex as a new lite packet (not a third fix round of the first packet): stages become fractions of the game's own length, stress rows must be positions no stage row uses, `stateHash` stops mixing in the scenario seed, and `bench_cli.rs::rows_of_one_decision_kind_measure_distinct_states` asserts it.

## Sampling defect: fixed

Cause confirmed by Codex: the standard4 reference game ends at seat turn 93 and the extension6 one at 62, so the old fixed caps returned a finished game for the later stages. Stages are now 1/4, 1/2 and 3/4 of the game's own length in whole rounds, a play that returns a winner is never sampled, and `stateHash` covers inputs only. All 62 scenarios are measured, none skipped. The second box run shows every row of one decision kind with its own instruction count.

## Review findings (self-review, 2026-10-10): approved, the user said "fix all"

| Fix | State |
| --- | --- |
| Rust fixes: seat 0 only, `pre_roll` before the pre-roll, per-game e2e scheduling, clock outside `timed_pass`, empty filter is an error, stress row skips instead of panicking, `seed` as hex, tightened tests, fixture regenerated | done by Codex (report `scratchpad/codex-bench-suite-report5.md`), verified by the main session: strict release build, `bench_cli` 7 and `bench_contract` 10 green in both profiles, 17 unit tests green. All 62 scenarios measured. The unrelated `main.rs::tournament` reflow was reverted by hand |
| `bench_cli.rs` tightened by the main session (seven tests: stale output deleted, two workers in the worker-count test, per-kind policy check for `action`/`discard`/`robber`, weights never reach move ranking) | done, green in release against the pre-fix code |
| Box scripts: `preflight.sh` refuses old refs, other candidate flags and uncommitted weights; `job.sh` survives a failed count, swaps the order each round, records both binary hashes; `post.sh` marks one-sided rows and replaces the summary atomically | done, shellcheck clean, exercised locally on the delivered run |
| Docs: contract reworded (seat 0, the ceiling of a decision row, candidates and state generation, `--quick` rule), README trimmed to operator text, `programme.md` says `PERF_SEED` is never spent, `CLAUDE.md` names the fixture | done, link check clean; re-check against what Codex actually built |
| Third box run on the fixed tree, same commit both sides | done: run `20261011T035559Z-d163f6da` on snapshot `b951008e`, verdict success, 20.5 minutes (callgrind phase 380s). Readings under "Box run readings" |
| `decision/extension6/discard/early` measures the cold fallback (88,398 instructions against about 800 for the other discard rows): its priming pre-roll plays a knight and returns before writing `scratch.goal`, which a real game would still hold from the seat's last turn | done by the main session. `action` never writes the goal, so the fix primes a discard row from the seat's pre-roll after the reference has played its own (`bench.rs::measure_decision`, the `primer` arena). `bench/unit.rs::discard_rows_carry_a_goal` was red before and is green now; the row reads 125ns locally. The regenerated fixture is byte-identical: the answer was the same, only its cost moved. Not rerun on the box |
| `/selfreview` cleanup pass (step 7), then verify (step 8) | done: Codex applied 12 cleanups with the fixture byte-identical (report `scratchpad/codex-bench-suite-report6.md`); three reviewer findings skipped on purpose (shared test-support module, folding the perf-domain test into `policy_strength.rs`, unit test reusing `normalized_sample`). Final verification by the main session on 2026-10-11: strict release build, full workspace 547 passed in debug and 519 in release, rustfmt on the owned files, shellcheck, link check |

`box.json` was copied into the worktree so the branch carries it; the main checkout's untracked copy has to go before the merge. The work was committed on branch `bench-suite` on 2026-10-11, this plan file with it. The box runs used throwaway commit objects (the last is `b951008e`, which predates the cleanup pass and the discard fix). The branch was rebased a second time on 2026-10-11, onto the seat-count weights merge (`54617f50`), and landed on main by fast-forward. That rebase kept both sides of `evaluate.rs` and `contracts.md`, extended the compile-time and runtime disjointness checks to the third and fourth seed generations, passed a seat count to `parse_heuristic`, and made `bench --weights` refuse the `{seats}` placeholder (one parsed kind serves both layouts). No pinned hash moved; 607 tests pass in debug and 579 in release. The suite's reference weights are still `placement/default-weights.json`, not the per-seat files the app now selects by seat count: switching the reference is an open choice and would move the fixture.

Open after this session: the run-to-run spread on `prepare` (a fixed-seed hasher in `topology.rs::index_map` is the candidate fix, an engine change, not started and not confirmed as the cause).

The findings as approved:

- `bench.rs::normalized_sample` begins a turn for whichever seat qualifies, so `discard`, `respond_trade` and both stress rows can sit on a seat that is not next to move. Only seat 0 is next after a capped play. The policy cannot read turn order, so the timings are still of real views, but the contract sentence "a start-of-turn state in a live game" overclaims.
- `pre_roll` rows are measured after `GameArena::begin_turn` already ran and applied the reference's pre-roll, so a dev card the reference plays before rolling is gone and the row can only time the nothing-to-play path. `promote_dev_for_test` exists; the two per-turn counters are private.
- `e2e/*/all_cores` splits games into fixed chunks, one per worker, where the old `runner.rs::benchmark` used `par_iter`. With 20 games on 12 cores only 10 workers get a chunk. A regression in the reported figure.
- A `--filter` matching nothing exits 0 with an empty table. The box job filters by exact id, so a renamed id would count nothing silently.
- A reference change that drops a stress row under its minimum panics and loses the whole run; it should report that row as skipped.
- Test gaps: the zero-count rejection test passes on a panic; the worker-count test runs one worker because `--quick` plays one game; no test shows `--weights` leaves decision rows alone; the candidate-policy test passes if one decision kind alone receives the candidate; both test helpers read a fixed output path without deleting it first.
- Settled: the pinned hashes hold on Linux. All 62 rows of the second box run (x86-64, release) equal `fixtures/bench-hashes.json`, which was generated on macOS.
- Box job: `set -e` makes one failed valgrind process fail the whole job, and `post.sh` then never runs. Candidate arguments other than `--policy` and `--weights` (for example `--calls`) change what the candidate's process counts. `preflight.sh` does not check that both refs have the new `bench`, so the README's `base=main` example fails until this branch is merged.
- `post.sh`: a scenario measured on one side only is labelled `STATES DIFFER` and can print a ratio of 0; a failed rerun truncates the previous `summary.json`.
- `timed_pass` reads the clock inside the counted function, so every instruction count carries a fixed few hundred instructions. That is a third of a `discard` row (765 instructions).
- Instruction counts of `prepare` and the draft-aware rows do not repeat exactly between two builds of one commit (up to 1.6% on `prepare`). Cause unknown: run to run, or build to build.
- Wall rounds always run base before candidate.
- Contract text overclaims in three places: candidates "reach nothing before the measured call" (they prepare the scorers and prime the scratch), the `--quick` single-call rule (true only with no explicit counts), and the stress rows being positions no stage row uses (only the three action stage rows are excluded). The README restates four contract claims and its box commands assume the repo root. `CLAUDE.md` does not mention regenerating `bench-hashes.json`.
- `box.json` was untracked in the main checkout and absent from the worktree during the box runs, which found it by walking up from the worktree. The branch now carries its own copy.

## Box run readings (same commit on both sides)

- Decision rows: instruction counts identical between the two builds, every row. Wall-clock ratios ranged 0.96 to 1.02.
- Placement rows: counts differ by parts per million, except `prepare` (up to 1.6%). Cause not yet named; Codex asked to report it.
- Phases: two builds 30s each, six wall runs 109s each, callgrind 256s.
- Second run, `flat_swamp` weights as the candidate: every decision row has the same instruction count on both sides (weights do not reach move ranking); greedy placement rows cost 7% to 15% of the base; draft-aware rows 72% to 94%; `prepare` within 1.3%; no row reported differing states.

- Third run, fixed suite and fixed job, same commit both sides: the two binaries are byte-identical (`binarySha256` in `done.json`), all 62 hashes equal the macOS fixture, and every move-ranking row has the same instruction count on both sides. Seven placement rows still differ between two runs of one binary: `prepare` by 0.3% to 0.4%, the others by parts per million. So the spread is run to run, not build to build. Likely cause, unverified: the randomly seeded `HashMap`s built by `topology.rs::index_map`.
- Moving the clock out of `timed_pass` removed exactly 114 instructions from each standard4 `discard` row (765 to 651).
- Wall ratios on identical binaries now range 0.965 to 1.067, on both sides of 1 since the order swaps each round. Wall time on the box is good to about 5%; the instruction count is the figure to climb on.

## Sent to Codex in fix round 2 (the last allowed)

- Default `--calls` is automatic per scenario: double from 1 until one pass takes a minimum time, then use that count for every pass. A fixed 10 calls cannot time a 170ns call. An explicit `--calls` or `--quick` disables it.

## Decisions

- Reference decision games use the greedy placement for setup and are normalised to the start of the measured seat's turn with `GameArena::begin_turn_for_test`; the draft-aware setup was over 90% of a quick run and the raw post-`play` state carried another seat's per-turn counters.
- Every measured call runs inside `bench.rs::timed_pass`, the one symbol the box job's callgrind collects in. The box job counts one process per scenario under `--quick`, so a process total is one call's instructions.
- `decisionHash` is the first call's result of the first pass; there are no separate hash calls.
- The acceptance contract is `simulator/crates/cli/tests/bench_cli.rs`, written by the main session before the packet; it fixes the scenario ids and the JSON shape. Hashes are pinned in `simulator/fixtures/bench-hashes.json`, which is what holds debug and release to the same values.
- The placement candidate flag is `--weights <path>`, not a placement spec: the suite always measures both the greedy and the draft-aware kind, so scenario ids stay the same between a base run and a candidate run and their ratios join.
- `bench` grows into the suite; there is no sibling command and no Criterion. Box runs a binary and needs JSON.
- States come from `GameArena::play` truncated by `turn_cap`, then `GameArena::decision_view`, as `denial_gate.rs::denial_arm_per_decision_cost_is_reported` already does. No serialized state files; the hash fixture is the only committed artifact.
- `PERF_SEED` is a new constant disjoint from every evaluation domain, so the suite never touches a spend-once domain.
- The remote metric is callgrind instruction counts, because wall-clock on a shared CodeBuild machine is too noisy to climb on.
- Known ceiling: a code change that alters play also alters the sampled states. The state hash flags that instead of comparing silently. Serialized state fixtures would remove the ceiling; add them only if it bites.
- Games per second is reported and never gated, per the throughput disposition in `.claude/specs/simulator/programme.md`.
- The box stack is `unsettled-box` (profile `pixie-dev`, `us-west-2`), created 2026-10-10; its config is the repo-root `box.json`.
- An accuracy climb can screen on `tuning4` and confirm on `eval4`, which are unspent, and needs a fresh gate domain to decide. The ledger is under "Seed-domain discipline" in `.claude/specs/simulator/programme.md`.
