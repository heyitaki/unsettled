# Seat-count weights: independent re-gate on a fourth seed generation

Follow-on to [completed/seat-count-weights.md](completed/seat-count-weights.md). Asked for by the user on 2026-10-10 after the closing report said seat counts on one layout share boards: "great do it. in the future dont ask about creating new generations/seeds. its cheap so just do it".

## Decisions

- **Fourth generation, seat count folded into the seed.** `tuning4`, `eval4` and `gate4` derive a run's domain seed as `mix64(constant ^ seats)`, so every seat count gets its own boards and its own game seeds. The nine earlier domains keep their seat-blind seeds, so every earlier entry stays reproducible.
- **One run per seat count, on `gate4` only.** Each seat count's candidate was already chosen without bias; what the shared boards cost was independence between seat counts. A single gate on boards no other seat count shares gives five mutually independent readings. No new screen and no `eval4` run: `tuning4` and `eval4` stay unspent.
- **The user's rule decides, applied to the independent gate.** A seat count keeps its adopted vector only on `better` at `--threshold 0.005` on `gate4`. Any other verdict returns that seat count to today's vector, with the M entry saying why.
- **Sizes.** The `gate3` board count, doubled where `gate3` cleared the bar by less than 0.25pp (four seats: 36000 boards; six seats: 20000), so a real effect of the size already read is unlikely to miss on power alone.

## Queue

| # | Item | State |
| ---: | --- | --- |
| 1 | Mint `tuning4`/`eval4`/`gate4` with the seat count folded into the seed; pins for disjointness across domains and seat counts; docs | done |
| 2 | Programme-file revision and five preregistrations (M-82 to M-86), committed before any run | done |
| 3 | Run the five `gate4` gates one after another: 2, 3, 4, 5, 6 seats | in progress: one background script, logs in the session scratchpad as `m8N.log`, artifacts in `simulator/runs/m8N-seatsN-gate4`; a seat count whose artifact directory exists is spent and must never be rerun |
| 4 | Record M-82 to M-86; keep or revert each seat count; regenerate; update outcome table, ledger, `CLAUDE.md`, README | not started |
| 5 | Three number-check passes; final gates (`npm test`, typecheck, lint, `cargo test` both profiles); `/selfreview`; commit | not started |
| 6 | Move this file to `docs/plans/completed/` | not started |
