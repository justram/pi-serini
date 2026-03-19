import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { basename, resolve } from "node:path";
import {
  evaluateRankings,
  getMetricValue,
  readQrels,
  readQueryIds,
  readRunFile,
  roundMetric,
} from "./retrieval_metrics";

type Args = {
  queriesPath: string;
  qrelsPath: string;
  secondaryQrelsPath?: string;
  indexPath: string;
  anseriniJarPath: string;
  outputDir: string;
  metric: string;
  hits: number;
  threads: number;
  topicReader: string;
  keepRuns: boolean;
  topK: number;
  ndcgCutoff: number;
  recallCutoff: number;
  k1Values: number[];
  bValues: number[];
};

type MetricSummary = {
  map: number;
  ndcg: number;
  recall: number;
  mrr10: number;
};

type TuningRow = {
  k1: number;
  b: number;
  metric: number;
  primary: MetricSummary;
  secondary?: MetricSummary;
  runFile: string;
};

function printHelpAndExit(): never {
  console.log(`Usage: npx tsx src/tune_bm25.ts [options]

Required options:
  --queries <path>               TSV query file
  --qrels <path>                 Qrels file
  --index <path>                 Lucene index path

Optional options:
  --secondaryQrels <path>        Optional secondary qrels file to report alongside the primary one
  --anseriniJar <path>           Anserini fatjar (default: vendor/anserini/anserini-1.6.0-fatjar.jar)
  --outputDir <path>             Output directory (default: runs/bm25_tuning_<timestamp>)
  --metric <name>                Optimization target (default: ndcg_cut_10)
  --ndcgCutoff <n>               nDCG cutoff to report and optimize against (default: 10)
  --recallCutoff <n>             recall cutoff to report and optimize against (default: 1000)
  --k1 <grid>                    k1 grid, e.g. 0.3:1.5:0.1 or 0.6,0.9,1.2 (default: 0.3:1.5:0.1)
  --b <grid>                     b grid, e.g. 0.0:1.0:0.05 (default: 0.0:1.0:0.05)
  --hits <n>                     Retrieval depth for SearchCollection (default: 1000)
  --threads <n>                  Search threads (default: 8)
  --topicReader <name>           SearchCollection topic reader (default: TsvString)
  --top <n>                      Number of top configs to print (default: 10)
  --keepRuns                     Keep per-configuration TREC files instead of deleting non-best runs
  --help, -h                     Show this help

Supported metrics include:
  ndcg_cut_<k>
  macro_recall@<k>
  micro_recall@<k>
  recall_<k>
  map
  recip_rank_<k>
`);
  process.exit(0);
}

function parsePositiveInt(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer, got: ${value}`);
  }
  return parsed;
}

function parseFloatGrid(value: string, flag: string): number[] {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${flag} requires at least one value`);
  }

  if (trimmed.includes(":")) {
    const parts = trimmed.split(":").map((part) => Number.parseFloat(part.trim()));
    if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) {
      throw new Error(`${flag} range syntax must be start:end:step, got: ${value}`);
    }
    const [start, end, step] = parts;
    if (step <= 0) {
      throw new Error(`${flag} step must be > 0, got: ${value}`);
    }
    if (end < start) {
      throw new Error(`${flag} range end must be >= start, got: ${value}`);
    }

    const values: number[] = [];
    const epsilon = step / 1000;
    for (let current = start; current <= end + epsilon; current += step) {
      values.push(Number(current.toFixed(6)));
    }
    return values;
  }

  const values = trimmed
    .split(",")
    .map((part) => Number.parseFloat(part.trim()))
    .filter((part) => Number.isFinite(part));
  if (values.length === 0) {
    throw new Error(`${flag} requires at least one numeric value, got: ${value}`);
  }
  return [...new Set(values.map((item) => Number(item.toFixed(6))))].sort((left, right) => left - right);
}

