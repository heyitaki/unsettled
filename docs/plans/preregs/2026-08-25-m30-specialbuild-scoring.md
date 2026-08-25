# M-30 preregistration — does distinct SpecialBuild scoring change outcomes? (SIM-GAP-19)

Date: 2026-08-25. Committed before the run.

**Question under test.** `DecisionPhase::SpecialBuild` reaches `ask_action` with no distinct scoring: the ordinary action scorer runs under the phase's narrower legality (no trades, no dev plays), so the effective special-build choice set is builds, the dev buy, and pass, all priced exactly as on the seat's own turn. SIM-GAP-19 asks whether that uniform treatment is correct. This is a measurement-first task: distinct scoring is implemented only if the measurement shows a gap.

**Trial arms.** Two measurement-only composite labels, both inert at default (`HeuristicParams::special_build = Uniform` ships unchanged; the standing corpus is expected byte-identical and is verified by recapture before the run):

- `sbmute` (`...-sbmute`): passes every SpecialBuild decision. The surface ablation: it bounds how much outcome weight any special-build rescoring could carry, because scoring can only modulate between acting and not acting there (location choice is phase-invariant, and the band structure fixes the action-class order).
- `sbhold` (`...-sbhold`): refuses any SpecialBuild spend that moves the current goal further away (a candidate survives only if some payable cost variant leaves the goal's closest-variant shortfall unchanged). The most plausible direction for distinct scoring: today's greedy spelling will burn goal resources on a lesser build or a dev buy out of turn.

**Design.** The plan's Task 12 protocol on the layout where the phase exists: `evaluate`, extension6, `--domain tuning`, field `pip_diversity` placement, field policy `heuristic-v1-trader`, player trading on, 400 boards x 10 reps, threads 0, reference = the current composite (`base`). Two invocations, 6 seats and 5 seats, since the phase fires at both counts.

**Commands.**

```text
cargo run --release -p unsettled-sim -- evaluate --layout extension6 --seats 6 --domain tuning --field pip_diversity --arm base=pip_diversity --arm sbmute=pip_diversity --arm sbhold=pip_diversity --arm-policy base=heuristic-v1-trader-aware-threat-devcards-denial --arm-policy sbmute=heuristic-v1-trader-aware-threat-devcards-denial-sbmute --arm-policy sbhold=heuristic-v1-trader-aware-threat-devcards-denial-sbhold --reference base --boards 400 --reps 10 --policy heuristic-v1-trader --threads 0 --player-trading --out runs/m30-specialbuild-6
cargo run --release -p unsettled-sim -- evaluate --layout extension6 --seats 5 --domain tuning --field pip_diversity --arm base=pip_diversity --arm sbmute=pip_diversity --arm sbhold=pip_diversity --arm-policy base=heuristic-v1-trader-aware-threat-devcards-denial --arm-policy sbmute=heuristic-v1-trader-aware-threat-devcards-denial-sbmute --arm-policy sbhold=heuristic-v1-trader-aware-threat-devcards-denial-sbhold --reference base --boards 400 --reps 10 --policy heuristic-v1-trader --threads 0 --player-trading --out runs/m30-specialbuild-5
```

**Decision rule (fixed before the run).** Distinct SpecialBuild scoring is implemented only if a trial arm's verdict is `better` (selected interval strictly above +1pp) at either seat count; that triggers Task 12's implement branch with its own follow-up A/B and corpus recapture. Any other combination of verdicts keeps the uniform treatment: `worse` or `equivalent` on `sbmute` reads as the surface being respectively live-but-greedy-right or outcome-light, `worse`/`equivalent`/`inconclusive` on `sbhold` reads as the refinement not paying, and in all such cases the reading is recorded and SIM-GAP-19 is deleted with the evidence. The trial labels stay in the roster as measurement variants either way.

**Threshold and alpha.** +-1pp practical threshold, interval selection as in prior M entries (McNemar vs clustered, whichever the harness selects).

**Admissibility.** `uptime` load recorded before and after; zero illegal actions required; each invocation (24,000 games; a 720-game probe ran in under a second) expected well under 5 minutes.
