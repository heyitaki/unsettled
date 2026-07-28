#!/usr/bin/env python3
"""Fail if the working tree touches anything outside the migration's allowed paths."""
import re, subprocess, sys
ALLOWED = re.compile(
    r"^(\.claude/specs/simulator/"
    r"|simulator/README\.md$"
    r"|CLAUDE\.md$"
    r"|\.gitignore$"
    r"|tools/(link-check\.py|scope-check\.py|spec-tracked-check\.sh)$)"
)
records = subprocess.run(["git", "-C", sys.argv[1], "status", "--porcelain=v1", "-z",
                          "--untracked-files=all"],
                         capture_output=True, text=True, check=True).stdout.split("\0")
paths, i = [], 0
while i < len(records):
    entry = records[i]
    if not entry:
        i += 1
        continue
    status, path = entry[:2], entry[3:]
    paths.append(path)
    if "R" in status or "C" in status:   # rename/copy: the ORIGIN follows as its own record
        i += 1
        if i < len(records) and records[i]:
            paths.append(records[i])
    i += 1
bad = [p for p in paths if not ALLOWED.match(p)]
if bad:
    print("OUT OF SCOPE:"); [print(" ", p) for p in bad]; sys.exit(1)
print(f"in scope ({len(paths)} path(s))")
