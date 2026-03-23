import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  getDefaultBenchmarkId,
  listBenchmarks,
  resolveBenchmarkConfig,
} from "../benchmarks/registry";
import { buildTsxCommand } from "../runtime/tsx";
import { runInheritedCommandSync } from "../runtime/process";
import { printCommandJson, printCommandPlan, readEnv } from "../wrappers/downstream_tool_wrappers";

type Args = {
  benchmarkId?: string;
  querySetId?: string;
  dryRun: boolean;
};

function hasAnyFlag(argv: string[], flags: string[]): boolean {
  return argv.some((arg) => flags.includes(arg));
}

function parseArgs(argv: string[]): Args {
  const args: Args = { dryRun: false };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    switch (arg) {
      case "--benchmark":
        if (!next) throw new Error(`${arg} requires a value`);
        args.benchmarkId = next;
        index += 1;
        break;
      case "--query-set":
        if (!next) throw new Error(`${arg} requires a value`);
        args.querySetId = next;
        index += 1;
        break;
      case "--dryRun":
      case "--dry-run":
        args.dryRun = true;
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
      default:
        break;
    }
  }

  return args;
}

function printHelp(): void {
  console.log(`Preferred package entrypoint: npm run tune:bm25 -- [options]\nLow-level direct command: npx tsx src/orchestration/tune_bm25_entry.ts [options]\n\nOptions:
  --benchmark <id>               Benchmark manifest id (default: ${getDefaultBenchmarkId()}; supported: ${listBenchmarks()
    .map((benchmark) => benchmark.id)
    .join(", ")})
  --query-set <id>               Benchmark query set (default: benchmark default query set)
  --dry-run

Compatibility environment:
  BENCHMARK, QUERY_SET, QUERIES_FILE, QRELS_FILE, SECONDARY_QRELS_FILE, INDEX_PATH,
  ANSERINI_JAR, OUTPUT_DIR, METRIC, NDCG_CUTOFF, RECALL_CUTOFF, K1_GRID, B_GRID,
  HITS, THREADS, TOPIC_READER, TOP_K, KEEP_RUNS
`);
}

