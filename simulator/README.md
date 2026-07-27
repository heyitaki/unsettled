# Unsettled self-play simulator

`unsettled-sim` is a seeded Rust simulator for complete base-Catan games. It supports the 19-hex `standard4` and 30-hex `extension6` layouts, app-exported Board JSON, generated legal boards, six built-in starting-placement heuristics, weights-file-parameterized app-formula arms, and post-placement policies including optional player-to-player trading and a threat-aware robber-placement arm.

The engine crate has no threading, CLI, or filesystem dependency. The CLI owns board generation, rayon scheduling, aggregation, and output.

Within the engine, `belief.rs` maintains a public-information opponent belief with exact hand totals and per-resource `[lo, hi]` intervals, updated only from public events in `game.rs`; `invariants_hold` includes a gated soundness clause, while the random-game fuzz test checks the same property ungated. `etw.rs` is the pinned closed-form expected-turns-to-win reference implementation, with its fixed constants at the top of the module; those constants are never swept. `policy/threat.rs` is the first consumer of both modules and consumes the pinned ETW directly rather than adding a second ETW; `policy/devcards.rs` is the second and values dev-card plays in the observer's own ETW terms.

## Build and test

```sh
RUSTFLAGS="-D warnings" cargo build --release
cargo test --workspace
cargo test --release -p unsettled-sim --test alloc
```

This repository's offline solve environment requires `CARGO_HOME` to point at the staged Cargo home described by the task harness before running Cargo.

## CLI

Compare all six placement heuristics on generated four-player boards:

```sh
cargo run --release -p unsettled-sim -- tournament \
  --layout standard4 \
  --random-boards 50 \
  --reps 25 \
  --heuristics max_pips,pip_diversity,pip_scarcity,port_synergy,city_focus,random \
  --policy heuristic-v1 \
  --seed 42 \
  --threads 0 \
  --out runs/std4
```

`--threads 0` selects all logical cores. The schedule is `boards × reps × heuristic-count rotations`. Rotation `j` assigns seat `s` to heuristic `(s + j) mod k`, so every heuristic visits every seat even when the number of heuristics differs from the seat count.

Evaluate labelled hero-placement arms against one fixed field placement:

```sh
cargo run --release -p unsettled-sim -- evaluate \
  --layout standard4 \
  --seats 4 \
  --domain tuning \
  --field app_formula:placement/default-weights.json \
  --arm base=app_formula:placement/default-weights.json \
  --arm candidate=max_pips \
  --reference base \
  --boards 40 \
  --reps 20 \
  --policy heuristic-v1 \
  --threshold 0.01 \
  --alpha 0.05 \
  --threads 0 \
  --out runs/evaluation
```

An evaluation unit is one `(board, rep, hero seat)` triple. The schedule fully crosses every generated board, repetition, and seat, then plays every labelled arm on every unit while every non-hero seat uses `--field`. Arm values split on the first `=`, so labels form their own namespace and a spec path may contain `=`. Labels must be unique, while specs may repeat. `--arm-policy label=policy` overrides the hero seat's policy for that arm only; the field keeps `--policy`, and each override label must name a declared arm. Game seeds are arm-independent, so policy-overridden paired arms retain common random numbers. `--reference` is required for two or more arms and optional for a single-arm marginal run.

`--layout` defaults to `standard4`; the corresponding default seat counts are four for `standard4` and six for `extension6`. Board and repetition counts must be positive. `--policy`, `--threshold`, `--alpha`, and `--threads` default to `heuristic-v1`, `0.01`, `0.05`, and all logical cores, respectively; `--arm-policy` defaults every arm to `--policy`. The threshold must be non-negative and alpha must be strictly between zero and one. As with tournament, non-official seat counts require `--allow-unofficial`.

The required `--domain tuning|eval|gate` selects the committed tuning (`0x7a11_1e5e_ed20_2607`), held-out evaluation (`0xe7a1_5eed_2026_0724`), or adoption-gate (`0x6a7e_5eed_2026_0725`) seed domain. It deliberately has no default so tuning work cannot accidentally use a held-out domain. `policy_strength.rs` asserts all three are pairwise disjoint in both their seed streams and their generated boards. The domain seed drives both board generation and each game's dice, deck, chance, and policy streams. On a given unit, the game seed depends only on `(domain seed, board, rep, hero seat)`, never the arm, so paired arms use common random numbers.

