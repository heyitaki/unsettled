# Desktop workspace: specification

What the desktop (and, through the shared `Workspace` tree, landscape phone, which is wider than the 760px phone arm) UI must become so it carries the design decisions the portrait phone settled in [`../mobile/spec.md`](../mobile/spec.md). Read that file first: its Surfaces, Behaviours and Decisions are the design; this file says what of it reaches the desktop, what the desktop keeps that the phone dropped, and how the two trees share code afterwards. Where this file is silent, the phone's rendering is the reference: `e2e/phoneShell.spec.ts` produces screenshots of every phone surface under `test-results/phone/`.

Scope is `src/ui/` outside `src/ui/phone/`, the base rules of `src/ui/editor.css`, and the phone files only where a surface is promoted out of them. **The portrait shell must not regress**: every phone e2e test stays green and phone screenshots preserve the layout except for the shared Best picks controls in D4.

## Why

The phone shell was built to a design that fixed decisions the desktop still contradicts: one-word factor pills and autosave already reached both, but the board colour, the claim-on-row roster, the rename-on-name lists, import as the first action, the empty-board state, menus with a check on the current option, and the flat marks in the claimed colour all stopped at the portrait arm. The desktop also keeps two things the phone showed to be wrong: a tab strip as the document switcher (the phone folded open boards into the Maps screen, and landscape phones have had no document switcher at all since the strip was hidden there) and a separate import panel two panels away from the library that receives the import. Desktop and phone share one flat Sand page (`#efe8d9`) and off-red accent (`#cd5037`). Panels have an opaque surface (`#fbf8f1`), a hairline border (`#ddd3bf`), a 14px radius and no shadow. The neutral tint is `#f3eee2`, ink is `#2d2924`, muted text is `#776f64`, the dark accent is `#a33d29`, and danger is `#a33428`. Controls use 6px radii, rows and cards 10px, and panels, dialogs and sheets 14px; circles and pills stay round. Cast shadows belong only to floating menus, dialogs, dragged rows, notices and tally tooltips. The toast uses an ink ground and surface text on both trees. Georgia headings, the Inter-first body stack, Charter number tokens and all board SVG paint stay fixed.

## The model

One `Workspace` tree for every viewport wider than 760px (mobile spec B8 holds). It has no tab bar and no pane gating at any width: the old `MobileNav` arm and the landscape side rail were deleted on 2026-09-03. Left rail: Board tools, then Library. Centre: the board, whose sea is the SVG's own box with the panels' 14px corners, with the layout menu in its top left corner. Right rail: Players (roster and points ledger), then Best picks with the draft ribbon under its heading. No tab strip and no footer. The site header is the 38px by 36px brand mark and a 32px Georgia `Unsettled` wordmark (the phone keeps the smaller pair), with a 12px bottom margin and a 16px top padding floor. Above 1120px the three columns sit side by side and the board is sticky; at 1120px and below the right rail wraps under the board as two equal columns and the board scrolls with the page, since Chromium bounds a sticky grid item by the whole grid and a pinned board would ride over the rail.

Everything the phone and the desktop both render is one component with one stylesheet rule. A phone surface that reaches the desktop is promoted: its component moves out of `src/ui/phone/` into `src/ui/`, its CSS moves out of the portrait arm into the base rules, and both lose the `phone-` prefix. The portrait arm keeps only the rules that differ on a phone. Anything still phone-only (`PhoneShell`, `PhoneHeader`, `PhoneOverlay`, the overlays, `PhoneBuild`, `buildMode.ts`, `revealBoard.ts`) keeps its name, its place and its prefix.

## Surfaces

### D1 · Library panel

Replaces the tab strip, the `Import & export` panel and the `Saved maps` panel with one panel in the left rail under Board tools, the desktop's version of the phone's Maps screen (S7). It is the only place a board's name shows and the only place to switch, rename, open, delete or create one.

