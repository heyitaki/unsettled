# M-41 preregistration — H2 policy-block screens

Date: 2026-08-25. Committed before the runs.

**Change under test.** Phase H2: single-parameter perturbation screens over every swept policy parameter — the `HeuristicParams` core, the J and knight axes, and the `ThreatParams`, `DevCardParams`, `TradeParams`, and `DenialParams` gate blocks — via the H0 params-file mechanism. Each parameter gets one arm below and one above its default (generally half and double, clamped to the ranges in `simulator/placement/sweep-bounds.json`; deviations noted per axis below), as full composite params files under `simulator/placement/arms/h2_<slug>_<lo|hi>.json` (exact-key load, domain guards and the SIM-GAP-30 headroom check at load; the committed test `the_h2_arm_files_are_single_parameter_perturbations_inside_bounds` pins that every file is a single-leaf perturbation inside bounds). 64 parameters, 128 arms.

**TradeConfig is excluded, structurally.** The screen's estimand is the paired win-rate difference under a hero-only change against an unchanged field. `TradeConfig` is engine-global (one `RuleConfig::player_trading` config for all seats; the CLI flags confirm this), so no perturbation of it can leave the field unchanged — and with the base arm identical to the field (all four seats the same placement, policy, and config), the hero's rotated-seat win rate is pinned at the symmetric seat average regardless of the config value. The estimand does not exist for a global setting; no run can screen it. Disposition recorded in the M entry and `programme.md` (the `TradeConfig` defaults stay declared placeholders; a per-seat refusal-threshold seam would be the follow-up if one is ever wanted), mirroring the M-38 "structurally dead on this instrument" precedent. `legacyValuation` and `specialBuild` are pinned measurement-only surfaces, not swept. Placement weights are H1 (M-38/M-39/M-40); `handValue`'s drop question is H3.

**Arms (64 parameters, 128 arms; every value inside the committed bounds).**

`HeuristicParams` core:

| Slug | Parameter | Default | lo | hi |
| --- | --- | ---: | ---: | ---: |
| production | productionWeight | 1.0 | 0.5 | 2.0 |
| scarcity | scarcityWeight | 0.35 | 0.175 | 0.7 |
| divbonus | diversityBonus | 1.4 | 0.7 | 2.8 |
| portw | portWeight | 0.1 | 0.05 | 0.2 |
| expansion | expansionWeight | 0.15 | 0.075 | 0.3 |
| robthresh | robberBlockThreshold | 4 | 2 | 7 (double clamped to bounds) |
| shed | shedWeight | 10.0 | 5.0 | 20.0 |

