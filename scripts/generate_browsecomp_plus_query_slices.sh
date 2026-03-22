#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

exec npx tsx src/orchestration/setup_benchmark_entry.ts --benchmark browsecomp-plus --step query-slices "$@"
