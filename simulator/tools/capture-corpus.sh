#!/bin/bash
# Capture the byte-exact behavior corpus required by contracts.md "Acceptance
# for any engine change": results.json + per-game JSONL for four policies on
# both layouts, all seeds fixed. Diffing a recapture against a pre-change
# capture identifies exactly which games a change moved.
#
# Usage: tools/capture-corpus.sh [out-dir]   (default runs/corpus-pre)
set -euo pipefail
cd "$(dirname "$0")/.."
out="${1:-runs/corpus-pre}"
mkdir -p "$out"

cargo build --release -p unsettled-sim
bin=target/release/unsettled-sim

run() {
  layout="$1" heuristics="$2" policy="$3"
  shift 3
  dir="$out/$layout-$policy"
  "$bin" tournament \
    --layout "$layout" \
    --random-boards 25 \
    --reps 4 \
    --heuristics "$heuristics" \
    --policy "$policy" \
    --seed 42 \
    --threads 0 \
    --jsonl "$dir/games.jsonl" \
    --out "$dir" \
    "$@"
}

std4=max_pips,pip_diversity,pip_scarcity,port_synergy
ext6=max_pips,pip_diversity,pip_scarcity,port_synergy,city_focus,random

for layout_spec in "standard4 $std4" "extension6 $ext6"; do
  set -- $layout_spec
  layout="$1" heuristics="$2"
  run "$layout" "$heuristics" heuristic-v1
  run "$layout" "$heuristics" priority-trader
  run "$layout" "$heuristics" heuristic-v1-trader --player-trading
  run "$layout" "$heuristics" heuristic-v1-trader-aware-threat-devcards-denial --player-trading
done

echo "corpus captured to $out"
