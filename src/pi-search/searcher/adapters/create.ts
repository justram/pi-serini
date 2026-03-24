import { resolve } from "node:path";
import type { Bm25RpcClient } from "../../../bm25/bm25_rpc_client";
import { Bm25StdioRpcClient } from "../../../bm25/bm25_stdio_rpc_client";
import { Bm25TcpRpcClient } from "../../../bm25/bm25_tcp_rpc_client";
import type { PiSearchBackend } from "../contract/interface";
import type { PiSearchExtensionConfig } from "../../config";
import { AnseriniBm25Backend } from "./anserini_bm25/adapter";
import { MockSearchBackend } from "./mock/adapter";

function createAnseriniBm25Helper(cwd: string, config: PiSearchExtensionConfig): Bm25RpcClient {
  if (config.backend.kind !== "anserini-bm25") {
    throw new Error(`Unsupported pi-search backend kind: ${String(config.backend.kind)}`);
  }
  if (config.backend.transport.kind === "tcp") {
    return new Bm25TcpRpcClient({
      host: config.backend.transport.host,
      port: config.backend.transport.port,
    });
  }
  return new Bm25StdioRpcClient({
    cwd,
    indexPath: resolve(cwd, config.backend.transport.indexPath),
    env: process.env,
  });
}

export function buildPiSearchBackendCacheKey(cwd: string, config: PiSearchExtensionConfig): string {
  if (config.backend.kind === "mock") {
    return `mock:${JSON.stringify(config.backend.documents)}`;
  }
  if (config.backend.transport.kind === "tcp") {
    return `anserini-bm25:tcp:${config.backend.transport.host}:${config.backend.transport.port}`;
  }
  return `anserini-bm25:stdio:${resolve(cwd, config.backend.transport.indexPath)}`;
}

export function createPiSearchBackend(
  cwd: string,
  config: PiSearchExtensionConfig,
): PiSearchBackend {
  if (config.backend.kind === "mock") {
    return new MockSearchBackend(config.backend.documents);
  }
  return new AnseriniBm25Backend(createAnseriniBm25Helper(cwd, config));
}
