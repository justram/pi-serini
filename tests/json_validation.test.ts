import assert from "node:assert/strict";
import test from "node:test";

import { parseBm25HelperResponse, parseBm25PingResponse } from "../src/bm25/bm25_rpc_client";
import { parseBm25RpcReadyMessage } from "../src/bm25/bm25_server_process";
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

void test("BM25 search payload validation rejects malformed results", () => {
  assert.throws(
    () => parseSearchPayload('{"results":[{"docid":"d1","score":"high"}]}'),
    /Invalid BM25 search response/,
  );
});

void test("BM25 render payload validation rejects malformed preview results", () => {
  assert.throws(
    () => parseRenderSearchResultsPayload('{"results":[{"docid":"d1","excerpt":"x"}]}'),
    /Invalid BM25 render_search_results response/,
  );
});

void test("BM25 read_document payload validation rejects malformed truncation metadata", () => {
  assert.throws(
    () => parseReadDocumentPayload('{"docid":"d1","truncated":true,"next_offset":"later"}'),
    /Invalid BM25 read_document response/,
  );
});
