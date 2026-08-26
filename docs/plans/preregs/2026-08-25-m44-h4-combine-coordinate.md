# M-44 preregistration — H4 combined vector and coordinate pass

Date: 2026-08-25. Committed before the run.

**Change under test.** Phase H4's combine step: the nine M-41/M-42 winners applied together, plus one coordinate re-screen of each winner at the combined point. The combined vector is the committed `simulator/placement/arms/h4_combined.json` — the full composite defaults with exactly the nine winner leaves moved: `trading.etwWeight` 4.0, `trading.tempoWeight` 0.8, `trading.benefitWeight` 2.0, `trading.marginScale` 24.0, `trading.offerBase` 700.0, `trading.tempoHalf` 1.0, `trading.dangerFloor` 4.0, `trading.dangerWeight` 2.0, `devBuyScale` 0.25. Each coordinate arm `h4_no_<slug>.json` is the combined vector with one winner reverted to its default, so its paired contrast against the combined arm is that winner's marginal value at the combined point. The committed pin test `the_h4_arm_files_are_the_committed_combine_vectors` proves every file loads through the full H0 contract (exact keys, domain guards, and the SIM-GAP-30 headroom check — this is H4's headroom re-check, discharged mechanically at load) and is byte-shape-identical to the vector stated here.

**Arms (11).**

| Label | File | Reverted axis (default) |
| --- | --- | --- |
| base | (named composite at defaults) | — |
| combined | h4_combined.json | — |
| no_tretw | h4_no_tretw.json | trading.etwWeight (1.0) |
| no_trtempo | h4_no_trtempo.json | trading.tempoWeight (0.2) |
| no_trbenefit | h4_no_trbenefit.json | trading.benefitWeight (0.5) |
| no_trmargin | h4_no_trmargin.json | trading.marginScale (6.0) |
| no_trofferbase | h4_no_trofferbase.json | trading.offerBase (350.0) |
| no_trtempohalf | h4_no_trtempohalf.json | trading.tempoHalf (4.0) |
| no_trfloor | h4_no_trfloor.json | trading.dangerFloor (1.0) |
| no_trdangerw | h4_no_trdangerw.json | trading.dangerWeight (0.5) |
| no_devbuy | h4_no_devbuy.json | devBuyScale (1.0) |

**Design.** H-screen protocol otherwise unchanged: `evaluate`, standard4, 4 seats, `--domain tuning`, field `pip_diversity`, composite field with `--player-trading`, 2000 boards x 2 reps (16,000 paired units per contrast over 2000 clusters), every arm placing via `pip_diversity`. **Reference = `combined`**, so each `no_<slug>` contrast reads the winner's marginal at the combined point directly, and the `base` contrast (sign-flipped) is the full combine's tuning-domain estimate against the default composite. One invocation, 11 arms, 176,000 games.

**Command** (from `simulator/`, `COMP` = `heuristic-v1-trader-aware-threat-devcards-denial`, `ARM(label)` = `--arm <label>=pip_diversity --arm-policy <label>=COMP@placement/arms/h4_<label>.json` for every label except `base`, which is `--arm base=pip_diversity` alone):

```text
cargo run --release -p unsettled-sim -- evaluate --layout standard4 --seats 4 --domain tuning --field pip_diversity --arm base=pip_diversity ARM(combined) ARM(no_tretw) ARM(no_trtempo) ARM(no_trbenefit) ARM(no_trmargin) ARM(no_trofferbase) ARM(no_trtempohalf) ARM(no_trfloor) ARM(no_trdangerw) ARM(no_devbuy) --reference combined --boards 2000 --reps 2 --policy heuristic-v1-trader-aware-threat-devcards-denial --threads 0 --player-trading --out runs/m44-h4-coordinate
```

**Decision rule (fixed before the run).** Per winner axis, from the `no_<slug>` verdict against reference `combined`:

- `better` (removing the winner improves the combined vector): the winner is harmful at the combined point — revert it to default in the final vector.
- `equivalent` (removal is established value-neutral): revert to default — at equal value the smaller deviation from defaults wins, the M-42 `offerBase` saturation precedent.
- `worse` (removal costs real value) or `inconclusive` (unresolved at this power): keep the winner. An axis enters this pass as a screened `better` winner; the coordinate pass removes it only on positive evidence of harm or established equivalence, and does not re-litigate the screen on an unresolved read.

If no axis reverts, the final vector is `h4_combined.json` and goes to the separately preregistered eval confirmation (M-45). If any axis reverts, the final vector is committed as `simulator/placement/arms/h4_final.json` (the mechanical application of the rule above; the pin test extends to it) and one follow-up tuning invocation at the same power runs arms `{base, combined, final}` with **reference = `final`**: the `base` contrast (sign-flipped) prices the final vector on tuning, and the `combined` contrast checks the reverts — if `combined` comes back `better` than `final`, the parsimony reverts cost real value in combination and the eval candidate is `h4_combined.json` instead; otherwise the candidate is `h4_final.json`. Nothing is adopted anywhere: the Rust param defaults, `simulator/placement/default-weights.json`, and `src/engine/weights.ts` stay byte-identical (Phase I is the user's).

**Prediction (recorded before the run).** The nine single-arm estimates sum to roughly +48pp, which is impossible, so heavy sub-additivity is certain — all nine move the same trade-selection machinery against the same fixed field. Expected combined estimate vs base: somewhere in the +8pp to +20pp range. `no_trofferbase` is the likeliest `equivalent` (M-42 showed the axis exactly saturated at 700 alone; at `marginScale` 24 the offer-pricing term plausibly stops binding entirely). The four axes that were still rising at their bounds (`etwWeight`, `tempoWeight`, `benefitWeight`, `marginScale`) are the likeliest `worse`-on-removal keeps. One to three reverts overall.

**Threshold and alpha.** +-1pp practical threshold, alpha 0.05, interval selection as in prior M entries (McNemar vs clustered, whichever the harness selects).

**Admissibility.** `uptime` load recorded before and after; zero illegal actions required; one invocation of 176,000 games (~25s at the observed ~7k games/s), well under the 5-minute ceiling; no concurrent test suite or CPU-heavy job.
