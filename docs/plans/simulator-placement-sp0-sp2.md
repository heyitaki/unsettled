# Placement programme: SP0, SP1 and SP2

## Overview

Execute phases **SP0**, **SP1** and **SP2** of [`.claude/specs/simulator/placement-programme.md`](../../.claude/specs/simulator/placement-programme.md). Read that file in full before the first task; it is the normative decision record for everything below and this plan never restates its rationale.

When this run is done:

- The simulator has a `diagnose` subcommand and an opt-in setup-pick trace, and the SP0-D1 (coastal selection) and SP0-D2 (expansion boxing, blockability) readings are recorded as M entries.
- The SP1 field change has landed: the robber picks hex and victim by one joint argmax, the victim's own need is priced, the need model has a completion step, the knight's own-tile relief is a declared parameter, and the `SIM-GAP-33` contest block-bonus predicate is tightened. `SIM-GAP-33`, `SIM-GAP-38`, `SIM-GAP-39` and `SIM-GAP-40` are deleted from `gaps.md`.
- The SP1e knight/threat sweep and the post-SP1 re-screen of the adopted Phase-I vector have run and are recorded.
- The SP2a dev-card recipe term and the SP2b coverage-conditioned port term exist in both scorers at a shipped weight of 0, each with a measured A/B recorded. SP2c (hex-count tempo) has either shipped the same way or been explicitly skipped on SP0-D1's recorded verdict.

### Standing rules for every iteration

**Record only. Never adopt.** Do not change any shipped default *value*: not in `src/engine/weights.ts`, not in `simulator/placement/default-weights.json`, not in `HeuristicParams::default()` or its siblings, not in `simulator/placement/policy-default-params.json`, not in `simulator/placement/phase-i-candidate-*.json`. The only permitted default changes are the ones a task explicitly specifies: a *new* parameter introduced at its stated behaviour-preserving value. A measured winner is recorded as a survivor for SP6 and nothing else.

**`--domain tuning` only.** Never run a command carrying `--domain eval` or `--domain gate`. Both domains are spent and the repo forbids them. Every run in this plan is `tuning`.

**Preregister, then run.** Each scaled run has its own task pair: one task writes `docs/plans/preregs/<YYYY-MM-DD>-m<NN>-<slug>.md` and commits it, the next task executes and appends the M entry. Never write the prereg and run the measurement in the same task; the commit is what freezes it. Follow the shape of `docs/plans/preregs/2026-08-25-m43-h3-handvalue.md`: change under test, why this field answers the question, design, exact command, decision rule fixed before the run, prediction, threshold and alpha, admissibility.

**`measurements.md` is append-only.** Add entries at the end; never edit or renumber an existing one. This plan's M numbers (M-47 onward) are the expected assignment; if the file has moved on, take the next unused number and keep the plan's ordering.

**Disposition rule, preregistered.** For an optional term: `better` keeps it at its measured value as an SP6 survivor, `worse` drops it and the M entry records why it was expected to help, `equivalent` at declared power drops it and records the null as the answer, `inconclusive` buys units exactly once at four times the boards (raise `--boards`, never `--reps`) and if it is still `inconclusive` records the item unresolved and stops. Gap-closing work (SP1a-d and the `SIM-GAP-33` fix) lands whatever its A/B reads; if such a fix reads `worse`, record it and flag it, do not revert.

**Both cargo profiles, every simulator change, as the last step of the task.** Always prefix every cargo invocation with `RUSTFLAGS="-D warnings"` — cargo fingerprints `RUSTFLAGS`, so an invocation without it forces a full rebuild of the workspace and burns several minutes. Run the two profiles once, not repeatedly.

**Byte-exact corpus before any behaviour change.** Run `simulator/tools/capture-corpus.sh runs/corpus-pre` *before* touching engine code, then recapture to `runs/corpus-post` after and diff. A task labelled behaviour-neutral must show a byte-identical diff and say so in its commit message. A task that moves behaviour records which policy/layout corpora moved.

**Keep the tree green at every commit.** A change that moves gated play moves the committed baselines: regenerate them in the same task through their committed harnesses, never by hand. `RUSTFLAGS="-D warnings" cargo test --manifest-path simulator/Cargo.toml -p unsettled-sim --test threat_gate -- --ignored generate_robber_gate_baseline` and the same shape for `generate_denial_gate_baseline` (`--test denial_gate`) and `generate_trading_gate_baseline` (`--test trading_gate`). Replay-derived trading fixtures are re-derived through `refind_replay_fixtures` and `find_forwarding_fixtures` in `crates/engine/tests/player_trading.rs`, both `#[ignore]`d and run the same way.

**Measurement hygiene.** Record `uptime` immediately before and immediately after every measurement command and put both in the M entry, as the existing entries do. Never run a measurement in the same command block as a test suite or any other CPU-heavy job; a busy machine turns a real result into noise. Zero illegal actions is required for a run to be admissible.

**Never hand-edit `simulator/topology/*.json`.**

**Markdown.** One line per paragraph or bullet, never hard-wrapped. No em or en dashes. Cite code as `file.rs::symbol`, never `file.rs:line`. `tools/link-check.py` guards backticked paths only, so resolve every symbol citation by hand.

### Out of scope

SP3 (expansion term), SP4 (draft-slot conditioning), SP5 (setup draft awareness and denial) and SP6 (combine and confirm). Minting new seed domain constants: the programme defers that decision to SP6 and everything here runs on `tuning`. Adopting any measured winner into a shipped default. Any `eval` or `gate` run. The app's UI beyond the one file listed under SP2c. The Phase-3 boons/curses work the repo `CLAUDE.md` marks paused.

## Context

### Where things live

