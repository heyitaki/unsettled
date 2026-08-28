# M-45 preregistration — H4 eval confirmation of the final vector

Date: 2026-08-25. Committed before the run.

**Change under test.** The single authorized `eval` spend of the programme: confirming that the H4 final vector's tuning-domain gain is not an artifact of the tuning seeds. The candidate is `simulator/placement/arms/h4_final.json`, fixed by the M-44 coordinate pass per its preregistered rule: the composite defaults with exactly four winners kept — `trading.etwWeight` 4.0, `trading.dangerFloor` 4.0, `trading.dangerWeight` 2.0, `devBuyScale` 0.25 — after the pass reverted `tempoWeight`, `tempoHalf`, `benefitWeight`, `marginScale`, and `offerBase` (three removal-`better`, two removal-`equivalent`), and the M-44 follow-up measured the final vector `better` than both the full combined vector (+4.56pp) and the default composite (+14.76pp) on tuning. The vector is pinned by `the_h4_arm_files_are_the_committed_combine_vectors` and loads through the full H0 contract (guards and headroom at load).

**Design.** Confirmation-at-power protocol (M-40/M-43 precedent) on the held-out domain: `evaluate`, standard4, 4 seats, **`--domain eval`**, field `pip_diversity`, every seat on `heuristic-v1-trader-aware-threat-devcards-denial` with `--player-trading`, 8000 boards x 2 reps (64,000 paired units over 8000 clusters), reference `base` = the named composite at defaults, one decision arm `final` = the composite at `h4_final.json`. Single arm by design: one question, one decision arm, no multiplicity. `eval` has previously been spent only on the `resourceValue` spread question, a different parameter set; it is unspent for every axis in this vector.

**Command** (from `simulator/`):

```text
cargo run --release -p unsettled-sim -- evaluate --layout standard4 --seats 4 --domain eval --field pip_diversity --arm base=pip_diversity --arm final=pip_diversity --arm-policy final=heuristic-v1-trader-aware-threat-devcards-denial@placement/arms/h4_final.json --reference base --boards 8000 --reps 2 --policy heuristic-v1-trader-aware-threat-devcards-denial --threads 0 --player-trading --out runs/m45-h4-eval
```

**Decision rule (fixed before the run).** Per the plan's Task 24: verdict `better`, or `equivalent` with a positive point estimate, confirms the candidate — record it as the committed `phase-i-candidate*` files (the policy vector, plus the placement side, which is today's `default-weights.json` unchanged since H1 produced no winner) and mark H done in `programme.md` with Phase I awaiting the user. Any other outcome (`worse`, `inconclusive`, or `equivalent` with a non-positive estimate) is recorded honestly, and the best defensible candidate is recorded instead with its evidence: the deliberation may weigh the M-40 `diversityWeight` 4.8 prior and the per-axis H2/H4 readings, but nothing enters a candidate file without a `better` verdict somewhere in its record. Nothing is adopted anywhere in any case: `simulator/placement/default-weights.json`, the Rust param defaults, and `src/engine/weights.ts` stay byte-identical; Phase I (the `gate` domain and adoption) is the user's.

**Prediction (recorded before the run).** The tuning estimate is +14.76pp with a half-interval under 1pp, and the four kept axes were each screened `better` alone and kept by the coordinate pass, so the gain should largely survive the seed change; the known risk is field-overfit (all four axes tune the hero's trade machinery against this exact fixed field), which a domain change does not remove — that residual risk is Phase I's gate question, not this run's. Expected: `better` with an estimate in the +10pp to +15pp range; the fallback outcomes exist for the case where the tuning gain was substantially seed-specific.

**Threshold and alpha.** +-1pp practical threshold, alpha 0.05, interval selection as in prior M entries (McNemar vs clustered, whichever the harness selects).

**Admissibility.** `uptime` load recorded before and after; zero illegal actions required; one invocation of 128,000 games (~20s at the observed throughput), well under the 5-minute ceiling; no concurrent test suite or CPU-heavy job.
