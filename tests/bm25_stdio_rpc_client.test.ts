import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { EventEmitter } from "node:events";
import test from "node:test";
import type { ChildProcessWithoutNullStreams } from "node:child_process";

import { Bm25StdioRpcClient, type Bm25StdioRpcLauncher } from "../src/bm25/bm25_stdio_rpc_client";
import { attachJsonlLineReader, serializeJsonLine } from "../src/pi-search/lib/jsonl";

function createFakeLauncher(
  onRequest: (
    message: Record<string, unknown>,
    controls: {
      stdout: PassThrough;
      stderr: PassThrough;
      close: (code?: number | null, signal?: NodeJS.Signals | null) => void;
    },
  ) => void,
  counters?: { launches: number; stops: number },
): Bm25StdioRpcLauncher {
  return () => {
    if (counters) {
      counters.launches += 1;
    }
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const stdin = new PassThrough();
    const child = Object.assign(new EventEmitter(), {
      stdout,
      stderr,
      stdin,
      stdio: [stdin, stdout, stderr],
      killed: false,
      kill: () => {
        child.killed = true;
        return true;
      },
    }) as unknown as EventEmitter & ChildProcessWithoutNullStreams & { killed: boolean };

    const stopReading = attachJsonlLineReader(stdin, (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      onRequest(JSON.parse(trimmed) as Record<string, unknown>, {
        stdout,
        stderr,
        close: (code = 0, signal = null) => {
          child.emit("close", code, signal);
        },
      });
    });

    return {
      child,
      stop: () => {
        if (counters) {
          counters.stops += 1;
        }
        stopReading();
        child.kill();
      },
    };
  };
}

void test("Bm25StdioRpcClient launches once, handshakes with ping, and reuses the same process", async () => {
  const counters = { launches: 0, stops: 0 };
  const seen: Array<{ id: number; type: string }> = [];
  const client = new Bm25StdioRpcClient({
    cwd: process.cwd(),
    indexPath: "indexes/demo",
    launcher: createFakeLauncher((message, { stdout }) => {
      seen.push({ id: Number(message.id), type: String(message.type) });
      if (message.type === "ping") {
        stdout.write(
          serializeJsonLine({
            id: message.id,
            type: "response",
            success: true,
            data: { ok: true },
          }),
        );
        return;
      }
      stdout.write(
        serializeJsonLine({
          id: message.id,
          type: "response",
          success: true,
          data: { echoedType: message.type, payload: message.query ?? message.docid ?? null },
        }),
      );
    }, counters),
  });

  const search = JSON.parse(await client.request("search", { query: "alpha" })) as {
    echoedType?: string;
    payload?: string;
  };
  const read = JSON.parse(await client.request("read_document", { docid: "d1" })) as {
    echoedType?: string;
    payload?: string;
  };

  assert.equal(counters.launches, 1);
  assert.equal(search.echoedType, "search");
  assert.equal(search.payload, "alpha");
  assert.equal(read.echoedType, "read_document");
  assert.equal(read.payload, "d1");
  assert.deepEqual(seen, [
    { id: 1, type: "ping" },
    { id: 2, type: "search" },
    { id: 3, type: "read_document" },
  ]);

  client.dispose();
  assert.equal(counters.stops, 1);
});

void test("Bm25StdioRpcClient rejects when the ping handshake fails", async () => {
  const counters = { launches: 0, stops: 0 };
  const client = new Bm25StdioRpcClient({
    cwd: process.cwd(),
    indexPath: "indexes/demo",
    launcher: createFakeLauncher((message, { stdout }) => {
      stdout.write(
        serializeJsonLine({ id: message.id, type: "response", success: true, data: { ok: false } }),
      );
    }, counters),
  });

  await assert.rejects(client.request("search", { query: "alpha" }), /failed ping handshake/);
  assert.equal(counters.launches, 1);
  assert.equal(counters.stops, 1);
});

void test("Bm25StdioRpcClient rejects pending requests when the helper exits unexpectedly", async () => {
  const counters = { launches: 0, stops: 0 };
  const client = new Bm25StdioRpcClient({
    cwd: process.cwd(),
    indexPath: "indexes/demo",
    launcher: createFakeLauncher((message, { stdout, stderr, close }) => {
      if (message.type === "ping") {
        stdout.write(
          serializeJsonLine({
            id: message.id,
            type: "response",
            success: true,
            data: { ok: true },
          }),
        );
        return;
      }
      stderr.write("fatal helper problem");
      close(17, null);
    }, counters),
  });

  await assert.rejects(
    client.request("search", { query: "alpha" }),
    /exited unexpectedly \(code=17, signal=null\)\.\nfatal helper problem/,
  );
  assert.equal(counters.launches, 1);
  assert.equal(counters.stops, 1);
});