- `simulator/crates/engine/src/policy/threat.rs` — `robber_choice`, `own_need_hit`, `victim_rank`, `need_share`, `cheapest_route_shortfall`, `seat_terms`, `ThreatParams`. SP1a, SP1b, SP1c.
- `simulator/crates/engine/src/policy/heuristic_v1.rs` — `knight_action_score`. The own-tile relief constant is the literal `12.0` multiplying the blocked hex's pips. SP1d.
- `simulator/crates/engine/src/policy/denial.rs` — `contest_term`, the `contest_block_bonus` predicate. `SIM-GAP-33`.
- `simulator/crates/engine/src/game.rs` — `setup`, `setup_pick`, `setup_order`. The setup trace hooks here.
- `simulator/crates/engine/src/placement/mod.rs` — `choose`, `choose_app_formula`, `vertex_score`. `AppFormulaScorer::score_for_owner(vertex_owner, seat, vertex, grant)` is the entry point a diagnostic re-scores candidates with.
- `simulator/crates/engine/src/placement/app_formula.rs` — the Rust mirror of the app formula, including `EngineWeights`, `coverage`, `port_surplus`.
- `simulator/crates/engine/src/policy/frontier.rs` — `opened`, the in-game reference implementation of what "opened" means. SP0-D2's boxing walk follows its notion of an expansion target.
- `simulator/crates/cli/src/main.rs` — the `Command` enum and per-command arg structs. `simulator/crates/cli/src/evaluate.rs` — `evaluation_schedule`, `evaluate`, `paired_stats`, artifact writing. `simulator/crates/cli/src/stats.rs` — the McNemar and board-clustered interval machinery.
- `src/engine/valuation.ts` — `ScoreBreakdown`, `diversityScore` (which holds all three recipe terms), `portDelta`, `portSurplus`, `coverage`, `marginalBreakdown`, `marginalTotal`. `src/engine/weights.ts` — `EngineWeights` and `DEFAULT_WEIGHTS`.
- `simulator/tools/generate-placement-parity.ts` regenerates `simulator/fixtures/placement-parity.json`; `simulator/crates/engine/tests/placement_parity.rs` consumes it and asserts its `REQUIRED_CLASSES` coverage set exactly.
- Preregistrations go in `docs/plans/preregs/`. M entries append to `.claude/specs/simulator/measurements.md`. Gap entries are deleted from `.claude/specs/simulator/gaps.md`. Decisions and phase status append to `.claude/specs/simulator/placement-programme.md`.

### The measurement protocol these runs follow

Every A/B in this plan is `evaluate`, `standard4`, 4 seats, `--domain tuning`, `--player-trading`, every seat on the composite policy `heuristic-v1-trader-aware-threat-devcards-denial`, `--threads 0`, `--threshold 0.01`, `--alpha 0.05`, run from `simulator/`. Placement field: `pip_diversity` for a *policy*-parameter A/B (SP1, matching M-43 through M-46), and `app_formula:placement/default-weights.json` for a *formula*-weight A/B (SP2), because a formula arm has to be scored against the live formula. Screen power is 2000 boards x 2 reps (16,000 paired units); confirmation power is 8000 boards x 2 reps. Prefer raising `--boards` over `--reps`: clustered precision comes from the number of boards. Runs are fast: a 2000-board 11-arm run took about 35 seconds and an 8000-board single-arm run about 20 seconds.

`simulator/runs/` and `simulator/target/` are gitignored, so run artifacts never dirty the tree.

### Defaults this plan fixes, which the programme left open

These filled real gaps in the spec. They are decisions, not discoveries; record them in the relevant prereg.

- **`SIM-GAP-33` rides SP1** and lands first among the behaviour changes, so its own A/B is against the adopted defaults exactly as its gap entry requires, before SP1b/c/d move the field further.
- **A new formula weight ships at 0** in `src/engine/weights.ts`, `simulator/placement/default-weights.json`, `simulator/placement/phase-i-candidate-weights.json` and all 49 weights-shaped files under `simulator/placement/arms/`, and its term must reduce to today's arithmetic exactly at 0. The A/B arm is the only file carrying the candidate value. This keeps every frozen arm a single-parameter perturbation of its own baseline and ships no behaviour change, following the `handValueWeight` precedent.
- **Sweep-bounds convention:** an existing parameter's declared range is default/4 to default x 4. A new weight defaulting to 0 declares `min` 0.0 and `max` four times its A/B candidate value.
- **A new policy parameter that replaces a hardcoded constant defaults to that constant**, so the change is behaviour-neutral and provable against the corpus.
- **SP1b's new `victimNeedWeight` and SP1c's new `needCompletionWeight` join SP1e's sweep** as a fourth and fifth axis. The programme lists three; leaving two brand-new axes unswept beside three swept ones would be worse.
- **The 49 weights-shaped arm files have no test walking them**, though `contracts.md` says one exists. Task 19 adds it, which is also what makes the 51-file edit verifiable.
- **`hex count`** throughout SP0 means the number of adjacent hexes carrying both a resource and a token, which is the quantity the setup grant pays on and the one `SIM-GAP-35` names. **`pip total`** means the sum of pips over those hexes.

### Traps

- `cargo test --workspace` in debug takes about 4 minutes warm, release about 1:15 warm. `npm test` is about 16 seconds. Budget for it and run the suites once, at the end of a task.
- The first task in a fresh worktree pays a full cold Rust build; `simulator/target/` does not come along.
- The zsh shell here: quote glob-bearing flags, and never use a bare `==` or `===` separator in a compound command.
- `#[ignore]`d tests are excluded from a normal run. The throughput and timing observations stay ignored; only the named regeneration harnesses are run deliberately.
- Nothing currently loads the 49 weights arm files in a test, so a broken key set there fails silently until an arm is used in a run.
- `evaluate` arm values split on the first `=`, so a spec path may contain `=` but a label may not.
- Never put more arms in a `tournament` than there are seats. This plan uses `evaluate` throughout, where the rule does not apply.

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

