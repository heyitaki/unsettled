# Unmodelled scoring surfaces

Class **G**: statements that the code does not do something, or does it wrong. Fixing the code makes the entry false — closing a gap means deleting its entry and saying so in the commit, not editing it into a contract. See [spec.md](spec.md) for the class rules and [programme.md](programme.md) for how to read this inventory.

Ids are stable and assigned in source order. A closed gap's id is retired, not reused.

## Denial and threat

**SIM-GAP-05.** The frozen knight path still passes a literal pressure of `1.0` into `contested_card_score`, so its contested-card value does not vary with opponent danger. Longest Road now does; the remaining knight limitation is coupled to `SIM-GAP-09`.

**SIM-GAP-06.** The frozen knight path still scales only through the observer's progress and never through the opponent's danger. Longest Road and dev buying now use denial pressure; the remaining knight limitation is coupled to `SIM-GAP-09`.

**SIM-GAP-09.** `knight_action_score`'s steal term is raw capped hand size, with no belief and no threat. G1 froze it deliberately so the robber A/B stayed placement-only; it is still frozen.

## Initial placement

**SIM-GAP-20.** The placement heuristics read `vertex_owner` for legality only — occupied, or adjacent to occupied. There is no draft-order awareness, no denial, and no model of what an opponent takes next, so the threat machinery G1 through G3 built is unavailable at setup. That is the placement tuning programme's subject rather than this one's, but it is worth stating plainly: setup is the one phase of the game the opponent model does not reach.

## Goal and action selection

**SIM-GAP-24.** `heuristic_v1.rs::dev_card_score` outranks expansion roads from turn one, at roughly 65 against 55 early and roughly 269 as Largest Army closes. Those figures predate `SIM-GAP-17`'s deck-aware rewrite and now describe an untouched deck only: the score scales with what the remaining deck can still contain, and a victory-point chase term raises it further as the observer closes on the win. Roads into settlements are the VP engine this simulator exists to measure, so this may bias results against expansion-oriented placements. Against that reading: the rankings hold under `priority-trader`, which has unrelated dev-card logic.

**SIM-GAP-25.** Goal selection has no plan persistence, hysteresis, sunk-tempo cost, or commitment state. `PolicyScratch.goal` is overwritten at each decision, so there is no durable plan for a threat-aware policy to abandon.

## Build valuation follow-up

**SIM-GAP-28.** `heuristic_v1.rs::vertex_score`'s expansion term is degree-valued for settlements: `DecisionView::legal_settlement` and `DecisionView::is_expansion_target` both require every neighbour to be unowned, so the count is always the vertex's topological degree. This is a crude expansion-room proxy rather than a measure of frontier actually opened. Phase J owns the replacement.

**SIM-GAP-29.** The build-kind comparison prices marginal production, scarcity, ports, diversity, frontier, and the one VP each building buys, but not piece economy or cost pressure. A city returns a settlement to supply and does not consume one of five settlement slots; it also spends ore and wheat that are otherwise often idle. Phase J's build-target scoring owns both omissions.

**SIM-GAP-30.** Building-band headroom below the contested-card band holds only under base rules and the shipped default `HeuristicParams`. `vertex_score` is linear in public, unbounded weights, so a swept vector can lift a building above that band and silently re-rank denial; `production_weight = 1000.0` on a raw-production-two vertex already reaches `12_000`. Phase H must either bound candidate weights or re-check headroom for every candidate vector.

## Performance

**SIM-GAP-21.** ~~Why the all-seat `-aware` configuration costs roughly 2x per seat is undiagnosed.~~ **Diagnosed; see M-18 in [measurements.md](measurements.md) for every number.** Most of the cost is not the new code. A sampling profile against a matched baseline attributes under a third of the slowdown to the whole ETW, threat and trading module group, and the rest to the existing engine — chiefly the Longest Road trail search, then `DecisionView`, then placement scoring — doing genuinely more work per game, because `-aware` seats play longer games and leave fuller boards, and the trail search grows superlinearly in roads on the board.

Three suspected causes were tested and are **refuted**, so do not re-test them: a redundant per-offer recompute of the delta-independent base ETW inside `trading.rs::counterparty_score` (the offer loop reaches the seat loop fewer times than it prepares seats, so the base is already computed about once per seat, which is also why the earlier hoist recovered nothing); `threat.rs::cheapest_route_shortfall`, which is called about two million times per four hundred games and accounts for roughly three percent of the added cost; and the O(vertex-count) `settlements_on_board` scan in `etw.rs::inputs_for_seat`, whose ablation changed nothing measurable. The ETW arithmetic itself is about 14ns per call, which cannot add up to the observed gap at the measured call volume.

What follows for the gate: the throughput target the G3 plan registered for the all-seat configuration is **not reachable by optimizing the new code**, because a bounded share of the slowdown lives there at all. The residual is the arm playing a different game, which is a property of the arm rather than a defect. Before Phase H, the decision owed is whether an all-seat throughput gate is measuring code efficiency or game length — see [programme.md](programme.md).
