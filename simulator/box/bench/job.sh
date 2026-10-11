# shellcheck shell=bash
# simulator/box/bench/job.sh (the box, bash 5): sourced with the job args as "$@". The args go to
# the candidate's bench runs only (--policy, --weights), so one commit under both ref names with a
# weights file measures a weights candidate, and two commits with no args measure a code change.
# Both refs are built by one toolchain, timed in alternation so drift on the shared machine lands
# on both, then each scenario is counted under callgrind, which does not move with the machine's
# load. A build or a timing run that fails ends the job; a count that fails only loses its row.
set -e
ROUNDS=3
CAND_ARGS=("$@")

dnf install -y -q valgrind gcc
curl -sSf https://sh.rustup.rs | sh -s -- -y -q --profile minimal --default-toolchain stable
# shellcheck disable=SC1091
. "$HOME/.cargo/env"
box_record "$(jq -nc --arg rustc "$(rustc --version)" --arg valgrind "$(valgrind --version)" \
  --arg cpu "$(lscpu | sed -n 's/^Model name: *//p')" --argjson nproc "$(nproc)" \
  '{rustc: $rustc, valgrind: $valgrind, cpu: $cpu, nproc: $nproc}')"

sim() { printf '%s/%s/simulator' "$BOX_CHECKOUTS" "$1"; }

# bench <ref name> <runner words...> -- <bench flags...>: one run from that ref's checkout.
bench() {
  local name=$1
  shift
  local -a runner=() extra=()
  while [ "$1" != -- ]; do runner+=("$1"); shift; done
  shift
  [ "$name" != cand ] || extra=("${CAND_ARGS[@]}")
  (cd "$(sim "$name")" && "${runner[@]}" ./target/release/unsettled-sim bench "$@" "${extra[@]}")
}

# `|| exit 1` keeps a killed child's 137 or 143 from becoming the job's own code: box reserves both.
for name in base cand; do
  box_phase "build-$name" cargo build --release --locked -p unsettled-sim \
    --manifest-path "$(sim "$name")/Cargo.toml" || exit 1
done
# Two refs that built the same bytes can only differ by run-to-run variation.
box_record "$(jq -nc --arg base "$(sha256sum < "$(sim base)/target/release/unsettled-sim")" \
  --arg cand "$(sha256sum < "$(sim cand)/target/release/unsettled-sim")" \
  '{binarySha256: {base: ($base | split(" ")[0]), cand: ($cand | split(" ")[0])}}')"

# The side that runs first swaps each round, so neither always follows the other.
for round in $(seq "$ROUNDS"); do
  order="base cand"
  [ $((round % 2)) = 1 ] || order="cand base"
  for name in $order; do
    box_phase "wall-$name-$round" bench "$name" -- --json "$BOX_OUT/wall-$name-$round.json" \
      > /dev/null || exit 1
  done
done

# One process per scenario: collection is switched on only inside bench.rs::timed_pass, and
# --quick makes that a single call with no warm-up pass, so the process total is one call's
# instructions. The end-to-end rows are threaded and are left to the wall clock.
count() {
  local name id ir
  while IFS= read -r id; do
    for name in base cand; do
      rm -f "$BOX_WORK/cg.out" "$BOX_WORK/cg.json"
      bench "$name" timeout 900 valgrind -q --tool=callgrind "--toggle-collect=*timed_pass*" \
        "--callgrind-out-file=$BOX_WORK/cg.out" -- --quick --threads 1 --filter "$id" \
        --json "$BOX_WORK/cg.json" > /dev/null || { box_log "callgrind failed: $name $id"; continue; }
      # A filter is a substring, so a second match would be summed into the same total, and a row
      # this ref skipped never entered timed_pass.
      [ "$(jq -c '.scenarios | map(.status)' "$BOX_WORK/cg.json")" = '["measured"]' ] || continue
      ir=$(sed -n 's/^totals: *\([0-9][0-9]*\).*/\1/p' "$BOX_WORK/cg.out" | head -1)
      jq -nc --arg id "$id" --arg name "$name" --argjson ir "${ir:-null}" \
        '{id: $id, name: $name, ir: $ir}' >> "$BOX_OUT/callgrind.ndjson"
    done
  done < <(jq -r '.scenarios[] | select(.status == "measured" and .group != "e2e") | .id' \
    "$BOX_OUT/wall-base-1.json")
}
# ponytail: sequential; fan out over $(nproc) if this phase comes to dominate the bill.
box_phase callgrind count || box_log "callgrind phase failed; the wall results stand"
