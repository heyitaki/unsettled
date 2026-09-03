# Desktop workspace — specification

What the desktop (and, through the shared `Workspace` tree, landscape phone) UI must become so it carries the design decisions the portrait phone settled in [`../mobile/spec.md`](../mobile/spec.md). Read that file first: its Surfaces, Behaviours and Decisions are the design; this file says what of it reaches the desktop, what the desktop keeps that the phone dropped, and how the two trees share code afterwards. Where this file is silent, the phone's rendering is the reference: `e2e/phoneShell.spec.ts` produces screenshots of every phone surface under `test-results/phone/`.

Scope is `src/ui/` outside `src/ui/phone/`, the base and landscape arms of `src/ui/editor.css`, and the phone files only where a surface is promoted out of them. **The portrait shell must not regress**: every phone e2e test stays green and every phone screenshot stays the same in substance (selectors may change with class names, pixels do not).

## Why

The phone shell was built to a design that fixed decisions the desktop still contradicts: one-word factor pills and autosave already reached both, but the board colour, the claim-on-row roster, the rename-on-name lists, import as the first action, the empty-board state, menus with a check on the current option, and the flat marks in the claimed colour all stopped at the portrait arm. The desktop also keeps two things the phone showed to be wrong: a tab strip as the document switcher (the phone folded open boards into the Maps screen, and landscape phones have had no document switcher at all since the strip was hidden there) and a separate import panel two panels away from the library that receives the import. One stylesheet now holds two visual systems, a gold-highlight desktop one and the phone's, and every shared component carries a `phone` branch.

## The model

One `Workspace` tree for desktop and landscape (mobile spec B8 holds; the portrait shell is untouched). Left rail: Library, then Board tools. Centre: the board in its paper stage with the layout caption under it. Right rail: Players (roster, then the draft ribbon), then Best picks. No tab strip and no footer. The site header is the brand mark and `Unsettled`, with no subtitle.

Everything the phone and the desktop both render is one component with one stylesheet rule. A phone surface that reaches the desktop is promoted: its component moves out of `src/ui/phone/` into `src/ui/`, its CSS moves out of the portrait arm into the base rules, and both lose the `phone-` prefix. The portrait arm keeps only the rules that differ on a phone. Anything still phone-only (`PhoneShell`, `PhoneHeader`, `PhoneOverlay`, the overlays, `PhoneBuild`, `buildMode.ts`, `revealBoard.ts`) keeps its name, its place and its prefix.

## Surfaces

### D1 · Library panel

Replaces the tab strip, the `Import & export` panel and the `Saved maps` panel with one panel at the top of the left rail, the desktop's version of the phone's Maps screen (S7). It is the only place a board's name shows and the only place to switch, rename, open, close or create one.

- **Heading**: eyebrow `Library`, h2 `Maps`, and at the right a dots button (`DotsGlyph`, `aria-label="Import and export files"`) opening a `ContextMenu` hung from the button with `Import JSON` and `Export JSON` (`ImportGlyph`, `ExportGlyph`), through `useJsonFiles`.
- **`Import screenshot`**: the filled accent hero button, full width, first in the body; opens `ImportDialog`.
- **`OPEN BOARDS (n)`** group label, then one row per open tab: the board's colour hex (`boardColor(title)`), its title, a close `×` (`XMarkGlyph`, `aria-label="Close <title>"`, `tab-close`). The row selects (`tab-select`); the name renames in place through `useRenameTab`. The active tab's row is `current`. Below the rows a dashed `New board` row (`PlusGlyph`, `tab-add`).
- **`SAVED MAPS (n)`** group label with the four-key sort `MenuSelect` at its right (`SortGlyph` caret, `SORT_OPTIONS`, default `modifiedAt`), then the library warning and the empty-state hint when they apply, then one row per map: hex (`boardColor(name)`), name (renames through `renameSavedMap`), the relative timestamp for the current sort key as plain meta (`3 m ago`, no `LAST MODIFIED` prefix; `corrupt` for an invalid map), a trash (`TrashGlyph`, `deleteSavedMap`). The row opens the map (`openMap`); an invalid map's row is disabled. The saved-maps list keeps its bounded scroller with the fade masks on desktop, bounded by its own max-height so a long library never runs the rail past the tools; the portrait arm's existing unbounding of `.saved-maps` continues to apply to the phone's overlay, and the landscape arm unbinds it too. A landscape pane is only about 342px tall, so a capped list would fill it and its contained overscroll would leave no surface to scroll the pane by, stranding the heading, `Import screenshot` and the open boards above it. In both phone arms the one scroller is the pane or the page, never a list inside it.
- **Rows** are the phone's rows: same height, same columns, name bounded to its own text (mobile B6, O3). The phone Maps screen renders the very same `ListRow` component.
- **Nothing from the tab strip survives beyond select, close, rename and add.** Duplicate, Close others, Close to the right, the right-click and long-press menu, and the F2 / ⌘D / ⌘W / ⌥⌘W chords are deleted with `BoardTabs.tsx` and `shortcuts.ts`. `copyTitle` and `nextCopyName` in `boardFiles.ts` go with them.
- Landscape phones get this panel in their Library pane, which gives them the document switcher they have lacked; the landscape arm's `.board-tabs { display: none }` rule is deleted as dead.

