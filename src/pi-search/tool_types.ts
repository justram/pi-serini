import type { TruncationResult } from "@mariozechner/pi-coding-agent";
import type {
  ReadDocumentPayload,
  SearchResultLite,
  SearchResultPreview,
} from "./protocol/schemas";

export type CachedSearch = {
  searchId: string;
  rawQuery: string;
  queryMode: string;
  results: SearchResultLite[];
  previewCache: Map<string, SearchResultPreview>;
  createdAt: number;
};

export type ToolTimingBreakdown = {
  searchRpcMs?: number;
  renderRpcMs?: number;
  readDocumentRpcMs?: number;
  serverInitMs?: number;
  serverUptimeMs?: number;
};

export type SearchPage = {
  searchId: string;
  rawQuery: string;
  queryMode: string;
  totalCached: number;
  offset: number;
  limit: number;
  returnedRankStart: number;
  returnedRankEnd: number;
  nextOffset?: number;
  timingMs?: ToolTimingBreakdown;
  results: Array<(SearchResultLite & SearchResultPreview) & { rank: number }>;
};

export type SearchDetails = {
  searchId: string;
  rawQuery: string;
  queryMode: string;
  k: number;
  totalCached: number;
  returnedRankStart: number;
  returnedRankEnd: number;
  nextOffset?: number;
  retrievedDocids: string[];
  timingMs?: ToolTimingBreakdown;
  truncation?: TruncationResult;
  fullOutputPath?: string;
};

export type ReadSearchResultsDetails = {
  searchId: string;
  rawQuery: string;
  queryMode: string;
  totalCached: number;
  offset: number;
  limit: number;
  returnedRankStart: number;
  returnedRankEnd: number;
  nextOffset?: number;
  retrievedDocids: string[];
  timingMs?: ToolTimingBreakdown;
  truncation?: TruncationResult;
  fullOutputPath?: string;
};

export type ReadDocumentDetails = {
  docid: string;
  offset: number;
  limit: number;
  totalLines: number;
  returnedLineStart: number;
  returnedLineEnd: number;
  truncated: boolean;
  nextOffset?: number;
  timingMs?: ToolTimingBreakdown;
  outputTruncation?: TruncationResult;
  fullOutputPath?: string;
};

export type ReadDocumentFormatterInput = ReadDocumentPayload;
