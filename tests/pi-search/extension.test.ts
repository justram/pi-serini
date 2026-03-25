import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import {
  buildAnseriniBm25StdioExtensionConfig,
  buildAnseriniBm25TcpExtensionConfig,
  buildHttpJsonExtensionConfig,
  buildMockExtensionConfig,
  parsePiSearchExtensionConfig,
  resolvePiSearchExtensionConfigFromEnv,
} from "../../src/pi-search/config";
import {
  buildReadSpillFileName,
  buildSearchSpillFileName,
  ManagedTempSpillDir,
  truncateReadDocumentOutput,
  truncateSearchOutput,
} from "../../src/pi-search/spill";
import { createPiSearchBackend } from "../../src/pi-search/searcher/adapters/create";

void test("buildAnseriniBm25TcpExtensionConfig produces a valid tcp-backed config", () => {
  const parsed = buildAnseriniBm25TcpExtensionConfig({ host: "127.0.0.1", port: 9000 });

  assert.equal(parsed.backend.kind, "anserini-bm25");
  assert.equal(parsed.backend.transport.kind, "tcp");
  if (parsed.backend.transport.kind === "tcp") {
    assert.equal(parsed.backend.transport.host, "127.0.0.1");
    assert.equal(parsed.backend.transport.port, 9000);
  }
});

void test("parsePiSearchExtensionConfig accepts a tcp-backed Anserini config", () => {
  const parsed = parsePiSearchExtensionConfig(
    '{"backend":{"kind":"anserini-bm25","transport":{"kind":"tcp","host":"127.0.0.1","port":9000}}}',
  );

  assert.equal(parsed.backend.kind, "anserini-bm25");
  assert.equal(parsed.backend.transport.kind, "tcp");
  if (parsed.backend.transport.kind === "tcp") {
    assert.equal(parsed.backend.transport.host, "127.0.0.1");
    assert.equal(parsed.backend.transport.port, 9000);
  }
});

void test("resolvePiSearchExtensionConfigFromEnv rejects missing explicit extension config", () => {
  assert.throws(
    () => resolvePiSearchExtensionConfigFromEnv({}),
    /Missing PI_SEARCH_EXTENSION_CONFIG/,
  );
});

void test("buildAnseriniBm25StdioExtensionConfig produces a valid stdio-backed config", () => {
  const parsed = buildAnseriniBm25StdioExtensionConfig({ indexPath: "indexes/demo" });

  assert.equal(parsed.backend.kind, "anserini-bm25");
  assert.equal(parsed.backend.transport.kind, "stdio");
  if (parsed.backend.transport.kind === "stdio") {
    assert.equal(parsed.backend.transport.indexPath, "indexes/demo");
  }
});

void test("generic pi-search backend creation rejects Anserini transport ownership without caller injection", () => {
  const config = buildAnseriniBm25StdioExtensionConfig({ indexPath: "indexes/demo" });

  assert.throws(
    () => createPiSearchBackend(process.cwd(), config),
    /Anserini BM25 backend creation now requires caller-owned transport integration/,
  );
});

