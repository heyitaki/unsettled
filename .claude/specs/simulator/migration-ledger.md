# Migration ledger

Provenance for the extraction of `simulator/README.md` into `.claude/specs/simulator/`. Source: `simulator/README.md` at commit `cd84289`, 258 lines.

One row per source claim and per source heading. **Anchor** is the source line number, with a letter suffix where one line carried more than one claim. **Rewrite** names which of the five permitted mechanical edits was applied: `split`, `delist`, `tabulate`, `add` (heading, id, link, provenance field), `re-anchor` (a code citation moved to `file.rs::symbol`), or `—` for a verbatim move.

Class key: **C** contract · **D** decision · **G** gap · **M** measurement · **O** operational.

## Headings

| Anchor | Heading | Disposition |
| --- | --- | --- |
| 9 | `## Build and test` | Retained in README |
| 19 | `## CLI` | Retained in README |
| 95 | `### Tournament config` | Retained in README |
| 119 | `## Outputs and determinism` | Retained in README |
| 134 | `## Board ingestion and topology` | Retained in README |
| 146 | `## Extending the study` | Retained in README |
| 152 | `## Programme and phase order` | Became `programme.md`'s title |

## Claims

| Anchor | Class | Destination | Rewrite |
| --- | --- | --- | --- |
| 1 | — | README (title) | — |
| 3a | C | contracts.md § Scope | split |
| 3b | C | README, pending run 2's pointer; superseded by contracts.md § Rosters | split |
| 5 | C | contracts.md § Crate boundaries | — |
| 7 | C | contracts.md § Module roster | tabulate, re-anchor |
| 11-15 | O | README § Build and test | — |
| 17 | O (unexecutable) | README; run 2 deletes | — |
| 21-33 | O | README § CLI | — |
| 35a | O | README § CLI | split |
| 35b | C | contracts.md § Schedule and evaluation units | split |
| 37 | O | README § CLI | — |
| 39-55 | O | README § CLI | — |
| 57a | C | contracts.md § Schedule and evaluation units | split |
| 57b | C | contracts.md § Schedule and evaluation units | split |
| 57c | C | contracts.md § Schedule and evaluation units | split |
| 59a | O | README § CLI | split |
| 59b | C | contracts.md § Argument domains and the seat envelope | split |
| 61a | O | README § CLI | split |
| 61b | C | contracts.md § Seed domains and seed derivation | split |
| 61c | D | programme.md § Seed-domain discipline | split |
| 63 | D | programme.md § Seed-domain discipline | — |
| 65-67 | C | contracts.md § Paired statistics | — |
| 69-85 | O | README § CLI | — |
| 87a | C | contracts.md § Rosters | delist |
| 87b | O | README § CLI | split |
| 87c | C | contracts.md § Weights files | split |
| 87d | C | contracts.md § Weights files | split, re-anchor |
| 87e | O | README § CLI | split |
| 87f | C | contracts.md § Rosters | split |
| 89a | O | README § CLI | split |
| 89b | D | programme.md § Phases | split |
| 89c | C | contracts.md § Player trading | split, re-anchor |
| 89d | D | programme.md § Phases | split |
| 91a | O | README § CLI | split |
| 91b | C | contracts.md § Output stability | split |
| 93a | O | README § CLI | split |
| 93b | C | contracts.md § Argument domains and the seat envelope | split |
| 93c | C | contracts.md § Output stability | split |
| 97-117 | O | README § Tournament config | — |
| 121-128a | O | README § Outputs and determinism | split |
| 121-128b | C | contracts.md § Output stability | split |
| 130 | C | contracts.md § Determinism | — |
| 132 | C | contracts.md § Game termination | — |
| 136 | C | contracts.md § Board ingestion and topology | — |
| 138-142 | O | README § Board ingestion and topology | — |
| 144a | C | contracts.md § Board ingestion and topology | split, re-anchor |
| 144b | C | contracts.md § Board ingestion and topology | split |
| 148 | O | README § Extending the study | — |
| 150a | O | README § Extending the study | split |
| 150b | C | contracts.md § Extension seams | split |
| 154-157 | D | programme.md (preamble) | — |
| 158 | D | programme.md (preamble) | — |
| 159 | D | programme.md (preamble) | — |
| 160-163 | D | programme.md § Phases | — |
| 164a | D | programme.md § Phases | split |
| 164b | C | contracts.md § Belief state and ETW | split |
| 165 | D + C | programme.md § Phases (status); contracts.md § Belief state and ETW (guarantees) | split |
| 166a | D | programme.md § Phases | split |
| 166b | C | contracts.md § Threat-aware consumers | split, re-anchor |
| 166c | D | programme.md § Phases | split |
| 167 | D | programme.md § Phases | — |
| 168 | D | programme.md § Phases | — |
| 169 | D | programme.md § Phases | — |
| 170-171 | D | programme.md § Phases | — |
| 172-175 | D | programme.md § How to read the gap inventory | — |
| 176 | G | gaps.md § Defects (group heading) | add |
| 178a | G | gaps.md SIM-GAP-01 | split, add |
| 178b | C | contracts.md § Threat-aware consumers | split |
| 179 | G | gaps.md SIM-GAP-02 | add |
| 180 | G | gaps.md SIM-GAP-03 | add |
| 181 | G | gaps.md SIM-GAP-04 | add |
| 183 | G | gaps.md § Denial and threat (group heading) | add, re-anchor |
| 185 | G | gaps.md SIM-GAP-05 | add |
| 186 | G | gaps.md SIM-GAP-06 | add |
| 187 | G | gaps.md SIM-GAP-07 | add |
| 188 | G | gaps.md SIM-GAP-08 | add |
| 189 | G | gaps.md SIM-GAP-09 | add |
| 191 | G | gaps.md § Card-play scope (group heading) | add |
| 193 | G | gaps.md SIM-GAP-10 | add |
| 194 | G | gaps.md SIM-GAP-11 | add |
| 195 | G | gaps.md SIM-GAP-12 | add |
| 196 | G | gaps.md SIM-GAP-13 | add |
| 197 | G | gaps.md SIM-GAP-14 | add |
| 199 | G | gaps.md § Untouched decision surfaces (group heading) | add |
| 201a | G | gaps.md SIM-GAP-15 | split, add |
| 201b | D | programme.md § Design notes that outlive their phase | split |
| 202 | G | gaps.md SIM-GAP-16 | add |
| 203a | G | gaps.md SIM-GAP-17 | split, add |
| 203b | C | contracts.md § Belief state and ETW | split |
| 205a | G | gaps.md SIM-GAP-18 | split, add |
| 205b | D | programme.md § Design notes that outlive their phase | split |
| 206 | G | gaps.md SIM-GAP-19 | add |
| 208 | G | gaps.md § Initial placement, SIM-GAP-20 | add |
| 210 | — | Connector sentence introducing 212/214/216; not carried (see Deviations) | — |
| 212 | D | programme.md § Design notes that outlive their phase | — |
| 214 | D | programme.md § Design notes that outlive their phase | — |
| 216 | D | programme.md § Design notes that outlive their phase | — |
| 218-220 | M | measurements.md § Machine | — |
| 222 | M | measurements.md M-01 | add |
| 224 | M | measurements.md M-02 | add |
| 226 | M | measurements.md M-03 | add |
| 228a | M | measurements.md M-04 | split, add |
| 228b | C | contracts.md § Player trading | split |
| 230a | M | measurements.md M-05 … M-10 | split, add |
| 230b | G | gaps.md SIM-GAP-21 | split, add |
| 232-236 | M | measurements.md M-11 | add |
| 237a | C | contracts.md § Benchmark reporting | split |
| 237b | M | measurements.md M-12 | split, add |
| 239-244 | C | contracts.md § Performance-critical structures | — |
| 246 | C | contracts.md § Performance-critical structures | — |
| 248 | C | contracts.md § Performance-critical structures | — |
| 250 | C | contracts.md § Performance-critical structures | — |
| 252 | D | programme.md § Seed-domain discipline | — |
| 254-256 | M | measurements.md M-13 | add |
| 258a | M | measurements.md M-14 | split, add |
| 258b | C | contracts.md § Ablation semantics | split |

