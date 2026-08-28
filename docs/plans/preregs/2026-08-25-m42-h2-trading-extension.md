# M-42 preregistration — H2 trading-axis extension

Date: 2026-08-25. Committed before the run.

**Change under test.** The M-41 screen's follow-up arms, inside its preregistered 2-4 arm per-parameter budget, per the M-39 precedent of extending a directional axis. M-41 left the `TradeParams` block as the one hot surface: five axes monotone with a `better` verdict at double the default (`etwWeight`, `tempoWeight`, `benefitWeight`, `marginScale`, `offerBase`), four more directional with the selected interval crossing the +1pp threshold (`tempoHalf` down, `scarcityFloor` up, `dangerFloor` up, `dangerWeight` up), and `devBuyScale` `better` at half. This run spends one further arm on each: the five winners at their sweep-bounds maxima (4x default — the last probe the committed bounds admit), the four crossing axes at their unprobed endpoint, and `devBuyScale` at the bounds minimum 0.25. Arms as committed files `simulator/placement/arms/h2x_<slug>.json`, pinned by the extended `the_h2_arm_files_are_single_parameter_perturbations_inside_bounds` test.

**Arms (10, every value a committed bounds endpoint).**

| Slug | Parameter | Default | M-41 reading | Extension value |
| --- | --- | ---: | --- | ---: |
| tretw_40 | trading.etwWeight | 1.0 | better at 2.0 (+4.24pp) | 4.0 |
| trtempo_80 | trading.tempoWeight | 0.2 | better at 0.4 (+3.67pp) | 0.8 |
| trbenefit_20 | trading.benefitWeight | 0.5 | better at 1.0 (+2.83pp) | 2.0 |
| trmargin_24 | trading.marginScale | 6.0 | better at 12.0 (+7.00pp) | 24.0 |
| trofferbase_1400 | trading.offerBase | 350.0 | better at 700.0 (+4.40pp) | 1400.0 |
| trtempohalf_10 | trading.tempoHalf | 4.0 | +1.69pp at 2.0, crossing | 1.0 |
| trscarcity_10 | trading.scarcityFloor | 0.25 | +1.06pp at 0.5, crossing | 1.0 |
| trfloor_40 | trading.dangerFloor | 1.0 | +1.40pp at 2.0, crossing | 4.0 |
| trdangerw_20 | trading.dangerWeight | 0.5 | +1.40pp at 1.0, crossing | 2.0 |
| devbuy_25 | devBuyScale | 1.0 | better at 0.5 (+2.46pp) | 0.25 |

**Design.** Identical protocol to M-41: `evaluate`, standard4, 4 seats, `--domain tuning`, field `pip_diversity` placement, composite field with `--player-trading`, 2000 boards x 2 reps, reference `base` = the named composite at defaults, every arm `pip_diversity` placement with `--arm-policy <label>=<composite>@placement/arms/h2x_<label>.json`. One invocation, 11 arms, 176,000 games.

**Command** (from `simulator/`, `ARM(label)` expanding as in the M-41 prereg with the `h2x_` prefix):

```text
cargo run --release -p unsettled-sim -- evaluate --layout standard4 --seats 4 --domain tuning --field pip_diversity --arm base=pip_diversity ARM(tretw_40) ARM(trtempo_80) ARM(trbenefit_20) ARM(trmargin_24) ARM(trofferbase_1400) ARM(trtempohalf_10) ARM(trscarcity_10) ARM(trfloor_40) ARM(trdangerw_20) ARM(devbuy_25) --reference base --boards 2000 --reps 2 --policy heuristic-v1-trader-aware-threat-devcards-denial --threads 0 --player-trading --out runs/m42-h2x
```

**Decision rule (fixed before the run).** Screen rule unchanged: an arm enters the H4 winners list only on verdict `better`. Where an axis then has two `better` values, the H4 combine takes the one with the larger estimate; a `worse` or lower-estimate extension leaves the M-41 winner standing. Crossing axes that resolve to `better` join the winners; anything else is recorded as a prior. The bounds file is not widened for further probes — the bounds are part of the H0 contract, and an axis still rising at its bound is recorded as exactly that. Nothing is adopted anywhere.

**Prediction (recorded before the run).** Per the M-39 plateau precedent, the five winner extensions more likely plateau or fall back than double their estimates; `marginScale` at 24 is the most likely to keep rising given its +7pp at 12. The crossing axes resolve in their leaned direction but most likely stay short of `better` at a single further doubling. `devBuyScale` 0.25 reads on whether the dev-band bias (SIM-GAP-24) deepens toward zero or the 0.5 reading was the floor.

**Threshold and alpha.** +-1pp practical threshold, alpha 0.05, interval selection as in prior M entries.

**Admissibility.** `uptime` load before and after; zero illegal actions required; one invocation of 176,000 games, well under the 5-minute ceiling; no other CPU-heavy job concurrent.
