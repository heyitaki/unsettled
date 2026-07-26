# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Unsettled: an offline, browser-only Catan starting-position analyzer (React 19 + TS + Vite). No backend — all state lives in `localStorage`. Three phases:

- **Phase 1 (done):** board editor + screenshot import.
- **Phase 2 (done):** rank the best placements for your pick(s) in a snake draft, accounting for intermediate picks (not just raw pip strength).
- **Phase 3 (paused, do not start):** boons/curses expansion scoring. Wait for the user's full boon/curse list before building. See [MEMORY.md](.claude/projects/-Users-aki-code-unsettled/memory/catan-companion-roadmap.md).

## Commands

- `npm run dev` — Vite dev server
- `npm test` — `vitest run` (single run). Watch: `npx vitest`. One file: `npx vitest run src/model/__tests__/board.test.ts`. By name: `npx vitest run -t "substring"`
- `npm run test:e2e` — Playwright (`e2e/`), which starts its own dev server on port 5199. Covers only what needs two real browser windows sharing one origin: the cross-document workspace sync. To check a regression test really bites, point it at a worktree of an older commit — `UNSETTLED_E2E_PORT=5201 UNSETTLED_E2E_ROOT=<worktree> npm run test:e2e`
- `npm run typecheck` — `tsc -b` (strict; no `any`)
- `npm run lint` — `oxlint`
- `npm run build` — typecheck + Vite build

## Architecture

Data flows **`parser/` → `model/Board` → `engine/` + `ui/store` → `persistence/`**. The `Board` interface (`model/types.ts`) is the single source of truth passed between all layers. A `Game` (`model/game.ts`) wraps a `Board` with the per-player state that cannot be derived from the pieces (hands, dev cards, knights, VP cards); tabs, the library, and import/export all persist whole games, and `parseGame` still accepts a bare legacy `Board`.

- **`model/`** — pure geometry + board logic, no React. `coords.ts` is the foundation: axial `{q,r}` hex coords; `VertexId`/`EdgeId` are deterministic strings built from **sorted** member coords (`v:q,r;q,r;q,r`), so any corner/edge has one canonical id regardless of which hex references it. `layouts.ts` defines the `standard4`/`extension6` grids and default port edges. `serialization.ts` validates untrusted board JSON with exact-key structural checks; `board.ts` builds/validates boards.
- **`engine/`** — pure placement analysis, no React: draft-state inference from building counts, legality, weighted valuation with per-factor breakdowns, seeded opponent rollouts (`analyzeBoard`). Phase-3 boons/curses plug in via `PlacementModifier`.
- **`parser/`** — offline screenshot → `Game`, dispatched by confidence through `sources/registry.ts`. `sources/types.ts` owns the `ScreenshotSource` template pipeline; shared `registration`/`tiles`/`tokens`/`ports`/`pieces` modules parse board content, while each source supplies detection, palette, roster geometry, stats, and name rectangles. `sources/settled/` contains the Settled iOS palette, chips, and binary counter/name templates. OCR (`textReader`, Tesseract) remains an optional layer for player names only; synchronous parsing is pure pixel analysis and emits `ParseIssue[]` rather than throwing.
- **`ui/`** — `store.ts` is a `useReducer` context holding multiple `TabState`s (each an independent game with its own `past`/`future` undo stacks over whole `Game`s) + the active `Tool`. Board edits dispatch `commit` with the next `Board` and the reducer wraps it via `withBoard`; stat edits dispatch `commit-game`. Panels: `ToolPalette`, `ImportPanel`, `BoardCanvas`, `BoardTabs`, `PlayerPanel`, `MapsPanel`, plus the shared `MenuSelect` dropdown, `ContextMenu` (the pointer-pinned menu behind the tab strip's right-click, whose chords all come from `shortcuts.ts` so a printed shortcut and a listened-for one cannot drift) and `glyphs.tsx`, the one home for inline SVG icons — piece silhouettes there must stay identical to the ones `BoardCanvas` draws.
- **`persistence/localStorage.ts`** — saves the whole workspace (`WORKSPACE_KEY`) and named maps (`MAPS_KEY`); corrupt blobs are preserved under `*.corrupt` keys instead of being discarded.
- **`simulator/`** — separate Rust workspace (outside the Vite build and `npm test`) that self-plays games to measure which starting placements win, including the paired `evaluate` harness for hero-rotation comparisons. `crates/engine` is pure rules + policies with no threading, CLI, or filesystem deps, kept wasm-portable for future in-app mid-game recommendations; `belief.rs` tracks public-information resource intervals and `etw.rs` is the pinned closed-form reference whose constants are never swept. `crates/cli` owns rayon, board generation, aggregation. Reads the app's exported Board JSON via topology packs generated from `src/model` by `tools/generate-topology.ts` — never hand-edit `simulator/topology/*.json`. `placement/app_formula.rs` is a Rust port of the app's own `engine/valuation.ts` scorer, run as `--heuristics app_formula:<weights.json>`; the two are held together by `fixtures/placement-parity.json`, generated by `tools/generate-placement-parity.ts` and asserted component by component. Change either scorer and you must regenerate and re-verify that fixture, because a silent divergence still produces plausible numbers. See `simulator/README.md`.

## Conventions

- Tesseract is self-hosted in `public/tesseract` + `public/tessdata` (offline). Don't switch to a CDN.
- Simulator changes run `cargo test` in BOTH profiles from `simulator/`: release compiles out `debug_assert!(invariants_hold)`, the only detector for a class of piece/VP accounting bugs. Determinism is a product guarantee — same seed, byte-identical `results.json` at any `--threads`, so never let `HashMap` iteration or float accumulation order reach an output.
- Simulator seed domains are spend-once: screen freely on `tuning`, spend `eval` only on a settled candidate, and `gate` only on a final adoption decision. Don't spend `eval` or `gate` on weight adoption until the engine's strategic capability is settled — results measured against today's self-regarding policies won't survive a threat-aware field. See the phase order in `simulator/README.md`.
- Parser correctness is guarded by fixture snapshots: `fixtures/*.png` → `src/parser/__tests__/expected/*.json`. Regenerating expected output means re-verifying it by hand.
- Cross-window sync (`ui/workspaceSync.ts`) is timing-sensitive, so a test for it is worthless until it has been shown to fail against the code it was written for. Two paces matter: a close pace under the 500ms autosave debounce coalesces into one write and races nothing, and a second window that is merely open — rather than also being written in — never answers mid-sequence. Both make a green run meaningless.
- `.claude/worktrees` holds full repo copies; `vite.config.ts` excludes it from vitest so tests don't double-run.
