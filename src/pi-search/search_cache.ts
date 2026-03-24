import type { Bm25RpcClient } from "../bm25/bm25_rpc_client";
import { parseRenderSearchResultsPayload } from "./protocol/parse";
import type { SearchResultLite, SearchResultPreview } from "./protocol/schemas";
import type { CachedSearch, SearchPage, ToolTimingBreakdown } from "./tool_types";

const MAX_CACHED_SEARCHES = 32;
const SEARCH_RESULTS_DEFAULT_LIMIT = 10;
const SEARCH_SNIPPET_MAX_CHARS = 220;

export function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.floor(value));
}

function formatSearchRequestSummary(cached: Pick<CachedSearch, "rawQuery">): string[] {
  return [`Plain query: ${JSON.stringify(cached.rawQuery)}`];
}

export class SearchSessionStore {
  private readonly searchCache = new Map<string, CachedSearch>();
  private searchCounter = 0;

  createSearch(rawQuery: string, queryMode: string, results: SearchResultLite[]): CachedSearch {
    this.searchCounter += 1;
    const searchId = `s${this.searchCounter}`;
    const cached: CachedSearch = {
      searchId,
      rawQuery,
      queryMode,
      results,
      previewCache: new Map<string, SearchResultPreview>(),
      createdAt: Date.now(),
    };
    this.searchCache.set(searchId, cached);
    this.evictOldSearches();
    return cached;
  }

  getSearch(searchId: string): CachedSearch | undefined {
    return this.searchCache.get(searchId);
  }

  private evictOldSearches(): void {
    while (this.searchCache.size > MAX_CACHED_SEARCHES) {
      const oldestEntry = this.searchCache.entries().next().value as
        | [string, CachedSearch]
        | undefined;
      if (!oldestEntry) return;
      this.searchCache.delete(oldestEntry[0]);
    }
  }
}

export async function buildSearchPage(
  helper: Bm25RpcClient,
  cached: CachedSearch,
  offset: number,
  limit: number,
  signal?: AbortSignal,
): Promise<SearchPage> {
  const normalizedOffset = normalizePositiveInteger(offset, 1);
  const normalizedLimit = normalizePositiveInteger(limit, SEARCH_RESULTS_DEFAULT_LIMIT);
  const totalCached = cached.results.length;
  const startIndex = Math.min(normalizedOffset - 1, totalCached);
  const endIndex = Math.min(startIndex + normalizedLimit, totalCached);
  const pageLiteResults = cached.results.slice(startIndex, endIndex);
  const missingDocids = pageLiteResults
    .map((result) => result.docid)
    .filter((docid) => !cached.previewCache.has(docid));

  let renderTiming: ToolTimingBreakdown | undefined;
  if (missingDocids.length > 0) {
    const output = await helper.request(
      "render_search_results",
      {
        docids: missingDocids,
        snippet_max_chars: SEARCH_SNIPPET_MAX_CHARS,
        highlight_clues: [],
        inline_highlights: false,
      },
      signal,
    );
    const parsed = parseRenderSearchResultsPayload(output);
    renderTiming = {
      renderRpcMs: parsed.timing_ms?.command,
      serverInitMs: parsed.timing_ms?.init,
      serverUptimeMs: parsed.timing_ms?.server_uptime,
    };
    for (const preview of parsed.results ?? []) {
      cached.previewCache.set(preview.docid, preview);
    }
  }

  const pageResults = pageLiteResults.map((result, index) => ({
    ...result,
    ...(cached.previewCache.get(result.docid) ?? {
      title: undefined,
      matched_terms: [],
      excerpt: "",
      excerpt_truncated: false,
    }),
    rank: startIndex + index + 1,
  }));
  const returnedRankStart = pageResults.length > 0 ? pageResults[0].rank : 0;
  const returnedRankEnd = pageResults.length > 0 ? pageResults[pageResults.length - 1].rank : 0;
  const nextOffset = endIndex < totalCached ? endIndex + 1 : undefined;

  return {
    searchId: cached.searchId,
    rawQuery: cached.rawQuery,
    queryMode: cached.queryMode,
    totalCached,
    offset: normalizedOffset,
    limit: normalizedLimit,
    returnedRankStart,
    returnedRankEnd,
    nextOffset,
    timingMs: renderTiming,
    results: pageResults,
  };
}

export function formatSearchPageText(page: SearchPage): string {
  const searchSummary = formatSearchRequestSummary(page);
  if (page.results.length === 0) {
    return [
      `No cached hits remain for search_id=${page.searchId}.`,
      ...searchSummary,
      `Cached hits in this ranking: ${page.totalCached}`,
    ].join("\n");
  }

  const lines = [
    `Showing ranks ${page.returnedRankStart}-${page.returnedRankEnd} of ${page.totalCached} cached hits for search_id=${page.searchId}`,
    ...searchSummary,
    "",
  ];
  for (const result of page.results) {
    lines.push(`${result.rank}. docid=${result.docid} score=${result.score.toFixed(4)}`);
    if (result.title) {
      lines.push(`   Title: ${result.title}`);
    }
    lines.push(`   Excerpt: ${result.excerpt}`);
    if (result.excerpt_truncated) {
      lines.push("   Excerpt preview truncated.");
    }
    lines.push("");
  }
  if (page.nextOffset !== undefined) {
    lines.push(
      `Use read_search_results({"search_id":"${page.searchId}","offset":${page.nextOffset},"limit":${page.limit}}) to inspect more hits from this same ranking.`,
    );
  }
  lines.push("Use read_document(docid) to inspect a specific document in paginated chunks.");
  return lines.join("\n").trim();
}
