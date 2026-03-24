# Changelog

## [Unreleased]

## [0.1.5] - 2026-03-23

### Fixed

- Added Ajv-backed runtime JSON validation for untrusted process-boundary payloads while keeping TypeBox as the schema authoring layer, hardening BM25 RPC responses, BM25 readiness metadata, pi JSON event lines, and extension-side BM25 search/render/read payloads against malformed or shape-mismatched JSON.
- Added focused regression coverage for malformed BM25, pi-event, and extension payloads so invalid JSON shapes now fail with explicit validation errors instead of relying on unchecked `JSON.parse(...) as T` casts.

## [0.1.4] - 2026-03-23

### Fixed

- Fixed package manifest runtime dependency classification by moving `@mariozechner/pi-coding-agent`, `@sinclair/typebox`, and `tsx` from `devDependencies` to `dependencies`, and refreshed `package-lock.json` with `npm install` so the published operator-facing commands reflect their actual runtime requirements.

## [0.1.3] - 2026-03-23

### Added

- Added explicit BM25 tuning documentation to `README.md` and `docs/running-benchmarks.md`, including the benchmark-run environment variables `PI_BM25_K1`, `PI_BM25_B`, and `PI_BM25_THREADS`, runnable examples for single-process/shared/sharded launches, and the suggested BrowseComp-Plus parameters `k1=25` and `b=1`.

## [0.1.2] - 2026-03-23

### Added

- Added explicit `benchctl` operator workflow documentation to `README.md`, including examples for benchmark listing, managed-run launch, status inspection, and the live terminal dashboard.

### Fixed

- Fixed the non-portable local `@mariozechner/pi-tui` dependency in `package.json` by replacing the sibling-checkout `file:` path with the published npm package, and refreshed `package-lock.json` via `npm install` so standalone installs no longer depend on a local `../../oss/pi-mono` layout.

## [0.1.1] - 2026-03-23

### Fixed

- Fixed the detached-process runtime test to synchronize on actual stdout/stderr file contents instead of assuming a completion marker implied output flush, eliminating an intermittent failure in `tests/runtime_process.test.ts` during push-time test runs.

## [0.1.0] - 2026-03-23

### New Features

- Benchmark-driven `pi` search-agent workflows over benchmark-scoped BM25 indexes for BrowseComp-Plus, MS MARCO v1 Passage, and the local `benchmark-template` demo benchmark.
- Agentic BM25 search through the `pi` extension surface, including search and document-reading flows over Lucene indexes.
- Shared BM25 RPC execution via the local JVM server, alongside single-process and sharded shared-daemon benchmark launch modes.
- Benchmark-aware retrieval evaluation, judge evaluation, summarization, and Markdown reporting for benchmark runs.
- Reproducible run manifests via per-run `benchmark_manifest_snapshot.json` artifacts.

### Added

- Added typed benchmark definitions, query-set-aware resolution, and benchmark setup-step resolution under `src/benchmarks/`.
- Added support for `browsecomp-plus` with query sets `q9`, `q100`, `q300`, and `qfull`.
- Added support for `msmarco-v1-passage` with query sets `dl19` and `dl20`.
- Added support for `benchmark-template` as a tiny end-to-end local benchmark for development and validation.
- Added managed preset support for operator-facing launch flows, including MS MARCO shared presets.
- Added the `pi` BM25 search extension in `src/pi-search/extension.ts`.
- Added Node.js/TypeScript-first orchestration entrypoints for benchmark setup, query-set launch, shared-BM25 launch, sharded launch, and BM25 tuning.
- Added benchmark-aware retrieval evaluation wrappers with both internal and `trec_eval`-backed execution paths.
- Added judge evaluation flows with benchmark-aware mode validation and defaults.
- Added run summarization utilities and Markdown report generation.
- Added BM25 comparison tooling and benchmark operator surfaces under `src/operator/`.
- Added benchmark-scoped setup scripts for benchmark asset preparation, local index setup, prebuilt index download, and baseline BM25 run generation.

### Changed

- Changed the repo from a BrowseComp-Plus-specific workspace into a manifest-driven, multi-benchmark control plane centered on typed benchmark registry entries.
- Changed the preferred operator-facing interface to Node.js/TypeScript package scripts under `src/orchestration/`, while preserving older shell and legacy entrypoints as compatibility surfaces.
- Changed run reproducibility to snapshot resolved benchmark identity, paths, and input hashes into benchmark manifest artifacts.
- Changed the release scope to an intentionally index-driven model where benchmark runs execute against prepared Lucene indexes; document-ingestion-first indexing workflows built around Anserini `IndexCollection` are planned next, but are not part of this release.

### Fixed

- Fixed benchmark and query-set resolution to be benchmark-aware across launch, compare, summarize, and evaluation workflows instead of relying on BrowseComp-only assumptions.
- Fixed MS MARCO support to include benchmark-aware qrels, baseline run resolution, retrieval-eval backend selection, and shared managed presets.
- Fixed run- and benchmark-level downstream tooling to prefer manifest-backed benchmark context when available, reducing ambiguity in evaluation and reporting flows.
