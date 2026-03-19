import { resolve } from "node:path";
import {
  evaluateRankings,
  getMetricValue,
  readQrels,
  readQueryIds,
  readRunFile,
  roundMetric,
  type Qrels,
  type Rankings,
} from "./retrieval_metrics";

type Args = {
  baselineRunPath: string;
  candidateRunPath: string;
  qrelsPath: string;
  secondaryQrelsPath?: string;
  queryTsv: string;
  ndcgCutoff: number;
  recallCutoff: number;
};

type BucketSummary = {
  label: string;
  queryIds: string[];
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    baselineRunPath: "data/browsecomp-plus/source/bm25_pure.trec",
    candidateRunPath: "",
    qrelsPath: "data/browsecomp-plus/qrels/qrel_evidence.txt",
    secondaryQrelsPath: "data/browsecomp-plus/qrels/qrel_gold.txt",
    queryTsv: "data/browsecomp-plus/queries/qfull.tsv",
    ndcgCutoff: 10,
    recallCutoff: 1000,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    switch (arg) {
      case "--baselineRun":
      case "--baseline-run":
        if (!next) throw new Error(`${arg} requires a value`);
        args.baselineRunPath = next;
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

  return args;
}

function printHelpAndExit(): never {
  console.log(`Usage: npx tsx src/compare_bm25_runs.ts --candidateRun runs/<candidate>.trec [options]

Options:
  --baselineRun, --baseline-run      Baseline run file (default: data/browsecomp-plus/source/bm25_pure.trec)
  --candidateRun, --candidate-run    Candidate run file to compare against the baseline
  --qrels                            Primary qrels path (default: data/browsecomp-plus/qrels/qrel_evidence.txt)
  --secondaryQrels                   Optional secondary qrels path (default: data/browsecomp-plus/qrels/qrel_gold.txt)
  --noSecondaryQrels                 Disable secondary qrels reporting
  --queries, --queryTsv              Query TSV used for evaluation (default: data/browsecomp-plus/queries/qfull.tsv)
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

function recallAt(rankings: Rankings, qrels: Qrels, queryId: string, cutoff: number): number {
  const rankedDocids = uniqueRankedDocids(rankings, queryId).slice(0, cutoff);
  const relevant = qrels.get(queryId) ?? new Map<string, number>();
  if (relevant.size === 0) return 0;
  let hits = 0;
  for (const docid of rankedDocids) {
    if (relevant.has(docid)) hits += 1;
  }
  return hits / relevant.size;
}

function buildBuckets(
  queryIds: string[],
  baselineRankings: Rankings,
  qrels: Qrels,
  recallCutoff: number,
): { difficulty: BucketSummary[]; gold: BucketSummary[]; strata: BucketSummary[] } {
  const difficultyMap = new Map<string, string[]>();
  const goldMap = new Map<string, string[]>();
  const stratumMap = new Map<string, string[]>();

  for (const queryId of queryIds) {
    const recall = recallAt(baselineRankings, qrels, queryId, recallCutoff);
    const goldDocs = qrels.get(queryId)?.size ?? 0;
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
): void {
  console.log(`\n${title}`);
  console.log("bucket\tqueries\tbaseline_ndcg\tcandidate_ndcg\tdelta_ndcg\tbaseline_recall\tcandidate_recall\tdelta_recall");

  for (const bucket of buckets) {
    const baseline = evaluateRankings(qrels, baselineRankings, bucket.queryIds, {
      recallCutoffs: [recallCutoff],
      ndcgCutoffs: [ndcgCutoff],
      mrrCutoffs: [10],
    });
    const candidate = evaluateRankings(qrels, candidateRankings, bucket.queryIds, {
      recallCutoffs: [recallCutoff],
      ndcgCutoffs: [ndcgCutoff],
      mrrCutoffs: [10],
    });

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

function printOverall(
  label: string,
  queryIds: string[],
  baselineRankings: Rankings,
  candidateRankings: Rankings,
  qrels: Qrels,
  ndcgCutoff: number,
  recallCutoff: number,
): void {
  const baseline = evaluateRankings(qrels, baselineRankings, queryIds, {
    recallCutoffs: [recallCutoff],
    ndcgCutoffs: [ndcgCutoff],
    mrrCutoffs: [10],
  });
  const candidate = evaluateRankings(qrels, candidateRankings, queryIds, {
    recallCutoffs: [recallCutoff],
    ndcgCutoffs: [ndcgCutoff],
    mrrCutoffs: [10],
  });

  const baselineNdcg = getMetricValue(baseline, `ndcg_cut_${ndcgCutoff}`);
  const candidateNdcg = getMetricValue(candidate, `ndcg_cut_${ndcgCutoff}`);
  const baselineRecall = getMetricValue(baseline, `recall_${recallCutoff}`);
  const candidateRecall = getMetricValue(candidate, `recall_${recallCutoff}`);

  console.log(`\n${label}`);
  console.log(`queries=${queryIds.length}`);
  console.log(`baseline ndcg_cut_${ndcgCutoff}=${roundMetric(baselineNdcg)}`);
  console.log(`candidate ndcg_cut_${ndcgCutoff}=${roundMetric(candidateNdcg)}`);
  console.log(`delta ndcg_cut_${ndcgCutoff}=${roundMetric(candidateNdcg - baselineNdcg)}`);
  console.log(`baseline recall_${recallCutoff}=${roundMetric(baselineRecall)}`);
  console.log(`candidate recall_${recallCutoff}=${roundMetric(candidateRecall)}`);
  console.log(`delta recall_${recallCutoff}=${roundMetric(candidateRecall - baselineRecall)}`);
}

function runComparison(label: string, args: Args, qrelsPath: string): void {
  const queryIds = readQueryIds(resolve(args.queryTsv));
  const qrels = readQrels(resolve(qrelsPath));
  const baselineRankings = readRunFile(resolve(args.baselineRunPath));
  const candidateRankings = readRunFile(resolve(args.candidateRunPath));
  const buckets = buildBuckets(queryIds, baselineRankings, qrels, args.recallCutoff);

  console.log(`\n=== ${label} qrels ===`);
  console.log(`Baseline: ${resolve(args.baselineRunPath)}`);
  console.log(`Candidate: ${resolve(args.candidateRunPath)}`);
  console.log(`Queries: ${resolve(args.queryTsv)}`);
  console.log(`Qrels: ${resolve(qrelsPath)}`);

  printOverall("Overall", queryIds, baselineRankings, candidateRankings, qrels, args.ndcgCutoff, args.recallCutoff);
  printMetricTable(
    `By baseline difficulty bucket (recall@${args.recallCutoff})`,
    buckets.difficulty,
    baselineRankings,
    candidateRankings,
    qrels,
    args.ndcgCutoff,
    args.recallCutoff,
  );
  printMetricTable(
    "By gold-doc-count bucket",
    buckets.gold,
    baselineRankings,
    candidateRankings,
    qrels,
    args.ndcgCutoff,
    args.recallCutoff,
  );
  printMetricTable(
    "By combined stratum",
    buckets.strata,
    baselineRankings,
    candidateRankings,
    qrels,
    args.ndcgCutoff,
    args.recallCutoff,
  );
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  runComparison("primary", args, args.qrelsPath);
  if (args.secondaryQrelsPath) {
    runComparison("secondary", args, args.secondaryQrelsPath);
  }
}

main();
