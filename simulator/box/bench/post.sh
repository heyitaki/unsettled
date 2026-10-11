#!/bin/bash
# simulator/box/bench/post.sh (laptop, bash 3.2): join the two refs per scenario. Wall time is the
# fastest of the rounds; a ratio under 1 means the candidate is cheaper. A changed state hash
# means the two refs measured different inputs, so that row's ratios compare nothing. Safe to
# rerun over a delivered directory: the summary is replaced only by a complete one.
set -uo pipefail
out=$BOX_RUN_DIR/out
counts=$out/callgrind.ndjson
[ -s "$counts" ] || counts=/dev/null
jq -n --slurpfile counts "$counts" '
  def ratio(a; b): if a and b and a > 0 and b > 0 then (b / a * 1000 | round / 1000) else null end;
  reduce (inputs
      | (input_filename | capture("wall-(?<name>base|cand)-").name) as $name
      | .scenarios[] | select(.status == "measured") | {name: $name, row: .}) as $r
    ({}; .[$r.row.id][$r.name] |= {
      ns: ([.ns, $r.row.nsPerCallMin] | map(select(. != null)) | min),
      state: $r.row.stateHash, decision: $r.row.decisionHash })
  | reduce $counts[] as $c (.; if has($c.id) then .[$c.id][$c.name].ir = $c.ir else . end)
  | to_entries | map((.value.base.state == null or .value.cand.state == null) as $oneSided | {
      id: .key,
      baseNs: .value.base.ns, candNs: .value.cand.ns,
      nsRatio: ratio(.value.base.ns; .value.cand.ns),
      baseIr: .value.base.ir, candIr: .value.cand.ir,
      irRatio: ratio(.value.base.ir; .value.cand.ir),
      oneSided: $oneSided,
      statesDiffer: (($oneSided | not) and .value.base.state != .value.cand.state),
      decisionsDiffer: (($oneSided | not) and .value.base.decision != .value.cand.decision) })
' "$out"/wall-*.json > "$BOX_RUN_DIR/summary.json.tmp" || { rm -f "$BOX_RUN_DIR/summary.json.tmp"; exit 1; }
mv "$BOX_RUN_DIR/summary.json.tmp" "$BOX_RUN_DIR/summary.json"
jq -r '
  def tenth: if . then (. * 10 | round / 10) else . end;
  (["scenario", "base ns", "cand ns", "ns ratio", "base Ir", "cand Ir", "Ir ratio", "note"]),
  (.[] | [.id, (.baseNs | tenth), (.candNs | tenth), .nsRatio, .baseIr, .candIr, .irRatio,
    (if .oneSided then "ONE SIDE ONLY" elif .statesDiffer then "STATES DIFFER"
     elif .decisionsDiffer then "decisions differ" else "" end)]
    | map(if . == null then "-" else tostring end))
  | @tsv' "$BOX_RUN_DIR/summary.json" | column -t -s "$(printf '\t')"
echo "summary: $BOX_RUN_DIR/summary.json"
