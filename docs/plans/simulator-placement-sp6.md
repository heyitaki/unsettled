# Placement programme: SP6, combine, confirm and adopt

## Overview

Execute phase **SP6** of [`.claude/specs/simulator/placement-programme.md`](../../.claude/specs/simulator/placement-programme.md) under the decisions the user made on 2026-09-02, which Task 1 records in that file and which this plan's Context restates as defaults. Read the programme file in full first, including every dated note at its end; read [`completed/simulator-placement-sp3-sp5.md`](completed/simulator-placement-sp3-sp5.md) for the task shape and protocol this plan continues; read M-44 and M-46 in `.claude/specs/simulator/measurements.md` before designing any arm, because the coordinate pass and the gate copy their shape.

When this run is done:

- Three new seed domains exist, `tuning2`, `eval2` and `gate2`, pairwise disjoint from each other and from the three spent ones, and the repo's documents say which are spent.
- The practical threshold for every SP6 verdict is 0.5 percentage points, recorded in `contracts.md` as SP6's standing threshold and used as `--threshold 0.005` in every SP6 run.
- The draft-aware placement kind is the programme's reference field, spelled `app_formula_draft:placement/default-weights.json@placement/default-weights.json`, and its greedy opponent model's accuracy against that field is measured and recorded.
- The rollout-occupancy divergence in `src/engine/analyze.ts` is fixed, so the app's expansion walk reads the same occupancy on both picks.
- The four candidate axes (expansion weight and decay, robber concentration, diversity 4.8) are re-screened against the new field, combined, put through a coordinate pass, confirmed on `eval2`, read once on the extension board, and decided on `gate2`. On `better` the package is adopted into both scorers' shipped defaults with the parity fixture regenerated and every arm pin re-anchored; on anything else nothing moves and the record says so.
- `placement-programme.md` carries a dated SP6 completion note and the programme is closed.

### Standing rules for every iteration

**Adoption happens once, in Task 17, and only on the preregistered `gate2` verdict.** Until then no shipped default *value* moves: not in `src/engine/weights.ts`, not in `simulator/placement/default-weights.json`, not in any params file. New parameters at behaviour-preserving values are the only permitted default changes before Task 17, and this plan introduces none.

**Domains.** `tuning`, `eval` and `gate` are spent: never run a command carrying `--domain eval` or `--domain gate`, and do not run `--domain tuning` either, since every SP6 reading belongs on the new field's own screening set. Every screen, pass and diagnostic in this plan is `--domain tuning2`. `eval2` is spent exactly once, by Task 12. `gate2` is spent exactly once, by Task 17. **The user delegated both spends to this run on 2026-09-02**, preregistered; that sentence is the authorization the M-46 precedent required, and Task 1 records it in the programme file.

**Preregister, then run.** Each scaled run has its own task pair: one task writes `docs/plans/preregs/<YYYY-MM-DD>-m<NN>-<slug>.md` and commits it, the next executes and appends the M entry. Never write the prereg and run the measurement in the same task. Follow the shape of `docs/plans/preregs/2026-09-02-m59-sp5-draft-awareness.md` for a draft-aware run and `docs/plans/preregs/2026-08-27-m46-phase-i-gate.md` for the gate.

**`measurements.md` is append-only.** M-61 onward is the expected assignment; if the file has moved on, take the next unused number and keep this plan's order.

**Disposition rule at the 0.5 bar.** For a candidate axis: `better` (whole selected interval above +0.5pp) survives; `worse` drops it and records why it was expected to help; `equivalent` drops it and records the null; `inconclusive` buys units exactly once at four times the boards (`--boards`, never `--reps`), and if still `inconclusive` records the axis unresolved and drops it from the package. The coordinate pass and the gate have their own rules, stated in their tasks.

**Conditional tasks.** A task whose header says "conditional" opens by reading the recorded outcome it depends on. If the condition fails, implement nothing: tick every box in that task and the tasks it names with the note "skipped: <condition>", append the decision note the task specifies, run the link check, commit.

**Both cargo profiles, every simulator change, as the last step of the task.** Always prefix cargo with `RUSTFLAGS="-D warnings"`. Run the two profiles once per task.

