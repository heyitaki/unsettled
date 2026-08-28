# M-34 preregistration — J3 piece economy at trial values

Date: 2026-08-25. Committed before the run.

**Change under test.** Phase J3 (SIM-GAP-29) adds both piece-economy halves, zero-default. The settlement-slot return (`policy::piece_economy::SlotReturn`, derived once per decision) prices what a city upgrade hands back to the piece supply: proximity to the settlement cap (placed pieces over the five-piece supply) times open-site availability (distance-rule-open sites board-wide over the supply, capped at 1), added to city vertex value scaled by `HeuristicParams::slot_return_weight`; being pure state it also reaches the goal chooser, like the J2 stage. The cost-pressure term reuses the shared J1 goal-need model (`goal_need::GoalNeed::cost_term`): each affordable build candidate (settlement, city, road) is charged `cost_pressure_weight` times the overlap between its cost — at the variant the payment path would actually spend, the first affordable one — and the selected goal's outstanding need; an affordable goal has zero need by construction, so a build is never charged for its own goal. Both weights default to zero, which never derives either model and keeps every shipped policy's scores bit-identical (checked by the corpus diff); the trial pairs live behind the composite labels `heuristic-v1-trader-aware-threat-devcards-denial-econlo` (slot 2.0, pressure 0.5) and `-econhi` (slot 8.0, pressure 2.0).

**Known surface shape (recorded before the run).** In base rules the cost-pressure overlap is structurally narrow: a payable road never overlaps a settlement or city goal's need (affording the road zeroes the shared wood/brick shortfalls), and the main live shape is a settlement build spending the wheat an unaffordable city goal still needs. The road-candidate charge is additionally throttled by the goal chooser: an affordable road goal scores at the 0.25-turn floor and outranks an unaffordable build goal at all but extreme production levels. The slot-return term is live whenever a city candidate exists and any settlement has been placed. Discordance counts will be read against this expectation.

**Design.** Standard paired A/B per the plan's measurement protocol: `evaluate`, standard4, 4 seats, `--domain tuning`, field `pip_diversity` placement, field policy `heuristic-v1-trader`, player trading on, 400 boards x 10 reps, threads 0. Reference = the full composite at all-zero piece-economy weights; test arms = the composite at each trial pair.

**Command.**

```text
cargo run --release -p unsettled-sim -- evaluate --layout standard4 --seats 4 --domain tuning --field pip_diversity --arm base=pip_diversity --arm econlo=pip_diversity --arm econhi=pip_diversity --arm-policy base=heuristic-v1-trader-aware-threat-devcards-denial --arm-policy econlo=heuristic-v1-trader-aware-threat-devcards-denial-econlo --arm-policy econhi=heuristic-v1-trader-aware-threat-devcards-denial-econhi --reference base --boards 400 --reps 10 --policy heuristic-v1-trader --threads 0 --player-trading --out runs/m34-econ
```

**Decision rule (fixed before the run).** This is a screen of a zero-default seam, not a gap fix: the weights ship at zero whatever the verdicts, so no arm can change shipped behavior. A `better` verdict at a trial pair marks it as prior evidence for the H2 policy-block sweep, which owns both parameters; `equivalent`, `inconclusive`, or `worse` is recorded as-is and leaves them to H2 with no prior. SIM-GAP-29 is deleted either way — the gap asks for the terms to exist and be measured, not for a win. No adoption in either direction (Phase I is the user's).

**Threshold and alpha.** +-1pp practical threshold, interval selection as in prior M entries (McNemar vs clustered, whichever the harness selects).

**Admissibility.** `uptime` load recorded before and after; zero illegal actions required; single invocation (48,000 games across three paired arms) expected well under 5 minutes.
