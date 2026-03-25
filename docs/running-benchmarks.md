# Running benchmarks

This document is the operator guide for setting up assets, launching runs, using shared or sharded execution, and generating downstream artifacts.

For benchmark semantics and metric interpretation, see [evaluation.md](./evaluation.md).
For reproducibility guarantees and artifact precedence, see [reproducibility.md](./reproducibility.md).

## Preferred entrypoints

The preferred operator-facing surface is Node-first and benchmark-first:

- `npm run setup:benchmark`
- `npm run run:benchmark:query-set`
- `npm run run:benchmark:query-set:shared-bm25`
- `npm run run:benchmark:query-set:sharded-shared-bm25`
- `npm run summarize:run`
- `npm run evaluate:retrieval`
- `npm run evaluate:run`
- `npm run report:run`
- `npm run bench:tui`

In the current source layout:

- `src/orchestration/` contains the active setup/launch/tuning control plane
- `src/legacy/` contains compatibility-only low-level TypeScript entrypoints
- `src/runtime/` contains shared runtime helpers used across orchestration, evaluation, reporting, and operator surfaces

Legacy shell scripts under `scripts/` remain available as compatibility shims, especially for historical BrowseComp-Plus workflows. The older package aliases `run:benchmark:query-set:shared` and `run:benchmark:query-set:sharded` also remain available as compatibility shims, but the preferred package aliases now say explicitly when they target a shared BM25 daemon.

There are two intentional subprocess boundaries in the current architecture:

- benchmark-specific setup implementations under `scripts/benchmarks/<benchmark>/...`
- the thin JVM bootstrap script `scripts/bm25_server.sh`

That split is deliberate. Setup internals are dataset-specific bootstrap work, while Anserini BM25 launch semantics such as tuning args, transport selection, readiness parsing, and endpoint discovery are owned in typed TypeScript under `src/search-providers/anserini/`.

## Supported benchmarks

Currently registered benchmarks:

- `browsecomp-plus`
- `msmarco-v1-passage`
- `benchmark-template`

BrowseComp-Plus remains the default benchmark when `--benchmark` or `BENCHMARK` is not provided.

For a CLI-discoverable summary of benchmark ids, query sets, setup steps, judge modes, and managed presets:

```bash
npm run bench -- benchmarks
```

## Asset setup

### BrowseComp-Plus

Base setup:

```bash
npm run setup:browsecomp-plus
```

This prepares local assets such as:

- `data/browsecomp-plus/source/queries.tsv`
- `data/browsecomp-plus/source/bm25_pure.trec`
- `data/browsecomp-plus/queries/q9.tsv`
- `data/browsecomp-plus/queries/q100.tsv`
- `data/browsecomp-plus/queries/q300.tsv`
- `data/browsecomp-plus/queries/qfull.tsv`
- `data/browsecomp-plus/qrels/qrel_evidence.txt`
- `data/browsecomp-plus/qrels/qrel_gold.txt`
- `indexes/browsecomp-plus-bm25-tevatron/`
- `vendor/anserini/anserini-1.6.0-fatjar.jar`

Decrypted BrowseComp-Plus ground truth is a separate step and requires an explicit operator-provided secret:

```bash
BROWSECOMP_PLUS_CANARY='...your secret...' \
npm run setup:ground-truth:browsecomp-plus
```

That step writes:

- `data/browsecomp-plus/ground-truth/browsecomp_plus_decrypted.jsonl`

BrowseComp-Plus slice generation is code-defined in this repo. Regenerate the packaged slices with:

```bash
npm run sample:browsecomp-plus:slices
```

### MSMARCO v1 passage

```bash
npm run setup:msmarco-v1-passage
```

This prepares local assets such as:

- `data/msmarco-v1-passage/queries/dl19.tsv`
- `data/msmarco-v1-passage/queries/dl20.tsv`
- `data/msmarco-v1-passage/qrels/qrels.dl19-passage.txt`
- `data/msmarco-v1-passage/qrels/qrels.dl20-passage.txt`
- `data/msmarco-v1-passage/source/bm25_pure.dl19.trec`
- `data/msmarco-v1-passage/source/bm25_pure.dl20.trec`
- `indexes/msmarco-v1-passage/`
- `vendor/anserini/anserini-1.6.0-fatjar.jar`

