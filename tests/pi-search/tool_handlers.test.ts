import assert from "node:assert/strict";
import test from "node:test";

import type { Bm25HelperRuntime } from "../../src/pi-search/helper_runtime";
import { SearchSessionStore } from "../../src/pi-search/search_cache";
import { ManagedTempSpillDir } from "../../src/pi-search/spill";
import {
  executeReadDocumentTool,
  executeReadSearchResultsTool,
  executeSearchTool,
} from "../../src/pi-search/tool_handlers";

type MockHelper = {
  request: (command: string, params: Record<string, unknown>) => Promise<string>;
  dispose?: () => void;
};

function createDeps(helper: MockHelper) {
  const spillDir = new ManagedTempSpillDir("pi-bm25-extension-test-");
  let spillSequence = 0;
  return {
    deps: {
      helperRuntime: {
        getHelper: () => helper,
        dispose: () => {},
      } as unknown as Bm25HelperRuntime,
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
    request: async () => {
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
    request: async () => {
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
    request: async (command) => {
      assert.equal(command, "read_document");
      return JSON.stringify({ docid: "doc-404", found: false, timing_ms: { command: 1 } });
    },
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
