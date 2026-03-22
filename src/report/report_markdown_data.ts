import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { detectBenchmarkManifestSnapshot } from "../benchmarks/run_manifest";
import { resolveInternalRetrievalMetricSemantics } from "../benchmarks/registry";
import {
  type EvaluationCutoffs,
  type EvaluationMetricSemantics,
  type EvaluationResult,
  evaluateRankings,
  type Qrels,
  getRunFiles,
  readQrels,
  readRunDir,
  resolveBenchmarkResultDir,
} from "../retrieval_metrics";
import type {
  BenchmarkRun,
  CoverageSummary,
  HitDepthSummary,
  PrefixMetricRow,
  PrefixMetricSpec,
  QueryCoverageRow,
  RunSetup,
  ToolCallRow,
} from "./report_markdown_types";
import { formatPercentFromRate, qrelsLabel } from "./report_markdown_utils";
import { getJudgeEvalSummaryCandidates } from "../output_layout";

export function loadRun(path: string): BenchmarkRun {
  return JSON.parse(readFileSync(path, "utf8")) as BenchmarkRun;
}

function filterQrelsForCoverage(qrels: Qrels, benchmarkId: string): Qrels {
  const semantics = resolveInternalRetrievalMetricSemantics(benchmarkId);
  const recallRelevantThreshold = Math.max(1, semantics.recallRelevantThreshold ?? 1);
  const filtered: Qrels = new Map();
  for (const [queryId, docs] of qrels) {
    const relevantDocs = new Map(
      [...docs.entries()].filter(([, rel]) => rel >= recallRelevantThreshold),
    );
    filtered.set(queryId, relevantDocs);
  }
  return filtered;
}

export function computeCoverageSummary(
  runFiles: string[],
  runDir: string,
  qrelsPath: string,
  benchmarkId: string,
): CoverageSummary {
  const qrels = filterQrelsForCoverage(readQrels(resolve(qrelsPath)), benchmarkId);
  let macroRecallSum = 0;
  let microHits = 0;
  let microGold = 0;

  for (const fileName of runFiles) {
    const run = loadRun(resolve(runDir, fileName));
    const retrieved = new Set((run.retrieved_docids ?? []).map(String));
    const gold = qrels.get(String(run.query_id)) ?? new Map<string, number>();
    let hits = 0;
    for (const docid of gold.keys()) {
      if (retrieved.has(docid)) hits += 1;
    }
    const goldCount = gold.size;
    macroRecallSum += goldCount > 0 ? hits / goldCount : 0;
    microHits += hits;
    microGold += goldCount;
  }

  return {
    label: qrelsLabel(qrelsPath),
    path: resolve(qrelsPath),
    hits: microHits,
    gold: microGold,
    macroRecall: runFiles.length > 0 ? macroRecallSum / runFiles.length : 0,
    microRecall: microGold > 0 ? microHits / microGold : 0,
  };
}

export function detectEvalSummaryPath(
  runRoot: string,
  benchmarkId: string,
  explicitPath?: string,
): string | undefined {
  if (explicitPath) {
    const resolved = resolve(explicitPath);
    return existsSync(resolved) ? resolved : undefined;
  }

  return getJudgeEvalSummaryCandidates({ runDir: runRoot, benchmarkId }).find((candidate) =>
    existsSync(candidate),
  );
}

export function buildQueryCoverageRows(
  runFiles: string[],
  runDir: string,
  qrelsPath: string,
  benchmarkId: string,
): QueryCoverageRow[] {
  const qrels = filterQrelsForCoverage(readQrels(resolve(qrelsPath)), benchmarkId);
  const rows: QueryCoverageRow[] = [];

  for (const fileName of runFiles) {
    const run = loadRun(resolve(runDir, fileName));
    const queryId = String(run.query_id);
    const retrieved = new Set((run.retrieved_docids ?? []).map(String));
    const gold = qrels.get(queryId) ?? new Map<string, number>();
    let hits = 0;
    for (const docid of gold.keys()) {
      if (retrieved.has(docid)) hits += 1;
    }
    const goldCount = gold.size;
    rows.push({
      queryId,
      status: run.status,
      agentSetRecall: goldCount > 0 ? hits / goldCount : 0,
      retrievedCount: retrieved.size,
      goldCount,
    });
  }

  return rows.sort((left, right) => Number(left.queryId) - Number(right.queryId));
}

