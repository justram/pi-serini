import { basename, dirname, extname, resolve } from "node:path";
import type { EvaluationResult } from "../evaluation/retrieval_metrics";
import type { NumericSummary, PrefixMetricSpec } from "./report_markdown_types";

export function qrelsLabel(path: string): string {
  const name = basename(path).toLowerCase();
  if (name.includes("evidence")) return "evidence";
  if (name.includes("gold")) return "gold";
  return basename(path);
}

export function formatFixed(value: number | null | undefined, digits: number): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "n/a";
  return value.toFixed(digits);
}

export function formatPercent(value: number | null | undefined, digits = 2): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "n/a";
  return `${value.toFixed(digits)}%`;
}

export function formatPercentFromRate(value: number | null | undefined, digits = 2): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "n/a";
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatStat1(value: number | null | undefined): string {
  return formatFixed(value, 1);
}

export function formatJudgeCost(value: number | null | undefined): string {
  return formatFixed(value, 6);
}

export function markdownTable(headers: string[], rows: string[][]): string {
  const headerLine = `| ${headers.join(" | ")} |`;
  const dividerLine = `| ${headers.map(() => "---").join(" | ")} |`;
  const rowLines = rows.map((row) => `| ${row.join(" | ")} |`);
  return [headerLine, dividerLine, ...rowLines].join("\n");
}

export function maybeAddSecondaryPath(
  primaryPath: string,
  secondaryPath?: string,
): string | undefined {
  if (!secondaryPath) return undefined;
  const primaryResolved = resolve(primaryPath);
  const secondaryResolved = resolve(secondaryPath);
  return primaryResolved === secondaryResolved ? undefined : secondaryResolved;
}

export function formatPrefixMetricSummary(
  metricSpecs: PrefixMetricSpec[],
  result: EvaluationResult,
): string {
  return metricSpecs
    .map((spec) => `${spec.summaryLabel}=${formatPercentFromRate(spec.extractFromResult(result))}`)
    .join(", ");
}

export function buildAssetsDir(outputPath: string): string {
  const extension = extname(outputPath);
  const baseName = basename(outputPath, extension || undefined);
  return resolve(dirname(outputPath), `${baseName}_assets`);
}

export function quantile(sortedValues: number[], q: number): number {
  if (sortedValues.length === 0) return 0;
  if (sortedValues.length === 1) return sortedValues[0];
  const position = (sortedValues.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sortedValues[lower];
  const weight = position - lower;
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}

export function summarizeNumbers(values: number[]): NumericSummary {
  const sorted = [...values].sort((left, right) => left - right);
  const count = sorted.length;
  if (count === 0) {
    return { min: 0, p25: 0, median: 0, mean: 0, p75: 0, p90: 0, p95: 0, max: 0 };
  }
  const mean = sorted.reduce((sum, value) => sum + value, 0) / count;
  return {
    min: sorted[0],
    p25: quantile(sorted, 0.25),
    median: quantile(sorted, 0.5),
    mean,
    p75: quantile(sorted, 0.75),
    p90: quantile(sorted, 0.9),
    p95: quantile(sorted, 0.95),
    max: sorted[count - 1],
  };
}
