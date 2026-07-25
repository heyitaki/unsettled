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
- `npm run typecheck` — `tsc -b` (strict; no `any`)
- `npm run lint` — `oxlint`
- `npm run build` — typecheck + Vite build

## Architecture

Data flows **`parser/` → `model/Board` → `engine/` + `ui/store` → `persistence/`**. The `Board` interface (`model/types.ts`) is the single source of truth passed between all layers. A `Game` (`model/game.ts`) wraps a `Board` with the per-player state that cannot be derived from the pieces (hands, dev cards, knights, VP cards); tabs, the library, and import/export all persist whole games, and `parseGame` still accepts a bare legacy `Board`.

- **`model/`** — pure geometry + board logic, no React. `coords.ts` is the foundation: axial `{q,r}` hex coords; `VertexId`/`EdgeId` are deterministic strings built from **sorted** member coords (`v:q,r;q,r;q,r`), so any corner/edge has one canonical id regardless of which hex references it. `layouts.ts` defines the `standard4`/`extension6` grids and default port edges. `serialization.ts` validates untrusted board JSON with exact-key structural checks; `board.ts` builds/validates boards.
- **`engine/`** — pure placement analysis, no React: draft-state inference from building counts, legality, weighted valuation with per-factor breakdowns, seeded opponent rollouts (`analyzeBoard`). Phase-3 boons/curses plug in via `PlacementModifier`.
- **`parser/`** — offline screenshot → `Game`, dispatched by confidence through `sources/registry.ts`. `sources/types.ts` owns the `ScreenshotSource` template pipeline; shared `registration`/`tiles`/`tokens`/`ports`/`pieces` modules parse board content, while each source supplies detection, palette, roster geometry, stats, and name rectangles. `sources/settled/` contains the Settled iOS palette, chips, and binary counter/name templates. OCR (`textReader`, Tesseract) remains an optional layer for player names only; synchronous parsing is pure pixel analysis and emits `ParseIssue[]` rather than throwing.
- **`ui/`** — `store.ts` is a `useReducer` context holding multiple `TabState`s (each an independent game with its own `past`/`future` undo stacks over whole `Game`s) + the active `Tool`. Board edits dispatch `commit` with the next `Board` and the reducer wraps it via `withBoard`; stat edits dispatch `commit-game`. Panels: `ToolPalette`, `ImportPanel`, `BoardCanvas`, `BoardTabs`, `PlayerPanel`, `MapsPanel`, plus the shared `MenuSelect` dropdown and `glyphs.tsx`, the one home for inline SVG icons — piece silhouettes there must stay identical to the ones `BoardCanvas` draws.
- **`persistence/localStorage.ts`** — saves the whole workspace (`WORKSPACE_KEY`) and named maps (`MAPS_KEY`); corrupt blobs are preserved under `*.corrupt` keys instead of being discarded.

## Conventions

- Tesseract is self-hosted in `public/tesseract` + `public/tessdata` (offline). Don't switch to a CDN.
- Parser correctness is guarded by fixture snapshots: `fixtures/*.png` → `src/parser/__tests__/expected/*.json`. Regenerating expected output means re-verifying it by hand.
- `.claude/worktrees` holds full repo copies; `vite.config.ts` excludes it from vitest so tests don't double-run.
