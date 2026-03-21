#!/usr/bin/env bash

PI_SERINI_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

pi_serini_cd_root() {
  cd "$PI_SERINI_ROOT"
}

pi_serini_realpath() {
  local path="$1"
  python3 - <<'PY' "$path"
import os
import sys

print(os.path.realpath(sys.argv[1]))
PY
}

pi_serini_detect_java_home_from_path() {
  local java_bin="$1"
  local resolved_java_bin
  resolved_java_bin="$(pi_serini_realpath "$java_bin")"
  dirname "$(dirname "$resolved_java_bin")"
}

pi_serini_setup_java() {
  if [[ -z "${JAVA_HOME:-}" ]]; then
    local uname_out
    uname_out="$(uname -s 2>/dev/null || printf 'unknown')"

    if [[ "$uname_out" == "Darwin" ]] && command -v brew >/dev/null 2>&1; then
      local openjdk_prefix
      openjdk_prefix="$(brew --prefix openjdk@21 2>/dev/null || true)"
      if [[ -n "$openjdk_prefix" ]]; then
        export JAVA_HOME="$openjdk_prefix/libexec/openjdk.jdk/Contents/Home"
      fi
    fi
  fi

  if [[ -z "${JAVA_HOME:-}" ]] && command -v java >/dev/null 2>&1; then
    export JAVA_HOME="$(pi_serini_detect_java_home_from_path "$(command -v java)")"
  fi

  if [[ -n "${JAVA_HOME:-}" ]]; then
    export PATH="$JAVA_HOME/bin:$PATH"
    if [[ -z "${JVM_PATH:-}" ]]; then
      local candidate
      for candidate in \
        "$JAVA_HOME/lib/server/libjvm.dylib" \
        "$JAVA_HOME/lib/server/libjvm.so" \
        "$JAVA_HOME/jre/lib/server/libjvm.dylib" \
        "$JAVA_HOME/jre/lib/server/libjvm.so" \
        "$JAVA_HOME/jre/lib/amd64/server/libjvm.so"
      do
        if [[ -f "$candidate" ]]; then
          export JVM_PATH="$candidate"
          break
        fi
      done
    fi
  fi
}

pi_serini_print_java_env() {
  printf 'JAVA_HOME=%s\n' "${JAVA_HOME:-unset}"
  printf 'JVM_PATH=%s\n' "${JVM_PATH:-unset}"
}

pi_serini_normalize_benchmark() {
  local benchmark="${1:-}"
  benchmark="$(printf '%s' "$benchmark" | tr '[:upper:]' '[:lower:]' | tr '_' '-')"
  printf '%s' "$benchmark"
}

pi_serini_default_benchmark() {
  pi_serini_normalize_benchmark "${BENCHMARK:-browsecomp-plus}"
}

pi_serini_default_dataset() {
  case "$(pi_serini_default_benchmark)" in
    browsecomp-plus)
      printf '%s' "${DATASET:-browsecomp-plus}"
      ;;
    *)
      printf '%s' "${DATASET:-$(pi_serini_default_benchmark)}"
      ;;
  esac
}

pi_serini_default_query_set() {
  case "$(pi_serini_default_benchmark)" in
    browsecomp-plus)
      printf '%s' "${QUERY_SET:-q9}"
      ;;
    benchmark-template|msmarco-v1-passage)
      printf '%s' "${QUERY_SET:-dev}"
      ;;
    *)
      printf '%s' "${QUERY_SET:-default}"
      ;;
  esac
}

pi_serini_default_index_name() {
  case "$(pi_serini_default_benchmark)" in
    browsecomp-plus)
      printf '%s' "${INDEX_NAME:-browsecomp-plus-bm25-tevatron}"
      ;;
    msmarco-v1-passage)
      printf '%s' "${INDEX_NAME:-msmarco-v1-passage}"
      ;;
    *)
      printf '%s' "${INDEX_NAME:-$(pi_serini_default_dataset)-bm25}"
      ;;
  esac
}

