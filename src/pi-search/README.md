# `pi-search`

`pi-search` is the package-owned search extension surface inside this repository.

It is designed to be a **backend-agnostic, extraction-ready extension boundary**:

- it owns the agent-facing retrieval tools
- it owns the extension contract and validation rules
- it owns extension-local runtime behavior such as cached search sessions, pagination, spill handling, and prompt policy
- it does **not** own repo-local benchmark orchestration or provider-specific transport/process wiring

If `pi-search` is ever extracted into its own package, this directory is intended to move with minimal churn.

For the deeper repo-level ownership contract, see:

- `../../docs/pi-search-contract.md`

For the current repo-local Anserini integration seam, see:

- `../../docs/bm25-extension-interface.md`

## What lives here

`src/pi-search/` owns the standalone extension contract and package-local behavior.

That includes:

- extension registration
- extension config parsing
- tool argument / result schemas
- runtime validation and protocol error shaping
- searcher contract definitions
- adapter normalization into the shared searcher contract
- backend lifecycle/cache behavior inside the extension runtime
- search session state and `search_id` pagination
- read/search spill behavior
- prompt shaping and time-budget steering

## What does not live here

The following remain outside `src/pi-search/` on purpose:

- benchmark orchestration
- benchmark artifact writing and evaluation
- operator/TUI code
- repo-local extension wrappers
- repo-local provider transport/process/client construction

Current repo-local Anserini provider code lives under:

- `src/search-providers/anserini/`

That provider layer is injected into package-owned `pi-search` from outside, rather than being imported directly by package-owned modules.

## Main entrypoints

### `extension.ts`

Package-owned extension registration and composition.

Main export:

- `registerPiSearchExtension(...)`

This file registers the user-facing tools:

- `search`
- `read_search_results`
- `read_document`

It accepts injected backend creation rather than constructing repo-local transport/process details itself.

### `config.ts`

Owns the `PI_SEARCH_EXTENSION_CONFIG` contract.

Important exports include:

- `PiSearchExtensionConfigSchema`
- `parsePiSearchExtensionConfig(...)`
- `resolvePiSearchExtensionConfigFromEnv(...)`
- `buildAnseriniBm25TcpExtensionConfig(...)`
- `buildAnseriniBm25StdioExtensionConfig(...)`
- `buildHttpJsonExtensionConfig(...)`
- `buildMockExtensionConfig(...)`

The extension now requires explicit config from its caller.

### `agent_prompt.ts`

Owns the reusable `pi-search` retrieval workflow prompt template.

This is package-owned prompt content for the `pi-search` retrieval flow, not generic repo runtime infrastructure.

## Directory map

### `protocol/`

Owns extension-facing schemas, Ajv wiring, parsers, protocol error types, and typed detail extractors.

Key responsibilities:

- tool parameter schemas
- tool result / payload schemas
- boundary parsing and validation
- repair-friendly protocol error shaping
- small stable machine-readable metadata for non-prose consumers

### `searcher/contract/`

Owns the backend-agnostic searcher contract.

This is the normalized interface that all supported backends must satisfy.

It defines things such as:

- search requests/responses
- read-document requests/responses
- backend capabilities
- backend-specific validation errors for malformed or invalid responses

### `searcher/adapters/`

Owns package-owned adapters that normalize concrete backends into the shared `PiSearchBackend` contract.

Current adapters:

- `anserini_bm25/`
- `http_json/`
- `mock/`
- `create.ts`

Important boundary rule:

- package-owned adapters may translate backend behavior into the shared contract
- they must not import repo-owned orchestration/evaluation/operator/provider layers

### `searcher/runtime.ts`

Owns backend caching/lifecycle behavior inside the extension runtime.

This is where backend instances are cached and disposed. It is also where caller-injected backend construction hooks plug into package-owned `pi-search`.

### `tool_handlers.ts`

Owns the concrete behavior behind:

- `search`
- `read_search_results`
- `read_document`

This file is responsible for applying the contract and producing repair-friendly extension behavior.

### `search_cache.ts`

Owns cached search session state, page construction, and ranked-result browsing helpers.

### `spill.ts`

Owns truncation-aware spill-file behavior for large search or document reads.

### `prompt_policy.ts`

Owns package-local prompt shaping and time-budget steering behavior.

This currently still reflects the benchmark harness environment the extension runs inside, but it remains package-owned because it is part of the extension’s retrieval workflow policy.

### `tool_types.ts`

Owns shared typed detail structures used by tool handlers and downstream contract consumers.

## Current supported backend kinds

`pi-search` currently supports these backend kinds through its config and shared searcher contract:

- `anserini-bm25`
- `http-json`
- `mock`

Important distinction:

- `anserini-bm25` is a supported backend kind in the package contract
- repo-local transport/process construction for the in-repo Anserini path still lives outside this directory under `src/search-providers/anserini/`

## Dependency direction

The intended dependency direction is strict:

- package-owned `src/pi-search/` code may depend on neutral/shared runtime utilities and external libraries
- repo-owned wrappers, orchestration, evaluation, operator code, and provider-integration layers may depend on `src/pi-search/`
- package-owned `src/pi-search/` code must not depend back on repo-owned layers

In practice, `src/pi-search/` should stay free of direct imports from repo-owned areas such as:

- `src/search-providers/`
- `src/orchestration/`
- `src/evaluation/`
- `src/operator/`
- `src/benchmarks/`
- `src/extensions/`

## Guardrails

This boundary is protected by tests.

In particular:

- `tests/pi-search/extension.test.ts`

contains whole-tree regression guards that fail if package-owned `src/pi-search/` starts importing repo-owned layers again.

## Relationship to the repo-local wrapper

The repository still needs a composition point that wires package-owned `pi-search` to repo-local provider construction.

That wrapper lives at:

- `src/extensions/pi_search.ts`

Its job is intentionally narrow:

- import the repo-local backend factory
- inject it into `registerPiSearchExtension(...)`

That keeps the dependency direction honest:

- `pi-search` owns the package boundary
- the repository owns provider composition

## If extraction happens later

The target shape is already visible:

- `src/pi-search/` is the movable package-owned body
- repo-local wrappers and provider code stay outside it

That does **not** mean extraction is required now.

It means this directory should keep behaving like a package boundary now, so a future extraction decision is based on product/release needs rather than cleanup debt.
