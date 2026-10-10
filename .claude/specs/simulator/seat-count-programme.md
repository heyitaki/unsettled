# Seat-count weights programme

Class **D**: decisions, their rationale, and what each revision replaced. Not falsifiable by code. See [spec.md](spec.md) for the class rules.

This programme asks one question five times: does the settlement placement scorer want a different weight vector at 2, 3, 4, 5 and 6 seats? Every shipped weight was measured at four seats on `standard4`, and until this programme both scorers read one vector for every roster. It is a third programme, opened on 2026-10-10 under the rule the closed [placement-programme.md](placement-programme.md) left behind: new placement work opens its own programme with a fresh field statement and a third domain generation. Readings append to [measurements.md](measurements.md) from M-67.

## What exists before any run

**Selection is by seat count alone, in both scorers, and every seat count ships today's vector.** The app's `analyzeBoard` reads `weights.ts::weightsForSeats(board.players.length)`, which is `DEFAULT_WEIGHTS` overlaid with that seat count's entry in `SEAT_WEIGHT_OVERRIDES`; all five entries start empty, and a roster with no entry (one player) scores on `DEFAULT_WEIGHTS`. The simulator mirrors the five vectors as `simulator/placement/seat-weights/seats-<n>.json` and selects one through the `{seats}` placeholder a placement spec may carry. What the selection must guarantee is a contract; see [contracts.md](contracts.md). Nothing in the UI changed.

**`slotScales` gained no two-seat row.** Both scorers already score a seat count the block has no row for unscaled, and this programme sweeps no slot scale, so adding a row would have cost an exact-key edit to every committed weights file to say what the fallback already says.

## Field statement

Every reading puts every seat on `heuristic-v1-trader-aware-threat-devcards-denial`, with the field placement `app_formula_draft:placement/default-weights.json@placement/default-weights.json`, the reference arm `base` on that same spec, and each candidate arm's opponent path pinned to the field's weights so an arm moves the hero's formula alone. This is M-66's design carried to five seat counts: 2, 3 and 4 seats on `standard4`, 5 and 6 on `extension6`. Player trading is on at 3 to 6 seats and off at 2, where only bank and port trades exist, and the two-seat runs pass `--allow-unofficial`. Every verdict is read at `--threshold 0.005` and `--alpha 0.05`, at 2 reps.

**The field is today's vector at every seat count, and that is a choice with a cost.** Today's vector was tuned at four seats, so at the other four seat counts the field itself may be mis-set, and an arm that beats it is beating a field nobody has tuned there. That is the question being asked rather than a flaw in asking it, but it bounds what a `better` means: a better hero formula against this field, not a better field.

Three limits carry over from the closed programme and none is repaired here. The arm moves the hero alone, so no run observes the world an adoption creates, where every seat at that seat count carries the adopted vector. The greedy opponent model inside every draft-aware hero is misspecified against a draft-aware field, measured in M-61 at four seats and never at any other seat count, so no verdict here may be described as taken against a correctly specified model. And an arm that moves `expansionWeight` moves the setup road as well as the settlement, because the road rule falls through to far-endpoint scoring only at a weight of 0.

## Seed domains and the authorization

The third generation, `tuning3`, `eval3` and `gate3`, was minted on 2026-10-10 for this programme. One generation serves all five seat counts because board generation consumes layout and seat count, so each seat count draws its own boards from each domain and a spend at one seat count leaves the other four untouched. The ledger is in [programme.md](programme.md) under "Seed-domain discipline".

`tuning3` screens freely. `eval3` and `gate3` are each spent at most once per seat count. The user authorized those spends in advance, on 2026-10-10, in these words: "Per seat count: screen on `tuning3`, confirm the survivor once on `eval3`, decide once on `gate3`. I pre-authorise those one-shot spends for each seat count." No further approval is sought at the point of spending, each spend is preregistered under `docs/plans/preregs/`, and a held-out domain is spent at a seat count whatever its run there reads. A seat count whose screen leaves no survivor never touches `eval3` or `gate3`.

