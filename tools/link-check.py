#!/usr/bin/env python3
"""Report spec/README links and code citations whose target does not resolve.

Usage: link-check.py <repo-root> <path> [<path> ...]

Each <path> is a file, or a directory scanned for *.md. A requested path that does
not exist is an error, not an empty scan.

Two kinds of reference are checked:

  * Markdown link destinations, `[text](dest)`. Resolved ONLY relative to the file
    containing them, which is what Markdown itself does. Angle-bracket destinations
    (`<dest with space>`) and optional titles (`(dest "title")`) are handled.
  * Backticked repo paths, `` `a/b.ext` `` -- a token containing a slash and ending
    in a known extension. Resolved against the repo root, then against the file.
    Bare module names without a slash are prose, not paths, and are ignored.

A target that exists but is a directory, or is empty, is reported: for a reader
either is as broken as a missing file.
"""

import re
import sys
from pathlib import Path

EXTENSIONS = ("md", "json", "rs", "ts", "tsx", "txt", "toml", "py", "sh")

# [text](<dest with space> "title") | [text](dest 'title') | [text](dest)
MD_LINK = re.compile(
    r"\[[^\]]*\]\(\s*(?:<(?P<angle>[^>]*)>|(?P<plain>[^()\s]+))"
    r"(?:\s+(?:\"[^\"]*\"|'[^']*'|\([^)]*\)))?\s*\)"
)
CODE_PATH = re.compile(r"`([^`\n]*/[^`\n]*?\.(?:" + "|".join(EXTENSIONS) + r"))`")
# Reference-style link definitions: `[label]: dest "title"` or `[label]: <dest>`.
# The destination lives here, not at the `[text][label]` use site, so this is where
# it is checked; an undefined label is reported separately.
REF_DEF = re.compile(r"(?m)^\s{0,3}\[([^\]]+)\]:\s*(?:<([^>]*)>|(\S+))")
REF_USE = re.compile(r"\[[^\]]*\]\[([^\]]*)\]")


def normalize_label(label):
    """CommonMark link-label matching: case-folded, internal whitespace collapsed."""
    return " ".join(label.strip().split()).casefold()


def why_bad(path):
    if not path.exists():
        return "missing"
    if path.is_dir():
        return "is a directory"
    if path.stat().st_size == 0:
        return "empty"
    return None


# The `file.rs::symbol` citation rule is a spec rule, so backticked paths are only
# enforced where that rule holds. Elsewhere (root CLAUDE.md) abbreviated module
# paths are ordinary prose and only Markdown links are checked.
CITATION_RULE_APPLIES = (".claude/specs/", "simulator/README.md")


def references(line, cite_paths):
    """Yield (target, root_relative_allowed) for every reference on the line."""
    for match in MD_LINK.finditer(line):
        dest = match.group("angle")
        if dest is None:
            dest = match.group("plain")
        yield dest, False
    match = REF_DEF.match(line)
    if match:
        yield (match.group(2) if match.group(2) is not None else match.group(3)), False
    if cite_paths:
        for dest in CODE_PATH.findall(line):
            if "*" in dest or " " in dest:  # globs and shell commands are not paths
                continue
            yield dest, True


def main(argv):
    if len(argv) < 3:
        print("usage: link-check.py <repo-root> <path> [<path> ...]", file=sys.stderr)
        return 2
    root = Path(argv[1]).resolve()
    files = []
    missing_sources = []
    for arg in argv[2:]:
        candidate = root / arg
        if candidate.is_file():
            files.append(candidate)
        elif candidate.is_dir():
            files.extend(sorted(candidate.rglob("*.md")))
        else:
            missing_sources.append(arg)
    for arg in missing_sources:
        print(f"ERROR: requested source does not exist: {arg}")
    if missing_sources:
        return 2

    bad = 0
    for file in files:
        text = file.read_text()
        defined = {normalize_label(m.group(1)) for m in REF_DEF.finditer(text)}
        for m in REF_USE.finditer(text):
            label = normalize_label(m.group(1) or m.group(0).strip("[]"))
            if label and label not in defined:
                bad += 1
                print(f"{file.relative_to(root)}: undefined link label: [{label}]")
        rel = str(file.relative_to(root))
        cite_paths = rel.startswith(CITATION_RULE_APPLIES) or rel in CITATION_RULE_APPLIES
        for number, line in enumerate(file.read_text().splitlines(), 1):
            for target, root_relative_allowed in references(line, cite_paths):
                target = target.split("#", 1)[0].strip()
                if not target or "://" in target or target.startswith("mailto:"):
                    continue
                candidates = [file.parent / target]
                if root_relative_allowed:
                    candidates.insert(0, root / target)
                resolved = next((c for c in candidates if why_bad(c) is None), candidates[0])
                reason = why_bad(resolved)
                if reason:
                    bad += 1
                    print(f"{file.relative_to(root)}:{number}: {reason}: {target}")
    print(f"-- {bad} bad reference(s) in {len(files)} file(s)")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
