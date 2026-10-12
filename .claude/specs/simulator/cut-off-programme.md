# Cut-off programme

## Summary

During the draft a rival's setup road cannot wall a settlement in, but it can point at the spot that settlement planned to expand to, and the rival then settles it first. Today the expansion term prices a spot as if nobody else wanted it, so rollouts that lay rival roads (shipped 2026-10-12) almost never move a ranking: 19 of 24 analyses were identical with rival roads ignored, the rest moved by at most 0.14. This programme does three things: it labels contested expansion spots in Best picks now, with no score change; it builds a contest discount into both placement scorers at weight 0, with every variant the owner asked to compare; and it measures those variants on boards chosen so that contests are common, adopting per seat count whatever passes.

Owner decisions this spec records (2026-10-12): capture both directions with one model; contested means a rival settlement within two edges, stronger when that rival's road ends next to the spot; test every discount shape and road rule and adopt the best; mint boards where cut-offs are common, both filtered and dense; a winner must win on fresh cut-off boards and not lose on fresh ordinary boards; all five seat counts, staged; re-price the first pick as its own measured stage; delete the variants that lose; dense boards are the best of 32 random deals, not a clustered deal; a cut-off board is the narrow race rule, widened only if the pilot finds it rare; strengths are 0.25 and 0.75.

## Queue

| # | Item | State |
| --- | --- | --- |
| 1 | Contest classifier and Best picks label (app only, no score change) | not started |
| 2 | Contest term and variants in both scorers at 0, parity classes, inert proofs, wasm, hashes | not started |
| 3 | First-pick re-pricing switch in the Rust lookahead and `analyze.ts`, off by default | not started |
| 4 | Board sources and generation five domains, `contest_score`, arms, preregistration, blind pilot | not started |
| 5 | Stage 1 to 3 screens on dense boards, seats two to six | not started |
| 6 | Confirm and both gates for each seat count's winner | not started |
| 7 | Adopt per seat count, delete losers, regenerate fixtures, close the record | not started |

## Requirements

### Contest classifier (shared by the label and the term)

1. Definitions over the pieces standing at scoring time, where `B(v)` is the owner of the building on vertex `v` and `E(e)` the owner of the road on edge `e`, either possibly none. A road end of seat `R` is a vertex with no building that has an incident edge owned by `R`.
2. A vertex `s` is tier 1 for `R` when `s` is a road end of `R`, or `s` has a neighbour `v` across an edge owned by nobody or by `R` and `v` is a road end of `R`. `R` needs one paid road to reach it.
3. A vertex `s` is tier 2 for `R` when it is not tier 1 for `R` and there is a path `s`, `m`, `a` with `B(m)` none, `B(a) = R`, and both edges owned by nobody or by `R`. `R` needs two paid roads. A rival settlement with no road of its own still counts as tier 2, not tier 1.
4. The rival paid count `r_R(s)` is 1 for tier 1 and 2 for tier 2. A seat is never its own rival.
5. TypeScript: `contestTiers(layout, vertexOwner, edgeOwner, seat, site)` in `src/engine/expansion.ts` returns, per rival with a tier, `{ playerId, roads: 1 | 2 }`. Rust: the same classification in `placement/expansion.rs` from `vertex_owner` and `edge_owner`. One definition serves the label, the term and the board predicate.

### Label (item 1)

6. `Recommendation` gains `contested: { vertexId: VertexId; playerId: string; roads: 1 | 2 }[]`: for each of the pick's two best expansion spots, the closest rival tier (ties to the earlier roster seat). The spots are the two that `expansionTerm` sums, exposed by a new `expansionSites(ctx, holdings, occupancy, candidate)` that shares the walk and is called only after the cut, once per listed row. `expansionTerm`'s return shape and hot path do not change.
7. The occupancy the label reads is the real board plus the likely-gone line's settlements and roads when the row's pick survives that line, and the real board alone otherwise, so every ring refers to a piece the board shows.
8. `recommendationMarks` adds one mark per contested spot: `{ ref: vertexId, color: <rival colour>, kind: 'ring', faded: roads === 2 }`. `HighlightMark.kind` gains `'ring'`; `markLayer` draws it as a circle of radius 13 with no fill and a 3-unit stroke in `mark.color`, at 0.55 opacity when faded.
9. Every listed row with a contest shows a note in `.analysis-row-body`, class `analysis-contest`, one clause per rival joined by `; `, rivals ordered by tier then roster order: `{Name} is also one road from {k} of {m} expansion spots` for tier 1 and `{Name} is two roads from {k} of {m} expansion spots` for tier 2, where `m` is the number of expansion spots the pick has (1 or 2) and `k` how many that rival contests at that tier. ASCII only, so the Inter cut is unchanged.
10. Before building, mock the ring and the note against a real board screenshot at desktop and phone widths, per the mock-up notes in project memory. Update both UI specs and the `engine/` bullet in `CLAUDE.md` when it lands.

