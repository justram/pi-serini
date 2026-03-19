#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"
pi_serini_cd_root

SLICE="${SLICE:-q9}"
MODEL="${MODEL:-openai-codex/gpt-5.4-mini}"
OUTPUT_DIR="${OUTPUT_DIR:-runs/pi_bm25_${SLICE}_plain_minimal_excerpt}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-300}"
THINKING="${THINKING:-medium}"
PI_BIN="${PI_BIN:-pi}"
EXTENSION="${EXTENSION:-src/pi-search/extension.ts}"
QUERY_FILE="${QUERY_FILE:-$(pi_serini_browsecomp_plus_query_file_for_slice "$SLICE")}"
QRELS_FILE="$(pi_serini_default_qrels_file)"
PI_BM25_INDEX_PATH="$(pi_serini_default_index_path)"

printf 'SLICE=%s\n' "$SLICE"
printf 'MODEL=%s\n' "$MODEL"
printf 'QUERY_FILE=%s\n' "$QUERY_FILE"
printf 'QRELS_FILE=%s\n' "$QRELS_FILE"
printf 'OUTPUT_DIR=%s\n' "$OUTPUT_DIR"
printf 'TIMEOUT_SECONDS=%s\n' "$TIMEOUT_SECONDS"
printf 'INDEX_PATH=%s\n' "$PI_BM25_INDEX_PATH"

MODEL="$MODEL" \
QUERY_FILE="$QUERY_FILE" \
OUTPUT_DIR="$OUTPUT_DIR" \
TIMEOUT_SECONDS="$TIMEOUT_SECONDS" \
THINKING="$THINKING" \
PI_BIN="$PI_BIN" \
EXTENSION="$EXTENSION" \
QRELS_FILE="$QRELS_FILE" \
PI_BM25_INDEX_PATH="$PI_BM25_INDEX_PATH" \
PROMPT_VARIANT="plain_minimal" \
bash scripts/run_benchmark.sh
