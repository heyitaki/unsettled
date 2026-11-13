# Turn in the header, turns in seat order

Approved 2026-11-13. Mock-up (version "Final"): https://claude.ai/artifact/3kGP5rF5TnZ3LqhT9P8pR5, source in `.claude/mock/turn-strip/` (git-excluded).

## Decisions

- Record your turn always records `game.turn.playerId`. The turn-order strip (`.move-order`, `move-seat`, `selectPlayer`) and the `move-context` line under it are removed. The turn moves only through `End turn` and undo/redo. With no recorded turn and nobody claimed, the panel shows the hint plus a `Start game` primary button that records seat 1's turn (`setActivePlayer(game, board.players[0].id)`, as in `DraftRecapPanel`), replacing `Tap a player to start tracking turns`.
- Header pill once a game has a recorded turn (`game.turn` defined): an ink ring (today's `.head-dot.me` ring style) marks whose turn it is in both modes. The claimed player is not marked.
  - Outside build mode each dot is a button (`View Blue's best moves`, `aria-pressed` on the viewed one). The viewed player's dot widens into a chip in their colour with their name (Inter 700 12px, 22px tall, `readableInk` text, 1.5px ink border); other dots shrink to 15px in 22px cells. The ring wraps the chip when the viewed player is on turn. The trailing dots button opens Players.
  - In build mode the chip marks the brush player (`tab.activePlayerId`) instead of today's ring, a dot picks the brush as today, and the ring still marks the turn.
- Before any recorded turn (draft, recap) the header is unchanged: ring on the claimed player outside build mode, ring on the brush in build mode, pill opens Players.
- Viewed player: temporary store state per workspace like `viewedPick` (not persisted, not in undo). `null` means the turn player. Reset to `null` when the turn player changes (End turn, undo, redo, any commit that moves `turn.playerId`) and on tab switch.
- Best moves follows the viewed player. Viewing the turn player: today's behaviour. Viewing anyone else: heading `Best moves for Blue` (or `Best moves` when it is the claimed player), a muted line `Not Blue's turn. These are the moves Blue would make with this hand if their turn started now.` (`your turn`/`you` wording for the claimed player), the engine's `turn` ranking with that player as `observer`, no pre-roll card, no `Apply`/`Play`/`End turn` buttons; selecting a row still previews and pins its board mark. The Ledger bar, Record turn and the heading `Record Orange's turn` stay on the turn player.
- Board tools help paragraph gains one sentence at the end: `Tap a player circle at the top to place pieces for that player.`

## Work

| Item | State |
| --- | --- |
| Remove the turn-order strip; Record turn fixed to the turn player; `Start game` fallback | done |
| Header pill: turn ring, name chip, view-player buttons, build-mode chip | done |
| Store `viewedPlayer` with resets; Best moves for a viewed non-turn player | done |
| Board tools sentence | done |
| Tests: unit and e2e updated off `Turn N:` buttons; new view-player, reset and in-order tests | done |
| Specs: desktop, mobile, adviser, CLAUDE.md `turn.playerId` line | done |
