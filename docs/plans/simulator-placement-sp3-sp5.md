# Placement programme: SP3, SP4 and SP5

## Overview

Execute phases **SP3**, **SP4** and **SP5** of [`.claude/specs/simulator/placement-programme.md`](../../.claude/specs/simulator/placement-programme.md). Read that file in full before the first task, including its dated SP0 through SP2 notes at the end; it is the normative decision record and this plan never restates its rationale. The previous run's plan, [`completed/simulator-placement-sp0-sp2.md`](completed/simulator-placement-sp0-sp2.md), shows the task shape and the measurement protocol this plan continues.

When this run is done:

- `evaluate` reports a per-hero-seat paired table beside the pooled one, record-only.
- SP3: an `expansion` term exists in both scorers at a shipped weight of 0, valuing the best sites a candidate opens by their marginal worth to the pair, with a road-direction output in the app; its A/B is recorded, and its decay axis is swept only if the weight read `better`. The robber-attraction item has its separation reading recorded and the concentration term is built and measured only if that reading passes its preregistered condition.
- SP4: `slotScales`, a (seat count, slot) keyed block of `expansion` and `diversity` multipliers, exists in both scorers at 1.0 everywhere, is plumbed with the slot on both sides, and its profile A/B is recorded.
- SP5: the Rust setup path has a deterministic draft-aware placement kind whose opponent model reproduces the field's picks exactly, closing `SIM-GAP-20`; the setup denial term rides that kind at a shipped weight of 0 with its two-value A/B recorded, the 1.0 value under a preregistered null.
- `placement-programme.md` carries a dated SP3 through SP5 completion note listing every M entry and the survivors carried to SP6.

### Standing rules for every iteration

**Record only. Never adopt.** Do not change any shipped default *value*: not in `src/engine/weights.ts`, not in `simulator/placement/default-weights.json`, not in `HeuristicParams::default()` or its siblings, not in `simulator/placement/policy-default-params.json`, not in `simulator/placement/phase-i-candidate-*.json`. The only permitted default changes are the ones a task explicitly specifies: a *new* parameter introduced at its stated behaviour-preserving value. A measured winner is recorded as an SP6 survivor and nothing else. The field's placement stays `app_formula:placement/default-weights.json` throughout; making the draft-aware kind the field is an SP6 decision.

**`--domain tuning` only.** Never run a command carrying `--domain eval` or `--domain gate`. Both domains are spent and the repo forbids them.

**Preregister, then run.** Each scaled run has its own task pair: one task writes `docs/plans/preregs/<YYYY-MM-DD>-m<NN>-<slug>.md` and commits it, the next task executes and appends the M entry. Never write the prereg and run the measurement in the same task; the commit is what freezes it. Follow the shape of `docs/plans/preregs/2026-09-01-m53-sp2b-port-coverage-deficit.md`: change under test, why this field answers the question, design, exact command, decision rule fixed before the run, prediction, threshold and alpha, admissibility.

**`measurements.md` is append-only.** Add entries at the end; never edit or renumber an existing one. This plan's M numbers (M-54 onward) are the expected assignment; if the file has moved on, take the next unused number and keep the plan's ordering.

**Disposition rule, preregistered.** For an optional term: `better` keeps it at its measured value as an SP6 survivor, `worse` drops it and the M entry records why it was expected to help, `equivalent` at declared power drops it and records the null as the answer, `inconclusive` buys units exactly once at four times the boards (raise `--boards`, never `--reps`) and if it is still `inconclusive` records the item unresolved and stops. Gap-closing work (the SP5 opponent model) lands whatever its A/B reads; if it reads `worse`, record it and flag it, do not revert.

**Conditional tasks.** A task whose header says "conditional" opens by reading the recorded outcome it depends on. If the condition fails, implement nothing: tick every box in that task and in the tasks it names with the note "skipped: <condition>", append the decision note the task specifies, run the link check, commit. A preregistration for a run a condition already forbade must not be written.

**Both cargo profiles, every simulator change, as the last step of the task.** Always prefix every cargo invocation with `RUSTFLAGS="-D warnings"`: cargo fingerprints `RUSTFLAGS`, so an invocation without it forces a full rebuild and burns minutes. Run the two profiles once, not repeatedly.

**Byte-exact corpus before any behaviour change.** Run `simulator/tools/capture-corpus.sh runs/corpus-pre` from `simulator/` *before* touching engine code, then recapture to `runs/corpus-post` after and diff. A task labelled behaviour-neutral must show a byte-identical diff (only `meta.json` elapsed-time fields may differ) and say so in its commit message. A task that moves behaviour records which policy and layout corpora moved. The corpus does not exercise the new draft-aware kind, so SP5's kind is covered by its own tests, not by the corpus.

**Keep the tree green at every commit.** A change that moves gated play moves the committed baselines: regenerate them in the same task through their committed harnesses, never by hand (`generate_robber_gate_baseline`, `generate_denial_gate_baseline`, `generate_trading_gate_baseline`, all `#[ignore]`d and run with `-- --ignored <name>`). Nothing in this plan should move them; if one moves, stop and record why before regenerating.

**Measurement hygiene.** Record `uptime` immediately before and after every measurement command and put both in the M entry. Never run a measurement in the same command block as a test suite or any other CPU-heavy job. Zero illegal actions is required for a run to be admissible. Build the release binary in its own command before the timed window.

**Long runs must keep printing.** The loop is killed after ten minutes of silence. Before any run expected to exceed five minutes (every SP5 run), time a 200-board version first and extrapolate. If the full run is predicted over eight minutes, launch it in the background (`... &`) and poll it with a loop that prints the elapsed minute while the process lives, then read the artifact. Never pipe a run through `tail` or `head`.

**SP5's opponent model never prunes.** The lookahead scores every legal candidate and every intervening pick. Speed comes from caching, never from restricting the candidate set; exactness against the field is the model's point.

**Never hand-edit `simulator/topology/*.json`.**