A task that touches only Rust may skip the three npm commands; a task that touches only TypeScript may skip the two cargo commands; a task that touches only markdown runs only the link check. Any task that touches both runs everything.

Measurement commands run from `simulator/`, because arm paths are relative to it.

### Task 1: Setup-pick trace, behaviour-neutral

- [x] Capture the pre-change corpus: `cd simulator && tools/capture-corpus.sh runs/corpus-pre`
- [x] Add a `SetupPick` record to `simulator/crates/engine/src/game.rs` carrying the seat, the pick index (0 or 1), whether the pick took the setup grant, the chosen vertex and the chosen edge
- [x] Thread an opt-in `Option<&mut Vec<SetupPick>>` (or an equivalent that keeps the hot path allocation-free when absent) from the game runner through `Game::setup` into `Game::setup_pick`, defaulting to absent everywhere it is not requested
- [x] Confirm no scoring, RNG draw, or ordering changes: the trace only observes
- [x] Add a Rust test that a traced game records exactly `2 * seats` picks, in the snake order `setup_order` produces, and that replaying the recorded picks onto an empty owner array reproduces the game's final setup ownership and edge ownership
- [x] Recapture to `runs/corpus-post` and assert the diff against `runs/corpus-pre` is empty; state that in the commit message
- [x] Both cargo profiles green

### Task 2: `diagnose` subcommand and its deterministic artifact

- [x] Add `Command::Diagnose(DiagnoseArgs)` to `simulator/crates/cli/src/main.rs` with `--layout`, `--seats`, `--domain`, `--placement`, `--boards`, `--reps`, `--policy`, `--player-trading`, `--alpha`, `--threads`, `--out`, and `--allow-unofficial`, following `EvaluateArgs` for defaults and validation
- [x] Every seat uses `--placement` and `--policy`; there is no field, no arm and no hero-seat rotation
- [x] Derive the game seed from `(domain seed, board, rep, hero seat = 0)` through the existing evaluation seed derivation, so a diagnose run is reproducible and its boards are the same board set an `evaluate` run at the same domain, layout and seat count would generate. Document the fixed hero-seat slot in the code
- [x] Run `boards * reps` games in schedule order under rayon, collecting one traced observation record per game, aggregated serially through that order
- [x] Write `diagnostics.json` plus `meta.json` to `--out`. `diagnostics.json` carries the run configuration and the statistics only, with no elapsed time and no worker count, so repeating a run produces a byte-identical artifact at any worker count. Populate it in this task with the observation counts alone; Tasks 3 and 4 add the statistics
- [x] Add a CLI test asserting `--domain` is required, that an unofficial seat count is rejected without `--allow-unofficial`, and that two runs at different `--threads` produce byte-identical `diagnostics.json`
- [x] Both cargo profiles green

### Task 3: SP0-D1, the coastal-selection statistic

- [x] For each recorded setup pick, rebuild the `vertex_owner` array as it stood immediately before that pick by replaying the preceding picks of the same game
- [x] Score every legal candidate vertex at that state with the same `AppFormulaScorer::score_for_owner` call the pick used, with the same `grant` flag
- [x] Take the chosen vertex and the best-scoring unchosen legal alternative whose pip total is within one of the chosen vertex's pip total. Record the hex count of each. Skip the pick if no such alternative exists
- [x] Discard pairs whose two hex counts are equal
- [x] Over the pairs that remain, report the share in which the chosen vertex had the lower hex count, with a board-clustered interval at the run's `--alpha`, reusing the clustered interval machinery in `simulator/crates/cli/src/stats.rs`
- [x] Report the win rate of the picking seat's games split by that choice: lower hex count chosen versus not
- [x] Report all of the above overall and broken down per draft slot, meaning the picking seat's index, so a slot effect cannot hide inside an average
- [x] Emit a boolean `sp2cGatePassed` computed from the preregistered passing condition: the share sits above 50% by more than its clustered interval **and** the lower-hex-count games win at least 1 percentage point less often. Both conditions, not either
- [x] Add a Rust test over a hand-built fixture game with known picks that pins the pair construction, the tie discard, and the gate boolean in both directions
- [x] Both cargo profiles green

### Task 4: SP0-D2, boxing and blockability

- [x] For each seat in each game, take the board state immediately after that seat's second setup pick, which is the moment its pair is completed
- [x] **Boxing:** count the legal expansion sites the pair can reach within two road builds. A site is a vertex that is unoccupied and not adjacent to an occupied vertex at that moment; reachable means reachable from the seat's own road network by adding at most two roads, counting distances 0, 1 and 2. Follow `policy::frontier::opened` for what counts as an expansion target, but walk from the seat's road network rather than from one vertex
- [x] **Blockability:** compute the share of the pair's total pips sitting on its single highest-pip hex, over the distinct producing hexes adjacent to either settlement. Report 0 when the pair has no producing hexes
- [x] Join both to the game's outcome and report each as the win rate of the top quartile of that quantity minus the win rate of the bottom quartile, constructed identically so the two magnitudes are comparable
- [x] Report the incidence of zero reachable expansion sites alongside the boxing gap
- [x] Report both overall and per draft slot
- [x] Emit a boolean `robberAttractionRevisit`, true when the absolute blockability quartile gap exceeds the absolute boxing quartile gap
- [x] Add a Rust test over a hand-built fixture pinning the two-road reach set, the zero-site case, the blockability share, and the quartile split
- [x] Both cargo profiles green

### Task 5: Preregister M-47 and M-48

