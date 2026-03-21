#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"
pi_serini_cd_root

BENCHMARK="$(pi_serini_default_benchmark)"
QUERY_SET="$(pi_serini_default_query_set)"
LOG_DIR="${LOG_DIR:-runs/shared-bm25-${BENCHMARK}-${QUERY_SET}}"
RUN_SCRIPT="scripts/run_benchmark_query_set.sh"

printf 'BENCHMARK=%s\n' "$BENCHMARK"
printf 'QUERY_SET=%s\n' "$QUERY_SET"
printf 'LOG_DIR=%s\n' "$LOG_DIR"

if [[ "${PI_SERINI_DRY_RUN:-0}" == "1" ]]; then
  if [[ -n "${OUTPUT_DIR:-}" ]]; then
    printf 'OUTPUT_DIR=%s\n' "$OUTPUT_DIR"
  fi
  printf 'RUN_SCRIPT=%s\n' "$RUN_SCRIPT"
  exit 0
fi

BENCHMARK="$BENCHMARK" \
QUERY_SET="$QUERY_SET" \
LOG_DIR="$LOG_DIR" \
RUN_SCRIPT="$RUN_SCRIPT" \
bash scripts/launch_shared_bm25_benchmark.sh
