import assert from "node:assert/strict";
import test from "node:test";

import { buildBm25ServerTcpArgs } from "../src/bm25_server_process";

test("buildBm25ServerTcpArgs uses default tuning values when env is unset", () => {
  const args = buildBm25ServerTcpArgs("indexes/demo", "127.0.0.1", 50455, {});
  assert.deepEqual(args, [
    "scripts/bm25_server.sh",
    "--index-path",
    "indexes/demo",
    "--transport",
    "tcp",
    "--host",
    "127.0.0.1",
    "--port",
    "50455",
    "--k1",
    "0.9",
    "--b",
    "0.4",
    "--threads",
    "1",
  ]);
});

test("buildBm25ServerTcpArgs preserves explicit BM25 tuning env overrides", () => {
  const args = buildBm25ServerTcpArgs("indexes/demo", "0.0.0.0", 60000, {
    PI_BM25_K1: " 1.7 ",
    PI_BM25_B: " 0.2 ",
    PI_BM25_THREADS: " 8 ",
  });
  assert.deepEqual(args, [
    "scripts/bm25_server.sh",
    "--index-path",
    "indexes/demo",
    "--transport",
    "tcp",
    "--host",
    "0.0.0.0",
    "--port",
    "60000",
    "--k1",
    "1.7",
    "--b",
    "0.2",
    "--threads",
    "8",
  ]);
});
