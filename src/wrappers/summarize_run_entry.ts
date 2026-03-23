import { spawnSync } from "node:child_process";
import {
  detectShellCompatibleEvalSummary,
  printCommandJson,
  printCommandPlan,
  readEnv,
  resolveWrapperQrels,
} from "./downstream_tool_wrappers";
import { buildNodeTsxCommand } from "../runtime/node_tsx";

type Args = {
  benchmarkId?: string;
  runDir?: string;
  qrelsPath?: string;
  secondaryQrelsPath?: string;
  secondaryQrelsDisabled: boolean;
  evalSummaryPath?: string;
  autoDetectMerged?: boolean;
  dryRun: boolean;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    secondaryQrelsDisabled: false,
    dryRun: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    switch (arg) {
      case "--benchmark":
        if (!next) throw new Error(`${arg} requires a value`);
        args.benchmarkId = next;
        index += 1;
        break;
      case "--runDir":
      case "--run-dir":
        if (!next) throw new Error(`${arg} requires a value`);
        args.runDir = next;
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
        args.secondaryQrelsDisabled = true;
        args.secondaryQrelsPath = undefined;
        break;
      case "--evalSummary":
      case "--eval-summary":
        if (!next) throw new Error(`${arg} requires a value`);
        args.evalSummaryPath = next;
        index += 1;
        break;
      case "--autoDetectMerged":
      case "--auto-detect-merged":
        args.autoDetectMerged = true;
        break;
      case "--noAutoDetectMerged":
      case "--no-auto-detect-merged":
        args.autoDetectMerged = false;
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
  console.log(`Usage: npx tsx src/wrappers/summarize_run_entry.ts [options]

Options:
  --benchmark <id>
  --run-dir <dir>
  --qrels <path>
  --secondary-qrels <path>
  --no-secondary-qrels
  --eval-summary <path>
  --auto-detect-merged
  --no-auto-detect-merged
  --dry-run
`);
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const runDir = args.runDir ?? readEnv("RUN_DIR");
  if (!runDir) {
    throw new Error("RUN_DIR is required, e.g. RUN_DIR=runs/<run>");
  }

  const autoDetectMerged = args.autoDetectMerged ?? (readEnv("AUTO_DETECT_MERGED") ?? "1") === "1";
  const qrelsResolution = resolveWrapperQrels({
    benchmarkId: args.benchmarkId,
    runPath: runDir,
    qrelsPath: args.qrelsPath,
    secondaryQrelsPath: args.secondaryQrelsPath,
    secondaryQrelsDisabled: args.secondaryQrelsDisabled,
  });
  const evalSummaryPath = autoDetectMerged
    ? detectShellCompatibleEvalSummary(
        runDir,
        qrelsResolution.benchmarkId,
        args.evalSummaryPath ?? readEnv("EVAL_SUMMARY"),
      )
    : args.evalSummaryPath ?? readEnv("EVAL_SUMMARY");

  const command = buildNodeTsxCommand("src/evaluation/summarize_run.ts", ["--benchmark", qrelsResolution.benchmarkId, "--runDir", runDir]);
  if (qrelsResolution.includePrimaryQrelsOverride) {
    command.push("--qrels", qrelsResolution.qrelsPath);
  }
  if (qrelsResolution.secondaryQrelsPath) {
    command.push("--secondaryQrels", qrelsResolution.secondaryQrelsPath);
  }
  if (evalSummaryPath) {
    command.push("--evalSummary", evalSummaryPath);
  }

  printCommandPlan({
    BENCHMARK: qrelsResolution.benchmarkId,
    RUN_DIR: runDir,
    USE_RUN_MANIFEST_DEFAULTS: qrelsResolution.manifestPresent,
    QRELS_FILE: qrelsResolution.includePrimaryQrelsOverride ? qrelsResolution.qrelsPath : undefined,
    SECONDARY_QRELS_FILE: qrelsResolution.secondaryQrelsPath,
    EVAL_SUMMARY: evalSummaryPath,
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
