# Unsettled self-play simulator

> **Operator's guide.** This file covers what you type: build, run, flags, config schema, which files a run writes, and how to extend the study.
>
> **The specification lives in [`.claude/specs/simulator/`](../.claude/specs/simulator/spec.md)**: invariants and guarantees in `contracts.md`, phase order and decisions in `programme.md` and `placement-programme.md`, unmodelled scoring surfaces in `gaps.md`, and the append-only measurement log in `measurements.md`. If a claim here and a claim there disagree, the spec wins.

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

`--layout` defaults to `standard4`; the corresponding default seat counts are four for `standard4` and six for `extension6`. `--policy`, `--threshold`, `--alpha`, and `--threads` default to `heuristic-v1`, `0.01`, `0.05`, and all logical cores, respectively (`--alpha` accepts only `0.10`, `0.05` or `0.01`); `--arm-policy` defaults every arm to `--policy`. As with tournament, non-official seat counts require `--allow-unofficial`.

`--domain tuning|eval|gate|tuning2|eval2|gate2|tuning3|eval3|gate3|tuning4|eval4|gate4` is required and has no default. The first nine are spent, so never run a command carrying one: the third generation was minted for the seat-count weights programme, which screened on `tuning3` and spent `eval3` and `gate3` once at each seat count from two to six. The fourth generation folds the seat count into its seed, so each seat count draws its own boards: `gate4` is spent at every seat count from two to six, on the seat-count programme's independent gate, and `tuning4` and `eval4` are unspent. The spend ledger is in [`programme.md`](../.claude/specs/simulator/programme.md) under "Seed-domain discipline", and the constants are in [`contracts.md`](../.claude/specs/simulator/contracts.md) under "Seed domains and seed derivation".

Each comparison in `evaluation.json` carries a `perHeroSeat` table beside its pooled numbers, indexed by seat. What it holds, and why it is record only, is in [`contracts.md`](../.claude/specs/simulator/contracts.md) under "Paired statistics".

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

It computes three fixed setup-time statistics, not a general diagnostics menu. **Coastal selection** replays every recorded setup pick against its best-scoring pip-matched alternative and reports how often the scorer took the lower hex count, with a board-clustered interval. **Expansion** reports, per completed settlement pair, the quartile win-rate gap of two-road expansion room (boxing) and of the share of pips on the pair's single highest-pip hex (blockability). Both are reported overall and per draft slot. **Lookahead accuracy** holds the draft-aware kind's opponent model against the games it was played in: for every recorded first settlement, the lookahead runs from the board as it stood before that pick, with the vertex the seat actually took, and its plan is compared with the trace. Its `lookahead` block reports `pickShare`, the share of intervening picks the model named exactly; `sequenceShare`, the share of first picks whose whole intervening sequence it named, counted over the picks that have one, because the seat picking last in the first round has nothing between its two settlements; and `secondShare`, the share of second settlements that landed where the lookahead planned. All three are reported overall and per draft slot as well. The statistic reads whatever `--placement` names, so a run on `app_formula:<weights>` is the control, where a tie-free greedy field must read 1 on all three, and a run on `app_formula_draft:<hero>@<opponent>` is the reading; a placement carrying no app formula produces no observations and the block reads zero. What each of them was preregistered for is in [`placement-programme.md`](../.claude/specs/simulator/placement-programme.md).

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

## Speed suite

`bench` measures placement, policy decisions, the adviser call, and whole-game throughput on both layouts (four seats on `standard4`, six on `extension6`). Use `--filter` to keep scenario IDs containing a substring.

```sh
cargo run --release -p unsettled-sim -- bench --quick
cargo run --release -p unsettled-sim -- bench --filter placement/standard4/ --calls 10 --repeats 5 --json /tmp/placement-bench.json
cargo run --release -p unsettled-sim -- bench --filter e2e/ --games 50 --threads 0
```

