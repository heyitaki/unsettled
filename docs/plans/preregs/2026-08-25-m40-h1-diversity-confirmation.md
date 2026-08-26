# M-40 preregistration — H1 diversity-weight confirmation at power

Date: 2026-08-25. Committed before the run.

**Change under test.** M-38 and M-39 mapped the `diversityWeight` axis at 0.8 / 3.2 / 4.8 / 6.4 and found it monotone-then-plateaued: -1.16pp, +0.70pp, +1.08pp, +1.10pp, the last three all `inconclusive` with intervals straddling the +1pp practical threshold. 16,000 paired units gives roughly a +-0.68pp half-width, which cannot separate a true +1.1pp from sub-threshold. This run re-measures **one** preregistered decision arm — `diversity_48` (4.8), chosen over 6.4 as the smaller deviation at the same plateau estimate — at four times the power. Single arm by design: two arms would be two chances at `better` and inflate the screen's false-positive rate.

**Design.** As M-38/M-39 except power: `evaluate`, standard4, 4 seats, `--domain tuning`, field `pip_diversity`, every seat on `heuristic-v1-trader-aware-threat-devcards-denial` with `--player-trading`, **8000 boards x 2 reps** (64,000 paired units over 8000 clusters; boards preferred over reps), reference `base` = `app_formula:placement/default-weights.json`. The tuning domain's board schedule is deterministic, so the first 2000 boards repeat the screen's boards; this is a screen-domain re-measurement, not an independent replication — `eval` stays unspent, and the H4 eval confirmation remains the independence check for whatever vector emerges.

**Command** (from `simulator/`):

```text
cargo run --release -p unsettled-sim -- evaluate --layout standard4 --seats 4 --domain tuning --field pip_diversity --arm base=app_formula:placement/default-weights.json --arm diversity_48=app_formula:placement/arms/h1_diversity_48.json --reference base --boards 8000 --reps 2 --policy heuristic-v1-trader-aware-threat-devcards-denial --threads 0 --player-trading --out runs/m40-h1-diversity-confirm
```

**Decision rule (fixed before the run).** Verdict `better`: `diversityWeight` 4.8 enters the H4 combine as H1's winner. Verdict `equivalent` or `inconclusive`: no winner from this axis — the reading is recorded as the H prior (positive, at or near the threshold) and H1's winners list closes empty on this axis; no further re-runs, whatever the estimate. Nothing shipped changes in any case.

**Prediction (recorded before the run).** The pooled M-39 plateau estimate is +1.09pp; at +-0.34pp expected half-width the interval lands entirely above +1pp only if the truth is above roughly +1.35pp, so `inconclusive` remains the most likely verdict, with `better` the live alternative if the screen estimates were dragged down by the shared low-power noise.

**Threshold and alpha.** +-1pp, alpha 0.05, interval selection as in prior M entries.

**Admissibility.** `uptime` before and after; zero illegal actions; one invocation of 128,000 games (~25s expected); no concurrent CPU-heavy jobs.
