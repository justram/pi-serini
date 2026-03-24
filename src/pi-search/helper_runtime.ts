import { resolve } from "node:path";
import { getDefaultBenchmarkId, resolveBenchmarkConfig } from "../benchmarks/registry";
import { Bm25StdioRpcClient } from "../bm25/bm25_stdio_rpc_client";
import { Bm25TcpRpcClient } from "../bm25/bm25_tcp_rpc_client";
import type { Bm25RpcClient } from "../bm25/bm25_rpc_client";

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

export class Bm25HelperRuntime {
  private readonly helperByKey = new Map<string, Bm25RpcClient>();

  getHelper(cwd: string): Bm25RpcClient {
    const sharedEndpoint = getSharedHelperEndpoint();
    const key = sharedEndpoint
      ? `rpc:${sharedEndpoint.host}:${sharedEndpoint.port}`
      : `local:${cwd}`;
    let helper = this.helperByKey.get(key);
    if (!helper) {
      helper = sharedEndpoint
        ? new Bm25TcpRpcClient({ host: sharedEndpoint.host, port: sharedEndpoint.port })
        : new Bm25StdioRpcClient({
            cwd,
            indexPath: getHelperPaths(cwd).indexPath,
            env: process.env,
          });
      this.helperByKey.set(key, helper);
    }
    return helper;
  }

  dispose(): void {
    for (const helper of this.helperByKey.values()) {
      helper.dispose?.();
    }
    this.helperByKey.clear();
  }
}