export function buildToolCallRows(runFiles: string[], runDir: string): ToolCallRow[] {
  return runFiles
    .map((fileName) => {
      const run = loadRun(resolve(runDir, fileName));
      return {
        queryId: String(run.query_id),
        status: run.status,
        total: run.stats?.tool_calls_total ?? 0,
        search: run.stats?.search_calls ?? 0,
        browse: run.stats?.read_search_results_calls ?? 0,
        read: run.stats?.read_document_calls ?? 0,
      };
    })
    .sort((left, right) => Number(left.queryId) - Number(right.queryId));
}

export function buildPrefixMetricSpecs(cutoffs: EvaluationCutoffs): PrefixMetricSpec[] {
  return [
    ...cutoffs.recallCutoffs.map((cutoff) => ({
      key: `recall@${cutoff}`,
      label: `recall@${cutoff}`,
      summaryLabel: `recall@${cutoff}`,
      extractFromResult: (result: EvaluationResult) => result.macroRecallByCutoff.get(cutoff) ?? 0,
    })),
    ...cutoffs.ndcgCutoffs.map((cutoff) => ({
      key: `ndcg@${cutoff}`,
      label: `ndcg@${cutoff}`,
      summaryLabel: `ndcg@${cutoff}`,
      extractFromResult: (result: EvaluationResult) => result.ndcgByCutoff.get(cutoff) ?? 0,
    })),
    ...cutoffs.mrrCutoffs.map((cutoff) => ({
      key: `mrr@${cutoff}`,
      label: `mrr@${cutoff}`,
      summaryLabel: `mrr@${cutoff}`,
      extractFromResult: (result: EvaluationResult) => result.mrrByCutoff.get(cutoff) ?? 0,
    })),
    {
      key: "map",
      label: "map",
      summaryLabel: "map",
      extractFromResult: (result: EvaluationResult) => result.map,
    },
  ];
}

export function buildPrefixMetricRows(
  rankings: ReturnType<typeof readRunDir>,
  qrels: Qrels,
  cutoffs: EvaluationCutoffs,
  metricSpecs: PrefixMetricSpec[],
  semantics?: EvaluationMetricSemantics,
): PrefixMetricRow[] {
  const rows: PrefixMetricRow[] = [];

  for (const queryId of [...rankings.keys()].sort((left, right) => Number(left) - Number(right))) {
    const result = evaluateRankings(qrels, rankings, [queryId], cutoffs, semantics);
    rows.push({
      queryId,
      metrics: new Map(metricSpecs.map((spec) => [spec.key, spec.extractFromResult(result)])),
    });
  }

  return rows;
}

export function computeHitDepthSummary(
  runFiles: string[],
  runDir: string,
  qrelsPath: string,
  benchmarkId: string,
): HitDepthSummary {
  const qrels = filterQrelsForCoverage(readQrels(resolve(qrelsPath)), benchmarkId);
  const allHitDepths: number[] = [];
  const firstHitDepths: number[] = [];
  const perQueryMeanHitDepths: number[] = [];
  let queriesWithHits = 0;
  let queriesWithoutHits = 0;

  for (const fileName of runFiles) {
    const run = loadRun(resolve(runDir, fileName));
    const queryId = String(run.query_id);
    const retrieved = (run.retrieved_docids ?? []).map(String);
    const depthByDocId = new Map<string, number>();
    for (let index = 0; index < retrieved.length; index += 1) {
      const docId = retrieved[index];
      if (!depthByDocId.has(docId)) {
        depthByDocId.set(docId, index + 1);
      }
    }

    const relevantDocIds = qrels.get(queryId)?.keys() ?? [];
    const hitDepths = [...relevantDocIds]
      .map((docId) => depthByDocId.get(docId))
      .filter((depth): depth is number => typeof depth === "number")
      .sort((left, right) => left - right);

    if (hitDepths.length === 0) {
      queriesWithoutHits += 1;
      continue;
    }

    queriesWithHits += 1;
    allHitDepths.push(...hitDepths);
    firstHitDepths.push(hitDepths[0]);
    perQueryMeanHitDepths.push(hitDepths.reduce((sum, depth) => sum + depth, 0) / hitDepths.length);
  }

  return {
    label: qrelsLabel(qrelsPath),
    queriesWithHits,
    queriesWithoutHits,
    totalHits: allHitDepths.length,
    allHitDepths,
    firstHitDepths,
    perQueryMeanHitDepths,
  };
}

