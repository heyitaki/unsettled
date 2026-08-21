# Simulator specification — index

The normative specification for the Catan self-play simulator in `simulator/`. Extracted from `simulator/README.md`, which survives as the operator's guide.

**Two homes, split by claim class, not by topic.** `simulator/README.md` tells you what to type. This tree says what must be true. The split is deliberately not the old section boundary: the README's CLI section held seed-domain discipline, the domain constants and their disjointness assertion, the paired-statistics rules and the byte-identity guarantee, while its "Measured performance" section held the four `RoadNetwork` invariants. Those are contracts filed under an operational heading; a topic split would have preserved that error.

## Files

| File | Class | Holds |
| --- | --- | --- |
| [contracts.md](contracts.md) | **C** | Invariants and guarantees. A violation is a bug. |
| [programme.md](programme.md) | **D** | Decisions: phase order, status, rationale, what each revision replaced. |
| [gaps.md](gaps.md) | **G** | Unmodelled scoring surfaces, each with a `SIM-GAP-NN` id. |
| [measurements.md](measurements.md) | **M** | Append-only log of readings, one entry per reading, with provenance. |
| [migration-ledger.md](migration-ledger.md) | — | Provenance of this extraction: one row per source claim and heading. |

`simulator/README.md` is class **O** — build, run, flags, config schema, which files are written, and how to extend.

## Classes and precedence

A claim's class is decided by the **first** rule that matches, in this order:

1. **M — measured.** A number produced by a run. Carries provenance: date, commit, domain, exact command, load before and after, admissible yes or no.
2. **G — gap.** A statement that the code does not do something, or does it wrong. Fixing the code makes the claim false, which is the point.
3. **D — decision.** A choice, its rationale, or what a revision replaced. Not falsifiable by code.
4. **C — contract.** Something that must be true of the code. A violation is a bug.
5. **O — operational.** What you type, what a flag is called, what a default is, which files a run writes.

Precedence matters because claims overlap. `--domain` having no default is **O** — that is the flag as typed. *Why* it has no default, so tuning cannot accidentally reach a held-out domain, is **D**. A single README sentence often split across two owners; that is the rule working, not a failure of it.

## The ownership rule

> The owner of a claim is the file its class names. A non-owner may **name** a claim and link to it; it may never restate its content, its rationale, or any number in it.
>
> **One exception, stated narrowly because an unstated one becomes the next drift:** the repo-root `CLAUDE.md` may restate a rule as a bare imperative — no rationale, no numbers, no thresholds — when an agent must obey it without first reading the spec, and it must link to the owner. "Run `cargo test` in both profiles" qualifies; "release compiles out `debug_assert!(invariants_hold)`, the only detector for a class of piece/VP accounting bugs" does not.
>
> **Memory holds only process learnings and undecided questions.** No decisions, no measurements, no contracts, no gaps.

## The staleness contract

- **C claims** are held true by review, and by tests where a test exists. A C claim that no test guards is still normative; it is not weaker, only less protected.
- **M entries are append-only.** Add entries; never edit one. An entry that a later run supersedes stays, and the later entry says so. This is what makes a measurement trustworthy without a test, and what keeps the file conflict-free below its last entry.
- **G claims go stale by being fixed.** Closing a gap means deleting its entry and saying so in the commit, not editing it into a contract. If the fix creates a guarantee, that is a new C claim.
- **D claims are superseded, never corrected.** A decision that changed records what it replaced, because the reason a phase order was revised outlives the order itself.

A number appearing in more than one file is a defect in this tree, not a convenience.

## Citing code

Cite code as `file.rs::symbol`, never `file.rs:line`. Line numbers rot silently; symbols fail loudly. `tools/link-check.py` enforces this indirectly: a citation carrying a directory prefix — a module written with its `policy/` directory in front, say — is treated as a repo path and reported missing unless it resolves in full. Bare module names carry no slash and are read as prose, so the `file.rs::symbol` form always passes.

## One operational note about this directory

`.claude/` is only partly tracked. `.claude/specs/` is checked in; `.claude/pairs/`, `.claude/solve-artifacts/`, `.claude/solves/` and `.claude/worktrees/` are ignored. Two consequences:

- `git clean -xdf` at the repo root deletes the ignored siblings and leaves `.claude/specs/` alone. Pre-existing behaviour, but it surprises once `.claude/` holds tracked files.
- The ignore rules in `.gitignore` must stay **per-subdirectory**. A blanket `.claude/` rule cannot be undone by `!.claude/specs/`, because git does not descend into an excluded directory. `.gitignore` carries a comment saying so.
