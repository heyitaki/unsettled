# Unsettled self-play simulator

> **Operator's guide.** This file covers what you type: build, run, flags, config schema, which files a run writes, and how to extend the study.
>
> **The specification lives in [`.claude/specs/simulator/`](../.claude/specs/simulator/spec.md)** — invariants and guarantees in `contracts.md`, phase order and decisions in `programme.md`, unmodelled scoring surfaces in `gaps.md`, and the append-only measurement log in `measurements.md`. If a claim here and a claim there disagree, the spec wins.

The authoritative rosters of placement heuristics and policies are in [`contracts.md`](../.claude/specs/simulator/contracts.md).

## Build and test

```sh
RUSTFLAGS="-D warnings" cargo build --release
cargo test --workspace
cargo test --release -p unsettled-sim --test alloc
```

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

Observe one placement and policy playing every seat, and read setup-time diagnostics off the games:

```sh
cargo run --release -p unsettled-sim -- diagnose \
  --layout standard4 \
  --seats 4 \
  --domain tuning \
  --placement app_formula:placement/default-weights.json \
  --boards 2000 \
  --reps 2 \
  --policy heuristic-v1-trader-aware-threat-devcards-denial \
  --player-trading \
  --alpha 0.05 \
  --threads 0 \
  --out runs/diagnostic
```

`diagnose` has no field, no arms and no hero-seat rotation: every seat plays `--placement` and `--policy`. It plays `--boards` x `--reps` games on the board set an `evaluate` run at the same domain, layout and seat count would generate, seeding each game like that run's first hero-seat unit. `--layout`, `--seats`, `--domain`, `--policy`, `--threads`, `--alpha` and `--allow-unofficial` behave as they do for `evaluate`.

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

`app_formula:<path/to/weights.json>` loads the app's settlement formula at run time and reports it as `app_formula:<file-stem>`, so multiple weights files with distinct stems can be arms in the same run.

`<base>@<path/to/params.json>` works anywhere a policy name is accepted — `--policy`, `--arm-policy`, config files — and runs the base policy's trader-family dispatch with a full `HeuristicParams` vector loaded from the file. The file must carry every key and no others; the loader applies the shared domain guards and the building-band headroom check, so an inadmissible vector fails at load rather than running. The base must be a heuristic-family kind (`heuristic-v1-noports` and non-heuristic kinds are rejected). The contract is in [`contracts.md`](../.claude/specs/simulator/contracts.md) under "Policy params files".

`placement/` holds the committed parameter files: `default-weights.json` (the app's `DEFAULT_WEIGHTS`, drift-pinned by vitest), `policy-default-params.json` (`HeuristicParams::default()`, drift-pinned by a Rust test), `sweep-bounds.json` (the declared candidate range of every swept parameter, walked for completeness and endpoint admissibility by test), and the `phase-i-candidate-params.json` / `phase-i-candidate-weights.json` pair recording the Phase-H output the M-46 gate run adopted (the params file now equals the live defaults; the weights file is the pre-drop placement snapshot).

`placement/arms/` holds the committed measurement arms. Weights files (loaded via `app_formula:`): `spread_*` scale the `resourceValue` spread, `gpf_*` vary `genericPortFactor`, `flat_swamp` renormalizes an external formula's resource ratios to the same mean, and `h1_*` are the Phase-H placement-weight screen perturbations. Policy params files (loaded via `@`): `h2_*` and `h2x_*` are the policy-block screen arms, `h3_hand_zero` the `handValue` A/B arm (byte-identical to the live defaults since the M-46 handValue drop), and `h4_*` the combine and coordinate-pass vectors, `h4_final.json` being the eval-confirmed candidate.

`tools/capture-corpus.sh [out-dir]` captures the byte-exact behavior corpus that [`contracts.md`](../.claude/specs/simulator/contracts.md) requires before any engine change (four policies, both layouts, fixed seeds); diff a recapture against the pre-change capture to identify exactly which games moved.

Player trading is disabled by default. Set `RuleConfig::player_trading` to `Some(TradeConfig)` and use a trader-family policy to exercise it.

The `tournament`, `evaluate`, `diagnose`, and `simulate` commands enable the mechanism with `--player-trading`. Their optional `--opponent-gain-weight`, `--acceptance-temperature`, `--max-offers-per-turn`, `--hidden-vp-confidence`, `--embargo-danger-floor`, `--embargo-danger`, and `--embargo-takeover-danger` flags override the corresponding defaults and require `--player-trading`.

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

Each run writes `results.json`, `results.csv`, `meta.json`, and optionally JSONL. `evaluate` instead writes deterministic `evaluation.json` plus `meta.json`, with no CSV, and `diagnose` writes deterministic `diagnostics.json` plus `meta.json` the same way.

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
