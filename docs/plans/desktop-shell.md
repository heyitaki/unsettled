# Desktop workspace alignment

## Overview

Bring the desktop workspace (and, through the shared `Workspace` tree, landscape phone) in line with the decisions the portrait phone shell settled, to [`.claude/specs/desktop/spec.md`](../../.claude/specs/desktop/spec.md). Read that file in full before the first task, then [`.claude/specs/mobile/spec.md`](../../.claude/specs/mobile/spec.md), whose Surfaces, Behaviours and Decisions are the underlying design; this plan never restates either. Where both are silent, the phone's rendering is the reference: run `npx playwright test e2e/phoneShell.spec.ts --reporter=list` once before the first task and look at the screenshots it drops in `test-results/phone/`.

When this run is done:

- The desktop has no tab strip and no import panel. The left rail is a Library panel (dots menu for JSON, hero `Import screenshot`, open boards with in-place rename and `New board`, saved maps with sort, in-place rename, relative time and trash) above the Board tools; the centre is a draft ribbon over the board, whose caption reads `4 player layout` with a chevron and no counts; the right rail is Players (claim on row, rename on name, grip drag with sliding rows, `YOU` chip, tally, dashed `Add player`, the snake-draft grid) above Best picks (`Your turn` pill, swatch claim row, empty-board state, select-on-click cards in the phone's styling, resting marks on the board). No footer. The site header is untouched.
- Every component and every stylesheet rule that both trees render exists once, without a `phone-` prefix, and `src/ui/phone/` holds only the shell, its header, its overlays and build mode.
- Every phone e2e test is green with the same screenshots in substance, and the desktop and landscape e2e tests assert the new surfaces.
- Every desktop spec ledger row D1 to D12 reads `done`, the mobile spec's `What already exists` table names the new paths, and `CLAUDE.md`'s `ui/` bullet describes the panels as they now are.

### Standing rules for every iteration

**One tree for desktop and landscape, one shell for portrait.** `App.tsx` keeps mounting `PhoneShell` for `usePortraitPhone()` and `Workspace` otherwise. `MobileNav`, `mobilePanes.ts` and the `data-pane` gating stay exactly as they are. The landscape block of `editor.css` (headed `Landscape phone keeps a fixed viewport`) changes only where a task names it. `PhoneShell.tsx`, `PhoneHeader.tsx`, `PhoneOverlay.tsx`, `MapsScreen.tsx`, `PlayersScreen.tsx`, `PhoneBuild.tsx` and `buildMode.ts` change only to consume a promoted piece or to drop a rule the spec retires.

**Promote, never copy.** A phone surface that reaches the desktop moves: the component out of `src/ui/phone/` into `src/ui/`, the rules out of the `@media (max-width: 760px) and (orientation: portrait)` arm into the base rules, both without the `phone-` prefix and without the `.phone-shell` scope. The desktop-only rule it replaces is deleted in the same task. The portrait arm keeps only what differs on a phone (sizes, the frosted paper, `transition: none`). A second copy of a row, a rename field, a ribbon, a grid or a menu rule is a defect, and so is a `.phone-shell` selector left in front of a rule the desktop now needs.

**Renames follow through.** When a class or an export is renamed, every reference moves with it, in `src/`, in `e2e/phoneShell.spec.ts`, and in `revealBoard.ts`; no alias, no duplicate selector, no compatibility rule. After each task `grep -rn '<old name>' src/ e2e/` for every name the task retired is empty.

**Tests before code, every task.** Desktop and landscape assertions go in `e2e/shellArms.spec.ts` (viewports already there: desktop `1280×900`, landscape `844×390` with `isMobile` and `hasTouch`); each desktop test ends with a full-page screenshot into `test-results/phone/desktop-<name>.png` through the file's `snap` helper. Pure logic gets a vitest file beside the existing ones in `src/ui/__tests__/` (`// @vitest-environment jsdom` on the first line when the DOM is needed). Never loosen a phone assertion to make it pass; when a phone selector must change because a class was promoted, change the selector only.

**`e2e/workspaceSync.spec.ts` is timing-sensitive.** Task 2 changes the four locators at its top and the `Add board` button name and nothing else there: not `CLOSE_PACE_MS`, not `settle`, not the sequence of actions. A red there on a loaded machine is re-run once alone before it counts.

**Keep the tree green at every commit.** Every task ends with `npm run typecheck`, `npm run lint`, `npm test`, `npx playwright test --reporter=list`, in that order, each alone, never two in one parallel block.

**Ledger.** The last checkbox of every task updates the matching desktop spec ledger row(s) to `done` and commits the spec with the code.

**Style.** No em or en dashes anywhere. No CSS comments unless a rule is genuinely non-obvious. One line per paragraph or bullet in markdown. No new dependencies.

**Give up, do not grind.** If a Playwright assertion cannot be made to pass in two attempts because the emulation cannot express the gesture (a real HTML5 drag between rows, a touch hold), record that in the progress output, cover the logic in vitest, note it in the ledger row, and move on.

### Out of scope

The portrait shell's layout. The site header. The points ledger's columns, view switch and steppers. The toast. `simulator/`, `parser/`, `engine/`, `persistence/`, `workspaceSync.ts`. Phase 3. Any persistence format or key.

## Context

### Where things live

- `src/ui/App.tsx`: `Workspace` (site header, `GlobalNotice`, three rails, `MobileNav`, the footer), `Shell`, `App`. Left rail today: `#pane-board` holds `ToolPalette`, `#pane-library` holds `ImportPanel` then `MapsPanel`. Centre: `BoardTabs` then `BoardCanvas`.
- `src/ui/BoardTabs.tsx`: the whole tab strip, its context menu, long-press, chords, `duplicate`, `rename`. Deleted in Task 2. Its only imports that die with it: `shortcuts.ts` (sole consumer), `copyTitle` in `boardFiles.ts` (with `nextCopyName`). `isTextEntry` and `overlayOpen` in `overlayPosition.ts` stay: `PhoneOverlay.tsx` and `BoardCanvas.tsx` use them.
- `src/ui/MapsPanel.tsx`: saved maps only (`useLibrary`, `sortMaps`, `stampFor`, `relativeTime`, the fade-mask scroller). Becomes the Library panel in Task 2. `src/ui/ImportPanel.tsx`: the hero import button and the two JSON buttons over `useJsonFiles`. Deleted in Task 2.
- `src/ui/phone/MapsScreen.tsx`: `Row` (lines 22-58) is the row both lists share; `Editing`, `draftFor`, `rename` show how one `editing` state drives every row. `src/ui/phone/InlineRename.tsx`: the name-bounded field. `src/ui/phone/PlayersScreen.tsx`: the roster row (grip, swatch, `InlineRename`, `YOU`, VP), `SHIFT_CLASS` over `rowShift`, the mid-drag trash, the snake-draft grid with its `pick n of m` label. `src/ui/phone/PhoneRibbon.tsx`: the ribbon with its `own` ref that drops the selection when another panel writes the highlight.
- `src/ui/PlayerPanel.tsx`: `TALLY_COLUMNS`, `RESOURCE_COLUMNS`, the tally bar and the `coarse` caption buttons (unchanged), the row (`drag-handle`, `player-dot`, `player-name` / `player-name-input`, `player-awards`, `player-tally`, `player-vp`), `player-steppers` under the `active` (brush) row, the `player-trash`, the `draft-strip`. `useRowReorder({ coarse, ids, rowSelector, trashSelector, lockedId, onMove, onRemove })` returns `listRef`, `dragId`, `dropTarget`, `dragOffset`, `rowProps`, `trashProps`, `startImmediately`.
- `src/ui/AnalysisPanel.tsx`: `displayedFactors`, `vertexDescription`, the `variant` prop and `phone` const, `coarse`, `own`/`mark`, `selectRecommendation`, `placeRecommendation`, `placeLikelyGone`, the `emptyMessage` map, the two card renderings (coarse with `analysis-row-select` and `analysis-touch-actions`; fine with `onMouseEnter` and `onClick` placing). The phone branch at the bottom is the design for both.
- `src/ui/BoardCanvas.tsx`: `restMarks` prop (line 149), `usePortraitPhone` for the caption's `align` and `caret` (lines 152-153), `board-status` with the two `board-count` spans (lines 766-780), the highlight rendering (`vertex-highlight`, `vertex-highlight-label`, `faded`).
- `src/ui/ToolPalette.tsx`: `ToolGroups` (shared with `PhoneBuild`) and `ToolPalette` whose heading holds the inline dice and hexagon SVGs and the `←` `→` buttons.
- `src/ui/MenuSelect.tsx`: `caret` default (line 38), `align` (`'start' | 'center'`), the `menu-tick` span rendered per option. `src/ui/ContextMenu.tsx`: `ContextMenuItem` (`icon`, `count`, `shortcut`, `shortcutKeys`, `disabled`, `separated`, `danger`), props `align`, `tail`, `className`, `history`.
- `src/ui/glyphs.tsx`: `BoardHexGlyph`, `ChevronGlyph`, `PencilGlyph`, `DotsGlyph`, `PhotoGlyph`, `BackGlyph`, `XMarkGlyph`, `PlusGlyph`, `TrashGlyph`, `GripGlyph`, `TickGlyph`, `SortGlyph`, `UndoGlyph`, `RedoGlyph`, `DiceGlyph`, `ExportGlyph`, `ImportGlyph`, `ClearBoardGlyph`.
- `src/ui/restMarks.ts`: `restingMarks`, `LISTED_PICKS`, `SOLID_RANKS`. `src/ui/draftSlots.ts`: per-slot `placed`, `vertex`, `mine`, `current`. `src/ui/boardColor.ts`. `src/ui/rowDrag.ts`: `rowShift`.
- `src/ui/editor.css`: base rules to line 396; `@media (max-width: 1120px)` at 392; the shared `(max-width: 760px)` and landscape-gated arm at 399 (holds `.board-tabs { display: none }` at 419 and `footer { display: none }` at 478); the portrait arm at 478 to 733; the landscape block at 735. Phone rules to promote sit at lines 587 to 733.
- `e2e/shellArms.spec.ts`: the desktop test asserts `.board-tabs` visible, the tab context menu's items, `Add board`, `Close Board 1`, and the maps panel has no input; the landscape tests assert the nav and `.board-tabs` hidden. `e2e/workspaceSync.spec.ts` lines 11-13 and 24, 40, 62, 88 name the strip. `e2e/phoneShell.spec.ts` asserts `.board-tabs` count 0 and selects on `.phone-*` classes (`.phone-row`, `.phone-row-name`, `.phone-row-meta`, `.phone-open-boards`, `.phone-saved-maps`, `.phone-group-label`, `.phone-prow`, `.phone-grip`, `.phone-you`, `.phone-trash`, `.phone-claim-row`, `.phone-ribbon`, `.phone-rslot`, `.phone-dslot`, `.phone-dslot-name` among the promoted ones; `.phone-shell`, `.phone-head`, `.phone-title`, `.phone-dot`, `.phone-page`, `.phone-analysis`, `.phone-build`, `.phone-overlay-title`, `.phone-ohead-btn` stay).
- `playwright.config.ts`: `baseURL` `http://localhost:5199/unsettled/`, `page.goto('')` opens the app, one worker, the dev server starts itself.
- `src/ui/__tests__/store.test.ts` builds a `StoreState` and drives `reducer`; `boardFiles.test.ts` holds the `copyTitle` and `nextCopyName` cases to delete; `shortcuts.test.ts` is deleted whole.

### Names this plan fixes

Promoted classes, old to new: `.phone-list` → `.list`, `.phone-row` → `.list-row`, `.phone-row-select` → `.list-row-select`, `.phone-row-hex` → `.list-row-hex`, `.phone-row-main` → `.list-row-main`, `.phone-row-name` → `.list-row-name`, `.phone-row-rename` → `.list-row-rename`, `.phone-row-meta` → `.list-row-meta`, `.phone-row-x` → `.list-row-x`, `.phone-add` → `.list-add`, `.phone-open-boards` → `.open-boards`, `.phone-saved-maps` → `.saved-maps` (the existing desktop scroller class; its fade rules stay), `.phone-group-label` → `.group-label`, `.phone-hero-import` → `.hero-import`, `.phone-hint` → `.hint`, `.phone-swatch` → `.swatch`, `.phone-you` → `.you-chip`, `.phone-claim` → `.claim`, `.phone-claim-row` → `.claim-row`, `.phone-empty-actions` → `.empty-actions`, `.phone-turn-pill` → `.turn-pill`, `.phone-menu` → `.sheet-menu`, `.phone-omenu` → `.sheet-menu-narrow`, `.phone-ribbon` → `.draft-ribbon`, `.phone-rslot` → `.draft-ribbon-slot`, `.phone-roster` → `.roster`, `.phone-prow` → `.roster-row`, `.phone-grip` → `.roster-grip`, `.phone-vp` → `.roster-vp`, `.phone-trash` → `.roster-trash`, `.phone-draft-grid` → `.draft-grid`, `.phone-dslot` → `.draft-grid-slot`, `.phone-dslot-circle` → `.draft-grid-circle`, `.phone-dslot-name` → `.draft-grid-name`, `.phone-block-head` stays phone-only. The `.current` and `.me` modifier classes keep their names.

Promoted files: `src/ui/phone/InlineRename.tsx` → `src/ui/InlineRename.tsx`; `Row` in `MapsScreen.tsx` → `src/ui/ListRow.tsx` (export `ListRow` with the same props); `src/ui/phone/PhoneRibbon.tsx` → `src/ui/DraftRibbon.tsx` (export `DraftRibbon`); the grid in `PlayersScreen.tsx` → `src/ui/DraftGrid.tsx` (export `DraftGrid`, rendering the group label row and the grid from `board` and `analysis`).

### Defaults this plan fixes, which the spec left open

- **Desktop no-me hint** reads `Pick your colour and the ranking starts`; the phone keeps `Tap`. One string chosen by `onBuild === undefined`, the same flag that hides `Build it by hand`.
- **Hover preview** uses `onMouseEnter` on a card and `onMouseLeave` on the list, both no-ops while `selectedPick !== null || selectedLikelyGone`; a preview writes the highlight without touching `selectedPick`. On a coarse pointer there is no hover and nothing changes.
- **The caption `MenuSelect`** uses `align="center"` and the chevron caret on both trees; `BoardCanvas` stops importing `usePortraitPhone`.
- **Tool label counts** render as `<span className="tool-count">` inside the existing `.tool-label` span, `12/19` beside `Terrain` and `4 pieces` beside `Structures`, muted, tabular numerals, `margin-left: auto` (the label becomes `display: flex`). Number tokens carry no count.
- **The Library dots menu** is a `ContextMenu` hung from the button's bottom-right (`align="right"`, `tail`), the way `PhoneHeader` hangs its own.
- **Library panel classes**: the section keeps `panel maps-panel` so `e2e/shellArms.spec.ts`'s `.maps-panel` locator and the left-rail flex rules keep working; the open-boards list is `list open-boards`, the saved-maps list `list saved-maps`.
- **Brush ring** on the roster swatch: `box-shadow: 0 0 0 2px var(--paper-light), 0 0 0 3.5px var(--accent)` when `aria-pressed="true"`; the `me` row uses the phone's `.phone-prow.me` rule promoted.
- **The roster row grid** on desktop is `12px 24px minmax(0, 1fr) auto auto auto` (grip, swatch, name plus awards, `YOU`, tally, VP); the phone keeps its five columns through the portrait arm.
- **The landscape ribbon rule** is one line in the landscape block: `.draft-ribbon { display: none; }`.
- **Screenshots** for the desktop tests are `test-results/phone/desktop-<name>.png`, full page, beside the phone ones.

### Traps

- The zsh shell here: quote glob-bearing flags (`grep -r --include='*.tsx'`), and never use a bare `==` or `===` separator in a compound command.
- `npm test` takes about 15 seconds; the Playwright run about 25 seconds plus dev-server start. Never run them in one parallel block; check `uptime` before believing a red on a loaded machine.
- Port 5199 belongs to the e2e dev server. If something else holds it the run reuses that server and tests stale code; `lsof -nP -i :5199` when an e2e result contradicts the source.
- A fresh e2e context boots with one blank `standard4` board and one player already claimed, so a test that needs an unclaimed roster must seed the stored workspace the way `e2e/phoneShell.spec.ts`'s claim-row test does (its `addInitScript` seed resets `stats` and `activePlayerId` too, or the loader rejects the blob). Move that seed into `e2e/seed.ts` the first time a second spec needs it.
- The `analysis.status` on a randomized one-player board is `ready` (with the `solo-roster` warning), so `Randomize` is enough to get cards and resting marks in a desktop test.
- `useMediaQuery`'s server snapshot is `false`, so nothing under `PhoneShell` renders in vitest; unit-test pure modules only.
- `renameMap` on a map deleted in another window fails; `useRenameTab` tolerates that and the Library panel must call it, never `tab-rename` directly.
- The portrait arm's `.phone-shell button { transition: none }` and its `@media (hover: hover)` resets are phone-only by design; promoted row rules must not carry them into the base.
- The `1120px` arm moves the right rail under the board as two columns; the Players panel and the Best picks panel must still fit there after the row restyle (the tally columns are the constraint; the desktop grid above leaves them their existing `--tally-col` width).

## Validation Commands

Run from the repo root, each on its own, in this order.

- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npx playwright test --reporter=list`

`npm run build` runs once, in the final task.

### Task 1: Promote the list vocabulary (D1)

- [x] Move `src/ui/phone/InlineRename.tsx` to `src/ui/InlineRename.tsx` and extract `Row` from `src/ui/phone/MapsScreen.tsx` into `src/ui/ListRow.tsx` as `ListRow`, props unchanged; `MapsScreen` and `PlayersScreen` import both from `../`.
- [x] Rename the list, row, add, group-label, hero-import, hint, swatch, YOU-chip, claim, empty-actions and turn-pill classes per `Names this plan fixes`, in the components (`MapsScreen`, `PlayersScreen`, `PhoneBuild`, `AnalysisPanel`, `ListRow`, `InlineRename`) and in `editor.css`; move their rules out of the portrait arm into the base rules, unscoped, deleting the `.phone-shell` prefix where one was in front; keep in the portrait arm only the hover resets that name them.
- [x] Update every selector in `e2e/phoneShell.spec.ts` that named a renamed class. `grep -rn 'phone-row\|phone-list\|phone-add\|phone-group-label\|phone-hero-import\|phone-hint\|phone-swatch\|phone-you\|phone-claim\|phone-empty-actions\|phone-turn-pill' src/ e2e/` is empty.
- [x] Add `src/ui/__tests__/inlineRename.test.tsx` (jsdom, `@testing-library`-free: render with `react-dom/client` into a container as `boardMarks.test.tsx` does) covering: at rest the name renders as a button; `onStart` absent renders plain text; with `draft` set the input is focused, Enter calls `onCommit`, Escape calls `onCancel`.
- [x] Phone e2e green with unchanged screenshots. Ledger: D1 done.

### Task 2: The Library panel replaces the tab strip and the import panel (D2, DB5)

- [x] Tests first. Rewrite the desktop test in `e2e/shellArms.spec.ts`: `.board-tabs` count 0; the `.maps-panel` shows `Import screenshot` first, then a `.group-label` starting `Open boards (1)`, one `.list-row.current` named `Board 1` with a `Close Board 1` button, a `New board` button, then `Saved maps`; right-clicking the current row opens no `menu`; the panel's `Import and export files` button opens a menu listing exactly `Import JSON`, `Export JSON`; `New board` adds a second row and `Close Board 1` removes one with no confirm dialog and no native dialog; clicking the current row's name opens a `.list-row-rename` field, typing `Harbour` and Enter retitles the row and (after the autosave) the saved-maps row; the landscape test's `.board-tabs` hidden assertion becomes count 0. In `e2e/workspaceSync.spec.ts` change only `strip` to `.open-boards .list-row`, `titles` to `.list-row-name` under it, `active` to `.open-boards .list-row.current .list-row-name`, the `Add board` clicks to `New board`, and `.board-tab-close` to `.open-boards .list-row-x`.
- [x] Rewrite `src/ui/MapsPanel.tsx` to the spec's D1 surface: heading with the dots `ContextMenu`, hero import opening `ImportDialog`, open boards from `state.tabs` through `ListRow` (`tab-select`, `tab-close`, `useRenameTab`), the dashed `New board`, the saved-maps group label with the sort `MenuSelect`, warning and empty-state hint, saved-map rows through `ListRow` (`openMap`, `renameSavedMap`, `deleteSavedMap`, meta from `stampFor` and `relativeTime`, `corrupt` when invalid); keep the fade-mask scroller around the saved-maps list. `MapsScreen.tsx` keeps rendering its own overlay with the same `ListRow`; if the two bodies come out identical, extract the shared body into `src/ui/LibraryLists.tsx` and render it from both.
- [x] `App.tsx`: the left rail is `#pane-library` holding `MapsPanel` first, then `#pane-board` holding `ToolPalette`; the centre column no longer mounts `BoardTabs`. Delete `src/ui/BoardTabs.tsx`, `src/ui/ImportPanel.tsx`, `src/ui/shortcuts.ts`, `src/ui/__tests__/shortcuts.test.ts`, `copyTitle` and `nextCopyName` from `boardFiles.ts` with their tests. Delete the `.board-tabs*`, `.board-tab*`, `.library-io`, `.io-primary`, `.io-json`, `.io-icon`, `.saved-map`, `.saved-map-*`, `.library-list-head`, `.map-sort`, `.empty-state` rules, the landscape arm's `.board-tabs { display: none }`, and every `board-tab` selector left in the arms. `grep -rn 'board-tab\|BoardTabs\|ImportPanel\|shortcuts' src/` is empty; in `e2e/` only the three `.board-tabs` count-0 assertions this same task asks for remain.
- [x] `CLAUDE.md` `ui/` bullet: drop `BoardTabs`, `ImportPanel` and the `shortcuts.ts` clause; say the Library panel (`MapsPanel`) is the document switcher and the import entry on desktop, sharing `ListRow`, `InlineRename`, `useLibrary`, `useRenameTab` and `useJsonFiles` with the phone's Maps screen. Its `test:e2e` bullet still describes `shellArms.spec.ts` correctly.
- [x] Ledger: D2 done.

### Task 3: Menus (D3)

- [x] Tests first. In `e2e/shellArms.spec.ts` desktop: opening the layout caption's `Board layout` menu shows a visible `.menu-tick` inside the option marked `active` and none visible elsewhere; the trigger contains an `svg` (the chevron) and no `▾` text. In `e2e/phoneShell.spec.ts` the dots-menu test additionally asserts the `Undo` item's text is exactly `Undo` after one `Randomize board` (no count).
- [x] `MenuSelect.tsx`: the default `caret` is `<ChevronGlyph className="menu-chevron" />`; callers that passed the same chevron drop the prop. Delete `.menu-caret` and the `▾` rendering. Promote the portrait arm's `.phone-shell .menu-popup*`, `.menu-tick` and `.menu-chevron` rules to the base `.menu-popup`, `.menu-tick`, `.menu-chevron`, deleting the desktop `.menu-popup` rule, the `button.active` gold highlight and the base `.menu-tick { display: none }`; keep the `phone-pop` fade.
- [x] `ContextMenu.tsx`: delete `count`, `shortcut` and `shortcutKeys` from `ContextMenuItem` and their rendering; `PhoneHeader.tsx` stops passing `count`. Rename `.phone-menu` → `.sheet-menu` and `.phone-omenu` → `.sheet-menu-narrow`, promote their rules (including `.menu-history`, `.menu-tail`, `.menu-icon`, the danger colour) to the base and make `ContextMenu` always render `sheet-menu` (callers add `sheet-menu-narrow` through `className`); delete the desktop `.context-menu` rules, `.menu-shortcut`, `.menu-count` and the `@media (hover: hover)` lines that named them. `grep -rn 'menu-caret\|menu-shortcut\|menu-count\|phone-menu\|phone-omenu\|shortcutKeys' src/ e2e/` is empty.
- [x] Ledger: D3 done.

### Task 4: Board area (D4, DB1, DB6)

- [x] Tests first. In `e2e/shellArms.spec.ts` desktop: after `Randomize`, `.draft-ribbon .draft-ribbon-slot` count is `2 × .swatch count in the roster` (or `2 × players` from the store, read the way the phone test does) with the first carrying `now`, and `.vertex-highlight` count equals `LISTED_PICKS` (import it) with the fourth and fifth carrying `faded`; hovering nothing, clicking a ribbon slot draws exactly one `.vertex-highlight`; the `.board-status` text contains neither `terrain` nor `pieces`; `footer` count 0. Landscape: `.draft-ribbon` hidden, `footer` count 0.
- [x] Move `src/ui/phone/PhoneRibbon.tsx` to `src/ui/DraftRibbon.tsx` (`DraftRibbon`), rename its classes, promote its rules to the base; `PhoneShell` imports it from `../DraftRibbon`; `Workspace` renders it in `.center-column` above `BoardCanvas`; the landscape block hides it.
- [x] `Workspace` computes `restingMarks(board, analyzeBoardCached(board))` (memoised on `board`) and passes it as `restMarks`; `BoardCanvas` drops `usePortraitPhone`, always passes `align="center"` and the chevron caret to the caption menu, and deletes the two `board-count` spans. Promote `.phone-shell .board-status*` and `.phone-shell .vertex-highlight*` to the base, deleting the desktop `.vertex-highlight`, `.vertex-highlight-label` sizes and the red defaults; keep the `faded` opacity rule. `.board-count` CSS goes.
- [x] Delete the `<footer>` from `Workspace`, the base `footer` rule and the arm's `footer { display: none }`.
- [x] `grep -rn 'PhoneRibbon\|phone-ribbon\|phone-rslot\|board-count\|<footer' src/ e2e/` is empty. Ledger: D4 done.

### Task 5: Tool heading and the moved counts (D5)

- [x] Tests first. `e2e/shellArms.spec.ts` desktop: the tools heading has buttons named `Randomize`, `Clear all`, `Undo`, `Redo`, each containing an `svg` and no `←`/`→` text; `Clear all` has the `danger` class; after `Randomize` the `Terrain` label's `.tool-count` reads `19/19` and the `Structures` label's reads `0 pieces`; the phone build test asserts the same two counts appear in the build block.
- [x] `ToolPalette.tsx`: the heading buttons render `DiceGlyph`, `ClearBoardGlyph`, `UndoGlyph`, `RedoGlyph`; delete the inline SVGs and `.btn-icon`; `Clear all` carries `className="danger"`. `ToolGroups` renders the counts inside the `Terrain` and `Structures` labels as `tool-count`, computed from `board.hexes` and `board.roads.length + board.buildings.length`; `.tool-label` becomes flex with the count at its end.
- [x] Ledger: D5 done.

### Task 6: Analysis behaviour (D6, DB2)

- [ ] Tests first. `e2e/shellArms.spec.ts` desktop: a fresh board shows `This board is empty` with an `Import screenshot` button and no `Build it by hand`; after the unclaimed-roster seed (`e2e/seed.ts`, extracted from the phone spec) and `Randomize`, the panel shows `Pick your colour and the ranking starts` and a `.claim-row` with one button per player, clicking the first makes the context line start `You are` and end `of 8` with no `turn` text, and a `.turn-pill` reading `Your turn` sits in the heading; clicking the first `.analysis-row` marks it `current`, shows `Place settlement` and `Clear`, and leaves `.vertex-highlight` count 2 (first solid, second `faded`) even after the mouse moves over the second card; clicking `Clear` restores `LISTED_PICKS` marks; clicking `Place settlement` adds one building (`.building` count or the `Structures` count reads `1 pieces` → assert the roster's VP for the player reads `1`) and no card is `current`.
- [ ] `AnalysisPanel.tsx`: delete `variant` and `coarse`; keep `onBuild?`. One rendering per card: the `analysis-row-select` button selecting, `analysis-touch-actions` under the selected card, plus `onMouseEnter` on the card and `onMouseLeave` on the list that preview only while nothing is selected. Same for the likely-gone block. The heading with the pill, the context line without the tail, the claim row and the empty state render for both trees; `Build it by hand` only with `onBuild`; the hint string switches on `onBuild`. The `phone-block` wrapper and `phone-analysis` class stay on the phone by taking `className` from the caller (`PhoneShell` passes them) while the desktop keeps `panel analysis-panel`. `revealBoardIfScrolledPast` still runs only when `onBuild` is supplied.
- [ ] `PhoneShell` passes `onBuild={enter}` as today and the phone e2e stays green.
- [ ] Ledger: D6 done.

### Task 7: Analysis card styling (D7)

- [ ] Tests first. `e2e/shellArms.spec.ts` desktop: the first `.analysis-rank`'s computed `background-color` equals the claimed player's colour (read `.roster-row.me .swatch`'s background) and its `border-width` is not `0px`; `.analysis-availability` (when present after the seed) has no `border-radius` pill and the accent colour; `.analysis-factors span` has no border.
- [ ] Promote every `.phone-shell .analysis-*` rule, `.phone-shell .analysis-context*` and the pill rules to the base, deleting the desktop `.analysis-row`, `.analysis-rank`, `.analysis-pick-line strong`, `.analysis-score`, `.analysis-availability`, `.analysis-second`, `.analysis-factors span`, `.analysis-row.selected` (gold), `.analysis-touch-actions` and `.analysis-clear` rules they replace; the selected card uses `current`. The rank circle's inline `myColor` background applies on both trees.
- [ ] Ledger: D7 done.

### Task 8: Roster rows (D8, DB3, DB4)

- [ ] Tests first. `e2e/shellArms.spec.ts` desktop, after the unclaimed seed: the `.roster-row` count equals the player count and none is `me`; clicking the second row makes it `me` with a visible `.you-chip` and the analysis context line names that player; clicking the third row's `.swatch` sets its `aria-pressed` to `true`, shows `.player-steppers` under that row, and does not move `me`; clicking the first row's name opens a `.list-row-rename` field, typing `Mara` and Enter renames the row and the ribbon slot titles; an `Add player` button sits under the rows and adding twice (to six) disables it; the heading has no `+` button.
- [ ] `PlayerPanel.tsx`: replace the row with the promoted roster row (`GripGlyph` with `startImmediately`, `swatch` button with `aria-pressed` for the brush and `stopPropagation`, `InlineRename` committing `renamePlayer` on Enter/blur, `player-awards`, `you-chip`, tally, VP); the row's `onClick` commits `setMe`; delete `.player-add`, `.drag-handle`, `.player-dot`, `.player-name`, `.player-name-input`, `.player-card.active` and the `⠿` glyph; add the dashed `Add player` `list-add` under the trash slot. Rename and promote `.phone-roster`, `.phone-prow*`, `.phone-grip`, `.phone-vp`, `.phone-trash` per `Names this plan fixes`, with the desktop six-column grid in the base and the phone's five columns in the portrait arm; `PlayersScreen` uses the same classes. Keep `--tally-col` and the tally bar alignment working: the tally header's right padding must still line up with the row's tally cells.
- [ ] `grep -rn 'player-dot\|player-name\b\|player-name-input\|player-add\|drag-handle\|phone-prow\|phone-grip\|phone-you\|phone-vp\|phone-trash\|phone-roster' src/ e2e/` is empty. Ledger: D8 done.

### Task 9: Drag feel and the draft grid (D9)

- [ ] Tests first. Vitest `src/ui/__tests__/draftGrid.test.tsx` (jsdom): `DraftGrid` on a four-player board with two placed settlements renders eight slots, the first two `placed`, the third `now`, the label `pick 3 of 8`; with every slot placed the label reads `draft complete`. `e2e/shellArms.spec.ts` desktop: the Players panel has a `.draft-grid` with `2 × players` slots and no `.draft-strip`; dragging the first roster row's grip onto the third row with `page.mouse` reorders the ribbon's first slot to that player's colour (skip with a ledger note if HTML5 drag will not fire under Playwright after two attempts, covering `rowShift` in vitest instead).
- [ ] Extract the grid and its label from `PlayersScreen.tsx` into `src/ui/DraftGrid.tsx`; `PlayerPanel` renders it in place of the `draft-strip` (delete the strip, `selectedSlot`, its hover and click handlers, `.draft-strip`, `.draft-slot*`, `.slot-circle`, `.slot-name`). Promote the row-shift transition rules (`.roster-row.dragging`, `.shift-up`, `.shift-down`, `.drag-over`, `--roster-row-step`) to the base; `PlayerPanel` applies `SHIFT_CLASS` from `rowShift` and the lifted row's `translateY(dragOffset)` exactly as `PlayersScreen` does; delete `.player-card.dragging { opacity }` in both arms.
- [ ] `grep -rn 'draft-strip\|draft-slot\|slot-circle\|phone-dslot\|phone-draft-grid' src/ e2e/` is empty. Ledger: D9 done.

### Task 10: Vocabulary sweep (D10, DB7)

- [ ] `grep -n '#d8bc77\|#fff9e9\|#c77c63\|▾\|⠿' src/ui/editor.css src/ui/*.tsx` is empty; every remaining `current` and `me` rule lives once in the base with the phone's tints.
- [ ] `grep -rl 'phone-' src/ui --include='*.ts' --include='*.tsx' | grep -v 'src/ui/phone/'` prints only `src/ui/revealBoard.ts`; every `.phone-shell`-scoped rule left in the portrait arm differs from the base rule it overrides (delete any that merely repeats it).
- [ ] Read the desktop, landscape and phone screenshots from the last e2e run and fix anything the promotions broke on the phone (a lost size, a lost tint), keeping the phone as the reference; note in the progress output which files were touched for it.
- [ ] Ledger: D10 done.

### Task 11: Docs and the specs (D11)

- [ ] `CLAUDE.md` `ui/` bullet describes the panels as they now are (`MapsPanel` as the Library, `DraftRibbon`, `DraftGrid`, `ListRow`, `InlineRename`, `PlayerPanel` claim-on-row, `AnalysisPanel` select-on-click) and names both spec files; nothing in it still mentions `BoardTabs`, `ImportPanel`, `shortcuts.ts` or the tab strip.
- [ ] `.claude/specs/mobile/spec.md`: every path in `What already exists` points at the promoted file; the `Out of scope` line about desktop layout notes that the desktop now follows `.claude/specs/desktop/spec.md`.
- [ ] `.claude/specs/desktop/spec.md`: `What already exists` paths current; ledger D11 done.

### Task 12: Verify acceptance criteria

- [ ] `npm run typecheck`, `npm run lint`, `npm test`, `npx playwright test --reporter=list`, then `npm run build`, all green, each alone.
- [ ] `ls src/ui/phone/` lists exactly `MapsScreen.tsx`, `PhoneBuild.tsx`, `PhoneHeader.tsx`, `PhoneOverlay.tsx`, `PhoneShell.tsx`, `PlayersScreen.tsx`, `buildMode.ts`; `ls src/ui/` includes `InlineRename.tsx`, `ListRow.tsx`, `DraftRibbon.tsx`, `DraftGrid.tsx` and not `BoardTabs.tsx`, `ImportPanel.tsx`, `shortcuts.ts`.
- [ ] Every grep in Tasks 2, 3, 4, 8, 9 and 10 is still empty.
- [ ] Every desktop spec ledger row D1 to D12 reads `done`; `CLAUDE.md` and both specs match the code.
- [ ] `test-results/phone/` holds a screenshot per phone, desktop and landscape e2e test; list them in the progress output with their sizes.
- [ ] `git status` is clean apart from this plan file.

## Post-Completion

- Open the run branch's dev server at desktop width and at `1100px` (the two-column arm) and click through: switch, rename, close and add boards from the Library; import a screenshot from `fixtures/`; claim, rename and drag players; select and place a recommendation; undo it.
- Review `test-results/phone/*.png`: the phone shots against their pre-run versions, the desktop shots against `.claude/specs/desktop/spec.md`.
- Merge the run branch into `main` and let the site CI deploy it (see the `unsettled-deployment` memory).
