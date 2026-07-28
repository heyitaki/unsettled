# Unmodelled scoring surfaces

Class **G**: statements that the code does not do something, or does it wrong. Fixing the code makes the entry false — closing a gap means deleting its entry and saying so in the commit, not editing it into a contract. See [spec.md](spec.md) for the class rules and [programme.md](programme.md) for how to read this inventory.

Ids are stable and assigned in source order. A closed gap's id is retired, not reused.

## Defects — wrong, not merely absent. Fix before H.

**SIM-GAP-01.** `vertex_score`'s `port_synergy` weights a port only against production at that same vertex's three hexes, so it ignores the resource you produce everywhere else on the board. It undervalues a port sited away from your engine and overvalues one sited on top of it. `port_weight` is on H's sweep list and the sweep is not meaningful until this is fixed.

> Naming note: `port_weight` is ambiguous between `heuristic_v1.rs::HeuristicParams::port_weight` (default `0.1`) and `app_formula.rs::EngineWeights::port_weight` (`0.55`). The source claim does not say which it means; this entry records the ambiguity rather than resolving it.

**SIM-GAP-02.** Two spellings of "best settlement" disagree. The action scorer ranks on the full `vertex_score`; the goal chooser calls `view.best_legal_settlement()`, which ranks on `vertex_pips` alone — no scarcity, diversity, port or expansion. Same divergence class as the `vp_estimate` spellings G3 unified.

**SIM-GAP-03.** Two of `vertex_score`'s five terms are dead on a city upgrade. `diversity` counts resources where the observer produces none, but you already produce that vertex's resources; `expansion` counts unowned neighbours, which an upgrade does not use. City ranking silently reduces to pips, scarcity and port synergy.

**SIM-GAP-04.** City-over-settlement is a hard constant ladder (`10_000.0` against `500.0`), so an affordable city outranks every settlement regardless of relative value. This is the lexicographic-ladder anti-pattern the programme rejects for opponent ranking, still present in the main action scorer.

## Denial and threat — G4-shaped. `threat.rs::danger_from_etw` exists and none of these consult it.

**SIM-GAP-05.** `contested_card_score`'s denial term is a flat constant, so taking Longest Road from a seat at nine VP scores identically to taking it from a seat at four.

**SIM-GAP-06.** `win_proximity` is own VP over win VP. Every contested-card term scales by *your* progress and never by the opponent's, which is backwards for a denial play.

**SIM-GAP-07.** No defensive extension of a card you already hold: `longest_road_value` returns nothing once you are the holder, and `dev_card_score` returns a flat score once you hold Largest Army. Neither notices an opponent closing in.

**SIM-GAP-08.** No blocking and no racing, anywhere. `best_road_building_pair` scores your own vertices plus a longest-road bonus; nothing values cutting an opponent's only route or claiming a contested vertex before they do. The Phase-D note that positional competition belongs as a multiplier on threat rather than its own criterion was never built.

**SIM-GAP-09.** `knight_action_score`'s steal term is raw capped hand size, with no belief and no threat. G1 froze it deliberately so the robber A/B stayed placement-only; it is still frozen.

## Card-play scope — the scorer cannot consider an offer the construction never makes.

**SIM-GAP-10.** Year of Plenty is offered only when the hand is exactly two cards short of a goal cost. Never for tempo, never to bank a scarce resource, never one-short-plus-spare. G2 gave the card a proper scalar, but the gate is upstream in `plenty_for_goal`.

**SIM-GAP-11.** Year of Plenty's two resources are picked in index order among those missing.

**SIM-GAP-12.** `monopoly_for_goal` considers only the first cost variant of the goal.

**SIM-GAP-13.** Road Building targeting carries no denial term at all, so it cannot be aimed at an opponent.

**SIM-GAP-14.** Hand-size risk is unmodelled and documented as a non-goal: pre-roll play resolves before the dice and a seven's discard, so a discard-aware model would defer Monopoly more often than this one does.

## Untouched decision surfaces — no scoring work has been done on these at all.

**SIM-GAP-15.** Discard at seven is greedy against the current goal cost only. No scarcity, no belief about an opponent's pending monopoly, no preservation of hand shape, and — most concretely — no port awareness. The design note on what a discard actually costs is in [programme.md](programme.md).

**SIM-GAP-16.** Bank and port trades fire only when the trade completes a cost or strictly reduces missing units. Never speculative, never rate-aware beyond legality, and never used to shed hand size ahead of a seven. That last one is a real play and it prices out: a 2:1 trade to go from eight cards to seven costs one card with certainty, against an expected loss of roughly two cards from the sevens other seats roll before your next turn.

