import { spawnSync } from "node:child_process";
import {
  hasEnv,
  parseInteger,
  printCommandJson,
  printCommandPlan,
  readEnv,
  resolveBenchmarkIdFromRunPath,
} from "./downstream_tool_wrappers";
import { resolveBenchmarkConfig } from "./benchmarks/registry";
import type { BenchmarkJudgeEvalMode } from "./benchmarks/types";

type Args = {
  benchmarkId?: string;
  inputDir?: string;
  evalDir?: string;
  groundTruthPath?: string;
  qrelEvidencePath?: string;
  judgeMode?: BenchmarkJudgeEvalMode;
  model?: string;
  thinking?: string;
  piBin?: string;
  timeoutSeconds?: number;
  force?: boolean;
  limit?: number;
  dryRun: boolean;
};

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
      case "--inputDir":
      case "--input-dir":
        if (!next) throw new Error(`${arg} requires a value`);
        args.inputDir = next;
        index += 1;
        break;
      case "--evalDir":
      case "--eval-dir":
        if (!next) throw new Error(`${arg} requires a value`);
        args.evalDir = next;
        index += 1;
        break;
      case "--groundTruth":
      case "--ground-truth":
        if (!next) throw new Error(`${arg} requires a value`);
        args.groundTruthPath = next;
        index += 1;
        break;
      case "--qrelEvidence":
      case "--qrel-evidence":
        if (!next) throw new Error(`${arg} requires a value`);
        args.qrelEvidencePath = next;
        index += 1;
        break;
      case "--judgeMode":
      case "--judge-mode":
        if (!next) throw new Error(`${arg} requires a value`);
        if (next !== "gold-answer" && next !== "reference-free") {
          throw new Error(`Unsupported judge mode: ${next}`);
        }
        args.judgeMode = next;
        index += 1;
        break;
      case "--model":
        if (!next) throw new Error(`${arg} requires a value`);
        args.model = next;
        index += 1;
        break;
      case "--thinking":
        if (!next) throw new Error(`${arg} requires a value`);
        args.thinking = next;
        index += 1;
        break;
      case "--pi":
        if (!next) throw new Error(`${arg} requires a value`);
        args.piBin = next;
        index += 1;
        break;
      case "--timeoutSeconds":
      case "--timeout-seconds":
        if (!next) throw new Error(`${arg} requires a value`);
        args.timeoutSeconds = parseInteger(next, "timeoutSeconds");
        index += 1;
        break;
      case "--limit":
        if (!next) throw new Error(`${arg} requires a value`);
        args.limit = parseInteger(next, "limit");
        index += 1;
        break;
      case "--force":
        args.force = true;
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
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function printHelp(): void {
  console.log(`Usage: npx tsx src/evaluate_run_with_pi_entry.ts [options]

Options:
  --benchmark <id>
  --input-dir <dir>
  --eval-dir <dir>
  --ground-truth <path>  Required in gold-answer mode unless the benchmark/run manifest provides a default
  --qrel-evidence <path>
  --judge-mode <gold-answer|reference-free>
  --model <model>
  --thinking <level>
  --pi <path>
  --timeout-seconds <seconds>
  --force
  --limit <n>
  --dry-run
`);
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const inputDir = args.inputDir ?? readEnv("INPUT_DIR");
  if (!inputDir) {
    throw new Error("INPUT_DIR is required, e.g. INPUT_DIR=runs/<run>");
  }

  const benchmarkResolution = resolveBenchmarkIdFromRunPath({
    benchmarkId: args.benchmarkId,
    runPath: inputDir,
  });
  const benchmarkConfig = resolveBenchmarkConfig({ benchmarkId: benchmarkResolution.benchmarkId });
  const judgeMode =
    args.judgeMode ??
    (readEnv("JUDGE_MODE") as BenchmarkJudgeEvalMode | undefined) ??
    benchmarkConfig.benchmark.judgeEvaluation?.defaultMode ??
    (benchmarkConfig.groundTruthPath ? "gold-answer" : "reference-free");
  if (judgeMode !== "gold-answer" && judgeMode !== "reference-free") {
    throw new Error(`Unsupported judge mode: ${judgeMode}`);
  }
  const supportedJudgeModes = benchmarkConfig.benchmark.judgeEvaluation?.supportedModes ?? [
    benchmarkConfig.groundTruthPath ? "gold-answer" : "reference-free",
  ];
  if (!supportedJudgeModes.includes(judgeMode)) {
    throw new Error(
      `Judge mode ${judgeMode} is not supported for benchmark ${benchmarkResolution.benchmarkId}. Supported modes: ${supportedJudgeModes.join(", ")}`,
    );
  }

  const groundTruthWasSet = args.groundTruthPath !== undefined || hasEnv("GROUND_TRUTH");
  const qrelEvidenceWasSet = args.qrelEvidencePath !== undefined || hasEnv("QREL_EVIDENCE");
  const groundTruthPath =
    args.groundTruthPath ?? readEnv("GROUND_TRUTH") ?? benchmarkConfig.groundTruthPath ?? "";
  const qrelEvidencePath =
    args.qrelEvidencePath ?? readEnv("QREL_EVIDENCE") ?? benchmarkConfig.qrelsPath;

  if (
    judgeMode === "gold-answer" &&
    !benchmarkResolution.manifestPresent &&
    !groundTruthWasSet &&
    !groundTruthPath
  ) {
    throw new Error(
      `Judge evaluation in gold-answer mode is not configured by default for benchmark ${benchmarkResolution.benchmarkId}. Pass --groundTruth <path> to opt in explicitly or use --judge-mode reference-free.`,
    );
  }

  const command = [
    "npx",
    "tsx",
    "src/evaluate_run_with_pi.ts",
    "--benchmark",
    benchmarkResolution.benchmarkId,
    "--inputDir",
    inputDir,
    "--evalDir",
    args.evalDir ?? readEnv("EVAL_DIR") ?? "evals/pi_judge",
    "--judgeMode",
    judgeMode,
    "--model",
    args.model ?? readEnv("MODEL") ?? "openai-codex/gpt-5.3-codex",
    "--thinking",
    args.thinking ?? readEnv("THINKING") ?? "low",
    "--pi",
    args.piBin ?? readEnv("PI_BIN") ?? "pi",
    "--timeoutSeconds",
    String(
      args.timeoutSeconds ??
        (readEnv("TIMEOUT_SECONDS")
          ? parseInteger(readEnv("TIMEOUT_SECONDS") as string, "TIMEOUT_SECONDS")
          : 180),
    ),
  ];

  if (
    judgeMode === "gold-answer" &&
    (!benchmarkResolution.manifestPresent || groundTruthWasSet) &&
    groundTruthPath
  ) {
    command.push("--groundTruth", groundTruthPath);
  }
  if (!benchmarkResolution.manifestPresent || qrelEvidenceWasSet) {
    command.push("--qrelEvidence", qrelEvidencePath);
  }
  if (args.force ?? readEnv("FORCE") === "1") {
    command.push("--force");
  }
  const limit =
    args.limit ?? (readEnv("LIMIT") ? parseInteger(readEnv("LIMIT") as string, "LIMIT") : 0);
  if (limit !== 0) {
    command.push("--limit", String(limit));
  }

  printCommandPlan({
    BENCHMARK: benchmarkResolution.benchmarkId,
    INPUT_DIR: inputDir,
    USE_RUN_MANIFEST_DEFAULTS: benchmarkResolution.manifestPresent,
    JUDGE_MODE: judgeMode,
    GROUND_TRUTH:
      judgeMode === "gold-answer" &&
      (!benchmarkResolution.manifestPresent || groundTruthWasSet) &&
      groundTruthPath
        ? groundTruthPath
        : undefined,
    QREL_EVIDENCE:
      !benchmarkResolution.manifestPresent || qrelEvidenceWasSet ? qrelEvidencePath : undefined,
  });
  printCommandJson(command);

  if (args.dryRun || readEnv("PI_SERINI_DRY_RUN") === "1") {
    return;
  }

  const result = spawnSync(command[0], command.slice(1), { stdio: "inherit", env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

main();
