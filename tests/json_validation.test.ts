import assert from "node:assert/strict";
import test from "node:test";

import {
  parseBm25HelperResponse,
  parseBm25PingResponse,
} from "../src/search-providers/anserini/bm25_rpc_client";
import { parseBm25RpcReadyMessage } from "../src/search-providers/anserini/bm25_server_process";
import {
  PiSearchInvalidToolResultError,
  PiSearchMalformedJsonError,
} from "../src/pi-search/protocol/errors";
import {
  parseReadDocumentPayload,
  parseRenderSearchResultsPayload,
  parseSearchPayload,
} from "../src/pi-search/protocol/parse";
import { parsePiEventJsonLine } from "../src/runtime/pi_json_protocol";

void test("BM25 helper response validation rejects non-object JSON payloads", () => {
  assert.throws(
    () => parseBm25HelperResponse('"not-an-object"'),
    /Invalid BM25 helper RPC response/,
  );
});

void test("BM25 ping validation requires an explicit ok boolean", () => {
  assert.throws(() => parseBm25PingResponse("{}"), /Invalid BM25 helper ping response/);
});

void test("BM25 readiness validation rejects payloads missing host metadata", () => {
  assert.throws(
    () =>
      parseBm25RpcReadyMessage(
        '{"type":"server_ready","transport":"tcp","port":9000}',
        "BM25 readiness line",
      ),
    /Invalid BM25 readiness line/,
  );
});

void test("Pi event validation requires a top-level type string", () => {
  assert.throws(
    () => parsePiEventJsonLine('{"message":{}}', "pi JSON line"),
    /Invalid pi JSON line/,
  );
});

void test("pi-search search payload validation rejects malformed results", () => {
  try {
    parseSearchPayload('{"results":[{"docid":"d1","score":"high"}]}');
    assert.fail("Expected parseSearchPayload to reject malformed results.");
  } catch (error) {
    assert.ok(error instanceof PiSearchInvalidToolResultError);
    assert.match(error.message, /Invalid pi-search search response/);
    assert.equal(error.code, "invalid_tool_result");
    assert.equal(error.toolName, "search");
    assert.equal(error.target, "payload");
    assert.equal(error.schemaName, "SearchPayloadSchema");
    assert.equal(error.fieldPath, "/results/0/score");
  }
});

void test("pi-search render payload validation rejects malformed preview results", () => {
  try {
    parseRenderSearchResultsPayload('{"results":[{"docid":"d1","excerpt":"x"}]}');
    assert.fail("Expected parseRenderSearchResultsPayload to reject malformed preview results.");
  } catch (error) {
    assert.ok(error instanceof PiSearchInvalidToolResultError);
    assert.match(error.message, /Invalid pi-search render_search_results response/);
    assert.equal(error.code, "invalid_tool_result");
    assert.equal(error.toolName, "read_search_results");
    assert.equal(error.target, "payload");
    assert.equal(error.schemaName, "RenderSearchResultsPayloadSchema");
    assert.equal(error.fieldPath, "/results/0");
  }
});

void test("pi-search read_document payload validation rejects malformed truncation metadata", () => {
  try {
    parseReadDocumentPayload('{"docid":"d1","truncated":true,"next_offset":"later"}');
    assert.fail("Expected parseReadDocumentPayload to reject malformed truncation metadata.");
  } catch (error) {
    assert.ok(error instanceof PiSearchInvalidToolResultError);
    assert.match(error.message, /Invalid pi-search read_document response/);
    assert.equal(error.code, "invalid_tool_result");
    assert.equal(error.toolName, "read_document");
    assert.equal(error.target, "payload");
    assert.equal(error.schemaName, "ReadDocumentPayloadSchema");
    assert.equal(error.fieldPath, "/next_offset");
  }
});

void test("pi-search payload parsing reports malformed-json metadata without requiring prose parsing", () => {
  try {
    parseSearchPayload('{"results":[');
    assert.fail("Expected parseSearchPayload to reject malformed JSON.");
  } catch (error) {
    assert.ok(error instanceof PiSearchMalformedJsonError);
    assert.match(error.message, /Failed to parse pi-search search response/);
    assert.equal(error.code, "malformed_json");
    assert.equal(error.toolName, "search");
    assert.equal(error.target, "payload");
    assert.equal(error.schemaName, "SearchPayloadSchema");
    assert.equal(error.fieldPath, undefined);
  }
});
