#!/bin/bash
# simulator/box/bench/preflight.sh (laptop, bash 3.2): the job compares two commits, so refuse a
# launch that does not name both, a commit older than the speed suite, or a candidate argument
# that would change what one side counts. Each refusal here saves two remote builds.
set -uo pipefail
refuse() { echo "bench: $*" >&2; exit 1; }
for name in base cand; do
  case " ${BOX_REF_NAMES:-} " in
    *" $name "*) ;;
    *) refuse "pass --ref $name=<ref>" ;;
  esac
  var=BOX_REF_$name
  git -C "$BOX_REPO" cat-file -e "${!var}:simulator/crates/cli/src/bench.rs" 2> /dev/null ||
    refuse "ref $name (${!var}) predates the speed suite: it has no simulator/crates/cli/src/bench.rs"
done
args=$*
while [ $# -gt 0 ]; do
  case $1 in
    --policy | --weights) [ $# -ge 2 ] || refuse "$1 needs a value" ;;
    *) refuse "the candidate takes --policy and --weights only, got $1" ;;
  esac
  # The job runs from the candidate's simulator/, so a path of its own has to be committed there.
  # An absolute path or one that climbs out (a box --input) is left for the job to find.
  if [ "$1" = --weights ]; then
    case $2 in
      /* | ../*) ;;
      *) git -C "$BOX_REPO" cat-file -e "${BOX_REF_cand:?}:simulator/$2" 2> /dev/null ||
        refuse "--weights $2 is not committed in the candidate ref under simulator/" ;;
    esac
  fi
  shift 2
done
jq -n --arg args "$args" '{capMinutes: 90, job: {candidateArgs: $args}}'
