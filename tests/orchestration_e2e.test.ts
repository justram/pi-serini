import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

const baseEnv = {
  ...process.env,
  PI_SERINI_DRY_RUN: "1",
};

function runNpmScript(script: string, args: string[] = [], env: NodeJS.ProcessEnv = {}): string {
  return execFileSync("npm", ["run", script, "--", ...args], {
    cwd: process.cwd(),
    env: {
      ...baseEnv,
      ...env,
    },
    encoding: "utf8",
  });
}

function parseCommandJson(output: string): string[] {
  const match = output.match(/^COMMAND_JSON=(.+)$/m);
  assert.ok(match, "Expected COMMAND_JSON in dry-run output");
  return JSON.parse(match[1]) as string[];
}

test("package setup:benchmark script delegates to orchestration setup entrypoint", () => {
  const output = runNpmScript("setup:benchmark", ["--benchmark", "benchmark-template", "--step", "query-slices"]);

  assert.match(output, /BENCHMARK=benchmark-template/);
  assert.match(output, /STEP=query-slices/);
  assert.match(
    output,
    /SCRIPT_PATH=scripts\/benchmarks\/benchmark_template\/generate_query_slices\.sh/,
  );
});

test("package run:benchmark:query-set script drives the active orchestration path end-to-end", () => {
  const output = runNpmScript("run:benchmark:query-set", [
    "--benchmark",
    "benchmark-template",
    "--query-set",
    "test",
    "--model",
    "openai-codex/gpt-5.4-mini",
    "--thinking",
    "medium",
  ]);

  assert.match(output, /BENCHMARK=benchmark-template/);
  assert.match(output, /QUERY_SET=test/);
  assert.match(output, /QUERY_FILE=data\/benchmark-template\/queries\/test.tsv/);
  assert.match(output, /QRELS_FILE=data\/benchmark-template\/qrels\/qrel_primary.txt/);
  assert.match(output, /INDEX_PATH=indexes\/benchmark-template-bm25/);

  assert.deepEqual(parseCommandJson(output), [
    "npx",
    "tsx",
    "src/orchestration/run_pi_benchmark.ts",
    "--benchmark",
    "benchmark-template",
    "--querySet",
    "test",
    "--query",
    "data/benchmark-template/queries/test.tsv",
    "--qrels",
    "data/benchmark-template/qrels/qrel_primary.txt",
    "--outputDir",
    "runs/pi_bm25_benchmark-template_test_plain_minimal",
    "--model",
    "openai-codex/gpt-5.4-mini",
    "--thinking",
    "medium",
    "--extension",
    "src/pi-search/extension.ts",
    "--pi",
    "pi",
    "--timeoutSeconds",
    "300",
    "--promptVariant",
    "plain_minimal",
  ]);
});

test("package run:benchmark:query-set:shared script drives the active shared orchestration path end-to-end", () => {
  const output = runNpmScript("run:benchmark:query-set:shared", [
    "--benchmark",
    "benchmark-template",
    "--query-set",
    "test",
    "--port",
    "51001",
  ]);

  assert.match(output, /BENCHMARK=benchmark-template/);
  assert.match(output, /QUERY_SET=test/);
  assert.match(output, /LOG_DIR=runs\/shared-bm25-benchmark-template-test/);
  assert.match(output, /HOST=127\.0\.0\.1/);
  assert.match(output, /PORT=51001/);
  assert.match(output, /RUN_ENTRYPOINT=src\/orchestration\/run_benchmark_query_set.ts/);
});

test("package run:benchmark:shared script preserves the legacy low-level shared path end-to-end", () => {
  const output = runNpmScript("run:benchmark:shared", [
    "--benchmark",
    "benchmark-template",
    "--query-set",
    "test",
    "--port",
    "51002",
  ]);

  assert.match(output, /BENCHMARK=benchmark-template/);
  assert.match(output, /QUERY_SET=test/);
  assert.match(output, /LOG_DIR=runs\/shared-bm25-benchmark-template-test/);
  assert.match(output, /HOST=127\.0\.0\.1/);
  assert.match(output, /PORT=51002/);
  assert.match(output, /RUN_ENTRYPOINT=src\/legacy\/run_benchmark_entry.ts/);
});

test("package tune:bm25 script delegates to orchestration tuning entrypoint", () => {
  const output = runNpmScript("tune:bm25", ["--dry-run", "--benchmark", "benchmark-template"]);

  assert.match(output, /BENCHMARK=benchmark-template/);
  assert.match(output, /QUERY_SET=dev/);
  assert.match(output, /QUERY_FILE=data\/benchmark-template\/queries\/dev.tsv/);
  assert.match(output, /QRELS_FILE=data\/benchmark-template\/qrels\/qrel_primary.txt/);
  assert.match(output, /SECONDARY_QRELS_FILE=data\/benchmark-template\/qrels\/qrel_secondary.txt/);
  assert.match(output, /INDEX_PATH=indexes\/benchmark-template-bm25/);

  const command = parseCommandJson(output);
  assert.ok(command.includes("src/orchestration/tune_bm25.ts"));
  assert.ok(command.includes("--benchmark"));
  assert.ok(command.includes("benchmark-template"));
});
