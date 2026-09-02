# Portrait phone shell

## Overview

Rebuild the portrait-phone UI to [`.claude/specs/mobile/spec.md`](../../.claude/specs/mobile/spec.md). Read that file in full before the first task, including its Decisions section and its B7 and B8 rows; it is the normative design and this plan never restates its rationale. Where the spec is silent, copy [`.claude/specs/mobile/prototype.html`](../../.claude/specs/mobile/prototype.html): its `<style>` block (lines 4-339) carries every size, tint and radius, and its script (lines 578-1426) carries every interaction. Read both before the first shell task.

When this run is done:

- On a portrait phone the app is one fixed header over one scrolling document: draft ribbon, board in a full-width sea frame, layout caption, then either the analysis block or the build tools. No bottom nav, no tab strip, no site header, no nested vertical scroller.
- The header's title opens a full-screen Maps overlay (import screenshot, open boards, saved maps, JSON behind a dots menu) and the player dots open a full-screen Players overlay (roster with claim-on-row, rename-on-name, hold-or-grip reorder, and the snake draft). Both slide in from the right and return the page exactly as it was.
- Boards save themselves (B7), on every screen size. The desktop tab menu's `Save to library`, the dirty dots, the save-and-close prompt and the `MapsPanel` save row are gone.
- Factor pills read one word each on every screen size.
- Desktop and landscape phone render exactly as they do on `main`.
- Every spec ledger row from M2 to M17 reads `done` (M10 stays `dropped`), the spec's `What already exists` and `Out of scope` sections are current, and `CLAUDE.md` describes the shell and the autosave.

### Standing rules for every iteration

**Two React trees, one store.** `App.tsx` mounts `PhoneShell` while `(max-width: 760px) and (orientation: portrait)` matches and today's `Workspace` otherwise (B8). `MobileNav`, `mobilePanes.ts`, the `data-pane` gating and the `.mobile-nav` CSS stay exactly as they are for the landscape arm. Never delete them and never touch the landscape block of `editor.css` (the one headed `Landscape phone keeps a fixed viewport`). Desktop-only files (`BoardTabs.tsx`, `MapsPanel.tsx`, `PlayerPanel.tsx`, `ToolPalette.tsx`, `AnalysisPanel.tsx`, `ImportPanel.tsx`) change only where a task names them, and only to share logic with the phone or to retire the save UI; their rendered desktop output is otherwise unchanged.

**Share, do not fork.** Every behaviour in the spec's `What already exists` table is reused by extracting it (a hook or a pure module) and calling it from both trees. A second copy of the reorder machinery, the rename logic, the sort, the map open path or the JSON import path is a defect.

**CSS.** All portrait work lives in the `@media (max-width: 760px) and (orientation: portrait)` arm of `src/ui/editor.css`, on new `.phone-*` class names rooted at `.phone-shell`. The shared `(max-width: 760px)` arm keeps applying to the desktop and landscape tree; when one of its rules would wrongly reach the phone shell, scope that rule to `.app-shell` rather than rewriting it. Sizes, colours and radii come from the prototype's stylesheet. No em or en dashes anywhere, no CSS comments unless a rule is genuinely non-obvious, one line per paragraph or bullet in markdown.

**Tests before code, every task.** Pure logic gets a vitest file beside the existing ones in `src/ui/__tests__/` (add `// @vitest-environment jsdom` on the first line when the DOM is needed). Everything a viewport can see gets a Playwright assertion in `e2e/phoneShell.spec.ts`, which Task 4 creates with this exact emulation block and which every later task extends:

```ts
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 })
```

That block is verified: under it `(max-width: 760px) and (orientation: portrait)` and `(pointer: coarse)` both match in the installed Chromium. Never spread `devices['iPhone …']` into `use`: it selects WebKit, which is not installed. Each e2e test starts from a fresh context (the app then opens one blank `standard4` board), and takes a full-page screenshot into `test-results/phone/<name>.png` at its end, so the human review after the run has pictures.

**Keep the tree green at every commit.** Every task ends with `npm run typecheck`, `npm run lint`, `npm test` and `npx playwright test --reporter=list`, in that order and never two of them in one parallel block. `workspaceSync.spec.ts` is timing-sensitive: a red there on a loaded machine is re-run once alone before it counts.