**Byte-exact corpus before any behaviour change.** `simulator/tools/capture-corpus.sh runs/corpus-pre` from `simulator/` before touching engine code, recapture to `runs/corpus-post` after, diff. Tasks 2, 4 and 17 are the only ones that touch engine or CLI code; 2 and 4 must be byte-identical (only `meta.json` elapsed fields may differ) and say so in the commit; 17 records which corpora moved, which on adoption is every corpus scored by the app formula.

**Keep the tree green at every commit.** Regenerate committed baselines only through their committed harnesses; nothing in this plan should move one before Task 17.

**Measurement hygiene.** `uptime` immediately before and after every measurement, both in the M entry. Never a measurement in the same command block as a suite or a build. Zero illegal actions or the run is inadmissible. Build the release binary in its own command first.

**Long runs must keep printing.** Draft-aware arms run at about 6,500 games/s at 18 workers; an 8000x2 four-seat run is about 20 seconds, a 32000x2 retry about 80 seconds, a 2000x2 six-seat extension run under a minute. Time a 200-board version of any invocation that carries more than 32,000 boards or a new layout before running it; if the full run is predicted over eight minutes, launch it in the background and poll it with a loop that prints the elapsed minute. Never pipe a run through `tail` or `head`.

**The lookahead never prunes.** Speed from caching, never from restricting candidates.

**Never hand-edit `simulator/topology/*.json`.**

**Markdown.** One line per paragraph or bullet. No em or en dashes anywhere, including comments and commit messages. Cite code as `file.rs::symbol`. `tools/link-check.py` guards backticked paths only.

### Out of scope

A recursive opponent model. Porting the deterministic lookahead or the denial credit into the app; the app keeps its sampled rollouts and ships weights only. Any change to `opponentTopK` or `softmaxTemperature`. Re-measuring `recipeDevCardBonus`, `portCoverageDeficitWeight`, `slotScales` or `setupDenialWeight`, which stay inert. `SIM-GAP-41`. Any run on `tuning`, `eval` or `gate`. Anything Phase-3 or mobile.

### Review bounds

Review and fix commits after the task phase may touch code and tests. They may not edit committed M entries, preregistration files, `gaps.md`, decision notes in `placement-programme.md`, `simulator/topology/*.json`, the numbers inside `simulator/fixtures/placement-parity.json`, or any shipped default value, including the ones Task 17 adopted.

## Context

### Where things live

- `simulator/crates/cli/src/evaluate.rs`: `TUNING_SEED`, `EVAL_SEED`, `GATE_SEED`, `EvaluationDomain` with its `parse` and `name`. Disjointness is asserted by `simulator/crates/cli/tests/policy_strength.rs::tuning_and_evaluation_seed_domains_are_disjoint` (pairwise over a list of seeds) and `simulator/crates/cli/tests/evaluate_harness.rs::tuning_and_evaluation_domains_have_disjoint_seeds_and_boards` (seeds and generated boards). `.claude/specs/simulator/contracts.md` "Seed domains and seed derivation" lists the three constants; `programme.md` "Seed-domain discipline" holds the spend ledger; the repo `CLAUDE.md` carries the spend-once rule.
- `simulator/crates/engine/src/placement/draft.rs`: the draft-aware kind, `ScoreRows` cache, the first-pick lookahead. `simulator/crates/cli/tests/draft_lookahead.rs::the_lookahead_predicts_the_picks_the_field_actually_made` is the existing exactness test against a greedy field. `simulator/crates/cli/src/diagnose.rs` and `expansion.rs` are where a per-game statistic over traced setup picks is added; `game.rs::play_traced` and `SetupPick` supply the trace.
- `simulator/crates/cli/src/heuristics.rs::parse_heuristic` resolves both `app_formula:<path>` and `app_formula_draft:<hero>@<opponent>`; `--field` goes through it too, so a draft-aware field is one flag. Two weights files in one run need distinct stems.
- `src/engine/analyze.ts::rolloutOccupancy` (the function with the "something to settle before it moves off 0" comment): it passes the rollout's distance-closed `blocked` set as the occupancy's blocked set, so the expansion walk treats a vertex barred by the scoring player's own settlement as a rival dead end. `occupancyFromBoard` builds the buildings-only reading the first pick uses. `simulateWindowDetailed` returns `taken`, the raw vertices picked in the window, which is the un-closed set a fix needs.
- `src/engine/weights.ts::DEFAULT_WEIGHTS` and `simulator/placement/default-weights.json` (written by `simulator/tools/generate-placement-parity.ts`, which also regenerates `simulator/fixtures/placement-parity.json`). `simulator/crates/engine/src/policy/params_file.rs`: `every_committed_weights_file_loads_through_the_full_contract` pins 58 weights arms; `SP2_ARMS`, `SP3_ARMS`, `SP4_ARMS`, `SP5_ARMS` and their tests pin each arm as a perturbation of the *live* `default-weights.json`, which is exactly what adoption breaks; `the_phase_i_candidate_files_record_the_adopted_vectors` and `simulator/placement/phase-i-candidate-weights.json` are the M-46 precedent for snapshotting a pre-adoption baseline so frozen arms keep their meaning.
- `simulator/placement/arms/h1_diversity_48.json` is the M-40 arm at `diversityWeight` 4.8, anchored to the pre-drop defaults with `handValueWeight` 0.4, so it cannot be reused; SP6 mints its own.
- `.claude/specs/simulator/gaps.md`: `SIM-GAP-34` (expansion unpriced) closes on adoption of a nonzero `expansionWeight`; `SIM-GAP-35` through `37` and `41` stay.
- Preregistrations in `docs/plans/preregs/`; M entries append to `measurements.md` (last entry M-60); decisions append to `placement-programme.md`; `simulator/README.md` documents commands, domains and arm families.