- **Heading**: h2 `Maps`, and at the right a plus button (`PlusGlyph`, `aria-label="New board"`, `tab-add`) then a dots button (`DotsGlyph`, `aria-label="Import and export files"`) opening a `ContextMenu` with `Import JSON`, `Export JSON`, `Back up library` and `Restore library backup`, through `useJsonFiles`. Backup includes current unsaved games, leaving out an unlinked board still blank. Restore merges without overwriting, skips content already restored under its name or a `name (n)` copy, and refuses to evict boards at the library cap.
- **`Boards (n)`** group label with the four-key sort `MenuSelect` at its right (`SortGlyph` caret, `SORT_OPTIONS`, default `modifiedAt`), then the library warning when it applies, then the one list. Every edited board saves itself into a map, so open and saved are one thing and the list shows it once: first any open tab with no row among the maps (never saved, or linked to a map the listing cannot show: deleted in another window before the store caught up, or an unreadable library), then every saved map in sort order. The row of the board on screen is `current`, whichever kind it is; nothing else marks a map as loaded. Each row: hex (`boardColor(name)`), name, meta, trash (`TrashGlyph`, `aria-label="Delete <name>"`). A saved map's meta is the relative timestamp for the current sort key (`3 m ago`, no `LAST MODIFIED` prefix; `corrupt` for an invalid map); an unsaved board has none. The row switches to the board (`aria-label="Switch to <name>"`): `tab-select` for an unsaved board, `openMap` for a map, which selects the tab linked to it when one exists and loads the map into a new tab otherwise, silently either way unless the load raised board warnings. An invalid map's row is disabled. The name renames in place: `useRenameTab` for an unsaved board, `renameSavedMap` for a map (the library refresh retitles the linked tab). The trash on an unsaved board is `tab-close { discard: true }`; on a map it is `deleteSavedMap`, which deletes the map and, once that write has landed, closes the tab linked to it the same way. Discard is what keeps the autosave's rescue write for a closing tab from putting the board straight back as a new map, whether it was an unsaved board edited inside the debounce or a map just deleted. The library holds at most `MAX_MAPS` (50) maps: a new map beyond that evicts the least recently touched (newest of created, modified and opened), never the one just saved nor one this document still owes a write to, with a toast saying how many went, and the autosave closes the tab linked to an evicted map with discard so it cannot list as unsaved and re-save itself past the cap. The list keeps its bounded scroller with the fade masks on desktop, bounded by its own max-height so a long library never runs the rail off the page; the phone arm unbounds `.board-list` for the phone's overlay, where the one scroller is the page, never a list inside it.
- **Rows** are the phone's rows: same columns, 34px tall under a fine pointer and the phone's 44px otherwise, name bounded to its own text (mobile B6, O3). The phone Maps screen renders the very same `ListRow` component.
- **Nothing from the tab strip survives beyond select, close, rename and add.** Duplicate, Close others, Close to the right, the right-click and long-press menu, and the F2 / ⌘D / ⌘W / ⌥⌘W chords are deleted with `BoardTabs.tsx` and `shortcuts.ts`. `copyTitle` and `nextCopyName` in `boardFiles.ts` go with them.
- Landscape phones get this panel in the left rail like any other workspace viewport, which gives them the document switcher they have lacked.

### D2 · Board area

- **Resting marks** (S5): while nothing is selected the board wears every listed recommendation's first pick, ranked, in the claimed colour, ranks four and up faded. `Workspace` passes `restingMarks(board, analysis)` to `BoardCanvas` exactly as `PhoneShell` does. Marks are drawn flat everywhere: the phone's `vertex-highlight` sizing and no cast shadow become the base rule; the desktop's red defaults go.
- **Settlement order**: during the draft, each settlement has a cream badge with a dark ring and `i` or `ii`, numbered per player from building array order. Imported and hand-placed settlements use the same badges. They are decoration, ignore pointer events and are hidden from the accessibility tree. Badges disappear when the draft is complete.
- **Layout caption**: `4 player ⌄` with `ChevronGlyph`. On desktop it is bare white text, with no ground or border, floating in the sea's top left corner, where no tile or port reaches, and the zoom chip floats in the top right corner while the board is zoomed; neither takes a row of its own, so the board gets that height. On the phone it stays a bare line centred under the board. The `19/19 terrain` and `4 pieces` counts leave the caption. `BoardCanvas` no longer consults `usePhone`.
- The desktop board stage has no background, border, shadow or padding, and the canvas has no drop shadow. The sea is the stage. Above 1120px the canvas is capped at `calc(100vh - 110px)`, reserving the shell padding, header, margin, status row and zoom control within the viewport. The 1120px arm keeps `max(320px, calc(100dvh - 130px))`. The phone sea frame uses a 14px radius without a shadow.