### D2 · Board area

- **Resting marks** (S5): while nothing is selected the board wears every listed recommendation's first pick, ranked, in the claimed colour, ranks four and up faded. `Workspace` passes `restingMarks(board, analysis)` to `BoardCanvas` exactly as `PhoneShell` does. Marks are drawn flat everywhere: the phone's `vertex-highlight` sizing and no cast shadow become the base rule; the desktop's red defaults go.
- **Layout caption**: `4 player layout ⌄` with `ChevronGlyph`, centred under the board on both trees (the stage no longer clips, so the menu can open below it); the `19/19 terrain` and `4 pieces` counts leave the caption. `BoardCanvas` no longer consults `usePortraitPhone`. The zoom chip stays.
- The board stage keeps its desktop frame (paper panel, sea rect, drop shadow); the phone's square sea frame stays portrait-only.

### D3 · Board tools

- The heading carries one dots button (`DotsGlyph`, `aria-label="Board options"`) opening the phone header's menu without its `Export JSON` row: `Undo` and `Redo` as the history pair on top, then `Randomize board` and `Clear board` (destructive), each with its glyph. The four round buttons go.
- The counts the caption lost move to the tool labels, right-aligned and muted: `Terrain` carries `12/19`, `Structures` carries `4 pieces`. They render inside `ToolGroups`, so the phone's build block shows them too.
- The phone's dots menu prints `Undo` and `Redo` with no stack-depth count (S1). `ContextMenuItem.count` is deleted.

### D4 · Analysis panel

One code path for every pointer; the `coarse` branch and the `variant` prop go.

- **Selecting a card** (click or tap) pins its marks in the claimed colour, first pick solid, planned second faded, road stub when present, and opens `Place settlement` / `Clear` under it; clicking the selected card again deselects. **Hovering** a card with a fine pointer previews its marks only while nothing is selected; leaving the list restores the resting marks. The likely-gone block behaves the same way with `Play these out` / `Clear`. A click never places a piece directly.
- **Heading** `Draft analysis` / `Best picks` with the `Your turn` pill at the right when it is your turn. **Context line** `You are <picker> · picking X and Y of N`; the desktop's `· pick N of M, whose turn` tail goes.
- **No player claimed**: the hint `Tap your colour and the ranking starts` (desktop: `Pick your colour and the ranking starts`) and a row of swatch buttons, one per player, that claim on click. The `choose player` placeholder goes.
- **Empty board** (mobile B5): heading `Nothing to rank yet` / `This board is empty` and the hint. The `Import screenshot` and `Build it by hand` buttons render only when the panel is given `onBuild`, which only the phone shell supplies; on the desktop both the import and the tools are already on screen in the left rail.
- **Cards** are the phone's: rank circle in the claimed colour with an ink ring, the triple in Inter, the score in ink, survival as plain accent text, flat tinted factor chips. The selected card uses the `current` state. The desktop rules for the accent-red rank, the Georgia score, the blue survival pill and the bordered 8px factor pills go.

