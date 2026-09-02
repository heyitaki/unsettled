# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Unsettled: an offline, browser-only Catan starting-position analyzer (React 19 + TS + Vite). No backend — all state lives in `localStorage`. Three phases:

- **Phase 1 (done):** board editor + screenshot import.
- **Phase 2 (done):** rank the best placements for your pick(s) in a snake draft, accounting for intermediate picks (not just raw pip strength).
- **Phase 3 (paused, do not start):** boons/curses expansion scoring. Wait for the user's full boon/curse list before building. See the `catan-companion-roadmap` project memory note, which lives outside the repo.

## Commands

- `npm run dev` — Vite dev server
- `npm test` — `vitest run` (single run). Watch: `npx vitest`. One file: `npx vitest run src/model/__tests__/board.test.ts`. By name: `npx vitest run -t "substring"`
- `npm run test:e2e` — Playwright (`e2e/`), which starts its own dev server on port 5199. `workspaceSync.spec.ts` covers the cross-document sync (needs two real windows on one origin); `phoneShell.spec.ts` drives the portrait shell under phone emulation and drops a full-page screenshot per test into `test-results/phone/` for visual review; `shellArms.spec.ts` checks desktop and landscape still mount `Workspace`. Phone tests use the `test.use` block at the top of `phoneShell.spec.ts`; never spread a `devices[...]` preset, which selects WebKit (not installed). To check a regression test really bites, point it at a worktree of an older commit: `UNSETTLED_E2E_PORT=5201 UNSETTLED_E2E_ROOT=<worktree> npm run test:e2e`
- `npm run typecheck` — `tsc -b` (strict; no `any`)
- `npm run lint` — `oxlint`
- `npm run build` — typecheck + Vite build

## Architecture

Data flows **`parser/` → `model/Board` → `engine/` + `ui/store` → `persistence/`**. The `Board` interface (`model/types.ts`) is the single source of truth passed between all layers. A `Game` (`model/game.ts`) wraps a `Board` with the per-player state that cannot be derived from the pieces (hands, dev cards, knights, VP cards); tabs, the library, and import/export all persist whole games, and `parseGame` still accepts a bare legacy `Board`.

- **`model/`** — pure geometry + board logic, no React. `coords.ts` is the foundation: axial `{q,r}` hex coords; `VertexId`/`EdgeId` are deterministic strings built from **sorted** member coords (`v:q,r;q,r;q,r`), so any corner/edge has one canonical id regardless of which hex references it. `layouts.ts` defines the `standard4`/`extension6` grids and default port edges. `serialization.ts` validates untrusted board JSON with exact-key structural checks; `board.ts` builds/validates boards.
- **`engine/`** — pure placement analysis, no React: draft-state inference from building counts, legality, weighted valuation with per-factor breakdowns, seeded opponent rollouts (`analyzeBoard`). Scoring also takes the board's occupancy (blocked vertices plus road owners, for `expansion.ts`'s walk) and the picking seat's draft slot. Phase-3 boons/curses plug in via `PlacementModifier`.
- **`parser/`** — offline screenshot → `Game`, dispatched by confidence through `sources/registry.ts`. `sources/types.ts` owns the `ScreenshotSource` template pipeline; shared `registration`/`tiles`/`tokens`/`ports`/`pieces` modules parse board content, while each source supplies detection, palette, roster geometry, stats, and name rectangles. `sources/settled/` contains the Settled iOS palette, chips, and binary counter/name templates. OCR (`textReader`, Tesseract) remains an optional layer for player names only; synchronous parsing is pure pixel analysis and emits `ParseIssue[]` rather than throwing.
- **`ui/`** — `store.ts` is a `useReducer` context holding multiple `TabState`s (each an independent game with its own `past`/`future` undo stacks over whole `Game`s) + the active `Tool`. Board edits dispatch `commit` with the next `Board` and the reducer wraps it via `withBoard`; stat edits dispatch `commit-game`. Panels: `ToolPalette`, `ImportPanel`, `BoardCanvas`, `BoardTabs`, `PlayerPanel`, `MapsPanel`, plus the shared `MenuSelect` dropdown, `ContextMenu` (the pinned menu behind the tab strip's right-click and the phone's dots menus, whose chords all come from `shortcuts.ts` so a printed shortcut and a listened-for one cannot drift) and `glyphs.tsx`, the one home for inline SVG icons; piece silhouettes there must stay identical to the ones `BoardCanvas` draws. On a portrait phone `App` mounts `phone/PhoneShell` (its own tree over the same store, gated by `usePortraitPhone`) instead of `Workspace`: one fixed header over a scrolling page, with `phone/MapsScreen` and `phone/PlayersScreen` as full-screen overlays that share their logic with the desktop panels through hooks (`useLibrary`, `useRenameTab`, `useJsonFiles`, `useRowReorder`). It is built to [`.claude/specs/mobile/spec.md`](.claude/specs/mobile/spec.md), so read that before touching `src/ui/phone/`, the `max-width: 760px` arms of `editor.css` or `MobileNav`.
- **`persistence/localStorage.ts`** — saves the whole workspace (`WORKSPACE_KEY`) and named maps (`MAPS_KEY`); corrupt blobs are preserved under `*.corrupt` keys instead of being discarded. Boards autosave into the library: `ui/libraryAutosave.ts` writes an edited tab into its map after a 500ms debounce and links an unlinked tab to a new map on its first non-blank edit, so there is no save button, dirty marker or close prompt anywhere.
- **`simulator/`** — separate Rust workspace (outside the Vite build and `npm test`) that self-plays games to measure which starting placements win. Never hand-edit `simulator/topology/*.json`. Change either placement scorer and you must regenerate and re-verify `simulator/fixtures/placement-parity.json`. See [`.claude/specs/simulator/spec.md`](.claude/specs/simulator/spec.md) for the specification and [`simulator/README.md`](simulator/README.md) for how to run it.

## Conventions

- Tesseract is self-hosted in `public/tesseract` + `public/tessdata` (offline). Don't switch to a CDN.
- Simulator changes run `cargo test` in BOTH profiles from `simulator/`. Never let `HashMap` iteration or float accumulation order reach an output. Why, in [`contracts.md`](.claude/specs/simulator/contracts.md).
- Simulator seed domains are spend-once: screen freely on `tuning`. `eval` and `gate` are both spent; never run an `eval`- or `gate`-domain command. Why, the spend ledger, and the phase order, in [`programme.md`](.claude/specs/simulator/programme.md).
- A draft-aware placement arm is spelled `app_formula_draft:<hero weights>@<opponent weights>`, and its opponent path is pinned to the field's weights so an A/B moves the hero's formula alone. Why, in [`contracts.md`](.claude/specs/simulator/contracts.md).
- Parser correctness is guarded by fixture snapshots: `fixtures/*.png` → `src/parser/__tests__/expected/*.json`. Regenerating expected output means re-verifying it by hand.
- Cross-window sync (`ui/workspaceSync.ts`) is timing-sensitive, so a test for it is worthless until it has been shown to fail against the code it was written for. Two paces matter: a close pace under the 500ms autosave debounce coalesces into one write and races nothing, and a second window that is merely open — rather than also being written in — never answers mid-sequence. Both make a green run meaningless.
- `.claude/worktrees` holds full repo copies; `vite.config.ts` excludes it from vitest so tests don't double-run.
