# BM25 integration architecture for `pi-search`

This document explains the **BM25-specific integration seam** inside `pi-serini`.

It is for maintainers or backend integrators who want to understand one narrow question:

- how the in-repo Anserini BM25 path plugs into the backend-agnostic `pi-search` extension

It is **not** the source of truth for the full `pi-search` extension contract.

For that broader package boundary, see:

- `docs/pi-search-contract.md`

For the local package-level directory map and entrypoints, see:

- `../src/pi-search/README.md`

## Why this document exists

`pi-search` is now intentionally split into two layers:

1. **package-owned `pi-search` extension logic**
   - lives under `src/pi-search/`
   - owns tool registration, tool behavior, protocol validation, search-session state, spill handling, and prompt/runtime policy
2. **repo-local BM25 integration glue**
   - lives outside `src/pi-search/`
   - owns how this repository constructs the Anserini BM25 backend over stdio or TCP

That means the question "how does BM25 work here?" is no longer the same as "how does the `pi-search` extension work?"

The BM25 path is now just one backend integration for `pi-search`.

## Current ownership split

### Package-owned `pi-search` layer

Main package-owned entrypoint:

- `src/pi-search/extension.ts`

Important supporting modules:

- `src/pi-search/config.ts`
- `src/pi-search/protocol/`
- `src/pi-search/searcher/contract/`
- `src/pi-search/searcher/adapters/`
- `src/pi-search/searcher/runtime.ts`
- `src/pi-search/search_cache.ts`
- `src/pi-search/tool_handlers.ts`
- `src/pi-search/spill.ts`
- `src/pi-search/prompt_policy.ts`

This layer is responsible for the agent-facing tool surface:

- `search`
- `read_search_results`
- `read_document`

It is also responsible for:

- validating extension config
- validating tool arguments and tool results
- caching ranked results behind `search_id`
- pagination behavior for result browsing and document reading
- repair-friendly error messages
- prompt shaping and time-budget steering

Critically, `src/pi-search/extension.ts` is now package-owned again and does **not** import `src/search-providers/anserini/*` directly.

### Repo-local BM25 integration layer

Main repo wrapper:

- `src/extensions/pi_search.ts`

Repo-local BM25 backend factory:

- `src/search-providers/anserini/pi_search_backend_factory.ts`

BM25 transport/client modules:

- `src/search-providers/anserini/bm25_rpc_client.ts`
- `src/search-providers/anserini/bm25_stdio_rpc_client.ts`
- `src/search-providers/anserini/bm25_tcp_rpc_client.ts`
- `src/search-providers/anserini/bm25_server_process.ts`

Anserini BM25 adapter:

- `src/pi-search/searcher/adapters/anserini_bm25/adapter.ts`

This layer is responsible for turning repo-local BM25 runtime details into a `PiSearchBackend` instance.

That includes:

- choosing stdio vs TCP transport
- resolving stdio index paths relative to the repo working directory
- passing `process.env` into the BM25 helper process path
- constructing the BM25 RPC client
- wrapping that client in the Anserini BM25 searcher adapter

## Big picture

There are now four distinct layers:

1. **Agent-facing extension surface**
   - package-owned
   - `src/pi-search/extension.ts`
   - registers the `search`, `read_search_results`, and `read_document` tools

2. **Searcher contract and adapter normalization**
   - package-owned
   - `src/pi-search/searcher/`
   - defines the backend-agnostic `PiSearchBackend` contract

3. **Repo-local backend construction**
   - repo-owned
   - `src/extensions/pi_search.ts`
   - `src/search-providers/anserini/pi_search_backend_factory.ts`
   - injects the in-repo BM25 transport/runtime implementation into package-owned `pi-search`

4. **Backend retrieval service**
   - current in-repo implementation is the Anserini BM25 helper stack under `src/search-providers/anserini/` plus the JVM server
   - this may be local stdio or a remote TCP service depending on config

That means BM25 no longer owns the whole extension surface.

It owns only one backend implementation path.

## How the layers connect

### 1. Package-owned extension registration

`src/pi-search/extension.ts` exports:

- `registerPiSearchExtension(...)`

That function owns tool registration and runtime behavior, but accepts injected backend creation.

Conceptually, the package-owned layer says:

- "give me a way to create a `PiSearchBackend`, and I will provide the `pi-search` tool UX"

### 2. Repo-local wrapper injects BM25 backend creation

`src/extensions/pi_search.ts` is intentionally thin.

Its job is:

- import `createRepoPiSearchBackend` from `src/search-providers/anserini/pi_search_backend_factory.ts`
- call `registerPiSearchExtension(pi, { createBackend: createRepoPiSearchBackend })`

So this file is no longer the real home of extension logic.

It is just the repository-specific composition point.

### 3. Repo-local BM25 factory chooses transport details