| Flag | Meaning |
| --- | --- |
| `--json <path>` | Write one JSON document instead of the stdout table. |
| `--filter <substring>` | Keep matching scenario IDs. |
| `--quick` | Default to one call, one repeat, and one game per e2e repeat, with no warm-up pass. Explicit counts take precedence. |
| `--calls <n>` | Fix calls per placement or decision repeat and disable automatic calibration. |
| `--min-pass-ms <n>` | Target duration for automatic calibration, default 20 milliseconds. |
| `--repeats <n>` | Measured repeats, default 5. Placement and decision rows warm up first; quick mode and e2e rows skip warm-up. |
| `--games <n>` | Games per e2e repeat, default 20. |
| `--threads <n>` | Workers for `e2e/*/all_cores` only. Default 0 uses all logical cores. |
| `--policy <spec>` | Measured policy, default `heuristic-v1-trader-aware-threat-devcards-denial`. Accepts the same `<base>@<params.json>` specs as other commands, except policies with rule-level effects such as `heuristic-v1-noports`. |
| `--weights <path>` | Measured app-formula weights, default `placement/default-weights.json`. Draft-aware opponents keep the shipped defaults. One file serves both layouts, so the `{seats}` placeholder is refused: pass a seat-specific file together with `--filter <layout>`. |

Without `--calls` or `--quick`, placement and decision rows automatically double calls from 1 until a pass reaches `--min-pass-ms` or 65,536 calls. The final calibration pass serves as warm-up, and the selected count is reported as `calls`.

All counts must be positive, and a `--filter` that matches no scenario is an error. Placement scenarios cover fresh board preparation, scores for every legal empty-board vertex, greedy picks at slots 0, halfway through round one, the first pick of round two, and the final pick, draft-aware first and middle picks, and a full draft. Earlier occupancy always comes from the default greedy formula.

Decision scenarios cover `pre_roll`, `action`, `discard`, `robber`, `respond_trade`, and `select_counterparty` at early, mid, and late stages, plus `action/long_road` and `action/full_hand`. The stages use 25%, 50%, and 75% of each reference game's length, rounded down to whole rounds. A scenario with no legal decision is reported as skipped, with a reason.

Advise scenarios time the app's adviser call, `advice.rs::advise`, from request JSON to response JSON, once per decision the app can ask about: `turn`, `pre_roll`, `discard`, `robber`, `trade_response`, and `produce`. `--policy` and `--weights` do not reach them, and the timing is native, not WebAssembly.

The table reports minimum and median nanoseconds per call, plus games per second for e2e rows. E2e games use the measured policy and draft-aware weights in every seat, with trading enabled.

JSON records `seed`, `policy`, `weights`, and the ordered `scenarios`. Measured rows include `calls`, `repeats`, `nsPerCallMin`, `nsPerCallMedian`, `stateHash`, and `decisionHash`; e2e rows also include `gamesPerSecond`. Skipped rows carry `reason`. What the two hashes guarantee, and when a row's timings do not compare, are contracts: see [`contracts.md`](../.claude/specs/simulator/contracts.md) under "Benchmark reporting".

After a change that moves `fixtures/bench-hashes.json`, delete it, publish it once in debug with `cargo test -p unsettled-sim --test bench_contract generate_bench_hashes -- --ignored --nocapture`, then run the same command with `--release` to verify it. The generator uses create-new and refuses to overwrite a differing or empty fixture.

`box/bench/` is a `box` job that builds two commits on one remote machine, times the suite on each in alternation, counts instructions per call under callgrind, and prints the ratio for every scenario. It needs the `box` CLI and the repo-root `box.json`, and unlike the commands above it is run from the repo root.

```sh
box run simulator/box/bench --ref base=main --ref cand=HEAD --node none
box run simulator/box/bench --ref base=HEAD --ref cand=HEAD --node none -- --weights placement/arms/flat_swamp.json
```

Arguments after `--` go to the candidate's runs only and may be `--policy` and `--weights`, so one commit under both names measures a weights or policy candidate and two commits measure a code change. Both commits must contain the suite, and a `--weights` path must be committed in the candidate. The joined rows are written to `summary.json` in the run directory. A ratio under 1 means the candidate is cheaper. `ONE SIDE ONLY` marks a scenario one commit measured and the other skipped; `STATES DIFFER` is explained in `contracts.md` under "Benchmark reporting".

