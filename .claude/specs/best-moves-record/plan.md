# Best moves: record-your-turn overhaul

Approved 2026-11-12. Mock-up: https://claude.ai/artifact/FXTAEV92eXLhZYSo7qsRSs (source `.claude/mock/best-moves/mock.src.html`, git-excluded). The owner chose direction C (turn steps) with B's action tiles, with four edits: the current step's circle gets a bold border and no outer ring, the 7 aligns with the other dice, a finished step is a bright green disc with a solid white tick, and the action tiles use carefully drawn line icons with regular-weight labels.

## Design

**Two top-level sections**, each its own panel, in both trees:

1. `Record your turn` / `Record Red's turn` (heading keeps Undo and Redo): turn order, context line, table, then a three-step rail.
2. `Best moves`: the `Your best moves` / `Best moves for Red` label, the recommendations, and the notes. The `Dev deck: N left` and `Super cities count for production…` notes are gone.

**The rail.** Three numbered circles joined by a hairline. A finished step is a bright green (`#22b14c`) disc with a white tick. The current step has a 2.5px ink border. A later step has a faint border and muted text.

- **1 · Roll.** Eleven dice buttons in one row (two rows of six on the phone), each with the pip dots under its number. The 7 is outlined in the accent and has an empty pip row so its number lines up. One tap records the roll. Once rolled the step folds to `Rolled 8` plus the production summary and a `Change` button. During a seven the discard lines and the robber prompt sit under the folded step.
- **2 · Actions.** A hint (`a dev card can come before the roll` before the roll, `any order, as many as happened` after). Under it is a log of this turn's recorded actions, derived so that undo removes entries. Below that are the action tiles: `Trade`, `Buy dev card`, `Play dev card` (only when the player can play one: a typed playable card for the claimed player, a public dev card count for a rival, and never after a dev card was played this turn) and `Build structure`. They are glyph-over-label tiles with regular-weight text. A selected tile gets an accent border over a light accent fill. A tile opens its tray below the tiles, and tapping it again closes it.
- **3 · End turn.** One full-width primary button.

**Trade, party last.** The gives row and the gets row are five resource buttons each. A tap adds one card and shows a count badge, and `Clear` resets both rows. `With`: `Bank 4:1` / `Port 3:1` / `Port 2:1`, using the player's best rate for the one resource given, is enabled when exactly one resource is given and one is received. It records `rate × gets` at that rate and ignores the tapped give count. Each other player is enabled when both rows have cards, and tapping them records the trade. When the claimed player is not the trader and each row holds one resource, the accept or decline verdict for the claimed player shows. Advice that opens a trade fills both rows, so a single tap on who accepted records it.

**Buy dev card.** For a rival, the tile records at once. For the claimed player, a `You drew` row opens and a tap records it.

**Play dev card.** The kinds row (only the typed playable kinds for the claimed player, all four for a rival):

- **Knight** starts the robber flow.
- **Road Building** records on the second road tap, with a button to record fewer.
- **Year of Plenty** records on the second resource tap.
- **Monopoly**: a resource, then a count per player prefilled with what is known of their hand, then `Record`.

**Robber (seven and Knight).** While the hex pick is live, every number token except the robber's pulses, and with reduced motion it shows a static accent ring instead. A tap on the robber's own hex is ignored. When the claimed player is the one moving the robber, the advised hex gets its dashed ring automatically and a line names the suggested hex, the victim and the reason. When a hex is tapped:

- **No candidates** (players other than the mover with a building on one of its corners and cards in hand): the move records at once.
- **Otherwise:** a popover anchored at the hex lists the candidates (swatch, name, card count) and `Nobody`.
- **Stolen card:** a five-resource row follows (with `Back`) only when the claimed player is the robber or the victim. Otherwise, tapping a name records it.

## Second round of owner edits (2026-11-12)

- The roll's production summary shows each producing player as a swatch bubble, the name and each resource icon, followed by its count when above one. The context line shows only `Rolled N`.
- `Change` is an icon-only pencil button (`Change roll`).
- The Actions step has no hint text.
- The tiles are larger (30px glyphs, more padding), and each glyph is centred on the grid.
- A tile shows only when its action can happen:
  - Trade: the player holds cards.
  - Buy dev card: the player could afford one (the known shortfall is no more than their unseen cards) and the deck is not known to be empty.
  - Build structure: some piece is both affordable and has a legal spot, and its tray lists only those pieces.
- After the roll, with nothing possible, Actions folds to done as `No actions possible`.
- `Change roll` works all turn (owner, 2026-11-12): it recommits the pre-roll snapshot, striking the roll and later actions from the log; Undo restores them. Production sits on its own line under `Rolled N`. Action tiles are chips in one row (`Trade`, `Buy card`, `Play card`, `Build`; owner chose option C of https://claude.ai/artifact/NeMSVUQoK7sLpMsBe2Ysnw), switching to option B's equal icon-over-label tiles only where the chips would wrap.
- Undo of a robber move must bring the robber flow back. Its pending state is `turn.robberMoved === false` in the turn record (set by a seven's roll, cleared by the robber move), so it survives a reload and the history cap.
- Discards come first: the robber hex pick arms only once every discard line is recorded or skipped. No action tile shows while a seven's robber is pending.
- A dev card bought this turn cannot be played (`turn.devBought`). Both new turn fields are left out of the advice request.

## Queue

| # | Item | State |
|---|---|---|
| 1 | Mock-up of three directions; owner picked C with edits | done |
| 2 | Codex packet: panel, trays, rail, robber popover, blinking tokens, glyphs, CSS, unit tests | done (Codex session 01a1d140-0ba2-7000-872d-eca33cc5185e, worktree `.claude/worktrees/best-moves-record`) |
| 3 | Review the Codex diff; fix rounds | done: review, one Codex fix round, then inline fixes (seven copy, robber banner, Clear, tile columns) |
| 4 | Update desktop D8, mobile S10, the CLAUDE.md super-city note line | done |
| 5 | Run the e2e Best moves specs (the Codex sandbox cannot) | done: 97 e2e and 3 production checks pass in the worktree |
| 6 | Port the worktree diff onto main over the other session's uncommitted `editor.css` | done: applied to main's working tree uncommitted, `editor.css` three-way merged over the other session's edits; typecheck and unit tests pass on main |
| 7 | `/selfreview`, screenshot beside the mock | done: screenshot matches; review found 9 issues plus the Buy flicker, owner approved all |
| 8 | Self-review fixes: robber state into the turn record (`robberMoved`, `devBought`, stripped from advice requests), discards before the robber pick, same-resource player trade, log and production in a `WeakMap`, Monopoly cap, undo/redo closes trays, Year of Plenty re-pick, section spacing, last known deck count, test gaps | done: Codex fix round 2 plus inline Year of Plenty fix (same resource twice stays allowed; `Clear` drops the first), cleanup pass, ported to main; worktree has 1063 unit and 97 e2e passing, main typecheck and 916 unit passing |
