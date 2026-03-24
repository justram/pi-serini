import assert from "node:assert/strict";
import test from "node:test";

import {
  PiSearchBackendCapabilityMismatchError,
  PiSearchBackendExecutionError,
  PiSearchBackendUnavailableError,
} from "../../src/pi-search/searcher/contract/errors";
import {
  parseSearchBackendReadDocumentResponse,
  parseSearchBackendSearchResponse,
  validateSearchBackendCapabilities,
} from "../../src/pi-search/searcher/contract/parse";

void test("backend contract accepts a valid search response with optional enrichments omitted", () => {
  const parsed = parseSearchBackendSearchResponse('{"hits":[{"docid":"d1"}],"hasMore":false}');

  assert.equal(parsed.hits.length, 1);
  assert.equal(parsed.hits[0].docid, "d1");
  assert.equal(parsed.hits[0].score, undefined);
  assert.equal(parsed.hasMore, false);
});

void test("backend contract rejects malformed score values", () => {
  assert.throws(
    () =>
      parseSearchBackendSearchResponse('{"hits":[{"docid":"d1","score":"high"}],"hasMore":false}'),
    /Invalid pi-search backend search response/,
  );
});

void test("backend contract accepts a valid found readDocument response", () => {
  const parsed = parseSearchBackendReadDocumentResponse(
    '{"found":true,"docid":"d1","text":"hello","offset":1,"limit":50,"truncated":false}',
  );

  assert.equal(parsed.found, true);
  if (parsed.found) {
    assert.equal(parsed.docid, "d1");
    assert.equal(parsed.text, "hello");
    assert.equal(parsed.offset, 1);
    assert.equal(parsed.limit, 50);
    assert.equal(parsed.truncated, false);
  }
});

void test("backend contract accepts a valid not-found readDocument response", () => {
  const parsed = parseSearchBackendReadDocumentResponse('{"found":false,"docid":"missing"}');

  assert.equal(parsed.found, false);
  assert.equal(parsed.docid, "missing");
});

void test("backend contract rejects malformed readDocument continuation metadata", () => {
  assert.throws(
    () =>
      parseSearchBackendReadDocumentResponse(
        '{"found":true,"docid":"d1","text":"hello","offset":1,"limit":50,"truncated":true,"nextOffset":"later"}',
      ),
    /Invalid pi-search backend readDocument response/,
  );
});

void test("backend capability validation rejects impossible capability shapes", () => {
  assert.throws(
    () =>
      validateSearchBackendCapabilities({
        backendId: "anserini-bm25",
        supportsScore: true,
        supportsSnippets: true,
        supportsExactTotalHits: true,
        maxPageSize: 0,
      }),
    /Invalid pi-search backend capabilities/,
  );
});

void test("backend error classes preserve useful human-readable messages", () => {
  assert.equal(
    new PiSearchBackendUnavailableError("anserini-bm25", "connection refused").message,
    "anserini-bm25 backend unavailable: connection refused",
  );
  assert.equal(
    new PiSearchBackendCapabilityMismatchError("anserini-bm25", "snippets are required").message,
    "anserini-bm25 backend capability mismatch: snippets are required",
  );
  assert.equal(
    new PiSearchBackendExecutionError("anserini-bm25", "search", "request timed out").message,
    "anserini-bm25 backend search failed: request timed out",
  );
});
