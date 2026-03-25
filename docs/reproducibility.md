# Reproducibility

This document explains what information is frozen into run artifacts, how downstream tools resolve benchmark metadata, and which local assets are expected to exist after benchmark setup.

For operator commands, see [running-benchmarks.md](./running-benchmarks.md).
For retrieval and judge semantics, see [evaluation.md](./evaluation.md).

## Benchmark condition packaged here

The repo is benchmark-manifest-driven, but it still ships with one primary packaged default condition:

- benchmark: `browsecomp-plus`
- prompt variant: `plain_minimal`
- BM25 tool mode: `plain`
- preview mode: `plain_excerpt`
- default sampled query slice: `data/browsecomp-plus/queries/q9.tsv`
- additional generated slices: `q100.tsv`, `q300.tsv`, `qfull.tsv`
- evidence qrels: `data/browsecomp-plus/qrels/qrel_evidence.txt`
- gold qrels: `data/browsecomp-plus/qrels/qrel_gold.txt`
- default prebuilt index: `indexes/browsecomp-plus-bm25-tevatron/`

BrowseComp-Plus remains the default benchmark when no explicit benchmark override is provided.

## Asset bootstrap

The repo includes dedicated benchmark bootstrap paths:

```bash
npm run setup:browsecomp-plus
npm run setup:msmarco-v1-passage
```

BrowseComp-Plus decrypted ground truth is intentionally a separate setup step and now requires an explicit operator-provided `BROWSECOMP_PLUS_CANARY` value. The decryption secret is no longer baked into tracked source.

By default, setup prepares benchmark-scoped local assets such as:

- qrels
- query files and generated query slices
- optional ground-truth files
- prebuilt BM25 indexes
- the Anserini fatjar
- benchmark-scoped baseline BM25 runs when the benchmark setup defines them

Setup dispatch is standardized through `src/orchestration/setup_benchmark_entry.ts`, but the implementation for each benchmark still lives behind its own script under `scripts/benchmarks/<benchmark>/...`. That is intentional: the control plane is generic, but the bootstrap work remains benchmark-scoped and reproducibility-sensitive. Those benchmark scripts are expected to be directly executable repo assets, because the active TypeScript entrypoint launches them directly instead of invoking `bash <script>`.

An important BrowseComp-Plus nuance:

- `q9`, `q100`, `q300`, and `qfull` are repo-defined slices generated locally by this repo's code
- they are not upstream Tevatron dataset artifacts
- the Tevatron dependency is for the underlying benchmark assets and prebuilt BM25 index distribution, not for the slice definitions themselves

## Run-manifest snapshots

Each run now writes a benchmark snapshot to:

- `<run>/benchmark_manifest_snapshot.json`

That file freezes the resolved benchmark condition used for the run, including fields such as:

- `benchmark_id`
- `benchmark_display_name`
- `dataset_id`
- `query_set_id`
- `prompt_variant`
- `query_path`
- `qrels_path`
- `secondary_qrels_path`
- `ground_truth_path`
- `index_path`
- `input_hashes`
  - `query`
  - `qrels`
  - `secondary_qrels` when present
  - `ground_truth` when present
- `git_commit`
- `git_commit_short`

`input_hashes` records SHA-256 digests and byte sizes for the critical benchmark input files when they exist at run creation time. That strengthens provenance beyond path capture alone: if a local qrels or query file later changes in place, the old run snapshot still preserves the content identity the run saw. Index directories are not recursively hashed in this batch; index provenance still comes from the resolved index path plus benchmark/setup provenance.

This snapshot is the primary reproducibility anchor for downstream summarize/eval/report tooling.

## Structured run setup metadata

Each new run also writes:

- `<run>/run_setup.json`

This persists structured launch/setup details such as:

- query set / slice
- model
- query file
- qrels file
- total queries
- timeout seconds
- index path
- BM25 settings
- shard-related launch settings when present

This matters because reproducibility metadata should not depend only on launcher logs.
Reports now prefer `run_setup.json` and use legacy `logs/run.log` only as a fallback.

For older runs created before `run_setup.json` existed, reports reconstruct what they can from the run manifest and query artifacts, but they do not invent unavailable setup values.

## Resolution precedence

Downstream tooling resolves benchmark metadata in this order:

1. explicit operator overrides
2. the run-manifest snapshot when present
3. current benchmark registry defaults in `src/benchmarks/`

In the current source layout, the active run/setup/tuning entrypoints live under `src/orchestration/`, compatibility-only low-level entrypoints live under `src/legacy/`, and shared runtime helpers such as prompt construction, artifact-path resolution, and isolated agent-dir handling live under `src/runtime/`.

This precedence is important because historical runs should keep their original benchmark condition even if repo defaults later change.

## Local asset layout

Benchmark-scoped local assets typically live under:

- `data/<dataset>/queries/...`
- `data/<dataset>/qrels/...`
- `data/<dataset>/ground-truth/...`
- `indexes/<index-name>/`
- `vendor/anserini/...`

Examples currently supported by the repo:

