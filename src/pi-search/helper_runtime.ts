import { resolve } from "node:path";
import { Bm25StdioRpcClient } from "../bm25/bm25_stdio_rpc_client";
import { Bm25TcpRpcClient } from "../bm25/bm25_tcp_rpc_client";
import type { Bm25RpcClient } from "../bm25/bm25_rpc_client";
import type { PiSearchBackend } from "./backend/interface";
import { AnseriniBm25Backend } from "./backends/anserini_bm25/adapter";
import type { PiSearchExtensionConfig } from "./config";

function createBm25Helper(cwd: string, config: PiSearchExtensionConfig): Bm25RpcClient {
  const backend = config.backend;
  if (backend.kind !== "anserini-bm25") {
    throw new Error(`Unsupported pi-search backend kind: ${String(backend.kind)}`);
  }
  if (backend.transport.kind === "tcp") {
    return new Bm25TcpRpcClient({
      host: backend.transport.host,
      port: backend.transport.port,
    });
  }
  return new Bm25StdioRpcClient({
    cwd,
    indexPath: resolve(cwd, backend.transport.indexPath),
    env: process.env,
  });
}

function buildBackendCacheKey(cwd: string, config: PiSearchExtensionConfig): string {
  const backend = config.backend;
  if (backend.kind !== "anserini-bm25") {
    throw new Error(`Unsupported pi-search backend kind: ${String(backend.kind)}`);
  }
  if (backend.transport.kind === "tcp") {
    return `anserini-bm25:tcp:${backend.transport.host}:${backend.transport.port}`;
  }
  return `anserini-bm25:stdio:${resolve(cwd, backend.transport.indexPath)}`;
}

export class PiSearchBackendRuntime {
  private readonly backendByKey = new Map<string, PiSearchBackend>();

  constructor(private readonly config: PiSearchExtensionConfig) {}

  getBackend(cwd: string): PiSearchBackend {
    const key = buildBackendCacheKey(cwd, this.config);
    let backend = this.backendByKey.get(key);
    if (!backend) {
      backend = new AnseriniBm25Backend(createBm25Helper(cwd, this.config));
      this.backendByKey.set(key, backend);
    }
    return backend;
  }

  dispose(): void {
    for (const backend of this.backendByKey.values()) {
      void backend.close?.();
    }
    this.backendByKey.clear();
  }
}