`dl19` is the default query set because it is much safer for routine agent-side validation than the larger `dl20` set.

### Tiny local benchmark demo

```bash
npm run setup:benchmark -- --benchmark benchmark-template
```

This generates a small fully local benchmark path for end-to-end validation without external dataset downloads.

Setup dispatch is Node-first through `src/orchestration/setup_benchmark_entry.ts`, but the benchmark-specific implementation still runs through the benchmark's own setup script. That keeps the operator surface standardized without pretending that asset bootstrap is generic when it is not.

## Launching runs

### Generic single-process run

MSMARCO example:

```bash
BENCHMARK=msmarco-v1-passage \
QUERY_SET=dl19 \
MODEL=openai-codex/gpt-5.4-mini \
npm run run:benchmark:query-set
```

Tiny local demo example:

```bash
BENCHMARK=benchmark-template \
QUERY_SET=test \
MODEL=openai-codex/gpt-5.4-mini \
npm run run:benchmark:query-set
```

### Shared BM25 daemon

Use this when multiple benchmark workers should reuse one BM25 server:

```bash
BENCHMARK=browsecomp-plus \
QUERY_SET=q9 \
MODEL=openai-codex/gpt-5.4-mini \
PI_BM25_RPC_PORT=50455 \
npm run run:benchmark:query-set:shared-bm25
```

The active orchestration layer starts BM25 through typed helpers in `src/search-providers/anserini/bm25_server_process.ts`. Those helpers still invoke `scripts/bm25_server.sh`, but only as a thin JVM/bootstrap boundary. Shell no longer owns BM25 orchestration semantics.

### Sharded shared-daemon run

Use this for larger query sets:

```bash
BENCHMARK=browsecomp-plus \
QUERY_SET=q100 \
SHARD_COUNT=4 \
MODEL=openai-codex/gpt-5.4-mini \
npm run run:benchmark:query-set:sharded-shared-bm25
```

By default, sharded runs split the query TSV, launch one worker per shard against a shared BM25 daemon, merge per-query artifacts under `merged/`, and summarize the merged run.

Sharded run roots typically contain:

- `shard-queries/`
- `shard-runs/`
- `merged/`
- `logs/`

Both Node-first entrypoints and legacy shims accept either the run root or the inner `merged/` directory for downstream summarize/eval/report commands.

## BM25 tuning during benchmark runs

The benchmark launchers accept BM25 tuning through environment variables:

- `PI_BM25_K1` — default `0.9`
- `PI_BM25_B` — default `0.4`
- `PI_BM25_THREADS` — default `1`

These values are consumed by the BM25 server/process startup helpers and are also recorded into run metadata for reproducibility.

### Manual BM25 tuning overrides

Single-process example:

```bash
PI_BM25_K1=0.82 \
PI_BM25_B=0.68 \
BENCHMARK=msmarco-v1-passage \
QUERY_SET=dl19 \
MODEL=openai-codex/gpt-5.4-mini \
npm run run:benchmark:query-set
```

Shared-daemon example:

```bash
PI_BM25_K1=0.82 \
PI_BM25_B=0.68 \
PI_BM25_THREADS=4 \
BENCHMARK=browsecomp-plus \
QUERY_SET=q9 \
MODEL=openai-codex/gpt-5.4-mini \
npm run run:benchmark:query-set:shared-bm25
```

Sharded shared-daemon example:

```bash
PI_BM25_K1=0.82 \
PI_BM25_B=0.68 \
PI_BM25_THREADS=4 \
BENCHMARK=browsecomp-plus \
QUERY_SET=q100 \
SHARD_COUNT=4 \
MODEL=openai-codex/gpt-5.4-mini \
npm run run:benchmark:query-set:sharded-shared-bm25
```

### Suggested BrowseComp-Plus parameters

For BrowseComp-Plus, the suggested BM25 parameters are:

- `PI_BM25_K1=25`
- `PI_BM25_B=1`

Example:

```bash
PI_BM25_K1=25 \
PI_BM25_B=1 \
BENCHMARK=browsecomp-plus \
QUERY_SET=q9 \
MODEL=openai-codex/gpt-5.4-mini \
npm run run:benchmark:query-set:shared-bm25
```

### Systematic tuning

If you want to search over a grid of BM25 parameters instead of setting `k1` and `b` manually, use the tuning entrypoint:

```bash
npm run tune:bm25
```

The tuning workflow supports explicit `--k1` and `--b` grids and benchmark-aware defaults; see the CLI help for the full surface:

```bash
npx tsx src/orchestration/tune_bm25.ts --help
```

## Artifact layout

### `runs/`

Single-run roots are benchmark-aware by manifest content rather than by a required global directory hierarchy. In practice a run root commonly contains:

- `<run>/benchmark_manifest_snapshot.json`
- `<run>/run_setup.json`
- `<run>/<query_id>.json`
- `<run>/raw-events/`
- `<run>/stderr/`
- `<run>/report.md`
- `<run>/report_assets/`

Sharded run roots typically add orchestration-specific directories around the merged result:

- `<run>/shard-queries/`
- `<run>/shard-runs/`
- `<run>/merged/`
- `<run>/logs/`

The important invariant is not the outer folder name alone; it is that the run root contains `benchmark_manifest_snapshot.json`, and downstream tools use that snapshot to recover benchmark identity and benchmark-scoped defaults.

### `evals/`

Evaluation outputs are benchmark-namespaced where cross-run collisions matter:

- judge evaluation:
  - `evals/pi_judge/<benchmark>/<run-relative-path>/evaluation_summary.json`
  - `evals/pi_judge/<benchmark>/<run-relative-path>/per-query/...`
  - `evals/pi_judge/<benchmark>/<run-relative-path>/raw-events/...`
- retrieval summaries:
  - `evals/retrieval/<benchmark>/<source-relative-path>.summary.json`

For sharded runs, judge evaluation preserves the run-relative nesting and may target the merged result under:

- `evals/pi_judge/<benchmark>/<run-relative-path>/merged/evaluation_summary.json`

Markdown report assets are scoped to the report output path itself. The default report writes to `<run>/report.md`, so the default assets land under `<run>/report_assets/`. If you choose a custom output path such as `<run>/custom-summary.md`, the assets move with it to `<run>/custom-summary_assets/`.

## Explicit overrides

You can still point the agent at a custom dataset or index layout by overriding specific inputs explicitly:

```bash
QUERY_FILE=data/my-dataset/queries/dev.tsv \
QRELS_FILE=data/my-dataset/qrels/qrel_evidence.txt \
PI_BM25_INDEX_PATH=indexes/my-dataset-bm25-v1 \
OUTPUT_DIR=runs/my_dataset_dev_gpt54mini \
MODEL=openai-codex/gpt-5.4-mini \
npm run run:benchmark:query-set
```

Explicit operator overrides take precedence over both benchmark defaults and run-manifest inference.

## BrowseComp compatibility wrappers

The old BrowseComp-Plus helper surface still exists for compatibility:

- `npm run run:browsecomp-plus:slice`
- `npm run run:browsecomp-plus:slice:shared`
- `npm run run:browsecomp-plus:slice:sharded`
- `npm run run:q9`
- `npm run run:q9:shared`

Examples:

```bash
SLICE=q100 MODEL=openai-codex/gpt-5.4-mini \
  bash scripts/run_browsecomp_plus_slice_plain_minimal_excerpt.sh

SLICE=q300 MODEL=openai-codex/gpt-5.4-mini \
  bash scripts/launch_browsecomp_plus_slice_plain_minimal_excerpt_shared_server.sh

SLICE=qfull SHARD_COUNT=4 MODEL=openai-codex/gpt-5.4-mini \
  bash scripts/launch_browsecomp_plus_slice_plain_minimal_excerpt_sharded_shared_server.sh
```

The q9 wrapper remains a thin preset wrapper around the generic launchers.

