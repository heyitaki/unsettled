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
| 3 | Best picks in Rust and WebAssembly: a Rust twin of `analyze.ts` (sampled rollouts, nested rival rankings, statuses) behind the existing worker, gated on matching today's rankings before any TypeScript goes. Decided 2026-10-10; `stats.ts`, `legality.ts` and `draft.ts` stay TypeScript. | Blocked on the unattended `/ralphex` loop: run dir `.claude/ralphex/best-picks-wasm/` in the main checkout (spec, 20-task plan, progress), branch `ralphex-best-picks-wasm` cut from this one. Do not work this row by hand while the loop lives (`kill -0 "$(cat <rundir>/pid)"`). The honest expectation is tens to hundreds of milliseconds, not microseconds: one ranking is thousands of scored placements. |
| 4 | Whole games: sample a profile at the head of this branch and pick targets. M-89 lists what it left: occupancy masks carried across the replay (about 2%), setup road sites from the reach table (about 4%), the proposer's win-distance inputs computed twice in a trade response, `denial::contest_term` (4.6% at four seats). | Not started. |
