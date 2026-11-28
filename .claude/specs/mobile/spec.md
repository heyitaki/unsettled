# Portrait phone shell: specification

What the portrait-phone UI must become. The working prototype is the normative reference for layout and interaction: **https://claude.ai/code/artifact/86ae14f6-692d-4a86-878d-f23b72bb0895** (source kept at `.claude/specs/mobile/prototype.html`). Where this file and the prototype disagree, this file wins; where this file is silent, copy the prototype.

Scope is the `@media (max-width: 760px)` arm plus the React that arm needs. **Desktop layout is out of scope** and must not regress; the shared Best picks controls in S2 and S5 apply to both trees. Width alone picks the tree: a landscape phone is wider than 760px and gets the desktop `Workspace`; a desktop window narrower than that gets this shell whatever its orientation or pointer. There is no landscape-phone arm and no tab-gated pane layout (decided 2026-09-03, when the old shared arm was found surfacing a bottom tab bar in narrow desktop windows).

## Why

Today's phone shell has a four-tab bottom nav over a single board. Three problems follow from it.

- **The tabs promise four places and there is one.** Board, Players, Picks and Library are stages of one pipeline shown as peers, so every tab looks like it might hold a different board. Users read the tab bar as a document switcher.
- **The real document switcher is unreachable.** `.board-tabs { display: none }` on phones, and nothing replaces it, so open boards cannot be listed, switched, renamed or closed from a phone at all.
- **The order is wrong.** You import in the fourth tab, edit in the first, and read your picks in the third, so a single pass through the app is a tour of the tab bar.

The panels themselves are desktop panels narrowed. The board fights for space with a fixed nav bar it does not need.

## The model

One board. One scrolling document. No bottom nav.

- The **header** is the only chrome that stays: under a brand row that scrolls away, its controls row sticks and holds the board's identity, the roster, and the two controls that change what the page below is for.
- The **page** below it is a single scroller: board, then one block that is either the analysis (which opens with the draft ribbon) or the board tools.
- **Maps** and **Players** are full-screen overlays that slide in from the right and return you to exactly where you were. They are screens you go to and come back from, not drawers that share the page.
- Only the History list (S10), capped at 440px, scrolls inside the page below the board. Nothing overflows horizontally except deliberately sideways-scrolling tool rows.

