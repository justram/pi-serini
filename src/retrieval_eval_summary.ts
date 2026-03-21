import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname, resolve } from "node:path";

import type { BenchmarkNdcgGainMode } from "./benchmarks/types";

export type RetrievalEvalMetricSummary = {
  metric: string;
  scope: string;
  value: number;
  stdout?: string;
};

export type RetrievalEvalMetricSemanticsSummary = {
  ndcgGainMode: BenchmarkNdcgGainMode;
  recallRelevantThreshold: number;
  binaryRelevantThreshold: number;
};

export type RetrievalEvalSummary = {
  benchmarkId: string;
  querySetId: string;
  backend: "internal" | "trec_eval";
  sourceType: "run-file" | "run-dir";
  sourcePath: string;
  qrelsPath: string;
  secondaryQrelsPath?: string;
  queryCount?: number;
  metricSemantics: RetrievalEvalMetricSemanticsSummary;
  metrics: RetrievalEvalMetricSummary[];
};

export function buildRetrievalEvalSummaryPath(options: {
  benchmarkId: string;
  sourcePath: string;
  evalRoot?: string;
}): string {
  const evalRoot = resolve(options.evalRoot ?? "evals/retrieval");
  const sourceBase = basename(options.sourcePath, extname(options.sourcePath));
  return resolve(evalRoot, options.benchmarkId, `${sourceBase}.summary.json`);
}

export function writeRetrievalEvalSummary(path: string, summary: RetrievalEvalSummary): void {
  writeFileSync(path, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
}

export function loadRetrievalEvalSummary(path: string): RetrievalEvalSummary {
  return JSON.parse(readFileSync(path, "utf8")) as RetrievalEvalSummary;
}

export function maybeLoadRetrievalEvalSummary(path?: string): RetrievalEvalSummary | undefined {
  if (!path) return undefined;
  const resolved = resolve(path);
  return existsSync(resolved) ? loadRetrievalEvalSummary(resolved) : undefined;
}

export function getRetrievalEvalMetricValue(
  summary: RetrievalEvalSummary,
  metric: string,
  scope = "all",
): number | undefined {
  return summary.metrics.find((entry) => entry.metric === metric && entry.scope === scope)?.value;
}

export function maybeLoadMatchingRetrievalEvalSummary(options: {
  benchmarkId: string;
  sourcePath: string;
  qrelsPath: string;
  sourceType?: RetrievalEvalSummary["sourceType"];
  querySetId?: string;
  queryCount?: number;
  requireQueryCountMatch?: boolean;
}): RetrievalEvalSummary | undefined {
  const summary = maybeLoadRetrievalEvalSummary(
    buildRetrievalEvalSummaryPath({
      benchmarkId: options.benchmarkId,
      sourcePath: options.sourcePath,
    }),
  );
  if (!summary) return undefined;
  if (summary.benchmarkId !== options.benchmarkId) return undefined;
  if (resolve(summary.sourcePath) !== resolve(options.sourcePath)) return undefined;
  if (resolve(summary.qrelsPath) !== resolve(options.qrelsPath)) return undefined;
  if (options.sourceType && summary.sourceType !== options.sourceType) return undefined;
  if (options.querySetId && summary.querySetId !== options.querySetId) return undefined;
  if (options.queryCount !== undefined) {
    if (summary.queryCount === undefined) {
      if (options.requireQueryCountMatch) return undefined;
    } else if (summary.queryCount !== options.queryCount) {
      return undefined;
    }
  }
  return summary;
}
