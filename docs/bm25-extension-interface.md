# BM25 extension architecture and backend interface

This document describes the contract between `pi-serini`'s retrieval extension and the backend BM25 service.

It is intended for users who want to keep the `pi` retrieval-agent workflow but replace:

- the prebuilt Lucene index under `indexes/...`
- the bundled Anserini/JVM server
- or both

with their own retrieval stack.

## Big picture

There are three layers:

1. **Agent-facing extension**
   - file: `src/pi-search/extension.ts`
   - exposes the tools the model sees:
     - `search`
     - `read_search_results`
     - `read_document`

2. **Transport/helper layer**
   - also inside `src/pi-search/extension.ts`
   - talks to a backend either:
     - by launching `scripts/bm25_server.sh` locally over stdio
     - or by connecting to an already-running TCP service via:
       - `PI_BM25_RPC_HOST`
       - `PI_BM25_RPC_PORT`

3. **Backend retrieval service**
   - current implementation: `jvm/src/main/java/dev/jhy/piserini/Bm25Server.java`
   - may be replaced by any other service that implements the same JSON-line protocol

The key design point is:

- the **tool contract is owned by the extension**
- the **backend contract is much smaller and lower-level**

So if you want to swap out Anserini, you do **not** need to reimplement the extension's tool UX exactly inside your backend. You only need to satisfy the backend RPC contract described below.

## What the model sees vs what the backend sees

### Model-facing tools

The model sees three tools:

- `search(reason, query)`
- `read_search_results(reason, search_id, offset?, limit?)`
- `read_document(reason, docid, offset?, limit?)`

Important:

- `search_id` caching and pagination are implemented in the extension, not in the backend
- the backend does **not** need to understand `search_id`
- the backend does **not** need to store search sessions

The extension handles:

- issuing the initial retrieval
- caching top-`k` hits for a search
- rendering first-page and later-page result views
- prompt shaping and tool descriptions
- timeout steering / retrieval blocking near budget exhaustion
- prompt cleanup for benchmark turns

### Backend-facing RPC

The backend only needs to support these low-level commands:

- `search`
- `render_search_results`
- `read_document`
- optionally `ping`

That is the actual replacement surface.

## Transport contract

The extension supports two backend modes.

### 1. Local process over stdio

If no external RPC host/port is provided, the extension launches:

- `scripts/bm25_server.sh`

and communicates using newline-delimited JSON over stdin/stdout.

### 2. External service over TCP

If these are set:

- `PI_BM25_RPC_HOST`
- `PI_BM25_RPC_PORT`

the extension connects to that TCP endpoint and sends the same newline-delimited JSON protocol.

### Message framing

Every request and response is exactly one JSON object per line.

- encoding: UTF-8
- framing: newline-delimited JSON (JSONL)
- no binary framing
- no HTTP required

## Lifecycle contract

### TCP readiness message

When running in TCP mode, the server must print one readiness line to stdout before it starts serving requests:

```json
{
  "type": "server_ready",
  "transport": "tcp",
  "host": "127.0.0.1",
  "port": 50455,
  "timing_ms": { "init": 123.456 }
}
```

Required fields:

- `type`: must be `"server_ready"`
- `transport`: must be `"tcp"`
- `host`: string
- `port`: number

Optional but used for diagnostics:

- `timing_ms.init`

In stdio mode, no readiness line is required.

## Request/response envelope

The extension sends requests in this shape:

```json
{"id":1,"type":"search",...command_specific_fields...}
```

The backend must return exactly one response line:

```json
{"id":1,"type":"response","command":"search","success":true,"data":{...payload...}}
```

On failure:

```json
{ "id": 1, "type": "response", "command": "search", "success": false, "error": "...message..." }
```

Required envelope fields:

- `id`: echo back the request id
- `type`: must be `"response"`
- `command`: command name
- `success`: boolean
- exactly one of:
  - `data`
  - `error`

## Command contract

## 1. `search`

### Request

```json
{
  "id": 1,
  "type": "search",
  "query": "example lexical query",
  "query_mode": "plain",
  "k": 1000,
  "rerank_clues": []
}
```

Fields:

- `query` required string
- `query_mode` string
  - current extension uses only `"plain"`
  - current JVM server also supports `"lucene"`, but the cleaned repo preset does not depend on it
- `k` positive integer
- `rerank_clues` array
  - current extension sends `[]`
  - replacement backends may safely ignore it

### Successful payload

```json
{
  "mode": "search",
  "query": "example lexical query",
  "query_mode": "plain",
  "k": 1000,
  "results": [
    { "docid": "123", "score": 42.17 },
    { "docid": "456", "score": 39.02 }
  ],
  "timing_ms": {
    "command": 12.3,
    "server_uptime": 456.7,
    "init": 123.4
  }
}
```