### Contest term (item 2)

11. Five new `EngineWeights` keys on both sides, all shipped at 0: `contestWeight` (w, in [0, 1]), `contestWantShare` (u, in [0, 1]), `contestStack` (0 or 1), `contestRaceShare` (g, in [0, 1]), `contestDenyBonus` (b, at least 0). `validate` enforces those ranges. Every weights-shaped file under `simulator/placement/` gains the keys through one script, never by hand; `sweep-bounds.json` gains their bounds.
12. For the scoring seat `h`, a site `s` reached at its cheapest paid count `p`, with today's undecayed price `P_h(s)`, and each rival `R` with a tier:
    - `k_R = expansionDecay ^ (r_R - 1)`.
    - `q_R = clamp(P_R(s) / P_h(s), 0, 1)`, where `P_R(s)` is `marginalWithoutExpansion` of `s` for `R`'s holdings as they stand; `q_R = 0` when `P_h(s) <= 0`.
    - `want_R = (1 - u) + u * q_R`.
    - `race_R = 1 - g` when `p == r_R` and `h` is earlier than `R` in roster order, else 1. With no scoring seat it is 1.
    - `d_R = w * k_R * want_R * race_R`.
    - `D(s) = max over R of d_R` when `contestStack` is 0, and `1 - product over R of (1 - d_R)` when it is 1.
    - `deny(s) = b * max over tier 1 rivals of max(0, P_R(s))` when `p <= 1`, else 0.
    - The site's value is `expansionDecay ^ p * (P_h(s) * (1 - D(s)) + deny(s))`. A non-positive `P_h(s)` is not discounted.
13. The top-two sum, the `expansionWeight` multiply and the road tie-break are unchanged and run over these values, so the road follows discounted values with no further rule, and a rival scored later in a rollout or replay sees the hero's road as a contest on its own spots.
14. The term reads only board state, occupancy, the scoring seat and roster order, so it stays inside the shared deterministic formula. TypeScript `Occupancy` gains `vertexOwner: ReadonlyMap<VertexId, string>`; `blocked` stays. Rollouts maintain it where they maintain `occupied`. Rival holdings for `P_R` are rebuilt from `vertexOwner` behind a per-context cache keyed by the rival's vertex ids.
15. Inert at 0: with `contestWeight` 0 and `contestDenyBonus` 0 neither side reaches the classifier. Proofs: a Rust test in the style of `a_zero_weight_never_reaches_the_walk_and_the_shipped_one_does`, an unchanged `bench-hashes.json`, every existing parity case bit-identical, cargo tests in both profiles, and the TypeScript perf tripwires with their bounds untouched and `analyzeBoard p4 fastest` within 2% of the figure taken before the change on a quiet machine.
16. Rust memo and bound: site prices stay memoized undiscounted and the discount is applied outside `PriceMemo`. `ValueEntry` and the pruned argmax are bypassed whenever any contest key is non-zero (full row, reference walk), which is correct and slow; item 7 extends the key and the bound for the adopted shape only. The zero-allocation test must still pass with contest keys non-zero.
17. Parity: new classes in `generate-placement-parity.ts` and `REQUIRED_CLASSES` with witness weights, one each for tier 1, tier 2, stacking, want share, race share and deny bonus (`W17` to `W22`). Regenerate and hand-verify `placement-parity.json`; rebuild `engine.wasm`; regenerate `advice-parity.json` only if advice output moves.
18. Record in `gaps.md` as `SIM-GAP-43` that TypeScript rollouts lay no road for a pick that opens nothing while the Rust replay lays the far-endpoint fallback.

### First-pick re-pricing (item 3)

19. One more key, `repriceFirstExpansion` (0 or 1, shipped 0), read by the Rust `Lookahead` and by `rankCandidates`, not by the formula. When 1, the pair value replaces the first pick's expansion term with the same term evaluated after the intervening seats have picked and laid roads: same candidate, same holdings as at pick time, occupancy equal to the replayed board without the hero's own first settlement and road.
20. Rust: in `value_with_marginal`, `marginal - expansion(before) + expansion(after replay)`. TypeScript: the same in `rankCandidates`, per candidate per surviving window, one extra walk. No parity class exists for lookahead terms; each side gets its own unit test that a rival road laid in the mid-window lowers the pair value at a non-zero `contestWeight` and that 0 leaves every existing expectation untouched.
21. The app cost is measured before any adoption of this key: `perf.test.ts` figures before and after with the key on. The tripwire bounds move only with the owner's say.

### Boards and domains (item 4)

