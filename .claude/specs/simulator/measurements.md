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
