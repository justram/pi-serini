import type { Bm25HelperRuntime } from "./helper_runtime";
import { PiSearchInvalidToolArgumentsError, PiSearchToolExecutionError } from "./protocol/errors";
import { parseReadDocumentPayload, parseSearchPayload } from "./protocol/parse";
import type {
  PlainSearchParams,
  ReadDocumentParams,
  ReadSearchResultsParams,
} from "./protocol/schemas";
import {
  buildReadSpillFileName,
  buildSearchSpillFileName,
  type ManagedTempSpillDir,
  truncateReadDocumentOutput,
  truncateSearchOutput,
} from "./spill";
import {
  buildSearchPage,
  formatSearchPageText,
  normalizePositiveInteger,
  SearchSessionStore,
} from "./search_cache";
import type {
  ReadDocumentDetails,
  ReadSearchResultsDetails,
  SearchDetails,
  ToolTimingBreakdown,
} from "./tool_types";

const SEARCH_QUERY_MODE = "plain";
const SEARCH_CACHE_K = 1000;
const SEARCH_FIRST_PAGE_LIMIT = 5;
const SEARCH_RESULTS_DEFAULT_LIMIT = 10;

type SpillSequence = () => number;
type ToolExecutionContext = { cwd: string };

type ToolHandlerDeps = {
  helperRuntime: Bm25HelperRuntime;
  searchStore: SearchSessionStore;
  spillDir: ManagedTempSpillDir;
  nextSpillSequence: SpillSequence;
};

function formatReadDocumentText(parsed: ReturnType<typeof parseReadDocumentPayload>): string {
  if (parsed.found === false) {
    return `Document with docid '${parsed.docid ?? "unknown"}' not found.`;
  }

  const docid = parsed.docid ?? "unknown";
  const totalLines = parsed.total_lines ?? 0;
  const returnedLineStart = parsed.returned_line_start ?? 0;
  const returnedLineEnd = parsed.returned_line_end ?? 0;
  const text = parsed.text ?? "";
  const lines = [
    `[docid=${docid} lines ${returnedLineStart}-${returnedLineEnd} of ${totalLines}]`,
    "",
    text,
  ];

  if (parsed.truncated && parsed.next_offset) {
    lines.push("");
    lines.push(
      `[Document truncated. Continue with read_document({"docid":"${docid}","offset":${parsed.next_offset},"limit":${parsed.limit ?? 200}}).]`,
    );
  }

  return lines.join("\n").trim();
}

export async function executeSearchTool(
  params: PlainSearchParams,
  signal: AbortSignal | undefined,
  ctx: ToolExecutionContext,
  deps: ToolHandlerDeps,
) {
  const helper = deps.helperRuntime.getHelper(ctx.cwd);
  const rawQuery = String(params.query ?? "").trim();
  if (!rawQuery) {
    throw new PiSearchInvalidToolArgumentsError(
      "search arguments",
      "query must be a non-empty string.",
    );
  }
  const queryMode = SEARCH_QUERY_MODE;
  const output = await helper.request(
    "search",
    {
      query: rawQuery,
      query_mode: queryMode,
      k: SEARCH_CACHE_K,
      rerank_clues: [],
    },
    signal,
  );

  const parsed = parseSearchPayload(output);
  const results = parsed.results ?? [];
  const searchTiming: ToolTimingBreakdown = {
    searchRpcMs: parsed.timing_ms?.command,
    serverInitMs: parsed.timing_ms?.init,
    serverUptimeMs: parsed.timing_ms?.server_uptime,
  };
  const cached = deps.searchStore.createSearch(rawQuery, parsed.query_mode ?? queryMode, results);
  const page = await buildSearchPage(helper, cached, 1, SEARCH_FIRST_PAGE_LIMIT, signal);
  const fullPageJson = JSON.stringify(page, null, 2);
  const rendered = truncateSearchOutput(
    deps.spillDir,
    buildSearchSpillFileName(page, deps.nextSpillSequence()),
    formatSearchPageText(page),
    fullPageJson,
  );

  return {
    content: [{ type: "text" as const, text: rendered.text }],
    details: {
      searchId: cached.searchId,
      rawQuery,
      queryMode: cached.queryMode,
      k: SEARCH_CACHE_K,
      totalCached: cached.results.length,
      returnedRankStart: page.returnedRankStart,
      returnedRankEnd: page.returnedRankEnd,
      nextOffset: page.nextOffset,
      retrievedDocids: cached.results.map((item) => item.docid),
      timingMs: {
        ...searchTiming,
        ...page.timingMs,
      },
      truncation: rendered.truncation,
      fullOutputPath: rendered.fullOutputPath,
    } satisfies SearchDetails,
  };
}

