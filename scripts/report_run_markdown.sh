#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
source "$ROOT/scripts/lib/common.sh"

BENCHMARK="$(pi_serini_default_benchmark)"
RUN_DIR="${RUN_DIR:-}"
QRELS_FILE="$(pi_serini_default_qrels_file)"
DEFAULT_SECONDARY_QRELS_FILE="$(pi_serini_default_secondary_qrels_file)"
SECONDARY_QRELS_FILE_SET="${SECONDARY_QRELS_FILE+1}"
SECONDARY_QRELS_FILE="${SECONDARY_QRELS_FILE:-}"
EVAL_SUMMARY="${EVAL_SUMMARY:-}"
OUTPUT_PATH="${OUTPUT_PATH:-}"
RECALL_CUTOFFS="${RECALL_CUTOFFS:-100,1000}"
NDCG_CUTOFFS="${NDCG_CUTOFFS:-10}"
MRR_CUTOFFS="${MRR_CUTOFFS:-10}"

if [[ -z "$RUN_DIR" ]]; then
  echo "RUN_DIR is required, e.g. RUN_DIR=runs/<run>" >&2
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
  npx tsx src/report_run_markdown.ts
  --benchmark "$BENCHMARK"
  --runDir "$RUN_DIR"
  --qrels "$QRELS_FILE"
  --recallCutoffs "$RECALL_CUTOFFS"
  --ndcgCutoffs "$NDCG_CUTOFFS"
  --mrrCutoffs "$MRR_CUTOFFS"
)

if [[ -n "$SECONDARY_QRELS_FILE" ]]; then
  CMD+=(--secondaryQrels "$SECONDARY_QRELS_FILE")
fi

if [[ -n "$EVAL_SUMMARY" ]]; then
  CMD+=(--evalSummary "$EVAL_SUMMARY")
fi

if [[ -n "$OUTPUT_PATH" ]]; then
  CMD+=(--output "$OUTPUT_PATH")
fi

printf 'Running:'
printf ' %q' "${CMD[@]}"
printf '\n'

"${CMD[@]}"
