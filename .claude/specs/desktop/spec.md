# Desktop workspace — specification

What the desktop (and, through the shared `Workspace` tree, landscape phone) UI must become so it carries the design decisions the portrait phone settled in [`../mobile/spec.md`](../mobile/spec.md). Read that file first: its Surfaces, Behaviours and Decisions are the design; this file says what of it reaches the desktop, what the desktop keeps that the phone dropped, and how the two trees share code afterwards. Where this file is silent, the phone's rendering is the reference: `e2e/phoneShell.spec.ts` produces screenshots of every phone surface under `test-results/phone/`.

Scope is `src/ui/` outside `src/ui/phone/`, the base and landscape arms of `src/ui/editor.css`, and the phone files only where a surface is promoted out of them. **The portrait shell must not regress**: every phone e2e test stays green and every phone screenshot stays the same in substance (selectors may change with class names, pixels do not).

## Why

The phone shell was built to a design that fixed decisions the desktop still contradicts: one-word factor pills and autosave already reached both, but the board colour, the claim-on-row roster, the rename-on-name lists, import as the first action, the empty-board state, menus with a check on the current option, and the flat marks in the claimed colour all stopped at the portrait arm. The desktop also keeps two things the phone showed to be wrong: a tab strip as the document switcher (the phone folded open boards into the Maps screen, and landscape phones have had no document switcher at all since the strip was hidden there) and a separate import panel two panels away from the library that receives the import. One stylesheet now holds two visual systems, a gold-highlight desktop one and the phone's, and every shared component carries a `phone` branch.

## The model

One `Workspace` tree for desktop and landscape (mobile spec B8 holds; the portrait shell is untouched). Left rail: Library, then Board tools. Centre: draft ribbon, board in its paper stage, layout caption. Right rail: Players, then Best picks. No tab strip and no footer. The site header (brand mark, subtitle rotation, `Unsettled`) stays exactly as it is.

Everything the phone and the desktop both render is one component with one stylesheet rule. A phone surface that reaches the desktop is promoted: its component moves out of `src/ui/phone/` into `src/ui/`, its CSS moves out of the portrait arm into the base rules, and both lose the `phone-` prefix. The portrait arm keeps only the rules that differ on a phone. Anything still phone-only (`PhoneShell`, `PhoneHeader`, `PhoneOverlay`, the overlays, `PhoneBuild`, `buildMode.ts`, `revealBoard.ts`) keeps its name, its place and its prefix.

## Surfaces

### D1 · Library panel

Replaces the tab strip, the `Import & export` panel and the `Saved maps` panel with one panel at the top of the left rail, the desktop's version of the phone's Maps screen (S7). It is the only place a board's name shows and the only place to switch, rename, open, close or create one.

- **Heading**: eyebrow `Library`, h2 `Maps`, and at the right a dots button (`DotsGlyph`, `aria-label="Import and export files"`) opening a `ContextMenu` hung from the button with `Import JSON` and `Export JSON` (`ImportGlyph`, `ExportGlyph`), through `useJsonFiles`.
- **`Import screenshot`**: the filled accent hero button, full width, first in the body; opens `ImportDialog`.
- **`OPEN BOARDS (n)`** group label, then one row per open tab: the board's colour hex (`boardColor(title)`), its title, a close `×` (`XMarkGlyph`, `aria-label="Close <title>"`, `tab-close`). The row selects (`tab-select`); the name renames in place through `useRenameTab`. The active tab's row is `current`. Below the rows a dashed `New board` row (`PlusGlyph`, `tab-add`).
- **`SAVED MAPS (n)`** group label with the four-key sort `MenuSelect` at its right (`SortGlyph` caret, `SORT_OPTIONS`, default `modifiedAt`), then the library warning and the empty-state hint when they apply, then one row per map: hex (`boardColor(name)`), name (renames through `renameSavedMap`), the relative timestamp for the current sort key as plain meta (`3 m ago`, no `LAST MODIFIED` prefix; `corrupt` for an invalid map), a trash (`TrashGlyph`, `deleteSavedMap`). The row opens the map (`openMap`); an invalid map's row is disabled. The saved-maps list keeps its bounded scroller with the fade masks on desktop, because the rail is bounded; the portrait arm's existing unbounding of `.saved-maps` continues to apply to the phone's overlay.
- **Rows** are the phone's rows: same height, same columns, name bounded to its own text (mobile B6, O3). The phone Maps screen renders the very same `ListRow` component.
- **Nothing from the tab strip survives beyond select, close, rename and add.** Duplicate, Close others, Close to the right, the right-click and long-press menu, and the F2 / ⌘D / ⌘W / ⌥⌘W chords are deleted with `BoardTabs.tsx` and `shortcuts.ts`. `copyTitle` and `nextCopyName` in `boardFiles.ts` go with them.
- Landscape phones get this panel in their Library pane, which gives them the document switcher they have lacked; the landscape arm's `.board-tabs { display: none }` rule is deleted as dead.

