import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import { resolveDefaultIndexPath } from "../../src/pi-search/helper_runtime";
import {
  buildReadSpillFileName,
  buildSearchSpillFileName,
  ManagedTempSpillDir,
  truncateReadDocumentOutput,
  truncateSearchOutput,
} from "../../src/pi-search/spill";

void test("resolveDefaultIndexPath follows the benchmark registry default", () => {
  assert.equal(resolveDefaultIndexPath({}), "indexes/browsecomp-plus-bm25-tevatron");
});

void test("resolveDefaultIndexPath respects BENCHMARK overrides", () => {
  assert.equal(
    resolveDefaultIndexPath({ BENCHMARK: "benchmark-template" }),
    "indexes/benchmark-template-bm25",
  );
});

void test("ManagedTempSpillDir writes spills under a dedicated temp root and cleans them up", () => {
  const spillDir = new ManagedTempSpillDir("pi-bm25-extension-test-");
  const spilledPath = spillDir.spillFile("search/results.json", '{"ok":true}\n');

  assert.match(spilledPath, /pi-bm25-extension-test-/);
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
          excerpt: "excerpt",
          excerpt_truncated: false,
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
  const spillDir = new ManagedTempSpillDir("pi-bm25-extension-test-");
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
  const spillDir = new ManagedTempSpillDir("pi-bm25-extension-test-");
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
