#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

QUERIES_FILE="${QUERIES_FILE:-data/browsecomp-plus/queries/q9.tsv}"
QRELS_FILE="${QRELS_FILE:-data/browsecomp-plus/qrels/qrel_evidence.txt}"
DEFAULT_SECONDARY_QRELS_FILE="data/browsecomp-plus/qrels/qrel_gold.txt"
SECONDARY_QRELS_FILE_SET="${SECONDARY_QRELS_FILE+1}"
SECONDARY_QRELS_FILE="${SECONDARY_QRELS_FILE:-}"
INDEX_PATH="${INDEX_PATH:-indexes/browsecomp-plus-bm25-tevatron}"
ANSERINI_JAR="${ANSERINI_JAR:-vendor/anserini/anserini-1.6.0-fatjar.jar}"
OUTPUT_DIR="${OUTPUT_DIR:-}"
METRIC="${METRIC:-ndcg_cut_10}"
NDCG_CUTOFF="${NDCG_CUTOFF:-10}"
RECALL_CUTOFF="${RECALL_CUTOFF:-1000}"
K1_GRID="${K1_GRID:-0.3:1.5:0.1}"
B_GRID="${B_GRID:-0.0:1.0:0.05}"
HITS="${HITS:-1000}"
THREADS="${THREADS:-8}"
TOPIC_READER="${TOPIC_READER:-TsvString}"
TOP_K="${TOP_K:-10}"
KEEP_RUNS="${KEEP_RUNS:-0}"

if [[ -z "$SECONDARY_QRELS_FILE_SET" && -f "$DEFAULT_SECONDARY_QRELS_FILE" ]]; then
  SECONDARY_QRELS_FILE="$DEFAULT_SECONDARY_QRELS_FILE"
fi
if [[ -n "$SECONDARY_QRELS_FILE" && ! -f "$SECONDARY_QRELS_FILE" ]]; then
  echo "Secondary qrels file not found: $SECONDARY_QRELS_FILE" >&2
  exit 1
fi

CMD=(
  npx tsx src/tune_bm25.ts
  --queries "$QUERIES_FILE"
  --qrels "$QRELS_FILE"
  --index "$INDEX_PATH"
  --anseriniJar "$ANSERINI_JAR"
  --metric "$METRIC"
  --ndcgCutoff "$NDCG_CUTOFF"
  --recallCutoff "$RECALL_CUTOFF"
  --k1 "$K1_GRID"
  --b "$B_GRID"
  --hits "$HITS"
  --threads "$THREADS"
  --topicReader "$TOPIC_READER"
  --top "$TOP_K"
)

if [[ -n "$SECONDARY_QRELS_FILE" ]]; then
  CMD+=(--secondaryQrels "$SECONDARY_QRELS_FILE")
fi

if [[ -n "$OUTPUT_DIR" ]]; then
  CMD+=(--outputDir "$OUTPUT_DIR")
fi

if [[ "$KEEP_RUNS" == "1" ]]; then
  CMD+=(--keepRuns)
fi

printf 'Running:'
printf ' %q' "${CMD[@]}"
printf '\n'

"${CMD[@]}"