22. A race site is an empty vertex with no occupied neighbour that is tier 1 for at least two seats. `contest_score(board, seats)` plays the draft with `app_formula_draft` on both paths from frozen copies of today's seat vectors (`simulator/placement/cutoff/filter-seats-<n>.json`, never regenerated), seeding its random ties from the board seed, and returns the number of race sites on the drafted board.
23. `EvaluationDomain` gains a board source. Ordinary: as today. Filtered: board `i` is the first attempt `a` in `0..4096` whose board `mix64(domain_seed ^ i ^ mix64(a))` has `contest_score >= 1`; exhausting the attempts is an error. Dense: the attempt in `0..32` with the highest `contest_score`, ties to the lowest attempt. Each board still depends on its own index alone.
24. Generation five, seat count folded into the seed as in generation four: `ctune5` (dense, screens and pilots), `ceval5` (filtered, confirm), `cgate5` (filtered, gate A), `gate5` (ordinary, gate B). Add the constants, the disjointness entries, `parse`/`name`/`seed`, the harness pins and the ledger rows in `programme.md`, `contracts.md` and `CLAUDE.md`.
25. The dense source is best-of-32 from the real generator, not a clustered tile deal: it keeps every board legal under the generator's own rules (non-adjacent reds, port shuffle) and needs no second generator.
26. Arms are per-seat perturbations of the live `seat-weights/seats-<n>.json`, written by a script as `placement/arms/co_<arm>_s<n>.json` and pinned in `params_file.rs` as `CO_ARMS`, each pin naming its anchor vector. Each arm sets `contestWeight` and at most one variant key, except where stated.
27. Field statement: every seat on `heuristic-v1-trader-aware-threat-devcards-denial`, field placement `app_formula_draft:placement/seat-weights/seats-{seats}.json@placement/seat-weights/seats-{seats}.json`, reference arm `base` on the same spec, each candidate's opponent path pinned to the field's weights.
28. Write the preregistration under `docs/plans/preregs/` from this spec before any run. Then a blind pilot per seat count on `ctune5`, 400 boards (100 on `extension6`), reading only wall time, illegal actions, half-widths, discordant share, the filtered keep share (boards kept per attempt), and for each arm how many contested picks change their corner or their road against `base`. None of these is a win rate, so the pilot stays blind. Size `B` as in `seat-count-programme.md`: the smallest multiple of 500 with predicted half-width at most 0.35pp, under 30 minutes (120 on `extension6`).
29. A seat count whose filtered keep share is under 0.5% is recorded as not measurable and keeps every key at 0.

### Screens, confirm, gates (items 5 and 6)

30. All runs use `--threshold 0.005 --alpha 0.05`. Stop rules are those of `seat-count-programme.md`.
31. Stage 1, discount shapes, on `ctune5` at `B` boards by 2 reps, six arms: `flat_lo`, `flat_hi` (w 0.25, 0.75), `stack_lo`, `stack_hi` (same w, `contestStack` 1), `want_lo`, `want_hi` (same w, `contestWantShare` 1).
32. The carrier is the stage 1 arm with the highest point estimate, whatever its verdict. Stage 2, road rules, three arms on the carrier: `race` (`contestRaceShare` 1), `deny_lo`, `deny_hi` (`contestDenyBonus` 0.25, 0.5).
33. Stage 3, re-pricing, two arms: `reprice` (the best arm so far by point estimate plus `repriceFirstExpansion` 1) and `reprice_only` (every contest key 0, `repriceFirstExpansion` 1).
34. In any stage an arm reading `inconclusive` at +0.25pp or better buys one retry at `4B`, once. The seat count's candidate is the arm with the highest point estimate among those reading `better` across all three stages. No `better` arm closes the seat count at 0.
35. Confirm: the candidate once on `ceval5` at `4B`; only `better` proceeds.
36. Gate A: once on `cgate5` at `4B`; must read `better`. Gate B: once on `gate5` at `4B`; passes when `interval[0] > -0.0025`, read by hand off the output, since `evaluate` has no non-inferiority mode. Both must pass.

### Adoption (item 7)

37. A passing seat count gets its keys in `SEAT_WEIGHT_OVERRIDES[n]` and a `SEAT_ADOPTIONS` row; regenerate the seat files, the parity fixture, `bench-hashes.json` and `engine.wasm`. `DEFAULT_WEIGHTS` does not move.
38. Delete every variant no seat count adopted: its key from both `EngineWeights`, every weights file, `sweep-bounds.json`, its parity class and its code path. `repriceFirstExpansion` is deleted the same way if unadopted. If nothing is adopted anywhere, `contestWeight` goes too and only the label and the classifier remain.
39. For what survives, extend `ValueEntry`'s key and `build_expansion_bounds` so the row path and the pruned argmax serve it, then compare instruction counts on the box against the pre-programme figure.
40. Record every reading in `measurements.md` from M-90, including the keep share per seat count and what lost by how much, and add an Outcome section here.

## Design

### Data model

