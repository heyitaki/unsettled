# Programme and phase order

Class **D**: decisions, their rationale, and what each revision replaced. Not falsifiable by code. See [spec.md](spec.md) for the class rules.

The simulator exists to measure which starting placements win, and ultimately to calibrate the app's own scorer (`src/engine/weights.ts`). The phase order below was revised after two findings, and the revision matters more than the list: **weight tuning now runs last.**

Why: a full-power sweep of the `resourceValue` spread found the optimum is policy-dependent and tracks trading volume — a light-trading policy and a heavy-trading one disagree about the best value, and neither answer is the answer. Every result measured so far was measured against a field of *self-regarding* policies, which model opponents almost not at all. Making the field threat-aware will invalidate those results the same way trading threatened to. Tuning weights against a field that is about to be replaced spends held-out seed domains on answers that will not survive.

**Phases E, F and G were reassigned in this revision.** They previously meant "re-tune across the trading grid", "structural formula terms" and "adopt"; those survive as H and I below. An older note referring to Phase E or F means the old plan.

## Phases

- **A — done.** The app formula as a playable arm, with a TS/Rust parity fixture.
- **B — done.** The paired `evaluate` harness.
- **C — retired.** Was the first tuning pass under no-trade. Superseded: tuning moved to the end, for the reason above.
- **D — built.** Player-to-player trading with the endgame embargo and farthest-from-winning counterparty selection.
- **E — built.** Opponent belief state. What it derives and guarantees is a contract; see [contracts.md](contracts.md).
- **F — built.** Expected turns to win, closed-form over the belief state. What it guarantees is a contract; see [contracts.md](contracts.md).
- **G — threat-aware decisions, measured one at a time.** Robber placement, belief-driven monopoly and dev-card timing, and threat-aware trading are built. What G3 unified, and the couplings the robber and dev-card arms carry, are contracts; see [contracts.md](contracts.md).
- **H — re-tune weights** across the resulting grid, including the structural formula terms that were the old Phase F. Fix the scoring defects in [gaps.md](gaps.md) first: sweeping a weight that multiplies a miscomputed term measures the defect, not the weight.
- **I — adopt** against the untouched `gate` domain.
- **J — build-target scoring.** Which settlement to upgrade, and where to put the next one, currently ignore what the current goal consumes, resource scarcity relative to that goal rather than to the board, and game stage. Also the card-play scope limits in [gaps.md](gaps.md). Not scheduled against a date; it is the largest block of genuinely new design left.
- **Knight timing — named but unscheduled.** Rejoining knight play timing with robber placement, deliberately deferred by G1 so its A/B stayed placement-only.

The rules-level `trade::embargoed` VP threshold is deliberately unchanged because it controls eligibility rather than ranking; moving it onto ETW belongs to G4 with goal switching and denial. `ThreatParams`, `DevCardParams`, and `TradeParams` weights are unswept Phase-H placeholders. The `TradeConfig` defaults are likewise placeholders for a later parameter sweep, not tuned values.

## Seed-domain discipline

`--domain` deliberately has no default so tuning work cannot accidentally use a held-out domain. The domain constants and their disjointness assertion are contracts; see [contracts.md](contracts.md).

Spend the domains in order and never go back. Screen and tune on `tuning` freely; use `eval` once a candidate is settled, to check the tuning result was not an artifact of its seeds; keep `gate` for the final adoption decision only. A domain cannot be un-spent — once a parameter has been screened against a domain, that domain's estimate for *that parameter* is no longer unbiased, though it stays clean for every other parameter. `eval` has already been spent on the `resourceValue` spread question.

Default heuristic parameters were tuned only on the named TUNING seed domain. The policy gates use the disjoint held-out EVAL seed domain and a fully crossed board × repetition × hero-seat schedule.

## How to read the gap inventory

[gaps.md](gaps.md) is an audit of the policy layer against the four consumers G built. Everything there is either absent or measurably wrong today; none of it is covered by G4, H or I unless stated. It is grouped by what kind of work it is, because the groups have different urgency: the defects corrupt measurements that H depends on, while the gaps merely leave value on the table.

## Design notes that outlive their phase

**Measure each consumer separately.** A single policy bundling belief, ETW, robber, monopoly and goal-switching that wins by several points teaches nothing about which part earned it and leaves none of it tunable. The paired `evaluate` harness gives clean per-consumer A/B; use it.

**Pin the opponent model to a fixed reference implementation.** If opponents' ETW is computed with the same value function being tuned, the model moves with the arm and every sweep measures two changes at once.

**A lexicographic tie-break ladder is the wrong shape for ranking opponents.** Each rung fires only on an exact tie of the rung above, so replacing a coarse integer criterion with a continuous one makes ties vanish and silently deletes every lower rung. Use a scalar score with weighted terms and sweep the weights. Relatedly, there is one opponent-threat function, not two: the acceptance rule's estimate of opponent gain and the counterparty-selection ranking are the same question over different arguments, and a parallel second model will drift out of agreement with the first.

**A card's discard cost is its conversion rate.** Holding a 2:1 wood port makes each wood worth about half a generic card against about a quarter for an unported resource, so the ported resource is the *last* thing to shed, not the first. Beware a naive `1 / rate` term, because the discrete marginal value oscillates: at a 2:1 rate, going from three wood to two loses only a dead spare, while going from two to one destroys a whole trade. Goal need still dominates conversion value when the two disagree, so this is a second term rather than a replacement.

**Build hand-size risk once as a shared exposure term** rather than patching each site, for the same reason the programme insists on one opponent-threat function: three independent spellings will drift.
