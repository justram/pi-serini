import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";

test("run_pi_benchmark records a failed query artifact when pi stdout ends with a truncated trailing JSON line", () => {
  const root = mkdtempSync(join(tmpdir(), "run-pi-benchmark-failure-"));
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
      "printf '%s\\n' '{\"type\":\"tool_execution_start\",\"toolCallId\":\"1\",\"toolName\":\"search\",\"args\":{\"reason\":\"initial search\"}}'",
      "printf '%s\\n' '{\"type\":\"tool_execution_end\",\"toolCallId\":\"1\",\"toolName\":\"search\",\"result\":{\"content\":[{\"type\":\"text\",\"text\":\"{\\\"results\\\":[{\\\"docid\\\":\\\"d1\\\"}]}\"}]}}'",
      "printf '%s' '{\"type\":\"message_end\"'",
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
    retrieved_docids: string[];
    result: Array<{ type: string; tool_name: string | null; output: string }>;
  };
  assert.equal(run.status, "failed");
  assert.deepEqual(run.retrieved_docids, ["d1"]);
  assert.ok(
    run.result.some(
      (entry) =>
        entry.type === "tool_call" &&
        entry.tool_name === "search" &&
        entry.output.includes('"docid":"d1"'),
    ),
  );
  assert.ok(
    run.result.some(
      (entry) =>
        entry.type === "output_text" &&
        entry.output.includes("invalid trailing JSON line"),
    ),
  );

  const rawEvents = readFileSync(join(outputDir, "raw-events", "1.jsonl"), "utf8");
  assert.equal(rawEvents.trim().split(/\r?\n/).length, 3);
});