**Ledger.** The last checkbox of every task updates the matching row(s) of the spec ledger to `done` and commits the spec with the code.

**Give up, do not grind.** If a task's e2e assertion cannot be made to pass in two attempts because the emulation cannot express the gesture (a real touch hold, a pinch), record that in the progress output, cover the logic in vitest instead, note it in the spec ledger row, and move on. Never loosen an assertion to make it pass.

### Out of scope

Landscape phone and desktop layout. The points ledger on phones (O1). Phase 3 boons and curses. `simulator/`, `parser/`, `engine/` (except `displayedFactors` labels, which live in `ui/`). `workspaceSync.ts` and its e2e spec. Any change to persistence formats or keys. Any new dependency.

## Context

### Where things live

- `src/ui/App.tsx`: `Workspace` (the desktop and landscape tree, with `MobileNav` and the `data-pane` gating), the toast (`global-notice`, the `unsettled:notice` window event), `StoreProvider`. `PhoneShell` mounts beside `Workspace` here.
- `src/ui/useMediaQuery.ts`: `useMediaQuery` (not exported) and `useCoarsePointer`. Export `usePortraitPhone` from here.
- `src/ui/store.ts`: `TabState` (`id`, `title`, `game`, `past`, `future`, `activePlayerId`, `mapId`), `StoreAction` (`commit`, `commit-game`, `undo`, `redo`, `tool`, `active-player`, `highlight`, `notice`, `tab-add`, `tab-select`, `tab-rename`, `tab-close`, `tab-link`, `maps-changed`, `workspace-adopt`), `reducer`, `activeTab`, `HighlightMark` (`ref`, `color?`, `label?`). `StoreProvider` owns the workspace autosave through `createWorkspaceSync`; the library autosave sits beside it.
- `src/ui/boardFiles.ts`: `saveTab` (no-prompt save: writes back into the tab's own map or adds a fresh entry under a free name), `tabIsDirty` (for an unlinked tab, "differs from a blank board of its layout"), `dirtyTabIds`, `inPlaceTarget`, `firstFreeName`, `copyTitle`, `loadedNotice`, `downloadBoard`. Tests in `src/ui/__tests__/boardFiles.test.ts` and `saveTab.test.ts`.
- `src/persistence/localStorage.ts`: `saveMap`, `updateMap`, `renameMap`, `deleteMap`, `loadMap`, `listMaps`, `markMapOpened`, `readLibrary`, `takenMapNames`, `migrateMapIds`.
- `src/ui/BoardTabs.tsx`: `commitEdit` (the rename rule: `renameMap` when linked, tolerate a map deleted elsewhere, then `tab-rename`), `dirty`, `requestClose`/`saveAndClose`/`closing`, `saveToLibrary`, `duplicate`, `rename`, `menuItems`. Extract the rename rule into a hook the phone reuses.
- `src/ui/MapsPanel.tsx`: `SORT_MENU_LABEL`/`SORT_OPTIONS`, `relativeTime`, `addressable`, `openMap`, the save row (`name`, `typed`, `submitSave`, `performSave`, `dupPrompt`). Extract sort, `relativeTime`, `addressable`, `openMap` and delete into a hook or module the phone reuses.
- `src/ui/ImportPanel.tsx`: the `Import screenshot` button opening `ImportDialog`, the hidden JSON `<input type=file>` and its parse-then-`tab-add` handler, `Export JSON` via `downloadBoard(title, serializeGame(game))`. Extract the JSON import and export into a hook.
- `src/ui/PlayerPanel.tsx`: rename (`renamingId`, `player-name-input`), the reorder machinery (HTML5 drag for fine pointers; for coarse pointers the hold with `HOLD_MS`=380 and `HOLD_SLOP`=8, `aimDrag`, the non-passive `touchmove` swallow, edge scrolling through `rowDrag.ts`, the mid-drag trash row, the `draggedRef` click swallow), the slot/prediction derivation (`placedByPlayer`, `slotVertex`, `predicted`, lines 189-228), the `draft-strip`. Extract the reorder into a hook and the slot derivation into a pure module.
- `src/ui/AnalysisPanel.tsx`: `displayedFactors`, `vertexDescription`, `recommendationMarks`, the `MenuSelect` claim picker (`setMe`), the coarse-pointer card with `Place settlement`/`Clear`, `emptyMessage` by `analysis.status` (`no-me`, `no-availability`, `no-production`, `complete`, `me-done`).
- `src/ui/ToolPalette.tsx`: `TILES`, `TOKENS`, `STRUCTURES`, `keyOf`, `selectTool`, the three tool groups, and the heading's randomize/clear/undo/redo buttons.
- `src/ui/BoardCanvas.tsx`: the fitted `viewBox` (line 202, hexes plus port bubbles plus placed buildings, which is the content bound S3 needs), the sea `<rect>` with `SEA_RADIUS`, the `board-status` line (layout `MenuSelect` with `LAYOUT_OPTIONS`, `choose`, `pendingLayout` confirm, terrain and pieces counts, `board-zoom`), the highlight rendering at line 690 (`vertex-highlight`, `vertex-highlight-label`, `mark.color`).
- `src/ui/ContextMenu.tsx`: `ContextMenuItem` (`label`, `onClick`, `shortcut?`, `shortcutKeys?`, `disabled?`, `separated?`), `ContextMenu({ ariaLabel, x, y, items, onClose })`, positioned at a point and clamped to the viewport. The header dots menus reuse it, anchored to the button's rect; add `danger?: boolean` to the item for `Clear board`.
- `src/ui/MenuSelect.tsx`: the dropdown behind the layout caption, the claim picker and the sort control.
- `src/ui/glyphs.tsx`: the one home for inline SVG icons; the pencil, chevron, three-dot, grip, trash, photo and x-mark glyphs from the prototype go here.
- `src/ui/colors.ts`: `readableInk`. `boardColor.ts` sits beside it.
- `src/model/board.ts`: `draftOrder(board, rounds)` reads `board.players` in order, so B3 already holds at the model level; `movePlayer`, `setMe`, `addPlayer`, `removePlayer`, `renamePlayer`, `randomizeBoard`, `clearBoard`, `setLayout`. `src/engine/analyze.ts`: `analyzeBoardCached(board)` recomputes on board identity, so a committed reorder re-runs the analysis with no further wiring.
- `src/ui/__tests__/store.test.ts` shows how to build a `StoreState` and drive `reducer` directly; `saveTab.test.ts` shows the jsdom localStorage setup.
- `e2e/workspaceSync.spec.ts` and `playwright.config.ts`: `baseURL` is `http://localhost:5199/unsettled/`, `page.goto('')` opens the app, the dev server starts itself, one worker.

### Defaults this plan fixes, which the spec left open

- **The scroller is the window.** The portrait page scrolls the document, as the layout contract says; the prototype's nested `#doc` scroller is not copied. B2 therefore sets `document.documentElement.scrollTop = 0` under a portrait-arm `html { scroll-behavior: smooth }`, with `@media (prefers-reduced-motion: reduce)` turning it to `auto`. The fixed header's height, plus `env(safe-area-inset-top)`, is the page's top padding.
- **Ribbon slots are tappable.** Tapping a ribbon circle highlights that pick's placed or predicted vertex exactly as today's coarse-pointer `draft-strip` does (existing behaviour, kept). The Players screen's snake grid is static.
- **Overlays close on selection.** Tapping an open-board row or a saved-map row selects or opens that board and closes the Maps overlay. Import screenshot, Import JSON and New board also close it once they have acted. Rename, close ×, delete and sort keep it open.
- **Build mode ends as Done** when the active tab changes, an import lands, or the layout is switched; the tool resets to `{ kind: 'none' }` on either exit. Cancel dispatches `commit-game` with the entry snapshot only when the game has changed, so a no-op cancel adds no undo entry.
- **No-me state on the phone** copies the prototype's `renderPicks` branch: heading unchanged, a hint line, and a row of swatch buttons (one per player) that claim on tap. Desktop keeps its text.
- **Phone context line** is exactly `You are <picker> · picking X and Y of N`; the desktop's `· pick N of M, whose turn` tail is replaced by the `Your turn` pill.
- **Marks with nothing selected** are every recommendation's first pick, labelled by rank, in the claimed colour, ranks four and up faded; with a card selected, that card's first pick solid and its planned second faded. `HighlightMark` gains `faded?: boolean`; `BoardCanvas` draws it at reduced opacity. Desktop hover marks are unchanged.
- **Removing a player on the phone** keeps today's drag-onto-trash row, which exists only mid-drag.
- **Sort on the Maps screen** is the existing four-key `MenuSelect`, not the prototype's cycling button (spec wins over prototype).
- **Autosave debounce** is 500ms per tab, coalescing edits; a pending save flushes on `pagehide`. Only `commit`, `commit-game`, `undo` and `redo` dispatched in this document mark a tab as needing a save; `workspace-adopt` and `maps-changed` never do. A save that fails surfaces through the toast once and is retried on the next edit.
- **Screenshots** go to `test-results/phone/` (already gitignored) as `<test-name>.png` full-page captures.

### Traps

- The zsh shell here: quote glob-bearing flags, and never use a bare `==` or `===` separator in a compound command.
- `npm test` takes about 15 seconds; the Playwright run about 10 seconds plus dev-server start. Both are fine at the end of a task; never run them in the same parallel block.
- Port 5199 is the e2e dev server's. If something else holds it the run reuses that server and tests stale code; check `lsof -nP -i :5199` when an e2e result contradicts the source.
- `BoardCanvas` is shared by both trees. A phone-only change there rides a CSS variable or a class on the portrait arm, never a media query in React.
- `useMediaQuery`'s server snapshot is `false`, so `PhoneShell` never renders in a non-browser environment; vitest tests for phone logic import pure modules, not the shell.
- `saveTab` links an unlinked tab under the first free name, which may be `title (1)` when the title collides with a saved map; the `tab-link` it produces retitles the tab. That is intended.
- `renameMap` on a map deleted in another window fails; `BoardTabs.commitEdit` already tolerates that case and the extracted hook must keep the tolerance.
- The `analysis-list` desktop path uses hover; every phone path must work from `onClick` alone.

## Validation Commands

Run from the repo root, each on its own, in this order.

- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npx playwright test --reporter=list`

`npm run build` runs once, in the final task.

### Task 1: One-word factor labels and the board colour hash

- [x] In `src/ui/AnalysisPanel.tsx` `displayedFactors`, rename `Diversity+recipes+numbers` to `Balance` and `Starting cards` to `Hand`; the other four labels stay.
- [x] Add `src/ui/boardColor.ts` exporting `BOARD_PALETTE` (the prototype's ten `MAP_COLORS`, line 679, in that order) and `boardColor(name: string): string`, the prototype's hash (`h = (h * 31 + charCode) >>> 0`, then `h % BOARD_PALETTE.length`).
- [x] Add `src/ui/__tests__/boardColor.test.ts`: same name gives the same colour; the palette has ten distinct entries; `boardColor` of an empty string is `BOARD_PALETTE[0]`; two fixed names that hash to different indices give different colours.
- [x] Ledger: M14 done; M4 half done (module), noted as such.

### Task 2: Library autosave in the store (B7, M16)

- [x] Add `src/ui/__tests__/libraryAutosave.test.ts` (jsdom, fake timers) covering: a blank new tab is never written to the library; the first tile placement on an unlinked tab, after 500ms, creates exactly one map named after the tab title and links the tab (`mapId` set); two edits 100ms apart produce one write; an edit to a linked tab updates the same map id and never adds a second entry; `undo` writes; a `workspace-adopt` carrying a foreign game writes nothing; a `pagehide` event flushes a pending save immediately.
- [x] Implement `src/ui/libraryAutosave.ts` (a hook or a factory driven from `StoreProvider` in `store.ts`, whichever keeps the store's existing `createWorkspaceSync` wiring untouched) using `saveTab` from `boardFiles.ts`, dispatching `tab-link` when the id is new to the tab and `maps-changed` with `readLibrary()` after every write. Track "needs a save" per tab id by the game identity last saved or adopted, so cross-window adoption never causes a write.
- [x] Surface a failed save through the `notice` action once per failure, not once per keystroke.
- [x] Ledger: M16 done.

### Task 3: Retire the explicit save UI (M17)

- [x] `BoardTabs.tsx`: remove the `Save to library` menu item, the `board-tab-dirty` dot, `dirty`/`dirtyTabs`, `closing`, `requestClose`, `saveAndClose` and their `ConfirmDialog`; a close closes. Remove the `save` chord from `shortcuts.ts` and its printed shortcut, and update `shortcuts.test.ts` if it lists it.
- [x] `MapsPanel.tsx`: remove the name field, the `Save to library` button, `typed`, `submitSave`, `performSave`, `dupPrompt` and its `ConfirmDialog`; the empty-state copy becomes `No saved maps yet. Boards save themselves as you edit them.`
- [x] Delete `dirtyTabIds` and any other helper in `boardFiles.ts` that is now unreferenced, with its tests; `tabIsDirty`, `inPlaceTarget`, `firstFreeName`, `nextCopyName` and `copyTitle` stay while `saveTab`, the autosave blank guard and `duplicate` use them. Delete the `.map-save-row` and `.board-tab-dirty` CSS.
- [x] `CLAUDE.md`: the `persistence/localStorage.ts` bullet says boards autosave into the library and names `ui/libraryAutosave.ts`.
- [x] Update the spec's `What already exists` table: the save row entry is gone; add the rename rule and the autosave as rows.
- [x] Ledger: M17 done.

### Task 4: PhoneShell skeleton, header, toast, e2e harness (B8, M2, M3, S1, S9)

- [x] Export `usePortraitPhone` from `useMediaQuery.ts` for `(max-width: 760px) and (orientation: portrait)`.
- [x] Lift the toast out of `Workspace` into a `GlobalNotice` component in `App.tsx` that both trees render (landed in its own `GlobalNotice.tsx`: `PhoneShell` imports it, and importing it from `App.tsx` would be a cycle); `App` renders `PhoneShell` when `usePortraitPhone()` is true and `Workspace` otherwise.
- [x] Add `src/ui/phone/PhoneShell.tsx` and `src/ui/phone/PhoneHeader.tsx`. Header per S1: title button (`boardColor` hex glyph, tab title, chevron; `aria-haspopup="dialog"`; opens the Maps overlay, which until Task 9 is state only), dot cluster (one dot per player in roster order, the `mePlayerId` dot ringed, `aria-label="Players"`), pencil (`aria-pressed` bound to shell `mode`), dots button opening a `ContextMenu` anchored at the button's bottom-right with items `Undo`, `Redo` (disabled off `past`/`future`), then separated `Randomize board`, `Export JSON`, `Clear board` (`danger`). Add `danger?: boolean` to `ContextMenuItem` and its style. Undo prints as `Undo`, no count.
- [x] Page below the header: `BoardCanvas` then `AnalysisPanel` (unchanged for now), inside `.phone-page`. Nothing mounts `BoardTabs`, `MobileNav`, the site header or the footer.
- [x] CSS in the portrait arm: `.phone-shell` root with `--gutter`; `.phone-head` fixed, opaque `var(--paper-light)` ground, safe-area top padding, sizes from the prototype's `.app-head`; `.phone-page` top padding equal to the header's height; `.global-notice` inside `.phone-shell` sits at the bottom above `env(safe-area-inset-bottom)`; scope any shared-arm rule that reaches the shell (`.app-shell` padding-bottom, the `.global-notice` nav offset) to `.app-shell` (done with `:where(.app-shell)`, so the landscape block's lower-specificity override of the same rule still wins there).
- [x] Create `e2e/phoneShell.spec.ts` with the emulation block from the standing rules and a `snap(page, name)` helper writing `test-results/phone/<name>.png`. Tests: the header shows the active tab's title in a button; `.mobile-nav`, `.board-tabs`, `.site-header` and `footer` have count 0; the dots menu opens and lists exactly `Undo`, `Redo`, `Randomize board`, `Export JSON`, `Clear board`, with `Undo` disabled on a fresh board; no descendant of `.phone-page` has computed `overflow-y` of `auto` or `scroll` with `scrollHeight > clientHeight`; `document.documentElement.scrollWidth` equals the viewport width.
- [x] Ledger: M2, M3 done; M4 done (header hex).

### Task 5: Draft ribbon, board frame, layout caption (S2, S3, S4, M5, M6)

- [x] Add `src/ui/draftSlots.ts`: `draftSlots(board, analysis)` returning, per slot, `{ playerId, placed: boolean, vertex: VertexId | undefined, mine: boolean, current: boolean }`, moved verbatim from `PlayerPanel.tsx` lines 189-228; `PlayerPanel` calls it. Add `src/ui/__tests__/draftSlots.test.ts`: on a blank four-player board every slot is unplaced, `current` is slot 0, `mine` marks exactly the claimed player's two slots; after one placed settlement slot 0 is placed with that vertex and `current` is slot 1.
- [x] Add `src/ui/phone/PhoneRibbon.tsx`: one circle per slot tinted to the player (`readableInk` for the number), taken solid, later faded, current ringed, own picks with a dot beneath clear of the ring; tap highlights the slot's vertex as the coarse `draft-strip` path does. Sizes from the prototype's `.ribbon`/`.rslot`.
- [x] `BoardCanvas.tsx`: set `--board-aspect: <viewBox.width / viewBox.height>` as an inline style on `.board-stage`. Portrait arm: `.phone-shell .board-stage { aspect-ratio: min(1, var(--board-aspect)); width: 100%; margin-inline: var(--gutter); background: sea; border-radius }`, the SVG filling it, no `max-height`, its own sea `<rect>` hidden in this arm so the frame is the sea. (Landed with the frame on `.board-canvas`, the SVG itself, which inherits the variable: `.board-stage` also holds the layout caption, so it cannot be the square box, and padding on the SVG would skew `clientToUnits`.)
- [x] Portrait arm: hide the terrain and pieces `<span>`s of `.board-status`; the layout `MenuSelect` is centred, 11px, with no hover or press state; `.board-zoom` keeps working.
- [x] e2e: the ribbon has `2 × players` circles and the current-pick class on the first; `.board-canvas` (the frame, see above) is square within 1px on a fresh board; the ribbon's top edge is unchanged after the layout menu switches to `5–6 player` (no confirm on a blank board) and the frame is then taller than wide; the caption contains no `terrain` or `pieces` text.
- [x] Ledger: M5, M6 done.

### Task 6: Analysis block on the phone, empty state, claim row (S5 heading and cards, B5, M12)

- [x] `AnalysisPanel.tsx` gains a `variant: 'desktop' | 'phone'` prop (default desktop) or a `PhoneAnalysis` sibling reusing its exported pieces; desktop output is byte-identical to before. Phone: `Draft analysis` / `Best picks` heading with a `Your turn` pill when `analysis.draft.currentPlayerId === board.mePlayerId`; the context line default above; the coarse-pointer cards (with their `Place settlement`/`Clear` actions) styled from the prototype's `.pick*` rules; the no-me claim row default above.
- [x] Empty board (`board.hexes.every((hex) => hex.tile === null)`): the block is replaced by heading `Nothing to rank yet` / `This board is empty`, the prototype's hint line, `Import screenshot` (filled, opens `ImportDialog`) and `Build it by hand` (outline, calls the shell's `enterBuild`). A partly-filled board keeps `no-production`.
- [x] e2e: a fresh board shows `This board is empty` and both buttons; `Build it by hand` sets the pencil's `aria-pressed` to `true` (pencil off again afterwards); `Randomize board` from the dots menu replaces the empty state with the claim row; tapping the first swatch makes the context line start with `You are` and the header's first dot ringed. (A fresh board boots with one player already claimed, so the claim-row test first seeds the stored workspace with a four-player unclaimed roster from a `page.addInitScript`, after the store's pagehide flush; the seed resets the game's `stats` and the tab's `activePlayerId`, which otherwise name the removed player and make the loader reject the blob as corrupt.)
- [x] Ledger: M12 done.

### Task 7: Marks in the claimed colour and reveal-on-select (S5 marks, B2, M13)

- [ ] `HighlightMark` gains `faded?: boolean`; `BoardCanvas` renders faded marks with a `faded` class at reduced opacity. Phone analysis: the nothing-selected marks and the selected-card marks per the defaults above, in `myColor`. Desktop hover marks unchanged.
- [ ] Add `src/ui/revealBoard.ts`: `shouldRevealBoard(boardBottom: number, headerBottom: number, slack = 120): boolean` (true when the board's bottom edge is above `headerBottom + slack`) and `revealBoard()` setting `document.documentElement.scrollTop = 0`. Test the predicate in `src/ui/__tests__/revealBoard.test.ts`. Portrait arm: `html { scroll-behavior: smooth }` with the reduced-motion override.
- [ ] Selecting a card calls `revealBoard()` only when the predicate says so.
- [ ] e2e (with `page.emulateMedia({ reducedMotion: 'reduce' })`): with a randomized board and a claimed player, five `vertex-highlight` marks exist before any tap and two carry the faded class; after scrolling the window by 2000px, tapping the last card returns `window.scrollY` to 0; tapping a card while the board is in view leaves `scrollY` unchanged.
- [ ] Ledger: M13 done.

### Task 8: Build mode with the snapshot Cancel (S6, B1, M11)

- [ ] Extract the three tool groups of `ToolPalette.tsx` into a `ToolGroups` component (same file or `phone/`-neutral location) used by `ToolPalette` (unchanged output) and by the phone build block.
- [ ] Shell state `mode: 'analyze' | 'build'` with `snapshot: Game | null`. Entering build stores `activeTab(state).game`; the tools block replaces the analysis block in the same slot; terrain, number-token and structure rows scroll sideways (`overflow-x: auto`, the only horizontal scrollers); `Done` and `Cancel` sit in a footer strip on its own tint per the prototype's `.block-actions`. Cancel dispatches `commit-game` with the snapshot when the game changed. Both exit and reset the tool. The exits-as-Done default above applies.
- [ ] e2e: pencil on, the tools block is visible, the analysis block is not, and the board's top edge is at the same `y` as before; `Randomize board` from the dots, then `Cancel`, brings back `This board is empty` and pencil off; the same with `Done` keeps the tiles (claim row visible) and `Undo` becomes enabled.
- [ ] Ledger: M11 done.

### Task 9: Maps overlay (S7, O2, O3, M7)

- [ ] Extract from `BoardTabs.tsx` a `useRenameTab()` hook returning `renameTab(tab, next): string | null` with `commitEdit`'s rule; `BoardTabs` calls it. Extract from `MapsPanel.tsx` a `useLibrary()` hook (or `src/ui/library.ts` plus a hook) exposing `sortedMaps(sortKey)`, `SORT_OPTIONS`, `SORT_MENU_LABEL`, `relativeTime`, `openMap`, `deleteMap` with the `addressable` retry, and `renameSavedMap(map, next)` (`renameMap` then `maps-changed`); `MapsPanel` calls it. Extract from `ImportPanel.tsx` a `useJsonFiles()` hook exposing `importJson()` (the file input) and `exportJson()`; `ImportPanel` calls it.
- [ ] Add `src/ui/phone/PhoneOverlay.tsx`: fixed full-screen `role="dialog"` with `aria-modal`, header (back chevron, left-aligned title, optional dots button that keeps its slot invisibly when absent), slides in from the right per the prototype's `.overlay` rules, closes on the back button and Escape, and leaves the window scroll position alone.
- [ ] Add `src/ui/phone/MapsScreen.tsx` per S7, with the row structure shared by both lists: hex, name (rename target bounded to its own width, dotted underline, Enter commits, Escape reverts, blur commits), meta (saved maps only), trailing button (× for open boards, trash for saved maps). Open-boards rows: active row accent border and white ground; tap selects and closes the overlay; × closes the tab. `New board` dashed. Saved maps: label with count and the sort `MenuSelect` on the right; tap opens (`openMap`) and closes the overlay; trash deletes. Dots menu: `Import JSON`, `Export JSON`.
- [ ] Rename input geometry: width from the text (`size` grows with typing), floor around 30px, so the row around it still selects.
- [ ] e2e: the title button opens the overlay with `Maps`; `New board` makes two open-board rows and the header title changes; tapping the first row selects it and closes the overlay; renaming the active row via its name updates the header title; after `Randomize board` the saved-maps list gains a row under the new title (autosave); × on the other row leaves one; the sort control lists the four labels; the dots menu lists `Import JSON` and `Export JSON`.
- [ ] Ledger: M7 done.

### Task 10: Players overlay (S8, B3, B6, M8, M9)

- [ ] Extract the reorder machinery from `PlayerPanel.tsx` into `src/ui/useRowReorder.ts` (HTML5 drag, coarse hold with `HOLD_MS`/`HOLD_SLOP`, `aimDrag`, touchmove swallow, edge scroll, trash target, click swallow, pointer rescue), parameterised by the row selector and callbacks; `PlayerPanel` uses it with no behaviour change. Add a `startImmediately` entry point for the grip.
- [ ] Add `src/ui/phone/PlayersScreen.tsx` per S8: roster rows (grip, dot, name, `YOU` chip, VP from `computeStandings`); tap row claims via `setMe`; name tap renames in place (local draft, Enter commits, Escape reverts, bounded width as in Task 9); grip starts a drag at once, elsewhere a hold; lifted row follows the pointer with no transition while the others ease; drop commits `movePlayer`; trash removes. `Add player` dashed, disabled at six. Below, `Snake draft` with `pick N of M` and the slot grid from `draftSlots`.
- [ ] Add a vitest in `src/engine/__tests__/draft.test.ts` (or a new file beside it) asserting that `inferDraftState(movePlayer(board, id, 0)).sequence[0]` is `id` and that `myPickIndices` change accordingly (B3 at the model level).
- [ ] e2e: the dot cluster opens `Players`; tapping the second row gives it the `YOU` chip and rings the header's second dot; renaming via the name updates the row and the context line's picker; a grip drag of the last row to the top (pointer down on the grip, move in steps, up) reorders the ribbon's first circle to that player's colour and changes the `picking … of` text; if the emulated drag cannot be made to land in two attempts, follow the give-up rule.
- [ ] Ledger: M8, M9 done.

### Task 11: Landscape and desktop regression specs (M15)

- [ ] Add `e2e/shellArms.spec.ts`. Desktop (`viewport 1280×900`, no touch): `.board-tabs` visible, `.phone-shell` count 0, the tab context menu has no `Save to library`, `MapsPanel` has no `Map name` field, closing an edited tab needs no confirmation. Landscape phone (`viewport 844×390`, `hasTouch`, `isMobile`): `.mobile-nav` present with four tabs, `.phone-shell` count 0. Rotation: `setViewportSize` to `390×844` mounts `.phone-shell`; back to `844×390` unmounts it and `.mobile-nav` returns.
- [ ] The landscape block of `editor.css` is byte-identical to `main`: extract it from `git show main:src/ui/editor.css` and from the working copy (from the `Landscape phone keeps a fixed viewport` comment to the block's closing brace) and `diff` them; empty output is the requirement.
- [ ] `git diff main --stat` touches nothing under `simulator/`, `src/parser/`, `src/engine/` (beyond the test added in Task 10), `src/persistence/` or `src/ui/workspaceSync.ts`.
- [ ] Ledger: M15 done.

### Task 12: Verify acceptance criteria

- [ ] `npm run typecheck`, `npm run lint`, `npm test`, `npx playwright test --reporter=list`, then `npm run build`, all green, each alone.
- [ ] `grep -rn 'mobile-nav\|MobileNav\|data-pane' src/ui/phone/` is empty; `grep -n 'MobileNav' src/ui/App.tsx` still finds the landscape mount.
- [ ] `grep -rn 'Diversity+recipes\|Starting cards' src/` is empty. `grep -rn 'Save to library\|map-save-row\|board-tab-dirty' src/` is empty.
- [ ] Every spec ledger row M2 to M17 reads `done` except M10 `dropped (O1)`; the spec's `What already exists` and `Out of scope` sections match the code; `CLAUDE.md`'s `ui/` bullet names `PhoneShell`, the two overlays and `usePortraitPhone`, and its persistence bullet names the autosave.
- [ ] `test-results/phone/` holds a screenshot per phone e2e test; list them in the progress output with their sizes.
- [ ] `git status` is clean apart from this plan file.

## Post-Completion

- Open the run branch's dev server on a real iPhone in Safari and on an Android phone in Chrome: check the hold-to-drag on the Players screen, the pinch-to-zoom on the board, the safe-area insets under the fixed header, and that the keyboard does not cover the rename field.
- Review `test-results/phone/*.png` against the prototype artifact.
- Merge the run branch into `main` and let the site CI deploy it (see the `unsettled-deployment` memory).
