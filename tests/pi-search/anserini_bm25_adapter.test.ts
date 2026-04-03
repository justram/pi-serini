import assert from "node:assert/strict";
import test from "node:test";

import { AnseriniBm25Backend } from "../../src/pi-search/searcher/adapters/anserini_bm25/adapter";
import type { AnseriniBm25HelperTransport } from "../../src/pi-search/searcher/adapters/anserini_bm25/helper_transport";

type HelperCall = {
  commandType: string;
  params: Record<string, unknown>;
};

function createHelper(
  handler: (commandType: string, params: Record<string, unknown>) => unknown,
): AnseriniBm25HelperTransport & { calls: HelperCall[] } {
  const calls: HelperCall[] = [];
  return {
    calls,
    async request(commandType, params) {
      calls.push({ commandType, params });
      return JSON.stringify(handler(commandType, params));
    },
  };
}

void test("AnseriniBm25Backend hydrates top search hits with title and excerpt previews", async () => {
  const helper = createHelper((commandType, params) => {
    if (commandType === "search") {
      assert.equal(params.query, "ada analytical engine");
      return {
        mode: "search",
        query: "ada analytical engine",
        query_mode: "plain",
        k: 10,
        results: [
          { docid: "doc-1", score: 3.5 },
          { docid: "doc-2", score: 2.1 },
        ],
        timing_ms: { command: 12, init: 3, server_uptime: 45 },
      };
    }
    if (commandType === "render_search_results") {
      assert.deepEqual(params.docids, ["doc-1", "doc-2"]);
      assert.equal(params.snippet_max_chars, 220);
      assert.equal(params.inline_highlights, false);
      assert.deepEqual(params.highlight_clues, [
        { text: "ada analytical engine", category: "any", boost: 1 },
      ]);
      return {
        mode: "render_search_results",
        docids: ["doc-1", "doc-2"],
        results: [
          {
            docid: "doc-1",
            title: "Ada Lovelace",
            matched_terms: ["ada", "analytical", "engine"],
            excerpt: "Ada wrote notes on the analytical engine.",
            excerpt_truncated: false,
          },
          {
            docid: "doc-2",
            title: "Charles Babbage",
            matched_terms: ["engine"],
            excerpt: "Babbage designed the analytical engine.",
            excerpt_truncated: true,
          },
        ],
      };
    }
    throw new Error(`Unexpected command: ${commandType}`);
  });

  const backend = new AnseriniBm25Backend(helper);
  const response = await backend.search({ query: "ada analytical engine", limit: 10 });

  assert.equal(backend.capabilities.supportsSnippets, true);
  assert.deepEqual(response.hits, [
    {
      docid: "doc-1",
      score: 3.5,
      title: "Ada Lovelace",
      snippet: "Ada wrote notes on the analytical engine.",
      snippetTruncated: false,
    },
    {
      docid: "doc-2",
      score: 2.1,
      title: "Charles Babbage",
      snippet: "Babbage designed the analytical engine.",
      snippetTruncated: true,
    },
  ]);
  assert.equal(response.timingMs?.request, 12);
  assert.equal(response.timingMs?.backendInit, 3);
  assert.equal(response.timingMs?.backendUptime, 45);
  assert.deepEqual(
    helper.calls.map((call) => call.commandType),
    ["search", "render_search_results"],
  );
});

void test("AnseriniBm25Backend falls back to docid and score when preview rendering fails", async () => {
  const calls: HelperCall[] = [];
  const helper: AnseriniBm25HelperTransport = {
    async request(commandType, params) {
      calls.push({ commandType, params });
      if (commandType === "search") {
        return JSON.stringify({
          mode: "search",
          query: "ada",
          query_mode: "plain",
          k: 10,
          results: [{ docid: "doc-1", score: 1.25 }],
        });
      }
      if (commandType === "render_search_results") {
        throw new Error("preview path temporarily unavailable");
      }
      throw new Error(`Unexpected command: ${commandType}`);
    },
  };

  const backend = new AnseriniBm25Backend(helper);
  const response = await backend.search({ query: "ada", limit: 10 });

  assert.deepEqual(response.hits, [{ docid: "doc-1", score: 1.25 }]);
  assert.deepEqual(
    calls.map((call) => call.commandType),
    ["search", "render_search_results"],
  );
});