Spend the domains in order and never go back. Screen and tune on `tuning` freely; use `eval` once a candidate is settled, to check the tuning result was not an artifact of its seeds; keep `gate` for the final adoption decision only. A domain cannot be un-spent — once a parameter has been screened against a domain, that domain's estimate for *that parameter* is no longer unbiased, though it stays clean for every other parameter. `eval` has already been spent on the `resourceValue` spread question.

For an arm and its reference, `b` counts units won only by the arm and `c` counts units won only by the reference. The paired estimate is `(b-c)/n`. The artifact reports both a McNemar Wald interval for the correlated per-unit differences and an interval clustered by generated board. It always selects the wider interval, choosing the clustered interval on an exact width tie. With only one board, between-board variance is unknowable, so the clustered interval is `[-1, 1]`, `clusteredDegenerate` is true, and the verdict is necessarily `inconclusive`.

For selected interval `[lo, hi]` and threshold `t`, the pre-registered verdict is `better` when `lo > t`, `worse` when `hi < -t`, `equivalent` when `lo > -t` and `hi < t`, and `inconclusive` otherwise. The chosen `alpha`, threshold, and normal quantile are recorded in the artifact. Prefer increasing `--boards` over increasing `--reps`: clustered precision comes from the number of boards, and the normal-quantile interval can still understate uncertainty when there are few clusters.

Use an app Board JSON file:

```sh
cargo run --release -p unsettled-sim -- simulate \
  --board ../src/parser/__tests__/expected/board-draft-empty.json \
  --games 1000 \
  --heuristics max_pips,pip_diversity,pip_scarcity,port_synergy,random \
  --policy heuristic-v1 \
  --seed 7 \
  --out runs/real
```

Measure throughput:

```sh
cargo run --release -p unsettled-sim -- bench --layout standard4 --games 20000
```

Available built-in placement names are `random`, `max_pips`, `pip_diversity`, `pip_scarcity`, `port_synergy`, and `city_focus`. `app_formula:<path/to/weights.json>` loads the app's settlement formula at run time and reports it as `app_formula:<file-stem>`, so multiple weights files with distinct stems can be arms in the same run. A weights file must carry **every** field the formula takes and no others — a missing or unknown key is a load error, not a defaulted value, so adding a weight means updating every arm file rather than letting stale ones score against a silently different formula. `placement/default-weights.json` mirrors the app's `DEFAULT_WEIGHTS` and is the field to compare candidates against; a vitest case fails if the two drift, because nothing else detects it. `placement/arms/` holds single-parameter perturbations of it — `spread_*` scale the `resourceValue` spread, `gpf_*` vary `genericPortFactor`, `flat_swamp` is an external formula's resource ratios renormalized to the same mean. Available policies are `random-legal`, `greedy-no-trade`, `priority-trader`, `heuristic-v1`, `heuristic-v1-noports`, `heuristic-v1-threat`, `heuristic-v1-devcards`, `heuristic-v1-threat-devcards`, and `heuristic-v1-trader`.

Player trading is disabled by default. Set `RuleConfig::player_trading` to `Some(TradeConfig)` and use `heuristic-v1-trader` to exercise it. `TradeConfig` exposes `opponent_gain_weight`, `acceptance_temperature`, `max_offers_per_turn`, and `hidden_vp_confidence`; their defaults are placeholders for a later parameter sweep, not tuned values. When several responders accept, the proposer trades with the acceptor having the lowest hidden-VP-aware estimate from the proposer's view; equal estimates prefer the seat furthest away in rotation order. The mechanism supports only offers giving one or two units of one resource for exactly one unit of another. Multi-resource baskets, bundles, counteroffers, and bank-trade changes are outside its scope.

The `tournament`, `evaluate`, and `simulate` commands enable the mechanism with `--player-trading`. Their optional `--opponent-gain-weight`, `--acceptance-temperature`, `--max-offers-per-turn`, and `--hidden-vp-confidence` flags override the corresponding defaults and require `--player-trading`. Deterministic result artifacts include a `playerTrading` config block only when the mechanism is enabled. `evaluation.json` likewise carries an `armPolicies` block only when at least one `--arm-policy` was given, so default-off output remains byte-identical.

Official simulation-ready combinations are three or four seats on `standard4` and five or six seats on `extension6`. `--allow-unofficial` permits two through six seats on either layout and is echoed in `results.json`.

### Tournament config

`--config config.json` can supply tournament options. Explicit flags override config values. The schema is:

