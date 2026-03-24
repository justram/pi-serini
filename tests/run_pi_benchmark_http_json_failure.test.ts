import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { buildHttpJsonExtensionConfig } from "../src/pi-search/config";

type HttpBenchmarkMode = "http-503" | "malformed-json" | "success";

type BenchmarkRunArtifact = {
  status: string;
  retrieved_docids: string[];
  stats: { pi_search_failures: number };
  result: Array<{ type: string; tool_name: string | null; output: string }>;
};

function listen(server: ReturnType<typeof createServer>): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to bind HTTP test server."));
        return;
      }
      resolvePromise(address.port);
    });
  });
}

function close(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolvePromise();
    });
  });
}

function createFakePiRunner(root: string): string {
  const fakePiTsPath = join(root, "fake-pi.ts");
  const fakePiPath = join(root, "fake-pi.sh");
  const configModulePath = resolve(process.cwd(), "src/pi-search/config.ts");
  const adapterFactoryModulePath = resolve(
    process.cwd(),
    "src/pi-search/searcher/adapters/create.ts",
  );

  writeFileSync(
    fakePiTsPath,
    `import { parsePiSearchExtensionConfig } from ${JSON.stringify(configModulePath)};
import { createPiSearchBackend } from ${JSON.stringify(adapterFactoryModulePath)};

function emit(event: unknown): void {
  process.stdout.write(JSON.stringify(event) + "\\n");
}

async function main(): Promise<void> {
  const rawConfig = process.env.PI_SEARCH_TEST_EXTENSION_CONFIG?.trim();
  if (!rawConfig) {
    throw new Error("Missing PI_SEARCH_TEST_EXTENSION_CONFIG for fake HTTP benchmark runner.");
  }
  const config = parsePiSearchExtensionConfig(rawConfig);
  const backend = createPiSearchBackend(process.cwd(), config);

  emit({ type: "session" });
  emit({
    type: "tool_execution_start",
    toolCallId: "1",
    toolName: "search",
    args: { reason: "initial search", query: "alpha query" },
  });

  try {
    try {
      const response = await backend.search({ query: "alpha query", limit: 1000 });
      emit({
        type: "tool_execution_end",
        toolCallId: "1",
        toolName: "search",
        result: {
          content: [
            {
              type: "text",
              text: JSON.stringify(response),
            },
          ],
          details: {
            retrievedDocids: response.hits.map((hit) => hit.docid),
          },
        },
      });
    } catch (error) {
      emit({
        type: "tool_execution_end",
        toolCallId: "1",
        toolName: "search",
        isError: true,
        result: {
          content: [
            {
              type: "text",
              text: error instanceof Error ? error.message : String(error),
            },
          ],
        },
      });
    }

    emit({
      type: "message_end",
      message: {
        role: "assistant",
        content: [
          {
            type: "text",
            text: "Explanation: recovered after http-backed pi-search failure. Exact Answer: alpha. Confidence: 60%",
          },
        ],
      },
    });
    emit({ type: "agent_end" });
  } finally {
    await backend.close?.();
  }
}

void main();
`,
    "utf8",
  );

  writeFileSync(
    fakePiPath,
    `#!/bin/sh
cd ${JSON.stringify(process.cwd())}
exec npx tsx --tsconfig tsconfig.json ${JSON.stringify(fakePiTsPath)}
`,
    "utf8",
  );
  chmodSync(fakePiPath, 0o755);
  return fakePiPath;
}

function execFileText(
  command: string,
  args: string[],
  options: Parameters<typeof execFile>[2],
): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    execFile(command, args, options, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      resolvePromise(typeof stdout === "string" ? stdout : (stdout?.toString("utf8") ?? ""));
    });
  });
}

