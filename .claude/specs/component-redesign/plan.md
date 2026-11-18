# Component redesign: plan

Go through every component of Unsettled one at a time, show 3 to 4 radically different options as live screenshots on an artifact, collect the owner's pick, then build every pick into `src/ui/editor.css` in one pass. Baseline is the Island look on `main` at `cff05598`.

Harness: `.claude/mock/radical/` (git-excluded) was deleted on 2026-11-17 after row 15 landed. The published artifacts keep every round of screenshots.

Rules every option keeps: same controls, actions, order, labels, copy and click or tap targets; viewport screenshots only; no new characters outside the Inter subset; icons only from `glyphs.tsx`.

## Queue

| # | Component | State | Artifact | Picked | Skin |
| --- | --- | --- | --- | --- | --- |
| 1 | Header controls (title button, player pill, pencil) | picked after three rounds (round one: owner preferred today; round two: owner asked for the pencil before the dots and the title split from them; on the pick the owner asked for even space either side of the hairline, so the pencil went back to today's 34px and the dots' left padding to 11px, about 13px each side) | https://claude.ai/artifact/FxEwiq2j5jXN6su33et1Fn | Split, 8px corners | `skins/header-splitsq.css` |
| 2 | Maps (desktop popover, phone screen) | picked after eight rounds (one: none beat today; two: Tidied, 400px wide, finished marker asked for; three: flag, faded, stage; four: corner badge; five: status in a larger hex; six: number on the colour, sharp dashed outline, bare check; seven: fine-line and flat hexes set aside; eight: semi-bold numbers lowered to centre, dashes respaced twice) | https://claude.ai/artifact/6R88Zaf2tjp5Sx8dNmbQAK | Tidied, wider, stage in the hex: ink check; a game finishes automatically once a player has won | `skins/maps-r6b.css` |
| 3 | Players (desktop popover, phone screen with the snake draft) | kept as today after round one (Tidied, Claimed row, Seat numbers): the owner found none better, and the always-visible grip dots stay because they show rows can be dragged | https://claude.ai/artifact/Ufpwip75RadpNL9BVbx86S | Today (no change) | none |
| 4 | Ledger (card and correction editor) | picked in round one (Quieter rules, Score column, Hand pills); the owner added: no rule under the last row, and the space under the last row trimmed to match the space above every heading (19.5px from card edge to text, measured; `margin-bottom: -10.5px` on a closed last row) | https://claude.ai/artifact/UanxhxdnjVwDr4TZ5E1KPg | Quieter rules, no closing rule | `skins/ledger-quietend.css` |
| 4b | Ledger column header (owner asked for a pass after the Ledger pick) | picked in round one (Small caps, Tinted band, Ledger rule) | https://claude.ai/artifact/2KwFXvHPicouapBEUdBMWL | Small caps | `skins/ledgerhead-caps.css` |
| 5 | Record your turn | kept as today after three rounds (one: Quieter steps, Ink check, Dice strip, too subtle; two: Number tokens, Step cards, Dark card; three: Cleaned up, Dice odds, Form rows, Recipe steps) | https://claude.ai/artifact/EdMdeXE9AVegS4gPGByLVq | Today (no change) | none |
| 6 | Best moves | picked "Cleaned up, tighter title, green top score" after two rounds: the desktop list moves up 6.5px so the first move sits 20px under the title like Record your turn; the top choice's score is `color-mix(in srgb, #22b14c 60%, var(--ink))` (the done-check green darkened for text contrast; the port should make it a token) | https://claude.ai/artifact/PT7dA7Uw8dt5KuSak9pMh5 | Cleaned up, tighter title, green top score | `skins/moves-green.css` |
| 7 | Best picks with the draft ribbon | picked "Cleaned up, a little wider" after three rounds (component id `bestpicks`, since `picks` is the summary page): rows as Best moves, desktop spot groups spaced 16/14/9px | https://claude.ai/artifact/4Rpit1SAwVVENtEt7dHDxB | Cleaned up, a little wider | `skins/bestpicks-wider.css` |
| 8 | Draft recap | normalized without option rounds (owner 2026-11-17: the look is settled, apply the cleaning broadly); see Normalization below | | Normalized | `skins/normalize-norm.css` |
| 9 | History with the turn bar | normalized without option rounds (owner 2026-11-17: the look is settled, apply the cleaning broadly); see Normalization below | | Normalized | `skins/normalize-norm.css` |
| 10 | Board tools | normalized without option rounds (owner 2026-11-17: the look is settled, apply the cleaning broadly); see Normalization below | | Normalized | `skins/normalize-norm.css` |
| 11 | Import dialog | normalized without option rounds (owner 2026-11-17: the look is settled, apply the cleaning broadly); see Normalization below | | Normalized | `skins/normalize-norm.css` |
| 12 | Empty-board card | normalized without option rounds (owner 2026-11-17: the look is settled, apply the cleaning broadly); see Normalization below | | Normalized | `skins/normalize-norm.css` |
| 13 | Toasts | normalized without option rounds (owner 2026-11-17: the look is settled, apply the cleaning broadly); see Normalization below | | Normalized | `skins/normalize-norm.css` |
| 14 | Board drawing (tiles, tokens, ports, pieces, rings) | normalized without option rounds (owner 2026-11-17: the look is settled, apply the cleaning broadly); see Normalization below | | Normalized | `skins/normalize-norm.css` |
| 15 | Build: port `skins/picks.css` into `src/ui/editor.css` via `/delegate`, update both specs, `/selfreview`, all gates | done 2026-11-17, uncommitted: ported by Codex; computed styles of the no-skin tour match the `picks.css` tour on every shared element; `/selfreview` fixed the green top score behind a dev card row, the stage while the board is back in the draft, the check's centring on WebKit and its ink on dark colours, live stage for open maps, recap score weight and zero tile hover; all gates green. Owner commits with `/c` | | | |