### D5 · Players panel

The roster is the phone's roster (S8) plus the tally the desktop keeps (mobile O1).

- **Heading**: eyebrow `Points ledger`, h2 `Players`. The `+` button in the heading goes; a dashed `Add player` row sits under the roster, disabled at six players.
- **Row**, left to right: grip (`GripGlyph`, starts a drag at once), swatch (24px, the player's colour), name, `YOU` chip (visible on the claimed row, an invisible placeholder on the others so columns hold), the tally columns and VP under the existing tally bar with its view switch. The awards pill keeps its place beside the name.
- The name is the row's only flexing cell, so every fixed cell added to its right comes straight out of it, and it must never be squeezed to nothing: the right rail's floor and ceiling both carry the `YOU` column's width, the tally and the row gap narrow across the whole three-column arm (the rail reaches its ceiling around 1300px and the workspace caps at 1580px, so a width threshold would only take the pixels back off the name as the window grows), and the name clips inside its cell rather than keeping the phone's 30px floor and overflowing onto the chip.
- **Clicking the row claims** that player (`setMe`); the claimed row is `me` (ink border, white ground). The claim is the phone's row-wide `list-row-select` button rather than a handler on the row, so it is reachable by keyboard and carries the claimed state (`aria-pressed`); the grip, swatch, name, tally and VP are positioned to paint over it and keep their own clicks and tooltips. **Clicking the swatch toggles the piece brush** (`active-player`), shown as an accent ring on the swatch (`aria-pressed`), and the resource steppers keep expanding under the brush player's row. The brush no longer tints the row.
- **Clicking the name renames in place** (`InlineRename`, dotted underline at rest, the field bounded to the text, Enter commits, Escape reverts, `renamePlayer` on commit rather than on every keystroke).
- **Dragging**: the rows the lifted row passes ease out of the way (`rowShift`) and the mid-drag trash row removes. The desktop's faded-card drag look goes. Fine pointers keep `useRowReorder`'s HTML5 path, where the browser's own drag image follows the pointer and the lifted row instead eases into the slot it would land in, so the list previews the order it will commit to; on a hold the lifted row tracks the finger with no easing. Every offset derives from `dragId` and `dropTarget`, which both paths supply.
- The native drag is aimed and dropped on the **list**, not on the rows: a row under the pointer has already moved out from under it, and the gap a row leaves behind is bare list, which would refuse the drop. Both paths therefore resolve the destination with `dropIndexFor` against the layout measured when the drag started.
- **Snake draft**: under the roster, where the strip was, the phone's ribbon (S2) promoted to `DraftRibbon` under the group label `Snake draft` with `pick n of m` (or `draft complete`) at the right (`DraftLabel`, shared with the phone's grid): one circle per pick, taken solid, later faded, current ringed, own picks dotted, click marks the pick's placed or predicted vertex. The phone's named grid (`DraftGrid`) stays on the phone's Players screen; the desktop roster already names every seat.

### D6 · Vocabulary

- **Menus.** `MenuSelect`'s default caret is `ChevronGlyph`; the `▾` text caret and `.menu-caret` go. Every popup is the phone's bordered sheet with a check on the current option (`.menu-tick` shown everywhere) and no gold highlight. `ContextMenu` always renders the phone's sheet (radius, shadow, icons), hung from its top-right corner with a tail, since every caller is a dots button near the right edge; its `shortcut`, `shortcutKeys` and `separated` fields, the `align`/`tail` props and the `.menu-shortcut` and `.separated` rules go with the chords and the tab menu.
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
| DB6 | The ribbon renders inside the Players panel on desktop and landscape, never over the board. |
| DB7 | A promoted component or rule loses the `phone-` prefix and the `.phone-shell` scope; `grep -rl "phone-" src/ui --include='*.ts' --include='*.tsx'` outside `src/ui/phone/` matches only `revealBoard.ts`. The phone e2e selectors follow the renames. |

## What already exists

Every row below has been moved; the paths are where each piece lives now.

