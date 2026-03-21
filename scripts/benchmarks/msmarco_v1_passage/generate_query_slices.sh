#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
DATASET_ROOT="$ROOT/data/msmarco-v1-passage"
SOURCE_QUERIES="$DATASET_ROOT/source/topics.dev-subset.tsv"
QUERY_DIR="$DATASET_ROOT/queries"
DEV_QUERIES="$QUERY_DIR/dev.tsv"

log() {
  printf '[setup:msmarco-v1-passage:query-slices] %s\n' "$*"
}

main() {
  if [[ ! -f "$SOURCE_QUERIES" ]]; then
    printf 'Missing source query file: %s\nRun setup first.\n' "$SOURCE_QUERIES" >&2
    exit 1
  fi

  mkdir -p "$QUERY_DIR"
  cp "$SOURCE_QUERIES" "$DEV_QUERIES"
  log "Wrote dev query set to $DEV_QUERIES"
}

main "$@"
