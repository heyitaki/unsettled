#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"
wasm=src/engine/advice/engine.wasm

source_hash() {
  # Include the embedded topology packs and test-only default weights as well as crate inputs.
  git ls-files -co --exclude-standard -- \
    simulator/crates/engine/src simulator/crates/engine/Cargo.toml \
    simulator/crates/wasm simulator/topology \
    simulator/placement/default-weights.json simulator/Cargo.toml simulator/Cargo.lock |
    grep -E '\.(rs|toml|json|lock)$' |
    LC_ALL=C sort -u |
    while IFS= read -r path; do
      size=$(wc -c < "$path")
      printf '%s\0%s\0' "$path" "$((size))"
      cat "$path"
    done |
    shasum -a 256 | cut -d ' ' -f 1
}

hashes() {
  source_hash
  shasum -a 256 "$wasm" | cut -d ' ' -f 1
}

case "${1:-}" in
  --check)
    if [[ -f "$wasm" && -f "$wasm.src-hash" && "$(hashes)" == "$(cat "$wasm.src-hash")" ]]; then
      exit 0
    fi
    echo 'engine.wasm is stale: run simulator/tools/build-wasm.sh' >&2
    exit 1
    ;;
  '') ;;
  *) echo "Usage: $0 [--check]" >&2; exit 1 ;;
esac

(cd simulator && RUSTFLAGS="${RUSTFLAGS:+$RUSTFLAGS }--remap-path-prefix=$HOME=/home --remap-path-prefix=$repo_root=/unsettled" \
  cargo build -p unsettled-wasm --target wasm32-unknown-unknown --release --offline)
built=simulator/target/wasm32-unknown-unknown/release/unsettled_wasm.wasm
if LC_ALL=C grep -aFq "$HOME" "$built"; then
  echo 'engine.wasm contains the builder home path' >&2
  exit 1
fi
mkdir -p "$(dirname "$wasm")"
cp "$built" "$wasm"
hashes > "$wasm.src-hash"
