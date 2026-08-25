# Simulator remaining programme

## Overview

Close the remaining simulator programme in one run: every open `SIM-GAP` entry except SIM-GAP-20 and SIM-GAP-21, the knight-timing rejoin, Phase J build-target scoring, and Phase H weight re-tuning through eval confirmation. When done: `gaps.md` holds only SIM-GAP-20 (placement-programme territory) and SIM-GAP-21 (kept as diagnosis record), `programme.md` shows H complete with a named Phase-I candidate, and the spec tree is consolidated and link-clean.

Standing rules, every iteration:

- **Never use `--domain gate`.** Screens on `tuning`; `eval` only where a task explicitly says so. Never adopt anything into `src/engine/weights.ts`, `simulator/placement/default-weights.json`, or the Rust param defaults; Phase I is the user's.
- Every engine change runs `cargo test --workspace` in **both profiles** from `simulator/`.
- Behavior changes diff against the byte-exact corpus captured in Task 1 (recapture after each corpus-moving task). A moved corpus is expected for tasks marked corpus-moving; document the movement (games moved / total) in the commit.
- `measurements.md` is append-only. Each scaled run gets a preregistration file in `docs/plans/preregs/` committed **before** the run, and an M entry with date, commit, domain, exact command, `uptime` load before and after, and admissibility. Check load before believing any timing; Docker idles at ~32% CPU on this machine.
- Every new policy seam ships a forwarded-argument table in its test module naming the test that observes each argument; assert concrete scores or choices against closed forms with non-default params, never shape checks.
- Spec discipline: closing a gap deletes its entry and says so in the commit; decisions go to `programme.md`, guarantees to `contracts.md`. The user has licensed consolidating/rewriting the spec tree for clarity; the fixed 6-file tracked set (`tools/spec-tracked-check.sh`) stays fixed.
- zsh: never a bare `==`/`===` in a compound command; quote glob-bearing flags. Never run two test suites in one parallel block; a red result under load is not evidence.
- Never hand-edit `simulator/topology/standard4.json`, `simulator/topology/extension6.json`, or `simulator/fixtures/placement-parity.json` (regenerate via `simulator/tools/` scripts only). Review-fix commits must not touch `measurements.md` (beyond appends), topology files, or corpus artifacts.
- Out of scope: SIM-GAP-20 (draft-aware placement; belongs to the placement tuning programme), new structural placement-formula terms (each would require TS+Rust+parity-fixture+every-arm-file changes; record as follow-up if a finding motivates one), Phase I gate adoption, and the app UI/parser (unrelated in-flight work exists on main; do not touch `src/parser/` or `src/ui/`).

## Context

Everything below fills a gap the spec leaves open; the spec tree (`.claude/specs/simulator/`) is authoritative for everything it covers. Read `programme.md`, `contracts.md`, and `gaps.md` before the first task.

**Measurement protocol.** Standard A/B: `evaluate`, standard4, 4 seats, `--domain tuning`, field `pip_diversity` placement, `--policy heuristic-v1-trader` (or composite where stated), reference = pre-change composite `heuristic-v1-trader-aware-threat-devcards-denial`, `--player-trading`, `--threads 0`, 400 boards x 10 reps (~30-60s at ~10k games/s). H screens use 2000 boards x 2 reps. Threshold +-1pp, alpha as in prior M entries. Sweep with **all G gates on and trading on** (M-21: the value lives at that corner). Prefer boards over reps for precision. Never `tournament` with more arms than seats; prefer `evaluate` throughout. Single invocations stay under ~5 minutes so the 10m idle-timeout cannot kill a session mid-run.

**Gap-fix A/Bs** are for the record and regression safety: keep the fix unless the composite arm comes back `worse`; a `worse` verdict means stop, record the reading, and mark the task blocked with the evidence rather than shipping.