void test("package-owned pi-search extension module stays free of repo-local BM25 imports", () => {
  const extensionSource = readFileSync("src/pi-search/extension.ts", "utf8");

  assert.doesNotMatch(extensionSource, /from\s+["']\.\.\/bm25\//);
  assert.match(extensionSource, /registerPiSearchExtension/);
});

void test("package-owned anserini adapter stays free of repo-local BM25 imports", () => {
  const adapterSource = readFileSync(
    "src/pi-search/searcher/adapters/anserini_bm25/adapter.ts",
    "utf8",
  );

  assert.doesNotMatch(adapterSource, /from\s+["']\.\.\.\.\/\.\.\.\.\/bm25\//);
  assert.match(adapterSource, /AnseriniBm25HelperTransport/);
});

void test("resolvePiSearchExtensionConfigFromEnv parses stdio-backed config from env", () => {
  const parsed = resolvePiSearchExtensionConfigFromEnv({
    PI_SEARCH_EXTENSION_CONFIG:
      '{"backend":{"kind":"anserini-bm25","transport":{"kind":"stdio","indexPath":"indexes/demo"}}}',
  });

  assert.equal(parsed.backend.kind, "anserini-bm25");
  assert.equal(parsed.backend.transport.kind, "stdio");
  if (parsed.backend.transport.kind === "stdio") {
    assert.equal(parsed.backend.transport.indexPath, "indexes/demo");
  }
});

void test("buildHttpJsonExtensionConfig produces a valid http-json backend config", () => {
  const parsed = buildHttpJsonExtensionConfig({
    capabilities: {
      backendId: "http-json-test",
      supportsScore: true,
      supportsSnippets: true,
      supportsExactTotalHits: true,
      maxPageSize: 20,
    },
    searchUrl: "http://127.0.0.1:8080/search",
    readDocumentUrl: "http://127.0.0.1:8080/read-document",
  });

  assert.equal(parsed.backend.kind, "http-json");
  if (parsed.backend.kind === "http-json") {
    assert.equal(parsed.backend.capabilities.backendId, "http-json-test");
    assert.equal(parsed.backend.endpoints.searchUrl, "http://127.0.0.1:8080/search");
    assert.equal(parsed.backend.endpoints.readDocumentUrl, "http://127.0.0.1:8080/read-document");
  }
});

void test("buildMockExtensionConfig produces a valid mock backend config", () => {
  const parsed = buildMockExtensionConfig({
    documents: [
      { docid: "doc-1", title: "Ada", snippet: "Analytical engine", text: "Ada\nLine 2" },
    ],
  });

  assert.equal(parsed.backend.kind, "mock");
  if (parsed.backend.kind === "mock") {
    assert.equal(parsed.backend.documents.length, 1);
    assert.equal(parsed.backend.documents[0].docid, "doc-1");
  }
});

void test("parsePiSearchExtensionConfig accepts an http-json backend config", () => {
  const parsed = parsePiSearchExtensionConfig(
    '{"backend":{"kind":"http-json","capabilities":{"backendId":"http-json-test","supportsScore":true,"supportsSnippets":true,"supportsExactTotalHits":true},"endpoints":{"searchUrl":"http://127.0.0.1:8080/search","readDocumentUrl":"http://127.0.0.1:8080/read-document"}}}',
  );

  assert.equal(parsed.backend.kind, "http-json");
  if (parsed.backend.kind === "http-json") {
    assert.equal(parsed.backend.capabilities.backendId, "http-json-test");
    assert.equal(parsed.backend.endpoints.searchUrl, "http://127.0.0.1:8080/search");
  }
});

void test("parsePiSearchExtensionConfig accepts a mock backend config", () => {
  const parsed = parsePiSearchExtensionConfig(
    '{"backend":{"kind":"mock","documents":[{"docid":"doc-1","title":"Ada","snippet":"Analytical engine","text":"Ada\\nLine 2"}]}}',
  );

  assert.equal(parsed.backend.kind, "mock");
  if (parsed.backend.kind === "mock") {
    assert.equal(parsed.backend.documents.length, 1);
    assert.equal(parsed.backend.documents[0].docid, "doc-1");
  }
});

void test("ManagedTempSpillDir writes spills under a dedicated temp root and cleans them up", () => {
  const spillDir = new ManagedTempSpillDir("pi-search-extension-test-");
  const spilledPath = spillDir.spillFile("search/results.json", '{"ok":true}\n');

  assert.match(spilledPath, /pi-search-extension-test-/);
  assert.match(spilledPath, /search\/results\.json$/);
  assert.equal(existsSync(spilledPath), true);
  assert.equal(existsSync(spillDir.rootDir), true);

  spillDir.cleanup();

  assert.equal(existsSync(spilledPath), false);
  assert.equal(existsSync(spillDir.rootDir), false);
});

void test("buildSearchSpillFileName includes search identity, rank range, and spill sequence", () => {
  const fileName = buildSearchSpillFileName(
    {
      searchId: "s/1",
      rawQuery: "alpha beta",
      queryMode: "plain",
      totalCached: 10,
      offset: 1,
      limit: 5,
      returnedRankStart: 1,
      returnedRankEnd: 5,
      results: [
        {
          rank: 1,
          docid: "doc-1",
          score: 1,
          snippet: "excerpt",
          snippetTruncated: false,
        },
      ],
    },
    7,
  );

  assert.equal(fileName, "7-s_1-ranks-1-5.json");
});

void test("buildSearchSpillFileName uses paginated empty-state metadata when a page has no results", () => {
  const fileName = buildSearchSpillFileName(
    {
      searchId: "s:2",
      rawQuery: "alpha beta",
      queryMode: "plain",
      totalCached: 10,
      offset: 11,
      limit: 5,
      returnedRankStart: 0,
      returnedRankEnd: 0,
      results: [],
    },
    8,
  );

  assert.equal(fileName, "8-s_2-offset-11-limit-5-empty.json");
});

void test("buildReadSpillFileName includes docid, line range, and spill sequence", () => {
  const fileName = buildReadSpillFileName(
    {
      docid: "doc/42",
      offset: 20,
      returned_line_start: 21,
      returned_line_end: 40,
    },
    9,
  );

  assert.equal(fileName, "9-doc_42-lines-21-40.txt");
});

void test("buildReadSpillFileName falls back to request offset when returned line metadata is missing", () => {
  const fileName = buildReadSpillFileName(
    {
      docid: "doc 42",
      offset: 20,
    },
    10,
  );

  assert.equal(fileName, "10-doc_42-lines-20-20.txt");
});

function normalizeSpillPath(text: string): string {
  return text.replace(/Full output saved to: .*?(?=\])/g, "Full output saved to: <spill-path>");
}

void test("truncateSearchOutput preserves rendered search truncation semantics aside from spill path", () => {
  const spillDir = new ManagedTempSpillDir("pi-search-extension-test-");
  const longText = Array.from(
    { length: 1200 },
    (_, index) => `search line ${index + 1} ${"x".repeat(120)}`,
  ).join("\n");
  const fullJson = JSON.stringify({ ok: true, payload: longText }, null, 2);

  const first = truncateSearchOutput(spillDir, "1-s1-ranks-1-5.json", longText, fullJson);
  const second = truncateSearchOutput(spillDir, "2-s1-ranks-1-5.json", longText, fullJson);

  assert.equal(first.truncation?.truncated, true);
  assert.deepEqual(first.truncation, second.truncation);
  assert.notEqual(first.fullOutputPath, second.fullOutputPath);
  assert.match(first.fullOutputPath ?? "", /1-s1-ranks-1-5\.json$/);
  assert.match(second.fullOutputPath ?? "", /2-s1-ranks-1-5\.json$/);
  assert.equal(normalizeSpillPath(first.text), normalizeSpillPath(second.text));

  spillDir.cleanup();
});

void test("truncateReadDocumentOutput preserves rendered document truncation semantics aside from spill path", () => {
  const spillDir = new ManagedTempSpillDir("pi-search-extension-test-");
  const longText = [
    "[docid=doc-42 lines 1-1200 of 1200]",
    "",
    ...Array.from({ length: 1200 }, (_, index) => `document line ${index + 1} ${"x".repeat(120)}`),
    "",
    '[Document truncated. Continue with read_document({"docid":"doc-42","offset":1201,"limit":200}).]',
  ].join("\n");
  const parsed = {
    docid: "doc-42",
    offset: 1,
    limit: 200,
    total_lines: 1200,
    returned_line_start: 1,
    returned_line_end: 1200,
    truncated: true,
    next_offset: 1201,
  };

  const first = truncateReadDocumentOutput(
    spillDir,
    "1-doc-42-lines-1-1200.txt",
    longText,
    longText,
    parsed,
  );
  const second = truncateReadDocumentOutput(
    spillDir,
    "2-doc-42-lines-1-1200.txt",
    longText,
    longText,
    parsed,
  );

  assert.equal(first.truncation?.truncated, true);
  assert.deepEqual(first.truncation, second.truncation);
  assert.notEqual(first.fullOutputPath, second.fullOutputPath);
  assert.match(first.fullOutputPath ?? "", /1-doc-42-lines-1-1200\.txt$/);
  assert.match(second.fullOutputPath ?? "", /2-doc-42-lines-1-1200\.txt$/);
  assert.equal(normalizeSpillPath(first.text), normalizeSpillPath(second.text));

  spillDir.cleanup();
});
