# M-51 preregistration — post-SP1 re-screen of the adopted Phase-I vector

Date: 2026-09-01. Committed before the run.

**Change under test.** Nothing. This is a re-screen: the five axes the Phase-I decision disposed of are each put back to the value they carried before that decision, one arm at a time, and measured against the post-SP1 defaults. No shipped default moves in any branch of any outcome.

**Why this run exists.** A measurement is a statement about the field it was taken on, and SP1 moved the field: the robber now picks hex and victim by one joint argmax, the victim's own need is priced, the need model has a completion step, and `SIM-GAP-33`'s block-bonus predicate is tighter. `.claude/specs/simulator/placement-programme.md` records the consequence rather than escaping it — **SP1 invalidates the M-46 vector as a confirmed result**. The defaults stay shipped either way; this run does not propose reverting them and cannot. What is at stake is only whether the reading still supports them, and the reason to take it now is that every SP2-through-SP6 measurement is taken on this field, so the field's own provenance has to be on the record before SP2 opens.

**The five axes.** Four are the policy axes M-46 adopted; the fifth is the placement weight the same decision dropped. The pre-adoption values are exactly the ones `params_file.rs::screen_baseline_value` restores, which is what the committed H-screen arm pins already anchor to.

| Arm | Parameter | Live default (post-SP1) | Reverted to | Source of the revert value |
| --- | --- | ---: | ---: | --- |
| revert_devbuy | `devBuyScale` | 0.25 | 1.0 | M-46 adoption |
| revert_tretw | `trading.etwWeight` | 4.0 | 1.0 | M-46 adoption |
| revert_trfloor | `trading.dangerFloor` | 4.0 | 1.0 | M-46 adoption |
| revert_trdangerw | `trading.dangerWeight` | 2.0 | 0.5 | M-46 adoption |
| hand | `handValueWeight` | 0 | 0.4 | M-43 drop, ridden by M-46 |

Each revert value sits inside its axis's committed `sweep-bounds.json` range, which the new pin test asserts, so no arm here is a vector a later phase would be forbidden to adopt.

**Arm files.** The four policy arms are committed as `simulator/placement/arms/sp1r_<slug>.json`: the post-SP1 composite defaults with exactly one leaf put back, everything else byte-identical. `params_file.rs::the_sp1r_arm_files_are_the_committed_pre_adoption_reverts` pins that in both directions and rejects a stray fifth `sp1r_` file that a run could pick up unpreregistered. The weights arm needs no new file: `simulator/placement/phase-i-candidate-weights.json` is already the live default weights with `handValueWeight` at its pre-drop 0.4, and `the_phase_i_candidate_files_record_the_adopted_vectors` already pins it as exactly that. Adding a duplicate would be a second copy of a pinned fact.

**Two invocations, because the two sides need different fields.** The four policy arms are policy-parameter contrasts, so they take the programme's policy field, `pip_diversity`, and differ from it in one `--arm-policy` leaf each. `handValueWeight` is a formula weight, so its arm has to be scored against the live formula and its invocation takes field `app_formula:placement/default-weights.json`, with `base` the same spec. That is the plan's declared split and it is also what makes this reading commensurable with M-52 and M-53, which are formula-weight A/Bs on the same field.

**What the changed field costs the `handValueWeight` reading, stated plainly.** M-43 measured the drop on a `pip_diversity` field. This run measures the restoration on an app-formula field. Two things therefore differ from M-43 at once: the field's policy (Phase-I adoption plus SP1) and the field's placement. A difference between the two readings consequently **cannot** be attributed to SP1 alone, and the M entry must not claim it can. What this invocation does answer is the question that has an action attached: does restoring the term beat the field that SP2 through SP6 will be measured against. The sign convention also flips relative to M-43, which measured zeroing and read `-0.13pp`; here a positive estimate means restoring the term helps.

**Design.** Both invocations: `evaluate`, `standard4`, 4 seats, `--domain tuning`, every seat on `heuristic-v1-trader-aware-threat-devcards-denial` with `--player-trading`, `--threads 0`, `--boards 8000 --reps 2`, `--threshold 0.01`, `--alpha 0.05`. That is confirmation power, 64,000 paired units over 8000 clusters per arm, the same power M-45 and M-46 took the vector's confirmation at. Boards carry the clustered precision, so the units are bought there and `--reps` stays at 2. Invocation one is 5 arms and 320,000 games; invocation two is 2 arms and 128,000 games.

**Reference arms.** `base` in each invocation is the shipped configuration itself: the post-SP1 composite defaults named explicitly through `--arm-policy` in invocation one, and `app_formula:placement/default-weights.json` in invocation two. Both should sit near the symmetric 0.25 corner, and a `base` far from it means the field and the reference have drifted apart and voids the run.

**Estimand and its sign.** Each arm reports `est = p(arm) - p(base)`, the win-rate effect of *undoing* one disposal. A negative estimate says the disposal earned its keep on this field; a positive one says the field has moved under it.

**Commands** (from `simulator/`, `uptime` recorded immediately before and immediately after each, run one at a time against a binary built beforehand):

```text
RUSTFLAGS="-D warnings" cargo build --release -p unsettled-sim
```

