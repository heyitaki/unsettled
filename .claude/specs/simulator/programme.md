# Programme and phase order

Class **D**: decisions, their rationale, and what each revision replaced. Not falsifiable by code. See [spec.md](spec.md) for the class rules.

The simulator exists to measure which starting placements win, and ultimately to calibrate the app's own scorer (`src/engine/weights.ts`). The phase order below was revised after two findings, and the revision matters more than the list: **weight tuning now runs last.**

Why: a full-power sweep of the `resourceValue` spread found the optimum is policy-dependent and tracks trading volume — a light-trading policy and a heavy-trading one disagree about the best value, and neither answer is the answer. Every result measured so far was measured against a field of *self-regarding* policies, which model opponents almost not at all. Making the field threat-aware will invalidate those results the same way trading threatened to. Tuning weights against a field that is about to be replaced spends held-out seed domains on answers that will not survive.

**Phases E, F and G were reassigned in this revision.** They previously meant "re-tune across the trading grid", "structural formula terms" and "adopt"; those survive as H and I below. An older note referring to Phase E or F means the old plan.

## Why E through G exist at all

Every policy the simulator started with maximizes its own progress and models opponents almost not at all; the Phase-D trade embargo was close to the only exception. The four targets E through G pursue — robber placement, dev-card timing, trade selection, goal switching — are all actions whose entire value lives in their effect on somebody else's trajectory. So this is a change of **objective**, not a feature list: from "maximize my VP rate" to "maximize my win probability". The distinction has teeth, because denial pays only through win probability. Taking Longest Road to strip two VP costs tempo, and if it does not change who wins, it is a straight loss.

There is a second payoff beyond sharpening the measuring instrument. `crates/engine` is deliberately wasm-portable so the app can eventually give mid-game recommendations rather than placement-only ones. A self-regarding policy cannot give mid-game advice worth reading: "take Longest Road now or settle?" is exactly the question that needs an opponent model.

## Phases

- **A — done.** The app formula as a playable arm, with a TS/Rust parity fixture.
- **B — done.** The paired `evaluate` harness.
- **C — retired.** Was the first tuning pass under no-trade. Superseded: tuning moved to the end, for the reason above.
- **D — built.** Player-to-player trading with the endgame embargo and farthest-from-winning counterparty selection.
- **E — built.** Opponent belief state. What it derives and guarantees is a contract; see [contracts.md](contracts.md).
- **F — built.** Expected turns to win, closed-form over the belief state. What it guarantees is a contract; see [contracts.md](contracts.md).
- **G — built and measured, singly and as a composite.** G1 robber placement, G2 belief-driven monopoly and dev-card timing, G3 threat-aware trading, and G4 threat-aware action selection and denial are built. G4 delivers contested-card pressure, bounded Longest Road and Largest Army defence, shared-target road racing, and denial-aware Road Building and goal inputs. It deliberately does not deliver plan persistence, route-cut blocking, ETW trade eligibility, or changes to the hardcoded building-action bands. The couplings and gate boundaries are contracts; see [contracts.md](contracts.md).
- **H — re-tune weights** across the resulting grid, including the structural formula terms that were the old Phase F. This previously said to fix the scoring defects in [gaps.md](gaps.md) first; SIM-BATCH1 discharged the four named valuation defects. H now inherits `SIM-GAP-30`: bound candidate weights or re-check building-band headroom for each vector. Sweep with every G gate on, for the reason M-21 gives. H also settles the open `handValue` question below.
- **I — adopt** against the untouched `gate` domain.
- **J — build-target scoring.** Which settlement to upgrade, and where to put the next one, currently ignore what the current goal consumes, resource scarcity relative to that goal rather than to the board, and game stage. Also the card-play scope limits in [gaps.md](gaps.md). Not scheduled against a date; it is the largest block of genuinely new design left.
- **Knight timing — named but unscheduled.** Rejoining knight play timing with robber placement, deliberately deferred by G1 so its A/B stayed placement-only.

