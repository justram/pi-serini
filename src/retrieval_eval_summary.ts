import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname, resolve } from "node:path";

export type RetrievalEvalMetricSummary = {
  metric: string;
  scope: string;
  value: number;
  stdout?: string;
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