```text
target/release/unsettled-sim evaluate --layout standard4 --seats 4 --domain tuning --field pip_diversity --arm base=pip_diversity --arm revert_devbuy=pip_diversity --arm revert_tretw=pip_diversity --arm revert_trfloor=pip_diversity --arm revert_trdangerw=pip_diversity --arm-policy base=heuristic-v1-trader-aware-threat-devcards-denial --arm-policy revert_devbuy=heuristic-v1-trader-aware-threat-devcards-denial@placement/arms/sp1r_devbuy.json --arm-policy revert_tretw=heuristic-v1-trader-aware-threat-devcards-denial@placement/arms/sp1r_tretw.json --arm-policy revert_trfloor=heuristic-v1-trader-aware-threat-devcards-denial@placement/arms/sp1r_trfloor.json --arm-policy revert_trdangerw=heuristic-v1-trader-aware-threat-devcards-denial@placement/arms/sp1r_trdangerw.json --reference base --boards 8000 --reps 2 --policy heuristic-v1-trader-aware-threat-devcards-denial --threads 0 --player-trading --threshold 0.01 --alpha 0.05 --out runs/m51-policy
```

```text
target/release/unsettled-sim evaluate --layout standard4 --seats 4 --domain tuning --field app_formula:placement/default-weights.json --arm base=app_formula:placement/default-weights.json --arm hand=app_formula:placement/phase-i-candidate-weights.json --reference base --boards 8000 --reps 2 --policy heuristic-v1-trader-aware-threat-devcards-denial --threads 0 --player-trading --threshold 0.01 --alpha 0.05 --out runs/m51-hand
```

The build carries `RUSTFLAGS="-D warnings"` exactly as every other cargo invocation in this plan does, so it hits the same fingerprint as the test runs and no compile lands inside a timed window. M-50 paid that lesson: an invocation through `cargo run` without the flag re-fingerprinted and put a 12s compile inside the recorded `uptime` pair.

**Decision rule (fixed before the run).** Record only, in every branch, on every arm. No default in `src/engine/weights.ts`, `simulator/placement/default-weights.json`, `simulator/placement/policy-default-params.json`, `simulator/placement/phase-i-candidate-*.json`, `HeuristicParams::default()` or any file under `simulator/placement/arms/` moves as a result of this run, whatever it reads.

- `worse` on a reverted arm: undoing the disposal costs win rate, so **the adoption still holds against the moved field**. This is the confirming outcome and the one the M entry records as support intact.
- `better` on a reverted arm: the pre-adoption value now beats the adopted one, so **the adoption no longer holds** on this field. Recorded, quantified, and flagged for the user as a decision they own. Nothing is reverted here.
- `equivalent` at this declared power: the adopted value no longer measurably beats the value it replaced. That is weaker support than M-44 through M-46 recorded, and the M entry says so rather than reporting a null as a pass.
- `inconclusive`: recorded unresolved at confirmation power, with **no retry**. The plan's four-times-boards clause serves an optional term whose disposition depends on the reading; here no branch changes an action, this run is already at confirmation power, and 8000 boards is the largest power the programme has ever bought. More units would buy a sharper number and no different decision.

**Multiplicity, stated rather than corrected.** Five contrasts across two invocations at alpha 0.05. Against a true null everywhere, roughly one nominal exceedance is expected by chance, and the M entry records the count of directional readings next to that expectation so a lone flag is read as what it is. No correction is applied, for the same reason the screens applied none: what this produces is a status report on five axes, each of which the user can re-open individually.

**Prediction (recorded before the run).** The Phase-I package as a whole was worth +14.76pp on tuning, +13.98pp on eval and +14.10pp on gate, so at least one of the four single reverts should be large and negative unless SP1 dismantled the mechanism. My ordering: `revert_tretw` largest, since M-44 read `no_tretw` the most decisively removal-negative of the nine at the combined point and `trading.etwWeight` 4.0 is the axis the whole trade machinery leans on; then `revert_devbuy`, because M-46 had to regenerate all three corpus gate baselines when `devBuyScale` moved, which is direct evidence that the axis changes played decisions often. `revert_trfloor` and `revert_trdangerw` are the two trade-danger axes, both `inconclusive` in the low tenths of a point at the combined point, and I predict they read `equivalent` or a small `worse` here; they are the arms most likely to have been carried by their partners rather than by their own value. I expect no `better` on any policy arm. If one appears it will be `revert_trfloor` or `revert_trdangerw`, because SP1 repriced the robber and the danger those two axes react to is downstream of it. For `hand`, M-43 put zeroing at -0.13pp with 1,464 of 64,000 units discordant, so restoring it should read a small positive at most; I predict `equivalent` inside +-0.5pp, and note that a `better` here would be the most interesting single reading in the run, since it would say SP1's robber changes gave the placement-time hand term back a job that ETW-aware play had been doing.

**Threshold and alpha.** +-1pp practical threshold, alpha 0.05. Interval selection is the harness's own rule, the wider of the McNemar and board-clustered intervals.

**Admissibility.** The release binary is built before either measurement starts, so no compile overlaps a timed run. `uptime` immediately before and immediately after each invocation, all four readings in the M entry. Zero illegal actions required in both runs. The two invocations run one at a time, never in the same command block as each other, a build, or a test suite. `base` must sit near 0.25 in both. 448,000 games total at M-50's observed ~7k games/s is roughly a minute of compute, well under the 5-minute ceiling. `simulator/runs/` is gitignored, so both artifacts stay out of the tree and the M entry is the record.

**Numbering.** M-50 is the last entry in `.claude/specs/simulator/measurements.md` at this commit, so this run takes M-51. If that file has moved on by the time the run executes, the entry takes the next unused number and this preregistration is cited by filename.
