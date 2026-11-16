# Import questions

After a screenshot parses, the import lands at once and the analysis column asks only what the screenshot could not show: the parsed Ledger, and under it a `Finish import` card (first built as `Import questions`), in place of Best picks, the draft recap or Best moves until the card is answered or skipped. Approved by the owner 2026-11-15 ("looks good. current award dialogs can be moved into here"); moved out of the import dialog into the column the same day ("we can see the imported board as well as the currently parsed ledger and the import questions are in a separate component under the ledger").

## Decisions

- Ask only what is unknown. A screenshot that leaves nothing open imports exactly as before.
- The import lands as `settleImport(game, read, {})` (guesses plus the award holders the points settle), carrying `Game.pendingImport`: the screenshot's read in the game's player ids, persisted and validated like the game's other optional fields. The card shows while `pendingImport` is set and `importQuestions(game, pendingImport)` still has questions, on both trees, in `AnalysisPanel` ahead of its other branches; build mode still replaces the column as usual.
- `Done` is enabled once every question has an answer, and commits `settleImport` with the answers and without `pendingImport` as one undo step. `Skip` (owner 2026-11-15: keep it, for an answer the user does not know) commits the same game without `pendingImport`, keeping the guesses. Undo brings the card back with its questions unanswered, since the previous game still carries `pendingImport` (owner 2026-11-15); redo re-applies.
- Parse issues still keep the import dialog open over the landed board, as before; the dialog has no question step.
- **Second settlement**: asked per player whose two settlements' order was not read, and only while the board is in draft shape (every building a settlement, at most two per player). Past the draft nothing reads the order. A Settled screenshot reads it from the (ii) badge mid-draft; a finished draft or any Colonist screenshot does not.
- **Turn order**: Settled pills show it, never asked. Colonist shows the seating cycle but not who went first: ask `Who went first?`, which rotates the seats. With no roster read at all (synthesized from pieces), ask for the whole order by tapping players in turn. Changing the order while in draft shape re-snakes the buildings, keeping each player's own first and second.
- **Awards**: the screenshot's points per player, minus their building points, say how many awards (0, 1 or 2) each holds. Every holder pair (Longest road from its tied candidates or nobody when none qualify; Largest army from its knight candidates when knights were read, otherwise anyone or nobody) consistent with those surpluses is kept. An award with one consistent holder is applied silently; with several it is asked, its options narrowed by the other award's answer. With no consistent pair (a misread), fall back to asking among the tied candidates, never asking Largest army when knights were unread. A Settled Largest army holder gets knights raised to at least 3. An award already recorded with a holder is never asked.
- **Update path**: only awards are asked, since `mergeScreenshot` keeps the saved seat order and building order whenever the screenshot did not show them. The update commit carries `pendingImport` when an award is open.
- The Ledger's award tie lines are hidden while the card is up and stay for mid-game ties, which main's ledger corrections log (owner 2026-11-15, reversing the earlier removal at merge). The parser warnings these questions replace are removed: Settled's `Could not determine settlement order for X`, Colonist's `The order of each player's two settlements could not be told` and `The first player could not be told; players are listed in panel order`.

## Queue

| # | Item | State |
| --- | --- | --- |
| 1 | Test contract for `src/ui/importQuestions.ts` | done |
| 2 | Parser: `ScreenshotRead` gains `unorderedPicks`, `points`, `knights`; drop the three replaced warnings | done |
| 3 | `importQuestions.ts`: `importQuestions` and `settleImport` | done |
| 4 | `ImportDialog` question step, both trees; remove Ledger tie lines and their tests | done |
| 5 | Desktop and mobile specs updated | done |
| 6 | Review, e2e, screenshots artifact for the owner (dialog version) | done (https://claude.ai/artifact/AEkmyTAJaV7xRghvEiiT76); owner asked for the column card instead |
| 7 | Move the questions from the dialog into an `Import questions` card under the Ledger, with `Game.pendingImport`, Done gated on every answer, Skip, undo bringing the card back; specs updated | done |
| 8 | Review, e2e, refresh the screenshots artifact at the same URL | done |
| 9 | Second-settlement layout: owner picked option J (2026-11-15) from https://claude.ai/artifact/SiD62XKNLXryRDkrBKB9d9: players two per row, two tile cards each, no player border, chosen card outlined, starting cards after the name, board stamps 2 and 1, Done reads `N left`. Prototype switch removed; specs updated | done |
| 10 | `/selfreview` fixes approved 2026-11-15 ("fix all"): card renamed `Finish import`; no Best picks circles or draft taps under the card; award pills never lock (a conflicting pick clears the other answer); History hidden under the card; partly read knights; who-went-first limited to seats the pieces allow; second-pick swap re-deals starting cards through `withBoard`; VP cards out of the award surplus; Colonist roster with pieces-only players asks the whole order; long names ellipsize; stale `pendingImport` dropped when nothing is left to ask; dead `.tie-line` assertions removed (restored with the tie lines) | done |
| 10b | Merge into main, push | done: c36f1d0f, rebased onto main's ledger corrections with tie lines restored |
| 11 | iOS store build (`ota/native-epoch` is 2): `ios:archive`, `ios:upload`, push the tag | not started; confirm timing with the owner after merge |