## Open question H must settle: does `handValue` survive ETW?

The placement formula's `handValue` term prices the second settlement's immediate setup grant as cards in hand. The belief state already tracks exact resource counts and ETW consumes them, so once a placement is evaluated through ETW the grant may already be counted there and the explicit term becomes a double count. Settle it by measurement — an A/B with the term's weight at zero against an ETW-aware field — and fold the answer into H rather than deciding it on argument now.

Two things keep this a real question rather than a formality. Dropping the term reverts a *rules*-correctness fix at the formula level, so the null result and the correct result look alike unless the A/B is set up to tell them apart. And `handValue` prices cards through `resourceValue` with no scarcity scaling, which is defensible for a one-off setup draw and wrong for a general hand — so ETW subsuming it may be the better model rather than merely a redundant one.

## Throughput disposition for G4, and the question H still owns

The G3 all-seat throughput floor mixed code efficiency with game length. `SIM-GAP-21` diagnosed the miss: the arm plays longer games that leave fuller boards, and the existing Longest Road search grows superlinearly in roads placed.

G4 therefore registers no all-seat games-per-second floor. M-20 observes a fixed number of policy decisions on the same state, gate off against gate on, and reports rather than gates the cost. It separately counts Longest Road network construction per decision so a hotter trail-search path is visible without confusing it with changed game length.

That answers the gate question for G4 only. H still has to decide whether the full tuning grid needs a per-decision efficiency floor, an all-seat affordability floor, both, or neither. What is no longer defensible is treating a per-game miss as an unqualified code-efficiency defect.

## How to read the A/B results so far — settled by the composite arm

Each of the four built G consumers was measured alone against a field of today's policies, and every one came back `inconclusive` with a positive point estimate declining in merge order: M-01, M-02, M-03 and M-19 in [measurements.md](measurements.md). That was consistent with "each consumer is individually under-powered" and equally consistent with "this is not paying against this field", and nothing measured then separated them.

This section previously carried the resulting directive — run a composite arm before H, and re-baseline against a threat-aware field if it too came back inconclusive. That experiment has been run, so what follows records its outcome and the precondition is discharged.

**M-21 separated them, and the programme is paying.** With all four gates on against the field G3 was measured against, the composite arm's verdict is `better` at the preregistered threshold — the first non-`inconclusive` result the programme has produced — and the gates compound *super-additively*, three of the four being worth markedly more inside the composite than alone. So four inconclusive singles were a power result about how the consumers were measured, not a value result about whether they work. **H may proceed against this field**; re-baselining against a threat-aware field is no longer indicated, and neither held-out domain was spent settling it.

Three consequences bind what comes next.

**Measure the composite, not the singles, from here.** The design note below still holds for *attribution* — a bundle that wins teaches nothing about which part earned it — but a per-consumer A/B against a field with every other gate off now systematically understates a consumer, because the interaction is where most of the value is. Paired increment runs against a full-composite reference give both: attribution and the value at the corner that will actually ship.

**Denial was the exception, and its read has changed.** This paragraph previously recorded M-21's three `equivalent` reads as positive evidence that denial's effect was below the practical threshold, bounded by the defective goal chooser then named `SIM-GAP-02`. SIM-BATCH1 fixed that chooser and re-ran both M-21 fields. Denial is now `inconclusive` on each moved field: that does not establish value, but the former read-down is no longer justified. Treat the re-measurement in M-22 as the current result and carry denial into H rather than excluding it as settled.

**The interaction is trading.** On the plain field the three gates that field admits are close to additive; the super-additivity appears only once player trading exists. Whatever H sweeps, it must sweep with the trade gate on, or it will be tuning at a corner the value does not live in.

The rules-level `trade::embargoed` VP threshold remains deliberately unchanged because it controls eligibility rather than ranking and moving it would change every trader arm outside the G4 gate; `SIM-GAP-27` records the remaining work. `ThreatParams`, `DevCardParams`, `TradeParams`, and `DenialParams` weights are unswept Phase-H placeholders. The `TradeConfig` defaults are likewise placeholders for a later parameter sweep, not tuned values.

