#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"
pi_serini_cd_root

SLICE="${SLICE:-q9}"
LOG_DIR="${LOG_DIR:-runs/shared-bm25-${SLICE}}"
RUN_SCRIPT="scripts/run_browsecomp_plus_slice_plain_minimal_excerpt.sh"

SLICE="$SLICE" LOG_DIR="$LOG_DIR" RUN_SCRIPT="$RUN_SCRIPT" bash scripts/launch_shared_bm25_benchmark.sh