Required payload fields for compatibility:

- `results`: array of objects with:
  - `docid`: string
  - `score`: number

Recommended fields:

- `mode`
- `query`
- `query_mode`
- `k`
- `timing_ms`

### Behavioral expectations

- return the top `k` documents in ranked order
- ranking can be BM25 or any compatible lexical retrieval strategy
- docids must be stable and usable in later `render_search_results` and `read_document` calls

## 2. `render_search_results`

This command turns ranked docids into model-readable snippets.

The extension uses this after `search` to render first-page and later-page ranking views.

### Request

```json
{
  "id": 2,
  "type": "render_search_results",
  "docids": ["123", "456"],
  "snippet_max_chars": 220,
  "highlight_clues": [],
  "inline_highlights": false
}
```

Fields:

- `docids` required array of strings
- `snippet_max_chars` positive integer
- `highlight_clues` array
  - current extension sends `[]`
  - replacement backends may ignore it
- `inline_highlights` boolean
  - current extension sends `false`
  - replacement backends may ignore it

### Successful payload

```json
{
  "mode": "render_search_results",
  "docids": ["123", "456"],
  "results": [
    {
      "docid": "123",
      "title": "Document title",
      "matched_terms": [],
      "excerpt": "Short preview text...",
      "excerpt_truncated": true
    },
    {
      "docid": "456",
      "title": null,
      "matched_terms": [],
      "excerpt": "Another preview...",
      "excerpt_truncated": false
    }
  ],
  "timing_ms": {
    "command": 4.2,
    "server_uptime": 460.1,
    "init": 123.4
  }
}
```

Required per-result fields for compatibility:

- `docid`: string
- `excerpt`: string
- `excerpt_truncated`: boolean

Recommended per-result fields:

- `title`: string or null
- `matched_terms`: array of strings

### Behavioral expectations

- preserve result order matching the input `docids`
- return one rendered preview per requested docid
- if a docid is missing, return a placeholder row rather than crashing the whole request when possible

## 3. `read_document`

This command returns a line-oriented chunk of a document.

### Request

```json
{
  "id": 3,
  "type": "read_document",
  "docid": "123",
  "offset": 1,
  "limit": 200
}
```

Fields:

- `docid` required string
- `offset` positive integer, 1-indexed line number
- `limit` positive integer

### Successful payload

```json
{
  "mode": "read_document",
  "docid": "123",
  "found": true,
  "offset": 1,
  "limit": 200,
  "total_lines": 780,
  "returned_line_start": 1,
  "returned_line_end": 200,
  "truncated": true,
  "next_offset": 201,
  "text": "...document text chunk...",
  "timing_ms": {
    "command": 3.8,
    "server_uptime": 463.9,
    "init": 123.4
  }
}
```

If the document does not exist:

```json
{
  "mode": "read_document",
  "docid": "123",
  "found": false,
  "error": "Document with docid '123' not found"
}
```

Required payload fields when found:

- `found`: boolean
- `text`: string
- `total_lines`: number
- `returned_line_start`: number
- `returned_line_end`: number
- `truncated`: boolean
- `next_offset`: number or null

### Behavioral expectations

- interpret `offset` as 1-indexed line offset
- paginate deterministically
- preserve stable line boundaries for the same stored document text

## 4. `ping` (optional)

### Request

```json
{ "id": 4, "type": "ping" }
```

### Response

```json
{ "id": 4, "type": "response", "command": "ping", "success": true, "data": { "ok": true } }
```

The current extension does not depend on `ping` in the critical benchmark path, but it is useful for debugging.

## Minimal backend you need to implement

If you want to replace the bundled Anserini server, the minimum viable backend is:

- accept JSONL requests over stdio or TCP
- support:
  - `search`
  - `render_search_results`
  - `read_document`
- return response envelopes exactly as described above
- use stable `docid` values across commands

That is enough to preserve the extension and agent workflow.

## What you are free to change behind the interface

You may replace all of the following without changing the extension:

- index format
- retrieval engine
- ranking formula
- snippet generation strategy
- document storage layer
- server language/runtime
- process model

For example, your replacement could be:

- another Lucene server
- Elasticsearch or OpenSearch behind a thin adapter
- Tantivy behind a JSONL bridge
- a custom Rust/Go/Java/Python lexical retriever

As long as it satisfies the command contract, the extension does not care.

## What is currently hard-coded in the extension

The cleaned extension is intentionally narrow.

Current assumptions:

- search mode used by the extension: `plain`
- preview rendering expected: simple excerpt rendering
- no structured search grammar
- no extension-side highlight-clue generation
- no extension-side inline highlighting mode

