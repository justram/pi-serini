import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";

void test("run_pi_benchmark records pi-search tool failures as benchmark-visible extension evidence without forcing query failure when the agent recovers", () => {
  const root = mkdtempSync(join(tmpdir(), "run-pi-benchmark-pi-search-failure-"));
  const queryPath = join(root, "queries.tsv");
  const qrelsPath = join(root, "qrels.txt");
  const outputDir = join(root, "run");
  const fakePiPath = join(root, "fake-pi.sh");

  writeFileSync(queryPath, "1\talpha query\n", "utf8");
  writeFileSync(qrelsPath, "1 0 d1 1\n", "utf8");
  writeFileSync(
    fakePiPath,
    [
      "#!/bin/sh",
      "printf '%s\\n' '{\"type\":\"session\"}'",
      'printf \'%s\\n\' \'{"type":"tool_execution_start","toolCallId":"1","toolName":"read_document","args":{"reason":"verify evidence","docid":"doc-404"}}\'',
      'printf \'%s\\n\' \'{"type":"tool_execution_end","toolCallId":"1","toolName":"read_document","isError":true,"result":{"content":[{"type":"text","text":"read_document failed: docid \\"doc-404\\" was not found. Choose a docid returned by search(...) or read_search_results(...)."}]}}\'',
      'printf \'%s\\n\' \'{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"Explanation: recovered. Exact Answer: alpha. Confidence: 50%"}]}}\'',
      "printf '%s\\n' '{\"type\":\"agent_end\"}'",
    ].join("\n"),
    "utf8",
  );
  chmodSync(fakePiPath, 0o755);

  const output = execFileSync(
    "npx",
    [
      "tsx",
      "src/orchestration/run_pi_benchmark.ts",
      "--benchmark",
      "benchmark-template",
      "--querySet",
      "dev",
      "--query",
      queryPath,
      "--qrels",
      qrelsPath,
      "--outputDir",
      outputDir,
      "--model",
      "openai-codex/gpt-5.4-mini",
      "--thinking",
      "medium",
      "--extension",
      "src/pi-search/extension.ts",
      "--pi",
      fakePiPath,
      "--timeoutSeconds",
      "5",
      "--limit",
      "1",
      "--promptVariant",
      "plain_minimal",
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PI_BM25_RPC_HOST: "127.0.0.1",
        PI_BM25_RPC_PORT: "65535",
      },
      encoding: "utf8",
    },
  );

  assert.match(output, /Finished 1\/1 queries/);

  const run = JSON.parse(readFileSync(join(outputDir, "1.json"), "utf8")) as {
    status: string;
    stats: { pi_search_failures: number };
    result: Array<{ type: string; tool_name: string | null; output: string }>;
  };
  assert.equal(run.status, "completed");
  assert.equal(run.stats.pi_search_failures, 1);
  assert.ok(
    run.result.some(
      (entry) =>
        entry.type === "output_text" &&
        entry.output.includes("pi-search extension failure (read_document):"),
    ),
  );
  assert.ok(
    run.result.some(
      (entry) =>
        entry.type === "tool_call" &&
        entry.tool_name === "read_document" &&
        entry.output.includes("doc-404"),
    ),
  );
});