export async function executeReadSearchResultsTool(
  params: ReadSearchResultsParams,
  signal: AbortSignal | undefined,
  ctx: ToolExecutionContext,
  deps: ToolHandlerDeps,
) {
  const helper = deps.helperRuntime.getHelper(ctx.cwd);
  const offset = normalizePositiveInteger(params.offset, SEARCH_FIRST_PAGE_LIMIT + 1);
  const limit = normalizePositiveInteger(params.limit, SEARCH_RESULTS_DEFAULT_LIMIT);
  const cached = deps.searchStore.getSearch(params.search_id);
  if (!cached) {
    throw new PiSearchInvalidToolArgumentsError(
      "read_search_results arguments",
      `search_id '${params.search_id}' is unknown. Call search(...) first to create a result set.`,
    );
  }

  const page = await buildSearchPage(helper, cached, offset, limit, signal);
  const fullPageJson = JSON.stringify(page, null, 2);
  const rendered = truncateSearchOutput(
    deps.spillDir,
    buildSearchSpillFileName(page, deps.nextSpillSequence()),
    formatSearchPageText(page),
    fullPageJson,
  );

  return {
    content: [{ type: "text" as const, text: rendered.text }],
    details: {
      searchId: cached.searchId,
      rawQuery: cached.rawQuery,
      queryMode: cached.queryMode,
      totalCached: cached.results.length,
      offset,
      limit,
      returnedRankStart: page.returnedRankStart,
      returnedRankEnd: page.returnedRankEnd,
      nextOffset: page.nextOffset,
      retrievedDocids: page.results.map((item) => item.docid),
      timingMs: page.timingMs,
      truncation: rendered.truncation,
      fullOutputPath: rendered.fullOutputPath,
    } satisfies ReadSearchResultsDetails,
  };
}

export async function executeReadDocumentTool(
  params: ReadDocumentParams,
  signal: AbortSignal | undefined,
  ctx: ToolExecutionContext,
  deps: ToolHandlerDeps,
) {
  const helper = deps.helperRuntime.getHelper(ctx.cwd);
  const offset = normalizePositiveInteger(params.offset, 1);
  const limit = normalizePositiveInteger(params.limit, 200);
  const output = await helper.request(
    "read_document",
    {
      docid: params.docid,
      offset,
      limit,
    },
    signal,
  );

  const parsed = parseReadDocumentPayload(output);
  const readTiming: ToolTimingBreakdown = {
    readDocumentRpcMs: parsed.timing_ms?.command,
    serverInitMs: parsed.timing_ms?.init,
    serverUptimeMs: parsed.timing_ms?.server_uptime,
  };
  if (parsed.found === false) {
    throw new PiSearchToolExecutionError(
      "read_document",
      `docid '${params.docid}' was not found. Choose a docid returned by search(...) or read_search_results(...).`,
    );
  }

  const formatted = formatReadDocumentText(parsed);
  const rendered = truncateReadDocumentOutput(
    deps.spillDir,
    buildReadSpillFileName(parsed, deps.nextSpillSequence()),
    formatted,
    formatted,
    parsed,
  );

  return {
    content: [{ type: "text" as const, text: rendered.text }],
    details: {
      docid: params.docid,
      offset,
      limit,
      totalLines: parsed.total_lines ?? 0,
      returnedLineStart: parsed.returned_line_start ?? 0,
      returnedLineEnd: parsed.returned_line_end ?? 0,
      truncated: parsed.truncated ?? false,
      nextOffset: parsed.next_offset ?? undefined,
      timingMs: readTiming,
      outputTruncation: rendered.truncation,
      fullOutputPath: rendered.fullOutputPath,
    } satisfies ReadDocumentDetails,
  };
}