## Shard retry controls

Sharded retry behavior is configurable:

- `MAX_SHARD_ATTEMPTS` — total attempts per shard, including the initial run. Default: `2`.
- `SHARD_RETRY_MODE=auto` — retry failed shard workers immediately.
- `SHARD_RETRY_MODE=manual` — pause and require explicit approval before retrying failed shards.

Examples:

```bash
MAX_SHARD_ATTEMPTS=2 SHARD_RETRY_MODE=auto \
SLICE=q100 SHARD_COUNT=4 MODEL=openai-codex/gpt-5.4-mini \
  bash scripts/launch_browsecomp_plus_slice_plain_minimal_excerpt_sharded_shared_server.sh

MAX_SHARD_ATTEMPTS=2 SHARD_RETRY_MODE=manual \
SLICE=q100 SHARD_COUNT=4 MODEL=openai-codex/gpt-5.4-mini \
  bash scripts/launch_browsecomp_plus_slice_plain_minimal_excerpt_sharded_shared_server.sh
```

When manual retry is enabled, control files are written under `<run>/_control/`:

- `shard_retry_request.json`
- `shard_retry_approval.json`

## Summarize, evaluate, and report

Summarize a run:

```bash
RUN_DIR=runs/<run> npm run summarize:run
```

Retrieval evaluation:

```bash
RUN_DIR=runs/<run> npm run evaluate:retrieval
```

Judge evaluation:

```bash
INPUT_DIR=runs/<run> npm run evaluate:run
```

Generate a Markdown report:

```bash
RUN_DIR=runs/<run> npm run report:run
```

For BrowseComp-Plus gold-answer judge eval, prepare benchmark ground truth first:

```bash
npm run setup:ground-truth:browsecomp-plus
```

## Benchmark monitor and supervisor

Text status view:

```bash
npm run bench:status
```

Supervisor-managed runs:

```bash
npm run bench:managed
```

Launch a managed run:

```bash
npm run bench -- run --preset q9_shared --model openai-codex/gpt-5.4-mini
```

Managed presets can also be benchmark-qualified when needed:

```bash
npm run bench -- run --preset browsecomp-plus/qfull_sharded --model openai-codex/gpt-5.4-mini --shards 8
```

Queue instead of starting immediately:

```bash
npm run bench -- run --preset q9_shared --model openai-codex/gpt-5.4-mini --queue
```

Live TUI dashboard:

```bash
npm run bench:tui
```

Current monitor/TUI surfaces expose benchmark identity, progress, BM25 server state, coverage, accuracy when present, and pending shard retry approval for supervisor-managed sharded runs.

## Prompt dumps

Prompt dumps are off by default. To capture the effective system prompt and first user prompt for a run:

```bash
PI_SEARCH_DUMP_PROMPTS=1 bash scripts/launch_q9_plain_minimal_excerpt_shared_server.sh
```

## Typical outputs

Run artifacts typically include:

- `benchmark_manifest_snapshot.json` — resolved benchmark condition
- `run_setup.json` — structured persisted run setup for report-time reproducibility
- `<query_id>.json` — normalized per-query result
- `raw-events/<query_id>.jsonl` — raw `pi` event stream
- `stderr/<query_id>.log` — per-query stderr
- `prompt-dumps/` — only when prompt dumping is enabled

Benchmark-aware downstream artifacts typically include:

- `runs/<run>/...`
- `runs/<run>/merged/...` for merged sharded artifacts
- `evals/pi_judge/<benchmark>/<run>/...` for judge-eval outputs
- `evals/retrieval/<benchmark>/<source-relative-path>.summary.json` for normalized retrieval summaries

## Git safety for local artifacts

Do not track generated benchmark content under:

- `data/`
- `runs/`
- `evals/`
- `indexes/`
- `scratch/`

Recommended hook setup:

```bash
git config core.hooksPath .githooks
chmod +x .githooks/pre-commit .githooks/pre-push scripts/check_no_sensitive_tracking.sh
```

You can also run the staged-file safety check manually:

```bash
npm run prek
```
