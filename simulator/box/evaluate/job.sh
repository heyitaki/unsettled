# shellcheck shell=bash
# simulator/box/evaluate/job.sh (the box, bash 5): one `unsettled-sim evaluate` run of the `run`
# ref, on the field statement every measurement programme uses. Args: --seats <n> --domain <d>
# --boards <b> --arms <label>[,<label>...] [--units] [--where <rule>]. Before a run on any domain
# other than perf, the same command plays perf boards at 2,000 and 20,000 and the job ends with
# nothing spent if memory still grows with boards or the run would not fit the cap. evaluate
# writes nothing until every game is played, so a job that ends early leaves no evaluation.json.
set -e
units=() where=()
while [ $# -gt 0 ]; do
  case $1 in
    --seats) seats=$2; shift 2 ;;
    --domain) domain=$2; shift 2 ;;
    --boards) boards=$2; shift 2 ;;
    --arms) arms=$2; shift 2 ;;
    --units) units=(--units); shift ;;
    --where) where=(--where "$2"); shift 2 ;;
    *) echo "evaluate: unknown argument $1" >&2; exit 2 ;;
  esac
done
layout=standard4
[ "$seats" -le 4 ] || layout=extension6
shipped='placement/seat-weights/seats-{seats}.json'
head=(--layout "$layout" --seats "$seats")
middle=(--field "app_formula_draft:$shipped@$shipped" --arm "base=app_formula_draft:$shipped@$shipped")
IFS=, read -r -a labels <<< "$arms"
for label in "${labels[@]}"; do
  middle+=(--arm "$label=app_formula_draft:placement/arms/co_${label}_s{seats}.json@$shipped")
done
tail=(--reps 2 --policy heuristic-v1-trader-aware-threat-devcards-denial --threads 0 --player-trading
  --threshold 0.005 --alpha 0.05)

dnf install -y -q gcc time
curl -sSf https://sh.rustup.rs | sh -s -- -y -q --profile minimal --default-toolchain stable
# shellcheck disable=SC1091
. "$HOME/.cargo/env"
cd "$BOX_CHECKOUTS/run/simulator"
box_phase build cargo build --release --locked -p unsettled-sim || exit 1
box_record "$(jq -nc --arg rustc "$(rustc --version)" --argjson nproc "$(nproc)" \
  --arg cpu "$(lscpu | sed -n 's/^Model name: *//p')" --arg commit "${BOX_REF_run:?}" \
  --arg binary "$(sha256sum < target/release/unsettled-sim | cut -d' ' -f1)" \
  '{rustc: $rustc, cpu: $cpu, nproc: $nproc, commit: $commit, binarySha256: $binary}')"

# play <domain> <boards> <dir>: the run, with its wall seconds and peak KiB left in <dir>.time.
play() {
  local -a command=(evaluate "${head[@]}" --domain "$1" "${middle[@]}" --reference base --boards "$2"
    "${tail[@]}" "${units[@]}" "${where[@]}" --out "$3")
  box_log "unsettled-sim ${command[*]}"
  /usr/bin/time -f '%e %M' -o "$3.time" ./target/release/unsettled-sim "${command[@]}" \
    > "$3.stdout" 2> "$3.stderr"
}

if [ "$domain" != perf ]; then
  for size in 2000 20000; do
    box_phase "perf-$size" play perf "$size" "$BOX_WORK/perf-$size" || exit 1
  done
  read -r smallSeconds smallKib < "$BOX_WORK/perf-2000.time"
  read -r seconds kib < "$BOX_WORK/perf-20000.time"
  predicted=$(jq -n --argjson s "$seconds" --argjson b "$boards" '$s * $b / 20000 / 60 | ceil')
  box_record "$(jq -nc --argjson s2 "$smallSeconds" --argjson k2 "$smallKib" --argjson s20 "$seconds" \
    --argjson k20 "$kib" --argjson p "$predicted" \
    '{perf: {seconds2000: $s2, peakKib2000: $k2, seconds20000: $s20, peakKib20000: $k20, predictedMinutes: $p}}')"
  # ponytail: the perf boards also pay for the flags a full run keeps, so 1.5 has slack to spare.
  [ "$kib" -le $((smallKib * 3 / 2)) ] || { box_log "memory grows with boards: $smallKib to $kib KiB"; exit 3; }
  left=$((BOX_CAP_MINUTES - SECONDS / 60))
  [ "$predicted" -le $((left * 3 / 4)) ] || { box_log "predicted $predicted minutes, $left left under the cap"; exit 3; }
fi

status=0
box_phase run play "$domain" "$boards" "$BOX_WORK/run" || status=$?
for file in run.time run.stdout run.stderr; do cp "$BOX_WORK/$file" "$BOX_OUT/$file"; done
# Out of scratch only when whole, and into the bucket at once: a result that exists is a spent domain.
if [ -f "$BOX_WORK/run/evaluation.json" ]; then
  mv "$BOX_WORK"/run/* "$BOX_OUT/"
  box_upload "$BOX_OUT/evaluation.json"
fi
exit "$status"
