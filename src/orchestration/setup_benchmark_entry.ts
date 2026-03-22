import { spawnSync } from "node:child_process";
import {
  getDefaultBenchmarkId,
  listBenchmarks,
  resolveBenchmarkConfig,
  resolveBenchmarkSetupStep,
} from "../benchmarks/registry";
import {
  BENCHMARK_SETUP_STEPS,
  isBenchmarkSetupStep,
  type BenchmarkSetupStep,
} from "../benchmarks/types";

type Args = {
  benchmarkId?: string;
  step?: BenchmarkSetupStep;
  dryRun: boolean;
};

function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function parseStep(value: string): BenchmarkSetupStep {
  if (isBenchmarkSetupStep(value)) {
    return value;
  }
  throw new Error(
    `Unsupported step: ${value}. Expected one of: ${BENCHMARK_SETUP_STEPS.join(", ")}`,
  );
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
      case "--step":
        if (!next) throw new Error(`${arg} requires a value`);
        args.step = parseStep(next);
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
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function printHelp(): void {
  console.log(`Usage: npx tsx src/orchestration/setup_benchmark_entry.ts [options]

Options:
  --benchmark <id>               Benchmark manifest id (default: ${getDefaultBenchmarkId()}; supported: ${listBenchmarks()
    .map((benchmark) => benchmark.id)
    .join(", ")})
  --step <${BENCHMARK_SETUP_STEPS.join("|")}>
  --dry-run
`);
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const benchmarkId = resolveBenchmarkConfig({
    benchmarkId: args.benchmarkId ?? readEnv("BENCHMARK"),
  }).benchmark.id;
  const step = args.step ?? parseStep(readEnv("STEP") ?? "setup");
  const resolved = resolveBenchmarkSetupStep(benchmarkId, step);

  console.log(`BENCHMARK=${resolved.benchmark.id}`);
  console.log(`STEP=${resolved.step}`);
  console.log(`SCRIPT_PATH=${resolved.scriptPath}`);

  if (args.dryRun || readEnv("PI_SERINI_DRY_RUN") === "1") {
    return;
  }

  const result = spawnSync("bash", [resolved.scriptPath], {
    stdio: "inherit",
    env: {
      ...process.env,
      BENCHMARK: resolved.benchmark.id,
      STEP: resolved.step,
    },
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

main();