So replacement backends only need to support the plain-path contract.

## Environment variables relevant to backend replacement

### External backend reuse

- `PI_BM25_RPC_HOST`
- `PI_BM25_RPC_PORT`

If both are set, the extension uses the external TCP service instead of launching `scripts/bm25_server.sh`.

### Local backend pathing

If the bundled local launcher is used, the default index path is controlled by:

- `PI_BM25_INDEX_PATH`

Default value in this repo:

- `indexes/browsecomp-plus-bm25-tevatron`

## Recommended migration strategy for custom backends

1. Keep `src/pi-search/extension.ts` unchanged.
2. Stand up a tiny adapter service that implements this JSONL protocol.
3. Point the benchmark at it with:
   - `PI_BM25_RPC_HOST`
   - `PI_BM25_RPC_PORT`
4. Verify command-by-command:
   - `search`
   - `render_search_results`
   - `read_document`
5. Only after protocol compatibility is stable, swap the default launcher/scripts if desired.

This keeps replacement work isolated to the backend boundary.

## Example JSONL transcripts

The examples below show the actual wire shape a replacement backend should support.

### Example 1: `search`

Request line:

```json
{
  "id": 1,
  "type": "search",
  "query": "grammy winner school dismissed military addiction spouse died 1997",
  "query_mode": "plain",
  "k": 5,
  "rerank_clues": []
}
```

Response line:

```json
{
  "id": 1,
  "type": "response",
  "command": "search",
  "success": true,
  "data": {
    "mode": "search",
    "query": "grammy winner school dismissed military addiction spouse died 1997",
    "query_mode": "plain",
    "k": 5,
    "results": [
      { "docid": "71781", "score": 42.173 },
      { "docid": "24042", "score": 39.551 }
    ],
    "timing_ms": { "command": 8.214, "server_uptime": 152.004, "init": 91.337 }
  }
}
```

### Example 2: `render_search_results`

Request line:

```json
{
  "id": 2,
  "type": "render_search_results",
  "docids": ["71781", "24042"],
  "snippet_max_chars": 220,
  "highlight_clues": [],
  "inline_highlights": false
}
```

Response line:

```json
{
  "id": 2,
  "type": "response",
  "command": "render_search_results",
  "success": true,
  "data": {
    "mode": "render_search_results",
    "docids": ["71781", "24042"],
    "results": [
      {
        "docid": "71781",
        "title": "Johnny Cash",
        "matched_terms": [],
        "excerpt": "John R. Cash was an American singer-songwriter...",
        "excerpt_truncated": true
      },
      {
        "docid": "24042",
        "title": "Another title",
        "matched_terms": [],
        "excerpt": "Preview text for the second result...",
        "excerpt_truncated": false
      }
    ],
    "timing_ms": { "command": 3.102, "server_uptime": 155.229, "init": 91.337 }
  }
}
```

### Example 3: `read_document`

Request line:

```json
{ "id": 3, "type": "read_document", "docid": "71781", "offset": 1, "limit": 200 }
```

Response line:

```json
{
  "id": 3,
  "type": "response",
  "command": "read_document",
  "success": true,
  "data": {
    "mode": "read_document",
    "docid": "71781",
    "found": true,
    "offset": 1,
    "limit": 200,
    "total_lines": 781,
    "returned_line_start": 1,
    "returned_line_end": 200,
    "truncated": true,
    "next_offset": 201,
    "text": "Line 1...\nLine 2...\n...",
    "timing_ms": { "command": 2.487, "server_uptime": 157.901, "init": 91.337 }
  }
}
```

### Example 4: missing document

Request line:

```json
{ "id": 4, "type": "read_document", "docid": "does-not-exist", "offset": 1, "limit": 200 }
```

Response line:

```json
{
  "id": 4,
  "type": "response",
  "command": "read_document",
  "success": true,
  "data": {
    "mode": "read_document",
    "docid": "does-not-exist",
    "found": false,
    "error": "Document with docid 'does-not-exist' not found",
    "timing_ms": { "command": 0.422, "server_uptime": 158.44, "init": 91.337 }
  }
}
```

### Example 5: `ping`

Request line:

```json
{ "id": 5, "type": "ping" }
```

Response line:

```json
{ "id": 5, "type": "response", "command": "ping", "success": true, "data": { "ok": true } }
```

## Source files for reference

- extension: `src/pi-search/extension.ts`
- JSONL helper: `src/pi-search/lib/jsonl.ts`
- JVM backend: `jvm/src/main/java/dev/jhy/piserini/Bm25Server.java`
- local launcher: `scripts/bm25_server.sh`
- generic shared launcher: `scripts/launch_shared_bm25_benchmark.sh`
