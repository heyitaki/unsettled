# Storage full

Approved 2026-11-13: when the browser refuses a save for lack of space, ask the user to delete old games to make room. Filter chosen by the owner: whole old games (not their history alone).

## Decisions

- **Detection.** A write that throws a quota error (`QuotaExceededError`, or Firefox's `NS_ERROR_DOM_QUOTA_REACHED`) fails with `quota: true` on its `WriteResult`, and that flag reaches the `SaveFailure` the save-failure toast reads. Any other write failure behaves as today.
- **Analysis cache first.** Before the prompt opens, the analysis cache key (`ANALYSIS_CACHE_KEY`) is removed and the failed save retried once; it is cheap to rebuild. The prompt opens only if the save still fails for lack of space.
- **Candidates.** Saved maps linked to no tab, in this document or in the stored workspace (another window's tabs), ordered least recently used first by the same rule as the library cap (newest of created, modified and opened; an entry with no stamps is the coldest). Each carries its name, last use and stored size (the length of its stored JSON). Entries with no usable id are not candidates.
- **Preselection.** Every candidate unused for 30 days or more; if none is that old, the 5 least recently used.
- **Prompt.** A `ModalDialog`, on both trees, opened once per run of quota failures (it does not reopen on every retry while the failure stands). Heading `Storage is full`. One line: `This browser has no room left to save your games. Delete old games to make room?` Then the candidates as a checkbox list: name, `Used 3 months ago` style relative time (the library's formatter), size in KB. Buttons: primary `Delete N games` (disabled at 0, with the total size), and `Not now`. Deleting removes the checked maps in one write, closes nothing (no candidate is open), refreshes the library and retries the failed saves at once. If a save still fails for lack of space, the prompt opens again with the remaining candidates. `Not now` closes it and leaves the existing save-failure toast (Retry saving, Export backup) as it is. With no candidates the prompt does not open; the toast's message adds `Delete or export old games to make room.`
- **Undo.** None; the prompt says the games are deleted for good only through the button label. Export backup stays one tap away on the toast.

## Data

- `localStorage.ts`: `WriteResult` failure gains `quota?: true`; `isQuotaError(error)` is the one test for it; `deleteMaps(ids)` deletes many maps in one write (unknown ids are ignored; a write with nothing to delete is skipped).
- New `persistence/storageCleanup.ts`: `cleanupCandidates(now, open)` returns `{ candidates, preselected }` as the tests in `__tests__/storageCleanup.test.ts` fix; `CLEANUP_AGE` (30 days) and `CLEANUP_FALLBACK` (5).

## Work

| Item | State |
| --- | --- |
| Persistence: quota flag, `deleteMaps`, `cleanupCandidates` (tests written first) | done; unchanged cleanup test: 10 passed, persistence suite: 67 passed |
| Save failures carry `quota`; analysis cache cleared and save retried once | done; includes closed rescues and deferred retries |
| `StorageFullDialog` on both trees, retry after delete, toast copy with no candidates | done through shared `GlobalNotice`; 14 new unit tests pass |
| Tests: UI unit, e2e (fill storage, accept, save lands) | done: 14 unit tests, e2e passes |
| Docs: desktop and mobile specs, CLAUDE.md `persistence/` bullet | done |
| Review, land on main | done 2026-11-13 |
