# Measurements

Class **M**: numbers produced by runs. See [spec.md](spec.md) for the class rules.

**This file is append-only.** Add entries; never edit one. An entry a later run supersedes stays, and the later entry says so. That is what makes a measurement trustworthy without a test, and what keeps the file conflict-free below its last entry.

Every entry carries date, commit, domain, exact command, load before and after, and admissible yes or no. **Fields the source did not record are written `unknown` and were not reconstructed** — this file was extracted from `simulator/README.md`, which carried readings without full provenance, and inventing a field here would be permanent.

## Machine

Measured on the acceptance machine with Rust 1.94.0, 18 logical cores (6 performance, 12 efficiency), release mode, standard4.

**The median-of-consecutive-runs rule applies to the throughput entries only** (M-05 through M-12). Throughput is noisy: any sample taken while another job holds a core is meaningless and reads 20-30% low, so those entries report the median of consecutive runs. The paired A/B entries (M-01 through M-03) report a single evaluation over a fixed unit schedule and are not medians; their sensitivity to machine load is a question of wall-clock, not of the estimate.

---

## M-01 — Phase G1 placement A/B

- **Date** `unknown` · **Commit** `unknown` · **Domain** `tuning` · **Admissible** no (load not recorded)
- **Command** `unknown`
- **Load** before `unknown`, after `unknown`

The Phase-G1 `tuning`-domain sanity check compared hero-seat `heuristic-v1-threat` with `heuristic-v1` against a `heuristic-v1` field over 1,600 paired units. It was `inconclusive`: estimate `0.015625`, selected McNemar interval `[-0.006240397838515523, 0.03749039783851552]`, `b = 172`, `c = 147`, 40 clusters, `clusteredDegenerate = false`; base and candidate win rates were `0.254375` and `0.27`, with zero illegal actions. This is a tuning-domain sanity check, not an adoption decision.

## M-02 — Phase G2 dev-card A/B

- **Date** `unknown` · **Commit** `unknown` · **Domain** `tuning` · **Admissible** no (loaded machine)
- **Command** `cargo run --release -p unsettled-sim -- evaluate --layout standard4 --seats 4 --domain tuning --field pip_diversity --arm base=pip_diversity --arm cand=pip_diversity --arm-policy cand=heuristic-v1-devcards --reference base --boards 40 --reps 10 --policy heuristic-v1 --threads 0`
- **Load** before `3.95`, after `3.79`

It was `inconclusive`: estimate `0.01375`, selected clustered interval `[-0.0002801098941004835, 0.027780109894100485]`, `b = 68`, `c = 46`, `n = 1600`, 40 clusters, `clusteredDegenerate = false`; base and candidate win rates were `0.254375` and `0.268125`, with zero illegal actions. This is a loaded-machine tuning-domain sanity check, not an adoption decision.

## M-03 — Phase G3 trading A/B

- **Date** `unknown` · **Commit** `unknown` · **Domain** `tuning` · **Admissible** no (loaded machine)
- **Command** `unknown`
- **Load** before `9.20 / 7.82 / 6.80`, after `11.08 / 8.44 / 7.07`

The Phase-G3 `tuning`-domain sanity check compared hero-seat `heuristic-v1-trader-aware` with `heuristic-v1-trader` against a `heuristic-v1-trader` field over 1,600 paired units. It was `inconclusive`: estimate `0.008125`, selected clustered interval `[-0.024196292516335795, 0.040446292516335795]`, McNemar interval `[-0.018849393050608506, 0.03509939305060851]`, `b = 249`, `c = 236`, 40 clusters, `clusteredDegenerate = false`; base and candidate win rates were `0.246875` and `0.255`, with zero illegal actions. This is a loaded-machine tuning-domain sanity check, not an adoption decision.

## M-04 — G3 scalar flat-group counts

- **Date** `unknown` · **Commit** `unknown` · **Domain** `unknown` · **Admissible** not applicable (a count, not a timing)
- **Command** `unknown`
- **Load** before `unknown`, after `unknown`

The G3 scalar left no completely flat acceptor-selection groups in 16,283 measured groups. Proposal scoring retained 5 flat mine-only proxy groups out of 1,884 (0.265%) and 1 flat final-score group out of 875 (0.114%), with two groups tied at the best score.

## M-05 — G3 throughput, admissible quiet-machine reading

- **Date** `unknown` · **Commit** `unknown` · **Domain** not applicable · **Admissible** **yes**
- **Command** `unknown`
- **Load** before `1.45`, after `2.00`

Median B/A of `0.830805` against its `0.50` gate and median D/A of `0.515988` against its `0.70` gate. The G3 throughput gate therefore remains a failure at its registered all-seat threshold, and the all-seat regression is a real design finding rather than a contention artifact. The admissible D/A lands inside the earlier `0.508`–`0.524` band and confirms that enabling `-aware` for every seat costs roughly 2x per seat. This affects measurement configurations only because the gate defaults off.

## M-06 — G3 throughput, loaded reading 1

- **Date** `unknown` · **Commit** `unknown` · **Domain** not applicable · **Admissible** no
- **Command** `unknown` · **Load** before `10.51`, after `unknown`

Hero-only B/A `0.830`, all-seat D/A `0.508`. Absolute reading inadmissible.

## M-07 — G3 throughput, loaded reading 2

- **Date** `unknown` · **Commit** `unknown` · **Domain** not applicable · **Admissible** no
- **Command** `unknown` · **Load** before `5.32`, after `unknown`

Hero-only B/A `0.834`, all-seat D/A `0.524`. Absolute reading inadmissible.

## M-08 — G3 throughput, loaded reading 3

- **Date** `unknown` · **Commit** `unknown` · **Domain** not applicable · **Admissible** no
- **Command** `unknown` · **Load** before `5.06`, after `unknown`

Hero-only B/A `0.828`, all-seat D/A `0.517`. Absolute reading inadmissible.

## M-09 — G3 throughput, loaded reading 4

- **Date** `unknown` · **Commit** `unknown` · **Domain** not applicable · **Admissible** no
- **Command** `unknown` · **Load** before `4.57`, after `unknown`

Hero-only B/A `0.828`, all-seat D/A `0.516`. Absolute reading inadmissible.

## M-10 — G3 throughput, loaded reading 5

- **Date** `unknown` · **Commit** `unknown` · **Domain** not applicable · **Admissible** no
- **Command** `unknown` · **Load** before `2.12`, after `unknown`

Hero-only B/A `0.831`, all-seat D/A `0.516`. Absolute reading inadmissible.

> **Provenance correction, made at creation.** This reading's raw output was recorded under a file named `g3-throughput-quiet.txt` in an untracked solve-artifact directory. The name is misleading: this is a **loaded** reading at pre-run load `2.12`, not the admissible quiet-machine reading, which is M-05. The source sentence attached the filename to the fifth loaded run correctly but the filename itself invites the opposite reading. Recorded here once, correctly, because an append-only file must not receive a knowingly misleading entry even transiently. The directory is untracked and will not exist in a fresh clone.

## M-11 — Throughput by worker count

- **Date** `unknown` · **Commit** `unknown` · **Domain** not applicable · **Admissible** `unknown`
- **Command** `unknown` · **Load** before `unknown`, after `unknown`

| Mode | Workers | Games/sec |
| --- | ---: | ---: |
| Single core | 1 | ~1,295 |
| All cores | 18 | ~12,100 |

## M-12 — Parallel scaling shape

- **Date** `unknown` · **Commit** `unknown` · **Domain** not applicable · **Admissible** `unknown`
- **Command** `unknown` · **Load** before `unknown`, after `unknown`

Scaling is near-linear to 8 workers (8.2x) and then flattens as work lands on efficiency cores.

## M-13 — Held-out policy strength

- **Date** `unknown` · **Commit** `unknown` · **Domain** `eval` · **Admissible** `unknown`
- **Command** `unknown` · **Load** before `unknown`, after `unknown`

On the held-out policy evaluation seeds, `priority-trader` won 85.5% against `random-legal` and 79.8% against `greedy-no-trade`; its latter 95% Wilson lower bound was 77.2%. `heuristic-v1` won 99.5% against `random-legal`, 95.0% against `greedy-no-trade`, and 34.65% against `priority-trader`; the last result's 95% Wilson lower bound was 32.6%.

That last margin is narrower than it once was because `priority-trader` got stronger, not because `heuristic-v1` got weaker: both policies previously refused to play a knight unless holding a spare, which made Largest Army unreachable for either of them. Fixing the comparator is what a comparator is for.

## M-14 — Acceptance placement rankings

- **Date** `unknown` · **Commit** `unknown` · **Domain** `unknown` · **Admissible** `unknown`
- **Command** `unknown` · **Load** before `unknown`, after `unknown`

The 7,500-game acceptance placement rankings under `heuristic-v1`, its no-ports ablation, and `priority-trader` share the same top two, `pip_diversity` and `port_synergy`, with pairwise Spearman correlations of 0.9429, 0.9429, and 0.8286. Those two are close enough to trade places between runs -- a 5,000-game standard4 tournament put `port_synergy` at 0.3574 [0.3442, 0.3708] and `pip_diversity` at 0.3536 [0.3405, 0.3670], overlapping confidence intervals -- so treat them as a tied leading pair rather than a strict order. The gap to third (`city_focus`, 0.2752) is unambiguous, as is the gap from every heuristic to `random` (0.0216). `port_synergy` holding second place under a policy that cannot use ports at all is therefore evidence about the placements, not an artifact of the policy.

## M-15 — Provenance for M-01 through M-10, supplied by a later entry

- **Date** 2026-07-28 · **Commit** `d52bf0b` · **Domain** not applicable · **Admissible** not applicable (an attribution, not a reading)
- **Command** not applicable
- **Load** not applicable

M-01 through M-10 were extracted from `simulator/README.md`, which recorded the readings without full provenance, so their commit and date fields are the literal `unknown` and the extraction run was forbidden from reconstructing them. This entry supplies the mapping from the session records that produced them. It does not correct or supersede any reading; every number in M-01 through M-10 stands exactly as written.

Each reading was taken during the `/solve` run that produced the phase it names, against that phase's merge commit:

| Entries | Phase | Merge commit | Merged | Run directory |
| --- | --- | --- | --- | --- |
| — | E and F, belief state and ETW | `e69a96a` | 2026-07-26 | `sim-belief-etw` |
| M-01 | G1, threat-aware robber placement | `9680d2a` | 2026-07-27 | `sim-g1-threat-robber` |
| M-02 | G2, belief-aware monopoly and dev-card timing | `b9756fd` | 2026-07-27 | `sim-g2-monopoly-dev-timing` |
| M-03, M-04, M-05 through M-10 | G3, threat-aware trade selection | `d5b991f` | 2026-07-28 | `sim-g3-trade-selection` |

Run directories are under `.claude/solves/`, which is ignored and will not exist in a fresh clone; they are named for traceability within a working checkout, not offered as citable artifacts. The commands for M-01, M-03 and M-05 through M-10 remain `unknown` — they were not recorded anywhere durable, and this entry supplies only what the session records actually carry.

## M-16 — Contestedness of counterparty selection

- **Date** `unknown` · **Commit** `unknown` (pre-dates G1; taken during the Phase-D review) · **Domain** `unknown` · **Admissible** not applicable (a count, not a timing)
- **Command** `unknown`
- **Load** not applicable

Over 20,411 resolutions with at least one acceptor on 6-seat `extension6`, counterparty selection was uncontested — exactly one acceptor — in 71.5% of cases. Of the 5,819 contested resolutions, 33.8% tied at the minimum estimate.

This bounds the prize on selection sophistication and was known before G3 was designed. It is not an argument against the belief state, whose larger consumers are the robber, monopoly and goal switching rather than counterparty choice. Carried here from project memory during SIM-SPEC-F2; the original run was not recorded with provenance and none was reconstructed.

## M-17 — G2 Hold firing rates

- **Date** `unknown` · **Commit** `b9756fd` · **Domain** `tuning` · **Admissible** not applicable (a rate, not a timing)
- **Command** `unknown`
- **Load** `unknown`

The Hold option introduced by G2's scalar pre-roll comparison fired on `0.117` and `0.038` of playable opportunities across the two measured configurations. Recorded because the arm's A/B was inconclusive (M-02) and the rates establish that the arm did not simply stop playing dev cards, which is the failure mode an inconclusive result would otherwise be consistent with. Carried here from project memory during SIM-SPEC-F2.

## M-18 — Where the all-seat `-aware` slowdown actually goes

- **Date** 2026-07-28 · **Commit** `46a7c00` · **Domain** not applicable · **Admissible** **yes** for the ratio and the call counts, **indicative** for the profile shares
- **Command** `simulate --board ../src/parser/__tests__/expected/board-draft-empty.json --games 1500 --heuristics pip_diversity --policy <policy> --player-trading --seed 7 --threads 1`, with `<policy>` `heuristic-v1-trader` and `heuristic-v1-trader-aware`. Profiles taken with `/usr/bin/sample` over an 8-second window, 2 seconds into a 20,000-game run of each.
- **Load** before `2.35`, after `2.66`

Single-threaded and therefore far less load-sensitive than the M-05 through M-10 readings; three consecutive runs of each arm spread under 1%. This entry **does not supersede M-05**, which measured a different board at `--threads 0`; it diagnoses the effect M-05 recorded.

**Wall clock.** Baseline median `1.94s`, all-seat `-aware` median `3.45s`, a ratio of `1.778`. Adding atomic instrumentation counters changed the `-aware` median by `0.01s`, so the counts below were taken without distorting the timing.

**Call counts**, 400 games, `-aware`, single-threaded. The baseline arm makes **zero** calls to any of these, so the whole of this volume is introduced by the gate:

| Counter | Calls |
| --- | ---: |
| `expected_turns_to_win` | 3,159,429 |
| `cheapest_route_shortfall` | 1,947,691 |
| `counterparty_score` | 866,094 |
| proposal decisions entered | 234,827 |
| recipient inputs prepared | 897,219 |
| proposal inner scorings | 714,599 |
| candidate offers scored (`mine`) | 970,780 |
| `acceptance_margin` | 110,817 |
| `select_counterparty` | 30,045 |

The accounting closes exactly with no residue, which is what makes the attribution trustworthy: `cheapest_route_shortfall` equals `mine` plus `counterparty_score` plus `acceptance_margin`, and `expected_turns_to_win` equals that total plus `counterparty_score` plus `acceptance_margin` plus one own-base call per decision.

**Profile shares of worker time**, base against `-aware`, self time grouped by module:

| Group | Base | `-aware` |
| --- | ---: | ---: |
| Longest Road | 46.1% | 41.6% |
| `DecisionView` | 24.4% | 20.0% |
| Placement and heuristic scoring | 23.7% | 16.7% |
| ETW, threat and trading | 0.0% | 13.7% |
| Other | 5.8% | 8.0% |

**Attribution of the slowdown**, normalizing base total time to 1.0 and `-aware` to 1.778:

| Group | Added | Share of the slowdown |
| --- | ---: | ---: |
| Longest Road | 0.279 | 35.8% |
| ETW, threat and trading | 0.244 | 31.3% |
| `DecisionView` | 0.112 | 14.3% |
| Other | 0.084 | 10.8% |
| Placement and heuristic scoring | 0.060 | 7.7% |

So under a third of the added cost is the new code. Mean turns rise from `66.62` to `71.69`, `+7.6%`, and mean final VP *falls* from `7.0004` to `6.8203`, so `-aware` games run longer and end lower — they leave fuller boards, and the Longest Road trail search grows superlinearly in roads placed. Turn count alone accounts for only a small part of the Longest Road increase; the rest is per-decision cost on a fuller board.

**Microbenchmark.** `expected_turns_to_win` costs about `14ns` per call on hot cache over 5,000,000 calls across 64 varied inputs. At the call volume above that is a small fraction of the gap, which is what first ruled the ETW arithmetic out as the cause.

