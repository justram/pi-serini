#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

OLD_REF="${OLD_REF:-v0.1.0}"
NEW_REF="${NEW_REF:-v0.2.2}"
MODEL="${MODEL:-openai-codex/gpt-5.4-mini}"
THINKING="${THINKING:-medium}"
QUERY_SET="${QUERY_SET:-q9}"
BENCHMARK="${BENCHMARK:-browsecomp-plus}"
WORKTREE_ROOT="${WORKTREE_ROOT:-$ROOT_DIR/.worktrees/q9-clean-compare}"
RUN_ROOT="${RUN_ROOT:-$ROOT_DIR/runs/repro-q9-clean-compare}"
SKIP_SETUP="${SKIP_SETUP:-0}"

usage() {
  cat <<'EOF'
Usage: bash scripts/prepare_q9_clean_compare.sh [options]

Prepares clean detached git worktrees for two refs and prints exact benchmark
commands to rerun BrowseComp-Plus q9 under identical BM25 settings.

Options:
  --old-ref <ref>         Git ref for the older baseline (default: v0.1.0)
  --new-ref <ref>         Git ref for the newer baseline (default: v0.2.2)
  --model <model>         Benchmark model (default: openai-codex/gpt-5.4-mini)
  --thinking <level>      Model thinking setting (default: medium)
  --query-set <id>        Query set id (default: q9)
  --benchmark <id>        Benchmark id (default: browsecomp-plus)
  --worktree-root <path>  Parent dir for clean worktrees
  --run-root <path>       Parent dir for benchmark outputs
  --skip-setup            Skip npm install in prepared worktrees
  --help                  Show this help text

Environment variables with the same names are also supported.

This script is intentionally non-destructive:
- it creates detached worktrees under WORKTREE_ROOT
- it never rewrites the current checkout
- it only prints the commands needed for the actual benchmark runs
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --old-ref)
      OLD_REF="$2"
      shift 2
      ;;
    --new-ref)
      NEW_REF="$2"
      shift 2
      ;;
    --model)
      MODEL="$2"
      shift 2
      ;;
    --thinking)
      THINKING="$2"
      shift 2
      ;;
    --query-set)
      QUERY_SET="$2"
      shift 2
      ;;
    --benchmark)
      BENCHMARK="$2"
      shift 2
      ;;
    --worktree-root)
      WORKTREE_ROOT="$2"
      shift 2
      ;;
    --run-root)
      RUN_ROOT="$2"
      shift 2
      ;;
    --skip-setup)
      SKIP_SETUP=1
      shift
      ;;
    --help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

require_clean_ref() {
  local ref="$1"
  git rev-parse --verify --quiet "$ref^{commit}" >/dev/null || {
    echo "Ref does not resolve to a commit: $ref" >&2
    exit 1
  }
}

slugify() {
  printf '%s' "$1" | tr '/:@ ' '----' | tr -cs '[:alnum:]._-' '-'
}

ensure_worktree() {
  local ref="$1"
  local path="$2"

  if [[ -d "$path/.git" || -f "$path/.git" ]]; then
    local current_head
    current_head="$(git -C "$path" rev-parse HEAD)"
    local target_head
    target_head="$(git rev-parse "$ref^{commit}")"
    if [[ "$current_head" != "$target_head" ]]; then
      echo "Existing worktree at $path points to $current_head, expected $target_head for $ref." >&2
      echo "Remove it manually if you want to recreate it: git worktree remove --force '$path'" >&2
      exit 1
    fi
    return
  fi

  mkdir -p "$(dirname "$path")"
  git worktree add --detach "$path" "$ref"
}

maybe_setup_worktree() {
  local path="$1"
  if [[ "$SKIP_SETUP" == "1" ]]; then
    return
  fi

  if [[ ! -d "$ROOT_DIR/node_modules" ]]; then
    echo "Root node_modules is missing. Run 'npm install' in $ROOT_DIR first." >&2
    exit 1
  fi

  # Worktrees live under ROOT_DIR/.worktrees/..., so Node can resolve the root
  # dependency tree by walking parent directories. Still, package metadata in the
  # worktree should be in sync with the lockfile for reproducibility.
  (cd "$path" && npm install --ignore-scripts >/dev/null)
}

