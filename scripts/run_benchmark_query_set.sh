#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"
pi_serini_cd_root

BENCHMARK="$(pi_serini_default_benchmark)"
QUERY_SET="$(pi_serini_default_query_set)"
MODEL="${MODEL:-openai-codex/gpt-5.4-mini}"
PROMPT_VARIANT="${PROMPT_VARIANT:-plain_minimal}"
OUTPUT_DIR="${OUTPUT_DIR:-runs/pi_bm25_${BENCHMARK}_${QUERY_SET}_${PROMPT_VARIANT}}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-300}"
THINKING="${THINKING:-medium}"
PI_BIN="${PI_BIN:-pi}"
EXTENSION="${EXTENSION:-src/pi-search/extension.ts}"
QUERY_FILE="${QUERY_FILE:-$(BENCHMARK="$BENCHMARK" QUERY_SET="$QUERY_SET" pi_serini_default_query_file)}"
QRELS_FILE="${QRELS_FILE:-$(BENCHMARK="$BENCHMARK" pi_serini_default_qrels_file)}"
PI_BM25_INDEX_PATH="${PI_BM25_INDEX_PATH:-$(BENCHMARK="$BENCHMARK" pi_serini_default_index_path)}"

printf 'BENCHMARK=%s\n' "$BENCHMARK"
printf 'QUERY_SET=%s\n' "$QUERY_SET"
printf 'PROMPT_VARIANT=%s\n' "$PROMPT_VARIANT"
printf 'MODEL=%s\n' "$MODEL"
printf 'QUERY_FILE=%s\n' "$QUERY_FILE"
printf 'QRELS_FILE=%s\n' "$QRELS_FILE"
printf 'OUTPUT_DIR=%s\n' "$OUTPUT_DIR"
printf 'TIMEOUT_SECONDS=%s\n' "$TIMEOUT_SECONDS"
printf 'INDEX_PATH=%s\n' "$PI_BM25_INDEX_PATH"

if [[ "${PI_SERINI_DRY_RUN:-0}" == "1" ]]; then
  exit 0
fi

BENCHMARK="$BENCHMARK" \
QUERY_SET="$QUERY_SET" \
MODEL="$MODEL" \
QUERY_FILE="$QUERY_FILE" \
OUTPUT_DIR="$OUTPUT_DIR" \
TIMEOUT_SECONDS="$TIMEOUT_SECONDS" \
THINKING="$THINKING" \
PI_BIN="$PI_BIN" \
EXTENSION="$EXTENSION" \
QRELS_FILE="$QRELS_FILE" \
PI_BM25_INDEX_PATH="$PI_BM25_INDEX_PATH" \
PROMPT_VARIANT="$PROMPT_VARIANT" \
bash scripts/run_benchmark.sh
