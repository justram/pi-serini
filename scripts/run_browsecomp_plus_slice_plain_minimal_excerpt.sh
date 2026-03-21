#!/usr/bin/env bash
set -euo pipefail

SLICE="${SLICE:-q9}"
BENCHMARK="${BENCHMARK:-browsecomp-plus}"
QUERY_SET="${QUERY_SET:-$SLICE}"
OUTPUT_DIR="${OUTPUT_DIR:-runs/pi_bm25_${SLICE}_plain_minimal_excerpt}"
PROMPT_VARIANT="${PROMPT_VARIANT:-plain_minimal}"

SLICE="$SLICE" \
BENCHMARK="$BENCHMARK" \
QUERY_SET="$QUERY_SET" \
OUTPUT_DIR="$OUTPUT_DIR" \
PROMPT_VARIANT="$PROMPT_VARIANT" \
bash scripts/run_benchmark_query_set.sh