## Additions made by this run

| Item | Where | Why |
| --- | --- | --- |
| Pointer header | `simulator/README.md` | Permitted rewrite 4. Names the spec tree and states that the spec wins on disagreement. |
| Class rules, precedence, ownership rule, staleness contract | `spec.md` | New structural content that the plan defines; it is not a migrated claim. |
| `.claude/` tracking note | `spec.md` | New; records the `git clean -xdf` side effect and why ignore rules must stay per-subdirectory. |
| `SIM-GAP-NN` ids | `gaps.md` | Permitted rewrite 4. Assigned in source order so a re-run is byte-reproducible. |
| `M-NN` ids and provenance fields | `measurements.md` | Permitted rewrite 4. Fields the source did not record are the literal `unknown`. |

## The single content change

`measurements.md` M-10 carries a **provenance correction made at creation**, which is this run's only content change. The source sentence recorded the fifth loaded throughput reading's raw output under a file named `g3-throughput-quiet.txt`. The filename invites the reading that this is the admissible quiet-machine sample; it is not — it is a loaded reading at pre-run load `2.12`, and the admissible one is M-05. Corrected once, here, because an append-only file must not receive a knowingly misleading entry even transiently. Run 2 does not revisit this file.

## Deviations from the plan's map, recorded rather than silently applied

