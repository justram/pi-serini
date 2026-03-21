#!/usr/bin/env bash
set -euo pipefail

BENCHMARK="${BENCHMARK:-browsecomp-plus}" \
QUERY_SET="${QUERY_SET:-q9}" \
OUTPUT_DIR="${OUTPUT_DIR:-runs/pi_bm25_q9_plain_minimal_excerpt}" \
LOG_DIR="${LOG_DIR:-runs/shared-bm25-q9}" \
bash scripts/launch_benchmark_query_set_shared.sh "$@"
