# M-38 preregistration — H1 placement-weight screens

Date: 2026-08-25. Committed before the runs.

**Change under test.** Phase H1: single-parameter perturbation screens over every swept parameter of `simulator/placement/default-weights.json`. Each screened parameter gets two arms — one below and one above the default, generally half and double, clamped to the ranges declared in `simulator/placement/sweep-bounds.json` — as full weights files under `simulator/placement/arms/h1_<slug>_<lo|hi>.json` (exact-key load, `EngineWeights::validate` at load). Skipped by prior spend or settlement: the `resourceValue` spread axis (eval already spent, per the seed-domain discipline), `genericPortFactor` (settled, pinned at 0.5), and the machinery parameters pinned by degenerate bounds ranges (`opponentTopK`, `softmaxTemperature`, `rolloutBudget`, `rolloutsMin`, `rolloutsMax`, `maxResults`). `handValueWeight` is screened here as a magnitude axis only; the drop-to-zero question is H3's own preregistered A/B at higher power.

**Arms (18 parameters, 36 arms; every value verified inside the committed bounds).**

| Slug | Parameter | Default | lo | hi |
| --- | --- | ---: | ---: | ---: |
| hand | handValueWeight | 0.4 | 0.2 | 0.8 |
| scarcity | scarcityWeight | 0.35 | 0.175 | 0.7 |
| clampmin | scarcityClampMin | 0.5 | 0.25 | 1.0 |
| clampmax | scarcityClampMax | 2 | 1.0 | 4.0 |
| diversity | diversityWeight | 1.6 | 0.8 | 3.2 |
| divcap | diversityCap | 4 | 2.0 | 8.0 |
| coverage | coverageExponent | 1.5 | 1.0 | 2.25 |
| covscarcity | coverageScarcityWeight | 0.5 | 0.25 | 1.0 |
| dup | duplicateNumberPenalty | 0.08 | 0.0 | 0.16 |
| road | recipeRoadBonus | 1.5 | 0.75 | 3.0 |
| city | recipeCityBonus | 2 | 1.0 | 4.0 |
| settlement | recipeSettlementBonus | 1 | 0.5 | 2.0 |
| recipecap | recipeCap | 4 | 2.0 | 8.0 |
| port | portWeight | 0.55 | 0.275 | 1.1 |
| portsurplus | portSurplusThreshold | 3 | 1.0 | 5.0 |
| portradius | nearPortRadius | 2 | 1.0 | 3.0 |
| portdecay | nearPortDecay | 0.5 | 0.25 | 1.0 |
| robber | robberDiscount | 0.35 | 0.175 | 0.7 |

**Design.** H-screen protocol per the plan: `evaluate`, standard4, 4 seats, `--domain tuning`, field `pip_diversity` placement, **composite field** — every seat (field and arms) runs `heuristic-v1-trader-aware-threat-devcards-denial` with `--player-trading` (M-21: the value lives at the all-gates-on trading corner; the H context specifies the ETW-aware composite field for screens, unlike the J runs whose field policy was plain `heuristic-v1-trader`). 2000 boards x 2 reps (16,000 paired units per arm over 2000 clusters; boards preferred over reps for precision). Reference = `base` = `app_formula:placement/default-weights.json`; test arms differ from it only in the one perturbed weight. Four invocations grouped by parameter family, each with its own reference arm, each expected well under the 5-minute idle-timeout ceiling.

**Commands** (from `simulator/`):

