#!/usr/bin/env bash

PI_SERINI_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

pi_serini_cd_root() {
  cd "$PI_SERINI_ROOT"
}

pi_serini_setup_java() {
  if [[ -z "${JAVA_HOME:-}" ]]; then
    local openjdk_prefix
    openjdk_prefix="$(brew --prefix openjdk@21 2>/dev/null || true)"
    if [[ -n "$openjdk_prefix" ]]; then
      export JAVA_HOME="$openjdk_prefix/libexec/openjdk.jdk/Contents/Home"
    fi
  fi

  if [[ -n "${JAVA_HOME:-}" ]]; then
    export PATH="$JAVA_HOME/bin:$PATH"
    if [[ -z "${JVM_PATH:-}" && -f "$JAVA_HOME/lib/server/libjvm.dylib" ]]; then
      export JVM_PATH="$JAVA_HOME/lib/server/libjvm.dylib"
    fi
  fi
}

pi_serini_print_java_env() {
  printf 'JAVA_HOME=%s\n' "${JAVA_HOME:-unset}"
  printf 'JVM_PATH=%s\n' "${JVM_PATH:-unset}"
}

pi_serini_default_dataset() {
  printf '%s' "${DATASET:-browsecomp-plus}"
}

pi_serini_default_index_name() {
  printf '%s' "${INDEX_NAME:-browsecomp-plus-bm25-tevatron}"
}

pi_serini_browsecomp_plus_query_file_for_slice() {
  local slice="$1"
  case "$slice" in
    q9|q100|q300|qfull)
      printf '%s' "data/browsecomp-plus/queries/$slice.tsv"
      ;;
    *)
      printf 'Unsupported BrowseComp-Plus slice: %s\n' "$slice" >&2
      return 1
      ;;
  esac
}

pi_serini_default_query_file() {
  local dataset
  dataset="$(pi_serini_default_dataset)"
  printf '%s' "${QUERY_FILE:-data/$dataset/queries/q9.tsv}"
}

pi_serini_default_qrels_file() {
  local dataset
  dataset="$(pi_serini_default_dataset)"
  printf '%s' "${QRELS_FILE:-data/$dataset/qrels/qrel_evidence.txt}"
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