### D3 · Board tools

- The heading is `Board tools`, with one dots button (`DotsGlyph`, `aria-label="Board options"`) opening the phone header's menu without its `Export JSON` row: `Undo` and `Redo` as the history pair on top, then `Randomize board` and `Clear board` (destructive), each with its glyph. The four round buttons go.
- **`Import screenshot`**: the filled accent hero button (`ImportButton`), full width, first in the body under the heading; opens `ImportDialog`. The phone keeps the same button at the top of its Maps screen (S7).
- The screenshot dialog keeps keyboard focus inside, closes on Escape and restores the opener's focus. Imported players are named by colour, and the highlighted pill claims the player to move. Names can be edited in Players.
- The tool rows sit under the import button in a native `<details>` whose summary reads `Edit manually`, closed on load. While it is closed no tool is active: `ToolPalette` drops the store's tool on mount and whenever the rows fold away, so a board click never paints with a tool nobody can see. The summary is a 36px target, 44px under a coarse pointer. The phone's build block is unchanged.
- The counts the caption lost move to the tool labels, right-aligned and muted: `Terrain` carries `12/19`, `Structures` carries `4 pieces`. They render inside `ToolGroups`, so the phone's build block shows them too.
- The phone's dots menu prints `Undo` and `Redo` with no stack-depth count (S1). `ContextMenuItem.count` is deleted.

### D4 · Analysis panel

One code path for every pointer; the `coarse` branch and the `variant` prop go.

Placement analysis runs in a shared worker. A changed board shows `Analyzing placements…` until its result arrives, with no old cards or predicted marks. A failed worker offers `Retry analysis`. Board editing and navigation remain available.

- **Selecting a card** (click or tap) pins its marks in the claimed colour, first pick solid, planned second faded, road stub when present, and opens `Place settlement` / `Clear` under it; clicking the selected card again deselects. **Hovering** a card with a fine pointer previews its marks only while nothing is selected; leaving the list restores the resting marks. The likely-gone block behaves the same way with `Play these out` / `Clear`. A click never places a piece directly.
- **Heading** `Best picks`, with round `Step back one pick` and `Step forward one pick` icon buttons on the right whenever the board has tiles, including an unclaimed draft. A finished draft shows Best moves (D8) instead, whose heading holds `Undo` and `Redo`. Back removes the last snake picker's last settlement and its touching roads owned by that player, falling back to the last settlement in board order when that picker has none. It is disabled with no settlements, any upgraded building, or more settlements than draft picks. Forward restores the removed pick and roads. Each step is an ordinary board edit; the local forward list survives player claims while the building and road arrays stay identical, and is discarded by a piece edit, a tab switch, or store undo/redo. Forward is disabled when that list is empty or invalid. **Context line** `<picker> · Picking 3rd and 6th`, with the same player picker and ordinal pick numbers.
- **Draft ribbon**: under the heading whenever the board has tiles, centred with space above the context or claim row. Each numbered circle claims its player, with `aria-pressed` reflecting the claim and no visible mark on that player's picks. Its title and accessible name read `Pick 3: Red`. Clicking an already claimed player does nothing. Taken picks are solid, later picks faded, and the current pick ringed; ribbon slots come from draft inference without analysis predictions.
- **No player claimed**: the hint `Tap your colour and the ranking starts` (desktop: `Pick your colour and the ranking starts`) and a row of swatch buttons, one per player, that claim on click. The `choose player` placeholder goes.
- **Empty board** (mobile B5): heading `This board is empty` and the hint `Import a screenshot to read the tiles, numbers and players off it, or place them yourself.` The `Import screenshot` and `Build it by hand` buttons render only when the panel is given `onBuild`, which only the phone shell supplies; on the desktop the import button and the `Edit manually` fold over the tools are already on screen in the left rail.
- **Cards** are the phone's: rank circle in the claimed colour with an ink ring, the triple in Inter, the score in ink, survival as plain accent text, flat tinted factor chips. The selected card uses an accent border and a 1px accent ring. Factor pills use the neutral tint without a border, and availability text uses `--accent-dark`.

