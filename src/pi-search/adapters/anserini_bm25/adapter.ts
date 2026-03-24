import type { Bm25RpcClient } from "../../../bm25/bm25_rpc_client";
import { parseReadDocumentPayload, parseSearchPayload } from "../../protocol/parse";
import type { PiSearchBackend } from "../../retrieval_contract/interface";
import type {
  SearchBackendCapabilities,
  SearchBackendReadDocumentRequest,
  SearchBackendReadDocumentResponse,
  SearchBackendSearchRequest,
  SearchBackendSearchResponse,
} from "../../retrieval_contract/types";

const ANSERINI_BM25_CAPABILITIES: SearchBackendCapabilities = {
  backendId: "anserini-bm25",
  supportsScore: true,
  supportsSnippets: false,
  supportsExactTotalHits: false,
};

export class AnseriniBm25Backend implements PiSearchBackend {
  readonly capabilities = ANSERINI_BM25_CAPABILITIES;

  constructor(private readonly helper: Bm25RpcClient) {}

  async search(
    request: SearchBackendSearchRequest,
    signal?: AbortSignal,
  ): Promise<SearchBackendSearchResponse> {
    const output = await this.helper.request(
      "search",
      {
        query: request.query,
        query_mode: "plain",
        k: request.limit,
        rerank_clues: [],
      },
      signal,
    );

    const parsed = parseSearchPayload(output);
    const hits = (parsed.results ?? []).map((result) => ({
      docid: result.docid,
      score: result.score,
    }));

    return {
      hits,
      hasMore: hits.length >= request.limit,
      timingMs: {
        request: parsed.timing_ms?.command,
        backendInit: parsed.timing_ms?.init,
        backendUptime: parsed.timing_ms?.server_uptime,
      },
    };
  }

  async readDocument(
    request: SearchBackendReadDocumentRequest,
    signal?: AbortSignal,
  ): Promise<SearchBackendReadDocumentResponse> {
    const offset = request.offset ?? 1;
    const limit = request.limit ?? 200;
    const output = await this.helper.request(
      "read_document",
      {
        docid: request.docid,
        offset,
        limit,
      },
      signal,
    );

    const parsed = parseReadDocumentPayload(output);
    const timingMs = {
      request: parsed.timing_ms?.command,
      backendInit: parsed.timing_ms?.init,
      backendUptime: parsed.timing_ms?.server_uptime,
    };

    if (parsed.found === false) {
      return {
        found: false,
        docid: parsed.docid ?? request.docid,
        timingMs,
      };
    }

    return {
      found: true,
      docid: parsed.docid ?? request.docid,
      text: parsed.text ?? "",
      offset: parsed.offset ?? offset,
      limit: parsed.limit ?? limit,
      totalUnits: parsed.total_lines,
      returnedOffsetStart: parsed.returned_line_start,
      returnedOffsetEnd: parsed.returned_line_end,
      truncated: parsed.truncated ?? false,
      nextOffset: parsed.next_offset ?? undefined,
      timingMs,
    };
  }

  async close(): Promise<void> {
    this.helper.dispose?.();
  }
}