**Corpus baseline:** Task 1 captures `results.json` + `--jsonl` for several policies (at minimum `heuristic-v1`, `heuristic-v1-trader`, the full composite, `priority-trader`) on both layouts into `simulator/runs/corpus-pre/` (gitignored; lives on disk for the run). Gate baselines consumed by the `threat_gate`/`denial_gate`/`devcards_gate`/`trading_gate` tests live under `simulator/`; regenerate only where a task says so.

**Phase J design (decided in interview; record as D-class decisions when built):**

- *Goal-need term:* `vertex_score` keeps its board-scarcity term and gains a second term weighting resources by the current goal's outstanding cost minus hand and expected production; the new weight is a swept parameter and **zero restores today's behavior**, so the A/B isolates it. One goal-need computation shared by all consumers (same one-model rule the programme applies to opponent threat).
- *Stage signal:* primary = remaining settlement/city pieces and legal settlement sites (available to all policies); additionally an ETW-derived urgency input under gated (`Option`-bearing) policies only, since setup and plain paths lack belief. Both zero-default gated.
- *Piece economy (SIM-GAP-29):* both halves. Settlement-slot return priced into city value, scaling with proximity to the five-settlement cap and remaining legal sites; cost pressure pricing a build's cost against goal need, reusing the goal-need machinery.
- *Hysteresis (SIM-GAP-25):* previous goal carried in per-game state (on `GameState`, reset in `GameArena::prepare`, per the extension-seams contract); a new goal must beat the incumbent by a swept margin; margin zero restores today's behavior.
- *Frontier (SIM-GAP-28):* replace the degree-valued expansion count with frontier actually opened (vertices newly reachable/settleable), gated the same way.
- Each J term lands as its own commit with its own paired A/B against the fixed full-composite reference (the programme's increment rule), then one composite J A/B.

**Phase H method (decided): single-parameter screens, then one coordinate pass, then eval confirmation, record-only.**

- *Mechanism first (H0):* the CLI cannot load policy params from a file. Add a params-file spec for policies (e.g. `--arm-policy label=<policy>@<params.json>`), loading a **full** `HeuristicParams` (every field present, unknown or missing keys are load errors — mirror the weights-file contract so single-parameter arms stay single-parameter). Apply `assert_params`-style domain guards at load. Add `simulator/placement/policy-default-params.json` mirroring `HeuristicParams::default()` with a test pinning drift (mirror of the default-weights vitest). Add a headroom checker discharging SIM-GAP-30: an assertion that a given params vector keeps every building below the non-winning contested band; every swept vector passes it before running, and candidate ranges are declared in a committed bounds file (`genericPortFactor >= 0` hard bound included on the placement side).
- *Screens:* per parameter, 2-4 perturbation arms vs default, tuning domain, composite field. Placement weights via `app_formula:` arm files in `simulator/placement/arms/`; policy blocks (`HeuristicParams` core, `ThreatParams`, `DevCardParams`, `TradeParams`, `DenialParams`, `TradeConfig`, and the new J/knight parameters) via H0 params files. Keep a move only on verdict `better`.
- *`handValue` question:* arm with `handValueWeight: 0` vs default against the ETW-aware composite field at >=8000 boards; preregistered rule: recommend dropping the term only on `equivalent` with the selected interval strictly inside +-1pp at that power; anything else keeps it. Record the answer in `programme.md` either way.
- *Combine:* apply all `better` winners together, re-screen each winner once at the combined point (one coordinate pass), then confirm the final vector on **eval** — the single authorized eval spend. The `resourceValue` spread axis is already eval-spent; do not re-ask that axis on eval. Write the candidate as committed arm/params files named `phase-i-candidate*`, append M entries, and update `programme.md`: H done, Phase I awaiting the user.
- *Throughput disposition (owed by H):* register the per-decision fixed-state metric (M-22's form) as the efficiency measure; no all-seat games-per-second floor. Record as a D-class decision closing the open question in `programme.md`.

**Ordering deviation to record:** J runs before H (the programme lists H then J) because H tunes whatever scorer exists and the programme's own reordering principle is tuning-last. Record in `programme.md` as a superseding decision.

**Known pre-existing failure:** `python3 tools/link-check.py . .claude/specs/simulator simulator/README.md` reports M-22's citation of the deleted, gitignored `.claude/solve-artifacts/preregistration.md`. Mechanical link repair of an M entry (the pointer only, never a reading) is authorized; if the original preregistration text is unrecoverable, replace the link with plain prose naming what it was.

## Validation Commands

All verified on this machine 2026-08-25 (release timings are warm-cache):

- `cd simulator && cargo test --workspace` (~3m30s)
- `cd simulator && cargo test --workspace --release` (~20s warm)
- `cd simulator && cargo test --release -p unsettled-sim --test alloc`
- `cd simulator && RUSTFLAGS="-D warnings" cargo build --release`
- `npm test` (~15s)
- `npm run typecheck`
- `npm run lint`
- `python3 tools/link-check.py . .claude/specs/simulator simulator/README.md` (clean after Task 1)
- `bash tools/spec-tracked-check.sh .`

### Task 1: Preflight, corpus baseline, spec link repair

- [x] Run both cargo profiles and the alloc test green at the branch point; record commit and `uptime` — all green at `6b481d71`, load 2.23 before / 3.07 after (2026-08-25 11:22)
- [x] Capture the byte-exact corpus (`results.json` + `--jsonl`, >=4 policies including the full composite, both layouts) into `simulator/runs/corpus-pre/` — via the new committed `simulator/tools/capture-corpus.sh` (4 policies x 2 layouts, seed 42, 25 boards x 4 reps, 4000 games, zero illegal actions); byte-exactness proven by a second capture diffing identical on everything but `meta.json` timing
- [x] Create `docs/plans/preregs/` with a README line saying what lives there
- [x] Repair the dangling M-22 preregistration link per Context; `link-check.py` exits clean — pointer replaced with prose naming the deleted file; 0 bad references

### Task 2: SIM-GAP-26 — discard fallback drops policy gates

- [x] Make `heuristic_v1.rs::discard`'s fallback use the caller's actual `HeuristicParams` instead of `HeuristicParams::default()` — fallback now rebuilds the denial context from the caller's params and passes both to `best_goal`; dispatcher forwards `heuristic_params(kind)`
- [x] Forwarded-argument test observing that gated params reach the fallback path — `the_gated_params_reach_the_discard_fallback` in `denial.rs`, closed-form discard vectors (ungated road goal vs gated settlement goal), plus a forwarded-argument table naming the observer of each `discard` argument
- [x] Corpus diff: document movement; delete the gap entry — 0 / 4000 games moved (fallback needs an 8+ hand before the game's first action sets a goal, which the corpus never produces); entry deleted

### Task 3: SIM-GAP-31 — replay-derived fixture audit

- [ ] Sweep `simulator/crates/*/tests` for fixtures that replay turns under a default policy; add explicit precondition assertions before each subject assertion, or convert to explicit state setup
- [ ] Delete or trim the gap entry to what remains, per the staleness contract

### Task 4: SIM-GAP-10/11/12 — card-play scope

- [ ] Year of Plenty offered beyond the exactly-two-short case (one-short-plus-spare, tempo/banking per the gap text); resource pick by value, not index order; `monopoly_for_goal` considers all cost variants of the goal
- [ ] Forwarded-argument tables; closed-form assertions with non-default params
- [ ] Preregistered A/B vs composite reference; corpus recapture; delete the three entries

### Task 5: SIM-GAP-17 — deck-composition-aware dev buying

- [ ] Derive remaining deck composition in the shape `belief.rs` uses (contracts state it is derivable; VP cards bounded, not known); scale the buy score by the probability the deck still holds something wanted
- [ ] Both directions tested: VP-rich small deck near win boosts, exhausted-value deck suppresses
- [ ] A/B; corpus recapture; delete the entry

### Task 6: Shared hand-size exposure term — SIM-GAP-14/15/16/18

- [ ] One exposure model (what a seven costs this hand) built once, consumed by: discard choice, pre-emptive shedding bank/port trades, pre-roll dev-card timing
- [ ] Discard cost = conversion rate (port-aware, discrete marginal per the design note; goal need dominates on disagreement)
- [ ] Shedding trade at 8+ cards prices certainty-of-one against expected sevens loss
- [ ] Forwarded-argument tables; A/B; corpus recapture; delete or trim the four entries

### Task 7: SIM-GAP-07/08 — race-check cap and approach blocking

- [ ] Rank exact `road_takes_longest_road` checks by danger across all rivals or raise `MAX_RACE_CHECKS` with measured per-decision cost (M-22 fixed-state form), closing the six-seat blind spot
- [ ] Price blocking: does the candidate edge cut the rival's actual approach to the contested vertex (bounded, reusing the one-road-reach memo)
- [ ] A/B; corpus recapture; delete or trim the entries

### Task 8: SIM-GAP-27 — embargo threshold onto the shared danger model

- [ ] Replace `trade.rs::embargoed`'s VP-estimate threshold with the shared ETW danger model; this changes every trader arm, so it is corpus-moving by design
- [ ] A/B on the composite; corpus recapture; delete the entry

### Task 9: SIM-GAP-22 — empty-hand robber victim

- [ ] Allow naming an adjacent empty-handed opponent; move `view.rs::stealable_on_hex` in lockstep (contracts: otherwise legal decisions count as illegal)
- [ ] Corpus regeneration (expected: ~20/48 games move per the gap text); zero illegal actions; M entry with provenance; delete the entry

### Task 10: SIM-GAP-23 — setup longest-road recompute

- [ ] `setup()` calls `recompute_all_roads` on the generated-placement path; nothing else bundled into this task
- [ ] Corpus recapture; delete the entry (the rationale for `build_road`'s all-seat recompute moves to a comment or contract if still needed)

### Task 11: SIM-GAP-32 — road-building pair gating, owns the M-22 re-run

- [ ] Apply the verified reproduction: gate `best_road_building_pair`'s expansion credit on `is_expansion_target`, fold both edges' endpoints through `Option` with `unwrap_or(0.0)`
- [ ] Repair the seven replay-derived `player_trading.rs` fixtures (Task 3's precondition assertions should localize the breaks)
- [ ] Re-run the M-22 attribution schedule; regenerate gate baselines; append the M entry; corpus recapture; delete the entry

### Task 12: SIM-GAP-19 — SpecialBuild measurement

- [ ] Preregister and run an extension6 5-6 seat A/B asking whether distinct SpecialBuild scoring changes outcomes; implement distinct scoring only if the measurement shows a gap, else record the reading and delete the entry with the evidence

### Task 13: Knight timing — SIM-GAP-05/06/09

- [ ] Unfreeze the knight path: steal term uses belief-derived victim value and the shared threat/danger model; contested-card and progress terms take real denial pressure instead of literal `1.0`; knight play timing rejoins robber placement value
- [ ] Preserve the ungated self-regarding path byte-stable; forwarded-argument tables
- [ ] A/B; corpus recapture; append M entry; delete the three entries; update the programme's "named but unscheduled" line

### Task 14: J1 — goal-need machinery and scarcity term

- [ ] Build the single goal-need computation (outstanding goal cost minus hand and expected production); add the second `vertex_score` term per Context, zero-default
- [ ] Paired A/B (new term at swept trial values vs zero) against the full composite; forwarded-argument table

### Task 15: J2 — stage signal

- [ ] Piece-supply/legal-site stage input to expansion and city terms, zero-default; ETW urgency input under gated policies only
- [ ] A/B as in J1

### Task 16: J3 — piece economy (SIM-GAP-29)

- [ ] Settlement-slot return term on city value; cost-pressure term reusing goal-need; both zero-default
- [ ] A/B; delete SIM-GAP-29 when both halves land

### Task 17: J4 — goal hysteresis (SIM-GAP-25)

- [ ] Incumbent goal on `GameState` (reset in `GameArena::prepare`); switch only on a swept margin, zero-default
- [ ] A/B; delete SIM-GAP-25

### Task 18: J5 — frontier replacement (SIM-GAP-28) and dev-band exposure (SIM-GAP-24)

- [ ] Replace the degree-valued expansion count with frontier actually opened, gated; expose `dev_card_score`'s scale as a swept parameter so H can answer SIM-GAP-24
- [ ] A/B; delete SIM-GAP-28; re-scope SIM-GAP-24 to its H sweep or delete it if the sweep answers it

### Task 19: J composite — measure, record, consolidate

- [ ] Composite J A/B (all J terms at trial values vs all-zero) on tuning; corpus recapture; M entry
- [ ] Record the J design decisions in `programme.md` (D-class) and new guarantees in `contracts.md`; J marked built

### Task 20: H0 — params files, bounds, headroom (SIM-GAP-30)

- [ ] Policy params-file mechanism per Context (full-params files, load errors on missing or unknown keys, domain guards at load); default-params file with drift-pin test; roster round-trip test untouched
- [ ] Headroom assertion helper; committed bounds file for every swept parameter (`genericPortFactor >= 0` bound included); every screen invocation asserts headroom first
- [ ] Delete SIM-GAP-30 once the bound and check ship

### Task 21: H1 — placement-weight screens

- [ ] Preregister; screen each `default-weights.json` parameter (2-4 arms, 2000 boards x 2 reps, tuning, composite field, trading on); skip the eval-spent `resourceValue` spread axis and the settled `genericPortFactor`
- [ ] M entries; winners list committed into this plan file under this task

### Task 22: H2 — policy-block screens

- [ ] Same protocol over `HeuristicParams` core, `ThreatParams`, `DevCardParams`, `TradeParams`, `DenialParams`, `TradeConfig`, and the J/knight parameters, via H0 params files; remember the threat-term regime dependence (orderings flip below danger ~0.105-0.108)
- [ ] M entries; winners list

### Task 23: H3 — `handValue` A/B

- [ ] Preregister the decision rule from Context; run at >=8000 boards; record the answer in `programme.md`

### Task 24: H4 — combine, coordinate pass, eval confirmation, candidate

- [ ] Combined vector from all `better` winners; one coordinate re-screen of each winner at the combined point; headroom re-check
- [ ] Confirm the final vector on **eval** (the single authorized eval spend); `better` or positive `equivalent` means record as `phase-i-candidate` arm/params files; anything else means record the honest outcome and the best defensible candidate
- [ ] Throughput-floor disposition recorded (per-decision metric, no all-seat floor); M entries; `programme.md`: H done, Phase I awaiting the user

### Task 25: Spec consolidation sweep

- [ ] `gaps.md` holds only SIM-GAP-20 and the SIM-GAP-21 diagnosis; every closed entry deleted with its closing commit named; `programme.md` statuses current including the J-before-H deviation; `contracts.md` carries new guarantees; `simulator/README.md` operational sections updated (params-file syntax, new flags)
- [ ] `link-check.py` and `spec-tracked-check.sh` clean; no hard-wrapped prose introduced

### Task 26: Verify acceptance criteria

- [ ] Both cargo profiles and the alloc test green from `simulator/`; `RUSTFLAGS="-D warnings" cargo build --release` clean
- [ ] `npm test`, `npm run typecheck`, `npm run lint` green (no app changes expected)
- [ ] `grep -n 'SIM-GAP-' .claude/specs/simulator/gaps.md` lists only SIM-GAP-20 and SIM-GAP-21
- [ ] Every scaled run has a prereg file in `docs/plans/preregs/` and an M entry with load fields; no command in the run's history used `--domain gate`
- [ ] `phase-i-candidate` files exist and load; `simulator/placement/default-weights.json`, the Rust param defaults, and `src/engine/weights.ts` byte-identical to the branch point

## Post-Completion

- Phase I: the user runs the adoption decision on `--domain gate` with the recorded candidate, then adopts into `weights.ts`/defaults/parity fixture or rejects.
- User review of the J and knight design decisions before merging the branch to main.