### The measurement protocol these runs follow

Every A/B is `evaluate`, `standard4`, 4 seats, `--domain tuning2` unless the task names `eval2` or `gate2`, `--player-trading`, every seat on `heuristic-v1-trader-aware-threat-devcards-denial`, `--threads 0`, **`--threshold 0.005`**, `--alpha 0.05`, run from `simulator/`. **Field** `app_formula_draft:placement/default-weights.json@placement/default-weights.json`; **reference** `base=` the same spec; each arm `app_formula_draft:placement/arms/<file>.json@placement/default-weights.json`, so the hero's formula moves while the opponent model stays pinned to the field's weights. Screen power at the 0.5 bar is **8000 boards x 2 reps** (64,000 paired units); the single retry is 32000 x 2. `simulator/runs/` and `simulator/target/` are gitignored.

### Decisions the user made on 2026-09-02, which Task 1 records

These are decisions, not discoveries. Task 1 appends them to `placement-programme.md` as a dated `## SP6 decisions, 2026-09-02` note in this wording, and every prereg cites that note rather than restating it.

- **The candidate is four axes, three of them sub-threshold on purpose.** `expansionWeight` 0.1 (M-54, +1.13pp unresolved at the old bar), `expansionDecay` swept beside it (never measured), `robberConcentrationWeight` 4.0 (M-57, +0.58pp `equivalent` at the old bar), and `diversityWeight` 4.8 (M-39/M-40, about +1.3pp, recorded as a prior and never adopted). The survivor rule that admitted only `better` readings to SP6 is superseded for this phase; the coordinate pass is what guards against M-44's stacking failure.
- **The draft-aware kind is the field, not a candidate.** Every SP6 reading is taken with every seat on `app_formula_draft` at the live defaults. This is a field change under the programme's own rule, so the four axes are re-screened against it before combination, and no SP3 through SP5 number is cited as if taken on this field. **The field switch lands regardless of the gate outcome**: it rests on M-59 and on M-61's accuracy reading, not on the weight package.
- **The hero keeps the greedy opponent model.** Against a draft-aware field the lookahead's assumption that each opponent is greedy is an approximation; its accuracy is measured (M-61) and recorded rather than assumed, and a recursive model is out of scope.
- **The practical threshold is 0.5pp for every SP6 verdict**, screens, pass, confirmation and gate alike, because the readings this programme produces sit between half a point and a point and the 1pp bar was what left real gains unshipped. Resolving at the tighter bar costs four times the boards, which is seconds.
- **Three new domains**, `tuning2`, `eval2`, `gate2`, so SP6 starts on boards no parameter has seen. `tuning2` screens freely; `eval2` confirms the pass's output once; `gate2` decides adoption once. The user delegated both spends to this run, preregistered.
- **The gate rule is M-46's at the new bar**: 8000 x 2 on `gate2`, `better` adopts the whole package, anything else rejects it outright with no partial adoption and no default moved.
- **The app ships weights only.** Its sampled opponent model (`opponentTopK` 3, `softmaxTemperature` 1.25) stays; the rollout-occupancy divergence is fixed before `expansionWeight` can move.
- **One record-only extension reading.** The final package is read once on `extension6` at 6 seats on `tuning2`; it cannot block adoption, and a `worse` reading is flagged for the user.

