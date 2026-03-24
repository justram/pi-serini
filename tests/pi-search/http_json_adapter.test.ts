import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { buildHttpJsonExtensionConfig } from "../../src/pi-search/config";
import { createPiSearchBackend } from "../../src/pi-search/searcher/adapters/create";
import {
  PiSearchBackendExecutionError,
  PiSearchBackendInvalidResponseError,
  PiSearchBackendMalformedJsonError,
} from "../../src/pi-search/searcher/contract/errors";

function listen(server: ReturnType<typeof createServer>): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to bind HTTP test server."));
        return;
      }
      resolve(address.port);
    });
  });
}

function close(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function readJsonBody(request: import("node:http").IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

void test("http-json adapter validates search and readDocument responses through the shared searcher contract", async () => {
  const server = createServer(async (request, response) => {
    if (request.method !== "POST" || !request.url) {
      response.statusCode = 404;
      response.end("not found");
      return;
    }

    const body = (await readJsonBody(request)) as { query?: string; docid?: string };
    response.setHeader("content-type", "application/json");

    if (request.url === "/search") {
      assert.equal(body.query, "ada analytical engine");
      response.end(
        JSON.stringify({
          hits: [
            {
              docid: "doc-1",
              score: 2,
              title: "Ada Lovelace",
              snippet: "Ada wrote about the analytical engine.",
              snippetTruncated: false,
            },
          ],
          totalHits: 1,
          hasMore: false,
        }),
      );
      return;
    }

    if (request.url === "/read-document") {
      assert.equal(body.docid, "doc-1");
      response.end(
        JSON.stringify({
          found: true,
          docid: "doc-1",
          text: "Ada Lovelace wrote notes on the analytical engine.",
          offset: 1,
          limit: 20,
          totalUnits: 1,
          returnedOffsetStart: 1,
          returnedOffsetEnd: 1,
          truncated: false,
        }),
      );
      return;
    }

    response.statusCode = 404;
    response.end("not found");
  });

  const port = await listen(server);
  try {
    const backend = createPiSearchBackend(
      process.cwd(),
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
    );

    const searchResult = await backend.search({ query: "ada analytical engine", limit: 10 });
    assert.equal(searchResult.hits.length, 1);
    assert.equal(searchResult.hits[0].docid, "doc-1");
    assert.equal(searchResult.hits[0].title, "Ada Lovelace");

    const readResult = await backend.readDocument({ docid: "doc-1", offset: 1, limit: 20 });
    assert.equal(readResult.found, true);
    if (readResult.found) {
      assert.equal(readResult.docid, "doc-1");
      assert.match(readResult.text, /Ada Lovelace/);
    }
  } finally {
    await close(server);
  }
});

void test("http-json adapter surfaces non-2xx backend responses as execution errors", async () => {
  const server = createServer((_request, response) => {
    response.statusCode = 503;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ error: "temporary outage" }));
  });

  const port = await listen(server);
  try {
    const backend = createPiSearchBackend(
      process.cwd(),
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
    );

    await assert.rejects(
      () => backend.search({ query: "ada", limit: 10 }),
      (error: unknown) => {
        assert.ok(error instanceof PiSearchBackendExecutionError);
        assert.match(error.message, /HTTP 503/);
        assert.match(error.message, /temporary outage/);
        return true;
      },
    );
  } finally {
    await close(server);
  }
});

void test("http-json adapter surfaces malformed successful search responses as malformed-json errors", async () => {
  const server = createServer((_request, response) => {
    response.statusCode = 200;
    response.setHeader("content-type", "application/json");
    response.end('{"hits":[');
  });

  const port = await listen(server);
  try {
    const backend = createPiSearchBackend(
      process.cwd(),
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
    );

    await assert.rejects(
      () => backend.search({ query: "ada", limit: 10 }),
      (error: unknown) => {
        assert.ok(error instanceof PiSearchBackendMalformedJsonError);
        assert.match(error.message, /Failed to parse pi-search backend search response/);
        return true;
      },
    );
  } finally {
    await close(server);
  }
});

void test("http-json adapter surfaces schema-invalid successful readDocument responses as invalid-response errors", async () => {
  const server = createServer((_request, response) => {
    response.statusCode = 200;
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify({
        found: true,
        docid: "doc-1",
        text: "Ada Lovelace wrote notes on the analytical engine.",
        offset: 1,
        limit: 20,
        totalUnits: "one",
        returnedOffsetStart: 1,
        returnedOffsetEnd: 1,
        truncated: false,
      }),
    );
  });

  const port = await listen(server);
  try {
    const backend = createPiSearchBackend(
      process.cwd(),
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
    );

    await assert.rejects(
      () => backend.readDocument({ docid: "doc-1", offset: 1, limit: 20 }),
      (error: unknown) => {
        assert.ok(error instanceof PiSearchBackendInvalidResponseError);
        assert.match(error.message, /Invalid pi-search backend readDocument response/);
        assert.match(error.message, /totalUnits/);
        return true;
      },
    );
  } finally {
    await close(server);
  }
});