**Ablations, all refuting a candidate cause.** Stubbing `cheapest_route_shortfall` to return zeroes moved the `-aware` median by about `0.05s` of a `1.51s` gap. Replacing the O(vertex-count) `settlements_on_board` scan in `inputs_for_seat` with a constant produced no measurable change. Both ablations change behaviour and so diverge from the real game; they are reported as order-of-magnitude bounds on a cause, never as timings of the real configuration.

## M-19 — G4 denial tuning-domain A/B

- **Date** 2026-07-28 · **Commit** uncommitted G4 working tree based on `1e353eb` · **Domain** `tuning` · **Admissible** **yes as a tuning-domain sanity check; no as an adoption decision**
- **Command** `cargo run --release --manifest-path simulator/Cargo.toml -p unsettled-sim -- evaluate --layout standard4 --seats 4 --domain tuning --field pip_diversity --arm base=pip_diversity --arm cand=pip_diversity --arm-policy cand=heuristic-v1-denial --reference base --boards 40 --reps 10 --policy heuristic-v1 --threads 0 --out .claude/solve-artifacts/ab-denial`
- **Load** before `4.16 3.92 3.37`, after `4.16 3.92 3.37`

The run fully crossed 40 boards, 10 repetitions, and four hero seats: 1,600 paired units and 3,200 games, with zero illegal actions. The reference won 407 games (`0.254375`) and the denial arm won 417 (`0.260625`). The paired difference was `+0.00625`, with 46 candidate-only wins and 36 reference-only wins. The selected board-clustered interval was `[-0.0061247758, 0.0186247758]`, so the preregistered verdict was `inconclusive`.

This is a tuning-domain reading of unswept Phase-H placeholders. Neither `eval` nor `gate` was spent.

## M-20 — G4 fixed-decision cost and Longest Road heat

- **Date** 2026-07-28 · **Commit** uncommitted G4 working tree based on `1e353eb` · **Domain** not applicable · **Admissible** **yes as a same-state per-decision observation; indicative for the trail-search counter**
- **Command** five consecutive `cargo test --release -p unsettled-sim --test denial_gate denial_arm_per_decision_cost_is_reported -- --exact --ignored --nocapture` runs; trail-search count from `cargo test --release -p unsettled-engine policy::denial::tests::denial_arm_road_network_heat_is_reported -- --exact --ignored --nocapture`
- **Load** fixed-decision runs before `3.50 3.69 3.37`, after `3.19 3.62 3.34`; trail-search count before `2.48 3.41 3.23`, after `5.09 3.95 3.43`

The timing fixture first produced one deterministic truncated real game, then called the action policy exactly 50,000 times per arm on the same `DecisionView`. Across five consecutive runs, the median was `495.428ns` per decision gate off and `951.822ns` gate on, a ratio of `1.921` (`+92.1%`). The first run after compilation was the widest outlier; the four warm repeats preserve the ordering.

The separate in-crate hook count ran 200 complete games per arm. Gate off built `67,740` road networks over `88,035` approximate turn-seat decisions (`0.769467` per decision); gate on built `69,777` over `86,830` (`0.803605` per decision), `+4.4%`. The gated arm therefore did make the Longest Road trail-search substrate hotter. This is a new G4 observation, not a re-test of the three causes already refuted by M-18.

No all-seat games-per-second floor is registered for G4: that would mix changed game length with code efficiency. Phase H still owns the affordability-gate decision for the full tuning grid.

## M-21 — Composite arm: do the four G consumers compound?

- **Date** 2026-07-29 · **Commit** `5398f61`, tree clean, no simulator code change · **Domain** `tuning` · **Admissible** **yes as a tuning-domain result; no as an adoption decision**
- **Command** `cargo run --release --manifest-path simulator/Cargo.toml -p unsettled-sim -- evaluate --layout standard4 --seats 4 --domain tuning --field pip_diversity --arm <label>=pip_diversity ... --arm-policy <label>=<policy> ... --reference <label> --boards 400 --reps 10 --policy <field> --threads 0 --out <dir>`, with `<field>` `heuristic-v1` for the plain runs and `heuristic-v1-trader --player-trading` for the trader runs. The built binary was invoked directly after one `cargo build --release`; the form above is the reproducible equivalent. Raw artifacts sit under the ignored solves directory in a working checkout, named `sim-composite-arm`, alongside the preregistration written before the scaled runs.
- **Load** plain run before `4.02 3.42 3.06`, after `4.02 3.42 3.06`; trader run before `3.87 3.42 3.07`, after `5.56 3.78 3.20`. Paired estimates over a fixed schedule, so load bears on wall clock and not on the estimate.

Answers the question `programme.md` posed after the fourth `inconclusive` single: whether four small positive estimates mean the consumers are individually under-powered or that the programme is not paying against this field. **It is the first.** Every run below is 400 boards x 10 reps x 4 hero seats — 16,000 paired units, 400 clusters, ten times the schedule M-01 through M-19 used — with zero illegal actions throughout.

**Harness identity, established before anything was scaled.** At the earlier entries' own 40-board schedule this invocation reproduces every recorded single exactly: `threat` b 172 c 147, `devcards` b 68 c 46, `trader-aware` b 249 c 236, `denial` b 46 c 36, and both reference win rates. So M-21 refines those entries by precision and contradicts none of them. Boards derive from `mix64(domain_seed ^ board_index)`, so the 400-board set is a strict superset of the 40-board set rather than a different sample.

**Trader field** (`heuristic-v1-trader`, the field M-03 used, and the only one on which all four gates can be on at once). Reference win rate `0.247812`.

| Arm | Estimate | b | c | Selected interval | Verdict |
| --- | ---: | ---: | ---: | --- | --- |
| all four gates | **`+0.068000`** | 3081 | 1993 | clustered `[+0.058189, +0.077811]` | **better** |
| `threat` `devcards` `denial`, no trade gate | `+0.022750` | 1986 | 1622 | clustered `[+0.015031, +0.030469]` | better |
| `aware` alone | `+0.024625` | 2565 | 2171 | clustered `[+0.015539, +0.033711]` | better |
| `devcards` alone | `+0.013938` | 576 | 353 | clustered `[+0.010184, +0.017691]` | better |
| `threat` alone | `+0.009562` | 1747 | 1594 | clustered `[+0.002027, +0.017098]` | inconclusive |
| `denial` alone | `+0.001437` | 553 | 530 | McNemar `[-0.002594, +0.005469]` | **equivalent** |

The composite reaches a `0.315812` hero win rate against a four-seat field whose reference seat wins `0.247812`. Paired directly against each other, the three non-trade gates and the trade gate alone are indistinguishable: `+0.001875`, clustered `[-0.007329, +0.011079]`, `inconclusive`. One gate is worth as much as the other three combined.

**The compounding is super-additive, and measured as paired increments rather than inferred by subtraction.** Summing the four standalone estimates gives `0.049562`, which lies below the composite's interval. Two paired increment runs confirm it directly: adding the trade gate on top of the other three is worth `+0.045250`, clustered `[+0.035698, +0.054802]`, against `+0.024625` standalone; adding the other three on top of the trade gate is worth `+0.043375`, clustered `[+0.035239, +0.051511]`, against `+0.022750` standalone. Both pairs of 95% intervals fail to overlap. These are correlated paired estimates over shared units rather than independent samples, so non-overlap is read as strong but not as a formal test.

**Leave-one-out on the trader field, exploratory and outside the preregistered design.** Each row is the paired value of adding one gate to the other three.

| Gate added to the other three | Marginal | Selected interval | Verdict | Standalone |
| --- | ---: | --- | --- | ---: |
| `aware` (G3) | `+0.045250` | clustered `[+0.035698, +0.054802]` | better | `+0.024625` |
| `threat` (G1) | `+0.021937` | clustered `[+0.013616, +0.030259]` | better | `+0.009562` |
| `devcards` (G2) | `+0.019813` | McNemar `[+0.015121, +0.024504]` | better | `+0.013938` |
| `denial` (G4) | `+0.003312` | McNemar `[-0.001748, +0.008373]` | **equivalent** | `+0.001437` |

Three of the four gates roughly double in value inside the composite. The fourth does not move.

**Plain field** (`heuristic-v1`, the field M-01, M-02 and M-19 used), full 2^3 factorial over the three gates that field admits. Reference win rate `0.252250`.

| Arm | Estimate | b | c | Selected interval | Verdict |
| --- | ---: | ---: | ---: | --- | --- |
| `threat` + `devcards` + `denial` | `+0.026687` | 1945 | 1518 | McNemar `[+0.019491, +0.033884]` | better |
| `threat` + `devcards` | `+0.024250` | 1891 | 1503 | McNemar `[+0.017123, +0.031377]` | better |
| `devcards` + `denial` | `+0.017750` | 887 | 603 | clustered `[+0.013012, +0.022488]` | better |
| `threat` + `denial` | `+0.012688` | 1735 | 1532 | McNemar `[+0.005689, +0.019686]` | inconclusive |
| `devcards` | `+0.011312` | 562 | 381 | clustered `[+0.007378, +0.015247]` | inconclusive |
| `threat` | `+0.009875` | 1666 | 1508 | McNemar `[+0.002975, +0.016775]` | inconclusive |
| `denial` | `+0.002750` | 404 | 360 | clustered `[-0.000665, +0.006165]` | **equivalent** |

Here the three gates are close to additive — the standalone estimates sum to `0.023937` against a composite of `0.026687` — so the super-additivity above is specific to the field in which trading exists. Denial's paired increment on top of `threat` + `devcards` is `+0.002437`, clustered `[-0.001174, +0.006049]`, `equivalent`: indistinguishable from its standalone value, so it does not compound on this field either.

**The denial result is a finding, not a null.** `equivalent` is a positive statement that the effect is confidently smaller than the `0.01` threshold, which `inconclusive` at 1,600 units was not. Three independent reads agree: standalone on the trader field, standalone on the plain field, and marginal inside the full composite. M-19 stands as recorded; at ten times the units the same arm resolves from `inconclusive` to `equivalent` and its point estimate falls.

**Estimates at 16,000 units run below their 1,600-unit counterparts** for `threat`, `devcards` and `denial`, and above for `aware`. The earlier entries are single evaluations over a 40-board schedule and were never medians; the movement is precision, not disagreement.

## M-22 — SIM-BATCH1 marginal vertex valuation

- **Date** 2026-07-30 · **Commit** uncommitted SIM-BATCH1 working tree based on `35a1738e`, with the captured unrelated parser and UI baseline still present · **Domain** `tuning` · **Admissible** **yes as a tuning-domain attribution and fixed-state timing observation; no as an adoption decision**
- **Preregistration** a `preregistration.md` beside the run artifacts in the ignored, since-deleted solve-artifacts working directory (no longer recoverable), written before every scaled run. The Stage 0 identity preflight preceded the behavioural edit and reproduced M-21's 40-board discordant pairs exactly: `threat` b 172 c 147, `devcards` b 68 c 46, `trader-aware` b 249 c 236, and `denial` b 46 c 36, with both recorded reference win rates and zero illegal actions.
- **Stage 0 identity loads** plain before `6.23 4.29 3.52`, after `6.23 4.29 3.52`; trader before `5.21 4.16 3.49`, after `4.87 4.11 3.47`.

The attribution command was:

```text
cargo run --release -p unsettled-sim -- evaluate --layout standard4 --seats 4 --domain tuning --field pip_diversity --arm fixed=pip_diversity --arm legacyall=pip_diversity --arm legacyport=pip_diversity --arm legacychooser=pip_diversity --arm legacycityterms=pip_diversity --arm legacyband=pip_diversity --arm legacycitygoal=pip_diversity --arm-policy fixed=heuristic-v1-trader-aware-threat-devcards-denial --arm-policy legacyall=heuristic-v1-trader-aware-threat-devcards-denial-legacyall --arm-policy legacyport=heuristic-v1-trader-aware-threat-devcards-denial-legacyport --arm-policy legacychooser=heuristic-v1-trader-aware-threat-devcards-denial-legacychooser --arm-policy legacycityterms=heuristic-v1-trader-aware-threat-devcards-denial-legacycityterms --arm-policy legacyband=heuristic-v1-trader-aware-threat-devcards-denial-legacyband --arm-policy legacycitygoal=heuristic-v1-trader-aware-threat-devcards-denial-legacycitygoal --reference fixed --boards 400 --reps 10 --policy heuristic-v1-trader --threads 0 --player-trading --out ../.claude/solve-artifacts/measurement-attribution
```

Load before `2.57 3.75 3.71`, after `7.63 4.77 4.07`. The run completed 112,000 games, 16,000 paired units per arm and 400 clusters, with zero illegal actions. The table orients every estimate as **fixed minus named legacy arm**, the value of applying the correction; the harness artifact stores the reverse orientation because `fixed` is its reference.

| Correction restored from legacy | Fixed-minus-legacy estimate | b/c in harness orientation | Selected interval | Verdict |
| --- | ---: | ---: | --- | --- |
| all five changes | `+0.0047500` | 575 / 651 | McNemar `[+0.0004615, +0.0090385]` | equivalent |
| prospective board-wide port production | `+0.0001875` | 94 / 97 | McNemar `[-0.0015055, +0.0018805]` | equivalent |
| scored settlement chooser | `-0.0000625` | 1 / 0 | clustered `[-0.0001850, +0.0000600]` | equivalent |
| build-kind-correct city terms | `+0.0006250` | 39 / 49 | clustered `[-0.0005370, +0.0017870]` | equivalent |
| one building band | `+0.0025625` | 106 / 147 | clustered `[+0.0005293, +0.0045957]` | equivalent |
| vertex-dependent city goal | `+0.0026250` | 444 / 486 | McNemar `[-0.0011105, +0.0063605]` | equivalent |

These are leave-one-out marginals at the fixed full-composite corner, not an additive decomposition. The bundle is statistically positive on this schedule but remains below the preregistered practical threshold.

**M-21 re-measurement, moved-field caveat.** Both original schedules were re-run, but the default valuation now moves in the field and every default hero policy. These are measurements against a new field, not paired comparisons with M-21.

Trader command:

```text
cargo run --release -p unsettled-sim -- evaluate --layout standard4 --seats 4 --domain tuning --field pip_diversity --arm base=pip_diversity --arm aware=pip_diversity --arm threat=pip_diversity --arm devcards=pip_diversity --arm denial=pip_diversity --arm other3=pip_diversity --arm all4=pip_diversity --arm-policy aware=heuristic-v1-trader-aware --arm-policy threat=heuristic-v1-trader-threat --arm-policy devcards=heuristic-v1-trader-devcards --arm-policy denial=heuristic-v1-trader-denial --arm-policy other3=heuristic-v1-trader-threat-devcards-denial --arm-policy all4=heuristic-v1-trader-aware-threat-devcards-denial --reference base --boards 400 --reps 10 --policy heuristic-v1-trader --threads 0 --player-trading --out ../.claude/solve-artifacts/measurement-m21-trader
```

Load before `5.36 4.52 4.01`, after `6.61 4.80 4.11`; zero illegal actions, reference win rate `0.2513125`.

| Trader arm | Estimate | b | c | Selected interval | Verdict |
| --- | ---: | ---: | ---: | --- | --- |
| all four gates | `+0.0711250` | 3153 | 2015 | clustered `[+0.0622632, +0.0799868]` | better |
| `threat` `devcards` `denial` | `+0.0308750` | 2140 | 1646 | McNemar `[+0.0233529, +0.0383971]` | better |
| `aware` | `+0.0266875` | 2655 | 2228 | clustered `[+0.0174445, +0.0359305]` | better |
| `devcards` | `+0.0160625` | 615 | 358 | clustered `[+0.0122192, +0.0199058]` | better |
| `threat` | `+0.0086250` | 1764 | 1626 | clustered `[+0.0013602, +0.0158898]` | inconclusive |
| `denial` | `+0.0081875` | 751 | 620 | McNemar `[+0.0036535, +0.0127215]` | inconclusive |

Plain command:

```text
cargo run --release -p unsettled-sim -- evaluate --layout standard4 --seats 4 --domain tuning --field pip_diversity --arm base=pip_diversity --arm threat=pip_diversity --arm devcards=pip_diversity --arm denial=pip_diversity --arm threat-devcards=pip_diversity --arm threat-denial=pip_diversity --arm devcards-denial=pip_diversity --arm all3=pip_diversity --arm-policy threat=heuristic-v1-threat --arm-policy devcards=heuristic-v1-devcards --arm-policy denial=heuristic-v1-denial --arm-policy threat-devcards=heuristic-v1-threat-devcards --arm-policy threat-denial=heuristic-v1-threat-denial --arm-policy devcards-denial=heuristic-v1-devcards-denial --arm-policy all3=heuristic-v1-threat-devcards-denial --reference base --boards 400 --reps 10 --policy heuristic-v1 --threads 0 --out ../.claude/solve-artifacts/measurement-m21-plain
```

Load before `5.72 4.69 4.08`, after `7.03 4.98 4.19`; zero illegal actions, reference win rate `0.2525625`.

| Plain arm | Estimate | b | c | Selected interval | Verdict |
| --- | ---: | ---: | ---: | --- | --- |
| `threat` `devcards` `denial` | `+0.0335625` | 2037 | 1500 | McNemar `[+0.0262958, +0.0408292]` | better |
| `devcards` `denial` | `+0.0240000` | 1050 | 666 | McNemar `[+0.0189392, +0.0290608]` | better |
| `threat` `denial` | `+0.0213750` | 1868 | 1526 | McNemar `[+0.0142462, +0.0285038]` | better |
| `threat` `devcards` | `+0.0211875` | 1872 | 1533 | McNemar `[+0.0140470, +0.0283280]` | better |
| `devcards` | `+0.0120000` | 561 | 369 | McNemar `[+0.0082690, +0.0157310]` | inconclusive |
| `denial` | `+0.0100625` | 597 | 436 | McNemar `[+0.0061285, +0.0139965]` | inconclusive |
| `threat` | `+0.0076875` | 1669 | 1546 | McNemar `[+0.0007428, +0.0146322]` | inconclusive |

The decision that changes is denial: M-21's old fields resolved it `equivalent`; after the chooser and valuation move it is `inconclusive` on both re-measured fields. This does not establish that denial is better, but it removes the prior positive claim that its effect is below the practical threshold.

**Crossing census and trace.** The Stage 1 behaviour-identical census was reproduced through the all-flags legacy instrument after Stage 2 had landed. Loads before `1.73 2.38 2.63`, after `2.98 2.61 2.71`. It emitted 245 crossings: below the building band, 80 roads and 6 bank trades, with no directly affordable dev card or aware-offer crossing. The Stage 2 post-state observation emitted 289 rows; loads before `2.88 2.64 2.71`, after `2.76 2.63 2.71`. The paired trace supplies first-divergence evidence; the terminal corpus alone cannot. The planned assertion that all five dynamic crossing subtypes would occur in this fixed schedule was false, while the targeted tests prove each subtype independently.

**Fixed-state throughput.** Command:

```text
cargo test --release -p unsettled-engine --lib policy::heuristic_v1::devcards_rate_tests::vertex_valuation_per_decision_cost_is_reported -- --exact --ignored --nocapture
```

Load before `5.06 5.16 4.70`, after `5.06 5.16 4.70`. On one deterministic 20-turn state, five consecutive runs of 50,000 calls measured the goal chooser at `83.308`, `82.862`, `83.160`, `83.494`, and `81.600` ns per decision, median **`83.160ns`**. The legal-road `expansion_road_score` calls plus one `best_road_building_pair` call measured `5937.741`, `5936.546`, `6128.373`, `5910.971`, and `5928.569` ns, median **`5936.546ns`**. This is reported, not gated, and does not re-test the three causes refuted by `SIM-GAP-21`.

The chooser figure is taken against `best_goal_uncounted`, the body split out from `best_goal_with`. The `#[cfg(test)]` call counter that pins the once-per-decision dedup lives in the wrapper, and an earlier reading of this fixture timed the wrapper: 50,000 thread-local read-modify-writes inside the timed loop put the median at `172.509ns` across a `129.927`–`219.546` spread. Removing scaffolding that does not exist in release more than halves the figure and collapses the spread below 2.4%, so the wrapper reading is superseded and should not be quoted. The road-consumer path never called the wrapper and is unchanged within noise.

## M-23 — Card-play scope widening (SIM-GAP-10/11/12)

2026-08-25, commit `74496095`, domain `tuning`. Preregistered in `docs/plans/preregs/2026-08-25-m23-card-play-scope.md` (committed with the implementation, before the run). The change: Year of Plenty offered beyond the exactly-two-short case with value-ranked picks, and `monopoly_for_goal` reading every cost variant. Reference is the pre-change composite behind `LegacyValuation::narrow_card_plays` (`heuristic-v1-trader-aware-threat-devcards-denial-legacycards`); the test arm is the post-change composite.

Command:

```text
cargo run --release -p unsettled-sim -- evaluate --layout standard4 --seats 4 --domain tuning --field pip_diversity --arm base=pip_diversity --arm cards=pip_diversity --arm-policy base=heuristic-v1-trader-aware-threat-devcards-denial-legacycards --arm-policy cards=heuristic-v1-trader-aware-threat-devcards-denial --reference base --boards 400 --reps 10 --policy heuristic-v1-trader --threads 0 --player-trading --out runs/m23-cards
```

Load before `2.73 3.70 3.69`, after `4.11 3.97 3.78`; zero illegal actions; admissible. Reference win rate `0.3227500`.

| Arm | Estimate | b | c | Selected interval | Verdict |
| --- | ---: | ---: | ---: | --- | --- |
| widened card plays | `-0.0036250` | 671 | 729 | McNemar `[-0.0082081, +0.0009581]` | equivalent |

The preregistered rule keeps the fix on anything but `worse`; `equivalent` with the interval strictly inside +-1pp is the recorded outcome. The corpus moved 2585/4000 games (heuristic-v1 family only; `priority-trader` 0/1000, its dev-card logic is unrelated), so the fix changes play frequently without changing composite strength measurably at this power.

## M-24 — Deck-composition-aware dev buying (SIM-GAP-17)

2026-08-25, commit `cc4c34a6` (prereg; implementation in the Task 5 commit), domain `tuning`. Preregistered in `docs/plans/preregs/2026-08-25-m24-deck-aware-dev-buying.md` (committed before the run). The change: the dev-buy score derives the remaining deck's composition (`DeckBelief`, the resource belief's lo/hi shape) and prices the buy by what a draw can still be — the flat base splits across victory-point/progress/knight shares relative to the configured mix, a chase term prices expected hidden points near the win, and the contest and defend terms scale with knight enrichment. Reference is the pre-change composite behind `LegacyValuation::deck_blind_buying` (`heuristic-v1-trader-aware-threat-devcards-denial-legacydeck`); the test arm is the post-change composite.

Command:

```text
cargo run --release -p unsettled-sim -- evaluate --layout standard4 --seats 4 --domain tuning --field pip_diversity --arm base=pip_diversity --arm deck=pip_diversity --arm-policy base=heuristic-v1-trader-aware-threat-devcards-denial-legacydeck --arm-policy deck=heuristic-v1-trader-aware-threat-devcards-denial --reference base --boards 400 --reps 10 --policy heuristic-v1-trader --threads 0 --player-trading --out runs/m24-deck
```

Load before `5.66 4.89 3.95`, after `5.45 4.86 3.94`; zero illegal actions; admissible. Reference win rate `0.3325000`.

| Arm | Estimate | b | c | Selected interval | Verdict |
| --- | ---: | ---: | ---: | --- | --- |
| deck-aware buying | `-0.0131875` | 662 | 873 | McNemar `[-0.0179825, -0.0083925]` | inconclusive |

The preregistered rule keeps the fix on anything but `worse`; the interval straddles the -1pp threshold (upper end -0.84pp), so the verdict is `inconclusive`, not `worse`, and the fix ships with this reading on record. The reading leans negative: the whole interval sits below zero, so the composite is measurably weaker against the `heuristic-v1-trader` field at this power, just not clearly past the practical threshold. The composition weights (the 0.55/0.35/0.10 base split, the 300-point chase scale) are unswept Phase-H placeholders; H2 owns re-asking this axis with swept values. The corpus moved 2275/4000 games (heuristic-v1 family only; `priority-trader` 0/1000, its dev-card logic is unrelated).

## M-25 — Shared hand-size exposure term (SIM-GAP-14/15/16/18)

2026-08-25, commit `706fb27c` (prereg; implementation in the Task 6 commit), domain `tuning`. Preregistered in `docs/plans/preregs/2026-08-25-m25-hand-exposure.md` (committed before the run). The change: one shared exposure model (`policy::exposure`) feeds three consumers — the forced discard ranks goal-surplus cards by port-aware discrete marginal conversion value (bundle protection only at rates strictly better than the observer's base rate; a bank-rate variant tripped the `policy_strength` heuristic-v1-vs-priority-trader gate during development, Wilson lower 0.2980 vs the required 0.30, and was narrowed to ports before this run), the action phase gains a pre-emptive shedding bank/port trade pricing the certain `rate - 1` cards against the expected loss to the next seven, and the gated pre-roll dev-card comparison charges candidates for the cards they add ahead of the observer's own roll. Reference is the pre-change composite behind `LegacyValuation::exposure_blind` (`heuristic-v1-trader-aware-threat-devcards-denial-legacyexposure`); the test arm is the post-change composite.

Command:

```text
cargo run --release -p unsettled-sim -- evaluate --layout standard4 --seats 4 --domain tuning --field pip_diversity --arm base=pip_diversity --arm exposure=pip_diversity --arm-policy base=heuristic-v1-trader-aware-threat-devcards-denial-legacyexposure --arm-policy exposure=heuristic-v1-trader-aware-threat-devcards-denial --reference base --boards 400 --reps 10 --policy heuristic-v1-trader --threads 0 --player-trading --out runs/m25-exposure
```

Load before `7.01 4.97 3.94`, after `8.21 5.25 4.04`; zero illegal actions; admissible (deterministic outcomes, load affects timing only). Reference win rate `0.3203125`.

| Arm | Estimate | b | c | Selected interval | Verdict |
| --- | ---: | ---: | ---: | --- | --- |
| exposure term | `-0.003125` | 463 | 513 | clustered `[-0.0071178, +0.0008678]` | equivalent |

The preregistered rule keeps the fix on anything but `worse`; the interval sits well inside the ±1pp threshold, so the fix ships as `equivalent`. `shed_weight` (10.0) and `DevCardParams::exposure_weight` (0.05) are unswept Phase-H placeholders; H2 owns both axes. The corpus moved 989/4000 games (`priority-trader` 0/1000, its discard path is separate).

## M-26 — Race-check cap and approach blocking (SIM-GAP-07/08)

2026-08-25, commit `6c0a5639` (prereg; implementation in the Task 7 commit), domain `tuning`. Preregistered in `docs/plans/preregs/2026-08-25-m26-race-cap-blocking.md` (committed before the run). The change: the exact Longest Road race-check budget moved from the fixed two-rival `MAX_RACE_CHECKS` onto `DenialParams::race_check_cap`, defaulting to every rival in the largest layout (5), closing the six-seat third-challenger blind spot; checks still spend in danger order behind the sound `road_count + 1 >= required` prefilter. The contest term now prices blocking: a rival's danger contribution scales by `1 + contest_block_bonus` (0.5, an unswept Phase-H placeholder) when the candidate edge is that rival's only remaining one-road approach to the contested vertex, bounded to the vertex's incident edges and reusing the one-road-reach memo. Fixed-state per-decision cost of the raised budget (M-22's form, worst-case state with three prefilter survivors and a succeeding third check, load `6.35 4.96 3.96`): ~180 ns at cap 2 vs ~330 ns at cap 5. Reference is the pre-change composite behind `LegacyValuation::bounded_race` (`heuristic-v1-trader-aware-threat-devcards-denial-legacyrace`); the test arm is the post-change composite.

Command:

```text
cargo run --release -p unsettled-sim -- evaluate --layout standard4 --seats 4 --domain tuning --field pip_diversity --arm base=pip_diversity --arm race=pip_diversity --arm-policy base=heuristic-v1-trader-aware-threat-devcards-denial-legacyrace --arm-policy race=heuristic-v1-trader-aware-threat-devcards-denial --reference base --boards 400 --reps 10 --policy heuristic-v1-trader --threads 0 --player-trading --out runs/m26-race
```

Load before `4.54 4.65 3.88`, after `6.02 4.95 3.99`; zero illegal actions; admissible (deterministic outcomes, load affects timing only). Reference win rate `0.3171875`.

| Arm | Estimate | b | c | Selected interval | Verdict |
| --- | ---: | ---: | ---: | --- | --- |
| race cap + blocking | `+0.00025` | 95 | 91 | McNemar `[-0.0014206, +0.0019206]` | equivalent |

The preregistered rule keeps the fix on anything but `worse`; only 186 of 16,000 paired units were discordant, so the change fires rarely on four-seat standard boards, and the interval sits far inside the ±1pp threshold. `race_check_cap` and `contest_block_bonus` are unswept Phase-H placeholders; H2 owns both axes. The corpus moved 415/4000 games, all in the denial-gated composite (330/600 on extension6, where six seats make the raised cap bind, and 85/400 on standard4); every ungated policy was byte-identical, and no gate baseline or replay-derived fixture moved.

## M-27 — Embargo threshold onto the shared danger model (SIM-GAP-27)

2026-08-25, commit `e662d166` (prereg; implementation in the Task 8 commit), domain `tuning`. Preregistered in `docs/plans/preregs/2026-08-25-m27-embargo-danger.md` (committed before the run). The change: `trade.rs::embargoed` thresholds the shared ETW danger model (`threat::danger_from_etw`) instead of a conservative hidden-VP estimate. A seat is refused all player trades at `TradeConfig::embargo_danger` (0.125, roughly ETW <= 7 turns at the shared floor 1.0) and at `embargo_takeover_danger` (0.0625, roughly ETW <= 15) only while holding an imminent Largest Army or Longest Road swing, which the ETW closed form deliberately excludes; the seat's own eligibility prices its real hand while a rival's estimate stands on belief, mirroring `trading::own_inputs`. All three thresholds are unswept Phase-H placeholders (H2 owns them). Reference is the pre-change composite behind `LegacyValuation::vp_embargo` (`heuristic-v1-trader-aware-threat-devcards-denial-legacyembargo`); the test arm is the post-change composite. The engine forwards each seat's own policy flag, so the field ran the danger model in both arms and the contrast isolates the arm seat's embargo model.

Command:

```text
cargo run --release -p unsettled-sim -- evaluate --layout standard4 --seats 4 --domain tuning --field pip_diversity --arm base=pip_diversity --arm embargo=pip_diversity --arm-policy base=heuristic-v1-trader-aware-threat-devcards-denial-legacyembargo --arm-policy embargo=heuristic-v1-trader-aware-threat-devcards-denial --reference base --boards 400 --reps 10 --policy heuristic-v1-trader --threads 0 --player-trading --out runs/m27-embargo
```

Load before `4.27 4.34 3.62`, after `4.27 4.34 3.62` (2.3s run); zero illegal actions; admissible (deterministic outcomes, load affects timing only). Reference win rate `0.317`.

| Arm | Estimate | b | c | Selected interval | Verdict |
| --- | ---: | ---: | ---: | --- | --- |
| danger-model embargo | `+0.0034375` | 532 | 477 | McNemar `[-0.0004532, +0.0073282]` | equivalent |

The preregistered rule keeps the fix on anything but `worse`; 1,009 of 16,000 paired units were discordant — the embargo fires far more often than the race-cap change did — and the interval leans positive while sitting well inside the ±1pp threshold. The corpus moved 1423/4000 games, every trader arm on both layouts (extension6: 432/600 trader, 454/600 composite; standard4: 251/400 trader, 286/400 composite), by design for a rules-level eligibility change; `heuristic-v1` and the no-trading `priority-trader` capture were byte-identical. The trading-gate baseline fixture was regenerated through its deliberate generator; two replay-derived `player_trading.rs` fixtures were re-found via the committed scan, and the hand-authored explicit trading state plus the free-dev-card belief script disable the embargo explicitly because free dev cards legitimately collapse ETW to zero.