**One stray touch of `tuning3` happened before any preregistered run, and it is on the record rather than waved off.** `simulator/crates/cli/tests/evaluate_cli.rs` used `tuning3` as its example of a domain the command line must reject. Once the constant existed that test ran a real evaluation instead, once, during implementation: one `standard4` board at four seats, four units, with the built-in `max_pips` placement as both field and arm. No app-formula weight was in play, the test's temporary artifact was never read, and the test now uses `tuning4`. `tuning3` screens freely, so nothing was spent.

## The screening family

Twelve committed arm files, `simulator/placement/arms/sc_*.json`, each the live `simulator/placement/default-weights.json` with one key moved, and the same twelve serve all five seat counts. The user named the families expected to move with seat count: scarcity, coverage, diversity, ports, expansion and the `resourceValue` spread.

| Axis | Low arm | Live | High arm |
| --- | ---: | ---: | ---: |
| `scarcityWeight` | 0.175 | 0.35 | 0.7 |
| `coverageScarcityWeight` | 0.25 | 0.5 | 1.0 |
| `coverageExponent` | 1.0 | 1.5 | 2.25 |
| `diversityWeight` | 0.8 | 1.6 | 3.2 |
| `portWeight` | 0.275 | 0.55 | 1.1 |
| `expansionWeight` | 0 | 0.1 | 0.3 |