async function runBenchmarkWithHttpMode(mode: HttpBenchmarkMode): Promise<BenchmarkRunArtifact> {
  const root = mkdtempSync(join(tmpdir(), `run-pi-benchmark-http-json-${mode}-`));
  const queryPath = join(root, "queries.tsv");
  const qrelsPath = join(root, "qrels.txt");
  const outputDir = join(root, "run");
  const fakePiPath = createFakePiRunner(root);

  writeFileSync(queryPath, "1\talpha query\n", "utf8");
  writeFileSync(qrelsPath, "1 0 d1 1\n", "utf8");

  const server = createServer((_request, response) => {
    response.setHeader("content-type", "application/json");
    if (mode === "http-503") {
      response.statusCode = 503;
      response.end(JSON.stringify({ error: "temporary outage" }));
      return;
    }
    if (mode === "malformed-json") {
      response.statusCode = 200;
      response.end('{"hits":[');
      return;
    }
    response.statusCode = 200;
    response.end(
      JSON.stringify({
        hits: [
          {
            docid: "d1",
            score: 3.5,
            title: "Ada Lovelace",
            snippet: "Ada wrote about the analytical engine.",
            snippetTruncated: false,
          },
          {
            docid: "d2",
            score: 2.1,
            title: "Charles Babbage",
            snippet: "Babbage designed the analytical engine.",
            snippetTruncated: false,
          },
        ],
        totalHits: 2,
        hasMore: false,
      }),
    );
  });

  const port = await listen(server);
  try {
    const output = await execFileText(
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
          PI_SEARCH_TEST_EXTENSION_CONFIG: JSON.stringify(
            buildHttpJsonExtensionConfig({
              capabilities: {
                backendId: "http-json-test",
                supportsScore: true,
                supportsSnippets: true,
                supportsExactTotalHits: true,
              },
              searchUrl: `http://127.0.0.1:${port}/search`,
              readDocumentUrl: `http://127.0.0.1:${port}/read-document`,
            }),
          ),
          PI_BM25_RPC_HOST: "127.0.0.1",
          PI_BM25_RPC_PORT: "65535",
        },
        encoding: "utf8",
      },
    );

    assert.match(output, /Finished 1\/1 queries/);
    return JSON.parse(readFileSync(join(outputDir, "1.json"), "utf8")) as BenchmarkRunArtifact;
  } finally {
    await close(server);
  }
}

void test("run_pi_benchmark records recoverable http-json backend execution failures as pi-search benchmark evidence", async () => {
  const run = await runBenchmarkWithHttpMode("http-503");

  assert.equal(run.status, "completed");
  assert.equal(run.stats.pi_search_failures, 1);
  assert.ok(
    run.result.some(
      (entry) =>
        entry.type === "output_text" &&
        entry.output.includes(
          'pi-search extension failure (search): http-json-test backend search failed: HTTP 503: {"error":"temporary outage"}',
        ),
    ),
  );
  assert.ok(
    run.result.some(
      (entry) =>
        entry.type === "tool_call" &&
        entry.tool_name === "search" &&
        entry.output.includes("http-json-test backend search failed: HTTP 503"),
    ),
  );
});

void test("run_pi_benchmark records malformed successful http-json responses as recoverable pi-search benchmark evidence", async () => {
  const run = await runBenchmarkWithHttpMode("malformed-json");

  assert.equal(run.status, "completed");
  assert.equal(run.stats.pi_search_failures, 1);
  assert.ok(
    run.result.some(
      (entry) =>
        entry.type === "output_text" &&
        entry.output.includes(
          "pi-search extension failure (search): Failed to parse pi-search backend search response:",
        ),
    ),
  );
  assert.ok(
    run.result.some(
      (entry) =>
        entry.type === "tool_call" &&
        entry.tool_name === "search" &&
        entry.output.includes("Failed to parse pi-search backend search response"),
    ),
  );
});

void test("run_pi_benchmark persists retrieved docids from a successful http-json-backed search via structured pi-search details", async () => {
  const run = await runBenchmarkWithHttpMode("success");

  assert.equal(run.status, "completed");
  assert.equal(run.stats.pi_search_failures, 0);
  assert.deepEqual(run.retrieved_docids, ["d1", "d2"]);
  assert.ok(
    run.result.some(
      (entry) =>
        entry.type === "tool_call" &&
        entry.tool_name === "search" &&
        entry.output.includes('"docid":"d1"') &&
        entry.output.includes('"docid":"d2"'),
    ),
  );
});
