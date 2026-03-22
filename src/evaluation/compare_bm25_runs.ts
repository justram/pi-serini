import { resolve } from "node:path";
import {
  getDefaultBenchmarkId,
  resolveBenchmarkCompareConfig,
  resolveBenchmarkConfig,
  resolveInternalRetrievalMetricSemantics,
} from "../benchmarks/registry";
import {
  evaluateRankings,
  getMetricValue,
  readQrels,
  readQueryIds,
  readRunFile,
  roundMetric,
  type EvaluationMetricSemantics,
  type Qrels,
  type Rankings,
} from "./retrieval_metrics";
import {
  getRetrievalEvalMetricValue,
  maybeLoadMatchingRetrievalEvalSummary,
} from "./retrieval_eval_summary";

type Args = {
  benchmarkId: string;
  baselineRunPath: string;
  candidateRunPath: string;
  qrelsPath: string;
  secondaryQrelsPath?: string;
  queryTsv: string;
  querySetId?: string;
  ndcgCutoff: number;
  recallCutoff: number;
};

type BucketSummary = {
  label: string;
  queryIds: string[];
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    benchmarkId: getDefaultBenchmarkId(),
    baselineRunPath: "",
    candidateRunPath: "",
    qrelsPath: "",
    secondaryQrelsPath: undefined,
    queryTsv: "",
    ndcgCutoff: 10,
    recallCutoff: 1000,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    switch (arg) {
      case "--benchmark": {
        if (!next) throw new Error(`${arg} requires a value`);
        const benchmark = resolveBenchmarkConfig({ benchmarkId: next });
        args.benchmarkId = benchmark.benchmark.id;
        index += 1;
        break;
      }
      case "--baselineRun":
      case "--baseline-run":
        if (!next) throw new Error(`${arg} requires a value`);
        args.baselineRunPath = next;
        index += 1;
        break;
      case "--querySet":
      case "--query-set":
        if (!next) throw new Error(`${arg} requires a value`);
        args.querySetId = next;
        index += 1;
        break;
      case "--candidateRun":
      case "--candidate-run":
        if (!next) throw new Error(`${arg} requires a value`);
        args.candidateRunPath = next;
        index += 1;
        break;
      case "--qrels":
        if (!next) throw new Error(`${arg} requires a value`);
        args.qrelsPath = next;
        index += 1;
        break;
      case "--secondaryQrels":
      case "--secondary-qrels":
        if (!next) throw new Error(`${arg} requires a value`);
        args.secondaryQrelsPath = next;
        index += 1;
        break;
      case "--noSecondaryQrels":
      case "--no-secondary-qrels":
        args.secondaryQrelsPath = undefined;
        break;
      case "--queries":
      case "--queryTsv":
      case "--query-tsv":
        if (!next) throw new Error(`${arg} requires a value`);
        args.queryTsv = next;
        index += 1;
        break;
      case "--ndcgCutoff":
      case "--ndcg-cutoff":
        if (!next) throw new Error(`${arg} requires a value`);
        args.ndcgCutoff = Number.parseInt(next, 10);
        index += 1;
        break;
      case "--recallCutoff":
      case "--recall-cutoff":
        if (!next) throw new Error(`${arg} requires a value`);
        args.recallCutoff = Number.parseInt(next, 10);
        index += 1;
        break;
      case "--help":
      case "-h":
        printHelpAndExit();
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!args.candidateRunPath) {
    throw new Error("--candidateRun is required");
  }

  const benchmark = resolveBenchmarkConfig({ benchmarkId: args.benchmarkId });
  const compareQuerySetId = args.querySetId ?? benchmark.benchmark.defaultCompareQuerySetId;
  const compareConfig = resolveBenchmarkCompareConfig({
    benchmarkId: benchmark.benchmark.id,
    querySetId: compareQuerySetId,
  });
  args.querySetId = compareConfig.querySetId;
  args.baselineRunPath ||= compareConfig.baselineRunPath ?? "";
  args.qrelsPath ||= compareConfig.qrelsPath;
  if (args.secondaryQrelsPath === undefined) {
    args.secondaryQrelsPath = compareConfig.secondaryQrelsPath;
  }
  args.queryTsv ||= compareConfig.queryPath;
  if (resolve(args.queryTsv) === resolve(compareConfig.queryPath)) {
    args.querySetId = compareConfig.querySetId;
  }

  return args;
}