- [x] Write `docs/plans/preregs/<today>-m47-sp0-d1-coastal-selection.md` covering the D1 reading: what it measures, why the pip-matched runner-up construction makes 50% the null, the exact command, the passing condition for SP2c stated before the run, and a prediction
- [x] Write `docs/plans/preregs/<today>-m48-sp0-d2-expansion-blockability.md` covering both D2 quantities, why both are read at pair completion rather than at game end, the exact command, the branch condition that decides whether the dropped robber-attraction term is revisited, and a prediction
- [x] Both preregs name the single invocation that produces all three readings, at `standard4`, 4 seats, `--domain tuning`, 2000 boards x 2 reps, every seat on `heuristic-v1-trader-aware-threat-devcards-denial` with `--player-trading`, placement `app_formula:placement/default-weights.json`, `--alpha 0.05`, `--threads 0`
- [x] Both preregs state that this is a diagnostic with no arms and no verdict, so the paired-statistics disposition rule does not apply to it; what it produces is a gate boolean and a branch boolean
- [x] Both preregs record the admissibility conditions: `uptime` before and after, zero illegal actions, no concurrent CPU-heavy job
- [x] Link check passes

### Task 6: Run the SP0 diagnostic and record M-47 and M-48

- [x] Record `uptime`, run the preregistered command from `simulator/`, record `uptime` again
- [x] Append `## M-47 — SP0-D1 coastal selection` to `.claude/specs/simulator/measurements.md` with full provenance (date, commit, domain, exact command, load before and after, games, illegal actions, admissibility) and the D1 numbers overall and per draft slot, ending with the gate outcome for SP2c
- [x] Append `## M-48 — SP0-D2 expansion boxing and blockability` in the same shape, with both quartile gaps, the zero-site incidence, and the branch outcome for the robber-attraction term
- [x] Append a dated decision note to `.claude/specs/simulator/placement-programme.md` recording, as decisions this run made: whether SP2c runs, and whether SP3 will need a separate boxing penalty rather than one gradient term. Supersede, never edit, per the class-D rule
- [x] Copy `diagnostics.json` nowhere: `simulator/runs/` is gitignored and the M entries are the record
- [x] Link check passes

### Task 7: SP1a, joint argmax over hex and victim

- [x] Capture `runs/corpus-pre`
- [x] Rewrite `threat.rs::robber_choice` as one joint maximum over `(hex, victim)` pairs, with `own_need_hit` inside the quantity being maximized, replacing the current two-stage search that picks a hex on a best-available-victim term and then re-picks the victim on that hex (`own_need_hit` is carried on the winning pair into `steal_value`, not into the maximized scalar: adding it there changes hex and victim choice and would break the byte-identical corpus this same task requires, and SIM-GAP-33's A/B in Task 10 needs the pre-SP1b field intact. The victim-scoped path the wiring half of `SIM-GAP-38` needs is the pair enumeration, which Task 11's `victimNeedWeight` rides through `victim_rank`.)
- [x] Keep the ordering on today's terms identical: the existing hex loop already maximizes a term carrying the best available victim's rank and the victim loop picks that same victim, so this is a no-op on current parameters. Prove it, do not assume it
- [x] Preserve the existing fallback when no candidate hex is scoreable, including `placement_score` going to 0
- [x] Keep `RobberChoice`'s public shape, since `heuristic_v1.rs::knight_action_score` consumes `steal_value` and `placement_score`
- [x] Add a Rust test that the joint argmax and a reference two-stage implementation agree on a set of constructed decision states, so the equivalence is pinned rather than asserted
- [x] Recapture and assert the corpus diff is empty; state that in the commit message
- [x] Do not measure this on its own. An A/B of the restructuring alone is guaranteed to read `equivalent` and answers nothing
- [x] Both cargo profiles green

### Task 8: `SIM-GAP-33`, tighten the contest block-bonus predicate

- [x] Capture `runs/corpus-pre`
- [x] In `denial.rs::contest_term`, add the missing condition to the `contest_block_bonus` predicate: the rival must own no edge incident to the contested vertex. A rival whose road network already touches the vertex can settle there with zero new roads and is not blocked by taking their last legal edge
- [x] Keep `contestCap` and the rest of the positional-competition arithmetic untouched
- [x] Add a Rust test with a rival owning an incident edge, asserting the bonus is now withheld, and a companion case with no incident edge asserting it is still credited
- [x] Regenerate `simulator/fixtures/denial-gate-baseline.json` through `generate_denial_gate_baseline`, and any other committed baseline this moves, through its own committed harness
- [x] Recapture the corpus and record in the commit message which policy and layout corpora moved
- [x] Delete the `SIM-GAP-33` entry from `.claude/specs/simulator/gaps.md` and say so in the commit message. Then update the two sentences that name it as pending: the "How to read the gap inventory" section of `.claude/specs/simulator/programme.md`, and the `SIM-GAP-33` mention in the four-constraints section of `.claude/specs/simulator/placement-programme.md`
- [x] Both cargo profiles green, link check passes

### Task 9: Preregister M-49, the `SIM-GAP-33` A/B

- [x] Write `docs/plans/preregs/<today>-m49-simgap33-block-predicate.md`
- [x] One decision arm: the composite policy with the tightened predicate, against reference `base` = the composite at the adopted defaults with the predicate as it was. Build both arms as committed policy params files under `simulator/placement/arms/` if the change is expressible as a parameter; if it is not, state plainly that the arm is the code change itself and that the reference is the pre-change binary, and preregister the two-build protocol the run will use
- [x] Screen power: `standard4`, 4 seats, `--domain tuning`, field `pip_diversity`, 2000 boards x 2 reps, `--player-trading`, `--threshold 0.01`, `--alpha 0.05`
- [x] Decision rule fixed before the run: this is a correctness fix and lands whatever the verdict. `better` or `equivalent` records the fix as costless or positive; `worse` records the loss and flags it for the user without reverting
- [x] Record the prediction and the admissibility conditions
- [x] Link check passes

