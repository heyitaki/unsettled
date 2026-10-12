# Engine speed: every entry point in microseconds

Goal, set by Aki on 2026-10-12: bring the Catan engine into the range a chess engine works in, where one unit of work costs microseconds. Branch `engine-speed`, worktree `.claude/worktrees/engine-speed`.

A policy decision already costs 0.02 to 2.5 µs. The entry points built on top of it are what this plan moves. Baseline is `main` at `4dab4d72`, `bench` on the laptop, minimum per call.

| Entry point | Baseline, 4 seats | Baseline, 6 seats | Target |
| --- | ---: | ---: | --- |
| Adviser call, JSON in to JSON out | 155 to 170 µs | 220 to 260 µs | under 15 µs |
| Best picks in the browser (`analyzeBoard`, TypeScript) | about 1.4 s | 1.6 s, 6.3 s with three rival rankings | Rust in WebAssembly: at most 300 ms, and 1200 ms with three rival rankings |
| Whole self-play game | 2.2 ms | 6.4 ms | set after item 4's profile |

No item may change an output: `fixtures/advice-parity.json`, `fixtures/bench-hashes.json` and `fixtures/placement-parity.json` stay byte-identical unless a row says otherwise.

## Queue

| # | Item | State |
| --- | --- | --- |
| 1 | Parse each layout's topology once per process (`Topology::shared`), used by `WireBoard::validate` and `advise`. The adviser parsed the 25 to 39 KB pack twice per call. | Done. Measured 33 µs at four seats and 43 µs at six (was 160 and 225). |
| 2 | Adviser: reuse one arena and policy scratch per thread, and parse the request in one typed pass with the current path as the fallback for any input the typed pass refuses. | Done. Measured about 16 µs at four seats and 22 µs at six; the `turn` rows are 27 µs. The 15 µs target is missed by about 1 µs on four rows. What is left per call: typed parse 6 µs, `validate` 3 µs, `try_from_wire` 2.6 µs, the policy 1 to 2 µs. |
| 3 | Best picks in Rust and WebAssembly: a Rust twin of `analyze.ts` (sampled rollouts, nested rival rankings, statuses) behind the existing worker, gated on matching today's rankings before any TypeScript goes. Decided 2026-10-10; `stats.ts`, `legality.ts` and `draft.ts` stay TypeScript. | Built, not landed. The loop finished 2026-10-12 in 6h12m: 20 tasks, 25 commits on `ralphex-best-picks-wasm` (head `1fd0a4eb`), two internal review rounds and the Codex review done, and every gate re-run green by the main session on that head. Worst six-seat board in WebAssembly: 31 ms for the opening and 105 ms with three rival rankings (TypeScript took 1600 and 6330); native 14 to 16 ms and 56 ms. `analyze.ts`, `valuation.ts`, `expansion.ts`, `weights.ts` and the placement parity fixture are deleted. Waiting on Aki: the `pow` near-tie on one-player boards (the plan's Post-Completion, `.claude/ralphex/best-picks-wasm/completed/best-picks-wasm.md` in the main checkout; recommended answer is accept), then the word to land onto this branch. This branch has two docs commits the run branch lacks, so landing is a rebase of the run branch, not a fast-forward. |
| 4 | Whole games: speed up the draft, which is most of a game. Profile at `b7702265` (8 s samples of `bench --filter e2e/<layout>/single_core`; 2.21 ms and 6.53 ms per game): the placement code is 51% of a four-seat game and 67% of a six-seat one, against 18% and 9% for trade pricing with win distance, and 11% and 9% for road legality and longest road. Inside placement, by self time: `expansion::row_value` 14% and 18%, `ScoreRows::argmax_row` 9% and 13%, `draft::setup_road` 6% and 9% (M-89 left it on the walk; read the sites from the reach table), `Occupancy::new` 3% and 4% (M-89 left it rebuilt per pick; carry the masks across the replay). Start with `setup_road` and `Occupancy::new`, then look at why `row_value` and `argmax_row` still cost a quarter of a game after M-89's bound. | Built, not landed: three commits on branch `whole-game-speed` (head `9ae3abf2`, on top of row 3's `1fd0a4eb`), reviewed and every gate green. A game is 2.08 ms at four seats and 5.94 ms at six (was 2.20 and 6.53); the 10% and 15% targets were missed at 5% and 9%. A fresh profile says what is left is the count of work, not waste: about 5,100 expansion terms a four-seat game at 60 ns each and 800 row scans at under 5 ns a vertex. Going further means changing the lookahead itself; not planned. Record in M-90. Lands with row 3. |
