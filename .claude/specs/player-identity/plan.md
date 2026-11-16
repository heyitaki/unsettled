# Player identity by profile photo

Approved 2026-11-15. The Settled parser fingerprints each pill's profile photo; a name the user gives a photographed player becomes a permanent, unique identity that names that face in every later import.

## Decisions

- **Fingerprint**: the photo disc in each Settled pill (about 64px across on a 3x phone screenshot), found by scanning the pill's middle row from 0.55 to 1.5 pill heights past its left edge for pixels that differ from the pill fill, so a highlighted pill's thicker border does not shift it. The square inscribed at 1.3 × radius is averaged into an 8×8 RGB grid and stored as a hex string. Distance is the mean absolute difference per value (0 to 255).
- **Cutoff 20.** Measured on the four Settled fixtures, which show the same five people across games: the same person scores 0 to 11 (11 when one pill is the highlighted turn pill or the image is scaled to 2/3), different people never under 33.
- **Blank photos** (almost no variation across the grid, such as a placeholder before the photo loads) get no fingerprint.
- **Where it lives in a game**: optional `Game.avatars`, player id to fingerprint. Not on `Player`, so the board JSON, board fixtures and the Rust engine stay unchanged; `engineRequest` strips it beside `history`. `withBoard` drops entries for players no longer on the board. `mergeScreenshot` takes the screenshot's fingerprint for matched players.
- **People list**: a permanent localStorage key `unsettled.people.v1`, an array of `{ name, prints: string[] }`. Names are unique, compared trimmed and case-insensitively. Written through `storeKey` and listed in `MIRRORED_KEYS`, so the iOS app also keeps it in a Library file. Corrupt data is kept under a `.corrupt` key like the other stores. Included in the library backup; restore merges by name and unions prints.
- **Import**: a player still carrying any default name takes the name of the identity whose closest print is under the cutoff. Applied to the parsed game on import as new. An Update merges the unnamed parsed game first, then names only default-named players in the merged game so saved names stay reserved. Two players in one game resolving to one identity both keep their default names.
- **Rename** (`useRoster`, the one path for desktop and phone): a rename to a name another seat in the same game already has is refused with a notice and the name reverts. For a player with a fingerprint, the rename assigns that photo to the named identity: a new name creates an identity or asks which photos to rename when the current identity has several; an existing identity other than the photo's current one asks first ("Join with X?", `ConfirmDialog`), and a refusal reverts the rename. When one photo moves to another identity, its nearest stored print leaves the previous identity, which is deleted when it has no prints left. A player without a fingerprint, an unchanged name (rename commits on blur) or a default name renames as before, with no list change. The list does not follow undo.
- Names already in other games are not rewritten. No list management screen: a wrong join is corrected by renaming the player to a new name and choosing `Only this photo` if prompted.
- `ota/native-epoch` is bumped: an older bundle rejects games carrying `avatars`.

- **Several photos**: a new name for a photo whose current identity holds several prints opens `Rename <A>?` with `<A> has <n> photos.` Primary `Rename everywhere` keeps all its prints under the new name; `Only this photo` moves the nearest print into a new identity; `Cancel` takes focus and changes nothing. Both rename choices commit the name in this game. Joins keep their existing confirmation.
- **Shared placeholders**: after all Settled pills are fingerprinted, every pill whose print matches another pill below `PRINT_CUTOFF` loses its avatar; unrelated photos keep theirs.
- **Exports**: JSON board exports omit `avatars` without changing the live game; library backups retain the fingerprints.
- **Default names** (approved 2026-11-15): a colour name (any palette key, case-insensitive) or `Player <n>` (what the add-seat button gives) is a default name. A default name never creates or joins an identity, and a photographed player with any default name can be named by recognition. `aki` (the fresh board's starting player) is a real name, so the owner's own face can link to it.
- **Board titles** (approved 2026-11-15): a board's automatic title is `M/D name1, name2, …` in seat order (`board.players` order, which is turn order), with the board's creation date unpadded (`11/5`, not `11/05`): the library entry's `createdAt` when linked, else today. Every player is listed, default-named ones included, unless all players have default names or the game is fresh (`isFreshGame`), in which case the title is the `Board N` default. A title another board (library map or open tab, never itself) already holds gets ` 2`, ` 3` and so on appended, so the first board keeps the plain title and suffixes stay stable as titles are recomputed. The title is recomputed whenever the game changes (renames, seats added, removed or reordered, an import Update), and imports start with the automatic title instead of the file name. A title is automatic when it reads `Board <n>` or `<m>/<d> …`; any other title was typed by hand and is never overwritten. No stored flag. A typed title that happens to look like `11/15 …` is treated as automatic.

## Queue

| # | Item | State |
| --- | --- | --- |
| 1 | Fingerprint in the Settled parser, `Game.avatars`, serialization, engine strip, `withBoard` prune, merge | done |
| 2 | People list store, mirror, backup and restore | done |
| 3 | Name faces on import | done |
| 4 | Rename: same-game uniqueness, identity assignment, join confirmation | done |
| 5 | Tests (unit, plus one e2e: import, rename, import the other 5p fixture, name appears) | done |
| 6 | Epoch bump; desktop and mobile spec rename rules; CLAUDE.md persistence and parser lines | done |
| 7 | Several prints on one identity | done |
| 8 | Shared placeholder photo | done |
| 9 | Exports | done |
| 10 | Docs | done |
| 11 | Default names never link to a photo (`Player <n>` joins the colour names) | done |
| 12 | Automatic board titles | done |

## Open

- A lone guest on a shared default avatar still gets that avatar's print; needs a screenshot showing Settled's guest avatar.
