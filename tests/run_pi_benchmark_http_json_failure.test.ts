import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { buildHttpJsonExtensionConfig } from "../src/pi-search/config";

type HttpBenchmarkMode =
  | "http-503"
  | "malformed-json"
  | "success"
  | "read-search-results-success"
  | "read-search-results-unknown"
  | "read-document-not-found"
  | "read-document-success";

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
  const mode = process.env.PI_SEARCH_TEST_MODE?.trim();
  if (!mode) {
    throw new Error("Missing PI_SEARCH_TEST_MODE for fake HTTP benchmark runner.");
  }
  const config = parsePiSearchExtensionConfig(rawConfig);
  const backend = createPiSearchBackend(process.cwd(), config);

  emit({ type: "session" });

  try {
    if (mode === "read-document-not-found" || mode === "read-document-success") {
      emit({
        type: "tool_execution_start",
        toolCallId: "1",
        toolName: "read_document",
        args: { reason: "verify evidence", docid: "d1", offset: 1, limit: 20 },
      });
      try {
        const response = await backend.readDocument({ docid: "d1", offset: 1, limit: 20 });
        if (!response.found) {
          throw new Error(
            "read_document failed: docid 'd1' was not found. Choose a docid returned by search(...) or read_search_results(...).",
          );
        }
        emit({
          type: "tool_execution_end",
          toolCallId: "1",
          toolName: "read_document",
          result: {
            content: [
              {
                type: "text",
                text: JSON.stringify(response),
              },
            ],
          },
        });
      } catch (error) {
        emit({
          type: "tool_execution_end",
          toolCallId: "1",
          toolName: "read_document",
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
    } else if (mode === "read-search-results-success") {
      emit({
        type: "tool_execution_start",
        toolCallId: "1",
        toolName: "search",
        args: { reason: "initial search", query: "alpha query" },
      });
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
        },
      });
      emit({
        type: "tool_execution_start",
        toolCallId: "2",
        toolName: "read_search_results",
        args: { reason: "browse deeper", search_id: "s1", offset: 2, limit: 1 },
      });
      emit({
        type: "tool_execution_end",
        toolCallId: "2",
        toolName: "read_search_results",
        result: {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                searchId: "s1",
                offset: 2,
                limit: 1,
                results: response.hits.slice(1, 2),
              }),
            },
          ],
          details: {
            retrievedDocids: response.hits.slice(1, 2).map((hit) => hit.docid),
          },
        },
      });
    } else if (mode === "read-search-results-unknown") {
      emit({
        type: "tool_execution_start",
        toolCallId: "1",
        toolName: "read_search_results",
        args: { reason: "browse deeper", search_id: "missing", offset: 6, limit: 10 },
      });
      emit({
        type: "tool_execution_end",
        toolCallId: "1",
        toolName: "read_search_results",
        isError: true,
        result: {
          content: [
            {
              type: "text",
              text: "Invalid read_search_results arguments: search_id 'missing' is unknown. Call search(...) first to create a result set.",
            },
          ],
        },
      });
    } else {
      emit({
        type: "tool_execution_start",
        toolCallId: "1",
        toolName: "search",
        args: { reason: "initial search", query: "alpha query" },
      });
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

  const server = createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.url === "/search") {
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
      return;
    }

    if (request.url === "/read-document") {
      if (mode === "read-document-not-found") {
        response.statusCode = 200;
        response.end(JSON.stringify({ found: false, docid: "d1" }));
        return;
      }
      response.statusCode = 200;
      response.end(
        JSON.stringify({
          found: true,
          docid: "d1",
          text: "Ada Lovelace wrote notes on the analytical engine.",
          offset: 1,
          limit: 20,
          totalUnits: 2,
          returnedOffsetStart: 1,
          returnedOffsetEnd: 2,
          truncated: false,
        }),
      );
      return;
    }

    response.statusCode = 404;
    response.end(JSON.stringify({ error: "not found" }));
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
          PI_SEARCH_TEST_MODE: mode,
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

void test("run_pi_benchmark persists retrieved docids from http-backed read_search_results structured details even when the initial search event omits docid details", async () => {
  const run = await runBenchmarkWithHttpMode("read-search-results-success");

  assert.equal(run.status, "completed");
  assert.equal(run.stats.pi_search_failures, 0);
  assert.deepEqual(run.retrieved_docids, ["d2"]);
  assert.ok(
    run.result.some(
      (entry) =>
        entry.type === "tool_call" &&
        entry.tool_name === "read_search_results" &&
        entry.output.includes('"docid":"d2"'),
    ),
  );
});

void test("run_pi_benchmark records recoverable read_search_results argument failures as pi-search benchmark evidence", async () => {
  const run = await runBenchmarkWithHttpMode("read-search-results-unknown");

  assert.equal(run.status, "completed");
  assert.equal(run.stats.pi_search_failures, 1);
  assert.deepEqual(run.retrieved_docids, []);
  assert.ok(
    run.result.some(
      (entry) =>
        entry.type === "output_text" &&
        entry.output.includes(
          "pi-search extension failure (read_search_results): Invalid read_search_results arguments: search_id 'missing' is unknown.",
        ),
    ),
  );
  assert.ok(
    run.result.some(
      (entry) =>
        entry.type === "tool_call" &&
        entry.tool_name === "read_search_results" &&
        entry.output.includes("search_id 'missing' is unknown"),
    ),
  );
});

void test("run_pi_benchmark records recoverable http-json read_document not-found failures as pi-search benchmark evidence", async () => {
  const run = await runBenchmarkWithHttpMode("read-document-not-found");

  assert.equal(run.status, "completed");
  assert.equal(run.stats.pi_search_failures, 1);
  assert.deepEqual(run.retrieved_docids, []);
  assert.ok(
    run.result.some(
      (entry) =>
        entry.type === "output_text" &&
        entry.output.includes(
          "pi-search extension failure (read_document): read_document failed: docid 'd1' was not found.",
        ),
    ),
  );
  assert.ok(
    run.result.some(
      (entry) =>
        entry.type === "tool_call" &&
        entry.tool_name === "read_document" &&
        entry.output.includes("docid 'd1' was not found"),
    ),
  );
});

void test("run_pi_benchmark preserves successful http-json read_document tool output without counting a pi-search failure", async () => {
  const run = await runBenchmarkWithHttpMode("read-document-success");

  assert.equal(run.status, "completed");
  assert.equal(run.stats.pi_search_failures, 0);
  assert.deepEqual(run.retrieved_docids, []);
  assert.ok(
    run.result.some(
      (entry) =>
        entry.type === "tool_call" &&
        entry.tool_name === "read_document" &&
        entry.output.includes('"found":true') &&
        entry.output.includes('"docid":"d1"'),
    ),
  );
});
