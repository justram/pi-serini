import type { PiSearchBackendRuntime } from "./searcher/runtime";
import { PiSearchInvalidToolArgumentsError, PiSearchToolExecutionError } from "./protocol/errors";
import type {
  GrepDocumentParams,
  PlainSearchParams,
  ReadDocumentParams,
  ReadSearchResultsParams,
} from "./protocol/schemas";
import {
  buildGrepSpillFileName,
  buildReadSpillFileName,
  buildSearchSpillFileName,
  type ManagedTempSpillDir,
  truncateGrepOutput,
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
  GrepDocumentDetails,
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
  backendRuntime: PiSearchBackendRuntime;
  searchStore: SearchSessionStore;
  spillDir: ManagedTempSpillDir;
  nextSpillSequence: SpillSequence;
};

function formatReadDocumentText(parsed: {
  docid: string;
  totalUnits?: number;
  returnedOffsetStart?: number;
  returnedOffsetEnd?: number;
  text: string;
  truncated: boolean;
  nextOffset?: number;
  limit: number;
}): string {
  const totalLines = parsed.totalUnits ?? 0;
  const returnedLineStart = parsed.returnedOffsetStart ?? 0;
  const returnedLineEnd = parsed.returnedOffsetEnd ?? 0;
  const lines = [
    `[docid=${parsed.docid} lines ${returnedLineStart}-${returnedLineEnd} of ${totalLines}]`,
    "",
    parsed.text,
  ];

  if (parsed.truncated && parsed.nextOffset) {
    lines.push("");
    lines.push(
      `[Document truncated. Continue with read_document({"docid":"${parsed.docid}","offset":${parsed.nextOffset},"limit":${parsed.limit}}).]`,
    );
  }

  return lines.join("\n").trim();
}

function normalizeNonNegInteger(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.floor(value));
}

function formatGrepText(opts: {
  docid: string;
  pattern: string;
  text: string;
  pageMatches: Array<{ start: number; end: number }>;
  totalMatches: number;
  returnedMatchStart: number;
  returnedMatchEnd: number;
  beforeChars: number;
  afterChars: number;
  limit: number;
  nextOffset?: number;
}): string {
  const {
    docid,
    pattern,
    text,
    pageMatches,
    totalMatches,
    returnedMatchStart,
    returnedMatchEnd,
    beforeChars,
    afterChars,
    nextOffset,
    limit,
  } = opts;

  const lines: string[] = [
    `[docid=${docid} grep=${JSON.stringify(pattern)} matches ${returnedMatchStart}-${returnedMatchEnd} of ${totalMatches}]`,
    "",
  ];

  for (let i = 0; i < pageMatches.length; i++) {
    const { start, end } = pageMatches[i];
    const excerptStart = Math.max(0, start - beforeChars);
    const excerptEnd = Math.min(text.length, end + afterChars);
    lines.push(`--- match ${returnedMatchStart + i} (char ${start}) ---`);
    lines.push(text.slice(excerptStart, excerptEnd));
    lines.push("");
  }

  if (nextOffset !== undefined) {
    lines.push(
      `[${returnedMatchEnd - returnedMatchStart + 1} matches shown. Use grep_document({"docid":"${docid}","pattern":${JSON.stringify(pattern)},"offset":${nextOffset},"limit":${limit}}) to see more.]`,
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
  const backend = deps.backendRuntime.getBackend(ctx.cwd);
  const rawQuery = String(params.query ?? "").trim();
  if (!rawQuery) {
    throw new PiSearchInvalidToolArgumentsError(
      "search arguments",
      "query must be a non-empty string.",
    );
  }
  const queryMode = SEARCH_QUERY_MODE;
  const response = await backend.search(
    {
      query: rawQuery,
      limit: SEARCH_CACHE_K,
    },
    signal,
  );

  const searchTiming: ToolTimingBreakdown = {
    searchRpcMs: response.timingMs?.request,
    serverInitMs: response.timingMs?.backendInit,
    serverUptimeMs: response.timingMs?.backendUptime,
  };
  const cached = deps.searchStore.createSearch(rawQuery, queryMode, response.hits);
  const page = buildSearchPage(cached, 1, SEARCH_FIRST_PAGE_LIMIT, searchTiming);
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
      previewedDocids: page.results.map((item) => item.docid),
      timingMs: page.timingMs,
      truncation: rendered.truncation,
      fullOutputPath: rendered.fullOutputPath,
    } satisfies SearchDetails,
  };
}