```json
{
  "layout": "standard4",
  "board": ["boards/example.json"],
  "boardDir": "boards/",
  "randomBoards": 50,
  "reps": 25,
  "heuristics": "max_pips,pip_diversity,pip_scarcity,port_synergy,city_focus,random",
  "policy": "heuristic-v1",
  "seed": 42,
  "threads": 0,
  "out": "runs/std4",
  "seats": 4,
  "allowUnofficial": false,
  "jsonl": "runs/std4/games.jsonl"
}
```

Fields are optional. At least one board source and an output directory are required after config and flags are merged. `--board` and config `board` entries are combined. `--jsonl` writes deterministic per-game records and is off by default.

## Outputs and determinism

Each run writes:

- `results.json`: deterministic config, per-heuristic games, wins, Wilson interval, mean VP, mean turns, per-seat totals, draws, head-to-head wins, and illegal-action count.
- `results.csv`: the same per-heuristic aggregates in tabular form.
- `meta.json`: elapsed time, throughput, worker count, and version data.
- Optional JSONL: ordered per-game schedule coordinates, seat placements, and result.

`evaluate` instead writes deterministic `evaluation.json` plus `meta.json`, with no CSV. Its evaluation artifact contains the run configuration, label-keyed arm marginals, ordered paired comparisons, and the total illegal-action count.

`results.json` and `evaluation.json` contain no time or thread-count fields. Tournament game seeds are derived from the base seed and `(board, rep)` only, so all rotations share dice, deck, and chance streams; evaluation game seeds use the domain and full unit coordinate described above. Dice, deck, chance, player trading, and each seat policy use independent xoshiro256** streams. Player-trade response softening uses only the trade stream; acceptor selection is deterministic from the proposer's view. Rayon collects each indexed schedule in order, then aggregation runs serially through that order. Repeating a run with the same seed or domain produces byte-identical result artifacts at any worker count.

Games that reach the configured 500-round cap are recorded as draws. Illegal policy actions are counted and must remain zero.

## Board ingestion and topology

Board ingestion first checks exact object key sets, including the presence of nullable fields, and then deserializes into a lossless wire DTO. Simulation conversion separately rejects incomplete tiles or tokens, resolves a null robber to the first desert, enforces the official seat envelope, and saturates integral port rates above `u32::MAX` without changing their effective behavior.

Topology packs are generated by the app's own geometry helpers and committed:

```sh
npx tsx tools/generate-topology.ts
```

Regeneration must leave `topology/standard4.json` and `topology/extension6.json` byte-identical unless app geometry changed. Rust treats canonical vertex and edge IDs as opaque ingestion keys and uses compact integer indices in the hot loop.

## Extending the study

To add a built-in placement heuristic, add a `PlacementKind` entry and name mapping in `crates/engine/src/placement/mod.rs`, then supply its vertex-score preset or implementation. The CLI registry and result keys use that stable name. The parameterized app formula lives in `crates/engine/src/placement/app_formula.rs`; the CLI loads each weights file, registers its stable file-stem name, and prepares its board-fixed port reach and scarcity context before games start.

Rule changes belong in `RuleConfig`, `BuildableSpec`, or `PlayerModifiers`. Parameter-only changes flatten into per-player cost and trade-rate tables. `RuleConfig::player_trading` is the default-off gate for player offers and carries the responder model's swept parameters. Port changes use `PortRule`; `heuristic-v1-noports` is exactly this mechanism applied to itself, declaring a `PortSelector::All` / `PortAction::Disable` rule via `PolicyKind::port_rules` so the seat's flattened trade rates fall back to the bank rate. A "ports removed" curse would be the same rule reached through `PlayerModifiers` instead. Policy-level gates use a `PolicyKind` variant together with an `Option<...>` parameter block in shared heuristic parameters when the behavior must reach every call site of a shared entry point: the inner calls see `HeuristicParams`, not the kind, while the kind makes the arm selectable. A behavioral boon or curse adds an `Effect` variant and handles it at the pre-roll, production, build, or trade hook. Policy code receives `DecisionView`, not `GameState`; app-facing recommendation code should use the `recommend` adapter while simulation code scores into the `ActionBuf` its `PolicyScratch` already owns. Incremental derived state that lasts for one game belongs on `GameState` and resets in `GameArena::prepare`; anything derived per decision and read board-wide belongs in the `DecisionView` cache next to production pips; anything fixed by the board or layout belongs on `SimBoard` or `Topology` at load.

## Programme and phase order

