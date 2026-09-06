# Repository improvements

Approved on 2026-09-05. Work through every unblocked item. Existing analyzer, valuation, analyzer-test, simulator-gap, and CLAUDE.md edits predate this task and must be preserved.

| Item | State | Evidence and remaining work |
| --- | --- | --- |
| Move placement analysis into a Web Worker | Done | Five client tests pass. Browser checks cover navigation during worker loading and completed analysis after an offline reload. |
| Make the existing tests a dependable CI gate | Done | CI app/Rust gates and read-only parity check added. Performance tests isolated. All local gates pass. The selection test passes three consecutive runs after replacing its full-page capture, which briefly mounted the phone tree at 1x1, with a viewport capture. |
| Display imported boards before name OCR finishes | Done | Three late-name reducer tests and production tests pass, including offline import and blocked OCR assets. Manual renames and claims survive late OCR. |
| Add persistent save-failure recovery and whole-library backup | Done | Seven backup tests plus open- and closed-board recovery tests pass. Browser verifies backup restore, recovery download and retry. Corrupt data and unreadable storage do not prevent exporting open games. |
| Finish keyboard support in the screenshot dialog | Done | Unit and browser tests verify focus entry, Tab containment, Escape and focus restoration. The file input remains keyboard-focusable with a visible outline. |
| Complete six-player screenshot parsing | Blocked | The three existing fixtures contain no brown player. Requested a local path to a real six-player Settled screenshot. Raw and sRGB colors must be measured from it, then verified with fixture tests. |
| Persist award ownership so tied scores remain correct | Done | Four new tests and existing engine/model/store tests pass. Browser verifies correction, undo, redo and reload. Imported ties remain unknown until corrected. |

## Validation

Write new behavior tests before implementation. Preserve existing tests unless an approved item specifically requires changing their contract. Run focused checks as each item lands, then build, lint, unit tests and browser tests. Run Rust tests in debug and release for the CI gate without running an experiment or spending any seed domain. Commit only with explicit approval. Do not push without a separate request.

Verified locally:

- `npm run build`, `npm run typecheck` and `npm run lint` pass.
- `npm test`: 481 tests pass, including the three isolated performance tests.
- `npm run test:e2e`: 44 tests pass.
- `npm run test:pwa`: three production tests pass.
- Desktop selection regression: three consecutive runs pass.
- `cargo test --workspace` and `cargo test --workspace --release` pass with the existing intentionally ignored tests left ignored.
- Workflow YAML parses and `git diff --check` passes. GitHub Actions has not run remotely. The user approved local commits on 2026-09-06. No push was requested.
