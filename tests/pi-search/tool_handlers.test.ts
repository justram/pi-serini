import assert from "node:assert/strict";
import test from "node:test";

import type { PiSearchBackend } from "../../src/pi-search/backend/interface";
import type { PiSearchBackendRuntime } from "../../src/pi-search/helper_runtime";
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
