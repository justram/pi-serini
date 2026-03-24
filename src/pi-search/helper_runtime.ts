import { resolve } from "node:path";
import { getDefaultBenchmarkId, resolveBenchmarkConfig } from "../benchmarks/registry";
import { Bm25StdioRpcClient } from "../bm25/bm25_stdio_rpc_client";
import { Bm25TcpRpcClient } from "../bm25/bm25_tcp_rpc_client";
import type { Bm25RpcClient } from "../bm25/bm25_rpc_client";
import type { PiSearchBackend } from "./backend/interface";
import { AnseriniBm25Backend } from "./backends/anserini_bm25/adapter";

export function resolveDefaultIndexPath(env: NodeJS.ProcessEnv = process.env): string {
  return resolveBenchmarkConfig({
    benchmarkId: env.BENCHMARK ?? getDefaultBenchmarkId(),
  }).indexPath;
}

function getHelperPaths(cwd: string, env: NodeJS.ProcessEnv = process.env) {
  return {
    indexPath: resolve(cwd, env.PI_BM25_INDEX_PATH ?? resolveDefaultIndexPath(env)),
  };
}

function getSharedHelperEndpoint(env: NodeJS.ProcessEnv = process.env): {
  host: string;
  port: number;
} | null {
  const host = env.PI_BM25_RPC_HOST?.trim();
  const rawPort = env.PI_BM25_RPC_PORT?.trim();
  if (!host || !rawPort) {
    return null;
  }
  const port = Number.parseInt(rawPort, 10);
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error(`Invalid PI_BM25_RPC_PORT=${rawPort}`);
  }
  return { host, port };
}

function createBm25Helper(cwd: string): Bm25RpcClient {
  const sharedEndpoint = getSharedHelperEndpoint();
  return sharedEndpoint
    ? new Bm25TcpRpcClient({ host: sharedEndpoint.host, port: sharedEndpoint.port })
    : new Bm25StdioRpcClient({
        cwd,
        indexPath: getHelperPaths(cwd).indexPath,
        env: process.env,
      });
}

export class PiSearchBackendRuntime {
  private readonly backendByKey = new Map<string, PiSearchBackend>();

  getBackend(cwd: string): PiSearchBackend {
    const sharedEndpoint = getSharedHelperEndpoint();
    const key = sharedEndpoint
      ? `rpc:${sharedEndpoint.host}:${sharedEndpoint.port}`
      : `local:${cwd}`;
    let backend = this.backendByKey.get(key);
    if (!backend) {
      backend = new AnseriniBm25Backend(createBm25Helper(cwd));
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