## M-28 — Empty-hand robber victim legality (SIM-GAP-22)

2026-08-25, commit `0eb8bbdc` (pre-change captures; implementation in the Task 9 commit), no seed domain spent (corpus captures run the fixed `--seed 42` schedule of `simulator/tools/capture-corpus.sh`). The change: `game.rs` renames `eligible_victim` to `nameable_victim` and drops its `hand_size() > 0` requirement, so any adjacent opponent may be named as the robber victim — naming an empty hand steals nothing, which is how the rules let a player decline a steal — while declining outright (`victim: None`) stays legal only when no adjacent seat holds a card. `view.rs::victim_on_hex` mirrors the naming clause and `stealable_on_hex` mirrors the mandatory-steal clause; `random_legal` enumerates the widened set (knight plays and the seven-roll robber) so the legal space is actually exercised.

No A/B was run, deliberately: the standing corpus recapture came back byte-identical on all eight arms (`games.jsonl` and `results.json`, 0/4000 games moved), so the pre-change composite reference provably did not move and a paired run would compare byte-identical arms. Corpus identity is a stronger statement than a statistical `equivalent`. Every shipped scoring policy keeps naming carded victims — naming an empty hand is outcome-identical to declining, so no scorer has anything to prefer — and the movement the gap predicted (20 of the audit-era 48 games) materializes only under `random-legal`, which is not a corpus arm.

Commands: `simulator/tools/capture-corpus.sh runs/corpus-post-gap22` diffed against `runs/corpus-pre`, plus the same 25-board x 4-rep seed-42 tournament schedule with `--policy random-legal` on both layouts, captured pre-change at `0eb8bbdc` (`runs/gap22-random-pre`) and post-change (`runs/gap22-random-post`).

Load before `1.40 2.18 2.77`, after `4.25 3.92 3.33`; admissible (deterministic outcomes, load affects timing only). Random-legal movement: standard4 78/400 games, extension6 241/600 games; zero illegal actions in every capture, pre and post. Gate baselines and the replay-derived `player_trading.rs` fixtures were untouched by construction and both cargo profiles pass unmodified.

## M-29 — Road-building pair gating and the M-22 attribution re-run (SIM-GAP-32)

2026-08-25, commit `17706a88` (prereg; implementation in the Task 11 commit), domain `tuning`. Preregistered in `docs/plans/preregs/2026-08-25-m29-pair-gating-m22-rerun.md` (committed before the run). The change: `heuristic_v1.rs::best_road_building_pair` gates its expansion credit on `DecisionView::is_expansion_target` and reads both laid edges' endpoints, folding through `Option` with `unwrap_or(0.0)` so a pair laid purely for Longest Road keeps a zero credit instead of a `NEG_INFINITY`-poisoned score — the verified reproduction SIM-GAP-32 recorded. Pre-change behavior is preserved behind `LegacyValuation::ungated_pair` (`heuristic-v1-trader-aware-threat-devcards-denial-legacypair`). Per the gap's assignment, this run is the M-22 attribution schedule at the corrected full-composite corner with `legacypair` as a seventh leave-one-out arm; M-22's readings stand as history and these rows re-measure the same marginals at the new corner.

Command: as preregistered (the M-22 attribution command plus the `legacypair` arm pair, `--out runs/m29-pair-attribution`). Load before `4.88 4.72 4.08`, after `7.43 5.27 4.28`; 128,000 games, 16,000 paired units per arm over 400 clusters, zero illegal actions; admissible. Reference win rate `0.3270625`. The table orients every estimate as **fixed minus named legacy arm**, the value of applying the correction; the harness artifact stores the reverse orientation because `fixed` is its reference.

| Correction restored from legacy | Fixed-minus-legacy estimate | b/c in harness orientation | Selected interval | Verdict |
| --- | ---: | ---: | --- | --- |
| **pair gating (this fix)** | `+0.0215625` | 339 / 684 | clustered `[+0.0174115, +0.0257135]` | **better** |
| all five SIM-BATCH1 changes | `+0.0088125` | 498 / 639 | clustered `[+0.0046184, +0.0130066]` | inconclusive |
| one building band | `+0.0034375` | 86 / 141 | McNemar `[+0.0015927, +0.0052823]` | equivalent |
| vertex-dependent city goal | `+0.0030625` | 393 / 442 | McNemar `[-0.0004769, +0.0066019]` | equivalent |
| prospective board-wide port production | `+0.0012500` | 78 / 98 | clustered `[-0.0004451, +0.0029451]` | equivalent |
| scored settlement chooser | `0.0000000` | 0 / 0 | clustered `[0, 0]` | equivalent |
| build-kind-correct city terms | `-0.0007500` | 34 / 22 | McNemar `[-0.0016666, +0.0001666]` | equivalent |

The pair gating is the first gap fix whose paired reading clears the practical threshold: `better` at +2.16pp with the interval entirely above +1pp, so the preregistered keep-unless-`worse` rule is satisfied with margin. The re-measured SIM-BATCH1 rows stay consistent with M-22 in sign and scale (the bundle reads +0.88pp here vs +0.48pp there, resolved `inconclusive` on the clustered interval; the chooser arm is now fully concordant at 0/0 discordant units where M-22 saw 1/0).

The corpus moved 2160/4000 games — every heuristic arm on both layouts (standard4: 245/400 plain, 239/400 trader, 238/400 composite; extension6: 469/600 plain, 490/600 trader, 479/600 composite) — while both `priority-trader` captures stayed byte-identical (that policy uses the separate view-side pair helper, untouched by this change). All three gate baselines (denial, robber, trading) moved and were regenerated through their deliberate delete-then-generate flow. Six replay-derived `player_trading.rs` fixtures were re-found via the committed scan, which gained blocks for the two tests it did not yet cover and a wider embargo search range. The `ranking_stability.rs` cross-policy tripwire now compares win counts through a noise margin (25 wins, ~1 SE on its 1,200-game schedule) with tie-aware midranks: under the corrected scorer `city_focus` and `port_synergy` sit one win apart at ranks 2-3 of the `heuristic-v1-noports` arm, a coin-flip boundary the old strict top-2 set equality misread as instability while the winner and the rank correlations are unchanged.

## M-30 — SpecialBuild scoring probe (SIM-GAP-19)

2026-08-25, commit `b3c2566f` (prereg and seam; readings recorded in the Task 12 commit), domain `tuning`. Preregistered in `docs/plans/preregs/2026-08-25-m30-specialbuild-scoring.md` (committed before the run). The question: `DecisionPhase::SpecialBuild` reaches `ask_action` with no distinct scoring — the ordinary action scorer runs under the phase's narrower legality — and whether that uniform treatment is correct was unmeasured. Two measurement-only composite labels probe it, both inert at the shipped `HeuristicParams::special_build = Uniform` default (the standing corpus recapture diffed byte-identical before the run): `-sbmute` passes every special-build decision (the surface ablation, bounding how much outcome weight any rescoring there could carry), and `-sbhold` refuses special-build spends whose every payable cost variant increases the current goal's closest-variant shortfall (the plausible refinement: greedy uniform building can burn goal resources on a lesser build or an out-of-turn dev buy).

Commands: as preregistered (extension6, field `pip_diversity`, field policy `heuristic-v1-trader`, player trading on, 400 boards x 10 reps, reference = current composite; one invocation at 6 seats, one at 5). Load before `4.81 4.34 3.61`, after `11.82 6.03 4.24`; 132,000 games total, zero illegal actions in both invocations; admissible (deterministic outcomes, load affects timing only).

| Seats | Arm | Estimate vs base | b/c | Selected interval | Verdict |
| ---: | --- | ---: | ---: | --- | --- |
| 6 | `sbmute` | `-0.0917917` | 1529 / 3732 | clustered `[-0.0977936, -0.0857897]` | **worse** |
| 6 | `sbhold` | `-0.0032917` | 2417 / 2496 | McNemar `[-0.0090157, +0.0024323]` | equivalent |
| 5 | `sbmute` | `-0.0739500` | 1927 / 3406 | McNemar `[-0.0810328, -0.0668672]` | **worse** |
| 5 | `sbhold` | `+0.0074500` | 2449 / 2300 | McNemar `[+0.0006974, +0.0142026]` | inconclusive |

Reading, per the preregistered rule (implement distinct scoring only on a `better` at either seat count): no arm reached `better`, so the uniform treatment stands and SIM-GAP-19 is deleted with this evidence. The surface itself is decisively live — muting it costs 9.2pp at 6 seats and 7.4pp at 5 — which reads as greedy uniform building being strongly right against not acting, and location choice being phase-invariant leaves act-versus-wait as the only axis a distinct scorer could move. The hold-for-goal refinement is indistinguishable from uniform at 6 seats and weakly positive but below the practical threshold at 5 (`inconclusive`, interval `[+0.07pp, +1.42pp]` straddling +1pp); if a future programme wants to re-ask, the `-sbhold` label remains in the roster and a 5-seat run at higher power is the place to start.

## M-31 — Knight timing rejoin (SIM-GAP-05/06/09)

2026-08-25, commit `6dc32029` (prereg; implementation in the Task 13 commit), domain `tuning`. Preregistered in `docs/plans/preregs/2026-08-25-m31-knight-timing.md` (committed before the run). The change unfreezes the knight path G1 froze so its robber A/B stayed placement-only: `knight_action_score`'s contested-card term takes the shared denial pressure toward the Largest Army holder instead of a literal `1.0` (SIM-GAP-05); the progress term scales by that same pressure instead of only the observer's own progress (SIM-GAP-06); and under the threat gate the steal term prices the victim through belief — the probability the stolen card fills the observer's own cheapest-route shortfall, the observer's side priced on the real hand mirroring `trading::own_inputs` — plus the shared danger-model victim rank, while a new placement term rejoins play timing to the robber placement value the chooser maximized, priced at the pair the knight actually plays rather than the self-regarding baseline (SIM-GAP-09 and the programme's knight-timing item). `threat::robber_choice` exposes the priced decision so choosing and pricing never recompute the context. `ThreatParams::knight_steal_weight` (12.0) and `knight_placement_weight` (30.0) are unswept Phase-H placeholders (H2 owns them). The fully ungated path is bit-identical by construction; pre-change gated behavior survives behind `LegacyValuation::frozen_knight` (`heuristic-v1-trader-aware-threat-devcards-denial-legacyknight`).

Command: as preregistered (`--out runs/m31-knight`). Load before `4.90 4.82 4.06`, after `4.90 4.82 4.06` (2.5s run); 32,000 games, 16,000 paired units over 400 clusters, zero illegal actions; admissible (deterministic outcomes, load affects timing only). Reference win rate `0.3270625`.

| Arm | Estimate | b | c | Selected interval | Verdict |
| --- | ---: | ---: | ---: | --- | --- |
| knight rejoin | `+0.000125` | 4 | 2 | clustered `[-0.0001752, +0.0004252]` | equivalent |

The preregistered rule keeps the fix on anything but `worse`. Only 6 of 16,000 paired units were discordant: at this corner the rescoring almost never flips a game, because the knight-motive gate already restricts scoring to decisions where a knight is likely to be played and the placement itself was already threat-chosen — the rejoin moves play/hold timing, not the destination. The corpus moved 12/4000 games, confined to the full-composite arm (standard4 4/400, extension6 8/600); every other arm — plain `heuristic-v1`, `heuristic-v1-trader`, both `priority-trader` captures — was byte-identical, which is the ungated byte-stability claim checked empirically. All three gate-baseline oracles and every replay-derived `player_trading.rs` fixture held unchanged (both cargo profiles green without regeneration), so no baseline was regenerated.

## M-32 — J1 goal-need vertex term at trial values

2026-08-25, commit `130205aa` (prereg; implementation in the Task 14 commit), domain `tuning`. Preregistered in `docs/plans/preregs/2026-08-25-m32-j1-goal-need.md` (committed before the run). Phase J1 builds the programme's single goal-need model (`policy::goal_need::GoalNeed`): the current goal's closest cost variant's missing cards minus one full round of expected production (`seats` rolls at `pips / 36` cards per roll), clamped at zero, sharing `closest_variant_missing` with the payment path. Its first consumer is a second `vertex_score` term on the settlement and city build candidates — candidate production pips weighted by the decision's selected goal's outstanding need, scaled by the new `HeuristicParams::goal_need_weight`. The goal chooser prices vertices without the term (a candidate goal's own need feeding the scores that choose it would be a fixed point, and roads are scored before any goal exists). The default weight is zero, which never constructs the model; the standing corpus recapture came back byte-identical on all eight arms (0/4000 games moved, zero illegal actions), so the seam ships with no behavior change. Trial values live behind `heuristic-v1-trader-aware-threat-devcards-denial-goalneedlo` (0.5) and `-goalneedhi` (2.0).

Command: as preregistered (`--out runs/m32-goalneed`). Load before `7.70 6.09 4.60`, after `7.32 6.04 4.59` (3.5s run; elevated by the just-finished test suites — deterministic outcomes, load affects timing only); 48,000 games, 16,000 paired units per arm over 400 clusters, zero illegal actions; admissible. Reference win rate `0.3271875`.

| Arm | Estimate | b | c | Selected interval | Verdict |
| --- | ---: | ---: | ---: | --- | --- |
| goalneedlo (0.5) | `0.0` | 0 | 0 | clustered `[0.0, 0.0]` | equivalent |
| goalneedhi (2.0) | `+0.0000625` | 1 | 0 | clustered `[-0.0000600, +0.0001850]` | equivalent |

Per the preregistered rule this screen changes nothing shipped and leaves the parameter to the H2 sweep with no prior. The discordance counts are the finding: the low arm played all 16,000 paired games identically to the zero-weight reference and the high arm flipped exactly one, so the term's live surface at this corner is nearly empty. The reason is structural — the need of an affordable goal is zero by construction, and a build candidate is scored only when it is affordable, at which point the goal chooser has almost always selected that same affordable build as the goal. The term binds only in the narrow states where the selected goal is a different, unaffordable buildable (the closed-form tests construct one deliberately). H2 should read this as "the weight axis is nearly flat at this corner", and J3's cost-pressure consumer — which prices spends against the goal rather than vertices against the goal — is the reuse of this machinery with a live surface at every build decision.

## M-33 — J2 stage signal at trial values

2026-08-25, commit `42774d35` (prereg; implementation in the Task 15 commit), domain `tuning`. Preregistered in `docs/plans/preregs/2026-08-25-m33-j2-stage.md` (committed before the run). Phase J2 builds the stage signal (`policy::stage::Stage`), one derivation per decision: `lateness = 1 - min(piece_frac, site_frac)`, the observer's remaining settlement+city pieces over the 5+4 supply against the count of distance-rule-open settlement sites over the settlement supply (capped at 1, so the site channel binds only once open sites drop below the supply). Under gated policies the denial context's top rival danger raises the lateness by `stage_urgency_weight * danger`, clamped to 1. Two zero-default consumers in `vertex_score_with`: the settlement expansion term scaled by `(1 - stage_expansion_weight * lateness).max(0)` and the city vertex score scaled by `1 + stage_city_weight * lateness`; being pure state, the stage also reaches the goal chooser and the road/pair expansion credits. The standing corpus recapture came back byte-identical on all eight arms (0/4000 games moved, zero illegal actions), so the seam ships with no behavior change. Trial triples live behind `heuristic-v1-trader-aware-threat-devcards-denial-stagelo` (0.5/0.5/0.5) and `-stagehi` (1.0/2.0/1.0).

Command: as preregistered (`--out runs/m33-stage`). Load before `6.45 5.05 4.10`, after `7.54 5.30 4.19` (~30s run; elevated by the just-finished corpus capture — deterministic outcomes, load affects timing only); 48,000 games, 16,000 paired units per arm over 400 clusters, zero illegal actions; admissible. Reference win rate `0.3271875`.