1. **Line 210** (`Two rules hold across all of it.`) was mapped to class G with the `206-211` range, but it is a connector introducing the class-D notes at 212/214/216 and carries no gap claim. It was not carried into `gaps.md`; `programme.md`'s § Design notes heading serves the same function. Recorded here rather than filed as a gap.
2. **Line 177 is blank** but does not appear in the plan's list of uncovered blank lines. No claim was lost; noted for accuracy of the coverage count.
3. **The solve-artifact citation** at source line 230 — a throughput log under an untracked `.claude` solve-artifact directory — is rendered in M-10 as prose rather than as a backticked path, and is deliberately unbackticked here too. The directory is untracked, so a backticked path would resolve in the authoring checkout and fail in a fresh clone, making acceptance criterion 4 environment-dependent.
4. **Commit, date and command fields in `measurements.md` are `unknown`** wherever the README did not carry them, including cases recoverable from `git log`. Run 1 forbids new claims. Because the file is append-only, a later entry may supply the mapping; an edit may not. **Discharged by M-15**, appended during SIM-SPEC-F2.

## Post-extraction additions — SIM-SPEC-F2

The extraction covered `simulator/README.md` and nothing else. SIM-SPEC-F2 reduced the `opponent-modelling-programme` project memory to the process learnings and undecided questions that `spec.md`'s ownership rule leaves it, which meant first moving the claims it held that no file in this tree owned. Those claims came from session records, not from the README, so they are recorded here rather than in the claims table above.

| Claim | Destination | Class |
| --- | --- | --- |
| Why phases E through G exist: the shift from own-VP-rate to win-probability, and denial paying only through win probability | programme.md § Why E through G exist | D |
| The wasm-portable engine as a second payoff — mid-game recommendations need an opponent model | programme.md § Why E through G exist | D |
| `handValue` may be double-counted once placement is scored through ETW; settle at H by A/B | programme.md § Open question H must settle | D |
| The three built consumers are each inconclusive with a declining estimate, and why that is the expected shape | programme.md § How to read the A/B results so far | D |
| A lone ETW term is degenerate for selection because `route_etw` caps at `cards_per_vp` | contracts.md § Belief state and ETW | C |
| The default threat term ordering reverses below a danger crossover | contracts.md § Threat-aware consumers | C |
| `assert_params` guards a sweep domain because an out-of-domain value degrades silently | contracts.md § Threat-aware consumers | C |
| Provenance for M-01 through M-10 | measurements.md M-15 | M |
| How often counterparty selection is uncontested, and how often the contested cases tie | measurements.md M-16 | M |
| G2 Hold firing rates | measurements.md M-17 | M |

The `simulator-known-gaps` memory was reduced in the same pass, for the same reason and under the same rule:

| Claim | Destination | Class |
| --- | --- | --- |
| `eligible_victim` cannot name an empty-handed opponent, so a steal cannot be declined | gaps.md `SIM-GAP-22` | G |
| `setup()` leaves `longest_road_len` stale until the first road build | gaps.md `SIM-GAP-23` | G |
| `dev_card_score` outranks expansion roads from turn one | gaps.md `SIM-GAP-24` | G |
| Never run a `tournament` with more arms than seats; prefer `evaluate` for comparing arms | contracts.md § Schedule and evaluation units | C |
| Acceptance runs both cargo profiles, and diffs against a corpus captured beforehand | contracts.md § Acceptance for any engine change | C |
| Why serde-defaulting a new weight to zero breaks the single-parameter property | contracts.md § Weights files | C |
| The collected `spread_*` and `gpf_*` results are superseded by the `handValue` field change | programme.md § Seed-domain discipline | D |
| Never bound achievable road length by `current_length + 1` | already owned by contracts.md § Performance-critical structures; the memory copy was a duplicate and was deleted | C |
| The policy never defends Longest Road once holding it | already owned by `SIM-GAP-07`; the memory copy was a duplicate and was deleted | G |

Claims deliberately **not** moved, because they are not about the simulator or cannot live in the repo:

- The solve-pipeline scope-control finding and the forwarded-argument test-design rule are process learnings about how this repo's runs are driven, and `spec.md` assigns those to memory.
- The rules-audit corpus and its reproductions are in `.claude/pairs/sim-rules-audit/`, which is ignored. Memory keeps a pointer and the warning that it exists in no fresh clone. Whether to track it is open.
- Measurement conditions specific to this host — a known background CPU floor, and that `uptime`'s user count is not a contention signal — describe the machine rather than the simulator.
