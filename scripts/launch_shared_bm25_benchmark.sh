#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"
pi_serini_cd_root
pi_serini_setup_java
pi_serini_print_java_env

HOST="${PI_BM25_RPC_HOST:-127.0.0.1}"
PORT="${PI_BM25_RPC_PORT:-50455}"
LOG_DIR="${LOG_DIR:-runs/shared-bm25}"
RUN_SCRIPT="${RUN_SCRIPT:-scripts/run_benchmark.sh}"
INDEX_PATH="$(pi_serini_default_index_path)"
RESOLVED_INDEX_PATH="$(pi_serini_resolve_path "$INDEX_PATH")"
PI_BM25_K1="${PI_BM25_K1:-0.9}"
PI_BM25_B="${PI_BM25_B:-0.4}"
PI_BM25_THREADS="${PI_BM25_THREADS:-1}"
BM25_LOG="$LOG_DIR/bm25_server.log"
mkdir -p "$LOG_DIR"

if command -v lsof >/dev/null 2>&1; then
  if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Port $PORT is already in use. Set PI_BM25_RPC_PORT to a free port or stop the existing listener." >&2
    exit 1
  fi
fi

cleanup() {
  if [[ -n "${BM25_PID:-}" ]]; then
    kill "$BM25_PID" >/dev/null 2>&1 || true
    wait "$BM25_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

echo "Starting shared BM25 RPC daemon on $HOST:$PORT"
echo "INDEX_PATH=$RESOLVED_INDEX_PATH"
echo "BM25_K1=$PI_BM25_K1"
echo "BM25_B=$PI_BM25_B"
echo "BM25_THREADS=$PI_BM25_THREADS"
bash scripts/bm25_server.sh --index-path "$RESOLVED_INDEX_PATH" --transport tcp --host "$HOST" --port "$PORT" --k1 "$PI_BM25_K1" --b "$PI_BM25_B" --threads "$PI_BM25_THREADS" >"$BM25_LOG" 2>&1 &
BM25_PID=$!

ready=0
for _ in $(seq 1 120); do
  if ! kill -0 "$BM25_PID" >/dev/null 2>&1; then
    echo "Shared BM25 RPC daemon exited before readiness. Log: $BM25_LOG" >&2
    tail -n 50 "$BM25_LOG" >&2 || true
    exit 1
  fi
  if grep -Eq '"type"[[:space:]]*:[[:space:]]*"server_ready"' "$BM25_LOG"; then
    ready=1
    break
  fi
  sleep 1
done

if [[ "$ready" != "1" ]]; then
  echo "Timed out waiting for shared BM25 RPC daemon readiness. Log: $BM25_LOG" >&2
  tail -n 50 "$BM25_LOG" >&2 || true
  exit 1
fi

echo "Shared BM25 RPC daemon ready. Log: $BM25_LOG"

PI_BM25_RPC_HOST="$HOST" \
PI_BM25_RPC_PORT="$PORT" \
bash "$RUN_SCRIPT" | tee "$LOG_DIR/run.log"
