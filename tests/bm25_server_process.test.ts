import assert from "node:assert/strict";
import test from "node:test";

import { buildBm25ServerStdioArgs, buildBm25ServerTcpArgs } from "../src/bm25/bm25_server_process";

test("buildBm25ServerStdioArgs uses default tuning values when env is unset", () => {
  const args = buildBm25ServerStdioArgs("indexes/demo", {});
  assert.deepEqual(args, [
    "scripts/bm25_server.sh",
    "--index-path",
    "indexes/demo",
    "--k1",
    "0.9",
    "--b",
    "0.4",
    "--threads",
    "1",
  ]);
});

test("buildBm25ServerTcpArgs uses default tuning values when env is unset", () => {
  const args = buildBm25ServerTcpArgs("indexes/demo", "127.0.0.1", 50455, {});
  assert.deepEqual(args, [
    "scripts/bm25_server.sh",
    "--index-path",
    "indexes/demo",
    "--k1",
    "0.9",
    "--b",
    "0.4",
    "--threads",
    "1",
    "--transport",
    "tcp",
    "--host",
    "127.0.0.1",
    "--port",
    "50455",
  ]);
});

test("buildBm25ServerStdioArgs and buildBm25ServerTcpArgs preserve explicit BM25 tuning env overrides", () => {
  const env = {
    PI_BM25_K1: " 1.7 ",
    PI_BM25_B: " 0.2 ",
    PI_BM25_THREADS: " 8 ",
  };

  assert.deepEqual(buildBm25ServerStdioArgs("indexes/demo", env), [
    "scripts/bm25_server.sh",
    "--index-path",
    "indexes/demo",
    "--k1",
    "1.7",
    "--b",
    "0.2",
    "--threads",
    "8",
  ]);

  assert.deepEqual(buildBm25ServerTcpArgs("indexes/demo", "0.0.0.0", 60000, env), [
    "scripts/bm25_server.sh",
    "--index-path",
    "indexes/demo",
    "--k1",
    "1.7",
    "--b",
    "0.2",
    "--threads",
    "8",
    "--transport",
    "tcp",
    "--host",
    "0.0.0.0",
    "--port",
    "60000",
  ]);
});