- `browsecomp-plus`
  - `data/browsecomp-plus/queries/q9.tsv`
  - `data/browsecomp-plus/queries/q100.tsv`
  - `data/browsecomp-plus/queries/q300.tsv`
  - `data/browsecomp-plus/queries/qfull.tsv`
  - `data/browsecomp-plus/qrels/qrel_evidence.txt`
  - `data/browsecomp-plus/qrels/qrel_gold.txt`
  - `data/browsecomp-plus/ground-truth/browsecomp_plus_decrypted.jsonl` after explicit `BROWSECOMP_PLUS_CANARY`-backed ground-truth setup
  - `indexes/browsecomp-plus-bm25-tevatron/`
- `msmarco-v1-passage`
  - `data/msmarco-v1-passage/queries/dl19.tsv`
  - `data/msmarco-v1-passage/queries/dl20.tsv`
  - `data/msmarco-v1-passage/qrels/qrels.dl19-passage.txt`
  - `data/msmarco-v1-passage/qrels/qrels.dl20-passage.txt`
  - `data/msmarco-v1-passage/source/bm25_pure.dl19.trec`
  - `data/msmarco-v1-passage/source/bm25_pure.dl20.trec`
  - `indexes/msmarco-v1-passage/`

Only code and setup logic are intended to remain tracked.
Downloaded assets, local benchmark outputs, indexes, and runtime jars remain local and ignored by default.

## JVM execution model

The BM25 backend is implemented as a small Java RPC server under:

- `jvm/src/main/java/dev/jhy/piserini/Bm25Server.java`

It is compiled on demand by:

- `scripts/build_bm25_server.sh`

and launched by:

- `scripts/bm25_server.sh`

The important architectural boundary is that BM25 launch semantics are owned in typed TypeScript under `src/bm25/bm25_server_process.ts`, which decides transport mode, tuning args, readiness handling, and endpoint discovery. The shell script remains only a thin JVM/bootstrap implementation detail so the runtime stays independent of `pyserini`.

## Index and dataset reuse

The retrieval agent and BM25 server are not tied to a single packaged dataset/index pair.

You can override:

- `QUERY_FILE`
- `QRELS_FILE`
- `PI_BM25_INDEX_PATH`

to reuse the same workflow with another compatible prebuilt Anserini/Lucene index and benchmark-specific inputs.

If you want to replace the bundled backend entirely, see [bm25-extension-interface.md](./bm25-extension-interface.md).

## Result format

Each run writes one normalized JSON file per query, stores raw event traces separately, and snapshots benchmark metadata into the run root so later analysis does not depend on mutable shell defaults.

Typical benchmark-aware artifact layout now looks like:

- `runs/<run>/benchmark_manifest_snapshot.json`
- `runs/<run>/run_setup.json`
- `runs/<run>/<query_id>.json`
- `runs/<run>/raw-events/...`
- `runs/<run>/stderr/...`
- `runs/<run>/report.md`
- `runs/<run>/report_assets/...`
- `runs/<run>/merged/...` for merged sharded artifacts
- `evals/pi_judge/<benchmark>/<run-relative-path>/...` for judge-eval outputs
- `evals/retrieval/<benchmark>/<source-relative-path>.summary.json` for normalized retrieval summaries

Judge-eval output paths preserve the run-relative nesting under `runs/` so managed or nested run layouts do not collapse into one flat eval namespace. Retrieval-summary output now also preserves source-relative nesting instead of flattening everything to a basename, so same-benchmark files like `a/run.trec` and `b/run.trec` no longer collide. Report assets are scoped to the report output path: by default that means `<run>/report_assets/`, but a custom report output like `<run>/custom-summary.md` writes sibling assets to `<run>/custom-summary_assets/`.

## Provenance in reports

Reports now distinguish between two separate provenance facts:

- `Run commit` — the commit captured in the run artifact when the run was created
- `Report commit` — the current checkout used when the report was generated

Older runs that predate stored run commit fields will only show report-time provenance unless the run artifact already captured run-time commit metadata.

## Prompt normalization

The `pi-search` extension strips benchmark-irrelevant prompt sections before each turn:

- the pi docs block
- the repo project-context block

The extension keeps the generic pi scaffold plus the `pi-search` retrieval instructions used for benchmark runs.

## Local-only artifact safety

Generated benchmark content should stay out of git.
In particular, do not track real content under:

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

## Artifact sharing caveat

The old credential-copy issue in the run and eval artifact trees has been addressed by moving isolated PI agent state into temporary runtime directories outside `runs/` and `evals/`.

That said, benchmark artifacts should still be reviewed before sharing or archiving because they can contain sensitive benchmark content, prompts, model outputs, stderr logs, or prompt dumps depending on how the run was executed.

In practice:

- copied compatibility auth files now live in temporary isolated agent directories, not under `runs/` or `evals/`
- `prompt-dumps/` may still contain sensitive prompt material when prompt dumping is enabled
- `stderr/` and raw event traces may still contain operator- or provider-relevant details worth reviewing before distribution