### D2 · Board area

- **Draft ribbon** above the board, the phone's ribbon (S2) promoted to `DraftRibbon`: one circle per pick, taken solid, later faded, current ringed, own picks dotted, click marks the pick's placed or predicted vertex. Hidden in the landscape arm, whose board height budget has no row to spare.
- **Resting marks** (S5): while nothing is selected the board wears every listed recommendation's first pick, ranked, in the claimed colour, ranks four and up faded. `Workspace` passes `restingMarks(board, analysis)` to `BoardCanvas` exactly as `PhoneShell` does. Marks are drawn flat everywhere: the phone's `vertex-highlight` sizing and no cast shadow become the base rule; the desktop's red defaults go.
- **Layout caption**: `4 player layout ⌄` with `ChevronGlyph`, centred, on both trees; the `19/19 terrain` and `4 pieces` counts leave the caption. `BoardCanvas` no longer consults `usePortraitPhone`. The zoom chip stays.
- The board stage keeps its desktop frame (paper panel, sea rect, drop shadow); the phone's square sea frame stays portrait-only.

### D3 · Board tools

- The heading keeps its four round buttons, drawn from `glyphs.tsx`: `DiceGlyph` (Randomize), `ClearBoardGlyph` (Clear all, styled destructive like the phone menu's `Clear board`), `UndoGlyph`, `RedoGlyph`. The inline dice and hexagon SVGs and the `←` `→` text go.
- The counts the caption lost move to the tool labels, right-aligned and muted: `Terrain` carries `12/19`, `Structures` carries `4 pieces`. They render inside `ToolGroups`, so the phone's build block shows them too.
- The phone's dots menu prints `Undo` and `Redo` with no stack-depth count (S1). `ContextMenuItem.count` is deleted.

### D4 · Analysis panel

One code path for every pointer; the `coarse` branch and the `variant` prop go.

- **Selecting a card** (click or tap) pins its marks in the claimed colour, first pick solid, planned second faded, road stub when present, and opens `Place settlement` / `Clear` under it; clicking the selected card again deselects. **Hovering** a card with a fine pointer previews its marks only while nothing is selected; leaving the list restores the resting marks. The likely-gone block behaves the same way with `Play these out` / `Clear`. A click never places a piece directly.
- **Heading** `Draft analysis` / `Best picks` with the `Your turn` pill at the right when it is your turn. **Context line** `You are <picker> · picking X and Y of N`; the desktop's `· pick N of M, whose turn` tail goes.
- **No player claimed**: the hint `Tap your colour and the ranking starts` (desktop: `Pick your colour and the ranking starts`) and a row of swatch buttons, one per player, that claim on click. The `choose player` placeholder goes.
- **Empty board** (mobile B5): heading `Nothing to rank yet` / `This board is empty`, the hint, and `Import screenshot`. `Build it by hand` renders only when the panel is given `onBuild`, which only the phone shell supplies; the desktop's tools are already on screen.
- **Cards** are the phone's: rank circle in the claimed colour with an ink ring, the triple in Inter, the score in ink, survival as plain accent text, flat tinted factor chips. The selected card uses the `current` state. The desktop rules for the accent-red rank, the Georgia score, the blue survival pill and the bordered 8px factor pills go.

### D5 · Players panel

The roster is the phone's roster (S8) plus the tally the desktop keeps (mobile O1).

- **Heading**: eyebrow `Points ledger`, h2 `Players`. The `+` button in the heading goes; a dashed `Add player` row sits under the roster, disabled at six players.
- **Row**, left to right: grip (`GripGlyph`, starts a drag at once), swatch (24px, the player's colour), name, `YOU` chip (visible on the claimed row, an invisible placeholder on the others so columns hold), the tally columns and VP under the existing tally bar with its view switch. The awards pill keeps its place beside the name.
- **Clicking the row claims** that player (`setMe`); the claimed row is `me` (ink border, white ground). **Clicking the swatch toggles the piece brush** (`active-player`), shown as an accent ring on the swatch (`aria-pressed`), and the resource steppers keep expanding under the brush player's row. The brush no longer tints the row.
- **Clicking the name renames in place** (`InlineRename`, dotted underline at rest, the field bounded to the text, Enter commits, Escape reverts, `renamePlayer` on commit rather than on every keystroke).
- **Dragging**: the lifted row follows the pointer with no easing and the rows it passes ease out of the way (`rowShift`); the mid-drag trash row removes. The desktop's faded-card drag look goes. Fine pointers keep `useRowReorder`'s HTML5 path; the visual shift derives from `dragId` and `dropTarget`, which both paths supply.
- **Snake draft**: the strip is replaced by the phone's grid, promoted to `DraftGrid` and shared with `PlayersScreen`: group label `Snake draft` with `pick n of m` (or `draft complete`) at the right, one column per player, circle plus name, the current pick outlined, pending picks dashed. The grid is static; marking a pick on the board is the ribbon's job (D2).

### D6 · Vocabulary

- **Menus.** `MenuSelect`'s default caret is `ChevronGlyph`; the `▾` text caret and `.menu-caret` go. Every popup is the phone's bordered sheet with a check on the current option (`.menu-tick` shown everywhere) and no gold highlight. `ContextMenu` always renders the phone's sheet (radius, shadow, icons, optional tail); its `shortcut` and `shortcutKeys` fields and the `.menu-shortcut` rule go with the chords.
- **Rows and cards** share one set of states: `current` (accent-dark border, white ground) for the open board, the selected card and the current draft slot; `me` (ink border, white ground) for the claimed player. The gold pair (`#d8bc77` with `#fff9e9`), the `#c77c63` tab border and the `#fff9e9` menu highlight leave the stylesheet.
- **Text controls.** The claim picker in the context line is the ink name with a dotted accent underline and a chevron on both trees. Group labels are the phone's (`10px`, `.09em`, uppercase, count in parentheses).
- The desktop keeps its hover lift on generic buttons; the phone's `transition: none` and hover resets stay portrait-only.

### D7 · Footer

`Phase 2 · draft analysis` is deleted with its `footer` rules in both arms.

## Behaviours that are not CSS

| id | Requirement |
| --- | --- |
| DB1 | `Workspace` passes resting marks to `BoardCanvas`; a hover or a selection wins over them and a clear falls back to them. |
| DB2 | Click selects a card or the likely-gone block; hover previews only while nothing is selected; placement happens only through the `Place settlement` / `Play these out` buttons. |
| DB3 | Roster row click claims (`setMe`); swatch click toggles the piece brush (`active-player`) without claiming. |
| DB4 | In all three lists (open boards, saved maps, roster) the rename hit area is the name, not the row, and the field grows with the text (mobile B6). |
| DB5 | The open-boards list reaches `tab-select`, `tab-close`, `tab-add` and the `useRenameTab` rule. `workspaceSync.ts` and the semantics of `e2e/workspaceSync.spec.ts` are unchanged: that spec changes only where a locator named the tab strip, never its pacing. |
| DB6 | The ribbon is hidden in the landscape arm. |
| DB7 | A promoted component or rule loses the `phone-` prefix and the `.phone-shell` scope; `grep -rl "phone-" src/ui --include='*.ts' --include='*.tsx'` outside `src/ui/phone/` matches only `revealBoard.ts`. The phone e2e selectors follow the renames. |

## What already exists

Reuse by moving, never by copying.

| Behaviour | Where |
| --- | --- |
| Name-bounded in-place rename | `phone/InlineRename.tsx` → `ui/InlineRename.tsx` |
| The two-list row | `Row` inside `phone/MapsScreen.tsx` → `ui/ListRow.tsx` |
| Draft ribbon | `phone/PhoneRibbon.tsx` → `ui/DraftRibbon.tsx` |
| Snake draft grid | the grid inside `phone/PlayersScreen.tsx` → `ui/DraftGrid.tsx` |
| Resting marks | `ui/restMarks.ts` |
| Board colour | `ui/boardColor.ts` |
| Tab rename rule, library sort/open/delete/rename, JSON import and export | `useRenameTab.ts`, `useLibrary.ts`, `useJsonFiles.tsx` |
| Reorder with hold and grip, row shift | `useRowReorder.ts`, `rowDrag.ts` |
| Menus | `MenuSelect.tsx`, `ContextMenu.tsx`, glyphs in `glyphs.tsx` |
| Claim, empty state, cards | `AnalysisPanel.tsx` (the phone variant is the design) |
| Undo, redo, randomize, clear | `ToolPalette.tsx` heading; `phone/PhoneHeader.tsx` menu |

## Decisions

- **No board title over the board.** The open-boards list is the only place the active board's name shows and the only place to rename it. The site header stays as it is.
- **Tab strip actions match the phone.** Only select, close, rename and new survive; the context menu, duplicate, close-others, close-to-the-right and every chord are deleted, not relocated.
- **Library first in the left rail.** It is the document switcher and the import entry, the two things done before any tool is touched.
- **Landscape keeps its height budget.** The ribbon is hidden there; the Library panel and every other promoted surface reach it.
- **Build it by hand stays phone-only.** The desktop's tools are always on screen.
- **Desktop keeps hover previews**, layered under the phone's select-on-click, rather than dropping hover.

## Ledger

One row per work item. Keep the state column current; this file is the durable copy, not the session task list.

| id | Item | Depends on | State |
| --- | --- | --- | --- |
| D1 | Promote the list vocabulary: `InlineRename`, `ListRow`, group labels, hero import, swatch, YOU chip, hint; phone e2e follows | | done |
| D2 | Library panel replaces the tab strip and the import panel (D1 surface, DB5) | D1 | not started |
| D3 | Menus: chevron caret, tick everywhere, sheet context menu, chords and counts deleted (D6 menus, D3 count) | D2 | not started |
| D4 | Board area: ribbon promoted and mounted, resting marks, flat marks, caption trimmed, footer deleted (D2 surface, D7, DB1, DB6) | | not started |
| D5 | Tool heading glyphs, destructive Clear, counts on the tool labels (D3 surface) | D4 | not started |
| D6 | Analysis behaviour: one code path, select on click, hover preview, pill, context line, claim row, empty state (D4 surface, DB2) | D1 | not started |
| D7 | Analysis card styling promoted; desktop card rules deleted (D4 cards) | D6 | not started |
| D8 | Roster rows: grip, swatch brush, rename on name, YOU chip, claim on row, dashed Add player (D5 surface, DB3, DB4) | D1 | not started |
| D9 | Drag feel and the draft grid on desktop (D5 dragging and snake draft) | D8, D4 | not started |
| D10 | Vocabulary sweep: `current` and `me` states everywhere, gold pair gone, DB7 grep clean | D2, D3, D7, D9 | not started |
| D11 | Docs: `CLAUDE.md` ui bullet, the mobile spec's `What already exists` paths, this ledger | D10 | not started |
| D12 | Regression screenshots and acceptance verification | all | not started |

## Out of scope

The portrait shell's own layout and the `PhoneShell`, `PhoneHeader`, `PhoneOverlay`, `MapsScreen`, `PlayersScreen`, `PhoneBuild` components beyond consuming promoted pieces. The site header. The points ledger's columns and steppers. The toast. `simulator/`, `parser/`, `engine/`, `persistence/`, `workspaceSync.ts`. Phase 3. Any new dependency.
