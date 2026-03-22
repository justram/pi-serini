import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { getDefaultBenchmarkId, resolveBenchmarkConfig } from "./benchmarks/registry";
import { detectBenchmarkManifestSnapshot } from "./benchmarks/run_manifest";
import { getJudgeEvalSummaryCandidates } from "./output_layout";

export function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export function hasEnv(name: string): boolean {
  return Object.hasOwn(process.env, name);
}

export function parseInteger(value: string, label: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} must be an integer; received ${value}`);
  }
  return parsed;
}

export function resolveBenchmarkIdFromRunPath(options: {
  benchmarkId?: string;
  runPath?: string;
}): {
  benchmarkId: string;
  querySetId?: string;
  manifestPresent: boolean;
} {
  const manifest = options.runPath ? detectBenchmarkManifestSnapshot(options.runPath) : null;
  if (manifest) {
    return {
      benchmarkId: manifest.snapshot.benchmark_id,
      querySetId: manifest.snapshot.query_set_id,
      manifestPresent: true,
    };
  }

  const benchmarkId = resolveBenchmarkConfig({
    benchmarkId: options.benchmarkId ?? readEnv("BENCHMARK") ?? getDefaultBenchmarkId(),
  }).benchmark.id;
  return { benchmarkId, querySetId: undefined, manifestPresent: false };
}

export function resolveSecondaryQrelsForWrapper(options: {
  benchmarkId: string;
  manifestPresent: boolean;
  explicitWasSet: boolean;
  explicitValue?: string;
}): string | undefined {
  if (options.explicitWasSet) {
    return options.explicitValue;
  }
  if (options.manifestPresent) {
    return undefined;
  }
  const secondaryPath = resolveBenchmarkConfig({ benchmarkId: options.benchmarkId }).secondaryQrelsPath;
  if (!secondaryPath) {
    return undefined;
  }
  return existsSync(resolve(secondaryPath)) ? secondaryPath : undefined;
}

export function detectShellCompatibleEvalSummary(
  runDir: string,
  benchmarkId: string,
  explicitPath?: string,
): string | undefined {
  if (explicitPath) {
    return explicitPath;
  }

  return getJudgeEvalSummaryCandidates({ runDir, benchmarkId }).find((candidate) =>
    existsSync(candidate),
  );
}

export function printCommandPlan(details: Record<string, string | number | boolean | undefined>): void {
  for (const [key, value] of Object.entries(details)) {
    if (value === undefined) continue;
    console.log(`${key}=${String(value)}`);
  }
}

export function printCommandJson(command: string[]): void {
  console.log(`COMMAND_JSON=${JSON.stringify(command)}`);
}