### Task 10: Run M-49 and record it

- [x] Record `uptime`, run the preregistered command from `simulator/`, record `uptime` again
- [x] Append `## M-49 — SIM-GAP-33 contest block-bonus predicate` with full provenance and the paired table in the existing format (arm, estimate, b, c, selected interval, verdict)
- [x] Record the disposition per the preregistered rule, including a flag for the user if it read `worse`
- [x] Link check passes

### Task 11: SP1b, price denial of the victim's own need

- [x] Capture `runs/corpus-pre`
- [x] Add `victim_need_weight` to `ThreatParams` in `threat.rs`, default 0.15 to match its sibling `victim_hand_weight`, with a `validate` condition that it is non-negative and finite, in the same shape as the existing checks
- [x] Extend `threat.rs::victim_rank` with a term pricing the denial of the victim's own need: the belief-derived probability that a card taken from the victim's believed hand fills the *victim's* cheapest-route shortfall, mirroring how `own_need_hit` prices the observer's. Reuse `need_share` and `cheapest_route_shortfall`; do not build a parallel opponent model
- [x] Confirm the joint argmax from Task 7 carries the new term into hex choice as well as victim choice, which is the wiring half `SIM-GAP-38` names
- [x] Declare `victimNeedWeight` in `simulator/placement/sweep-bounds.json` under `policy.threat` with range 0.0375 to 0.6
- [x] Regenerate `simulator/placement/policy-default-params.json` and `simulator/placement/phase-i-candidate-params.json` so both carry the new key at its default. Do not change any other value in either file
- [x] Add the new key to every `h2_*`, `h2x_*` and `h4_*` file under `simulator/placement/arms/` at the value their frozen baseline carries, so each stays a single-parameter perturbation and the committed pin tests still pass
- [x] Add a Rust test that a victim holding exactly what they need ranks above an otherwise identical victim who does not, and that the term vanishes at weight 0
- [x] Regenerate `simulator/fixtures/robber-gate-baseline.json` and any other baseline this moves, through the committed harnesses (re-ran `generate_robber_gate_baseline`: byte-identical, since that baseline pins `PolicyKind::HeuristicV1`, which carries no threat params. No committed baseline moved)
- [x] Recapture the corpus and record which corpora moved
- [x] Delete the `SIM-GAP-38` entry from `gaps.md` and say so in the commit message
- [x] Both cargo profiles green, link check passes

### Task 12: SP1c, a completion step in the need model

- [x] Capture `runs/corpus-pre`
- [x] Add `need_completion_weight` to `ThreatParams`, default 0.35 to match `need_weight`, validated non-negative and finite
- [x] Extend `threat.rs::need_share` so a shortfall a single card completes scores above the smooth proportional share it gets today: keep the proportional spread as the base and add a completion step scaled by the new weight for resources where the remaining shortfall is at most one card. Do not replace the smooth term; a distant goal must still be priced
- [x] Keep the function total-normalized where callers depend on it, and state in a comment what the normalization now means
- [x] Declare `needCompletionWeight` in `sweep-bounds.json` under `policy.threat` with range 0.0875 to 1.4
- [x] Regenerate `policy-default-params.json` and `phase-i-candidate-params.json`, and add the key to every `h2_*`, `h2x_*` and `h4_*` arm at its baseline value, as in Task 11
- [x] Add a Rust test that a one-card-from-done shortfall now outscores an equal proportional share that is three cards from done, and that the term vanishes at weight 0
- [x] Regenerate every committed baseline this moves, through the committed harnesses
- [x] Recapture the corpus and record which corpora moved
- [x] Delete the `SIM-GAP-40` entry from `gaps.md` and say so in the commit message
- [x] Both cargo profiles green, link check passes

### Task 13: SP1d, promote the knight own-tile relief constant

- [x] Capture `runs/corpus-pre`
- [x] Add `knight_relief_weight` to `ThreatParams`, default 12.0, which is exactly the literal it replaces in `heuristic_v1.rs::knight_action_score`, validated non-negative and finite
- [x] Replace the hardcoded `12.0` multiplying the blocked hex's pips with the parameter. The ungated path that takes no `ThreatParams` keeps its current arithmetic unchanged
- [x] Declare `knightReliefWeight` in `sweep-bounds.json` under `policy.threat` with range 3.0 to 48.0
- [x] Regenerate `policy-default-params.json` and `phase-i-candidate-params.json`, and add the key to every `h2_*`, `h2x_*` and `h4_*` arm at its baseline value
- [x] Add a Rust test that the params-file loader rejects a negative value on this axis, so the parameter is genuinely bounds-checked
- [x] Recapture and assert the corpus diff is empty; this task is behaviour-neutral. State that in the commit message (every `results.json` and `games.jsonl` byte-identical across all eight corpora; only `meta.json` elapsed-time fields differ)
- [x] Delete the `SIM-GAP-39` entry from `gaps.md` and say so in the commit message
- [x] Both cargo profiles green, link check passes

### Task 14: Preregister M-50, the SP1e sweep