| Arm | Estimate | b | c | Selected interval | Verdict |
| --- | ---: | ---: | ---: | --- | --- |
| stagelo (0.5/0.5/0.5) | `-0.00075` | 152 | 164 | clustered `[-0.0030565, +0.0015565]` | equivalent |
| stagehi (1.0/2.0/1.0) | `-0.001125` | 454 | 472 | McNemar `[-0.0048526, +0.0026026]` | equivalent |

Per the preregistered rule this screen changes nothing shipped and leaves the three parameters to the H2 sweep with no prior. Unlike the J1 need term, the stage's live surface is real: 316 of 16,000 paired games moved at the moderate triple and 926 at the aggressive one, so the seam does redirect decisions — the redirected games simply win at the same rate as the reference at this corner. Both estimates sit within a tenth of a percentage point of zero with intervals well inside the +-1pp threshold, so H2 can sweep each axis independently knowing the composite response at these two points is flat rather than unexplored.

## M-34 — J3 piece economy at trial values

2026-08-25, commit `49058a23` (prereg; implementation in the Task 16 commit), domain `tuning`. Preregistered in `docs/plans/preregs/2026-08-25-m34-j3-piece-economy.md` (committed before the run). Phase J3 closes SIM-GAP-29 with both halves, zero-default. The settlement-slot return (`policy::piece_economy::SlotReturn`, one derivation per decision) adds proximity-to-the-settlement-cap times open-site availability to city vertex value under `slot_return_weight`; pure state, it also reaches the goal chooser. The cost-pressure term reuses the shared goal-need model (`goal_need::GoalNeed::cost_term`): each affordable build candidate is charged `cost_pressure_weight` times the overlap between its cost — at the first affordable variant, the one `pay_cost` spends — and the selected goal's outstanding need; an affordable goal has zero need, so a build is never charged for its own goal. The standing corpus recapture came back byte-identical on all eight arms (0/4000 games moved, zero illegal actions), so the seam ships with no behavior change. Trial pairs live behind `heuristic-v1-trader-aware-threat-devcards-denial-econlo` (slot 2.0, pressure 0.5) and `-econhi` (slot 8.0, pressure 2.0).

Command: as preregistered (`--out runs/m34-econ`). Load before `4.12 3.86 3.39`, after `5.31 4.11 3.48` (~25s run; deterministic outcomes, load affects timing only); 48,000 games, 16,000 paired units per arm over 400 clusters, zero illegal actions; admissible. Reference win rate `0.3271875`.

| Arm | Estimate | b | c | Selected interval | Verdict |
| --- | ---: | ---: | ---: | --- | --- |
| econlo (2.0/0.5) | `+0.000375` | 60 | 54 | clustered `[-0.0009681, +0.0017181]` | equivalent |
| econhi (8.0/2.0) | `-0.0025625` | 208 | 249 | clustered `[-0.0054928, +0.0003678]` | equivalent |

Per the preregistered rule this screen changes nothing shipped and leaves both parameters to the H2 sweep with no prior. The discordance matches the preregistered surface-shape expectation: the live surface is real but narrow (114 of 16,000 paired games moved at the moderate pair, 457 at the aggressive one). Two structural findings recorded for H2's benefit: in base rules a payable road never overlaps a settlement or city goal's need, so the road-candidate charge is nearly dead (the main live overlap is a settlement build spending the wheat an unaffordable city goal still needs), and an affordable road goal prices at the 0.25-turn floor (score 1.4), which outranks any unaffordable build goal at ordinary production levels — the test pinning the road charge needed an artificial many-settlement state to reach that corner. The aggressive pair leans slightly negative (interval upper edge barely above zero), consistent with M-24's placeholder-weight reading: H2 should sweep `cost_pressure_weight` downward from 2.0 rather than upward.

## M-35 — J4 goal hysteresis at trial margins

2026-08-25, commit `09fca3ce` (prereg; implementation in the Task 17 commit), domain `tuning`. Preregistered in `docs/plans/preregs/2026-08-25-m35-j4-hysteresis.md` (committed before the run). Phase J4 closes SIM-GAP-25 with commitment state, zero-default. The engine records each seat's last committed goal as its incumbent (`PlayerState::incumbent_goal`, written after every pre-roll and action decision, reset by the fresh `GameState` in `GameArena::prepare`, read through `DecisionView::incumbent_goal` so every chooser call site — including the discard fallback — sees the one record). In `heuristic_v1`'s goal chooser a challenger must beat the incumbent's candidate by `HeuristicParams::goal_hysteresis_margin`, applied as a selection-only boost in the comparisons: the chosen goal keeps its true score, and an incumbent with no legal candidate boosts nothing. The standing corpus recapture came back byte-identical on all eight arms (0/4000 games moved, zero illegal actions), so the seam ships with no behavior change. Trial margins live behind `heuristic-v1-trader-aware-threat-devcards-denial-hystlo` (0.25) and `-hysthi` (1.0).

Command: as preregistered (`--out runs/m35-hyst`). Load before `4.58 4.02 3.23`, after `5.82 4.28 3.33` (~25s run; deterministic outcomes, load affects timing only); 48,000 games, 16,000 paired units per arm over 400 clusters, zero illegal actions; admissible. Reference win rate `0.3271875`.

| Arm | Estimate | b | c | Selected interval | Verdict |
| --- | ---: | ---: | ---: | --- | --- |
| hystlo (0.25) | `-0.023375` | 1190 | 1564 | McNemar `[-0.0297933, -0.0169567]` | worse |
| hysthi (1.0) | `-0.072875` | 1219 | 2385 | McNemar `[-0.0801417, -0.0656083]` | worse |

The first J screen with a decisive verdict, and it is negative at both margins, monotone in the margin, with both intervals entirely beyond the -1pp threshold. Per the preregistered rule nothing shipped changes (the margin ships at zero) and SIM-GAP-25 is deleted — the gap asked for commitment state to exist and be measured, and the measurement's answer is that at this corner goal stickiness forgoes value: the live surface is far larger than the indirect-consumer expectation (2,754 of 16,000 paired games moved at 0.25, 3,604 at 1.0), and re-optimizing the goal every decision is worth roughly 2-7pp against holding it through sub-margin score flips. Reading for H2: this axis is not flat — both measured points are decisively below zero, so a sweep should treat the margin as likely zero-optimal and probe below 0.25 if it probes at all.

## M-36 — J5 frontier replacement at trial mixes

2026-08-25, commit `586cae54` (prereg; implementation in the Task 18 commit), domain `tuning`. Preregistered in `docs/plans/preregs/2026-08-25-m36-j5-frontier.md` (committed before the run). Phase J5 closes SIM-GAP-28 with a real frontier measure, zero-default. `policy::frontier::opened` counts the distinct vertices a settlement at the candidate would newly open to the observer: adjacent unowned vertices the road network does not already reach through an unowned edge (new road continuation points), plus the distance-rule-open sites one further unowned edge beyond them that the network does not already reach (girth six means nothing is double-counted). The blend `degree + frontier_mix * (frontier - degree)` sits inside `vertex_score`'s settlement expansion closure, so build candidates, the goal chooser, and the road and pair expansion credits all price it through one expression. The same task exposes `HeuristicParams::dev_buy_scale` (default 1.0, bit-identical, wrapping the deck-aware and legacy deck-blind buy-score spellings alike) as the SIM-GAP-24 seam for the H2 sweep — mechanism only, no arm here moves it. The standing corpus recapture came back byte-identical on all eight arms (0/4000 games moved, zero illegal actions), so the seam ships with no behavior change. Trial mixes live behind `heuristic-v1-trader-aware-threat-devcards-denial-frontierlo` (0.5) and `-frontierhi` (1.0).

Command: as preregistered (`--out runs/m36-frontier`). Load before `2.73 3.35 2.86`, after `4.35 3.68 2.98` (~25s run; deterministic outcomes, load affects timing only); 48,000 games, 16,000 paired units per arm over 400 clusters, zero illegal actions; admissible. Reference win rate `0.3271875`.

| Arm | Estimate | b | c | Selected interval | Verdict |
| --- | ---: | ---: | ---: | --- | --- |
| frontierlo (0.5) | `-0.00075` | 89 | 101 | McNemar `[-0.0024385, +0.0009385]` | equivalent |
| frontierhi (1.0) | `-0.0026875` | 155 | 198 | clustered `[-0.0050859, -0.0002891]` | equivalent |

Per the preregistered rule this screen changes nothing shipped and leaves the mix to the H2 sweep. The live surface is smaller than the preregistered expectation predicted (190 of 16,000 paired games moved at the half blend, 353 at the full replacement — between J1's near-empty surface and J2's): by the time settlements are actually being priced mid-game, most legal candidates sit at a similar distance from the observer's network, so the frontier and degree counts order them more alike than the empty-board fan suggests. The full replacement leans negative (its clustered interval sits entirely below zero but well inside the +-1pp practical threshold), so H2 should read this axis as flat-to-slightly-negative and not prioritize raising the mix; SIM-GAP-28 is deleted per the prereg rule — the gap asked for the degree proxy to be replaced by a measured frontier term, and it is built, gated, and measured.

## M-37 — Phase J composite at lo trial values

2026-08-25, commit `06428a6c` (prereg; implementation in the Task 19 commit), domain `tuning`. Preregistered in `docs/plans/preregs/2026-08-25-m37-j-composite.md` (committed before the run). The Phase J composite per the programme's increment rule: all five J terms applied together against the all-zero shipped default, each at the lo trial value it was measured at alone (M-32 through M-36). Two measurement-only labels on the full composite: `heuristic-v1-trader-aware-threat-devcards-denial-jall` (goal need 0.5, stage 0.5/0.5/0.5, slot return 2.0, cost pressure 0.5, hysteresis margin 0.25, frontier mix 0.5) and `-jnohyst` (the same vector with the hysteresis margin at its shipped zero, separating the J interaction from the hysteresis penalty M-35 established). The standing corpus recapture came back byte-identical on all eight arms (0/4000 games moved, zero illegal actions), so the labels ship with no behavior change.

Command: as preregistered (`--out runs/m37-jcomposite`). Load before `4.43 4.44 3.46`, after `5.59 4.68 3.55` (~25s run; deterministic outcomes, load affects timing only); 48,000 games, 16,000 paired units per arm over 400 clusters, zero illegal actions; admissible. Reference win rate `0.3271875`.

| Arm | Estimate | b | c | Selected interval | Verdict |
| --- | ---: | ---: | ---: | --- | --- |
| jall (all five at lo) | `-0.0205` | 1206 | 1534 | McNemar `[-0.0269043, -0.0140957]` | worse |
| jnohyst (hysteresis at zero) | `-0.001625` | 261 | 287 | clustered `[-0.0047527, +0.0015027]` | equivalent |

The composite response is near-additive, which is the answer H2 needed. One correction to the prereg's prediction paragraph: it stated the non-hysteresis lo singles sum to roughly -0.4pp; the correct sum of the M-32/M-33/M-34/M-36 lo estimates is -0.11pp (an arithmetic slip in the prereg, recorded here rather than edited there). Both the stated and the corrected prediction called `jnohyst` `equivalent` near zero, and it measured -0.16pp with the interval inside +-0.5pp — indistinguishable from the singles sum, with 548 discordant games against roughly 620 summed across the four singles. `jall` measured -2.05pp against a predicted -2.45pp (hystlo's -2.34pp plus the flat terms); its interval overlaps M-35's hystlo interval almost exactly, so the composite penalty is the hysteresis penalty and nothing more. No J interaction is detectable at the lo corner in either direction: H2 may sweep the J axes independently rather than jointly, with the flat-to-slightly-negative per-axis priors recorded in M-32 through M-36 and the hysteresis axis treated as likely zero-optimal per M-35. Per the preregistered rule nothing shipped changes; every J weight remains zero-default.

## M-38 — H1 placement-weight screens

2026-08-25, commit `9384b07d` (prereg; no code change), domain `tuning`. Preregistered in `docs/plans/preregs/2026-08-25-m38-h1-placement-screens.md` (committed before the runs, including every arm vector). Phase H1 screens every swept parameter of `simulator/placement/default-weights.json` — 18 parameters, one arm below and one above the default (generally half and double, clamped to `sweep-bounds.json`), as full weights files `placement/arms/h1_*.json`. Skipped: the `resourceValue` spread axis (eval-spent), `genericPortFactor` (settled at 0.5), the degenerate-bounds machinery parameters, and `handValueWeight`'s zero question (H3's own A/B; screened here as a magnitude axis only). Protocol per the H context: composite field — every seat, field and arms alike, runs `heuristic-v1-trader-aware-threat-devcards-denial` with player trading (unlike the J screens, whose field policy was plain `heuristic-v1-trader`) — 2000 boards x 2 reps, 16,000 paired units per arm over 2000 clusters, reference `base` = `simulator/placement/default-weights.json` loaded as an app-formula arm. Four invocations grouped by family. Loads before/after: h1a `2.63 2.72 2.75` / `7.14 3.74 3.12` (20s), h1b `6.64 3.70 3.11` / `11.55 5.09 3.62` (25s), h1c `10.71 5.02 3.61` / `13.34 5.99 3.99` (20s), h1d `12.27 5.89 3.96` / `14.97 7.04 4.43` (25s) — the rising averages are these back-to-back runs themselves; deterministic outcomes, load affects timing only. 144,000/176,000/144,000/176,000 games, zero illegal actions everywhere; admissible. Reference win rate `0.2331875` in all four (the default app formula gives up about 1.7pp to a `pip_diversity` seat at this corner).

| Arm | Value | Estimate | b | c | Selected interval | Verdict |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| hand_lo | 0.2 | `-0.00175` | 82 | 110 | clustered `[-0.0034724, -0.0000276]` | equivalent |
| hand_hi | 0.8 | `+0.000625` | 166 | 156 | clustered `[-0.0016275, +0.0028775]` | equivalent |
| scarcity_lo | 0.175 | `-0.003125` | 331 | 381 | clustered `[-0.0065879, +0.0003379]` | equivalent |
| scarcity_hi | 0.7 | `-0.0008125` | 647 | 660 | clustered `[-0.0054247, +0.0037997]` | equivalent |
| clampmin_lo | 0.25 | `0.0` | 0 | 0 | clustered `[0.0, 0.0]` | equivalent |
| clampmin_hi | 1.0 | `-0.001125` | 415 | 433 | clustered `[-0.0048893, +0.0026393]` | equivalent |
| clampmax_lo | 1.0 | `-0.0034375` | 585 | 640 | clustered `[-0.0078374, +0.0009624]` | equivalent |
| clampmax_hi | 4.0 | `+0.000125` | 16 | 14 | clustered `[-0.0007060, +0.0009560]` | equivalent |
| diversity_lo | 0.8 | `-0.0115625` | 445 | 630 | clustered `[-0.0158139, -0.0073111]` | inconclusive |
| diversity_hi | 3.2 | `+0.007` | 902 | 790 | clustered `[+0.0015071, +0.0124929]` | inconclusive |
| divcap_lo | 2.0 | `-0.001375` | 1034 | 1056 | clustered `[-0.0072663, +0.0045163]` | equivalent |
| divcap_hi | 8.0 | `-0.018375` | 1060 | 1354 | clustered `[-0.0246763, -0.0120737]` | worse |
| coverage_lo | 1.0 | `-0.000375` | 457 | 463 | clustered `[-0.0043112, +0.0035612]` | equivalent |
| coverage_hi | 2.25 | `-0.003375` | 414 | 468 | clustered `[-0.0071327, +0.0003827]` | equivalent |
| covscarcity_lo | 0.25 | `-0.0009375` | 131 | 146 | clustered `[-0.0031255, +0.0012505]` | equivalent |
| covscarcity_hi | 1.0 | `-0.0018125` | 229 | 258 | clustered `[-0.0045974, +0.0009724]` | equivalent |
| dup_lo | 0.0 | `-0.0019375` | 163 | 194 | clustered `[-0.0043897, +0.0005147]` | equivalent |
| dup_hi | 0.16 | `+0.00025` | 170 | 166 | McNemar `[-0.0019954, +0.0024954]` | equivalent |
| road_lo | 0.75 | `-0.00225` | 197 | 233 | clustered `[-0.0048299, +0.0003299]` | equivalent |
| road_hi | 3.0 | `+0.0043125` | 547 | 478 | clustered `[+0.0001707, +0.0084543]` | equivalent |
| city_lo | 1.0 | `+0.0040625` | 315 | 250 | clustered `[+0.0010540, +0.0070710]` | equivalent |
| city_hi | 4.0 | `-0.00475` | 347 | 423 | clustered `[-0.0083120, -0.0011880]` | equivalent |
| settlement_lo | 0.5 | `-0.0008125` | 33 | 46 | McNemar `[-0.0019012, +0.0002762]` | equivalent |
| settlement_hi | 2.0 | `+0.0011875` | 111 | 92 | clustered `[-0.0006084, +0.0029834]` | equivalent |
| recipecap_lo | 2.0 | `+0.000875` | 784 | 770 | clustered `[-0.0041857, +0.0059357]` | equivalent |
| recipecap_hi | 8.0 | `-0.0024375` | 589 | 628 | McNemar `[-0.0067107, +0.0018357]` | equivalent |
| port_lo | 0.275 | `+0.0050625` | 369 | 288 | clustered `[+0.0018446, +0.0082804]` | equivalent |
| port_hi | 1.1 | `-0.0145625` | 558 | 791 | clustered `[-0.0193581, -0.0097669]` | inconclusive |
| portsurplus_lo | 1.0 | `+0.0005` | 464 | 456 | clustered `[-0.0033474, +0.0043474]` | equivalent |
| portsurplus_hi | 5.0 | `+0.00175` | 423 | 395 | clustered `[-0.0019291, +0.0054291]` | equivalent |
| portradius_lo | 1.0 | `-0.00175` | 388 | 416 | clustered `[-0.0053508, +0.0018508]` | equivalent |
| portradius_hi | 3.0 | `-0.00125` | 167 | 187 | clustered `[-0.0036379, +0.0011379]` | equivalent |
| portdecay_lo | 0.25 | `-0.0039375` | 256 | 319 | clustered `[-0.0069163, -0.0009587]` | equivalent |
| portdecay_hi | 1.0 | `+0.00475` | 1088 | 1012 | clustered `[-0.0011887, +0.0106887]` | inconclusive |
| robber_lo | 0.175 | `0.0` | 0 | 0 | clustered `[0.0, 0.0]` | equivalent |
| robber_hi | 0.7 | `0.0` | 0 | 0 | clustered `[0.0, 0.0]` | equivalent |