J axes (zero-default axes perturb upward from zero at their Phase-J trial values, so the H2 readings extend the M-32..M-37 priors to the composite-field corner; `goalHysteresisMargin` probes below 0.25 per M-35's decisively-worse reading at 0.25 and 1.0):

| Slug | Parameter | Default | lo | hi |
| --- | --- | ---: | ---: | ---: |
| goalneed | goalNeedWeight | 0.0 | 0.5 | 2.0 |
| stageexp | stageExpansionWeight | 0.0 | 0.5 | 1.0 |
| stagecity | stageCityWeight | 0.0 | 0.5 | 2.0 |
| stageurg | stageUrgencyWeight | 0.0 | 0.5 | 1.0 |
| slotret | slotReturnWeight | 0.0 | 2.0 | 8.0 |
| costpress | costPressureWeight | 0.0 | 0.5 | 2.0 |
| frontier | frontierMix | 0.0 | 0.5 | 1.0 |
| devbuy | devBuyScale | 1.0 | 0.5 | 2.0 |
| hyst | goalHysteresisMargin | 0.0 | 0.0625 | 0.125 |

`ThreatParams` (the knight axes are the M-31 placeholders):

| Slug | Parameter | Default | lo | hi |
| --- | --- | ---: | ---: | ---: |
| thrdelay | delayWeight | 1.0 | 0.5 | 2.0 |
| thrneed | needWeight | 0.35 | 0.175 | 0.7 |
| thrblock | blockWeight | 0.25 | 0.125 | 0.5 |
| thrsteal | stealWeight | 0.02 | 0.01 | 0.04 |
| thrvictim | victimHandWeight | 0.15 | 0.075 | 0.3 |
| thrfloor | dangerFloor | 1.0 | 0.5 | 2.0 |
| thrdelaycap | delayCap | 4.0 | 2.0 | 8.0 |
| thrhandcap | handCap | 8.0 | 4.0 | 16.0 |
| knsteal | knightStealWeight | 12.0 | 6.0 | 24.0 |
| knplace | knightPlacementWeight | 30.0 | 15.0 | 60.0 |

`DevCardParams` (`holdDiscount`'s half/double both clamp, so its arms are the bounds endpoints):

| Slug | Parameter | Default | lo | hi |
| --- | --- | ---: | ---: | ---: |
| dcetw | etwWeight | 1.0 | 0.5 | 2.0 |
| dcetwfloor | etwFloor | 1.0 | 0.5 | 2.0 |
| dcgaincap | gainCap | 4.0 | 2.0 | 8.0 |
| dccompletion | completionWeight | 0.35 | 0.175 | 0.7 |
| dchold | holdDiscount | 0.95 | 0.8 | 1.0 |
| dchaul | haulGrowth | 0.5 | 0.25 | 1.0 |
| dcmono | monopolySoundFloor | 1.0 | 0.5 | 2.0 |
| dctempo | tempoWeight | 0.2 | 0.1 | 0.4 |
| dctempohalf | tempoHalf | 4.0 | 2.0 | 8.0 |
| dcexposure | exposureWeight | 0.05 | 0.025 | 0.1 |

`TradeParams`:

| Slug | Parameter | Default | lo | hi |
| --- | --- | ---: | ---: | ---: |
| tretw | etwWeight | 1.0 | 0.5 | 2.0 |
| tretwfloor | etwFloor | 1.0 | 0.5 | 2.0 |
| trgaincap | gainCap | 4.0 | 2.0 | 8.0 |
| trtempo | tempoWeight | 0.2 | 0.1 | 0.4 |
| trtempohalf | tempoHalf | 4.0 | 2.0 | 8.0 |
| trscarcity | scarcityFloor | 0.25 | 0.125 | 0.5 |
| trfloor | dangerFloor | 1.0 | 0.5 | 2.0 |
| trdangerw | dangerWeight | 0.5 | 0.25 | 1.0 |
| trbenefit | benefitWeight | 0.5 | 0.25 | 1.0 |
| trmargin | marginScale | 6.0 | 3.0 | 12.0 |
| troffergain | offerGainWeight | 1.0 | 0.5 | 2.0 |
| trofferbase | offerBase | 350.0 | 175.0 | 700.0 |
| trofferspan | offerSpan | 100.0 | 50.0 | 200.0 |

`DenialParams` (`raceCheckCap` doubles to a clamp at the default, and at 4 seats every cap of 3 or more already checks all three rivals, so both arms probe downward — 1 and 2 are the only values that bite; `pressureFloor`'s double clamps to the bounds max):

| Slug | Parameter | Default | lo | hi |
| --- | --- | ---: | ---: | ---: |
| dnfloor | dangerFloor | 1.0 | 0.5 | 2.0 |
| dnpressfloor | pressureFloor | 0.55 | 0.275 | 1.0 |
| dnpressspan | pressureSpan | 0.85 | 0.425 | 1.7 |
| dnrace | raceBonus | 0.5 | 0.25 | 1.0 |
| dnracemin | raceDangerMin | 0.25 | 0.125 | 0.5 |
| dnracecap | raceCheckCap | 5 | 1 | 2 |
| dndefend | defendWeight | 12000.0 | 6000.0 | 24000.0 |
| dnheadroom | defendHeadroomHalf | 1.0 | 0.5 | 2.0 |
| dnprobe | defendProbeSlack | 2 | 1 | 4 |
| dncontest | contestWeight | 60.0 | 30.0 | 120.0 |
| dncontestcap | contestCap | 120.0 | 60.0 | 240.0 |
| dnblockbonus | contestBlockBonus | 0.5 | 0.25 | 1.0 |
| dngoalshare | contestGoalShare | 0.5 | 0.25 | 1.0 |
| dnarmy | armyDefendWeight | 80.0 | 40.0 | 160.0 |
| dnarmygap | armyGapHalf | 1.0 | 0.5 | 2.0 |

**Design.** H-screen protocol per the plan: `evaluate`, standard4, 4 seats, `--domain tuning`, field `pip_diversity` placement, composite field — every seat runs `heuristic-v1-trader-aware-threat-devcards-denial` with `--player-trading`. 2000 boards x 2 reps (16,000 paired units per arm over 2000 clusters). Every arm places via `pip_diversity` like the field, so an arm differs from the field only in the one perturbed policy parameter; reference = `base` = the named composite at defaults (H0's e2e suite proved a composite-defaults params file bit-identical to the named label), expected to sit near the symmetric 0.25 corner. Six invocations grouped by block; each arm's policy is `heuristic-v1-trader-aware-threat-devcards-denial@placement/arms/h2_<slug>_<lo|hi>.json`.

**Commands** (from `simulator/`; each `--arm <label>=pip_diversity` carries a matching `--arm-policy <label>=<composite>@placement/arms/h2_<label>.json`, abbreviated here as `ARM(label)`; the expansions are mechanical):

```text
cargo run --release -p unsettled-sim -- evaluate --layout standard4 --seats 4 --domain tuning --field pip_diversity --arm base=pip_diversity ARM(production_lo) ARM(production_hi) ARM(scarcity_lo) ARM(scarcity_hi) ARM(divbonus_lo) ARM(divbonus_hi) ARM(portw_lo) ARM(portw_hi) ARM(expansion_lo) ARM(expansion_hi) ARM(robthresh_lo) ARM(robthresh_hi) ARM(shed_lo) ARM(shed_hi) --reference base --boards 2000 --reps 2 --policy heuristic-v1-trader-aware-threat-devcards-denial --threads 0 --player-trading --out runs/m41-h2a

cargo run --release -p unsettled-sim -- evaluate ... --arm base=pip_diversity ARM(goalneed_lo) ARM(goalneed_hi) ARM(stageexp_lo) ARM(stageexp_hi) ARM(stagecity_lo) ARM(stagecity_hi) ARM(stageurg_lo) ARM(stageurg_hi) ARM(slotret_lo) ARM(slotret_hi) ARM(costpress_lo) ARM(costpress_hi) ARM(frontier_lo) ARM(frontier_hi) ARM(devbuy_lo) ARM(devbuy_hi) ARM(hyst_lo) ARM(hyst_hi) ... --out runs/m41-h2b

cargo run --release -p unsettled-sim -- evaluate ... --arm base=pip_diversity ARM(thrdelay_lo) ARM(thrdelay_hi) ARM(thrneed_lo) ARM(thrneed_hi) ARM(thrblock_lo) ARM(thrblock_hi) ARM(thrsteal_lo) ARM(thrsteal_hi) ARM(thrvictim_lo) ARM(thrvictim_hi) ARM(thrfloor_lo) ARM(thrfloor_hi) ARM(thrdelaycap_lo) ARM(thrdelaycap_hi) ARM(thrhandcap_lo) ARM(thrhandcap_hi) ARM(knsteal_lo) ARM(knsteal_hi) ARM(knplace_lo) ARM(knplace_hi) ... --out runs/m41-h2c

cargo run --release -p unsettled-sim -- evaluate ... --arm base=pip_diversity ARM(dcetw_lo) ARM(dcetw_hi) ARM(dcetwfloor_lo) ARM(dcetwfloor_hi) ARM(dcgaincap_lo) ARM(dcgaincap_hi) ARM(dccompletion_lo) ARM(dccompletion_hi) ARM(dchold_lo) ARM(dchold_hi) ARM(dchaul_lo) ARM(dchaul_hi) ARM(dcmono_lo) ARM(dcmono_hi) ARM(dctempo_lo) ARM(dctempo_hi) ARM(dctempohalf_lo) ARM(dctempohalf_hi) ARM(dcexposure_lo) ARM(dcexposure_hi) ... --out runs/m41-h2d

cargo run --release -p unsettled-sim -- evaluate ... --arm base=pip_diversity ARM(tretw_lo) ARM(tretw_hi) ARM(tretwfloor_lo) ARM(tretwfloor_hi) ARM(trgaincap_lo) ARM(trgaincap_hi) ARM(trtempo_lo) ARM(trtempo_hi) ARM(trtempohalf_lo) ARM(trtempohalf_hi) ARM(trscarcity_lo) ARM(trscarcity_hi) ARM(trfloor_lo) ARM(trfloor_hi) ARM(trdangerw_lo) ARM(trdangerw_hi) ARM(trbenefit_lo) ARM(trbenefit_hi) ARM(trmargin_lo) ARM(trmargin_hi) ARM(troffergain_lo) ARM(troffergain_hi) ARM(trofferbase_lo) ARM(trofferbase_hi) ARM(trofferspan_lo) ARM(trofferspan_hi) ... --out runs/m41-h2e

cargo run --release -p unsettled-sim -- evaluate ... --arm base=pip_diversity ARM(dnfloor_lo) ARM(dnfloor_hi) ARM(dnpressfloor_lo) ARM(dnpressfloor_hi) ARM(dnpressspan_lo) ARM(dnpressspan_hi) ARM(dnrace_lo) ARM(dnrace_hi) ARM(dnracemin_lo) ARM(dnracemin_hi) ARM(dnracecap_lo) ARM(dnracecap_hi) ARM(dndefend_lo) ARM(dndefend_hi) ARM(dnheadroom_lo) ARM(dnheadroom_hi) ARM(dnprobe_lo) ARM(dnprobe_hi) ARM(dncontest_lo) ARM(dncontest_hi) ARM(dncontestcap_lo) ARM(dncontestcap_hi) ARM(dnblockbonus_lo) ARM(dnblockbonus_hi) ARM(dngoalshare_lo) ARM(dngoalshare_hi) ARM(dnarmy_lo) ARM(dnarmy_hi) ARM(dnarmygap_lo) ARM(dnarmygap_hi) ... --out runs/m41-h2f
```

The elided middle of each command is identical to the first's: `--layout standard4 --seats 4 --domain tuning --field pip_diversity` before the arms, `--reference base --boards 2000 --reps 2 --policy heuristic-v1-trader-aware-threat-devcards-denial --threads 0 --player-trading` after.

**Decision rule (fixed before the runs).** This is a screen on the tuning domain. A parameter direction is kept as an H4 combine candidate only on verdict `better`; `worse`, `equivalent`, and `inconclusive` are recorded as H priors and change nothing. SIM-GAP-24 closes on the `devbuy` axis per its own recorded rule: a `better` verdict at the lower scale confirms the dev-band bias, anything else refutes it, and either way the reading closes the entry. Per the H1 precedent, the per-parameter screen budget is 2-4 arms: if an axis comes back directional with an interval crossing the threshold, up to two follow-up arms (and at most one confirmation at 4x power, both separately preregistered) may resolve it, exactly as M-39/M-40 did for `diversityWeight`. Nothing is adopted anywhere: the Rust param defaults, `simulator/placement/default-weights.json`, and `src/engine/weights.ts` stay byte-identical (Phase I is the user's). The winners list (possibly empty) is committed into the plan file under Task 22.

**Prediction (recorded before the runs).** The J axes were screened in M-32..M-37 against a plain-trader field and read flat-to-slightly-negative at these same trial values; the composite-field corner here differs, but the prior says mostly `equivalent`, with `hyst` the axis most likely to lean negative even at these sub-0.25 margins (M-35 was decisively worse at 0.25 and monotone in the margin). The knight axes should show low discordance (M-31's rejoin moved 6 of 16,000 games). The gate blocks have never been swept; no directional priors, and most axes are expected `equivalent` or `inconclusive` at this power. Interpretive note for the threat block, per contracts.md: the default threat-term ordering is regime-dependent (it reverses below danger roughly 0.105-0.108), so a single-parameter verdict there averages over both regimes and a null does not establish the axis dead in either regime alone. M-24's negative-leaning deck-aware reading suggests the `dcetw`/`dchaul`/`dcmono` family is where dev-card signal would appear if anywhere.

**Threshold and alpha.** +-1pp practical threshold, alpha 0.05, interval selection as in prior M entries (McNemar vs clustered, whichever the harness selects).

**Admissibility.** `uptime` load recorded before and after each invocation; zero illegal actions required; six invocations of 240,000 / 304,000 / 336,000 / 336,000 / 432,000 / 496,000 games, each expected well under the 5-minute ceiling at the observed ~7k games/s; no other test suite or CPU-heavy job runs concurrently.