require_clean_ref "$OLD_REF"
require_clean_ref "$NEW_REF"

mkdir -p "$WORKTREE_ROOT" "$RUN_ROOT"

OLD_SLUG="$(slugify "$OLD_REF")"
NEW_SLUG="$(slugify "$NEW_REF")"
MODEL_SLUG="$(slugify "$MODEL")"

OLD_WORKTREE="$WORKTREE_ROOT/$OLD_SLUG"
NEW_WORKTREE="$WORKTREE_ROOT/$NEW_SLUG"
OLD_RUN_DIR="$RUN_ROOT/${QUERY_SET}_${OLD_SLUG}_${MODEL_SLUG}"
NEW_RUN_DIR="$RUN_ROOT/${QUERY_SET}_${NEW_SLUG}_${MODEL_SLUG}"

ensure_worktree "$OLD_REF" "$OLD_WORKTREE"
ensure_worktree "$NEW_REF" "$NEW_WORKTREE"
maybe_setup_worktree "$OLD_WORKTREE"
maybe_setup_worktree "$NEW_WORKTREE"

OLD_COMMIT="$(git -C "$OLD_WORKTREE" rev-parse --short HEAD)"
NEW_COMMIT="$(git -C "$NEW_WORKTREE" rev-parse --short HEAD)"

cat <<EOF
Prepared clean worktrees:
- old: $OLD_WORKTREE ($OLD_REF @ $OLD_COMMIT)
- new: $NEW_WORKTREE ($NEW_REF @ $NEW_COMMIT)

Suggested rerun commands
========================

1) Old baseline
(cd "$OLD_WORKTREE" && \
  OUTPUT_DIR="$OLD_RUN_DIR" \
  npm run run:benchmark:query-set -- \
    --benchmark "$BENCHMARK" \
    --query-set "$QUERY_SET" \
    --model "$MODEL" \
    --thinking "$THINKING" \
    --prompt-variant plain_minimal)

2) New baseline
(cd "$NEW_WORKTREE" && \
  OUTPUT_DIR="$NEW_RUN_DIR" \
  npm run run:benchmark:query-set -- \
    --benchmark "$BENCHMARK" \
    --query-set "$QUERY_SET" \
    --model "$MODEL" \
    --thinking "$THINKING" \
    --prompt-variant plain_minimal)

3) Retrieval evaluation
(cd "$OLD_WORKTREE" && npm run evaluate:retrieval -- --run-dir "$OLD_RUN_DIR")
(cd "$NEW_WORKTREE" && npm run evaluate:retrieval -- --run-dir "$NEW_RUN_DIR")

4) Optional BM25 comparison after both runs finish
(cd "$NEW_WORKTREE" && npm run compare:bm25 -- --baseline "$OLD_RUN_DIR" --candidate "$NEW_RUN_DIR" --benchmark "$BENCHMARK" --query-set "$QUERY_SET")

5) Fast sanity checks I expect you to inspect immediately
- $OLD_RUN_DIR/run_setup.json
- $NEW_RUN_DIR/run_setup.json
- $OLD_RUN_DIR/benchmark_manifest_snapshot.json
- $NEW_RUN_DIR/benchmark_manifest_snapshot.json
- per-query tool counts for 244, 549, 655, 1219

Notes
=====
- These commands preserve the same BM25 defaults as the benchmark config. They do not switch to k1=25, b=1.
- The worktrees are detached and clean, so they avoid the dirty-worktree provenance issue we saw in the degraded rerun.
- This script does not launch the expensive benchmark automatically; it prepares reproducible environments and exact commands so the run is deliberate and inspectable.
EOF