No arm reached `better`, so per the preregistered rule the screen itself sends nothing to the H4 combine; every reading stands as an H prior. What the table establishes: (1) `diversityWeight` is the one axis with directional signal — monotone across the default, lowering it decisively negative-leaning, raising it positive with the interval crossing +1pp — resolved in M-39/M-40 below. (2) `diversityCap` raised to 8 is decisively `worse` (-1.84pp): the cap at 4 is doing real work containing the diversity term, which coheres with raising the weight helping while raising the cap hurts. (3) Two axes are structurally dead on this instrument, both with literally zero discordant games: `robberDiscount` (the robber starts on the desert, so the discount multiplies zero production on every starting board — the axis is invisible to self-play placement tuning and matters only for the app's mid-game boards) and `scarcityClampMin` lowered to 0.25 (no tuning-schedule board produces a scarcity ratio below the current 0.5 floor). Neither can be tuned by this harness; both should be left at defaults through H. (4) Sub-threshold directional leans worth carrying into H4's deliberation: `portWeight` prefers down (lo +0.51pp with interval entirely positive, hi -1.46pp inconclusive-worse), `recipeCityBonus` prefers down (lo +0.41pp entirely positive, hi negative), `recipeRoadBonus` leans up (+0.43pp, interval barely positive). Everything else is flat inside the threshold at this power.

## M-39 — H1 diversity-weight axis extension

2026-08-25, commit `699a68a2` (prereg; no code change), domain `tuning`. Preregistered in `docs/plans/preregs/2026-08-25-m39-h1-diversity-extension.md` (committed before the run). Spends the remaining two arms of the H1 per-parameter budget on the one axis M-38 left directional: `diversityWeight` at 4.8 and 6.4 (bounds max 6.4), same protocol and reference. Load before `5.12 5.76 4.17`, after `5.89 5.91 4.24` (7s run); 48,000 games, 16,000 paired units per arm over 2000 clusters, zero illegal actions; admissible. Reference win rate `0.2331875`.

| Arm | Estimate | b | c | Selected interval | Verdict |
| --- | ---: | ---: | ---: | --- | --- |
| diversity_48 (4.8) | `+0.01075` | 1422 | 1250 | clustered `[+0.0039310, +0.0175690]` | inconclusive |
| diversity_64 (6.4) | `+0.011` | 1692 | 1516 | clustered `[+0.0035908, +0.0184092]` | inconclusive |

The axis rises from the default and plateaus: +0.70pp at 3.2, +1.08pp at 4.8, +1.10pp at 6.4, the last two statistically indistinguishable. Both intervals sit entirely above zero — the gain is real — but both straddle the +1pp practical threshold, so neither is `better` and the preregistered rule sends nothing to H4 from this run. The plateau locates the useful range at roughly 3x-4x the default with nothing further above; M-40 puts power on the 4.8 point to resolve the threshold question.

## M-40 — H1 diversity-weight confirmation at power

2026-08-25, commit `637ca475` (prereg; no code change), domain `tuning`. Preregistered in `docs/plans/preregs/2026-08-25-m40-h1-diversity-confirmation.md` (committed before the run). One decision arm — `diversityWeight` 4.8, chosen over 6.4 as the smaller deviation at the same plateau estimate — at four times the screen power: 8000 boards x 2 reps, 64,000 paired units over 8000 clusters, same protocol and reference otherwise. The tuning domain's deterministic board schedule means the screen's 2000 boards recur inside this run's 8000, so this is a same-domain re-measurement at power, not an independent replication; `eval` stays unspent. Load before `3.37 5.24 4.10`, after `7.17 6.01 4.40` (20s run); 128,000 games, zero illegal actions; admissible. Reference win rate `0.2345`.

| Arm | Estimate | b | c | Selected interval | Verdict |
| --- | ---: | ---: | ---: | --- | --- |
| diversity_48 (4.8) | `+0.0128906` | 5794 | 4969 | clustered `[+0.0095231, +0.0162581]` | inconclusive |

The interval's lower edge lands at +0.95pp against the +1pp threshold — `inconclusive` by half a tenth of a point. The preregistered rule was fixed exactly for this case: no winner, no further re-runs. H1 therefore closes with an **empty winners list**, and this reading is recorded as the strongest H1 prior: `diversityWeight` around 4.8 is worth roughly +1.3pp (interval `[+0.95pp, +1.63pp]`) against the composite field on the tuning schedule, real beyond doubt but not established above the practical threshold. H4's candidate deliberation may weigh it under Task 24's "best defensible candidate" clause; per the screen rule it does not enter the combine, and the H4 eval confirmation remains the only place an independent domain would price it.

## M-41 — H2 policy-block screens

2026-08-25, commit `5a066658` (prereg; the same commit adds the committed arm files and their pin test, no engine behavior change), domain `tuning`. Preregistered in `docs/plans/preregs/2026-08-25-m41-h2-policy-screens.md` (committed before the runs, including every arm vector). Phase H2 screens every swept policy parameter — the `HeuristicParams` core, the J and knight axes, and the `ThreatParams`, `DevCardParams`, `TradeParams`, and `DenialParams` blocks — as single-parameter perturbation arms (generally half and double the default, clamped to `sweep-bounds.json`; 64 parameters, 128 arms as committed files `placement/arms/h2_*.json`, each pinned as a single-leaf perturbation inside bounds by `the_h2_arm_files_are_single_parameter_perturbations_inside_bounds`). Protocol per the H context: composite field with `--player-trading`, every arm placing via `pip_diversity` like the field so an arm differs from the field only in the one perturbed policy parameter, loaded through the H0 params-file mechanism (each `--arm-policy` names the composite base at the arm's committed `h2_` file); 2000 boards x 2 reps, 16,000 paired units per arm over 2000 clusters; reference `base` = the named composite at defaults, sitting at the symmetric corner (all four seats identical; reference win rate `0.241875` in all six invocations, the deficit to 0.25 being draws and seat effects). Six invocations grouped by block. Loads before/after: h2a `1.81 3.24 3.64` / `10.73 5.28 4.37` (33s), h2b `9.38 5.18 4.34` / `15.73 7.42 5.21` (43s), h2c `15.73 7.42 5.21` / `18.30 9.42 6.07` (49s), h2d `18.30 9.42 6.07` / `20.18 11.10 6.86` (47s), h2e `20.18 11.10 6.86` / `20.72 13.26 8.00` (66s), h2f `20.72 13.26 8.00` / `21.08 14.89 9.03` (68s) — the rising averages are these back-to-back runs themselves; deterministic outcomes, load affects timing only. 240,000 / 304,000 / 336,000 / 336,000 / 432,000 / 496,000 games, zero illegal actions everywhere; admissible.

**TradeConfig disposition (no run, structural).** As preregistered: the screen's estimand — the paired win-rate difference under a hero-only change against an unchanged field — does not exist for `TradeConfig`, because the config is engine-global (one `RuleConfig::player_trading` for all seats), and with the base arm identical to the field the hero's rotated-seat win rate is pinned at the symmetric seat average regardless of the config value. No run can screen it; the axis group is structurally dead on this instrument, the M-38 sense extended from "zero discordant games" to "zero by construction". The `TradeConfig` defaults stay declared placeholders; a per-seat refusal-threshold seam would be the follow-up if per-seat tuning of these flags is ever wanted.

`HeuristicParams` core (h2a):

| Arm | Value | Estimate | b | c | Selected interval | Verdict |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| production_lo | 0.5 | `+0.0014375` | 655 | 632 | McNemar `[-0.0029570, +0.0058320]` | equivalent |
| production_hi | 2.0 | `+0.0029375` | 688 | 641 | McNemar `[-0.0015280, +0.0074030]` | equivalent |
| scarcity_lo | 0.175 | `-0.001875` | 266 | 296 | McNemar `[-0.0047789, +0.0010289]` | equivalent |
| scarcity_hi | 0.7 | `+0.001` | 430 | 414 | clustered `[-0.0026180, +0.0046180]` | equivalent |
| divbonus_lo | 0.7 | `+0.0008125` | 124 | 111 | clustered `[-0.0010655, +0.0026905]` | equivalent |
| divbonus_hi | 2.8 | `+0.0025` | 216 | 176 | clustered `[+0.0000275, +0.0049725]` | equivalent |
| portw_lo | 0.05 | `-0.0001875` | 64 | 67 | McNemar `[-0.0015895, +0.0012145]` | equivalent |
| portw_hi | 0.2 | `+0.00075` | 126 | 114 | clustered `[-0.0011637, +0.0026637]` | equivalent |
| expansion_lo | 0.075 | `+0.00025` | 34 | 30 | McNemar `[-0.0007300, +0.0012300]` | equivalent |
| expansion_hi | 0.3 | `-0.000625` | 45 | 55 | McNemar `[-0.0018499, +0.0005999]` | equivalent |
| robthresh_lo | 2 | `-0.000125` | 161 | 163 | McNemar `[-0.0023300, +0.0020800]` | equivalent |
| robthresh_hi | 7 | `-0.0044375` | 1624 | 1695 | McNemar `[-0.0114944, +0.0026194]` | inconclusive |
| shed_lo | 5.0 | `0.0` | 0 | 0 | clustered `[0.0, 0.0]` | equivalent |
| shed_hi | 20.0 | `0.0` | 0 | 0 | clustered `[0.0, 0.0]` | equivalent |

J axes (h2b):

| Arm | Value | Estimate | b | c | Selected interval | Verdict |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| goalneed_lo | 0.5 | `0.0` | 0 | 0 | clustered `[0.0, 0.0]` | equivalent |
| goalneed_hi | 2.0 | `-6.25e-05` | 1 | 2 | clustered `[-0.0002747, +0.0001497]` | equivalent |
| stageexp_lo | 0.5 | `+6.25e-05` | 10 | 9 | clustered `[-0.0004716, +0.0005966]` | equivalent |
| stageexp_hi | 1.0 | `+0.000375` | 22 | 16 | McNemar `[-0.0003801, +0.0011301]` | equivalent |
| stagecity_lo | 0.5 | `+0.001125` | 154 | 136 | McNemar `[-0.0009610, +0.0032110]` | equivalent |
| stagecity_hi | 2.0 | `+0.002375` | 456 | 418 | clustered `[-0.0012912, +0.0060412]` | equivalent |
| stageurg_lo | 0.5 | `0.0` | 0 | 0 | clustered `[0.0, 0.0]` | equivalent |
| stageurg_hi | 1.0 | `0.0` | 0 | 0 | clustered `[0.0, 0.0]` | equivalent |
| slotret_lo | 2.0 | `+0.0008125` | 77 | 64 | clustered `[-0.0006625, +0.0022875]` | equivalent |
| slotret_hi | 8.0 | `+0.001875` | 254 | 224 | clustered `[-0.0008082, +0.0045582]` | equivalent |
| costpress_lo | 0.5 | `0.0` | 0 | 0 | clustered `[0.0, 0.0]` | equivalent |
| costpress_hi | 2.0 | `0.0` | 0 | 0 | clustered `[0.0, 0.0]` | equivalent |
| frontier_lo | 0.5 | `+0.0006875` | 118 | 107 | McNemar `[-0.0011499, +0.0025249]` | equivalent |
| frontier_hi | 1.0 | `-0.0009375` | 221 | 236 | clustered `[-0.0035794, +0.0017044]` | equivalent |
| devbuy_lo | 0.5 | `+0.024625` | 1413 | 1019 | McNemar `[+0.0185960, +0.0306540]` | **better** |
| devbuy_hi | 2.0 | `+0.0074375` | 712 | 593 | McNemar `[+0.0030138, +0.0118612]` | inconclusive |
| hyst_lo | 0.0625 | `+0.0003125` | 559 | 554 | McNemar `[-0.0037742, +0.0043992]` | equivalent |
| hyst_hi | 0.125 | `-0.00175` | 910 | 938 | clustered `[-0.0071100, +0.0036100]` | equivalent |

`ThreatParams` (h2c):

| Arm | Value | Estimate | b | c | Selected interval | Verdict |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| thrdelay_lo | 0.5 | `-0.000375` | 398 | 404 | clustered `[-0.0038794, +0.0031294]` | equivalent |
| thrdelay_hi | 2.0 | `+0.00125` | 311 | 291 | McNemar `[-0.0017555, +0.0042555]` | equivalent |
| thrneed_lo | 0.175 | `+0.0010625` | 274 | 257 | McNemar `[-0.0017602, +0.0038852]` | equivalent |
| thrneed_hi | 0.7 | `-0.0004375` | 431 | 438 | McNemar `[-0.0040486, +0.0031736]` | equivalent |
| thrblock_lo | 0.125 | `-0.00025` | 135 | 139 | clustered `[-0.0022856, +0.0017856]` | equivalent |
| thrblock_hi | 0.5 | `+0.0008125` | 214 | 201 | clustered `[-0.0017132, +0.0033382]` | equivalent |
| thrsteal_lo | 0.01 | `-0.0005` | 45 | 53 | McNemar `[-0.0017126, +0.0007126]` | equivalent |
| thrsteal_hi | 0.04 | `-0.000125` | 93 | 95 | clustered `[-0.0018578, +0.0016078]` | equivalent |
| thrvictim_lo | 0.075 | `+0.0014375` | 214 | 191 | clustered `[-0.0010336, +0.0039086]` | equivalent |
| thrvictim_hi | 0.3 | `+0.0011875` | 324 | 305 | McNemar `[-0.0018847, +0.0042597]` | equivalent |
| thrfloor_lo | 0.5 | `+0.0014375` | 101 | 78 | clustered `[-0.0002279, +0.0031029]` | equivalent |
| thrfloor_hi | 2.0 | `+0.0013125` | 151 | 130 | McNemar `[-0.0007408, +0.0033658]` | equivalent |
| thrdelaycap_lo | 2.0 | `0.0` | 0 | 0 | clustered `[0.0, 0.0]` | equivalent |
| thrdelaycap_hi | 8.0 | `0.0` | 0 | 0 | clustered `[0.0, 0.0]` | equivalent |
| thrhandcap_lo | 4.0 | `+0.0015` | 253 | 229 | McNemar `[-0.0011893, +0.0041893]` | equivalent |
| thrhandcap_hi | 16.0 | `+0.0013125` | 212 | 191 | clustered `[-0.0011527, +0.0037777]` | equivalent |
| knsteal_lo | 6.0 | `+6.25e-05` | 2 | 1 | clustered `[-0.0001497, +0.0002747]` | equivalent |
| knsteal_hi | 24.0 | `+0.000125` | 5 | 3 | clustered `[-0.0002215, +0.0004715]` | equivalent |
| knplace_lo | 15.0 | `-6.25e-05` | 2 | 3 | clustered `[-0.0003365, +0.0002115]` | equivalent |
| knplace_hi | 60.0 | `+0.0001875` | 7 | 4 | clustered `[-0.0002188, +0.0005938]` | equivalent |

`DevCardParams` (h2d):

| Arm | Value | Estimate | b | c | Selected interval | Verdict |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| dcetw_lo | 0.5 | `-0.001` | 238 | 254 | McNemar `[-0.0037171, +0.0017171]` | equivalent |
| dcetw_hi | 2.0 | `+0.001` | 236 | 220 | McNemar `[-0.0016158, +0.0036158]` | equivalent |
| dcetwfloor_lo | 0.5 | `+0.00025` | 7 | 3 | McNemar `[-0.0001374, +0.0006374]` | equivalent |
| dcetwfloor_hi | 2.0 | `-0.000375` | 6 | 12 | McNemar `[-0.0008947, +0.0001447]` | equivalent |
| dcgaincap_lo | 2.0 | `0.0` | 0 | 0 | clustered `[0.0, 0.0]` | equivalent |
| dcgaincap_hi | 8.0 | `0.0` | 0 | 0 | clustered `[0.0, 0.0]` | equivalent |
| dccompletion_lo | 0.175 | `+6.25e-05` | 1 | 0 | clustered `[-0.0000600, +0.0001850]` | equivalent |
| dccompletion_hi | 0.7 | `0.0` | 0 | 0 | clustered `[0.0, 0.0]` | equivalent |
| dchold_lo | 0.8 | `+0.0009375` | 230 | 215 | McNemar `[-0.0016466, +0.0035216]` | equivalent |
| dchold_hi | 1.0 | `-0.000375` | 115 | 121 | McNemar `[-0.0022568, +0.0015068]` | equivalent |
| dchaul_lo | 0.25 | `-0.000375` | 110 | 116 | McNemar `[-0.0022165, +0.0014665]` | equivalent |
| dchaul_hi | 1.0 | `+0.00125` | 203 | 183 | McNemar `[-0.0011566, +0.0036566]` | equivalent |
| dcmono_lo | 0.5 | `0.0` | 0 | 0 | clustered `[0.0, 0.0]` | equivalent |
| dcmono_hi | 2.0 | `+0.0014375` | 114 | 91 | McNemar `[-0.0003163, +0.0031913]` | equivalent |
| dctempo_lo | 0.1 | `-0.0005625` | 110 | 119 | McNemar `[-0.0024162, +0.0012912]` | equivalent |
| dctempo_hi | 0.4 | `+0.000625` | 139 | 129 | clustered `[-0.0014251, +0.0026751]` | equivalent |
| dctempohalf_lo | 2.0 | `-0.00075` | 49 | 61 | clustered `[-0.0020463, +0.0005463]` | equivalent |
| dctempohalf_hi | 8.0 | `0.0` | 76 | 76 | McNemar `[-0.0015103, +0.0015103]` | equivalent |
| dcexposure_lo | 0.025 | `+0.002625` | 179 | 137 | McNemar `[+0.0004478, +0.0048022]` | equivalent |
| dcexposure_hi | 0.1 | `-0.0013125` | 172 | 193 | McNemar `[-0.0036527, +0.0010277]` | equivalent |

`TradeParams` (h2e):

| Arm | Value | Estimate | b | c | Selected interval | Verdict |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| tretw_lo | 0.5 | `-0.023125` | 1853 | 2223 | McNemar `[-0.0309375, -0.0153125]` | worse |
| tretw_hi | 2.0 | `+0.0424375` | 2684 | 2005 | clustered `[+0.0340602, +0.0508148]` | **better** |
| tretwfloor_lo | 0.5 | `-0.0005` | 171 | 179 | McNemar `[-0.0027917, +0.0017917]` | equivalent |
| tretwfloor_hi | 2.0 | `-0.0019375` | 297 | 328 | McNemar `[-0.0049998, +0.0011248]` | equivalent |
| trgaincap_lo | 2.0 | `0.0` | 0 | 0 | clustered `[0.0, 0.0]` | equivalent |
| trgaincap_hi | 8.0 | `0.0` | 0 | 0 | clustered `[0.0, 0.0]` | equivalent |
| trtempo_lo | 0.1 | `-0.010375` | 2104 | 2270 | clustered `[-0.0185250, -0.0022250]` | inconclusive |
| trtempo_hi | 0.4 | `+0.0366875` | 2678 | 2091 | McNemar `[+0.0282472, +0.0451278]` | **better** |
| trtempohalf_lo | 2.0 | `+0.0169375` | 2371 | 2100 | McNemar `[+0.0087508, +0.0251242]` | inconclusive |
| trtempohalf_hi | 8.0 | `-0.0065625` | 2093 | 2198 | clustered `[-0.0149048, +0.0017798]` | inconclusive |
| trscarcity_lo | 0.125 | `+0.0039375` | 2260 | 2197 | McNemar `[-0.0042403, +0.0121153]` | inconclusive |
| trscarcity_hi | 0.5 | `+0.010625` | 2340 | 2170 | McNemar `[+0.0024001, +0.0188499]` | inconclusive |
| trfloor_lo | 0.5 | `-0.0050625` | 1089 | 1170 | clustered `[-0.0108922, +0.0007672]` | inconclusive |
| trfloor_hi | 2.0 | `+0.014` | 1695 | 1471 | McNemar `[+0.0071108, +0.0208892]` | inconclusive |
| trdangerw_lo | 0.25 | `-0.0054375` | 1097 | 1184 | McNemar `[-0.0112874, +0.0004124]` | inconclusive |
| trdangerw_hi | 1.0 | `+0.014` | 1734 | 1510 | McNemar `[+0.0070264, +0.0209736]` | inconclusive |
| trbenefit_lo | 0.25 | `-0.006625` | 2117 | 2223 | McNemar `[-0.0146943, +0.0014443]` | inconclusive |
| trbenefit_hi | 1.0 | `+0.0283125` | 2547 | 2094 | McNemar `[+0.0199789, +0.0366461]` | **better** |
| trmargin_lo | 3.0 | `-0.0443125` | 1634 | 2343 | McNemar `[-0.0520071, -0.0366179]` | worse |
| trmargin_hi | 12.0 | `+0.07` | 2952 | 1832 | McNemar `[+0.0615970, +0.0784030]` | **better** |
| troffergain_lo | 0.5 | `+0.00825` | 2044 | 1912 | clustered `[+0.0005421, +0.0159579]` | inconclusive |
| troffergain_hi | 2.0 | `-0.0025` | 1994 | 2034 | clustered `[-0.0103276, +0.0053276]` | inconclusive |
| trofferbase_lo | 175.0 | `-0.0133125` | 1163 | 1376 | clustered `[-0.0195172, -0.0071078]` | inconclusive |
| trofferbase_hi | 700.0 | `+0.044` | 2145 | 1441 | McNemar `[+0.0366962, +0.0513038]` | **better** |
| trofferspan_lo | 50.0 | `-6.25e-05` | 0 | 1 | clustered `[-0.0001850, +0.0000600]` | equivalent |
| trofferspan_hi | 200.0 | `+0.003` | 161 | 113 | clustered `[+0.0009613, +0.0050387]` | equivalent |

`DenialParams` (h2f):

| Arm | Value | Estimate | b | c | Selected interval | Verdict |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| dnfloor_lo | 0.5 | `-0.001125` | 114 | 132 | McNemar `[-0.0030462, +0.0007962]` | equivalent |
| dnfloor_hi | 2.0 | `+0.003125` | 208 | 158 | clustered `[+0.0007657, +0.0054843]` | equivalent |
| dnpressfloor_lo | 0.275 | `+0.0010625` | 131 | 114 | McNemar `[-0.0008548, +0.0029798]` | equivalent |
| dnpressfloor_hi | 1.0 | `-0.002625` | 260 | 302 | clustered `[-0.0055378, +0.0002878]` | equivalent |
| dnpressspan_lo | 0.425 | `+0.000125` | 5 | 3 | clustered `[-0.0002215, +0.0004715]` | equivalent |
| dnpressspan_hi | 1.7 | `+0.000125` | 14 | 12 | clustered `[-0.0004998, +0.0007498]` | equivalent |
| dnrace_lo | 0.25 | `0.0` | 0 | 0 | clustered `[0.0, 0.0]` | equivalent |
| dnrace_hi | 1.0 | `0.0` | 0 | 0 | clustered `[0.0, 0.0]` | equivalent |
| dnracemin_lo | 0.125 | `+0.00025` | 6 | 2 | McNemar `[-0.0000965, +0.0005965]` | equivalent |
| dnracemin_hi | 0.5 | `+6.25e-05` | 1 | 0 | clustered `[-0.0000600, +0.0001850]` | equivalent |
| dnracecap_lo | 1 | `0.0` | 0 | 0 | clustered `[0.0, 0.0]` | equivalent |
| dnracecap_hi | 2 | `0.0` | 0 | 0 | clustered `[0.0, 0.0]` | equivalent |
| dndefend_lo | 6000.0 | `0.0` | 0 | 0 | clustered `[0.0, 0.0]` | equivalent |
| dndefend_hi | 24000.0 | `-6.25e-05` | 0 | 1 | clustered `[-0.0001850, +0.0000600]` | equivalent |
| dnheadroom_lo | 0.5 | `0.0` | 0 | 0 | clustered `[0.0, 0.0]` | equivalent |
| dnheadroom_hi | 2.0 | `0.0` | 0 | 0 | clustered `[0.0, 0.0]` | equivalent |
| dnprobe_lo | 1 | `0.0` | 0 | 0 | clustered `[0.0, 0.0]` | equivalent |
| dnprobe_hi | 4 | `0.0` | 0 | 0 | clustered `[0.0, 0.0]` | equivalent |
| dncontest_lo | 30.0 | `-0.0014375` | 108 | 131 | McNemar `[-0.0033311, +0.0004561]` | equivalent |
| dncontest_hi | 120.0 | `+0.0024375` | 199 | 160 | clustered `[+0.0001055, +0.0047695]` | equivalent |
| dncontestcap_lo | 60.0 | `-0.000125` | 7 | 9 | clustered `[-0.0006151, +0.0003651]` | equivalent |
| dncontestcap_hi | 240.0 | `+6.25e-05` | 3 | 2 | clustered `[-0.0002115, +0.0003365]` | equivalent |
| dnblockbonus_lo | 0.25 | `-0.0006875` | 34 | 45 | McNemar `[-0.0017762, +0.0004012]` | equivalent |
| dnblockbonus_hi | 1.0 | `+0.0011875` | 58 | 39 | clustered `[-0.0000305, +0.0024055]` | equivalent |
| dngoalshare_lo | 0.25 | `+6.25e-05` | 3 | 2 | clustered `[-0.0002115, +0.0003365]` | equivalent |
| dngoalshare_hi | 1.0 | `-0.000125` | 7 | 9 | clustered `[-0.0006151, +0.0003651]` | equivalent |
| dnarmy_lo | 40.0 | `-0.000125` | 5 | 7 | clustered `[-0.0005494, +0.0002994]` | equivalent |
| dnarmy_hi | 160.0 | `0.0` | 6 | 6 | clustered `[-0.0004245, +0.0004245]` | equivalent |
| dnarmygap_lo | 0.5 | `-6.25e-05` | 5 | 6 | clustered `[-0.0004689, +0.0003439]` | equivalent |
| dnarmygap_hi | 2.0 | `+0.000125` | 6 | 4 | clustered `[-0.0002624, +0.0005124]` | equivalent |

Six arms reached `better` — the first `better` verdicts Phase H has produced, all on one surface. What the tables establish: (1) **The `TradeParams` block is the hot surface and it is monotone.** Five axes (`etwWeight`, `tempoWeight`, `benefitWeight`, `marginScale`, `offerBase`) are `worse` or negative-leaning at half and decisively `better` at double, with `marginScale` 12 worth +7.00pp; four more (`tempoHalf` down, `scarcityFloor`, `dangerFloor`, `dangerWeight` up) lean the same way with intervals crossing the threshold. All of these price the hero's trade acceptance and offers against three field seats whose own trade behavior is fixed, so the coherent reading is that the default trading weights leave large value on the table at this corner by trading too generously; whether that survives the combined vector and an independent domain is exactly what H4's coordinate pass and eval confirmation exist to answer. Resolved in M-42 below at the bounds endpoints. (2) `devBuyScale` 0.5 is `better` at +2.46pp, the SIM-GAP-24 answer (see M-42 for the 0.25 extension; the entry's own rule says a `better` at a lower scale confirms the dev-band bias, and it is confirmed — with the wrinkle that 2.0 is also mildly positive, so the default sits in a local dip rather than on a monotone slope). (3) Everything else is quiet: every core, threat, dev-card, and denial axis is `equivalent` or `inconclusive` inside the threshold at this power, consistent with the M-31/M-37 tiny-surface priors (the knight axes moved single-digit game counts; the J axes reproduce their plain-trader-field flatness at the composite corner, including hysteresis at sub-0.25 margins). Structurally dead at the symmetric corner with literally zero discordant games: `shedWeight` (both directions), `goalNeedWeight` lo, `stageUrgencyWeight`, `costPressureWeight`, `threat.delayCap`, `devCards.gainCap`, `devCards.monopolySoundFloor` lo, `trading.gainCap`, and seven `DenialParams` axes (`raceBonus`, `raceCheckCap`, `defendWeight` lo, `defendHeadroomHalf`, `defendProbeSlack`, and near-zero counts on the rest) — the denial machinery fires so rarely between identical composites that its weights cannot be tuned by this instrument. Per the preregistered rule the six `better` arms go to the H4 combine (as amended by M-42's extensions) and everything else stands as priors.

## M-42 — H2 trading-axis extension

2026-08-25, commit `2c371889` (prereg; the same commit adds the ten committed extension arms), domain `tuning`. Preregistered in `docs/plans/preregs/2026-08-25-m42-h2-trading-extension.md` (committed before the run). One further arm per hot M-41 axis, inside the preregistered 2-4 arm budget: the five trading winners at their sweep-bounds maxima (4x default), the four crossing axes at their unprobed endpoints, `devBuyScale` at the bounds minimum 0.25. Same protocol and reference; one invocation, 11 arms, 176,000 games. Load before `2.52 6.20 6.99`, after `13.49 8.39 7.75` (24s run); zero illegal actions; admissible. Reference win rate `0.241875`.

| Arm | Value | Estimate | b | c | Selected interval | Verdict |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| tretw_40 | 4.0 | `+0.0844375` | 3251 | 1900 | McNemar `[+0.0757437, +0.0931313]` | **better** |
| trtempo_80 | 0.8 | `+0.069` | 3076 | 1972 | clustered `[+0.0603164, +0.0776836]` | **better** |
| trbenefit_20 | 2.0 | `+0.05575` | 2925 | 2033 | McNemar `[+0.0471679, +0.0643321]` | **better** |
| trmargin_24 | 24.0 | `+0.122313` | 3621 | 1664 | McNemar `[+0.1136112, +0.1310138]` | **better** |
| trofferbase_1400 | 1400.0 | `+0.044` | 2145 | 1441 | McNemar `[+0.0366962, +0.0513038]` | **better** |
| trtempohalf_10 | 1.0 | `+0.0225625` | 2568 | 2207 | clustered `[+0.0140878, +0.0310372]` | **better** |
| trscarcity_10 | 1.0 | `-0.008` | 2187 | 2315 | clustered `[-0.0162739, +0.0002739]` | inconclusive |
| trfloor_40 | 4.0 | `+0.027375` | 2333 | 1895 | McNemar `[+0.0194211, +0.0353289]` | **better** |
| trdangerw_20 | 2.0 | `+0.031` | 2381 | 1885 | McNemar `[+0.0230135, +0.0389865]` | **better** |
| devbuy_25 | 0.25 | `+0.0406875` | 1911 | 1260 | McNemar `[+0.0338183, +0.0475567]` | **better** |

Four trading axes are **still rising at their committed bounds** — `etwWeight` (+8.44pp at 4.0 vs +4.24pp at 2.0), `tempoWeight` (+6.90 vs +3.67), `benefitWeight` (+5.58 vs +2.83), and `marginScale` (+12.23pp at 24, the largest estimate the programme has recorded) — and per the preregistered rule the bounds are not widened to chase them; the record is that the axis is unexhausted at its bound. `offerBase` is exactly saturated: 700 and 1400 produce identical discordance counts (2145/1441) and estimate, so past 700 the offer-pricing term stops changing any decision and 700 is the winner as the smaller deviation. `tempoHalf` 1.0 resolves its crossing to `better` (+2.26pp); `dangerFloor` 4.0 and `dangerWeight` 2.0 likewise (+2.74pp, +3.10pp). `scarcityFloor` turns non-monotone (-0.80pp at 1.0 after +1.06pp at 0.5) and stays a prior, not a winner. `devBuyScale` deepens to +4.07pp at 0.25: the SIM-GAP-24 bias is confirmed decisively — the cheaper the policy prices dev buying, the better it does at this corner, all the way to the bound — and the entry is deleted with this reading. **H4 combine list (largest `better` estimate per axis):** `trading.etwWeight` 4.0, `trading.tempoWeight` 0.8, `trading.benefitWeight` 2.0, `trading.marginScale` 24.0, `trading.offerBase` 700.0, `trading.tempoHalf` 1.0, `trading.dangerFloor` 4.0, `trading.dangerWeight` 2.0, `devBuyScale` 0.25. The standing caution for H4 and the eval confirmation: all nine winners shift the same trade-selection machinery against a field whose trade behavior is fixed, so their effects will interact and part of the gain may be exploitation of this particular field; the coordinate re-screen at the combined point and the single eval spend are the designed checks.

## M-43 — H3 `handValue` drop A/B

2026-08-25, commit `54406d43` (prereg; no code change), domain `tuning`. Preregistered in `docs/plans/preregs/2026-08-25-m43-h3-handvalue.md` (committed before the run). Phase H3 settles the programme's open `handValue` question by measurement: one decision arm — `hand_zero` = the committed default weights with `handValueWeight: 0` (`simulator/placement/arms/h3_hand_zero.json`; the committed bounds minimum on this axis is 0.0) — against reference `base` = `simulator/placement/default-weights.json` loaded as an app-formula arm (`handValueWeight` 0.4), at M-40 power: `evaluate`, standard4, 4 seats, field `pip_diversity`, every seat on `heuristic-v1-trader-aware-threat-devcards-denial` with `--player-trading`, 8000 boards x 2 reps (64,000 paired units over 8000 clusters). The field choice is what makes the null informative: downstream play is ETW-aware in both arms, so a null on zeroing reads "the explicit placement-time term adds nothing ETW-aware play does not realize", while a real loss reads "the term still carries unique placement-choice signal". Load before `1.96 3.33 5.29`, after `7.84 4.57 5.69` (18s run); 128,000 games, zero illegal actions; admissible. Reference win rate `0.2345`.

| Arm | Estimate | b | c | Selected interval | Verdict |
| --- | ---: | ---: | ---: | --- | --- |
| hand_zero (0.0) | `-0.0013125` | 690 | 774 | clustered `[-0.0025326, -0.0000924]` | equivalent |

The preregistered rule — recommend dropping the term only on `equivalent` with the selected interval strictly inside ±1pp — is met, so the recorded answer is **drop recommended**: ETW-aware play subsumes the term at this corner. The honest shape of the reading, recorded alongside: the interval sits entirely below zero, so the term is not literally worthless — zeroing it costs a real but tiny ~0.13pp on a small live surface (1,464 of 64,000 paired units discordant), an order of magnitude under the practical threshold and consistent with M-38's flat magnitude screen (0.2 read -0.18pp, 0.8 read +0.06pp, both `equivalent`). Nothing shipped changes: the drop recommendation is an input to the user's Phase I decision, and the H4 combine takes nothing from this run (the rule can only recommend removing a term, never adds a `better` arm). Answer folded into `programme.md`'s open-question section.

## M-44 — H4 combined vector and coordinate pass

2026-08-25, commit `50e8ab4c` (prereg; the same commit adds the ten committed `h4_*` arm files and their pin test, no engine behavior change), domain `tuning`. Preregistered in `docs/plans/preregs/2026-08-25-m44-h4-combine-coordinate.md` (committed before the run). Phase H4's combine: `simulator/placement/arms/h4_combined.json` applies the nine M-41/M-42 winners together (`trading.etwWeight` 4.0, `trading.tempoWeight` 0.8, `trading.benefitWeight` 2.0, `trading.marginScale` 24.0, `trading.offerBase` 700.0, `trading.tempoHalf` 1.0, `trading.dangerFloor` 4.0, `trading.dangerWeight` 2.0, `devBuyScale` 0.25), and each `h4_no_<slug>.json` reverts one winner to its default, so with **reference = `combined`** each revert arm's paired contrast is that winner's marginal value at the combined point, and the `base` contrast (sign-flipped) is the full combine's tuning estimate. The pin test loads every file through the full H0 contract, discharging H4's headroom re-check mechanically. Same protocol otherwise (composite field, `--player-trading`, 2000 boards x 2 reps, 16,000 paired units per contrast). Load before `4.05 2.90 4.09`, after `11.46 4.75 4.70` (~35s); 176,000 games, zero illegal actions; admissible. Combined win rate `0.343875`, base `0.241875`.

| Arm | Reverted axis | Estimate | b | c | Selected interval | Verdict | Rule outcome |
| --- | --- | ---: | ---: | ---: | --- | --- | --- |
| base | (all nine) | `-0.102` | 1824 | 3456 | clustered `[-0.1109624, -0.0930376]` | worse | combine worth +10.20pp on tuning |
| no_tretw | trading.etwWeight | `-0.0145` | 2085 | 2317 | McNemar `[-0.0226243, -0.0063757]` | inconclusive | **keep** 4.0 |
| no_trtempo | trading.tempoWeight | `+0.03875` | 2998 | 2378 | clustered `[+0.0296880, +0.0478120]` | **better** | revert to 0.2 |
| no_trbenefit | trading.benefitWeight | `+0.053875` | 3221 | 2359 | clustered `[+0.0446744, +0.0630756]` | **better** | revert to 0.5 |
| no_trmargin | trading.marginScale | `+0.001125` | 577 | 559 | clustered `[-0.0030622, +0.0053122]` | equivalent | revert to 6.0 |
| no_trofferbase | trading.offerBase | `-0.0023125` | 653 | 690 | McNemar `[-0.0068015, +0.0021765]` | equivalent | revert to 350.0 |
| no_trtempohalf | trading.tempoHalf | `+0.036` | 2862 | 2286 | McNemar `[+0.0272286, +0.0447714]` | **better** | revert to 4.0 |
| no_trfloor | trading.dangerFloor | `+0.0064375` | 1262 | 1159 | McNemar `[+0.0004110, +0.0124640]` | inconclusive | **keep** 4.0 |
| no_trdangerw | trading.dangerWeight | `+0.0049375` | 1283 | 1204 | McNemar `[-0.0011710, +0.0110460]` | inconclusive | **keep** 2.0 |
| no_devbuy | devBuyScale | `-0.0061875` | 701 | 800 | McNemar `[-0.0109324, -0.0014426]` | inconclusive | **keep** 0.25 |

The interaction the M-42 caution predicted is real and large. The nine single-arm estimates summed to an impossible ~+48pp; together they are worth +10.20pp, and at the combined point five winners no longer earn their deviation: removing `tempoWeight` 0.8, `tempoHalf` 1.0, or `benefitWeight` 2.0 each *improves* the combined vector by 3.6-5.4pp (`better` — those three are harmful in combination), and `marginScale` 24.0 and `offerBase` 700.0 are absorbed to `equivalent` (the +12.23pp `marginScale` single, the largest estimate the programme recorded, contributes nothing once the other trade axes have moved — the parsimony rule reverts both). The four keeps (`etwWeight` 4.0, `dangerFloor` 4.0, `dangerWeight` 2.0, `devBuyScale` 0.25) all read removal-negative, `no_tretw` decisively so. Per the preregistered revert rule the final vector `simulator/placement/arms/h4_final.json` (committed `a94a70b5`, pin test extended) carries exactly those four, and the preregistered follow-up ran at the same power with **reference = `final`** (load before `6.99 4.67 4.67`, after `6.84 4.76 4.70`, ~15s; 48,000 games, zero illegal actions; final win rate `0.3894375`): `base` `worse` at `-0.1475625`, McNemar `[-0.1564490, -0.1386760]` (the final vector is worth **+14.76pp** on tuning, 5611/16000 discordant), and `combined` `worse` at `-0.0455625`, clustered `[-0.0548870, -0.0362380]` — the five reverts gained +4.56pp of real value in combination, so per the rule the eval candidate is `h4_final.json`, carried to M-45.

## M-45 — H4 eval confirmation of the final vector

2026-08-25, commit `9f51a5b1` (prereg; no code change), **domain `eval` — the single authorized eval spend**. Preregistered in `docs/plans/preregs/2026-08-25-m45-h4-eval-confirmation.md` (committed before the run). One decision arm: `final` = the composite at `simulator/placement/arms/h4_final.json` (`trading.etwWeight` 4.0, `trading.dangerFloor` 4.0, `trading.dangerWeight` 2.0, `devBuyScale` 0.25, everything else at defaults) against reference `base` = the named composite at defaults, at confirmation power on the held-out domain: 8000 boards x 2 reps, 64,000 paired units over 8000 clusters, composite field with `--player-trading`, `pip_diversity` placement everywhere. `eval` had previously been spent only on the `resourceValue` spread question; it was unspent for every axis in this vector. Load before `6.54 4.88 4.74`, after `12.62 6.37 5.28` (~20s); 128,000 games, zero illegal actions; admissible. Base win rate `0.2520156`, final `0.3917656`.

| Arm | Estimate | b | c | Selected interval | Verdict |
| --- | ---: | ---: | ---: | --- | --- |
| final | `+0.13975` | 15812 | 6868 | McNemar `[+0.1352669, +0.1442331]` | **better** |

The preregistered confirmation condition is met decisively: the tuning-domain estimate (+14.76pp) survives the seed-domain change nearly intact (+13.98pp, interval `[+13.53pp, +14.42pp]`, 22,680 of 64,000 units discordant), so the H4 gain is not an artifact of the tuning seeds. The vector is recorded as the committed Phase-I candidate: `simulator/placement/phase-i-candidate-params.json` (the policy side, byte-shape-identical to `h4_final.json`) and `simulator/placement/phase-i-candidate-weights.json` (the placement side — today's `default-weights.json` unchanged, H1 having produced no winner), both pinned by `the_phase_i_candidate_files_load_and_match_their_confirmed_vectors`. The standing caution stays recorded: all four kept axes tune the hero's trade machinery against this exact fixed field, and a seed-domain change does not remove field-overfit risk — pricing that residual is precisely the Phase-I `gate` question, which is the user's. Nothing is adopted: `simulator/placement/default-weights.json`, the Rust param defaults, and `src/engine/weights.ts` are byte-identical to the branch point. H is done; Phase I awaits the user.

## M-46 — Phase I gate decision: the candidate is adopted

2026-08-27, prereg commit `0d7bb684` (no code change), **domain `gate` — the single authorized gate spend, delegated by the user ("you do phase i")**. Preregistered in `docs/plans/preregs/2026-08-27-m46-phase-i-gate.md` (committed before the run). Design mirrors M-45 with only the domain changed: one decision arm `candidate` = the composite at `simulator/placement/phase-i-candidate-params.json` (`trading.etwWeight` 4.0, `trading.dangerFloor` 4.0, `trading.dangerWeight` 2.0, `devBuyScale` 0.25, everything else at defaults) against reference `base` = the named composite at defaults, 8000 boards x 2 reps, 64,000 paired units over 8000 clusters, composite field with `--player-trading`, `pip_diversity` placement everywhere. Load before `3.38 2.61 2.51`, after `8.06 3.76 2.92` (~20s); 128,000 games, zero illegal actions; admissible. Base win rate `0.2514688`, candidate `0.3924844`.

| Arm | Estimate | b | c | Selected interval | Verdict |
| --- | ---: | ---: | ---: | --- | --- |
| candidate | `+0.1410156` | 15732 | 6707 | clustered `[+0.1365087, +0.1455226]` | **better** |

The gain survives its third seed domain essentially unchanged (+14.76pp tuning, +13.98pp eval, +14.10pp gate), so per the preregistered rule the **Phase-I package is adopted**:

- `TradeParams::default()` moves to `etw_weight` 4.0, `danger_floor` 4.0, `danger_weight` 2.0, and `HeuristicParams::default()` to `dev_buy_scale` 0.25; `simulator/placement/policy-default-params.json` regenerated to match. The candidate params file now equals the live defaults, pinned by `the_phase_i_candidate_files_record_the_adopted_vectors`.
- The M-43 `handValue` drop rides the package as preregistered: `handValueWeight` 0 in `simulator/placement/default-weights.json` and `src/engine/weights.ts`. The term code stays; the SU-7 suite now pins the mechanism at an explicit 0.4 witness weight and pins the shipped default at 0. `simulator/fixtures/placement-parity.json` needs no regeneration: each fixture case embeds the weights it was generated with, and no scorer logic changed.
- The M-40 `diversityWeight` ~4.8 prior is **not** adopted (never earned a `better` verdict); it stays a recorded prior. The SIM-GAP-33 block-bonus fix does not ride along and still owes its own preregistered `tuning` A/B, now against the adopted defaults.

Mechanical consequences of moving the defaults, all documented in the tests they touched: the three corpus oracles (`denial-gate-baseline.json`, `robber-gate-baseline.json`, `trading-gate-baseline.json`) were regenerated through their committed `generate_*` harnesses because plain `heuristic-v1` play moves under `devBuyScale` 0.25; every replay-derived `player_trading.rs` fixture was re-derived through the committed `refind_replay_fixtures`/`find_forwarding_fixtures` scans and the explicit-state margin witnesses recomputed at the adopted params; the `h2_*`/`h2x_*`/`h4_*` arm pins re-anchor to a literal `screen_baseline_value()` (the pre-adoption composite the screens were generated against — arm bytes unchanged); the M21 flip witness seed moved to 667; and the trade-side `danger_floor` is now deliberately decoupled from the threat/denial/embargo floors, which keep 1.0 (the sweep moved only the trade axis, and the decoupling is pinned). Both cargo profiles and the full JS suite are green.

The standing field-overfit caution transfers to the adopted defaults verbatim: all four axes tune the hero's trade machinery against this exact fixed field, gate reuses that field, and the +14pp is an estimate against it, not against a changed opponent pool. These are the defaults *for this simulator's composite policy against this field*; a future field change re-opens the question on fresh `tuning` seeds. All three seed domains are now spent for these parameters; there is no unbiased domain left, so no re-measurement of this vector is possible — a genuinely new question needs new preregistered domains.