### D5 · Players panel

The roster is the phone's roster (S8) plus the tally the desktop keeps (mobile O1).

Below the roster, `Award holders` opens Longest road and Largest army selectors when anyone qualifies. Only tied leaders can be chosen. Imported ties start as `Unknown`, while a recorded incumbent keeps a tie. Corrections share game undo, redo and persistence.

- **Heading**: h2 `Players`, and at the right a plus button (`PlusGlyph`, `aria-label="Add player"`), disabled at six players.
- **Row**, left to right: grip (`GripGlyph`, starts a drag at once), swatch (24px, the player's colour), name, `YOU` chip (visible on the claimed row, an invisible placeholder on the others so columns hold), the tally columns and VP under the existing tally bar with its view switch. The awards pill keeps its place beside the name.
- The name is the row's only flexing cell, so every fixed cell added to its right comes straight out of it, and it must never be squeezed to nothing: the right rail's floor and ceiling both carry the `YOU` column's width, the tally and the row gap narrow across the whole three-column arm (the rail reaches its ceiling around 1300px and the workspace caps at 1580px, so a width threshold would only take the pixels back off the name as the window grows), and the name clips inside its cell rather than keeping the phone's 30px floor and overflowing onto the chip.
- **Clicking the row claims** that player (`setMe`); the claimed row is `me` (neutral tint, transparent 1px border). The claim is the phone's row-wide `list-row-select` button rather than a handler on the row, so it is reachable by keyboard and carries the claimed state (`aria-pressed`); the grip, swatch, name, tally and VP are positioned to paint over it and keep their own clicks and tooltips. **Clicking the swatch toggles the piece brush** (`active-player`), carried by `aria-pressed` with no ring on the swatch: the Structures tools take the brush player's colour, and the brush does not tint the row. The roster has no hand or dev card steppers: the Best moves table's row editor (D8) is the one place to correct them.
- **Clicking the name renames in place** (`InlineRename`, dotted underline at rest in the phone shell and on a coarse pointer, and only on hover or keyboard focus with a fine pointer, the field bounded to the text, Enter commits, Escape reverts, `renamePlayer` on commit rather than on every keystroke).
- **Dragging**: the rows the lifted row passes ease out of the way (`rowShift`) and the mid-drag trash row removes. The lifted row has an opaque surface ground and the shared floating shadow. Fine pointers keep `useRowReorder`'s HTML5 path, where the browser's own drag image follows the pointer and the lifted row instead eases into the slot it would land in, so the list previews the order it will commit to; on a hold the lifted row tracks the finger with no easing. Every offset derives from `dragId` and `dropTarget`, which both paths supply.
- The native drag is aimed and dropped on the **list**, not on the rows: a row under the pointer has already moved out from under it, and the gap a row leaves behind is bare list, which would refuse the drop. Both paths therefore resolve the destination with `dropIndexFor` against the layout measured when the drag started.
- **Snake draft**: the ribbon lives in Best picks (D4). The named grid and its `DraftLabel` stay on the phone's Players screen; the desktop roster already names every seat.

### D6 · Vocabulary

- **Menus.** `MenuSelect` uses `ChevronGlyph` and a check on the current option. Every popup is an opaque surface sheet with a hairline border, 14px radius and the shared floating shadow. `ContextMenu` hangs from its top-right corner as a plain sheet with icons. Dialogs use the same surface, border and radius, with a plain dim backdrop. The shadow sits on `.modal-dialog`, and on `.port-popover`, which mounts in its own backdrop rather than through `ModalDialog`.
- **Rows and cards.** Library and roster rows have transparent grounds and transparent 1px borders. The open board (`current`) and claimed player (`me`) use the neutral tint, as does a non-current library row on fine-pointer hover. Cards retain a surface ground and a hairline border. Selected analysis cards and the selected likely-gone block use an accent border with a 1px accent ring. The current slot in the draft ribbon keeps its ink ring over a surface gap. The likely-gone block has a solid hairline border and surface ground, and placeholders use the neutral tint. Action strips have a top hairline without a tinted ground.
- **Text controls.** The claim picker in the context line is the ink name with a dotted accent underline and a chevron on both trees. Tool and group labels are 12px, weight 600, muted and sentence case. A group label carries its count in parentheses (`Boards (n)`); a tool label carries its count right-aligned (`12/19`). Panel and dialog headings stand alone, without a label above them. Chrome text has an 11px floor except fixed-shape badges and numerals. `YOU` and `VP` stay capitals. Terrain and structure grids each have three columns on desktop. The solo-roster notice is muted; the snake-mismatch warning keeps the danger red.
- Buttons stay still on hover and transition only background colour, border colour and text colour. Generic desktop buttons take the neutral tint; primary and hero-import buttons take `--accent-dark`. Filled controls use white text on the red accent; the ones that have a border take the accent for it. A selected tool is not filled: it has an accent border with a 1px accent ring over a 14% accent wash, deepening to 22% on hover. Number-token buttons wear the board's token face (cream `#f4eacf`, ink ring), and the selected one swaps the ring for the accent. Delete and erase controls and warnings use the separate danger red. Phone buttons keep only their explicit hover cases.

### D7 · Footer

`Phase 2 · draft analysis` is deleted with its `footer` rules in both arms.

### D8 · Best moves

Once every starting settlement is placed the analysis panel becomes Best moves, in both trees from one component. It tracks the game turn by turn for every player and advises whoever's turn it is. The behaviour behind it (what the advice reads, what each recorded action does to hands) is in [`.claude/specs/adviser/spec.md`](../adviser/spec.md); this section is the surface. The approved mock-up is https://claude.ai/artifact/ChDoUgMJR5yt7VYgDWJbLo.

Top to bottom:

- **Heading**: a muted 12px label `Your turn` / `Red's turn` over the title `Best moves`, and round `Undo` and `Redo` buttons on the right in place of the pick step buttons. They are the store's undo and redo, drawn as straight arrows (`ArrowLeftGlyph` / `ArrowRightGlyph`). Stepping a draft pick back is an undo, or a piece erased with the board tools.
- **Turn order** replaces the draft ribbon: one numbered circle per player in seat order, tinted to the player, the active player ringed. A circle is a button named `Turn 2: Red`; clicking it makes it that player's turn, so the advice and the action bar are theirs. Nothing marks the claimed player here.
- **Context line**, centred: the active player's name and what the last recorded action did (`Rolled 8 · aki +2 wheat +1 ore · Red +1 wheat`), or `not rolled yet`.
- **Table**: one row per player, the active row tinted. A two-way switch picks the view. `Cards`: the five resources, the hand total and the dev card count; a resource is a number when known and a range (`1–3`) while the player holds cards nobody saw. `Points`: settlements, cities, road length, knights, VP cards and the total, with a star on each award holder. Under the table, `Your dev cards` lists the claimed player's cards by type and their VP cards, as chips in three plainly different states: a playable card is ink on white with an ink ring, a kind you hold none of is muted on the paper tint, and a card bought this turn is a faded grey outline with no fill and no label until it can be played. Clicking a row opens stepper chips under the table to correct that player by hand: resources, unseen cards and dev cards, and for the claimed player the dev cards by type.
- **Action bar**, labelled `Record your turn` / `Record Red's turn`: `Roll`, `Trade`, `Build`, `Buy dev card`, `Play dev card`, `End turn`, three to a row. Each acts for the active player. Choosing one opens its controls in a tray under the bar; choosing it again closes the tray. `Roll` reads `Rolled 8` once rolled.
  - `Roll`: eleven totals in one row, seven outlined in the accent. A total commits at once. A seven keeps the tray open: every player holding more than seven cards gets a line with their count and a `Record` button (the advised cards for the claimed player; `discards 4, types not seen` with an `Enter types` alternative for a rival), then the robber line: for the claimed player the advised hex and victim with `Show` to mark it and a `Stole` resource picker, for a rival a prompt to tap the hex and pick who was robbed.
  - `Trade`: `With` (the bank at the player's rate, each port they own, or another player), what they give and what they get, each a count and a resource. When the claimed player is the one answering and the trade is one or two cards of one resource for one card of another, the tray shows `Advice for you: Accept` or `Decline` with the margin and the reason. `Record trade` commits.
  - `Build`: road, settlement or city with its cost, then a click on the spot on the board.
  - `Buy dev card`: the cost, a `Drew` picker when the claimed player is buying, `Record`.
  - `Play dev card`: the card, then its own inputs: the robber move for a Knight, two road spots for Road Building, two resources for Year of Plenty, and for Monopoly the resource plus how many each other player gave.
  - `End turn` commits at once and moves the ring to the next seat.
- **Recommendations**, labelled `Your best moves` / `Best moves for Red`. Before the roll, one dashed card titled `Before you roll` holds the dev card to play or `Hold`. After it, ranked cards in the Best picks card style: rank circle in the active player's colour, the action, the policy's raw score, a one-line reason, and the cost as chips while selected. Selecting a card pins its mark on the board under the Best picks select, pin and hover rules and opens `Apply` / `Clear`. `Apply` commits when the advice is the whole fact (a build, a bank trade, a discard, Year of Plenty); `Pass` reads `End turn`; otherwise it opens the matching action with the advice filled in (`Apply: who accepted?`, the `Drew` picker, the `Stole` picker). During a seven the list is replaced by a hint to record the discards and the robber first.
- **Notes**, small and muted: `Dev deck: 14 left`, `Bank estimated: 6 cards of unknown type`, `2 of Red's cards are of unknown type and ignored`, `Super cities count for production and points but are never suggested`. A note appears only when it applies.

Every recorded action is one commit, so one undo takes back the piece and the cards together. Advice comes from a worker and never runs during render; while a changed game is pending the old cards disappear, as in Best picks. A robber destination is marked by a dashed ring on its hex, the one board mark this panel adds.

The Players panel shows the same game read-only: the table's row editor is the only place hands, dev cards, knights and VP cards are edited.

## Behaviours that are not CSS

| id | Requirement |
| --- | --- |
| DB1 | `Workspace` passes resting marks to `BoardCanvas`; a hover or a selection wins over them and a clear falls back to them. |
| DB2 | Click selects a card or the likely-gone block; hover previews only while nothing is selected; placement happens only through the `Place settlement` / `Play these out` buttons. |
| DB3 | Roster row click claims (`setMe`); swatch click toggles the piece brush (`active-player`) without claiming. |
| DB4 | In both lists (boards, roster) the rename hit area is the name, not the row, and the field grows with the text (mobile B6). |
| DB5 | The board list reaches `tab-select`, `tab-close`, `tab-add` and the `useRenameTab` rule. `workspaceSync.ts` and the semantics of `e2e/workspaceSync.spec.ts` are unchanged: that spec changes only where a locator named the tab strip or the old open-boards list, never its pacing. |
| DB6 | The ribbon renders inside Best picks on desktop and landscape whenever the board has tiles, never in the Players panel or over the board. |
| DB7 | A promoted component or rule loses the `phone-` prefix and the `.phone-shell` scope; `grep -rl "phone-" src/ui --include='*.ts' --include='*.tsx'` outside `src/ui/phone/` matches only `revealBoard.ts`. The phone e2e selectors follow the renames. |

## What already exists

Every row below has been moved; the paths are where each piece lives now.

| Behaviour | Where |
| --- | --- |
| Name-bounded in-place rename | `ui/InlineRename.tsx` |
| The board row, and the one list around it | `ui/ListRow.tsx` inside `ui/LibraryLists.tsx`, rendered by `ui/MapsPanel.tsx` and `phone/MapsScreen.tsx` |
| Draft ribbon | `ui/DraftRibbon.tsx`, mounted by `ui/AnalysisPanel.tsx` in both trees |
| Snake draft grid and its label | `ui/DraftGrid.tsx` (`DraftGrid` and its `DraftLabel`, mounted by `phone/PlayersScreen.tsx`) |
| Resting marks | `ui/restMarks.ts` |
| Board colour | `ui/boardColor.ts` |
| Board rename rule, library sort/open/delete/rename, JSON import and export | `useRenameTab.ts`, `useLibrary.ts`, `useJsonFiles.tsx` |
| Reorder with hold and grip, row shift | `useRowReorder.ts`, `rowDrag.ts` |
| Menus | `MenuSelect.tsx`, `ContextMenu.tsx`, glyphs in `glyphs.tsx` |
| Claim row, empty state, select-on-click cards | `AnalysisPanel.tsx`, one code path for both trees |
| Undo, redo, randomize, clear | `ToolPalette.tsx` heading; `phone/PhoneHeader.tsx` menu |

## Decisions

- **No board title over the board.** The board list is the only place the active board's name shows and the only place to rename it. The site header keeps only the brand.
- **Tab strip actions match the phone.** Only select, close, rename and new survive; the context menu, duplicate, close-others, close-to-the-right and every chord are deleted, not relocated.
- **Board tools first in the left rail, Library under it.** Board tools opens with the import entry, the usual way a board arrives, and folds the hand tools behind `Edit manually`. The Library is the document switcher.
- **Landscape phones are plain workspace viewports.** They scroll the page like a short desktop window; nothing is gated behind a pane.
- **The empty-board buttons stay phone-only.** The desktop's import button and its `Edit manually` fold are always on screen.
- **Desktop keeps hover previews**, layered under the phone's select-on-click, rather than dropping hover.

## Ledger

One row per work item. Keep the state column current; this file is the durable copy, not the session task list.

| id | Item | Depends on | State |
| --- | --- | --- | --- |
| D1 | Promote the list vocabulary: `InlineRename`, `ListRow`, group labels, hero import, swatch, YOU chip, hint; phone e2e follows | | done |
| D2 | Library panel replaces the tab strip and the import panel (D1 surface, DB5) | D1 | done |
| D3 | Menus: chevron caret, tick everywhere, sheet context menu, chords and counts deleted (D6 menus, D3 count) | D2 | done |
| D4 | Board area: resting marks, flat marks, caption trimmed, footer deleted (D2 surface, D7, DB1, DB6) | | done |
| D5 | Tool heading glyphs, destructive Clear, counts on the tool labels (D3 surface) | D4 | done |
| D6 | Analysis behaviour: one code path, select on click, hover preview, pick step buttons, context line, claim row, empty state (D4 surface, DB2) | D1 | done |
| D7 | Analysis card styling promoted; desktop card rules deleted (D4 cards) | D6 | done |
| D8 | Roster rows: grip, swatch brush, rename on name, YOU chip, claim on row, Add player plus in the heading (D5 surface, DB3, DB4) | D1 | done |
| D9 | Drag feel and the draft ribbon in Best picks (D5 dragging, D4 ribbon) | D8, D4 | done |
| D10 | Vocabulary sweep: `current` and `me` states everywhere, gold pair gone, DB7 grep clean | D2, D3, D7, D9 | done |
| D11 | Docs: `CLAUDE.md` ui bullet, the mobile spec's `What already exists` paths, this ledger | D10 | done |
| D12 | Regression screenshots and acceptance verification | all | done |
| D13 | Best moves panel (D8); tracked as A9 and A10 in `.claude/specs/adviser/spec.md` | D6 | not started |

## Out of scope

The portrait shell's own layout and the `PhoneShell`, `PhoneHeader`, `PhoneOverlay`, `MapsScreen`, `PlayersScreen`, `PhoneBuild` components beyond consuming promoted pieces. The points ledger's columns. The toast. `simulator/`, `parser/`, `engine/`, `persistence/`, `workspaceSync.ts`. Phase 3. Any new dependency.
