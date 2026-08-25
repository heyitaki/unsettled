# M-27 preregistration — embargo threshold onto the shared danger model (SIM-GAP-27)

Date: 2026-08-25. Committed before the run.

**Change under test.** `trade.rs::embargoed` no longer thresholds a conservative hidden-VP estimate; it thresholds the shared ETW danger model (`threat::danger_from_etw`), the same standing-danger function the robber and trading policies already use. A seat is refused all player trades when its danger reaches `TradeConfig::embargo_danger` (default 0.125, roughly ETW <= 7 turns at the shared floor 1.0), and at the softer `embargo_takeover_danger` (default 0.0625, roughly ETW <= 15) only while it holds an imminent Largest Army or Longest Road swing, which the ETW closed form deliberately excludes. The seat's own eligibility (the engine's per-seat pass) prices its real hand; a rival's estimate stands on the belief-derived expectation, mirroring `trading::own_inputs`. All three thresholds are unswept Phase-H placeholders in `TradeConfig` (H2 owns them) and are exposed as CLI flags. Pre-change behavior is preserved behind `LegacyValuation::vp_embargo`, exposed as the composite label `heuristic-v1-trader-aware-threat-devcards-denial-legacyembargo`.

**Scope note.** The engine forwards each seat's own policy flag, so the field seats run the danger-model embargo in both arms; the paired contrast isolates the arm seat's embargo model (its self-eligibility and its proposal-recipient filter). The rules-level default change moves every trader arm, so the corpus recapture is corpus-moving by design and is documented in the task commit.

**Design.** Standard gap-fix A/B per the programme's measurement protocol: `evaluate`, standard4, 4 seats, `--domain tuning`, field `pip_diversity` placement, field policy `heuristic-v1-trader`, player trading on, 400 boards x 10 reps, threads 0. Reference arm = pre-change composite (`-legacyembargo`); test arm = post-change composite (`heuristic-v1-trader-aware-threat-devcards-denial`, current defaults).

**Command.**

```text
cargo run --release -p unsettled-sim -- evaluate --layout standard4 --seats 4 --domain tuning --field pip_diversity --arm base=pip_diversity --arm embargo=pip_diversity --arm-policy base=heuristic-v1-trader-aware-threat-devcards-denial-legacyembargo --arm-policy embargo=heuristic-v1-trader-aware-threat-devcards-denial --reference base --boards 400 --reps 10 --policy heuristic-v1-trader --threads 0 --player-trading --out runs/m27-embargo
```

**Decision rule (fixed before the run).** This is a record-and-regression A/B, not an adoption gate: the fix ships unless the `embargo` arm's verdict is `worse` (selected interval strictly below -1pp). `better`, `equivalent`, or `inconclusive` all keep the fix with the reading recorded. A `worse` verdict stops the task and records the evidence per the plan's gap-fix rule.

**Threshold and alpha.** +-1pp practical threshold, interval selection as in prior M entries (McNemar vs clustered, whichever the harness selects).

**Admissibility.** `uptime` load recorded before and after; zero illegal actions required; single invocation expected well under 5 minutes.