**SIM-GAP-17.** Dev-card buying scales a contest bonus by own win proximity. Deck composition is consulted only for whether the deck is non-empty, so the policy will happily buy into a deck that can no longer contain anything it wants. Both directions matter: with three VP cards live in a five-card deck at eight VP, buying is the strongest action on the board, and with none live and Largest Army already held, it is close to worthless. That the remaining composition is derivable is a contract; see [contracts.md](contracts.md).

**SIM-GAP-18.** Hand-size risk is one concept with at least three consumers, and none of them have it. The discard choice above, the pre-emptive shedding trade above, and the pre-roll dev-card timing that `devcards.rs` already documents as a non-goal are the same question — what a seven costs this hand — asked at three sites.

**SIM-GAP-19.** `DecisionPhase::SpecialBuild` reaches `ask_action` with no distinct scoring and is treated as an ordinary action phase. Whether that is correct is unmeasured.

## Initial placement

**SIM-GAP-20.** The placement heuristics read `vertex_owner` for legality only — occupied, or adjacent to occupied. There is no draft-order awareness, no denial, and no model of what an opponent takes next, so the threat machinery G1 through G3 built is unavailable at setup. That is the placement tuning programme's subject rather than this one's, but it is worth stating plainly: setup is the one phase of the game the opponent model does not reach.

## Rules deviations and stale derived state

**SIM-GAP-22.** `game.rs::eligible_victim` requires `hand_size() > 0`, so an adjacent empty-handed opponent cannot be named — which is how the rules let a player decline a steal. Found by the 2026-07-25 rules audit and left open because neither reviewer could make it change a recorded output. `view.rs::stealable_on_hex` must move in lockstep with any fix, or legal decisions start being counted as illegal actions.

**SIM-GAP-23.** `setup()` never calls `recompute_all_roads` on the generated-placement path, so every seat's `longest_road_len` reads `0` until somebody's first road build refreshes all seats, and policies consult opponents' lengths over that window. Confirmed harmless for awards — setup leaves two disconnected stubs, so the true longest is 1 against a minimum of 5 and no card or VP can differ — but it is why `build_road` still recomputes every seat rather than just the builder, which is otherwise sound, since a road cannot shorten anyone else's trail. Fixing it shifts results, so it is deliberately not bundled with a performance change.

**SIM-GAP-24.** `heuristic_v1.rs::dev_card_score` outranks expansion roads from turn one, at roughly 65 against 55 early and roughly 269 as Largest Army closes. Roads into settlements are the VP engine this simulator exists to measure, so this may bias results against expansion-oriented placements. Against that reading: the rankings hold under `priority-trader`, which has unrelated dev-card logic.

## Performance

**SIM-GAP-21.** ~~Why the all-seat `-aware` configuration costs roughly 2x per seat is undiagnosed.~~ **Diagnosed; see M-18 in [measurements.md](measurements.md) for every number.** Most of the cost is not the new code. A sampling profile against a matched baseline attributes under a third of the slowdown to the whole ETW, threat and trading module group, and the rest to the existing engine — chiefly the Longest Road trail search, then `DecisionView`, then placement scoring — doing genuinely more work per game, because `-aware` seats play longer games and leave fuller boards, and the trail search grows superlinearly in roads on the board.

Three suspected causes were tested and are **refuted**, so do not re-test them: a redundant per-offer recompute of the delta-independent base ETW inside `trading.rs::counterparty_score` (the offer loop reaches the seat loop fewer times than it prepares seats, so the base is already computed about once per seat, which is also why the earlier hoist recovered nothing); `threat.rs::cheapest_route_shortfall`, which is called about two million times per four hundred games and accounts for roughly three percent of the added cost; and the O(vertex-count) `settlements_on_board` scan in `etw.rs::inputs_for_seat`, whose ablation changed nothing measurable. The ETW arithmetic itself is about 14ns per call, which cannot add up to the observed gap at the measured call volume.

What follows for the gate: the throughput target the G3 plan registered for the all-seat configuration is **not reachable by optimizing the new code**, because a bounded share of the slowdown lives there at all. The residual is the arm playing a different game, which is a property of the arm rather than a defect. Before Phase H, the decision owed is whether an all-seat throughput gate is measuring code efficiency or game length — see [programme.md](programme.md).