function main(): void {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);
  const benchmarkConfig = resolveBenchmarkConfig({
    benchmarkId: args.benchmarkId ?? readEnv("BENCHMARK"),
    querySetId: args.querySetId ?? readEnv("QUERY_SET"),
    queryPath: readEnv("QUERIES_FILE") ?? undefined,
    qrelsPath: readEnv("QRELS_FILE") ?? undefined,
    indexPath: readEnv("INDEX_PATH") ?? undefined,
  });

  const secondaryQrelsExplicit = Object.hasOwn(process.env, "SECONDARY_QRELS_FILE");
  const secondaryQrelsPath = secondaryQrelsExplicit
    ? readEnv("SECONDARY_QRELS_FILE")
    : benchmarkConfig.secondaryQrelsPath && existsSync(resolve(benchmarkConfig.secondaryQrelsPath))
      ? benchmarkConfig.secondaryQrelsPath
      : undefined;

  const command = buildTsxCommand(
    "src/orchestration/tune_bm25.ts",
    argv.filter((arg) => arg !== "--dryRun" && arg !== "--dry-run"),
  );

  if (!hasAnyFlag(argv, ["--benchmark"])) {
    command.push("--benchmark", benchmarkConfig.benchmark.id);
  }
  if (!hasAnyFlag(argv, ["--query-set"])) {
    command.push("--query-set", benchmarkConfig.querySetId);
  }
  if (!hasAnyFlag(argv, ["--queries", "--queryTsv", "--query-tsv"])) {
    command.push("--queries", benchmarkConfig.queryPath);
  }
  if (!hasAnyFlag(argv, ["--qrels"])) {
    command.push("--qrels", benchmarkConfig.qrelsPath);
  }
  if (
    !hasAnyFlag(argv, [
      "--secondaryQrels",
      "--secondary-qrels",
      "--noSecondaryQrels",
      "--no-secondary-qrels",
    ])
  ) {
    if (secondaryQrelsPath) {
      command.push("--secondaryQrels", secondaryQrelsPath);
    } else {
      command.push("--noSecondaryQrels");
    }
  }
  if (!hasAnyFlag(argv, ["--index"])) {
    command.push("--index", benchmarkConfig.indexPath);
  }
  if (!hasAnyFlag(argv, ["--anseriniJar", "--anserini-jar"]) && readEnv("ANSERINI_JAR")) {
    command.push("--anseriniJar", readEnv("ANSERINI_JAR") as string);
  }
  if (!hasAnyFlag(argv, ["--outputDir", "--output-dir"]) && readEnv("OUTPUT_DIR")) {
    command.push("--outputDir", readEnv("OUTPUT_DIR") as string);
  }
  if (!hasAnyFlag(argv, ["--metric"]) && readEnv("METRIC")) {
    command.push("--metric", readEnv("METRIC") as string);
  }
  if (!hasAnyFlag(argv, ["--ndcgCutoff", "--ndcg-cutoff"]) && readEnv("NDCG_CUTOFF")) {
    command.push("--ndcgCutoff", readEnv("NDCG_CUTOFF") as string);
  }
  if (!hasAnyFlag(argv, ["--recallCutoff", "--recall-cutoff"]) && readEnv("RECALL_CUTOFF")) {
    command.push("--recallCutoff", readEnv("RECALL_CUTOFF") as string);
  }
  if (!hasAnyFlag(argv, ["--k1"]) && readEnv("K1_GRID")) {
    command.push("--k1", readEnv("K1_GRID") as string);
  }
  if (!hasAnyFlag(argv, ["--b"]) && readEnv("B_GRID")) {
    command.push("--b", readEnv("B_GRID") as string);
  }
  if (!hasAnyFlag(argv, ["--hits"]) && readEnv("HITS")) {
    command.push("--hits", readEnv("HITS") as string);
  }
  if (!hasAnyFlag(argv, ["--threads"]) && readEnv("THREADS")) {
    command.push("--threads", readEnv("THREADS") as string);
  }
  if (!hasAnyFlag(argv, ["--topicReader", "--topic-reader"]) && readEnv("TOPIC_READER")) {
    command.push("--topicReader", readEnv("TOPIC_READER") as string);
  }
  if (!hasAnyFlag(argv, ["--top"]) && readEnv("TOP_K")) {
    command.push("--top", readEnv("TOP_K") as string);
  }
  if (!hasAnyFlag(argv, ["--keepRuns", "--keep-runs"]) && readEnv("KEEP_RUNS") === "1") {
    command.push("--keepRuns");
  }

  printCommandPlan({
    BENCHMARK: benchmarkConfig.benchmark.id,
    QUERY_SET: benchmarkConfig.querySetId,
    QUERY_FILE: benchmarkConfig.queryPath,
    QRELS_FILE: benchmarkConfig.qrelsPath,
    SECONDARY_QRELS_FILE: secondaryQrelsPath,
    INDEX_PATH: benchmarkConfig.indexPath,
    ANSERINI_JAR: readEnv("ANSERINI_JAR") ?? undefined,
    OUTPUT_DIR: readEnv("OUTPUT_DIR") ?? undefined,
    METRIC: readEnv("METRIC") ?? undefined,
    NDCG_CUTOFF: readEnv("NDCG_CUTOFF") ?? undefined,
    RECALL_CUTOFF: readEnv("RECALL_CUTOFF") ?? undefined,
    K1_GRID: readEnv("K1_GRID") ?? undefined,
    B_GRID: readEnv("B_GRID") ?? undefined,
    HITS: readEnv("HITS") ?? undefined,
    THREADS: readEnv("THREADS") ?? undefined,
    TOPIC_READER: readEnv("TOPIC_READER") ?? undefined,
    TOP_K: readEnv("TOP_K") ?? undefined,
    KEEP_RUNS: readEnv("KEEP_RUNS") ?? undefined,
  });
  printCommandJson(command);

  if (args.dryRun || readEnv("PI_SERINI_DRY_RUN") === "1") {
    return;
  }

  runInheritedCommandSync(command);
}

main();