function printHelpAndExit(): never {
  console.log(`Usage: npx tsx src/evaluation/compare_bm25_runs.ts --candidateRun runs/<candidate>.trec [options]

Options:
  --benchmark                        Benchmark manifest id (default: ${getDefaultBenchmarkId()})
  --baselineRun, --baseline-run      Baseline run file (default: selected query-set baseline run)
  --candidateRun, --candidate-run    Candidate run file to compare against the baseline
  --querySet, --query-set            Query set id for benchmark-scoped compare defaults
  --qrels                            Primary qrels path (default: benchmark primary qrels)
  --secondaryQrels                   Optional secondary qrels path (default: benchmark secondary qrels)
  --noSecondaryQrels                 Disable secondary qrels reporting
  --queries, --queryTsv              Query TSV used for evaluation (default: selected benchmark compare query set)
  --ndcgCutoff                       nDCG cutoff (default: 10)
  --recallCutoff                     recall cutoff (default: 1000)
`);
  process.exit(0);
}

function difficultyBin(recall: number): string {
  if (recall === 0) return "zero";
  if (recall <= 0.1) return "tiny";
  if (recall <= 0.25) return "low";
  if (recall <= 0.5) return "medium";
  return "high";
}

function goldBin(goldDocs: number): string {
  return goldDocs <= 5 ? "small" : "large";
}

function relevantDocidsForRecall(
  qrels: Qrels,
  queryId: string,
  semantics: EvaluationMetricSemantics,
): Set<string> {
  const threshold = Math.max(1, semantics.recallRelevantThreshold ?? 1);
  const relevant = qrels.get(queryId) ?? new Map<string, number>();
  return new Set(
    [...relevant.entries()].filter(([, rel]) => rel >= threshold).map(([docid]) => docid),
  );
}

function uniqueRankedDocids(rankings: Rankings, queryId: string): string[] {
  const entries = rankings.get(queryId) ?? [];
  const seen = new Set<string>();
  const docids: string[] = [];
  for (const entry of entries) {
    if (seen.has(entry.docid)) continue;
    seen.add(entry.docid);
    docids.push(entry.docid);
  }
  return docids;
}

function recallAt(
  rankings: Rankings,
  qrels: Qrels,
  queryId: string,
  cutoff: number,
  semantics: EvaluationMetricSemantics,
): number {
  const rankedDocids = uniqueRankedDocids(rankings, queryId).slice(0, cutoff);
  const relevantDocids = relevantDocidsForRecall(qrels, queryId, semantics);
  if (relevantDocids.size === 0) return 0;
  let hits = 0;
  for (const docid of rankedDocids) {
    if (relevantDocids.has(docid)) hits += 1;
  }
  return hits / relevantDocids.size;
}

export function buildBuckets(
  queryIds: string[],
  baselineRankings: Rankings,
  qrels: Qrels,
  recallCutoff: number,
  semantics: EvaluationMetricSemantics = {},
): { difficulty: BucketSummary[]; gold: BucketSummary[]; strata: BucketSummary[] } {
  const difficultyMap = new Map<string, string[]>();
  const goldMap = new Map<string, string[]>();
  const stratumMap = new Map<string, string[]>();

  for (const queryId of queryIds) {
    const recall = recallAt(baselineRankings, qrels, queryId, recallCutoff, semantics);
    const goldDocs = relevantDocidsForRecall(qrels, queryId, semantics).size;
    const difficulty = difficultyBin(recall);
    const gold = goldBin(goldDocs);
    const stratum = `${difficulty}_${gold}`;

    difficultyMap.set(difficulty, [...(difficultyMap.get(difficulty) ?? []), queryId]);
    goldMap.set(gold, [...(goldMap.get(gold) ?? []), queryId]);
    stratumMap.set(stratum, [...(stratumMap.get(stratum) ?? []), queryId]);
  }

  const order = ["zero", "tiny", "low", "medium", "high"];
  const difficulty = order
    .filter((label) => difficultyMap.has(label))
    .map((label) => ({ label, queryIds: difficultyMap.get(label) ?? [] }));
  const gold = ["small", "large"]
    .filter((label) => goldMap.has(label))
    .map((label) => ({ label, queryIds: goldMap.get(label) ?? [] }));
  const strata = [...stratumMap.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([label, ids]) => ({ label, queryIds: ids }));

  return { difficulty, gold, strata };
}

