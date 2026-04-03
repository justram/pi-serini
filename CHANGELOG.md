# Changelog

## [Unreleased]

## [0.2.3] - 2026-04-03

### Added

- Added explicit document-visibility tiers for benchmark runs and downstream analysis: `surfaced_docids` for the full system-exposed retrieval pool, `previewed_docids` for result-page items actually shown to the model, and `agent_docids` for the union of documents the agent opened or cited. The benchmark runner, judge evaluation, run summarization, and Markdown reports now surface these tiers so retrieval diagnostics can distinguish hidden top-k availability from model-visible evidence and agent behavior.

### Changed

- Reconnected BM25 helper-side preview rendering to the active `pi-search` Anserini adapter, so `search(...)` once again hydrates top BM25 hits with cheap title/excerpt previews instead of showing only `docid`, score, and the fallback “No snippet available from this backend” message. This restores meaningful result-page visibility for the agent on the BM25 path without requiring extra `read_document(...)` calls just to understand top-ranked hits.
- Moved the repo-local Anserini integration stack from `src/bm25/` to `src/search-providers/anserini/`, keeping the package-owned `pi-search` adapter surface separate from provider-owned transport/process construction and updating docs/tests to reflect the clearer provider boundary. (commit `82e51cd`)
- Changed retrieval-evaluation/report wording from the ambiguous legacy "agent-set" framing toward explicit surfaced/previewed/agent-behavior semantics while retaining compatibility aliases for older run artifacts and downstream consumers.

## [0.2.2] - 2026-03-23

### Added

- Added small stable machine-readable metadata to `pi-search` protocol errors under `src/pi-search/protocol/errors.ts`, including `code`, `toolName`, `target`, `schemaName`, and `fieldPath`, while keeping the existing repair-friendly human-readable error messages intact. (commit `8b921cd`)
- Added structured `pi-search` failure metadata extraction and benchmark-harness artifact support so recoverable extension failures can carry machine-readable classification alongside the existing human-readable benchmark evidence text when metadata is present. (commit `6055b5f`)
- Added a whole-tree regression guard in `tests/pi-search/extension.test.ts` that fails if package-owned `src/pi-search/` modules import repo-owned `src/` layers such as `bm25/`, `orchestration/`, `evaluation/`, `operator/`, `benchmarks/`, or `extensions/`. (commit `1747747`)

### Changed

- Restored `src/pi-search/extension.ts` as the package-owned `pi-search` extension registration layer and moved the repo-local BM25 composition seam into the thin wrapper `src/extensions/pi_search.ts`, so standalone `pi-search` ownership no longer depends directly on in-repo BM25 transport wiring. (commit `068c468`)
- Moved the shared JSONL stream helper from fake `pi-search` ownership to `src/runtime/jsonl.ts`, keeping BM25 transport code and orchestration readers on a neutral runtime primitive instead of a future package boundary. (commit `068c468`)
- Changed `src/pi-search/protocol/parse.ts` to attach structured protocol error metadata for malformed JSON and schema-invalid payloads, so future harness or package consumers can classify failures without parsing prose. (commit `8b921cd`)
- Renamed the package-owned prompt-dump env gate from `PI_BM25_DUMP_PROMPTS` to `PI_SEARCH_DUMP_PROMPTS`, so the `pi-search` prompt policy no longer advertises BM25 ownership in its backend-agnostic extension layer. (commit `0fd5949`)
- Changed the package-owned Anserini adapter seam to depend on a `pi-search`-owned narrow helper transport interface instead of importing the repo-owned BM25 RPC client type directly, so the adapter can move with `pi-search` cleanly if package extraction happens later. (commit `04e2ac0`)

### Fixed

- Updated current maintainer-facing docs to match the new ownership split, including `docs/pi-search-contract.md`, `docs/bm25-extension-interface.md`, and `docs/reproducibility.md`, so the repo-local wrapper is no longer described as the product-owned extension implementation. (commit `068c468`)

## [0.2.1] - 2026-03-23

### Added

- Added a generic `http-json` searcher adapter under `src/pi-search/searcher/adapters/http_json/adapter.ts`, plus explicit extension config support for selecting HTTP-backed `pi-search` backends alongside the existing Anserini BM25 and mock adapters.
- Added benchmark-harness regression coverage proving that `pi-serini` validates HTTP-backed `pi-search` behavior across the full tool surface, including recoverable `search`, `read_search_results`, and `read_document` failures as well as successful structured-result flows.

### Changed

- Changed the `pi-search` extension surface to be backend-agnostic in its tool labels, descriptions, spill-directory naming, and runtime log prefixes so the top-level product contract no longer implies BM25 ownership when other backend kinds are configured.
- Changed maintainer-facing contract documentation in `docs/pi-search-contract.md` to reflect the current `searcher/` subsystem layout, explicit backend config ownership, and the benchmark-validated HTTP-backed adapter path.

### Fixed

- Fixed HTTP-backed `pi-search` response handling so successful `2xx` responses are parsed through the shared searcher-contract parsers, preserving distinct error classes for malformed JSON, schema-invalid payloads, and backend execution failures instead of collapsing them into generic invalid-response behavior.

## [0.2.0] - 2026-03-23

### Added

- Added a dedicated `pi-search` protocol contract layer under `src/pi-search/protocol/`, including TypeBox-authored schemas, a shared Ajv runtime, explicit protocol error types, schema-backed payload parsers, and contract helpers for benchmark-harness consumers.
- Added focused regression coverage for the extracted `pi-search` contract surface, including protocol parser tests, helper/spill module tests, repair-friendly tool failure tests, contract-detail extraction tests, and benchmark-runner integration coverage for recoverable extension failures.
- Added maintainer-facing contract ownership documentation in `docs/pi-search-contract.md`, documenting that `pi-search` owns the standalone extension contract while `pi-serini` acts as the benchmark-backed validation harness around it.

### Changed

- Changed `src/pi-search/extension.ts` from a single mixed-responsibility module into a composition root over extracted `pi-search` subsystems for protocol validation, helper runtime ownership, prompt policy, spill management, cached search state, and tool handlers.
- Changed `pi-serini` benchmark execution to consume `pi-search`-owned structured result details instead of re-deriving active `pi-search` search docids from rendered tool output, keeping extension contract knowledge under `src/pi-search/`.
- Changed the benchmark runner to record recoverable `pi-search` tool failures as explicit benchmark evidence and to count them in per-query stats without collapsing successful agent recovery into a generic runtime crash.

### Fixed

- Fixed `pi-search` tool failure feedback to be more repairable in the agent loop by distinguishing malformed JSON, invalid tool-result shape, semantic argument mistakes, and tool execution failures for the initial search/read failure paths.

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
