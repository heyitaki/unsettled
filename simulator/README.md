# Unsettled self-play simulator

> **Operator's guide.** This file covers what you type: build, run, flags, config schema, which files a run writes, and how to extend the study.
>
> **The specification lives in [`.claude/specs/simulator/`](../.claude/specs/simulator/spec.md)** — invariants and guarantees in `contracts.md`, phase order and decisions in `programme.md`, unmodelled scoring surfaces in `gaps.md`, and the append-only measurement log in `measurements.md`. If a claim here and a claim there disagree, the spec wins.

`unsettled-sim` supports six built-in starting-placement heuristics, and post-placement policies including optional player-to-player trading, threat-aware robber placement, and threat-aware trading.

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

`--threads 0` selects all logical cores.

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

`--layout` defaults to `standard4`; the corresponding default seat counts are four for `standard4` and six for `extension6`. `--policy`, `--threshold`, `--alpha`, and `--threads` default to `heuristic-v1`, `0.01`, `0.05`, and all logical cores, respectively; `--arm-policy` defaults every arm to `--policy`. As with tournament, non-official seat counts require `--allow-unofficial`.

`--domain tuning|eval|gate` is required and has no default.

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

`app_formula:<path/to/weights.json>` loads the app's settlement formula at run time and reports it as `app_formula:<file-stem>`, so multiple weights files with distinct stems can be arms in the same run. `placement/arms/` holds single-parameter perturbations of the default weights — `spread_*` scale the `resourceValue` spread, `gpf_*` vary `genericPortFactor`, `flat_swamp` is an external formula's resource ratios renormalized to the same mean.

Player trading is disabled by default. Set `RuleConfig::player_trading` to `Some(TradeConfig)` and use a trader-family policy to exercise it. `TradeConfig` exposes `opponent_gain_weight`, `acceptance_temperature`, `max_offers_per_turn`, and `hidden_vp_confidence`.

The `tournament`, `evaluate`, and `simulate` commands enable the mechanism with `--player-trading`. Their optional `--opponent-gain-weight`, `--acceptance-temperature`, `--max-offers-per-turn`, and `--hidden-vp-confidence` flags override the corresponding defaults and require `--player-trading`.

`--allow-unofficial` permits non-official seat counts.

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

Each run writes `results.json`, `results.csv`, `meta.json`, and optionally JSONL. `evaluate` instead writes deterministic `evaluation.json` plus `meta.json`, with no CSV.

What each artifact contains, and the determinism guarantees, are contracts — see [`contracts.md`](../.claude/specs/simulator/contracts.md).

## Board ingestion and topology

Topology packs are generated by the app's own geometry helpers and committed:

```sh
npx tsx tools/generate-topology.ts
```

## Extending the study

To add a built-in placement heuristic, add a `PlacementKind` entry and name mapping in `crates/engine/src/placement/mod.rs`, then supply its vertex-score preset or implementation. The CLI registry and result keys use that stable name. The parameterized app formula lives in `crates/engine/src/placement/app_formula.rs`; the CLI loads each weights file, registers its stable file-stem name, and prepares its board-fixed port reach and scarcity context before games start.

Rule changes belong in `RuleConfig`, `BuildableSpec`, or `PlayerModifiers`. Parameter-only changes flatten into per-player cost and trade-rate tables. `RuleConfig::player_trading` is the default-off gate for player offers and carries the responder model's swept parameters. Port changes use `PortRule`; `heuristic-v1-noports` is exactly this mechanism applied to itself, declaring a `PortSelector::All` / `PortAction::Disable` rule via `PolicyKind::port_rules` so the seat's flattened trade rates fall back to the bank rate. A "ports removed" curse would be the same rule reached through `PlayerModifiers` instead. A behavioral boon or curse adds an `Effect` variant and handles it at the pre-roll, production, build, or trade hook.

The seams a policy-level gate must use, and where derived state belongs, are contracts — see [`contracts.md`](../.claude/specs/simulator/contracts.md).
