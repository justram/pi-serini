import assert from "node:assert/strict";
import { createServer } from "node:net";
import test from "node:test";

import { Bm25TcpRpcClient } from "../src/search-providers/anserini/bm25_tcp_rpc_client";
import { attachJsonlLineReader, serializeJsonLine } from "../src/runtime/jsonl";

async function withJsonlServer(
  handler: (message: Record<string, unknown>, socket: import("node:net").Socket) => void,
  run: (port: number) => Promise<void>,
): Promise<void> {
  const server = createServer((socket) => {
    attachJsonlLineReader(socket, (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      handler(JSON.parse(trimmed) as Record<string, unknown>, socket);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => resolve());
    server.once("error", reject);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Failed to allocate a TCP test port.");
  }

  try {
    await run(address.port);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

void test("Bm25TcpRpcClient sends requests and normalizes successful responses", async () => {
  const seen: Array<{ id: number; type: string }> = [];

  await withJsonlServer(
    (message, socket) => {
      seen.push({ id: Number(message.id), type: String(message.type) });
      socket.write(
        serializeJsonLine({
          id: message.id,
          type: "response",
          success: true,
          data: { echoedType: message.type, payload: message.query ?? message.docid ?? null },
        }),
      );
    },
    async (port) => {
      const client = new Bm25TcpRpcClient({ host: "127.0.0.1", port });
      const search = JSON.parse(await client.request("search", { query: "alpha" })) as {
        echoedType?: string;
        payload?: string;
      };
      const read = JSON.parse(await client.request("read_document", { docid: "d1" })) as {
        echoedType?: string;
        payload?: string;
      };

      assert.equal(search.echoedType, "search");
      assert.equal(search.payload, "alpha");
      assert.equal(read.echoedType, "read_document");
      assert.equal(read.payload, "d1");
    },
  );

  assert.deepEqual(seen, [
    { id: 1, type: "search" },
    { id: 2, type: "read_document" },
  ]);
});

void test("Bm25TcpRpcClient rejects protocol errors consistently", async () => {
  await withJsonlServer(
    (message, socket) => {
      socket.write(
        serializeJsonLine({
          id: Number(message.id) + 1,
          type: "response",
          success: true,
          data: { ok: true },
        }),
      );
    },
    async (port) => {
      const client = new Bm25TcpRpcClient({ host: "127.0.0.1", port });
      await assert.rejects(
        client.request("search", { query: "alpha" }),
        /BM25 helper RPC response ID mismatch: expected 1, received 2/,
      );
    },
  );
});

void test("Bm25TcpRpcClient rejects aborts with the shared request wording", async () => {
  await withJsonlServer(
    (_message, _socket) => {
      // Intentionally never respond so the client must abort.
    },
    async (port) => {
      const client = new Bm25TcpRpcClient({ host: "127.0.0.1", port });
      const controller = new AbortController();
      const request = client.request("search", { query: "alpha" }, controller.signal);
      controller.abort();
      await assert.rejects(request, /BM25 helper request aborted during request for search/);
    },
  );
});
