# M-37 preregistration — Phase J composite at lo trial values

Date: 2026-08-25. Committed before the run.

**Change under test.** The Phase J composite: all five J terms applied together against the all-zero shipped default, per the programme's increment rule (each term measured alone in M-32 through M-36, then one composite). Two measurement-only labels carry it, both built on the full composite `heuristic-v1-trader-aware-threat-devcards-denial`:

- `-jall`: every J term at its lo trial value — `goal_need_weight` 0.5 (M-32), the stage triple 0.5/0.5/0.5 (M-33), `slot_return_weight` 2.0 with `cost_pressure_weight` 0.5 (M-34), `goal_hysteresis_margin` 0.25 (M-35), `frontier_mix` 0.5 (M-36). The literal reading of the plan's "all J terms at trial values".
- `-jnohyst`: the same vector with the hysteresis margin held at its shipped zero. M-35 measured both trial margins decisively `worse` (monotone, -2.34pp at 0.25), so the margin ships at zero; this arm is the composite of the terms that could actually carry a nonzero value into Phase H, and it separates "the J interaction" from "the known hysteresis penalty".

The lo values are used because each was measured individually at exactly these points (making composite-versus-sum-of-singles attribution direct), and because the hi values of hysteresis, piece economy, and frontier each measured negative or negative-leaning alone — a hi composite would answer nothing H2 can use.

**Prediction (recorded before the run).** The individual lo readings sum to roughly -0.4pp excluding hysteresis (M-32 0.0, M-33 -0.075pp, M-34 +0.04pp, M-36 -0.075pp) and roughly -2.7pp including it. If the terms are near-additive, `-jnohyst` lands `equivalent` near zero and `-jall` lands `worse` near -2.4pp. A `-jnohyst` result materially better than the sum would be the first evidence of a positive J interaction; materially worse, of a negative one.

**Design.** Standard paired A/B per the plan's measurement protocol: `evaluate`, standard4, 4 seats, `--domain tuning`, field `pip_diversity` placement, field policy `heuristic-v1-trader`, player trading on, 400 boards x 10 reps, threads 0. Reference = the full composite with every J term at zero; test arms = `-jall` and `-jnohyst`.

**Command.**

```text
cargo run --release -p unsettled-sim -- evaluate --layout standard4 --seats 4 --domain tuning --field pip_diversity --arm base=pip_diversity --arm jall=pip_diversity --arm jnohyst=pip_diversity --arm-policy base=heuristic-v1-trader-aware-threat-devcards-denial --arm-policy jall=heuristic-v1-trader-aware-threat-devcards-denial-jall --arm-policy jnohyst=heuristic-v1-trader-aware-threat-devcards-denial-jnohyst --reference base --boards 400 --reps 10 --policy heuristic-v1-trader --threads 0 --player-trading --out runs/m37-jcomposite
```

**Decision rule (fixed before the run).** This is a screen of zero-default seams, not a gap fix: every J weight ships at zero whatever the verdicts, and no arm can change shipped behavior. The readings are recorded as H2 priors — in particular whether the lo-composite response differs from the sum of the lo singles, which tells H2 whether it may sweep the J axes independently or must treat them jointly. No adoption in either direction (Phase I is the user's). Phase J is recorded as built and measured in `programme.md` regardless of verdict.

**Threshold and alpha.** +-1pp practical threshold, interval selection as in prior M entries (McNemar vs clustered, whichever the harness selects).

**Admissibility.** `uptime` load recorded before and after; zero illegal actions required; single invocation (48,000 games across three paired arms) expected well under 5 minutes.