| Behaviour | Where |
| --- | --- |
| Name-bounded in-place rename | `ui/InlineRename.tsx` |
| The two-list row, and the two lists around it | `ui/ListRow.tsx` inside `ui/LibraryLists.tsx`, rendered by `ui/MapsPanel.tsx` and `phone/MapsScreen.tsx` |
| Draft ribbon | `ui/DraftRibbon.tsx`, mounted by `ui/App.tsx` and `phone/PhoneShell.tsx` |
| Snake draft grid and its label | `ui/DraftGrid.tsx` (`DraftGrid`, mounted by `phone/PlayersScreen.tsx`; `DraftLabel`, also over the desktop ribbon in `ui/PlayerPanel.tsx`) |
| Resting marks | `ui/restMarks.ts` |
| Board colour | `ui/boardColor.ts` |
| Board rename rule, library sort/open/delete/rename, JSON import and export | `useRenameTab.ts`, `useLibrary.ts`, `useJsonFiles.tsx` |
| Reorder with hold and grip, row shift | `useRowReorder.ts`, `rowDrag.ts` |
| Menus | `MenuSelect.tsx`, `ContextMenu.tsx`, glyphs in `glyphs.tsx` |
| Claim row, empty state, select-on-click cards | `AnalysisPanel.tsx`, one code path for both trees |
| Undo, redo, randomize, clear | `ToolPalette.tsx` heading; `phone/PhoneHeader.tsx` menu |

## Decisions

- **No board title over the board.** The open-boards list is the only place the active board's name shows and the only place to rename it. The site header keeps only the brand.
- **Tab strip actions match the phone.** Only select, close, rename and new survive; the context menu, duplicate, close-others, close-to-the-right and every chord are deleted, not relocated.
- **Library first in the left rail.** It is the document switcher and the import entry, the two things done before any tool is touched.
- **Landscape keeps its height budget.** Nothing new sits over its board; the ribbon rides in the Players pane, and the Library panel and every other promoted surface reach it.
- **The empty-board buttons stay phone-only.** The desktop's import and tools are always on screen.
- **Desktop keeps hover previews**, layered under the phone's select-on-click, rather than dropping hover.

## Ledger

One row per work item. Keep the state column current; this file is the durable copy, not the session task list.

| id | Item | Depends on | State |
| --- | --- | --- | --- |
| D1 | Promote the list vocabulary: `InlineRename`, `ListRow`, group labels, hero import, swatch, YOU chip, hint; phone e2e follows | | done |
| D2 | Library panel replaces the tab strip and the import panel (D1 surface, DB5) | D1 | done |
| D3 | Menus: chevron caret, tick everywhere, sheet context menu, chords and counts deleted (D6 menus, D3 count) | D2 | done |
| D4 | Board area: ribbon promoted and mounted, resting marks, flat marks, caption trimmed, footer deleted (D2 surface, D7, DB1, DB6) | | done |
| D5 | Tool heading glyphs, destructive Clear, counts on the tool labels (D3 surface) | D4 | done |
| D6 | Analysis behaviour: one code path, select on click, hover preview, pill, context line, claim row, empty state (D4 surface, DB2) | D1 | done |
| D7 | Analysis card styling promoted; desktop card rules deleted (D4 cards) | D6 | done |
| D8 | Roster rows: grip, swatch brush, rename on name, YOU chip, claim on row, dashed Add player (D5 surface, DB3, DB4) | D1 | done |
| D9 | Drag feel and the draft grid on desktop (D5 dragging and snake draft) | D8, D4 | done |
| D10 | Vocabulary sweep: `current` and `me` states everywhere, gold pair gone, DB7 grep clean | D2, D3, D7, D9 | done |
| D11 | Docs: `CLAUDE.md` ui bullet, the mobile spec's `What already exists` paths, this ledger | D10 | done |
| D12 | Regression screenshots and acceptance verification | all | done |

## Out of scope

The portrait shell's own layout and the `PhoneShell`, `PhoneHeader`, `PhoneOverlay`, `MapsScreen`, `PlayersScreen`, `PhoneBuild` components beyond consuming promoted pieces. The points ledger's columns and steppers. The toast. `simulator/`, `parser/`, `engine/`, `persistence/`, `workspaceSync.ts`. Phase 3. Any new dependency.