`src/search-providers/anserini/pi_search_backend_factory.ts` owns the in-repo Anserini BM25 wiring.

If the configured backend is not `anserini-bm25`, it delegates to the generic package-owned backend factory.

If the configured backend **is** `anserini-bm25`, it does the repo-local work needed for this repository's helper model:

- TCP transport:
  - construct `Bm25TcpRpcClient`
- stdio transport:
  - resolve `indexPath` relative to `cwd`
  - construct `Bm25StdioRpcClient`
  - pass `process.env`

Then it returns:

- `new AnseriniBm25Backend(...)`

### 4. The Anserini adapter normalizes BM25 behavior into the shared contract

`src/pi-search/searcher/adapters/anserini_bm25/adapter.ts` translates BM25 helper behavior into the backend-agnostic `PiSearchBackend` interface.

That means the top-level `pi-search` layer does not need to know BM25 transport details.

It only consumes the normalized backend contract.

## What BM25 still owns

BM25-specific code should remain responsible for things that are honestly BM25/Anserini/runtime-specific, such as:

- helper process launch details
- TCP connection details
- JSONL request/response transport
- helper readiness behavior
- JVM/Anserini-specific request and response semantics
- mapping BM25 helper payloads into normalized `pi-search` backend responses

This is why the following still live in BM25-shaped modules:

- RPC clients
- server-process management
- the repo-local backend factory
- the Anserini BM25 adapter

## What BM25 no longer owns

BM25 should **not** own the package-level extension surface anymore.

That includes:

- tool registration
- `search_id` cache ownership
- `read_search_results` pagination UX
- top-level tool descriptions and prompt guidance
- extension-facing repair messages
- generic `pi-search` runtime policies

Those now belong to package-owned `pi-search` modules under `src/pi-search/`.

## Configuration flow

The extension now requires explicit backend config via:

- `PI_SEARCH_EXTENSION_CONFIG`

Package-owned config parsing lives in:

- `src/pi-search/config.ts`

That config can describe multiple backend kinds, including:

- `anserini-bm25`
- `mock`
- `http-json`

The BM25 integration path only applies when:

- `backend.kind === "anserini-bm25"`

This is important because BM25-specific environment and transport details are no longer the universal extension contract.

They are only one backend choice inside that contract.

## BM25 transport modes

For `anserini-bm25`, the current repo-local integration supports two transport modes.

### Stdio mode

The repo constructs a local BM25 helper process and communicates over stdin/stdout.

Relevant module:

- `src/search-providers/anserini/bm25_stdio_rpc_client.ts`

This path is responsible for:

- resolving the configured index path relative to the current working directory
- launching the helper process
- sending JSONL requests
- validating JSONL responses

### TCP mode

The repo connects to an already-running BM25 helper endpoint.

Relevant module:

- `src/search-providers/anserini/bm25_tcp_rpc_client.ts`

This path is responsible for:

- connecting to the configured host and port
- sending JSONL requests
- validating JSONL responses

## Replacement guidance

If you want to replace the in-repo Anserini BM25 path, there are two different levels at which you can do it.

### Option 1: replace only the BM25 implementation

Keep the package-owned `pi-search` layer and replace the BM25 integration/backend.

In that case, you should target one of these seams:

- implement another `PiSearchBackend` adapter under `src/pi-search/searcher/adapters/`
- or provide another repo-local backend factory injection path

This is the preferred path if you still want the same `pi-search` tool UX.

### Option 2: replace the whole extension product

If you replace `src/pi-search/extension.ts` behavior itself, you are no longer just swapping BM25.

You are changing the actual `pi-search` extension product surface.

That is a different architectural change and should be treated as such.

## What this document intentionally does not define

This document is no longer the source of truth for:

- the full `pi-search` tool contract
- non-BM25 backend contracts like `mock` or `http-json`
- generic extension validation rules
- benchmark-harness ownership

Those topics belong in:

- `docs/pi-search-contract.md`
- `src/pi-search/searcher/contract/`
- the relevant adapter modules and tests

## Maintainer checklist

If BM25 integration changes again, keep these rules true:

1. `src/pi-search/extension.ts` must stay free of direct `src/search-providers/anserini/*` imports.
2. `src/extensions/pi_search.ts` should remain a thin repo-local wrapper.
3. Repo-local transport/process construction should stay in `src/search-providers/anserini/pi_search_backend_factory.ts` or an equivalent repo-owned integration layer.
4. BM25-specific request/response handling should stay behind the Anserini adapter boundary.
5. Package-owned `pi-search` logic should continue to depend on the normalized `PiSearchBackend` contract, not BM25 helper details.

If those rules remain true, `pi-search` stays extractable while `pi-serini` still supports the in-repo Anserini BM25 path cleanly.