- `Recommendation.contested` and `HighlightMark.kind: 'ring'` (label).
- `Occupancy.vertexOwner` in TypeScript (term).
- Six `EngineWeights` keys, five in the formula and one in the lookahead, all f64 because arms can only change numbers.
- `EvaluationDomain` board source: ordinary, filtered or dense.

### Architecture

- Classifier and term: `src/engine/expansion.ts` and `simulator/crates/engine/src/placement/expansion.rs`, priced where site prices are priced today (`expansionTerm` lines 356 to 365; `term` and `row_value` in Rust).
- Re-pricing: `rankCandidates` in `src/engine/analyze.ts` and `Lookahead::value_with_marginal` in `placement/draft.rs`.
- Boards: `simulator/crates/cli/src/boardgen.rs` stays the only generator; the source wrapper and `contest_score` live beside `EvaluationDomain` in `evaluate.rs`.
- Label: `analyze.ts` after the cut, `src/ui/analysisMarks.ts`, `src/ui/AnalysisPanel.tsx`, `src/ui/BoardCanvas.tsx`, `src/ui/editor.css`.

### Behavior

A pick's expansion spots are priced as today, then each contested spot is discounted by how close the nearest rival is, optionally by how much that rival wants it, by how many rivals contest it, and by who moves first. The road goes toward the best spot after the discount. With re-pricing on, a first pick also pays for rivals who arrive after it. At the shipped zeros none of this runs.

## Edge cases and error handling

- A site that is a rival road end is tier 1 even though an own walk cannot cross the rival's edge to it by that route.
- A rival edge whose far end carries another seat's building has no road end there.
- Two rivals at the same tier: `max` under `contestStack` 0, the product under 1; the label names both.
- `expansionWeight` 0: no sites, no label, no term.
- A filtered board that exhausts 4096 attempts fails the run loudly instead of substituting an ordinary board.
- `ctx` must carry roster order for `race_R`; a seat missing from the roster gets `race_R = 1`.

## Non-goals

- The in-game turn policy's `contest_term` and its placeholders.
- Porting `analyzeBoard` rollouts to the simulator, or closing `SIM-GAP-42`.
- A clustered tile deal, true rival walk distance, or any change to `expansionWeight` or `expansionDecay`.
- Moving the perf tripwire bounds.

## Testing strategy

- Classifier: unit tests on hand-built boards for tier 1 through a road end, tier 1 as the road end itself, tier 2, a roadless rival, a blocked connecting edge, and own pieces never counting.
- Term: one TypeScript and one Rust test per variant key that bites when the key is zeroed, plus the parity classes.
- Inert proofs as listed in requirement 15.
- Label: `recommendationMarks` emits rings with the right colour and fade; the row note strings for one rival, two rivals and mixed tiers; one browser test that hovering a row draws a ring.
- Board sources: board `i` is reproducible from its index alone; filtered boards all score at least 1; a dense board's score is the maximum of its 32 attempts.
- A hand-built regression board from that session: `standard4`, two seats, the first seat's settlement on ore 9 / wheat 6 / sheep 10 with its road ending at ore 9 / wheat 6 / sheep 11. The second seat's top pick, brick 8 / sheep 11 / ore 9, lays its road toward the same wheat 6 / sheep 11 / wood 3 spot (9.74 after decay, next best 6.39); at an adopted flat strength above 0.34 that road must turn to the wood 4 / sheep 11 / brick 8 side. The ports were read by eye and need checking before it becomes a fixture.
- Each mutation-style check is shown to fail once against the code it guards.

## Decision points deferred to build time

- **Race-site definition too rare.** Owner rule: if the four-seat pilot keeps under 5% of boards, widen a race site to tier 1 for one seat and tier 1 or 2 for another before any screen, at every seat count. The pilot reads no win rates, so this stays blind.
- **A middle strength.** Input from another session on 2026-10-12, for the vet; the owner chose 0.25 and 0.75 before seeing it. The flat discount moves a road only once it passes `1 - next best site / contested site`, so on one real two-seat board 0.25 changes nothing and 0.75 turns the road (the step is at 0.34). A null at 0.25 beside a result at 0.75 cannot then be told from a dose response. Options: add 0.5 to each stage 1 shape (nine arms per seat count), or keep two strengths and let the pilot's changed-pick counts move them in the preregistration.
- **Dense attempt count.** 32 is a guess. Raise it if dense boards average under two race sites; lower it if the pilot's wall time breaks the cap. Fix it in the preregistration.
- **Variants that slow the screens.** If bypassing `ValueEntry` and the pruned argmax makes a stage miss its time cap, extend the key for the flat shape first and keep the bypass for the others.
- **Clustered deal.** If dense boards from the real generator give too little signal, a constructed deal is the fallback and needs its own domain names and an owner decision on which generator rules it may break.
