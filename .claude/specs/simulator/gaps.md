# Unmodelled scoring surfaces

Class **G**: statements that the code does not do something, or does it wrong. Fixing the code makes the entry false — closing a gap means deleting its entry and saying so in the commit, not editing it into a contract. See [spec.md](spec.md) for the class rules and [programme.md](programme.md) for how to read this inventory.

Ids are stable and assigned in source order. A closed gap's id is retired, not reused.

## Denial and threat

**SIM-GAP-05.** The frozen knight path still passes a literal pressure of `1.0` into `contested_card_score`, so its contested-card value does not vary with opponent danger. Longest Road now does; the remaining knight limitation is coupled to `SIM-GAP-09`.

**SIM-GAP-06.** The frozen knight path still scales only through the observer's progress and never through the opponent's danger. Longest Road and dev buying now use denial pressure; the remaining knight limitation is coupled to `SIM-GAP-09`.

**SIM-GAP-07.** Longest Road defence has a bounded-check blind spot. `denial.rs::MAX_RACE_CHECKS` limits exact checks to the first two dangerous prefilter survivors, so in a six-seat game a third rival can be one road from taking the card without being noticed.

**SIM-GAP-08.** Shared-target racing is priced, but blocking is not. The denial contest term is keyed on a vertex an opponent can reach after one legal road; it values claiming that site first without determining whether the observer's candidate edge cuts the rival's actual approach.

**SIM-GAP-09.** `knight_action_score`'s steal term is raw capped hand size, with no belief and no threat. G1 froze it deliberately so the robber A/B stayed placement-only; it is still frozen.

## Card-play scope — the scorer cannot consider an offer the construction never makes.

**SIM-GAP-10.** Year of Plenty is offered only when the hand is exactly two cards short of a goal cost. Never for tempo, never to bank a scarce resource, never one-short-plus-spare. G2 gave the card a proper scalar, but the gate is upstream in `plenty_for_goal`.

**SIM-GAP-11.** Year of Plenty's two resources are picked in index order among those missing.

**SIM-GAP-12.** `monopoly_for_goal` considers only the first cost variant of the goal.

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

**SIM-GAP-22.** `game.rs::eligible_victim` requires `hand_size() > 0`, so an adjacent empty-handed opponent cannot be named — which is how the rules let a player decline a steal. Found by the 2026-07-25 rules audit. That audit's claim that no reviewer could make it change a recorded output is wrong: measured 2026-08-10 at `35a1738e`, the prescribed fix fails all three corpus-identity tests and moves 20 of the 48 corpus games (board 0 seed 2's winner shifts from seat 2 to seat 0 and its turn count from 131 to 113). Closing this gap therefore costs corpus regeneration and the programme's A/B path, not a free fix. `view.rs::stealable_on_hex` must move in lockstep with any fix, or legal decisions start being counted as illegal actions.

**SIM-GAP-23.** `setup()` never calls `recompute_all_roads` on the generated-placement path, so every seat's `longest_road_len` reads `0` until somebody's first road build refreshes all seats, and policies consult opponents' lengths over that window. Confirmed harmless for awards — setup leaves two disconnected stubs, so the true longest is 1 against a minimum of 5 and no card or VP can differ — but it is why `build_road` still recomputes every seat rather than just the builder, which is otherwise sound, since a road cannot shorten anyone else's trail. Fixing it shifts results, so it is deliberately not bundled with a performance change.

**SIM-GAP-24.** `heuristic_v1.rs::dev_card_score` outranks expansion roads from turn one, at roughly 65 against 55 early and roughly 269 as Largest Army closes. Roads into settlements are the VP engine this simulator exists to measure, so this may bias results against expansion-oriented placements. Against that reading: the rankings hold under `priority-trader`, which has unrelated dev-card logic.

**SIM-GAP-25.** Goal selection has no plan persistence, hysteresis, sunk-tempo cost, or commitment state. `PolicyScratch.goal` is overwritten at each decision, so there is no durable plan for a threat-aware policy to abandon.

**SIM-GAP-26.** `heuristic_v1.rs::discard` falls back to `HeuristicParams::default()` when `PolicyScratch.goal` is absent. That silently drops every policy gate, including denial, on the fallback path.