pi_serini_default_query_file() {
  if [[ -n "${QUERY_FILE:-}" ]]; then
    printf '%s' "$QUERY_FILE"
    return
  fi

  local dataset benchmark query_set
  benchmark="$(pi_serini_default_benchmark)"
  dataset="$(pi_serini_default_dataset)"
  query_set="$(pi_serini_default_query_set)"
  case "$benchmark" in
    browsecomp-plus)
      printf '%s' "data/$dataset/queries/$query_set.tsv"
      ;;
    *)
      printf '%s' "data/$dataset/queries/$query_set.tsv"
      ;;
  esac
}

pi_serini_default_qrels_file() {
  local dataset
  dataset="$(pi_serini_default_dataset)"
  case "$(pi_serini_default_benchmark)" in
    browsecomp-plus)
      printf '%s' "${QRELS_FILE:-data/$dataset/qrels/qrel_evidence.txt}"
      ;;
    benchmark-template)
      printf '%s' "${QRELS_FILE:-data/$dataset/qrels/qrel_primary.txt}"
      ;;
    msmarco-v1-passage)
      printf '%s' "${QRELS_FILE:-data/$dataset/qrels/qrels.dev.txt}"
      ;;
    *)
      printf '%s' "${QRELS_FILE:-data/$dataset/qrels/qrel_evidence.txt}"
      ;;
  esac
}

pi_serini_default_secondary_qrels_file() {
  local dataset
  dataset="$(pi_serini_default_dataset)"
  case "$(pi_serini_default_benchmark)" in
    browsecomp-plus)
      printf '%s' "${SECONDARY_QRELS_FILE:-data/$dataset/qrels/qrel_gold.txt}"
      ;;
    benchmark-template)
      printf '%s' "${SECONDARY_QRELS_FILE:-data/$dataset/qrels/qrel_secondary.txt}"
      ;;
    msmarco-v1-passage)
      printf '%s' "${SECONDARY_QRELS_FILE:-}"
      ;;
    *)
      printf '%s' "${SECONDARY_QRELS_FILE:-data/$dataset/qrels/qrel_gold.txt}"
      ;;
  esac
}

pi_serini_default_ground_truth_file() {
  local dataset
  dataset="$(pi_serini_default_dataset)"
  case "$(pi_serini_default_benchmark)" in
    browsecomp-plus)
      printf '%s' "${GROUND_TRUTH:-data/$dataset/ground-truth/browsecomp_plus_decrypted.jsonl}"
      ;;
    msmarco-v1-passage)
      printf '%s' "${GROUND_TRUTH:-}"
      ;;
    *)
      printf '%s' "${GROUND_TRUTH:-data/$dataset/ground-truth/ground_truth.jsonl}"
      ;;
  esac
}

pi_serini_default_index_path() {
  local index_name
  index_name="$(pi_serini_default_index_name)"
  printf '%s' "${PI_BM25_INDEX_PATH:-indexes/$index_name}"
}

pi_serini_resolve_path() {
  local path="$1"
  if [[ "$path" = /* ]]; then
    printf '%s' "$path"
  else
    printf '%s' "$PI_SERINI_ROOT/$path"
  fi
}

pi_serini_resolve_run_root() {
  local path="$1"
  local resolved
  resolved="$(pi_serini_resolve_path "$path")"
  if [[ "$(basename "$resolved")" == "merged" ]]; then
    dirname "$resolved"
  else
    printf '%s' "$resolved"
  fi
}

pi_serini_run_manifest_snapshot_path() {
  local run_path="$1"
  local run_root
  run_root="$(pi_serini_resolve_run_root "$run_path")"
  printf '%s' "$run_root/benchmark_manifest_snapshot.json"
}

pi_serini_run_manifest_exists() {
  local run_path="$1"
  local snapshot_path
  snapshot_path="$(pi_serini_run_manifest_snapshot_path "$run_path")"
  [[ -f "$snapshot_path" ]]
}