### Defaults this plan fixes beyond those decisions

- **Domain constants** are minted by the same recipe as the existing three: a `u64` literal with a readable date tag, `EvaluationDomain::{Tuning2, Eval2, Gate2}` parsed from `tuning2`, `eval2`, `gate2`, and both disjointness tests extended to assert all six pairwise, seeds and generated boards alike.
- **M-61's accuracy statistic** is computed by `diagnose` with every seat on the draft-aware field: for each traced hero first pick, run the greedy prediction the lookahead uses for the seats that pick before the hero's second settlement, and report the share of those intervening picks predicted exactly, overall and per slot, plus the share of hero second picks whose best surviving site was the one the lookahead planned. Report the same statistic on a greedy field in the same entry as the control, where it must read 100% on tie-free picks.
- **The occupancy fix** builds the rollout's occupancy from the board's buildings plus the window's raw `taken` vertices, not from the distance-closed `blocked` set, so the expansion walk applies the distance rule itself exactly as it does for the first pick. The `blocked` set keeps its job for legality. A vitest case pins that a vertex barred only by the scoring player's own settlement no longer stops the walk on the second pick, and that first and second pick read the same expansion component on a board where the rollout took nothing.
- **Re-screen arms**, each the live defaults with one change: `sp6_expansion` (0.1), `sp6_expansion_hi` (0.3), `sp6_decay_lo` (0.1 with decay 0.25) and `sp6_decay_hi` (0.1 with decay 1.0), `sp6_concentration` (4.0), `sp6_diversity` (4.8). An `SP6_ARMS` pin test follows `SP3_ARMS`. The decay pair is read only if `sp6_expansion` or `sp6_expansion_hi` survives; the surviving expansion value is the better-reading of the two.
- **Combined and removal arms**: `sp6_combined.json` carries every survivor at its value, and `sp6_minus_<axis>.json` carries the combined vector with one axis returned to its shipped value. **Coordinate rule**, from M-44: an axis whose removal reads `better` is dropped (it is harmful in combination); one whose removal reads `worse` is kept; one whose removal reads `equivalent` or unresolved is dropped on parsimony unless its own re-screen read `better`, in which case it is kept. The result is written to `simulator/placement/sp6-candidate-weights.json` with a pin test recording its provenance.
- **Confirmation then gate**: M-64 on `eval2` must read `better` for the gate to run; otherwise the package is rejected, recorded, and `gate2` is left unspent for a future programme. The extension reading (M-65) runs before the gate so its flag is in the record whatever the gate reads.
- **Adoption mechanics**, copied from M-46: snapshot the pre-adoption `default-weights.json` to `simulator/placement/sp6-pre-adoption-weights.json`; move `DEFAULT_WEIGHTS` in `src/engine/weights.ts` and regenerate `default-weights.json` and the parity fixture through the generator; re-anchor `SP2_ARMS`, `SP3_ARMS`, `SP4_ARMS`, `SP5_ARMS` and `SP6_ARMS` pins to the snapshot with a comment saying why; delete `SIM-GAP-34`; update the programme, `contracts.md`, `README.md` and the repo `CLAUDE.md`. App tests that pin a factor strip or a road mark at the shipped default are updated to the adopted values, never loosened.

### Traps

- `cargo test --workspace` in debug takes about 4 minutes warm, release about 1:15; `npm test` about 15 seconds. Once per task, at the end.
- The first task in a fresh worktree pays a full cold Rust build.
- The zsh shell: quote glob-bearing flags; never a bare `==` or `===` in a compound command.
- Two weights files in one run need distinct stems, and `parse_heuristics` rejects a label collision; the draft spec's registered name includes both stems.
- A weights file counts as a weights arm to the pin test only with a top-level `resourceValue` key; the count pin (58 today) moves by exactly the arms a task adds, and each addition is a deliberate edit to that literal.
- `generate-placement-parity.ts` also rewrites `default-weights.json`; run it after `DEFAULT_WEIGHTS` changes, never before, and re-verification of the fixture by a human is a Post-Completion item.
- `--threshold` is a fraction, so the 0.5pp bar is `0.005`; a prereg that writes `0.5` runs at a fifty-point bar and reads `equivalent` on everything.
- `evaluate` at 6 seats rotates the hero over six positions, so units per board double relative to four seats; size `--boards` accordingly.