**SIM-GAP-27.** `trade.rs::embargoed` still uses a VP-estimate threshold rather than the shared ETW danger model. It controls trade eligibility rather than ranking and remains deliberately ungated.

## Build valuation follow-up

**SIM-GAP-28.** `heuristic_v1.rs::vertex_score`'s expansion term is degree-valued for settlements: `DecisionView::legal_settlement` and `DecisionView::is_expansion_target` both require every neighbour to be unowned, so the count is always the vertex's topological degree. This is a crude expansion-room proxy rather than a measure of frontier actually opened. Phase J owns the replacement.

**SIM-GAP-29.** The build-kind comparison prices marginal production, scarcity, ports, diversity, frontier, and the one VP each building buys, but not piece economy or cost pressure. A city returns a settlement to supply and does not consume one of five settlement slots; it also spends ore and wheat that are otherwise often idle. Phase J's build-target scoring owns both omissions.

**SIM-GAP-30.** Building-band headroom below the contested-card band holds only under base rules and the shipped default `HeuristicParams`. `vertex_score` is linear in public, unbounded weights, so a swept vector can lift a building above that band and silently re-rank denial; `production_weight = 1000.0` on a raw-production-two vertex already reaches `12_000`. Phase H must either bound candidate weights or re-check headroom for every candidate vector.

**SIM-GAP-31.** `player_trading.rs` historically built trading scenarios by replaying a fixed number of turns under the default policy. Changing default policy valuation silently changed the state those fixtures reached, so trading assertions failed through unrelated preconditions or lost legal offers. The tests now establish their trading state explicitly, but other policy-replay fixtures can carry the same coupling. Fixture construction should make the state under test explicit or loudly assert every replay-derived precondition before the subject assertion.

**SIM-GAP-32.** `heuristic_v1.rs::best_road_building_pair` credits expansion from `edge_endpoints(second)` without gating on `DecisionView::is_expansion_target`, so it prices vertices nobody can settle — including ones permanently blocked by the distance rule — and it folds only the second edge's endpoints, never the first's. Its sibling `expansion_road_score` applies both gates. SIM-BATCH1 threaded `BuildKind` through this expression without repairing it, deliberately: adding the filter is a behaviour change that moves the corpus, breaks seven replay-derived `player_trading.rs` fixtures, and would bundle an unmeasured sixth change into M-22's five-row attribution. A verified reproduction exists — filter on `is_expansion_target`, then fold through `Option` with `unwrap_or(0.0)`, the last part required so a pair laid purely for Longest Road is not poisoned to `NEG_INFINITY`. Whoever fixes it owns re-running M-22 and regenerating the gate baselines.

## Performance

**SIM-GAP-21.** ~~Why the all-seat `-aware` configuration costs roughly 2x per seat is undiagnosed.~~ **Diagnosed; see M-18 in [measurements.md](measurements.md) for every number.** Most of the cost is not the new code. A sampling profile against a matched baseline attributes under a third of the slowdown to the whole ETW, threat and trading module group, and the rest to the existing engine — chiefly the Longest Road trail search, then `DecisionView`, then placement scoring — doing genuinely more work per game, because `-aware` seats play longer games and leave fuller boards, and the trail search grows superlinearly in roads on the board.

Three suspected causes were tested and are **refuted**, so do not re-test them: a redundant per-offer recompute of the delta-independent base ETW inside `trading.rs::counterparty_score` (the offer loop reaches the seat loop fewer times than it prepares seats, so the base is already computed about once per seat, which is also why the earlier hoist recovered nothing); `threat.rs::cheapest_route_shortfall`, which is called about two million times per four hundred games and accounts for roughly three percent of the added cost; and the O(vertex-count) `settlements_on_board` scan in `etw.rs::inputs_for_seat`, whose ablation changed nothing measurable. The ETW arithmetic itself is about 14ns per call, which cannot add up to the observed gap at the measured call volume.

What follows for the gate: the throughput target the G3 plan registered for the all-seat configuration is **not reachable by optimizing the new code**, because a bounded share of the slowdown lives there at all. The residual is the arm playing a different game, which is a property of the arm rather than a defect. Before Phase H, the decision owed is whether an all-seat throughput gate is measuring code efficiency or game length — see [programme.md](programme.md).
