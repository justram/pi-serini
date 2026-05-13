import assert from "node:assert/strict";
import test from "node:test";

import type { PiSearchBackend } from "../../src/pi-search/searcher/contract/interface";
import { buildMockExtensionConfig } from "../../src/pi-search/config";
import { PiSearchBackendRuntime } from "../../src/pi-search/searcher/runtime";
import { SearchSessionStore } from "../../src/pi-search/search_cache";
import { ManagedTempSpillDir } from "../../src/pi-search/spill";
import {
  executeGrepDocumentTool,
  executeReadDocumentTool,
  executeReadSearchResultsTool,
  executeSearchTool,
} from "../../src/pi-search/tool_handlers";

type MockBackend = PiSearchBackend;

function createDeps(backend: MockBackend) {
  const spillDir = new ManagedTempSpillDir("pi-search-extension-test-");
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
  const spillDir = new ManagedTempSpillDir("pi-search-extension-test-");
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

void test("grep_document rejects invalid regex with repair-friendly error", async () => {
  const { deps, cleanup } = createDeps({
    capabilities: { backendId: "mock", supportsScore: false, supportsSnippets: false, supportsExactTotalHits: false },
    search: async () => { throw new Error("should not be called"); },
    readDocument: async () => { throw new Error("should not be called"); },
  });

  await assert.rejects(
    () =>
      executeGrepDocumentTool(
        { reason: "test", docid: "doc-1", pattern: "[invalid" },
        undefined,
        { cwd: "." },
        deps,
      ),
    /Invalid grep_document arguments: pattern is not a valid regular expression/,
  );

  cleanup();
});

void test("grep_document reports missing docid as tool execution failure", async () => {
  const { deps, cleanup } = createDeps({
    capabilities: { backendId: "mock", supportsScore: false, supportsSnippets: false, supportsExactTotalHits: false },
    search: async () => { throw new Error("should not be called"); },
    readDocument: async () => ({ found: false, docid: "doc-404", timingMs: { request: 1 } }),
  });

  await assert.rejects(
    () =>
      executeGrepDocumentTool(
        { reason: "test", docid: "doc-404", pattern: "foo" },
        undefined,
        { cwd: "." },
        deps,
      ),
    /grep_document failed: docid 'doc-404' was not found/,
  );

  cleanup();
});

void test("grep_document returns zero-match output for unmatched pattern", async () => {
  const { deps, cleanup } = createRuntimeDeps();

  const result = await executeGrepDocumentTool(
    { reason: "look for nonexistent term", docid: "doc-1", pattern: "xyzzy_no_match_12345" },
    undefined,
    { cwd: "." },
    deps,
  );

  assert.match(result.content[0].text, /matches 0-0 of 0/);
  assert.equal(result.details.totalMatches, 0);
  assert.equal(result.details.returnedMatchStart, 0);
  assert.equal(result.details.returnedMatchEnd, 0);
  assert.equal(result.details.nextOffset, undefined);

  cleanup();
});

void test("grep_document finds matches and returns char context", async () => {
  const { deps, cleanup } = createRuntimeDeps();

  // doc-1 text: "Ada Lovelace wrote notes on the analytical engine.\nShe is often described as an early computer pioneer.\nThis line provides extra context."
  // "Ada" appears at char 0; with after_chars=10 we expect "Ada Lovelace" in the excerpt
  const result = await executeGrepDocumentTool(
    { reason: "find Ada", docid: "doc-1", pattern: "Ada", before_chars: 0, after_chars: 10 },
    undefined,
    { cwd: "." },
    deps,
  );

  assert.match(result.content[0].text, /grep="Ada"/);
  assert.match(result.content[0].text, /matches 1-\d+ of \d+/);
  assert.match(result.content[0].text, /Ada/);
  assert.equal(result.details.docid, "doc-1");
  assert.equal(result.details.pattern, "Ada");
  assert.ok(result.details.totalMatches >= 1);
  assert.equal(result.details.returnedMatchStart, 1);

  // Verify after_chars=10 produces the correct excerpt window: "Ada" (3 chars) + 10 after = "Ada Lovelace"
  assert.match(result.content[0].text, /Ada Lovelace/);

  cleanup();
});

void test("grep_document paginates with offset and limit", async () => {
  const { deps, cleanup } = createRuntimeDeps();

  // doc-2 text: "Charles Babbage designed mechanical computing devices.\nThe analytical engine appears in many histories of computing."
  // "al" appears 3 times: once in "mechanical", twice in "analytical"
  const page1 = await executeGrepDocumentTool(
    { reason: "first match", docid: "doc-2", pattern: "al", offset: 1, limit: 1 },
    undefined,
    { cwd: "." },
    deps,
  );

  assert.equal(page1.details.returnedMatchStart, 1);
  assert.equal(page1.details.returnedMatchEnd, 1);
  assert.ok(page1.details.nextOffset === 2);

  const page2 = await executeGrepDocumentTool(
    { reason: "second match", docid: "doc-2", pattern: "al", offset: 2, limit: 1 },
    undefined,
    { cwd: "." },
    deps,
  );

  assert.equal(page2.details.returnedMatchStart, 2);
  assert.equal(page2.details.returnedMatchEnd, 2);

  cleanup();
});
