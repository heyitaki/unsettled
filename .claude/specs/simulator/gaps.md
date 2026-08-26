# Unmodelled scoring surfaces

Class **G**: statements that the code does not do something, or does it wrong. Fixing the code makes the entry false — closing a gap means deleting its entry and saying so in the commit, not editing it into a contract. See [spec.md](spec.md) for the class rules and [programme.md](programme.md) for how to read this inventory.

Ids are stable and assigned in source order. A closed gap's id is retired, not reused.

## Initial placement

**SIM-GAP-20.** The placement heuristics read `vertex_owner` for legality only — occupied, or adjacent to occupied. There is no draft-order awareness, no denial, and no model of what an opponent takes next, so the threat machinery G1 through G3 built is unavailable at setup. That is the placement tuning programme's subject rather than this one's, but it is worth stating plainly: setup is the one phase of the game the opponent model does not reach.

## Performance

**SIM-GAP-21.** ~~Why the all-seat `-aware` configuration costs roughly 2x per seat is undiagnosed.~~ **Diagnosed; see M-18 in [measurements.md](measurements.md) for every number.** Most of the cost is not the new code. A sampling profile against a matched baseline attributes under a third of the slowdown to the whole ETW, threat and trading module group, and the rest to the existing engine — chiefly the Longest Road trail search, then `DecisionView`, then placement scoring — doing genuinely more work per game, because `-aware` seats play longer games and leave fuller boards, and the trail search grows superlinearly in roads on the board.

Three suspected causes were tested and are **refuted**, so do not re-test them: a redundant per-offer recompute of the delta-independent base ETW inside `trading.rs::counterparty_score` (the offer loop reaches the seat loop fewer times than it prepares seats, so the base is already computed about once per seat, which is also why the earlier hoist recovered nothing); `threat.rs::cheapest_route_shortfall`, which is called about two million times per four hundred games and accounts for roughly three percent of the added cost; and the O(vertex-count) `settlements_on_board` scan in `etw.rs::inputs_for_seat`, whose ablation changed nothing measurable. The ETW arithmetic itself is about 14ns per call, which cannot add up to the observed gap at the measured call volume.

What follows for the gate: the throughput target the G3 plan registered for the all-seat configuration is **not reachable by optimizing the new code**, because a bounded share of the slowdown lives there at all. The residual is the arm playing a different game, which is a property of the arm rather than a defect. The decision this diagnosis owed — whether an all-seat throughput gate measures code efficiency or game length — was settled at H: the per-decision fixed-state metric is the registered efficiency measure and there is no all-seat floor. See the throughput disposition in [programme.md](programme.md); this entry stays as the diagnosis record behind it.

## Action valuation

**SIM-GAP-33.** The SIM-GAP-08 block bonus in `denial.rs::contest_term` decides "blocked" from build legality alone: a rival counts as blocked when every edge incident to the contested vertex other than the candidate is illegal for them to build. An edge the rival already owns is not legal to build, so a rival whose road network already touches the vertex — who can settle there with zero new roads — can satisfy the predicate, and the candidate is credited `contestBlockBonus` for a block that denies nothing. The missing condition is that the rival owns no edge incident to the vertex. Found in post-completion review and deliberately not hot-fixed: M-26 measured this seam and the Phase-I candidate (M-44/M-45, denial gate on) was confirmed on `eval` with this exact semantics, so tightening the predicate must ride a preregistered `tuning` A/B with a fresh corpus. Until then, `contestBlockBonus` over-credits precisely on the edges where the rival is least blockable, bounded by `contestCap`.
