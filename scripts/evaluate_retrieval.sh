#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

QRELS_FILE="${QRELS_FILE:-data/browsecomp-plus/qrels/qrel_evidence.txt}"
DEFAULT_SECONDARY_QRELS_FILE="data/browsecomp-plus/qrels/qrel_gold.txt"
SECONDARY_QRELS_FILE_SET="${SECONDARY_QRELS_FILE+1}"
SECONDARY_QRELS_FILE="${SECONDARY_QRELS_FILE:-}"
RUN_FILE="${RUN_FILE:-}"
RUN_DIR="${RUN_DIR:-}"
QUERY_TSV="${QUERY_TSV:-}"
WRITE_RUN_FILE="${WRITE_RUN_FILE:-}"
RECALL_CUTOFFS="${RECALL_CUTOFFS:-100,1000}"
NDCG_CUTOFFS="${NDCG_CUTOFFS:-10}"
MRR_CUTOFFS="${MRR_CUTOFFS:-10}"

if [[ -n "$RUN_FILE" && -n "$RUN_DIR" ]]; then
  echo 'Specify only one of RUN_FILE or RUN_DIR' >&2
  exit 1
fi

if [[ -z "$RUN_FILE" && -z "$RUN_DIR" ]]; then
  echo 'RUN_FILE or RUN_DIR is required' >&2
  exit 1
fi

if [[ -z "$SECONDARY_QRELS_FILE_SET" && -f "$DEFAULT_SECONDARY_QRELS_FILE" ]]; then
  SECONDARY_QRELS_FILE="$DEFAULT_SECONDARY_QRELS_FILE"
fi
if [[ -n "$SECONDARY_QRELS_FILE" && ! -f "$SECONDARY_QRELS_FILE" ]]; then
  echo "Secondary qrels file not found: $SECONDARY_QRELS_FILE" >&2
  exit 1
fi

CMD=(
  npx tsx src/eval_retrieval.ts
  --qrels "$QRELS_FILE"
  --recallCutoffs "$RECALL_CUTOFFS"
  --ndcgCutoffs "$NDCG_CUTOFFS"
  --mrrCutoffs "$MRR_CUTOFFS"
)

if [[ -n "$SECONDARY_QRELS_FILE" ]]; then
  CMD+=(--secondaryQrels "$SECONDARY_QRELS_FILE")
fi

if [[ -n "$RUN_FILE" ]]; then
  CMD+=(--runFile "$RUN_FILE")
fi

if [[ -n "$RUN_DIR" ]]; then
  CMD+=(--runDir "$RUN_DIR")
fi

if [[ -n "$QUERY_TSV" ]]; then
  CMD+=(--queries "$QUERY_TSV")
fi

if [[ -n "$WRITE_RUN_FILE" ]]; then
  CMD+=(--writeRunFile "$WRITE_RUN_FILE")
fi

printf 'Running:'
printf ' %q' "${CMD[@]}"
printf '\n'

"${CMD[@]}"