The simulator exists to measure which starting placements win, and ultimately to calibrate the app's own scorer (`src/engine/weights.ts`). The phase order below was revised after two findings, and the revision matters more than the list: **weight tuning now runs last.**

Why: a full-power sweep of the `resourceValue` spread found the optimum is policy-dependent and tracks trading volume — a light-trading policy and a heavy-trading one disagree about the best value, and neither answer is the answer. Every result measured so far was measured against a field of *self-regarding* policies, which model opponents almost not at all. Making the field threat-aware will invalidate those results the same way trading threatened to. Tuning weights against a field that is about to be replaced spends held-out seed domains on answers that will not survive.

**Phases E, F and G were reassigned in this revision.** They previously meant "re-tune across the trading grid", "structural formula terms" and "adopt"; those survive as H and I below. An older note referring to Phase E or F means the old plan.

- **A — done.** The app formula as a playable arm, with a TS/Rust parity fixture.
- **B — done.** The paired `evaluate` harness.
- **C — retired.** Was the first tuning pass under no-trade. Superseded: tuning moved to the end, for the reason above.
- **D — built.** Player-to-player trading with the endgame embargo and farthest-from-winning counterparty selection.
- **E — built.** Opponent belief state with per-seat resource counts derived from public events, plus a bounded uncertainty pool from robber steals. Production, bank and port trades, player trades, purchases, discards, monopoly and year-of-plenty are all public; only the robber steal and dev-card identity are hidden, and a steal moves exactly one card, so bounds stay tight. Pure derived state with no RNG and no behaviour change until a policy reads it, so it is corpus-safe and independently testable. It never reads private state, and its updates are O(1) because this runs on every action of every game.
- **F — built.** Expected turns to win, closed-form over the belief state. Never a mini-rollout. VP alone is a lagging indicator: six VP with two cities queued and strong production beats eight VP built out.
- **G — threat-aware decisions, measured one at a time.** Robber placement and belief-driven monopoly and dev-card timing are built. Trade selection and acceptance, then goal switching and denial, remain. Counterparty-ranking unification is deferred to G3, where all trading consumers can move from `vp_estimate` to the same danger function together. The robber arm holds knight play/hold fixed by scoring the knight action from the self-regarding robber choice while using the threat-selected placement; rejoining timing and placement belongs to the knight-timing phase. The dev-card arm deliberately changes whether the turn's single dev play is spent pre-roll, so action-phase knight availability moves with it; that coupling is the subject of the measurement, not a confound. `ThreatParams` and `DevCardParams` weights are unswept Phase-H placeholders.
- **H — re-tune weights** across the resulting grid, including the structural formula terms that were the old Phase F.
- **I — adopt** against the untouched `gate` domain.

Two rules hold across all of it.

**Measure each consumer separately.** A single policy bundling belief, ETW, robber, monopoly and goal-switching that wins by several points teaches nothing about which part earned it and leaves none of it tunable. The paired `evaluate` harness gives clean per-consumer A/B; use it.

**Pin the opponent model to a fixed reference implementation.** If opponents' ETW is computed with the same value function being tuned, the model moves with the arm and every sweep measures two changes at once.

One design note worth keeping, because it is easy to get wrong: a lexicographic tie-break ladder is the wrong shape for ranking opponents. Each rung fires only on an exact tie of the rung above, so replacing a coarse integer criterion with a continuous one makes ties vanish and silently deletes every lower rung. Use a scalar score with weighted terms and sweep the weights. Relatedly, there is one opponent-threat function, not two: the acceptance rule's estimate of opponent gain and the counterparty-selection ranking are the same question over different arguments, and a parallel second model will drift out of agreement with the first.

## Measured performance

Measured on the acceptance machine with Rust 1.94.0, 18 logical cores (6 performance, 12 efficiency), release mode, standard4. Reported as the median of consecutive runs, because this benchmark is noisy: any sample taken while another job holds a core is meaningless and reads 20-30% low.

The Phase-G1 `tuning`-domain sanity check compared hero-seat `heuristic-v1-threat` with `heuristic-v1` against a `heuristic-v1` field over 1,600 paired units. It was `inconclusive`: estimate `0.015625`, selected McNemar interval `[-0.006240397838515523, 0.03749039783851552]`, `b = 172`, `c = 147`, 40 clusters, `clusteredDegenerate = false`; base and candidate win rates were `0.254375` and `0.27`, with zero illegal actions. This is a tuning-domain sanity check, not an adoption decision.