This restores the layout contract already recorded for this arm (one page scroller with the History exception in S10, a flat sea-blue page (`#3c7fbf`, the board's sea; Sand `#efe8d9` until the Island change of 2026-11-16), no sticky board) which the tab bar had been sitting on top of.

## Surfaces

### S1 · Header

Two rows. The **brand row** (the 30px brand mark and 24px Georgia `Unsettled`, the desktop site header's `Brand`) sits at the top of the page and scrolls away with it. The **controls row** under it is sticky: it rides up with the page until it meets the top of the viewport, then takes the page ground and a 1px bottom hairline once the page slides under it. Header buttons have opaque surface grounds and no visible outer border. The title is its own chip; the pencil and player pill form one joined group with a shared control shadow and 8px outer corners. Their wrapper carries the unclaimed `head-nudge` pulse as a translucent accent ring. DOM and focus order match the screen. Three things in the controls row, left to right:

1. **Board title**: the active tab's `title`, preceded by a hex in that board's colour (see B4) and followed by a chevron. The whole thing is one button that opens the Maps screen. This is the phone's document switcher. Automatic titles follow the Maps rule (S7).
2. **Pencil**: toggles build mode (S6). `aria-pressed` reflects the mode and fills it with `--accent`. It is 34px wide with its own left radius, joined directly to the player pill.
3. **Player dots**: one dot per player in roster order, then a dots button (`DotsGlyph`). The pill has rounded right corners, 11px left padding and a 1px by 18px `--line` hairline at its left edge, leaving about 12 to 13px on each side of the join. There is no divider between the player dots and the dots button, which opens Players. Once a game has a recorded turn and a finished draft, an ink ring marks the turn player in both modes, with no claim marker. Outside build mode each dot is a button named `View Blue's best moves`, pressed on the viewed player (the turn player by default), whose dot widens into the coloured name chip specified in the desktop spec's header paragraph. In build mode the chip and pressed state mark the brush player, a dot picks that player through `Place pieces for Blue`, and the ring stays on the turn player. While the draft is unfinished, outside build mode, each dot views that player's next pick in Best picks and rings the viewed player, and the dots button opens Players (desktop spec, the model). After the draft and before a recorded turn, the pill opens Players and rings the claimed player. Build-mode dots pick and ring the brush player. All other phone header sizing stays the same.
The header has no dots menu. Undo, redo, randomize and clear live in the build block (S6), and `Export JSON` in the Maps screen's file menu (S7).

### S2 · Draft ribbon

Whenever the board has tiles, a row of numbered circles opens the analysis block (S5) under its heading and above the context line, centred in the block. The circles have a 1px ink border, 1.5px on the viewed slot, that fades with a later pick's fill, an Inter 800 numeral and an ink ring. They are 30px across while the row fits and shrink together, numerals and ring included, when it does not (`--slots` on the ribbon, container query units on the slot); a shrunk row spans 92% of the block's content width, as on desktop, so it keeps side margins instead of running edge to edge. Each circle is one pick in the snake, tinted to the player who takes it. Picks already taken and the current pick are solid and later picks are faded. The ring marks the viewed pick, defaulting to the claimed player's next unplaced pick, and is absent while nobody is claimed. Each circle is a button named `Pick 3: Red` that views that pick without changing the claim; if nobody is claimed, it claims the circle's player first. A placed circle views that player's first unplaced pick, or does nothing if they have none. Every circle of the viewed player has `aria-pressed` set to true. The slots come from draft inference without analysis predictions. The viewed pick is temporary UI state, outside persistence and undo history. Changing the claim or switching boards resets the view. When viewing the earliest open pick, the view follows the draft through board edits, undo, redo and the Best picks step buttons; `Place settlement` on that pick moves the view to the next open pick. A later pick viewed on purpose stays viewed while its slot remains unplaced and is not the claimed player's next pick. The Players screen's grid keeps its current behaviour.

It leaves with the analysis block in build mode; nothing sits between the header and the board, so entering build mode does not shift the board.

### S3 · Board frame

The board sits in a sea frame with the `--radius` corners and no shadow, the same blue as the page, so it shows no edge, the full width of the pane, sharing the `--gutter` the sections below use. The SVG paint stays fixed.

- The frame is **square when the board's own content is wider than it is tall, and takes the content's proportions when it is not**: `aspect-ratio: min(1, contentWidth / contentHeight)`. Since the round port tokens, `standard4` is under 1% taller than wide, so its frame is a hair taller than square; `extension6` is clearly taller, so it gets a taller frame instead of shrinking to fit a square (which clipped its harbours).
- Content bounds include the port tokens, not just the hexes.
- No height cap. A cap makes the SVG shrink away from both gutters.

Settlements show the same `1` and `2` order numbers inside the piece as desktop while the draft is in progress. The numbers are decoration and do not intercept taps.

### S4 · Layout caption

The board has no caption line. The layout switch is the first row of the build block (S6). While zoomed, the zoom chip (scale and `Reset`) floats 10px inside the sea's top right corner, as on the desktop, so zooming moves nothing below the board.

### S5 · Analysis block

Every block below the board is a card, as on desktop: the analysis block (Best picks, the draft recap, and each section of Best moves in S10) and the build block that replaces it alike use the opaque surface (`#fbf8f1`), no border, an 8px radius, the desktop's 17px padding and the floating card shadow the desktop uses, so the cards rest on the sea. Card spacing is measured to the text: 19.5px from the edge above headings and below the final text, or 17px below a final button. Inside the cards the phone takes the desktop's values (heading size and spacing, draft ribbon spacing, help paragraph, tool button sizes and gaps, `Done` and `Cancel`) and every card heading row is the desktop's 30px, so titles sit the same distance below the card's top edge whether or not the heading has buttons; the 44px heading buttons overhang that row. It differs only where touch or the narrow screen needs it: 44px targets, sideways tool rows, ledger columns and the single page scroller. The first card sits 8px below the board (or the history bar), later ones 12px below the card before. An off-red (`#cd5037`) is the accent, `#a33d29` the dark accent, `#f3eee2` the neutral tint and `#a33428` the separate danger red. Overlays stay on the surface ground. Controls, rows, cards, panels, dialogs and sheets all use one 8px radius (`--radius`); circles and pills stay round, and the board's sea frame takes the same radius. The brand wordmark and the logo's outline are the surface cream on the sea. The brand row, the sticky header, the board and the analysis block share the `--gutter` side margin, so their edges line up. Dialog backdrops are dim without blur, and the shadow sits on the modal wrapper. Georgia headings, the Inter-first body stack and Charter number tokens stay fixed. Inter ships with the app as `src/ui/fonts/Inter.woff2`, cut down to the characters the UI prints (ASCII plus `· × − – — …`), weights 400 to 800, kerning and tabular figures; a new non-ASCII character in a UI string needs the file cut again or it falls back to the system font. Ledger column headings, tool labels and counts, History round labels and the recap win-chance label share small capitals: `--glyph`, 10px, weight 700, .09em letter spacing and uppercase. Group labels remain sentence case, muted, 12px and weight 600. Other chrome text has an 11px floor except those small-caps labels, fixed-shape badges and numerals; `YOU` and `VP` stay capitals. Buttons keep their explicit phone hover cases without lifting or cast shadows.

- Heading `Best picks`, with borderless `Step back one pick` and `Step forward one pick` icon buttons (`panel-dots`, as in the other panel headings) on the right whenever the board has tiles, including an unclaimed draft. The heading is drawn like Best moves: the title alone on the left, and the step buttons are the straight arrows (`ArrowLeftGlyph` / `ArrowRightGlyph`). A finished draft shows the draft recap and then Best moves (S10) instead, where the `Draft recap` and `Record your turn` headings hold `Undo` and `Redo`. Each heading button is 36px wide and 44px tall with no gap between them, and the last glyph's right edge sits on the block's content edge, as in the build block (S6). Back and Forward behave as on desktop (D4).
- Context line, centred: `<name> · Picking 3rd and 6th` when viewing that player's first remaining pick, or `<name> · Picking 6th` for a later one. The name menu, labelled `Whose picks to show`, views the selected player's first unplaced pick without changing the claim. It lists players with picks remaining plus the viewed player.
- Viewing a later pick, the likely-gone line, `Play these out` and `Place settlement` behave as on desktop (D4). Changing the viewed pick clears selected rows and marks and shows the loading bar, which sits just inside the top of the Best picks block, over the last ranking's blanked rows (desktop spec, placement analysis) until a matching result arrives; tapping the same view leaves them alone.
- Ranked recommendations are drawn as on desktop: rows separated by hairlines at 55% `--line` straight on the card, with no line above the first row, and the selected row a flat tint with transparent top and bottom borders and no right rule or inset shadow, reaching 9px into the card's padding on each side with its 3px ink bar on its left edge; the viewed slot in the draft ribbon keeps its ink ring, and the current slot in the Players screen's draft grid takes the accent border and ring. Each row shows a hex cluster in a 48.5px thumbnail column, a survival line in `--accent-dark` and wrapping `then` / `or` follow-up clusters beside it, and a score column. Follow-up labels and unselected scores use `--glyph`, scores at weight 600; a selected score is ink at weight 800. The first choice's score stays `color-mix(in srgb, var(--good) 60%, var(--ink))`, where `--good` is the done-step green `#22b14c`. The phone keeps its existing 10px row gap and 6px follow-up gaps; the wider desktop gaps do not reach it. Factors appear only in the selected row, below the thumbnail and body as muted text with semibold ink values. Each spot is one inline SVG of the corner's hexes in their board colours and positions, with token discs on numbered hexes (including blank hexes), a desert cactus and any port badge in its sea position; the pick uses 14px hex sides, follow-ups and Likely gone 11.5px. The likely-gone block has a solid hairline border and surface ground; loading clusters become flat tint silhouettes. Generic placeholders match the desktop ledger shape, 74px per row including its hairline, with a rank disc, thumbnail block, body bar and score block. A selected row's `Place settlement` and `Clear` follow desktop, starting at the thumbnail column; the likely-gone block's pair keeps its top hairline. The last unselected row pulls its bottom margin up 9.5px to leave 19.5px from card edge to text; a selected last row pulls up 12px to leave 17px under its buttons.
- Tapping a row draws its marks on the board **in the viewed player's colour**, with the planned second-pick circle faded behind the first-pick circle and a dashed planned road for each, and never places a piece. Each circle carries the number of that player's settlement it stands for, so a row ranking their second settlement shows `2`. Each planned road follows the edge its pick opens and is absent when that pick opens nothing or `expansionWeight` is 0. If the board has been scrolled past, tapping a row scrolls the page back to it (B2).
- When nothing is selected, all recommendations are marked at once, all solid.
- During an unfinished draft on a board with tiles, outside build mode, with no board pick active and an open pick viewed, a board tap within half a hex edge (29 board units) of a first-pick circle (a resting ranked circle, or the selected or hovered row's solid circle) places the viewed player's settlement on that circle's corner and moves the view to the earliest unplaced pick. The settlement comes with the setup road a ranking of that seat would draw for it on the board as it stands. It places only that corner, leaving the likely-gone picks unplaced. No other tap changes the board: the faded planned second-pick circle, a likely-gone circle, an unmarked legal corner and an existing piece all do nothing, and no legal-corner dots are drawn. Roads and buildings are always drawn at full strength. A tap within reach of a first-pick circle never counts towards a double tap; anywhere else a double tap zooms as usual, and pinch always zooms.

**Factor labels are one word each.** `Diversity+recipes+numbers` becomes **`Balance`** and `Starting cards` becomes **`Hand`**; `Production`, `Scarcity`, `Port`, `Robber` and `Expansion` are already one word. This is a change to `displayedFactors` in `src/ui/AnalysisPanel.tsx` and applies on desktop too.

**Empty board (B5).** When no hex on the board carries a tile, this block is replaced entirely: heading becomes `This board is empty`, followed by `Import a screenshot to read the tiles, numbers and players off it, or place them yourself.` and two stacked buttons, `Import screenshot` (filled) and `Build it by hand` (outline, enters build mode). The trigger is "no tiles", not "wrong layout", so an emptied standard board gets it too. A partly-filled board keeps the existing `no-production` message.

### S6 · Build mode

The pencil replaces the analysis block with the board tools in the same slot. The desktop does the same with the same block (desktop D3). Entering build mode arms the default taps (desktop D3), with no tool button selected; leaving build mode clears the tool. Outside build mode and with no board pick active, the board shows no placement dots and a tap changes it only through the Best picks circles, by the draft placement rule in S5; otherwise taps do nothing and double-tap zoom remains available. Everything above the block stays put, so nothing jumps.

- Layout comes first, the same two buttons as desktop (D3), each as wide as its label and packed from the left. Switching the layout there keeps build mode open, and Cancel restores the board the pencil opened on, its layout included. Then three rows: Terrain and Number token scroll sideways; `Board` fits without scrolling. The block has no Player row: the header's player dots pick the brush player for new pieces (S1). On desktop that brush is the roster row's swatch (D5, DB3); the phone roster (S8) shows a swatch but does not use it as a brush.
- `Board` has `Randomize`, `Clear pieces` and `Clear board`, each as wide as its label and packed from the left. The rows, their counts, the default taps, the dots, the help paragraph under the heading and the three confirm dialogs are the desktop's (D3), from the same component, except that a touch screen has no preview. There is no robber, port or erase tool.
- The block heading is `Board tools`, with no label above it. On its right sit three borderless icon buttons (`panel-dots`), `Undo` and `Redo` as the straight arrows, then `Close` (acts as `Done`), like the History heading. Each is 36px wide and 44px tall with no gap between them, and the last glyph's right edge sits on the block's content edge, in line with the buttons below. `Done` and `Cancel` live inside the block, in a footer strip separated by a top hairline with no tinted ground, 13px above its buttons and 17px below them.
- Randomize and both clears each ask before changing the board, with the desktop's dialogs (D3).

**Cancel needs a snapshot (B1).** Board edits commit immediately today, with undo as the way back, so Cancel currently has nothing to restore. Entering build mode must snapshot the tab's game; Cancel restores it, Done keeps it. Both leave build mode. The desktop's build mode uses the same snapshot.

### S7 · Maps screen

Automatic board titles list every player in seat order as `M/D name1, name2, ...`, using the linked map's creation date or today, without zero padding. Fresh games and rosters containing only default names use `Board N`. A name held by another open board or library map gets ` 2`, ` 3` and so on; the current tab and its own map do not compete with themselves. Each game edit recomputes automatic titles and renames the linked map without adding an undo step. Titles matching `Board <n>` or `<m>/<d> ...` are automatic, including typed titles in those forms; other typed titles stay unchanged. When falling back, an existing `Board N` stays, otherwise the first free number is chosen.

Full-screen overlay. Header: back chevron, `Maps` left-aligned, then in the right corner a plus button (`New board`, which adds a board and closes the screen) and the dots menu holding `Import JSON`, `Export JSON`, `Back up library` and `Restore library backup`. Export JSON omits photo fingerprints; library backups keep them. Backup includes current unsaved games, leaving out an unlinked board still blank. Restore merges without overwriting, skips content already restored under its name or a `name (n)` copy, and refuses to evict boards at the cap. Body, in order:

1. **`Import screenshot`**: the filled accent button with 10px padding, first on the page. It is why the screen was opened. Imported players use recognised people names while still default-named. Import as new uses the named roster's automatic title, falling back to `Board N`, while the notice keeps the file name. Update recomputes an automatic title after the merge. Photos matching within the recognition cutoff on two or more Settled pills are treated as shared placeholders and get no fingerprints. The import lands at once with its guesses and forced awards. On both trees, unresolved details replace Best picks, the draft recap or Best moves with the parsed Ledger and a separate `Finish import` card underneath it, as specified by desktop D8. The card asks unread turn order, second settlements, whether this is the first round and award holders. Second settlements sit two players per row with two tile cards each, and a choice adds that corner's starting cards after the player's name and stamps their pieces `2` and `1` on the board, as on desktop. The primary button reads `N left` and stays disabled until every asked question has an answer, then reads `Done`; it applies them and removes `Game.pendingImport` in one undo step. Skip removes only `pendingImport`, keeping the guesses. While the card is up the Ledger hides History and the board shows no Best picks circles, as on desktop. Undo returns to the unanswered card, redo reapplies the result, an edit that leaves nothing to ask drops `pendingImport`, and an open review survives reload through the persisted read. Temporary answers reset on a game change, new import or tab switch. Build mode still replaces the column. Parse issues keep the dialog open over the landed board; it has no question step. The dialog uses 19.5px top padding, 17px side and bottom padding, a 21px Georgia 700 heading at line-height 1.1 with 14px below it, and bold 13px action buttons padded 9px by 16px.
2. **`Boards (n)`** with a sort control on the right of the label: the existing four-key sort (`Last modified`, `Created`, `Last opened`, `Name`), default `Last modified`. One list: every saved map in sort order, with any open board that has no row among them (never saved, or its map missing from the listing) ahead of them. Rows: a 28px by 31px stage hex, name, relative timestamp, trash. Rows have transparent grounds and transparent 1px borders. The board on screen has the neutral tint. The trash is `--faint` at rest and `--glyph` on the current or hovered row. Before `Start game` (no `Game.turn`), or while the board has been edited back into the draft, the hex has no fill and a `--glyph` outline with `stroke-dasharray: 3.3 1.9615 2.8 1.9615`, `stroke-dashoffset: 1.65` and miter joins. In progress it keeps the board colour and centres the turn bar's current turn number, `(game.history?.turns.length ?? 0) + 1`, in Inter 600 12.5px with tabular figures and -.02em spacing, lowered .1em; text is `--ink`, or `--surface` when `readableInk(color)` selects light ink. Once any player's recorded VP, computed exactly as the Ledger's VP column, reaches 10 or more, the filled hex instead centres a 15px check (`M5.5 10.5l3 3 6-6.5`, width 2.6, round caps and joins) in the same ink as the turn number. The named `WIN_VP` constant mirrors the engine's `win_vp`; stage is derived when the cached library listing is built, with no stored flag or manual control. Invalid, unreadable or nameless entries have no stage marker. A board open in a tab shows its tab's live stage, listed or not, since the stored copy trails it by the autosave. The header hex stays unchanged.
3. **Version line** (iOS app only, `VersionLine`): one centred line of muted type at the foot of the screen, 14px above the safe area, or after the last row once the list outgrows the screen. It reads `Version <running bundle label>`, joined by ` · Update in TestFlight` while the last manifest check found an update this store build cannot take. `Update in TestFlight` is a bold accent link that opens TestFlight, with a 44px-tall tap area. The website build renders nothing.

Every board autosaves into a map (O2), so an open board and its saved map are one thing and the list shows it once. Nothing marks a map as loaded: tapping one already loaded just switches to it. An unsaved board carries no timestamp, because it has nothing saved; the timestamp answers "can I delete this?". The trash deletes the map and drops the board loaded from it in one gesture (an unsaved board is simply dropped, pending edit included). The library keeps the 50 most recently touched boards; older ones leave the list on their own, board and map together (desktop D1). Desktop spec D1 holds the store actions each row reaches.

There is no save control anywhere on this screen: boards save themselves (O2). The **name is a rename target**: tapping it opens an in-place field bounded to the name's own width, the way the roster name works (S8, B6), so a tap anywhere else on the row still selects or opens the board (O3).

This screen is the phone's document switcher, so it must reach `tab-select`, `tab-close`, `tab-add`, `tab-rename`, `renameMap`, `openMap` and `deleteMap`.

### S8 · Players screen

Full-screen overlay. Header: back chevron, `Players`, then in the right corner a plus button (`Add player`, disabled at six players). No dots menu: there is nothing to import here.

**Roster.** Label reads `Roster`, in muted 12px type at weight 600. One row per player, each row doing three things:

- **Tap the row** to claim that player as you (`setMe`). Rows have transparent grounds and transparent 1px borders. The claimed row has no tint. Only that row draws a `YOU` chip, immediately after the name inside the name cell. There are no `CLAIM` buttons: four rows each carrying the same button repeated what the label said and left nothing to distinguish the claimed row.
- **Tap the name** to rename in place. The name button is only as wide as its own text plus a few pixels, with a floor around 30px, so the rest of the row stays a claim target; the field grows with what is typed rather than filling the column. Enter commits, Escape reverts. The name carries a faint dotted underline, matching the context-line player picker, because nothing else distinguishes it from the row it sits in.
- Player names are compared trimmed and case-insensitively. A name held by another seat in this game is refused with a notice and the field reverts. Renaming a photographed Settled player assigns the photo to a permanent identity: a new name saves directly unless the current identity holds several photos; joining a different existing identity opens `Join with <name>?`, with primary `Join` followed by `Cancel`, which takes focus. Changing capitalisation within the photo's own identity updates its stored spelling. Cancel reverts without changing the game or people list. Join uses the identity's stored spelling and moves the photo from its previous identity, deleting that identity if no prints remain. A player without a photo, an unchanged name or a default name changes no identity. Default names are palette colour names or `Player <n>`, compared trimmed and case-insensitively; any default-named player can be named by photo recognition, regardless of their colour. `aki` is a real name. Undo affects the game only, and names in other games stay unchanged.

- Renaming to a new identity name when the current identity holds several photos opens `Rename <A>?` with `<A> has <n> photos.` The actions are primary `Rename everywhere`, `Only this photo`, then `Cancel`, which takes focus. `Rename everywhere` keeps all the identity's photos under the new name. `Only this photo` moves the nearest stored print to a new identity. Both commit the player name in this game; Cancel leaves the game and people list unchanged and reverts the field.
- **Press and hold, or drag the grip**, to move the row to another seat. The grip starts a drag immediately; anywhere else needs a hold, and movement past a slop threshold before the hold lands cancels it so a scroll still scrolls. The lifted row tracks the finger with no easing while the rows it passes ease out of the way.

**Snake draft.** Below the roster, the pick grid, derived from seat order.

**Seat order is draft order (B3).** Dragging a row is not tidying a list: the snake is derived from it, so `Picking 3rd and 6th` changes with the drag and the ribbon repaints. The reorder must re-run the analysis, not only repaint the roster.

The Best moves Ledger shows hands, pieces, awards and VP on both trees (O1), including before any player is active. It has the same award tie lines as desktop D8 above its column headings, with the pills on their own row, hidden while the Finish import card is up. The Players screen keeps the roster and snake draft.

### S9 · Toast

Bottom of the screen, above the safe area, with an ink ground, surface text and the shared floating shadow.

Save failures stay visible until resolved, with `Retry saving` and `Export backup` actions. A board saved again after it closed says so, and its rescued edits land as a separate board rather than over the newer save. Ordinary notices still dismiss automatically.

A quota failure clears the analysis cache and retries once before the shared `Storage is full` dialog offers closed games for deletion, as specified in [`../storage-full/plan.md`](../storage-full/plan.md). The prompt uses `ConfirmDialog` with `Clean up` (danger) followed by `Not now` (focused). It names the count and size of the games clean-up deletes: closed games unused for at least 30 days, or the five least recently used when none qualify. There are no checkboxes. Clean-up excludes maps open here or in the stored workspace, refreshes the library and retries saving. A further quota failure prompts with the next set. `Not now` keeps the prompt closed until quota failures clear; while it is closed, Maps shows a warning above `Boards (n)` with the same clean-up action. With no candidates, neither surface offers clean-up: the toast adds `Delete or export old games to make room.`, and Maps says `Your latest edits are not saved. Delete or export games to make room.` The warning goes when saving succeeds.

### S10 · Best moves

Once every starting settlement is placed the analysis block shows the draft recap (desktop D8) until `Start game` records the first turn, and then becomes Best moves: the same component and the same order as desktop D8 (the `Ledger` section, `Record your turn` with its step rail and no player picker, then `Best moves`), on the main page so the Ledger is in view while choosing a move. The Players screen stays for the roster.

The Ledger has the desktop's History toggle on its heading once `game.turn` exists. It swaps Record your turn and Best moves for the shared History panel. Rows, round labels, Now, Game start, summaries, selected production and log details, and ArrowUp/ArrowDown navigation follow desktop D8 and [`../history/plan.md`](../history/plan.md). Round labels use the shared small capitals. History rows have hairlines at 55% `--line`, no line after a round label, and a flat tint and 3px ink left bar on the selected row, with transparent top and bottom borders and no right rule or inset shadow. A past row shows the saved board pieces and Ledger with `After turn N` or `At game start`, disables board input and Ledger editing, and hides the award tie lines. The heading has the desktop's Earlier, Later and Close history buttons. The 32px board pill sits centred 8px below the board, uses 12px type, and has the same Earlier, Later and Back to now states as desktop; `Back to now` turns History off. Selecting a row calls `revealBoardIfScrolledPast`. The list scrolls internally up to 440px, with the desktop's top and bottom edge shadows while rows are hidden past either edge; its side spacing is `var(--gutter)` and its scroll end space is 8px, giving the final text the 19.5px card spacing. History closes on entering build mode. Opening History, committing, undoing, redoing or switching tabs selects Now. The view is temporary, while `Game.history` and `turn.log` persist with the game.

What differs on the phone:

- `Undo` and `Redo` in the heading follow the heading button size in S5. The header holds the turn ring and viewed-player chip (S1).
- The dice wrap into as many columns as fit at 36px or wider (eight on a 390px phone), each 4:5 like the desktop ones and so over 44px tall; the action tiles and the robber popover's buttons are at least 44px tall.
- Actions use the desktop's unframed trays, 13px weight-500 questions, labels, hints and totals, and light accent pressed state. Card choices always wrap as chips; they and resource cells are at least 44px tall. Resource counts sit beside 18px icons; corner minus buttons are 24px, positioned at top -8px and right -6px. Inside the trays nothing is solid; End turn is the step's one solid button.
- `Trade` keeps the desktop's gives, gets and lowercase `with` rows, conditional eraser Clear and wrapping partners. Exact hands show `n/N`, known plus unseen cards bound gives and player partners, and bank/port trades accept mixed whole lots that add up to the received total. The party tap records the entered cards with the same bank/port log wording.
- `Buy card` asks `Which card did you draw?` with wrapping line-art chips and full card names; one tap records. Rival purchases still record on the action tap.
- `Play card` uses the desktop's questions naming the active player, wrapping chips, robber question and hint, Year of plenty counted cells that record on the second card, and Monopoly player tiles with known-to-possible caps, minus buttons, a muted total and outlined check Record. Road building's two fixed slots are 44px tall, the last placed road has a corner minus, and the second road records; the outlined check button also records zero or one road.
- `Build` uses wrapping chips with the active player's outlined piece glyph beside the name and the cost below it, then the question and hint for the board pick. Costs remain visible without selecting a chip.
- The newest action-log entry has a curved SVG arrow and `Undo` at its right only when the newest undo entry has the same turn player and a matching log one line shorter; it uses the heading's undo and has a 36px minimum height.
- The Ledger uses columns `100px 1fr 36px 36px` with a 6px gap. Its small-caps header has 6px bottom padding and a transparent bottom border. Row rules use 55% `--line`, hidden immediately before active or open rows, with no closing rule below the last row; active and open rows have a flat tint without a box, and the active bar is inset 0 vertically. A closed last row has a -10.5px bottom margin for 19.5px from card edge to text. The open editor's tiles use surface grounds, with solid zero-tile borders at 60% `--line`. The Ledger's row editor is the only place to correct a hand on the phone. Its tiles are 68px tall, its tabs 44px and its Undo 36px.
- Best moves uses the same quiet row rules and flat selected tint as History. Scores use `--glyph` at weight 500, ink at weight 700 when selected, and the first choice stays green through `color-mix(in srgb, var(--good) 60%, var(--ink))`; reasons use `--muted`. It keeps its phone title gap and 5px vertical action-button padding, with 44px coarse-pointer targets; the desktop's 6.5px upward body shift and 4px button padding do not reach the phone.
- A build or a robber move that needs a spot scrolls the board into view, as selecting a row does (S5).

## Behaviours that are not CSS

| id | Requirement |
| --- | --- |
| B1 | Build mode snapshots the tab's game on entry; `Cancel` restores it, `Done` keeps it. |
| B2 | Selecting a recommendation whose board is scrolled out of view returns the page to the board, and only then. Use CSS `scroll-behavior: smooth` plus a plain `scrollTop` assignment; `scrollTo({behavior:'smooth'})` silently no-ops on a nested scroller in Chrome. Honour `prefers-reduced-motion`. |
| B3 | Roster order is the source of the snake draft. A reorder re-runs the analysis. |
| B4 | A board's hex colour is a pure function of its name: hash the name, index a fixed palette. The same board wears the same colour in the header and the filled stages of the board list; the not-started stage uses the unfilled outline in S7. The palette needs enough distinct hues that two boards open together do not collide: six was not enough in the prototype; ten was. |
| B5 | Empty board (`board.hexes.every(hex => hex.tile === null)`) replaces the analysis block with the two ways to fill it. |
| B6 | The roster name's hit area is the name, not the column. |
| B7 | Boards save themselves. Every edit made in this document autosaves the tab into its library map, debounced; an unlinked tab links itself to a new map on its first non-blank edit, so blank new boards never reach the library. Adopting another window's workspace never triggers a write. Undo is the way back from an unwanted change. The explicit save UI (tab-menu Save, dirty dots, save-and-close prompt, `MapsPanel` save row) goes, on desktop too. |
| B8 | The phone shell is a separate React tree mounted only while `(max-width: 760px)` matches (`usePhone`). Every wider viewport, a landscape phone included, keeps the `Workspace` tree. `MobileNav`, the pane gating and the landscape arm are gone: the workspace has no tab bar at any width. |

## What already exists

Do not rebuild these; move or restyle them.

| Behaviour | Where |
| --- | --- |
| Rename a player on name click | the name-bounded field is `InlineRename.tsx`, shared by `RosterRow.tsx` (both trees' roster rows) and `ListRow.tsx` |
| Reorder players by drag, both mouse DnD and a coarse-pointer hold, plus the grip that lifts at once | `useRowReorder.ts` + `rowDrag.ts`, `HOLD_MS`/`HOLD_SLOP`, behind `useRoster.ts`, shared by `PlayerPanel.tsx` and `phone/PlayersScreen.tsx` |
| Add and remove players | `PlayerPanel.tsx` and `phone/PlayersScreen.tsx`, `addPlayer` / drag-to-trash |
| Claim yourself | `AnalysisPanel.tsx`'s swatch claim row, the `DraftRibbon.tsx` buttons while nobody is claimed, and a click on a `RosterRow.tsx` row in either tree, all through `setMe` |
| Saved-map sort, four keys, and the open, delete and rename paths | `library.ts` and `useLibrary.ts`, under the `LibraryLists.tsx` body that `MapsPanel.tsx` and `phone/MapsScreen.tsx` both render |
| Import screenshot, import and export JSON | `ImportDialog.tsx`; `useJsonFiles.tsx`, shared by `MapsPanel.tsx` and `phone/MapsScreen.tsx` |
| Layout switch with a confirm when the board is not blank | `boardActions.tsx`, `chooseLayout` in `useBoardActions` |
| Undo, redo, randomize, clear | Undo and redo in the Board tools heading, randomize and both clears in its `Board` row; one `BoardTools` component for both trees |
| Open, delete, select, rename boards | the board list in `LibraryLists.tsx` (rows are `ListRow.tsx`), `useLibrary.ts` and `store.ts` (`tab-*` actions) |
| Board rename rule: `renameMap` when linked, tolerating a map deleted elsewhere, then `tab-rename` | `useRenameTab.ts`, called from `LibraryLists.tsx` |
| Library autosave (B7): debounced per tab, links an unlinked tab on its first non-blank edit, never writes a game that arrived with its tab (adopted, opened, imported, duplicated) | `libraryAutosave.ts`, wired from `StoreProvider` in `store.ts` |
| Toast | `GlobalNotice.tsx`, rendered by both `Workspace` and `PhoneShell` |
| Snake draft grid and ribbon, both off the slot derivation in `draftSlots.ts` | `DraftGrid.tsx` with `DraftLabel` under `phone/PlayersScreen.tsx`; `DraftRibbon.tsx` inside `AnalysisPanel.tsx` in both trees |

## Decisions

Resolved 2026-09-02.

**O1 · Points ledger: replaced by the Best moves Ledger.** The tally columns and view switch are gone from desktop Players too. The Best moves Ledger shows hands, pieces, awards and VP on both trees, with corrections in its row editor and tied award holders in its tie lines. It also shows before any player is active. The Players screen carries the roster (no VP column, owner 2026-11-12) and snake draft. Under its title, as under the desktop Players panel's heading, a muted `tool-hint` line reads `Assign yourself a player by selecting the corresponding row. Drag rows to reassign turn order. Tap on a player name to rename them across all games with the same imported profile picture.` (desktop says `Click on a player name`). M10 is dropped.

**O2 · Saving: automatic (B7).** No save control on the phone or on the desktop. Every edit autosaves the tab into its map; the first non-blank edit of an unlinked tab creates the map and links the tab. The desktop tab menu's `Save to library`, the dirty dots, the save-and-close prompt and the `MapsPanel` name field and button are removed.

**O3 · Renaming: tap the name.** On the Maps screen the name in a board row is a rename target bounded to its own width, exactly like the roster name (B6). The rest of the row selects or opens. An unsaved board's rename goes through `tab-rename`; a saved map's rename goes through `renameMap` and the library refresh retitles any tab linked to it.

**M2 · Two trees, split by width (B8).** The phone shell is its own tree that never mounts the site header; it shows the brand through its own row (S1). `MobileNav` and the pane gating were kept for landscape phones at first and deleted on 2026-09-03; landscape phones now get the workspace.

## Ledger

One row per work item. Keep the state column current; this file is the durable copy, not the session task list.

| id | Item | Depends on | State |
| --- | --- | --- | --- |
| M1 | Copy the prototype to `.claude/specs/mobile/prototype.html` | | done |
| M2 | Phone widths mount a separate `PhoneShell` tree (B8); `MobileNav` and pane gating deleted | | done |
| M3 | Build the header (S1): title button, joined pencil and dots cluster | M2 | done |
| M4 | Board colour hash (B4) and the hex in the header and the board list (stage hex, S7) | | done |
| M5 | Draft ribbon in the analysis block (S2) | M2 | done |
| M6 | Board frame proportions (S3) and the trimmed layout caption (S4) | M2 | done |
| M7 | Maps overlay (S7): import first, open boards, saved maps, in-place rename (O3), JSON behind the dots | M3, M4, M16 | done |
| M8 | Players overlay (S8) roster: claim on row, rename hit area (B6), reorder | M3 | done |
| M9 | Seat order drives the draft (B3) | M8 | done |
| M10 | Points ledger block in the Players overlay | | dropped (O1) |
| M11 | Build mode replaces the analysis block (S6), with the snapshot Cancel (B1) | M3 | done |
| M12 | Empty-board state (B5) | M6 | done |
| M13 | Reveal-on-select scroll (B2) | M6 | done |
| M14 | One-word factor labels in `displayedFactors` | | done |
| M15 | Landscape and desktop regression pass | all | done |
| M16 | Library autosave in the store (B7) | | done |
| M17 | Retire the explicit save UI on desktop: tab-menu Save, dirty dots, save-and-close prompt, `MapsPanel` save row (B7) | M16 | done |
| M18 | Board tools rework on the phone (S1, S4, S5, S6); tracked as D14 to D20 in the desktop spec | | done 2026-10-12 |
| M19 | Board tools without `Other tools`: `Board` row, counts, help paragraph, default taps, no dice in the heading (S6); tracked as D21 to D24 in the desktop spec | | done 2026-10-13 |

## Out of scope

Landscape phone. Desktop layout, which now follows [`.claude/specs/desktop/spec.md`](../desktop/spec.md) (B7 and the S5 factor labels change desktop behaviour deliberately). Phase 3 boons and curses.
