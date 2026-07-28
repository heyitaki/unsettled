#!/usr/bin/env bash
# No temp file: v3 redirected to a fixed /tmp path and exited 0 when that path was unwritable.
R="$1"; fail=0
expected=$(printf '%s\n' contracts gaps measurements migration-ledger programme spec \
  | sed 's|^|.claude/specs/simulator/|; s|$|.md|')
actual=$(git -C "$R" ls-files -- .claude/specs/simulator | sort)
if [ "$actual" != "$expected" ]; then
  echo "TRACKED SET MISMATCH"; diff <(printf '%s\n' "$expected") <(printf '%s\n' "$actual") || true; fail=1
fi
problems=$(printf '%s\n' "$expected" | while IFS= read -r f; do
  git -C "$R" check-ignore --no-index -q "$f" && echo "IGNORED: $f"
  [ -s "$R/$f" ] || echo "EMPTY: $f"
done)
[ -n "$problems" ] && { printf '%s\n' "$problems"; fail=1; }
exit "$fail"