function printMetricTable(
  title: string,
  buckets: BucketSummary[],
  baselineRankings: Rankings,
  candidateRankings: Rankings,
  qrels: Qrels,
  ndcgCutoff: number,
  recallCutoff: number,
  semantics: Parameters<typeof evaluateRankings>[4],
): void {
  console.log(`\n${title}`);
  console.log(
    "bucket\tqueries\tbaseline_ndcg\tcandidate_ndcg\tdelta_ndcg\tbaseline_recall\tcandidate_recall\tdelta_recall",
  );

  for (const bucket of buckets) {
    const baseline = evaluateRankings(
      qrels,
      baselineRankings,
      bucket.queryIds,
      {
        recallCutoffs: [recallCutoff],
        ndcgCutoffs: [ndcgCutoff],
        mrrCutoffs: [10],
      },
      semantics,
    );
    const candidate = evaluateRankings(
      qrels,
      candidateRankings,
      bucket.queryIds,
      {
        recallCutoffs: [recallCutoff],
        ndcgCutoffs: [ndcgCutoff],
        mrrCutoffs: [10],
      },
      semantics,
    );

    const baselineNdcg = getMetricValue(baseline, `ndcg_cut_${ndcgCutoff}`);
    const candidateNdcg = getMetricValue(candidate, `ndcg_cut_${ndcgCutoff}`);
    const baselineRecall = getMetricValue(baseline, `recall_${recallCutoff}`);
    const candidateRecall = getMetricValue(candidate, `recall_${recallCutoff}`);

    console.log(
      [
        bucket.label,
        String(bucket.queryIds.length),
        roundMetric(baselineNdcg).toFixed(4),
        roundMetric(candidateNdcg).toFixed(4),
        roundMetric(candidateNdcg - baselineNdcg).toFixed(4),
        roundMetric(baselineRecall).toFixed(4),
        roundMetric(candidateRecall).toFixed(4),
        roundMetric(candidateRecall - baselineRecall).toFixed(4),
      ].join("\t"),
    );
  }
}

export function resolveOverallMetrics(options: {
  benchmarkId: string;
  querySetId?: string;
  runPath: string;
  qrelsPath: string;
  queryCount: number;
  queryIds: string[];
  rankings: Rankings;
  qrels: Qrels;
  ndcgCutoff: number;
  recallCutoff: number;
  semantics: Parameters<typeof evaluateRankings>[4];
}): { ndcg: number; recall: number; usedSummary: boolean } {
  const summary = maybeLoadMatchingRetrievalEvalSummary({
    benchmarkId: options.benchmarkId,
    sourcePath: options.runPath,
    qrelsPath: options.qrelsPath,
    sourceType: "run-file",
    querySetId: options.querySetId,
    queryCount: options.queryCount,
    requireQueryCountMatch: false,
  });

  const computed = evaluateRankings(
    options.qrels,
    options.rankings,
    options.queryIds,
    {
      recallCutoffs: [options.recallCutoff],
      ndcgCutoffs: [options.ndcgCutoff],
      mrrCutoffs: [10],
    },
    options.semantics,
  );

  const summaryNdcg = summary
    ? getRetrievalEvalMetricValue(summary, `ndcg_cut_${options.ndcgCutoff}`)
    : undefined;
  const summaryRecall = summary
    ? getRetrievalEvalMetricValue(summary, `recall_${options.recallCutoff}`)
    : undefined;

  return {
    ndcg: summaryNdcg ?? getMetricValue(computed, `ndcg_cut_${options.ndcgCutoff}`),
    recall: summaryRecall ?? getMetricValue(computed, `recall_${options.recallCutoff}`),
    usedSummary: summaryNdcg !== undefined && summaryRecall !== undefined,
  };
}

