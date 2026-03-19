#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

RUN_DIR="${RUN_DIR:-}"
DATASET="${DATASET:-browsecomp-plus}"
QRELS_FILE="${QRELS_FILE:-data/$DATASET/qrels/qrel_evidence.txt}"
DEFAULT_SECONDARY_QRELS_FILE="data/$DATASET/qrels/qrel_gold.txt"
SECONDARY_QRELS_FILE_SET="${SECONDARY_QRELS_FILE+1}"
SECONDARY_QRELS_FILE="${SECONDARY_QRELS_FILE:-}"
EVAL_SUMMARY="${EVAL_SUMMARY:-}"
AUTO_DETECT_MERGED="${AUTO_DETECT_MERGED:-1}"

if [[ -n "$RUN_DIR" && "$AUTO_DETECT_MERGED" == "1" ]]; then
  RUN_BASENAME="$(basename "$RUN_DIR")"
  if [[ -z "$EVAL_SUMMARY" && -f "$RUN_DIR/merged/evaluation_summary.json" ]]; then
    EVAL_SUMMARY="$RUN_DIR/merged/evaluation_summary.json"
  elif [[ -z "$EVAL_SUMMARY" && -f "$RUN_DIR/evaluation_summary.json" ]]; then
    EVAL_SUMMARY="$RUN_DIR/evaluation_summary.json"
  elif [[ -z "$EVAL_SUMMARY" && -f "evals/pi_judge/$RUN_BASENAME/merged/evaluation_summary.json" ]]; then
    EVAL_SUMMARY="evals/pi_judge/$RUN_BASENAME/merged/evaluation_summary.json"
  elif [[ -z "$EVAL_SUMMARY" && -f "evals/pi_judge/$RUN_BASENAME/evaluation_summary.json" ]]; then
    EVAL_SUMMARY="evals/pi_judge/$RUN_BASENAME/evaluation_summary.json"
  fi
fi

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
  npx tsx src/summarize_run.ts
  --runDir "$RUN_DIR"
  --qrels "$QRELS_FILE"
)

if [[ -n "$SECONDARY_QRELS_FILE" ]]; then
  CMD+=(--secondaryQrels "$SECONDARY_QRELS_FILE")
fi

if [[ -n "$EVAL_SUMMARY" ]]; then
  CMD+=(--evalSummary "$EVAL_SUMMARY")
fi

printf 'Running:'
printf ' %q' "${CMD[@]}"
printf '\n'

"${CMD[@]}"
