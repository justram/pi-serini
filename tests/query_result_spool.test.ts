import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { QueryResultSpool } from "../src/orchestration/query_result_spool";

void test("QueryResultSpool appends and reloads normalized results in order", () => {
  const root = mkdtempSync(join(tmpdir(), "query-result-spool-"));
  const spool = new QueryResultSpool(join(root, "nested", "1.jsonl"));

  spool.append({
    type: "tool_call",
    tool_name: "search",
    arguments: { q: "alpha" },
    output: "first output",
  });
  spool.append({
    type: "output_text",
    tool_name: null,
    arguments: null,
    output: "final answer",
  });

  assert.deepEqual(spool.load(), [
    {
      type: "tool_call",
      tool_name: "search",
      arguments: { q: "alpha" },
      output: "first output",
    },
    {
      type: "output_text",
      tool_name: null,
      arguments: null,
      output: "final answer",
    },
  ]);
});

void test("QueryResultSpool cleanup removes its dedicated temp directory", () => {
  const root = mkdtempSync(join(tmpdir(), "query-result-spool-cleanup-"));
  const spool = new QueryResultSpool(join(root, "nested", "1.jsonl"));
  spool.append({
    type: "tool_call",
    tool_name: "search",
    arguments: null,
    output: "x",
  });

  spool.cleanup();

  assert.equal(existsSync(join(root, "nested")), false);
});
