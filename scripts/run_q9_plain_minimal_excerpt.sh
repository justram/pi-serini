#!/usr/bin/env bash
set -euo pipefail

BENCHMARK="${BENCHMARK:-browsecomp-plus}" \
QUERY_SET="${QUERY_SET:-q9}" \
OUTPUT_DIR="${OUTPUT_DIR:-runs/pi_bm25_q9_plain_minimal_excerpt}" \
PROMPT_VARIANT="${PROMPT_VARIANT:-plain_minimal}" \
bash scripts/run_benchmark_query_set.sh "$@"