## Placement and policy specs

`app_formula:<path/to/weights.json>` loads the app's settlement formula at run time and reports it as `app_formula:<file-stem>`, so multiple weights files with distinct stems can be arms in the same run. Its setup road follows `expansionWeight`: at 0 it scores each incident edge's far endpoint and breaks ties at random, as it always has; above 0, which the shipped vector has been since the SP6 adoption, it lays the first edge of the cheapest path to the best site the settlement opens, which is the direction the score just paid for, with ties broken deterministically. A settlement that opens nothing falls back to the far-endpoint rule either way.

`app_formula_draft:<path/to/hero.json>@<path/to/opponent.json>` runs that same formula draft-aware and reports it as `app_formula_draft:<hero stem>@<opponent stem>`. Its first settlement is not the greedy argmax: it puts each legal candidate down, replays every seat that picks between the hero's two settlements at its own argmax under the opponent weights, and ranks the candidate by its own marginal plus the best second settlement still legal once those rivals have picked. The second settlement is the plain argmax, because nothing the hero cares about follows it. The kind is deterministic and draws nothing from the RNG stream: settlement ties go to the lowest vertex index and road ties to the lowest edge id, where `app_formula` breaks both at random. Two paths rather than one so a measurement sweeps the hero's formula while the opponent model stays pinned to the field's weights. `setupDenialWeight` is read here and nowhere else: above 0 it also pays a candidate for what taking it costs each of those intervening rivals, priced as the rival's best score with the candidate free less its best with the candidate taken, floored at 0. It ships at 0, where no credit is formed.

Both placement specs replace every literal `{seats}` with the run's seat count before loading: `app_formula_draft:placement/seat-weights/seats-{seats}.json@placement/seat-weights/seats-{seats}.json` selects the shipped vectors for that count. The five generated seat files mirror `weightsForSeats(n)`: `seats-2.json`, `seats-3.json` and `seats-5.json` carry `coverageExponent` 1.0 and `diversityWeight` 3.2, and `seats-4.json` and `seats-6.json` carry `coverageExponent` 1.0.

`<base>@<path/to/params.json>` works anywhere a policy name is accepted — `--policy`, `--arm-policy`, config files — and runs the base policy's trader-family dispatch with a full `HeuristicParams` vector loaded from the file. The file must carry every key and no others; the loader applies the shared domain guards and the building-band headroom check, so an inadmissible vector fails at load rather than running. The base must be a heuristic-family kind (`heuristic-v1-noports` and non-heuristic kinds are rejected). The contract is in [`contracts.md`](../.claude/specs/simulator/contracts.md) under "Policy params files".

