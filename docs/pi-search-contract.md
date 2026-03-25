# `pi-search` contract ownership

This document defines the `v0.2.0` ownership boundary between the standalone `pi-search` extension contract and the surrounding `pi-serini` benchmark harness.

## Why this exists

`pi-search` is intended to be shippable as a standalone extension. That means its tool/protocol contract must be owned inside `src/pi-search/`, not scattered across benchmark runner code.

`pi-serini` then acts as the benchmark-backed validation loop around that contract:

- it runs benchmark workloads through `pi-search`
- it records failures as benchmark evidence
- it evaluates whether the agent loop recovered or degraded
- it should not become the source of truth for the extension contract itself

## Ownership boundary

### `pi-search` owns

Anything that defines or validates the standalone extension contract belongs under `src/pi-search/`.

That includes:

- tool parameter schemas
- tool result schemas
- protocol parser/validator setup
- protocol error types
- extension-facing repairable error wording
- helper/runtime wiring needed by the extension implementation
- tool handler behavior and extension-local retrieval state

Current ownership layout:

- `src/pi-search/protocol/`
  - `ajv.ts`
  - `errors.ts`
  - `parse.ts`
  - `schemas.ts`
  - `tool_result_details.ts`
- `src/pi-search/searcher/`
  - `contract/`
  - `adapters/`
  - `runtime.ts`
- `src/pi-search/agent_prompt.ts`
- `src/pi-search/extension.ts`
  - package-owned extension registration/composition
  - accepts injected backend creation instead of importing repo-local BM25 wiring
- `src/pi-search/prompt_policy.ts`
- `src/pi-search/search_cache.ts`
- `src/pi-search/spill.ts`
- `src/pi-search/tool_handlers.ts`
- `src/pi-search/tool_types.ts`
- `src/pi-search/config.ts`

### `pi-serini` owns

Anything that measures, records, or evaluates the extension in benchmark runs belongs outside `src/pi-search/`.

That includes:

- benchmark orchestration
- query/run lifecycle management
- run artifact writing
- recall/evaluation/reporting logic
- benchmark-visible classification of extension failures
- judge evaluation over finalized benchmark artifacts
- repo-local extension entry wrappers that compose `pi-search` with in-repo integration layers

Current main consumers / wrappers:

- `src/extensions/pi_search.ts`
  - thin repo-local wrapper that injects `src/search-providers/anserini/pi_search_backend_factory.ts` into the package-owned `src/pi-search/extension.ts`
- `src/orchestration/run_pi_benchmark.ts`
- `src/evaluation/evaluate_run_with_pi.ts`
- downstream summarize/evaluate/report modules

## Current validated state

The recent refactor and harness work established a stronger concrete contract than the original `v0.2.0` extraction phase alone.

`pi-search` now has:

- a scoped retrieval subsystem under `src/pi-search/searcher/`
- more than one adapter implementation:
  - `anserini-bm25`
  - `mock`
  - `http-json`
- explicit extension-owned backend config in `src/pi-search/config.ts`
- a backend-agnostic top-level extension surface
- boundary validation for HTTP-backed responses using the shared searcher contract parsers

`pi-serini` now has benchmark-harness regression coverage proving that it validates the stable `pi-search` contract rather than backend-specific rendered text.

In particular, the harness now has explicit coverage for HTTP-backed `pi-search` behavior across the full user-facing tool surface:

- `search`
  - recoverable backend execution failure
  - malformed successful payload
  - successful structured `retrievedDocids` flow
- `read_search_results`
  - recoverable argument failure
  - successful structured `retrievedDocids` flow
- `read_document`
  - recoverable not-found failure
  - successful output preservation

That means the current architecture is not only schema-defined; it is benchmark-validated through a real service-shaped backend path.

## Contract consumption rule

When `pi-serini` needs to understand `pi-search` output, it should consume a `pi-search`-owned helper or typed detail structure rather than reverse-engineering rendered tool text.

Good:

- consume `result.details.retrievedDocids` through `src/pi-search/protocol/tool_result_details.ts`
- rely on benchmark artifact fields already produced by the runner, such as `retrieved_docids`

Bad:

- parsing rendered search output text in `pi-serini` to rediscover docids
- duplicating tool result schemas in benchmark runner code
- introducing new `pi-search`-specific payload readers under `src/orchestration/` or `src/evaluation/`

## Schema placement rules

Use these rules when adding new `pi-search` capabilities.

### Put schemas in `src/pi-search/protocol/` when

- the schema describes a tool parameter contract
- the schema describes a tool result or protocol payload
- the schema will be consumed by more than one module
- the schema represents part of the intended standalone extension surface

### Keep a schema local only when

- it is tiny
- it is used in exactly one implementation file
- it is not part of the extension contract surface
- extracting it would make ownership less clear rather than more clear

Default bias: if a schema is part of the standalone extension contract, put it under `src/pi-search/protocol/`.

## Naming conventions

Use one consistent naming style.

- schema values end with `Schema`
  - `SearchPayloadSchema`
  - `ReadDocumentParamsSchema`
- schema-derived types use `Static<typeof ...Schema>`
  - `type SearchPayload = Static<typeof SearchPayloadSchema>`
- parser helpers use `parse...`
  - `parseSearchPayload(...)`
- extractor/helpers for validated detail objects use `extract...`
  - `extractRetrievedDocidsFromPiSearchToolDetails(...)`
- error types begin with `PiSearch`
  - `PiSearchMalformedJsonError`
  - `PiSearchInvalidToolArgumentsError`

## Error-shaping rules

`pi-search` errors should help the agent repair its next step.

Protocol errors may also expose small stable machine-readable metadata fields for non-prose consumers such as the benchmark harness or a future extracted package surface. Keep that metadata intentionally narrow:

- `code`
- `toolName`
- `target`
- `schemaName`
- `fieldPath`

Prefer messages like:

- `Invalid search arguments: query must be a non-empty string.`
- `Invalid read_search_results arguments: search_id 's9' is unknown. Call search(...) first to create a result set.`
- `read_document failed: docid 'doc-404' was not found. Choose a docid returned by search(...) or read_search_results(...).`

Avoid generic messages like:

- `schema validation failed`
- `tool error`
- `invalid payload`

The benchmark harness may add extra context around these failures, but it should not replace the underlying `pi-search` error semantics with unrelated infrastructure wording.

## Adding a new `pi-search` tool or result field

When adding a new tool or changing a contract field:

1. Add or update schemas in `src/pi-search/protocol/`.
2. Export schema-derived types from the same protocol module.
3. Add parse/extract helpers under `src/pi-search/protocol/` if benchmark consumers need structured access.
4. Use those helpers from `src/pi-search/` runtime modules.
5. If `pi-serini` must interpret the new structured detail, consume the `pi-search` helper rather than re-implementing parsing in the harness.
6. Add regression tests at the owning layer first:
   - protocol tests for schema/parser behavior
   - tool-handler tests for repairable failure wording
   - harness tests only for benchmark evidence and integration semantics

## Non-goals for this milestone

This `v0.2.0` boundary work is not a repo-wide JSON validation rewrite.

Out of scope unless explicitly expanded later:

- generic artifact validation across the whole repo
- unrelated operator/control-plane JSON readers
- broad benchmark artifact schema hardening outside the `pi-search` contract path

The goal here is narrower and more important:

- make `pi-search` a clear validated extension contract
- make `pi-serini` the benchmark-backed validation harness around it