- [x] Write `docs/plans/preregs/<today>-m50-sp1e-knight-threat-sweep.md`
- [x] Five axes, two arms each: `knightStealWeight`, `knightPlacementWeight`, `knightReliefWeight`, `victimNeedWeight`, `needCompletionWeight`. State plainly that the programme lists three and that the two new axes were added because leaving a brand-new parameter unswept beside three swept ones is worse
- [x] Build ten committed arm files under `simulator/placement/arms/` named `sp1e_<slug>_lo.json` and `sp1e_<slug>_hi.json`, each a single-parameter perturbation of the post-SP1 defaults at its bounds endpoints, and extend the committed pin test in `params_file.rs` to walk them the way the `h2_*` walk does
- [x] Because arms must not exceed the number of paired contrasts a run can carry cleanly, split the sweep across runs if needed and preregister each invocation explicitly. Reference arm is the post-SP1 defaults under a distinct label
- [x] Screen power: 2000 boards x 2 reps, field `pip_diversity`, composite policy, `--player-trading`, `--threshold 0.01`, `--alpha 0.05`
- [x] Decision rule fixed before the run: the standing disposition rule in this plan's Overview. Record only, adopt nothing
- [x] Record the prediction and the admissibility conditions
- [x] Both cargo profiles green (the pin test is new code), link check passes

### Task 15: Run M-50 and record it

- [x] Record `uptime`, run every preregistered invocation from `simulator/`, record `uptime` again
- [x] Append `## M-50 — SP1e knight and threat axis sweep` with full provenance and one paired table per invocation
- [x] Record each axis's verdict and its disposition under the standing rule, and list the surviving axes explicitly as SP6 candidates. Adopt nothing
- [x] If any axis read `inconclusive`, run the single preregistered retry at four times the boards and record it in the same entry; if it is still `inconclusive`, record the axis unresolved and stop
- [x] Link check passes

### Task 16: Preregister M-51, the post-SP1 re-screen

- [x] Write `docs/plans/preregs/<today>-m51-post-sp1-rescreen.md`
- [x] The SP1 field change invalidates the reading that confirmed the adopted Phase-I vector, so this run re-measures that vector against the moved field before SP2 opens. The defaults stay shipped either way; what is at stake is whether the reading still supports them
- [x] Arms: the four adopted Phase-I axes reverted to their pre-adoption values, one arm each, against reference `base` = the post-SP1 defaults. The four axes are named in M-46; read that entry rather than restating it here
- [x] Add a fifth arm re-screening `handValueWeight` at its pre-drop value, since M-43 was taken on a field playing ETW-aware and SP1 is what changed that property. This arm is a weights file, so preregister it as its own invocation with field `app_formula:placement/default-weights.json`
- [x] Confirmation power: 8000 boards x 2 reps for each invocation
- [x] Decision rule fixed before the run: record only. A `worse` reading on any reverted axis confirms the adoption still holds against the moved field; a `better` reading means the adoption no longer holds and is recorded and flagged for the user, with no default changed
- [x] Record the prediction and the admissibility conditions
- [x] Link check passes

### Task 17: Run M-51 and record it

- [x] Record `uptime`, run every preregistered invocation from `simulator/`, record `uptime` again
- [x] Append `## M-51 — post-SP1 re-screen of the adopted Phase-I vector` with full provenance and one paired table per invocation
- [x] Record whether each adopted axis and `handValueWeight` still reads the way M-43 through M-46 recorded, and flag anything that does not
- [x] Append a dated decision note to `.claude/specs/simulator/placement-programme.md` recording that SP1 is complete, that the field has moved, and that every SP2 reading below is measured against the re-screened field
- [x] Link check passes

### Task 18: SP2a, the dev-card recipe term

- [x] Add `recipeDevCardBonus` to `EngineWeights` in `src/engine/weights.ts` with `DEFAULT_WEIGHTS` value 0, and mirror it in `EngineWeights` in `simulator/crates/engine/src/placement/app_formula.rs`
- [x] Implement the term in `src/engine/valuation.ts::diversityScore` exactly mirroring the three existing recipe terms: `recipeDevCardBonus * Math.min(oreRecipe, wheatRecipe, sheepRecipe)`, using the same `recipeCap`-based coverage the others use. Mirror it in `app_formula.rs`. It contributes to the existing `diversity` breakdown component; no new component
- [x] Declare `recipeDevCardBonus` in `simulator/placement/sweep-bounds.json` under `placement` with `min` 0.0 and `max` 4.0
- [x] Add the key at 0 to `simulator/placement/default-weights.json`, `simulator/placement/phase-i-candidate-weights.json`, and all 49 weights-shaped files under `simulator/placement/arms/`. Script the arm edit; preserve each file's existing key order and formatting
- [x] Add a Rust test walking every weights-shaped file under `simulator/placement/arms/` plus the two committed vectors, loading each through the full `EngineWeights` exact-key contract and `validate`. `contracts.md` says such a test exists and none does; this is the one that makes the 51-file edit verifiable (`params_file.rs::every_committed_weights_file_loads_through_the_full_contract`; shown to fail against an arm with the key removed)
- [x] Add a vitest case pinning the term's contribution at an explicit nonzero witness weight on a hand-computed board, with the expected value derived in the test rather than read off the implementation, and a case pinning the shipped default at 0
- [x] Leave the `SIM-GAP-36` entry in `gaps.md` in place: a term shipped at weight 0 prices nothing, so the gap closes on adoption, not on implementation, and adoption is SP6's business. Record in `placement-programme.md` that the term now exists and awaits its verdict
- [x] Add a new coverage class to `simulator/crates/engine/tests/placement_parity.rs::REQUIRED_CLASSES` for the dev-card recipe, add the matching case to `simulator/tools/generate-placement-parity.ts`, and regenerate `simulator/fixtures/placement-parity.json` with `npx tsx simulator/tools/generate-placement-parity.ts` (class `W11`, case `dev-card-recipe` at a witness weight of 2; regeneration also rolled the fixture forward onto the adopted `handValueWeight` drop, so `extension-granted-hand` now pins 0.4 explicitly to keep the hand-value path covered)
- [x] All six validation commands green

### Task 19: Preregister M-52, the SP2a A/B

