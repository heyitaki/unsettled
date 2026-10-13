#!/bin/bash
# simulator/box/evaluate/preflight.sh (laptop, bash 3.2): refuse a launch the box could only fail
# at, or one that names a domain no run may carry again. Each refusal saves a remote build.
set -uo pipefail
refuse() { echo "evaluate: $*" >&2; exit 1; }
case " ${BOX_REF_NAMES:-} " in
  *" run "*) ;;
  *) refuse "pass --ref run=<ref>" ;;
esac
args=$*
seats='' domain='' boards='' arms=''
while [ $# -gt 0 ]; do
  case $1 in
    --seats | --domain | --boards | --arms | --where)
      [ $# -ge 2 ] || refuse "$1 needs a value"
      case $1 in
        --seats) seats=$2 ;;
        --domain) domain=$2 ;;
        --boards) boards=$2 ;;
        --arms) arms=$2 ;;
      esac
      shift 2
      ;;
    --units) shift ;;
    *) refuse "unknown argument $1" ;;
  esac
done
case $seats in 3 | 4 | 5 | 6) ;; *) refuse "--seats takes 3 to 6, got '$seats'" ;; esac
case $boards in '' | *[!0-9]*) refuse "--boards takes a count, got '$boards'" ;; esac
[ -n "$arms" ] || refuse "pass --arms <label>[,<label>...]"
# Spent at every seat count. The per-seat ledger in programme.md covers the later domains.
case $domain in
  '') refuse "pass --domain" ;;
  tuning | eval | gate | tuning2 | eval2 | gate2 | tuning3 | eval3 | gate3 | gate4 | tuning4)
    refuse "domain $domain is spent" ;;
esac
git -C "$BOX_REPO" cat-file -e "${BOX_REF_run:?}:simulator/box/evaluate/job.sh" 2> /dev/null ||
  refuse "ref run ($BOX_REF_run) predates this job"
old_ifs=$IFS
IFS=,
for label in $arms; do
  git -C "$BOX_REPO" cat-file -e "$BOX_REF_run:simulator/placement/arms/co_${label}_s$seats.json" 2> /dev/null ||
    refuse "arm $label has no file at $seats seats in the run ref"
done
IFS=$old_ifs
jq -n --arg args "$args" '{capMinutes: 240, job: {args: $args}}'