function timestampLabel(): string {
  const now = new Date();
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mi = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  return `${yyyy}${mm}${dd}_${hh}${mi}${ss}`;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    queriesPath: "data/browsecomp-plus/queries/q9.tsv",
    qrelsPath: "data/browsecomp-plus/qrels/qrel_evidence.txt",
    indexPath: "indexes/browsecomp-plus-bm25-tevatron",
    anseriniJarPath: "vendor/anserini/anserini-1.6.0-fatjar.jar",
    outputDir: `runs/bm25_tuning_${timestampLabel()}`,
    metric: "ndcg_cut_10",
    hits: 1000,
    threads: 8,
    topicReader: "TsvString",
    keepRuns: false,
    topK: 10,
    ndcgCutoff: 10,
    recallCutoff: 1000,
    k1Values: parseFloatGrid("0.3:1.5:0.1", "--k1"),
    bValues: parseFloatGrid("0.0:1.0:0.05", "--b"),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    switch (arg) {
      case "--queries":
      case "--queryTsv":
      case "--query-tsv":
        if (!next) throw new Error(`${arg} requires a value`);
        args.queriesPath = next;
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
      case "--index":
        if (!next) throw new Error(`${arg} requires a value`);
        args.indexPath = next;
        index += 1;
        break;
      case "--anseriniJar":
      case "--anserini-jar":
        if (!next) throw new Error(`${arg} requires a value`);
        args.anseriniJarPath = next;
        index += 1;
        break;
      case "--outputDir":
      case "--output-dir":
        if (!next) throw new Error(`${arg} requires a value`);
        args.outputDir = next;
        index += 1;
        break;
      case "--metric":
        if (!next) throw new Error(`${arg} requires a value`);
        args.metric = next;
        index += 1;
        break;
      case "--ndcgCutoff":
      case "--ndcg-cutoff":
        if (!next) throw new Error(`${arg} requires a value`);
        args.ndcgCutoff = parsePositiveInt(next, arg);
        index += 1;
        break;
      case "--recallCutoff":
      case "--recall-cutoff":
        if (!next) throw new Error(`${arg} requires a value`);
        args.recallCutoff = parsePositiveInt(next, arg);
        index += 1;
        break;
      case "--k1":
        if (!next) throw new Error(`${arg} requires a value`);
        args.k1Values = parseFloatGrid(next, arg);
        index += 1;
        break;
      case "--b":
        if (!next) throw new Error(`${arg} requires a value`);
        args.bValues = parseFloatGrid(next, arg);
        index += 1;
        break;
      case "--hits":
        if (!next) throw new Error(`${arg} requires a value`);
        args.hits = parsePositiveInt(next, arg);
        index += 1;
        break;
      case "--threads":
        if (!next) throw new Error(`${arg} requires a value`);
        args.threads = parsePositiveInt(next, arg);
        index += 1;
        break;
      case "--topicReader":
      case "--topic-reader":
        if (!next) throw new Error(`${arg} requires a value`);
        args.topicReader = next;
        index += 1;
        break;
      case "--top":
        if (!next) throw new Error(`${arg} requires a value`);
        args.topK = parsePositiveInt(next, arg);
        index += 1;
        break;
      case "--keepRuns":
      case "--keep-runs":
        args.keepRuns = true;
        break;
      case "--help":
      case "-h":
        printHelpAndExit();
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function sanitizeNumberLabel(value: number): string {
  return value.toFixed(3).replace(/\.?(0+)$/, "").replace(".", "p");
}

function runSearchCollection(args: Args, k1: number, b: number, runFile: string): void {
  const command = [
    "-cp",
    resolve(args.anseriniJarPath),
    "io.anserini.search.SearchCollection",
    "-topicReader",
    args.topicReader,
    "-topics",
    resolve(args.queriesPath),
    "-index",
    resolve(args.indexPath),
    "-output",
    runFile,
    "-bm25",
    "-bm25.k1",
    String(k1),
    "-bm25.b",
    String(b),
    "-hits",
    String(args.hits),
    "-threads",
    String(args.threads),
    "-runtag",
    `bm25-k1-${sanitizeNumberLabel(k1)}-b-${sanitizeNumberLabel(b)}`,
  ];

  const result = spawnSync("java", command, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error(
      [
        `SearchCollection failed for k1=${k1}, b=${b}`,
        result.stdout.trim(),
        result.stderr.trim(),
      ]
        .filter((part) => part.length > 0)
        .join("\n\n"),
    );
  }
}

function compareRows(left: TuningRow, right: TuningRow): number {
  return (
    right.metric - left.metric ||
    right.primary.map - left.primary.map ||
    right.primary.ndcg - left.primary.ndcg ||
    right.primary.recall - left.primary.recall ||
    right.primary.mrr10 - left.primary.mrr10 ||
    left.k1 - right.k1 ||
    left.b - right.b
  );
}

function summarizeMetrics(
  qrels: ReturnType<typeof readQrels>,
  runFile: string,
  queryIds: string[],
  args: Args,
): MetricSummary {
  const result = evaluateRankings(qrels, readRunFile(runFile), queryIds, {
    recallCutoffs: [...new Set([100, args.recallCutoff])].sort((left, right) => left - right),
    ndcgCutoffs: [...new Set([10, args.ndcgCutoff])].sort((left, right) => left - right),
    mrrCutoffs: [10],
  });
  return {
    map: result.map,
    ndcg: result.ndcgByCutoff.get(args.ndcgCutoff) ?? 0,
    recall: result.macroRecallByCutoff.get(args.recallCutoff) ?? 0,
    mrr10: result.mrrByCutoff.get(10) ?? 0,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const outputDir = resolve(args.outputDir);
  const runsDir = resolve(outputDir, "runs");
  mkdirSync(runsDir, { recursive: true });

  const qrels = readQrels(resolve(args.qrelsPath));
  const secondaryQrels =
    args.secondaryQrelsPath && resolve(args.secondaryQrelsPath) !== resolve(args.qrelsPath)
      ? readQrels(resolve(args.secondaryQrelsPath))
      : undefined;
  const queryIds = readQueryIds(resolve(args.queriesPath));
  const totalConfigs = args.k1Values.length * args.bValues.length;
  const ndcgMetricName = `ndcg_cut_${args.ndcgCutoff}`;
  const recallMetricName = `recall_${args.recallCutoff}`;

  if (args.metric === "ndcg_cut_10") {
    args.metric = ndcgMetricName;
  } else if (args.metric === "recall_1000") {
    args.metric = recallMetricName;
  }

  console.log(`Queries: ${resolve(args.queriesPath)}`);
  console.log(`Primary qrels: ${resolve(args.qrelsPath)}`);
  if (secondaryQrels) {
    console.log(`Secondary qrels: ${resolve(args.secondaryQrelsPath ?? "")}`);
  }
  console.log(`Index: ${resolve(args.indexPath)}`);
  console.log(`Anserini: ${resolve(args.anseriniJarPath)}`);
  console.log(`Output dir: ${outputDir}`);
  console.log(`Metric: ${args.metric}`);
  console.log(`Grid size: ${args.k1Values.length} x ${args.bValues.length} = ${totalConfigs}`);

  const rows: TuningRow[] = [];
  let completed = 0;

  for (const k1 of args.k1Values) {
    for (const b of args.bValues) {
      completed += 1;
      const runFile = resolve(
        runsDir,
        `bm25_k1-${sanitizeNumberLabel(k1)}_b-${sanitizeNumberLabel(b)}.trec`,
      );
      console.log(`[${completed}/${totalConfigs}] k1=${k1.toFixed(3)} b=${b.toFixed(3)}`);
      runSearchCollection(args, k1, b, runFile);
      const primaryResult = evaluateRankings(qrels, readRunFile(runFile), queryIds, {
        recallCutoffs: [...new Set([100, args.recallCutoff])].sort((left, right) => left - right),
        ndcgCutoffs: [...new Set([10, args.ndcgCutoff])].sort((left, right) => left - right),
        mrrCutoffs: [10],
      });
      const row: TuningRow = {
        k1,
        b,
        metric: getMetricValue(primaryResult, args.metric),
        primary: {
          map: primaryResult.map,
          ndcg: primaryResult.ndcgByCutoff.get(args.ndcgCutoff) ?? 0,
          recall: primaryResult.macroRecallByCutoff.get(args.recallCutoff) ?? 0,
          mrr10: primaryResult.mrrByCutoff.get(10) ?? 0,
        },
        secondary: secondaryQrels ? summarizeMetrics(secondaryQrels, runFile, queryIds, args) : undefined,
        runFile,
      };
      rows.push(row);
      console.log(
        `  primary ${args.metric}=${roundMetric(row.metric)} map=${roundMetric(row.primary.map)} ${ndcgMetricName}=${roundMetric(row.primary.ndcg)} ${recallMetricName}=${roundMetric(row.primary.recall)}`,
      );
      if (row.secondary) {
        console.log(
          `  secondary map=${roundMetric(row.secondary.map)} ${ndcgMetricName}=${roundMetric(row.secondary.ndcg)} ${recallMetricName}=${roundMetric(row.secondary.recall)}`,
        );
      }
    }
  }

  rows.sort(compareRows);
  const best = rows[0];
  if (!best) {
    throw new Error("No BM25 configurations were evaluated.");
  }

  const summary = {
    metric: args.metric,
    queriesPath: resolve(args.queriesPath),
    qrelsPath: resolve(args.qrelsPath),
    secondaryQrelsPath: secondaryQrels ? resolve(args.secondaryQrelsPath ?? "") : undefined,
    indexPath: resolve(args.indexPath),
    anseriniJarPath: resolve(args.anseriniJarPath),
    hits: args.hits,
    threads: args.threads,
    topicReader: args.topicReader,
    totalConfigs,
    best: {
      k1: best.k1,
      b: best.b,
      metric: best.metric,
      primary: best.primary,
      secondary: best.secondary,
      runFile: best.runFile,
    },
    rankings: rows.map((row, index) => ({
      rank: index + 1,
      ...row,
    })),
  };

  const tsvHeader = [
    "rank",
    "k1",
    "b",
    "metric",
    "primary_map",
    `primary_${ndcgMetricName}`,
    `primary_${recallMetricName}`,
    "primary_recip_rank_10",
  ];
  if (secondaryQrels) {
    tsvHeader.push(
      "secondary_map",
      `secondary_${ndcgMetricName}`,
      `secondary_${recallMetricName}`,
      "secondary_recip_rank_10",
    );
  }
  tsvHeader.push("run_file");
  const tsvLines = [tsvHeader.join("\t")];
  for (const [index, row] of rows.entries()) {
    const values = [
      String(index + 1),
      row.k1.toFixed(3),
      row.b.toFixed(3),
      roundMetric(row.metric).toFixed(4),
      roundMetric(row.primary.map).toFixed(4),
      roundMetric(row.primary.ndcg).toFixed(4),
      roundMetric(row.primary.recall).toFixed(4),
      roundMetric(row.primary.mrr10).toFixed(4),
    ];
    if (secondaryQrels) {
      values.push(
        roundMetric(row.secondary?.map ?? 0).toFixed(4),
        roundMetric(row.secondary?.ndcg ?? 0).toFixed(4),
        roundMetric(row.secondary?.recall ?? 0).toFixed(4),
        roundMetric(row.secondary?.mrr10 ?? 0).toFixed(4),
      );
    }
    values.push(row.runFile);
    tsvLines.push(values.join("\t"));
  }

  writeFileSync(resolve(outputDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  writeFileSync(resolve(outputDir, "summary.tsv"), `${tsvLines.join("\n")}\n`, "utf8");
  writeFileSync(
    resolve(outputDir, "best.json"),
    `${JSON.stringify({ ...summary.best, metricName: args.metric }, null, 2)}\n`,
    "utf8",
  );

  if (!args.keepRuns) {
    for (const row of rows) {
      if (row.runFile === best.runFile) continue;
      rmSync(row.runFile, { force: true });
    }
  }

  console.log("");
  console.log(`Best configuration for ${args.metric}:`);
  console.log(`  k1=${best.k1.toFixed(3)} b=${best.b.toFixed(3)}`);
  console.log(`  ${args.metric}=${roundMetric(best.metric)}`);
  console.log(`  primary map=${roundMetric(best.primary.map)} ${ndcgMetricName}=${roundMetric(best.primary.ndcg)} ${recallMetricName}=${roundMetric(best.primary.recall)}`);
  if (best.secondary) {
    console.log(
      `  secondary map=${roundMetric(best.secondary.map)} ${ndcgMetricName}=${roundMetric(best.secondary.ndcg)} ${recallMetricName}=${roundMetric(best.secondary.recall)}`,
    );
  }
  console.log(`  kept run: ${best.runFile}`);
  console.log(`  summary: ${resolve(outputDir, "summary.tsv")}`);
  console.log("");
  console.log(`Top ${Math.min(args.topK, rows.length)} configurations:`);
  for (const row of rows.slice(0, args.topK)) {
    console.log(
      [
        `  k1=${row.k1.toFixed(3)}`,
        `b=${row.b.toFixed(3)}`,
        `${args.metric}=${roundMetric(row.metric)}`,
        `primary_map=${roundMetric(row.primary.map)}`,
        `primary_${ndcgMetricName}=${roundMetric(row.primary.ndcg)}`,
        `primary_${recallMetricName}=${roundMetric(row.primary.recall)}`,
        row.secondary
          ? `secondary_${recallMetricName}=${roundMetric(row.secondary.recall)}`
          : undefined,
      ]
        .filter((part): part is string => Boolean(part))
        .join(" "),
    );
  }

  console.log("");
  console.log("Reproduce best run:");
  console.log(
    [
      "java",
      "-cp",
      resolve(args.anseriniJarPath),
      "io.anserini.search.SearchCollection",
      "-topicReader",
      args.topicReader,
      "-topics",
      resolve(args.queriesPath),
      "-index",
      resolve(args.indexPath),
      "-output",
      resolve(outputDir, `best_${basename(best.runFile)}`),
      "-bm25",
      "-bm25.k1",
      String(best.k1),
      "-bm25.b",
      String(best.b),
      "-hits",
      String(args.hits),
      "-threads",
      String(args.threads),
    ].join(" "),
  );
}

main();
