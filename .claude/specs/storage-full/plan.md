# Storage full

Approved 2026-11-13: when the browser refuses a save for lack of space, ask the user to delete old games to make room. Filter chosen by the owner: whole old games (not their history alone).

## Decisions

- **Detection.** A write that throws a quota error (`QuotaExceededError`, or Firefox's `NS_ERROR_DOM_QUOTA_REACHED`) fails with `quota: true` on its `WriteResult`, and that flag reaches the `SaveFailure` the save-failure toast reads. Any other write failure behaves as today.
- **Analysis cache first.** Before the prompt opens, the analysis cache key (`ANALYSIS_CACHE_KEY`) is removed and the failed save retried once; it is cheap to rebuild. The prompt opens only if the save still fails for lack of space.
- **Candidates.** Saved maps linked to no tab, in this document or in the stored workspace (another window's tabs), ordered least recently used first by the same rule as the library cap (newest of created, modified and opened; an entry with no stamps is the coldest). Each carries its name, last use and stored size (the length of its stored JSON). Entries with no usable id are not candidates.
- **What clean-up deletes.** Every candidate unused for 30 days or more; if none is that old, the 5 least recently used. The user never picks games one by one (owner, 2026-11-13: no checkboxes).
- **Prompt.** `ConfirmDialog` on both trees, opened once per run of quota failures (it does not reopen on every retry while the failure stands). Title `Storage is full`. Message: `This browser has no room left, so your latest edits are not saved.` then the clean-up sentence, then `You can also delete games yourself in Maps.` Clean-up sentence: `Clean up deletes the 3 games you haven't opened in 30 days.` (`the game` when one), or with no game that old `Clean up deletes the 5 games you opened least recently.` Actions in this order: `Clean up` (`danger`), then `Not now` (plain, last, so it takes the focus). Clean up deletes those maps in one write, closes nothing (no candidate is open), refreshes the library and retries the failed saves at once; if a save still fails for lack of space, the prompt opens again with the next set. `Not now` closes it; the existing save-failure toast (Retry saving, Export backup) stays as it is. With no candidates the prompt does not open; the toast's message adds `Delete or export old games to make room.`
- **Maps warning.** While a quota failure stands and the prompt is closed, the library list (`LibraryLists`, so the desktop Maps panel and the phone Maps screen both) starts with a warning block above `Boards (n)`: bold `Storage is full` in `--danger` with a `Clean up` button on the same row at the right, then a muted line across the full width: `Your latest edits are not saved.` plus the clean-up sentence. The button does exactly what the prompt's button does. With no candidates the line reads `Your latest edits are not saved. Delete or export games to make room.` and there is no button. It goes as soon as saving works again.
- **Undo.** None. Export backup stays one tap away on the toast.

## Data

- `localStorage.ts`: `WriteResult` failure gains `quota?: true`; `isQuotaError(error)` is the one test for it; `deleteMaps(ids)` deletes many maps in one write (unknown ids are ignored; a write with nothing to delete is skipped).
- New `persistence/storageCleanup.ts`: `cleanupCandidates(now, open)` returns `{ candidates, preselected }` as the tests in `__tests__/storageCleanup.test.ts` fix; `CLEANUP_AGE` (30 days) and `CLEANUP_FALLBACK` (5).

## Work

| Item | State |
| --- | --- |
| Persistence: quota flag, `deleteMaps`, `cleanupCandidates` (tests written first) | done; unchanged cleanup test: 10 passed, persistence suite: 67 passed |
| Save failures carry `quota`; analysis cache cleared and save retried once | done; includes closed rescues and deferred retries |
| Replace `StorageFullDialog` and its CSS with `ConfirmDialog`, exact copy and action order | done; exact copy, action order and focus covered by unit tests |
| Move the clean-up plan and action into one hook shared by `GlobalNotice` and `LibraryLists` | done in `useStorageCleanup`; persistence unchanged |
| Maps warning above the group label, with shared base styles and danger hover | done; existing phone overlay padding supplies spacing |
| Update UI tests for automatic clean-up, copy variants, dismissal and the Maps warning | done; 20 UI tests pass, alongside the 10 unchanged cleanup tests |
| Update the prompt e2e and add the Not now then Maps clean-up e2e | done; both storageFull e2e tests pass |
| Docs: desktop and mobile specs, CLAUDE.md `persistence/` bullet | updated for the revised design |
| Review, typecheck, lint and `npm test` | done; typecheck and lint pass, full unit run: 1,203 passed and 44 skipped, then all 4 performance tests pass |
| Land on main | previous implementation landed 2026-11-13; revised design awaiting the owner's look |
