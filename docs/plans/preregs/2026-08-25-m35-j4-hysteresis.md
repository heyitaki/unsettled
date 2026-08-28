# M-35 preregistration — J4 goal hysteresis at trial margins

Date: 2026-08-25. Committed before the run.

**Change under test.** Phase J4 (SIM-GAP-25) gives goal selection plan persistence, zero-default. The engine records the goal a seat's policy commits to at each pre-roll and action decision as the seat's incumbent (`PlayerState::incumbent_goal`, reset by the fresh `GameState` in `GameArena::prepare`, read back through `DecisionView::incumbent_goal` — the extension-seams contract's per-game-state home, so the one record reaches every chooser call site including the discard fallback). In `heuristic_v1`'s goal chooser, a challenger goal must beat the incumbent's candidate by `HeuristicParams::goal_hysteresis_margin`, implemented as a selection-only boost on the incumbent in the comparisons: the chosen goal always keeps its true score, and an incumbent with no legal candidate boosts nothing and dies on its own. A margin of zero never reads the incumbent and restores the pre-J4 selection bit-for-bit (checked by the corpus diff); the trial values live behind the composite labels `heuristic-v1-trader-aware-threat-devcards-denial-hystlo` (0.25) and `-hysthi` (1.0). Goal scores are value per turn with affordable goals floored at 0.25 turns, so 0.25 absorbs sub-road-base score wobble and 1.0 spans the typical gap between an affordable goal and a mid-horizon challenger.

**Known surface shape (recorded before the run).** Hysteresis bites only when consecutive decisions would flip the argmax goal by less than the margin. Under the composite at these arms a kept incumbent reaches outcomes indirectly: the discard cost vector, Year of Plenty and Monopoly targeting, the dev-card timing comparison's goal cost, and the special-build HoldGoal prune (not shipped here); the build candidates themselves are goal-independent while the J1/J3 need weights sit at zero. Discordance counts will be read against this narrow-but-real expectation.

**Design.** Standard paired A/B per the plan's measurement protocol: `evaluate`, standard4, 4 seats, `--domain tuning`, field `pip_diversity` placement, field policy `heuristic-v1-trader`, player trading on, 400 boards x 10 reps, threads 0. Reference = the full composite at margin zero; test arms = the composite at each trial margin.

**Command.**

```text
cargo run --release -p unsettled-sim -- evaluate --layout standard4 --seats 4 --domain tuning --field pip_diversity --arm base=pip_diversity --arm hystlo=pip_diversity --arm hysthi=pip_diversity --arm-policy base=heuristic-v1-trader-aware-threat-devcards-denial --arm-policy hystlo=heuristic-v1-trader-aware-threat-devcards-denial-hystlo --arm-policy hysthi=heuristic-v1-trader-aware-threat-devcards-denial-hysthi --reference base --boards 400 --reps 10 --policy heuristic-v1-trader --threads 0 --player-trading --out runs/m35-hyst
```

**Decision rule (fixed before the run).** This is a screen of a zero-default seam, not a gap fix: the margin ships at zero whatever the verdicts, so no arm can change shipped behavior. A `better` verdict at a trial margin marks it as prior evidence for the H2 policy-block sweep, which owns the parameter; `equivalent`, `inconclusive`, or `worse` is recorded as-is and leaves it to H2 with no prior. SIM-GAP-25 is deleted either way — the gap asks for commitment state to exist and be measured, not for a win. No adoption in either direction (Phase I is the user's).

**Threshold and alpha.** +-1pp practical threshold, interval selection as in prior M entries (McNemar vs clustered, whichever the harness selects).

**Admissibility.** `uptime` load recorded before and after; zero illegal actions required; single invocation (48,000 games across three paired arms) expected well under 5 minutes.