**Markdown.** One line per paragraph or bullet, never hard-wrapped. No em or en dashes anywhere, including code comments and commit messages. Cite code as `file.rs::symbol`, never `file.rs:line`. `tools/link-check.py` guards backticked paths only, so resolve every symbol citation by hand.

### Out of scope

SP6 (combine, coordinate pass, confirmation, adoption of anything). Minting new seed domain constants. Making the draft-aware kind the field. Porting the setup denial credit or the deterministic lookahead into the app's `analyze.ts`; the app keeps its sampled rollouts. `SIM-GAP-41`. Any `eval` or `gate` run. `extension6` and seat counts other than four in any measurement (the `slotScales` block carries entries for 3 to 6 seats at 1.0 so the contract is complete, but only the four-seat entries are measured). The Phase-3 boons/curses work and the mobile shell rebuild the repo `CLAUDE.md` names.

### Review bounds

Review and fix commits after the task phase may touch code and tests. They may not edit committed M entries, preregistration files, `gaps.md`, decision notes in `placement-programme.md`, any shipped default value, `simulator/topology/*.json`, or the numbers inside `simulator/fixtures/placement-parity.json`.

## Context

### Where things live

- `src/engine/valuation.ts`: `ScoreBreakdown` (six components), `breakdownTotal`, `marginalBreakdown`, `marginalTotal`, `scoreCandidate`, private `vertexBase`, `baseParts`, `diversityDelta`, `portDelta`, `buildPrecompute`. `Holdings` and `BoardContext` carry no occupancy and no roads; `computeBoardContext` never reads `board.buildings` or `board.roads`. `src/engine/weights.ts`: `EngineWeights` (28 fields) and `DEFAULT_WEIGHTS`.
- `src/engine/analyze.ts`: `analyzeBoard`, `rankCandidates`, `simulateWindowDetailed`, `opponentPick`, `receivesSecondSettlementGrant`, private `emptyBreakdown` and `addBreakdown`, and the averaging literal near the end of `rankCandidates` that rebuilds every component; the early-return literal in `valuation.ts::marginalBreakdown` is the fourth place a new component must be added. `Recommendation` carries `firstPick`, `plannedSecond`, `survival`, `score`, `rankScore`, `breakdown`, `expectedTaken`. The rollout's occupancy is the `blocked` set in `PreWindowResult`; rollouts never place roads.
- `src/engine/draft.ts::inferDraftState`: `sequence` is `draftOrder(board, 2)`, forward then reversed over `board.players`, so a player's slot is its index in `board.players` and `turnIndex` is the pick index. Seat count is `board.players.length`.
- `src/engine/legality.ts::vertexAdjacency` is the per-layout, grid-filtered vertex adjacency; `src/model/coords.ts` has `vertexIncidentEdgeIds`, `edgeEndpointVertexIds`, `vertexAdjacentVertexIds` (unfiltered, so guard with the grid's vertex set).
- `src/ui/AnalysisPanel.tsx`: `displayedFactors` hardcodes the six component labels; `recommendationMarks` emits `HighlightMark { ref, color, label }` for vertices 1 and 2. `src/ui/BoardCanvas.tsx::markLayer` draws only marks whose `ref` starts with `v:`; an edge mark needs its own branch there. `src/ui/store.ts::HighlightMark.ref` is a plain string, so an `EdgeId` fits without a type change.
- `simulator/crates/engine/src/placement/mod.rs`: `choose`, private `choose_app_formula` (settlement argmax, then the setup road chosen by scoring each incident edge's far endpoint with `score_for_owner(..., grant = false)` and a random tie-break), `setup_candidate_score`, `register_app_formula`, `PlacementKind::AppFormula(u8)`. `simulator/crates/engine/src/placement/app_formula.rs`: `EngineWeights` with `validate` (a hardcoded `scalars` array plus two hard bounds), `ScoreBreakdown`, `AppFormulaScorer::{new, breakdown, marginal_total, score_for_owner}`. `score_for_owner(vertex_owner, seat, candidate, receives_grant)` filters the owner array to its own seat and has no `edge_owner` and no topology handle after construction.
- `simulator/crates/engine/src/game.rs`: `setup`, `setup_pick` (one `choose` call returns `(vertex, edge)`), `setup_order` (`0..seats` then reversed, so slot equals seat), `SetupPick`, `play_traced`, `can_place_settlement`. `simulator/crates/engine/src/board.rs::prepare_app_formula` builds one scorer per (board, arm index).
- `simulator/crates/cli/src/expansion.rs::reachable_expansion_sites(topology, vertex_owner, edge_owner, seat)` is the SP0-D2 boxing walk (two rounds from the seat's road endpoints, rival settlements stop the walk, `can_place_settlement` filters sites); its doc comment already states how it differs from `policy::frontier::opened`. `blockability_share` and `game_pairs` are beside it; `simulator/crates/cli/src/diagnose.rs` wires them.
- `simulator/crates/cli/src/heuristics.rs::parse_heuristic` resolves `app_formula:<path>` and registers `app_formula:<stem>`; `simulator/crates/cli/src/evaluate.rs`: `EvaluateRequest`, `evaluation_schedule` (every `hero_seat in 0..seats` is a unit), `paired_stats`, `PairStats`, `try_paired_stats`; `simulator/crates/cli/src/stats.rs` owns the McNemar and clustered intervals.
- `simulator/crates/engine/src/policy/params_file.rs` tests: `every_committed_weights_file_loads_through_the_full_contract` (pins 51 weights arms; a file counts as a weights arm when it has a top-level `resourceValue` key), `the_sp2_arm_files_are_the_committed_single_term_perturbations` (driven by the `SP2_ARMS` table; extend the pattern for `sp3*`, `sp4*`, `sp5*` families), `the_sweep_bounds_file_is_complete_and_every_endpoint_admissible` (walks leaf JSON pointers of `default-weights.json`, so a nested object is fine but an array is one leaf).
- `simulator/tools/generate-placement-parity.ts` writes both `simulator/fixtures/placement-parity.json` and `simulator/placement/default-weights.json`; `simulator/crates/engine/tests/placement_parity.rs` has `REQUIRED_CLASSES` (40 classes, W1 through W12 are the weights classes), `FixtureCase`, `FixtureBreakdown`, and a hand-written `parse_weights`. A case carries a whole app `Board` JSON including `buildings` and `roads`, which the harness currently discards.
- Preregistrations go in `docs/plans/preregs/`. M entries append to `.claude/specs/simulator/measurements.md` (last entry M-53). Gap entries live in `.claude/specs/simulator/gaps.md`. Decisions and phase status append to `.claude/specs/simulator/placement-programme.md`. `simulator/README.md` documents commands and the arm families; update it when a command or family is added.

### The measurement protocol these runs follow

Every A/B is `evaluate`, `standard4`, 4 seats, `--domain tuning`, `--player-trading`, every seat on `heuristic-v1-trader-aware-threat-devcards-denial`, `--threads 0`, `--threshold 0.01`, `--alpha 0.05`, run from `simulator/`, field `app_formula:placement/default-weights.json`, reference `base=app_formula:placement/default-weights.json` unless a task names another reference. Screen power is 2000 boards x 2 reps; the single retry is 8000 boards x 2 reps. A 2000-board formula screen takes about five seconds; SP5's draft-aware arms will be far slower, which the long-run rule above covers. `simulator/runs/` and `simulator/target/` are gitignored.

### Defaults this plan fixes, which the programme left open

These are decisions, not discoveries; record each in the relevant prereg or decision note.

- **Occupancy reaches the formula as an explicit input on both sides.** SP3 needs legal-site and road information at score time and neither scorer has it. TypeScript gains an `Occupancy` value (a blocked-vertex set and an owned-edge map) passed to `marginalBreakdown`, `marginalTotal` and `scoreCandidate`, defaulting to empty; Rust's `score_for_owner` gains `edge_owner: &[u8]` and the scorer keeps the adjacency it needs from `new`. At `expansionWeight` 0 every number is bit-identical to today.
- **SP3 site definition.** From candidate `c`, walk edges outward. An edge owned by a rival, or a vertex occupied by a rival, is impassable; the seat's own edges cost 0 paid builds; an unowned edge costs 1, except that the first unowned edge on a path is free, being the setup road. A site is a vertex at path length at least 2 that would be legal once `c` is placed: unoccupied, no occupied neighbour, and not adjacent to `c`. Reach is capped at 2 paid builds (so at most 3 edges on a fully unowned path). Each site takes its cheapest paid-build count.
- **SP3 site value and term.** A site's value is the existing formula's marginal score of the site given the seat's holdings plus `c`, with `receivesGrant` false and the expansion term itself excluded (no recursion), multiplied by `expansionDecay ^ paidBuilds`. The term is `expansionWeight * (sum of the two largest discounted site values)`, in a new `expansion` breakdown component. `expansionWeight` ships at 0; `expansionDecay` ships at 0.5 and is inert while the weight is 0. Sweep bounds: `expansionWeight` 0.0 to 1.2, `expansionDecay` 0.125 to 1.0.
- **Road direction** is the first edge of the cheapest path to the highest-valued site, ties broken by the larger top-two sum reachable through that edge, then by the lowest edge id. Rust's `choose_app_formula` uses the same rule for the setup road whenever `expansionWeight` is nonzero and keeps today's far-endpoint scoring at 0, so the corpus stays byte-identical. The app exposes it as `Recommendation.firstRoad: EdgeId | null` and draws it as an edge mark on hover and click.
- **SP3 arm values.** Two arms in one run: `sp3_expansion_lo` at 0.1 and `sp3_expansion_hi` at 0.3, both on the live defaults with only that key changed. A site's marginal score is on the candidate's own scale, so 0.3 puts the term near a quarter of a typical candidate total; 0.1 is the conservative bracket. The survivor, if any, is the better-reading value.
- **Robber-attraction separation condition.** The stratified reading groups pairs by the number of distinct producing hexes the pair touches (the quantity M-48 named as the confound) and reports the blockability quartile gap within each stratum, plus the pair-count-weighted mean of those gaps. The concentration term is built only if that weighted mean is at most `-3pp` **and** the gap is negative in every stratum holding at least 1000 pairs. Both, not either. If built, the term is a delta: `robberConcentrationWeight * (topHexShare(holdings + c) - topHexShare(holdings))` subtracted from the score, in the existing `robber` component, shipping at 0, arm at 4.0 (a full-share move of 0.25 costs one point), bounds 0.0 to 16.0.
- **`slotScales` shape.** A nested object in `EngineWeights`: seat count key (`"3"`, `"4"`, `"5"`, `"6"`) to slot key (`"0"` to seats minus one) to `{ "expansion": number, "diversity": number }`, every entry 1.0 at ship. Exact keys are enforced: `validate` rejects a missing or extra seat count, a missing or extra slot, and any non-finite or negative scale. The `diversity` scale multiplies the whole `diversity` component delta; the `expansion` scale multiplies the `expansion` component. Sweep bounds per leaf: 0.25 to 4.0.
- **Slot plumbing.** TypeScript: `marginalBreakdown`, `marginalTotal` and `scoreCandidate` take an optional `DraftSlot { seats: number; slot: number }`; absent means scales of 1.0, and `analyze.ts` passes the picking player's slot from `board.players` and the seat count from `board.players.length`. Rust: `score_for_owner` uses `seat` as the slot (true by `setup_order`, and stated in a comment) and `board.seats()` as the seat count; a seat count outside 3 to 6 uses scales of 1.0.
- **SP4 arms are whole profiles, and the expansion axis is conditional.** Diversity profiles: `sp4_div_rise` scales slots 0 to 3 by 0.5, 0.8, 1.25, 2.0 and `sp4_div_fall` by the reverse. Expansion profiles `sp4_exp_rise` and `sp4_exp_fall` use the same numbers but only exist if SP3's `expansionWeight` read `better`, in which case they also carry that surviving weight, because scaling a weight of 0 measures nothing. Reference is `base`.
- **Per-hero-seat table.** `evaluation.json` gains, per arm, a `perHeroSeat` array of `PairStats` computed over the units whose `hero_seat` matches, using the same estimator and both intervals. No verdict per slot; the pooled verdict is the verdict. The artifact stays byte-identical across worker counts.
- **SP5 kind and spec string.** `app_formula_draft:<hero weights path>@<opponent weights path>`, registered as `app_formula_draft:<hero stem>@<opponent stem>`, two paths so the opponent model is pinned to the field's weights while the hero's are swept. Opponents are modelled as the field is: each intervening seat, in `setup_order` order, takes the argmax of the opponent formula for its own holdings under the same legality, ties to the lowest vertex index. Every arm in this plan pins the opponent path to `placement/default-weights.json`.
- **SP5 valuation.** First pick: for each legal candidate `c`, place `c`, replay the intervening opponents' argmax picks up to the hero's second pick, then value `c` as `marginal(c) + max over surviving legal s of marginal(s given c, grant = true)`; a candidate with no surviving second site scores `marginal(c)` alone. Second pick: the plain formula argmax, since no pick the hero cares about follows. Both picks choose the setup road by SP3's road rule at the hero's weights. The hero's own marginals use the hero weights, opponents' argmaxes use the opponent weights.
- **SP5 denial.** `setupDenialWeight` joins `EngineWeights` on both sides, ships at 0, bounds 0.0 to 4.0, and is read only by the draft kind; `src/engine/weights.ts` declares it with a comment that the app does not read it this run, the mirror image of the search-control fields Rust ignores. Inside the first-pick lookahead, for each intervening rival at its position in the sequence, denial is the rival's best available score with `c` still free minus with `c` taken by the hero, at the rival's own weights, floored at 0; the credit is `setupDenialWeight * sum over intervening rivals`. Arms: `sp5_denial_lo` at 0.25 and `sp5_denial_hi` at 1.0, reference `draft` (the kind at denial 0). The 1.0 arm is preregistered to read `equivalent` or `worse`.
- **`SIM-GAP-20` closes when the draft kind lands and M-59 is recorded**, whatever M-59 reads, because the gap is that the setup path has no opponent model. `SIM-GAP-34` stays open: a term at weight 0 closes nothing.
- **A new formula weight ships at its stated default** in `src/engine/weights.ts`, `simulator/placement/default-weights.json`, `simulator/placement/phase-i-candidate-weights.json` and every weights-shaped file under `simulator/placement/arms/` (51 today), and the A/B arm is the only file carrying a candidate value. Script the arm edit; preserve each file's key order and formatting. The arm-count pin moves by exactly the arms a task adds, and each new family gets its own pin test in `params_file.rs` following `SP2_ARMS`.

### Traps

- `cargo test --workspace` in debug takes about 4 minutes warm, release about 1:15 warm. `npm test` is about 16 seconds. Run each suite once, at the end of a task.
- The first task in a fresh worktree pays a full cold Rust build.
- The zsh shell: quote glob-bearing flags, and never use a bare `==` or `===` separator in a compound command.
- `parse_heuristics` rejects two arms whose registered names collide, so two weights files in one run need distinct stems.
- `evaluate` arm values split on the first `=`, so a spec path may contain `=` but a label may not. The `@` separator is already used by `--arm-policy` specs; the draft kind's `@` lives inside the `--arm` value, which is parsed by `parse_heuristic`, not by the policy parser.
- A weights file is a weights arm to the pin test only if it has a top-level `resourceValue` key; `slotScales` nests objects, and `collect_leaf_paths` descends objects but treats an array as one leaf, so never encode the block as arrays.
- `js_max`/`js_min` in `app_formula.rs` propagate NaN to match JavaScript; use them, not `f64::max`, anywhere a degenerate weight could reach.
- The parity test drives `AppFormulaScorer::breakdown`, not `score_for_owner`; the occupancy-aware entry has to become what the test drives, or SP3's class covers nothing.
- `generate-placement-parity.ts` also rewrites `default-weights.json`; run it after `DEFAULT_WEIGHTS` changes, never before.

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

A task that touches only Rust may skip the three npm commands; a task that touches only TypeScript may skip the two cargo commands; a task that touches only markdown runs only the link check. Any task that touches both runs everything. Measurement commands run from `simulator/`, because arm paths are relative to it.

### Task 1: Per-hero-seat paired table in `evaluate`

- [x] In `simulator/crates/cli/src/evaluate.rs`, compute for each arm a `perHeroSeat: Vec<PairStats>` (index = hero seat) over the units whose `hero_seat` matches, through the same `paired_stats` estimator, both intervals, same `clustered_degenerate` handling, and write it beside the pooled stats in `evaluation.json`
- [x] No per-slot verdict: the verdict field stays pooled. Document in the struct comment that the table is record-only and why (a slot-keyed weight is diluted in the pooled estimate by the slots it does not touch)
- [x] Add a CLI test that the per-seat `n` values sum to the pooled `n`, that each seat's `b + c` sums to the pooled `b + c`, and that two runs at different `--threads` produce byte-identical `evaluation.json`
- [x] Update the `evaluate` section of `simulator/README.md` and the "Paired statistics" section of `.claude/specs/simulator/contracts.md` with one sentence each
- [x] Both cargo profiles green, link check passes

### Task 2: Occupancy reaches the Rust scorer, behaviour-neutral

- [x] Capture `runs/corpus-pre`
- [x] Widen `app_formula.rs::AppFormulaScorer::score_for_owner` to take `edge_owner: &[u8]` and keep a compact adjacency copy (vertex adjacency, `edge_between`, vertex edge lists) taken from `Topology` in `new`, so the scorer can walk without a topology handle. Thread the new argument through `placement/mod.rs::choose_app_formula` (both call sites), `setup_candidate_score`, and `simulator/crates/cli/src/coastal.rs::compare_pick`
- [x] Add a public occupancy-aware entry beside `breakdown`, taking `vertex_owner`, `edge_owner`, `seat` and returning the `ScoreBreakdown`, and make `score_for_owner` its total. Nothing reads occupancy yet
- [x] Add a Rust test that the occupancy-aware entry and `breakdown` agree bit-for-bit on the parity fixture's cases when occupancy is derived from each case's board
- [x] Recapture and assert the corpus diff is empty; state that in the commit message
- [x] Both cargo profiles green

### Task 3: Occupancy reaches the TypeScript scorer and the parity harness, behaviour-neutral

- [x] Add `Occupancy { blocked: ReadonlySet<VertexId>; edgeOwner: ReadonlyMap<EdgeId, string> }` to `src/engine/valuation.ts` with an `emptyOccupancy()` and an `occupancyFromBoard(board)` built from `board.buildings` and `board.roads`; add it as an optional trailing parameter of `marginalBreakdown`, `marginalTotal` and `scoreCandidate`, default empty
- [x] In `analyze.ts`, build the rollout's occupancy from the board plus the rollout's `blocked` set and pass it through `scoreForScan`; rollouts place no roads, so the edge map is the board's
- [x] Make `simulator/tools/generate-placement-parity.ts::scoreCase` pass `occupancyFromBoard(input.board)` and make `placement_parity.rs` drive the Rust occupancy-aware entry with owner arrays built from the ingested board's buildings and roads (the seat is the owner of the first holding, or a fresh seat when there are none; record the rule in a comment on both sides)
- [x] Regenerate the fixture and assert every existing case's numbers are unchanged (diff the JSON: only formatting may move, and it should not)
- [x] All six validation commands green

### Task 4: SP3 expansion term in TypeScript

- [x] Add `expansionWeight` (0) and `expansionDecay` (0.5) to `EngineWeights` and `DEFAULT_WEIGHTS` in `src/engine/weights.ts`
- [x] Add an `expansion` component to `ScoreBreakdown`, `breakdownTotal`, the early-return literal in `marginalBreakdown`, `emptyBreakdown`, `addBreakdown`, the averaging literal in `rankCandidates`, and a row label `Expansion` in `AnalysisPanel.tsx::displayedFactors`
- [x] Implement the walk in a new `src/engine/expansion.ts`: `expansionSites(layout, occupancy, seatId, candidate)` returning each site with its paid-build count and the first edge of its cheapest path, per the site definition in Context (0/1-cost search over `vertexAdjacency(layout)` and `vertexIncidentEdgeIds`, grid-filtered). Export `expansionTerm(ctx, holdings, occupancy, candidate)` returning the term value and the chosen road edge, valuing each site by `marginalTotal` of the site given holdings plus the candidate with the expansion weight forced to 0 and no grant, discounted by `expansionDecay ^ paidBuilds`, summing the top two
- [x] Wire the term into `marginalBreakdown` and `marginalTotal` as the `expansion` component; at weight 0 skip the walk entirely so the hot path is unchanged
- [x] Declare both weights in `simulator/placement/sweep-bounds.json` under `placement` with the bounds in Context, and add both keys at their defaults to `default-weights.json` (via the generator, after Task 5's Rust mirror exists it must load), `phase-i-candidate-weights.json` and every weights-shaped arm file
- [x] Vitest: a hand-built board where a candidate with two strong distance-2 sites outscores an equal-production candidate boxed by rival settlements at an explicit witness weight, with the expected term derived in the test from the two sites' marginals; a case where a rival road blocks the only path; a case pinning the shipped default at 0 as bit-identical to the pre-change breakdown; and a case pinning the chosen road edge and its tie rule
- [x] `npm run typecheck`, `npm run lint`, `npm test` green (the Rust walk test in `params_file.rs` will fail until Task 5; say so in the commit message)

### Task 5: SP3 expansion term in Rust and the parity class

- [x] Mirror `expansion_weight` and `expansion_decay` in `app_formula.rs::EngineWeights` (fields, `validate` scalars, `expansionDecay` in `[0, 1]` as a hard bound), `expansion` in `ScoreBreakdown` and `total`, and the walk plus term in a new `placement/expansion.rs` using the scorer's adjacency copy from Task 2, with the same site definition, valuation, top-two sum, decay and road rule as the TypeScript
- [x] In `choose_app_formula`, when `expansion_weight` is nonzero choose the setup road by the road rule; at 0 keep the existing far-endpoint scoring so the corpus is byte-identical. Capture `runs/corpus-pre` before the edit and recapture after; assert the diff is empty
- [x] Add class `W13`, case `expansion-sites`, to `REQUIRED_CLASSES`, `FixtureBreakdown`, `parse_weights` and the generator: a board with rival buildings and roads, a nonzero witness weight, and a second case `expansion-blocked` where a rival road closes the only path. Regenerate the fixture
- [x] Add a Rust test that the walk agrees with `cli::expansion::reachable_expansion_sites` on the set of reachable sites for a seat with no roads placed (the two walks differ only in their start), and a test that at weight 0 `score_for_owner` never calls the walk (a counter or a `debug_assert` in a test-only hook)
- [x] Update the extension guide in `simulator/README.md` for the new component
- [x] All six validation commands green

### Task 6: Road direction in the app

- [x] Add `firstRoad: EdgeId | null` to `analyze.ts::Recommendation`, set from the expansion term's chosen edge for the first pick at the recommendation's own holdings; null when `expansionWeight` is 0 or no site is reachable
- [x] In `AnalysisPanel.tsx::recommendationMarks`, emit an edge mark `{ ref: firstRoad, color, label: 'R' }` when present, and add an edge branch to `BoardCanvas.tsx::markLayer` that draws a short stroke along the edge in the mark colour for refs starting with `e:` that are in the grid's edge set
- [x] Vitest for `recommendationMarks` covering present and null roads; a render test that an edge mark produces one edge stroke and no vertex circle
- [x] `npm run typecheck`, `npm run lint`, `npm test` green

### Task 7: Preregister M-54, the SP3 expansion A/B

- [x] Write `docs/plans/preregs/<today>-m54-sp3-expansion.md`
- [x] Two decision arms, `simulator/placement/arms/sp3_expansion_lo.json` (0.1) and `sp3_expansion_hi.json` (0.3), each the live defaults with only `expansionWeight` changed; reference `base`. Add an `SP3_ARMS` pin test in `params_file.rs` following `SP2_ARMS`, and move the weights-arm count pin by two
- [x] Screen power and protocol as in Context. State the power argument off M-48's smallest per-slot boxing magnitude (+5.54pp at slot 3), not the pooled row, and note that Task 1's per-seat table is where the slot pattern will be read
- [x] Decision rule fixed before the run: the standing disposition rule; the survivor is the better-reading arm if either reads `better`. Record only
- [x] Prediction and admissibility conditions
- [x] Both cargo profiles green, link check passes

### Task 8: Run M-54 and record it

- [x] Record `uptime`, run the preregistered command from `simulator/`, record `uptime` again
- [x] Append `## M-54: SP3 expansion term` with full provenance, the pooled paired table and the per-hero-seat table for each arm
- [x] Record the disposition under the standing rule, including the single retry if it read `inconclusive`. Name the survivor, if any, as an SP6 candidate and record the surviving value in the entry's last paragraph, since Tasks 9 and 15 read it. Adopt nothing
- [x] Link check passes

### Task 9: Preregister M-55, the expansion decay sweep, conditional on M-54

- [x] Read M-54. If no expansion arm read `better`, skip this task and Task 10 with the note "skipped: expansionWeight did not read better in M-54" and append a dated one-paragraph note to `placement-programme.md` recording that the decay axis was never swept and why (skipped: expansionWeight did not read better in M-54)
- [x] Otherwise write `docs/plans/preregs/<today>-m55-sp3-expansion-decay.md`: two arms at the surviving weight with `expansionDecay` 0.25 and 1.0 (`sp3_decay_lo`, `sp3_decay_hi`), reference `sp3_decay_ref` = the surviving weight at decay 0.5; extend the `SP3_ARMS` pin and the count (skipped: expansionWeight did not read better in M-54)
- [x] Screen power and protocol as in Context; the standing disposition rule applies to the decay axis, whose survivor is the better-reading decay or 0.5 if neither reads `better` (skipped: expansionWeight did not read better in M-54)
- [x] Prediction and admissibility conditions (skipped: expansionWeight did not read better in M-54)
- [x] Both cargo profiles green, link check passes (skipped: expansionWeight did not read better in M-54)

### Task 10: Run M-55 and record it, conditional on M-54

- [x] If Task 9 recorded the skip, tick these boxes with the same note and stop (skipped: expansionWeight did not read better in M-54)
- [x] Record `uptime`, run the preregistered command, record `uptime` again (skipped: expansionWeight did not read better in M-54)
- [x] Append `## M-55: SP3 expansion decay` with full provenance, both tables per arm, and the disposition; record the surviving `(expansionWeight, expansionDecay)` pair explicitly (skipped: expansionWeight did not read better in M-54)
- [x] Link check passes (skipped: expansionWeight did not read better in M-54)

### Task 11: Robber-attraction separation reading in `diagnose`

- [x] In `simulator/crates/cli/src/expansion.rs`, add the pair's distinct producing-hex count to `PairReading`, and in `expansion_reading` add a `blockabilityByHexCount` table: for each hex count present, the pair count, the blockability quartile gap within that stratum (same `quartile_gap` construction), plus the pair-count-weighted mean gap over strata holding at least 1000 pairs, and a boolean `concentrationTermIndicated` per the condition in Context
- [x] Emit the table in `diagnostics.json` overall and per slot; keep the artifact byte-identical across worker counts
- [x] Rust test over a hand-built sample pinning the stratification, the weighting, the 1000-pair floor and the boolean in both directions
- [x] Both cargo profiles green

### Task 12: Preregister M-56, the separation reading

- [x] Write `docs/plans/preregs/<today>-m56-robber-separation.md`: the same single `diagnose` invocation as M-47 and M-48 (`standard4`, 4 seats, `--domain tuning`, 2000 boards x 2 reps, composite policy with `--player-trading`, placement `app_formula:placement/default-weights.json`, `--alpha 0.05`, `--threads 0`), a diagnostic with no arm and no verdict, whose product is the `concentrationTermIndicated` boolean
- [x] State the passing condition from Context before the run and why each half exists: the weighted mean guards magnitude, the every-stratum sign guards against one stratum carrying the pooled gap
- [x] Prediction and admissibility conditions
- [x] Link check passes

### Task 13: Run M-56 and record it

- [x] Record `uptime`, run the preregistered command, record `uptime` again
- [x] Append `## M-56: blockability within hex-count strata` with full provenance, the per-stratum table overall and per slot, the weighted mean, and the boolean
- [x] Append a dated decision note to `placement-programme.md` recording whether the concentration term is built, superseding the "open with its first task named" sentence of the SP0 decisions
- [x] Link check passes

### Task 14: Robber concentration term, conditional on M-56

- [x] Read M-56. If `concentrationTermIndicated` is false, skip this task and Tasks 15 and 16 with the note "skipped: M-56 did not separate blockability from hex count" and stop (M-56 read `concentrationTermIndicated` true: weighted mean gap `-6.65pp` over both counted strata, each strictly negative, so the term is built and Tasks 15 and 16 stand)
- [x] Otherwise add `robberConcentrationWeight` (0) to both `EngineWeights`, `DEFAULT_WEIGHTS`, `validate` (non-negative), sweep bounds 0.0 to 16.0, every weights-shaped file; implement the delta term from Context in both scorers inside the `robber` component; vitest with hand-derived expected values at a witness weight and a 0 pin; parity class `W14`, case `robber-concentration`, regenerated fixture
- [x] All six validation commands green

### Task 15: Preregister M-57, the concentration A/B, conditional on M-56

- [x] If Task 14 recorded the skip, tick these boxes with the same note and stop (Task 14 recorded no skip: M-56 read `concentrationTermIndicated` true and the term is built, so this task runs in full)
- [x] Write `docs/plans/preregs/<today>-m57-robber-concentration.md`: one arm `sp3_concentration.json` at 4.0, reference `base`; extend `SP3_ARMS` and the count; screen power and protocol as in Context; standing disposition rule; prediction and admissibility
- [x] Both cargo profiles green, link check passes

### Task 16: Run M-57 and record it, conditional on M-56

- [x] If Task 14 recorded the skip, tick these boxes with the same note and stop (Task 14 recorded no skip: M-56 read `concentrationTermIndicated` true and the term is built, so this run executed in full)
- [x] Record `uptime`, run, record `uptime` again; append `## M-57: robber concentration term` with full provenance, both tables, and the disposition including the single retry (the arm read `equivalent`, which buys no retry: the single retry is bought by `inconclusive` alone)
- [x] Link check passes

### Task 17: SP4 `slotScales` block and slot plumbing, behaviour-neutral

- [ ] Capture `runs/corpus-pre`
- [ ] Add `slotScales` to both `EngineWeights` with the shape, defaults and `validate` rules in Context; TypeScript `DEFAULT_WEIGHTS` and the Rust mirror build the 3-to-6 seat entries at 1.0
- [ ] Plumb the slot: TypeScript `DraftSlot` parameter on `marginalBreakdown`, `marginalTotal`, `scoreCandidate`, passed from `analyze.ts` for the picking player at each scored pick (first pick and planned second alike); Rust `score_for_owner` uses `seat` and the scorer's seat count taken from the board in `new`. Apply the `diversity` scale to the diversity delta and the `expansion` scale to the expansion term
- [ ] Sweep bounds: one `{min 0.25, max 4.0}` range per leaf under `placement/slotScales`; add the block at 1.0 to every weights-shaped file, scripted
- [ ] Parity: `FixtureCase` gains `slot: { seats, slot } | null` on both sides (null means no scaling); add class `W15`, case `slot-scales`, at a non-neutral four-seat scale, and regenerate
- [ ] Vitest: a scaled slot changes only the two scaled components by exactly the scale factor; a 1.0 block is bit-identical to no block; `validate` rejects a missing slot key, an extra seat count and a negative scale (Rust test for the same three rejections)
- [ ] Recapture and assert the corpus diff is empty; state that in the commit message
- [ ] All six validation commands green

### Task 18: Preregister M-58, the SP4 profile sweep

- [ ] Write `docs/plans/preregs/<today>-m58-sp4-slot-profiles.md`
- [ ] Arms per Context: `sp4_div_rise`, `sp4_div_fall`, and, only if M-54 or M-55 recorded a surviving `expansionWeight`, `sp4_exp_rise` and `sp4_exp_fall` carrying the surviving weight and decay. State plainly which set applies and why the expansion pair is absent if it is. Reference `base`. Add an `SP4_ARMS` pin test that checks each arm differs from the live defaults only in the four-seat `slotScales` entries (plus the surviving expansion pair where applicable) and move the count
- [ ] Screen power and protocol as in Context; state that the per-hero-seat table is the reading of record for which slots drive an arm, while the pooled verdict decides
- [ ] Decision rule fixed before the run: the standing disposition rule per arm; a surviving profile is an SP6 candidate as a whole block. Record only
- [ ] Prediction (the diversity axis should read near zero at slot 0's first pick since there is nothing to complement yet, so `div_rise` is the favoured direction) and admissibility conditions
- [ ] Both cargo profiles green, link check passes

### Task 19: Run M-58 and record it

- [ ] Record `uptime`, run every preregistered invocation, record `uptime` again
- [ ] Append `## M-58: SP4 slot-scale profiles` with full provenance, pooled and per-hero-seat tables per arm, and the disposition per arm including the single retry
- [ ] Link check passes

### Task 20: SP5 draft-aware placement kind

- [ ] Add `PlacementKind::AppFormulaDraft(u8)` with its own registry entry carrying the hero and opponent `EngineWeights`, `parse_heuristic` support for `app_formula_draft:<hero>@<opponent>` per Context, `prepare_app_formula_boards` building both scorers per board, and `PlacementKind::name` reporting the registered name
- [ ] Implement the first-pick and second-pick valuation from Context in a new `placement/draft.rs`, exact over every legal candidate, using `score_for_owner` at the hero weights for the hero and at the opponent weights for each intervening seat, replaying intervening argmaxes onto scratch owner arrays. Choose the setup road by SP3's road rule at the hero weights. Read `setup_denial_weight` as 0 for now (Task 23 adds the credit); structure the lookahead so the rival's pre- and post-`c` best scores are available to it
- [ ] Cache per-candidate opponent scores where the holdings do not change between candidates; measure a 200-board `evaluate` with a draft arm before and after and record the games per second in the commit message. Never prune the candidate set
- [ ] Rust test: on ten traced games from the `tuning` domain where every field pick is tie-free (assert it by re-scoring), the lookahead's predicted intervening picks equal the picks the field actually made; a test that the hero's second pick equals `AppFormula`'s choice on the same state; a test that a `standard4` first pick completes in under 50 milliseconds in release
- [ ] `simulator/README.md`: document the kind and its spec string; `contracts.md`: one sentence under "Rosters" or the placement section naming the kind and the pinned-opponent rule
- [ ] Both cargo profiles green, link check passes

### Task 21: Preregister M-59, the opponent-model A/B

- [ ] Write `docs/plans/preregs/<today>-m59-sp5-draft-awareness.md`
- [ ] One arm, `draft=app_formula_draft:placement/default-weights.json@placement/default-weights.json`, reference `base`. This is gap-closing work under the gap-fix rule: it lands whatever it reads, and `worse` is recorded and flagged, not reverted
- [ ] Screen power and protocol as in Context. Preregister the timing: the 200-board extrapolation from Task 20, the background-and-poll invocation if the full run is predicted over eight minutes, and the admissibility rule that a build must not land inside the timed window
- [ ] Prediction (positive, since the field's first-pick greedy leaves the surviving-pair value unpriced) and admissibility conditions
- [ ] Link check passes

### Task 22: Run M-59, record it, close `SIM-GAP-20`

- [ ] Record `uptime`, run the preregistered invocation from `simulator/` (background and poll if preregistered so), record `uptime` again
- [ ] Append `## M-59: SP5 setup draft awareness` with full provenance including games per second, both tables, and the disposition under the gap-fix rule; flag a `worse` reading for the user
- [ ] Delete the `SIM-GAP-20` entry from `.claude/specs/simulator/gaps.md`, update the "How to read the gap inventory" sentence in `.claude/specs/simulator/programme.md` that names it, and say so in the commit message
- [ ] Link check passes

### Task 23: SP5 setup denial credit

- [ ] Add `setupDenialWeight` (0) to both `EngineWeights` per Context: TypeScript declares it with the not-read-by-the-app comment, Rust validates it non-negative, sweep bounds 0.0 to 4.0, every weights-shaped file gains it at 0
- [ ] Implement the credit in `placement/draft.rs` per Context; `AppFormula` never reads it. At 0 the lookahead's choices are bit-identical to Task 20's (pin with a test over the same traced games)
- [ ] Rust test on a hand-built state: a candidate that is the next rival's unique best gains exactly `weight * (rival best with c free - rival best with c taken)`; a candidate no rival wants gains 0; the credit floors at 0
- [ ] Both cargo profiles green

### Task 24: Preregister M-60, the denial A/B

- [ ] Write `docs/plans/preregs/<today>-m60-sp5-setup-denial.md`
- [ ] Arms `sp5_denial_lo` (0.25) and `sp5_denial_hi` (1.0), each `app_formula_draft:placement/arms/<file>.json@placement/default-weights.json`, reference `draft` = the kind at the live defaults; add an `SP5_ARMS` pin and move the count. State plainly that the opponent path is pinned to the live defaults in every arm and why
- [ ] Preregister the null for `sp5_denial_hi`: expected `equivalent` or `worse` at the `±1pp` threshold; `equivalent` at screen power confirms it, `inconclusive` confirms nothing and buys the single retry. `sp5_denial_lo` is an ordinary optional term under the standing rule
- [ ] Screen power, protocol and the long-run timing preregistration as in Task 21
- [ ] Prediction and admissibility conditions
- [ ] Both cargo profiles green, link check passes

### Task 25: Run M-60 and record it

- [ ] Record `uptime`, run every preregistered invocation, record `uptime` again
- [ ] Append `## M-60: SP5 setup denial` with full provenance, both tables per arm, the disposition per arm including the single retry, and whether the preregistered null held
- [ ] Link check passes

### Task 26: SP3 through SP5 completion note

- [ ] Append a dated `## SP3 through SP5 completion` note to `placement-programme.md`: every M entry from M-54 on with its verdict, the SP6 survivor list (a term, its value, and the entry that made it a survivor), the terms sitting inert at 0, the closed and still-open gaps, and that the field's placement is unchanged pending SP6
- [ ] Update the repo `CLAUDE.md` simulator bullet if a command or convention this run introduced needs a rule there (the draft kind's pinned-opponent spelling qualifies); leave it alone otherwise
- [ ] Link check passes

### Task 27: Verify acceptance criteria

- [ ] `npm run typecheck` clean
- [ ] `npm run lint` clean (the pre-existing `src/ui/glyphs.tsx` fast-refresh warning is the only permitted warning and must not have grown)
- [ ] `npm test` fully green
- [ ] `python3 tools/link-check.py . .claude/specs/simulator simulator/README.md docs/plans/preregs` reports zero bad references
- [ ] `RUSTFLAGS="-D warnings" cargo test --manifest-path simulator/Cargo.toml --workspace` fully green
- [ ] `RUSTFLAGS="-D warnings" cargo test --manifest-path simulator/Cargo.toml --release --workspace` fully green
- [ ] `git status` is clean apart from gitignored run artifacts
- [ ] `gaps.md` no longer contains `SIM-GAP-20` and still contains `SIM-GAP-34` through `SIM-GAP-37` and `SIM-GAP-41`
- [ ] `measurements.md` contains M-54, M-56, M-58, M-59 and M-60, plus M-55 and M-57 unless their conditions skipped them, each with a date, a commit, a domain, an exact command, load before and after, a games count, an illegal-action count, and an admissibility statement; grep the new entries and preregs for `--domain eval` and `--domain gate` and confirm neither appears
- [ ] `simulator/placement/default-weights.json` matches `DEFAULT_WEIGHTS` (the vitest mirror test proves it); against the pre-run tree its only differences are `expansionWeight` 0, `expansionDecay` 0.5, `slotScales` all 1.0, `setupDenialWeight` 0, and `robberConcentrationWeight` 0 if Task 14 built it
- [ ] Every weights-shaped file under `simulator/placement/arms/` loads through the exact-key walk test and the count pin equals 51 plus the arms this run added
- [ ] `placement-programme.md` carries the M-56 decision note and the completion note, each appended
- [ ] Write a run summary at the end of `.ralphex/progress/progress-simulator-placement-sp3-sp5.txt` listing every M entry produced, its verdict, and the survivors carried to SP6

## Post-Completion

These need a human and cannot be automated.

- **Re-verify the regenerated `simulator/fixtures/placement-parity.json` by hand.** Tasks 3, 5, 14 and 17 regenerate it; the loop proves the two scorers agree with each other, not that the new expected numbers are right. This supersedes the same item still open from the SP0 to SP2 run.
- **Read the flagged readings.** A `worse` verdict on M-59 is recorded and flagged but not reverted.
- **Decide the seed domains before SP6**, and whether the draft-aware kind becomes the field there, which re-opens every reading taken on the formula-only field.
- **Decide whether the app gets the deterministic lookahead or the denial credit** if M-59 or M-60 read `better`; this run measured them in the simulator only.