- [x] Write `docs/plans/preregs/2026-09-01-m52-sp2a-devcard-recipe.md`
- [x] One decision arm: `simulator/placement/arms/sp2a_devcard.json`, the live default weights with `recipeDevCardBonus` at 1.0, the value matching `recipeSettlementBonus`'s scale for the other three-resource recipe. Reference `base` = `app_formula:placement/default-weights.json` (the arm differs from `default-weights.json` on that key alone; the weights-arm count in `params_file.rs::every_committed_weights_file_loads_through_the_full_contract` moves 49 to 50)
- [x] Screen power: 2000 boards x 2 reps, field `app_formula:placement/default-weights.json`, composite policy, `--player-trading`, `--threshold 0.01`, `--alpha 0.05`
- [x] State why this A/B is informative: the term is the only one in the programme that raises sheep's standing on its own, so a null reads "sheep's existing credit through the spread and the settlement recipe is already enough"
- [x] Decision rule fixed before the run: the standing disposition rule. Record only
- [x] Record the prediction and the admissibility conditions
- [x] Both cargo profiles green (the arm file is walked by the new test), link check passes

### Task 20: Run M-52 and record it

- [x] Record `uptime`, run the preregistered command from `simulator/`, record `uptime` again
- [x] Append `## M-52 — SP2a dev-card recipe bonus` with full provenance and the paired table
- [x] Record the disposition under the standing rule, including the single four-times-boards retry if it read `inconclusive`. If it survives, name it an SP6 candidate; adopt nothing
- [x] Link check passes

### Task 21: SP2b, condition port value on coverage deficit

- [x] Add `portCoverageDeficitWeight` to `EngineWeights` in `src/engine/weights.ts` with `DEFAULT_WEIGHTS` value 0, and mirror it in `app_formula.rs`
- [x] In `src/engine/valuation.ts::portDelta`, multiply each per-resource product by `1 + portCoverageDeficitWeight * deficit_r(state)`, where `deficit_r(state) = 1 - (sum over the four resources other than r of coverage(weights, pips_q(state), recipeCap)) / 4`, using the same `coverage` helper the recipe terms use. Apply the post-move deficit to the post-move half of each difference and the pre-move deficit to the pre-move half, so the term stays a true delta. At weight 0 the expression must be arithmetically identical to today's. Mirror it in `app_formula.rs`
- [x] It contributes to the existing `port` breakdown component; no new component. `portSurplusThreshold` keeps its current job of gating on the ported resource's own production; this term prices the deficit elsewhere, which is what `SIM-GAP-37` says the threshold cannot express
- [x] Declare `portCoverageDeficitWeight` in `sweep-bounds.json` under `placement` with `min` 0.0 and `max` 4.0
- [x] Add the key at 0 to `default-weights.json`, `phase-i-candidate-weights.json`, and all 50 weights-shaped arm files, `sp2a_devcard.json` included
- [x] Add a vitest case at an explicit nonzero witness weight showing a port paying more to a narrow-spread pair than to a broad one at equal ported production, with expected values hand-derived in the test, plus a case pinning the shipped default at 0 as arithmetically identical to the pre-change port delta
- [x] Add a coverage class to `REQUIRED_CLASSES`, the matching case to the parity generator, and regenerate `placement-parity.json`
- [x] Leave the `SIM-GAP-37` entry in `gaps.md` in place. A term that exists at a shipped weight of 0 prices nothing, so the gap is not closed until the term is adopted, which is SP6's business and out of scope here. Record in `placement-programme.md` that the term now exists and awaits its verdict
- [x] All six validation commands green

### Task 22: Preregister M-53, the SP2b A/B

- [x] Write `docs/plans/preregs/2026-09-01-m53-sp2b-port-coverage-deficit.md`
- [x] One decision arm: `simulator/placement/arms/sp2b_portdeficit.json`, the live default weights with `portCoverageDeficitWeight` at 1.0, which at most doubles a port's credit for a pair covering nothing else. Reference `base` = `app_formula:placement/default-weights.json` (the arm differs from `default-weights.json` on that key alone; the weights-arm count in `params_file.rs::every_committed_weights_file_loads_through_the_full_contract` moves 50 to 51)
- [x] Screen power and protocol as in Task 19
- [x] Decision rule fixed before the run: the standing disposition rule. Record only
- [x] Record the prediction and the admissibility conditions
- [x] Both cargo profiles green, link check passes

### Task 23: Run M-53 and record it

- [x] Record `uptime`, run the preregistered command from `simulator/`, record `uptime` again
- [x] Append `## M-53 — SP2b coverage-conditioned port value` with full provenance and the paired table
- [x] Record the disposition under the standing rule, including the single retry if it read `inconclusive` (the screen read `inconclusive`, the single preregistered retry at 8000 boards read `inconclusive` again, so the item is recorded unresolved and stops)
- [x] Link check passes

### Task 24: SP2c, the hex-count tempo term, conditional on M-47

