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
