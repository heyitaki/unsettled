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

## M-47: SP0-D1 coastal selection

2026-09-01, commit `3765e688` (the preregistration commit; the `diagnose` subcommand and the D1 statistic landed earlier in this run at `be2fd2dd` and `0e30c6fa`, and no shipped default moved), domain `tuning`. Preregistered in `docs/plans/preregs/2026-09-01-m47-sp0-d1-coastal-selection.md` (committed before the run). SP0's first reading, sizing `SIM-GAP-35`: over every setup pick the shipped app formula makes, the run rebuilds the ownership state as it stood immediately before the pick, re-scores every legal candidate vertex through `placement::setup_candidate_score` with the same `grant` flag the pick carried, and pairs the chosen vertex with the best-scoring unchosen legal alternative whose pip total is within one of it. Hex count means adjacent hexes carrying both a resource and a token; pip total is the sum of pips over those hexes. A pick with no such alternative is skipped, and a pair whose two hex counts are equal is discarded. **This is a diagnostic, not an A/B**: no arms, no reference, no field contrast and no hero-seat rotation, so it carries no verdict and the paired-statistics disposition rule does not apply to it. What it produces is the preregistered gate boolean for SP2c. The same invocation produced M-48.

```text
cargo run --release -p unsettled-sim -- diagnose --layout standard4 --seats 4 --domain tuning --placement app_formula:placement/default-weights.json --boards 2000 --reps 2 --policy heuristic-v1-trader-aware-threat-devcards-denial --player-trading --alpha 0.05 --threads 0 --out runs/m47-m48-sp0-diagnostic
```

Load before `1.32 1.74 2.05`, after `1.32 1.74 2.05` (0.78s at 18 workers); 4000 games, all decided, no draws, 32,000 setup picks, **zero illegal actions**; admissible. Every seat is on the same placement and the same policy, so a seat's unconditional win rate is 0.25 by construction and that is the baseline every rate below is read against. Of the 32,000 picks, 1,492 had no pip-matched legal alternative and were skipped and 24,459 pairs tied on hex count and were discarded, leaving **6,049 pairs** spread over 1,681 of the 2,000 boards, which are the clusters the intervals are taken over.

| Slot | Pairs | Lower-hex chosen | Share | Clustered interval | Clusters | Lower-hex win rate | Higher-hex win rate | Win-rate gap |
| --- | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: |
| overall | 6049 | 2733 | `0.4518102` | `[0.4356736, 0.4679468]` | 1681 | `0.2056348` | `0.2557298` | `+0.0500950` |
| 0 | 1491 | 703 | `0.4714956` | `[0.4357429, 0.5072484]` | 748 | `0.2446657` | `0.2918782` | `+0.0472125` |
| 1 | 1426 | 622 | `0.4361851` | `[0.3998361, 0.4725341]` | 712 | `0.2234727` | `0.2524876` | `+0.0290149` |
| 2 | 1401 | 617 | `0.4403997` | `[0.4042821, 0.4765173]` | 675 | `0.1750405` | `0.2525510` | `+0.0775105` |
| 3 | 1731 | 791 | `0.4569613` | `[0.4249053, 0.4890173]` | 798 | `0.1807838` | `0.2308511` | `+0.0500672` |

**Gate outcome: `sp2cGatePassed` false, so SP2c does not run.** The two preregistered conditions split. The first fails, and decisively rather than marginally: the share sits at 45.18% with its clustered interval `[43.57%, 46.79%]` entirely *below* 50%, so the formula does not prefer the lower hex count among pip-matched candidates, it reliably prefers the higher one, in 54.8% of the pairs that express a preference at all. The second passes: the picks that took the lower hex count won 20.56% of their games against 25.57% for the picks that took the higher one, a gap of +5.01pp, five times the registered 1pp threshold. The gate is the conjunction, so it fails. The per-slot rows carry no gate weight by preregistration and none of them would change the outcome anyway: every slot's share is below 50%, three of the four intervals sit entirely below it, and slot 0's `[0.4357, 0.5072]` is the only one that straddles. Every slot's win-rate gap is positive, from +2.90pp at slot 1 to +7.75pp at slot 2.

Read together the two rows point the same way, which is why the gate is built as a conjunction: the formula leans toward more hexes and more hexes is also what wins, so there is no bias here for a hex-count tempo term to correct. `SIM-GAP-35`'s mechanism is real, the setup grant does pay per producing hex regardless of token and `handValueWeight` is 0, but the residual preference the shipped formula expresses through its diversity, coverage, duplicate-number and port terms already leans toward hex count rather than against it. The M-47 prediction was half right: the direction of the share was called correctly and for the stated reason, and the win-rate gap was called wrong, predicted under 1pp and of uncertain sign, measured at +5.01pp and positive at every slot.

Two limits on how far this reaches, recorded now rather than discovered later. The win-rate split is **observational, not randomized**: which side of the pair got taken is the formula's own choice, so the +5.01pp is a contrast between two self-selected groups of picks. Pip matching to within one pip removes the dominant confound, and the runner-up was never played, so nothing here licenses the claim that adding a hex at fixed pips causes a win-rate gain of any particular size. And 76.4% of picks tied on hex count and were discarded, so the reading describes the minority of picks where a hex-count difference existed at matched pips, which is the subset the question is about but is not most of the draft. Exact ties at the top candidate score are broken by lowest vertex index, since the diagnostic ranks rather than picks and has no RNG stream to draw on: 773 of the 32,000 picks had such a tie, and only 5 of those held tied candidates whose hex counts differed, so at most 5 of the 6,049 recorded pairs turn on scan order rather than on score.

## M-48: SP0-D2 expansion boxing and blockability

2026-09-01, commit `3765e688` (the preregistration commit; the D2 statistics landed earlier in this run at `dfcf99b5`, and no shipped default moved), domain `tuning`. Preregistered in `docs/plans/preregs/2026-09-01-m48-sp0-d2-expansion-blockability.md` (committed before the run). The **same single `diagnose` invocation as M-47**, whose command, load, admissibility and 4000 games are recorded there: one run, three readings, because they are three statistics over one set of observed games rather than three experiments. Two quantities are read off each seat's pair at the moment its second setup pick lands, which is the last moment either is still a fact about the placement alone, and each is joined to how that seat's game ended. **Boxing:** the number of legal expansion sites the pair can reach by adding at most two roads to its own road network, a site being a vertex unoccupied and not adjacent to an occupied vertex at that moment, following `policy::frontier::opened` for what counts as a target. **Blockability:** the share of the pair's total pips sitting on its single highest-pip hex, over the distinct producing hexes adjacent to either settlement. Both are reported as the win rate of the top quartile minus the win rate of the bottom quartile, cut at quarter *values* rather than at ranks and cut identically, so the two magnitudes are comparable and the branch below compares like with like. **This is a diagnostic, not an A/B**, and the D2 gaps carry no interval and no significance claim: what they carry is size, which is what SP3's A/B needs to be powered. 16,000 completed pairs, 4000 games times 4 seats. A seat's unconditional win rate is 0.25 by construction.

**Zero reachable expansion sites: 0 of 16,000 pairs, at every slot, an incidence of 0.00%.** The observed range is 1 to 20 sites.

| Slot | Boxing bottom cut | Bottom n | Bottom mean sites | Bottom win rate | Boxing top cut | Top n | Top mean sites | Top win rate | Gap |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| overall | `<= 7` | 4992 | `5.5917` | `0.2169471` | `>= 11` | 4986 | `12.4813` | `0.2815884` | `+0.0646413` |
| 0 | `<= 5` | 1175 | `4.0843` | `0.2238298` | `>= 9` | 1136 | `10.0343` | `0.3362676` | `+0.1124378` |
| 1 | `<= 7` | 1388 | `5.7233` | `0.2255043` | `>= 10` | 1389 | `11.3204` | `0.3059755` | `+0.0804712` |
| 2 | `<= 8` | 1334 | `6.7526` | `0.1664168` | `>= 12` | 1020 | `13.0647` | `0.3058824` | `+0.1394656` |
| 3 | `<= 9` | 1273 | `7.6968` | `0.2050275` | `>= 13` | 1148 | `14.1882` | `0.2604530` | `+0.0554255` |

| Slot | Blockability bottom cut | Bottom n | Bottom mean share | Bottom win rate | Blockability top cut | Top n | Top mean share | Top win rate | Gap |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| overall | `<= 0.2380952` | 5383 | `0.2285860` | `0.2985324` | `>= 0.2777778` | 4908 | `0.2962879` | `0.1848003` | `-0.1137321` |
| 0 | `<= 0.2380952` | 1583 | `0.2277978` | `0.3240682` | `>= 0.2777778` | 1077 | `0.2976659` | `0.1922006` | `-0.1318677` |
| 1 | `<= 0.2380952` | 1377 | `0.2290544` | `0.3159041` | `>= 0.2777778` | 1191 | `0.2964935` | `0.1956339` | `-0.1202702` |
| 2 | `<= 0.2380952` | 1278 | `0.2284978` | `0.2707355` | `>= 0.2777778` | 1273 | `0.2948351` | `0.1775334` | `-0.0932021` |
| 3 | `<= 0.2380952` | 1145 | `0.2292107` | `0.2733624` | `>= 0.2777778` | 1367 | `0.2963761` | `0.1762985` | `-0.0970640` |

The arms are not exactly 4,000 apiece because the cuts are on values: every pair holding the boundary value joins its arm, which is the preregistered construction working as declared and is why the blockability arms (5,383 and 4,908) are more lopsided than the boxing ones (4,992 and 4,986). No pair had zero producing hexes, so the 0-by-convention case never arose; the observed blockability range is `0.1818182` to `0.4545455`, so concentration never exceeded about 45% of a pair's pips on one hex.

**Boxing: +6.46pp overall, positive at every slot, from +5.54pp at slot 3 to +13.95pp at slot 2.** The prediction was right in direction and in rough size. One property of the reading limits how the overall row may be used: the snake completes pairs at pick indices 4, 5, 6 and 7 for slots 3, 2, 1 and 0, so slot 3's pair completes with five settlements on the board and slot 0's with all eight, and the quantity's scale moves with that fill, visible in cuts that walk from `<= 5` and `>= 9` at slot 0 to `<= 9` and `>= 13` at slot 3. The **per-slot rows are the comparable ones**; the overall row pools four quantities whose scale differs by slot, and SP3 should power its arm off a per-slot magnitude rather than the pooled one. Blockability has no such property: its cuts are identical at all four slots, because it is a property of the pair's own hexes and does not depend on how full the board is.

**Branch outcome: `robberAttractionRevisit` true, so the dropped robber-attraction term is revisited.** The absolute blockability gap, `0.1137321`, exceeds the absolute boxing gap, `0.0646413`, by nearly two to one, and the blockability gap is unambiguously negative at every slot: pairs piling a larger share of their pips onto one hex win less often, by 11.37pp between the outer quartiles. The M-48 prediction was wrong here, and stated the case that would change its mind exactly: a blockability gap both large and negative. Per the preregistration the term comes back as a **separate item to be specified inside SP3's scope**, and this run does not build it; SP3 is out of scope here.

One confound the specification has to resolve before that term is built, recorded now because nothing in this run separates it. Blockability and hex count are mechanically entangled: the share on the top hex has a floor near one over the number of producing hexes the pair touches, so a pair on few hexes cannot score low on it, and the top blockability quartile is therefore enriched in low-hex-count pairs, which M-47 independently found win about 5pp less often. This reading does not distinguish "one robber can take this economy away" from "this pair touches few hexes", and the diagnostic measured no quantity that would. Whoever specifies the revisited term has to separate the two, or it will price hex count under another name, on the same surface M-47 just closed SP2c over. The branch boolean is recorded as it read, and the confound is recorded beside it rather than after the fact.

**Zero-site incidence answers the threshold question SP3's merge was hedged against, and answers it cleanly.** Not one of 16,000 pairs was boxed to zero reachable sites, so at four seats on `standard4` the threshold case a single gradient term could not carry does not occur at pair completion, and the response over the observed 1-to-20 range is a gradient. That is the reading SP3's one-term merge needed; it does not extend to `extension6` or to other seat counts, which this run did not observe.

## M-49: `SIM-GAP-33` contest block-bonus predicate

2026-09-01, commit `5f27c8ef` (the preregistration commit; the predicate fix itself landed at `65203baa` and no shipped default moved), domain `tuning`. Preregistered in `docs/plans/preregs/2026-09-01-m49-simgap33-block-predicate.md` (committed before the run). `denial.rs::contest_term` scales a rival's danger contribution by `1 + contest_block_bonus` when the candidate edge is that rival's last remaining one-road approach to the contested vertex; until `65203baa` that predicate decided "blocked" from build legality alone, so a rival already owning an edge incident to the vertex passed it despite being able to settle there with no new road. The fix adds the missing condition. **The arm is the code change, not a parameter**: no key in `DenialParams` distinguishes the two predicates and no legacy flag was minted, so the run uses the preregistered two-build protocol against the pre-change binary.

The two builds: pre-change at `47b1f39a` in a detached scratch worktree, post-change at the tree above. The only compiled delta between them is `simulator/crates/engine/src/policy/denial.rs`; everything else that moved is markdown or `simulator/crates/engine/tests/denial.rs`, which the binary does not link. Both built `--release`, both `meta.json` recording `rustc 1.94.0 (4a4ef493e 2026-03-02)`, so no toolchain mismatch. Because a code change applies to every seat in its own build, an all-composite field would cancel it by construction; following M-26, the field here is `heuristic-v1-trader-aware-threat-devcards`, the shipped composite minus exactly the component under test, and the composite sits on the hero seat alone.

```text
git worktree add --detach /tmp/unsettled-m49-pre 47b1f39ac84b88fba6ddf8268048f56088f862f0
RUSTFLAGS="-D warnings" cargo build --release --manifest-path /tmp/unsettled-m49-pre/simulator/Cargo.toml -p unsettled-sim
RUSTFLAGS="-D warnings" cargo build --release --manifest-path simulator/Cargo.toml -p unsettled-sim

# pre-change, from simulator/
/tmp/unsettled-m49-pre/simulator/target/release/unsettled-sim evaluate --layout standard4 --seats 4 --domain tuning --field pip_diversity --arm base=pip_diversity --arm block=pip_diversity --arm-policy base=heuristic-v1-trader-aware-threat-devcards --arm-policy block=heuristic-v1-trader-aware-threat-devcards-denial --reference base --boards 2000 --reps 2 --policy heuristic-v1-trader-aware-threat-devcards --threads 0 --player-trading --threshold 0.01 --alpha 0.05 --out runs/m49-pre

# post-change, from simulator/, identical in every other argument
target/release/unsettled-sim evaluate ... --out runs/m49-post
```

Load before the pre-change run `1.32 1.39 1.73`, after `2.89 1.72 1.84` (3.81s at 18 workers); before the post-change run `2.66 1.69 1.83`, after `4.05 1.99 1.93` (3.81s at 18 workers). 32,000 games per run, 64,000 total, **zero illegal actions in both**; the two invocations ran one at a time, after both builds finished, with no other CPU-heavy job. **The `base` identity check passes exactly**: 16,000 games, 3,986 wins, 0 draws in both artifacts, so no seat outside the changed code moved and the two runs share one reference vector. Both runs are admissible.

| Run | Arm | Estimate | b | c | Selected interval | Verdict |
| --- | --- | ---: | ---: | ---: | --- | --- |
| pre (`47b1f39a`) | block | `+0.0100625` | 730 | 569 | clustered `[+0.0054648, +0.0146602]` | inconclusive |
| post (`65203baa`) | block | `+0.0100000` | 729 | 569 | clustered `[+0.0054036, +0.0145964]` | inconclusive |

**The decision statistic.** `delta = est_post - est_pre = -0.0000625`, interval `[-0.0065637, +0.0064387]` from the two selected half-widths combined in quadrature as preregistered. That lies strictly inside +-1pp, so **`delta` reads `equivalent`**: the predicate correction cost nothing and bought nothing measurable, its point estimate being 0.006pp against a 1pp practical threshold. Each run's own `block` verdict is `inconclusive` and answers a different question (whether the denial component beats a denial-free field, which lands almost exactly on the +1pp threshold at about +1.0pp with the interval straddling it), and it is not the decision.

**Disposition, per the preregistered rule.** This is a correctness fix and it lands whatever the verdict; `equivalent` records it as **costless**, so there is nothing to flag for the user and nothing to revert. Nothing is adopted: `src/engine/weights.ts`, `simulator/placement/default-weights.json`, `simulator/placement/policy-default-params.json` and every file under `simulator/placement/arms/` are untouched by this run.

The sharpest number here is not in the table. Between the two builds exactly **one of 16,000 hero games changed outcome** (block wins 4,147 to 4,146; discordant pairs 1,299 to 1,298), which is the effect size the corpus recapture behind the fix already implied when it moved 7 of 600 games on `standard4`. The prereg's honest limit on this design therefore did not bite: each run's interval carries the variance of the whole denial component and quadrature widens it further, but because the two runs are so nearly identical the difference of their estimates is pinned near zero anyway, and `equivalent` survives rather than the `inconclusive` the prereg thought equally likely. The prediction was right in magnitude, calling `delta` inside +-0.3pp against a measured 0.006pp, and wrong only in the sign of a point estimate at one part in 16,000, which is noise rather than a direction.

**Scope, as preregistered.** This is the predicate's effect on one seat playing the composite against three seats that do not. It is **not** the effect in the shipped configuration where every seat is denial-gated and the correction applies to all four at once, which no design available in this binary can measure, since a symmetric field cancels the change by construction. No later phase may cite M-49 as a measurement of the all-composite field.


## M-50: SP1e knight and threat axis sweep

2026-09-01, commit `eb4cb111` (the preregistration commit; no code and no default moved for this run), domain `tuning`. Preregistered in `docs/plans/preregs/2026-09-01-m50-sp1e-knight-threat-sweep.md` (committed before the run). A screen, not a change: five declared `ThreatParams` axes perturbed one at a time to the endpoints of their committed `sweep-bounds.json` ranges and measured against the post-SP1 composite defaults. The five are `knightStealWeight`, `knightPlacementWeight` and SP1d's `knightReliefWeight`, which the programme names, plus SP1b's `victimNeedWeight` and SP1c's `needCompletionWeight`, which this plan added because a brand-new parameter left unswept beside three swept ones in the same struct is worse than paying for two more arms. Endpoints rather than H2's half and double, because M-41 read both knight axes `equivalent` on single-digit discordance and that is a statement about reach rather than about value.

Protocol as preregistered: `evaluate`, `standard4`, 4 seats, placement field `pip_diversity`, every arm placing via `pip_diversity` so it differs from the field in exactly one policy leaf, every seat on `heuristic-v1-trader-aware-threat-devcards-denial` with `--player-trading`, `--threads 0`, 2000 boards x 2 reps (16,000 paired units over 2000 clusters per arm), `--threshold 0.01`, `--alpha 0.05`, reference `base` = the post-SP1 defaults named explicitly through `--arm-policy`. One invocation, eleven arms, exactly as preregistered; the sweep was not split.

```text
target/release/unsettled-sim evaluate --layout standard4 --seats 4 --domain tuning --field pip_diversity \
  --arm base=pip_diversity --arm knsteal_lo=pip_diversity ... --arm needcomp_hi=pip_diversity \
  --arm-policy base=heuristic-v1-trader-aware-threat-devcards-denial \
  --arm-policy knsteal_lo=heuristic-v1-trader-aware-threat-devcards-denial@placement/arms/sp1e_knsteal_lo.json ... \
  --reference base --boards 2000 --reps 2 --policy heuristic-v1-trader-aware-threat-devcards-denial \
  --threads 0 --player-trading --threshold 0.01 --alpha 0.05 --out runs/m50-sp1e
```

The command above is the preregistered one elided at the repeated arms; the file carries it in full and every `--arm-policy` matched it exactly.

Load before `5.41 4.00 3.09`, after `11.25 5.46 3.64` (24.6s at 18 workers, 7,163 games/s), `rustc 1.94.0 (4a4ef493e 2026-03-02)`. 176,000 games, **zero illegal actions**, 0 draws in every arm; the invocation ran alone, against a binary built beforehand, with no build or test suite in its command block. `base` sits at 3,975 wins of 16,000, `0.2484375`, close to the symmetric 0.25 corner as expected. The run is admissible.

**A note on the timed window.** The invocation was issued twice. The first went through `cargo run` without `RUSTFLAGS="-D warnings"`, which re-fingerprinted and put a 12s compile inside the recorded `uptime` window; the compile finished before the measurement began, but the load pair no longer described the run. The second, recorded above, ran the prebuilt binary alone. The two `evaluation.json` artifacts compare **byte-identical**, which is the determinism contract holding and is why the first invocation costs nothing beyond the wasted seconds. Only the second is the record.

| Arm | Parameter | Value | Estimate | b | c | Selected interval | Verdict |
| --- | --- | ---: | ---: | ---: | ---: | --- | --- |
| knsteal_lo | `knightStealWeight` | 3.0 | `-6.25e-05` | 1 | 2 | clustered `[-0.0002747, +0.0001497]` | equivalent |
| knsteal_hi | `knightStealWeight` | 48.0 | `+0.000125` | 10 | 8 | clustered `[-0.0003948, +0.0006448]` | equivalent |
| knplace_lo | `knightPlacementWeight` | 7.5 | `-6.25e-05` | 2 | 3 | clustered `[-0.0003365, +0.0002115]` | equivalent |
| knplace_hi | `knightPlacementWeight` | 120.0 | `+6.25e-05` | 9 | 8 | clustered `[-0.0004427, +0.0005677]` | equivalent |
| knrelief_lo | `knightReliefWeight` | 3.0 | `-6.25e-05` | 0 | 1 | clustered `[-0.0001850, +0.0000600]` | equivalent |
| knrelief_hi | `knightReliefWeight` | 48.0 | `+6.25e-05` | 1 | 0 | clustered `[-0.0000600, +0.0001850]` | equivalent |
| victimneed_lo | `victimNeedWeight` | 0.0375 | `-0.0009375` | 74 | 89 | McNemar `[-0.0025014, +0.0006264]` | equivalent |
| victimneed_hi | `victimNeedWeight` | 0.6 | `-0.0025625` | 232 | 273 | McNemar `[-0.0053150, +0.0001900]` | equivalent |
| needcomp_lo | `needCompletionWeight` | 0.0875 | `-0.000125` | 18 | 20 | clustered `[-0.0008803, +0.0006303]` | equivalent |
| needcomp_hi | `needCompletionWeight` | 1.4 | `-0.0006875` | 18 | 29 | McNemar `[-0.0015272, +0.0001522]` | equivalent |

**Verdicts and disposition, per the standing rule.** All five axes read `equivalent` in both directions at the declared power, and no arm reads `better`, `worse` or `inconclusive`. `equivalent` drops the axis and records the null as the answer, so **the surviving-axis list is empty**: this run contributes no SP6 candidate. No retry was triggered, because the retry is preregistered for `inconclusive` only and nothing read `inconclusive`. Nothing was adopted: `src/engine/weights.ts`, `simulator/placement/default-weights.json`, `simulator/placement/policy-default-params.json`, `simulator/placement/phase-i-candidate-params.json`, `HeuristicParams::default()` and every file under `simulator/placement/arms/` are byte-identical to what commit `eb4cb111` carries.

**Multiplicity, as preregistered rather than corrected.** Ten contrasts at alpha 0.05 against a true null everywhere would be expected to throw roughly one nominal exceedance by chance. **Zero** arms exclude zero from the selected interval, so the table is quieter than chance alone would predict and there is no lone `better` to read down.

**What the numbers say beyond the verdicts.** The three knight axes are flat to the point of near-silence: a factor of four either way on `knightStealWeight` or `knightPlacementWeight` moves 3 to 18 games of 16,000, and on `knightReliefWeight` it moves exactly one. That is not a degenerate zero (`clusteredDegenerate` is false on every arm and each interval has real width), but it puts a firm number on how rarely the knight is the marginal action inside `knight_action_score`: SP1d's own corpus recapture was byte-identical for the same reason. Any later phase proposing to tune a knight axis on this instrument should expect no signal and should reach for a design that forces knight decisions rather than sampling them.

The two new axes behave like an interior optimum. Both read negative at both endpoints (`victimneed` -0.094pp and -0.256pp, `needcomp` -0.013pp and -0.069pp), which is the sign pattern of a default sitting at or near a local maximum, though at these magnitudes it is not separable from noise and the M entry claims nothing stronger. `victimneed_hi` is the loudest arm in the table at 505 discordant pairs and carries the widest interval, so `victimNeedWeight` is the one axis here that a four-fold move genuinely reaches; its estimate is still a quarter of the practical threshold.

**Prediction against outcome.** Right on the shape: no arm read `better`, every point estimate landed inside +-0.5pp (the largest being `victimneed_hi` at -0.256pp), and the three knight axes repeated M-41's reading in the low tens rather than the hundreds. Right that `victimneed` would be where movement lives. **Wrong on `needcomp`**, predicted to show discordance in the hundreds from SP1c's 37 of 400 corpus games and delivering 38 and 47 pairs of 16,000, an order of magnitude less; a term that moves the corpus does not move the win rate at the same rate, and the corpus figure is a poor power estimate. Also wrong on the most likely non-`equivalent` outcome, predicted to be `inconclusive` on one of the two `hi` arms and in the event nothing at all: the intervals came in tighter than expected, so the run resolved every axis rather than buying its retry.

**Interpretive limit, per `contracts.md`.** The default ordering of the threat terms is regime-dependent, holding above danger roughly 0.108 and 0.105 and reversing below. The `victimneed` and `needcomp` verdicts therefore average over both regimes, and their nulls do **not** establish either axis dead within one regime alone. The three knight axes are outside that ordering, scoring an action rather than ranking threat terms, so their nulls carry no such caveat.

## M-51: post-SP1 re-screen of the adopted Phase-I vector

2026-09-01, commit `882f61ab` (the preregistration commit; no code and no default moved for this run), domain `tuning`. Preregistered in `docs/plans/preregs/2026-09-01-m51-post-sp1-rescreen.md` (committed before the run). Not a change and not a proposal: SP1 moved the field the M-46 confirmation was taken on, so the five axes the Phase-I decision disposed of are each put back to their pre-adoption value, one arm at a time, and measured against the post-SP1 defaults. Four are the policy axes M-46 adopted; the fifth is `handValueWeight`, which M-43 recommended dropping and M-46 dropped as part of the same package.

Two invocations, because the two sides need different fields, exactly as preregistered. The four policy arms are policy-parameter contrasts and take the programme's policy field `pip_diversity`, differing from it in one `--arm-policy` leaf each through the committed `simulator/placement/arms/sp1r_*.json` files. `handValueWeight` is a formula weight, so its arm has to be scored against the live formula: field and `base` are both the app-formula spec over `simulator/placement/default-weights.json` and the arm is the same spec over `simulator/placement/phase-i-candidate-weights.json`, which is already the live default weights with `handValueWeight` at its pre-drop 0.4 and is pinned as exactly that by `the_phase_i_candidate_files_record_the_adopted_vectors`.

Both invocations: `evaluate`, `standard4`, 4 seats, every seat on `heuristic-v1-trader-aware-threat-devcards-denial` with `--player-trading`, `--threads 0`, 8000 boards x 2 reps (64,000 paired units over 8000 clusters per arm), `--threshold 0.01`, `--alpha 0.05`, reference `base` = the shipped configuration itself. That is confirmation power, the same the vector's own confirmation was taken at in M-45 and M-46.

```text
RUSTFLAGS="-D warnings" cargo build --release -p unsettled-sim

# invocation one, from simulator/
target/release/unsettled-sim evaluate --layout standard4 --seats 4 --domain tuning --field pip_diversity --arm base=pip_diversity --arm revert_devbuy=pip_diversity --arm revert_tretw=pip_diversity --arm revert_trfloor=pip_diversity --arm revert_trdangerw=pip_diversity --arm-policy base=heuristic-v1-trader-aware-threat-devcards-denial --arm-policy revert_devbuy=heuristic-v1-trader-aware-threat-devcards-denial@placement/arms/sp1r_devbuy.json --arm-policy revert_tretw=heuristic-v1-trader-aware-threat-devcards-denial@placement/arms/sp1r_tretw.json --arm-policy revert_trfloor=heuristic-v1-trader-aware-threat-devcards-denial@placement/arms/sp1r_trfloor.json --arm-policy revert_trdangerw=heuristic-v1-trader-aware-threat-devcards-denial@placement/arms/sp1r_trdangerw.json --reference base --boards 8000 --reps 2 --policy heuristic-v1-trader-aware-threat-devcards-denial --threads 0 --player-trading --threshold 0.01 --alpha 0.05 --out runs/m51-policy

# invocation two, from simulator/
target/release/unsettled-sim evaluate --layout standard4 --seats 4 --domain tuning --field app_formula:placement/default-weights.json --arm base=app_formula:placement/default-weights.json --arm hand=app_formula:placement/phase-i-candidate-weights.json --reference base --boards 8000 --reps 2 --policy heuristic-v1-trader-aware-threat-devcards-denial --threads 0 --player-trading --threshold 0.01 --alpha 0.05 --out runs/m51-hand
```

**Provenance and admissibility.** The release binary was built with `RUSTFLAGS="-D warnings"` before either measurement started, so no compile landed inside a timed window; the build reported `Finished` in 0.03s against a warm fingerprint, which is M-50's lesson applied. Invocation one: load before `2.90 2.95 2.81`, after `13.25 5.76 3.86`, 44.9s at 18 workers, 7,123.7 games/s, **320,000 games, zero illegal actions**, 0 draws in every arm. Invocation two: load before `10.01 5.50 3.81`, after `12.70 6.32 4.13`, 17.8s at 18 workers, 7,209.0 games/s, **128,000 games, zero illegal actions**, 0 draws. Both `rustc 1.94.0 (4a4ef493e 2026-03-02)`. The two ran strictly one at a time and neither shared a command block with a build, a test suite or the other; invocation two's elevated before-load is invocation one's one-minute average still decaying, not concurrent work. 448,000 games total in about 63s of wall clock, well inside the 5-minute ceiling. Both references sit near the symmetric 0.25 corner as the preregistered check requires: policy `base` 15,988 wins of 64,000 (`0.2498125`), formula `base` 15,912 of 64,000 (`0.248625`), so the field and the reference have not drifted apart in either invocation. `simulator/runs/` is gitignored, so neither artifact is in the tree and this entry is the record.

Invocation one, field `pip_diversity`, reference `base` = the post-SP1 composite defaults:

| Arm | Parameter | Reverted to | Live default | Estimate | b | c | Selected interval | Verdict |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| revert_devbuy | `devBuyScale` | 1.0 | 0.25 | `-0.010984375` | 4059 | 4762 | clustered `[-0.0138794, -0.0080894]` | inconclusive |
| revert_tretw | `trading.etwWeight` | 1.0 | 4.0 | `-0.032859375` | 7296 | 9399 | McNemar `[-0.0368081, -0.0289106]` | **worse** |
| revert_trfloor | `trading.dangerFloor` | 1.0 | 4.0 | `-0.029421875` | 7339 | 9222 | clustered `[-0.0333770, -0.0254667]` | **worse** |
| revert_trdangerw | `trading.dangerWeight` | 0.5 | 2.0 | `-0.031484375` | 7183 | 9198 | clustered `[-0.0354416, -0.0275271]` | **worse** |

Invocation two, field the app-formula spec over `simulator/placement/default-weights.json`, reference `base` = the same spec:

| Arm | Parameter | Reverted to | Live default | Estimate | b | c | Selected interval | Verdict |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| hand | `handValueWeight` | 0.4 | 0 | `+0.000171875` | 770 | 759 | clustered `[-0.0010619, +0.0014057]` | equivalent |

**Does each disposal still read the way M-43 through M-46 recorded it? Axis by axis.**

- **`trading.etwWeight` 4.0: support intact and stronger.** Reverting to 1.0 costs `-3.29pp` with the whole interval below the practical threshold. M-44 kept this axis on a removal-negative `inconclusive` of `-1.45pp` at the combined point; on the post-SP1 field at confirmation power the same direction now clears the threshold outright. The adoption holds.
- **`trading.dangerFloor` 4.0: support intact, and the sign has flipped in its favour.** Reverting to 1.0 costs `-2.94pp`, `worse`. M-44's coordinate pass read removal of this axis at `+0.64pp`, `inconclusive`, meaning the point estimate at that time leaned *against* the keep and the axis survived on the parsimony rule rather than on its own number. On the post-SP1 field it earns its value directly. **Flagged as a changed reading, in the confirming direction.**
- **`trading.dangerWeight` 2.0: same story, same size.** Reverting to 0.5 costs `-3.15pp`, `worse`, against M-44's `+0.49pp` `inconclusive` removal estimate. **Flagged as a changed reading, in the confirming direction.**
- **`devBuyScale` 0.25: direction confirmed, magnitude unresolved.** Reverting to 1.0 reads `-1.10pp` with a selected interval of `[-1.39pp, -0.81pp]`: entirely below zero, so the disposal is not worthless, but straddling the `-1pp` practical threshold, which is what makes the verdict `inconclusive` rather than `worse`. Same direction as M-44's `-0.62pp`, roughly double the magnitude. Per the preregistration there is **no retry**: this run is already at the largest power the programme has ever bought, no branch of the rule changes an action, and more units would buy a sharper number and no different decision. Recorded unresolved on magnitude, confirmed on direction.
- **`handValueWeight` 0: the drop still holds, and the reading is now tighter than M-43's.** Restoring 0.4 reads `+0.017pp` with a selected interval of `[-0.11pp, +0.14pp]`, strictly inside `±1pp`: `equivalent`. M-43 measured the mirror contrast, zeroing the term, at `-0.13pp` on 1,464 of 64,000 discordant units; this run measures restoring it at effectively zero on 1,529 discordant units, an interval about a tenth the width of M-43's practical threshold. Nothing here disturbs the drop.

**Nothing is flagged as broken.** No arm read `better`. The preregistered `better` branch, which would have said an adoption no longer holds on this field and handed the user a decision they own, did not fire on any of the five.

**Disposition, per the preregistered rule.** Record only, in every branch, on every arm. `src/engine/weights.ts`, `simulator/placement/default-weights.json`, `simulator/placement/policy-default-params.json`, `simulator/placement/phase-i-candidate-*.json`, `HeuristicParams::default()` and every file under `simulator/placement/arms/` are byte-identical to what commit `882f61ab` carries. This run proposes no revert and could not have: it exists to put the field's own provenance on the record before SP2 opens.

**Multiplicity, stated rather than corrected.** Five contrasts across two invocations at alpha 0.05. Against a true null everywhere, roughly one nominal exceedance is expected by chance. **Four of five** exclude zero, all four negative, all four in the direction that confirms the disposal. That is not a lone flag to read down; it is a coherent pattern four times the chance expectation, and the one arm that includes zero is the one whose disposal was itself a null result in M-43.

**Prediction against outcome.** Right on the shape of the run: no `better` anywhere, `hand` `equivalent` and comfortably inside the predicted `±0.5pp`. Right that `revert_tretw` would be the largest, but only by a fifth of a point, which is not the gap the prediction implied. **Wrong on the two trade-danger axes**, and wrong in the most useful direction: they were called the arms most likely to have been carried by their partners, expected to read `equivalent` or a small `worse`, and they came in second and third at `-2.94pp` and `-3.15pp`, statistically indistinguishable from `etwWeight` itself. On the post-SP1 field each of the three trade axes carries about 3pp on its own. **Wrong on `devBuyScale`**, predicted second largest on the strength of M-46's corpus regeneration and delivered smallest and the only non-`worse` arm; a parameter that moves enough plain-`heuristic-v1` decisions to force three gate baselines to be regenerated is not thereby the parameter that moves the most composite-play win rate.

**Scope, and what this entry may not be cited for.** Each contrast puts the reverted value on the hero seat against three seats carrying the adopted defaults. That is the same design M-44's coordinate pass used and it is **not** a measurement of a field where every seat reverts. It is also not a re-measurement of the Phase-I package: M-46's `+14.76 / +13.98 / +14.10pp` stands as the last word on the package, this run measures four of its axes singly, and all three seed domains remain spent for that vector. The `hand` reading carries the limit its preregistration set out in advance and it is the sharpest caveat in this entry: **M-43 was taken on a `pip_diversity` field and this arm is taken on an app-formula field**, so the field's policy and its placement both differ from M-43 at once and no difference between the two readings may be attributed to SP1 alone. What invocation two does answer, and all it answers, is whether restoring the term beats the field SP2 through SP6 will be measured against. It does not.

**Consequence for the phases below.** The four adopted policy axes and the `handValueWeight` drop all still read the way M-43 through M-46 recorded them, two of them more decisively than before. The post-SP1 defaults are therefore the field every SP2 measurement is taken against, with this entry as their provenance.

## M-52: SP2a dev-card recipe bonus

2026-09-01, commit `4eba94d5` (the preregistration commit; no code and no default moved for this run), domain `tuning`. Preregistered in `docs/plans/preregs/2026-09-01-m52-sp2a-devcard-recipe.md` (committed before the run). One decision arm against the shipped vector: does pricing the ore/wheat/sheep development-card recipe at placement time win more games?

The change under test is `recipeDevCardBonus`, added in SP2a to `src/engine/weights.ts::EngineWeights` and mirrored in `app_formula.rs::EngineWeights`, computed as `recipeDevCardBonus * min(oreRecipe, wheatRecipe, sheepRecipe)` inside `valuation.ts::diversityScore` and `app_formula.rs::diversity_score` and landing in the existing `diversity` breakdown component. It ships at 0 and is arithmetically inert there. The arm `devcard` is `simulator/placement/arms/sp2a_devcard.json`, the live `simulator/placement/default-weights.json` with that one key at 1.0, which is `recipeSettlementBonus`'s value and the credit the formula already gives the other multi-resource recipe. Reference `base` is the shipped `simulator/placement/default-weights.json` itself. Both field and reference are the app-formula spec over the shipped weights, because a formula arm has to be scored against the live formula.

`evaluate`, `standard4`, 4 seats, every seat on `heuristic-v1-trader-aware-threat-devcards-denial` with `--player-trading`, `--threads 0`, 2000 boards x 2 reps (16,000 paired units over 2000 clusters), `--threshold 0.01`, `--alpha 0.05`. That is the programme's screen power for an optional term, matching M-38's placement screens and M-49.

```text
RUSTFLAGS="-D warnings" cargo build --release --manifest-path simulator/Cargo.toml -p unsettled-sim

# from simulator/
target/release/unsettled-sim evaluate --layout standard4 --seats 4 --domain tuning --field app_formula:placement/default-weights.json --arm base=app_formula:placement/default-weights.json --arm devcard=app_formula:placement/arms/sp2a_devcard.json --reference base --boards 2000 --reps 2 --policy heuristic-v1-trader-aware-threat-devcards-denial --threads 0 --player-trading --threshold 0.01 --alpha 0.05 --out runs/m52-sp2a
```

**Provenance and admissibility.** The release binary was built with `RUSTFLAGS="-D warnings"` before the measurement started and reported `Finished` in 0.04s against a warm fingerprint, so no compile landed inside the timed window. Load before `3.02 3.10 2.73`, after `4.30 3.36 2.83`; 4.40s at 18 workers, 7,265.4 games/s, **32,000 games, zero illegal actions**, 0 draws in either arm, `rustc 1.94.0 (4a4ef493e 2026-03-02)`. Domain seed `8795844940285355527`. The invocation shared its command block with no build, no test suite and no other CPU-heavy job. The reference sits at the symmetric 0.25 corner as the preregistered check requires: `base` won 3,988 of 16,000 (`0.24925`), so field and reference have not drifted apart. `simulator/runs/` is gitignored, so the artifact is not in the tree and this entry is the record.

| Arm | Parameter | Arm value | Live default | Estimate | b | c | Selected interval | Verdict |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| devcard | `recipeDevCardBonus` | 1.0 | 0 | `+0.0025625` | 374 | 333 | clustered `[-0.0007165, +0.0058415]` | equivalent |

**The reading.** `+0.26pp`, with a selected interval of `[-0.07pp, +0.58pp]` on 707 discordant units. The whole interval sits inside the `±1pp` practical threshold, which is what makes this `equivalent` rather than `inconclusive`, and it straddles zero, so the term is not even shown to help directionally at this power. No retry: the retry branch belongs to `inconclusive` alone.

**What the null answers.** This was the only term in the placement programme that raises sheep's standing on its own, so the null is a substantive reading rather than a shrug. Sheep earns credit through two existing channels: the diversity spread, which pays for holding any of a resource, and `recipeSettlementBonus`, whose minimum runs over four resources and is therefore usually pinned by wood or brick rather than by sheep. The dev-card recipe's minimum runs over three, and the ore/wheat pair gating it is the pair `recipeCityBonus` already rewards, so the term's marginal signal is close to "this pair also has sheep on top of an ore and wheat base". At screen power that signal reorders too few candidate vertices to show up: 707 of 16,000 units changed outcome, about 4.4%. **The recorded answer is that sheep's existing credit through the spread and the settlement recipe is already enough at placement time**, and any future proposal to re-rank `resourceValue.sheep` has to argue against this entry.

**Prediction against outcome.** Right on the verdict, `equivalent` as predicted. Right on the magnitude: `+0.26pp` against a predicted point estimate inside `±0.3pp`, and the realised half-width of `±0.33pp` against a predicted `±0.2` to `±0.3pp`. Right on the loosely held direction, slightly positive. **Wrong on the discordant count**, predicted "low hundreds" and delivered 707, about three and a half times M-38's `settlement_hi` (111 versus 92) for the same 1.0 of added headroom; the dev-card minimum is over three resources rather than four, so it binds on more boards than the settlement recipe does and moves more picks, it just does not move them anywhere better.

**Disposition, per the preregistered rule.** `equivalent` at declared power drops the candidate and records the null as the answer. **Nothing is adopted and nothing survives to SP6 from this run.** No shipped default moved: `src/engine/weights.ts`, `simulator/placement/default-weights.json` and `simulator/placement/phase-i-candidate-weights.json` all still carry `recipeDevCardBonus` at 0, and `sp2a_devcard.json` remains the only committed file carrying a nonzero value on this axis. Nothing is reverted either: a weight shipped at 0 is arithmetically inert, removing it is outside SP2's scope, and `SIM-GAP-36` stays open in `gaps.md` because that gap closes on adoption and adoption is SP6's business.

**Scope, and what this entry may not be cited for.** One contrast, one arm value. It measures `recipeDevCardBonus` at 1.0 on the hero seat against three seats carrying the shipped weights; it is **not** a measurement of a field where every seat prices the dev-card recipe, and it is not evidence about any other value on the axis, whose committed `sweep-bounds.json` range runs to 4.0. It is a screen at 2000 boards, not a confirmation, so it can retire a candidate but could not have adopted one on its own.

## M-53: SP2b coverage-conditioned port value

2026-09-01, commit `035fcd38` (the preregistration commit; no code and no default moved for this run), domain `tuning`. Preregistered in `docs/plans/preregs/2026-09-01-m53-sp2b-port-coverage-deficit.md` (committed before the run). One decision arm against the shipped vector: does paying a port more when it is the pair's only route to the resources it lacks win more games?

The change under test is `portCoverageDeficitWeight`, added in SP2b to `src/engine/weights.ts::EngineWeights` and mirrored in `app_formula.rs::EngineWeights`. Each per-resource product inside `valuation.ts::portDelta` and its mirror `app_formula.rs::port_delta` is multiplied by `1 + portCoverageDeficitWeight * deficit_r`, where `deficit_r` is one minus the mean `recipeCap` coverage of the four resources other than the ported one, computed by `valuation.ts::portDeficitFactor` and `app_formula.rs::port_deficit_factor`. The post-move deficit prices the post-move half of each difference and the pre-move deficit the pre-move half, so the term stays a true delta. It lands in the existing `port` breakdown component and ships at 0, where the factor is exactly 1 and every product is bit-for-bit unchanged. The arm `portdeficit` is `simulator/placement/arms/sp2b_portdeficit.json`, the live `simulator/placement/default-weights.json` with that one key at 1.0 and every other key byte-identical, so the factor runs over `[1, 2]`: at most double credit for a pair covering nothing else, no change for a pair already saturated across the other four. Reference `base` is the shipped `simulator/placement/default-weights.json` itself. Both field and reference are the app-formula spec over the shipped weights, because a formula arm has to be scored against the live formula.

`evaluate`, `standard4`, 4 seats, every seat on `heuristic-v1-trader-aware-threat-devcards-denial` with `--player-trading`, `--threads 0`, `--threshold 0.01`, `--alpha 0.05`. The screen ran at 2000 boards x 2 reps (16,000 paired units over 2000 clusters), the plan's screen power for an optional term, matching M-38's placement screens, M-49 and M-52. It read `inconclusive`, which bought the single preregistered retry at four times the boards and unchanged reps: 8000 boards x 2 reps, 64,000 paired units over 8000 clusters.

```text
RUSTFLAGS="-D warnings" cargo build --release --manifest-path simulator/Cargo.toml -p unsettled-sim

# screen, from simulator/
target/release/unsettled-sim evaluate --layout standard4 --seats 4 --domain tuning --field app_formula:placement/default-weights.json --arm base=app_formula:placement/default-weights.json --arm portdeficit=app_formula:placement/arms/sp2b_portdeficit.json --reference base --boards 2000 --reps 2 --policy heuristic-v1-trader-aware-threat-devcards-denial --threads 0 --player-trading --threshold 0.01 --alpha 0.05 --out runs/m53-sp2b

# preregistered retry, from simulator/, identical but for --boards and --out
target/release/unsettled-sim evaluate --layout standard4 --seats 4 --domain tuning --field app_formula:placement/default-weights.json --arm base=app_formula:placement/default-weights.json --arm portdeficit=app_formula:placement/arms/sp2b_portdeficit.json --reference base --boards 8000 --reps 2 --policy heuristic-v1-trader-aware-threat-devcards-denial --threads 0 --player-trading --threshold 0.01 --alpha 0.05 --out runs/m53-sp2b-retry
```

**Provenance and admissibility.** The release binary was built with `RUSTFLAGS="-D warnings"` before the measurement started and reported `Finished` in 0.01s against a warm fingerprint, so no compile landed inside either timed window, and the retry reused that same binary. Neither invocation shared its command block with a build, a test suite or any other CPU-heavy job. `rustc 1.94.0 (4a4ef493e 2026-03-02)`, domain seed `8795844940285355527` in both runs.

Screen: load before `2.80 3.12 2.79`, after `4.18 3.40 2.89`; 4.43s at 18 workers, 7,226.5 games/s, **32,000 games, zero illegal actions**, 0 draws in either arm. `base` won 3,988 of 16,000 (`0.24925`).

Retry: load before `2.99 3.19 2.83`, after `7.00 4.06 3.15`; 17.55s at 18 workers, 7,295.3 games/s, **128,000 games, zero illegal actions**, 0 draws in either arm. `base` won 15,912 of 64,000 (`0.248625`).

Both reference win rates sit at the symmetric 0.25 corner as the preregistered check requires, so field and reference have not drifted apart, and the throughput came in a fraction under M-52's 7,265 games/s as the prereg expected from the hero seat's now-nonzero weight taking the ten fractional `coverage` powers the zero branch skips. `simulator/runs/` is gitignored, so neither artifact is in the tree and this entry is the record.

| Run | Arm | Parameter | Arm value | Live default | Estimate | b | c | Selected interval | Verdict |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| screen, 2000 boards | portdeficit | `portCoverageDeficitWeight` | 1.0 | 0 | `-0.009` | 408 | 552 | clustered `[-0.0130148, -0.0049852]` | inconclusive |
| retry, 8000 boards | portdeficit | `portCoverageDeficitWeight` | 1.0 | 0 | `-0.009625` | 1664 | 2280 | clustered `[-0.0116028, -0.0076472]` | inconclusive |

**The reading.** The screen read `-0.90pp` on 960 discordant units of 16,000, interval `[-1.30pp, -0.50pp]`. The retry read `-0.96pp` on 3,944 discordant units of 64,000, interval `[-1.16pp, -0.76pp]`. Both are `inconclusive` for one reason only: the interval straddles the `-1pp` practical threshold, so the harness cannot say whether the loss clears it. **Everything else about the reading is resolved.** Both intervals sit entirely below zero, the retry's four-fold units shrank the half-width from `±0.40pp` to `±0.20pp` and moved the point estimate by 0.06pp, and the two runs agree to well inside each other's intervals. The term is harmful at 1.0, at somewhere close to a full percentage point, and buying more units would only sharpen which side of the threshold that lands on. On the retry the clustered interval was again the wider of the two and was the one selected, per `evaluate.rs::try_paired_stats`.

**What the reading answers.** The prereg set two of the formula's existing opinions against each other. `diversityScore` penalises a narrow pair, and M-39 and M-40 established that the field wants *more* of that penalty (`diversityWeight` at 4.8 against the shipped 1.6, worth about `+1.3pp`); this term pays a narrow pair back on the argument that a port converts the surplus the narrowness produces. **The field sides with the diversity penalty.** A port does not buy a narrow pair out of being narrow, and `SIM-GAP-37`'s "a port should be worth more to a pair covering three resources than to one covering five" is, as a placement-time credit, an argument the measurement contradicts rather than supports.

The conditioning is what makes this sharper than a repeat of M-38. `port_hi` there raised every port's credit unconditionally by the same factor of two and read `-1.46pp` on 1,349 discordant units. This arm raises credit *only* where coverage elsewhere is absent and fades to no change at full coverage, which touches far fewer pairs, and it still delivered two thirds of that harm. So the conditioning bought back about a third of the unconditional damage, not most of it. That is a statement about where the damage lives: `portSurplus` already gates the term on the ported resource's own production clearing `portSurplusThreshold`, so the pairs the deficit factor reaches are precisely the pairs that are long on one resource and short on the rest, and those are the pairs the field most wants to avoid. Shaping the credit to land on them concentrates the harm rather than avoiding it.

**Prediction against outcome.** **Wrong on the verdict**, predicted `equivalent` and delivered `inconclusive` twice. **Wrong on the magnitude**, predicted a point estimate around `-0.3pp` and delivered `-0.90pp` then `-0.96pp`, three times the prediction and only just inside the `-1pp` bracket the prediction called honest. **Wrong on the interval straddling zero**, which is what an `equivalent` prediction implies: both intervals exclude zero comfortably. Right on the direction, and right that a `better` reading was not coming. Right on the discordant count, predicted 600 to 1,300 of 16,000 and above M-52's 707, delivering 960. **Half wrong on the comparison to `port_hi`**: right that this arm would land short of `-1.46pp`, wrong that it would land "well short" of it, since fading the credit out at high coverage removed only a third of the loss. The lesson for later predictions on this axis is that narrowing a term's reach does not narrow its harm proportionally when the reach is aimed at the pairs the harm comes from.

**Disposition, per the preregistered rule.** `inconclusive` bought units exactly once, at four times the boards with `--reps` unchanged, and the retry read `inconclusive` again, so **the item is recorded unresolved and the run stops here**. Unresolved means unresolved against the `±1pp` practical threshold alone; the sign is settled and negative. **Nothing survives to SP6 from this run**: only a `better` reading produces a candidate, and 1.0 on this axis is not one. No shipped default moved: `src/engine/weights.ts`, `simulator/placement/default-weights.json` and `simulator/placement/phase-i-candidate-weights.json` all still carry `portCoverageDeficitWeight` at 0, and `sp2b_portdeficit.json` remains the only committed file carrying a nonzero value on this axis. Nothing is reverted either: a weight shipped at 0 is arithmetically inert, removing it is outside SP2's scope, and `SIM-GAP-37` stays open in `gaps.md` because that gap closes on adoption and adoption is SP6's business.

**Scope, and what this entry may not be cited for.** One contrast, one arm value. It measures `portCoverageDeficitWeight` at 1.0 on the hero seat against three seats carrying the shipped weights; it is **not** a measurement of a field where every seat conditions port value on coverage, and it is not evidence about any other value on the axis, whose committed `sweep-bounds.json` range runs to 4.0. A smaller value is untested here, though the sign and the shape of the term make a positive reading at a smaller one unlikely rather than open. The retry is 8000 boards at screen protocol, not a `gate`-domain confirmation, so it can retire a candidate but could not have adopted one.

## M-54: SP3 expansion term

2026-09-02, commit `e3605a06` (the preregistration commit; no code and no default moved for this run), domain `tuning`. Preregistered in `docs/plans/preregs/2026-09-02-m54-sp3-expansion.md` (committed before the run). Two decision arms on one axis against the shipped vector: does paying a candidate for the sites it opens win more games?

The change under test is `expansionWeight`, added in SP3 to `src/engine/weights.ts::EngineWeights` and mirrored in `app_formula.rs::EngineWeights`, with its walk in `src/engine/expansion.ts::expansionTerm` and `simulator/crates/engine/src/placement/expansion.rs`, pinned against each other by parity class `W13`. It answers the arithmetic half of `SIM-GAP-34`: the formula prices what a candidate produces and nothing about what it opens, so a settlement hemmed in by rival pieces scores exactly like an identical one with an open fan. The term walks outward from the candidate over the current occupancy, collects the sites at path length at least 2 that would be legal once the candidate is placed and are reachable within two paid road builds, values each by `marginalTotal` of that site given holdings plus the candidate with `receivesGrant` false and `expansionWeight` forced to 0, discounts by `expansionDecay ^ paidBuilds`, and pays `expansionWeight` times the sum of the best two. It ships at 0, where both scorers skip the walk and the corpus diff in the implementing task was byte-identical; `expansionDecay` ships at 0.5. The arms are the live `simulator/placement/default-weights.json` with only that one key moved: `exp_lo` = `simulator/placement/arms/sp3_expansion_lo.json` at 0.1 and `exp_hi` = `simulator/placement/arms/sp3_expansion_hi.json` at 0.3, both inside the committed `sweep-bounds.json` range of 0.0 to 1.2 and both pinned by `simulator/crates/engine/src/policy/params_file.rs::the_sp3_arm_files_are_the_committed_expansion_perturbations`. Reference `base` is the shipped vector itself; field and reference are both the app-formula spec over it, because a formula arm has to be scored against the live formula.

`evaluate`, `standard4`, 4 seats, every seat on `heuristic-v1-trader-aware-threat-devcards-denial` with `--player-trading`, `--threads 0`, `--threshold 0.01`, `--alpha 0.05`. The screen ran at 2000 boards x 2 reps (16,000 paired units over 2000 clusters), the plan's screen power for an optional term, matching M-38's placement screens, M-49, M-52 and M-53. Both arms read `inconclusive`, which bought the single preregistered retry at four times the boards and unchanged reps: 8000 boards x 2 reps, 64,000 paired units over 8000 clusters, carrying both arms in one invocation as the prereg specified.

```text
RUSTFLAGS="-D warnings" cargo build --release --manifest-path simulator/Cargo.toml -p unsettled-sim

# screen, from simulator/
target/release/unsettled-sim evaluate --layout standard4 --seats 4 --domain tuning --field app_formula:placement/default-weights.json --arm base=app_formula:placement/default-weights.json --arm exp_lo=app_formula:placement/arms/sp3_expansion_lo.json --arm exp_hi=app_formula:placement/arms/sp3_expansion_hi.json --reference base --boards 2000 --reps 2 --policy heuristic-v1-trader-aware-threat-devcards-denial --threads 0 --player-trading --threshold 0.01 --alpha 0.05 --out runs/m54-sp3-expansion

# preregistered retry, from simulator/, identical but for --boards and --out
target/release/unsettled-sim evaluate --layout standard4 --seats 4 --domain tuning --field app_formula:placement/default-weights.json --arm base=app_formula:placement/default-weights.json --arm exp_lo=app_formula:placement/arms/sp3_expansion_lo.json --arm exp_hi=app_formula:placement/arms/sp3_expansion_hi.json --reference base --boards 8000 --reps 2 --policy heuristic-v1-trader-aware-threat-devcards-denial --threads 0 --player-trading --threshold 0.01 --alpha 0.05 --out runs/m54-sp3-expansion-retry
```

**Provenance and admissibility.** The release binary was built with `RUSTFLAGS="-D warnings"` before the measurement started and reported `Finished` in 0.03s against a warm fingerprint, so no compile landed inside either timed window, and the retry reused that same binary. Neither invocation shared its command block with a build, a test suite or any other CPU-heavy job. `rustc 1.94.0 (4a4ef493e 2026-03-02)`, domain seed `8795844940285355527` in both runs.

Screen: load before `3.18 3.34 2.60`, after `4.77 3.67 2.72`; 6.71s at 18 workers, 7,158.3 games/s, **48,000 games, zero illegal actions**, 0 draws in any arm. `base` won 3,988 of 16,000 (`0.24925`).

Retry: load before `3.64 3.50 2.69`, after `8.84 4.82 3.20`; 29.00s at 18 workers, 6,621.6 games/s, **192,000 games, zero illegal actions**, 0 draws in any arm. `base` won 15,912 of 64,000 (`0.248625`).

Both reference win rates sit at the symmetric 0.25 corner as the preregistered check requires, and both match M-53's `base` figures to the digit, which is what the shared domain seed and the unchanged reference spec should produce. Throughput came in under M-53's 7,226.5 games/s in both runs and fell further on the retry, which the prereg anticipated: two of three arms carry a nonzero `expansionWeight`, and a nonzero weight enters the outward walk on every scored candidate, the first component in the formula that is not arithmetic on precomputed vertex data. Timing is a throughput observation only; the outcomes are deterministic in the seeds and unaffected by load. `simulator/runs/` is gitignored, so neither artifact is in the tree and this entry is the record.

Pooled paired table, both runs, reference `base`, live default on this axis 0:

| Run | Arm | `expansionWeight` | Estimate | b | c | Selected interval | Verdict |
| --- | --- | ---: | ---: | ---: | ---: | --- | --- |
| screen, 2000 boards | exp_lo | 0.1 | `0.0109375` | 1659 | 1484 | clustered `[0.0038080, 0.0180670]` | inconclusive |
| screen, 2000 boards | exp_hi | 0.3 | `0.0034375` | 1876 | 1821 | clustered `[-0.0043036, 0.0111786]` | inconclusive |
| retry, 8000 boards | exp_lo | 0.1 | `0.011265625` | 6701 | 5980 | clustered `[0.0077785, 0.0147527]` | inconclusive |
| retry, 8000 boards | exp_hi | 0.3 | `0.0063125` | 7610 | 7206 | clustered `[0.0025156, 0.0101094]` | inconclusive |

The clustered interval was the wider of the two and was the one selected in every row, per `evaluate.rs::try_paired_stats`. No comparison was clustered-degenerate.

Per-hero-seat table, from Task 1's `perHeroSeat` block. Hero seat equals draft slot, because `game.rs::setup_order` runs `0..seats` then reversed. Record only: there is no per-slot verdict and the pooled row above is the verdict. Percentage points, clustered intervals.

| Run | Arm | Slot 0 | Slot 1 | Slot 2 | Slot 3 |
| --- | --- | ---: | ---: | ---: | ---: |
| screen | exp_lo | **+1.40** `[-0.05, +2.85]` | +0.28 `[-1.12, +1.67]` | +1.05 `[-0.35, +2.45]` | +1.65 `[+0.27, +3.03]` |
| screen | exp_hi | **+1.85** `[+0.31, +3.39]` | -0.88 `[-2.40, +0.65]` | -0.65 `[-2.20, +0.90]` | +1.05 `[-0.46, +2.56]` |
| retry | exp_lo | **+2.08** `[+1.36, +2.81]` | +0.79 `[+0.10, +1.49]` | +0.59 `[-0.11, +1.29]` | +1.04 `[+0.36, +1.72]` |
| retry | exp_hi | **+2.14** `[+1.37, +2.92]` | +0.19 `[-0.57, +0.94]` | -0.09 `[-0.85, +0.68]` | +0.28 `[-0.46, +1.02]` |

Per-seat `n` sums to the pooled `n` and per-seat `b + c` sums to the pooled `b + c` in every row, which is what the CLI test added in Task 1 asserts.

**The reading.** Every one of the eight screen and retry estimates is positive, and on the retry both arms' intervals sit entirely above zero: `exp_lo` at `+1.13pp` on 12,681 discordant units of 64,000, interval `[+0.78pp, +1.48pp]`, and `exp_hi` at `+0.63pp` on 14,816 discordant units, interval `[+0.25pp, +1.01pp]`. **The term helps, and the sign is settled.** Both arms are nonetheless `inconclusive` for the same reason M-53 was, in the opposite direction: the interval straddles the `+1pp` practical threshold, so the harness cannot say whether the gain clears it. `exp_lo`'s retry interval brackets the threshold from `+0.78pp` to `+1.48pp`; `exp_hi`'s brackets it from `+0.25pp` to `+1.01pp`, missing `equivalent` by a hundredth of a point at the top. The retry did its job on precision: `exp_lo`'s half-width shrank from `+/-0.71pp` to `+/-0.35pp` and its point estimate moved 0.04pp, and `exp_hi`'s shrank from `+/-0.78pp` to `+/-0.38pp` while its estimate moved 0.29pp toward the middle of the screen's interval. The two runs agree well inside each other's intervals on both arms.

**The smaller weight is the stronger one, which the prereg predicted backwards.** `exp_lo` at 0.1 beats `exp_hi` at 0.3 by half a point at both powers, and their retry intervals barely overlap. The discordant counts say why: `exp_hi` moves outcomes on 14,816 units against `exp_lo`'s 12,681, so the larger weight changes the pick more often and converts a smaller share of those changes into wins. At 0.3 the two-site sum runs near a quarter of a typical candidate total and overrides the production ranking on candidates where production was right; at 0.1 it runs near a twelfth and acts as a tie-breaker among candidates the production terms already rate closely. That is the shape of a term that is real but has been given too much authority, not of a term that is noise.

**The effect is concentrated at slot 0, which is the reading SP4 is designed off.** On the retry `exp_lo` runs `+2.08pp` at slot 0 against `+0.79`, `+0.59` and `+1.04` at the later slots, and `exp_hi` runs `+2.14pp` at slot 0 against `+0.19`, `-0.09` and `+0.28`, a slot-0 effect roughly seven times its own pooled estimate and the only slot whose interval excludes zero. The direction is what the fan argument predicts: the first picker chooses on an empty board where every candidate has an open second ring and the differences between fans are largest, while a slot-3 picker is choosing among what three rivals have left and the expansion walk finds fewer distinguishable options. It also says plainly that the pooled estimate is diluted by the slots the term does not reach, which is the case `slotScales` exists to test. **`exp_hi` is the sharper illustration**: its slot-0 reading is the largest single number in this run, yet its pooled estimate is the weaker of the two arms, because slots 1 through 3 wash it out. A slot-scaled expansion weight is therefore the live hypothesis this run produces, and it is one SP4 cannot pursue on the conditional branch it was written with.

**What the reading answers about `SIM-GAP-34`.** M-48 measured the outcome side and found boxing worth `+6.46pp` pooled and `+5.54pp` at its smallest slot; the open question was whether a formula term could capture any of it. It can: about a fifth of the worst-slot magnitude converts at 0.1, and about two fifths of it at slot 0. Neither of the two failure modes the prereg named held. The correlation is not purely downstream of production, or a term added on top of the production weights would have read flat or negative, and the field does not already reach open pairs by accident, or there would have been no headroom. The gap's arithmetic half now has a positive measured answer whose magnitude is bracketed rather than pinned.

**Prediction against outcome.** **Right on the direction** for both arms and right that the term would convert only a fraction of M-48's magnitude. **Wrong on which arm wins**: predicted `exp_hi` at 0.3 as the stronger reading around `+0.5pp` with `exp_lo` near `+0.2pp` and reading `equivalent`, and delivered the reverse ordering with `exp_lo` at more than five times its predicted estimate. **Wrong on the verdicts**, predicting `better`-or-`inconclusive` for `exp_hi` and `equivalent` for `exp_lo`, delivering `inconclusive` for both twice. **Badly wrong on the discordant count**, predicted 700 to 1,400 of 16,000 for `exp_hi` and fewer for `exp_lo`, delivering 3,697 and 3,143: the term changes the argmax several times more often than "the production and expansion rankings mostly agree on an empty board" allowed for, and that error is the same error that made the larger weight look like the safer bet. The lesson for the remaining SP3 and SP4 predictions is to stop reasoning about how often a new term changes the pick from how correlated it looks with the existing terms, and to expect a term with a new input to be far more active than that reasoning suggests.

**Disposition, per the preregistered rule.** Both arms read `inconclusive` on the screen, which bought units exactly once at four times the boards with `--reps` unchanged, and both read `inconclusive` again on the retry, so **the item is recorded unresolved and the run stops here**. Unresolved means unresolved against the `+/-1pp` practical threshold alone; the sign is settled and positive on both arms. **The survivor rule takes the better-reading arm only if an arm reads `better`, and neither does, so there is no survivor and this axis carries no value into SP6.** The recorded surviving `expansionWeight` is **none**. Task 9 and Task 10 of `docs/plans/completed/simulator-placement-sp3-sp5.md` are therefore on their skip branch, the decay axis is never swept, and Task 18's `sp4_exp_rise` and `sp4_exp_fall` arms do not exist, leaving M-58 to measure the diversity axis alone. Record only in every branch: no shipped default moved, in `src/engine/weights.ts`, `simulator/placement/default-weights.json`, `simulator/placement/phase-i-candidate-weights.json` or anywhere else, and the two arm files stay the only committed files carrying a nonzero value on this axis. Nothing is reverted either: a weight shipped at 0 skips the walk and is inert, and `SIM-GAP-34` stays open in `gaps.md` because that gap closes on adoption and adoption is SP6's business.

**Scope, and what this entry may not be cited for.** Two contrasts, two arm values, one axis. It measures `expansionWeight` at 0.1 and 0.3 on the hero seat against three seats carrying the shipped weights; it is **not** a measurement of a field where every seat expands deliberately, and the term is occupancy-dependent, so the hero is scoring against a board three shipped-formula seats fill. `expansionDecay` was 0.5 in both arms and is untested: nothing here is evidence about the decay axis, and the preregistered sweep of it does not run. The per-hero-seat table is record-only and carries no verdict; it is a hypothesis for SP4, not a result. The retry is 8000 boards at screen protocol, not a `gate`-domain confirmation, so it can retire a candidate but could not have adopted one.

## M-56: blockability within hex-count strata

2026-09-02, commit `e73058df` (the preregistration commit; the stratified table itself landed earlier in this run at `398dbb17`, and no shipped default moved), domain `tuning`. Preregistered in `docs/plans/preregs/2026-09-02-m56-robber-separation.md` (committed before the run). One reading, and the only one this run takes: the blockability quartile gap M-48 measured, re-measured *within* strata of fixed producing-hex count, where hex count cannot vary and therefore cannot be the quantity the gap is expressing. **This is a diagnostic, not an A/B**: no arms, no reference, no field contrast, no hero-seat rotation, so it carries no verdict and the paired-statistics disposition rule does not apply to it and cannot be read onto it. Its product is one boolean, `concentrationTermIndicated`, which decides whether Tasks 14, 15 and 16 of `docs/plans/completed/simulator-placement-sp3-sp5.md` build the robber concentration term or take their skip branch.

The statistic is `simulator/crates/cli/src/expansion.rs::blockability_by_hex_count`: every completed pair grouped by `PairReading::producing_hexes`, the identical `expansion.rs::quartile_gap` construction run inside each group, a stratum counted when it holds at least `expansion.rs::CONCENTRATION_STRATUM_PAIRS` (1,000) pairs, and the pair-count-weighted mean of the counted gaps compared against `expansion.rs::CONCENTRATION_MEAN_GAP` (`-0.03`). The boolean is the conjunction of that mean clearing the threshold and every counted stratum's gap being strictly negative. The table is emitted on the overall row and on each of the four per-slot rows of `diagnostics.json`; the boolean is read off the overall row and the per-slot booleans are record-only.

```text
RUSTFLAGS="-D warnings" cargo build --release --manifest-path simulator/Cargo.toml -p unsettled-sim

# from simulator/
target/release/unsettled-sim diagnose --layout standard4 --seats 4 --domain tuning --placement app_formula:placement/default-weights.json --boards 2000 --reps 2 --policy heuristic-v1-trader-aware-threat-devcards-denial --player-trading --alpha 0.05 --threads 0 --out runs/m56-robber-separation
```

**Provenance and admissibility.** The release binary was built with `RUSTFLAGS="-D warnings"` before the measurement started and reported `Finished` in 0.01s against a warm fingerprint, so no compile landed inside the timed window. `rustc 1.94.0 (4a4ef493e 2026-03-02)`, domain seed `8795844940285355527`, the same seed M-47 and M-48 ran on. Load before `1.53 1.90 2.05`, after `1.53 1.90 2.05`; 0.87s at 18 workers, 4,589.3 games/s. 4,000 games, 32,000 setup picks, 16,000 completed pairs, **zero illegal actions**. The invocation shared its command block with no build, no test suite and no other CPU-heavy job. `simulator/runs/` is gitignored, so the artifact is not in the tree and this entry is the record. As in M-48, no pair had zero reachable expansion sites and no pair had zero producing hexes.

**The preregistered reproduction check failed as written, and the investigation it mandated found the field's play had moved, not its placement.** The preregistration required this run to reproduce M-48's overall boxing gap `+0.0646413` and blockability gap `-0.1137321` and M-47's coastal-selection 6,049 pairs and `0.4518102` share, on the stated premise that "the same board set, the same seeds, the same policy" were unchanged since those runs. Two of the four reproduced and two did not: the coastal block came back at exactly 6,049 pairs and `0.4518102165647214`, and the gaps came back at `+0.0694517` and `-0.1243270`. Per the preregistration no reading was taken and no branch was decided until the discrepancy was explained.

**What is identical, and what moved.** Every placement-derived number in the artifact reproduces M-47 and M-48 to the digit: the same domain seed, the same 32,000 picks with 1,492 skipped for want of a pip-matched alternative and 24,459 discarded as hex-count ties, the same 6,049 coastal pairs over 1,681 clusters, the same boxing arms of 4,992 and 4,986 at cuts `<= 7` and `>= 11` with means `5.5917468` and `12.4813478`, and the same blockability arms of 5,383 and 4,908 at cuts `<= 0.2380952` and `>= 0.2777778` with means `0.2285860` and `0.2962879`. What moved is only the win rates attached to those identical pairs: boxing's bottom arm from `0.2169471` to `0.2143429` and its top from `0.2815884` to `0.2837946`, blockability's bottom from `0.2985324` to `0.3048486` and its top from `0.1848003` to `0.1805216`, and coastal's from `0.2056` and `0.2557` to `0.2023417` and `0.2524125`, whose gap still rounds to the same `+5.01pp`. The placements are the same placements; the games they lead to end differently.

**The cause, demonstrated rather than inferred.** The preregistration's premise about the policy was simply wrong, and was wrong when it was written. Three commits between M-48's run and this plan's first commit moved the composite policy's play and each recorded its own corpus delta at the time: `65203baa` (`SIM-GAP-33`, the contest block-bonus predicate, 7 of 600 games on `standard4`), `731eaac1` (SP1b, `victimNeedWeight` at a default of 0.15, 62 of 400) and `5d8c28ab` (SP1c, `needCompletionWeight` at a default of 0.35, 37 of 400), each moving the `heuristic-v1-trader-aware-threat-devcards-denial` corpora alone, which is exactly the policy this run's field plays. Rather than rest on those commit messages, the attribution was measured. Two extra binaries were built in a detached scratch worktree and run through the identical invocation, after the timed window and therefore contaminating nothing in it:

```text
git worktree add --detach /tmp/unsettled-m56-pre 3765e688
RUSTFLAGS="-D warnings" cargo build --release --manifest-path /tmp/unsettled-m56-pre/simulator/Cargo.toml -p unsettled-sim
# from /tmp/unsettled-m56-pre/simulator/, identical to the run above but for --out
target/release/unsettled-sim diagnose ... --out runs/m56-attrib-pre

git -C /tmp/unsettled-m56-pre checkout --detach 255b5ba1
RUSTFLAGS="-D warnings" cargo build --release --manifest-path /tmp/unsettled-m56-pre/simulator/Cargo.toml -p unsettled-sim
target/release/unsettled-sim diagnose ... --out runs/m56-attrib-sp1d
```

At `3765e688`, M-48's own commit, the gaps come back at `+0.0646413` and `-0.1137321` and the coastal block at 6,049 and `0.4518102165647214`, reproducing M-47 and M-48 exactly on today's tree. At `255b5ba1`, SP1d and the last commit in the programme that touches policy code, they come back at `+0.0694517` and `-0.1243270`, reproducing today exactly. **The entire delta therefore lands inside `3765e688..255b5ba1`**, which is SP1a through SP1d plus the `SIM-GAP-33` fix, and everything after SP1d is play-neutral: SP2a, SP2b, the review-fix commits and every task of this plan. That is an independent confirmation, on end-to-end game outcomes rather than on a 600-game corpus, that SP3's behaviour-neutral tasks were in fact behaviour-neutral.

**Disposition of the check, and why the reading stands.** The clause is recorded as **failing as written**, and it is not retroactively relaxed: what is recorded instead is that it fused two questions the investigation has now separated. The half the clause was built to protect, stated in its own rationale as "a moved number means something in the field moved that was declared not to have", is the placement, and the placement reproduces to every digit under two independently built binaries. The half that moved was declared to have moved, in three commits' recorded corpus deltas, by the previous run and before this plan began; the preregistration overlooked them. **The reading is a property of the field as it is shipped today, and the field as it is shipped today is the one the term would have to earn its weight against**, so it is taken on this run, with the failure and its explanation recorded above rather than buried. The alternative was not a better reading elsewhere: the M-48-era field no longer exists in the tree and could only be restored by reverting three landed gap fixes, and the stratified table did not exist in it, so declaring the run void would have left the branch permanently undecided rather than decided on better evidence. One consequence for how this entry may be cited: the preregistration's threshold rationale describes `-0.03` as "roughly a quarter of the pooled `-11.37pp` M-48 read", and the like-for-like pooled figure on this run's field is `-12.43pp`. The constant is unchanged, the fraction it represents moves from 26% to 24%, and nothing about the comparison below turns on which of the two is used.

**The stratified table, overall row.** Percentage points would obscure the cuts, so shares and rates are given as they are computed. The four strata hold all 16,000 pairs.

| Row | Producing hexes | Pairs | Counted | Bottom cut | Bottom n | Bottom mean share | Bottom win rate | Top cut | Top n | Top mean share | Top win rate | Gap |
| --- | ---: | ---: | :---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| overall | 3 | 22 | no | `0.3571429` | 6 | `0.3571429` | `0.0000000` | `0.4166667` | 6 | `0.4292929` | `0.1666667` | `+0.1666667` |
| overall | 4 | 809 | no | `0.2941176` | 296 | `0.2879643` | `0.1621622` | `0.3333333` | 305 | `0.3516516` | `0.0983607` | `-0.0638015` |
| overall | 5 | 6,709 | yes | `0.2500000` | 1,847 | `0.2449730` | `0.2517596` | `0.2941176` | 1,822 | `0.3058515` | `0.1602634` | `-0.0914962` |
| overall | 6 | 8,460 | yes | `0.2272727` | 2,815 | `0.2204421` | `0.3150977` | `0.2500000` | 3,741 | `0.2609797` | `0.2683774` | `-0.0467203` |

**Per-slot rows, record-only.** The cuts differ by slot as well as by stratum, which they did not in M-48's pooled reading, because a slot's pairs complete at a different board fill and the strata's mass shifts with it.

| Row | Producing hexes | Pairs | Counted | Bottom cut | Bottom n | Bottom mean share | Bottom win rate | Top cut | Top n | Top mean share | Top win rate | Gap |
| --- | ---: | ---: | :---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 0 | 3 | 4 | no | `0.4166667` | 4 | `0.4166667` | `0.2500000` | `0.4166667` | 4 | `0.4166667` | `0.2500000` | `+0.0000000` |
| 0 | 4 | 316 | no | `0.2941176` | 140 | `0.2867520` | `0.1785714` | `0.3333333` | 86 | `0.3554682` | `0.0930233` | `-0.0855482` |
| 0 | 5 | 1,667 | yes | `0.2500000` | 602 | `0.2443777` | `0.2475083` | `0.2777778` | 666 | `0.2917747` | `0.1906907` | `-0.0568176` |
| 0 | 6 | 2,013 | yes | `0.2272727` | 854 | `0.2195195` | `0.3395785` | `0.2500000` | 679 | `0.2583934` | `0.3210604` | `-0.0185181` |
| 1 | 3 | 2 | no | `0.3846154` | 2 | `0.3846154` | `0.0000000` | `0.3846154` | 2 | `0.3846154` | `0.0000000` | `+0.0000000` |
| 1 | 4 | 223 | no | `0.2941176` | 85 | `0.2881584` | `0.1529412` | `0.3333333` | 97 | `0.3506948` | `0.0927835` | `-0.0601577` |
| 1 | 5 | 1,718 | yes | `0.2500000` | 509 | `0.2450021` | `0.2946955` | `0.2857143` | 436 | `0.3050743` | `0.1949541` | `-0.0997414` |
| 1 | 6 | 2,057 | yes | `0.2272727` | 687 | `0.2207108` | `0.3231441` | `0.2500000` | 854 | `0.2613666` | `0.2377049` | `-0.0854392` |
| 2 | 3 | 2 | no | `0.3846154` | 2 | `0.3846154` | `0.0000000` | `0.3846154` | 2 | `0.3846154` | `0.0000000` | `+0.0000000` |
| 2 | 4 | 149 | no | `0.3125000` | 85 | `0.3031315` | `0.1058824` | `0.3333333` | 64 | `0.3460251` | `0.0468750` | `-0.0590074` |
| 2 | 5 | 1,644 | yes | `0.2631579` | 731 | `0.2539863` | `0.2202462` | `0.2941176` | 495 | `0.3049290` | `0.1616162` | `-0.0586301` |
| 2 | 6 | 2,205 | yes | `0.2272727` | 704 | `0.2210571` | `0.2897727` | `0.2500000` | 1,052 | `0.2614318` | `0.2690114` | `-0.0207613` |
| 3 | 3 | 14 | no | `0.3571429` | 6 | `0.3571429` | `0.0000000` | `0.3846154` | 6 | `0.4079254` | `0.0000000` | `+0.0000000` |
| 3 | 4 | 121 | no | `0.2941176` | 36 | `0.2904866` | `0.1388889` | `0.3333333` | 58 | `0.3538014` | `0.1724138` | `+0.0335249` |
| 3 | 5 | 1,680 | yes | `0.2631579` | 702 | `0.2541322` | `0.2108262` | `0.2941176` | 572 | `0.3067959` | `0.1293706` | `-0.0814556` |
| 3 | 6 | 2,185 | yes | `0.2272727` | 570 | `0.2207412` | `0.3000000` | `0.2631579` | 617 | `0.2721111` | `0.2301459` | `-0.0698541` |

**Summary of the condition, on every row.**

| Row | Counted strata | Counted pairs | Weighted mean gap | Every counted stratum negative | `concentrationTermIndicated` |
| --- | ---: | ---: | ---: | :---: | :---: |
| overall | 5, 6 | 15,169 | `-0.0665239` | yes | true |
| 0 | 5, 6 | 3,680 | `-0.0358673` | yes | true |
| 1 | 5, 6 | 3,775 | `-0.0919481` | yes | true |
| 2 | 5, 6 | 3,849 | `-0.0369360` | yes | true |
| 3 | 5, 6 | 3,865 | `-0.0748969` | yes | true |

**Branch outcome: `concentrationTermIndicated` true, so the robber concentration term is built.** Both halves of the preregistered conjunction hold on the overall row. The weighted mean gap over the counted strata is **`-6.65pp`**, more than twice the `-3pp` threshold, and both counted strata are strictly negative, at `-9.15pp` on five producing hexes and `-4.67pp` on six. The two counted strata hold 15,169 of the 16,000 pairs, so the boolean is read over 94.8% of the mass rather than over a thin slice of it. Every per-slot row indicates true as well, though slot 0 at `-3.59pp` and slot 2 at `-3.69pp` clear the threshold by well under a point; the overall row is what governs and the per-slot agreement is corroboration rather than evidence.

**The boolean does not turn on the 1,000-pair floor.** The two uncounted strata pull in opposite directions and neither is load-bearing. Four producing hexes holds 809 pairs at `-6.38pp`, negative and close to the weighted mean, so admitting it would leave both halves holding and move the mean only to `-6.64pp`. Three producing hexes holds 22 pairs at `+16.67pp`, which is one win against zero on arms of six pairs each and is noise at that size, but it is the one positive stratum in the run and it would fail the sign test if it were ever counted. Working the floor as a free parameter: the boolean is true for any floor from 23 to 8,460 pairs and false outside that range, false below because the three-hex stratum enters and breaks the sign test, false above because nothing is counted at all and `countedPairs` is 0. The registered floor of 1,000 sits in the middle of a range spanning nearly three orders of magnitude, so the reading is insensitive to it, which is the check worth making on a constant fixed before any of these counts were known.

**About half the pooled gap was the confound, and about half was not.** The pooled blockability gap on this field is `-12.43pp` and the within-stratum weighted mean is `-6.65pp`, so holding producing-hex count fixed removes `5.78pp`, or 46% of the pooled magnitude, and leaves 54% standing. The confound is real and it is large, exactly as M-48 warned and as the preregistration argued; it is simply not most of the reading. The mechanism is visible in the cuts themselves, which is worth stating because it is what a future session will want to check. The pooled cuts were `<= 0.2380952` and `>= 0.2777778`. The four-hex stratum's own bottom cut is `0.2941176`, above the pooled *top* cut, so at least three quarters of four-hex pairs fall in the pooled top arm; the three-hex stratum's bottom cut is `0.3571429` and all of it does. The six-hex stratum's top cut is `0.2500000`, below the pooled top cut, so at most a quarter of six-hex pairs reach the pooled top arm. The pooled contrast really was splitting five-and-six-hex pairs from three-and-four-hex pairs, as predicted. What was not predicted is that a contrast of comparable size survives inside the two big strata anyway.

**What the surviving gap is and is not evidence for.** It is evidence that among pairs touching the same number of producing hexes, the ones with a larger share of their pips on their single best hex win materially less often, at every hex count observed in quantity and at every draft slot. It is not a causal estimate and it carries no interval and no significance claim, exactly as M-48's gaps carried none: the arms are self-selected by the formula's own picks, and the point contrasts are compared against fixed constants rather than tested against a null. The sign test in particular is applied to point estimates, so a counted stratum whose true gap is near zero could have failed it on noise; that asymmetry was preregistered as intentional and it did not bite, since both counted gaps are several points from zero. One property the strata do not share is comparability of their arms: a six-hex pair's top arm sits at a mean share of `0.2610` and a five-hex pair's bottom arm at `0.2450`, so the same nominal share means different things in different strata, and only the gaps are compared, only through the weighted mean, which is the cost the preregistration named in advance.

**Prediction against outcome: wrong on the headline, and wrong in the direction the preregistration named as the one that would change its mind.** The prediction was `concentrationTermIndicated` **false**, failing on magnitude with a weighted mean between `-1pp` and `-3pp`, and it came back **true** at `-6.65pp`, outside the predicted range by more than a factor of two. The reasoning that produced it was that the pooled cuts split hex counts almost directly, which is true and is confirmed above by the strata's own cuts, and that the confound would therefore account for most of the pooled `-11.37pp`, which is false: it accounts for 46% of it. The secondary calls split. The strata range was called right, 3 to 6 producing hexes. The number clearing the floor was called at three or four and came in at two, because the mass is far more concentrated on five and six hexes than expected, 94.8% of pairs between them. The failure mode named as most likely, a large mean broken by one thin-but-counted stratum reading positive, did not occur: the only positive stratum in the run is far below the floor. And the preregistration's stated mind-changing reading was "a weighted mean at or past `-5pp` with every counted stratum negative", which is precisely what was measured, so the call flips on the condition it set for itself rather than on a reinterpretation after the fact.

The lesson generalises the one M-54 recorded and is why that one was cited in this preregistration's own hedging. M-54's error was reasoning about how often a new term changes a pick from how correlated it looks with the existing terms; this one is the same error wearing different clothes, reasoning about how much of a pooled contrast a confound carries from how tightly the confound tracks the cuts. Tight tracking of the cut is not the same as ownership of the effect, and in both cases the estimate that came from that reasoning was off by roughly a factor of two in the direction of underrating the new quantity. The remaining SP4 and SP5 predictions in this run should treat "the new quantity is mostly redundant with what is already priced" as the claim that needs the evidence, not the default.

**Disposition.** Nothing here adopts or changes a shipped default in either direction, and nothing here builds the term: the term is Task 14's business and this run only opens that branch. `robberConcentrationWeight` does not yet exist in `src/engine/weights.ts` or in `simulator/crates/engine/src/placement/app_formula.rs`, and when Task 14 adds it, it ships at 0 like every other term this run has produced, with M-57 as its A/B at an arm value of 4.0. The dated decision note in `.claude/specs/simulator/placement-programme.md` records the branch and supersedes the SP0 decisions section's "the item is open with its first task named, not scheduled". No entry in `.claude/specs/simulator/gaps.md` moves on this reading, because the robber-attraction item has never been a gap entry: it is a dropped proposal recorded in `placement-programme.md`, revisited there by M-48 and branched there by this run.

## M-57: robber concentration term

2026-09-02, commit `57636726` (the preregistration commit; no code and no default moved for this run), domain `tuning`. Preregistered in `docs/plans/preregs/2026-09-02-m57-robber-concentration.md` (committed before the run). One decision arm on one axis against the shipped vector: does charging a candidate for concentrating a pair's income on one blockable hex win more games?

The change under test is `robberConcentrationWeight`, built by Task 14 of `docs/plans/completed/simulator-placement-sp3-sp5.md` on the branch M-56 opened, declared in `src/engine/weights.ts::EngineWeights` and mirrored in `simulator/crates/engine/src/placement/app_formula.rs::EngineWeights`. It is a delta on the existing `robber` component, `robberConcentrationWeight * (topHexShare(holdings + c) - topHexShare(holdings))` subtracted from the candidate's score, computed by `src/engine/valuation.ts::concentrationDelta` over `valuation.ts::topHexShare` and by `app_formula.rs::concentration_delta` over `app_formula.rs::top_hex_share`, the two pinned against each other by parity class `W14` through cases `robber-concentration` and `robber-concentration-shared-hex`. The share is the largest single hex's share of the raw pips the *distinct* producing hexes touched by those settlements make, so a hex two settlements share counts once, matching `simulator/crates/cli/src/expansion.rs::pair_hexes`, the diagnostic the quantity comes from. It ships at 0, where both scorers return the delta as exactly 0 without taking a share, and the corpus diff in the implementing task was byte-identical. The arm is the live `simulator/placement/default-weights.json` with only that one key moved: `conc` = `simulator/placement/arms/sp3_concentration.json` at 4.0, inside the committed `sweep-bounds.json` range of 0.0 to 16.0 and pinned by `simulator/crates/engine/src/policy/params_file.rs::the_sp3_arm_files_are_the_committed_expansion_perturbations`. One arm rather than M-54's two, because the value is set by an interpretable calibration (a full-share move of 0.25 costs one point) rather than guessed from the units. Reference `base` is the shipped vector itself; field and reference are both the app-formula spec over it, because a formula arm has to be scored against the live formula.

`evaluate`, `standard4`, 4 seats, every seat on `heuristic-v1-trader-aware-threat-devcards-denial` with `--player-trading`, `--threads 0`, `--threshold 0.01`, `--alpha 0.05`, 2000 boards x 2 reps (16,000 paired units over 2000 clusters), the plan's screen power for an optional term, matching M-38's placement screens, M-49, M-52, M-53 and M-54's screen. The arm read `equivalent` on the screen, which buys no retry under the preregistered rule, so this is a single invocation.

```text
RUSTFLAGS="-D warnings" cargo build --release --manifest-path simulator/Cargo.toml -p unsettled-sim

# from simulator/
target/release/unsettled-sim evaluate --layout standard4 --seats 4 --domain tuning --field app_formula:placement/default-weights.json --arm base=app_formula:placement/default-weights.json --arm conc=app_formula:placement/arms/sp3_concentration.json --reference base --boards 2000 --reps 2 --policy heuristic-v1-trader-aware-threat-devcards-denial --threads 0 --player-trading --threshold 0.01 --alpha 0.05 --out runs/m57-robber-concentration
```

**Provenance and admissibility.** The release binary was built with `RUSTFLAGS="-D warnings"` before the measurement started and reported `Finished` in 0.02s against a warm fingerprint, so no compile landed inside the timed window. The invocation shared its command block with no build, no test suite and no other CPU-heavy job. `rustc 1.94.0 (4a4ef493e 2026-03-02)`, domain seed `8795844940285355527`, the same seed M-53, M-54 and M-56 ran on. Load before `2.20 2.88 2.42`, after `3.94 3.23 2.55`; 4.77s at 18 workers, 6,713.5 games/s, **32,000 games, zero illegal actions**, 0 draws in either arm. `base` won 3,988 of 16,000 (`0.24925`), `conc` won 4,080 of 16,000 (`0.255`).

The reference win rate sits at the symmetric 0.25 corner as the preregistered check requires, and it matches M-54's screen `base` figure to the digit, 3,988 of 16,000, which is the drift check the preregistration registered in place of a reproduction clause: the placement code has moved since M-54 by exactly one term shipping at 0, and a reference carrying the shipped vector shows any unintended movement in its own win rate. It shows none. Throughput at 6,713.5 games/s sits between M-54's screen (7,158.3) and its retry (6,621.6) and below M-53's 7,226.5, which is roughly where the prereg placed it: the term is arithmetic over a hex mask the precompute already carries, so it is far cheaper per candidate than M-54's expansion walk, and the reference arm skips it entirely. Timing is a throughput observation only; the outcomes are deterministic in the seeds and unaffected by load. `simulator/runs/` is gitignored, so the artifact is not in the tree and this entry is the record.

Pooled paired table, reference `base`, live default on this axis 0:

| Arm | `robberConcentrationWeight` | n | Estimate | b | c | Discordant | McNemar interval | Clustered interval | Selected | Verdict |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | --- | --- |
| conc | 4.0 | 16,000 | `0.0057500` | 416 | 324 | 740 | `[0.0024189, 0.0090811]` | `[0.0022805, 0.0092195]` | clustered | equivalent |

The clustered interval was the wider of the two and was the one selected, per `evaluate.rs::try_paired_stats`. The comparison was not clustered-degenerate, over 2,000 clusters.

Per-hero-seat table, from Task 1's `perHeroSeat` block. Hero seat equals draft slot, because `game.rs::setup_order` runs `0..seats` then reversed. Record only: there is no per-slot verdict and the pooled row above is the verdict. Percentage points, clustered intervals.

| Slot | Estimate | Clustered interval | b | c | Discordant |
| ---: | ---: | --- | ---: | ---: | ---: |
| 0 | +0.62 | `[-0.06, +1.31]` | 96 | 71 | 167 |
| 1 | **+0.90** | `[+0.23, +1.57]` | 107 | 71 | 178 |
| 2 | +0.15 | `[-0.56, +0.86]` | 100 | 94 | 194 |
| 3 | +0.62 | `[-0.11, +1.36]` | 113 | 88 | 201 |

Per-seat `n` sums to the pooled 16,000 and per-seat `b + c` sums to the pooled 740, which is what the CLI test added in Task 1 asserts.

**The reading: a real positive effect, too small to clear the practical threshold.** The point estimate is `+0.575pp` and the selected interval is `[+0.228pp, +0.922pp]`, entirely above zero and entirely below the `+1pp` threshold. Both facts matter and they say different things. The interval excluding zero says the term helps rather than doing nothing; the interval sitting under the threshold says the help is smaller than the size the plan declared worth carrying. **This is the one `equivalent` in the programme so far that is not a null**, and it must not be cited as one: M-53's port deficit read flat, this reads positive and small. Every slot estimate is positive too, and the arm wins the discordant units 416 to 324.

**The term changes very few picks and converts a high share of the ones it changes.** 740 of 16,000 units are discordant, 4.6%, against M-54's 3,143 and 3,697 at the same power on the same field, so the concentration term reorders the argmax roughly a fifth as often as either expansion arm. Among the units it does move it wins 56.2%, above `exp_lo`'s 52.8% and `exp_hi`'s 50.7% at the screen and above `exp_lo`'s 52.8% on the retry. The axis is pointing the right way and it has almost no authority at 4.0. That is exactly the third failure mode the preregistration named, "the term's per-candidate spread may simply be too small at 4.0 to reorder an argmax often enough to matter", and it is the one that bit; the other two named modes did not. The double-count mode would have shown as a flat or negative estimate and did not, so the term is not merely restating what `diversityWeight`, `coverageExponent` and `duplicateNumberPenalty` already price. The nothing-to-steer-toward mode would have shown as a null among the picks it does change, and instead the changed picks win more often than the changed picks of either expansion arm.

**What this says about M-56's surviving gap.** M-56 found the top blockability quartile winning `-6.65pp` less often than the bottom within producing-hex strata, `-9.15pp` at five hexes and `-4.67pp` at six, with every slot indicating the same way and the smallest slot at `-3.59pp`. A term aimed straight at that quantity converts `+0.575pp` of it at this weight, about a sixth of the smallest slot's magnitude and under a tenth of the overall figure. Compare M-54, where a term aimed at M-48's boxing gap converted about a fifth of that reading's worst-slot magnitude. The concentration signal is therefore real in the outcomes, real in the picks, and worth about a tenth of what the diagnostic gap suggests once it has to compete with the production terms for the argmax. The gap is not an artefact and the formula is not blind to it, it is simply that the part the formula misses is small.

**A hypothesis this run produces and deliberately does not test.** The combination of a low discordant count and a high conversion rate among discordant units is what a correctly aimed but underpowered weight looks like, and it invites a larger value on the same axis. **This run does not buy one, and the preregistration forbade buying one after the reading in either direction**, because choosing an arm value from a result is choosing the arm from the data. If a future phase revisits the axis it should preregister the larger value first, and it should expect the calibration argument to work against it: the prereg's own reasoning is that 4.0 already prices a full-share move of 0.25 at one point, so a value large enough to move the argmax often would also be large enough to override the production ranking on candidates where production was right, which is the failure M-54 measured on `exp_hi`.

**Prediction against outcome.** **Right on the point estimate**, predicted between `+0.3pp` and `+1.0pp` and delivered `+0.575pp`, near the middle of the band. **Right on the direction and on the reasoning for a fraction rather than a full conversion.** **Wrong on the verdict**, predicting `inconclusive` on an interval straddling `+1pp` from below and delivering `equivalent` on an interval that clears zero and stops short of the threshold; the interval came in tighter than predicted, at a half-width of `+/-0.35pp` against M-54's `+/-0.71pp` and `+/-0.78pp` at the same power, because a term that moves few units produces less variance in the paired estimate. **Badly wrong on the discordant count, and wrong in the opposite direction from M-54's error**: predicted 2,500 to 5,000 and delivered 740, roughly a fifth of the low end. That prediction was reasoned explicitly off M-54's lesson, that a term with a new input is far more active than its correlation with the existing terms suggests, and applying that lesson mechanically over-corrected. The refinement worth carrying forward is that a term's activity is set by the spread of its own values across the candidates of a single pick, not by the novelty of its input: the expansion walk produces large differences between candidates on the same board, while the concentration share on a first pick runs a tenth of a share across candidates and buys a few tenths of a point at 4.0, which is the prereg's own arithmetic and should have driven the number rather than the analogy to M-54.

**Disposition, per the preregistered rule.** `conc` reads `equivalent` at the declared screen power, which under the plan's standing rule **drops the axis and records the reading itself as the answer**, with no retry: the single retry is bought by `inconclusive` alone and this is not that. **There is no SP6 survivor on this axis and no value is carried forward.** The recorded surviving `robberConcentrationWeight` is **none**. The robber-attraction item, dropped in SP0, revisited by M-48, separated from its hex-count confound by M-56 and converted into a term by Task 14, is now **closed on evidence**: the standing blockability signal M-56 isolated is real and a formula term can capture a small positive slice of it, and that slice is below the threshold the programme set for carrying a weight. Record only: no shipped default moved, in `src/engine/weights.ts`, `simulator/placement/default-weights.json`, `simulator/placement/phase-i-candidate-weights.json` or anywhere else, and `sp3_concentration.json` stays the only committed file carrying a nonzero value on this axis. Nothing is reverted either: at 0 the delta is exactly 0 and the term is inert. No entry in `.claude/specs/simulator/gaps.md` moves on this reading, because the robber-attraction item has never been a gap entry: it is a dropped proposal recorded in `.claude/specs/simulator/placement-programme.md`, revisited there by M-48, branched there by M-56, and closed there by this run.

**Scope, and what this entry may not be cited for.** One contrast, one arm value, one axis. It measures `robberConcentrationWeight` at 4.0 on the hero seat against three seats carrying the shipped weights; it is **not** a measurement of a field where every seat avoids concentration, and it says nothing about any other value on the axis, in either direction. The share is over raw pips and not robber-adjusted ones, so the term prices a standing property of the board and this entry is not evidence about pricing the robber's actual position, which `robberDiscount` already does and which this run did not touch. The per-hero-seat table is record-only and carries no verdict; slot 1's is the only interval excluding zero and one slot in four doing that at alpha 0.05 is not a slot pattern. `equivalent` here means "positive and below `+1pp`", not "zero", and the entry may not be cited for the claim that pair concentration does not matter to winning, which is M-56's question and which M-56 answered the other way.

## M-58: SP4 slot-scale profiles

2026-09-02, commit `c57ffddc` (the preregistration commit; no code and no default moved for this run), domain `tuning`. Preregistered in `docs/plans/preregs/2026-09-02-m58-sp4-slot-profiles.md` (committed before the run). Two mirrored decision arms on one axis against the shipped vector: is a formula weight that is right on average wrong slot by slot?

The change under test is `slotScales`, built by Task 17 of `docs/plans/completed/simulator-placement-sp3-sp5.md`, a nested block in both `EngineWeights` keyed seat count to slot to `{ expansion, diversity }`, shipping at 1.0 in every entry with exact-key validation on both sides. `src/engine/valuation.ts::slotScaleOf` resolves the pair from an explicit `DraftSlot` and `simulator/crates/engine/src/placement/app_formula.rs::AppFormulaScorer::slot_scale` resolves it from the seat, which is the slot by `simulator/crates/engine/src/game.rs::setup_order`; parity class `W15` pins the two against each other through case `slot-scales`. At 1.0 everywhere the block is exactly a no-op, which Task 17's byte-identical corpus diff confirmed. The two arms are the live `simulator/placement/default-weights.json` with only the four `diversity` leaves of the four-seat row moved, every other key including the three other seat-count rows and all four `expansion` leaves byte-identical: `div_rise` = `simulator/placement/arms/sp4_div_rise.json` at 0.5, 0.8, 1.25, 2.0 for slots 0 to 3, and `div_fall` = `simulator/placement/arms/sp4_div_fall.json` at the reverse, 2.0, 1.25, 0.8, 0.5. Every moved leaf sits inside the committed `sweep-bounds.json` range of 0.25 to 4.0 and both files are pinned by `simulator/crates/engine/src/policy/params_file.rs::the_sp4_arm_files_are_the_committed_slot_profiles`. The same multiset of scales in both arms with only the order differing is the design: a purely global misweighting cannot separate the two arms, because the hero rotates through all four slots equally, while a genuine slot effect should. **The plan's `sp4_exp_rise` and `sp4_exp_fall` arms do not exist and this run did not measure the expansion axis**; they were conditional on M-54 recording a surviving `expansionWeight` and M-54 read `inconclusive` twice, so `expansionWeight` stays at 0 and scaling an exactly-zero term would have produced a copy of the reference wearing a different name. Reference `base` is the shipped vector itself; field and reference are both the app-formula spec over it, because a formula arm has to be scored against the live formula.

`evaluate`, `standard4`, 4 seats, every seat on `heuristic-v1-trader-aware-threat-devcards-denial` with `--player-trading`, `--threads 0`, `--threshold 0.01`, `--alpha 0.05`, 2000 boards x 2 reps (16,000 paired units over 2000 clusters), the plan's screen power for an optional term, matching M-38's placement screens, M-49, M-52, M-53, M-54's screen and M-57. Both arms read `equivalent` on the screen, which buys no retry under the preregistered rule, so this is a single invocation.

```text
RUSTFLAGS="-D warnings" cargo build --release --manifest-path simulator/Cargo.toml -p unsettled-sim

# from simulator/
target/release/unsettled-sim evaluate --layout standard4 --seats 4 --domain tuning --field app_formula:placement/default-weights.json --arm base=app_formula:placement/default-weights.json --arm div_rise=app_formula:placement/arms/sp4_div_rise.json --arm div_fall=app_formula:placement/arms/sp4_div_fall.json --reference base --boards 2000 --reps 2 --policy heuristic-v1-trader-aware-threat-devcards-denial --threads 0 --player-trading --threshold 0.01 --alpha 0.05 --out runs/m58-sp4-slot-profiles
```

**Provenance and admissibility.** The release binary was built with `RUSTFLAGS="-D warnings"` before the measurement started and reported `Finished` in 0.01s against a warm fingerprint, so no compile landed inside the timed window. The invocation shared its command block with no build, no test suite and no other CPU-heavy job. `rustc 1.94.0 (4a4ef493e 2026-03-02)`, domain seed `8795844940285355527`, the same seed M-53, M-54, M-56 and M-57 ran on. Load before `2.13 2.72 2.38`, after `3.40 2.96 2.47`; 6.43s at 18 workers, 7,465.3 games/s, **48,000 games, zero illegal actions**, 0 draws in any arm. `base` won 3,988 of 16,000 (`0.24925`), `div_fall` 3,982 (`0.248875`), `div_rise` 3,916 (`0.24475`).

The reference win rate sits at the symmetric 0.25 corner as the preregistered check requires, and it matches M-54's screen and M-57's `base` figure to the game, 3,988 of 16,000, which is the drift check the preregistration registered in place of a reproduction clause: the placement code has moved since M-57 by exactly one block that is a no-op at its shipped values, and a reference carrying the shipped vector shows any unintended movement in its own win rate. It shows none. Throughput at 7,465.3 games/s is the highest of the plan's screens, above M-57's 6,713.5 and M-54's 7,158.3, which is where the prereg placed it: the scale is one multiplication on a component both scorers already compute, and no arm carries a nonzero `expansionWeight`, so no expansion walk ran anywhere in this run. Timing is a throughput observation only; the outcomes are deterministic in the seeds and unaffected by load. `simulator/runs/` is gitignored, so the artifact is not in the tree and this entry is the record.

Pooled paired table, reference `base`, live four-seat `diversity` scales all 1.0. `b` is units the arm won and the reference lost, `c` the reverse.

| Arm | Four-seat `diversity` scales, slots 0 to 3 | n | Estimate | b | c | Discordant | McNemar interval | Clustered interval | Selected | Verdict |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- | --- |
| div_fall | 2.0, 1.25, 0.8, 0.5 | 16,000 | `-0.0003750` | 722 | 728 | 1,450 | `[-0.0050396, 0.0042896]` | `[-0.0051205, 0.0043705]` | clustered | equivalent |
| div_rise | 0.5, 0.8, 1.25, 2.0 | 16,000 | `-0.0045000` | 725 | 797 | 1,522 | `[-0.0092785, 0.0002785]` | `[-0.0095332, 0.0005332]` | clustered | equivalent |

The clustered interval was the wider of the two on both arms and was the one selected, per `simulator/crates/cli/src/evaluate.rs::try_paired_stats`. Neither comparison was clustered-degenerate, over 2,000 clusters.

Per-hero-seat table, from Task 1's `perHeroSeat` block. Hero seat equals draft slot, because `game.rs::setup_order` runs `0..seats` then reversed. Record only: there is no per-slot verdict and the pooled rows above are the verdict. Percentage points, selected intervals, with the scale that slot carried in that arm.

| Arm | Slot | Scale | Estimate | Interval | b | c | Discordant |
| --- | ---: | ---: | ---: | --- | ---: | ---: | ---: |
| div_fall | 0 | 2.0 | +0.23 | `[-0.97, +1.42]` | 284 | 275 | 559 |
| div_fall | 1 | 1.25 | +0.25 | `[-0.46, +0.96]` | 107 | 97 | 204 |
| div_fall | 2 | 0.8 | -0.08 | `[-0.86, +0.71]` | 115 | 118 | 233 |
| div_fall | 3 | 0.5 | -0.55 | `[-1.63, +0.53]` | 216 | 238 | 454 |
| div_rise | 0 | 0.5 | **-2.23** | `[-3.45, -1.00]` | 255 | 344 | 599 |
| div_rise | 1 | 0.8 | +0.50 | `[-0.22, +1.22]` | 115 | 95 | 210 |
| div_rise | 2 | 1.25 | -0.33 | `[-1.02, +0.37]` | 93 | 106 | 199 |
| div_rise | 3 | 2.0 | +0.25 | `[-0.92, +1.42]` | 262 | 252 | 514 |

Per-seat `n` sums to the pooled 16,000 and per-seat `b + c` sums to the pooled 1,450 and 1,522, which is what the CLI test added in Task 1 asserts. Slot 2 of `div_rise` is the only row in the run where the McNemar interval was the wider of the two.

**The reading: two nulls, and a per-slot pattern that follows the scale rather than the slot.** Both arms read `equivalent` at the declared power. `div_fall` is flat, `-0.0375pp` on a half-width of `+/-0.47pp`, about as close to nothing as this instrument can report. `div_rise` is `-0.45pp` on `+/-0.50pp`, an interval that lies within the `+/-1pp` threshold and so reads `equivalent` by the rule, but that sits almost wholly below zero and whose lower end stops 0.05pp short of the threshold. It is the closest any arm in this plan has come to reading `worse` from inside the equivalence band, and the entry should not be cited as if the two arms read alike; they read alike in verdict and 0.41pp apart in estimate.

The discriminating comparison this design was built for is whether the two arms' slot patterns are mirror images, and the answer is that they are, in the scale rather than in the slot. Sorting the eight per-slot rows by the scale the slot carried: at 0.5 the readings are `-2.23` and `-0.55`, both negative; at 2.0 they are `+0.25` and `+0.23`, both positive and near-identical; the four middle rows at 0.8 and 1.25 run `+0.50`, `-0.08`, `-0.33`, `+0.25` with no order at all. Discordance tracks the same axis and nothing else: 599 and 454 units at 0.5, 559 and 514 at 2.0, and 199 to 233 at each of the two middle scales, so the outer scales carry roughly two and a half times the activity of the inner ones in both arms alike. **A reading ordered by the scale and not by the slot is a level effect, not a slot effect**, and the level in question is already known to be set low: M-40 measured the field wanting roughly three times the shipped `diversityWeight` of 1.6, at `+1.3pp` with interval `[+0.95pp, +1.63pp]`, missing `better` by half a tenth of a point and never adopted. Halving the diversity bundle hurts and doubling it helps slightly, at whichever slot it is done.

**What separates the two arms is a difference in sensitivity, not in direction.** The whole 0.41pp gap between the arms comes from one row, `div_rise` slot 0 at `-2.23pp`, the only interval anywhere in this run that excludes zero and the only row larger in magnitude than 0.55pp. Halving the diversity bundle costs about four times as much at slot 0 as the same halving costs at slot 3, on similar discordant counts (599 against 454), and the two intervals do not overlap. So slot 0 is genuinely the slot most sensitive to this component, which is a slot effect of a kind. It is not the kind SP4 was built to exploit. Every slot wants the scale moved the same way, up, so a slot-keyed block whose four entries all point in one direction is a strictly less efficient way of writing a single larger number, and the block earns its keep only if some slot wants the component scaled down. No slot does. Two cautions on that comparison, both stated rather than buried: the cross-arm per-slot contrast is not a preregistered test, and the per-slot rows are record-only at half-widths near `+/-1pp`, so the slot-0 row establishes that halving hurts there and nothing finer.

**The bundle limit still applies to the one live signal.** The prereg stated before the run that the `diversity` scale multiplies a bundle, not the spread term alone: `valuation.ts::diversityDelta` carries the `diversityWeight`-scaled spread plus the four recipe-coverage bonuses plus the duplicate-number penalty, and a scale of 0.5 halves all six. The `-2.23pp` at `div_rise` slot 0 is therefore a reading about halving that whole bundle at the first pick, and this run cannot say which of the six parts the loss came from. The prereg named "both arms negative" as the reading that would indict the instrument rather than the hypothesis. Both point estimates are indeed below zero, but only in the letter: `div_fall` is 0.04pp below zero on a 0.47pp half-width, which is not a negative reading in any usable sense, and the arithmetic sign of a dead-flat estimate is not evidence. The honest position is that the instrument is not indicted and the hypothesis is not supported, and the bundle question stays exactly as open as it was.

**Prediction against outcome.** **Wrong on which arm reads better.** `div_rise` was predicted ahead at `+0.2pp` to `+1.0pp` on the argument that a seat's control over its own complement rises with its slot; it delivered `-0.45pp` and finished behind. **Right on `div_fall`**, predicted between `-0.4pp` and `+0.4pp` and delivered `-0.04pp`, and **right on both verdicts**, predicted `inconclusive` or `equivalent` and delivered `equivalent` on both. **Badly wrong on the discordant count for the second entry running, and in the same direction as M-57's error**: predicted 5,000 to 9,000 units per arm and explicitly predicted more activity than either M-54 expansion arm's 3,143 and 3,697, and delivered 1,450 and 1,522, under a third of the low end and under half of M-54's arms. M-57, recorded one commit before this preregistration was written, had already extracted the refinement that would have got this right, that a term's activity is set by the spread of its own values across the candidates of a single pick rather than by the novelty of its input; this prediction reasoned from M-54's analogy anyway and repeated the same overshoot. The arithmetic that should have driven it: a scale of 2.0 reorders an argmax only where the gap in the diversity delta between the leading candidates is of the same size as the gap in the other five components, and on a first pick the diversity delta varies far less across the strong candidates than production does. **The named mind-changer that partly fired is the second one.** `div_fall` clearly ahead of `div_rise` would have said the first picker needs diversity most, because its second pick comes last and is nearly forced, so its first settlement has to be self-sufficient. `div_fall` is ahead but not clearly, on heavily overlapping pooled intervals, and the proposed mechanism is exactly what the slot-0 rows show: slot 0 is where scaling the diversity bundle down does the most damage. That mechanism is recorded as supported in its per-slot form and unsupported in its pooled form, and it is the opposite of the direction SP4's profiles were built around.

**Disposition, per the preregistered rule.** Both arms read `equivalent` at the declared screen power, which under the plan's standing rule **drops each arm and records the null as the answer**, with no retry: the single retry is bought by `inconclusive` alone and neither arm is that. **There is no SP6 survivor from SP4 and no profile is carried forward.** No leaf is carried on its own and no intermediate profile is constructed after the reading, both being forbidden by the preregistration as choosing the arm from the data. **SP4's premise is unsupported on the axis where it had its best chance**: a single number per axis is the right shape for the diversity weight, and what is wrong with that weight is its level, which M-39 and M-40 measured and which SP4 did not test. The expansion axis SP4 was designed around was never reachable, since M-54 left `expansionWeight` at 0. Record only: no shipped default moved, in `src/engine/weights.ts`, `simulator/placement/default-weights.json`, `simulator/placement/phase-i-candidate-weights.json` or anywhere else, the block stays at 1.0 in every shipped vector, and `sp4_div_rise.json` and `sp4_div_fall.json` stay the only committed files carrying a non-neutral scale. Nothing is reverted either: a 1.0 block is a no-op with a byte-identical corpus behind it. No entry in `.claude/specs/simulator/gaps.md` moves on this reading, because SP4 closes no gap of its own.

**Scope, and what this entry may not be cited for.** Two contrasts, one axis, one seat count. It measures four-seat `diversity` slot scales on the hero seat against three seats scoring unscaled at every slot; it is **not** a measurement of a field where every seat conditions on its slot, and it says nothing about the 3, 5 and 6 seat rows, which stayed at 1.0 throughout. It says nothing about the `expansion` leaves, which no arm moved and which are inert at `expansionWeight` 0 in any case. It does not test any scale outside `{0.5, 0.8, 1.25, 2.0}` nor any profile other than the two committed ones. `equivalent` here means "within `+/-1pp`", and for `div_rise` it means an estimate sitting almost entirely below zero, so the entry may not be cited for the claim that a rising diversity profile is harmless. The per-hero-seat table is record-only and carries no verdict. The arm moves the setup road as well as the settlement, because `placement/mod.rs::choose_app_formula` scores each incident edge's far endpoint through the same scaled entry at `expansionWeight` 0, and this run does not separate the two effects. Finally, this entry is evidence about the **shape** of the diversity weight and not about its **level**: it may not be cited against M-40, which asked the level question and answered it the other way.

## M-59: SP5 setup draft awareness

2026-09-02, commit `eb1a1d27` (the preregistration commit; no code and no default moved for this run), domain `tuning`. Preregistered in `docs/plans/preregs/2026-09-02-m59-sp5-draft-awareness.md` (committed before the run). One decision arm against the shipped placement: what was the missing setup lookahead costing?

The change under test is `PlacementKind::AppFormulaDraft`, built by Task 20 of `docs/plans/completed/simulator-placement-sp3-sp5.md` in `simulator/crates/engine/src/placement/draft.rs`. The field's setup path is greedy twice: `simulator/crates/engine/src/placement/mod.rs::choose_app_formula` takes the argmax of the formula for the pick in front of it and knows nothing about the picks that follow. The draft kind replaces the first settlement with an exact lookahead. For each legal candidate `c` it places `c`, replays every seat that picks between the hero's two settlements at that seat's own argmax under the opponent weights, and ranks `c` by `marginal(c)` plus the best second settlement still legal once those rivals have picked, with the setup grant on for the second; a candidate with no surviving second site scores `marginal(c)` alone. The second settlement stays the plain argmax, because nothing the hero cares about follows it. Both picks take the setup road by SP3's road rule at the hero weights, which at `expansionWeight` 0 falls through to the same far-endpoint scoring the field uses. The kind never prunes: it scores every legal candidate and every intervening pick, and its speed comes from `draft.rs::ScoreRows`, a cache keyed by seat, holdings and grant, kept only while both formulas carry `expansionWeight` 0 so that no component reads the occupancy. `simulator/crates/cli/tests/draft_lookahead.rs::the_lookahead_predicts_the_picks_the_field_actually_made` holds the model against ten tie-free traced `tuning` games at all four hero seats and requires the predicted intervening picks to equal the picks the field made.

One decision arm, `draft`, the draft kind carrying the shipped `simulator/placement/default-weights.json` on both its hero path and its opponent path, registered as `app_formula_draft:default-weights@default-weights` and written in full in the command block below. The same weights file on both sides means the only thing separating the arm from the reference is the lookahead. No weights file and no arm file was added; the arm is a placement kind rather than a parameter vector. Reference `base` is the app-formula spec over that same file, the shipped vector under the shipped greedy kind. `setupDenialWeight` does not exist at this commit and the lookahead carries no denial credit, which is M-60's subject.

`evaluate`, `standard4`, 4 seats, every seat on `heuristic-v1-trader-aware-threat-devcards-denial` with `--player-trading`, `--threads 0`, `--threshold 0.01`, `--alpha 0.05`. The screen ran at 2000 boards x 2 reps (16,000 paired units over 2000 clusters), the plan's screen power, matching M-38's placement screens, M-49, M-52, M-53, M-54's screen, M-57 and M-58. It read `inconclusive`, which bought the single preregistered retry at four times the boards and unchanged reps: 8000 boards x 2 reps, 64,000 paired units over 8000 clusters.

```text
RUSTFLAGS="-D warnings" cargo build --release --manifest-path simulator/Cargo.toml -p unsettled-sim

# screen, from simulator/
target/release/unsettled-sim evaluate --layout standard4 --seats 4 --domain tuning --field app_formula:placement/default-weights.json --arm base=app_formula:placement/default-weights.json --arm draft=app_formula_draft:placement/default-weights.json@placement/default-weights.json --reference base --boards 2000 --reps 2 --policy heuristic-v1-trader-aware-threat-devcards-denial --threads 0 --player-trading --threshold 0.01 --alpha 0.05 --out runs/m59-sp5-draft-awareness

# preregistered retry, from simulator/, identical but for --boards and --out
target/release/unsettled-sim evaluate --layout standard4 --seats 4 --domain tuning --field app_formula:placement/default-weights.json --arm base=app_formula:placement/default-weights.json --arm draft=app_formula_draft:placement/default-weights.json@placement/default-weights.json --reference base --boards 8000 --reps 2 --policy heuristic-v1-trader-aware-threat-devcards-denial --threads 0 --player-trading --threshold 0.01 --alpha 0.05 --out runs/m59-sp5-draft-awareness-retry
```

**Provenance and admissibility.** The release binary was built with `RUSTFLAGS="-D warnings"` before the measurement started and reported `Finished` in 0.01s against a warm fingerprint, so no compile landed inside either timed window, and the retry reused that same binary. Neither invocation shared its command block with a build, a test suite or any other CPU-heavy job. `rustc 1.94.0 (4a4ef493e 2026-03-02)`, domain seed `8795844940285355527` in both runs, the same seed M-53, M-54, M-56, M-57 and M-58 ran on.

Screen: load before `1.46 1.71 1.98`, after `2.94 2.02 2.08`; 4.99s at 18 workers, 6,417.0 games/s, **32,000 games, zero illegal actions**, 0 draws in either arm. `base` won 3,988 of 16,000 (`0.24925`), `draft` won 4,249 of 16,000 (`0.2655625`).

Retry: load before `2.54 2.06 2.10`, after `7.37 3.19 2.50`; 19.06s at 18 workers, 6,714.7 games/s, **128,000 games, zero illegal actions**, 0 draws in either arm. `base` won 15,912 of 64,000 (`0.248625`), `draft` won 16,967 of 64,000 (`0.2651094`).

**The registered reproduction check passes on both runs.** The preregistration made a mismatch inadmissible, because a reference carrying the shipped spec is where an accidental touch of the shipped path would show. The screen's `base` reproduces M-54's screen, M-57's and M-58's figure to the game, 3,988 of 16,000, and the retry's `base` reproduces M-54's retry to the game, 15,912 of 64,000. Both sit at the symmetric 0.25 corner. The new kind reached nothing the reference runs.

Throughput at 6,417.0 and 6,714.7 games/s is the lowest of the plan's screens, below M-57's 6,713.5 and well below M-58's 7,465.3, which is where the lookahead's cost shows: half the games in each run carry a hero that scores every legal candidate against a replay of the rest of the draft. **The preregistered timing extrapolation was conservative and the pessimistic branch never fired.** Task 20 measured 432.4 games/s on a single worker and the prereg took a zero-parallelism ceiling near 39 seconds for the screen; the screen took 4.99s and the retry 19.06s, so the 60 second trigger that would have moved the retry to a backgrounded poll did not fire and both invocations ran in the foreground. Timing is a throughput observation only; the outcomes are deterministic in the seeds and unaffected by load. `simulator/runs/` is gitignored, so neither artifact is in the tree and this entry is the record.

Pooled paired table, both runs, reference `base`. `b` is units the arm won and the reference lost, `c` the reverse.

| Run | n | Estimate | b | c | Discordant | McNemar interval | Clustered interval | Selected | Verdict |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- | --- |
| screen, 2000 boards | 16,000 | `0.0163125` | 1550 | 1289 | 2,839 | `[0.0097904, 0.0228346]` | `[0.0095269, 0.0230981]` | clustered | inconclusive |
| retry, 8000 boards | 64,000 | `0.016484375` | 6191 | 5136 | 11,327 | `[0.0132276, 0.0197412]` | `[0.0131152, 0.0198535]` | clustered | **better** |

The clustered interval was the wider of the two in both runs and was the one selected, per `simulator/crates/cli/src/evaluate.rs::try_paired_stats`. Neither comparison was clustered-degenerate, over 2,000 and 8,000 clusters.

Per-hero-seat table, from Task 1's `perHeroSeat` block, both runs. Hero seat equals draft slot, because `game.rs::setup_order` runs `0..seats` then reversed. Record only: there is no per-slot verdict and the pooled rows above are the verdict. Percentage points, selected intervals. `Intervening` is the number of picks the lookahead has to replay at that slot.

| Run | Slot | Intervening | Estimate | Interval | b | c | Discordant |
| --- | ---: | ---: | ---: | --- | ---: | ---: | ---: |
| screen | 0 | 6 | +1.80 | `[+0.50, +3.10]` | 383 | 311 | 694 |
| screen | 1 | 4 | +2.58 | `[+1.17, +3.98]` | 434 | 331 | 765 |
| screen | 2 | 2 | +1.48 | `[+0.17, +2.78]` | 355 | 296 | 651 |
| screen | 3 | 0 | +0.68 | `[-0.69, +2.04]` | 378 | 351 | 729 |
| retry | 0 | 6 | +1.94 | `[+1.31, +2.57]` | 1442 | 1132 | 2,574 |
| retry | 1 | 4 | **+2.26** | `[+1.56, +2.95]` | 1668 | 1307 | 2,975 |
| retry | 2 | 2 | +1.74 | `[+1.07, +2.41]` | 1527 | 1249 | 2,776 |
| retry | 3 | 0 | +0.66 | `[-0.02, +1.34]` | 1554 | 1448 | 3,002 |

Per-seat `n` sums to the pooled 16,000 and 64,000, and per-seat `b + c` sums to the pooled 2,839 and 11,327, which is what the CLI test added in Task 1 asserts. The clustered interval was selected on every row of both runs.

**The reading: the largest effect the placement programme has measured, and the retry bought precision rather than a different answer.** The point estimate moved by 0.017pp between the two runs, from `+1.6313pp` to `+1.6484pp`, while the half-width fell from `+/-0.68pp` to `+/-0.34pp`. That is the clean case for what a fourfold retry is for: the screen's estimate was right and its interval straddled the `+1pp` threshold from above, and quadrupling the boards resolved the verdict without moving the number. `+1.65pp` is larger than every term reading in this plan put together, against M-54's best arm at `+1.13pp`, M-57's `+0.575pp` and M-58's two nulls, and it is the only `better` verdict the plan has produced.

**The activity numbers say the lookahead agrees with greedy far more often than the preregistration allowed.** 2,839 of 16,000 units are discordant on the screen and 11,327 of 64,000 on the retry, 17.7% in both, and among discordant units the arm wins 54.6% and 54.7%. Working the prereg's own arithmetic backwards, a discordant share of 17.7% at four seats implies the two games diverge at all on about 47% of units, against the 70 to 100% the prediction assumed. So the draft kind is *less* discordant than either M-54 expansion arm, which produced 3,143 and 3,697 discordant units at the same power, and the prereg's claim that this would be the most discordant instrument in the plan is simply wrong. What it converts is the point: it changes fewer picks than an expansion weight of 0.3 and wins a far larger share of the ones it changes, which is what a change of objective looks like beside a change of coefficient.

**The per-slot pattern is ordered by opponent modelling, not by pair optimization, and this is the run's second finding.** Slot 3, where the lookahead replays nothing and is exactly a joint optimization of the hero's own pair, is the smallest reading at `+0.66pp` and the only interval in either run that touches zero. It is also the *most* discordant slot, 3,002 units against slot 0's 2,574, and it converts the worst: 51.8% of its discordant units against 56.0% at slot 0, 56.1% at slot 1 and 55.0% at slot 2. Pair optimization on an almost-full board therefore changes the most picks and wins the fewest of them, while the slots that carry two, four and six intervening picks change fewer and win more. The preregistration named "slot 3 clearly ahead of slot 0" as the reading that would say the gain was pair optimization rather than opponent modelling; the opposite happened, so **the gain is the opponent model and `SIM-GAP-20` was the larger half of what SP5 fixes**, not the smaller one.

**Slot 0 diverges least and converts best, which is not what the prediction expected either.** The prediction put slot 0 largest on the argument that six intervening picks strip the hero's favourite region before it picks again. Slot 0 is second largest at `+1.94pp` behind slot 1's `+2.26pp`, on intervals that overlap almost completely, and it is the slot where the two arms diverge least of all four (2,574 discordant, 42.9% implied divergence against slot 3's 50.0%). The coherent reading is that on an empty board the strongest vertex is unambiguous and greedy and joint agree about which it is far more often than they do later, while the divergences that do happen at slot 0 are between candidates the lookahead has a genuine six-pick reason to separate. Later slots diverge more because a fuller board offers more near-equal candidates, and near-equal candidates are where a differing pick buys least. Both facts point the same way: the value is in the picks the lookahead reasons about, not in the count of picks it changes.

**What this run cannot separate, restated after the reading exactly as the preregistration stated it before.** The arm differs from the reference in two ways, not one: the lookahead, and deterministic tie-breaking in both the settlement argmax and the setup road, since `app_formula` breaks both at random from the hero seat's own policy stream while the draft kind takes the lowest vertex index and the lowest edge id. **No attempt is made to separate them and this entry may not be cited as if the `+1.65pp` were the lookahead alone.** The tie-break difference is a coin flip against a coin flip on states where the formula is indifferent, so it should not bias the estimate in either direction, but it adds units where the two games diverge for no reason of substance, and it offsets the hero's own policy stream for the rest of any game containing a setup tie. That is one mechanism behind the 47% divergence being spread across all four slots rather than concentrated where the lookahead has picks to replay. Nothing in this run bounds how often it fires.

**Prediction against outcome.** **Right on the pooled estimate**, predicted between `+1.0pp` and `+2.5pp` and delivered `+1.65pp`, near the middle of the band. **Right on the verdict path**, predicted most likely `better` and otherwise `inconclusive`, and delivered `inconclusive` on the screen and `better` on the retry. **Right on the direction and on the reasoning**, that the field's greedy first pick maximizes the value of one settlement when the pair is what decides the game, and that a change of objective should beat a change of coefficient. **Wrong on the discordant count for the third entry running**, predicted 4,200 to 6,000 of 16,000 and delivered 2,839, and wrong in the opposite direction from M-57's and M-58's errors: those two overpredicted activity and this one overpredicted it as well, but from a different argument, that the arm changes something whenever a tie fires even when greedy and joint agree. That argument was sound and its magnitude was guessed. The prediction also called this the most discordant instrument in the plan and it is less discordant than either M-54 arm, so the interval came in at `+/-0.68pp` rather than the predicted `+/-0.8pp`. **Wrong on which slot leads**, predicting slot 0 largest between `+2pp` and `+5pp` and delivering slot 1 largest at `+2.26pp` with slot 0 at `+1.94pp`, both below the predicted band, on intervals too wide to separate them. **Right on slot 3 being positive and smallest.** **Neither named mind-changer fired**: the pooled estimate is positive, not negative, and slot 3 is clearly behind slot 0 rather than ahead of it. The refinement worth carrying forward, which M-57 and M-58 both reached from the other direction, is that a term's or a kind's discordance is set by how often it reorders the top of a candidate list and not by how large a structural change it is; the size of the change sets the conversion rate among the units it does move, and those are two separate quantities that three predictions in a row have conflated.

**Disposition, per the preregistered gap-fix rule.** `draft` reads **`better`** on the preregistered retry, `+1.6484pp` on a clustered interval of `[+1.31pp, +1.99pp]` that clears the `+1pp` threshold entirely at alpha 0.05. This is gap-closing work and the kind lands whatever the reading is; it happens to read positive, so no `worse` flag is raised for the user. **`PlacementKind::AppFormulaDraft` stays, and it is recorded as an SP6 candidate for the field placement.** Making it the field is SP6's decision and this plan puts it out of scope: the field's placement stays the app-formula spec over `simulator/placement/default-weights.json` throughout. Record only on every default: no shipped value moved, in `src/engine/weights.ts`, `simulator/placement/default-weights.json`, `simulator/placement/phase-i-candidate-weights.json` or anywhere else, and nothing in this run adopts anything. **`SIM-GAP-20` is closed and its entry deleted from `.claude/specs/simulator/gaps.md`**, because the gap was that the setup path has no opponent model and it now has one; the sentence in `.claude/specs/simulator/programme.md` that names it moves with it. `SIM-GAP-34` does not move: a term at weight 0 closes nothing.

**Scope, and what this entry may not be cited for.** One contrast, one kind, one seat count, one layout. The opponent path is pinned to the same weights file the field runs, which makes the opponent model **correctly specified by construction**: the three rival seats are running exactly the formula the lookahead assumes they are running. That is a deliberate best case and it bounds the claim. **This entry measures what draft awareness is worth against a field the model predicts exactly, and it may not be cited as what it is worth against a field that plays differently.** The lookahead runs on the hero seat alone against three greedy seats; a field where every seat looked ahead is a different and larger question this run does not ask, and the reading would not transfer to it. It carries no denial credit, since `setupDenialWeight` does not exist at this commit, so it is not evidence about denial in either direction. It says nothing about `extension6` or about 3, 5 and 6 seat games. The per-hero-seat table is record-only and carries no verdict, and the slot 1 against slot 0 ordering rests on overlapping intervals and should not be read as an ordering; what the table does establish, on non-overlapping intervals, is slot 3 below slots 0 and 1. Finally, the two differences bundled in the arm are not separable here, so the entry supports "the draft kind is worth about `+1.65pp`" and not "the lookahead is worth about `+1.65pp`".

## M-60: SP5 setup denial

2026-09-02, commit `f18b59dc` (the preregistration commit; no code and no default moved for this run), domain `tuning`. Preregistered in `docs/plans/preregs/2026-09-02-m60-sp5-setup-denial.md` (committed before the run). Two decision arms against the draft kind itself: what is it worth to the hero to price what its first settlement costs the rivals?

The change under test is `setupDenialWeight`, added by Task 23 of `docs/plans/completed/simulator-placement-sp3-sp5.md` and implemented in `simulator/crates/engine/src/placement/draft.rs`. M-59 established the draft kind at `+1.6484pp` over the shipped greedy setup, and everything it prices is the hero's own pair: `draft.rs::Lookahead::value` ranks a candidate by its marginal score plus the best second settlement still legal once the intervening rivals have replayed their argmaxes. What the candidate costs those rivals is visible to that replay and unpriced by it. `draft.rs::replay` scores each intervening seat's row twice, once with the hero's candidate taken and once with that vertex vacated for legality alone; `draft.rs::denial_gain` differences the two and floors at 0, `replay` sums the differences into `Lookahead::denial`, and `value` pays the hero `setupDenialWeight` times that sum on top of the pair value. The loss is scored at the rival's own weights and the price put on it is the hero's. `AppFormulaScorer::score_for_owner` never reads the field, so the credit reaches the argmax over first-pick candidates and nothing else: not the second settlement, which is `draft.rs::best_direct`, and not the setup road, which is `draft.rs::setup_road`.

Two decision arms, each the draft kind with the arm file on its hero path and the shipped vector on its opponent path:

- `denial_lo`, the draft kind over `simulator/placement/arms/sp5_denial_lo.json` on its hero path, registered as `app_formula_draft:sp5_denial_lo@default-weights`, `setupDenialWeight` 0.25
- `denial_hi`, the draft kind over `simulator/placement/arms/sp5_denial_hi.json` on its hero path, registered as `app_formula_draft:sp5_denial_hi@default-weights`, `setupDenialWeight` 1.0

Reference `draft` is the draft kind over `simulator/placement/default-weights.json` on both paths, registered as `app_formula_draft:default-weights@default-weights`, the same kind carrying the shipped vector on both paths, which is exactly the arm M-59 measured. Each arm file is the live `simulator/placement/default-weights.json` with `setupDenialWeight` alone raised and every other key byte-identical, pinned by `simulator/crates/engine/src/policy/params_file.rs::the_sp5_arm_files_are_the_committed_denial_perturbations`. All three specs are written in full in the command block below. **The opponent path is pinned to `simulator/placement/default-weights.json` in all three of them**, so the model the lookahead replays the rest of the field with is fixed while the hero's formula moves; `setupDenialWeight` is read only through the hero path, and an arm that also moved it on the opponent path would change what the replayed rivals pick and the contrast would stop being one term. Nothing in a JSON file pins that half; the command block below and the preregistration are where it lives.

`evaluate`, `standard4`, 4 seats, every seat on `heuristic-v1-trader-aware-threat-devcards-denial` with `--player-trading`, `--threads 0`, `--threshold 0.01`, `--alpha 0.05`. The screen ran at 2000 boards x 2 reps (16,000 paired units over 2000 clusters), the plan's screen power, matching M-38's placement screens, M-49, M-52, M-53, M-54's screen, M-57, M-58 and M-59's screen. `denial_hi` read `inconclusive` there, which bought the single preregistered retry at four times the boards and unchanged reps: 8000 boards x 2 reps, 64,000 paired units over 8000 clusters, carrying both arms against the one reference as the preregistration requires.

```text
RUSTFLAGS="-D warnings" cargo build --release --manifest-path simulator/Cargo.toml -p unsettled-sim

# screen, from simulator/
target/release/unsettled-sim evaluate --layout standard4 --seats 4 --domain tuning --field app_formula:placement/default-weights.json --arm draft=app_formula_draft:placement/default-weights.json@placement/default-weights.json --arm denial_lo=app_formula_draft:placement/arms/sp5_denial_lo.json@placement/default-weights.json --arm denial_hi=app_formula_draft:placement/arms/sp5_denial_hi.json@placement/default-weights.json --reference draft --boards 2000 --reps 2 --policy heuristic-v1-trader-aware-threat-devcards-denial --threads 0 --player-trading --threshold 0.01 --alpha 0.05 --out runs/m60-sp5-setup-denial

# preregistered retry, from simulator/, identical but for --boards and --out
target/release/unsettled-sim evaluate --layout standard4 --seats 4 --domain tuning --field app_formula:placement/default-weights.json --arm draft=app_formula_draft:placement/default-weights.json@placement/default-weights.json --arm denial_lo=app_formula_draft:placement/arms/sp5_denial_lo.json@placement/default-weights.json --arm denial_hi=app_formula_draft:placement/arms/sp5_denial_hi.json@placement/default-weights.json --reference draft --boards 8000 --reps 2 --policy heuristic-v1-trader-aware-threat-devcards-denial --threads 0 --player-trading --threshold 0.01 --alpha 0.05 --out runs/m60-sp5-setup-denial-retry
```

**Provenance and admissibility.** The release binary was built with `RUSTFLAGS="-D warnings"` before the measurement started and reported `Finished` in 0.01s against a warm fingerprint, so no compile landed inside either timed window, and the retry reused that same binary. Neither invocation shared its command block with a build, a test suite or any other CPU-heavy job. `rustc 1.94.0 (4a4ef493e 2026-03-02)`, domain seed `8795844940285355527` in both runs, the same seed M-53, M-54, M-56, M-57, M-58 and M-59 ran on.

Screen: load before `1.64 2.39 2.25`, after `4.23 2.92 2.44`; 7.68s at 18 workers, 6,252.2 games/s, **48,000 games, zero illegal actions**, 0 draws in any arm. `draft` won 4,249 of 16,000 (`0.2655625`), `denial_lo` 4,220 (`0.26375`), `denial_hi` 4,100 (`0.25625`).

Retry: load before `2.96 2.73 2.39`, after `9.92 4.44 3.02`; 31.21s at 18 workers, 6,151.6 games/s, **192,000 games, zero illegal actions**, 0 draws in any arm. `draft` won 16,967 of 64,000 (`0.265109375`), `denial_lo` 16,884 (`0.2638125`), `denial_hi` 16,538 (`0.25840625`).

**All three registered admissibility checks pass on both runs.** The reference reproduces M-59 to the game: 4,249 of 16,000 on the screen against M-59's screen `draft`, and 16,967 of 64,000 on the retry against M-59's retry `draft`, so the only placement code that moved since M-59 reached nothing at weight 0, exactly as Task 23 pinned. Slot 3 is exactly concordant on both arms in both runs, `b` and `c` both 0, for the structural reason the preregistration set out. Per-seat `n` sums to the pooled 16,000 and 64,000 and per-seat `b + c` sums to the pooled discordant counts on every arm of both runs, the invariant Task 1's CLI test asserts.

Throughput of 6,252.2 and 6,151.6 games/s is the lowest of the plan's screens, below M-59's 6,417.0 and 6,714.7. **That gap is smaller than it should be and it is worth recording.** Every game in this run carries a draft hero, against M-59 where the `base` arm made half of them greedy, and the cost of that is 2.6% and 8.4% of throughput. The lookahead scores every legal candidate against a full replay of the intervening draft and it still costs under a tenth of a game's total simulation time, which is `draft.rs::ScoreRows` doing its job. **The preregistered timing extrapolation held with room to spare and the 120 second trigger did not fire.** The prereg's 18-worker estimate was near 5,400 games/s, 9 seconds for the screen and 36 for the retry; delivered 7.68s and 31.21s, so both invocations ran in the foreground. Timing is a throughput observation only; the outcomes are deterministic in the seeds and unaffected by load. `simulator/runs/` is gitignored, so neither artifact is in the tree and this entry is the record.

Pooled paired tables, both runs, reference `draft`. `b` is units the arm won and the reference lost, `c` the reverse.

| Run | Arm | n | Estimate | b | c | Discordant | McNemar interval | Clustered interval | Selected | Verdict |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- | --- |
| screen, 2000 boards | `denial_lo` | 16,000 | `-0.0018125` | 356 | 385 | 741 | `[-0.0051469, +0.0015219]` | `[-0.0052967, +0.0016717]` | clustered | equivalent |
| screen, 2000 boards | `denial_hi` | 16,000 | `-0.0093125` | 586 | 735 | 1,321 | `[-0.0137624, -0.0048626]` | `[-0.0138904, -0.0047346]` | clustered | inconclusive |
| retry, 8000 boards | `denial_lo` | 64,000 | `-0.001296875` | 1429 | 1512 | 2,941 | `[-0.0029576, +0.0003639]` | `[-0.0030256, +0.0004319]` | clustered | equivalent |
| retry, 8000 boards | `denial_hi` | 64,000 | `-0.006703125` | 2411 | 2840 | 5,251 | `[-0.0089217, -0.0044846]` | `[-0.0089983, -0.0044080]` | clustered | equivalent |

The clustered interval was the wider of the two on every row and was the one selected, per `simulator/crates/cli/src/evaluate.rs::try_paired_stats`. No comparison was clustered-degenerate, over 2,000 and 8,000 clusters.

Per-hero-seat tables, from Task 1's `perHeroSeat` block. Hero seat equals draft slot, because `game.rs::setup_order` runs `0..seats` then reversed. Record only: there is no per-slot verdict and the pooled rows above are the verdict. Percentage points, selected intervals, clustered on every row. `Positions` is the number of intervening picks the credit sums over at that slot, which is `Lookahead::new`'s `first + 1..last` range.

| Run | Arm | Slot | Positions | Estimate | Interval | b | c | Discordant |
| --- | --- | ---: | ---: | ---: | --- | ---: | ---: | ---: |
| screen | `denial_lo` | 0 | 6 | -0.73 | `[-1.67, +0.22]` | 164 | 193 | 357 |
| screen | `denial_lo` | 1 | 4 | -0.20 | `[-1.06, +0.66]` | 137 | 145 | 282 |
| screen | `denial_lo` | 2 | 2 | +0.20 | `[-0.29, +0.69]` | 55 | 47 | 102 |
| screen | `denial_lo` | 3 | 0 | 0.00 | `[0.00, 0.00]` | 0 | 0 | 0 |
| screen | `denial_hi` | 0 | 6 | **-1.90** | `[-3.03, -0.77]` | 225 | 301 | 526 |
| screen | `denial_hi` | 1 | 4 | -1.33 | `[-2.48, -0.17]` | 233 | 286 | 519 |
| screen | `denial_hi` | 2 | 2 | -0.50 | `[-1.35, +0.35]` | 128 | 148 | 276 |
| screen | `denial_hi` | 3 | 0 | 0.00 | `[0.00, 0.00]` | 0 | 0 | 0 |
| retry | `denial_lo` | 0 | 6 | -0.33 | `[-0.80, +0.14]` | 665 | 718 | 1,383 |
| retry | `denial_lo` | 1 | 4 | -0.39 | `[-0.82, +0.03]` | 522 | 585 | 1,107 |
| retry | `denial_lo` | 2 | 2 | +0.21 | `[-0.06, +0.47]` | 242 | 209 | 451 |
| retry | `denial_lo` | 3 | 0 | 0.00 | `[0.00, 0.00]` | 0 | 0 | 0 |
| retry | `denial_hi` | 0 | 6 | -1.19 | `[-1.75, -0.63]` | 905 | 1096 | 2,001 |
| retry | `denial_hi` | 1 | 4 | **-1.36** | `[-1.94, -0.78]` | 933 | 1151 | 2,084 |
| retry | `denial_hi` | 2 | 2 | -0.13 | `[-0.56, +0.31]` | 573 | 593 | 1,166 |
| retry | `denial_hi` | 3 | 0 | 0.00 | `[0.00, 0.00]` | 0 | 0 | 0 |

**The reading: denial is mispriced at both values, and the mispricing gets monotonically worse with the price.** Win rate falls with the weight without exception, `0.265109` at 0 to `0.263813` at 0.25 to `0.258406` at 1.0 on the retry, and both pooled estimates are negative in both runs. Quadrupling the weight multiplies the harm by 5.2, from `-0.1297pp` to `-0.6703pp`, so the damage is at worst mildly superlinear in the price. **The conversion rate is where the term convicts itself.** Among discordant units the arm wins 48.6% at 0.25 and 45.9% at 1.0 on the retry, 48.0% and 44.4% on the screen, so the credit loses the picks it changes at both values and loses more of them the more it pays. That is the signature of a term whose direction is wrong rather than one whose scale is wrong: a correctly directed term priced too high converts above half on the picks it barely moves and below half on the ones it moves hardest, and this one is under half everywhere it acts.

**The externality argument the preregistration used to set the two values survives, and the run bounds the axis from above without a sweep.** `denial_hi` at 1.0 prices a rival's loss as if it were the hero's own gain, and it reads `equivalent` on the retry at `-0.6703pp` with a clustered interval of `[-0.90pp, -0.44pp]` sitting entirely inside the `+/-1pp` threshold. So the zero-sum error costs about two thirds of a point and no more, which is the outcome the prereg named as making the arm worth running. `denial_lo` at 0.25, just under the `1/3` break-even the externality argument implies, reads `-0.1297pp` on `[-0.30pp, +0.04pp]`: an interval that is almost entirely below zero and whose upper bound barely clears it. **The break-even price is therefore not 0.25 and is not above it either; the axis has no positive region these two values bracket.** Nothing between 0 and 1.0 is worth a sweep on this evidence.

**The per-slot pattern is the term's own shape and not a slot effect.** The credit sums over intervening positions rather than distinct rivals, so at four seats it charges six positions at slot 0, four at slot 1, two at slot 2 and none at slot 3, and the same weight therefore buys a systematically larger nudge the earlier the hero picks. The harm tracks that window on both arms: at `denial_hi` on the retry, `-1.19pp` and `-1.36pp` at the six and four position slots against `-0.13pp` at two positions, on intervals that separate slot 2 from both. Slot 2 on `denial_lo` is the only positive point estimate in either run at `+0.21pp`, and its interval `[-0.06pp, +0.47pp]` touches zero, so it is not evidence of benefit; the honest statement is that the smallest effective dose is the least harmful and is indistinguishable from no dose at all. **This is not evidence about slot conditioning in the SP4 sense and must not be cited as such**, because an un-normalized sum makes the effective price a function of the slot; a normalized variant of the term is a different instrument this run did not measure.

**Sparsity behaved as designed and the activity numbers are stable across the fourfold change.** `denial_gain` is exactly 0 on any candidate that is not an intervening rival's argmax, so the credit is a bonus on at most one vertex per intervening position and zero elsewhere. Discordance came in at 4.6% of units on `denial_lo` and 8.3% on `denial_hi` at screen power, and 4.6% and 8.2% at retry power, against the draft kind's own 17.7% against greedy in M-59. So the term reorders the top of a candidate list a quarter to a half as often as changing the objective did. **Quadrupling the weight did not quadruple the discordance**: the ratio between the two arms is 1.78 on the screen and 1.79 on the retry, near the square root of the weight ratio rather than the linear triple the prediction assumed. The credited vertices are the rivals' argmaxes under the same weights file the hero scores with, so they overlap the hero's own strong candidates and most of the credit reinforces a leader it was never going to displace; raising the price mostly enlarges the credit on vertices that were already winning.

**On the dilution the preregistration declared in advance.** Slot 3's 16,000 of 64,000 units are concordant by construction, so the pooled row is the mean of four slot estimates one of which is exactly 0. **The `+/-1pp` threshold was applied to the pooled row with no dilution correction, as preregistered.** For the record and changing nothing: the three-slot mean is `-0.89pp` for `denial_hi` and `-0.17pp` for `denial_lo` on the retry, both still inside the threshold, so the undiluted figures give the same two verdicts.

**Prediction against outcome, and this is the first entry in the plan where the activity prediction was right.** **Right on `denial_hi`'s estimate**, predicted between `-1.2pp` and `+0.2pp` and delivered `-0.93pp` on the screen and `-0.67pp` on the retry, and **right on its verdict path**, predicted most likely `inconclusive` or `equivalent` and delivered exactly that sequence. **Right on `denial_hi`'s discordant count**, predicted 1,200 to 3,200 of 16,000 and delivered 1,321. **Right on `denial_lo`'s discordant count**, predicted 400 to 1,400 and delivered 741. **Right on both interval widths**, predicted near `+/-0.35pp` for `lo` and nearer `+/-0.5pp` for `hi` at screen power, delivered `+/-0.35pp` and `+/-0.46pp`. **Marginally wrong on `denial_lo`'s estimate**, predicted between `-0.1pp` and `+0.6pp` and delivered `-0.18pp` and `-0.13pp`, missing the lower edge by under a tenth of a point, and its verdict landed on the predicted alternative rather than the predicted mode. **Wrong on the scaling between the arms**, predicted roughly triple and delivered 1.79. **Right on slot 3 being exactly zero**, which was a structural claim rather than an estimate. **Roughly right on the slot ordering**, predicting magnitudes falling from slot 0 to slot 2 and delivering that on the screen for both arms, while the retry put slot 1 marginally ahead of slot 0 on both arms on heavily overlapping intervals; slot 2 is clearly last in every case. **None of the three named mind-changers fired.** `denial_hi` did not read `better`, so the externality argument stands and the axis does not go to SP6 unbracketed. `denial_lo`'s negative reading is under two tenths of a point, short of the "larger than a few tenths" that would have said the credit is harmful at any price, though the sign and the sub-coin-flip conversion point that way and the honest summary is that the mind-changer missed by a margin the run cannot call. Slot 3 was not discordant on either arm, so the run is admissible.

**Disposition, per the preregistered rules applied without discretion.** `denial_lo` read **`equivalent`** at screen power on `[-0.53pp, +0.17pp]`, and the plan's standing rule is that `equivalent` at declared power drops the term and records the null as the answer. **0.25 is dropped and does not survive to SP6.** The retry carried the arm along because the preregistered invocation carries both arms against one reference; it read `equivalent` again at four times the precision, `[-0.30pp, +0.04pp]`, which corroborates the screen disposition and changes nothing about it. `denial_hi` carried a preregistered null of `equivalent` or `worse` against the `+/-1pp` threshold. It read **`inconclusive`** on the screen, which the preregistration says confirms nothing and buys the single retry, and **`equivalent`** on the retry. **The preregistered null holds and is confirmed.** The estimate moved toward zero between the runs, from `-0.93pp` to `-0.67pp`, while the half-width fell from `+/-0.46pp` to `+/-0.23pp`, so the added power resolved the reading into the null rather than into `worse`; that is the mirror image of M-59, where the estimate held still and the interval narrowed into `better`. **1.0 is dropped and does not survive to SP6.** No arm read `better`, so no denial value is a survivor and the SP6 survivor list is unchanged by this entry.

Record only in every respect. No shipped default moved, in `src/engine/weights.ts`, `simulator/placement/default-weights.json`, `simulator/placement/phase-i-candidate-weights.json` or anywhere else; `setupDenialWeight` stays at 0 in every shipped vector and `simulator/placement/arms/sp5_denial_lo.json` and `sp5_denial_hi.json` remain the only committed files carrying a nonzero value. The term stays in both `EngineWeights` at 0 exactly as Task 23 built it, inert, and the code is not reverted on this reading. The field's placement stays the app-formula spec over `simulator/placement/default-weights.json`. **No entry in `.claude/specs/simulator/gaps.md` moves.** `SIM-GAP-20` closed on M-59 and is already gone; `SIM-GAP-34` does not move, because a term left at 0 closes nothing.

**Scope, and what this entry may not be cited for.** Two contrasts on one axis, one kind, one seat count, one layout, one policy. The reference is the draft kind rather than the shipped greedy placement, so every number here is the credit alone and none of them is comparable to M-59's `+1.65pp`, which measured a different contrast. The opponent path is pinned to the field's weights in all three specs, which makes the opponent model correctly specified by construction, so this measures denial against a field the lookahead predicts exactly and may not be cited as what denial is worth against a field that plays differently. The hero denies alone against three seats that never deny; the externality argument that set the two arm values assumes exactly that, and a field where every seat paid to deny is a different question with a different answer. The credit is un-normalized over the intervening window, so **this entry is evidence about the term Task 23 built and not about setup denial in general**; a per-position normalized credit, or one that charged distinct rivals rather than positions, would price slot 0 and slot 2 alike and is untested. Nothing here says anything about `extension6`, about 3, 5 and 6 seat games, or about denial outside setup. The per-hero-seat table is record-only and carries no verdict, and the slot 0 against slot 1 ordering rests on overlapping intervals and should not be read as an ordering; what the table does establish on separated intervals is slot 2 below slots 0 and 1 on `denial_hi`.

## M-61: greedy lookahead accuracy against the draft-aware field

2026-09-02, commit `d64b4163` (the preregistration commit; the statistic itself landed earlier in this run at `1ac61f11` and no shipped default moved), domain `tuning2` (seed `8796197394747623682`). Preregistered in `docs/plans/preregs/2026-09-02-m61-lookahead-accuracy.md` (committed before the run). How well does the draft-aware kind's opponent model predict the field it is about to become?

`simulator/crates/engine/src/placement/draft.rs::Lookahead::replay` prices a first settlement by placing it and letting every seat that picks before the hero's second settlement take its own argmax under the opponent weights, both rounds, single pick at a time. Against a greedy field that replay is the field, which `simulator/crates/cli/tests/draft_lookahead.rs::the_lookahead_predicts_the_picks_the_field_actually_made` pins. Against a field where every seat is itself draft-aware it is an approximation, and this entry is the number for how good an approximation, taken on games the field actually played. The statistic is `simulator/crates/cli/src/lookahead.rs`, reported in the `lookahead` block of `diagnostics.json`: for each recorded first settlement it re-runs the lookahead from the board as it stood immediately before that pick, with the vertex the seat actually took, and holds the plan against the trace. **This is a diagnostic, not an A/B**: no field, no arms, no reference and no hero-seat rotation, so it carries no verdict, the disposition rule does not apply to it, and SP6's 0.5pp practical bar governs the paired verdicts of the A/B runs and not this one. Nothing here adopts anything and no shipped default moved in either direction.

Two invocations, one code path, the control first. Both are `diagnose`, `standard4`, 4 seats, `--domain tuning2`, 2000 boards x 2 reps, every seat on `heuristic-v1-trader-aware-threat-devcards-denial` with `--player-trading`, `--alpha 0.05`, `--threads 0`. The release binary was built in its own command block first and reported `Finished` against a warm fingerprint.

```text
target/release/unsettled-sim diagnose --layout standard4 --seats 4 --domain tuning2 --placement app_formula:placement/default-weights.json --boards 2000 --reps 2 --policy heuristic-v1-trader-aware-threat-devcards-denial --player-trading --alpha 0.05 --threads 0 --out runs/m61-lookahead-control
```

```text
target/release/unsettled-sim diagnose --layout standard4 --seats 4 --domain tuning2 --placement app_formula_draft:placement/default-weights.json@placement/default-weights.json --boards 2000 --reps 2 --policy heuristic-v1-trader-aware-threat-devcards-denial --player-trading --alpha 0.05 --threads 0 --out runs/m61-lookahead-draft
```

Control load before `2.37 3.02 3.80`, after `2.42 3.02 3.79`, 1.220s wall at 18 workers. Reading load before `2.31 2.98 3.78`, after `2.31 2.98 3.78`, 1.452s wall. Both invocations ran alone, one after the other, neither shared a command block with the build or a suite, and neither was piped. 4000 games each, all decided, no draws, 32,000 setup picks, **zero illegal actions** in both. **Admissible on every registered condition:** both report domain `tuning2` at seed `8796197394747623682`; both report the registered structural counts, `firstPicks` 16,000, `predictingFirstPicks` 12,000 and `interveningPicks` 48,000, identically; and the draft-aware run's slot 3 `secondShare` reads exactly `1.0`, which was the in-run exactness check. Both timings beat their predictions (control under 2 seconds, reading under 5 seconds) and neither came near the 60-second recording trigger.

Control, every seat on the greedy app-formula spec over the shipped weights file, which the artifact registers as `app_formula:default-weights` and the command block above spells in full. Slot 3 has no intervening pick, so its `pickShare` and `sequenceShare` read 0 by the zero-denominator convention rather than because the model failed.

| Slot | First picks | Intervening | Matched | `pickShare` | Exact sequences | `sequenceShare` | Second matches | `secondShare` |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| overall | 16000 | 48000 | 47090 | `0.9810417` | 11435 | `0.9529167` | 15669 | `0.9793125` |
| 0 | 4000 | 24000 | 23440 | `0.9766667` | 3704 | `0.9260000` | 3880 | `0.9700000` |
| 1 | 4000 | 16000 | 15736 | `0.9835000` | 3810 | `0.9525000` | 3895 | `0.9737500` |
| 2 | 4000 | 8000 | 7914 | `0.9892500` | 3921 | `0.9802500` | 3929 | `0.9822500` |
| 3 | 4000 | 0 | 0 | `0.0000000` | 0 | `0.0000000` | 3965 | `0.9912500` |

Reading, every seat on the draft-aware kind carrying that same file on both its hero and its opponent path, registered as `app_formula_draft:default-weights@default-weights`.

| Slot | First picks | Intervening | Matched | `pickShare` | Exact sequences | `sequenceShare` | Second matches | `secondShare` |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| overall | 16000 | 48000 | 18920 | `0.3941667` | 2826 | `0.2355000` | 12832 | `0.8020000` |
| 0 | 4000 | 24000 | 9040 | `0.3766667` | 460 | `0.1150000` | 2610 | `0.6525000` |
| 1 | 4000 | 16000 | 6524 | `0.4077500` | 824 | `0.2060000` | 2952 | `0.7380000` |
| 2 | 4000 | 8000 | 3356 | `0.4195000` | 1542 | `0.3855000` | 3270 | `0.8175000` |
| 3 | 4000 | 0 | 0 | `0.0000000` | 0 | `0.0000000` | 4000 | `1.0000000` |

**The control's shortfall is 1.9pp and it is pure tie noise, which is a floor rather than a baseline.** The preregistration fixed before the numbers existed that the two shortfalls have different sources and may not be netted, and that holds: on a greedy field the replay is the field at the same weights with the same grant rule, so the only thing that can separate them is `placement/mod.rs::choose_app_formula` breaking a settlement tie from the picking seat's policy stream where `draft.rs::best_legal` takes the lowest vertex index. The cleanest sizing of that is the control's slot 3 `secondShare`, one pick with no propagation behind it, at `0.9912500`, so ties disagree on about **0.875% of picks**. Propagating that rate forward predicts `pickShare` of 0.9698, 0.9783 and 0.9869 at slots 0, 1 and 2 against the measured 0.9767, 0.9835 and 0.9893, so the observed decay with depth is slightly gentler than full propagation, which is what happens when a tie-broken difference at one vertex leaves the next seat's argmax unchanged. The reading has no tie noise at all, since the draft kind draws nothing from the policy stream during setup, so the reading's floor is 1 rather than 0.981.

**The reading: the model names 39.4% of intervening picks and reaches the board the game actually reached on 23.6% of first picks.** That is below the predicted `pickShare` band of 0.45 to 0.70, and 4.4pp above the 0.35 line the preregistration named as the reading that would be flagged as a limitation on every later SP6 entry. **That named reading did not fire**, and neither did the other one, since 0.394 is nowhere near the control's 0.981. It came close enough to the 0.35 line to say so plainly: the greedy opponent model is a substantially worse predictor of a draft-aware field than the prediction allowed, and the prediction's reasoning, that M-59's low discordance implies a high per-pick agreement rate, was the wrong inference from that entry.

**Per slot the reading is monotone as predicted, and the structure says why.** `pickShare` runs 0.3767, 0.4078, 0.4195 at slots 0, 1 and 2, ordered by how many first-round picks the replay has to stand a greedy argmax in for: three at slot 0, two at slot 1, one at slot 2. `sequenceShare` falls much faster, 0.1150, 0.2060, 0.3855, because a sequence is exact only if every position in it is, and slot 0 has six positions to get right against slot 2's two. Every slot satisfies the registered arithmetic condition that `sequenceShare` cannot exceed `pickShare`.

**Decomposing by predicted seat, which the shares support and which is arithmetic rather than measurement.** Write `a_k` for the rate at which a greedy argmax names the first-round pick that seat `k` actually made. Seat 3 is bounded by counting alone, with no model: slot 2's intervening span is seat 3's two picks, and of its 4,000 first picks 1,542 matched both, 272 matched exactly one and 2,186 matched neither, so `a_3` lies in **[0.3855, 0.4535]**. Assuming a mispredicted pick derails everything after it, which the control shows is a slight overstatement, slot 1's `pickShare` gives `a_2` near **0.69 to 0.76** and slot 0's gives `a_1` near **0.77**, stable across the whole `a_3` range. So the model predicts seats 1 and 2 about three times in four and seat 3 about two times in five, and **seat 3 is the outlier by a wide margin**.

**Seat 3 is the outlier for a structural reason the replay has no branch for, and it is the same fact M-59 found from the other side.** At 4 seats the setup order is 0, 1, 2, 3, 3, 2, 1, 0, so seat 3 picks twice in a row: its `Lookahead::intervening` range is empty, and its draft-aware first pick maximizes `marginal(c)` plus the best second site left after `c`, a pair objective. The replay predicts it with `best_legal` on a single-pick argmax row, the same call it uses for every other intervening seat, so it is predicting a pair optimizer with a single-site rule. M-59 recorded slot 3 as the most discordant slot against a greedy field, 3,002 discordant units against slot 0's 2,574, and read that as pair optimization changing the most picks; this run sees the identical fact as the seat the model predicts worst. Giving the replay the pair objective for the last first-round seat would need no recursion, since that seat's own lookahead has nothing to replay, but it is not in SP6's scope and nothing here is changed by it.

**What the approximation costs.** The hero's first settlement is priced against a projected board that differs from the real one on **76.4% of first picks**, and at slot 0, where the replay has six positions to get right, on 88.5% of them. Every candidate's value carries the best second site surviving a rival sequence that mostly did not happen, so the ranking the kind produces at the first pick is a ranking under a wrong forecast rather than under the exact one M-59 measured. That is the honest limit on citing M-59 forward: M-59 was taken against a field the model predicts at 98.1%, the tie floor, and this field is predicted at 39.4%, so **M-59's `+1.65pp` may not be read as what the kind is worth on the SP6 field**, and no later SP6 entry may describe the opponent model as correctly specified.

**What it does not cost, and this is the larger half of the reading.** The plan's conclusion survives its premises far better than the premises do. `secondShare` reads **0.8020** overall against a `pickShare` of 0.3942: the site the lookahead planned for the hero is where the hero actually ended up four times in five, while the rival picks it predicted on the way there were right two times in five. Slot 0, the worst-predicted slot, still plans the hero's second settlement correctly 65.3% of the time. The reason is that the lookahead's job is to rank the hero's candidates, not to forecast the draft, and most rival mispredictions take a vertex the hero was never going to reach or leave the hero's best surviving site unchanged. The approximation is therefore wrong about the draft and much less wrong about the thing it is used for, which is why a 39.4% pick accuracy does not license predicting that the kind is worthless on this field. What the kind is worth on this field is not measured by this run and is not measured anywhere: no SP6 A/B contrasts the draft kind against greedy, because the draft kind is the field for all of them.

**Prediction against outcome.** **Wrong on the control, in the safe direction**, predicted `pickShare` between 0.75 and 0.92 and delivered 0.9810, because the tie rate was modelled at 5 to 10% per pick and measures 0.875%; the slot 3 `secondShare` prediction of 0.90 to 0.99 delivered 0.99125, a hair above its top. **Right on the control's internal ordering**, `sequenceShare` below `pickShare` with `secondShare` between them, 0.9529 below 0.9793 below 0.9810. **Wrong on the reading's `pickShare`**, predicted 0.45 to 0.70 and delivered 0.3942, below the band. **Right on `sequenceShare`**, predicted 0.20 to 0.45 and delivered 0.2355. **Right on `secondShare` to within two thousandths**, predicted 0.55 to 0.80 and delivered 0.8020, and right on the stated reason, that slot 3 reading exactly 1.0 pulls it up. **Right on the per-slot ordering being monotone with slot 2 highest and slot 0 lowest**, and right on the mechanism, the count of first-round picks the replay has to stand in for. **Neither named mind-changer fired.** The error worth carrying forward is the one behind the `a` estimate: M-59's 17.7% discordant share was read as evidence that greedy and the lookahead pick alike most of the time, and it is not, because a per-game discordance rate on a field with three greedy seats and one draft seat is a different quantity from a per-pick agreement rate on a field with four draft seats, and the second is far lower than the first suggested.

**Scope, and what this entry may not be cited for.** One layout, one seat count, one weights vector on both the hero and the opponent path, one policy. The per-seat decomposition beyond seat 3's bounds is arithmetic under a stated propagation assumption and is not a measured quantity; nothing in the artifact separates the positions directly. The two invocations may not be netted against each other, by preregistration. The entry says how accurately the model predicts the field and says nothing about what that inaccuracy is worth in win rate, in either direction: no arm here, no verdict, no interval. It does not extend to `extension6`, to 3, 5 and 6 seat games, or to a field carrying a different weights vector on its opponent path, and the SP6 re-screens change the hero's weights while pinning the opponent path to the field's, so this reading describes their field rather than their arms.

## M-62: SP6 re-screen against the draft-aware field

2026-09-03, commit `29d0748d` (the preregistration commit; no code and no default moved for this run), domain `tuning2` (seed `8796197394747623682`). Preregistered in `docs/plans/preregs/2026-09-03-m62-sp6-rescreen.md` (committed before the run). Six contrasts across four candidate axes, each re-read against the programme's new reference field: which of them is still worth carrying now that every seat drafts with a lookahead?

The four axes are the ones the `## SP6 decisions, 2026-09-02` note in `.claude/specs/simulator/placement-programme.md` carries into SP6: `expansionWeight` at 0.1 and 0.3, `expansionDecay` at 0.25 and 1.0 beside the surviving weight, `robberConcentrationWeight` at 4.0 and `diversityWeight` at 4.8. Every prior they hold was taken on the greedy app-formula field, `expansionWeight` in M-54, `robberConcentrationWeight` in M-57 and `diversityWeight` in M-39 and M-40, and the `## The reference field is the draft-aware kind, 2026-09-02` note moved the field to `app_formula_draft:default-weights@default-weights` on all four seats. The preregistration sets out four separate mechanisms by which that move can change these readings: the board an arm is scored on, the hero being a different instrument whose first pick already values its best surviving second site, a reference that M-59 measured at `+1.6484pp` over the old one, and a tie rate that falls from about 0.875% of picks to nothing because `draft.rs` breaks ties deterministically. None of the four old numbers is cited here as if taken on this field.

Six committed arm files under `simulator/placement/arms/`, each the live `simulator/placement/default-weights.json` with only its declared keys moved, pinned by `simulator/crates/engine/src/policy/params_file.rs::the_sp6_arm_files_are_the_committed_rescreen_perturbations`. `sp6_expansion.json` moves `expansionWeight` 0 to 0.1; `sp6_expansion_hi.json` moves it 0 to 0.3; `sp6_decay_lo.json` and `sp6_decay_hi.json` move `expansionWeight` 0 to 0.1 and `expansionDecay` 0.5 to 0.25 and 1.0 respectively, two keys on purpose because at `expansionWeight` 0 the decay multiplies nothing; `sp6_concentration.json` moves `robberConcentrationWeight` 0 to 4.0; `sp6_diversity.json` moves `diversityWeight` 1.6 to 4.8. Every value sits inside its committed `sweep-bounds.json` range.

`evaluate`, `standard4`, 4 seats, every seat on `heuristic-v1-trader-aware-threat-devcards-denial` with `--player-trading`, `--threads 0`, **`--threshold 0.005`**, `--alpha 0.05`, run from `simulator/`. Invocation A screened the four non-decay arms against `base`, the field spec itself, at 8000 boards x 2 reps (64,000 paired units over 8,000 clusters), SP6's screen power at the 0.5 bar. Three of its four arms read `inconclusive`, which bought the single preregistered retry at four times the boards and unchanged reps: 32000 boards x 2 reps, 256,000 paired units, carrying every arm in one invocation because the prereg fixes the retry as invocation A's command with `--boards` and `--out` changed and nothing else. Invocation B's condition was that `exp_lo` read `better` in invocation A, which it did, so the decay pair ran against reference `exp_ref`, the same `sp6_expansion.json` the decay arms carry, at screen power. Both decay arms read `equivalent`, so invocation B bought no retry.

```text
RUSTFLAGS="-D warnings" cargo build --release --manifest-path simulator/Cargo.toml -p unsettled-sim

# timing pilot, from simulator/, wall time only, estimates and verdicts not read
target/release/unsettled-sim evaluate --layout standard4 --seats 4 --domain tuning2 --field app_formula_draft:placement/default-weights.json@placement/default-weights.json --arm base=app_formula_draft:placement/default-weights.json@placement/default-weights.json --arm exp_lo=app_formula_draft:placement/arms/sp6_expansion.json@placement/default-weights.json --arm exp_hi=app_formula_draft:placement/arms/sp6_expansion_hi.json@placement/default-weights.json --arm conc=app_formula_draft:placement/arms/sp6_concentration.json@placement/default-weights.json --arm div=app_formula_draft:placement/arms/sp6_diversity.json@placement/default-weights.json --reference base --boards 200 --reps 2 --policy heuristic-v1-trader-aware-threat-devcards-denial --threads 0 --player-trading --threshold 0.005 --alpha 0.05 --out runs/m62-sp6-rescreen-pilot

# invocation A, the screen, from simulator/
target/release/unsettled-sim evaluate --layout standard4 --seats 4 --domain tuning2 --field app_formula_draft:placement/default-weights.json@placement/default-weights.json --arm base=app_formula_draft:placement/default-weights.json@placement/default-weights.json --arm exp_lo=app_formula_draft:placement/arms/sp6_expansion.json@placement/default-weights.json --arm exp_hi=app_formula_draft:placement/arms/sp6_expansion_hi.json@placement/default-weights.json --arm conc=app_formula_draft:placement/arms/sp6_concentration.json@placement/default-weights.json --arm div=app_formula_draft:placement/arms/sp6_diversity.json@placement/default-weights.json --reference base --boards 8000 --reps 2 --policy heuristic-v1-trader-aware-threat-devcards-denial --threads 0 --player-trading --threshold 0.005 --alpha 0.05 --out runs/m62-sp6-rescreen

# the preregistered retry, from simulator/, identical but for --boards and --out
target/release/unsettled-sim evaluate --layout standard4 --seats 4 --domain tuning2 --field app_formula_draft:placement/default-weights.json@placement/default-weights.json --arm base=app_formula_draft:placement/default-weights.json@placement/default-weights.json --arm exp_lo=app_formula_draft:placement/arms/sp6_expansion.json@placement/default-weights.json --arm exp_hi=app_formula_draft:placement/arms/sp6_expansion_hi.json@placement/default-weights.json --arm conc=app_formula_draft:placement/arms/sp6_concentration.json@placement/default-weights.json --arm div=app_formula_draft:placement/arms/sp6_diversity.json@placement/default-weights.json --reference base --boards 32000 --reps 2 --policy heuristic-v1-trader-aware-threat-devcards-denial --threads 0 --player-trading --threshold 0.005 --alpha 0.05 --out runs/m62-sp6-rescreen-retry

# invocation B, the decay pair against the surviving expansion weight, from simulator/
target/release/unsettled-sim evaluate --layout standard4 --seats 4 --domain tuning2 --field app_formula_draft:placement/default-weights.json@placement/default-weights.json --arm exp_ref=app_formula_draft:placement/arms/sp6_expansion.json@placement/default-weights.json --arm decay_lo=app_formula_draft:placement/arms/sp6_decay_lo.json@placement/default-weights.json --arm decay_hi=app_formula_draft:placement/arms/sp6_decay_hi.json@placement/default-weights.json --reference exp_ref --boards 8000 --reps 2 --policy heuristic-v1-trader-aware-threat-devcards-denial --threads 0 --player-trading --threshold 0.005 --alpha 0.05 --out runs/m62-sp6-rescreen-decay
```

**Provenance and admissibility.** The release binary was built with `RUSTFLAGS="-D warnings"` in its own command block before any measurement started and reported `Finished` in 0.06s against a warm fingerprint, so no compile landed inside a timed window, and all four invocations reused that same binary. No invocation shared its command block with a build, a test suite or any other CPU-heavy job, none was piped through `tail` or `head`, and they ran one after another rather than in parallel. `rustc 1.94.0 (4a4ef493e 2026-03-02)`, `simulatorVersion` 0.1.0. Every invocation reported domain `tuning2` at seed `8796197394747623682`, the domain Task 2 of `docs/plans/completed/simulator-placement-sp6.md` minted; no invocation carried `tuning`, `eval` or `gate`, and `eval2` and `gate2` are untouched by this run. **Zero illegal actions in all four invocations** and zero draws in every arm of all four. `simulator/runs/` is gitignored, so no artifact entered the tree and this entry is the record.

Pilot: load before `2.32 4.74 4.46`, after `4.38 5.13 4.60`; 3.393s wall for 8,000 games. Multiplied by 40 that puts invocation A at about 136 seconds, comfortably inside the eight-minute bar, so invocation A ran in the foreground. **The pilot's estimates and verdicts were not read, not recorded and are not cited**, here or anywhere, per the preregistration.

Invocation A: load before `4.12 5.04 4.58`, after `19.62 10.75 6.92`; 128.586s at 18 workers, 2,488.6 games/s, **320,000 games, zero illegal actions**. `base` won 16,000 of 64,000, a win rate of exactly `0.25`.

Retry: load before `7.58 8.96 6.56`, after `25.42 20.53 13.77`; 496.140s at 18 workers, 2,579.9 games/s, **1,280,000 games, zero illegal actions**. `base` won 64,080 of 256,000 (`0.2503125`). Four times invocation A's games extrapolated to 514 seconds, over the eight-minute bar, so per the plan's long-run rule the retry was launched in the background and polled by a loop printing the elapsed minute; it finished in the ninth minute. The load before this invocation is higher than the programme's usual figure because it is invocation A's own one-minute average still decaying, not another job: the five-minute and fifteen-minute figures were still climbing toward it and the machine had no other work on it.

Invocation B: the launcher waited for the one-minute load to fall back under 5.0 before starting, which took 60 seconds after the retry; load before `4.34 13.85 12.10`, after `21.43 17.26 13.70`; 129.134s at 18 workers, 1,486.8 games/s, **192,000 games, zero illegal actions**. `exp_ref` won 16,569 of 64,000 (`0.258890625`).

**The three admissibility checks the preregistration fixed all pass.** `base` sits at the symmetric 0.25 corner in both invocation A and the retry, exactly on it in A and 3 units of a thousand above it in the retry, which is the drift check as well: `base` carries the field spec, so an unintended touch of the shipped path would show there first and none did. Invocation B's reference is `exp_ref` rather than `base` and sits at no symmetric corner, so what is checked instead is that its win rate reproduces invocation A's `exp_lo`, the same spec on the same domain and board schedule: both read **16,569 wins of 64,000**, equal to the game, so the schedule did not move. As the preregistration required, invocation A's `base` is not compared with any earlier entry's reference figure, because both the field and the domain moved; this run establishes the first four-seat draft-aware `base` win rate on `tuning2` and later SP6 entries reproduce it rather than the other way round.

**Throughput, and what it says about the cache.** Invocation A ran at 2,488.6 games/s against M-61's 2,755 games/s for four-seat draft games without arms, and invocation B at 1,486.8 games/s, four tenths slower again. That ordering is the one the preregistration predicted from `draft.rs::Lookahead::new`, which turns the `ScoreRows` cache off whenever either scorer carries a nonzero `expansionWeight`: invocation A has two such arms of five, invocation B has three of three. Treating per-arm cost as additive, which is arithmetic on the two wall times rather than a measurement, a nonzero-`expansionWeight` arm costs about **three times** a zero one per game, 6.73e-4s against 2.21e-4s at 18 workers. The retry's 496.1s came in under the 514s its own extrapolation predicted.

Pooled paired table, invocation A and its retry, reference `base`. Live default on each axis in the third column.

| Run | Arm | Live to arm | Estimate | b | c | Selected interval | Verdict |
| --- | --- | --- | ---: | ---: | ---: | --- | --- |
| screen, 8000 boards | exp_lo | `expansionWeight` 0 to 0.1 | `0.008890625` | 6828 | 6259 | clustered `[0.0053855, 0.0123958]` | **better** |
| screen, 8000 boards | exp_hi | `expansionWeight` 0 to 0.3 | `0.006015625` | 7982 | 7597 | clustered `[0.0021322, 0.0098991]` | inconclusive |
| screen, 8000 boards | conc | `robberConcentrationWeight` 0 to 4.0 | `0.00534375` | 1644 | 1302 | clustered `[0.0036625, 0.0070250]` | inconclusive |
| screen, 8000 boards | div | `diversityWeight` 1.6 to 4.8 | `0.00375` | 5242 | 5002 | clustered `[0.0005594, 0.0069406]` | inconclusive |
| retry, 32000 boards | exp_lo | `expansionWeight` 0 to 0.1 | `0.00844921875` | 27302 | 25139 | clustered `[0.0066792, 0.0102192]` | **better** |
| retry, 32000 boards | exp_hi | `expansionWeight` 0 to 0.3 | `0.00351953125` | 31542 | 30641 | clustered `[0.0015754, 0.0054637]` | inconclusive |
| retry, 32000 boards | conc | `robberConcentrationWeight` 0 to 4.0 | `0.00445703125` | 6631 | 5490 | clustered `[0.0035979, 0.0053162]` | inconclusive |
| retry, 32000 boards | div | `diversityWeight` 1.6 to 4.8 | `0.003015625` | 20997 | 20225 | clustered `[0.0014207, 0.0046106]` | equivalent |

The clustered interval was the wider of the two and was the one selected in every pooled row, per `evaluate.rs::try_paired_stats`. No comparison was clustered-degenerate. **`exp_lo`'s retry row is record-only for disposition**: the screen already read it `better` and fixed its disposition there, and it appears in the retry only because the preregistered retry command is invocation A's with `--boards` and `--out` changed and nothing else. It read `better` again, so the two readings agree.

Pooled paired table, invocation B, reference `exp_ref` = `sp6_expansion.json`, which both arms match on `expansionWeight` so the contrast is the decay alone.

| Run | Arm | Live to arm | Estimate | b | c | Selected interval | Verdict |
| --- | --- | --- | ---: | ---: | ---: | --- | --- |
| decay, 8000 boards | decay_lo | `expansionDecay` 0.5 to 0.25 | `0.001125` | 899 | 827 | clustered `[-0.0001856, 0.0024356]` | equivalent |
| decay, 8000 boards | decay_hi | `expansionDecay` 0.5 to 1.0 | `-0.0006875` | 3818 | 3862 | clustered `[-0.0034244, 0.0020494]` | equivalent |

Per-hero-seat table, from the `perHeroSeat` block. Hero seat equals draft slot, because `game.rs::setup_order` runs `0..seats` then reversed. Record only: there is no per-slot verdict and the pooled row is the verdict. Percentage points, clustered intervals except where noted.

| Run | Arm | Slot 0 | Slot 1 | Slot 2 | Slot 3 |
| --- | --- | ---: | ---: | ---: | ---: |
| screen | exp_lo | +0.75 `[+0.03, +1.47]` | **+1.36** `[+0.66, +2.06]` | +0.93 `[+0.24, +1.62]` | +0.51 `[-0.22, +1.24]` |
| screen | exp_hi | +0.66 `[-0.13, +1.46]` | **+0.94** `[+0.17, +1.72]` | +0.54 `[-0.23, +1.31]` | +0.26 `[-0.52, +1.03]` |
| screen | conc | +0.36 `[+0.09, +0.64]` | +0.59 `[+0.30, +0.88]` | +0.56 `[+0.26, +0.86]` (mcnemar) | **+0.63** `[+0.17, +1.08]` |
| screen | div | +0.29 `[-0.35, +0.93]` | **+0.57** `[-0.07, +1.21]` | +0.28 `[-0.35, +0.90]` | +0.37 `[-0.28, +1.01]` |
| retry | exp_lo | +1.04 `[+0.68, +1.40]` | **+1.18** `[+0.83, +1.53]` | +0.64 `[+0.29, +0.98]` | +0.52 `[+0.15, +0.89]` |
| retry | exp_hi | **+0.66** `[+0.27, +1.06]` | +0.53 `[+0.15, +0.92]` | +0.07 `[-0.32, +0.45]` | +0.15 `[-0.24, +0.53]` |
| retry | conc | +0.42 `[+0.28, +0.56]` | **+0.53** `[+0.39, +0.68]` | +0.48 `[+0.32, +0.63]` | +0.35 `[+0.12, +0.58]` |
| retry | div | **+0.55** `[+0.23, +0.88]` | +0.15 `[-0.16, +0.47]` | +0.14 `[-0.18, +0.45]` | +0.37 `[+0.04, +0.69]` |
| decay | decay_lo | **+0.31** `[+0.03, +0.58]` | -0.06 `[-0.32, +0.20]` | -0.04 `[-0.31, +0.22]` | +0.25 `[-0.00, +0.50]` |
| decay | decay_hi | -0.14 `[-0.68, +0.39]` | -0.18 `[-0.73, +0.37]` | **+0.06** `[-0.49, +0.61]` | -0.01 `[-0.58, +0.56]` |

Per-seat `n` sums to the pooled `n` and per-seat `b + c` sums to the pooled `b + c` in every row.

**The reading: one axis survives, and it is `expansionWeight` at 0.1.** It is the only arm of the six whose selected interval sits entirely above the `+0.5pp` bar, and it does so at both powers: `+0.889pp` on `[+0.539pp, +1.240pp]` over 13,087 discordant units of 64,000, then `+0.845pp` on `[+0.668pp, +1.022pp]` over 52,441 discordant units of 256,000. Every one of the ten estimates in the two pooled tables is positive except `decay_hi`, so the field change did not reverse any of these axes; it shrank three of them below the bar and left the fourth above it.

**`expansionWeight` shrank by about a quarter and kept its lead over the larger weight.** M-54 read 0.1 at `+1.13pp` on the greedy field and this run reads it at `+0.845pp`, a loss of roughly 0.29pp, which is the direction and roughly the size the preregistration predicted from redundancy: the draft kind's first pick already values the best second site surviving the intervening picks, so a term paying for what a candidate opens overlaps the objective it now rides on. Most of the term survives that overlap. The 0.1 against 0.3 ordering that M-54 called its clearest secondary finding holds on this field too and by a wider relative margin, `+0.845pp` against `+0.352pp` on the retry with barely overlapping intervals, and the discordant counts say the same thing they said in M-54: `exp_hi` moves 62,183 units against `exp_lo`'s 52,441 and converts a smaller share of them, so the larger weight overrides the production ranking on candidates where production was right. The named reading that `exp_hi` might come out clearly above `exp_lo`, which would have said the weight's right scale depends on the field, did not fire.

**The slot structure of the expansion term changed, and this is the one place a re-screen bought more than a number.** M-54 found the effect concentrated at slot 0, `+2.08pp` there against `+0.79`, `+0.59` and `+1.04` at the later slots, and SP4's slot profiles were designed off that shape. On this field `exp_lo` runs `+1.04`, `+1.18`, `+0.64`, `+0.52` across the slots on the retry, a mild slope with its peak at slot 1 rather than a spike at slot 0, and every slot interval excludes zero. The reading is that the first picker's advantage from an open fan is much smaller when the three seats behind it are drafting deliberately rather than taking single-pick argmaxes, because a deliberate field takes the open fans that a greedy field left standing. This is record-only and carries no verdict, but it is a direct caution against citing M-54's slot-0 concentration as a property of the term on the field the programme now runs.

**`diversityWeight` at 4.8 is the collapse of the run, and the preregistration predicted the opposite.** M-39 and M-40 read it at about `+1.3pp` on `[+0.95pp, +1.63pp]` at exactly this power, the strongest prior of the four and the only one whose old interval already sat entirely above the new bar. It reads `+0.302pp` on `[+0.142pp, +0.461pp]` here, `equivalent`, with more than three quarters of the effect gone. The preregistration argued explicitly that the redundancy mechanism would not touch this axis, since a pair's resource spread is priced the same way whoever picks next. That reasoning located the redundancy in the opponent replay, and the mechanism that actually bit is on the hero's own side: a draft-aware hero already chooses its first settlement for the pair it can complete, scoring each candidate by `marginalTotal` of the best surviving second site given the first, so the shipped `diversityWeight` of 1.6 is already being applied to a jointly chosen pair rather than to one settlement at a time. Tripling it adds emphasis to a spread the pair objective largely secures on its own. The estimate stayed positive at both powers and the interval never touched zero, so the term still helps a little; it is well under half the bar SP6 set.

**`robberConcentrationWeight` at 4.0 is the near miss the bar was moved for, and it missed anyway.** M-57 read it `+0.575pp` on `[+0.23pp, +0.92pp]`, `equivalent` at the old 1pp bar and the specific reading the SP6 decisions note cited when it moved the threshold to 0.5pp. It reads `+0.534pp` on the screen and `+0.446pp` on the retry, so the point estimate is stable across the field change and is the least-moved of the four, exactly as the preregistration predicted for an axis that is a property of the hero's own pair. What it did not do is clear the bar: the retry's interval `[+0.360pp, +0.532pp]` straddles `+0.5pp` by 3 hundredths of a point at the top and the verdict is `inconclusive` a second time. Four times the boards cut the half-width from `+/-0.168pp` to `+/-0.086pp`, half again tighter than the `+/-0.18pp` the preregistration budgeted, and the estimate simply sits below the bar rather than on it. **This is the cleanest illustration in the programme of what a practical threshold does**: the sign is settled beyond doubt on 12,121 discordant units, the axis helps, and it is dropped because it does not help by enough to be worth a parameter.

**`conc` moves very few games and wins a high share of the ones it moves.** Its discordant rate is 4.7% of units on the retry against 16.1% for `div`, 20.5% for `exp_lo` and 24.3% for `exp_hi`, so the concentration penalty changes the pick far less often than the other three and converts about 55% of the changes it does make. Its per-seat discordant counts are also lopsided, roughly 2,000 units at each of slots 0, 1 and 2 against 5,629 at slot 3. A plausible reading, and it is a reading rather than a measurement, is that slot 3 picks twice in a row and is the seat most able to assemble a pair concentrated on one number, so a term penalising concentration has the most to act on there; nothing in this artifact tests that.

**`expansionDecay` is null on this field in both directions.** `decay_lo` at 0.25 reads `+0.113pp` on `[-0.019pp, +0.244pp]` and `decay_hi` at 1.0 reads `-0.069pp` on `[-0.342pp, +0.205pp]`, both `equivalent`, both inside the `-0.4pp` to `+0.4pp` band the preregistration predicted, and `decay_lo` above `decay_hi` as predicted. The discordant counts separate them by more than the estimates do: 1,726 units for `decay_lo` against 7,680 for `decay_hi`, so pushing the discount toward 1.0 changes four and a half times as many picks as pulling it to 0.25 and gains nothing for it, which is what a term that already takes only the best two sites should do. The shipped 0.5 is not mis-set in either direction on the evidence here, and `expansionDecay` stays at 0.5 in every downstream SP6 vector. This is the first measurement the axis has ever had.

**Disposition, per the preregistered rule, per axis.**

`expansionWeight`: **survives at 0.1.** `exp_lo` read `better` on the screen, which fixed its disposition, and read `better` again on the retry. `exp_hi` at 0.3 read `inconclusive` twice and is recorded unresolved and dropped, and since the axis contributes at most one value the survivor is 0.1 regardless.

`expansionDecay`: **dropped, null recorded.** Both arms read `equivalent` at screen power, which is a resolved verdict and buys no retry. The axis keeps its shipped 0.5.

`robberConcentrationWeight`: **dropped, unresolved.** `inconclusive` on the screen bought the single retry at four times the boards, `inconclusive` again on the retry, so the rule records the axis unresolved and drops it from the package. Unresolved here means unresolved against the `+/-0.5pp` threshold alone; the sign is settled and positive.

`diversityWeight`: **dropped, null recorded.** `inconclusive` on the screen bought the retry, and the retry resolved it to `equivalent`, which the rule drops with the null recorded rather than as an unresolved item.

**Prediction against outcome.** **Right on `exp_lo`**, predicted `+0.3pp` to `+1.0pp` and most likely `better`, delivered `+0.845pp` and `better`. **Right on `exp_hi`**, predicted `0pp` to `+0.6pp` and most likely `equivalent` or `inconclusive`, delivered `+0.352pp` and `inconclusive`, and right that `exp_lo` would beat it again. **Right on `conc`**, predicted `+0.2pp` to `+0.8pp` and most likely `inconclusive` with the smallest shift from its old reading, delivered `+0.446pp`, `inconclusive`, and a shift of 0.13pp, the smallest of the four. **Right on both decay arms**, band, verdict and ordering. **Wrong on `div`**, and wrong in the way that mattered: predicted `+0.6pp` to `+1.5pp` and most likely `better`, delivered `+0.302pp` and `equivalent`, below the band and the weakest of the four rather than the strongest, and the argument given for why the redundancy mechanism would spare it was itself the error. **Wrong on the survivor count and its identity**, predicted two or three survivors and most likely `div` alone or `div` with one of `exp_lo` and `conc`, delivered exactly one survivor which is `exp_lo`. Neither of the two named readings fired: no arm read `worse`, and `exp_hi` did not come out above `exp_lo`.

**Scope, and what this entry may not be cited for.** Six contrasts across four axes, one layout, one seat count, one policy, one domain. Every arm moves the hero's weights alone against three seats carrying the field's, so nothing here measures a field where every seat carries the arm's value, and no reading transfers to `extension6` or to 3, 5 and 6 seat games. Both expansion arms and both decay arms move the setup road as well as the settlement, because `draft.rs::setup_road` applies SP3's road rule and falls through to far-endpoint scoring only at `expansionWeight` 0, so their readings bundle the two effects and this run does not separate them. The readings are taken against an opponent model M-61 measured at 39.4% of intervening picks named exactly and 23.6% of first picks reaching the board the game actually reached, so **no verdict here may be described as taken against a correctly specified model**; what keeps that from biasing the contrast is that every arm and the reference alike carry the same opponent weights file on the same greedy replay, so the misspecification bounds what the readings mean rather than whether they are comparable. A single arm's verdict says what that axis is worth alone and nothing about what it is worth beside another. No multiplicity correction was applied across the four arms of invocation A and none is claimed. No shipped default moved for this run, in either scorer or any params file, and `SIM-GAP-34` stays open in `.claude/specs/simulator/gaps.md`, because that gap closes on adoption and adoption sits behind two further verdicts.

**The survivor set is `(expansionWeight, 0.1)`, and it is the only member.** `expansionDecay` stays at its shipped 0.5, `robberConcentrationWeight` at its shipped 0, `diversityWeight` at its shipped 1.6. That is **one survivor**, so Task 9 of `docs/plans/completed/simulator-placement-sp6.md` takes its fewer-than-two branch: the combined vector is that single axis, no removal arms exist and no coordinate pass is needed, and Tasks 10 through 17 proceed on a candidate vector that is the live defaults with `expansionWeight` at 0.1.

## M-63: SP6 combined vector and coordinate pass

2026-09-03, commit `f106e8bc` (the commit that took Task 9's one-survivor branch), **no domain touched and no run made**. There is no preregistration for this entry and there was no invocation, so there is no command, no load reading, no game count and no illegal-action count: the condition Task 9 of `docs/plans/completed/simulator-placement-sp6.md` fixed before M-62 ran forbade the pass, and the standing rule that a preregistration for a run a condition already forbade must not be written kept the prereg unwritten too. **This entry is a record of a decision the prior condition made, not a measurement**, and admissibility does not arise because nothing was measured.

**No pass was needed.** M-62's re-screen of the four SP6 candidate axes against the draft-aware field left exactly one survivor, `(expansionWeight, 0.1)`. The combine and the coordinate pass exist to price interaction: `sp6_combined.json` would carry every survivor at its value and each `sp6_minus_<axis>.json` would return one axis to its shipped value, so that the removal contrast against the combined vector reads what that axis is worth *beside the others*. With one survivor the combined vector is `sp6_expansion.json`, which M-62 already read against `base` at both screen and retry power, and the only removal arm is `base` itself, so both preregistered invocations would have re-measured contrasts M-62 holds. No arm file was written and the `SP6_ARMS` count in `simulator/crates/engine/src/policy/params_file.rs` did not move.

**Disposition per axis, under the coordinate rule, which has nothing to act on.** The rule from M-44 drops an axis whose removal reads `better` (it is harmful in combination), keeps one whose removal reads `worse`, and drops one whose removal reads `equivalent` or unresolved on parsimony unless its own re-screen read `better`. `expansionWeight` at 0.1 is the only axis in the vector; it read `better` at both powers in M-62 and there is no other axis for it to interact with, so it is kept by the last clause of the rule with no removal arm read. `expansionDecay` stays at its shipped 0.5, dropped null in M-62 by two `equivalent` readings. `robberConcentrationWeight` stays at its shipped 0, dropped unresolved after `inconclusive` at both powers. `diversityWeight` stays at its shipped 1.6, dropped null after the retry resolved it to `equivalent`. None of the three enters the combined vector, so none has a removal arm and none has a coordinate-pass disposition.

**What this costs the record.** M-44 is the precedent for why removal arms are read rather than single estimates summed: its nine H4 winners summed to an impossible +48pp and were worth +10.20pp together, with three of them actively harmful in combination. That failure mode needs at least two axes to exist. What SP6 gives up by not running the pass is not interaction evidence, which is unobtainable from one axis, but the second reading of `sp6_expansion.json` against `base` that a combined invocation would incidentally have produced on fresh boards. M-62 already read that contrast twice, `+0.889pp` on `[+0.539pp, +1.240pp]` at 64,000 units and `+0.845pp` on `[+0.668pp, +1.022pp]` at 256,000, both `better`, and `eval2` confirmation at M-64 is the held-out reading the programme relies on rather than a third `tuning2` one.

**The final vector is the live `simulator/placement/default-weights.json` with `expansionWeight` moved from 0 to 0.1, and nothing else.** It is committed as `simulator/placement/sp6-candidate-weights.json` and pinned by `params_file.rs::the_sp6_candidate_file_records_the_combined_vector`, which asserts it differs from `default-weights.json` on exactly that leaf, at that value, inside that axis's committed `sweep-bounds.json` range, and that it stays equal to `simulator/placement/arms/sp6_expansion.json`, the arm M-62 read, so the confirmed candidate and its measured arm cannot drift apart. The file loads through the full `EngineWeights` contract in `params_file.rs::every_committed_weights_file_loads_through_the_full_contract` alongside the shipped vector and the Phase-I snapshot. It sits in `placement/` rather than `placement/arms/`, so the committed weights-arm count stays at 64.

**Scope, and what this entry may not be cited for.** No number here is new. Every estimate quoted is M-62's and carries M-62's scope: one layout, one seat count, one policy, one domain, the hero's weights moved against three seats carrying the field's, and an opponent model M-61 measured at 39.4% of intervening picks named exactly. Nothing here says the candidate is worth adopting; it says only which vector goes to the confirmation. **No shipped default moved for this entry**, in either scorer or any params file, and `SIM-GAP-34` stays open in `.claude/specs/simulator/gaps.md`, because that gap closes on adoption and adoption sits behind M-64 on `eval2` and M-66 on `gate2`. `eval2` and `gate2` are both still unspent.

## M-64: SP6 confirmation on eval2

2026-09-03, commit `77c91c36` (the preregistration commit; no code and no default moved for this run), domain `eval2` (seed `16691007541528103170`). Preregistered in `docs/plans/preregs/2026-09-03-m64-sp6-eval2-confirmation.md` (committed before the run). One contrast, one spend: does the gain the SP6 candidate earned on `tuning2` survive a change of seeds?

**This run spends `eval2`, and `eval2` is now gone.** The `## SP6 decisions, 2026-09-02` note in `.claude/specs/simulator/placement-programme.md` records the authorization: on 2026-09-02, in advance of either run, the user authorized this phase to spend `eval2` once on the SP6 confirmation and `gate2` once on the adoption decision, preregistered and without a further approval at the point of spending. This is that reading. No retry was preregistered, none was bought, and no further `eval2` command may ever run, on these parameters or any others. The spend ledger under "Seed-domain discipline" in `.claude/specs/simulator/programme.md` is updated by this entry's task to say so.

**Change under test.** The candidate is `simulator/placement/sp6-candidate-weights.json`, which M-63 recorded as the output of a coordinate pass that was not needed: M-62's re-screen of the four SP6 axes against the draft-aware field left exactly one survivor, so the candidate is the live `simulator/placement/default-weights.json` with `expansionWeight` moved from 0 to 0.1 and nothing else moved. `expansionDecay` stays at 0.5, `robberConcentrationWeight` at 0, `diversityWeight` at 1.6. `simulator/crates/engine/src/policy/params_file.rs::the_sp6_candidate_file_records_the_combined_vector` pins that, and pins the file equal to `simulator/placement/arms/sp6_expansion.json`, the arm M-62 actually read, so the confirmed vector and its measured arm cannot drift apart.

**What a domain change controls, and what it does not.** It controls seed luck alone. It does not control field-overfit, because the field is the same `app_formula_draft:default-weights@default-weights` on `eval2` as on `tuning2`, and it does not control the opponent model: M-61 measured the greedy model inside every hero at 39.4% of intervening picks named exactly against a draft-aware field, so per the `## The reference field is the draft-aware kind, 2026-09-02` note no verdict here is taken against a correctly specified model. Field-overfit is the gate's residual risk in M-46's sense and stays priced rather than removed.

`evaluate`, `standard4`, 4 seats, every seat on `heuristic-v1-trader-aware-threat-devcards-denial` with `--player-trading`, `--threads 0`, **`--threshold 0.005`**, `--alpha 0.05`, run from `simulator/`. 8000 boards x 2 reps, which is 64,000 paired units over 8,000 clusters, SP6's screen power at the 0.5 bar and the same power M-62's screen used. Reference `base` carries the field spec itself, so it sits at the symmetric 0.25 corner and is the drift check. The decision arm carries the candidate on the hero path with the opponent path pinned to the field's weights, per the draft-aware arm contract in `.claude/specs/simulator/contracts.md`.

```text
RUSTFLAGS="-D warnings" cargo build --release --manifest-path simulator/Cargo.toml -p unsettled-sim

# the single invocation, from simulator/
target/release/unsettled-sim evaluate --layout standard4 --seats 4 --domain eval2 --field app_formula_draft:placement/default-weights.json@placement/default-weights.json --arm base=app_formula_draft:placement/default-weights.json@placement/default-weights.json --arm candidate=app_formula_draft:placement/sp6-candidate-weights.json@placement/default-weights.json --reference base --boards 8000 --reps 2 --policy heuristic-v1-trader-aware-threat-devcards-denial --threads 0 --player-trading --threshold 0.005 --alpha 0.05 --out runs/m64-sp6-eval2
```

**Provenance and admissibility.** The release binary was built with `RUSTFLAGS="-D warnings"` in its own command block before the measurement started and reported `Finished` in 0.06s against a warm fingerprint, so no compile landed inside the timed window, which is M-50's lesson. The invocation did not share its command block with a build, a test suite or any other CPU-heavy job, and was not piped through `tail` or `head`. `rustc 1.94.0 (4a4ef493e 2026-03-02)`, `simulatorVersion` 0.1.0. The run reported domain `eval2` at seed `16691007541528103170`, the decimal form of `0xe7a2_5eed_2026_0902`, which is the domain and seed the preregistration fixed; no invocation carried `tuning`, `eval`, `gate` or `tuning2`, and `gate2` is untouched by this run. **Zero illegal actions**, and zero draws in both arms. `simulator/runs/` is gitignored, so no artifact entered the tree and this entry is the record.

Load before `2.43 3.80 5.01`, after `14.63 6.98 6.11`; 59.525s at 18 workers, 2,150.3 games/s, **128,000 games**. The preregistration extrapolated 57 seconds from M-62's two per-arm costs, 2.21e-4s per game for a zero-`expansionWeight` arm and 6.73e-4s for a nonzero one, applied to one arm of each at 64,000 games; the run came in 4% over that. Throughput is below M-62's invocation A at 2,488.6 games/s for the reason that arithmetic gives: this run's nonzero-`expansionWeight` share is one arm of two against two of five, and `draft.rs::Lookahead::new` turns the `ScoreRows` cache off for such an arm.

**The two admissibility checks the preregistration fixed both pass.** `base` won 15,958 of 64,000, a win rate of `0.24934375`, which is 0.66 units per thousand under the symmetric 0.25 corner with a Wilson interval of `[0.24601, 0.25271]` covering it. Because `base` carries the field spec exactly this is also the drift check: an unintended touch of the shipped path would show there first and none did. As the preregistration required, that figure **is not compared with M-62's `tuning2` reference**, because the domain and the board schedule moved with it; this run establishes the first four-seat draft-aware `base` win rate on `eval2` and nothing reproduces it, since no further `eval2` run may ever be made. `candidate` won 16,556 of 64,000 (`0.2586875`).

Pooled paired table, reference `base`.

| Arm | Live to arm | Estimate | b | c | McNemar | Clustered | Selected interval | Verdict |
| --- | --- | ---: | ---: | ---: | --- | --- | --- | --- |
| candidate | `expansionWeight` 0 to 0.1 | `0.00934375` | 6880 | 6282 | `[0.0058311, 0.0128564]` | `[0.0057883, 0.0128992]` | clustered `[0.0057883, 0.0128992]` | **better** |

The clustered interval was the wider of the two and was the one selected, per `evaluate.rs::try_paired_stats`. The comparison was not clustered-degenerate.

Per-hero-seat table, from the `perHeroSeat` block. Hero seat equals draft slot, because `game.rs::setup_order` runs `0..seats` then reversed. Record only: there is no per-slot verdict and the pooled row is the verdict. Percentage points, 16,000 units per slot.

| Arm | Slot 0 | Slot 1 | Slot 2 | Slot 3 |
| --- | ---: | ---: | ---: | ---: |
| candidate | **+1.44** `[+0.73, +2.15]` (mcnemar) | +1.24 `[+0.56, +1.91]` | +0.27 `[-0.42, +0.97]` | +0.79 `[+0.04, +1.54]` |

Per-seat `n` sums to the pooled 64,000 and per-seat `b + c` sums to the pooled 13,162 discordant units.

**The verdict is `better`, and the gate runs.** The selected interval `[+0.579pp, +1.290pp]` sits entirely above the `+0.5pp` bar, which is the preregistered condition for confirming the package, so Task 15 of `docs/plans/completed/simulator-placement-sp6.md` preregisters M-66 on `gate2` and Task 16 executes it. The `worse`, `equivalent` and `inconclusive` branches, each of which would have rejected the package outright and left `gate2` unspent, did not fire.

**It cleared by 0.079pp, on the estimate rather than on the power.** The preregistration named this run's one hazard in advance and the arithmetic came out exactly as stated: the half-width delivered was `+/-0.3555pp` against the `+/-0.35pp` predicted, so a `better` verdict needed a point estimate above about `+0.856pp`, and the estimate landed at `+0.934pp`. That is a margin of 0.079pp of estimate, or 0.079pp on the interval's lower edge. Had the estimate come in at either of M-62's two figures, `+0.889pp` or `+0.845pp`, the verdict would have been `better` by 0.033pp and `inconclusive` by 0.011pp respectively. **The run was as close to a coin flip as the preregistration said it was**, and it is worth recording plainly that the confirmation turned on hundredths of a point at a power the plan fixed and a retry the spend-once rule forbade. Nothing about that weakens the verdict, which is the preregistered rule applied to the preregistered run; it bounds how much reassurance a second such run would have added.

**The held-out estimate came in above both screening estimates, which is the direction that needed no explaining and got none.** `+0.934pp` here against `+0.889pp` on M-62's 64,000-unit screen and `+0.845pp` on its 256,000-unit retry. Regression toward the mean on a held-out domain would have predicted the opposite, and a shrinkage large enough to matter is the failure this run exists to catch; none appeared. The three estimates span 0.089pp across three seed sets and two powers, which is inside a single half-width of any of them, so the honest reading is that they are one effect measured three times rather than three findings, and M-62's retry remains the tightest estimate of its size at `+/-0.177pp`. The discordant rate agrees too: 13,162 of 64,000 units here, 20.57%, against 13,087 and 20.45% on M-62's screen, so the arm changes the pick at the same rate on boards it has never seen.

**The slot structure did not reproduce M-62's shape, and the per-slot power is not enough to say whether that means anything.** M-62's retry read `+1.04`, `+1.18`, `+0.64`, `+0.52` across slots 0 to 3 and this run reads `+1.44`, `+1.24`, `+0.27`, `+0.79`, so the peak moved from slot 1 to slot 0 and the trough from slot 3 to slot 2. Slot 1 reproduced almost exactly and the other three did not. Each slot here carries 16,000 units and a half-width near `+/-0.7pp`, four times the pooled row's, so every one of these slot readings overlaps its M-62 counterpart comfortably and the differences are what noise at that width looks like. What both runs agree on is the thing M-62 recorded as its one structural finding: there is no slot-0 spike of M-54's kind on a draft-aware field, only a mild slope. Three of the four slot intervals exclude zero.

**Prediction against outcome.** **Right on the point estimate**, predicted between `+0.5pp` and `+1.1pp` and centred near `+0.85pp`, delivered `+0.934pp`. **Right on the verdict, against my own odds**: I predicted `better` and `inconclusive` at close to even with a slight lean to `inconclusive`, and it read `better`. **Right that `equivalent` was live but unlikely** and that `worse` would be a surprise; neither fired. **Wrong on the slot profile**, predicted roughly `+1.0`, `+1.2`, `+0.6`, `+0.5` from M-62's retry shape and delivered `+1.44`, `+1.24`, `+0.27`, `+0.79`, right on slot 1 and outside the named figure on the other three, though as recorded above the per-slot power does not support treating that as a real difference.

**Scope, and what this entry may not be cited for.** One contrast, one axis, one layout, one seat count, one policy, one domain, one spend. The arm moves the hero's weights alone against three seats carrying the field's, so nothing here measures a field where every seat carries `expansionWeight` 0.1, and no reading transfers to `extension6` or to 3, 5 and 6 seat games; the extension reading is M-65's separate, record-only business and cannot block adoption. The arm moves the setup road as well as the settlement, because `draft.rs::setup_road` applies SP3's road rule and falls through to far-endpoint scoring only at `expansionWeight` 0, so this reading bundles the two effects and does not separate them, exactly as M-62's did. The reading is taken against the greedy opponent model M-61 measured at 39.4% exact, so **no verdict here may be described as taken against a correctly specified model**; what keeps that from biasing the contrast is that the arm and the reference carry the same opponent weights file on the same greedy replay. **A `better` verdict here confirms only that the `tuning2` gain survived a seed change.** It says nothing about whether the gain survives adoption as a shipped default, where every seat would carry it, which is the question `gate2` is held for. **No shipped default moved for this run or for the task that records it**, in either scorer or any params file, and `SIM-GAP-34` stays open in `.claude/specs/simulator/gaps.md`, because that gap closes on adoption and adoption sits behind M-66.

## M-65: SP6 candidate on extension6

2026-09-03, commit `a3e4c7aa` (the preregistration commit; no code and no default moved for this run), domain `tuning2` (seed `8796197394747623682`). Preregistered in `docs/plans/preregs/2026-09-03-m65-sp6-extension6.md` (committed before the run). Record only, and it cannot block adoption: this is the one observation of the SP6 candidate outside the four-seat `standard4` corner every other SP6 entry was taken in.

**It did not read `worse`, so there is no flag for the user.** The `## SP6 decisions, 2026-09-02` note in `.claude/specs/simulator/placement-programme.md` fixed one record-only extension reading with a `worse` result flagged; the flag condition was the whole selected interval below `-0.005` and the reading is `+0.717pp` with the whole interval above zero. Nothing here changes the candidate vector, and M-66 on `gate2` runs exactly as Task 15 of `docs/plans/completed/simulator-placement-sp6.md` preregisters it.

**Change under test.** One arm, the same single contrast M-62 screened and M-64 confirmed: `simulator/placement/sp6-candidate-weights.json`, the live `simulator/placement/default-weights.json` with `expansionWeight` moved from 0 to 0.1 and nothing else moved, `expansionDecay` at 0.5, `robberConcentrationWeight` at 0, `diversityWeight` at 1.6. `simulator/crates/engine/src/policy/params_file.rs::the_sp6_candidate_file_records_the_combined_vector` pins that and pins the file equal to `simulator/placement/arms/sp6_expansion.json`.

`evaluate`, **`extension6`, 6 seats**, every seat on `heuristic-v1-trader-aware-threat-devcards-denial` with `--player-trading`, `--threads 0`, **`--threshold 0.005`**, `--alpha 0.05`, run from `simulator/`. 2000 boards x 2 reps, which is **24,000 paired units over 2,000 clusters** and 48,000 games, because `simulator/crates/cli/src/evaluate.rs::evaluation_schedule` crosses boards, reps and hero seats and six seats give 12 units per board against four seats' 8. Six seats is an official combination for this layout in `evaluate.rs::validate_request`, so no `--allow-unofficial` was needed. Reference `base` carries the field spec itself and sits at the symmetric **1/6** corner, not the 0.25 corner every four-seat SP6 entry checked. The decision arm carries the candidate on the hero path with the opponent path pinned to the field's weights, per the draft-aware arm contract in `.claude/specs/simulator/contracts.md`.

```text
RUSTFLAGS="-D warnings" cargo build --release --manifest-path simulator/Cargo.toml -p unsettled-sim

# the single invocation, from simulator/
target/release/unsettled-sim evaluate --layout extension6 --seats 6 --domain tuning2 --field app_formula_draft:placement/default-weights.json@placement/default-weights.json --arm base=app_formula_draft:placement/default-weights.json@placement/default-weights.json --arm candidate=app_formula_draft:placement/sp6-candidate-weights.json@placement/default-weights.json --reference base --boards 2000 --reps 2 --policy heuristic-v1-trader-aware-threat-devcards-denial --threads 0 --player-trading --threshold 0.005 --alpha 0.05 --out runs/m65-sp6-extension6
```

**Provenance and admissibility.** The release binary was built with `RUSTFLAGS="-D warnings"` in its own command block before the measurement started and reported `Finished` in 0.06s against a warm fingerprint, so no compile landed inside the timed window. The invocation did not share its command block with a build, a test suite or any other CPU-heavy job, and was not piped through `tail` or `head`. `rustc 1.94.0 (4a4ef493e 2026-03-02)`, `simulatorVersion` 0.1.0. The run reported domain `tuning2` at seed `8796197394747623682`, the decimal form of `0x7a12_5eed_2026_0902`, which is the domain and seed the preregistration fixed; no invocation carried `tuning`, `eval`, `gate`, `eval2` or `gate2`, so nothing was spent, `tuning2` being SP6's freely screening domain. **Zero illegal actions**, and zero draws in both arms. `simulator/runs/` is gitignored, so no artifact entered the tree and this entry is the record.

Load before `2.17 3.58 4.66`, after `14.33 6.66 5.72`; 55.439s at 18 workers, 865.8 games/s, **48,000 games**. The preregistration extrapolated **about 55 seconds** from a 200-board pilot that measured 876.4 games/s on this layout, and the run came in 1.2% slower per game, 1.155e-3s against the pilot's 1.141e-3s. That is 2.48 times the 4.65e-4s per game M-64 measured on four-seat `standard4`, against the 2.45 the pilot predicted.

**The admissibility check on the corner passes.** `base` won 4,026 of 24,000, a win rate of `0.16775`, which is 1.08 units per thousand above the symmetric 1/6 corner of `0.166667` with a Wilson interval of `[0.16308, 0.17253]` covering it. Because `base` carries the field spec exactly this is also the drift check, and nothing drifted. As the preregistration required, that figure **is not compared with M-62's or M-64's four-seat reference win rate**, because the layout, the seat count and the board schedule all moved with it; this run establishes the first six-seat draft-aware `base` win rate on `extension6`. `candidate` won 4,198 of 24,000 (`0.17491667`).

Pooled paired table, reference `base`.

| Arm | Live to arm | Estimate | b | c | McNemar | Clustered | Selected interval | Verdict |
| --- | --- | ---: | ---: | ---: | --- | --- | --- | --- |
| candidate | `expansionWeight` 0 to 0.1 | `0.00716667` | 1996 | 1824 | `[0.0021201, 0.0122133]` | `[0.0021146, 0.0122188]` | clustered `[0.0021146, 0.0122188]` | **inconclusive** |

The clustered interval was the wider of the two and was the one selected, per `evaluate.rs::try_paired_stats`. The comparison was not clustered-degenerate.

Per-hero-seat table, from the `perHeroSeat` block. Hero seat equals draft slot, because `game.rs::setup_order` runs `0..seats` then reversed, which at six seats puts **10 intervening picks** between slot 0's two settlements and none at all between slot 5's. Record only: there is no per-slot verdict and the pooled row is the verdict. Percentage points, 4,000 units per slot.

| Arm | Slot 0 | Slot 1 | Slot 2 | Slot 3 | Slot 4 | Slot 5 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| candidate | **+1.70** `[+0.44, +2.96]` | +0.38 `[-0.90, +1.65]` | +0.15 `[-1.12, +1.42]` | +1.43 `[+0.25, +2.60]` (mcnemar) | +0.40 `[-0.82, +1.62]` (mcnemar) | +0.25 `[-1.02, +1.52]` |

Per-seat `n` sums to the pooled 24,000 and per-seat `b + c` sums to the pooled 3,820 discordant units. Slots 3 and 4 selected the McNemar interval as the wider one; the other four selected the clustered.

**The verdict is `inconclusive`, which the preregistration named as the modal outcome by construction, and it is not a null.** The selected interval `[+0.211pp, +1.222pp]` sits entirely above zero but straddles the `+0.5pp` bar, so the run separates the candidate from doing nothing and does not separate it from doing less than half a point. That is what a 2,000-cluster design at this bar can deliver and the preregistration said so before the run rather than afterwards. `better` needed an estimate above about `+1.22pp` and `worse` below about `-1.22pp`; neither was close.

**The interval came in a third tighter than predicted, and the reason corrects the preregistration's arithmetic.** I predicted `+/-0.7pp` to `+/-0.9pp` from the cluster count alone, a quarter of M-64's 8,000 clusters giving roughly twice its `+/-0.3555pp`. The delivered half-width is `+/-0.5052pp`, only 1.44 times M-64's. The missing factor is the discordant rate, not the cluster count: a McNemar half-width goes as `sqrt(b + c) / n`, and the discordant rate fell from 20.57% at four seats to **15.92%** here, 3,820 of 24,000. That drop is close to what the corner change alone predicts, since `p (1 - p)` falls by a factor of 0.74 going from a 0.25 corner to a 1/6 one, against the 0.774 observed. Fewer games are win-flippable at six seats, so each unit carries less variance, and that recovers most of what the smaller sample cost. **The consequence is that `equivalent` was not structurally unreachable after all**: it needed a half-width under `0.5pp` and the run delivered `0.5052pp`, missing by five thousandths of a point. Had the estimate also sat near zero the verdict could have been `equivalent`, so the preregistration's flat claim that the outcome space held only three verdicts was wrong by a hair. The claim it rested on, that this design cannot resolve the 0.5 bar, held: it could not.

**The sign survived the bigger board and the longer draft, which is the question the run was sized to ask.** `+0.717pp` here against `+0.934pp` on M-64's four-seat confirmation and `+0.845pp` on M-62's 256,000-unit retry. The preregistration's corner-scaling argument predicted about `+0.62pp` from M-64 by the 1/6-versus-1/4 ratio, and the delivered estimate is above that, so whatever the longer intervening window costs the lookahead here it did not cost more than the larger board's extra room returned. That is a one-run reading with a half-width wider than the gap between any two of these three numbers, so the honest statement is that nothing in it contradicts a single effect of the same sign and roughly the same corner-scaled size on both layouts, not that the sizes have been shown equal.

**Prediction against outcome.** **Right on the point estimate**, predicted between `0pp` and `+1.0pp` centred near `+0.6pp`, delivered `+0.717pp`. **Right on the verdict**, predicted `inconclusive` at about four in five, delivered `inconclusive`. **Right that `worse` would be a surprise**; it did not fire, and the flag it would have raised is not raised. **Wrong on the half-width and on the outcome space**, as recorded above: `+/-0.505pp` against `+/-0.7pp` to `+/-0.9pp` predicted, which put `equivalent` a hair inside reach rather than structurally out of it. **Wrong on the slot profile.** I predicted the mild early-to-late slope M-62 and M-64 both found, with slot 5 lowest because it picks twice in a row with no intervening window for a lookahead to work on. Slot 0 is highest at `+1.70` as predicted, but slot 3 is second at `+1.43` and the lowest slot is 2 at `+0.15`, with slot 5 at `+0.25` third from bottom; there is no slope. Four of the six slot intervals contain zero, each carries a half-width near `+/-1.25pp`, and every slot overlaps every other, so the profile is what noise at 4,000 units per slot looks like and none of it is evidence of six-seat slot structure. The per-slot half-width itself is about 2.45 times the pooled row's rather than the "roughly twice" the preregistration wrote, which is the square root of six slots and not of four.

**Scope, and what this entry may not be cited for.** One contrast, one axis, one layout, one seat count, one policy, one domain. The arm moves the hero's weights alone against five seats carrying the field's, so nothing here measures a field where every seat carries `expansionWeight` 0.1. The arm moves the setup road as well as the settlement, because `draft.rs::setup_road` applies SP3's road rule and falls through to far-endpoint scoring only at `expansionWeight` 0, so this reading bundles the two effects exactly as M-62's and M-64's did. The reading is taken against the greedy opponent model M-61 measured at 39.4% exact **at four seats and never at six**, where the window is half again as long, so **no verdict here may be described as taken against a correctly specified model** and the misspecification is expected to be worse here than anywhere else in SP6; what keeps it from biasing the contrast is that the arm and the reference carry the same opponent weights file on the same greedy replay. Nothing here transfers back to `standard4`, to 3, 4 and 5 seat games, or to `extension6` at five seats, which this run does not observe. The per-hero-seat table is record-only and carries no verdict. **No shipped default moved for this run or for the task that records it**, in either scorer or any params file, and `SIM-GAP-34` stays open in `.claude/specs/simulator/gaps.md`, because that gap closes on adoption and adoption sits behind M-66.

## M-66: SP6 adoption gate on gate2

2026-09-03, commit `6279ec4e` (the preregistration commit; no code and no default moved for this run, and the adoption it licenses is a separate commit), domain `gate2` (seed `7670297487904999682`). Preregistered in `docs/plans/preregs/2026-09-03-m66-sp6-gate2.md` (committed before the run). One contrast, one decision, one spend: is the SP6 candidate's gain real enough to ship as a default?

**This run spends `gate2`, and with it the last unspent domain in the programme.** The `## SP6 decisions, 2026-09-02` note in `.claude/specs/simulator/placement-programme.md` records the authorization in terms: on 2026-09-02, in advance of either run, the user authorized this phase to spend `eval2` once on the SP6 confirmation and `gate2` once on the adoption decision, preregistered and without a further approval at the point of spending. This is that reading. No retry was preregistered, none was bought, and **no further `gate2` command may ever run**, on these parameters or any others. All six domains, `tuning`, `eval`, `gate`, `tuning2`, `eval2` and `gate2`, are now spent or exhausted for their purpose; the spend ledger under "Seed-domain discipline" in `.claude/specs/simulator/programme.md` is updated by this entry's task to say so.

**Change under test.** One arm, the SP6 candidate vector `simulator/placement/sp6-candidate-weights.json` against the field's own weights. M-63 recorded that vector as the output of a coordinate pass that was not needed: M-62's re-screen of the four SP6 axes against the draft-aware field left exactly one survivor, so the candidate is the live `simulator/placement/default-weights.json` with `expansionWeight` moved from 0 to 0.1 and nothing else moved. `expansionDecay` stays at 0.5, `robberConcentrationWeight` at 0, `diversityWeight` at 1.6. `simulator/crates/engine/src/policy/params_file.rs::the_sp6_candidate_file_records_the_combined_vector` walks every leaf of the shipped vector and pins that the moved set is exactly that one axis at that value, checks it against `simulator/placement/sweep-bounds.json`, and pins the file equal to `simulator/placement/arms/sp6_expansion.json`, the arm M-62 actually read, so the vector this gate decided on and the vector every earlier SP6 entry measured cannot drift apart.

**What this run adds, and what it does not.** M-64 asked whether the `tuning2` gain survived a change of seeds; this run asks M-46's question instead, whether the gain is real enough to ship. What it adds is a second independent seed set, `gate2` sharing no seed and no generated board with `tuning`, `eval`, `gate`, `tuning2` or `eval2`. What it does not add is any control on field-overfit, because the field is the same `app_formula_draft:default-weights@default-weights` here as on both earlier domains, and none on the opponent model: M-61 measured the greedy model inside every hero at 39.4% of intervening picks named exactly against a draft-aware field, so per the `## The reference field is the draft-aware kind, 2026-09-02` note **no verdict here may be described as taken against a correctly specified model**. Field-overfit is this gate's residual risk in M-46's sense, accepted as priced rather than removed: the adopted default is a default for this simulator's composite policy against this field.

`evaluate`, `standard4`, 4 seats, every seat on `heuristic-v1-trader-aware-threat-devcards-denial` with `--player-trading`, `--threads 0`, **`--threshold 0.005`**, `--alpha 0.05`, run from `simulator/`. 8000 boards x 2 reps, which is 64,000 paired units over 8,000 clusters, the power the user's gate rule fixed and the same power M-62's screen and M-64's confirmation used. Reference `base` carries the field spec itself, so it sits at the symmetric 0.25 corner and is the drift check. The decision arm carries the candidate on the hero path with the opponent path pinned to the field's weights, per the draft-aware arm contract in `.claude/specs/simulator/contracts.md`, so the arm moves the hero's formula and nothing about the opponent model.

```text
RUSTFLAGS="-D warnings" cargo build --release --manifest-path simulator/Cargo.toml -p unsettled-sim

# the single invocation, from simulator/
target/release/unsettled-sim evaluate --layout standard4 --seats 4 --domain gate2 --field app_formula_draft:placement/default-weights.json@placement/default-weights.json --arm base=app_formula_draft:placement/default-weights.json@placement/default-weights.json --arm candidate=app_formula_draft:placement/sp6-candidate-weights.json@placement/default-weights.json --reference base --boards 8000 --reps 2 --policy heuristic-v1-trader-aware-threat-devcards-denial --threads 0 --player-trading --threshold 0.005 --alpha 0.05 --out runs/m66-sp6-gate2
```

**Provenance and admissibility.** The release binary was built with `RUSTFLAGS="-D warnings"` in its own command block before the measurement started and reported `Finished` in 0.08s against a warm fingerprint, so no compile landed inside the timed window, which is M-50's lesson. The invocation did not share its command block with a build, a test suite or any other CPU-heavy job, and was not piped through `tail` or `head`. `rustc 1.94.0 (4a4ef493e 2026-03-02)`, `simulatorVersion` 0.1.0. The run reported domain `gate2` at seed `7670297487904999682`, the decimal form of `0x6a72_5eed_2026_0902`, which is the domain and seed the preregistration fixed; no invocation carried `tuning`, `eval`, `gate`, `tuning2` or `eval2`. **Zero illegal actions**, and zero draws in both arms. `simulator/runs/` is gitignored, so no artifact entered the tree and this entry is the record.

Load before `2.55 4.05 4.74`, after `14.05 7.09 5.83`; 58.809s at 18 workers, 2,176.5 games/s, **128,000 games**. The preregistration predicted about 60 seconds by carrying M-64's identical schedule across unchanged, and the run came in 1.2% faster, 2,176.5 games/s against M-64's 2,150.3 on the same arm mix of one zero-`expansionWeight` arm, whose `ScoreRows` cache `draft.rs::Lookahead::new` leaves on, and one nonzero arm, whose cache it turns off.

**The corner check passes.** `base` won 16,058 of 64,000, a win rate of `0.25090625`, which is 0.91 units per thousand above the symmetric 0.25 corner with a Wilson interval of `[0.24756, 0.25428]` covering it. Because `base` carries the field spec exactly this is also the drift check: an unintended touch of the shipped path would show there first and none did. As the preregistration required, that figure **is not compared with M-62's or M-64's reference win rate**, because the domain and the board schedule moved with it; this run establishes the first and only four-seat draft-aware `base` win rate on `gate2`, and nothing reproduces it, since no further `gate2` run may ever be made. `candidate` won 16,760 of 64,000 (`0.261875`).

Pooled paired table, reference `base`.

| Arm | Live to arm | Estimate | b | c | McNemar | Clustered | Selected interval | Verdict |
| --- | --- | ---: | ---: | ---: | --- | --- | --- | --- |
| candidate | `expansionWeight` 0 to 0.1 | `0.01096875` | 6970 | 6268 | `[0.0074462, 0.0144913]` | `[0.0074044, 0.0145331]` | clustered `[0.0074044, 0.0145331]` | **better** |

The clustered interval was the wider of the two and was the one selected, per `evaluate.rs::try_paired_stats`. The comparison was not clustered-degenerate.

Per-hero-seat table, from the `perHeroSeat` block. Hero seat equals draft slot, because `game.rs::setup_order` runs `0..seats` then reversed. Record only: there is no per-slot verdict and the pooled row is the verdict. Percentage points, 16,000 units per slot, every slot selecting the clustered interval.

| Arm | Slot 0 | Slot 1 | Slot 2 | Slot 3 |
| --- | ---: | ---: | ---: | ---: |
| candidate | **+1.55** `[+0.83, +2.27]` | +0.93 `[+0.24, +1.62]` | +1.21 `[+0.51, +1.91]` | +0.69 `[-0.04, +1.43]` |

Per-seat `n` sums to the pooled 64,000 and per-seat `b + c` sums to the pooled 13,238 discordant units.

**The verdict is `better`, and it adopts the whole package.** The selected interval `[+0.740pp, +1.453pp]` sits entirely above the `+0.5pp` bar, which is the preregistered condition for adoption, so Task 17 of `docs/plans/completed/simulator-placement-sp6.md` executes the adoption exactly as its Context specifies: `expansionWeight` moves from 0 to 0.1 in `src/engine/weights.ts::DEFAULT_WEIGHTS`, `simulator/placement/default-weights.json` and `simulator/fixtures/placement-parity.json` are regenerated through `simulator/tools/generate-placement-parity.ts`, the pre-adoption vector is snapshotted to a new `sp6-pre-adoption-weights.json` beside `simulator/placement/phase-i-candidate-weights.json`, whose precedent it follows, and every SP-family arm pin is re-anchored to that snapshot, and `SIM-GAP-34` is deleted from `.claude/specs/simulator/gaps.md`. The `worse`, `equivalent` and `inconclusive` branches, each of which would have rejected the package outright with no partial adoption and no default moved, did not fire. Nothing else moves: `expansionDecay`, `robberConcentrationWeight` and `diversityWeight` stay where they ship, and the field spelling stays `app_formula_draft:default-weights@default-weights`, with only the vector inside it moving.

**It cleared by 0.240pp, and the coin flip the preregistration predicted did not materialise.** The half-width delivered was `+/-0.3564pp` against the `+/-0.355pp` M-62 and M-64 both delivered on this contrast at this power, so a `better` verdict needed a point estimate above about `+0.856pp` and the estimate landed at `+1.097pp`. That is a margin of 0.240pp on the interval's lower edge, against the 0.079pp M-64 cleared by. The preregistration put `better` and `inconclusive` at roughly 52 to 48 because the threshold at this power, about `+0.855pp`, and the inverse-variance pooling of the two available non-overlapping readings, about `+0.863pp`, coincided to within a hundredth of a point. The estimate came in 0.23pp above that pooled figure, which is 0.66 of this run's own half-width, so the gate was decided by an ordinary upward fluctuation rather than by the margin being real: at the pooled estimate this run had close to even odds, and it drew the favourable side. **That does not qualify the verdict**, which is the preregistered rule applied to the preregistered run at a power the user fixed. It does bound the reassurance the run adds: had the estimate landed at the pooled figure the package would have been rejected outright on `inconclusive`, and the record should not be read as though `better` was the likely outcome.

**Four four-seat readings now agree on the size of the effect, and this is the largest of them.** `+1.097pp` here against `+0.889pp` on M-62's 64,000-unit screen, `+0.845pp` on M-62's 256,000-unit retry and `+0.934pp` on M-64's held-out confirmation. Inverse-variance weighting the three non-overlapping readings, M-62's retry at `+/-0.177pp`, M-64 at `+/-0.3555pp` and this run at `+/-0.3564pp`, gives about **`+0.90pp`** over 384,000 paired units on three disjoint seed sets, and that is the tightest statement the programme can make about the size of the gain. The four estimates span 0.25pp, which is less than one half-width of any of the three 64,000-unit readings, so they are one effect measured four times rather than four findings. The discordant rate agrees as it has throughout: 13,238 of 64,000 units here, 20.68%, against 20.45% on M-62's screen and 20.57% on M-64, so the arm changes the pick at the same rate on boards it has never seen. Nothing shrank on a held-out domain, twice, which is the failure the confirmation and the gate exist to catch.

**The slot structure again failed to reproduce, and again the per-slot power cannot say whether that means anything.** The three four-seat readings give `+1.04`, `+1.18`, `+0.64`, `+0.52` (M-62 retry), `+1.44`, `+1.24`, `+0.27`, `+0.79` (M-64) and `+1.55`, `+0.93`, `+1.21`, `+0.69` (here). Slot 0 is the highest of the four in all three and slot 3 is below slot 0 in all three, but the middle two swap freely: slot 2 reads `+0.27` on one domain and `+1.21` on the next. Each slot here carries 16,000 units and a half-width near `+/-0.70pp`, twice the pooled row's, so every slot reading overlaps its counterpart in both earlier runs and the differences are what noise at that width looks like. What all three agree on is M-62's one structural finding: a mild early-to-late tilt on a draft-aware field, with no slot-0 spike of M-54's kind. Three of the four slot intervals here exclude zero, slot 3 being the one that does not.

**Prediction against outcome.** **Right on the point estimate**, predicted between `+0.47pp` and `+1.25pp` centred near `+0.86pp`, delivered `+1.097pp`, in the upper half of the range. **Right on the verdict**, predicted `better` at roughly 52 to 48 over `inconclusive`, delivered `better`, though as recorded above the margin came from the estimate running above the pooled figure and not from the odds having been better than stated. **Right that `equivalent` was under 1% and `worse` out of reach**; neither fired, and `worse` would have needed the sign to be seed-specific across three four-seat seed sets and 384,000 non-overlapping paired units. **Right on the half-width**, predicted `+/-0.355pp` from the two earlier readings at this power, delivered `+/-0.3564pp`. **Wrong on the slot profile again**, predicted roughly `+1.2`, `+1.2`, `+0.5`, `+0.6` from the earlier shapes and delivered `+1.55`, `+0.93`, `+1.21`, `+0.69`, right on the ordering of slots 0 and 3 and outside the named figures on slots 1 and 2. The preregistration predicted that it would be wrong in detail on the slots for exactly this reason and it was, which is the third consecutive SP6 entry where the per-slot table has told nothing the pooled row did not.

**Scope, and what this entry may not be cited for.** One contrast, one axis, one layout, one seat count, one policy, one domain, one spend. The arm moves the hero's weights alone against three seats carrying the field's, so **nothing here measures the field adoption creates**, one where all four seats carry `expansionWeight` 0.1. That gap is sharper for this programme than it was at M-46, because the field spelling names `simulator/placement/default-weights.json` on both its paths: after adoption the same spelling denotes a different field and no post-adoption run reproduces this reading, which is also why the adoption task re-anchors every SP-family arm pin to a pre-adoption snapshot rather than to the live defaults. No reading transfers to `extension6` or to 3, 5 and 6 seat games; M-65 is the only observation outside this corner and it is record-only, having read `inconclusive` at `+0.717pp` without raising the `worse` flag. The arm moves the setup road as well as the settlement, because `draft.rs::setup_road` applies SP3's road rule and falls through to far-endpoint scoring only at `expansionWeight` 0, so this reading bundles the two effects and does not separate them, exactly as M-62's, M-64's and M-65's did. The reading is taken against the greedy opponent model M-61 measured at 39.4% exact; what keeps that from biasing the contrast is that the arm and the reference carry the same opponent weights file on the same greedy replay. **A `better` verdict here decides adoption and nothing more.** It does not establish that 0.1 is the optimal value, since `expansionWeight` 0.3 read `inconclusive` twice in M-62 and was recorded unresolved rather than beaten, and no finer sweep was run; and it does not license moving any other axis. `SIM-GAP-35`, `SIM-GAP-36`, `SIM-GAP-37` and `SIM-GAP-41` stay open.

## M-67: seat-count screen at 4 seats

2026-10-10, commit `e6ebaa6f` (the preregistration commit; no default moved for this run), domain `tuning3` (seed `8796478869724336144`). Preregistered in `docs/plans/preregs/2026-10-10-m67-seats4-screen.md` (committed before the pilot). First entry of the seat-count weights programme, whose rules are in `.claude/specs/simulator/seat-count-programme.md`: does any of twelve single-parameter arms beat today's vector at four seats, on seeds no parameter has seen?

`evaluate`, `standard4`, 4 seats, field `app_formula_draft:placement/default-weights.json@placement/default-weights.json`, every seat on `heuristic-v1-trader-aware-threat-devcards-denial` with `--player-trading`, `--threads 0`, 2 reps, `--threshold 0.005`, `--alpha 0.05`, run from `simulator/`. Reference `base` is the field spec itself. Each arm carries one `simulator/placement/arms/sc_*.json` on the hero path with the opponent path pinned to the field's weights. The arms, value against live default: `scarcity_lo`/`scarcity_hi` `scarcityWeight` 0.175/0.7 (0.35); `covscarcity_lo`/`covscarcity_hi` `coverageScarcityWeight` 0.25/1.0 (0.5); `coverage_lo`/`coverage_hi` `coverageExponent` 1.0/2.25 (1.5); `diversity_lo`/`diversity_hi` `diversityWeight` 0.8/3.2 (1.6); `port_lo`/`port_hi` `portWeight` 0.275/1.1 (0.55); `expansion_lo`/`expansion_hi` `expansionWeight` 0/0.3 (0.1).

```text
RUSTFLAGS="-D warnings" cargo build --release --manifest-path simulator/Cargo.toml -p unsettled-sim

# pilot, from simulator/, read blind
target/release/unsettled-sim evaluate --layout standard4 --seats 4 --domain tuning3 --field app_formula_draft:placement/default-weights.json@placement/default-weights.json --arm base=app_formula_draft:placement/default-weights.json@placement/default-weights.json --arm scarcity_lo=app_formula_draft:placement/arms/sc_scarcity_lo.json@placement/default-weights.json --arm scarcity_hi=app_formula_draft:placement/arms/sc_scarcity_hi.json@placement/default-weights.json --arm covscarcity_lo=app_formula_draft:placement/arms/sc_covscarcity_lo.json@placement/default-weights.json --arm covscarcity_hi=app_formula_draft:placement/arms/sc_covscarcity_hi.json@placement/default-weights.json --arm coverage_lo=app_formula_draft:placement/arms/sc_coverage_lo.json@placement/default-weights.json --arm coverage_hi=app_formula_draft:placement/arms/sc_coverage_hi.json@placement/default-weights.json --arm diversity_lo=app_formula_draft:placement/arms/sc_diversity_lo.json@placement/default-weights.json --arm diversity_hi=app_formula_draft:placement/arms/sc_diversity_hi.json@placement/default-weights.json --arm port_lo=app_formula_draft:placement/arms/sc_port_lo.json@placement/default-weights.json --arm port_hi=app_formula_draft:placement/arms/sc_port_hi.json@placement/default-weights.json --arm expansion_lo=app_formula_draft:placement/arms/sc_expansion_lo.json@placement/default-weights.json --arm expansion_hi=app_formula_draft:placement/arms/sc_expansion_hi.json@placement/default-weights.json --reference base --boards 400 --reps 2 --policy heuristic-v1-trader-aware-threat-devcards-denial --threads 0 --player-trading --threshold 0.005 --alpha 0.05 --out runs/m67-seats4-pilot

# screen, from simulator/: the pilot's command with --boards 4500 --out runs/m67-seats4-screen

# retry, from simulator/
target/release/unsettled-sim evaluate --layout standard4 --seats 4 --domain tuning3 --field app_formula_draft:placement/default-weights.json@placement/default-weights.json --arm base=app_formula_draft:placement/default-weights.json@placement/default-weights.json --arm diversity_hi=app_formula_draft:placement/arms/sc_diversity_hi.json@placement/default-weights.json --reference base --boards 18000 --reps 2 --policy heuristic-v1-trader-aware-threat-devcards-denial --threads 0 --player-trading --threshold 0.005 --alpha 0.05 --out runs/m67-seats4-retry
```

**Provenance and admissibility.** The release binary was built with `RUSTFLAGS="-D warnings"` in its own command block and reported `Finished` in 0.03s against a warm fingerprint; all three invocations used it. `rustc 1.94.0 (4a4ef493e 2026-03-02)`. Each invocation ran alone in its command block, unpiped, one after another, and each reported domain `tuning3` at seed `8796478869724336144`. **Zero illegal actions in all three, and zero draws in every arm.** `simulator/runs/` is gitignored, so this entry is the record. Other sessions were using the machine throughout, which the load figures show, so every throughput here is a contended figure; the results are deterministic and do not depend on it.

Pilot, 400 boards: load before `9.12 9.41 8.51`, after `29.15 18.95 12.62`; 150.426s at 18 workers, 276.5 games/s, 41,600 games. **Read blind**: only the wall time, the illegal-action count and each arm's half-width and discordant share were printed; its estimates, signs and verdicts were not read and are not cited. That is about a fifth of the 1,486.8 games/s M-62 recorded for an all-nonzero-`expansionWeight` invocation, and the reason is the SP6 adoption rather than this run: the field now carries `expansionWeight` 0.1 on every seat's hero and opponent path, and `draft.rs::Lookahead::new` turns its row cache off whenever either path is nonzero, so every lookahead in every game runs uncached where M-62's field seats ran cached.

Sizing: the widest pilot half-width was `port_hi` at 1.5784pp, so the 0.35pp target wanted 8,135 boards, rounded to 8500; the 30-minute cap allowed 4,786, rounded down to **`B` = 4500**. The cap bound, and at 4500 boards the pilot predicted half-widths from 0.16pp to 0.47pp, about 0.32pp for a typical arm.

Screen, 4500 boards, 36,000 paired units over 4,500 clusters: load before `12.18 16.01 12.01`, after `8.73 29.42 33.65`; 1601.185s, 292.3 games/s, 468,000 games. `base` won 8,843 of 36,000 (`0.24563888888888888`), 1.911 binomial standard errors below the 0.25 corner, inside the preregistered 3.29, so the corner check passes.

Retry, 18000 boards, 144,000 paired units, carrying `base` and `diversity_hi` only: load before `7.73 27.86 32.99`, after `43.04 41.15 38.32`; 930.632s, 309.5 games/s, 288,000 games. `base` won 35,945 of 144,000 (`0.24961805555555555`), 0.335 standard errors below the corner; the check passes.

Screen, pooled, reference `base`:

| Arm | Estimate | b | c | McNemar | Clustered | Selected | Half-width pp | Verdict |
| --- | ---: | ---: | ---: | --- | --- | --- | ---: | --- |
| coverage_hi | `-0.011805555555555555` | 1245 | 1670 | `[-0.0147425, -0.0088686]` | `[-0.0147953, -0.0088159]` | clustered `[-0.0147953, -0.0088159]` | 0.2990 | worse |
| coverage_lo | `0.010833333333333334` | 1757 | 1367 | `[0.0077924, 0.0138743]` | `[0.0076621, 0.0140046]` | clustered `[0.0076621, 0.0140046]` | 0.3171 | better |
| covscarcity_hi | `-0.0005555555555555556` | 652 | 672 | `[-0.0025366, 0.0014255]` | `[-0.0026188, 0.0015077]` | clustered `[-0.0026188, 0.0015077]` | 0.2063 | equivalent |
| covscarcity_lo | `0.001388888888888889` | 360 | 310 | `[-0.0000203, 0.0027980]` | `[-0.0000511, 0.0028289]` | clustered `[-0.0000511, 0.0028289]` | 0.1440 | equivalent |
| diversity_hi | `0.006666666666666667` | 2122 | 1882 | `[0.0032223, 0.0101110]` | `[0.0031416, 0.0101917]` | clustered `[0.0031416, 0.0101917]` | 0.3525 | inconclusive |
| diversity_lo | `-0.00925` | 1468 | 1801 | `[-0.0123613, -0.0061387]` | `[-0.0124539, -0.0060461]` | clustered `[-0.0124539, -0.0060461]` | 0.3204 | worse |
| expansion_hi | `-0.004527777777777778` | 1485 | 1648 | `[-0.0075748, -0.0014808]` | `[-0.0076314, -0.0014241]` | clustered `[-0.0076314, -0.0014241]` | 0.3104 | inconclusive |
| expansion_lo | `-0.007166666666666667` | 3512 | 3770 | `[-0.0118120, -0.0025213]` | `[-0.0118167, -0.0025167]` | clustered `[-0.0118167, -0.0025167]` | 0.4650 | inconclusive |
| port_hi | `-0.022833333333333334` | 2674 | 3496 | `[-0.0271033, -0.0185633]` | `[-0.0272695, -0.0183972]` | clustered `[-0.0272695, -0.0183972]` | 0.4436 | worse |
| port_lo | `-0.00025` | 1260 | 1269 | `[-0.0029879, 0.0024879]` | `[-0.0029817, 0.0024817]` | mcnemar `[-0.0029879, 0.0024879]` | 0.2738 | equivalent |
| scarcity_hi | `-0.00175` | 1749 | 1812 | `[-0.0049988, 0.0014988]` | `[-0.0051039, 0.0016039]` | clustered `[-0.0051039, 0.0016039]` | 0.3354 | inconclusive |
| scarcity_lo | `0.0014444444444444444` | 1048 | 996 | `[-0.0010169, 0.0039058]` | `[-0.0010551, 0.0039440]` | clustered `[-0.0010551, 0.0039440]` | 0.2500 | equivalent |

Retry, pooled, reference `base`:

| Arm | Estimate | b | c | McNemar | Clustered | Selected | Half-width pp | Verdict |
| --- | ---: | ---: | ---: | --- | --- | --- | ---: | --- |
| diversity_hi | `0.005645833333333333` | 8556 | 7743 | `[0.0039084, 0.0073833]` | `[0.0038584, 0.0074332]` | clustered `[0.0038584, 0.0074332]` | 0.1787 | inconclusive |

Per-hero-seat tables, record only; hero seat equals draft slot. Percentage points, clustered intervals except where noted. Screen:

| Arm | pp estimate [interval] | discordant | Slot 0 | Slot 1 | Slot 2 | Slot 3 |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| coverage_hi | -1.181 `[-1.480, -0.882]` | 2915 | -0.71 `[-1.30, -0.12]` | -1.47 `[-2.08, -0.86]` | -1.02 `[-1.60, -0.45]` | -1.52 `[-2.14, -0.90]` (mcnemar) |
| coverage_lo | +1.083 `[+0.766, +1.400]` | 3124 | +1.52 `[+0.91, +2.14]` | +1.39 `[+0.78, +2.00]` | +0.67 `[+0.02, +1.32]` | +0.76 `[+0.12, +1.39]` |
| covscarcity_hi | -0.056 `[-0.262, +0.151]` | 1324 | +0.17 `[-0.25, +0.59]` | +0.13 `[-0.28, +0.55]` | -0.11 `[-0.53, +0.30]` | -0.41 `[-0.82, -0.01]` (mcnemar) |
| covscarcity_lo | +0.139 `[-0.005, +0.283]` | 670 | +0.14 `[-0.12, +0.41]` | +0.16 `[-0.14, +0.45]` | +0.12 `[-0.19, +0.43]` | +0.13 `[-0.16, +0.42]` |
| diversity_hi | +0.667 `[+0.314, +1.019]` | 4004 | +1.14 `[+0.43, +1.86]` | +0.76 `[+0.03, +1.48]` | +0.73 `[+0.03, +1.43]` | +0.03 `[-0.65, +0.72]` |
| diversity_lo | -0.925 `[-1.245, -0.605]` | 3269 | -0.80 `[-1.44, -0.16]` | -1.20 `[-1.83, -0.57]` | -0.98 `[-1.61, -0.35]` | -0.72 `[-1.37, -0.07]` |
| expansion_hi | -0.453 `[-0.763, -0.142]` | 3133 | +0.44 `[-0.20, +1.09]` | -0.61 `[-1.27, +0.04]` | -0.44 `[-1.08, +0.19]` | -1.20 `[-1.77, -0.63]` |
| expansion_lo | -0.717 `[-1.182, -0.252]` | 7282 | -0.03 `[-0.95, +0.88]` (mcnemar) | -1.39 `[-2.32, -0.46]` | -0.22 `[-1.13, +0.69]` | -1.22 `[-2.21, -0.23]` |
| port_hi | -2.283 `[-2.727, -1.840]` | 6170 | -2.04 `[-2.94, -1.15]` | -3.01 `[-3.94, -2.09]` | -2.21 `[-3.08, -1.35]` | -1.87 `[-2.71, -1.02]` |
| port_lo | -0.025 `[-0.299, +0.249]` | 2529 | +0.21 `[-0.35, +0.77]` | +0.23 `[-0.33, +0.80]` | -0.19 `[-0.73, +0.35]` | -0.36 `[-0.94, +0.22]` |
| scarcity_hi | -0.175 `[-0.510, +0.160]` | 3561 | +0.51 `[-0.18, +1.20]` | +0.13 `[-0.54, +0.81]` | -0.43 `[-1.10, +0.24]` | -0.91 `[-1.55, -0.27]` |
| scarcity_lo | +0.144 `[-0.106, +0.394]` | 2044 | +0.17 `[-0.33, +0.66]` | +0.21 `[-0.31, +0.73]` | -0.08 `[-0.58, +0.43]` | +0.28 `[-0.22, +0.77]` |

Retry:

| Arm | pp estimate [interval] | discordant | Slot 0 | Slot 1 | Slot 2 | Slot 3 |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| diversity_hi | +0.565 `[+0.386, +0.743]` | 16299 | +0.72 `[+0.35, +1.09]` | +0.73 `[+0.37, +1.10]` | +0.41 `[+0.06, +0.77]` | +0.39 `[+0.05, +0.74]` |

Per-seat `n` sums to the pooled `n` and per-seat `b + c` to the pooled `b + c` in every row; the reader asserts both.

**One arm survives: `coverage_lo`, `coverageExponent` 1.5 to 1.0.** It read `+1.083pp` on `[+0.766pp, +1.400pp]` over 3,124 discordant units of 36,000, the whole interval above the `+0.5pp` bar, and its mirror image agrees: `coverage_hi` at 2.25 read `-1.181pp` on `[-1.480pp, -0.882pp]`, `worse`. Two arms on one axis reading opposite signs of about the same size is the cleanest dose-response in the screen. The exponent sets how steeply coverage credit falls off for thin production, and at 1.0 the credit is linear, so a lone low-pip hex of a missing resource earns its proportional share. Every slot is positive, larger at the two early slots. M-38 read this same value `equivalent` at `-0.04pp` on the Phase-H field, which was a greedy formula-only field; nothing from that entry transfers to this one, and the two readings together say only that the answer changed with the field.

**`diversity_hi` is dropped unresolved, the way `robberConcentrationWeight` was in M-62.** `+0.667pp` on `[+0.314pp, +1.019pp]` at the screen, `inconclusive` with an estimate above the `+0.25pp` retry line, then `+0.565pp` on `[+0.386pp, +0.743pp]` on 144,000 units, `inconclusive` again with the bar inside the interval. The sign is settled and positive. `diversity_lo` read `-0.925pp`, `worse`, so this axis has a slope too. M-62 read three times the live weight at `+0.302pp`; twice the weight reads higher here, on a different seed generation and a field that has since adopted `expansionWeight`, and this entry does not explain the difference.

**The calibration reading has the right sign and a smaller size than the readings that adopted the term.** `expansion_lo` removes `expansionWeight` and read `-0.717pp` on `[-1.182pp, -0.252pp]`, `inconclusive`, on the widest interval in the screen. M-66 read the term's addition at `+1.097pp`; the two are not the same contrast, since here three field seats and the hero's opponent model all carry the term and there none did. `expansion_hi` at 0.3 read `-0.453pp`, also `inconclusive` and negative, so 0.1 sits above both its neighbours on a third seed generation.

**`port_hi` is the strongest reading in the screen and it is negative.** Doubling `portWeight` cost `-2.283pp` on `[-2.727pp, -1.840pp]`, negative at every slot, while halving it read `-0.025pp`, `equivalent`. At four seats with player trading the port term is, if anything, already generous.

**Disposition, per arm, by the preregistered rule.** `coverage_lo`: survives. `coverage_hi`, `diversity_lo`, `port_hi`: dropped, `worse`. `covscarcity_lo`, `covscarcity_hi`, `port_lo`, `scarcity_lo`: dropped, `equivalent`. `scarcity_hi`, `expansion_lo`, `expansion_hi`: dropped unresolved, `inconclusive` with negative estimates, which buy no retry. `diversity_hi`: retried, `inconclusive` again, dropped unresolved. One survivor, so no combine pass: **the four-seat candidate is `simulator/placement/arms/sc_coverage_lo.json`** and it goes to `eval3`.

**Prediction against outcome.** **Wrong on the headline**: predicted no survivor at about 90%, delivered one. **Right on `expansion_lo`**, predicted `-1.3pp` to `-0.5pp` and `worse` or `inconclusive`, delivered `-0.717pp` `inconclusive`. **Right on `expansion_hi`**, predicted `-0.9pp` to `0pp`, delivered `-0.453pp`. **Right on `diversity_lo`**, predicted `-1.0pp` to `0pp`, delivered `-0.925pp`. **Wrong on `diversity_hi`**, predicted `-0.2pp` to `+0.5pp` and `equivalent`, delivered `+0.667pp` then `+0.565pp`, `inconclusive` twice. **Right on five of the eight scarcity, coverage-scarcity and port arms and wrong on three**: both `scarcityWeight` arms, both `coverageScarcityWeight` arms and `port_lo` landed inside `+/-0.5pp` as predicted, while `coverage_lo`, `coverage_hi` and `port_hi` landed well outside it. The prediction named `port_hi` and `coverage_lo` as the two arms the Phase-H argument was least to be trusted on, and those are two of the three it got wrong.

**Scope, and what this entry may not be cited for.** One layout, one seat count, one policy, one domain, twelve single-parameter contrasts with no multiplicity correction, at a power the wall-time cap set below the programme's target. Each arm moves the hero's weights alone against three seats on today's vector. The greedy opponent model inside every hero is the one M-61 measured at 39.4% of intervening picks named exactly, so no verdict here may be described as taken against a correctly specified model. Both expansion arms move the setup road as well as the settlement. A `better` on `tuning3` is a screening result: it sends one vector to `eval3` and decides nothing about what ships. Nothing here transfers to another seat count.

## M-68: 4-seat confirmation on eval3

2026-10-10, commit `34921fd3` (the preregistration commit; no default moved for this run), domain `eval3` (seed `16691289016504815632`). Preregistered in `docs/plans/preregs/2026-10-10-m68-seats4-eval3.md` (committed before the run). **This run is the one authorized `eval3` spend at 4 seats**, under the user's 2026-10-10 authorization quoted in `.claude/specs/simulator/seat-count-programme.md`; no further `eval3` command may run on `standard4` at 4 seats.

`evaluate`, `standard4`, 4 seats, field `app_formula_draft:placement/default-weights.json@placement/default-weights.json`, every seat on `heuristic-v1-trader-aware-threat-devcards-denial` with `--player-trading`, `--threads 0`, 18,000 boards x 2 reps, 144,000 paired units, `--threshold 0.005`, `--alpha 0.05`, run from `simulator/`. Reference `base` is the field spec; `candidate` carries `simulator/placement/arms/sc_coverage_lo.json` on the hero path with the opponent path pinned to the field's weights.

```text
RUSTFLAGS="-D warnings" cargo build --release --manifest-path simulator/Cargo.toml -p unsettled-sim

# the single invocation, from simulator/
target/release/unsettled-sim evaluate --layout standard4 --seats 4 --domain eval3 --field app_formula_draft:placement/default-weights.json@placement/default-weights.json --arm base=app_formula_draft:placement/default-weights.json@placement/default-weights.json --arm candidate=app_formula_draft:placement/arms/sc_coverage_lo.json@placement/default-weights.json --reference base --boards 18000 --reps 2 --policy heuristic-v1-trader-aware-threat-devcards-denial --threads 0 --player-trading --threshold 0.005 --alpha 0.05 --out runs/m68-seats4-eval3
```

**Provenance and admissibility.** The release binary was rebuilt with `RUSTFLAGS="-D warnings"` in its own command block and reported `Finished` in 0.03s against a warm fingerprint. The invocation ran alone in its command block, unpiped. `rustc 1.94.0 (4a4ef493e 2026-03-02)`. It reported domain `eval3` at seed `16691289016504815632`, as preregistered. **Zero illegal actions**, and 0 draws in `base` and 0 in `candidate`. Load before `13.33 29.08 33.82`, after `21.03 40.17 40.44`, other sessions sharing the machine; 1007.176s at 18 workers, 285.9 games/s, 288,000 games. `base` won 35,775 of 144,000 (`0.2484375`), 1.369 binomial standard errors below the `0.25` corner and inside the preregistered 3.29, so the corner check passes. `candidate` won 37,182 of 144,000 (`0.2582083333333333`). `simulator/runs/` is gitignored, so this entry is the record.

Pooled, reference `base`:

| Arm | Estimate | b | c | McNemar | Clustered | Selected | Half-width pp | Verdict |
| --- | ---: | ---: | ---: | --- | --- | --- | ---: | --- |
| candidate | `0.009770833333333333` | 6867 | 5460 | `[0.0082605, 0.0112812]` | `[0.0082251, 0.0113166]` | clustered `[0.0082251, 0.0113166]` | 0.1546 | better |

Per-hero-seat, record only; hero seat equals draft slot. Percentage points:

| Arm | pp estimate [interval] | discordant | Slot 0 | Slot 1 | Slot 2 | Slot 3 |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| candidate | +0.977 `[+0.823, +1.132]` | 12327 | +0.67 `[+0.38, +0.96]` | +0.96 `[+0.64, +1.27]` | +1.31 `[+0.99, +1.62]` | +0.97 `[+0.65, +1.29]` |

**The verdict is `better`, so the candidate goes to the gate.** `+0.977pp` on `[+0.823pp, +1.132pp]` over 12,327 discordant units of 144,000, the whole interval above the `+0.5pp` bar with 0.323pp to spare at the lower edge. The screen in M-67 read `+1.083pp` on 36,000 `tuning3` units, so the estimate shrank by about a tenth of a point on seeds it was not selected on, which is the size of shrinkage a pick of the best of twelve should show and no more. The discordant share is 8.56% here against 8.68% on the screen: the arm changes the pick at the same rate on boards it has never seen. Every slot is positive and every slot interval excludes zero.

**One deviation of form, with no effect on the reading.** The invocation was first launched in the same shell command as the warm rebuild, which the preregistration forbids. That process was killed seconds after it started, before it wrote any artifact, and the identical command was relaunched alone. Nothing was read from the killed process and the run is deterministic, so the reading above is the only one that exists.

**Prediction against outcome.** **Right on the estimate**, predicted `+0.4pp` to `+1.3pp` centred near `+0.85pp`, delivered `+0.977pp`. **Right on the verdict**, predicted `better` at about 75%. **Right on the half-width**, predicted about `+/-0.16pp`, delivered `+/-0.155pp`.

**Scope, and what this entry may not be cited for.** One contrast, one layout, one seat count, one policy, one domain, one spend. The arm moves the hero's weights alone against three seats on today's vector. The greedy opponent model inside every hero is the one M-61 measured as misspecified against a draft-aware field, so the verdict may not be described as taken against a correctly specified model, and the field is the same here as on `tuning3`, so this run controls for seeds and not for field-overfit. A `better` here confirms the screen and decides nothing about what ships; that is M-69's question on `gate3`.

## M-69: 4-seat adoption gate on gate3

2026-10-10, commit `3d554d14` (the preregistration commit; no default moved for this run), domain `gate3` (seed `7670578962881712144`). Preregistered in `docs/plans/preregs/2026-10-10-m69-seats4-gate3.md` (committed before the run). **This run is the one authorized `gate3` spend at 4 seats**, under the user's 2026-10-10 authorization quoted in `.claude/specs/simulator/seat-count-programme.md`; no further `gate3` command may run on `standard4` at 4 seats.

`evaluate`, `standard4`, 4 seats, field `app_formula_draft:placement/default-weights.json@placement/default-weights.json`, every seat on `heuristic-v1-trader-aware-threat-devcards-denial` with `--player-trading`, `--threads 0`, 18,000 boards x 2 reps, 144,000 paired units, `--threshold 0.005`, `--alpha 0.05`, run from `simulator/`. Reference `base` is the field spec; `candidate` carries `simulator/placement/arms/sc_coverage_lo.json` on the hero path with the opponent path pinned to the field's weights.

```text
RUSTFLAGS="-D warnings" cargo build --release --manifest-path simulator/Cargo.toml -p unsettled-sim

# the single invocation, from simulator/
target/release/unsettled-sim evaluate --layout standard4 --seats 4 --domain gate3 --field app_formula_draft:placement/default-weights.json@placement/default-weights.json --arm base=app_formula_draft:placement/default-weights.json@placement/default-weights.json --arm candidate=app_formula_draft:placement/arms/sc_coverage_lo.json@placement/default-weights.json --reference base --boards 18000 --reps 2 --policy heuristic-v1-trader-aware-threat-devcards-denial --threads 0 --player-trading --threshold 0.005 --alpha 0.05 --out runs/m69-seats4-gate3
```

**Provenance and admissibility.** The release binary was rebuilt with `RUSTFLAGS="-D warnings"` in its own command block and reported `Finished` in 0.10s against a warm fingerprint. The invocation ran alone in its command block, unpiped. `rustc 1.94.0 (4a4ef493e 2026-03-02)`. It reported domain `gate3` at seed `7670578962881712144`, as preregistered. **Zero illegal actions**, and 0 draws in `base` and 0 in `candidate`. Load before `10.35 32.93 37.68`, after `27.88 40.43 41.38`, other sessions sharing the machine; 1077.737s at 18 workers, 267.2 games/s, 288,000 games. `base` won 36,105 of 144,000 (`0.25072916666666667`), 0.639 binomial standard errors above the `0.25` corner and inside the preregistered 3.29, so the corner check passes. `candidate` won 37,321 of 144,000 (`0.2591736111111111`). `simulator/runs/` is gitignored, so this entry is the record.

Pooled, reference `base`:

| Arm | Estimate | b | c | McNemar | Clustered | Selected | Half-width pp | Verdict |
| --- | ---: | ---: | ---: | --- | --- | --- | ---: | --- |
| candidate | `0.008444444444444444` | 6612 | 5396 | `[0.0069536, 0.0099353]` | `[0.0069174, 0.0099714]` | clustered `[0.0069174, 0.0099714]` | 0.1527 | better |

Per-hero-seat, record only; hero seat equals draft slot. Percentage points:

| Arm | pp estimate [interval] | discordant | Slot 0 | Slot 1 | Slot 2 | Slot 3 |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| candidate | +0.844 `[+0.692, +0.997]` | 12008 | +0.56 `[+0.27, +0.84]` | +1.00 `[+0.69, +1.31]` | +0.88 `[+0.56, +1.19]` | +0.94 `[+0.63, +1.26]` |

**The verdict is `better`, and it adopts the candidate as the four-seat vector.** `+0.844pp` on `[+0.692pp, +0.997pp]` over 12,008 discordant units of 144,000, the whole interval above the `+0.5pp` bar with 0.192pp to spare at the lower edge. By the preregistered rule `coverageExponent` moves from 1.5 to 1.0 for four-seat rosters: `SEAT_WEIGHT_OVERRIDES[4]` in `src/engine/weights.ts` carries the leaf, `simulator/placement/seat-weights/seats-4.json` is regenerated through `simulator/tools/generate-placement-parity.ts`, and the `SEAT_ADOPTIONS` row in `params_file.rs` moves with it. `DEFAULT_WEIGHTS` and `default-weights.json` do not move, so the 2, 3, 5 and 6 seat vectors and the field every remaining run is measured against are unchanged.

**Three readings on three disjoint seed sets agree on the size.** `+1.083pp` on the 36,000-unit `tuning3` screen, `+0.977pp` on 144,000 `eval3` units and `+0.844pp` here. The first was selected as the best of twelve and should be discounted; inverse-variance weighting the two held-out readings alone gives about `+0.91pp` over 288,000 paired units. The discordant share is 8.34% here against 8.56% on `eval3` and 8.68% on the screen. Every slot is positive and every slot interval excludes zero, with the first slot the smallest on both held-out domains.

**Prediction against outcome.** **Right on the estimate**, predicted `+0.6pp` to `+1.3pp` centred near `+0.95pp`, delivered `+0.844pp`, in the lower half of the range. **Right on the verdict**, predicted `better` at about 95%.

**Scope, and what this entry may not be cited for.** One contrast, one layout, one seat count, one policy, one domain, one spend. The arm moves the hero's weights alone against three seats on today's vector, so **nothing here measures the world the adoption creates in the app**, where a four-seat analysis scores every seat's picks on the adopted vector. The greedy opponent model inside every hero is the one M-61 measured as misspecified against a draft-aware field, so the verdict may not be described as taken against a correctly specified model. The field is the same on all three domains, so the held-out readings control for seeds and not for field-overfit: the adopted value is a default for this simulator's composite policy against this field. The value 1.0 is the lower endpoint of the key's range in `sweep-bounds.json` and its mirror arm at 2.25 read `worse` in M-67, so the response was still rising at the bound; nothing here says 1.0 is the optimum, and probing below it means re-bracketing the range first. The verdict licenses moving this one leaf at this one seat count and nothing else.

## M-70: seat-count screen at 2 seats

2026-10-10, commit `904ee1c8` (the preregistration commit; no default moved for this run), domain `tuning3` (seed `8796478869724336144`). Preregistered in `docs/plans/preregs/2026-10-10-m70-seats2-screen.md` (committed before the pilot). The first placement reading ever taken at two seats: does any of the twelve `sc_*` arms beat today's vector there?

`evaluate`, `standard4`, 2 seats, field `app_formula_draft:placement/default-weights.json@placement/default-weights.json`, every seat on `heuristic-v1-trader-aware-threat-devcards-denial`, no `--player-trading` so only bank and port trades exist, `--allow-unofficial`, `--threads 0`, 2 reps, `--threshold 0.005`, `--alpha 0.05`, run from `simulator/`. Reference `base` is the field spec itself, except in the combine pass, where the reference is the combined vector. Each arm carries one `simulator/placement/arms/sc_*.json` on the hero path with the opponent path pinned to the field's weights; the arm values are M-67's.

```text
RUSTFLAGS="-D warnings" cargo build --release --manifest-path simulator/Cargo.toml -p unsettled-sim

# pilot, from simulator/, read blind
target/release/unsettled-sim evaluate --layout standard4 --seats 2 --domain tuning3 --field app_formula_draft:placement/default-weights.json@placement/default-weights.json --arm base=app_formula_draft:placement/default-weights.json@placement/default-weights.json --arm scarcity_lo=app_formula_draft:placement/arms/sc_scarcity_lo.json@placement/default-weights.json --arm scarcity_hi=app_formula_draft:placement/arms/sc_scarcity_hi.json@placement/default-weights.json --arm covscarcity_lo=app_formula_draft:placement/arms/sc_covscarcity_lo.json@placement/default-weights.json --arm covscarcity_hi=app_formula_draft:placement/arms/sc_covscarcity_hi.json@placement/default-weights.json --arm coverage_lo=app_formula_draft:placement/arms/sc_coverage_lo.json@placement/default-weights.json --arm coverage_hi=app_formula_draft:placement/arms/sc_coverage_hi.json@placement/default-weights.json --arm diversity_lo=app_formula_draft:placement/arms/sc_diversity_lo.json@placement/default-weights.json --arm diversity_hi=app_formula_draft:placement/arms/sc_diversity_hi.json@placement/default-weights.json --arm port_lo=app_formula_draft:placement/arms/sc_port_lo.json@placement/default-weights.json --arm port_hi=app_formula_draft:placement/arms/sc_port_hi.json@placement/default-weights.json --arm expansion_lo=app_formula_draft:placement/arms/sc_expansion_lo.json@placement/default-weights.json --arm expansion_hi=app_formula_draft:placement/arms/sc_expansion_hi.json@placement/default-weights.json --reference base --boards 400 --reps 2 --policy heuristic-v1-trader-aware-threat-devcards-denial --threads 0 --allow-unofficial --threshold 0.005 --alpha 0.05 --out runs/m70-seats2-pilot

# screen, from simulator/: the pilot's command with --boards 17500 --out runs/m70-seats2-screen

# retry, from simulator/
target/release/unsettled-sim evaluate --layout standard4 --seats 2 --domain tuning3 --field app_formula_draft:placement/default-weights.json@placement/default-weights.json --arm base=app_formula_draft:placement/default-weights.json@placement/default-weights.json --arm port_lo=app_formula_draft:placement/arms/sc_port_lo.json@placement/default-weights.json --arm scarcity_lo=app_formula_draft:placement/arms/sc_scarcity_lo.json@placement/default-weights.json --reference base --boards 70000 --reps 2 --policy heuristic-v1-trader-aware-threat-devcards-denial --threads 0 --allow-unofficial --threshold 0.005 --alpha 0.05 --out runs/m70-seats2-retry

# combine pass, from simulator/, at commit a0a199fd
target/release/unsettled-sim evaluate --layout standard4 --seats 2 --domain tuning3 --field app_formula_draft:placement/default-weights.json@placement/default-weights.json --arm combined=app_formula_draft:placement/arms/sc_s2_combined.json@placement/default-weights.json --arm base=app_formula_draft:placement/default-weights.json@placement/default-weights.json --arm coverage_lo=app_formula_draft:placement/arms/sc_coverage_lo.json@placement/default-weights.json --arm diversity_hi=app_formula_draft:placement/arms/sc_diversity_hi.json@placement/default-weights.json --reference combined --boards 17500 --reps 2 --policy heuristic-v1-trader-aware-threat-devcards-denial --threads 0 --allow-unofficial --threshold 0.005 --alpha 0.05 --out runs/m70-seats2-combine
```

**Provenance and admissibility.** The release binary was rebuilt with `RUSTFLAGS="-D warnings"` in its own command block after the four-seat adoption commit and reported `Finished` in 0.03s on the warm check; the pilot, screen and retry used it. It was rebuilt again after `a0a199fd`, which changed test code only, and reported `Finished` in 0.04s on the warm check before the combine pass. `rustc 1.94.0 (4a4ef493e 2026-03-02)`. Each invocation ran alone in its command block, unpiped, one after another, and each reported domain `tuning3` at seed `8796478869724336144`. **Zero illegal actions in all four, and zero draws in every arm.** `simulator/runs/` is gitignored, so this entry is the record. Other sessions shared the machine, so the throughputs are contended figures.

Pilot, 400 boards: load before `11.34 17.33 28.95`, after `16.24 18.05 28.87`; 22.810s at 18 workers, 911.9 games/s, 20,800 games. **Read blind**: only the wall time, the illegal-action count and each arm's half-width and discordant share were printed.

Sizing: the widest pilot half-width was `port_hi` at 2.2862pp, so the 0.35pp target wanted 17,067 boards, rounded up to **`B` = 17500**; the 30-minute cap allowed 31,565, so the target bound and the cap did not. The pilot predicted a widest half-width of 0.346pp at that size.

Screen, 17500 boards, 70,000 paired units over 17,500 clusters: load before `14.98 17.72 28.63`, after `39.05 39.59 37.33`; 998.999s, 910.9 games/s, 910,000 games. `base` won 34,995 of 70,000 (`0.49992857142857144`), 0.038 binomial standard errors below the 0.5 corner; the corner check passes.

Retry, 70000 boards, 280,000 paired units, carrying `base`, `port_lo` and `scarcity_lo`: load before `31.55 37.91 36.77`, after `26.78 30.38 32.66`; 888.135s, 945.8 games/s, 840,000 games. `base` won 140,191 of 280,000 (`0.5006821428571429`), 0.722 standard errors above the corner; the check passes.

Combine pass, 17500 boards, 70,000 paired units, reference `combined` (`simulator/placement/arms/sc_s2_combined.json`, the live defaults with `coverageExponent` 1.0 and `diversityWeight` 3.2), arms `base`, `coverage_lo` and `diversity_hi`: load before `7.62 6.85 7.13`, after `26.10 25.91 16.77`; 356.848s, 784.6 games/s, 280,000 games. Its boards are the screen's, so `base`, `coverage_lo` and `diversity_hi` reproduce their screen win counts exactly (34,995, 35,547 and 35,929), and the corner check on `base` is the screen's. `combined` won 36,846 of 70,000 (`0.5263714285714286`).

Screen, pooled, reference `base`:

| Arm | Estimate | b | c | McNemar | Clustered | Selected | Half-width pp | Verdict |
| --- | ---: | ---: | ---: | --- | --- | --- | ---: | --- |
| coverage_hi | `-0.012228571428571429` | 2381 | 3237 | `[-0.0143253, -0.0101319]` | `[-0.0144173, -0.0100399]` | clustered `[-0.0144173, -0.0100399]` | 0.2189 | worse |
| coverage_lo | `0.007885714285714286` | 2975 | 2423 | `[0.0058294, 0.0099420]` | `[0.0057429, 0.0100285]` | clustered `[0.0057429, 0.0100285]` | 0.2143 | better |
| covscarcity_hi | `-0.0054` | 983 | 1361 | `[-0.0067550, -0.0040450]` | `[-0.0068370, -0.0039630]` | clustered `[-0.0068370, -0.0039630]` | 0.1437 | inconclusive |
| covscarcity_lo | `0.002142857142857143` | 674 | 524 | `[0.0011739, 0.0031118]` | `[0.0011338, 0.0031519]` | clustered `[0.0011338, 0.0031519]` | 0.1009 | equivalent |
| diversity_hi | `0.013342857142857142` | 5043 | 4109 | `[0.0106661, 0.0160196]` | `[0.0105670, 0.0161187]` | clustered `[0.0105670, 0.0161187]` | 0.2776 | better |
| diversity_lo | `-0.021342857142857143` | 2933 | 4427 | `[-0.0237397, -0.0189460]` | `[-0.0238642, -0.0188215]` | clustered `[-0.0238642, -0.0188215]` | 0.2521 | worse |
| expansion_hi | `-0.012314285714285715` | 2851 | 3713 | `[-0.0145809, -0.0100476]` | `[-0.0147016, -0.0099269]` | clustered `[-0.0147016, -0.0099269]` | 0.2387 | worse |
| expansion_lo | `-0.003457142857142857` | 6444 | 6686 | `[-0.0066654, -0.0002489]` | `[-0.0067055, -0.0002088]` | clustered `[-0.0067055, -0.0002088]` | 0.3248 | inconclusive |
| port_hi | `-0.03791428571428571` | 5271 | 7925 | `[-0.0411184, -0.0347102]` | `[-0.0412845, -0.0345441]` | clustered `[-0.0412845, -0.0345441]` | 0.3370 | worse |
| port_lo | `0.003742857142857143` | 2678 | 2416 | `[0.0017447, 0.0057411]` | `[0.0016516, 0.0058341]` | clustered `[0.0016516, 0.0058341]` | 0.2091 | inconclusive |
| scarcity_hi | `-0.013771428571428572` | 3194 | 4158 | `[-0.0161700, -0.0113728]` | `[-0.0162900, -0.0112528]` | clustered `[-0.0162900, -0.0112528]` | 0.2519 | worse |
| scarcity_lo | `0.0036` | 2131 | 1879 | `[0.0018271, 0.0053729]` | `[0.0017630, 0.0054370]` | clustered `[0.0017630, 0.0054370]` | 0.1837 | inconclusive |

Retry, pooled, reference `base`:

| Arm | Estimate | b | c | McNemar | Clustered | Selected | Half-width pp | Verdict |
| --- | ---: | ---: | ---: | --- | --- | --- | ---: | --- |
| port_lo | `0.0026357142857142855` | 10333 | 9595 | `[0.0016476, 0.0036238]` | `[0.0016092, 0.0036622]` | clustered `[0.0016092, 0.0036622]` | 0.1026 | equivalent |
| scarcity_lo | `0.003867857142857143` | 8601 | 7518 | `[0.0029793, 0.0047564]` | `[0.0029395, 0.0047962]` | clustered `[0.0029395, 0.0047962]` | 0.0928 | equivalent |

Combine pass, pooled, **reference `combined`**, so a negative estimate says the combined vector beats that arm:

| Arm | Estimate | b | c | McNemar | Clustered | Selected | Half-width pp | Verdict |
| --- | ---: | ---: | ---: | --- | --- | --- | ---: | --- |
| base | `-0.026442857142857143` | 4247 | 6098 | `[-0.0292840, -0.0236018]` | `[-0.0294060, -0.0234797]` | clustered `[-0.0294060, -0.0234797]` | 0.2963 | worse |
| coverage_lo | `-0.01855714285714286` | 3835 | 5134 | `[-0.0212053, -0.0159090]` | `[-0.0213274, -0.0157869]` | clustered `[-0.0213274, -0.0157869]` | 0.2770 | worse |
| diversity_hi | `-0.0131` | 2621 | 3538 | `[-0.0152952, -0.0109048]` | `[-0.0153656, -0.0108344]` | clustered `[-0.0153656, -0.0108344]` | 0.2266 | worse |

Per-hero-seat tables, record only; hero seat equals draft slot. Percentage points. Screen:

| Arm | pp estimate [interval] | discordant | Slot 0 | Slot 1 |
| --- | --- | ---: | ---: | ---: |
| coverage_hi | -1.223 `[-1.442, -1.004]` | 5618 | -1.47 `[-1.78, -1.17]` | -0.97 `[-1.29, -0.65]` |
| coverage_lo | +0.789 `[+0.574, +1.003]` | 5398 | +0.52 `[+0.23, +0.81]` | +1.06 `[+0.74, +1.38]` |
| covscarcity_hi | -0.540 `[-0.684, -0.396]` | 2344 | -0.63 `[-0.84, -0.43]` | -0.45 `[-0.65, -0.25]` |
| covscarcity_lo | +0.214 `[+0.113, +0.315]` | 1198 | +0.18 `[+0.04, +0.32]` | +0.25 `[+0.10, +0.40]` |
| diversity_hi | +1.334 `[+1.057, +1.612]` | 9152 | +1.45 `[+1.05, +1.86]` | +1.21 `[+0.83, +1.60]` |
| diversity_lo | -2.134 `[-2.386, -1.882]` | 7360 | -2.54 `[-2.90, -2.18]` | -1.73 `[-2.08, -1.37]` |
| expansion_hi | -1.231 `[-1.470, -0.993]` | 6564 | -1.78 `[-2.15, -1.41]` | -0.68 `[-1.00, -0.37]` |
| expansion_lo | -0.346 `[-0.671, -0.021]` | 13130 | -0.37 `[-0.79, +0.06]` | -0.33 `[-0.82, +0.17]` |
| port_hi | -3.791 `[-4.128, -3.454]` | 13196 | -4.69 `[-5.18, -4.21]` | -2.89 `[-3.36, -2.42]` |
| port_lo | +0.374 `[+0.165, +0.583]` | 5094 | +0.30 `[+0.00, +0.60]` | +0.45 `[+0.15, +0.74]` |
| scarcity_hi | -1.377 `[-1.629, -1.125]` | 7352 | -1.61 `[-1.98, -1.25]` | -1.14 `[-1.49, -0.79]` |
| scarcity_lo | +0.360 `[+0.176, +0.544]` | 4010 | +0.26 `[-0.00, +0.53]` | +0.46 `[+0.20, +0.71]` |

Retry:

| Arm | pp estimate [interval] | discordant | Slot 0 | Slot 1 |
| --- | --- | ---: | ---: | ---: |
| port_lo | +0.264 `[+0.161, +0.366]` | 19928 | +0.30 `[+0.15, +0.44]` | +0.23 `[+0.09, +0.38]` |
| scarcity_lo | +0.387 `[+0.294, +0.480]` | 16119 | +0.31 `[+0.18, +0.44]` | +0.47 `[+0.33, +0.60]` |

Combine pass, reference `combined`:

| Arm | pp estimate [interval] | discordant | Slot 0 | Slot 1 |
| --- | --- | ---: | ---: | ---: |
| base | -2.644 `[-2.941, -2.348]` | 10345 | -2.67 `[-3.10, -2.25]` | -2.61 `[-3.04, -2.19]` |
| coverage_lo | -1.856 `[-2.133, -1.579]` | 8969 | -2.15 `[-2.55, -1.75]` | -1.56 `[-1.94, -1.17]` |
| diversity_hi | -1.310 `[-1.537, -1.083]` | 6159 | -1.22 `[-1.53, -0.91]` | -1.40 `[-1.73, -1.07]` |

**Two axes survive, and they are the two that moved at four seats.** `coverage_lo` read `+0.789pp` on `[+0.574pp, +1.003pp]` and `diversity_hi` read `+1.334pp` on `[+1.057pp, +1.612pp]`, both `better`, and each axis's other arm reads the opposite sign: `coverage_hi` `-1.223pp` and `diversity_lo` `-2.134pp`, both `worse`. `diversity_hi` was the arm M-67 retried and dropped unresolved at four seats at about `+0.57pp`; with no player trading it reads more than twice that.

**The two changes stack.** Against the combined vector, removing the coverage change (leaving `diversity_hi`) reads `-1.310pp`, `worse`, and removing the diversity change (leaving `coverage_lo`) reads `-1.856pp`, `worse`, so by the preregistered rule neither axis is dropped. `base` reads `-2.644pp` on `[-2.941pp, -2.348pp]` against the combined vector, `worse`, which is the combined vector reading `better` against `base` with the whole interval beyond the `0.5pp` bar. The two single-arm estimates sum to `+2.123pp`, so the pair is worth about half a point more together than apart. **The two-seat candidate is `simulator/placement/arms/sc_s2_combined.json`** and it goes to `eval3`.

**Both retried arms read `equivalent`, on intervals that exclude zero.** `port_lo` read `+0.374pp` at the screen and `+0.264pp` on `[+0.161pp, +0.366pp]` at the retry; `scarcity_lo` read `+0.360pp` and then `+0.387pp` on `[+0.294pp, +0.480pp]`. Both are real and both are under the half-point bar, so both are dropped with that answer. `covscarcity_lo` read `+0.214pp`, `equivalent`, the same way.

**Every arm that raises a weight other than diversity reads negative, and `port_hi` is the largest effect in the programme so far.** Doubling `portWeight` cost `-3.791pp` on `[-4.128pp, -3.454pp]`, at a seat count where ports are the only way to trade. `scarcity_hi` read `-1.377pp`, `expansion_hi` `-1.231pp` and `coverage_hi` `-1.223pp`, all `worse`. `covscarcity_hi` read `-0.540pp` on `[-0.684pp, -0.396pp]`, `inconclusive` with a negative estimate.

**`expansion_lo` is the least settled arm.** Removing `expansionWeight` read `-0.346pp` on `[-0.671pp, -0.021pp]`, `inconclusive`, on 13,130 discordant units, about as many as `port_hi`'s 13,196. The term changes the pick on almost a fifth of units at two seats and wins barely more than half of them.

**Disposition, per arm, by the preregistered rule.** `coverage_lo`, `diversity_hi`: survive. `coverage_hi`, `diversity_lo`, `expansion_hi`, `port_hi`, `scarcity_hi`: dropped, `worse`. `covscarcity_lo`: dropped, `equivalent`. `covscarcity_hi`, `expansion_lo`: dropped unresolved, `inconclusive` with negative estimates. `port_lo`, `scarcity_lo`: retried, `equivalent`, dropped. Two surviving axes, so the combine pass ran, and both stay.

**Prediction against outcome.** **Right on `diversity_hi`**, predicted `0pp` to `+1.5pp`, delivered `+1.334pp`. **Right on `coverage_lo`**, predicted `0pp` to `+1.5pp`, delivered `+0.789pp`. **Right on `expansion_lo`**, predicted inside `+/-0.5pp`, delivered `-0.346pp`, and **right on `expansion_hi`**, predicted negative, delivered `-1.231pp`. **Wrong on `port_hi`, and wrong in sign**: predicted `0pp` to `+1.5pp` on the argument that ports are the only trade at two seats, delivered `-3.791pp`. The argument confused needing a port with needing the scorer to pay more for one; the live weight evidently already pays enough. **Wrong on `scarcity_hi`**, predicted inside `+/-0.5pp`, delivered `-1.377pp`, and **wrong by a hair on `covscarcity_hi`**, predicted inside `+/-0.5pp`, delivered `-0.540pp`. **Right on `scarcity_lo` and `covscarcity_lo`**, both inside `+/-0.5pp`. **Right that effects run larger than at four seats**, and right on two of the three arms named as likeliest survivors.

**Scope, and what this entry may not be cited for.** One layout, one seat count, one policy, one domain, twelve single-parameter contrasts and one combination with no multiplicity correction. Two seats is not an official player count and runs under `--allow-unofficial` on a board built for four. Each arm moves the hero's weights alone against one seat on today's vector, which was tuned at four seats. The greedy opponent model inside every hero was measured in M-61 at four seats only, so no verdict here may be described as taken against a correctly specified model. Both expansion arms move the setup road as well as the settlement. A `better` on `tuning3` is a screening result: it sends one vector to `eval3` and decides nothing about what ships. Nothing here transfers to another seat count.

## M-71: 2-seat confirmation on eval3

2026-10-10, commit `ee0fb1de` (the preregistration commit; no default moved for this run), domain `eval3` (seed `16691289016504815632`). Preregistered in `docs/plans/preregs/2026-10-10-m71-seats2-eval3.md` (committed before the run). **This run is the one authorized `eval3` spend at 2 seats**, under the user's 2026-10-10 authorization quoted in `.claude/specs/simulator/seat-count-programme.md`; no further `eval3` command may run on `standard4` at 2 seats.

`evaluate`, `standard4`, 2 seats, field `app_formula_draft:placement/default-weights.json@placement/default-weights.json`, every seat on `heuristic-v1-trader-aware-threat-devcards-denial` without `--player-trading` and with `--allow-unofficial`, `--threads 0`, 70,000 boards x 2 reps, 280,000 paired units, `--threshold 0.005`, `--alpha 0.05`, run from `simulator/`. Reference `base` is the field spec; `candidate` carries `simulator/placement/arms/sc_s2_combined.json` on the hero path with the opponent path pinned to the field's weights.

```text
RUSTFLAGS="-D warnings" cargo build --release --manifest-path simulator/Cargo.toml -p unsettled-sim

# the single invocation, from simulator/
target/release/unsettled-sim evaluate --layout standard4 --seats 2 --domain eval3 --field app_formula_draft:placement/default-weights.json@placement/default-weights.json --arm base=app_formula_draft:placement/default-weights.json@placement/default-weights.json --arm candidate=app_formula_draft:placement/arms/sc_s2_combined.json@placement/default-weights.json --reference base --boards 70000 --reps 2 --policy heuristic-v1-trader-aware-threat-devcards-denial --threads 0 --allow-unofficial --threshold 0.005 --alpha 0.05 --out runs/m71-seats2-eval3
```

**Provenance and admissibility.** The release binary was rebuilt with `RUSTFLAGS="-D warnings"` in its own command block and reported `Finished` in 0.08s against a warm fingerprint. The invocation ran alone in its command block, unpiped. `rustc 1.94.0 (4a4ef493e 2026-03-02)`. It reported domain `eval3` at seed `16691289016504815632`, as preregistered. **Zero illegal actions**, and 0 draws in `base` and 0 in `candidate`. Load before `12.33 21.80 15.94`, after `32.74 35.31 27.31`, other sessions sharing the machine; 629.775s at 18 workers, 889.2 games/s, 560,000 games. `base` won 140,013 of 280,000 (`0.5000464285714286`), 0.049 binomial standard errors above the `0.5` corner and inside the preregistered 3.29, so the corner check passes. `candidate` won 147,611 of 280,000 (`0.5271821428571428`). `simulator/runs/` is gitignored, so this entry is the record.

Pooled, reference `base`:

| Arm | Estimate | b | c | McNemar | Clustered | Selected | Half-width pp | Verdict |
| --- | ---: | ---: | ---: | --- | --- | --- | ---: | --- |
| candidate | `0.027135714285714287` | 24990 | 17392 | `[0.0256982, 0.0285733]` | `[0.0256465, 0.0286249]` | clustered `[0.0256465, 0.0286249]` | 0.1489 | better |

Per-hero-seat, record only; hero seat equals draft slot. Percentage points:

| Arm | pp estimate [interval] | discordant | Slot 0 | Slot 1 |
| --- | --- | ---: | ---: | ---: |
| candidate | +2.714 `[+2.565, +2.862]` | 42382 | +2.76 `[+2.55, +2.97]` | +2.66 `[+2.45, +2.88]` |

**The verdict is `better`, so the candidate goes to the gate.** `+2.714pp` on `[+2.565pp, +2.862pp]` over 42,382 discordant units of 280,000, the whole interval above the `+0.5pp` bar with about two points to spare. The combine pass in M-70 read the same contrast at `+2.644pp` on 70,000 `tuning3` units, so the estimate did not shrink on seeds it was not selected on; it rose by 0.07pp, well inside either interval. The discordant share is 15.1% here against 14.8% there. Both slots are positive and about equal.

**Prediction against outcome.** **Right on the estimate**, predicted `+1.7pp` to `+2.9pp` centred near `+2.3pp`, delivered `+2.714pp`, in the upper half of the range; the shrinkage I expected did not appear. **Right on the verdict**, predicted `better` at about 97%. **Right on the half-width**, predicted about `+/-0.15pp`, delivered `+/-0.149pp`.

**Scope, and what this entry may not be cited for.** One contrast, one layout, one seat count, one policy, one domain, one spend. Two seats is not an official player count and runs under `--allow-unofficial` on a board built for four, with bank and port trades only. The arm moves the hero's weights alone against one seat on today's vector. The greedy opponent model inside every hero was measured in M-61 at four seats only, so the verdict may not be described as taken against a correctly specified model, and the field is the same here as on `tuning3`, so this run controls for seeds and not for field-overfit. A `better` here confirms the screen and decides nothing about what ships; that is M-72's question on `gate3`.

## M-72: 2-seat adoption gate on gate3

2026-10-10, commit `300affcc` (the preregistration commit; no default moved for this run), domain `gate3` (seed `7670578962881712144`). Preregistered in `docs/plans/preregs/2026-10-10-m72-seats2-gate3.md` (committed before the run). **This run is the one authorized `gate3` spend at 2 seats**, under the user's 2026-10-10 authorization quoted in `.claude/specs/simulator/seat-count-programme.md`; no further `gate3` command may run on `standard4` at 2 seats.

`evaluate`, `standard4`, 2 seats, field `app_formula_draft:placement/default-weights.json@placement/default-weights.json`, every seat on `heuristic-v1-trader-aware-threat-devcards-denial` without `--player-trading` and with `--allow-unofficial`, `--threads 0`, 70,000 boards x 2 reps, 280,000 paired units, `--threshold 0.005`, `--alpha 0.05`, run from `simulator/`. Reference `base` is the field spec; `candidate` carries `simulator/placement/arms/sc_s2_combined.json` on the hero path with the opponent path pinned to the field's weights.

```text
RUSTFLAGS="-D warnings" cargo build --release --manifest-path simulator/Cargo.toml -p unsettled-sim

# the single invocation, from simulator/
target/release/unsettled-sim evaluate --layout standard4 --seats 2 --domain gate3 --field app_formula_draft:placement/default-weights.json@placement/default-weights.json --arm base=app_formula_draft:placement/default-weights.json@placement/default-weights.json --arm candidate=app_formula_draft:placement/arms/sc_s2_combined.json@placement/default-weights.json --reference base --boards 70000 --reps 2 --policy heuristic-v1-trader-aware-threat-devcards-denial --threads 0 --allow-unofficial --threshold 0.005 --alpha 0.05 --out runs/m72-seats2-gate3
```

**Provenance and admissibility.** The release binary was rebuilt with `RUSTFLAGS="-D warnings"` in its own command block and reported `Finished` in 0.07s against a warm fingerprint. The invocation ran alone in its command block, unpiped. `rustc 1.94.0 (4a4ef493e 2026-03-02)`. It reported domain `gate3` at seed `7670578962881712144`, as preregistered. **Zero illegal actions**, and 0 draws in `base` and 0 in `candidate`. Load before `23.24 32.86 26.66`, after `31.18 31.76 28.93`, other sessions sharing the machine; 591.622s at 18 workers, 946.6 games/s, 560,000 games. `base` won 139,921 of 280,000 (`0.49971785714285716`), 0.299 binomial standard errors below the `0.5` corner and inside the preregistered 3.29, so the corner check passes. `candidate` won 147,492 of 280,000 (`0.5267571428571428`). `simulator/runs/` is gitignored, so this entry is the record.

Pooled, reference `base`:

| Arm | Estimate | b | c | McNemar | Clustered | Selected | Half-width pp | Verdict |
| --- | ---: | ---: | ---: | --- | --- | --- | ---: | --- |
| candidate | `0.027039285714285714` | 25003 | 17432 | `[0.0256008, 0.0284778]` | `[0.0255427, 0.0285358]` | clustered `[0.0255427, 0.0285358]` | 0.1497 | better |

Per-hero-seat, record only; hero seat equals draft slot. Percentage points:

| Arm | pp estimate [interval] | discordant | Slot 0 | Slot 1 |
| --- | --- | ---: | ---: | ---: |
| candidate | +2.704 `[+2.554, +2.854]` | 42435 | +2.84 `[+2.63, +3.05]` | +2.57 `[+2.35, +2.78]` |

**The verdict is `better`, and it adopts the candidate as the two-seat vector.** `+2.704pp` on `[+2.554pp, +2.854pp]` over 42,435 discordant units of 280,000, the whole interval above the `+0.5pp` bar with about two points to spare. By the preregistered rule `coverageExponent` moves from 1.5 to 1.0 and `diversityWeight` from 1.6 to 3.2 for two-seat rosters: `SEAT_WEIGHT_OVERRIDES[2]` in `src/engine/weights.ts` carries both leaves, `simulator/placement/seat-weights/seats-2.json` is regenerated through `simulator/tools/generate-placement-parity.ts`, and the `SEAT_ADOPTIONS` row in `params_file.rs` moves with it. `DEFAULT_WEIGHTS` and `default-weights.json` do not move.

**Three readings on three disjoint seed sets agree to within a tenth of a point.** `+2.644pp` on the 70,000-unit `tuning3` combine pass, `+2.714pp` on 280,000 `eval3` units and `+2.704pp` here. The two held-out readings average `+2.71pp` over 560,000 paired units. The discordant share is 15.2% here, 15.1% on `eval3` and 14.8% on the combine pass. Both slots are positive and close.

**Prediction against outcome.** **Right on the estimate**, predicted `+2.2pp` to `+3.1pp` centred near `+2.7pp`, delivered `+2.704pp`. **Right on the verdict**, predicted `better` at about 99%.

**Scope, and what this entry may not be cited for.** One contrast, one layout, one seat count, one policy, one domain, one spend. Two seats is not an official player count: the runs use `--allow-unofficial` on a board built for four, with bank and port trades only, so the adopted vector is a default for that game as this simulator plays it. The arm moves the hero's weights alone against one seat on today's vector, so **nothing here measures the world the adoption creates in the app**, where a two-seat analysis scores both seats' picks on the adopted vector. The greedy opponent model inside every hero was measured in M-61 at four seats only, so the verdict may not be described as taken against a correctly specified model. The field is the same on all three domains, so the held-out readings control for seeds and not for field-overfit. Both adopted values are screening endpoints: 1.0 is the lower bound of the exponent's range in `sweep-bounds.json`, and 3.2 is the only value above the live `diversityWeight` that was read, so nothing here says either is an optimum. The verdict licenses moving these two leaves at this one seat count and nothing else.

## M-73: seat-count screen at 3 seats

2026-10-10, commit `bacde3e0` (the preregistration commit; no default moved for this run), domain `tuning3` (seed `8796478869724336144`). Preregistered in `docs/plans/preregs/2026-10-10-m73-seats3-screen.md` (committed before the pilot). The first placement reading ever taken at three seats: does any of the twelve `sc_*` arms beat today's vector there?

`evaluate`, `standard4`, 3 seats, field `app_formula_draft:placement/default-weights.json@placement/default-weights.json`, every seat on `heuristic-v1-trader-aware-threat-devcards-denial` with `--player-trading`, `--threads 0`, 2 reps, `--threshold 0.005`, `--alpha 0.05`, run from `simulator/`. Reference `base` is the field spec itself, except in the combine pass, where the reference is the combined vector. Each arm carries one `simulator/placement/arms/sc_*.json` on the hero path with the opponent path pinned to the field's weights; the arm values are M-67's.

```text
RUSTFLAGS="-D warnings" cargo build --release --manifest-path simulator/Cargo.toml -p unsettled-sim

# pilot, from simulator/, read blind
target/release/unsettled-sim evaluate --layout standard4 --seats 3 --domain tuning3 --field app_formula_draft:placement/default-weights.json@placement/default-weights.json --arm base=app_formula_draft:placement/default-weights.json@placement/default-weights.json --arm scarcity_lo=app_formula_draft:placement/arms/sc_scarcity_lo.json@placement/default-weights.json --arm scarcity_hi=app_formula_draft:placement/arms/sc_scarcity_hi.json@placement/default-weights.json --arm covscarcity_lo=app_formula_draft:placement/arms/sc_covscarcity_lo.json@placement/default-weights.json --arm covscarcity_hi=app_formula_draft:placement/arms/sc_covscarcity_hi.json@placement/default-weights.json --arm coverage_lo=app_formula_draft:placement/arms/sc_coverage_lo.json@placement/default-weights.json --arm coverage_hi=app_formula_draft:placement/arms/sc_coverage_hi.json@placement/default-weights.json --arm diversity_lo=app_formula_draft:placement/arms/sc_diversity_lo.json@placement/default-weights.json --arm diversity_hi=app_formula_draft:placement/arms/sc_diversity_hi.json@placement/default-weights.json --arm port_lo=app_formula_draft:placement/arms/sc_port_lo.json@placement/default-weights.json --arm port_hi=app_formula_draft:placement/arms/sc_port_hi.json@placement/default-weights.json --arm expansion_lo=app_formula_draft:placement/arms/sc_expansion_lo.json@placement/default-weights.json --arm expansion_hi=app_formula_draft:placement/arms/sc_expansion_hi.json@placement/default-weights.json --reference base --boards 400 --reps 2 --policy heuristic-v1-trader-aware-threat-devcards-denial --threads 0 --player-trading --threshold 0.005 --alpha 0.05 --out runs/m73-seats3-pilot

# screen, from simulator/: the pilot's command with --boards 10500 --out runs/m73-seats3-screen

# retry, from simulator/
target/release/unsettled-sim evaluate --layout standard4 --seats 3 --domain tuning3 --field app_formula_draft:placement/default-weights.json@placement/default-weights.json --arm base=app_formula_draft:placement/default-weights.json@placement/default-weights.json --arm diversity_hi=app_formula_draft:placement/arms/sc_diversity_hi.json@placement/default-weights.json --arm port_lo=app_formula_draft:placement/arms/sc_port_lo.json@placement/default-weights.json --reference base --boards 42000 --reps 2 --policy heuristic-v1-trader-aware-threat-devcards-denial --threads 0 --player-trading --threshold 0.005 --alpha 0.05 --out runs/m73-seats3-retry

# combine pass, from simulator/
target/release/unsettled-sim evaluate --layout standard4 --seats 3 --domain tuning3 --field app_formula_draft:placement/default-weights.json@placement/default-weights.json --arm combined=app_formula_draft:placement/arms/sc_s2_combined.json@placement/default-weights.json --arm base=app_formula_draft:placement/default-weights.json@placement/default-weights.json --arm coverage_lo=app_formula_draft:placement/arms/sc_coverage_lo.json@placement/default-weights.json --arm diversity_hi=app_formula_draft:placement/arms/sc_diversity_hi.json@placement/default-weights.json --reference combined --boards 10500 --reps 2 --policy heuristic-v1-trader-aware-threat-devcards-denial --threads 0 --player-trading --threshold 0.005 --alpha 0.05 --out runs/m73-seats3-combine
```

**Provenance and admissibility.** The release binary was rebuilt with `RUSTFLAGS="-D warnings"` in its own command block after the two-seat adoption commit and reported `Finished` in 0.01s on the warm check; all four invocations used it. `rustc 1.94.0 (4a4ef493e 2026-03-02)`. Each invocation ran alone, unpiped, one after another, and each reported domain `tuning3` at seed `8796478869724336144`. **Zero illegal actions in all four, and zero draws in every arm.** `simulator/runs/` is gitignored, so this entry is the record. Other sessions shared the machine, so the throughputs are contended figures.

Pilot, 400 boards: load before `8.00 13.22 20.24`, after `27.26 18.19 21.57`; 67.744s at 18 workers, 460.6 games/s, 31,200 games. **Read blind**: only the wall time, the illegal-action count and each arm's half-width and discordant share were printed.

Sizing: the widest pilot half-width was `expansion_lo` at 1.9175pp, so the 0.35pp target wanted 12,006 boards, rounded up to 12500; the 30-minute cap allowed 10,628, rounded down to **`B` = 10500**. The cap bound, narrowly: the pilot predicted a widest half-width of 0.374pp at that size, and about 0.23pp for a typical arm.

Screen, 10500 boards, 63,000 paired units over 10,500 clusters: load before `23.46 17.67 21.35`, after `30.48 36.67 37.77`; 1797.607s, 455.6 games/s, 819,000 games. `base` won 21,011 of 63,000 (`0.33350793650793653`), 0.093 binomial standard errors above the one-third corner; the corner check passes.

Retry, 42000 boards, 252,000 paired units, carrying `base`, `diversity_hi` and `port_lo`: load before `28.44 36.14 37.57`, after `11.12 31.78 37.69`; 1724.353s, 438.4 games/s, 756,000 games. `base` won 84,166 of 252,000 (`0.3339920634920635`), 0.701 standard errors above the corner; the check passes.

Combine pass, 10500 boards, 63,000 paired units, reference `combined`, arms `base`, `coverage_lo` and `diversity_hi`: load before `9.91 30.50 37.13`, after `50.66 39.39 37.88`; 562.388s, 448.1 games/s, 252,000 games. The combined vector three seats needs is the live defaults with `coverageExponent` 1.0 and `diversityWeight` 3.2, which is the file M-70 committed as `simulator/placement/arms/sc_s2_combined.json`, so the pass reads that file and no second copy was minted. Its boards are the screen's, so `base`, `coverage_lo` and `diversity_hi` reproduce their screen win counts exactly (21,011, 21,656 and 21,489), and the corner check on `base` is the screen's. `combined` won 22,226 of 63,000 (`0.35279365079365077`).

Screen, pooled, reference `base`:

| Arm | Estimate | b | c | McNemar | Clustered | Selected | Half-width pp | Verdict |
| --- | ---: | ---: | ---: | --- | --- | --- | ---: | --- |
| coverage_hi | `-0.014047619047619048` | 2432 | 3317 | `[-0.0164039, -0.0116913]` | `[-0.0164520, -0.0116432]` | clustered `[-0.0164520, -0.0116432]` | 0.2404 | worse |
| coverage_lo | `0.010238095238095239` | 3206 | 2561 | `[0.0078769, 0.0125993]` | `[0.0078247, 0.0126515]` | clustered `[0.0078247, 0.0126515]` | 0.2413 | better |
| covscarcity_hi | `-0.0013650793650793651` | 1202 | 1288 | `[-0.0029175, 0.0001873]` | `[-0.0029659, 0.0002357]` | clustered `[-0.0029659, 0.0002357]` | 0.1601 | equivalent |
| covscarcity_lo | `0.000873015873015873` | 670 | 615 | `[-0.0002422, 0.0019882]` | `[-0.0002805, 0.0020266]` | clustered `[-0.0002805, 0.0020266]` | 0.1154 | equivalent |
| diversity_hi | `0.007587301587301587` | 4329 | 3851 | `[0.0047742, 0.0104004]` | `[0.0047518, 0.0104228]` | clustered `[0.0047518, 0.0104228]` | 0.2836 | inconclusive |
| diversity_lo | `-0.014063492063492063` | 2881 | 3767 | `[-0.0165977, -0.0115293]` | `[-0.0167132, -0.0114138]` | clustered `[-0.0167132, -0.0114138]` | 0.2650 | worse |
| expansion_hi | `-0.007031746031746031` | 2879 | 3322 | `[-0.0094810, -0.0045825]` | `[-0.0095212, -0.0045423]` | clustered `[-0.0095212, -0.0045423]` | 0.2489 | inconclusive |
| expansion_lo | `-0.00907936507936508` | 6742 | 7314 | `[-0.0127671, -0.0053916]` | `[-0.0128002, -0.0053585]` | clustered `[-0.0128002, -0.0053585]` | 0.3721 | worse |
| port_hi | `-0.032857142857142856` | 5146 | 7216 | `[-0.0363066, -0.0294077]` | `[-0.0364414, -0.0292729]` | clustered `[-0.0364414, -0.0292729]` | 0.3584 | worse |
| port_lo | `0.0028253968253968255` | 2541 | 2363 | `[0.0006469, 0.0050039]` | `[0.0006020, 0.0050488]` | clustered `[0.0006020, 0.0050488]` | 0.2223 | inconclusive |
| scarcity_hi | `-0.007158730158730159` | 3269 | 3720 | `[-0.0097590, -0.0045585]` | `[-0.0098045, -0.0045130]` | clustered `[-0.0098045, -0.0045130]` | 0.2646 | inconclusive |
| scarcity_lo | `-0.0005396825396825396` | 1943 | 1977 | `[-0.0024875, 0.0014081]` | `[-0.0025255, 0.0014461]` | clustered `[-0.0025255, 0.0014461]` | 0.1986 | equivalent |

Retry, pooled, reference `base`:

| Arm | Estimate | b | c | McNemar | Clustered | Selected | Half-width pp | Verdict |
| --- | ---: | ---: | ---: | --- | --- | --- | ---: | --- |
| diversity_hi | `0.006825396825396826` | 17388 | 15668 | `[0.0054116, 0.0082392]` | `[0.0053843, 0.0082665]` | clustered `[0.0053843, 0.0082665]` | 0.1441 | better |
| port_lo | `0.002488095238095238` | 10264 | 9637 | `[0.0013909, 0.0035853]` | `[0.0013627, 0.0036135]` | clustered `[0.0013627, 0.0036135]` | 0.1125 | equivalent |

Combine pass, pooled, **reference `combined`**, so a negative estimate says the combined vector beats that arm:

| Arm | Estimate | b | c | McNemar | Clustered | Selected | Half-width pp | Verdict |
| --- | ---: | ---: | ---: | --- | --- | --- | ---: | --- |
| base | `-0.019285714285714285` | 4430 | 5645 | `[-0.0224048, -0.0161666]` | `[-0.0224656, -0.0161058]` | clustered `[-0.0224656, -0.0161058]` | 0.3180 | worse |
| coverage_lo | `-0.009047619047619047` | 3891 | 4461 | `[-0.0118899, -0.0062053]` | `[-0.0119809, -0.0061143]` | clustered `[-0.0119809, -0.0061143]` | 0.2933 | worse |
| diversity_hi | `-0.0116984126984127` | 2974 | 3711 | `[-0.0142404, -0.0091564]` | `[-0.0142879, -0.0091090]` | clustered `[-0.0142879, -0.0091090]` | 0.2589 | worse |

Per-hero-seat tables, record only; hero seat equals draft slot. Percentage points. Screen:

| Arm | pp estimate [interval] | discordant | Slot 0 | Slot 1 | Slot 2 |
| --- | --- | ---: | ---: | ---: | ---: |
| coverage_hi | -1.405 `[-1.645, -1.164]` | 5749 | -1.10 `[-1.50, -0.71]` | -1.66 `[-2.08, -1.25]` | -1.45 `[-1.88, -1.01]` |
| coverage_lo | +1.024 `[+0.782, +1.265]` | 5767 | +1.10 `[+0.70, +1.50]` | +0.81 `[+0.39, +1.23]` | +1.16 `[+0.72, +1.60]` |
| covscarcity_hi | -0.137 `[-0.297, +0.024]` | 2490 | -0.20 `[-0.46, +0.06]` | -0.37 `[-0.65, -0.08]` | +0.16 `[-0.13, +0.44]` |
| covscarcity_lo | +0.087 `[-0.028, +0.203]` | 1285 | +0.12 `[-0.06, +0.31]` | +0.09 `[-0.11, +0.29]` | +0.05 `[-0.16, +0.25]` |
| diversity_hi | +0.759 `[+0.475, +1.042]` | 8180 | +1.04 `[+0.53, +1.55]` | +0.58 `[+0.09, +1.07]` | +0.66 `[+0.17, +1.14]` |
| diversity_lo | -1.406 `[-1.671, -1.141]` | 6648 | -1.36 `[-1.81, -0.90]` | -1.36 `[-1.82, -0.90]` | -1.50 `[-1.96, -1.04]` |
| expansion_hi | -0.703 `[-0.952, -0.454]` | 6201 | -0.44 `[-0.90, +0.02]` | -1.05 `[-1.51, -0.60]` | -0.62 `[-1.01, -0.23]` |
| expansion_lo | -0.908 `[-1.280, -0.536]` | 14056 | -1.61 `[-2.24, -0.98]` | -0.26 `[-0.89, +0.37]` | -0.86 `[-1.53, -0.18]` |
| port_hi | -3.286 `[-3.644, -2.927]` | 12362 | -4.21 `[-4.85, -3.58]` | -3.37 `[-3.98, -2.75]` | -2.28 `[-2.88, -1.68]` |
| port_lo | +0.283 `[+0.060, +0.505]` | 4904 | +0.36 `[-0.03, +0.76]` | +0.33 `[-0.05, +0.72]` | +0.15 `[-0.23, +0.53]` |
| scarcity_hi | -0.716 `[-0.980, -0.451]` | 6989 | -0.76 `[-1.22, -0.29]` | -0.90 `[-1.37, -0.44]` | -0.49 `[-0.93, -0.04]` |
| scarcity_lo | -0.054 `[-0.253, +0.145]` | 3920 | -0.04 `[-0.38, +0.31]` | -0.11 `[-0.47, +0.25]` | -0.01 `[-0.35, +0.32]` |

Retry:

| Arm | pp estimate [interval] | discordant | Slot 0 | Slot 1 | Slot 2 |
| --- | --- | ---: | ---: | ---: | ---: |
| diversity_hi | +0.683 `[+0.538, +0.827]` | 33056 | +0.85 `[+0.59, +1.10]` | +0.55 `[+0.29, +0.80]` | +0.65 `[+0.41, +0.90]` |
| port_lo | +0.249 `[+0.136, +0.361]` | 19901 | +0.37 `[+0.17, +0.57]` | +0.28 `[+0.09, +0.47]` | +0.10 `[-0.09, +0.30]` |

Combine pass, reference `combined`:

| Arm | pp estimate [interval] | discordant | Slot 0 | Slot 1 | Slot 2 |
| --- | --- | ---: | ---: | ---: | ---: |
| base | -1.929 `[-2.247, -1.611]` | 10075 | -2.26 `[-2.82, -1.70]` | -1.63 `[-2.18, -1.09]` | -1.89 `[-2.44, -1.34]` |
| coverage_lo | -0.905 `[-1.198, -0.611]` | 8352 | -1.16 `[-1.68, -0.64]` | -0.82 `[-1.32, -0.33]` | -0.73 `[-1.23, -0.23]` |
| diversity_hi | -1.170 `[-1.429, -0.911]` | 6685 | -1.22 `[-1.66, -0.79]` | -1.05 `[-1.50, -0.61]` | -1.23 `[-1.70, -0.76]` |

**The same two axes survive as at two seats, one at the screen and one on its retry.** `coverage_lo` read `+1.024pp` on `[+0.782pp, +1.265pp]`, `better`, with `coverage_hi` at `-1.405pp`, `worse`. `diversity_hi` read `+0.759pp` on `[+0.475pp, +1.042pp]` at the screen, `inconclusive` with the bar just inside the interval, and then `+0.683pp` on `[+0.538pp, +0.827pp]` over 252,000 units, `better` with 0.038pp to spare at the lower edge; `diversity_lo` read `-1.406pp`, `worse`. That is the thinnest `better` in the programme so far, and it is a screening result that the held-out domains now have to stand behind.

**The two changes stack here too.** Against the combined vector, removing the coverage change reads `-1.170pp`, `worse`, and removing the diversity change reads `-0.905pp`, `worse`, so neither axis is dropped. `base` reads `-1.929pp` on `[-2.247pp, -1.611pp]` against it, `worse`, which is the combined vector reading `better` against `base`. The two single-arm screen estimates sum to `+1.783pp`. **The three-seat candidate is the combined vector, `simulator/placement/arms/sc_s2_combined.json`**, and it goes to `eval3`.

**`diversity_hi` now has a reading at three seat counts, and it falls as seats are added.** `+1.334pp` at two seats without player trading (M-70), `+0.683pp` at three and `+0.565pp` at four (M-67's retry), the last two with trading. Part of that is the win-rate corner falling from a half to a quarter, and this entry does not separate the two.

**`expansion_lo` reads `worse` for the first time on this generation.** Removing `expansionWeight` cost `-0.908pp` on `[-1.280pp, -0.536pp]`, the whole interval beyond the bar, against `inconclusive` readings of `-0.717pp` at four seats and `-0.346pp` at two. `expansion_hi` read `-0.703pp`, `inconclusive`, so 0.1 again sits above both neighbours.

**`port_hi` is again the largest effect and again negative**, `-3.286pp` on `[-3.644pp, -2.927pp]`, and `port_lo` again reads a small real gain under the bar: `+0.283pp` at the screen and `+0.249pp` on `[+0.136pp, +0.361pp]` at the retry, `equivalent`.

**Disposition, per arm, by the preregistered rule.** `coverage_lo`: survives. `diversity_hi`: retried, `better`, survives. `port_lo`: retried, `equivalent`, dropped. `coverage_hi`, `diversity_lo`, `expansion_lo`, `port_hi`: dropped, `worse`. `covscarcity_lo`, `covscarcity_hi`, `scarcity_lo`: dropped, `equivalent`. `expansion_hi`, `scarcity_hi`: dropped unresolved, `inconclusive` with negative estimates. Two surviving axes, so the combine pass ran, and both stay.

**Prediction against outcome.** **Right on `coverage_lo`**, predicted `+0.3pp` to `+1.8pp` and the likeliest survivor, delivered `+1.024pp` `better`, and right on `coverage_hi`'s sign. **Right on `diversity_hi`**, predicted `+0.2pp` to `+1.4pp`, above the retry line and about even to survive; it delivered `+0.759pp`, was retried and survived. **Right on `port_hi`**, predicted `-4.0pp` to `-1.0pp`, delivered `-3.286pp`, and **right on `port_lo`**, predicted inside `+/-0.5pp`. **Right on `expansion_lo`**, predicted `-1.0pp` to `+0.2pp`, delivered `-0.908pp`, near the bottom of the range, and right on `expansion_hi`'s sign. **Mostly right on the scarcity arms**: the high arms read negative and `covscarcity_lo` slightly positive as predicted, while `scarcity_lo` read `-0.054pp` where I predicted slightly positive. **Right that the cap would bind.** This prediction was written after the two- and four-seat screens, so its accuracy says more about those screens transferring than about my priors.

**Scope, and what this entry may not be cited for.** One layout, one seat count, one policy, one domain, twelve single-parameter contrasts and one combination with no multiplicity correction, at a power the wall-time cap set a little below the programme's target. Each arm moves the hero's weights alone against two seats on today's vector, which was tuned at four seats. The greedy opponent model inside every hero was measured in M-61 at four seats only, so no verdict here may be described as taken against a correctly specified model. Both expansion arms move the setup road as well as the settlement. A `better` on `tuning3` is a screening result: it sends one vector to `eval3` and decides nothing about what ships. Nothing here transfers to another seat count.

## M-74: 3-seat confirmation on eval3

2026-10-10, commit `495c68b6` (the preregistration commit; no default moved for this run), domain `eval3` (seed `16691289016504815632`). Preregistered in `docs/plans/preregs/2026-10-10-m74-seats3-eval3.md` (committed before the run). **This run is the one authorized `eval3` spend at 3 seats**, under the user's 2026-10-10 authorization quoted in `.claude/specs/simulator/seat-count-programme.md`; no further `eval3` command may run on `standard4` at 3 seats.

`evaluate`, `standard4`, 3 seats, field `app_formula_draft:placement/default-weights.json@placement/default-weights.json`, every seat on `heuristic-v1-trader-aware-threat-devcards-denial` with `--player-trading`, `--threads 0`, 42,000 boards x 2 reps, 252,000 paired units, `--threshold 0.005`, `--alpha 0.05`, run from `simulator/`. Reference `base` is the field spec; `candidate` carries `simulator/placement/arms/sc_s2_combined.json` on the hero path with the opponent path pinned to the field's weights.

```text
RUSTFLAGS="-D warnings" cargo build --release --manifest-path simulator/Cargo.toml -p unsettled-sim

# the single invocation, from simulator/
target/release/unsettled-sim evaluate --layout standard4 --seats 3 --domain eval3 --field app_formula_draft:placement/default-weights.json@placement/default-weights.json --arm base=app_formula_draft:placement/default-weights.json@placement/default-weights.json --arm candidate=app_formula_draft:placement/arms/sc_s2_combined.json@placement/default-weights.json --reference base --boards 42000 --reps 2 --policy heuristic-v1-trader-aware-threat-devcards-denial --threads 0 --player-trading --threshold 0.005 --alpha 0.05 --out runs/m74-seats3-eval3
```

**Provenance and admissibility.** The release binary was rebuilt with `RUSTFLAGS="-D warnings"` in its own command block and reported `Finished` in 0.02s against a warm fingerprint. The invocation ran alone in its command block, unpiped. `rustc 1.94.0 (4a4ef493e 2026-03-02)`. It reported domain `eval3` at seed `16691289016504815632`, as preregistered. **Zero illegal actions**, and 0 draws in `base` and 0 in `candidate`. Load before `19.06 32.12 35.25`, after `40.51 40.70 38.59`, other sessions sharing the machine; 1024.597s at 18 workers, 491.9 games/s, 504,000 games. `base` won 83,882 of 252,000 (`0.33286507936507936`), 0.499 binomial standard errors below the `0.3333333333333333` corner and inside the preregistered 3.29, so the corner check passes. `candidate` won 88,420 of 252,000 (`0.3508730158730159`). `simulator/runs/` is gitignored, so this entry is the record.

Pooled, reference `base`:

| Arm | Estimate | b | c | McNemar | Clustered | Selected | Half-width pp | Verdict |
| --- | ---: | ---: | ---: | --- | --- | --- | ---: | --- |
| candidate | `0.018007936507936508` | 22336 | 17798 | `[0.0164514, 0.0195645]` | `[0.0164098, 0.0196061]` | clustered `[0.0164098, 0.0196061]` | 0.1598 | better |

Per-hero-seat, record only; hero seat equals draft slot. Percentage points:

| Arm | pp estimate [interval] | discordant | Slot 0 | Slot 1 | Slot 2 |
| --- | --- | ---: | ---: | ---: | ---: |
| candidate | +1.801 `[+1.641, +1.961]` | 40134 | +1.71 `[+1.44, +1.99]` | +1.71 `[+1.43, +1.99]` | +1.98 `[+1.71, +2.26]` |

**The verdict is `better`, so the candidate goes to the gate.** `+1.801pp` on `[+1.641pp, +1.961pp]` over 40,134 discordant units of 252,000, the whole interval above the `+0.5pp` bar with 1.14pp to spare. The combine pass in M-73 read the same contrast at `+1.929pp` on 63,000 `tuning3` units, so the estimate shrank by about 0.13pp on seeds it was not selected on. The discordant share is 15.9% here against 16.0% there. Every slot is positive and every slot interval excludes zero.

**Prediction against outcome.** **Right on the estimate**, predicted `+1.2pp` to `+2.2pp` centred near `+1.7pp`, delivered `+1.801pp`. **Right on the verdict**, predicted `better` at about 97%. **Right on the half-width**, predicted about `+/-0.16pp`, delivered `+/-0.160pp`. The shrinkage was smaller than the few tenths I expected.

**Scope, and what this entry may not be cited for.** One contrast, one layout, one seat count, one policy, one domain, one spend. The arm moves the hero's weights alone against two seats on today's vector. The greedy opponent model inside every hero was measured in M-61 at four seats only, so the verdict may not be described as taken against a correctly specified model, and the field is the same here as on `tuning3`, so this run controls for seeds and not for field-overfit. The run reads the pair of changes together and says nothing about either alone; the diversity half's own case rests on M-73's retry. A `better` here confirms the screen and decides nothing about what ships; that is M-75's question on `gate3`.

## M-75: 3-seat adoption gate on gate3

2026-10-10, commit `dc1dcec1` (the preregistration commit; no default moved for this run), domain `gate3` (seed `7670578962881712144`). Preregistered in `docs/plans/preregs/2026-10-10-m75-seats3-gate3.md` (committed before the run). **This run is the one authorized `gate3` spend at 3 seats**, under the user's 2026-10-10 authorization quoted in `.claude/specs/simulator/seat-count-programme.md`; no further `gate3` command may run on `standard4` at 3 seats.

`evaluate`, `standard4`, 3 seats, field `app_formula_draft:placement/default-weights.json@placement/default-weights.json`, every seat on `heuristic-v1-trader-aware-threat-devcards-denial` with `--player-trading`, `--threads 0`, 42,000 boards x 2 reps, 252,000 paired units, `--threshold 0.005`, `--alpha 0.05`, run from `simulator/`. Reference `base` is the field spec; `candidate` carries `simulator/placement/arms/sc_s2_combined.json` on the hero path with the opponent path pinned to the field's weights.

```text
RUSTFLAGS="-D warnings" cargo build --release --manifest-path simulator/Cargo.toml -p unsettled-sim

# the single invocation, from simulator/
target/release/unsettled-sim evaluate --layout standard4 --seats 3 --domain gate3 --field app_formula_draft:placement/default-weights.json@placement/default-weights.json --arm base=app_formula_draft:placement/default-weights.json@placement/default-weights.json --arm candidate=app_formula_draft:placement/arms/sc_s2_combined.json@placement/default-weights.json --reference base --boards 42000 --reps 2 --policy heuristic-v1-trader-aware-threat-devcards-denial --threads 0 --player-trading --threshold 0.005 --alpha 0.05 --out runs/m75-seats3-gate3
```

**Provenance and admissibility.** The release binary was rebuilt with `RUSTFLAGS="-D warnings"` in its own command block and reported `Finished` in 0.07s against a warm fingerprint. The invocation ran alone in its command block, unpiped. `rustc 1.94.0 (4a4ef493e 2026-03-02)`. It reported domain `gate3` at seed `7670578962881712144`, as preregistered. **Zero illegal actions**, and 0 draws in `base` and 0 in `candidate`. Load before `28.51 37.86 37.63`, after `13.10 34.87 41.24`, other sessions sharing the machine; 1147.049s at 18 workers, 439.4 games/s, 504,000 games. `base` won 84,109 of 252,000 (`0.333765873015873`), 0.461 binomial standard errors above the `0.3333333333333333` corner and inside the preregistered 3.29, so the corner check passes. `candidate` won 88,958 of 252,000 (`0.3530079365079365`). `simulator/runs/` is gitignored, so this entry is the record.

Pooled, reference `base`:

| Arm | Estimate | b | c | McNemar | Clustered | Selected | Half-width pp | Verdict |
| --- | ---: | ---: | ---: | --- | --- | --- | ---: | --- |
| candidate | `0.01924206349206349` | 22520 | 17671 | `[0.0176846, 0.0207995]` | `[0.0176488, 0.0208353]` | clustered `[0.0176488, 0.0208353]` | 0.1593 | better |

Per-hero-seat, record only; hero seat equals draft slot. Percentage points:

| Arm | pp estimate [interval] | discordant | Slot 0 | Slot 1 | Slot 2 |
| --- | --- | ---: | ---: | ---: | ---: |
| candidate | +1.924 `[+1.765, +2.084]` | 40191 | +2.00 `[+1.72, +2.27]` | +2.02 `[+1.74, +2.30]` | +1.76 `[+1.49, +2.04]` |

**The verdict is `better`, and it adopts the candidate as the three-seat vector.** `+1.924pp` on `[+1.765pp, +2.084pp]` over 40,191 discordant units of 252,000, the whole interval above the `+0.5pp` bar with 1.26pp to spare. By the preregistered rule `coverageExponent` moves from 1.5 to 1.0 and `diversityWeight` from 1.6 to 3.2 for three-seat rosters: `SEAT_WEIGHT_OVERRIDES[3]` in `src/engine/weights.ts` carries both leaves, `simulator/placement/seat-weights/seats-3.json` is regenerated through `simulator/tools/generate-placement-parity.ts`, and the `SEAT_ADOPTIONS` row in `params_file.rs` moves with it. `DEFAULT_WEIGHTS` and `default-weights.json` do not move.

**Three readings on three disjoint seed sets agree.** `+1.929pp` on the 63,000-unit `tuning3` combine pass, `+1.801pp` on 252,000 `eval3` units and `+1.924pp` here. The two held-out readings average `+1.86pp` over 504,000 paired units. The discordant share is 15.9% on both held-out domains. Every slot is positive and every slot interval excludes zero.

**Prediction against outcome.** **Right on the estimate**, predicted `+1.4pp` to `+2.2pp` centred near `+1.8pp`, delivered `+1.924pp`. **Right on the verdict**, predicted `better` at about 99%.

**Scope, and what this entry may not be cited for.** One contrast, one layout, one seat count, one policy, one domain, one spend. The arm moves the hero's weights alone against two seats on today's vector, so **nothing here measures the world the adoption creates in the app**, where a three-seat analysis scores every seat's picks on the adopted vector. The greedy opponent model inside every hero was measured in M-61 at four seats only, so the verdict may not be described as taken against a correctly specified model. The field is the same on all three domains, so the held-out readings control for seeds and not for field-overfit. The run reads the pair of changes together: the gate says the pair beats today's vector by more than the bar, and the case for carrying the diversity half rather than the coverage half alone rests on M-73's retry and combine pass on `tuning3`, not on a held-out reading. Both adopted values are screening endpoints, so nothing here says either is an optimum. The verdict licenses moving these two leaves at this one seat count and nothing else.

## M-76: seat-count screen at 5 seats

2026-10-10, commit `30c47a71` (the preregistration commit; no default moved for this run), domain `tuning3` (seed `8796478869724336144`). Preregistered in `docs/plans/preregs/2026-10-10-m76-seats5-screen.md` (committed before the pilot). The first placement screen on `extension6`, and the first reading of any kind at five seats: does any of the twelve `sc_*` arms beat today's vector there?

`evaluate`, `extension6`, 5 seats, field `app_formula_draft:placement/default-weights.json@placement/default-weights.json`, every seat on `heuristic-v1-trader-aware-threat-devcards-denial` with `--player-trading`, `--threads 0`, 2 reps, `--threshold 0.005`, `--alpha 0.05`, run from `simulator/`. Reference `base` is the field spec itself, except in the combine pass, where the reference is the combined vector. Each arm carries one `simulator/placement/arms/sc_*.json` on the hero path with the opponent path pinned to the field's weights; the arm values are M-67's. Sized under Revision 1 of the programme's procedure: a 100-board pilot and a 120-minute cap on the screen.

```text
RUSTFLAGS="-D warnings" cargo build --release --manifest-path simulator/Cargo.toml -p unsettled-sim

# pilot, from simulator/, read blind
target/release/unsettled-sim evaluate --layout extension6 --seats 5 --domain tuning3 --field app_formula_draft:placement/default-weights.json@placement/default-weights.json --arm base=app_formula_draft:placement/default-weights.json@placement/default-weights.json --arm scarcity_lo=app_formula_draft:placement/arms/sc_scarcity_lo.json@placement/default-weights.json --arm scarcity_hi=app_formula_draft:placement/arms/sc_scarcity_hi.json@placement/default-weights.json --arm covscarcity_lo=app_formula_draft:placement/arms/sc_covscarcity_lo.json@placement/default-weights.json --arm covscarcity_hi=app_formula_draft:placement/arms/sc_covscarcity_hi.json@placement/default-weights.json --arm coverage_lo=app_formula_draft:placement/arms/sc_coverage_lo.json@placement/default-weights.json --arm coverage_hi=app_formula_draft:placement/arms/sc_coverage_hi.json@placement/default-weights.json --arm diversity_lo=app_formula_draft:placement/arms/sc_diversity_lo.json@placement/default-weights.json --arm diversity_hi=app_formula_draft:placement/arms/sc_diversity_hi.json@placement/default-weights.json --arm port_lo=app_formula_draft:placement/arms/sc_port_lo.json@placement/default-weights.json --arm port_hi=app_formula_draft:placement/arms/sc_port_hi.json@placement/default-weights.json --arm expansion_lo=app_formula_draft:placement/arms/sc_expansion_lo.json@placement/default-weights.json --arm expansion_hi=app_formula_draft:placement/arms/sc_expansion_hi.json@placement/default-weights.json --reference base --boards 100 --reps 2 --policy heuristic-v1-trader-aware-threat-devcards-denial --threads 0 --player-trading --threshold 0.005 --alpha 0.05 --out runs/m76-seats5-pilot

# screen, from simulator/: the pilot's command with --boards 4500 --out runs/m76-seats5-screen

# retry, from simulator/
target/release/unsettled-sim evaluate --layout extension6 --seats 5 --domain tuning3 --field app_formula_draft:placement/default-weights.json@placement/default-weights.json --arm base=app_formula_draft:placement/default-weights.json@placement/default-weights.json --arm coverage_lo=app_formula_draft:placement/arms/sc_coverage_lo.json@placement/default-weights.json --reference base --boards 18000 --reps 2 --policy heuristic-v1-trader-aware-threat-devcards-denial --threads 0 --player-trading --threshold 0.005 --alpha 0.05 --out runs/m76-seats5-retry

# combine pass, from simulator/
target/release/unsettled-sim evaluate --layout extension6 --seats 5 --domain tuning3 --field app_formula_draft:placement/default-weights.json@placement/default-weights.json --arm combined=app_formula_draft:placement/arms/sc_s2_combined.json@placement/default-weights.json --arm base=app_formula_draft:placement/default-weights.json@placement/default-weights.json --arm coverage_lo=app_formula_draft:placement/arms/sc_coverage_lo.json@placement/default-weights.json --arm diversity_hi=app_formula_draft:placement/arms/sc_diversity_hi.json@placement/default-weights.json --reference combined --boards 4500 --reps 2 --policy heuristic-v1-trader-aware-threat-devcards-denial --threads 0 --player-trading --threshold 0.005 --alpha 0.05 --out runs/m76-seats5-combine
```

**Provenance and admissibility.** The release binary was rebuilt with `RUSTFLAGS="-D warnings"` in its own command block after the three-seat adoption commit and reported `Finished` in 0.03s on the warm check; all four invocations used it. `rustc 1.94.0 (4a4ef493e 2026-03-02)`. Each invocation ran alone, unpiped, one after another, and each reported domain `tuning3` at seed `8796478869724336144`. **Zero illegal actions in all four, and zero draws in every arm.** `simulator/runs/` is gitignored, so this entry is the record. Other sessions loaded the machine heavily throughout, which the load figures show, so the throughputs are contended figures; the results are deterministic and do not depend on it.

Pilot, 100 boards: load before `11.37 15.75 29.10`, after `39.80 25.96 31.03`; 158.301s at 18 workers, 82.1 games/s, 13,000 games. **Read blind**: only the wall time, the illegal-action count and each arm's half-width and discordant share were printed.

Sizing: the widest pilot half-width was `port_hi` at 2.5981pp, so the 0.35pp target wanted 5,510 boards, which rounds up to 6000; the 120-minute cap allowed 4,548, rounded down to **`B` = 4500**. The cap bound: the pilot predicted a widest half-width of 0.387pp at that size and about 0.26pp for `coverage_lo`.

Screen, 4500 boards, 45,000 paired units over 4,500 clusters: load before `32.48 25.01 30.61`, after `84.29 76.09 74.00`; 7009.206s, 83.5 games/s, 585,000 games. `base` won 8,991 of 45,000 (`0.1998`), 0.106 binomial standard errors below the one-fifth corner; the corner check passes.

Retry, 18000 boards, 180,000 paired units, carrying `base` and `coverage_lo`, the only arm that earned it: load before `67.68 72.80 72.86`, after `67.74 64.57 68.13`; 4280.443s, 84.1 games/s, 360,000 games. `base` won 36,012 of 180,000 (`0.20006666666666667`), 0.071 standard errors above the corner; the check passes.

Combine pass, 4500 boards, 45,000 paired units, reference `combined`, arms `base`, `coverage_lo` and `diversity_hi`: load before `59.92 63.00 67.53`, after `54.29 58.34 59.18`; 2110.299s, 85.3 games/s, 180,000 games. The combined vector is again the live defaults with `coverageExponent` 1.0 and `diversityWeight` 3.2, read from `simulator/placement/arms/sc_s2_combined.json` as in M-73. Its boards are the screen's, so `base`, `coverage_lo` and `diversity_hi` reproduce their screen win counts exactly (8,991, 9,310 and 9,368), and the corner check on `base` is the screen's. `combined` won 9,670 of 45,000 (`0.21488888888888888`).

Screen, pooled, reference `base`:

| Arm | Estimate | b | c | McNemar | Clustered | Selected | Half-width pp | Verdict |
| --- | ---: | ---: | ---: | --- | --- | --- | ---: | --- |
| coverage_hi | `-0.007266666666666667` | 1438 | 1765 | `[-0.0097307, -0.0048026]` | `[-0.0098026, -0.0047308]` | clustered `[-0.0098026, -0.0047308]` | 0.2536 | inconclusive |
| coverage_lo | `0.0070888888888888885` | 1922 | 1603 | `[0.0045038, 0.0096740]` | `[0.0044270, 0.0097508]` | clustered `[0.0044270, 0.0097508]` | 0.2662 | inconclusive |
| covscarcity_hi | `8.888888888888889e-05` | 575 | 571 | `[-0.0013856, 0.0015633]` | `[-0.0014049, 0.0015827]` | clustered `[-0.0014049, 0.0015827]` | 0.1494 | equivalent |
| covscarcity_lo | `6.666666666666667e-05` | 325 | 322 | `[-0.0010412, 0.0011745]` | `[-0.0010549, 0.0011883]` | clustered `[-0.0010549, 0.0011883]` | 0.1122 | equivalent |
| diversity_hi | `0.008377777777777777` | 2620 | 2243 | `[0.0053415, 0.0114141]` | `[0.0052868, 0.0114688]` | clustered `[0.0052868, 0.0114688]` | 0.3091 | better |
| diversity_lo | `-0.0132` | 1669 | 2263 | `[-0.0159284, -0.0104716]` | `[-0.0159945, -0.0104055]` | clustered `[-0.0159945, -0.0104055]` | 0.2794 | worse |
| expansion_hi | `-0.005355555555555555` | 1851 | 2092 | `[-0.0080901, -0.0026211]` | `[-0.0082060, -0.0025051]` | clustered `[-0.0082060, -0.0025051]` | 0.2850 | inconclusive |
| expansion_lo | `-0.005266666666666667` | 3813 | 4050 | `[-0.0091285, -0.0014048]` | `[-0.0091891, -0.0013442]` | clustered `[-0.0091891, -0.0013442]` | 0.3922 | inconclusive |
| port_hi | `-0.020755555555555555` | 3002 | 3936 | `[-0.0243784, -0.0171327]` | `[-0.0245485, -0.0169626]` | clustered `[-0.0245485, -0.0169626]` | 0.3793 | worse |
| port_lo | `-0.0009555555555555555` | 1263 | 1306 | `[-0.0031631, 0.0012520]` | `[-0.0032284, 0.0013173]` | clustered `[-0.0032284, 0.0013173]` | 0.2273 | equivalent |
| scarcity_hi | `-0.0004` | 1796 | 1814 | `[-0.0030169, 0.0022169]` | `[-0.0030760, 0.0022760]` | clustered `[-0.0030760, 0.0022760]` | 0.2676 | equivalent |
| scarcity_lo | `8.888888888888889e-05` | 1002 | 998 | `[-0.0018589, 0.0020367]` | `[-0.0018795, 0.0020573]` | clustered `[-0.0018795, 0.0020573]` | 0.1968 | equivalent |

Retry, pooled, reference `base`:

| Arm | Estimate | b | c | McNemar | Clustered | Selected | Half-width pp | Verdict |
| --- | ---: | ---: | ---: | --- | --- | --- | ---: | --- |
| coverage_lo | `0.007544444444444445` | 7774 | 6416 | `[0.0062478, 0.0088411]` | `[0.0062181, 0.0088708]` | clustered `[0.0062181, 0.0088708]` | 0.1326 | better |

Combine pass, pooled, **reference `combined`**, so a negative estimate says the combined vector beats that arm:

| Arm | Estimate | b | c | McNemar | Clustered | Selected | Half-width pp | Verdict |
| --- | ---: | ---: | ---: | --- | --- | --- | ---: | --- |
| base | `-0.01508888888888889` | 2593 | 3272 | `[-0.0184215, -0.0117562]` | `[-0.0185618, -0.0116160]` | clustered `[-0.0185618, -0.0116160]` | 0.3473 | worse |
| coverage_lo | `-0.008` | 2309 | 2669 | `[-0.0110721, -0.0049279]` | `[-0.0111505, -0.0048495]` | clustered `[-0.0111505, -0.0048495]` | 0.3151 | inconclusive |
| diversity_hi | `-0.006711111111111111` | 1787 | 2089 | `[-0.0094220, -0.0040002]` | `[-0.0095009, -0.0039213]` | clustered `[-0.0095009, -0.0039213]` | 0.2790 | inconclusive |

Per-hero-seat tables, record only; hero seat equals draft slot. Percentage points. Screen:

| Arm | pp estimate [interval] | discordant | Slot 0 | Slot 1 | Slot 2 | Slot 3 | Slot 4 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| coverage_hi | -0.727 `[-0.980, -0.473]` | 3203 | -0.91 `[-1.43, -0.39]` | -0.27 `[-0.85, +0.32]` | -1.03 `[-1.60, -0.47]` | -0.90 `[-1.47, -0.33]` | -0.52 `[-1.13, +0.08]` |
| coverage_lo | +0.709 `[+0.443, +0.975]` | 3525 | +0.16 `[-0.40, +0.71]` | +1.10 `[+0.51, +1.69]` | +0.68 `[+0.07, +1.28]` | +0.72 `[+0.12, +1.33]` | +0.89 `[+0.29, +1.49]` |
| covscarcity_hi | +0.009 `[-0.140, +0.158]` | 1146 | +0.03 `[-0.27, +0.33]` | +0.27 `[-0.07, +0.61]` (mcnemar) | -0.04 `[-0.39, +0.30]` | -0.19 `[-0.54, +0.16]` | -0.02 `[-0.37, +0.32]` |
| covscarcity_lo | +0.007 `[-0.105, +0.119]` | 647 | +0.04 `[-0.17, +0.26]` (mcnemar) | -0.02 `[-0.28, +0.23]` | -0.11 `[-0.38, +0.16]` | -0.07 `[-0.33, +0.20]` | +0.19 `[-0.07, +0.45]` (mcnemar) |
| diversity_hi | +0.838 `[+0.529, +1.147]` | 4863 | +1.00 `[+0.30, +1.70]` | +1.33 `[+0.63, +2.03]` | -0.12 `[-0.80, +0.56]` | +1.00 `[+0.31, +1.69]` | +0.98 `[+0.29, +1.67]` |
| diversity_lo | -1.320 `[-1.599, -1.041]` | 3932 | -1.54 `[-2.17, -0.92]` | -1.51 `[-2.17, -0.85]` | -1.22 `[-1.85, -0.60]` | -1.51 `[-2.11, -0.91]` | -0.81 `[-1.43, -0.20]` |
| expansion_hi | -0.536 `[-0.821, -0.251]` | 3943 | -0.63 `[-1.28, +0.02]` | -0.41 `[-1.08, +0.26]` | -1.06 `[-1.71, -0.40]` | -0.43 `[-1.08, +0.21]` | -0.14 `[-0.70, +0.41]` |
| expansion_lo | -0.527 `[-0.919, -0.134]` | 7863 | -1.06 `[-1.96, -0.16]` | -0.17 `[-1.02, +0.69]` | -1.03 `[-1.88, -0.18]` | +0.04 `[-0.80, +0.89]` (mcnemar) | -0.42 `[-1.33, +0.48]` |
| port_hi | -2.076 `[-2.455, -1.696]` | 6938 | -3.17 `[-4.04, -2.30]` | -2.72 `[-3.59, -1.85]` | -2.39 `[-3.22, -1.56]` | -1.31 `[-2.12, -0.50]` | -0.79 `[-1.57, -0.01]` |
| port_lo | -0.096 `[-0.323, +0.132]` | 2569 | +0.04 `[-0.49, +0.58]` | +0.14 `[-0.36, +0.65]` | -0.13 `[-0.64, +0.37]` | -0.43 `[-0.91, +0.05]` | -0.10 `[-0.60, +0.40]` |
| scarcity_hi | -0.040 `[-0.308, +0.228]` | 3610 | +0.56 `[-0.03, +1.14]` | -0.17 `[-0.78, +0.44]` | -0.56 `[-1.16, +0.05]` | -0.23 `[-0.83, +0.36]` | +0.20 `[-0.37, +0.77]` |
| scarcity_lo | +0.009 `[-0.188, +0.206]` | 2000 | -0.10 `[-0.52, +0.32]` (mcnemar) | +0.30 `[-0.18, +0.78]` | -0.19 `[-0.62, +0.24]` | -0.26 `[-0.71, +0.20]` | +0.29 `[-0.14, +0.72]` (mcnemar) |

Retry:

| Arm | pp estimate [interval] | discordant | Slot 0 | Slot 1 | Slot 2 | Slot 3 | Slot 4 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| coverage_lo | +0.754 `[+0.622, +0.887]` | 14190 | +0.48 `[+0.20, +0.76]` | +0.95 `[+0.66, +1.25]` | +0.94 `[+0.64, +1.24]` | +0.71 `[+0.41, +1.01]` | +0.69 `[+0.39, +1.00]` |

Combine pass, reference `combined`:

| Arm | pp estimate [interval] | discordant | Slot 0 | Slot 1 | Slot 2 | Slot 3 | Slot 4 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| base | -1.509 `[-1.856, -1.162]` | 5865 | -1.19 `[-1.95, -0.43]` | -2.23 `[-3.00, -1.47]` | -0.99 `[-1.77, -0.21]` | -1.23 `[-1.99, -0.48]` | -1.90 `[-2.64, -1.16]` |
| coverage_lo | -0.800 `[-1.115, -0.485]` | 4978 | -1.03 `[-1.75, -0.32]` | -1.13 `[-1.83, -0.44]` | -0.31 `[-1.04, +0.41]` | -0.51 `[-1.20, +0.18]` | -1.01 `[-1.69, -0.33]` |
| diversity_hi | -0.671 `[-0.950, -0.392]` | 3876 | -0.19 `[-0.75, +0.38]` | -0.90 `[-1.49, -0.31]` (mcnemar) | -1.11 `[-1.73, -0.49]` | -0.23 `[-0.87, +0.41]` | -0.92 `[-1.57, -0.28]` |

**The same two axes survive on the larger board, each by a thin margin.** `diversity_hi` read `+0.838pp` on `[+0.529pp, +1.147pp]` at the screen, `better` with 0.029pp to spare at the lower edge, and `diversity_lo` read `-1.320pp`, `worse`. `coverage_lo` read `+0.709pp` on `[+0.443pp, +0.975pp]` at the screen, `inconclusive` with the bar just inside the interval, and then `+0.754pp` on `[+0.622pp, +0.887pp]` over 180,000 units, `better` with 0.12pp to spare; `coverage_hi` read `-0.727pp`. Neither `better` would survive much shrinkage alone, and `diversity_hi` was read once, at the screen's power, on the seeds it was selected on.

**The combine pass keeps both, on weaker evidence than at two or three seats.** Against the combined vector, removing the coverage change reads `-0.671pp` and removing the diversity change reads `-0.800pp`, both `inconclusive` with the whole interval negative. The rule drops an axis only when its removal reads `better`, and neither does, so both stay. `base` reads `-1.509pp` on `[-1.856pp, -1.162pp]` against the combined vector, `worse`, which is the combined vector reading `better` against `base`. The two single-arm screen estimates sum to `+1.547pp`, so the pair is about additive. **The five-seat candidate is the combined vector, `simulator/placement/arms/sc_s2_combined.json`**, and it goes to `eval3`.

**`diversity_hi` does not keep falling as seats are added.** M-73 noted `+1.334pp`, `+0.683pp` and `+0.565pp` at two, three and four seats on `standard4`. Five seats on `extension6` reads `+0.838pp`, above both of the last two at a lower win-rate corner, so the trend that entry described belongs to `standard4` and not to seat count.

**The scarcity and port-discount arms that read small real effects on `standard4` read nothing here.** `scarcity_lo` `+0.009pp`, `scarcity_hi` `-0.040pp`, `covscarcity_lo` `+0.007pp`, `covscarcity_hi` `+0.009pp` and `port_lo` `-0.096pp` are all `equivalent` on intervals that straddle zero. `port_hi` is again the largest effect and negative, `-2.076pp` on `[-2.455pp, -1.696pp]`, strongest at the early slots.

**Both expansion arms read negative and `inconclusive`**: `expansion_lo` `-0.527pp` on `[-0.919pp, -0.134pp]` and `expansion_hi` `-0.536pp` on `[-0.821pp, -0.251pp]`. The live 0.1 sits above both neighbours on a second layout, at a power that cannot say by how much.

**Disposition, per arm, by the preregistered rule.** `diversity_hi`: survives. `coverage_lo`: retried, `better`, survives. `diversity_lo`, `port_hi`: dropped, `worse`. `covscarcity_lo`, `covscarcity_hi`, `port_lo`, `scarcity_lo`, `scarcity_hi`: dropped, `equivalent`. `coverage_hi`, `expansion_lo`, `expansion_hi`: dropped unresolved, `inconclusive` with negative estimates under a binding cap, which is a statement about power and not a null. Two surviving axes, so the combine pass ran, and both stay.

**Prediction against outcome.** **Right on `coverage_lo`**, predicted `+0.2pp` to `+1.2pp` and about even to survive at the screen or on its retry; it delivered `+0.709pp`, was retried and survived. **Wrong on `diversity_hi`, narrowly and in the direction that matters**: predicted `0pp` to `+0.8pp` and lumped into a 15% chance of any other survivor, delivered `+0.838pp` `better`. **Right on `port_hi`**, predicted `-3.0pp` to `-0.5pp`, delivered `-2.076pp`. **Right on `expansion_lo`**, predicted `-1.2pp` to `0pp`, delivered `-0.527pp`. **Right on the remaining arms inside `+/-0.5pp`** for five of six, with `expansion_hi` at `-0.536pp` just outside. **Right that the cap would bind and that smaller effects would sit near the edge of what the power could call.**

**Scope, and what this entry may not be cited for.** One layout, one seat count, one policy, one domain, twelve single-parameter contrasts and one combination with no multiplicity correction, at a power the wall-time cap set below the programme's target. Each arm moves the hero's weights alone against four seats on today's vector, which was tuned at four seats on the other layout. The greedy opponent model inside every hero was measured in M-61 at four seats on `standard4` only, so no verdict here may be described as taken against a correctly specified model. Both expansion arms move the setup road as well as the settlement. A `better` on `tuning3` is a screening result: it sends one vector to `eval3` and decides nothing about what ships. Nothing here transfers to another seat count.

## M-77: 5-seat confirmation on eval3

2026-10-10, commit `465379f4` (the preregistration commit; no default moved for this run), domain `eval3` (seed `16691289016504815632`). Preregistered in `docs/plans/preregs/2026-10-10-m77-seats5-eval3.md` (committed before the run). **This run is the one authorized `eval3` spend at 5 seats**, under the user's 2026-10-10 authorization quoted in `.claude/specs/simulator/seat-count-programme.md`; no further `eval3` command may run on `extension6` at 5 seats.

`evaluate`, `extension6`, 5 seats, field `app_formula_draft:placement/default-weights.json@placement/default-weights.json`, every seat on `heuristic-v1-trader-aware-threat-devcards-denial` with `--player-trading`, `--threads 0`, 18,000 boards x 2 reps, 180,000 paired units, `--threshold 0.005`, `--alpha 0.05`, run from `simulator/`. Reference `base` is the field spec; `candidate` carries `simulator/placement/arms/sc_s2_combined.json` on the hero path with the opponent path pinned to the field's weights.

```text
RUSTFLAGS="-D warnings" cargo build --release --manifest-path simulator/Cargo.toml -p unsettled-sim

# the single invocation, from simulator/
target/release/unsettled-sim evaluate --layout extension6 --seats 5 --domain eval3 --field app_formula_draft:placement/default-weights.json@placement/default-weights.json --arm base=app_formula_draft:placement/default-weights.json@placement/default-weights.json --arm candidate=app_formula_draft:placement/arms/sc_s2_combined.json@placement/default-weights.json --reference base --boards 18000 --reps 2 --policy heuristic-v1-trader-aware-threat-devcards-denial --threads 0 --player-trading --threshold 0.005 --alpha 0.05 --out runs/m77-seats5-eval3
```

**Provenance and admissibility.** The release binary was rebuilt with `RUSTFLAGS="-D warnings"` in its own command block and reported `Finished` in 0.09s against a warm fingerprint. The invocation ran alone in its command block, unpiped. `rustc 1.94.0 (4a4ef493e 2026-03-02)`. It reported domain `eval3` at seed `16691289016504815632`, as preregistered. **Zero illegal actions**, and 0 draws in `base` and 0 in `candidate`. Load before `22.82 47.96 55.19`, after `60.44 63.74 64.58`, other sessions sharing the machine; 4203.408s at 18 workers, 85.6 games/s, 360,000 games. `base` won 35,988 of 180,000 (`0.19993333333333332`), 0.071 binomial standard errors below the `0.2` corner and inside the preregistered 3.29, so the corner check passes. `candidate` won 39,117 of 180,000 (`0.21731666666666666`). `simulator/runs/` is gitignored, so this entry is the record.

Pooled, reference `base`:

| Arm | Estimate | b | c | McNemar | Clustered | Selected | Half-width pp | Verdict |
| --- | ---: | ---: | ---: | --- | --- | --- | ---: | --- |
| candidate | `0.017383333333333334` | 13470 | 10341 | `[0.0157050, 0.0190616]` | `[0.0156531, 0.0191136]` | clustered `[0.0156531, 0.0191136]` | 0.1730 | better |

Per-hero-seat, record only; hero seat equals draft slot. Percentage points:

| Arm | pp estimate [interval] | discordant | Slot 0 | Slot 1 | Slot 2 | Slot 3 | Slot 4 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| candidate | +1.738 `[+1.565, +1.911]` | 23811 | +1.48 `[+1.10, +1.87]` | +1.84 `[+1.45, +2.23]` | +1.82 `[+1.44, +2.21]` | +1.63 `[+1.25, +2.01]` | +1.91 `[+1.53, +2.29]` |

**The verdict is `better`, so the candidate goes to the gate.** `+1.738pp` on `[+1.565pp, +1.911pp]` over 23,811 discordant units of 180,000, the whole interval above the `+0.5pp` bar with 1.07pp to spare. The combine pass in M-76 read the same contrast at `+1.509pp` on 45,000 `tuning3` units, so the estimate rose by 0.23pp on seeds it was not selected on; that pass's interval reached `+1.856pp`, so the two readings agree. The discordant share is 13.2% here against 13.0% there. Every slot is positive and every slot interval excludes zero.

**Prediction against outcome.** **Wrong on the estimate, narrowly**: predicted `+0.8pp` to `+1.7pp` centred near `+1.25pp`, delivered `+1.738pp`, just above the top of the range. I expected a quarter of a point of shrinkage from the screening estimate and got a quarter of a point the other way. **Right on the verdict**, predicted `better` at about 90%. **Right on the half-width**, predicted about `+/-0.17pp`, delivered `+/-0.173pp`.

**Scope, and what this entry may not be cited for.** One contrast, one layout, one seat count, one policy, one domain, one spend. The arm moves the hero's weights alone against four seats on today's vector. The greedy opponent model inside every hero was measured in M-61 at four seats on `standard4` only, so the verdict may not be described as taken against a correctly specified model, and the field is the same here as on `tuning3`, so this run controls for seeds and not for field-overfit. The run reads the pair of changes together and says nothing about either alone. A `better` here confirms the screen and decides nothing about what ships; that is M-78's question on `gate3`.

## M-78: 5-seat adoption gate on gate3

2026-10-10, commit `ac20ad03` (the preregistration commit; no default moved for this run), domain `gate3` (seed `7670578962881712144`). Preregistered in `docs/plans/preregs/2026-10-10-m78-seats5-gate3.md` (committed before the run). **This run is the one authorized `gate3` spend at 5 seats**, under the user's 2026-10-10 authorization quoted in `.claude/specs/simulator/seat-count-programme.md`; no further `gate3` command may run on `extension6` at 5 seats.

`evaluate`, `extension6`, 5 seats, field `app_formula_draft:placement/default-weights.json@placement/default-weights.json`, every seat on `heuristic-v1-trader-aware-threat-devcards-denial` with `--player-trading`, `--threads 0`, 18,000 boards x 2 reps, 180,000 paired units, `--threshold 0.005`, `--alpha 0.05`, run from `simulator/`. Reference `base` is the field spec; `candidate` carries `simulator/placement/arms/sc_s2_combined.json` on the hero path with the opponent path pinned to the field's weights.

```text
RUSTFLAGS="-D warnings" cargo build --release --manifest-path simulator/Cargo.toml -p unsettled-sim

# the single invocation, from simulator/
target/release/unsettled-sim evaluate --layout extension6 --seats 5 --domain gate3 --field app_formula_draft:placement/default-weights.json@placement/default-weights.json --arm base=app_formula_draft:placement/default-weights.json@placement/default-weights.json --arm candidate=app_formula_draft:placement/arms/sc_s2_combined.json@placement/default-weights.json --reference base --boards 18000 --reps 2 --policy heuristic-v1-trader-aware-threat-devcards-denial --threads 0 --player-trading --threshold 0.005 --alpha 0.05 --out runs/m78-seats5-gate3
```

**Provenance and admissibility.** The release binary was rebuilt with `RUSTFLAGS="-D warnings"` in its own command block and reported `Finished` in 0.07s against a warm fingerprint. The invocation ran alone in its command block, unpiped. `rustc 1.94.0 (4a4ef493e 2026-03-02)`. It reported domain `gate3` at seed `7670578962881712144`, as preregistered. **Zero illegal actions**, and 0 draws in `base` and 0 in `candidate`. Load before `43.00 59.39 62.98`, after `62.57 59.40 60.74`, other sessions sharing the machine; 4327.698s at 18 workers, 83.2 games/s, 360,000 games. `base` won 35,813 of 180,000 (`0.19896111111111112`), 1.102 binomial standard errors below the `0.2` corner and inside the preregistered 3.29, so the corner check passes. `candidate` won 38,557 of 180,000 (`0.21420555555555557`). `simulator/runs/` is gitignored, so this entry is the record.

Pooled, reference `base`:

| Arm | Estimate | b | c | McNemar | Clustered | Selected | Half-width pp | Verdict |
| --- | ---: | ---: | ---: | --- | --- | --- | ---: | --- |
| candidate | `0.015244444444444444` | 13292 | 10548 | `[0.0135647, 0.0169242]` | `[0.0135036, 0.0169853]` | clustered `[0.0135036, 0.0169853]` | 0.1741 | better |

Per-hero-seat, record only; hero seat equals draft slot. Percentage points:

| Arm | pp estimate [interval] | discordant | Slot 0 | Slot 1 | Slot 2 | Slot 3 | Slot 4 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| candidate | +1.524 `[+1.350, +1.699]` | 23840 | +1.09 `[+0.70, +1.48]` | +1.39 `[+0.99, +1.79]` | +1.89 `[+1.51, +2.28]` | +1.46 `[+1.08, +1.83]` | +1.78 `[+1.40, +2.16]` |

**The verdict is `better`, and it adopts the candidate as the five-seat vector.** `+1.524pp` on `[+1.350pp, +1.699pp]` over 23,840 discordant units of 180,000, the whole interval above the `+0.5pp` bar with 0.85pp to spare. By the preregistered rule `coverageExponent` moves from 1.5 to 1.0 and `diversityWeight` from 1.6 to 3.2 for five-seat rosters: `SEAT_WEIGHT_OVERRIDES[5]` in `src/engine/weights.ts` carries both leaves, `simulator/placement/seat-weights/seats-5.json` is regenerated through `simulator/tools/generate-placement-parity.ts`, and the `SEAT_ADOPTIONS` row in `params_file.rs` moves with it. `DEFAULT_WEIGHTS` and `default-weights.json` do not move.

**Three readings on three disjoint seed sets agree.** `+1.509pp` on the 45,000-unit `tuning3` combine pass, `+1.738pp` on 180,000 `eval3` units and `+1.524pp` here. The two held-out readings average `+1.63pp` over 360,000 paired units. The discordant share is 13.2% on both held-out domains. Every slot is positive and every slot interval excludes zero.

**Prediction against outcome.** **Right on the estimate**, predicted `+1.2pp` to `+2.0pp` centred near `+1.6pp`, delivered `+1.524pp`. **Right on the verdict**, predicted `better` at about 99%.

**Scope, and what this entry may not be cited for.** One contrast, one layout, one seat count, one policy, one domain, one spend. The arm moves the hero's weights alone against four seats on today's vector, so **nothing here measures the world the adoption creates in the app**, where a five-seat analysis scores every seat's picks on the adopted vector. The greedy opponent model inside every hero was measured in M-61 at four seats on `standard4` only, so the verdict may not be described as taken against a correctly specified model. The field is the same on all three domains, so the held-out readings control for seeds and not for field-overfit. The run reads the pair of changes together: the gate says the pair beats today's vector by more than the bar, and the case for carrying both halves rather than one rests on M-76's screen, retry and combine pass on `tuning3`, where each half cleared the bar alone by a thin margin and each removal read `inconclusive` rather than `worse`. Both adopted values are screening endpoints, so nothing here says either is an optimum. The verdict licenses moving these two leaves at this one seat count and nothing else.

## M-79: seat-count screen at 6 seats

2026-10-10, commit `04f4286e` (the preregistration commit; no default moved for this run), domain `tuning3` (seed `8796478869724336144`). Preregistered in `docs/plans/preregs/2026-10-10-m79-seats6-screen.md` (committed before the pilot). The first placement reading of any kind at six seats, and the last screen of the seat-count programme: does any of the twelve `sc_*` arms beat today's vector in the full extension game?

`evaluate`, `extension6`, 6 seats, field `app_formula_draft:placement/default-weights.json@placement/default-weights.json`, every seat on `heuristic-v1-trader-aware-threat-devcards-denial` with `--player-trading`, `--threads 0`, 2 reps, `--threshold 0.005`, `--alpha 0.05`, run from `simulator/`. Reference `base` is the field spec itself. Each arm carries one `simulator/placement/arms/sc_*.json` on the hero path with the opponent path pinned to the field's weights; the arm values are M-67's. Sized under Revision 1 of the programme's procedure: a 100-board pilot and a 120-minute cap on the screen.

```text
RUSTFLAGS="-D warnings" cargo build --release --manifest-path simulator/Cargo.toml -p unsettled-sim

# pilot, from simulator/, read blind
target/release/unsettled-sim evaluate --layout extension6 --seats 6 --domain tuning3 --field app_formula_draft:placement/default-weights.json@placement/default-weights.json --arm base=app_formula_draft:placement/default-weights.json@placement/default-weights.json --arm scarcity_lo=app_formula_draft:placement/arms/sc_scarcity_lo.json@placement/default-weights.json --arm scarcity_hi=app_formula_draft:placement/arms/sc_scarcity_hi.json@placement/default-weights.json --arm covscarcity_lo=app_formula_draft:placement/arms/sc_covscarcity_lo.json@placement/default-weights.json --arm covscarcity_hi=app_formula_draft:placement/arms/sc_covscarcity_hi.json@placement/default-weights.json --arm coverage_lo=app_formula_draft:placement/arms/sc_coverage_lo.json@placement/default-weights.json --arm coverage_hi=app_formula_draft:placement/arms/sc_coverage_hi.json@placement/default-weights.json --arm diversity_lo=app_formula_draft:placement/arms/sc_diversity_lo.json@placement/default-weights.json --arm diversity_hi=app_formula_draft:placement/arms/sc_diversity_hi.json@placement/default-weights.json --arm port_lo=app_formula_draft:placement/arms/sc_port_lo.json@placement/default-weights.json --arm port_hi=app_formula_draft:placement/arms/sc_port_hi.json@placement/default-weights.json --arm expansion_lo=app_formula_draft:placement/arms/sc_expansion_lo.json@placement/default-weights.json --arm expansion_hi=app_formula_draft:placement/arms/sc_expansion_hi.json@placement/default-weights.json --reference base --boards 100 --reps 2 --policy heuristic-v1-trader-aware-threat-devcards-denial --threads 0 --player-trading --threshold 0.005 --alpha 0.05 --out runs/m79-seats6-pilot

# screen, from simulator/: the pilot's command with --boards 2500 --out runs/m79-seats6-screen

# retry, from simulator/
target/release/unsettled-sim evaluate --layout extension6 --seats 6 --domain tuning3 --field app_formula_draft:placement/default-weights.json@placement/default-weights.json --arm base=app_formula_draft:placement/default-weights.json@placement/default-weights.json --arm coverage_lo=app_formula_draft:placement/arms/sc_coverage_lo.json@placement/default-weights.json --arm diversity_hi=app_formula_draft:placement/arms/sc_diversity_hi.json@placement/default-weights.json --reference base --boards 10000 --reps 2 --policy heuristic-v1-trader-aware-threat-devcards-denial --threads 0 --player-trading --threshold 0.005 --alpha 0.05 --out runs/m79-seats6-retry
```

**Provenance and admissibility.** The release binary was rebuilt with `RUSTFLAGS="-D warnings"` in its own command block after the five-seat adoption commit and reported `Finished` in 0.03s on the warm check; all three invocations used it. `rustc 1.94.0 (4a4ef493e 2026-03-02)`. Each invocation ran alone, unpiped, one after another, and each reported domain `tuning3` at seed `8796478869724336144`. **Zero illegal actions in all three, and zero draws in every arm.** `simulator/runs/` is gitignored, so this entry is the record. Other sessions loaded the machine throughout, which the load figures show, so the throughputs are contended figures; the results are deterministic and do not depend on it.

Pilot, 100 boards: load before `8.67 22.49 41.70`, after `37.07 29.93 39.93`; 253.610s at 18 workers, 61.5 games/s, 15,600 games. **Read blind**: only the wall time, the illegal-action count and each arm's half-width and discordant share were printed.

Sizing: the widest pilot half-width was `expansion_lo` at 2.4789pp, so the 0.35pp target wanted 5,017 boards, which rounds up to 5500; the 120-minute cap allowed 2,839, rounded down to **`B` = 2500**. The cap bound harder than at any other seat count: the pilot predicted a widest half-width of 0.496pp at that size, about 0.33pp for `coverage_lo` and about 0.38pp for `diversity_hi`, so no arm with an effect under about `+0.85pp` could read `better` at the screen.

Screen, 2500 boards, 30,000 paired units over 2,500 clusters: load before `32.15 29.11 39.52`, after `35.56 36.71 37.43`; 6140.890s, 63.5 games/s, 390,000 games. `base` won 5,091 of 30,000 (`0.1697`), 1.410 binomial standard errors above the one-sixth corner, inside the preregistered 3.29, so the corner check passes.

Retry, 10000 boards, 120,000 paired units, carrying `base`, `coverage_lo` and `diversity_hi`, the two arms that earned it: load before `31.01 35.69 37.06`, after `35.06 32.84 34.26`; 5674.118s, 63.4 games/s, 360,000 games. `base` won 20,253 of 120,000 (`0.168775`), 1.960 standard errors above the corner; the check passes, on the high side for the second time.

Screen, pooled, reference `base`:

| Arm | Estimate | b | c | McNemar | Clustered | Selected | Half-width pp | Verdict |
| --- | ---: | ---: | ---: | --- | --- | --- | ---: | --- |
| coverage_hi | `-0.010666666666666666` | 891 | 1211 | `[-0.0136596, -0.0076738]` | `[-0.0137351, -0.0075982]` | clustered `[-0.0137351, -0.0075982]` | 0.3068 | worse |
| coverage_lo | `0.0057666666666666665` | 1156 | 983 | `[0.0027458, 0.0087875]` | `[0.0026636, 0.0088697]` | clustered `[0.0026636, 0.0088697]` | 0.3103 | inconclusive |
| covscarcity_hi | `-0.0015666666666666667` | 373 | 420 | `[-0.0034064, 0.0002730]` | `[-0.0035293, 0.0003960]` | clustered `[-0.0035293, 0.0003960]` | 0.1963 | equivalent |
| covscarcity_lo | `0.0011333333333333334` | 226 | 192 | `[-0.0002023, 0.0024690]` | `[-0.0002083, 0.0024750]` | clustered `[-0.0002083, 0.0024750]` | 0.1342 | equivalent |
| diversity_hi | `0.0033` | 1494 | 1395 | `[-0.0002114, 0.0068114]` | `[-0.0003530, 0.0069530]` | clustered `[-0.0003530, 0.0069530]` | 0.3653 | inconclusive |
| diversity_lo | `-0.014033333333333333` | 925 | 1346 | `[-0.0171427, -0.0109240]` | `[-0.0172665, -0.0108002]` | clustered `[-0.0172665, -0.0108002]` | 0.3233 | worse |
| expansion_hi | `-0.0087` | 1075 | 1336 | `[-0.0119064, -0.0054936]` | `[-0.0120484, -0.0053516]` | clustered `[-0.0120484, -0.0053516]` | 0.3348 | worse |
| expansion_lo | `-0.009433333333333334` | 2157 | 2440 | `[-0.0138616, -0.0050050]` | `[-0.0140424, -0.0048243]` | clustered `[-0.0140424, -0.0048243]` | 0.4609 | inconclusive |
| port_hi | `-0.02263333333333333` | 1762 | 2441 | `[-0.0268611, -0.0184056]` | `[-0.0271609, -0.0181058]` | clustered `[-0.0271609, -0.0181058]` | 0.4528 | worse |
| port_lo | `-0.0001` | 800 | 803 | `[-0.0027157, 0.0025157]` | `[-0.0027551, 0.0025551]` | clustered `[-0.0027551, 0.0025551]` | 0.2655 | equivalent |
| scarcity_hi | `-0.0024333333333333334` | 1006 | 1079 | `[-0.0054164, 0.0005497]` | `[-0.0055086, 0.0006420]` | clustered `[-0.0055086, 0.0006420]` | 0.3075 | inconclusive |
| scarcity_lo | `-0.0015333333333333334` | 588 | 634 | `[-0.0038171, 0.0007504]` | `[-0.0038868, 0.0008201]` | clustered `[-0.0038868, 0.0008201]` | 0.2353 | equivalent |

Retry, pooled, reference `base`:

| Arm | Estimate | b | c | McNemar | Clustered | Selected | Half-width pp | Verdict |
| --- | ---: | ---: | ---: | --- | --- | --- | ---: | --- |
| coverage_lo | `0.008533333333333334` | 4888 | 3864 | `[0.0070061, 0.0100606]` | `[0.0069409, 0.0101258]` | clustered `[0.0069409, 0.0101258]` | 0.1592 | better |
| diversity_hi | `0.0057` | 6125 | 5441 | `[0.0039438, 0.0074562]` | `[0.0038924, 0.0075076]` | clustered `[0.0038924, 0.0075076]` | 0.1808 | inconclusive |

Per-hero-seat tables, record only; hero seat equals draft slot. Percentage points. Screen:

| Arm | pp estimate [interval] | discordant | Slot 0 | Slot 1 | Slot 2 | Slot 3 | Slot 4 | Slot 5 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| coverage_hi | -1.067 `[-1.374, -0.760]` | 2102 | -0.94 `[-1.69, -0.19]` | -0.30 `[-1.07, +0.47]` | -1.18 `[-1.92, -0.44]` | -1.48 `[-2.26, -0.70]` | -1.46 `[-2.20, -0.72]` | -1.04 `[-1.81, -0.27]` (mcnemar) |
| coverage_lo | +0.577 `[+0.266, +0.887]` | 2139 | +0.72 `[+0.02, +1.42]` | +0.18 `[-0.62, +0.98]` | +0.28 `[-0.47, +1.03]` | +1.02 `[+0.27, +1.77]` | +0.68 `[-0.09, +1.45]` | +0.58 `[-0.23, +1.39]` |
| covscarcity_hi | -0.157 `[-0.353, +0.040]` | 793 | -0.16 `[-0.61, +0.29]` | +0.14 `[-0.30, +0.58]` | -0.32 `[-0.75, +0.11]` | -0.34 `[-0.82, +0.14]` | -0.24 `[-0.70, +0.22]` | -0.02 `[-0.54, +0.50]` |
| covscarcity_lo | +0.113 `[-0.021, +0.247]` | 418 | -0.02 `[-0.27, +0.23]` (mcnemar) | +0.22 `[-0.18, +0.62]` | -0.02 `[-0.34, +0.30]` | +0.40 `[+0.09, +0.71]` (mcnemar) | +0.20 `[-0.18, +0.58]` | -0.10 `[-0.46, +0.26]` |
| diversity_hi | +0.330 `[-0.035, +0.695]` | 2889 | +0.20 `[-0.73, +1.13]` | -0.28 `[-1.24, +0.68]` | +0.38 `[-0.46, +1.22]` | +0.50 `[-0.35, +1.35]` (mcnemar) | +0.70 `[-0.16, +1.56]` | +0.48 `[-0.39, +1.35]` |
| diversity_lo | -1.403 `[-1.727, -1.080]` | 2271 | -1.74 `[-2.54, -0.94]` | -0.96 `[-1.77, -0.15]` | -1.72 `[-2.54, -0.90]` | -1.20 `[-1.96, -0.44]` | -1.28 `[-2.05, -0.51]` | -1.52 `[-2.29, -0.75]` |
| expansion_hi | -0.870 `[-1.205, -0.535]` | 2411 | -0.96 `[-1.76, -0.16]` | -0.98 `[-1.87, -0.09]` | -0.94 `[-1.73, -0.15]` | -1.16 `[-2.00, -0.32]` | -0.94 `[-1.75, -0.13]` | -0.24 `[-0.99, +0.51]` |
| expansion_lo | -0.943 `[-1.404, -0.482]` | 4597 | -0.62 `[-1.79, +0.55]` | -0.60 `[-1.70, +0.50]` | -1.66 `[-2.72, -0.60]` | -1.48 `[-2.52, -0.44]` | -0.04 `[-1.12, +1.04]` | -1.26 `[-2.39, -0.13]` (mcnemar) |
| port_hi | -2.263 `[-2.716, -1.811]` | 4203 | -2.48 `[-3.57, -1.39]` | -2.08 `[-3.24, -0.92]` | -2.74 `[-3.80, -1.68]` | -3.12 `[-4.15, -2.09]` | -1.74 `[-2.77, -0.71]` | -1.42 `[-2.47, -0.37]` |
| port_lo | -0.010 `[-0.276, +0.256]` | 1603 | +0.40 `[-0.31, +1.11]` | -0.12 `[-0.80, +0.56]` | -0.08 `[-0.70, +0.54]` | +0.02 `[-0.61, +0.65]` | +0.14 `[-0.50, +0.78]` | -0.42 `[-1.07, +0.23]` |
| scarcity_hi | -0.243 `[-0.551, +0.064]` | 2085 | -0.50 `[-1.29, +0.29]` | +0.30 `[-0.47, +1.07]` | -0.50 `[-1.24, +0.24]` | +0.06 `[-0.69, +0.81]` | -0.30 `[-1.02, +0.42]` | -0.52 `[-1.24, +0.20]` |
| scarcity_lo | -0.153 `[-0.389, +0.082]` | 1222 | +0.10 `[-0.47, +0.67]` | -0.16 `[-0.80, +0.48]` | -0.46 `[-1.04, +0.12]` | +0.10 `[-0.45, +0.65]` | -0.02 `[-0.63, +0.59]` | -0.48 `[-1.02, +0.06]` (mcnemar) |

Retry:

| Arm | pp estimate [interval] | discordant | Slot 0 | Slot 1 | Slot 2 | Slot 3 | Slot 4 | Slot 5 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| coverage_lo | +0.853 `[+0.694, +1.013]` | 8752 | +0.68 `[+0.31, +1.04]` | +0.64 `[+0.25, +1.02]` | +0.61 `[+0.23, +0.99]` | +0.90 `[+0.51, +1.29]` | +1.35 `[+0.96, +1.74]` | +0.95 `[+0.55, +1.35]` |
| diversity_hi | +0.570 `[+0.389, +0.751]` | 11566 | +0.40 `[-0.06, +0.87]` | +0.14 `[-0.32, +0.61]` | +0.49 `[+0.06, +0.92]` | +0.48 `[+0.05, +0.91]` | +1.00 `[+0.56, +1.44]` | +0.90 `[+0.47, +1.33]` |

**One arm survives, and only on its retry: `coverage_lo`, `coverageExponent` 1.5 to 1.0.** It read `+0.577pp` on `[+0.266pp, +0.887pp]` at the screen, `inconclusive` with the bar inside the interval, and then `+0.853pp` on `[+0.694pp, +1.013pp]` over 8,752 discordant units of 120,000, `better` with 0.19pp to spare at the lower edge. Its mirror arm agrees: `coverage_hi` read `-1.067pp` on `[-1.374pp, -0.760pp]`, `worse`. Every slot is positive on the retry and every slot interval excludes zero. This is the fifth seat count of five at which linear coverage credit reads `better` than the shipped exponent.

**`diversity_hi` is dropped unresolved, as it was at four seats.** `+0.330pp` on `[-0.035pp, +0.695pp]` at the screen, `inconclusive` above the `+0.25pp` retry line, then `+0.570pp` on `[+0.389pp, +0.751pp]` over 120,000 units, `inconclusive` again with the bar inside the interval. The sign is settled and positive, and `diversity_lo` read `-1.403pp`, `worse`, so the axis has a slope here too. M-67's four-seat retry read `+0.565pp`. The programme buys one retry, so the arm is dropped with a positive effect the power could not place on either side of the bar, which is a statement about power and not a null.

**Both expansion arms read about a point negative.** `expansion_hi` read `-0.870pp` on `[-1.205pp, -0.535pp]`, `worse`, and `expansion_lo` read `-0.943pp` on `[-1.404pp, -0.482pp]`, `inconclusive` on the widest interval in the screen with its upper edge just above the `-0.5pp` line. The live 0.1 sits above both neighbours at a fifth seat count.

**`port_hi` is again the largest effect and negative**: `-2.263pp` on `[-2.716pp, -1.811pp]`, negative at every slot. `port_lo` read `-0.010pp`, `equivalent`.

**Disposition, per arm, by the preregistered rule.** `coverage_lo`: retried, `better`, survives. `diversity_hi`: retried, `inconclusive` again, dropped unresolved. `coverage_hi`, `diversity_lo`, `expansion_hi`, `port_hi`: dropped, `worse`. `covscarcity_lo`, `covscarcity_hi`, `port_lo`, `scarcity_lo`: dropped, `equivalent`. `scarcity_hi`, `expansion_lo`: dropped unresolved, `inconclusive` with negative estimates, which buy no retry. Two arms earned the retry, which is the most the `extension6` rule carries, so none was left behind. One survivor, so no combine pass: **the six-seat candidate is `simulator/placement/arms/sc_coverage_lo.json`** and it goes to `eval3`.

**Prediction against outcome.** **Right on `coverage_lo`**, predicted `+0.2pp` to `+1.0pp`, delivered `+0.577pp` then `+0.853pp`. **Right on `diversity_hi`**, predicted `+0.2pp` to `+1.0pp`, delivered `+0.330pp` then `+0.570pp`. **Right on `coverage_hi`**, predicted negative. **Right on the sign of `diversity_lo` and low on its size**, predicted near `-1pp`, delivered `-1.403pp`. **Right on `port_hi`**, predicted `-2.5pp` to `-0.8pp`, delivered `-2.263pp`. **Right on `expansion_lo`**, predicted `-1.0pp` to `0pp`, delivered `-0.943pp`, and **right on `expansion_hi`**, predicted negative. **Right on all five scarcity, coverage-scarcity and `port_lo` arms**, predicted inside `+/-0.3pp`. **Right that both candidates would end the screen `inconclusive` above the retry line and that the retry would decide them.** At least one survivor was put near 65% and one survived; both surviving was put near 35% and did not happen.

**Scope, and what this entry may not be cited for.** One layout, one seat count, one policy, one domain, twelve single-parameter contrasts with no multiplicity correction, at a power the wall-time cap set well below the programme's target. Each arm moves the hero's weights alone against five seats on today's vector, which was tuned at four seats on the other layout. The greedy opponent model inside every hero was measured in M-61 at four seats on `standard4` only, so no verdict here may be described as taken against a correctly specified model. Both expansion arms move the setup road as well as the settlement. The combined vector that five seats adopted in M-78 was not read here, because the rule sends only survivors to a combine pass; nothing in this entry says the pair would or would not beat the bar at six seats. A `better` on `tuning3` is a screening result: it sends one vector to `eval3` and decides nothing about what ships. Nothing here transfers to another seat count.

## M-80: 6-seat confirmation on eval3

2026-10-10, commit `a09c7089` (the preregistration commit; no default moved for this run), domain `eval3` (seed `16691289016504815632`). Preregistered in `docs/plans/preregs/2026-10-10-m80-seats6-eval3.md` (committed before the run). **This run is the one authorized `eval3` spend at 6 seats**, under the user's 2026-10-10 authorization quoted in `.claude/specs/simulator/seat-count-programme.md`; no further `eval3` command may run on `extension6` at 6 seats.

`evaluate`, `extension6`, 6 seats, field `app_formula_draft:placement/default-weights.json@placement/default-weights.json`, every seat on `heuristic-v1-trader-aware-threat-devcards-denial` with `--player-trading`, `--threads 0`, 10,000 boards x 2 reps, 120,000 paired units, `--threshold 0.005`, `--alpha 0.05`, run from `simulator/`. Reference `base` is the field spec; `candidate` carries `simulator/placement/arms/sc_coverage_lo.json` on the hero path with the opponent path pinned to the field's weights.

```text
RUSTFLAGS="-D warnings" cargo build --release --manifest-path simulator/Cargo.toml -p unsettled-sim

# the single invocation, from simulator/
target/release/unsettled-sim evaluate --layout extension6 --seats 6 --domain eval3 --field app_formula_draft:placement/default-weights.json@placement/default-weights.json --arm base=app_formula_draft:placement/default-weights.json@placement/default-weights.json --arm candidate=app_formula_draft:placement/arms/sc_coverage_lo.json@placement/default-weights.json --reference base --boards 10000 --reps 2 --policy heuristic-v1-trader-aware-threat-devcards-denial --threads 0 --player-trading --threshold 0.005 --alpha 0.05 --out runs/m80-seats6-eval3
```

**Provenance and admissibility.** The release binary was rebuilt with `RUSTFLAGS="-D warnings"` in its own command block and reported `Finished` in 0.10s against a warm fingerprint. The invocation ran alone in its command block, unpiped. `rustc 1.94.0 (4a4ef493e 2026-03-02)`. It reported domain `eval3` at seed `16691289016504815632`, as preregistered. **Zero illegal actions**, and 0 draws in `base` and 0 in `candidate`. Load before `9.83 24.33 30.74`, after `54.39 52.53 45.37`, other sessions sharing the machine; 3884.172s at 18 workers, 61.8 games/s, 240,000 games. `base` won 20,106 of 120,000 (`0.16755`), 0.821 binomial standard errors above the `0.16666666666666666` corner and inside the preregistered 3.29, so the corner check passes. `candidate` won 21,044 of 120,000 (`0.17536666666666667`). `simulator/runs/` is gitignored, so this entry is the record.

Pooled, reference `base`:

| Arm | Estimate | b | c | McNemar | Clustered | Selected | Half-width pp | Verdict |
| --- | ---: | ---: | ---: | --- | --- | --- | ---: | --- |
| candidate | `0.007816666666666666` | 4850 | 3912 | `[0.0062884, 0.0093449]` | `[0.0062464, 0.0093869]` | clustered `[0.0062464, 0.0093869]` | 0.1570 | better |

Per-hero-seat, record only; hero seat equals draft slot. Percentage points:

| Arm | pp estimate [interval] | discordant | Slot 0 | Slot 1 | Slot 2 | Slot 3 | Slot 4 | Slot 5 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| candidate | +0.782 `[+0.625, +0.939]` | 8762 | +0.46 `[+0.10, +0.83]` | +0.91 `[+0.54, +1.28]` | +0.84 `[+0.46, +1.23]` | +0.80 `[+0.40, +1.19]` | +0.92 `[+0.51, +1.32]` | +0.76 `[+0.37, +1.15]` |

**The verdict is `better`, so the candidate goes to the gate.** `+0.782pp` on `[+0.625pp, +0.939pp]` over 8,762 discordant units of 120,000, the whole interval above the `+0.5pp` bar with 0.12pp to spare at the lower edge, the thinnest margin of the five confirmations. The retry in M-79 read `+0.853pp` on 120,000 `tuning3` units, so the estimate shrank by 0.07pp on seeds it was not selected on. The discordant share is 7.30% here against 7.29% there: the arm changes the pick at the same rate on boards it has never seen. Every slot is positive and every slot interval excludes zero.

**Prediction against outcome.** **Right on the estimate**, predicted `+0.4pp` to `+1.1pp` centred near `+0.75pp`, delivered `+0.782pp`. **Right on the verdict**, predicted `better` at about 65%. **Right on the half-width**, predicted about `+/-0.16pp`, delivered `+/-0.157pp`.

**Scope, and what this entry may not be cited for.** One contrast, one layout, one seat count, one policy, one domain, one spend. The arm moves the hero's weights alone against five seats on today's vector. The greedy opponent model inside every hero was measured in M-61 at four seats on `standard4` only, so the verdict may not be described as taken against a correctly specified model, and the field is the same here as on `tuning3`, so this run controls for seeds and not for field-overfit. A `better` here confirms the screen and decides nothing about what ships; that is M-81's question on `gate3`.

## M-81: 6-seat adoption gate on gate3

2026-10-10, commit `97e51966` (the preregistration commit; no default moved for this run), domain `gate3` (seed `7670578962881712144`). Preregistered in `docs/plans/preregs/2026-10-10-m81-seats6-gate3.md` (committed before the run). **This run is the one authorized `gate3` spend at 6 seats**, under the user's 2026-10-10 authorization quoted in `.claude/specs/simulator/seat-count-programme.md`; no further `gate3` command may run on `extension6` at 6 seats.

`evaluate`, `extension6`, 6 seats, field `app_formula_draft:placement/default-weights.json@placement/default-weights.json`, every seat on `heuristic-v1-trader-aware-threat-devcards-denial` with `--player-trading`, `--threads 0`, 10,000 boards x 2 reps, 120,000 paired units, `--threshold 0.005`, `--alpha 0.05`, run from `simulator/`. Reference `base` is the field spec; `candidate` carries `simulator/placement/arms/sc_coverage_lo.json` on the hero path with the opponent path pinned to the field's weights.

```text
RUSTFLAGS="-D warnings" cargo build --release --manifest-path simulator/Cargo.toml -p unsettled-sim

# the single invocation, from simulator/
target/release/unsettled-sim evaluate --layout extension6 --seats 6 --domain gate3 --field app_formula_draft:placement/default-weights.json@placement/default-weights.json --arm base=app_formula_draft:placement/default-weights.json@placement/default-weights.json --arm candidate=app_formula_draft:placement/arms/sc_coverage_lo.json@placement/default-weights.json --reference base --boards 10000 --reps 2 --policy heuristic-v1-trader-aware-threat-devcards-denial --threads 0 --player-trading --threshold 0.005 --alpha 0.05 --out runs/m81-seats6-gate3
```

**Provenance and admissibility.** The release binary was rebuilt with `RUSTFLAGS="-D warnings"` in its own command block and reported `Finished` in 0.10s against a warm fingerprint. The invocation ran alone in its command block, unpiped. `rustc 1.94.0 (4a4ef493e 2026-03-02)`. It reported domain `gate3` at seed `7670578962881712144`, as preregistered. **Zero illegal actions**, and 0 draws in `base` and 0 in `candidate`. Load before `35.27 48.09 44.01`, after `34.32 39.99 43.31`, other sessions sharing the machine; 4771.874s at 18 workers, 50.3 games/s, 240,000 games. `base` won 19,922 of 120,000 (`0.16601666666666667`), 0.604 binomial standard errors below the `0.16666666666666666` corner and inside the preregistered 3.29, so the corner check passes. `candidate` won 20,749 of 120,000 (`0.17290833333333333`). `simulator/runs/` is gitignored, so this entry is the record.

Pooled, reference `base`:

| Arm | Estimate | b | c | McNemar | Clustered | Selected | Half-width pp | Verdict |
| --- | ---: | ---: | ---: | --- | --- | --- | ---: | --- |
| candidate | `0.006891666666666667` | 4782 | 3955 | `[0.0053655, 0.0084178]` | `[0.0053168, 0.0084666]` | clustered `[0.0053168, 0.0084666]` | 0.1575 | better |

Per-hero-seat, record only; hero seat equals draft slot. Percentage points:

| Arm | pp estimate [interval] | discordant | Slot 0 | Slot 1 | Slot 2 | Slot 3 | Slot 4 | Slot 5 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| candidate | +0.689 `[+0.532, +0.847]` | 8737 | +0.48 `[+0.13, +0.84]` | +0.82 `[+0.43, +1.21]` | +0.46 `[+0.08, +0.84]` | +0.95 `[+0.54, +1.35]` | +0.63 `[+0.24, +1.02]` | +0.80 `[+0.41, +1.18]` |

**The verdict is `better`, and it adopts the candidate as the six-seat vector, by the thinnest margin of the five gates.** `+0.689pp` on `[+0.532pp, +0.847pp]` over 8,737 discordant units of 120,000, the whole interval above the `+0.5pp` bar with 0.03pp to spare at the lower edge. By the preregistered rule `coverageExponent` moves from 1.5 to 1.0 for six-seat rosters: `SEAT_WEIGHT_OVERRIDES[6]` in `src/engine/weights.ts` carries the leaf, `simulator/placement/seat-weights/seats-6.json` is regenerated through `simulator/tools/generate-placement-parity.ts`, and the `SEAT_ADOPTIONS` row in `params_file.rs` moves with it. `DEFAULT_WEIGHTS` and `default-weights.json` do not move.

**Three readings at the same power on three disjoint seed sets fall in order.** `+0.853pp` on the `tuning3` retry, `+0.782pp` on `eval3` and `+0.689pp` here, each on 120,000 paired units. The first was read on seeds that include the ones the arm was selected on. The two held-out readings average `+0.74pp` over 240,000 paired units, and their difference of 0.09pp is about one standard error of a single run's estimate. The discordant share is 7.28% here against 7.30% on `eval3`. Every slot is positive and every slot interval excludes zero.

**The rule adopts, and the size is small.** The decision was fixed before the run as the whole interval above the bar, and it is. A reader should carry the size as about three quarters of a point, with the bar inside the uncertainty of where the true effect sits: an estimate 0.04pp lower would have read `inconclusive` and left six seats on today's vector.

**Prediction against outcome.** **Right on the estimate**, predicted `+0.5pp` to `+1.1pp` centred near `+0.8pp`, delivered `+0.689pp`, in the lower half of the range. **Right on the verdict**, predicted `better` at about 88%, and right that this was the gate most likely to miss.

**Scope, and what this entry may not be cited for.** One contrast, one layout, one seat count, one policy, one domain, one spend. The arm moves the hero's weights alone against five seats on today's vector, so **nothing here measures the world the adoption creates in the app**, where a six-seat analysis scores every seat's picks on the adopted vector. The greedy opponent model inside every hero was measured in M-61 at four seats on `standard4` only, so the verdict may not be described as taken against a correctly specified model. The field is the same on all three domains, so the held-out readings control for seeds and not for field-overfit. The adopted value is the lower endpoint of the key's range in `simulator/placement/sweep-bounds.json` and the only value below the shipped one that was read, so nothing here says it is an optimum. `diversityWeight` stays at 1.6 at six seats because M-79 dropped its arm unresolved at `+0.570pp`, which is a statement about power and not a finding that five and six seats differ. The verdict licenses moving this one leaf at this one seat count and nothing else.

## Correction to M-67 through M-81: seat counts on one layout share boards

2026-10-10, found in code review after M-81. Not a measurement; no run was made for it and the next entry is M-82.

Every preregistration for M-67 through M-81 says board generation consumes layout and seat count, so each seat count draws its own boards. It does not. `generate_board` uses the seat count only to build the player list, after every random draw, and `derive_evaluation_seed` takes no seat count, so on one layout board `i` of a domain has the same tiles, tokens and ports at every seat count. `seat_count_does_not_change_a_domains_boards` in `simulator/crates/cli/tests/evaluate_harness.rs` pins it. Within each domain the four-seat boards (M-67 to M-69) are the first part of the three-seat boards (M-73 to M-75), which are the first part of the two-seat boards (M-70 to M-72), and the six-seat boards (M-79 to M-81) are the first part of the five-seat boards (M-76 to M-78).

**No number in any entry changes, and no verdict.** Each entry's "three disjoint seed sets" are the three domains at one seat count, and those are disjoint. Each seat count's candidate was chosen from that seat count's `tuning3` runs by a rule fixed before any held-out run, so its `eval3` and `gate3` estimates remain unbiased for the vector they tested.

**What may no longer be said.** That the five seat counts are independent replications: readings at two, three and four seats share `standard4` boards, and readings at five and six share `extension6` boards, so agreement within a layout is correlated by an amount no run measured. M-79's remark that linear coverage credit reads `better` at the fifth seat count of five is a count of verdicts, not of independent tests. That a held-out spend at one seat count left the others untouched: in board terms `eval3` and `gate3` are spent per layout. The full statement is in `.claude/specs/simulator/seat-count-programme.md` under "Seed domains and the authorization".


## M-82: 2-seat independent gate on gate4

2026-10-10, commit `a4fe0fff` (the commit that preregistered all five independent gates; no default moved for this run), domain `gate4` (seed `16890014424357517501`). Preregistered in `docs/plans/preregs/2026-10-10-m82-seats2-gate4.md` (committed before the run). **This run is the one `gate4` spend at 2 seats**, under Revision 2 of `.claude/specs/simulator/seat-count-programme.md` and the user's 2026-10-10 go-ahead quoted there; no further `gate4` command may run at 2 seats. The fourth generation folds the seat count into the seed, so these boards and game seeds are shared with no other seat count and no earlier run.

`evaluate`, `standard4`, 2 seats, field `app_formula_draft:placement/default-weights.json@placement/default-weights.json`, every seat on `heuristic-v1-trader-aware-threat-devcards-denial` without `--player-trading` and with `--allow-unofficial`, `--threads 0`, 70,000 boards x 2 reps, 280,000 paired units, `--threshold 0.005`, `--alpha 0.05`, run from `simulator/`. Reference `base` is the field spec; `candidate` carries `simulator/placement/arms/sc_s2_combined.json` on the hero path with the opponent path pinned to the field's weights.

```text
RUSTFLAGS="-D warnings" cargo build --release --manifest-path simulator/Cargo.toml -p unsettled-sim

# the single invocation, from simulator/
target/release/unsettled-sim evaluate --layout standard4 --seats 2 --domain gate4 --field app_formula_draft:placement/default-weights.json@placement/default-weights.json --arm base=app_formula_draft:placement/default-weights.json@placement/default-weights.json --arm candidate=app_formula_draft:placement/arms/sc_s2_combined.json@placement/default-weights.json --reference base --boards 70000 --reps 2 --policy heuristic-v1-trader-aware-threat-devcards-denial --threads 0 --allow-unofficial --threshold 0.005 --alpha 0.05 --out runs/m82-seats2-gate4
```

**Provenance and admissibility.** The release binary was rebuilt with `RUSTFLAGS="-D warnings"` in its own command block and reported `Finished` in 0.03s against a warm fingerprint. The five `gate4` invocations ran one after another from one script, each alone, unpiped, and none shared a shell command with a build or a test suite. `rustc 1.94.0 (4a4ef493e 2026-03-02)`. It reported domain `gate4` at seed `16890014424357517501`, as preregistered. **Zero illegal actions**, and 0 draws in `base` and 0 in `candidate`. Load before `8.45 9.10 8.39`, after `32.92 34.46 25.22`, other sessions sharing the machine; 716.196s at 18 workers, 781.9 games/s, 560,000 games. `base` won 139,828 of 280,000 (`0.49938571428571427`), 0.650 binomial standard errors below the `0.5` corner and inside the preregistered 3.29, so the corner check passes. `candidate` won 147,337 of 280,000 (`0.5262035714285714`). `simulator/runs/` is gitignored, so this entry is the record.

Pooled, reference `base`:

| Arm | Estimate | b | c | McNemar | Clustered | Selected | Half-width pp | Verdict |
| --- | ---: | ---: | ---: | --- | --- | --- | ---: | --- |
| candidate | `0.026817857142857143` | 24901 | 17392 | `[0.0253817, 0.0282540]` | `[0.0253336, 0.0283021]` | clustered `[0.0253336, 0.0283021]` | 0.1484 | better |

Per-hero-seat, record only; hero seat equals draft slot. Percentage points:

| Arm | pp estimate [interval] | discordant | Slot 0 | Slot 1 |
| --- | --- | ---: | ---: | ---: |
| candidate | +2.682 `[+2.533, +2.830]` | 42293 | +2.80 `[+2.59, +3.01]` | +2.56 `[+2.35, +2.78]` |

**The verdict is `better`, so two seats keeps its vector.** `+2.682pp` on `[+2.533pp, +2.830pp]` over 42,293 discordant units of 280,000, the whole interval above the `+0.5pp` bar with 2.03pp to spare. By the preregistered rule the two-seat vector stays as adopted in M-72, and no file moves.

**The reading on boards no other seat count shares matches the third generation's.** `gate3` read `+2.704pp` and `eval3` `+2.714pp` on boards that three and four seats also played; this run reads 0.02pp under the first. The discordant share is 15.1% here against 15.2% and 15.1% there. Both slots are positive and both slot intervals exclude zero.

**Prediction against outcome.** **Right on the estimate**, predicted `+2.2pp` to `+3.1pp` centred near `+2.65pp`, delivered `+2.682pp`. **Right on the verdict**, predicted `better` above 99%.

**Scope, and what this entry may not be cited for.** One contrast, one layout, one seat count, one policy, one domain, one spend. The arm moves the hero's weights alone against one seat on today's vector, so nothing here measures the world the adoption creates in the app, where every seat carries the vector. The greedy opponent model inside every hero was measured in M-61 at four seats on `standard4` only, so the verdict may not be described as taken against a correctly specified model. The field is the same as on every third-generation domain, so this run controls for seeds and for the shared boards, and not for field-overfit. The vector was chosen on `tuning3` boards that other seat counts shared, and this run did not re-screen, so it says the choice holds on independent boards and nothing about whether another arm would have been chosen there. Both shipped values are screening endpoints, so nothing here says either is an optimum.

## M-83: 3-seat independent gate on gate4

2026-10-11, commit `a4fe0fff` (the commit that preregistered all five independent gates; no default moved for this run), domain `gate4` (seed `9339080276862700003`). Preregistered in `docs/plans/preregs/2026-10-10-m83-seats3-gate4.md` (committed before the run). **This run is the one `gate4` spend at 3 seats**, under Revision 2 of `.claude/specs/simulator/seat-count-programme.md` and the user's 2026-10-10 go-ahead quoted there; no further `gate4` command may run at 3 seats. The fourth generation folds the seat count into the seed, so these boards and game seeds are shared with no other seat count and no earlier run.

`evaluate`, `standard4`, 3 seats, field `app_formula_draft:placement/default-weights.json@placement/default-weights.json`, every seat on `heuristic-v1-trader-aware-threat-devcards-denial` with `--player-trading`, `--threads 0`, 42,000 boards x 2 reps, 252,000 paired units, `--threshold 0.005`, `--alpha 0.05`, run from `simulator/`. Reference `base` is the field spec; `candidate` carries `simulator/placement/arms/sc_s2_combined.json` on the hero path with the opponent path pinned to the field's weights.

```text
RUSTFLAGS="-D warnings" cargo build --release --manifest-path simulator/Cargo.toml -p unsettled-sim

# the single invocation, from simulator/
target/release/unsettled-sim evaluate --layout standard4 --seats 3 --domain gate4 --field app_formula_draft:placement/default-weights.json@placement/default-weights.json --arm base=app_formula_draft:placement/default-weights.json@placement/default-weights.json --arm candidate=app_formula_draft:placement/arms/sc_s2_combined.json@placement/default-weights.json --reference base --boards 42000 --reps 2 --policy heuristic-v1-trader-aware-threat-devcards-denial --threads 0 --player-trading --threshold 0.005 --alpha 0.05 --out runs/m83-seats3-gate4
```

**Provenance and admissibility.** The release binary was rebuilt with `RUSTFLAGS="-D warnings"` in its own command block and reported `Finished` in 0.03s against a warm fingerprint. The five `gate4` invocations ran one after another from one script, each alone, unpiped, and none shared a shell command with a build or a test suite. `rustc 1.94.0 (4a4ef493e 2026-03-02)`. It reported domain `gate4` at seed `9339080276862700003`, as preregistered. **Zero illegal actions**, and 0 draws in `base` and 0 in `candidate`. Load before `32.92 34.46 25.22`, after `33.16 34.64 33.33`, other sessions sharing the machine; 1210.075s at 18 workers, 416.5 games/s, 504,000 games. `base` won 84,452 of 252,000 (`0.3351269841269841`), 1.910 binomial standard errors above the `0.3333333333333333` corner and inside the preregistered 3.29, so the corner check passes. `candidate` won 88,737 of 252,000 (`0.3521309523809524`). `simulator/runs/` is gitignored, so this entry is the record.

Pooled, reference `base`:

| Arm | Estimate | b | c | McNemar | Clustered | Selected | Half-width pp | Verdict |
| --- | ---: | ---: | ---: | --- | --- | --- | ---: | --- |
| candidate | `0.017003968253968254` | 22316 | 18031 | `[0.0154431, 0.0185648]` | `[0.0154000, 0.0186080]` | clustered `[0.0154000, 0.0186080]` | 0.1604 | better |

Per-hero-seat, record only; hero seat equals draft slot. Percentage points:

| Arm | pp estimate [interval] | discordant | Slot 0 | Slot 1 | Slot 2 |
| --- | --- | ---: | ---: | ---: | ---: |
| candidate | +1.700 `[+1.540, +1.861]` | 40347 | +1.76 `[+1.48, +2.04]` | +1.65 `[+1.37, +1.93]` | +1.69 `[+1.42, +1.97]` |

**The verdict is `better`, so three seats keeps its vector.** `+1.700pp` on `[+1.540pp, +1.861pp]` over 40,347 discordant units of 252,000, the whole interval above the `+0.5pp` bar with 1.04pp to spare. By the preregistered rule the three-seat vector stays as adopted in M-75, and no file moves.

**The reading is a little under the third generation's and well clear of the bar.** `gate3` read `+1.924pp` and `eval3` `+1.801pp`; this run reads 0.22pp under the first, which is about two standard errors of the difference between two runs of this size and in the direction the preregistration expected from readings that were only taken because the one before them passed. Every slot is positive and every slot interval excludes zero.

**Prediction against outcome.** **Right on the estimate**, predicted `+1.4pp` to `+2.3pp` centred near `+1.8pp`, delivered `+1.700pp`. **Right on the verdict**, predicted `better` above 99%.

**Scope, and what this entry may not be cited for.** One contrast, one layout, one seat count, one policy, one domain, one spend. The arm moves the hero's weights alone against two seats on today's vector, so nothing here measures the world the adoption creates in the app, where every seat carries the vector. The greedy opponent model inside every hero was measured in M-61 at four seats on `standard4` only, so the verdict may not be described as taken against a correctly specified model. The field is the same as on every third-generation domain, so this run controls for seeds and for the shared boards, and not for field-overfit. The vector was chosen on `tuning3` boards that other seat counts shared, and this run did not re-screen, so it says the choice holds on independent boards and nothing about whether another arm would have been chosen there. Both shipped values are screening endpoints, so nothing here says either is an optimum.

## M-84: 4-seat independent gate on gate4

2026-10-11, commit `a4fe0fff` (the commit that preregistered all five independent gates; no default moved for this run), domain `gate4` (seed `16013495161676280900`). Preregistered in `docs/plans/preregs/2026-10-10-m84-seats4-gate4.md` (committed before the run). **This run is the one `gate4` spend at 4 seats**, under Revision 2 of `.claude/specs/simulator/seat-count-programme.md` and the user's 2026-10-10 go-ahead quoted there; no further `gate4` command may run at 4 seats. The fourth generation folds the seat count into the seed, so these boards and game seeds are shared with no other seat count and no earlier run.

`evaluate`, `standard4`, 4 seats, field `app_formula_draft:placement/default-weights.json@placement/default-weights.json`, every seat on `heuristic-v1-trader-aware-threat-devcards-denial` with `--player-trading`, `--threads 0`, 36,000 boards x 2 reps, 288,000 paired units, `--threshold 0.005`, `--alpha 0.05`, run from `simulator/`. Reference `base` is the field spec; `candidate` carries `simulator/placement/arms/sc_coverage_lo.json` on the hero path with the opponent path pinned to the field's weights.

```text
RUSTFLAGS="-D warnings" cargo build --release --manifest-path simulator/Cargo.toml -p unsettled-sim

# the single invocation, from simulator/
target/release/unsettled-sim evaluate --layout standard4 --seats 4 --domain gate4 --field app_formula_draft:placement/default-weights.json@placement/default-weights.json --arm base=app_formula_draft:placement/default-weights.json@placement/default-weights.json --arm candidate=app_formula_draft:placement/arms/sc_coverage_lo.json@placement/default-weights.json --reference base --boards 36000 --reps 2 --policy heuristic-v1-trader-aware-threat-devcards-denial --threads 0 --player-trading --threshold 0.005 --alpha 0.05 --out runs/m84-seats4-gate4
```

**Provenance and admissibility.** The release binary was rebuilt with `RUSTFLAGS="-D warnings"` in its own command block and reported `Finished` in 0.03s against a warm fingerprint. The five `gate4` invocations ran one after another from one script, each alone, unpiped, and none shared a shell command with a build or a test suite. `rustc 1.94.0 (4a4ef493e 2026-03-02)`. It reported domain `gate4` at seed `16013495161676280900`, as preregistered. **Zero illegal actions**, and 0 draws in `base` and 0 in `candidate`. Load before `33.16 34.64 33.33`, after `49.44 42.59 38.93`, other sessions sharing the machine; 2169.989s at 18 workers, 265.4 games/s, 576,000 games. `base` won 72,001 of 288,000 (`0.25000347222222224`), 0.004 binomial standard errors above the `0.25` corner and inside the preregistered 3.29, so the corner check passes. `candidate` won 74,663 of 288,000 (`0.2592465277777778`). `simulator/runs/` is gitignored, so this entry is the record.

Pooled, reference `base`:

| Arm | Estimate | b | c | McNemar | Clustered | Selected | Half-width pp | Verdict |
| --- | ---: | ---: | ---: | --- | --- | --- | ---: | --- |
| candidate | `0.009243055555555555` | 13562 | 10900 | `[0.0081792, 0.0103069]` | `[0.0081516, 0.0103345]` | clustered `[0.0081516, 0.0103345]` | 0.1091 | better |

Per-hero-seat, record only; hero seat equals draft slot. Percentage points:

| Arm | pp estimate [interval] | discordant | Slot 0 | Slot 1 | Slot 2 | Slot 3 |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| candidate | +0.924 `[+0.815, +1.033]` | 24462 | +0.66 `[+0.45, +0.86]` | +1.04 `[+0.82, +1.26]` | +0.86 `[+0.64, +1.09]` | +1.13 `[+0.91, +1.36]` |

**The verdict is `better`, so four seats keeps its vector.** `+0.924pp` on `[+0.815pp, +1.033pp]` over 24,462 discordant units of 288,000, the whole interval above the `+0.5pp` bar with 0.32pp to spare. By the preregistered rule the four-seat vector stays as adopted in M-69, and no file moves.

**At twice the power, on independent boards, the reading sits between the two third-generation ones.** `eval3` read `+0.977pp` and `gate3` `+0.844pp` at 18000 boards; this run reads `+0.924pp` at 36000 with a half-width of 0.109pp against their 0.155pp and 0.153pp. Every slot is positive and every slot interval excludes zero, the first slot lowest at `+0.66pp`.

**Prediction against outcome.** **Right on the estimate**, predicted `+0.6pp` to `+1.15pp` centred near `+0.85pp`, delivered `+0.924pp`. **Right on the verdict**, predicted `better` at about 96%. **Right on the half-width**, predicted about `+/-0.11pp`, delivered `+/-0.109pp`.

**Scope, and what this entry may not be cited for.** One contrast, one layout, one seat count, one policy, one domain, one spend. The arm moves the hero's weights alone against three seats on today's vector, so nothing here measures the world the adoption creates in the app, where every seat carries the vector. The greedy opponent model inside every hero was measured in M-61 at four seats on `standard4` only, so the verdict may not be described as taken against a correctly specified model. The field is the same as on every third-generation domain, so this run controls for seeds and for the shared boards, and not for field-overfit. The vector was chosen on `tuning3` boards that other seat counts shared, and this run did not re-screen, so it says the choice holds on independent boards and nothing about whether another arm would have been chosen there. The shipped value is the lower endpoint of its declared range, so nothing here says it is an optimum, and `diversityWeight` was not read here: M-67 dropped its arm unresolved.

## M-85: 5-seat independent gate on gate4

2026-10-11, commit `a4fe0fff` (the commit that preregistered all five independent gates; no default moved for this run), domain `gate4` (seed `15970491955241482323`). Preregistered in `docs/plans/preregs/2026-10-10-m85-seats5-gate4.md` (committed before the run). **This run is the one `gate4` spend at 5 seats**, under Revision 2 of `.claude/specs/simulator/seat-count-programme.md` and the user's 2026-10-10 go-ahead quoted there; no further `gate4` command may run at 5 seats. The fourth generation folds the seat count into the seed, so these boards and game seeds are shared with no other seat count and no earlier run.

`evaluate`, `extension6`, 5 seats, field `app_formula_draft:placement/default-weights.json@placement/default-weights.json`, every seat on `heuristic-v1-trader-aware-threat-devcards-denial` with `--player-trading`, `--threads 0`, 18,000 boards x 2 reps, 180,000 paired units, `--threshold 0.005`, `--alpha 0.05`, run from `simulator/`. Reference `base` is the field spec; `candidate` carries `simulator/placement/arms/sc_s2_combined.json` on the hero path with the opponent path pinned to the field's weights.

```text
RUSTFLAGS="-D warnings" cargo build --release --manifest-path simulator/Cargo.toml -p unsettled-sim

# the single invocation, from simulator/
target/release/unsettled-sim evaluate --layout extension6 --seats 5 --domain gate4 --field app_formula_draft:placement/default-weights.json@placement/default-weights.json --arm base=app_formula_draft:placement/default-weights.json@placement/default-weights.json --arm candidate=app_formula_draft:placement/arms/sc_s2_combined.json@placement/default-weights.json --reference base --boards 18000 --reps 2 --policy heuristic-v1-trader-aware-threat-devcards-denial --threads 0 --player-trading --threshold 0.005 --alpha 0.05 --out runs/m85-seats5-gate4
```

**Provenance and admissibility.** The release binary was rebuilt with `RUSTFLAGS="-D warnings"` in its own command block and reported `Finished` in 0.03s against a warm fingerprint. The five `gate4` invocations ran one after another from one script, each alone, unpiped, and none shared a shell command with a build or a test suite. `rustc 1.94.0 (4a4ef493e 2026-03-02)`. It reported domain `gate4` at seed `15970491955241482323`, as preregistered. **Zero illegal actions**, and 0 draws in `base` and 0 in `candidate`. Load before `49.44 42.59 38.93`, after `45.87 45.29 44.62`, other sessions sharing the machine; 4830.499s at 18 workers, 74.5 games/s, 360,000 games. `base` won 35,831 of 180,000 (`0.1990611111111111`), 0.996 binomial standard errors below the `0.2` corner and inside the preregistered 3.29, so the corner check passes. `candidate` won 38,881 of 180,000 (`0.21600555555555556`). `simulator/runs/` is gitignored, so this entry is the record.

Pooled, reference `base`:

| Arm | Estimate | b | c | McNemar | Clustered | Selected | Half-width pp | Verdict |
| --- | ---: | ---: | ---: | --- | --- | --- | ---: | --- |
| candidate | `0.016944444444444446` | 13426 | 10376 | `[0.0152664, 0.0186225]` | `[0.0152101, 0.0186787]` | clustered `[0.0152101, 0.0186787]` | 0.1734 | better |

Per-hero-seat, record only; hero seat equals draft slot. Percentage points:

| Arm | pp estimate [interval] | discordant | Slot 0 | Slot 1 | Slot 2 | Slot 3 | Slot 4 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| candidate | +1.694 `[+1.521, +1.868]` | 23802 | +1.49 `[+1.11, +1.88]` | +1.57 `[+1.17, +1.96]` | +1.93 `[+1.54, +2.31]` | +1.86 `[+1.48, +2.23]` | +1.63 `[+1.25, +2.01]` |

**The verdict is `better`, so five seats keeps its vector.** `+1.694pp` on `[+1.521pp, +1.868pp]` over 23,802 discordant units of 180,000, the whole interval above the `+0.5pp` bar with 1.02pp to spare. By the preregistered rule the five-seat vector stays as adopted in M-78, and no file moves.

**The reading on boards six seats does not share sits between the two third-generation ones.** `eval3` read `+1.738pp` and `gate3` `+1.524pp`; this run reads `+1.694pp`. The discordant share is 13.2%, as it was on both. Every slot is positive and every slot interval excludes zero.

**Prediction against outcome.** **Right on the estimate**, predicted `+1.1pp` to `+2.0pp` centred near `+1.55pp`, delivered `+1.694pp`. **Right on the verdict**, predicted `better` at about 99%.

**Scope, and what this entry may not be cited for.** One contrast, one layout, one seat count, one policy, one domain, one spend. The arm moves the hero's weights alone against four seats on today's vector, so nothing here measures the world the adoption creates in the app, where every seat carries the vector. The greedy opponent model inside every hero was measured in M-61 at four seats on `standard4` only, so the verdict may not be described as taken against a correctly specified model. The field is the same as on every third-generation domain, so this run controls for seeds and for the shared boards, and not for field-overfit. The vector was chosen on `tuning3` boards that other seat counts shared, and this run did not re-screen, so it says the choice holds on independent boards and nothing about whether another arm would have been chosen there. The run reads the pair of changes together; the case for carrying both halves still rests on M-76. Both shipped values are screening endpoints.

## M-86: 6-seat independent gate on gate4

2026-10-11, commit `a4fe0fff` (the commit that preregistered all five independent gates; no default moved for this run), domain `gate4` (seed `4584976607990361878`). Preregistered in `docs/plans/preregs/2026-10-10-m86-seats6-gate4.md` (committed before the run). **This run is the one `gate4` spend at 6 seats**, under Revision 2 of `.claude/specs/simulator/seat-count-programme.md` and the user's 2026-10-10 go-ahead quoted there; no further `gate4` command may run at 6 seats. The fourth generation folds the seat count into the seed, so these boards and game seeds are shared with no other seat count and no earlier run.

`evaluate`, `extension6`, 6 seats, field `app_formula_draft:placement/default-weights.json@placement/default-weights.json`, every seat on `heuristic-v1-trader-aware-threat-devcards-denial` with `--player-trading`, `--threads 0`, 20,000 boards x 2 reps, 240,000 paired units, `--threshold 0.005`, `--alpha 0.05`, run from `simulator/`. Reference `base` is the field spec; `candidate` carries `simulator/placement/arms/sc_coverage_lo.json` on the hero path with the opponent path pinned to the field's weights.

```text
RUSTFLAGS="-D warnings" cargo build --release --manifest-path simulator/Cargo.toml -p unsettled-sim

# the single invocation, from simulator/
target/release/unsettled-sim evaluate --layout extension6 --seats 6 --domain gate4 --field app_formula_draft:placement/default-weights.json@placement/default-weights.json --arm base=app_formula_draft:placement/default-weights.json@placement/default-weights.json --arm candidate=app_formula_draft:placement/arms/sc_coverage_lo.json@placement/default-weights.json --reference base --boards 20000 --reps 2 --policy heuristic-v1-trader-aware-threat-devcards-denial --threads 0 --player-trading --threshold 0.005 --alpha 0.05 --out runs/m86-seats6-gate4
```

**Provenance and admissibility.** The release binary was rebuilt with `RUSTFLAGS="-D warnings"` in its own command block and reported `Finished` in 0.03s against a warm fingerprint. The five `gate4` invocations ran one after another from one script, each alone, unpiped, and none shared a shell command with a build or a test suite. `rustc 1.94.0 (4a4ef493e 2026-03-02)`. It reported domain `gate4` at seed `4584976607990361878`, as preregistered. **Zero illegal actions**, and 0 draws in `base` and 0 in `candidate`. Load before `45.87 45.29 44.62`, after `54.23 54.56 54.69`, other sessions sharing the machine; 7827.990s at 18 workers, 61.3 games/s, 480,000 games. `base` won 39,999 of 240,000 (`0.1666625`), 0.005 binomial standard errors below the `0.16666666666666666` corner and inside the preregistered 3.29, so the corner check passes. `candidate` won 41,952 of 240,000 (`0.1748`). `simulator/runs/` is gitignored, so this entry is the record.

Pooled, reference `base`:

| Arm | Estimate | b | c | McNemar | Clustered | Selected | Half-width pp | Verdict |
| --- | ---: | ---: | ---: | --- | --- | --- | ---: | --- |
| candidate | `0.0081375` | 9713 | 7760 | `[0.0070585, 0.0092165]` | `[0.0070221, 0.0092529]` | clustered `[0.0070221, 0.0092529]` | 0.1115 | better |

Per-hero-seat, record only; hero seat equals draft slot. Percentage points:

| Arm | pp estimate [interval] | discordant | Slot 0 | Slot 1 | Slot 2 | Slot 3 | Slot 4 | Slot 5 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| candidate | +0.814 `[+0.702, +0.925]` | 17473 | +0.56 `[+0.30, +0.83]` | +0.64 `[+0.38, +0.91]` | +1.08 `[+0.80, +1.36]` | +0.90 `[+0.62, +1.17]` | +0.71 `[+0.44, +0.98]` | +0.99 `[+0.71, +1.27]` |

**The verdict is `better`, so six seats keeps its vector, and this time with room.** `+0.814pp` on `[+0.702pp, +0.925pp]` over 17,473 discordant units of 240,000, the whole interval above the `+0.5pp` bar with 0.20pp to spare, where `gate3` cleared it by 0.03pp. By the preregistered rule the six-seat vector stays as adopted in M-81, and no file moves.

**At twice the power, on independent boards, the reading is above both third-generation ones.** `eval3` read `+0.782pp` and `gate3` `+0.689pp` at 10000 boards; this run reads `+0.814pp` at 20000 with a half-width of 0.112pp against their 0.157pp. The preregistration centred under both on the argument that readings taken only because the one before them passed run high; that shrinkage did not appear. The discordant share is 7.28%, as on `gate3`. Every slot is positive and every slot interval excludes zero.

**Prediction against outcome.** **Right on the estimate, in the upper half of the range**, predicted `+0.45pp` to `+0.95pp` centred near `+0.7pp`, delivered `+0.814pp`. **Right on the verdict**, predicted `better` at about 85%. **Right on the half-width**, predicted about `+/-0.11pp`, delivered `+/-0.112pp`. This was named as the seat count most likely to return to today's vector, and it did not.

**Scope, and what this entry may not be cited for.** One contrast, one layout, one seat count, one policy, one domain, one spend. The arm moves the hero's weights alone against five seats on today's vector, so nothing here measures the world the adoption creates in the app, where every seat carries the vector. The greedy opponent model inside every hero was measured in M-61 at four seats on `standard4` only, so the verdict may not be described as taken against a correctly specified model. The field is the same as on every third-generation domain, so this run controls for seeds and for the shared boards, and not for field-overfit. The vector was chosen on `tuning3` boards that other seat counts shared, and this run did not re-screen, so it says the choice holds on independent boards and nothing about whether another arm would have been chosen there. The shipped value is the lower endpoint of its declared range, so nothing here says it is an optimum, and `diversityWeight` was not read here: M-79 dropped its arm unresolved.

## M-87: where a game's time goes after M-66, and the setup lookahead at half its cost

2026-10-11, base commit `f4f11422`, candidate commit `9406c86a` (measured before it was committed, as commit object `49a5bd92` carrying the same simulator sources on `f4f11422`). No seed domain: `bench` runs on `PERF_SEED` and the profiles on a plain `--seed 7`. Plan in `docs/plans/completed/simulator-lookahead-speed.md`. **Admissible: yes for the instruction counts and the hashes. The local wall times were taken under load averages of 6 to 7 and are a cross-check only.**

```text
# profile, from simulator/, one thread, sampled for 10 seconds with /usr/bin/sample
target/release/unsettled-sim simulate --board ../src/parser/__tests__/expected/board-draft-empty.json --games 200000 --heuristics 'app_formula_draft:placement/default-weights.json@placement/default-weights.json' --policy heuristic-v1-trader-aware-threat-devcards-denial --player-trading --seed 7 --threads 1 --out <dir>

# box, from the repo root: both commits built by one toolchain, three alternated wall rounds, then callgrind
box run simulator/box/bench --ref base=f4f11422 --ref cand=49a5bd92 --node none

# local cross-check, from simulator/, base and candidate binaries alternated, two passes each
<binary> bench --filter placement/ --json <path>
<binary> bench --filter e2e/ --json <path>
```

**Since M-66 the draft-aware setup is nearly all of a game's time.** At the base commit 97% of the samples of a four-seat game sit under `GameArena::setup_pick`, in `draft::first_pick`'s lookahead. `ScoreRows` keeps a rival's scored row only while both formulas carry `expansionWeight` 0, because the expansion walk reads occupancy the replay moves; M-66 set the weight to 0.1, so every replayed pick has rescored every vertex since. The per-decision policy cost, Longest Road included, is the remaining 3%. Whole-game throughput on this field therefore measures placement cost, and the earlier profiles that named Longest Road predate M-66.

**Three changes, none of which moves an output bit.** `expansion::term` scores the holdings' own diversity total once per call instead of once per site. `ScoreRows::legal_row` scores only the vertices a scan can read when rows are not cached. `coverage` keeps its `powf` results in a 64-slot per-thread table keyed by the bits of both operands. `fixtures/bench-hashes.json` did not move, and every state and decision hash matched between base and candidate in every local run.

Box run `20261011T101323Z-b2b7d029`, `rustc 1.94.0`, 4 vCPU. `Ir` is callgrind instructions per call:

| Scenario | Base Ir | Candidate Ir | Ir ratio | Wall ratio |
| --- | ---: | ---: | ---: | ---: |
| `placement/standard4/prepare` | 137,582 | 137,584 | 1.000 | 1.008 |
| `placement/standard4/score_all` | 1,657,629 | 1,048,970 | 0.633 | 0.453 |
| `placement/standard4/greedy/first` | 1,688,737 | 1,064,914 | 0.631 | 0.457 |
| `placement/standard4/draft/first` | 485,592,115 | 242,884,646 | 0.500 | 0.385 |
| `placement/standard4/draft/middle` | 176,986,478 | 86,602,346 | 0.489 | 0.367 |
| `placement/standard4/full_draft` | 1,040,771,322 | 512,273,077 | 0.492 | 0.371 |
| `placement/extension6/prepare` | 190,507 | 190,380 | 0.999 | 1.011 |
| `placement/extension6/score_all` | 2,549,070 | 1,605,480 | 0.630 | 0.434 |
| `placement/extension6/greedy/first` | 2,582,410 | 1,622,565 | 0.628 | 0.431 |
| `placement/extension6/draft/first` | 1,715,890,463 | 885,659,733 | 0.516 | 0.412 |
| `placement/extension6/draft/middle` | 660,571,491 | 334,702,524 | 0.507 | 0.374 |
| `placement/extension6/full_draft` | 5,214,763,376 | 2,651,421,956 | 0.508 | 0.395 |

The `decision` rows count the same instructions on both sides to the unit, as they should: no policy code changed. The `advise` rows move by at most 1.2% in either direction. Whole games on the box, wall time only: `e2e/standard4` 0.397 on one core and 0.463 on all, `e2e/extension6` 0.408 and 0.470. Wall time falls further than the instruction count because the instructions removed are `pow` calls, which cost more time each than the average instruction. The gap is wider on the box than on the acceptance machine.

Acceptance machine, load `7.28 7.08 6.71` before and `6.42 6.87 6.65` after, fastest pass of two per side:

| Scenario | Base | Candidate | Speed-up |
| --- | ---: | ---: | ---: |
| `placement/standard4/full_draft` | 33.0 ms | 16.3 ms | 2.02x |
| `placement/extension6/full_draft` | 160.1 ms | 81.8 ms | 1.96x |
| `e2e/standard4/single_core` | 27.7 games/s | 54.0 games/s | 1.95x |
| `e2e/standard4/all_cores` | 238.1 games/s | 468.6 games/s | 1.97x |
| `e2e/extension6/single_core` | 5.8 games/s | 11.4 games/s | 1.97x |
| `e2e/extension6/all_cores` | 50.3 games/s | 85.7 games/s | 1.70x |

Step by step on `standard4/full_draft`, same machine: the diversity hoist alone 1.15x to 1.22x on every row that scores with the expansion term, with `legal_row` 1.65x, with the `powf` table 2.0x. With the four-seat shipped vector (`placement/seat-weights/seats-4.json`, `coverageExponent` 1) the last two read 1.65x and 2.04x, so the table pays at an exponent of 1 as well.

**What is left.** Setup is still about 95% of a game. A profile of the candidate puts `expansion::term` with its walk and inlined site pricing at 59% of samples, `diversity_score` at 13%, `port_delta` at 8%, `legal_row`'s own loop at 4% and `pow` at 4%, from about a third. The next candidate is a per-lookahead cache of site prices, which read only the holdings, the candidate and the site and never the occupancy. It would hit on rival rows only, since the hero's own second-settlement row is keyed by the candidate being weighed, and it was not built.

**Scope.** Code cost only: no placement, policy or rule changed, so no win rate and no earlier measurement moves. The wall ratios are one field, `app_formula_draft` on the default weights with the denial policy; a greedy field never enters the lookahead and gains only the `score_all` ratio.

## M-88: the setup lookahead at an eighth of its cost, and a trade response at a ninth

2026-10-11, base commit `1ff6a7dd`, candidate commit `53578bbe` (branch `sim-speed`). No seed domain: `bench` runs on `PERF_SEED`. **Admissible: yes for the instruction counts and the hashes. The local wall times were taken hours apart under load averages of 3 to 5, base before candidate rather than alternated, and are a cross-check only.**

```text
# box, from the repo root: both commits built by one toolchain, three alternated wall rounds, then callgrind
box run simulator/box/bench --ref base=main --ref cand=sim-speed --node none

# local cross-check, from simulator/
target/release/unsettled-sim bench --filter e2e/ --games 40 --repeats 3
target/release/unsettled-sim bench --filter full_draft --repeats 5
```

**What changed, none of which moves an output bit.** `fixtures/bench-hashes.json` and the advice parity fixture are unchanged, and the box reported no differing state or decision hash.

- An uncached lookahead row no longer calls `score_for_owner` per vertex. It reads the board into occupancy bit masks once, takes each candidate's reachable sites from a per-adjacency table of two- and three-edge walks (or from a bit-mask walk when one of the seat's own roads is in reach), and prices sites through a per-holdings `SitePricer`.
- Per-thread tables remember what repeats across a lookahead's candidates: site prices and base totals by scorer and own vertices, whole expansion values by the site masks they were folded from, reachable sites by the occupancy the scan read, and general walks by the vertices and edges each walk read. Every hit compares its full key; nothing is keyed by a counter the engine maintains.
- A setup road is chosen from the same masks and remembered prices instead of a second `term` call.
- A trade response under the ETW trader asks whether any building goal exists instead of ranking all of them, `score_offers` returns before pricing rivals when no offer can be legal, and `best_road` scores each settlement vertex once per call.
- `expansion::walk`, `expansion::term` and `score_for_owner` are untouched: they are the reference the new tests compare against bit for bit, and the greedy path still runs on them.

Box run `20261011T155123Z-f71231e1`, `rustc 1.99.0`, 4 vCPU. `Ir` is callgrind instructions per call:

| Scenario | Base Ir | Candidate Ir | Ir ratio | Wall ratio |
| --- | ---: | ---: | ---: | ---: |
| `placement/standard4/prepare` | 137,352 | 146,337 | 1.065 | 0.998 |
| `placement/standard4/score_all` | 1,049,127 | 1,053,383 | 1.004 | 1.026 |
| `placement/standard4/draft/first` | 242,884,628 | 24,661,377 | 0.102 | 0.106 |
| `placement/standard4/draft/middle` | 86,602,374 | 14,226,489 | 0.164 | 0.164 |
| `placement/standard4/full_draft` | 512,273,130 | 64,597,129 | 0.126 | 0.144 |
| `placement/extension6/prepare` | 188,431 | 201,406 | 1.069 | 1.035 |
| `placement/extension6/score_all` | 1,605,842 | 1,611,612 | 1.004 | 1.009 |
| `placement/extension6/draft/first` | 885,659,733 | 67,528,779 | 0.076 | 0.087 |
| `placement/extension6/draft/middle` | 334,702,524 | 37,442,582 | 0.112 | 0.116 |
| `placement/extension6/full_draft` | 2,651,421,866 | 249,562,403 | 0.094 | 0.112 |

Whole games on the box, wall time only: `e2e/standard4` 0.201 on one core and 0.191 on all, `e2e/extension6` 0.138 and 0.128. That is 5.0x and 5.2x at four seats, 7.2x and 7.8x at six. The `respond_trade` rows count 0.12 to 0.13 of their instructions at four seats and 0.09 to 0.12 at six; the `action` rows 0.77 to 0.97 and `pre_roll` 0.93 to 1.00; `discard`, `robber` and `select_counterparty` count the same instructions to the unit; the `advise` rows move by under 2%. `prepare` costs 6.5% more instructions because a scorer now builds its decay powers and per-vertex token lists; the reach table itself is shared per adjacency per thread.

Acceptance machine, fastest pass per side:

| Scenario | Base | Candidate | Speed-up |
| --- | ---: | ---: | ---: |
| `placement/standard4/full_draft` | 16.6 ms | 2.06 ms | 8.1x |
| `placement/extension6/full_draft` | 73.6 ms | 8.95 ms | 8.2x |
| `e2e/standard4/single_core` | 53.6 games/s | 273.6 games/s | 5.1x |
| `e2e/standard4/all_cores` | 564.6 games/s | 2,981 games/s | 5.3x |
| `e2e/extension6/single_core` | 11.4 to 12.8 games/s | 80.5 games/s | 6.3x to 7.1x |
| `e2e/extension6/all_cores` | 118.5 games/s | 906 games/s | 7.6x |

**A trap this run found.** A table of `decay.powf(k)` built in a loop over constant `k` is not the reference's `powf`: release builds unroll the loop and LLVM rewrites `pow(x, 2.0)` to `x * x`, which differs from libm's `pow` in the last bit for some decays whose square is inexact (reproduced on arm64 macOS). Every shipped vector has a decay of 0.5 or 1, exact either way, so no committed result was touched, but a sweep arm with any other decay would have diverged from `term` by one ULP in release only. The table is now built through a non-inlined helper with an opaque exponent, and `cached_decays_match_runtime_powers` sweeps 4,094 decays in both profiles.

**Measured and not kept.** The per-vertex token-number list in `duplicate_number_penalty` made the `score_all` and `greedy` rows 6% to 9% slower in wall time on the box at 1% more instructions, and 11% faster on the acceptance machine, so the reference path keeps the dense loop and only `SitePricer` reads the list. Building a row's holdings lazily from the own-vertex mask lost on both layouts. Sharing one legality-and-score predicate between `has_goal` and `best_scored_vertex` slowed `decision/standard4/action/early` by 7%.

**What is left.** Setup is about 57% of a four-seat game and 72% of a six-seat one on the acceptance machine (2.06 of 3.64 ms, 8.95 of 12.4 ms). Not built: a setup road's per-first-edge sites read from the reach table instead of up to three mask walks, and occupancy masks carried across the replay instead of rebuilt from the owner arrays per row.

**Scope.** Code cost only: no placement, policy or rule changed, so no win rate and no earlier measurement moves. The wall ratios are one field, `app_formula_draft` on the default weights with the denial policy and trading on; a greedy field never enters the lookahead and gains only what the `decision` rows show.

## M-89: the lookahead's rows without the losing candidates, and play's repeated estimates

2026-10-11, base commit `f619a83a` (`main`, code equal to M-88's candidate), candidate commit `0a91a5e8` (branch `sim-speed`, measured before its rebase as `d358bfc6`; the two commits after it change tests, comments and the rebuilt `engine.wasm`). No seed domain: `bench` runs on `PERF_SEED`. **Admissible: yes for the instruction counts and the hashes. The local wall times were taken under load averages of 4 to 8 and are a cross-check only.**

```text
# box, from the repo root
box run simulator/box/bench --ref base=main --ref cand=sim-speed --node none

# local cross-check, from simulator/
target/release/unsettled-sim bench --filter e2e/ --games 40 --repeats 3
target/release/unsettled-sim bench --filter full_draft --repeats 5
```

**Where the time was.** A sampled profile of whole games at M-88's commit: the hero's own second-pick row 26% of a four-seat game and 25% of a six-seat one, the rivals' replay rows 26% and 41%, setup roads 6% and 6%, turn-by-turn play 39% and 24%. Inside play at four seats, `etw::expected_turns_to_win` was 7.5% of the game and `etw::inputs_for_seat` 5.0%, most of both from trade pricing; `RoadNetwork::search` was 5.8%, three quarters of it from one-edge probes.

**What changed, none of which moves an output bit.** `fixtures/bench-hashes.json` and the advice parity fixture are unchanged, and the box reported no differing state or decision hash.

- Every lookahead row is read only through an argmax, so a row no longer prices the expansion term for a candidate that cannot win. Each candidate gets an upper bound on `scale.expansion * row_value(v)` built from its exact base, its exact `SitePricer` total and port products, and per-vertex tables of the two largest site bases and the largest port terms over the sites it could reach. The exact term is computed for the first legal vertex, for the legal vertex with the largest base, and then only where the bound is not strictly below the best score so far. The hero's row skips 80% of its candidates at four seats and 84% at six; rivals' rows skip 86% and 90%.
- The bound is exact by construction, with no slack constant: it repeats `SitePricer::price` and `row_value` operation for operation with operands that are never smaller, and rounding is monotone. That needs signs, so `build_expansion_bounds` refuses any vector with a negative or non-finite weight on the path (and the pricer's fallback form), and such a vector takes the full row as before. A non-finite bound or a NaN score also abandons the row to the full path. Debug builds compute the full row as well and assert the same vertex and score bits.
- The argmax keeps `best_legal_mask`'s rule: the lowest index among equal maxima, and the first legal vertex held unless something is strictly greater.
- A decision that prices trade offers computes each seat's win-distance inputs, prepared estimate and base value once (`EtwCache`, alive for that decision only). `EtwEstimate` holds the part of `expected_turns_to_win` that does not read the hand, and `TradeValue` the part of `trade_benefit_with_base` that does not read the offer, so pricing an offer re-evaluates the hand alone. The direct functions are untouched and are what the new tests compare against.
- A seat's road network and its one-edge probe results are remembered per thread while the seat's own edges and the vertices rivals hold are unchanged, and the denial policy's one-road reach while vertex and edge ownership are unchanged. Over eight four-seat games probe searches fell from about 18,600 to 2,000 and reach scans from 7,870 to 830. Both validate by content, never by a counter the engine maintains.

Box run `20261012T004505Z-3f1dfc3e`, 4 vCPU. `Ir` is callgrind instructions per call:

| Scenario | Base Ir | Candidate Ir | Ir ratio | Wall ratio |
| --- | ---: | ---: | ---: | ---: |
| `placement/standard4/prepare` | 146,308 | 146,735 | 1.003 | 1.004 |
| `placement/standard4/score_all` | 1,053,208 | 1,053,179 | 1.000 | 1.001 |
| `placement/standard4/draft/first` | 24,661,567 | 13,916,453 | 0.564 | 0.508 |
| `placement/standard4/draft/middle` | 14,226,489 | 7,940,834 | 0.558 | 0.530 |
| `placement/standard4/full_draft` | 64,597,204 | 36,543,145 | 0.566 | 0.528 |
| `placement/extension6/prepare` | 200,876 | 202,228 | 1.007 | 1.009 |
| `placement/extension6/score_all` | 1,611,591 | 1,611,703 | 1.000 | 1.008 |
| `placement/extension6/draft/first` | 67,528,483 | 37,396,193 | 0.554 | 0.461 |
| `placement/extension6/draft/middle` | 37,442,445 | 19,568,033 | 0.523 | 0.498 |
| `placement/extension6/full_draft` | 249,562,371 | 134,010,563 | 0.537 | 0.479 |

Whole games on the box, wall time only: `e2e/standard4` 0.601 on one core and 0.602 on all, `e2e/extension6` 0.525 and 0.535. That is 1.66x at four seats and 1.90x at six on top of M-88. The `action` rows count 0.52 to 0.75 of their instructions at four seats (`long_road` 0.91) and 0.50 to 0.62 at six; `pre_roll` 0.50 to 0.55 early and late at four seats, unchanged mid, and 0.53 to 0.61 at six. `discard` counts the same instructions to the unit, `robber`, `respond_trade` and `select_counterparty` within 0.7%, and the `advise` rows between 0.5% fewer and 1.3% more.

Acceptance machine, fastest pass per side, base read earlier the same evening:

| Scenario | Base | Candidate | Speed-up |
| --- | ---: | ---: | ---: |
| `placement/standard4/full_draft` | 2.06 ms | 0.93 ms | 2.2x |
| `placement/extension6/full_draft` | 8.95 ms | 4.07 ms | 2.2x |
| `e2e/standard4/single_core` | 274 games/s | 448 games/s | 1.6x |
| `e2e/standard4/all_cores` | 2,981 games/s | 4,627 games/s | 1.6x |
| `e2e/extension6/single_core` | 80.5 games/s | 151.6 games/s | 1.9x |
| `e2e/extension6/all_cores` | 906 games/s | 1,430 games/s | 1.6x |

**Read the `decision` rows with care from here on.** A `decision` row replays one state, so the per-thread road and reach memos hit on every pass after the first, which a real game does only while the board is unchanged between decisions. The `pre_roll` and `action` ratios above overstate what a game gains from those two memos; the `e2e` rows and the call counts are the honest reading.

**Measured and not kept.** A bound from board-wide maxima alone, without the candidate's own pricer total and port products, came out 8 to 9 times the true value because of the port term and skipped only 21% to 45% of candidates. Keeping the win-distance cache inside every `DecisionView` made each view 1,056 bytes instead of 288 and slowed `respond_trade`, `robber` and `select_counterparty` by 3% to 5%, so the cache is borrowed by the decisions that price offers instead. Carrying the outer view's cached masks into that scope cost 2.5% to 2.9% on `decision/extension6/action/full_hand`.

**What is left.** Setup is about 41% of a four-seat game and 61% of a six-seat one on the acceptance machine (0.93 of 2.24 ms, 4.07 of 6.73 ms). Not built: M-88's two leftovers, capped by the profile at about 2% (occupancy masks carried across the replay) and 4% (setup road sites from the reach table); the proposer's win-distance inputs computed twice in a trade response; `denial::contest_term`, 4.6% of a four-seat game from `best_road`, which was not the same kind of repeat.

**Scope.** Code cost only: no placement, policy or rule changed, so no win rate and no earlier measurement moves. The wall ratios are one field, `app_formula_draft` on the default weights with the denial policy and trading on. A weight vector that fails the bound's gate keeps M-88's cost in the lookahead.


## M-90: cheaper setup roads, carried occupancy and indexed row bounds

2026-10-12, baseline is this worktree before the edits, candidate is the local result. No seed domain: `bench` uses `PERF_SEED`. **Admissible: yes for the unchanged hashes and bit comparisons. Wall times are five-repeat medians from sequential local runs, not paired measurements or instruction counts.**

Whole games fell from 2.231 to 2.083 ms at four seats (6.64%) and from 6.551 to 5.944 ms at six (9.27%). **The 10% and 15% whole-game targets were missed.** Full drafts fell from 0.950 to 0.869 ms (8.53%) and from 4.131 to 3.496 ms (15.37%). Every acceptance command passed.

```text
# From simulator/, before any edit and after the final source change:
cargo build --release -p unsettled-sim
uptime
target/release/unsettled-sim bench --filter e2e/ --repeats 5
uptime
target/release/unsettled-sim bench --filter placement/ --repeats 5
uptime
target/release/unsettled-sim bench --filter analyze/ --repeats 5

# Each mechanism was also measured separately after adding it:
uptime
target/release/unsettled-sim bench --filter e2e/ --repeats 5
uptime
target/release/unsettled-sim bench --filter full_draft --repeats 5
```

**What changed, without moving an output bit.**

- `ReachTable` retains each first edge's span. `row_road` reads that span when `table_path` permits it and keeps the mask walk otherwise. Edge ordering and both tie comparisons are unchanged. A borrowed `PRICE_MEMO` uses the reference road calculation through `try_borrow_mut`.
- Each lookahead snapshots occupancy by seat, copies it at the start of a candidate replay and updates it for every settlement and road. Each consumed mask is compared with a rebuild in debug and test builds. Owner arrays remain the source for the initial snapshot.
- Opponent rows reuse their base scores and expansion bounds through the existing seat/held-vertex/grant index. The cache validates scorer identity, own vertices, own edges, seat and grant by content. Rival pieces still determine legality and exact expansion. More than one held vertex and the hero's one-use rows keep the previous calculation. Every cached operand is compared by bits with a fresh calculation in debug and test builds.

Incremental measurements, four-seat / six-seat medians in milliseconds. The final acceptance run below is a separate pass; these stage differences are not added together.

| Mechanism | Full draft before | Full draft after | Draft time saved | Whole game before | Whole game after |
| --- | ---: | ---: | ---: | ---: | ---: |
| Road sites from the reach table | 0.950281 / 4.130677 | 0.909223 / 3.997688 | 4.3% / 3.2% | 2.231167 / 6.551415 | 2.168825 / 6.318925 |
| Occupancy carried across replay | 0.909223 / 3.997688 | 0.886050 / 3.653792 | 2.5% / 8.6% | 2.168825 / 6.318925 | 2.119204 / 6.044898 |
| Indexed base and bound rows | 0.886050 / 3.653792 | 0.854508 / 3.491016 | 3.6% / 4.5% | 2.119204 / 6.044898 | 2.096402 / 5.968204 |

Stage load averages (1 / 5 / 15 minutes): road e2e `3.84 / 4.21 / 4.34`, road draft `3.94 / 4.22 / 4.34`; occupancy e2e and draft `2.72 / 3.41 / 3.96`; indexed rows e2e and draft `2.90 / 3.14 / 3.53`.

**What the counters justified.** Temporary counters were added after the two required mechanisms, before choosing the third, then removed. Each observation ran one whole game with `bench --filter e2e/<layout>/single_core --games 1 --repeats 1`. Counts exclude reference assertions because the instrumented CLI was a release build. The sets used to count duplicates never supplied a score or a pick.

| Per-game count | Four seats | Six seats |
| --- | ---: | ---: |
| Pruned argmax rows | 808 | 2,670 |
| Duplicate whole-row inputs within a pick | 10 | 43 |
| Distinct base/bound keys within picks, including one-use hero rows | 221 | 519 |
| Legal candidates scanned | 31,925 | 159,460 |
| Bound skips | 27,122 | 141,335 |
| `row_value` calls | 5,133 | 18,868 |
| Calls with value memo enabled | 3,869 | 15,703 |
| Value memo hits | 2,577 | 12,577 |
| Calls without a value memo (hero rows) | 1,264 | 3,165 |
| Table-path expansion calls | 2,356 | 8,092 |
| Base price lookups / hits | 25,701 / 24,496 | 138,163 / 132,699 |
| Bound lookups / hits | 25,371 / 25,008 | 137,420 / 134,968 |
| Site price lookups / hits, including roads | 20,113 / 17,397 | 55,452 / 46,692 |
| `SitePricer::new` calls | 8,784 | 30,550 |
| `diversity_coverage` calls | 16,926 | 59,467 |

Only 1.2% and 1.6% of whole rows repeated, so no whole-row result cache was added. Base and bound scalar lookups already hit 95% to 99% of the time; the third mechanism removes those repeated lookups by indexing the rows. A linear search over row keys measured 0.865 / 3.541 ms per draft; indexing measured 0.855 / 3.491 ms. `SitePricer`, coverage arithmetic and bound arithmetic are unchanged.

**Identity and deliberate faults.** New tests use convertible boards from the analysis corpus with generated occupancy, including own-road fallbacks and direct owner-array edits. Existing scrambled-board tests cover additional weights, NaNs and road ties. No existing test was edited.

| New test | Comparison | Deliberate fault and observed failure |
| --- | --- | --- |
| `road_table_matches_each_first_edge_and_reference_road` | Per-edge site masks against the walk and the chosen edge against `expansion_road` | Returning empty table masks failed with `[0, 0, 0]` versus `[0, 16, 128]` |
| `road_uses_reference_when_price_memo_is_borrowed` | Every candidate's road while the price memo is held | Returning `None` instead of the reference fallback failed against `Some(6)` |
| `carried_replay_matches_rebuilt_rows_on_corpus_boards` | Full replay owner arrays, roads, denial score bits, per-seat masks and second-pick score bits | Omitting adjacent vertices from the blocked mask failed the carried/rebuilt comparison at seat 2 |
| `prepared_rows_follow_owner_content_scorer_seat_and_grant` | Cached and repeated rows against a full unmemoized argmax, across scorers and direct state edits | Omitting scorer identity from invalidation failed with score bits `4619770462287049449` versus `4620042704884523995` |

Each fault test failed under `cargo test --release -p unsettled-engine --lib <test-filter> -- --nocapture`. All faults were restored before the full acceptance runs.

**Acceptance.**

```text
cd simulator && cargo test
PASS: 777 passed, 0 failed, 15 intentionally ignored
cd simulator && cargo test --release
PASS: 749 passed, 0 failed, 15 intentionally ignored

git diff --stat -- simulator/fixtures simulator/placement simulator/topology
PASS: empty output

simulator/tools/build-wasm.sh
PASS: release wasm built; binary and source hash written by the script
simulator/tools/build-wasm.sh --check
PASS: exit 0

npx vitest run src/engine/advice
PASS: 5 files, 201 tests
npx vitest run src/engine/__tests__/analysisPerf.test.ts
PASS: 1 file, 2 tests

cd simulator && cargo build --release -p unsettled-sim
PASS: release build
```

Both Rust suites passed `hashes_match_the_committed_fixture`, both parity corpora and all seven allocation tests. The original test modules and `app_formula.rs` were also compared with the pre-edit copies and are unchanged.

**Before and after tables.** Times below are the bench command's nanoseconds per call; each row has five repeats. All runs use seed `9e4f5eed20261010`, the denial policy and `placement/default-weights.json`.

Before `e2e/`, load averages `3.81 / 5.01 / 4.63`:

```text
scenario                                           calls repeats   min ns/call median ns/call    games/sec
e2e/standard4/single_core                             20       5     2195529.1     2231166.6       448.20
e2e/standard4/all_cores                               20       5      245100.0      275848.0      3625.19
e2e/extension6/single_core                            20       5     6532881.2     6551414.6       152.64
e2e/extension6/all_cores                              20       5      672410.4      680568.8      1469.36
```

After `e2e/`, load averages `4.07 / 5.26 / 4.69`:

```text
scenario                                           calls repeats   min ns/call median ns/call    games/sec
e2e/standard4/single_core                             20       5     2080275.0     2083058.3       480.06
e2e/standard4/all_cores                               20       5      219718.8      232310.5      4304.58
e2e/extension6/single_core                            20       5     5938439.6     5943925.0       168.24
e2e/extension6/all_cores                              20       5      612358.3      628668.8      1590.66
```

Before `placement/`, load averages `3.66 / 4.91 / 4.60`:

```text
scenario                                           calls repeats   min ns/call median ns/call    games/sec
placement/standard4/prepare                         4096       5        5577.3        5654.7
placement/standard4/score_all                       1024       5       29103.8       29364.1
placement/standard4/greedy/first                    1024       5       29457.8       29578.9
placement/standard4/greedy/middle                   1024       5       22043.3       22355.9
placement/standard4/greedy/turn                     2048       5       17835.7       18069.7
placement/standard4/greedy/last                     2048       5       11174.1       11203.1
placement/standard4/draft/first                       64       5      327469.4      328753.2
placement/standard4/draft/middle                     128       5      183491.5      185088.2
placement/standard4/full_draft                        32       5      933322.9      950281.2
placement/extension6/prepare                        2048       5        7763.7        7791.7
placement/extension6/score_all                       512       5       44710.4       45058.5
placement/extension6/greedy/first                    512       5       44775.6       44884.1
placement/extension6/greedy/middle                  1024       5       33537.9       33832.1
placement/extension6/greedy/turn                    1024       5       28918.7       29257.6
placement/extension6/greedy/last                    2048       5       17179.5       17337.3
placement/extension6/draft/first                      32       5     1019423.2     1037049.5
placement/extension6/draft/middle                     64       5      499613.3      504853.5
placement/extension6/full_draft                        8       5     4094473.9     4130677.1
```

After `placement/`, load averages `3.81 / 5.09 / 4.65`:

```text
scenario                                           calls repeats   min ns/call median ns/call    games/sec
placement/standard4/prepare                         4096       5        5577.0        5604.8
placement/standard4/score_all                       1024       5       29531.0       29554.1
placement/standard4/greedy/first                    1024       5       29511.3       29818.9
placement/standard4/greedy/middle                   1024       5       22116.7       22425.3
placement/standard4/greedy/turn                     2048       5       17773.8       17802.9
placement/standard4/greedy/last                     2048       5       11098.5       11125.8
placement/standard4/draft/first                      128       5      292003.9      292953.4
placement/standard4/draft/middle                     128       5      170820.6      171112.0
placement/standard4/full_draft                        32       5      865808.6      869207.0
placement/extension6/prepare                        2048       5        7591.0        7673.0
placement/extension6/score_all                       512       5       44943.0       45286.7
placement/extension6/greedy/first                    512       5       44957.8       45161.5
placement/extension6/greedy/middle                  1024       5       33681.2       34086.7
placement/extension6/greedy/turn                    1024       5       29117.3       29408.6
placement/extension6/greedy/last                    2048       5       17450.1       17478.0
placement/extension6/draft/first                      32       5      833494.8      839296.9
placement/extension6/draft/middle                     64       5      452496.1      452634.1
placement/extension6/full_draft                        8       5     3477062.5     3495916.6
```

Before `analyze/`, load averages `3.15 / 4.69 / 4.53`:

```text
scenario                                           calls repeats   min ns/call median ns/call    games/sec
analyze/standard4/opening                              2       5    13601979.5    13620229.5
analyze/extension6/opening                             2       5    15791146.0    15917291.5
analyze/extension6/behind_three                        1       5    55358125.0    55876708.0
```

After `analyze/`, load averages `2.95 / 4.67 / 4.52`:

```text
scenario                                           calls repeats   min ns/call median ns/call    games/sec
analyze/standard4/opening                              2       5    13575000.0    13721895.5
analyze/extension6/opening                             2       5    15903479.0    16090604.0
analyze/extension6/behind_three                        1       5    55331042.0    55619458.0
```

**What is left.** A final full draft costs 0.869 ms at four seats and 3.496 ms at six, against whole games of 2.083 and 5.944 ms. The counters still identify thousands of exact expansion evaluations and one-use hero rows, whose bounds and site pricers cannot use the opponent row cache. A fresh sampled profile was attempted on the candidate with `sample <pid> 3 1`; the sandbox denied attachment, so no new self-time percentages are claimed. The profiling run is excluded from the timing tables. The whole-game targets remain unmet.

**Scope.** Only `draft.rs`, `expansion.rs`, their new adjacent tests, the rebuilt wasm and its hash, and this entry changed. No placement, policy, analysis result, seed domain, fixture, weight or topology changed. No mechanism was approximated to reach a timing target.

## M-91: reach tables and indexed rows recover the setup road cost

2026-10-12, baseline is `engine-speed` before this round, candidate is the local result. No seed domain: `bench` uses `PERF_SEED`. **Admissible: yes for byte-identical fixtures, the raw wasm response sweep and reference assertions. Timings are sequential local five-repeat medians, not instruction counts.**

The final analysis medians are **15.859, 16.684 and 59.538 ms**, below the requested **16.0, 18.3 and 63.8 ms** limits. They improve this round's baseline of 19.952, 21.062 and 74.874 ms by 20.5%, 20.8% and 20.5%.

The retained records from the roads port give pre-road medians of 13.919, 15.886 and 55.475 ms, followed by 18.951, 20.581 and 74.862 ms after that port, costs of 36.2%, 29.6% and 34.9%. This round's final times are 13.9%, 5.0% and 7.3% above those pre-road numbers. Those historical timings and this round's fresh baseline are separate runs.

**What changed, without moving an output bit.**

- The shared geometry holds lazy tables for a candidate and one owned edge. Paths contain up to four edges and record zero, one or two paid builds. Rival edges, rival intermediate vertices and blocked sites filter the paths through masks. Tables are shared by adjacency content across layout switches and never evict. Positions that need the own-road path and have multiple owned edges retain the walk and its memo.
- The one-road upper bound uses those reachable sites, excludes the picker's fixed settlement closure and permits obstacles to raise a site's paid cost. Each cost band uses the largest applicable later decay. A cached bound includes the owned edge. A skipped row is checked against its reference score in debug and test builds.
- Analysis base rows are indexed by held vertices, seat and grant. Open-table bounds are indexed by held vertices. Each context has one immutable scorer. Every cached scalar is compared by bits with a fresh calculation in debug and test builds; each unskipped row and each bounded ranking retain their reference comparisons.
- A cached bound can reject a candidate before its geometry table is read. Candidate entries for one owned edge occupy adjacent memory. The shared pricing helper is inlined so the simulator's existing row path does not gain a function call. The simulator does not use the new analysis row caches or owned-edge tables.

**What the counters justified.** Temporary counters observe one `analyze/extension6/opening` call in a release CLI, excluding reference assertions. The first call is shown on both sides. Counters and deliberate faults are removed from the final sources.

| Per-call count | Before | After |
| --- | ---: | ---: |
| Rows considered | 358,669 | 358,669 |
| Rows skipped | 107,591 | 123,411 |
| Rows priced | 251,078 | 235,258 |
| Row value memo hits | 218,854 | 208,837 |
| Own-road reach requests | 27,058 | 11,238 |
| Own-road reach cache hits | 15,797 | 6,243 |
| Own-road walks run | 11,261 | 0 |
| All bound requests | 157,652 | 157,652 |
| All bound cache hits | 134,247 | 150,512 |
| Base score requests | 358,669 | 358,669 |
| Base scores computed | 46,379 | 10,260 |

The before reach cache is the 32-way walk memo; the after reach cache stores obstacle-filtered table masks. Before, 2,528 walks repeated after eviction. After, no own-road row walk runs. The table alone leaves the skip count at 107,591; the one-road bound raises it to 122,726, and excluding the picker's blocked sites raises it to 123,411. The pre-road record has 123,237 skips.

After the reach and bound changes, counters identify 32,470 repeated base calculations. Indexing removes them. The remaining open-table bound lookups include 6,499 repeated calculations; their indexed rows remove those too. The final 121,423 open-bound requests compute 3,908 values and hit 117,515 cached values. Geometry reads fall from one per own-road candidate (38,672) to 12,478. The first call builds 1,036 geometry entries; subsequent calls build none.

The final own-road table has 11,238 mask requests, 6,243 hits and 4,995 scans. Of those scans, 1,276 repeat after mask-cache eviction. Geometry construction and walks do not repeat. The existing bounded mask and value memos remain bounded; no cache sizes are increased.

**Identity and deliberate faults.** The six new tests fail under these faults, then pass after restoration. No existing test body or expectation changes.

| New test | Deliberate fault |
| --- | --- |
| `single_road_masks_match_walks_with_obstacles` | Charge the owned edge as an unowned edge. |
| `single_road_cache_uses_topology_and_falls_back_for_multiple_roads` | Accept multiple owned edges into the one-edge table. |
| `single_road_bounds_cover_obstacles_and_all_cost_bands` | Drop every reachable site from the upper bound. |
| `single_road_bound_keys_separate_edges_and_other_prices` | Omit the owned edge from the bound memo key. |
| `base_rows_keep_holdings_seat_and_grant_across_road_changes` | Omit seat and grant from the base row key. |
| `open_bound_rows_keep_holdings_when_the_board_changes` | Omit held vertices from the open bound row key. |

Validation: `cargo test`: 803 passed, 15 ignored. `cargo test --release`: 775 passed, 15 ignored. The allocation tests pass in both profiles. The wasm build and source-hash check succeed. The sweep prints `384 states, 0 moved`. Typecheck and lint pass. `npx vitest run src/engine`: 267 passed, with the golden sweep skipped only in that environment-free run and passed separately. The protected-path git diff is empty; fixture, golden and sweep-test SHA-256 digests match the initial snapshot.

The required commands, run sequentially:

```text
cd simulator
cargo test
cargo test --release
cargo build --release -p unsettled-sim
uptime
target/release/unsettled-sim bench --filter analyze/ --repeats 5
uptime
target/release/unsettled-sim bench --filter e2e/ --repeats 5
uptime
target/release/unsettled-sim bench --filter placement/ --repeats 5
cd ..
simulator/tools/build-wasm.sh
simulator/tools/build-wasm.sh --check
SWEEP_GOLDEN=/private/tmp/claude-501/-Users-aki-code-unsettled/0c0ebb95-697a-42b0-b2e0-39f41f0d5101/scratchpad/sweep-golden.txt npx vitest run src/engine/__tests__/sweepGolden.test.ts
npm run typecheck
npm run lint
npx vitest run src/engine
git diff --stat -- simulator/fixtures simulator/placement simulator/topology
```

Vitest's console interception suppresses the sweep's log in this environment. A second run with `--disableConsoleIntercept` prints `384 states, 0 moved`; the test and golden file are unchanged.

**Before and after tables.** All repeats are five. The load averages are the 1, 5 and 15 minute values immediately before each group.

analyze: before

```text
22:27  55 users, load averages: 6.97 7.32 6.81
seed: 9e4f5eed20261010  policy: heuristic-v1-trader-aware-threat-devcards-denial  weights: placement/default-weights.json
scenario                                           calls repeats   min ns/call median ns/call    games/sec
analyze/standard4/opening                              1       5    19455750.0    19952416.0             
analyze/extension6/opening                             1       5    20554833.0    21062125.0             
analyze/extension6/behind_three                        1       5    74519917.0    74873917.0
```

analyze: after

```text
23:27  55 users, load averages: 8.62 11.34 10.87
seed: 9e4f5eed20261010  policy: heuristic-v1-trader-aware-threat-devcards-denial  weights: placement/default-weights.json
scenario                                           calls repeats   min ns/call median ns/call    games/sec
analyze/standard4/opening                              2       5    15703917.0    15858833.0             
analyze/extension6/opening                             2       5    16497000.0    16684020.5             
analyze/extension6/behind_three                        1       5    57708875.0    59537542.0
```

e2e: before

```text
22:27  55 users, load averages: 6.73 7.26 6.79
seed: 9e4f5eed20261010  policy: heuristic-v1-trader-aware-threat-devcards-denial  weights: placement/default-weights.json
scenario                                           calls repeats   min ns/call median ns/call    games/sec
e2e/standard4/single_core                             20       5     2095666.7     2126127.1       470.34
e2e/standard4/all_cores                               20       5      271983.3      294729.2      3392.95
e2e/extension6/single_core                            20       5     5839568.8     5856131.2       170.76
e2e/extension6/all_cores                              20       5      626425.0      632356.2      1581.39
```

e2e: after

```text
23:27  55 users, load averages: 8.62 11.34 10.87
seed: 9e4f5eed20261010  policy: heuristic-v1-trader-aware-threat-devcards-denial  weights: placement/default-weights.json
scenario                                           calls repeats   min ns/call median ns/call    games/sec
e2e/standard4/single_core                             20       5     2104414.5     2136729.1       468.01
e2e/standard4/all_cores                               20       5      227652.0      251354.2      3978.45
e2e/extension6/single_core                            20       5     5998770.8     6065604.2       164.86
e2e/extension6/all_cores                              20       5      673672.9      703889.6      1420.68
```

placement: before

```text
22:27  55 users, load averages: 6.73 7.26 6.79
seed: 9e4f5eed20261010  policy: heuristic-v1-trader-aware-threat-devcards-denial  weights: placement/default-weights.json
scenario                                           calls repeats   min ns/call median ns/call    games/sec
placement/standard4/prepare                         4096       5        5923.3        6193.3             
placement/standard4/score_all                       1024       5       29354.9       29558.2             
placement/standard4/greedy/first                    1024       5       29725.7       30006.6             
placement/standard4/greedy/middle                   1024       5       22241.2       22399.9             
placement/standard4/greedy/turn                     2048       5       17979.7       18073.2             
placement/standard4/greedy/last                     2048       5       11273.5       11318.8             
placement/standard4/draft/first                      128       5      275463.2      275916.0             
placement/standard4/draft/middle                     256       5      152632.0      153413.4             
placement/standard4/full_draft                        32       5      847580.7      855143.2             
placement/extension6/prepare                        2048       5        7796.0        7872.3             
placement/extension6/score_all                       512       5       45028.2       45425.2             
placement/extension6/greedy/first                    512       5       44907.0       45280.9             
placement/extension6/greedy/middle                  1024       5       34177.0       34495.6             
placement/extension6/greedy/turn                    1024       5       29480.6       29665.1             
placement/extension6/greedy/last                    2048       5       17349.8       19344.8             
placement/extension6/draft/first                      32       5      778175.8      784649.7             
placement/extension6/draft/middle                     64       5      426791.0      434326.2             
placement/extension6/full_draft                        8       5     3467239.5     3540229.1
```

placement: after

```text
23:27  55 users, load averages: 8.62 11.34 10.87
seed: 9e4f5eed20261010  policy: heuristic-v1-trader-aware-threat-devcards-denial  weights: placement/default-weights.json
scenario                                           calls repeats   min ns/call median ns/call    games/sec
placement/standard4/prepare                         4096       5        5635.7        5705.2             
placement/standard4/score_all                       1024       5       29448.2       29738.1             
placement/standard4/greedy/first                    1024       5       29630.1       30106.7             
placement/standard4/greedy/middle                   1024       5       22306.6       22541.9             
placement/standard4/greedy/turn                     2048       5       17977.9       18020.5             
placement/standard4/greedy/last                     2048       5       11399.2       11552.2             
placement/standard4/draft/first                      128       5      280063.2      284781.6             
placement/standard4/draft/middle                     256       5      153103.8      153668.5             
placement/standard4/full_draft                        32       5      855901.0      884290.4             
placement/extension6/prepare                        2048       5        7813.6        7854.3             
placement/extension6/score_all                       512       5       45606.0       45697.1             
placement/extension6/greedy/first                    512       5       46155.3       46422.0             
placement/extension6/greedy/middle                  1024       5       34343.0       34660.6             
placement/extension6/greedy/turn                    1024       5       29610.4       29867.8             
placement/extension6/greedy/last                    2048       5       17532.4       17561.3             
placement/extension6/draft/first                      32       5      771878.9      783615.9             
placement/extension6/draft/middle                     64       5      425472.7      435036.5             
placement/extension6/full_draft                        8       5     3550755.2     3596020.9
```

**Noise checks.** The initial twenty-game tables and the larger comparisons vary with machine load. Two final 200-game comparisons run in opposite binary orders. All state and decision hashes match. Their final/baseline changes are:

| e2e row | Before then final | Final then before |
| --- | ---: | ---: |
| `e2e/standard4/single_core` | -0.44% | +0.75% |
| `e2e/standard4/all_cores` | -11.74% | +0.61% |
| `e2e/extension6/single_core` | -1.92% | -0.95% |
| `e2e/extension6/all_cores` | +2.90% | -7.61% |

Loads for those four runs: `6.44 7.78 8.93`, `6.22 7.69 8.88`, `8.30 8.10 9.02`, `8.33 8.12 9.01`.

The two final placement comparisons also reverse binary order. Full-draft changes are -4.60% / +1.66% at four seats and -9.29% / -0.29% at six. Individual greedy rows move in both directions, with no consistent slowdown beyond the observed noise. Their before/final loads are `13.71 10.97 10.23` / `13.17 10.90 10.21`, then final/before `13.24 11.05 10.28` / `12.66 10.97 10.25`. The earlier three paired comparisons of the same native paths agree with that conclusion. These checks justify treating the isolated e2e all-core increases as timing noise, not a simulator change.

**What is left.** The four-seat analysis row has 0.141 ms of headroom under its cap, and loaded runs cross that cap. The six-seat rows have more room. The remaining work includes exact mask filtering and site pricing, plus the roads each rollout must choose and lay. The general walk remains available for multiple owned edges. No scoring approximation or output change is used to meet a timing target.

**Scope.** Only `expansion.rs`, `app_formula.rs`, `analysis/window.rs`, their new adjacent tests, the rebuilt wasm and its source hash, and this entry change. Fixture, weight and topology bytes stay unchanged. The sweep test and golden file stay unchanged.

## M-93: the contest term at weight 0 costs under 1% of the placement rows' instructions

**Question.** Cut-off programme item 1 adds a contest discount to the placement scorer behind `contestWeight`, shipped at 0. Requirement 11 of [`cut-off-programme.md`](cut-off-programme.md) asks that no bench scenario executes more than 1.01 times the instructions of the commit before it, with no output moved.

**Runs** (2026-10-13). `box run simulator/box/bench --ref base=a4067536 --ref cand=<candidate> --node none`, twice, the candidate being the uncommitted item 1 tree as a commit object. Run `20261013T073636Z-9e972fbb` measured the first shape (candidate `63cd7d22`): the discount written inside `term`, the pricing loops and `row_road`, each behind a test of the weight. Run `20261013T081413Z-257de8e0` measured the final shape (candidate `90ecb26f`): a `contested` flag on the scorer, each hot function compiled in a plain and a contested instance from one source (`const CONTESTED: bool`), the contested calls out of line, and the tier cache in its own thread-local.

| Scenario | Base Ir | First attempt Ir | Ratio | Final Ir | Ratio | Final wall ratio |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `placement/standard4/prepare` | 150,285 | 149,170 | 0.998 | 148,709 | 0.990 | 1.039 |
| `placement/standard4/score_all` | 1,055,960 | 1,075,288 | 1.018 | 1,060,780 | 1.005 | 0.995 |
| `placement/standard4/greedy/first` | 1,066,623 | 1,086,290 | 1.018 | 1,071,690 | 1.005 | 1.012 |
| `placement/standard4/greedy/middle` | 783,355 | 796,725 | 1.017 | 787,060 | 1.005 | 1.026 |
| `placement/standard4/greedy/turn` | 610,821 | 620,199 | 1.015 | 613,708 | 1.005 | 1.030 |
| `placement/standard4/greedy/last` | 371,290 | 376,203 | 1.013 | 372,999 | 1.005 | 1.023 |
| `placement/standard4/draft/first` | 12,568,626 | 12,856,383 | 1.023 | 12,624,908 | 1.004 | 0.985 |
| `placement/standard4/draft/middle` | 7,613,478 | 7,728,866 | 1.015 | 7,628,410 | 1.002 | 0.999 |
| `placement/standard4/full_draft` | 33,939,801 | 34,609,267 | 1.020 | 34,086,170 | 1.004 | 1.006 |
| `analyze/standard4/opening` | 361,254,415 | 368,783,035 | 1.021 | 363,279,142 | 1.006 | 1.009 |
| `placement/extension6/prepare` | 204,293 | 204,297 | 1.000 | 203,974 | 0.998 | 0.965 |
| `placement/extension6/score_all` | 1,614,372 | 1,645,386 | 1.019 | 1,622,769 | 1.005 | 0.999 |
| `placement/extension6/greedy/first` | 1,624,752 | 1,655,774 | 1.019 | 1,632,641 | 1.005 | 1.011 |
| `placement/extension6/greedy/middle` | 1,198,142 | 1,219,350 | 1.018 | 1,203,932 | 1.005 | 1.027 |
| `placement/extension6/greedy/turn` | 1,018,598 | 1,035,285 | 1.016 | 1,023,430 | 1.005 | 1.023 |
| `placement/extension6/greedy/last` | 577,873 | 585,778 | 1.014 | 580,555 | 1.005 | 1.022 |
| `placement/extension6/draft/first` | 29,483,347 | 30,083,034 | 1.020 | 29,602,787 | 1.004 | 0.984 |
| `placement/extension6/draft/middle` | 18,126,179 | 18,417,901 | 1.016 | 18,193,061 | 1.004 | 0.990 |
| `placement/extension6/full_draft` | 113,953,059 | 115,895,660 | 1.017 | 114,465,029 | 1.004 | 0.983 |
| `analyze/extension6/opening` | 372,665,082 | 381,375,702 | 1.024 | 374,710,200 | 1.005 | 1.002 |
| `analyze/extension6/behind_three` | 1,310,309,669 | 1,342,555,322 | 1.025 | 1,317,061,389 | 1.005 | 1.009 |

Every `decision/*` and `advise/*` row, which never reaches the expansion term, is between 0.998 and 1.001 in the final run. No row in either run carries `decisions differ` or `STATES DIFFER`.

**Reading.** The first shape failed the bar on every placement and analysis row (1.013 to 1.025) although its source added one float comparison per site: the reference scorer gained about 350 instructions per candidate, so the cost was in how the larger functions compiled, not in the comparisons. The final shape passes on every row, highest 1.006. Wall ratios on the box are within its 5% noise and decide nothing. `engine.wasm` grows from 1,102,957 to 1,128,534 bytes, because each hot function now exists twice.

**Decision.** Item 1 meets requirement 11's speed proof. The final shape is the one kept.

## M-94: the first-pick re-pricing switch at 0 costs nothing measurable

**Question.** Cut-off programme item 2 gives `repriceFirstExpansion` its two readers, `rank_candidates` and `Lookahead::value_with_marginal`, shipped at 0. Requirement 19 of [`cut-off-programme.md`](cut-off-programme.md) asks that no bench scenario executes more than 1.01 times the instructions of the commit before item 2, with no output moved.

**Run** (2026-10-13). `box run simulator/box/bench --ref base=90ecb26f --ref cand=cdf17c6e --node none`, run `20261013T090736Z-473464b0`. The base is item 1's final shape (M-93) and the candidate adds item 2, both uncommitted trees as commit objects.

| Scenario | Base Ir | Candidate Ir | Ratio | Wall ratio |
| --- | ---: | ---: | ---: | ---: |
| `placement/standard4/prepare` | 148,709 | 148,709 | 1.000 | 0.999 |
| `placement/standard4/score_all` | 1,060,823 | 1,060,911 | 1.000 | 0.985 |
| `placement/standard4/greedy/first` | 1,071,690 | 1,071,689 | 1.000 | 0.988 |
| `placement/standard4/greedy/middle` | 787,060 | 787,059 | 1.000 | 0.985 |
| `placement/standard4/greedy/turn` | 613,708 | 613,707 | 1.000 | 0.984 |
| `placement/standard4/greedy/last` | 372,999 | 372,998 | 1.000 | 0.978 |
| `placement/standard4/draft/first` | 12,624,999 | 12,625,677 | 1.000 | 1.018 |
| `placement/standard4/draft/middle` | 7,628,387 | 7,629,032 | 1.000 | 1.024 |
| `placement/standard4/full_draft` | 34,091,672 | 34,095,910 | 1.000 | 1.025 |
| `analyze/standard4/opening` | 363,785,438 | 363,473,593 | 0.999 | 1.009 |
| `placement/extension6/prepare` | 203,974 | 203,974 | 1.000 | 0.997 |
| `placement/extension6/score_all` | 1,622,769 | 1,622,257 | 1.000 | 0.982 |
| `placement/extension6/greedy/first` | 1,632,641 | 1,632,640 | 1.000 | 0.968 |
| `placement/extension6/greedy/middle` | 1,203,932 | 1,203,931 | 1.000 | 0.966 |
| `placement/extension6/greedy/turn` | 1,023,430 | 1,023,429 | 1.000 | 0.969 |
| `placement/extension6/greedy/last` | 580,555 | 580,554 | 1.000 | 0.962 |
| `placement/extension6/draft/first` | 29,602,799 | 29,603,920 | 1.000 | 1.018 |
| `placement/extension6/draft/middle` | 18,193,073 | 18,194,026 | 1.000 | 1.010 |
| `placement/extension6/full_draft` | 114,483,791 | 114,492,701 | 1.000 | 1.014 |
| `analyze/extension6/opening` | 374,454,960 | 374,783,797 | 1.001 | 1.002 |
| `analyze/extension6/behind_three` | 1,318,442,047 | 1,318,904,208 | 1.000 | 1.002 |

Every `decision/*` and `advise/*` row is between 1.000 and 1.001. No row carries `decisions differ` or `STATES DIFFER`.

**Reading.** The highest ratio is 1.001. With both keys on, the two new cases in `analysisPerf.test.ts` (six seats, `contestWeight` 0.5, `repriceFirstExpansion` 1) rank in 62 ms and 204 ms on the build machine against the unchanged bounds of 300 ms and 1200 ms; the same boards at 0 take 33 ms and 108 ms.

**Decision.** Item 2 meets requirement 19's speed proof.

## M-95: 4 seats, the cut-off arms' picks reading and blind pilot

**Preregistration.** [`2026-10-13-m95-seats4-picks-pilot.md`](../../../docs/plans/preregs/2026-10-13-m95-seats4-picks-pilot.md), committed as `2281c8f4` before either run. Both ran on that commit's release binary, 2026-10-13, `uptime` load 4.9 and 4.6 on 18 cores.

**Picks reading** (`evaluate --picks-only`, `standard4`, 4 seats, `tuning4` at seed `8972835441189626876`, 400 boards, 1,600 drafts, no game played).

| Arm | Leaf | Drafts changed | Share |
| --- | --- | ---: | ---: |
| `flat_25` | `contestWeight` 0.25 | 466 | 0.291 |
| `flat_50` | `contestWeight` 0.5 | 733 | 0.458 |
| `flat_75` | `contestWeight` 0.75 | 856 | 0.535 |
| `reprice_only` | `repriceFirstExpansion` 1 | 102 | 0.064 |

Every share is at or above 0.02, so all four arms are piloted and screened at 4 seats. The prediction put the flat arms between 5% and 30%; two of the three are above that.

**Blind pilot** (the same command without the flag, 400 boards x 2 reps, 3,200 games an arm). Read from it, and nothing else: `elapsedSeconds` 2.82; `illegalActions` 0; `base` 774 wins of 3,200 with 0 draws.

| Arm | Half-width | Discordant share |
| --- | ---: | ---: |
| `flat_25` | 0.00879 | 0.064 |
| `flat_50` | 0.01131 | 0.107 |
| `flat_75` | 0.01255 | 0.125 |
| `reprice_only` | 0.00554 | 0.024 |

**Stop conditions.** Neither fired. The symmetric corner is 0.25 and `base` won 0.2419, a miss of 0.0081 against an allowance of 0.0252.

**Sizing.** The widest arm is `flat_75`. A half-width of 0.0035 needs 5,145 boards, so `B` is 5,500, where the predicted half-width is 0.00339 and the predicted wall time is 39 seconds, far under the 30 minute cap. Neither the cap nor the floor set it. Every later run at 4 seats uses it: the screen at 5,500 boards, a retry, the confirm and the gate at 22,000.

**Ledger.** `tuning4` is spent at 4 seats.

## M-96: 2 seats, the cut-off arms' picks reading and blind pilot

**Preregistration.** [`2026-10-13-m96-seats2-picks-pilot.md`](../../../docs/plans/preregs/2026-10-13-m96-seats2-picks-pilot.md), committed in `2927d813` before either run. Both ran on that commit's release binary, 2026-10-13, load averages 5.15 5.97 6.75 on 18 cores.

**Picks reading** (`evaluate --picks-only`, `standard4`, 2 seats, player trading off, `--allow-unofficial`, `tuning4` at seed `13887469506549625143`, 400 boards, 800 drafts, no game played).

| Arm | Leaf | Drafts changed | Share |
| --- | --- | ---: | ---: |
| `flat_25` | `contestWeight` 0.25 | 170 | 0.212 |
| `flat_50` | `contestWeight` 0.5 | 257 | 0.321 |
| `flat_75` | `contestWeight` 0.75 | 280 | 0.350 |
| `reprice_only` | `repriceFirstExpansion` 1 | 34 | 0.043 |

Every share is at or above 0.02, so all four arms are piloted and screened at 2 seats.

**Blind pilot** (the same command without the flag, 400 boards x 2 reps, 1,600 games an arm). Read from it, and nothing else: `elapsedSeconds` 0.55; `illegalActions` 0; `base` 817 wins of 1,600 with 0 draws.

| Arm | Half-width | Discordant share |
| --- | ---: | ---: |
| `flat_25` | 0.01075 | 0.046 |
| `flat_50` | 0.01335 | 0.073 |
| `flat_75` | 0.01391 | 0.081 |
| `reprice_only` | 0.00795 | 0.019 |

**Stop conditions.** Neither fired. The symmetric corner is 0.5000 and `base` won 0.5106, a miss of 0.0106 against an allowance of 0.0411.

**Sizing.** The widest arm is `flat_75`. A half-width of 0.0035 needs 6,322 boards, so `B` is 6,500, where the predicted half-width is 0.00345 and the predicted wall time is 9 seconds, far under the 30 minute cap. Neither the cap nor the floor set it. Every later run at 2 seats uses it: the screen at 6,500 boards, a retry, the confirm and the gate at 26,000.

**Ledger.** `tuning4` is spent at 2 seats.

## M-97: 3 seats, the cut-off arms' picks reading and blind pilot

**Preregistration.** [`2026-10-13-m97-seats3-picks-pilot.md`](../../../docs/plans/preregs/2026-10-13-m97-seats3-picks-pilot.md), committed in `2927d813` before either run. Both ran on that commit's release binary, 2026-10-13, load averages 6.90 6.32 6.86 on 18 cores.

**Picks reading** (`evaluate --picks-only`, `standard4`, 3 seats, player trading on, `tuning4` at seed `6052338987207494362`, 400 boards, 1,200 drafts, no game played).

| Arm | Leaf | Drafts changed | Share |
| --- | --- | ---: | ---: |
| `flat_25` | `contestWeight` 0.25 | 292 | 0.243 |
| `flat_50` | `contestWeight` 0.5 | 499 | 0.416 |
| `flat_75` | `contestWeight` 0.75 | 561 | 0.468 |
| `reprice_only` | `repriceFirstExpansion` 1 | 72 | 0.060 |

Every share is at or above 0.02, so all four arms are piloted and screened at 3 seats.

**Blind pilot** (the same command without the flag, 400 boards x 2 reps, 2,400 games an arm). Read from it, and nothing else: `elapsedSeconds` 1.57; `illegalActions` 0; `base` 776 wins of 2,400 with 0 draws.

| Arm | Half-width | Discordant share |
| --- | ---: | ---: |
| `flat_25` | 0.01117 | 0.063 |
| `flat_50` | 0.01404 | 0.110 |
| `flat_75` | 0.01492 | 0.126 |
| `reprice_only` | 0.00611 | 0.022 |

**Stop conditions.** Neither fired. The symmetric corner is 0.3333 and `base` won 0.3233, a miss of 0.0100 against an allowance of 0.0317.

**Sizing.** The widest arm is `flat_75`. A half-width of 0.0035 needs 7,265 boards, so `B` is 7,500, where the predicted half-width is 0.00344 and the predicted wall time is 29 seconds, far under the 30 minute cap. Neither the cap nor the floor set it. Every later run at 3 seats uses it: the screen at 7,500 boards, a retry, the confirm and the gate at 30,000.

**Ledger.** `tuning4` is spent at 3 seats.

## M-98: 5 seats, the cut-off arms' picks reading and blind pilot

**Preregistration.** [`2026-10-13-m98-seats5-picks-pilot.md`](../../../docs/plans/preregs/2026-10-13-m98-seats5-picks-pilot.md), committed in `2927d813` before either run. Both ran on that commit's release binary, 2026-10-13, load averages 6.90 6.32 6.86 on 18 cores.

**Picks reading** (`evaluate --picks-only`, `extension6`, 5 seats, player trading on, `tuning4` at seed `13485105647361630321`, 100 boards, 500 drafts, no game played).

| Arm | Leaf | Drafts changed | Share |
| --- | --- | ---: | ---: |
| `flat_25` | `contestWeight` 0.25 | 123 | 0.246 |
| `flat_50` | `contestWeight` 0.5 | 227 | 0.454 |
| `flat_75` | `contestWeight` 0.75 | 254 | 0.508 |
| `reprice_only` | `repriceFirstExpansion` 1 | 44 | 0.088 |

Every share is at or above 0.02, so all four arms are piloted and screened at 5 seats.

**Blind pilot** (the same command without the flag, 100 boards x 2 reps, 1,000 games an arm). Read from it, and nothing else: `elapsedSeconds` 2.01; `illegalActions` 0; `base` 209 wins of 1,000 with 0 draws.

| Arm | Half-width | Discordant share |
| --- | ---: | ---: |
| `flat_25` | 0.01255 | 0.041 |
| `flat_50` | 0.01728 | 0.077 |
| `flat_75` | 0.01930 | 0.090 |
| `reprice_only` | 0.00939 | 0.023 |

**Stop conditions.** Neither fired. The symmetric corner is 0.2000 and `base` won 0.2090, a miss of 0.0090 against an allowance of 0.0416.

**Sizing.** The widest arm is `flat_75`. A half-width of 0.0035 needs 3,040 boards, so `B` is 3,500, where the predicted half-width is 0.00326 and the predicted wall time is 70 seconds, far under the 120 minute cap. Neither the cap nor the floor set it. Every later run at 5 seats uses it: the screen at 3,500 boards, a retry, the confirm and the gate at 14,000.

**Ledger.** `tuning4` is spent at 5 seats.

## M-99: 6 seats, the cut-off arms' picks reading and blind pilot

**Preregistration.** [`2026-10-13-m99-seats6-picks-pilot.md`](../../../docs/plans/preregs/2026-10-13-m99-seats6-picks-pilot.md), committed in `2927d813` before either run. Both ran on that commit's release binary, 2026-10-13, load averages 8.83 6.73 7.01 on 18 cores.

**Picks reading** (`evaluate --picks-only`, `extension6`, 6 seats, player trading on, `tuning4` at seed `267929230571891344`, 100 boards, 600 drafts, no game played).

| Arm | Leaf | Drafts changed | Share |
| --- | --- | ---: | ---: |
| `flat_25` | `contestWeight` 0.25 | 181 | 0.302 |
| `flat_50` | `contestWeight` 0.5 | 284 | 0.473 |
| `flat_75` | `contestWeight` 0.75 | 322 | 0.537 |
| `reprice_only` | `repriceFirstExpansion` 1 | 49 | 0.082 |

Every share is at or above 0.02, so all four arms are piloted and screened at 6 seats.

**Blind pilot** (the same command without the flag, 100 boards x 2 reps, 1,200 games an arm). Read from it, and nothing else: `elapsedSeconds` 3.10; `illegalActions` 0; `base` 232 wins of 1,200 with 0 draws.

| Arm | Half-width | Discordant share |
| --- | ---: | ---: |
| `flat_25` | 0.01469 | 0.068 |
| `flat_50` | 0.01756 | 0.097 |
| `flat_75` | 0.01873 | 0.110 |
| `reprice_only` | 0.00783 | 0.019 |

**Stop conditions.** Neither fired. The symmetric corner is 0.1667 and `base` won 0.1933, a miss of 0.0267 against an allowance of 0.0354.

**Sizing.** The widest arm is `flat_75`. A half-width of 0.0035 needs 2,862 boards, so `B` is 3,000, where the predicted half-width is 0.00342 and the predicted wall time is 93 seconds, far under the 120 minute cap. Neither the cap nor the floor set it. Every later run at 6 seats uses it: the screen at 3,000 boards, a retry, the confirm and the gate at 12,000.

**Ledger.** `tuning4` is spent at 6 seats.

## M-100: 4 seats, the cut-off arms' screen on `tuning4`

**Preregistration.** [`2026-10-13-m100-seats4-screen.md`](../../../docs/plans/preregs/2026-10-13-m100-seats4-screen.md), committed in `42ff166d` before the run. Ran on that commit's release binary, 2026-10-13: `standard4`, 4 seats, `tuning4` at seed `8972835441189626876`, 5,500 boards x 2 reps, 44,000 games an arm, 43 seconds. Load averages 4.61 5.91 6.67 before and 22.56 10.44 8.30 after on 18 cores; the screens ran back to back, so the later ones started under the earlier ones' load, which changes wall time and no outcome.

| Arm | Estimate | Interval | Verdict | Discordant wins, losses |
| --- | ---: | --- | --- | ---: |
| `flat_25` | +0.080pp | -0.158pp to +0.317pp | `equivalent` | 1,414, 1,379 |
| `flat_50` | +0.491pp | +0.182pp to +0.800pp | `inconclusive` | 2,439, 2,223 |
| `flat_75` | +0.570pp | +0.238pp to +0.903pp | `inconclusive` | 2,860, 2,609 |
| `reprice_only` | +0.057pp | -0.097pp to +0.211pp | `equivalent` | 559, 534 |

**Stop conditions.** Neither fired: `illegalActions` 0; `base` won 11,111 of 44,000 with 0 draws, 0.2525 against a corner of 0.2500, a miss of 0.0025 against an allowance of 0.0068.

**Decision.** `flat_25` and `reprice_only` are dropped as `equivalent`. `flat_50` and `flat_75` are `inconclusive` with estimates at or above 0.0025, so each buys its one retry at 22,000 boards (M-105). `reprice_only`'s last reading is positive and not `worse`, so a second-stage arm follows if a flat arm's last reading is positive too.

## M-101: 2 seats, the cut-off arms' screen on `tuning4`

**Preregistration.** [`2026-10-13-m101-seats2-screen.md`](../../../docs/plans/preregs/2026-10-13-m101-seats2-screen.md), committed in `42ff166d` before the run. Ran on that commit's release binary, 2026-10-13: `standard4`, 2 seats, `tuning4` at seed `13887469506549625143`, 6,500 boards x 2 reps, 26,000 games an arm, 11 seconds. Load averages 22.56 10.44 8.30 before and 23.19 10.97 8.51 after on 18 cores; the screens ran back to back, so the later ones started under the earlier ones' load, which changes wall time and no outcome.

| Arm | Estimate | Interval | Verdict | Discordant wins, losses |
| --- | ---: | --- | --- | ---: |
| `flat_25` | -0.200pp | -0.465pp to +0.065pp | `equivalent` | 594, 646 |
| `flat_50` | -0.362pp | -0.687pp to -0.036pp | `inconclusive` | 884, 978 |
| `flat_75` | -0.346pp | -0.692pp to -0.001pp | `inconclusive` | 1,006, 1,096 |
| `reprice_only` | -0.058pp | -0.238pp to +0.122pp | `equivalent` | 258, 273 |

**Stop conditions.** Neither fired: `illegalActions` 0; `base` won 13,036 of 26,000 with 0 draws, 0.5014 against a corner of 0.5000, a miss of 0.0014 against an allowance of 0.0102.

**Decision.** `flat_25` and `reprice_only` are dropped as `equivalent`. `flat_50` and `flat_75` are `inconclusive` with negative estimates, under the 0.0025 retry line, so both are dropped unresolved. `reprice_only`'s estimate is negative, so there is no second stage. No arm read `better`: **2 seats closes with both keys at 0**, and `eval4` and `gate5` stay unspent at 2 seats.

## M-102: 3 seats, the cut-off arms' screen on `tuning4`

**Preregistration.** [`2026-10-13-m102-seats3-screen.md`](../../../docs/plans/preregs/2026-10-13-m102-seats3-screen.md), committed in `42ff166d` before the run. Ran on that commit's release binary, 2026-10-13: `standard4`, 3 seats, `tuning4` at seed `6052338987207494362`, 7,500 boards x 2 reps, 45,000 games an arm, 36 seconds. Load averages 23.19 10.97 8.51 before and 34.48 15.13 10.12 after on 18 cores; the screens ran back to back, so the later ones started under the earlier ones' load, which changes wall time and no outcome.

| Arm | Estimate | Interval | Verdict | Discordant wins, losses |
| --- | ---: | --- | --- | ---: |
| `flat_25` | +0.018pp | -0.220pp to +0.255pp | `equivalent` | 1,475, 1,467 |
| `flat_50` | +0.080pp | -0.225pp to +0.385pp | `equivalent` | 2,458, 2,422 |
| `flat_75` | -0.002pp | -0.330pp to +0.325pp | `equivalent` | 2,810, 2,811 |
| `reprice_only` | -0.004pp | -0.156pp to +0.147pp | `equivalent` | 577, 579 |

**Stop conditions.** Neither fired: `illegalActions` 0; `base` won 15,033 of 45,000 with 0 draws, 0.3341 against a corner of 0.3333, a miss of 0.0007 against an allowance of 0.0073.

**Decision.** All four arms are dropped as `equivalent`. `reprice_only`'s estimate is negative, so there is no second stage. No arm read `better`: **3 seats closes with both keys at 0**, and `eval4` and `gate5` stay unspent at 3 seats.

## M-103: 5 seats, the cut-off arms' screen on `tuning4`

**Preregistration.** [`2026-10-13-m103-seats5-screen.md`](../../../docs/plans/preregs/2026-10-13-m103-seats5-screen.md), committed in `42ff166d` before the run. Ran on that commit's release binary, 2026-10-13: `extension6`, 5 seats, `tuning4` at seed `13485105647361630321`, 3,500 boards x 2 reps, 35,000 games an arm, 85 seconds. Load averages 34.48 15.13 10.12 before and 34.09 20.09 12.51 after on 18 cores; the screens ran back to back, so the later ones started under the earlier ones' load, which changes wall time and no outcome.

| Arm | Estimate | Interval | Verdict | Discordant wins, losses |
| --- | ---: | --- | --- | ---: |
| `flat_25` | +0.317pp | +0.074pp to +0.560pp | `inconclusive` | 986, 875 |
| `flat_50` | +0.300pp | -0.011pp to +0.611pp | `inconclusive` | 1,569, 1,464 |
| `flat_75` | +0.406pp | +0.065pp to +0.746pp | `inconclusive` | 1,855, 1,713 |
| `reprice_only` | +0.071pp | -0.110pp to +0.253pp | `equivalent` | 479, 454 |

**Stop conditions.** Neither fired: `illegalActions` 0; `base` won 6,945 of 35,000 with 0 draws, 0.1984 against a corner of 0.2000, a miss of 0.0016 against an allowance of 0.0070.

**Decision.** `reprice_only` is dropped as `equivalent`. All three flat arms are `inconclusive` with estimates at or above 0.0025. On `extension6` at most two retry, the two with the largest screen estimates: `flat_75` (0.004057) and `flat_25` (0.003171) retry at 14,000 boards (M-106), and `flat_50` (0.003000) is dropped unresolved. `reprice_only`'s last reading is positive and not `worse`, so a second-stage arm follows if a flat arm's last reading is positive too.

## M-104: 6 seats, the cut-off arms' screen on `tuning4`

**Preregistration.** [`2026-10-13-m104-seats6-screen.md`](../../../docs/plans/preregs/2026-10-13-m104-seats6-screen.md), committed in `42ff166d` before the run. Ran on that commit's release binary, 2026-10-13: `extension6`, 6 seats, `tuning4` at seed `267929230571891344`, 3,000 boards x 2 reps, 36,000 games an arm, 109 seconds. Load averages 34.09 20.09 12.51 before and 30.15 23.35 14.73 after on 18 cores; the screens ran back to back, so the later ones started under the earlier ones' load, which changes wall time and no outcome.

| Arm | Estimate | Interval | Verdict | Discordant wins, losses |
| --- | ---: | --- | --- | ---: |
| `flat_25` | +0.283pp | +0.046pp to +0.521pp | `inconclusive` | 929, 827 |
| `flat_50` | +0.361pp | +0.063pp to +0.659pp | `inconclusive` | 1,516, 1,386 |
| `flat_75` | +0.358pp | +0.025pp to +0.692pp | `inconclusive` | 1,792, 1,663 |
| `reprice_only` | +0.156pp | -0.013pp to +0.324pp | `equivalent` | 471, 415 |

**Stop conditions.** Neither fired: `illegalActions` 0; `base` won 6,078 of 36,000 with 0 draws, 0.1688 against a corner of 0.1667, a miss of 0.0022 against an allowance of 0.0065.

**Decision.** `reprice_only` is dropped as `equivalent`. All three flat arms are `inconclusive` with estimates at or above 0.0025. On `extension6` at most two retry, the two with the largest screen estimates: `flat_50` (0.003611) and `flat_75` (0.003583) retry at 12,000 boards (M-107), and `flat_25` (0.002833) is dropped unresolved. `reprice_only`'s last reading is positive and not `worse`, so a second-stage arm follows if a flat arm's last reading is positive too.

**Prediction against the five screens (M-100 to M-104).** I predicted every estimate inside plus or minus 0.5pp: 19 of 20 are, and `flat_75` at 4 seats is at +0.570pp. I put some arm reading `better` at about 15% a seat count and none did. I put some flat arm reading `worse` at about 25% and none did, though both heavier flat arms at 2 seats have intervals wholly below zero. I put a retry at about 20% a seat count, and three of five bought one, so I underrated how often the heavier discounts would land between the retry line and the bar. Across seat counts the flat arms' estimates are negative at 2 seats, near zero at 3, and positive at 4, 5 and 6.

## M-105: 4 seats, the cut-off arms' retry on `tuning4`

**Preregistration.** [`2026-10-13-m105-seats4-retry.md`](../../../docs/plans/preregs/2026-10-13-m105-seats4-retry.md), committed in `c9f002d7` before the run. Ran on that commit's release binary, 2026-10-13: `standard4`, 4 seats, `tuning4` at seed `8972835441189626876`, 22,000 boards x 2 reps, 176,000 games an arm, 97 seconds. Load averages 14.35 20.09 14.06 before and 27.25 23.45 16.06 after on 18 cores, from this programme's own back-to-back runs.

| Arm | Estimate | Interval | Verdict | Discordant wins, losses |
| --- | ---: | --- | --- | ---: |
| `flat_50` | +0.451pp | +0.299pp to +0.603pp | `inconclusive` | 9,504, 8,710 |
| `flat_75` | +0.499pp | +0.334pp to +0.664pp | `inconclusive` | 11,171, 10,292 |

**Stop conditions.** Neither fired: `illegalActions` 0; `base` won 44,232 of 176,000 with 0 draws, 0.2513 against a corner of 0.2500, a miss of 0.0013 against an allowance of 0.0034.

**Decision.** Neither arm read `better`, so both are dropped; there is no second retry. Both intervals sit wholly above zero and reach the +0.5pp bar without clearing it. Last readings at 4 seats: `flat_25` +0.080pp, `flat_50` +0.451pp, `flat_75` +0.499pp, `reprice_only` +0.057pp, none `worse`. A flat arm and `reprice_only` are both positive, so requirement 30 creates the second-stage arm `flat_reprice` at 4 seats on `flat_75`, the flat arm with the highest last-reading estimate: `contestWeight` 0.75 with `repriceFirstExpansion` 1 (M-108).

## M-106: 5 seats, the cut-off arms' retry on `tuning4`

**Preregistration.** [`2026-10-13-m106-seats5-retry.md`](../../../docs/plans/preregs/2026-10-13-m106-seats5-retry.md), committed in `c9f002d7` before the run. Ran on that commit's release binary, 2026-10-13: `extension6`, 5 seats, `tuning4` at seed `13485105647361630321`, 14,000 boards x 2 reps, 140,000 games an arm, 182 seconds. Load averages 27.25 23.45 16.06 before and 44.66 33.23 21.53 after on 18 cores, from this programme's own back-to-back runs.

| Arm | Estimate | Interval | Verdict | Discordant wins, losses |
| --- | ---: | --- | --- | ---: |
| `flat_25` | +0.171pp | +0.049pp to +0.293pp | `equivalent` | 3,839, 3,600 |
| `flat_75` | +0.217pp | +0.047pp to +0.388pp | `equivalent` | 7,353, 7,049 |

**Stop conditions.** Neither fired: `illegalActions` 0; `base` won 28,013 of 140,000 with 0 draws, 0.2001 against a corner of 0.2000, a miss of 0.0001 against an allowance of 0.0035.

**Decision.** Both arms read `equivalent` and are dropped. Last readings at 5 seats: `flat_25` +0.171pp (this retry), `flat_50` +0.300pp (its screen, since the two-retry cap dropped it unresolved), `flat_75` +0.217pp (this retry), `reprice_only` +0.071pp, none `worse`. A flat arm and `reprice_only` are both positive, so requirement 30 creates `flat_reprice` at 5 seats on the flat arm with the highest last-reading estimate. Read literally that is `flat_50`, whose last reading is a screen four times smaller than the other two's retries: `contestWeight` 0.5 with `repriceFirstExpansion` 1 (M-109).

## M-107: 6 seats, the cut-off arms' retry on `tuning4`

**Preregistration.** [`2026-10-13-m107-seats6-retry.md`](../../../docs/plans/preregs/2026-10-13-m107-seats6-retry.md), committed in `c9f002d7` before the run. Ran on that commit's release binary, 2026-10-13: `extension6`, 6 seats, `tuning4` at seed `267929230571891344`, 12,000 boards x 2 reps, 144,000 games an arm, 233 seconds. Load averages 44.66 33.23 21.53 before and 38.36 34.07 24.55 after on 18 cores, from this programme's own back-to-back runs.

| Arm | Estimate | Interval | Verdict | Discordant wins, losses |
| --- | ---: | --- | --- | ---: |
| `flat_50` | +0.420pp | +0.272pp to +0.568pp | `inconclusive` | 6,072, 5,467 |
| `flat_75` | +0.471pp | +0.310pp to +0.632pp | `inconclusive` | 7,133, 6,455 |

**Stop conditions.** Neither fired: `illegalActions` 0; `base` won 24,068 of 144,000 with 0 draws, 0.1671 against a corner of 0.1667, a miss of 0.0005 against an allowance of 0.0032.

**Decision.** Neither arm read `better`, so both are dropped; there is no second retry. Both intervals sit wholly above zero and reach the +0.5pp bar without clearing it. Last readings at 6 seats: `flat_25` +0.283pp (its screen), `flat_50` +0.420pp, `flat_75` +0.471pp, `reprice_only` +0.156pp, none `worse`. A flat arm and `reprice_only` are both positive, so requirement 30 creates `flat_reprice` at 6 seats on `flat_75`: `contestWeight` 0.75 with `repriceFirstExpansion` 1 (M-110).

**Prediction against the three retries (M-105 to M-107).** I expected every estimate to shrink into the range 0 to +0.4pp and put `better` at about 10% an arm. No arm read `better`. The two 5-seat arms shrank as predicted, to about +0.2pp. The four arms at 4 and 6 seats barely moved, +0.42pp to +0.50pp, above my range: at those two seat counts a heavy flat discount is worth a little under half a point, measured twice, which is real and under the bar the owner set.