Five axes are halved and doubled (the coverage exponent's high arm is one and a half times, as Phase H screened it). `expansionWeight` instead takes the two values the closed programme already read at four seats, so the four-seat screen doubles as a calibration of the whole pipeline against a known answer.

**The `resourceValue` spread is not screened, and neither is `genericPortFactor`.** The user's instruction was to stay inside `simulator/placement/sweep-bounds.json`, and that file declares both with a minimum equal to its maximum, so no perturbation of either is inside the candidate space. Widening a declared range is a deliberate act the user did not authorize here. This is the one expected family the programme leaves unmeasured, and it is flagged for the user rather than worked around. `tuning3` stays free to screen it later.

No other placement axis is screened. A wider screen multiplies the false-positive surface across five seat counts for axes nobody expected to move.

## Procedure, fixed before any run

Each seat count goes through the same stages. Seat counts run in the order 4, 2, 3, 5, 6: four seats first because it is the corner with priors.

**Pilot, read blind.** The screen's own command at 400 boards on `tuning3`. Its boards are the first 400 of the screen's, so only four things are read from it: wall time, the illegal-action count, and per arm the half-width of the selected interval and the discordant share. Estimates, signs, interval endpoints, win rates and verdicts are not read, recorded or cited. A width carries no information about the direction of the effect it surrounds, which is what makes the pilot usable for power without being a peek.

**Sizing.** The screen runs at `B` boards, the smallest multiple of 500 at which the widest arm's predicted half-width, its pilot half-width times `sqrt(400 / B)`, is at most 0.35pp, the half-width the closed programme screened at against the same bar. `B` is at least 2000, and at most the largest multiple of 500 whose predicted wall time, the pilot's time scaled by boards, stays under 30 minutes. If the cap binds the screen runs at the cap and its entry says what half-width that predicts.

**Screen.** `base` and the twelve arms at `B` boards on `tuning3`. An arm reading `better` survives. An arm reading `worse` or `equivalent` is dropped with that answer recorded. An arm reading `inconclusive` with a point estimate of at least `+0.25pp` buys one retry; any other `inconclusive` arm is dropped unresolved, because the retry's estimate would have to more than double for it to read `better` and a retry that cannot produce a survivor decides nothing this programme asks.

**Retry.** `base` plus the retried arms at `4B` boards, once. `better` survives; anything else is dropped, unresolved if it is `inconclusive` again. Adding or removing arms does not perturb the others, which is a contract in [contracts.md](contracts.md), so the retry carries only what it needs.

**Candidate.** No survivor: the seat count keeps today's vector and its held-out domains stay unspent. One survivor: its arm file is the candidate. If both arms of one axis survive, the one with the larger estimate at the highest power it was read is kept. Two or more axes: a combined vector carrying every survivor's value is committed with one removal arm per axis, and one invocation at `B` boards on `tuning3` reads `base` and each removal arm against the combined vector. An axis whose removal reads `better` is dropped; the rest stay, each having read `better` alone. The candidate is the vector that remains, provided it has read `better` against `base` on `tuning3` in some invocation (for the combined vector, `base` reading `worse` against it), and it gets one more invocation at `B` to be read against `base` if it has not been. A vector that fails that reading falls back to the single survivor with the largest estimate.

**Confirmation on `eval3`.** One invocation, `base` and the candidate, at `4B` boards. `better` proceeds to the gate. Anything else stops the seat count on today's vector and leaves `gate3` unspent there.

**Gate on `gate3`.** One invocation, the same design, at `4B` boards. **`better` adopts the candidate for that seat count; anything else leaves today's vector.** No retry exists on either held-out domain.

**Stop conditions.** Any illegal action, or a `base` arm that misses the symmetric corner, stops that seat count at that run and its entry records why. The corner is `(1 - d) / seats` where `d` is `base`'s draw share, and a miss is a `base` win rate more than 3.29 binomial standard errors from it. A looser miss rule would stop a seat count on noise about once in every twenty runs, and the programme makes more than twenty.

**Adoption mechanics.** The candidate's moved leaves go into `SEAT_WEIGHT_OVERRIDES` for that seat count, `simulator/tools/generate-placement-parity.ts` regenerates `seats-<n>.json`, and the Rust adoption table moves with it. `DEFAULT_WEIGHTS` and `default-weights.json` never move in this programme, so the field spelling keeps denoting the same field throughout and every `sc_*` arm stays a single-parameter perturbation of it.

## Revision 1 to the procedure, 2026-10-10

Made after the four-seat pilot was read for its wall time and widths and before any run at another seat count. It changes how the remaining four seat counts are sized and nothing about how any arm is judged. Four seats runs to completion under the procedure as first written.

**Why.** The four-seat pilot played several times slower than the last four-seat draft-field throughput on record, which M-62 holds; M-67 holds the pilot's own figure. The older figure predates the SP6 adoption. Since then the field carries a nonzero `expansionWeight` on every seat's hero and opponent path, and `draft.rs::Lookahead::new` turns its row cache off whenever either path carries one, so every lookahead in every game now runs uncached. The first sizing rule was written against the old speed and contradicts itself on `extension6`, where its 2000-board floor cannot fit under its 30-minute cap.

**What changes, for 2, 3, 5 and 6 seats.**

- The pilot runs at 400 boards on `standard4` and at 100 on `extension6`. The sizing formula scales from whichever count the pilot used.
- The 2000-board floor is dropped; `B` is at least 500. The screen's wall-time cap stays 30 minutes on `standard4` and is 120 minutes on `extension6`.
- On `extension6` the retry carries at most two arms: of the arms that earn it, the two with the largest screen estimates. Any other arm that earned a retry is dropped unresolved and its entry says the cap dropped it.
- The retry, the confirmation and the gate stay at `4B`.

**What this costs.** Where a cap binds, the screen's half-widths are wider than the 0.35pp target and more arms end `inconclusive`. An `inconclusive` reading is a statement about power and never a null, and an entry under a binding cap says so.

## Outcome

Filled in as each seat count closes. One row per seat count: the vector it ships and the entry that says why.

| Seats | Layout | Ships | Why |
| ---: | --- | --- | --- |
| 2 | `standard4` | today's vector with `coverageExponent` 1.0 and `diversityWeight` 3.2 | Adopted on `gate3`. M-70 screened both axes as survivors and read them `better` together, M-71 confirmed the pair on `eval3`, M-72 read `better` at the gate. |
| 3 | `standard4` | pending | |
| 4 | `standard4` | today's vector with `coverageExponent` 1.0 | Adopted on `gate3`. M-67 screened it as the one survivor, M-68 confirmed it on `eval3`, M-69 read `better` at the gate. |
| 5 | `extension6` | pending | |
| 6 | `extension6` | pending | |
