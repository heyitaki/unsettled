# M-46 preregistration — Phase I gate decision

Date: 2026-08-27. Committed before the run.

**Authorization.** The `gate` domain is reserved for the user's Phase-I adoption decision. The user delegated that decision explicitly ("you do phase i", 2026-08-27) after being told the run is spend-once and that field-overfit risk survives a seed-domain change. This is the single authorized `gate` spend of the programme; after this run the domain is spent and no further gate-domain command may ever run.

**Change under test.** The committed Phase-I candidate exactly as the M-45 eval confirmation recorded it: `simulator/placement/phase-i-candidate-params.json` (`trading.etwWeight` 4.0, `trading.dangerFloor` 4.0, `trading.dangerWeight` 2.0, `devBuyScale` 0.25, everything else at defaults), with the placement side `phase-i-candidate-weights.json` byte-identical to today's `default-weights.json` (H1 had no winner), so both arms place with default weights and only the policy vector differs — the same estimand M-45 measured, on the untouched domain.

**Design.** Mirror of M-45's confirmation-at-power protocol, changing only the domain: `evaluate`, standard4, 4 seats, **`--domain gate`**, field `pip_diversity`, every seat on `heuristic-v1-trader-aware-threat-devcards-denial` with `--player-trading`, 8000 boards x 2 reps (64,000 paired units over 8000 clusters), reference `base` = the named composite at defaults, one decision arm `candidate` = the composite at `phase-i-candidate-params.json`. Single arm by design: one question, one decision arm, no multiplicity. The M-43 `handValue` question is deliberately **not** given a gate arm: its measured effect (~0.13pp, M-43) is an order of magnitude below this design's resolution (M-45's half-interval was ~0.45pp), so a gate arm could only ever read `equivalent` and would buy no information for its share of the spend.

**Command** (from `simulator/`):

```text
cargo run --release -p unsettled-sim -- evaluate --layout standard4 --seats 4 --domain gate --field pip_diversity --arm base=pip_diversity --arm candidate=pip_diversity --arm-policy candidate=heuristic-v1-trader-aware-threat-devcards-denial@placement/phase-i-candidate-params.json --reference base --boards 8000 --reps 2 --policy heuristic-v1-trader-aware-threat-devcards-denial --threads 0 --player-trading --out runs/m46-phase-i-gate
```

**Decision rule (fixed before the run).** Verdict `better` → **adopt the Phase-I package**; any other outcome (`worse`, `equivalent`, or `inconclusive`, regardless of point estimate) → **reject**, record honestly, and change nothing anywhere — the drop recommendation below then stays a recorded recommendation, not an applied one. No re-runs, no second gate invocation under any outcome. The strictness relative to M-45's confirmation rule is deliberate: confirmation asked "did the tuning gain survive the seeds", adoption asks "is the gain real enough to ship as defaults", and an `equivalent` gate reading against a +14pp eval claim would mean the claimed value did not show up where it counts.

**What adoption changes (and what it does not).** On `better`:

- Rust policy defaults move to the candidate values: `TradeParams::default()` `etw_weight` 1.0→4.0, `danger_floor` 1.0→4.0, `danger_weight` 0.5→2.0 (`crates/engine/src/policy/trading.rs`), and `HeuristicParams` `dev_buy_scale` 1.0→0.25 (`crates/engine/src/policy/heuristic_v1.rs`). `simulator/placement/policy-default-params.json` is regenerated to match (pinned by `the_default_params_file_matches_the_struct_defaults`).
- The M-43 `handValue` drop recommendation is applied as part of the same package: `handValueWeight` → 0 in `simulator/placement/default-weights.json` and `src/engine/weights.ts` (term code kept), `simulator/fixtures/placement-parity.json` regenerated and re-verified per the standing contract. The coupling is preregistered: the drop rides adoption because the package ships together; on reject nothing moves.
- Historical arm files under `placement/arms/` are measurement records of the pre-adoption defaults; their pin tests are re-anchored to an explicit literal pre-adoption baseline rather than `Default::default()`, with a comment saying why. The `phase-i-candidate*` pin test is updated to record adoption. No arm file's bytes change.
- The M-40 `diversityWeight` ~4.8 prior is **not** adopted: it never earned a `better` verdict and is not in the candidate. It stays a recorded prior for any future programme.
- The SIM-GAP-33 block-bonus fix does **not** ride along: the candidate was eval-confirmed with the current semantics, and the fix waits for its own preregistered `tuning` A/B per the gap entry.
- Both cargo profiles and the full JS suite must pass before the adoption commit.

**Prediction (recorded before the run).** M-45 measured +13.98pp on `eval` with a ~0.45pp half-interval; `gate` changes seeds again but reuses the same field, so seed luck is controlled and field-overfit is not. Expected: `better` in the +10pp to +15pp range. The residual field-overfit risk is accepted as priced: the adopted defaults are defaults *for this simulator's composite policy against this field*, and the standing caution remains recorded in M-45 and `programme.md`.

**Threshold and alpha.** ±1pp practical threshold, alpha 0.05, interval selection as in prior M entries (McNemar vs clustered, whichever the harness selects).

**Admissibility.** `uptime` load recorded before and after; zero illegal actions required; one invocation of 128,000 games (~20s at observed throughput), well under the 5-minute ceiling; no concurrent test suite or CPU-heavy job.