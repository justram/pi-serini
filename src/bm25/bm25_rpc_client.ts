export type Bm25HelperResponse = {
  id?: number;
  type?: string;
  command?: string;
  success?: boolean;
  data?: unknown;
  error?: string;
};

export interface Bm25RpcClient {
  request(
    commandType: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<string>;
  dispose?(): void;
}

export function createBm25RequestAbortError(
  commandType: string,
  phase: "before dispatch" | "during request",
): Error {
  return new Error(`BM25 helper request aborted ${phase} for ${commandType}.`);
}

export function parseBm25HelperResponse(line: string): Bm25HelperResponse {
  const trimmed = line.trim();
  try {
    return JSON.parse(trimmed) as Bm25HelperResponse;
  } catch (error) {
    throw new Error(`Failed to parse BM25 helper RPC response: ${trimmed}\n${String(error)}`);
  }
}

export function resolveBm25HelperResponse(
  response: Bm25HelperResponse,
  expectedId: number,
  commandType: string,
): string {
  if (response.id !== expectedId) {
    throw new Error(
      `BM25 helper RPC response ID mismatch: expected ${expectedId}, received ${String(response.id)}`,
    );
  }
  if (response.type === "response" && response.success) {
    return JSON.stringify(response.data ?? {});
  }
  throw new Error(response.error ?? `BM25 helper RPC ${response.command ?? commandType} failed.`);
}
