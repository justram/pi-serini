import assert from "node:assert/strict";
import test from "node:test";

import type { PiSearchBackend } from "../../src/pi-search/searcher/contract/interface";
import { buildMockExtensionConfig } from "../../src/pi-search/config";
import { PiSearchBackendRuntime } from "../../src/pi-search/searcher/runtime";
import { SearchSessionStore } from "../../src/pi-search/search_cache";
import { ManagedTempSpillDir } from "../../src/pi-search/spill";
import {
  executeReadDocumentTool,
  executeReadSearchResultsTool,
  executeSearchTool,
} from "../../src/pi-search/tool_handlers";

type MockBackend = PiSearchBackend;

function createDeps(backend: MockBackend) {
  const spillDir = new ManagedTempSpillDir("pi-bm25-extension-test-");
  let spillSequence = 0;
  return {
    deps: {
      backendRuntime: {
        getBackend: () => backend,
        dispose: () => {},
      } as unknown as PiSearchBackendRuntime,
      searchStore: new SearchSessionStore(),
      spillDir,
      nextSpillSequence: () => {
        spillSequence += 1;
        return spillSequence;
      },
    },
    cleanup: () => spillDir.cleanup(),
  };
}

function createRuntimeDeps() {
  const spillDir = new ManagedTempSpillDir("pi-bm25-extension-test-");
  let spillSequence = 0;
  return {
    deps: {
      backendRuntime: new PiSearchBackendRuntime(
        buildMockExtensionConfig({
          documents: [
            {
              docid: "doc-1",
              title: "Ada Lovelace",
              snippet: "Ada wrote about the analytical engine.",
              text: [
                "Ada Lovelace wrote notes on the analytical engine.",
                "She is often described as an early computer pioneer.",
                "This line provides extra context.",
              ].join("\n"),
            },
            {
              docid: "doc-2",
              title: "Charles Babbage",
              snippet: "Babbage designed the analytical engine.",
              text: [
                "Charles Babbage designed mechanical computing devices.",
                "The analytical engine appears in many histories of computing.",
              ].join("\n"),
            },
          ],
        }),
      ),
      searchStore: new SearchSessionStore(),
      spillDir,
      nextSpillSequence: () => {
        spillSequence += 1;
        return spillSequence;
      },
    },
    cleanup: () => spillDir.cleanup(),
  };
}

void test("search rejects empty query with agent-repair-friendly argument feedback", async () => {
  const { deps, cleanup } = createDeps({
    capabilities: {
      backendId: "mock",
      supportsScore: true,
      supportsSnippets: false,
      supportsExactTotalHits: false,
    },
    search: async () => {
      throw new Error("should not be called");
    },
    readDocument: async () => {
      throw new Error("should not be called");
    },
  });

  await assert.rejects(
    () =>
      executeSearchTool({ reason: "need more clues", query: "   " }, undefined, { cwd: "." }, deps),
    /Invalid search arguments: query must be a non-empty string\./,
  );

  cleanup();
});

void test("read_search_results rejects unknown search_id with repair guidance", async () => {
  const { deps, cleanup } = createDeps({
    capabilities: {
      backendId: "mock",
      supportsScore: true,
      supportsSnippets: false,
      supportsExactTotalHits: false,
    },
    search: async () => {
      throw new Error("should not be called");
    },
    readDocument: async () => {
      throw new Error("should not be called");
    },
  });

  await assert.rejects(
    () =>
      executeReadSearchResultsTool(
        { reason: "browse deeper", search_id: "missing", offset: 6, limit: 10 },
        undefined,
        { cwd: "." },
        deps,
      ),
    /Invalid read_search_results arguments: search_id 'missing' is unknown\. Call search\(\.\.\.\) first to create a result set\./,
  );

  cleanup();
});

void test("read_document reports missing docids as tool execution failures instead of generic errors", async () => {
  const { deps, cleanup } = createDeps({
    capabilities: {
      backendId: "mock",
      supportsScore: true,
      supportsSnippets: false,
      supportsExactTotalHits: false,
    },
    search: async () => {
      throw new Error("should not be called");
    },
    readDocument: async () => ({
      found: false,
      docid: "doc-404",
      timingMs: { request: 1 },
    }),
  });

  await assert.rejects(
    () =>
      executeReadDocumentTool(
        { reason: "verify evidence", docid: "doc-404", offset: 1, limit: 20 },
        undefined,
        { cwd: "." },
        deps,
      ),
    /read_document failed: docid 'doc-404' was not found\. Choose a docid returned by search\(\.\.\.\) or read_search_results\(\.\.\.\)\./,
  );

  cleanup();
});

void test("mock adapter can power search and browse through the shared pi-search contract", async () => {
  const { deps, cleanup } = createRuntimeDeps();

  const searchResult = await executeSearchTool(
    { reason: "find analytical engine pioneers", query: "analytical engine ada" },
    undefined,
    { cwd: "." },
    deps,
  );

  assert.match(searchResult.content[0].text, /docid=doc-1/);
  assert.match(searchResult.content[0].text, /Title: Ada Lovelace/);
  assert.match(searchResult.content[0].text, /Excerpt: Ada wrote about the analytical engine\./);
  assert.equal(searchResult.details.retrievedDocids[0], "doc-1");

  const browseResult = await executeReadSearchResultsTool(
    {
      reason: "inspect same cached ranking",
      search_id: searchResult.details.searchId,
      offset: 1,
      limit: 2,
    },
    undefined,
    { cwd: "." },
    deps,
  );

  assert.match(browseResult.content[0].text, /search_id=/);
  assert.deepEqual(browseResult.details.retrievedDocids, ["doc-1", "doc-2"]);

  cleanup();
});

void test("mock adapter can power continuable read_document semantics through the shared contract", async () => {
  const { deps, cleanup } = createRuntimeDeps();

  const result = await executeReadDocumentTool(
    { reason: "verify details", docid: "doc-1", offset: 1, limit: 2 },
    undefined,
    { cwd: "." },
    deps,
  );

  assert.match(result.content[0].text, /docid=doc-1 lines 1-2 of 3/);
  assert.match(result.content[0].text, /Continue with read_document/);
  assert.equal(result.details.docid, "doc-1");
  assert.equal(result.details.returnedLineStart, 1);
  assert.equal(result.details.returnedLineEnd, 2);
  assert.equal(result.details.truncated, true);
  assert.equal(result.details.nextOffset, 3);

  cleanup();
});