Picks so far artifact (header, Maps, Ledger; Players and Record your turn kept as today): https://claude.ai/artifact/Q6TjdbZBDMQjaDy9PVboG1 (built by `node pub/picks.mjs` from `out/tour-picks/` and `out/tour/`; the pick list is `picks.json`).

## Normalization

Rows 8 to 14 got no option rounds. One skin, `skins/normalize-norm.css`, brings them in line with the picks, measured with `COMP=normalize MEASURE=<base|norm>`:

- Section labels (History rounds, Board tools sections and counts, the recap's win-chance label) use the Ledger header's small capitals: `--glyph`, 10px, 700, .09em, uppercase.
- History rows take Best moves' treatment: rules at 55% `--line`, the current turn a flat tint behind the ink bar with no box.
- Every card keeps 19.5px from its edge to text at the top and bottom, and 17px under a button. That trims Best picks' last row (29px to 19.5px; a selected last row's buttons to 17px), sets History's `--edge-bottom` to 8px in both trees (was 17px desktop, 6px phone), and gives the Board tools footer 13px above and 17px below its buttons (was 10px each).
- The import dialog uses card padding (19.5px top, 17px sides and bottom), the card heading's 21px Georgia, and a bold 13px Done like the Board tools footer.
- Toasts, the empty-board card, the recap cards and the board drawing already matched and are unchanged.

## Notes

- Each component's options and states live in `components.json` (the walk's checkpoint names are the `at()` calls in `comp.spec.ts`). Publish `pub/<id>.html` with `root` set to the absolute `pub/` path and `files` as the list form of `pub/<id>-files.json`.
- After a pick: append that skin to `skins/picks.css`, add its line to `picks.json`, run `SKIN=picks npx playwright test -c playwright.config.ts tour.spec.ts`, then `node pub/picks.mjs` and republish `pub/picks.html` with the list form of `pub/picks-files.json`.
- A finished-game marker is a feature the owner added to the redesign. The app records no finished state, so the build needs a rule (proposed: some player's recorded VP reaches 10, the engine's win target) computed per saved map for the list, plus the chosen marker. Round five also needs each saved map's stage (not started, turn number, finished) in the listing, which today reads only names and times, and the hex drawn per stage in `BoardHexGlyph` with a contrast rule for text on dark board colours. Hidden VP cards mean the win may go unrecorded unless the final turn is entered.
- Both walks seed six saved boards (`library.ts`) so Maps reads as in use.
- Mock skins scope the phone Maps screen as `.phone-overlay[aria-label="Maps"]`; the build needs a class on that overlay if a Maps pick changes the phone header.
- `MEASURE=<option> COMP=<id>` makes `comp.spec.ts` log measurements instead of shooting: header spacing for `header`, otherwise each card's heading-text top and ink bottom (text runs, glyphs and controls) against the card edge.
- The header pick (Split) puts the pencil before the dots with CSS `order` in the mock. The build moves the pencil before the pill in `HeaderControls.tsx` so focus order matches what is on screen.
