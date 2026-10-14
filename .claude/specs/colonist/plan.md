# Colonist.io screenshot source

A second screenshot source beside Settled, approved 2026-10-13. Work happens on branch `colonist-parser`.

The screenshots are not in the repo: Colonist's terms require credit on published screenshots and the repo is public, so they live in the ignored `fixtures/colonist.local/` and `src/parser/__tests__/colonist.test.ts` skips when that folder is absent. Its expected boards were read by eye from the screenshots, so a changed expectation is re-read by eye, never regenerated from parser output.

| # | Item | State |
| --- | --- | --- |
| 1 | Pick the source in `parseScreenshot`: Settled first, Colonist whenever the Settled path yields no board (Settled's palette check accepts some Colonist screens, so it cannot be the switch), Settled's error when both fail | done |
| 2 | Colonist terrain: tiles, number tokens, robber, harbours, at four window sizes, in both Display P3 and sRGB, and at half resolution (a 2x2 average standing in for a 1x display) | done |
| 3 | Colonist pieces: roads, settlements and cities in red, blue, orange and green, players synthesized from the colours found, buildings in snake shape with a warning that Colonist does not show which of a player's two settlements came first | done; the test holds nine screenshots' pieces read by eye |
| 4 | Colonist player panel: players and colours from the rows, the viewer claimed, hand sizes, development cards and knights into the stats, victory points cross-checked against buildings. The panel is rotated to put the viewer last, so the first player is worked out only mid-draft (from settlement counts, or the lit row when they are level) and otherwise panel order is kept with a warning | done; the test holds nine screenshots' panels read by eye |
| 5 | Catch `CLAUDE.md` and the import dialog's wording up with the second source | done |
| 6 | Full test suite, self-review, and one import of a Colonist screenshot through the app's own dialog | done 2026-10-14: suite green, the dialog import checked, the review's twelve findings (rows 7 to 18) fixed and the cleanup pass applied |
| 7 | An update from a screenshot that could not tell turn order keeps the saved seat order (`ScreenshotRead.order`) | done |
| 8 | An update from a screenshot that could not tell pick order keeps the saved order of buildings (`ScreenshotRead.picks`) | done |
| 9 | A rival row hidden in the Colonist panel is an `unreadable` roster issue | done |
| 10 | `labelComponents` clamps an inverted x range instead of throwing | done |
| 11 | Colonist tiles and numbers are checked against the standard counts; a mismatch is `unreadable` | done |
| 12 | Dev card and knight issues carry no player id as `ref` | done |
| 13 | Colonist pieces and boards use the app's key order | done |
| 14 | Colonist is tried first when `isColonistScreen` holds | done |
| 15 | First-player inference only when every player's points equal their settlement count | done |
| 16 | A board whose vertex windows leave the image is refused | done |
| 17 | Panel digits share the token hole counter and its size floor; no 40% height assumption; the lit row is sampled over several pixels | done |
| 18 | Tests: digit-colour cross-check, the two smallest half-resolution cases cover pieces and panel, damaged-image cases for rows 9, 11, 15, 16 | done |

Known limits, kept on purpose until someone needs more:

- Four-player boards only. No 5 to 6 player screenshot exists to test against. A three-player game on the four-player board would always be flagged as missing a panel row and never get its first player worked out; no such screenshot exists either.
- The nine harbours are taken to sit on fixed edges, as they did on all four boards captured.
- No screenshot has a blue or orange city, or a viewer in a colour other than red.
- Only the four free seat colours are known. A piece in a paid member's colour (white, purple and others) would be missed without a warning until a screenshot of one exists.
- A screenshot update of a saved game (`mergeScreenshot`) still keeps the saved development card and knight counts, as it must for Settled, although Colonist shows them.
- Tiles and numbers are checked against the base game's counts, so a Colonist custom map or a variant would be flagged as unreadable.
- The viewer's own cards along the bottom are not read; only the hand size is.
- A frame caught mid-animation is read as it looks: `b-03` shows a settlement still flying to its corner and a road under a points ribbon, so that settlement and road are missed. The import says so only through the warning that the victory points disagree with the buildings.
- Settled's pick order counts as shown only when every two-settlement pair was ordered by its badges, so an update from a post-draft Settled screenshot now keeps the saved building order.
- No real 1x capture exists; the half-resolution tests use a 2x2 average of a 2x capture.