export async function executeReadSearchResultsTool(
  params: ReadSearchResultsParams,
  _signal: AbortSignal | undefined,
  _ctx: ToolExecutionContext,
  deps: ToolHandlerDeps,
) {
  const offset = normalizePositiveInteger(params.offset, SEARCH_FIRST_PAGE_LIMIT + 1);
  const limit = normalizePositiveInteger(params.limit, SEARCH_RESULTS_DEFAULT_LIMIT);
  const cached = deps.searchStore.getSearch(params.search_id);
  if (!cached) {
    throw new PiSearchInvalidToolArgumentsError(
      "read_search_results arguments",
      `search_id '${params.search_id}' is unknown. Call search(...) first to create a result set.`,
    );
  }

  const page = buildSearchPage(cached, offset, limit);
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
      previewedDocids: page.results.map((item) => item.docid),
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
  const backend = deps.backendRuntime.getBackend(ctx.cwd);
  const offset = normalizePositiveInteger(params.offset, 1);
  const limit = normalizePositiveInteger(params.limit, 200);
  const response = await backend.readDocument(
    {
      docid: params.docid,
      offset,
      limit,
    },
    signal,
  );

  const readTiming: ToolTimingBreakdown = {
    readDocumentRpcMs: response.timingMs?.request,
    serverInitMs: response.timingMs?.backendInit,
    serverUptimeMs: response.timingMs?.backendUptime,
  };
  if (!response.found) {
    throw new PiSearchToolExecutionError(
      "read_document",
      `docid '${params.docid}' was not found. Choose a docid returned by search(...) or read_search_results(...).`,
    );
  }

  const formatted = formatReadDocumentText({
    docid: response.docid,
    totalUnits: response.totalUnits,
    returnedOffsetStart: response.returnedOffsetStart,
    returnedOffsetEnd: response.returnedOffsetEnd,
    text: response.text,
    truncated: response.truncated,
    nextOffset: response.nextOffset,
    limit: response.limit,
  });
  const spillPayload = {
    docid: response.docid,
    offset: response.offset,
    limit: response.limit,
    returned_line_start: response.returnedOffsetStart,
    returned_line_end: response.returnedOffsetEnd,
  };
  const rendered = truncateReadDocumentOutput(
    deps.spillDir,
    buildReadSpillFileName(spillPayload, deps.nextSpillSequence()),
    formatted,
    formatted,
    {
      ...spillPayload,
      truncated: response.truncated,
      next_offset: response.nextOffset,
    },
  );

  return {
    content: [{ type: "text" as const, text: rendered.text }],
    details: {
      docid: params.docid,
      offset,
      limit,
      totalLines: response.totalUnits ?? 0,
      returnedLineStart: response.returnedOffsetStart ?? 0,
      returnedLineEnd: response.returnedOffsetEnd ?? 0,
      truncated: response.truncated,
      nextOffset: response.nextOffset,
      timingMs: readTiming,
      outputTruncation: rendered.truncation,
      fullOutputPath: rendered.fullOutputPath,
    } satisfies ReadDocumentDetails,
  };
}

export async function executeGrepDocumentTool(
  params: GrepDocumentParams,
  signal: AbortSignal | undefined,
  ctx: ToolExecutionContext,
  deps: ToolHandlerDeps,
) {
  let regex: RegExp;
  try {
    regex = new RegExp(params.pattern, "g");
  } catch (e) {
    throw new PiSearchInvalidToolArgumentsError(
      "grep_document arguments",
      `pattern is not a valid regular expression: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  const backend = deps.backendRuntime.getBackend(ctx.cwd);
  const response = await backend.readDocument(
    { docid: params.docid, offset: 1, limit: 2_000_000 },
    signal,
  );

  if (!response.found) {
    throw new PiSearchToolExecutionError(
      "grep_document",
      `docid '${params.docid}' was not found. Choose a docid returned by search(...) or read_search_results(...).`,
    );
  }

  const text = response.text;
  const beforeChars = normalizeNonNegInteger(params.before_chars, 200);
  const afterChars = normalizeNonNegInteger(params.after_chars, 200);
  const offset = normalizePositiveInteger(params.offset, 1);
  const limit = normalizePositiveInteger(params.limit, 20);

  // Collect all matches
  const allMatches: Array<{ start: number; end: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    allMatches.push({ start: m.index, end: m.index + m[0].length });
    if (m[0].length === 0) regex.lastIndex++; // guard against zero-length match infinite loop
  }

  const totalMatches = allMatches.length;

  if (totalMatches === 0) {
    return {
      content: [
        {
          type: "text" as const,
          text: `[docid=${params.docid} grep=${JSON.stringify(params.pattern)} matches 0-0 of 0]`,
        },
      ],
      details: {
        docid: params.docid,
        pattern: params.pattern,
        totalMatches: 0,
        offset,
        limit,
        returnedMatchStart: 0,
        returnedMatchEnd: 0,
        nextOffset: undefined,
      } satisfies GrepDocumentDetails,
    };
  }

  const startIdx = offset - 1;
  const pageMatches = allMatches.slice(startIdx, startIdx + limit);

  if (pageMatches.length === 0) {
    return {
      content: [
        {
          type: "text" as const,
          text: `[docid=${params.docid} grep=${JSON.stringify(params.pattern)} matches 0-0 of ${totalMatches}]`,
        },
      ],
      details: {
        docid: params.docid,
        pattern: params.pattern,
        totalMatches,
        offset,
        limit,
        returnedMatchStart: 0,
        returnedMatchEnd: 0,
        nextOffset: undefined,
      } satisfies GrepDocumentDetails,
    };
  }

  const returnedMatchStart = startIdx + 1;
  const returnedMatchEnd = startIdx + pageMatches.length;
  const nextOffset = returnedMatchEnd < totalMatches ? returnedMatchEnd + 1 : undefined;

  const formatted = formatGrepText({
    docid: params.docid,
    pattern: params.pattern,
    text,
    pageMatches,
    totalMatches,
    returnedMatchStart,
    returnedMatchEnd,
    beforeChars,
    afterChars,
    limit,
    nextOffset,
  });

  const spillPayload = {
    docid: params.docid,
    pattern: params.pattern,
    offset,
    limit,
    nextOffset,
  };
  const rendered = truncateGrepOutput(
    deps.spillDir,
    buildGrepSpillFileName(spillPayload, deps.nextSpillSequence()),
    formatted,
    spillPayload,
  );

  return {
    content: [{ type: "text" as const, text: rendered.text }],
    details: {
      docid: params.docid,
      pattern: params.pattern,
      totalMatches,
      offset,
      limit,
      returnedMatchStart,
      returnedMatchEnd,
      nextOffset,
      outputTruncation: rendered.truncation,
      fullOutputPath: rendered.fullOutputPath,
    } satisfies GrepDocumentDetails,
  };
}