## Seed-domain discipline

`--domain` deliberately has no default so tuning work cannot accidentally use a held-out domain. The domain constants and their disjointness assertion are contracts; see [contracts.md](contracts.md).

Spend the domains in order and never go back. Screen and tune on `tuning` freely; use `eval` once a candidate is settled, to check the tuning result was not an artifact of its seeds; keep `gate` for the final adoption decision only. A domain cannot be un-spent — once a parameter has been screened against a domain, that domain's estimate for *that parameter* is no longer unbiased, though it stays clean for every other parameter. `eval` has already been spent on the `resourceValue` spread question.

The already-collected `spread_*` and `gpf_*` arm results are **superseded and need re-running**, independently of the reordering above. `evaluate` scores arms against the field `simulator/placement/default-weights.json`, and the OBJ-8 fix added `handValue` to it, so every recorded arm-versus-field number was taken against a field that no longer exists. No option preserved comparability; the alternative is worse for the reason given under Weights files in [contracts.md](contracts.md). This is part of what already spent `eval` on the spread question.

Default heuristic parameters were tuned only on the named TUNING seed domain. The policy gates use the disjoint held-out EVAL seed domain and a fully crossed board × repetition × hero-seat schedule.

## How to read the gap inventory

[gaps.md](gaps.md) is an audit of the policy layer after the four G consumers. G4 closed `SIM-GAP-13`, narrowed the contested-card, defence, and racing entries to what remains, and added the plan-persistence, discard-fallback, and embargo-threshold gaps found while threading the gate. The inventory is grouped by what kind of work it is, because defects corrupt measurements that H depends on while gaps merely leave value on the table.

## Design notes that outlive their phase

**Measure each consumer separately.** A single policy bundling belief, ETW, robber, monopoly and goal-switching that wins by several points teaches nothing about which part earned it and leaves none of it tunable. The paired `evaluate` harness gives clean per-consumer A/B; use it.

**Pin the opponent model to a fixed reference implementation.** If opponents' ETW is computed with the same value function being tuned, the model moves with the arm and every sweep measures two changes at once.

**A lexicographic tie-break ladder is the wrong shape for ranking opponents.** Each rung fires only on an exact tie of the rung above, so replacing a coarse integer criterion with a continuous one makes ties vanish and silently deletes every lower rung. Use a scalar score with weighted terms and sweep the weights. SIM-BATCH1 applied this note to the main action scorer, replacing its city-over-settlement ladder with one building band ordered by marginal value. Relatedly, there is one opponent-threat function, not two: the acceptance rule's estimate of opponent gain and the counterparty-selection ranking are the same question over different arguments, and a parallel second model will drift out of agreement with the first.

**A card's discard cost is its conversion rate.** Holding a 2:1 wood port makes each wood worth about half a generic card against about a quarter for an unported resource, so the ported resource is the *last* thing to shed, not the first. Beware a naive `1 / rate` term, because the discrete marginal value oscillates: at a 2:1 rate, going from three wood to two loses only a dead spare, while going from two to one destroys a whole trade. Goal need still dominates conversion value when the two disagree, so this is a second term rather than a replacement. Built in `policy::exposure` (M-25) with one measured narrowing: the discrete bundle protection applies only at rates strictly better than the observer's base rate, because protecting bank-rate four-stacks sacrificed hand diversity for a marginal trade and dropped heuristic-v1 below the predeclared `policy_strength` gate against priority-trader.

**Build hand-size risk once as a shared exposure term** rather than patching each site, for the same reason the programme insists on one opponent-threat function: three independent spellings will drift. Built as `policy::exposure` (M-25): the discard's conversion ranking, the pre-emptive shedding trade, and the pre-roll seven charge on card-adding dev plays all read it; `LegacyValuation::exposure_blind` restores the exposure-blind pipeline as the `-legacyexposure` measurement reference.