`placement/` holds the committed parameter files: `default-weights.json` (the app's `DEFAULT_WEIGHTS`, drift-pinned by vitest), `policy-default-params.json` (`HeuristicParams::default()`, drift-pinned by a Rust test), `sweep-bounds.json` (the declared candidate range of every swept parameter, walked for completeness and endpoint admissibility by test), the `phase-i-candidate-params.json` / `phase-i-candidate-weights.json` pair recording the Phase-H output the M-46 gate run adopted (the params file now equals the live defaults; the weights file is the pre-drop placement snapshot), and the `sp6-candidate-weights.json` / `sp6-pre-adoption-weights.json` pair recording the SP6 output the M-66 gate run adopted (the candidate file now equals the live defaults; the pre-adoption file is the vector every SP-family arm perturbs and every M-61 through M-66 reading was taken against, which is the live defaults with `expansionWeight` back at 0).

`placement/arms/` holds the committed measurement arms. Weights files (loaded via `app_formula:`): `spread_*` scale the `resourceValue` spread, `gpf_*` vary `genericPortFactor`, `flat_swamp` renormalizes an external formula's resource ratios to the same mean, `h1_*` are the Phase-H placement-weight screen perturbations, `h3_hand_zero` is the `handValue` A/B arm (the Phase-I weights snapshot with the drop applied, byte-identical to `sp6-pre-adoption-weights.json`), `sp2a_devcard` / `sp2b_portdeficit` are the SP2 term arms and `sp3_*` the SP3 ones, each with its own new weight raised from its then-shipped 0, `sp4_*` are the SP4 slot profiles with only the four-seat `slotScales` diversity leaves moved off 1.0, `sp5_*` are the SP5 denial arms with `setupDenialWeight` alone raised, and `sp6_*` are the SP6 re-screen arms across the expansion, decay, concentration and diversity axes; the SP5 and SP6 arms are loaded on the hero path of an `app_formula_draft:` spec, which for SP5 is the only kind that reads its key and for SP6 is the reference field. The twelve `sc_*` arms are single-parameter seat-count screening perturbations anchored to the live `default-weights.json`. `sc_s<n>_combined.json` carries every surviving `sc_*` value at `n` seats at once. Policy params files (loaded via `@`): `h2_*` and `h2x_*` are the policy-block screen arms, `h4_*` the combine and coordinate-pass vectors with `h4_final.json` the eval-confirmed candidate, `sp1e_*` the SP1e knight-and-threat sweep arms (two per axis, at its declared `sweep-bounds.json` endpoints), and `sp1r_*` the M-51 re-screen arms (one per axis M-46 adopted, put back to its pre-adoption value).

Which baseline each `h*`, `sp*` and `sc_*` family is bracketed around, and the test pinning each, are in [`contracts.md`](../.claude/specs/simulator/contracts.md) under "Weights files". An arm re-run against a field it was not measured against is not the measurement its name records.

`tools/capture-corpus.sh [out-dir]` captures the byte-exact behavior corpus that [`contracts.md`](../.claude/specs/simulator/contracts.md) requires before any engine change (four policies, both layouts, fixed seeds); diff a recapture against the pre-change capture to identify exactly which games moved.

Player trading is disabled by default. Set `RuleConfig::player_trading` to `Some(TradeConfig)` and use a trader-family policy to exercise it.

The `tournament`, `evaluate`, `diagnose`, and `simulate` commands enable the mechanism with `--player-trading`. Their optional `--opponent-gain-weight`, `--acceptance-temperature`, `--max-offers-per-turn`, `--hidden-vp-confidence`, `--embargo-danger-floor`, `--embargo-danger`, and `--embargo-takeover-danger` flags override the corresponding defaults and require `--player-trading`.

`--allow-unofficial` permits non-official seat counts.

`--jsonl` writes deterministic per-game records and is off by default.

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

A new component of that formula has to land on both sides at once, because the parity fixture compares them: the weight in `src/engine/weights.ts` and in `EngineWeights` (field plus `validate`), the component in `ScoreBreakdown` and its total in each language, the term in the scoring entry, a range in `placement/sweep-bounds.json`, the new key at its shipped default in every weights-shaped file under `placement/`, and a `W` class in `tools/generate-placement-parity.ts` carrying a witness weight, since a component that ships at 0 is invisible to the fixture. A component that reads the board around the candidate rather than only the seat's own holdings, as SP3's `expansion` does in `crates/engine/src/placement/expansion.rs`, belongs in the occupancy-aware entries `AppFormulaScorer::breakdown_for_owner` and `marginal_total_for_owner`; the holdings-list entries beside them carry no occupancy and price none of it.

Rule changes belong in `RuleConfig`, `BuildableSpec`, or `PlayerModifiers`. Parameter-only changes flatten into per-player cost and trade-rate tables. `RuleConfig::player_trading` is the default-off gate for player offers and carries the responder model's swept parameters. Port changes use `PortRule`; `heuristic-v1-noports` is exactly this mechanism applied to itself, declaring a `PortSelector::All` / `PortAction::Disable` rule via `PolicyKind::port_rules` so the seat's flattened trade rates fall back to the bank rate. A "ports removed" curse would be the same rule reached through `PlayerModifiers` instead. A behavioral boon or curse has no seam yet: the uninhabited effect enum and its hooks were removed, so one has to be added at the pre-roll, production, build or trade site.

The seams a policy-level gate must use, and where derived state belongs, are contracts — see [`contracts.md`](../.claude/specs/simulator/contracts.md).
