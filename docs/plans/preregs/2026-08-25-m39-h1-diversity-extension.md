# M-39 preregistration — H1 diversity-weight axis extension

Date: 2026-08-25. Committed before the run.

**Change under test.** The M-38 screen found exactly one axis with positive directional signal: `diversityWeight` is monotone across its two arms (0.8 at -1.16pp, clustered `[-1.58pp, -0.73pp]`; 3.2 at +0.70pp, clustered `[+0.15pp, +1.25pp]`, `inconclusive` because the interval crosses the +1pp threshold). The H1 protocol budgets 2-4 arms per parameter; this extension spends the remaining two arms upward to resolve whether the axis crosses the practical threshold inside the committed bounds (max 6.4): `h1_diversity_48.json` (4.8) and `h1_diversity_64.json` (6.4), both verified inside `simulator/placement/sweep-bounds.json`.

**Design.** Identical to M-38: `evaluate`, standard4, 4 seats, `--domain tuning`, field `pip_diversity`, every seat on `heuristic-v1-trader-aware-threat-devcards-denial` with `--player-trading`, 2000 boards x 2 reps, reference `base` = `app_formula:placement/default-weights.json`.

**Command** (from `simulator/`):

```text
cargo run --release -p unsettled-sim -- evaluate --layout standard4 --seats 4 --domain tuning --field pip_diversity --arm base=app_formula:placement/default-weights.json --arm diversity_48=app_formula:placement/arms/h1_diversity_48.json --arm diversity_64=app_formula:placement/arms/h1_diversity_64.json --reference base --boards 2000 --reps 2 --policy heuristic-v1-trader-aware-threat-devcards-denial --threads 0 --player-trading --out runs/m39-h1-diversity
```

**Decision rule (fixed before the run).** Same as M-38: a value is kept as an H4 combine candidate only on verdict `better`; anything else is recorded as an H prior and changes nothing shipped. If both extension arms come back `better`, the H4 candidate is the better point estimate; if neither does, the axis carries no winner despite the directional lean, per the screen rule.

**Prediction (recorded before the run).** If the response keeps rising, 4.8 lands with its interval above +1pp (`better`); if 3.2 was near the optimum, 4.8 lands `equivalent`-positive and 6.4 falls back toward zero or below.

**Threshold and alpha.** +-1pp, alpha 0.05, interval selection as in prior M entries.

**Admissibility.** `uptime` before and after; zero illegal actions; one invocation of 48,000 games, well under 5 minutes; no concurrent CPU-heavy jobs.
