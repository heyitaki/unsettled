# Engine speed: every entry point in microseconds

Goal, set by Aki on 2026-10-12: bring the Catan engine into the range a chess engine works in, where one unit of work costs microseconds. Branch `engine-speed`, worktree `.claude/worktrees/engine-speed`.

A policy decision already costs 0.02 to 2.5 µs. The entry points built on top of it are what this plan moves. Baseline is `main` at `4dab4d72`, `bench` on the laptop, minimum per call.

| Entry point | Baseline, 4 seats | Baseline, 6 seats | Target |
| --- | ---: | ---: | --- |
| Adviser call, JSON in to JSON out | 155 to 170 µs | 220 to 260 µs | under 15 µs |
| Best picks in the browser (`analyzeBoard`, TypeScript) | about 1.4 s | 1.6 s, 6.3 s with three rival rankings | Rust in WebAssembly: at most 300 ms, and 1200 ms with three rival rankings |
| Whole self-play game | 2.2 ms | 6.4 ms | set after item 4's profile |

No item may change an output: `fixtures/advice-parity.json`, `fixtures/bench-hashes.json` and `fixtures/analysis-parity.json` stay byte-identical unless a row says otherwise.

## Queue

| # | Item | State |
| --- | --- | --- |
| 1 | Parse each layout's topology once per process (`Topology::shared`), used by `WireBoard::validate` and `advise`. The adviser parsed the 25 to 39 KB pack twice per call. | Done. Measured 33 µs at four seats and 43 µs at six (was 160 and 225). |
| 2 | Adviser: reuse one arena and policy scratch per thread, and parse the request in one typed pass with the current path as the fallback for any input the typed pass refuses. | Done. Measured about 16 µs at four seats and 22 µs at six; the `turn` rows are 27 µs. The 15 µs target is missed by about 1 µs on four rows. What is left per call: typed parse 6 µs, `validate` 3 µs, `try_from_wire` 2.6 µs, the policy 1 to 2 µs. |
| 3 | Best picks in Rust and WebAssembly: a Rust twin of `analyze.ts` (sampled rollouts, nested rival rankings, statuses) behind the existing worker, gated on matching today's rankings before any TypeScript goes. Decided 2026-10-10; `stats.ts`, `legality.ts` and `draft.ts` stay TypeScript. | Done, on this branch since 2026-10-12 (25 commits, rebased from `ralphex-best-picks-wasm`). Worst six-seat board in WebAssembly: 31 ms for the opening and 105 ms with three rival rankings (TypeScript took 1600 and 6330); native 14 to 16 ms and 56 ms. `analyze.ts`, `valuation.ts`, `expansion.ts`, `weights.ts` and the placement parity fixture are deleted. Aki accepted the `pow` near-tie on one-player boards (revision 1 in `.claude/ralphex/best-picks-wasm/spec.md`, main checkout). |
| 4 | Whole games: speed up the draft, which is most of a game. Profile at `b7702265` (8 s samples of `bench --filter e2e/<layout>/single_core`; 2.21 ms and 6.53 ms per game): the placement code is 51% of a four-seat game and 67% of a six-seat one, against 18% and 9% for trade pricing with win distance, and 11% and 9% for road legality and longest road. Inside placement, by self time: `expansion::row_value` 14% and 18%, `ScoreRows::argmax_row` 9% and 13%, `draft::setup_road` 6% and 9% (M-89 left it on the walk; read the sites from the reach table), `Occupancy::new` 3% and 4% (M-89 left it rebuilt per pick; carry the masks across the replay). Start with `setup_road` and `Occupancy::new`, then look at why `row_value` and `argmax_row` still cost a quarter of a game after M-89's bound. | Done, on this branch since 2026-10-12 (three commits, M-90). A game is 2.08 ms at four seats and 5.94 ms at six, 5% and 9% faster; the 10% and 15% targets were missed and no further round is planned, because the remaining cost is the count of work the lookahead does (about 5,100 expansion terms per four-seat game at about 60 ns). |
| 5 | Land on `main`. Aki said "land everything" on 2026-10-12. | Done 2026-10-12. `main` had moved 16 commits and `5f4b97eb` (setup roads in draft rollouts) had changed the TypeScript analysis this branch deletes, so the Rust analysis was brought to it first (`0bc01b4a`: roads per simulated pick, `TakenVertex.road`, `Recommendation.secondRoad`, the drawn second leading `plannedSecond`, a `setup_road` export behind `src/engine/setupRoad.ts`), checked bit for bit against `main`'s TypeScript on 45 fixture boards, 384 generated draft states and 6,024 setup roads. Then `main` was merged in (`2ce5dbe8`) and fast-forwarded. Every gate ran green on the merged tree: Rust tests in both profiles, 928 unit tests and the three perf files, the build, 3 production and 76 e2e Playwright tests. Not pushed. |

## Candidates, not approved

Nothing below is queued. Each needs Aki's word before it starts.

| Candidate | What is known |
| --- | --- |
| Recover the Best picks speed the roads cost | Native rankings are 30 to 36% slower than before `0bc01b4a`: 19.0, 20.6 and 74.9 ms against 13.9, 15.9 and 55.5 ms (`bench --filter analyze/`). Still far under the 300 and 1200 ms bounds. Two Codex rounds cut the repeated work (road selections 6,248 to 1,788 per six-seat opening, occupancy rebuilds 6,808 to 1,208) and stopped at reach walks along a seat's own road, which the shared reach table cannot serve: 27,058 calls, 58% served by a 32-way memo, 2,528 repeated after eviction, about 2.7 ms of a 20.6 ms call. Not tried: a larger or better-keyed walk memo, a reach table that covers own roads, bounds that skip the 15,646 extra rows. |
| Draft recap in parallel | 1,000 self-play games take 2 to 5 s in the browser, in one worker, 50 games a batch (`useDraftRecap.ts`). Games are independent, so several workers should scale almost linearly. Not profiled. |
| WebAssembly build settings | `build-wasm.sh` runs a plain release build: no `wasm-opt`, no SIMD target feature. The wasm runs a ranking about twice as slow as native. Unmeasured; SIMD can move float results, which the parity fixtures would catch. |
| Rival rankings in parallel workers | The three nested rankings of the worst six-seat case are independent. Invisible to a player at today's numbers. |
| Draft lookahead redesign | The simulator's setup phase is the count of work the lookahead does (row 4). Pays off only for another tuning programme. |