function printOverall(
  label: string,
  args: Args,
  qrelsPath: string,
  queryIds: string[],
  baselineRankings: Rankings,
  candidateRankings: Rankings,
  qrels: Qrels,
  ndcgCutoff: number,
  recallCutoff: number,
  semantics: Parameters<typeof evaluateRankings>[4],
): void {
  const baseline = resolveOverallMetrics({
    benchmarkId: args.benchmarkId,
    querySetId: args.querySetId,
    runPath: args.baselineRunPath,
    qrelsPath,
    queryCount: queryIds.length,
    queryIds,
    rankings: baselineRankings,
    qrels,
    ndcgCutoff,
    recallCutoff,
    semantics,
  });
  const candidate = resolveOverallMetrics({
    benchmarkId: args.benchmarkId,
    querySetId: args.querySetId,
    runPath: args.candidateRunPath,
    qrelsPath,
    queryCount: queryIds.length,
    queryIds,
    rankings: candidateRankings,
    qrels,
    ndcgCutoff,
    recallCutoff,
    semantics,
  });

  const baselineNdcg = baseline.ndcg;
  const candidateNdcg = candidate.ndcg;
  const baselineRecall = baseline.recall;
  const candidateRecall = candidate.recall;

  console.log(`\n${label}`);
  console.log(`queries=${queryIds.length}`);
  if (baseline.usedSummary || candidate.usedSummary) {
    console.log(
      `retrieval_summary=${baseline.usedSummary ? "baseline" : ""}${baseline.usedSummary && candidate.usedSummary ? "," : ""}${candidate.usedSummary ? "candidate" : ""}`,
    );
  }
  console.log(`baseline ndcg_cut_${ndcgCutoff}=${roundMetric(baselineNdcg)}`);
  console.log(`candidate ndcg_cut_${ndcgCutoff}=${roundMetric(candidateNdcg)}`);
  console.log(`delta ndcg_cut_${ndcgCutoff}=${roundMetric(candidateNdcg - baselineNdcg)}`);
  console.log(`baseline recall_${recallCutoff}=${roundMetric(baselineRecall)}`);
  console.log(`candidate recall_${recallCutoff}=${roundMetric(candidateRecall)}`);
  console.log(`delta recall_${recallCutoff}=${roundMetric(candidateRecall - baselineRecall)}`);
}

function runComparison(
  label: string,
  args: Args,
  qrelsPath: string,
  semantics: Parameters<typeof evaluateRankings>[4],
): void {
  const queryIds = readQueryIds(resolve(args.queryTsv));
  const qrels = readQrels(resolve(qrelsPath));
  const baselineRankings = readRunFile(resolve(args.baselineRunPath));
  const candidateRankings = readRunFile(resolve(args.candidateRunPath));
  const buckets = buildBuckets(queryIds, baselineRankings, qrels, args.recallCutoff, semantics);

  console.log(`\n=== ${label} qrels ===`);
  console.log(`Baseline: ${resolve(args.baselineRunPath)}`);
  console.log(`Candidate: ${resolve(args.candidateRunPath)}`);
  console.log(`Queries: ${resolve(args.queryTsv)}`);
  console.log(`Qrels: ${resolve(qrelsPath)}`);

  printOverall(
    "Overall",
    args,
    qrelsPath,
    queryIds,
    baselineRankings,
    candidateRankings,
    qrels,
    args.ndcgCutoff,
    args.recallCutoff,
    semantics,
  );
  printMetricTable(
    `By baseline difficulty bucket (recall@${args.recallCutoff})`,
    buckets.difficulty,
    baselineRankings,
    candidateRankings,
    qrels,
    args.ndcgCutoff,
    args.recallCutoff,
    semantics,
  );
  printMetricTable(
    "By gold-doc-count bucket",
    buckets.gold,
    baselineRankings,
    candidateRankings,
    qrels,
    args.ndcgCutoff,
    args.recallCutoff,
    semantics,
  );
  printMetricTable(
    "By combined stratum",
    buckets.strata,
    baselineRankings,
    candidateRankings,
    qrels,
    args.ndcgCutoff,
    args.recallCutoff,
    semantics,
  );
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const semantics = resolveInternalRetrievalMetricSemantics(args.benchmarkId);
  runComparison("primary", args, args.qrelsPath, semantics);
  if (args.secondaryQrelsPath) {
    runComparison("secondary", args, args.secondaryQrelsPath, semantics);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