```text
cargo run --release -p unsettled-sim -- evaluate --layout standard4 --seats 4 --domain tuning --field pip_diversity --arm base=app_formula:placement/default-weights.json --arm hand_lo=app_formula:placement/arms/h1_hand_lo.json --arm hand_hi=app_formula:placement/arms/h1_hand_hi.json --arm scarcity_lo=app_formula:placement/arms/h1_scarcity_lo.json --arm scarcity_hi=app_formula:placement/arms/h1_scarcity_hi.json --arm clampmin_lo=app_formula:placement/arms/h1_clampmin_lo.json --arm clampmin_hi=app_formula:placement/arms/h1_clampmin_hi.json --arm clampmax_lo=app_formula:placement/arms/h1_clampmax_lo.json --arm clampmax_hi=app_formula:placement/arms/h1_clampmax_hi.json --reference base --boards 2000 --reps 2 --policy heuristic-v1-trader-aware-threat-devcards-denial --threads 0 --player-trading --out runs/m38-h1a

cargo run --release -p unsettled-sim -- evaluate --layout standard4 --seats 4 --domain tuning --field pip_diversity --arm base=app_formula:placement/default-weights.json --arm diversity_lo=app_formula:placement/arms/h1_diversity_lo.json --arm diversity_hi=app_formula:placement/arms/h1_diversity_hi.json --arm divcap_lo=app_formula:placement/arms/h1_divcap_lo.json --arm divcap_hi=app_formula:placement/arms/h1_divcap_hi.json --arm coverage_lo=app_formula:placement/arms/h1_coverage_lo.json --arm coverage_hi=app_formula:placement/arms/h1_coverage_hi.json --arm covscarcity_lo=app_formula:placement/arms/h1_covscarcity_lo.json --arm covscarcity_hi=app_formula:placement/arms/h1_covscarcity_hi.json --arm dup_lo=app_formula:placement/arms/h1_dup_lo.json --arm dup_hi=app_formula:placement/arms/h1_dup_hi.json --reference base --boards 2000 --reps 2 --policy heuristic-v1-trader-aware-threat-devcards-denial --threads 0 --player-trading --out runs/m38-h1b

cargo run --release -p unsettled-sim -- evaluate --layout standard4 --seats 4 --domain tuning --field pip_diversity --arm base=app_formula:placement/default-weights.json --arm road_lo=app_formula:placement/arms/h1_road_lo.json --arm road_hi=app_formula:placement/arms/h1_road_hi.json --arm city_lo=app_formula:placement/arms/h1_city_lo.json --arm city_hi=app_formula:placement/arms/h1_city_hi.json --arm settlement_lo=app_formula:placement/arms/h1_settlement_lo.json --arm settlement_hi=app_formula:placement/arms/h1_settlement_hi.json --arm recipecap_lo=app_formula:placement/arms/h1_recipecap_lo.json --arm recipecap_hi=app_formula:placement/arms/h1_recipecap_hi.json --reference base --boards 2000 --reps 2 --policy heuristic-v1-trader-aware-threat-devcards-denial --threads 0 --player-trading --out runs/m38-h1c

cargo run --release -p unsettled-sim -- evaluate --layout standard4 --seats 4 --domain tuning --field pip_diversity --arm base=app_formula:placement/default-weights.json --arm port_lo=app_formula:placement/arms/h1_port_lo.json --arm port_hi=app_formula:placement/arms/h1_port_hi.json --arm portsurplus_lo=app_formula:placement/arms/h1_portsurplus_lo.json --arm portsurplus_hi=app_formula:placement/arms/h1_portsurplus_hi.json --arm portradius_lo=app_formula:placement/arms/h1_portradius_lo.json --arm portradius_hi=app_formula:placement/arms/h1_portradius_hi.json --arm portdecay_lo=app_formula:placement/arms/h1_portdecay_lo.json --arm portdecay_hi=app_formula:placement/arms/h1_portdecay_hi.json --arm robber_lo=app_formula:placement/arms/h1_robber_lo.json --arm robber_hi=app_formula:placement/arms/h1_robber_hi.json --reference base --boards 2000 --reps 2 --policy heuristic-v1-trader-aware-threat-devcards-denial --threads 0 --player-trading --out runs/m38-h1d

```

**Decision rule (fixed before the runs).** This is a screen on the tuning domain. A parameter direction is kept as an H4 combine candidate only on verdict `better`; `worse`, `equivalent`, and `inconclusive` verdicts are recorded as H priors and change nothing. Nothing is adopted anywhere: `simulator/placement/default-weights.json`, `src/engine/weights.ts`, and the Rust defaults stay byte-identical (Phase I is the user's). The winners list (possibly empty) is committed into the plan file under Task 21.

**Prediction (recorded before the runs).** At 16,000 paired units the prior J screens produced intervals roughly +-0.2pp to +-0.5pp wide around the estimate; placement perturbations move every hero pick, so discordance (and interval width) should run higher than the policy screens'. Most axes are expected `equivalent` or `inconclusive`; the axes most likely to show signal are the large structural ones (`diversityWeight`, `portWeight`, `robberDiscount`), with no directional prior.

**Threshold and alpha.** +-1pp practical threshold, alpha 0.05, interval selection as in prior M entries (McNemar vs clustered, whichever the harness selects).

**Admissibility.** `uptime` load recorded before and after each invocation; zero illegal actions required; four invocations of 144,000 / 176,000 / 144,000 / 176,000 games, each expected well under 5 minutes; no other test suite or CPU-heavy job runs concurrently.
