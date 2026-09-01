# Contracts

Class **C**: things that must be true of the code. A violation is a bug. See [spec.md](spec.md) for the class rules and the ownership rule.

## Scope

`unsettled-sim` is a seeded Rust simulator for complete base-Catan games. It supports the 19-hex `standard4` and 30-hex `extension6` layouts, app-exported Board JSON, generated legal boards, and weights-file-parameterized app-formula arms.

The authoritative rosters of placement heuristics and policies are below, under [Rosters](#rosters).

## Crate boundaries

The engine crate has no threading, CLI, or filesystem dependency. The CLI owns board generation, rayon scheduling, aggregation, and output.

## Module roster

Within the engine:

| Module | Role |
| --- | --- |
| `belief.rs` | Maintains a public-information opponent belief with exact hand totals and per-resource `[lo, hi]` intervals, updated only from public events in `game.rs`. `invariants_hold` includes a gated soundness clause, while the random-game fuzz test checks the same property ungated. |
| `etw.rs` | The pinned closed-form expected-turns-to-win reference implementation, with its fixed constants at the top of the module. Those constants are never swept. |
| `threat.rs` | The first consumer of both modules. Consumes the pinned ETW directly rather than adding a second ETW. |
| `devcards.rs` | The second consumer. Values dev-card plays in the observer's own ETW terms. |
| `trading.rs` | The third consumer. Supplies the shared opponent-value model for trade proposal, acceptance, and counterparty selection. |
| `denial.rs` | The fourth consumer. Prices contested cards, award defence, and legality-aware shared-target racing through the shared ETW danger function. |
| `exposure.rs` | The single model of what the next seven costs this hand. The forced discard, the pre-emptive shedding trade, and the pre-roll dev-card timing all read it; no consumer carries its own spelling. |

## Schedule and evaluation units

The schedule is `boards × reps × heuristic-count rotations`. Rotation `j` assigns seat `s` to heuristic `(s + j) mod k`, so every heuristic visits every seat even when the number of heuristics differs from the seat count.

An evaluation unit is one `(board, rep, hero seat)` triple. The schedule fully crosses every generated board, repetition, and seat, then plays every labelled arm on every unit while every non-hero seat uses `--field`.

Arm values split on the first `=`, so labels form their own namespace and a spec path may contain `=`. Labels must be unique, while specs may repeat. `--arm-policy label=policy` overrides the hero seat's policy for that arm only; the field keeps `--policy`, and each override label must name a declared arm. Game seeds are arm-independent, so policy-overridden paired arms retain common random numbers.

`--reference` is required for two or more arms and optional for a single-arm marginal run.

**Never run a `tournament` with more arms than seats.** Because rotation `j` gives seat `s` heuristic `(s + j) mod k`, a run with `k` greater than the seat count puts only a *window* of arms in each game: index-adjacent arms co-play far more than distant ones, every arm faces a different opponent mix, and the win rates become an artifact of command-line order. Permuting the order of a six-arm, four-seat run moved win rates by ±1.35pp and swung one arm's head-to-head share from 56% to 44%. Keep arms at or below the seat count so every game holds the full field, and fill a spare slot with a duplicate of the baseline under a second file stem, which both calibrates the noise floor and should land at 50.0% ±0.1pp. Note that at arms equal to seats, each head-to-head cell degenerates into the row arm's total wins, so `headToHead` is a renormalization of the win counts rather than independent evidence.

For comparing arms, prefer `evaluate` over `tournament` outright: it fixes the field, rotates a single hero seat, and pairs on common random numbers, so none of the above applies. `tournament` is the right tool only for ranking a whole field at once.

## Argument domains and the seat envelope

Board and repetition counts must be positive. The threshold must be non-negative and alpha must be strictly between zero and one.

Official simulation-ready combinations are three or four seats on `standard4` and five or six seats on `extension6`. `--allow-unofficial` permits two through six seats on either layout.

## Seed domains and seed derivation

The three seed domains are the committed tuning (`0x7a11_1e5e_ed20_2607`), held-out evaluation (`0xe7a1_5eed_2026_0724`), and adoption-gate (`0x6a7e_5eed_2026_0725`) domains. `policy_strength.rs` asserts all three are pairwise disjoint in both their seed streams and their generated boards.

The domain seed drives both board generation and each game's dice, deck, chance, and policy streams. On a given unit, the game seed depends only on `(domain seed, board, rep, hero seat)`, never the arm, so paired arms use common random numbers.

Board `i` derives from `mix64(domain seed ^ i)`, so within one layout, seat count and domain it depends on its own index alone — the generator also consumes layout and seats, and a run that changes either gets a different board set at the same indices. Two consequences worth relying on: raising `--boards` extends the board set rather than resampling it, so a longer run's boards are a strict superset of a shorter one's; and adding arms to a run cannot perturb any other arm or the reference, so an earlier run's paired result is reproducible exactly by a later run that merely carries more arms. M-21 used both to prove its invocation identical to the runs it refines.

## Paired statistics

For an arm and its reference, `b` counts units won only by the arm and `c` counts units won only by the reference. The paired estimate is `(b-c)/n`. The artifact reports both a McNemar Wald interval for the correlated per-unit differences and an interval clustered by generated board. It always selects the wider interval, choosing the clustered interval on an exact width tie. With only one board, between-board variance is unknowable, so the clustered interval is `[-1, 1]`, `clusteredDegenerate` is true, and the verdict is necessarily `inconclusive`.

For selected interval `[lo, hi]` and threshold `t`, the pre-registered verdict is `better` when `lo > t`, `worse` when `hi < -t`, `equivalent` when `lo > -t` and `hi < t`, and `inconclusive` otherwise. The chosen `alpha`, threshold, and normal quantile are recorded in the artifact. Prefer increasing `--boards` over increasing `--reps`: clustered precision comes from the number of boards, and the normal-quantile interval can still understate uncertainty when there are few clusters.

## Rosters

Available built-in placement names:

```
random
max_pips
pip_diversity
pip_scarcity
port_synergy
city_focus
```

Available policies:

```
random-legal
greedy-no-trade
priority-trader
heuristic-v1
heuristic-v1-noports
heuristic-v1-denial
heuristic-v1-threat
heuristic-v1-threat-denial
heuristic-v1-devcards
heuristic-v1-devcards-denial
heuristic-v1-threat-devcards
heuristic-v1-threat-devcards-denial
heuristic-v1-trader
heuristic-v1-trader-denial
heuristic-v1-trader-threat
heuristic-v1-trader-threat-denial
heuristic-v1-trader-devcards
heuristic-v1-trader-devcards-denial
heuristic-v1-trader-threat-devcards
heuristic-v1-trader-threat-devcards-denial
heuristic-v1-trader-aware
heuristic-v1-trader-aware-denial
heuristic-v1-trader-aware-threat
heuristic-v1-trader-aware-threat-denial
heuristic-v1-trader-aware-devcards
heuristic-v1-trader-aware-devcards-denial
heuristic-v1-trader-aware-threat-devcards
heuristic-v1-trader-aware-threat-devcards-denial
heuristic-v1-trader-aware-threat-devcards-denial-legacyall
heuristic-v1-trader-aware-threat-devcards-denial-legacyport
heuristic-v1-trader-aware-threat-devcards-denial-legacychooser
heuristic-v1-trader-aware-threat-devcards-denial-legacycityterms
heuristic-v1-trader-aware-threat-devcards-denial-legacyband
heuristic-v1-trader-aware-threat-devcards-denial-legacycitygoal
heuristic-v1-trader-aware-threat-devcards-denial-legacycards
heuristic-v1-trader-aware-threat-devcards-denial-legacydeck
heuristic-v1-trader-aware-threat-devcards-denial-legacyexposure
heuristic-v1-trader-aware-threat-devcards-denial-legacyrace
heuristic-v1-trader-aware-threat-devcards-denial-legacyembargo
heuristic-v1-trader-aware-threat-devcards-denial-legacypair
heuristic-v1-trader-aware-threat-devcards-denial-legacyknight
heuristic-v1-trader-aware-threat-devcards-denial-sbmute
heuristic-v1-trader-aware-threat-devcards-denial-sbhold
heuristic-v1-trader-aware-threat-devcards-denial-goalneedlo
heuristic-v1-trader-aware-threat-devcards-denial-goalneedhi
heuristic-v1-trader-aware-threat-devcards-denial-stagelo
heuristic-v1-trader-aware-threat-devcards-denial-stagehi
heuristic-v1-trader-aware-threat-devcards-denial-econlo
heuristic-v1-trader-aware-threat-devcards-denial-econhi
heuristic-v1-trader-aware-threat-devcards-denial-hystlo
heuristic-v1-trader-aware-threat-devcards-denial-hysthi
heuristic-v1-trader-aware-threat-devcards-denial-frontierlo
heuristic-v1-trader-aware-threat-devcards-denial-frontierhi
heuristic-v1-trader-aware-threat-devcards-denial-jall
heuristic-v1-trader-aware-threat-devcards-denial-jnohyst
```

Within the trader family, `-threat` enables G1 robber placement, `-devcards` enables G2 pre-roll dev-card timing, `-aware` enables G3 threat-aware trading, and `-denial` enables G4 threat-aware action selection and denial. The suffixes compose independently. The `-legacy*` spellings are measurement-only ablations restoring one pre-fix behavior each (or, for `-legacyall`, the whole pre-SIM-BATCH1 valuation) and are not default-reachable policies. `heuristic-v1-noports` remains a rules-level ablation and is not crossed with the four gates. The `-sbmute` and `-sbhold` spellings are measurement-only SpecialBuild treatments (`HeuristicParams::special_build`): `-sbmute` passes every special-build decision, `-sbhold` drops special-build spends whose every payable cost variant increases the current goal's closest-variant shortfall, and the shipped default is the uniform treatment, in which special-build decisions run the ordinary action scorer under the phase's narrower legality. The `-goalneedlo` and `-goalneedhi` spellings are measurement-only trial values of the J1 goal-need vertex term (`HeuristicParams::goal_need_weight` at 0.5 and 2.0): the shipped default weight is zero, which never constructs the shared `policy::goal_need` model and keeps the pre-J1 scores bit-identical. The `-stagelo` and `-stagehi` spellings are measurement-only trial values of the J2 stage signal (`policy::stage::Stage`, one derivation per decision): the settlement expansion term is damped by `stage_expansion_weight`, the city vertex score is boosted by `stage_city_weight`, and under gated policies the denial context's top rival danger raises the stage through `stage_urgency_weight`; all three default to zero, which never derives the stage and keeps the pre-J2 scores bit-identical. The `-econlo` and `-econhi` spellings are measurement-only trial values of the two J3 piece-economy terms: `slot_return_weight` (2.0 and 8.0) adds `policy::piece_economy::SlotReturn` — proximity to the settlement cap times open-site availability, one derivation per decision — to city vertex value, and `cost_pressure_weight` (0.5 and 2.0) charges each affordable build candidate for the overlap between its cost (at the variant the payment path would spend) and the shared goal-need model's outstanding need for the selected goal; both default to zero, which never derives either model and keeps the pre-J3 scores bit-identical. The `-hystlo` and `-hysthi` spellings are measurement-only trial values of the J4 goal-hysteresis margin (`HeuristicParams::goal_hysteresis_margin` at 0.25 and 1.0): the engine records each seat's last committed goal on `GameState` (reset in `GameArena::prepare`, read through `DecisionView::incumbent_goal`), and the goal chooser boosts the incumbent's candidate by the margin in its comparisons only — the chosen goal always keeps its true score; the margin defaults to zero, which never reads the incumbent and keeps the pre-J4 selection bit-identical. The `-frontierlo` and `-frontierhi` spellings are measurement-only trial values of the J5 frontier blend (`HeuristicParams::frontier_mix` at 0.5 and 1.0): the settlement expansion count becomes `degree + mix * (frontier - degree)`, where `policy::frontier::opened` counts the vertices a settlement at the candidate newly opens — unowned neighbours the observer's road network does not already reach through an unowned edge, plus the distance-rule-open sites one further unowned edge beyond them — and the blend sits inside `vertex_score`'s expansion closure, so it reaches build candidates, the goal chooser, and the road and pair expansion credits through one expression; the mix defaults to zero, which never computes the frontier and keeps the degree count bit-identical. The `-jall` and `-jnohyst` spellings are the Phase J composite measurement labels: `-jall` applies every J term at its lo trial value (goal need 0.5, the stage triple 0.5/0.5/0.5, slot return 2.0, cost pressure 0.5, hysteresis margin 0.25, frontier mix 0.5) and `-jnohyst` the same vector with the hysteresis margin held at the shipped zero; both are measurement-only and no default-reachable policy carries any nonzero J weight. Separately, `HeuristicParams::dev_buy_scale` is one overall scale on the development-card buy score, wrapping the deck-aware and legacy deck-blind spellings alike; a value of 1.0 restores the pre-sweep expression bit-identically, the Phase-H sweep answered the buy-band question it was built for, and the Phase-I adoption (M-46) made 0.25 the default. It has no measurement label of its own.

## Weights files

A weights file must carry **every** field the formula takes and no others — a missing or unknown key is a load error, not a defaulted value, so adding a weight means updating every arm file rather than letting stale ones score against a silently different formula.

Serde-defaulting a new weight to zero is the actively harmful alternative, and it is worth being explicit about why, because it looks like the considerate option. The arm files in `placement/arms/` are *single-parameter* perturbations of the baseline they were measured against. If a new weight defaulted to zero in the arms while the field carried its real value, every arm would differ from the field in two parameters at once, so `gpf_0` would quietly stop isolating `genericPortFactor` and the single-parameter property would go false with nothing failing.

Since the Phase-I adoption (M-46) that baseline is no longer the live defaults: the arm files are frozen measurement records of the *pre-adoption* baselines. The policy arms anchor to the pre-adoption composite (pinned by `screen_baseline_value()` in `params_file.rs`); the weights arms anchor to the pre-drop placement defaults with `handValueWeight` 0.4 (the snapshot committed as `phase-i-candidate-weights.json`), so every `h1_*`/`gpf_*`/`spread_*` arm now differs from the live `default-weights.json` in its own axis *plus* the handValue drop, and `h3_hand_zero.json` is byte-identical to the live defaults. Re-running any of these arms against the live field is therefore not the measurement their name records; a new sweep needs new arms bracketed around the adopted defaults.

`simulator/placement/default-weights.json` mirrors the app's `DEFAULT_WEIGHTS` and is the field to compare candidates against; a vitest case fails if the two drift, because nothing else detects it.

Weights files are additionally domain-guarded at load by `EngineWeights::validate`: every field must be finite, and `genericPortFactor >= 0` is a hard bound of the candidate space (a negative factor turns generic ports into penalties, which the placement programme has ruled out).

## Policy params files

The H0 seam: `--arm-policy label=<base>@<params.json>` (and the same `@` spelling anywhere a policy name is accepted) loads a **full** `HeuristicParams` vector from JSON and registers it as a runtime policy, so Phase-H screens run single-parameter arms without minting a roster label per point. The contract mirrors the weights files, for the same single-parameter reason: every key present, missing and unknown keys are load errors, and the key shape is checked structurally against the live structs' own serialization at every nesting level, so a field added to any params struct widens the contract without hand-maintenance. The gate blocks (`threat`, `devCards`, `trading`, `denial`) are each either `null` (gate off) or fully populated. `legacyValuation` is pinned to `null` and `specialBuild` to `"uniform"`: both are measurement-only surfaces owned by named roster labels, never swept.

A vector must pass the shared domain guards (the same conditions the engine debug-asserts at every scoring entry, spelled as `validate` functions per params block) and the SIM-GAP-30 building-band headroom check before it registers. The base kind contributes only its dispatch family — whether the seat makes and answers player-trade offers — and every parameter comes from the file; `heuristic-v1-noports` is rejected as a base because its effect is a port rule, not a parameter, and non-heuristic kinds are rejected because they have no params to replace. A params-file policy spelling out a base's exact param values is bit-identical to the named kind (the evaluation seed never mixes the policy), which the arm-policy test suite pins.

`simulator/placement/policy-default-params.json` mirrors `HeuristicParams::default()` and is the starting point for sweep vectors; a Rust test fails if the two drift, in either direction. `simulator/placement/sweep-bounds.json` declares the candidate range of every swept parameter (placement weights, policy params including every gate block, and the `TradeConfig` flags); a test walks it against the live shapes for completeness in both directions and verifies every range endpoint admissible.

## Player trading

Ungated trader policies select the acceptor with the lowest hidden-VP-aware estimate from the proposer's view, breaking equal estimates by rotation-relative rank. `-aware` policies instead use `trading.rs::counterparty_score`, the same offer-sensitive scalar used by acceptance and proposal scoring, and retain the first seat on an exact score tie.

The mechanism supports only offers giving one or two units of one resource for exactly one unit of another. Multi-resource baskets, bundles, counteroffers, and bank-trade changes are outside its scope.

Exact ties resolve to the first candidate in the fixed `give × get × count` enumeration.

## Denial and positional competition

`DenialParams` is independently gated through `HeuristicParams::denial`. `None` is the byte-stable self-regarding path; `Some` enables G4. The defaults are Phase-H sweep targets, not tuned values.

The non-winning `contested_card_score` expression is multiplied by denial pressure derived from the holder's absolute ETW danger, or the most dangerous opponent when nobody holds the card. A confirmed non-holder Longest Road racer multiplies that pressure. The win-now short circuit is never modulated. The knight call site forwards the shared denial pressure toward the Largest Army holder under gated policies (1.0 ungated, bit-identical to the frozen scorer); only the `-legacyknight` measurement label's `frozen_knight_action_score` still forwards the literal `1.0`, preserving G1's knight play/hold comparison as a reference.

Exactly one `DenialContext` is built per gated policy decision and threaded through every consumer. It memoizes per-seat one-road reach and one Longest Road challenger resolution without adding fields to `ViewCache`. Exact `road_takes_longest_road` checks are ranked by danger, guarded by the sound necessary condition `road_count + 1 >= required`, and capped at `DenialParams::race_check_cap` per decision, whose default (`denial.rs::MAX_RACE_CHECKS`, every rival in the largest layout) leaves no prefilter survivor unchecked. The prefilter has no false negatives relative to the codebase's exact checker.

Positional competition is threat multiplied by legal one-road reach, site openness, and settlement-piece availability. It prices racing to a shared target, and additionally the block itself when the candidate edge is a rival's only remaining one-road approach to the contested vertex (`contest_block_bonus`, zero restoring blocking-blind contesting; the predicate reads build legality only, so it over-credits a rival already owning an incident edge — `SIM-GAP-33` in [gaps.md](gaps.md)); the cut check is bounded to the vertex's incident edges and every production consumer reads one-road reach through the context memo. General route cutting away from contested vertices is still not priced.

`PolicyKind::parse` ends in a wildcard and is not compiler-enforced. The complete policy roster is guarded by an enum-to-name-to-parse round-trip test in addition to exhaustive production matches.

## Output stability

Deterministic result artifacts include a `playerTrading` config block only when the mechanism is enabled. `evaluation.json` likewise carries an `armPolicies` block only when at least one `--arm-policy` was given, so default-off output remains byte-identical. `diagnostics.json` follows the same rule for its own `playerTrading` block.

`--allow-unofficial` is echoed in `results.json`.

What each artifact contains:

- `results.json`: deterministic config, per-heuristic games, wins, Wilson interval, mean VP, mean turns, per-seat totals, draws, head-to-head wins, and illegal-action count.
- `results.csv`: the same per-heuristic aggregates in tabular form.
- `meta.json`: elapsed time, throughput, worker count, and version data.
- Optional JSONL: ordered per-game schedule coordinates, seat placements, and result.
- `evaluation.json`: the run configuration, label-keyed arm marginals, ordered paired comparisons, and the total illegal-action count.
- `diagnostics.json`: the run configuration, the observation counts the statistics rest on, the setup-time statistics themselves, and the total illegal-action count.

The optional corpus JSONL carries identifiers, placements, and a terminal `GameResult` only. It records no candidate scores, chosen action, or per-turn state. A byte-exact corpus can identify which games changed and prove a mechanical stage stable, but it cannot by itself supply per-decision evidence; a behavioural explanation needs a paired decision trace read at each game's first divergence.

## Determinism

`results.json`, `evaluation.json` and `diagnostics.json` contain no time or thread-count fields. Tournament game seeds are derived from the base seed and `(board, rep)` only, so all rotations share dice, deck, and chance streams; evaluation game seeds use the domain and full unit coordinate described above. A diagnostic has no arm to rotate, so `diagnose` pins the rotation coordinate at hero seat 0 and generates its boards exactly as `evaluate` does, which puts its games on an `evaluate` run's boards at the same domain, layout and seat count. Dice, deck, chance, player trading, and each seat policy use independent xoshiro256** streams. Player-trade response softening uses only the trade stream; acceptor selection is deterministic from the proposer's view. Rayon collects each indexed schedule in order, then aggregation runs serially through that order. Repeating a run with the same seed or domain produces byte-identical result artifacts at any worker count.

## Acceptance for any engine change

**Both cargo profiles, every time.** `--release` compiles out `debug_assert!(invariants_hold)`, which is the only detector for a class of piece and VP accounting bugs, so a release-only run has "passed" a board that panics in debug. Neither profile substitutes for the other.

**Diff against a byte-exact corpus captured before the change.** Capture `results.json` plus `--jsonl` across several policies and both layouts *first*, then touch the code. Tie-breaking reads the action buffer in push order and reservoir-samples it, so reordering two loops, or merging them, silently changes which game gets played — with no test failing and no output looking wrong. That corpus is what proved the 2026-07-25 rewrite behaviour-preserving, and what localised the one change that was not.

**A placement-formula change lands in both scorers and every committed vector.** A new term or weight lands in `src/engine/valuation.ts` and `src/engine/weights.ts` and is mirrored in `app_formula.rs`, is declared in `simulator/placement/sweep-bounds.json` or the completeness walk fails, and reaches every committed weights file under the exact-key rule in [Weights files](#weights-files) above, the arms included, since a test walks that directory and loads each file through the full contract. `simulator/fixtures/placement-parity.json` is regenerated and re-verified by hand whenever scorer logic changes; a weight-value change alone does not need it, because each fixture case embeds the weights it was generated with. Nothing here is optional and none of it is one edit, which is why the placement programme costs a term rather than a phase.

**Policy tests must own the state they assert.** Replaying turns under a default policy is not stable fixture construction for a test of another subsystem: any default-policy change can silently move the replay to a state where the subject precondition no longer holds. Prefer explicit state setup. Where replay is essential, assert every derived precondition before the subject assertion so a policy change fails as fixture drift rather than quietly re-scoping the test.

## Game termination

Games that reach the configured 500-round cap are recorded as draws. Illegal policy actions are counted and must remain zero.

## Board ingestion and topology

Board ingestion first checks exact object key sets, including the presence of nullable fields, and then deserializes into a lossless wire DTO. Simulation conversion separately rejects incomplete tiles or tokens, resolves a null robber to the first desert, enforces the official seat envelope, and saturates integral port rates above `u32::MAX` without changing their effective behavior.

Regeneration must leave `simulator/topology/standard4.json` and `simulator/topology/extension6.json` byte-identical unless app geometry changed. Rust treats canonical vertex and edge IDs as opaque ingestion keys and uses compact integer indices in the hot loop.

## Extension seams

Policy-level gates use a `PolicyKind` variant together with an `Option<...>` parameter block in shared heuristic parameters when the behavior must reach every call site of a shared entry point: the inner calls see `HeuristicParams`, not the kind, while the kind makes the arm selectable. Policy code receives `DecisionView`, not `GameState`; app-facing recommendation code should use the `recommend` adapter while simulation code scores into the `ActionBuf` its `PolicyScratch` already owns. Incremental derived state that lasts for one game belongs on `GameState` and resets in `GameArena::prepare`; anything derived per decision and read board-wide belongs in the `DecisionView` cache next to production pips; anything fixed by the board or layout belongs on `SimBoard` or `Topology` at load.

## Belief state and ETW

The belief state carries per-seat resource counts derived from public events, plus a bounded uncertainty pool from robber steals. Production, bank and port trades, player trades, purchases, discards, monopoly and year-of-plenty are all public; only the robber steal and dev-card identity are hidden, and a steal moves exactly one card, so bounds stay tight. Pure derived state with no RNG and no behaviour change until a policy reads it, so it is corpus-safe and independently testable. It never reads private state, and its updates are O(1) because this runs on every action of every game.

Expected turns to win is closed-form over the belief state. Never a mini-rollout. VP alone is a lagging indicator: six VP with two cities queued and strong production beats eight VP built out.

**A lone ETW term is degenerate for selection and must never be one.** `etw.rs::route_etw` caps credit at `cards_per_vp`, so roughly half of realistic mid-game hands score bit-identically across every candidate; a ranking on ETW alone therefore collapses to the order candidates were pushed in — a lexicographic ladder wearing a float costume, which is the shape this programme rejects everywhere else. Any consumer that selects among candidates has to break the plateau with a second bounded, monotone term. `devcards.rs` does it with a tempo term, and `trading.rs::counterparty_score` is offer-sensitive, which is why the plateau does not recur there.

Remaining dev-deck composition is derivable in exactly the shape `belief.rs` already uses — the initial counts come from `RuleConfig`, every knight and progress card played is public, and the residue is a bounded unknown pool — with victory-point cards the one term needing a genuine estimate, since they are never played and so are only bounded by the deck total and the per-seat dev counts.

## Threat-aware consumers

G3 unified proposal scoring, acceptance, and counterparty selection around `trading.rs::counterparty_score`; its standing term is `threat.rs::danger_from_etw` applied to `etw.rs::expected_turns_to_win`, the same danger expression the robber arm uses — though since the Phase-I adoption (M-46) the trade side passes its own `danger_floor` 4.0 while threat, denial, and the embargo config keep 1.0, so the shared expression no longer yields the same danger number across arms. The robber arm holds knight play/hold fixed by scoring the knight action from the self-regarding robber choice while using the threat-selected placement. The dev-card arm deliberately changes whether the turn's single dev play is spent pre-roll, so action-phase knight availability moves with it.

Decay across multiple ports needs no new parameter: the term already compares against `view.trade_rate`, which includes ports you hold, so a second port for the same resource scores zero by construction.

**The default ordering of the threat terms is regime-dependent, not fixed.** At the shipped defaults the terms rank delay, need, block, steal, but that holds only above danger roughly `0.108157` and `0.104855`; below those crossovers the ordering reverses to block over delay and steal over need. Reading the weights off `threat.rs` gives the high-danger ordering only, so a sweep that assumes a fixed ranking is reasoning about one regime of two.

**`assert_params` guards a domain, not a type.** `ThreatParams`, `DevCardParams` and `TradeParams` are `pub` and `Deserialize` and are themselves the Phase-H sweep targets, so swept values reach them directly with no intermediate validation. The guard exists because an out-of-domain value degrades silently rather than loudly: `danger_floor = 0.0` yields a NaN danger and a robber choice that is still returned and still legal, not a panic. Widening a sweep range means widening the guard deliberately, never removing it.

## Performance-critical structures

The trail search behind Longest Road dominates everything else, so most of the speed is in `RoadNetwork` (`longest_road.rs`) and these four properties are load-bearing:

- **Adjacency, not an edge list.** The search follows the two or three segments at a vertex instead of rescanning every edge on the board at every step of every branch.
- **Build once, probe per candidate.** Scoring a seat's roads costs one full search plus one small search per candidate. `best_road` builds the network and hands the same one to `best_goal`.
- **Component scope.** A probe searches only the component its segments touch; a trail never leaves its component, and the rest was already measured into the base length.
- **Pruned starts.** A maximum trail ends at odd-degree or blocked vertices, and a component with neither is Eulerian and needs no search at all. This is an argument about trails rather than an obvious property, so `pruned_search_matches_exhaustive_reference` checks it against a brute-force reference over thousands of random graphs. Change the search and that test is the thing to trust.

One tempting mitigation is deliberately absent: the search is *not* gated on `current_length + 1`, because a single road can bridge two components into `a + b + 1` and every seat leaves setup with two disconnected stubs -- that bound is false and silently declines game-winning roads. The guard bounds by segments owned instead, which is sound but fires far more often.

Elsewhere, `DecisionView` memoises what it derives from the borrowed `GameState` -- production pips, legal settlements and roads as bitsets -- because the scoring passes ask for those board-wide within a single decision. Board and topology constants (resource pips, port incidence, edge neighbours) are computed at load. Policies score into a buffer owned by `PolicyScratch` rather than a fresh one per decision.

The allocator test warms 50 games and then observes zero allocations across 200 games through the buffer-based scoring path.

## Benchmark reporting

Ignore the `parallel efficiency` figure the bench prints. It divides by the logical core count, which assumes 18 interchangeable cores; this machine has two kinds.

## Ablation semantics

The no-ports ablation is applied at the rules level, so a no-ports seat genuinely trades at the base bank rate rather than merely discounting ports when scoring locations.

`HeuristicParams::legacy_valuation` is different: it is a measurement-only instrument inside the single shipped valuation implementation, not a rules-level ablation. `None` is the only default-reachable value. Six named `legacy*` policy kinds restore the complete pre-SIM-BATCH1 valuation or exactly one of its five separable expressions so paired attribution can hold the field fixed; each later gap fix adds one more kind restoring exactly that fix's pre-change behavior, on the same terms. No unnamed or default policy reaches any of them.

Two preconditions on reading that attribution. The restoration is exact only where `vertex_score` is finite: the city goal's presence gate moved from "a legal city exists" to "a legal city scores finitely" and no flag restores the old form, so a params vector making every city score non-finite drops the city goal under `legacyall` as well as under the fixed scorer. Every shipped rate is clamped at two or more, so no default-reachable policy can get there, but `HeuristicParams` is `pub` and `Deserialize` and is a Phase-H sweep target. And the five flags are marginal against the fixed corner rather than isolating: the port term is not build-kind dispatched, so `legacycityterms` alone does not reconstitute a pre-batch *city* score — only `legacyall` does.

## Build valuation

`heuristic_v1.rs::vertex_score` is marginal and build-kind-aware. Its port term prices prospective board-wide own production, the observer's current production plus the candidate build's marginal contribution, matching the shape of `app_formula.rs::port_delta`. A settlement may add diversity and frontier; a city upgrade adds neither. Only the frontier half was ever a live term: `legal_city` requires the observer to already own the vertex and `production_pips` sums owned vertices with the same robber skip, so a city's diversity count was structurally zero before this batch too, and no legacy flag restores it. `SIM-GAP-03` named two dead terms and one of the two was genuinely dead.

`heuristic_v1.rs::best_goal_with` and `heuristic_v1.rs::score_actions_with` consume that one vertex value. The building saved toward and the building built are therefore ranked by the same marginal quantity.

City and settlement actions share `heuristic_v1.rs::BUILD_BAND` and are ordered inside it by marginal value rather than kind. Under base rules and the shipped default `HeuristicParams`, every building stays below the non-winning contested-card band at pressure one. For swept vectors the guarantee is mechanical: `heuristic_v1::building_band_headroom` computes a closed-form worst-case building score from a params vector (documented over-counts for pips, scarcity, diversity, ports, frontier fan, and the J terms) and rejects any vector whose bound reaches `NON_WINNING_CONTESTED_FLOOR` (the pressure-one, zero-proximity contested value, pinned to the live expression by test). The params-file loader runs this check on every load, so no screen can run an inadmissible vector, and every candidate range declared in `simulator/placement/sweep-bounds.json` has both endpoints verified admissible by test.