- [ ] Read the M-47 entry in `.claude/specs/simulator/measurements.md` and its recorded gate outcome. **If the gate did not pass, do not implement anything.** Instead: append a dated decision note to `placement-programme.md` recording that SP2c is dropped on M-47's reading and that `SIM-GAP-35` stays open unmeasured, tick every remaining box in this task and in Tasks 25 and 26 with the note "skipped: SP0-D1 gate did not pass", run the link check, and commit
- [ ] If the gate passed, add `tempoHexWeight` to `EngineWeights` in `src/engine/weights.ts` with `DEFAULT_WEIGHTS` value 0, and mirror it in `app_formula.rs`
- [ ] Add a `tempo` component to `ScoreBreakdown` in `src/engine/valuation.ts`, include it in `breakdownTotal`, and set it in `marginalBreakdown` and `marginalTotal`. The term is `tempoHexWeight` times the candidate vertex's producing-hex count, independent of pips
- [ ] Follow the new component through every consumer: `src/engine/analyze.ts` (`emptyBreakdown`, `addBreakdown`, and the averaging block near the end), `src/engine/modifiers.ts`, and `src/ui/AnalysisPanel.tsx`, where it needs a row label
- [ ] Mirror the component in `ScoreBreakdown` in `app_formula.rs` and in `FixtureBreakdown` in `simulator/crates/engine/tests/placement_parity.rs`
- [ ] Declare `tempoHexWeight` in `sweep-bounds.json` under `placement` with `min` 0.0 and `max` 1.0
- [ ] Add the key at 0 to `default-weights.json`, `phase-i-candidate-weights.json`, and every weights-shaped arm file, the SP2a and SP2b arms included
- [ ] Add a vitest case at an explicit nonzero witness weight showing a three-hex vertex outscoring a two-hex vertex of equal pips, with expected values hand-derived, plus a case pinning the shipped default at 0
- [ ] Add a coverage class to `REQUIRED_CLASSES`, the matching case to the parity generator, and regenerate `placement-parity.json`
- [ ] Leave the `SIM-GAP-35` entry in `gaps.md` in place, for the reason given in Task 21, and record in `placement-programme.md` that the term now exists and awaits its verdict
- [ ] All six validation commands green

### Task 25: Preregister M-54, the SP2c A/B, conditional on M-47

- [ ] If Task 24 recorded the skip, tick these boxes with the same skip note and stop
- [ ] Write `docs/plans/preregs/<today>-m54-sp2c-hex-tempo.md`
- [ ] One decision arm: `simulator/placement/arms/sp2c_tempo.json`, the live default weights with `tempoHexWeight` at 0.25. Reference `base` = `app_formula:placement/default-weights.json`
- [ ] State explicitly that this is not a re-litigation of M-43: the term is differently specified, it is measured on the post-SP1 field, and SP0-D1 gated it on fresh evidence
- [ ] Screen power and protocol as in Task 19
- [ ] Decision rule fixed before the run: the standing disposition rule. Record only
- [ ] Record the prediction and the admissibility conditions
- [ ] Both cargo profiles green, link check passes

### Task 26: Run M-54 and record it, conditional on M-47

- [ ] If Task 24 recorded the skip, tick these boxes with the same skip note and stop
- [ ] Record `uptime`, run the preregistered command from `simulator/`, record `uptime` again
- [ ] Append `## M-54 — SP2c hex-count tempo term` with full provenance and the paired table
- [ ] Record the disposition under the standing rule, including the single retry if it read `inconclusive`
- [ ] Link check passes

### Task 27: Verify acceptance criteria

- [ ] `npm run typecheck` clean
- [ ] `npm run lint` clean (the pre-existing `src/ui/glyphs.tsx` fast-refresh warning is the only permitted warning and must not have grown)
- [ ] `npm test` fully green
- [ ] `python3 tools/link-check.py . .claude/specs/simulator simulator/README.md docs/plans/preregs` reports zero bad references
- [ ] `RUSTFLAGS="-D warnings" cargo test --manifest-path simulator/Cargo.toml --workspace` fully green
- [ ] `RUSTFLAGS="-D warnings" cargo test --manifest-path simulator/Cargo.toml --release --workspace` fully green
- [ ] `git status` is clean apart from gitignored run artifacts
- [ ] `.claude/specs/simulator/gaps.md` no longer contains `SIM-GAP-33`, `SIM-GAP-38`, `SIM-GAP-39` or `SIM-GAP-40`, and still contains `SIM-GAP-35`, `SIM-GAP-36` and `SIM-GAP-37`, since a term shipped at weight 0 closes nothing
- [ ] `.claude/specs/simulator/measurements.md` contains M-47 through M-53, plus M-54 unless SP2c was skipped, each with a date, a commit, a domain, an exact command, load before and after, a games count, an illegal-action count, and an admissibility statement
- [ ] Every M entry's `--domain` is `tuning`. Grep the file's new entries and the new preregs for `--domain eval` and `--domain gate` and confirm neither appears
- [ ] `simulator/placement/default-weights.json` still matches `DEFAULT_WEIGHTS` (the vitest mirror test proves it), and every value in it that existed before this run is unchanged. The only additions are the new weights at 0
- [ ] `simulator/placement/policy-default-params.json` differs from its pre-run state only by the new threat keys at their stated defaults
- [ ] Every weights-shaped file under `simulator/placement/arms/` loads through the new exact-key walk test
- [ ] `.claude/specs/simulator/placement-programme.md` carries dated decision notes for the SP2c gate outcome, the SP3 branch outcome, and SP1 completion, each appended rather than editing an existing paragraph
- [ ] Write a run summary at the end of `.ralphex/progress/progress-simulator-placement-sp0-sp2.txt` listing every M entry produced, its verdict, and the surviving terms carried to SP6

## Post-Completion

These need a human and cannot be automated.

- **Re-verify the regenerated `simulator/fixtures/placement-parity.json` by hand.** `contracts.md` requires it whenever scorer logic changes, and the loop can only prove the two scorers agree with each other, not that the new expected numbers are right. Review the diff from Tasks 18, 21 and 24.
- **Read the flagged readings.** Any `worse` verdict on a gap fix, and any adopted Phase-I axis whose M-51 re-screen no longer supports it, is recorded and flagged but deliberately not acted on.
- **Decide the seed domains before SP6.** The programme recommends minting new domain constants and extending the disjointness assertion; nothing in this run depends on it.
- **Decide what SP3 becomes** on M-48's recorded branch: one gradient expansion term, or that term plus a separate boxing penalty.