## Validation Commands

Run from the repo root unless noted.

```
npm run typecheck
npm run lint
npm test
python3 tools/link-check.py . .claude/specs/simulator simulator/README.md docs/plans/preregs
RUSTFLAGS="-D warnings" cargo test --manifest-path simulator/Cargo.toml --workspace
RUSTFLAGS="-D warnings" cargo test --manifest-path simulator/Cargo.toml --release --workspace
```

A task that touches only Rust may skip the three npm commands; only TypeScript, the two cargo commands; only markdown, everything but the link check. A task that touches both runs everything. Measurement commands run from `simulator/`.

### Task 1: Record the SP6 decisions

- [x] Append `## SP6 decisions, 2026-09-02` to `.claude/specs/simulator/placement-programme.md` carrying the eight decisions in Context, in that wording, each as its own paragraph, with the delegation sentence for `eval2` and `gate2` stated plainly, and a closing paragraph saying which earlier sentences each decision supersedes (the survivor rule in the Phases preamble, the "open decision" seed-domain section, and the SP5 bullet's field statement)
- [x] In `.claude/specs/simulator/contracts.md` "Paired statistics", add one sentence recording that SP6 runs at a 0.5pp practical threshold (`--threshold 0.005`) and that the threshold is a per-run declaration the prereg fixes
- [x] Link check passes

### Task 2: Mint `tuning2`, `eval2` and `gate2`

- [x] Capture `runs/corpus-pre`
- [x] Add `TUNING2_SEED`, `EVAL2_SEED`, `GATE2_SEED` to `simulator/crates/cli/src/evaluate.rs` in the existing recipe, with `EvaluationDomain::{Tuning2, Eval2, Gate2}` parsed from `tuning2`, `eval2`, `gate2` and named the same way
- [x] Extend `policy_strength.rs::tuning_and_evaluation_seed_domains_are_disjoint` and `evaluate_harness.rs::tuning_and_evaluation_domains_have_disjoint_seeds_and_boards` to assert all six domains pairwise disjoint in seeds, and the boards test to cover every pair that shares a layout
- [x] Add a CLI test that `--domain tuning2` is accepted and `--domain tuning3` is rejected with the existing error shape
- [x] Update `contracts.md` "Seed domains and seed derivation" with the three constants, `programme.md` "Seed-domain discipline" with the new ledger (`tuning2` screening, `eval2` and `gate2` unspent until SP6's Tasks 12 and 17), `simulator/README.md` where domains are listed, and the repo `CLAUDE.md` spend-once rule to name all six and say `eval2` and `gate2` are SP6's to spend once
- [x] Recapture and assert the corpus diff is empty; state it in the commit
- [x] Both cargo profiles green, link check passes

### Task 3: Fix the rollout occupancy in the app

- [ ] Rewrite `src/engine/analyze.ts::rolloutOccupancy` per the occupancy default in Context: blocked set built from the board's buildings plus the window's raw `taken` vertices, the `blocked` set retained for legality only; update its doc comment and remove the "something to settle" sentence
- [ ] Vitest: the two cases named in Context, with expected values hand-derived at an explicit nonzero `expansionWeight` passed through `AnalysisOptions.weights`
- [ ] Confirm the parity generator's `occupancyFromBoard` path is untouched and the fixture does not need regenerating
- [ ] `npm run typecheck`, `npm run lint`, `npm test` green

### Task 4: The lookahead accuracy statistic in `diagnose`

- [ ] Expose from `placement/draft.rs` a function that, given the board, topology, owner arrays and a hero seat and pick index, returns the intervening picks the lookahead predicts and the planned second site, without choosing anything
- [ ] In `simulator/crates/cli/src/diagnose.rs` (and a sibling module beside `expansion.rs`), for each traced game and each seat's first pick, compare the prediction against the picks the trace recorded, and aggregate the shares named in Context overall and per slot into `diagnostics.json`, byte-identical across worker counts. The statistic runs whatever placement `--placement` names, so the greedy control and the draft-aware reading are two invocations of one code path
- [ ] Rust test over a hand-built trace pinning the share arithmetic in both directions, plus a test that on a greedy field with tie-free picks the share reads exactly 1.0
- [ ] Update the `diagnose` section of `simulator/README.md`
- [ ] Recapture the corpus and assert it is byte-identical (the statistic only observes)
- [ ] Both cargo profiles green, link check passes

### Task 5: Preregister M-61, lookahead accuracy on the draft-aware field

- [ ] Write `docs/plans/preregs/<today>-m61-lookahead-accuracy.md`: two `diagnose` invocations on `tuning2`, `standard4`, 4 seats, 2000 boards x 2 reps, composite policy with `--player-trading`, `--alpha 0.05`, `--threads 0`; one with `--placement app_formula:placement/default-weights.json` as the control, one with `--placement app_formula_draft:placement/default-weights.json@placement/default-weights.json`
- [ ] State that this is a diagnostic with no arm and no verdict, that the control must read 100% on tie-free picks or the statistic is broken, and record a prediction for the draft-aware share
- [ ] Admissibility conditions
- [ ] Link check passes

### Task 6: Run M-61 and record it

- [ ] Record `uptime`, run both invocations, record `uptime` again
- [ ] Append `## M-61: greedy lookahead accuracy against the draft-aware field` with full provenance, the control and the reading overall and per slot, and a paragraph on what the approximation costs and does not cost
- [ ] Append a dated note to `placement-programme.md` recording that the draft-aware kind is now the reference field, citing M-59 and M-61, and that this landed independently of the weight package
- [ ] Link check passes

### Task 7: Preregister M-62, the re-screen on the new field

- [ ] Write `docs/plans/preregs/<today>-m62-sp6-rescreen.md`
- [ ] Build the six re-screen arm files named in Context under `simulator/placement/arms/`, add `SP6_ARMS` and its pin test to `params_file.rs`, move the weights-arm count pin by six
- [ ] Two invocations preregistered: the four non-decay arms against `base`; the decay pair against reference `sp6_expansion` (or `sp6_expansion_hi` if it is the better reader), run only if an expansion arm survives, with that condition written down. Screen power and protocol as in Context, `--threshold 0.005`
- [ ] Decision rule: the standing disposition rule at the 0.5 bar. State why the field change requires this re-screen and why no SP3 through SP5 number transfers
- [ ] Prediction per arm and admissibility conditions
- [ ] Both cargo profiles green, link check passes

### Task 8: Run M-62 and record it

- [ ] Record `uptime`, run the first invocation, record `uptime` again; run the decay invocation only if its condition holds, with its own load readings
- [ ] Append `## M-62: SP6 re-screen against the draft-aware field` with full provenance, pooled and per-hero-seat tables per arm, the single retry where bought, and the disposition per axis
- [ ] Record the survivor set explicitly in the entry's last paragraph, as `(key, value)` pairs, since Tasks 9 and 11 read it. If no axis survives, say so; Task 9 then takes its skip branch
- [ ] Link check passes

### Task 9: Preregister M-63, the combined arm and coordinate pass, conditional on M-62

- [ ] Read M-62. If fewer than two axes survived, skip the pass: with one survivor the combined vector is that axis and Task 10 records M-63 as "no pass needed"; with none, skip Tasks 10 through 17 with the note "skipped: no axis survived the M-62 re-screen", append a dated note to `placement-programme.md`, and go to Task 18
- [ ] Otherwise write `docs/plans/preregs/<today>-m63-sp6-combine-coordinate.md`: `sp6_combined.json` and one `sp6_minus_<axis>.json` per survivor, all registered in `SP6_ARMS` with the count moved; one invocation with `sp6_combined` against `base` and one with every `sp6_minus_*` against reference `sp6_combined`; screen power and protocol as in Context
- [ ] Decision rule: the coordinate rule in Context, stated before the run, and the M-44 precedent cited for why removal arms are read rather than singles summed
- [ ] Prediction (the sum of M-62 point estimates, and where interaction is expected) and admissibility
- [ ] Both cargo profiles green, link check passes

### Task 10: Run M-63 and record it, conditional on M-62

- [ ] Record `uptime`, run both invocations, record `uptime` again
- [ ] Append `## M-63: SP6 combined vector and coordinate pass` with full provenance, both tables per arm, the disposition per axis under the coordinate rule, and the final vector
- [ ] Write `simulator/placement/sp6-candidate-weights.json` as the final vector (the live defaults with the kept axes at their values) and add a pin test that it differs from `default-weights.json` exactly on the kept axes at the recorded values
- [ ] Both cargo profiles green, link check passes

### Task 11: Preregister M-64, the `eval2` confirmation, conditional on M-63

- [ ] If Task 9 recorded the no-survivor skip, tick with the same note and stop
- [ ] Write `docs/plans/preregs/<today>-m64-sp6-eval2-confirmation.md`: one arm, `candidate=app_formula_draft:placement/sp6-candidate-weights.json@placement/default-weights.json`, against `base`, on **`eval2`**, 8000 x 2, `--threshold 0.005`; state that `eval2` is spent by this run for these parameters and that it is not re-run whatever it reads
- [ ] Decision rule: `better` proceeds to the gate; anything else rejects the package, records it, and leaves `gate2` unspent
- [ ] Prediction and admissibility
- [ ] Link check passes

### Task 12: Run M-64 and record it, conditional on M-63

- [ ] Record `uptime`, run, record `uptime` again
- [ ] Append `## M-64: SP6 confirmation on eval2` with full provenance, both tables, the verdict, and whether the gate runs
- [ ] Update the spend ledger in `programme.md` "Seed-domain discipline" to say `eval2` is spent, on what
- [ ] Link check passes

### Task 13: Preregister M-65, the extension-board reading, conditional on M-63

- [ ] If Task 9 recorded the no-survivor skip, tick with the same note and stop
- [ ] Write `docs/plans/preregs/<today>-m65-sp6-extension6.md`: the candidate against `base` on `tuning2`, **`extension6`, 6 seats**, 2000 boards x 2 reps, composite policy with `--player-trading`, `--threshold 0.005`, record-only, cannot block adoption; a `worse` reading is flagged for the user
- [ ] Preregister the timing: time a 200-board run first, extrapolate, and name the background-and-poll invocation if it is predicted over eight minutes
- [ ] Prediction and admissibility
- [ ] Link check passes

### Task 14: Run M-65 and record it, conditional on M-63

- [ ] Record `uptime`, run, record `uptime` again
- [ ] Append `## M-65: SP6 candidate on extension6` with full provenance, both tables, and the flag if it read `worse`
- [ ] Link check passes

### Task 15: Preregister M-66, the `gate2` decision, conditional on M-64

- [ ] Read M-64. If it did not read `better`, skip this task and Tasks 16 and 17 with the note "skipped: M-64 did not read better", append a dated rejection note to `placement-programme.md` saying the package is rejected, nothing moved, and `gate2` is unspent
- [ ] Otherwise write `docs/plans/preregs/<today>-m66-sp6-gate2.md` mirroring M-46's prereg at the new bar: the same candidate spec against `base`, **`gate2`**, 8000 x 2, `--threshold 0.005`; the delegation sentence from Task 1's note quoted; what adoption changes and does not, per the adoption mechanics in Context
- [ ] Decision rule fixed before the run: `better` adopts the whole package; `worse`, `equivalent` or `inconclusive` rejects it outright, no partial adoption, no default moved, `gate2` spent either way
- [ ] Prediction and admissibility
- [ ] Link check passes

### Task 16: Run M-66 and record it, conditional on M-64

- [ ] Record `uptime`, run, record `uptime` again
- [ ] Append `## M-66: SP6 adoption gate on gate2` with full provenance, both tables, the verdict, and the decision it makes
- [ ] Update the spend ledger to say `gate2` is spent, on what
- [ ] Link check passes

### Task 17: Adopt the package, conditional on M-66

- [ ] Read M-66. If it did not read `better`, tick this task with the note "skipped: M-66 rejected the package", append a dated rejection note to `placement-programme.md`, and stop
- [ ] Capture `runs/corpus-pre`
- [ ] Copy the pre-adoption `simulator/placement/default-weights.json` to `simulator/placement/sp6-pre-adoption-weights.json` and add a pin test that it equals the literal pre-adoption vector
- [ ] Move `DEFAULT_WEIGHTS` in `src/engine/weights.ts` to the candidate values; run `npx tsx simulator/tools/generate-placement-parity.ts` so `default-weights.json` and `placement-parity.json` follow; confirm the vitest mirror test passes
- [ ] Re-anchor `SP2_ARMS`, `SP3_ARMS`, `SP4_ARMS`, `SP5_ARMS` and `SP6_ARMS` pin tests to `sp6-pre-adoption-weights.json` with a comment saying they are frozen measurement records of the pre-adoption field, following the `phase-i-candidate` precedent; update `the_sp6_candidate` pin to record adoption
- [ ] Update app tests that pin the factor strip, the road mark or a recommendation ordering at the shipped defaults to the adopted values, never by loosening an assertion
- [ ] Delete `SIM-GAP-34` from `gaps.md` and say so in the commit; update the sentence in `programme.md` "How to read the gap inventory" that counts the open placement gaps
- [ ] Append a dated `## SP6 adoption, <today>` note to `placement-programme.md` listing every moved value, old and new, and the M entries behind each; update `contracts.md` "Weights files" (the new anchor for SP-family arms), `simulator/README.md` (arm families and the reference field), and the repo `CLAUDE.md` simulator bullet
- [ ] Recapture the corpus and record which corpora moved
- [ ] All six validation commands green

### Task 18: SP6 completion note

- [ ] Append a dated `## SP6 completion` note to `placement-programme.md`: every M entry from M-61 on with its verdict, the final decision (adopted vector or rejection), the field switch, the spend state of all six domains, the still-open gaps, and that the placement programme is closed
- [ ] Update the programme's opening paragraphs only where they say a phase is pending
- [ ] Link check passes

### Task 19: Verify acceptance criteria

- [ ] `npm run typecheck` clean
- [ ] `npm run lint` clean (the pre-existing `src/ui/glyphs.tsx` fast-refresh warning is the only permitted warning)
- [ ] `npm test` fully green
- [ ] `python3 tools/link-check.py . .claude/specs/simulator simulator/README.md docs/plans/preregs` reports zero bad references
- [ ] `RUSTFLAGS="-D warnings" cargo test --manifest-path simulator/Cargo.toml --workspace` fully green
- [ ] `RUSTFLAGS="-D warnings" cargo test --manifest-path simulator/Cargo.toml --release --workspace` fully green
- [ ] `git status` is clean apart from gitignored run artifacts
- [ ] `measurements.md` contains M-61 and M-62, plus M-63 through M-66 unless a condition skipped them, each with a date, commit, domain, exact command, load before and after, games, illegal actions and an admissibility statement; grep the new entries and preregs and confirm no `--domain tuning`, `--domain eval` or `--domain gate` appears, and that `--domain eval2` and `--domain gate2` each appear in at most one M entry
- [ ] Every SP6 prereg and M entry carries `--threshold 0.005`
- [ ] If Task 17 adopted: `simulator/placement/default-weights.json` matches `DEFAULT_WEIGHTS`, differs from `sp6-pre-adoption-weights.json` exactly on the adopted axes, `SIM-GAP-34` is gone from `gaps.md`, and the parity fixture was regenerated in the adoption commit. If it did not: `default-weights.json` is byte-identical to its state at Task 1, and `gaps.md` still carries `SIM-GAP-34`
- [ ] `placement-programme.md` carries the SP6 decisions note, the field-switch note, and the completion note, each appended
- [ ] Write a run summary at the end of `.ralphex/progress/progress-simulator-placement-sp6.txt` listing every M entry, its verdict, the final decision, and the domain spend state

## Post-Completion

These need a human and cannot be automated.

- **Re-verify the regenerated `simulator/fixtures/placement-parity.json` by hand** if Task 17 adopted; the loop proves the two scorers agree, not that the adopted numbers are right. This supersedes the same item from the SP3 to SP5 run.
- **Read the flags**: a `worse` M-65 extension reading, and any rejection note.
- **Look at the app** after adoption: the road stub and the `Expansion` pill are now visible at the shipped defaults, on desktop and on the phone.
- **Decide whether a recursive opponent model is worth a programme of its own**, using M-61's accuracy reading as the sizing.