export function buildPrefixMetricExplanation(): string {
  return "Let `S_q = [s_1, s_2, ..., s_m]` be the final accumulated `retrieved_docids` sequence for query `q`, and let `G_q` be that query's relevant docid set. Prefix-of-agent-set metrics are computed on prefixes `S_q[:k]` of this final sequence, not on individual search calls. In particular, `Recall@k(q) = |G_q ∩ S_q[:k]| / |G_q|`. `MRR@k(q) = 1 / r_q` if the first relevant doc appears at rank `r_q <= k`, else `0`. `AP(q) = (1 / |G_q|) * sum_r P@r(q) * rel_q(r)` over ranks in the final sequence, where `rel_q(r)` indicates whether rank `r` is relevant. `nDCG@k(q) = DCG@k(q) / IDCG@k(q)` with `DCG@k(q) = sum_{r=1..k} rel_q(r) / log2(r + 1)`. Lower-level search or browse steps can revisit or expose documents earlier, but the reported metrics are always taken from the final accumulated sequence seen by the agent.";
}

export function buildHitDepthExplanation(): string {
  return "These beeswarm plots show three complementary views of hit depth. For a query with relevant-hit depths `D_q = {d_1, ..., d_n}`, `First(q) = min(D_q)` is the earliest relevant document found for that query, and `Mean(q) = (1 / n) * sum_{i=1..n} d_i` is the average depth of that query’s relevant hits. `All hits` is not a per-query summary: it pools every depth from every `D_q` across all queries into one distribution, so queries with more relevant hits contribute more observations. Lower values are better in all three views because they mean relevant material appears earlier in the final accumulated `retrieved_docids` sequence. The x-axis uses log-scaled spacing (`log1p`) so both the dense early-hit region and the long tail remain readable, while tick labels stay in raw depth units.";
}

export function buildCoverageRow(summary: CoverageSummary): string[] {
  return [
    summary.label,
    formatPercentFromRate(summary.macroRecall),
    formatPercentFromRate(summary.microRecall),
    `${summary.hits} / ${summary.gold}`,
  ];
}

function loadRunSetupFromLog(runRoot: string): RunSetup | undefined {
  const runLogPath = resolve(runRoot, "logs", "run.log");
  if (!existsSync(runLogPath)) return undefined;

  const keyMap: Record<string, keyof RunSetup> = {
    SLICE: "slice",
    MODEL: "model",
    QUERY_FILE: "queryFile",
    QRELS_FILE: "qrelsFile",
    SHARD_COUNT: "shardCount",
    TOTAL_QUERIES: "totalQueries",
    TIMEOUT_SECONDS: "timeoutSeconds",
    INDEX_PATH: "indexPath",
    BM25_K1: "bm25K1",
    BM25_B: "bm25B",
    BM25_THREADS: "bm25Threads",
    MAX_SHARD_ATTEMPTS: "maxShardAttempts",
    SHARD_RETRY_MODE: "shardRetryMode",
  };

  const setup: RunSetup = {};
  const lines = readFileSync(runLogPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    const [, key, value] = match;
    const field = keyMap[key];
    if (!field || setup[field] !== undefined) continue;
    setup[field] = value.trim();
  }

  return Object.keys(setup).length > 0 ? setup : undefined;
}

function loadRunSetupFromArtifact(runRoot: string): RunSetup | undefined {
  const path = resolve(runRoot, "run_setup.json");
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf8")) as RunSetup;
}

function buildFallbackRunSetup(runRoot: string): RunSetup | undefined {
  const manifest = detectBenchmarkManifestSnapshot(runRoot);
  const benchmarkResultDir = resolveBenchmarkResultDir(runRoot);
  const runFiles = getRunFiles(benchmarkResultDir);
  const firstRun =
    runFiles.length > 0 ? loadRun(resolve(benchmarkResultDir, runFiles[0])) : undefined;

  const setup: RunSetup = {
    slice: manifest?.snapshot.query_set_id,
    model: typeof firstRun?.metadata?.model === "string" ? firstRun.metadata.model : undefined,
    queryFile: manifest?.snapshot.query_path,
    qrelsFile: manifest?.snapshot.qrels_path,
    totalQueries: runFiles.length > 0 ? String(runFiles.length) : undefined,
    indexPath: manifest?.snapshot.index_path,
  };

  return Object.values(setup).some((value) => value !== undefined) ? setup : undefined;
}

export function loadRunSetup(runRoot: string): RunSetup | undefined {
  const setupFromLog = loadRunSetupFromLog(runRoot);
  const setupFromArtifact = loadRunSetupFromArtifact(runRoot);
  const fallbackSetup = buildFallbackRunSetup(runRoot);
  const merged = {
    ...fallbackSetup,
    ...setupFromLog,
    ...setupFromArtifact,
  } satisfies RunSetup;
  return Object.values(merged).some((value) => value !== undefined) ? merged : undefined;
}