The Phase-G2 `tuning`-domain sanity check ran `cargo run --release -p unsettled-sim -- evaluate --layout standard4 --seats 4 --domain tuning --field pip_diversity --arm base=pip_diversity --arm cand=pip_diversity --arm-policy cand=heuristic-v1-devcards --reference base --boards 40 --reps 10 --policy heuristic-v1 --threads 0`. It was `inconclusive`: estimate `0.01375`, selected clustered interval `[-0.0002801098941004835, 0.027780109894100485]`, `b = 68`, `c = 46`, `n = 1600`, 40 clusters, `clusteredDegenerate = false`; base and candidate win rates were `0.254375` and `0.268125`, with zero illegal actions. The one-minute load averages were 3.95 before and 3.79 after, so this is a loaded-machine tuning-domain sanity check, not an adoption decision.

| Mode | Workers | Games/sec |
| --- | ---: | ---: |
| Single core | 1 | ~1,295 |
| All cores | 18 | ~12,100 |

Ignore the `parallel efficiency` figure the bench prints. It divides by the logical core count, which assumes 18 interchangeable cores; this machine has two kinds. Scaling is near-linear to 8 workers (8.2x) and then flattens as work lands on efficiency cores.

The trail search behind Longest Road dominates everything else, so most of the speed is in `RoadNetwork` (`longest_road.rs`) and these four properties are load-bearing:

- **Adjacency, not an edge list.** The search follows the two or three segments at a vertex instead of rescanning every edge on the board at every step of every branch.
- **Build once, probe per candidate.** Scoring a seat's roads costs one full search plus one small search per candidate. `best_road` builds the network and hands the same one to `best_goal`.
- **Component scope.** A probe searches only the component its segments touch; a trail never leaves its component, and the rest was already measured into the base length.
- **Pruned starts.** A maximum trail ends at odd-degree or blocked vertices, and a component with neither is Eulerian and needs no search at all. This is an argument about trails rather than an obvious property, so `pruned_search_matches_exhaustive_reference` checks it against a brute-force reference over thousands of random graphs. Change the search and that test is the thing to trust.

One tempting mitigation is deliberately absent: the search is *not* gated on `current_length + 1`, because a single road can bridge two components into `a + b + 1` and every seat leaves setup with two disconnected stubs -- that bound is false and silently declines game-winning roads. The guard bounds by segments owned instead, which is sound but fires far more often.

Elsewhere, `DecisionView` memoises what it derives from the borrowed `GameState` -- production pips, legal settlements and roads as bitsets -- because the scoring passes ask for those board-wide within a single decision. Board and topology constants (resource pips, port incidence, edge neighbours) are computed at load. Policies score into a buffer owned by `PolicyScratch` rather than a fresh one per decision.

The allocator test warms 50 games and then observes zero allocations across 200 games through the buffer-based scoring path.

Default heuristic parameters were tuned only on the named TUNING seed domain. The policy gates use the disjoint held-out EVAL seed domain and a fully crossed board × repetition × hero-seat schedule.

On the held-out policy evaluation seeds, `priority-trader` won 85.5% against `random-legal` and 79.8% against `greedy-no-trade`; its latter 95% Wilson lower bound was 77.2%. `heuristic-v1` won 99.5% against `random-legal`, 95.0% against `greedy-no-trade`, and 34.65% against `priority-trader`; the last result's 95% Wilson lower bound was 32.6%.

That last margin is narrower than it once was because `priority-trader` got stronger, not because `heuristic-v1` got weaker: both policies previously refused to play a knight unless holding a spare, which made Largest Army unreachable for either of them. Fixing the comparator is what a comparator is for.

The 7,500-game acceptance placement rankings under `heuristic-v1`, its no-ports ablation, and `priority-trader` share the same top two, `pip_diversity` and `port_synergy`, with pairwise Spearman correlations of 0.9429, 0.9429, and 0.8286. Those two are close enough to trade places between runs -- a 5,000-game standard4 tournament put `port_synergy` at 0.3574 [0.3442, 0.3708] and `pip_diversity` at 0.3536 [0.3405, 0.3670], overlapping confidence intervals -- so treat them as a tied leading pair rather than a strict order. The gap to third (`city_focus`, 0.2752) is unambiguous, as is the gap from every heuristic to `random` (0.0216). The ablation is applied at the rules level (see below), so a no-ports seat genuinely trades at the base bank rate rather than merely discounting ports when scoring locations -- `port_synergy` holding second place under a policy that cannot use ports at all is therefore evidence about the placements, not an artifact of the policy.
