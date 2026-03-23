import { spawnSync } from "node:child_process";

type Mode = "run" | "shared" | "sharded";

type Args = {
  mode: Mode;
  slice?: string;
  dryRun: boolean;
  passthrough: string[];
};

type CompatibilityCommand = {
  command: string[];
  env: NodeJS.ProcessEnv;
};

function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function hasAnyFlag(argv: string[], flags: string[]): boolean {
  return argv.some((arg) => flags.includes(arg));
}

function readFlagValue(argv: string[], flags: string[]): string | undefined {
  for (let index = 0; index < argv.length; index += 1) {
    if (!flags.includes(argv[index])) continue;
    return argv[index + 1];
  }
  return undefined;
}

function sanitizeModelTag(model: string): string {
  return model
    .replace(/^openai-codex\//, "")
    .replace(/^openai\//, "")
    .replace(/[^A-Za-z0-9]/g, "")
    .toLowerCase();
}

function formatRunStamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    [date.getFullYear(), pad(date.getMonth() + 1), pad(date.getDate())].join("") +
    `_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

function printHelp(): void {
  console.log(`Usage: npx tsx src/legacy/browsecomp_compat_entry.ts --mode <run|shared|sharded> [options]

Compatibility options:
  --mode <run|shared|sharded>    Historical BrowseComp/q9 launcher mode
  --slice <id>                   BrowseComp slice alias (default: q9 for run/shared, q100 for sharded)
  --dry-run

All other arguments are forwarded to the active Node orchestration entrypoint for the selected mode.

Examples:
  npx tsx src/legacy/browsecomp_compat_entry.ts --mode run --slice q9 --dry-run
  npx tsx src/legacy/browsecomp_compat_entry.ts --mode shared --slice q9 --dry-run
  npx tsx src/legacy/browsecomp_compat_entry.ts --mode sharded --slice q300 --dry-run
`);
}

function parseArgs(argv: string[]): Args {
  let mode: Mode | undefined;
  let slice: string | undefined;
  let dryRun = false;
  const passthrough: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    switch (arg) {
      case "--mode":
        if (!next) throw new Error(`${arg} requires a value`);
        if (next !== "run" && next !== "shared" && next !== "sharded") {
          throw new Error(`Unsupported mode: ${next}. Expected one of: run, shared, sharded`);
        }
        mode = next;
        index += 1;
        break;
      case "--slice":
        if (!next) throw new Error(`${arg} requires a value`);
        slice = next;
        index += 1;
        break;
      case "--dryRun":
      case "--dry-run":
        dryRun = true;
        passthrough.push(arg);
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
      default:
        passthrough.push(arg);
        break;
    }
  }

  if (!mode) {
    throw new Error("--mode is required. Expected one of: run, shared, sharded");
  }

  return { mode, slice, dryRun, passthrough };
}

function buildCompatibilityCommand(args: Args): CompatibilityCommand {
  const defaultSlice = args.mode === "sharded" ? "q100" : "q9";
  const slice = args.slice ?? readEnv("SLICE") ?? defaultSlice;
  const benchmarkId = readEnv("BENCHMARK") ?? "browsecomp-plus";
  const querySetId = readEnv("QUERY_SET") ?? slice;

  const userModel = readFlagValue(args.passthrough, ["--model"]);
  const userPromptVariant = readFlagValue(args.passthrough, [
    "--promptVariant",
    "--prompt-variant",
  ]);
  const userShardCount = readFlagValue(args.passthrough, [
    "--shardCount",
    "--shard-count",
    "--shards",
  ]);
  const userOutputDir = readFlagValue(args.passthrough, [
    "--outputDir",
    "--output-dir",
    "--outputRoot",
    "--output-root",
  ]);
  const userLogDir = readFlagValue(args.passthrough, ["--logDir", "--log-dir"]);

  const command = ["npx", "tsx"];
  const env: NodeJS.ProcessEnv = { ...process.env };

  if (args.mode === "run") {
    command.push("src/orchestration/run_benchmark_query_set.ts");
  } else if (args.mode === "shared") {
    command.push("src/orchestration/launch_benchmark_query_set_shared.ts");
  } else {
    command.push("src/orchestration/launch_benchmark_query_set_sharded_shared.ts");
  }

  if (!hasAnyFlag(args.passthrough, ["--benchmark"])) {
    command.push("--benchmark", benchmarkId);
  }
  if (!hasAnyFlag(args.passthrough, ["--querySet", "--query-set"])) {
    command.push("--query-set", querySetId);
  }

  if (args.mode === "run") {
    if (!hasAnyFlag(args.passthrough, ["--outputDir", "--output-dir"])) {
      command.push(
        "--output-dir",
        readEnv("OUTPUT_DIR") ?? `runs/pi_bm25_${slice}_plain_minimal_excerpt`,
      );
    }
    if (!hasAnyFlag(args.passthrough, ["--promptVariant", "--prompt-variant"])) {
      command.push("--prompt-variant", readEnv("PROMPT_VARIANT") ?? "plain_minimal");
    }
  }

  if (args.mode === "shared") {
    if (!hasAnyFlag(args.passthrough, ["--outputDir", "--output-dir"])) {
      env.OUTPUT_DIR = readEnv("OUTPUT_DIR") ?? `runs/pi_bm25_${slice}_plain_minimal_excerpt`;
    }
    if (!hasAnyFlag(args.passthrough, ["--logDir", "--log-dir"])) {
      command.push("--log-dir", readEnv("LOG_DIR") ?? `runs/shared-bm25-${slice}`);
    }
  }

  if (args.mode === "sharded") {
    const effectiveModel = userModel ?? readEnv("MODEL") ?? "openai-codex/gpt-5.4-mini";
    const effectiveShardCount = userShardCount ?? readEnv("SHARD_COUNT") ?? "4";
    const effectivePromptVariant =
      userPromptVariant ?? readEnv("PROMPT_VARIANT") ?? "plain_minimal";
    const effectiveOutputDir =
      userOutputDir ??
      readEnv("OUTPUT_DIR") ??
      `runs/pi_bm25_${slice}_plain_minimal_excerpt_${sanitizeModelTag(effectiveModel)}_shared${effectiveShardCount}_${formatRunStamp(new Date())}`;

    if (!hasAnyFlag(args.passthrough, ["--shardCount", "--shard-count", "--shards"])) {
      command.push("--shard-count", effectiveShardCount);
    }
    if (!hasAnyFlag(args.passthrough, ["--model"])) {
      command.push("--model", effectiveModel);
    }
    if (!hasAnyFlag(args.passthrough, ["--promptVariant", "--prompt-variant"])) {
      command.push("--prompt-variant", effectivePromptVariant);
    }
    if (
      !hasAnyFlag(args.passthrough, [
        "--outputDir",
        "--output-dir",
        "--outputRoot",
        "--output-root",
      ])
    ) {
      command.push("--output-root", effectiveOutputDir);
      env.OUTPUT_DIR = effectiveOutputDir;
    }
    if (!hasAnyFlag(args.passthrough, ["--logDir", "--log-dir"]) && (userLogDir ?? readEnv("LOG_DIR"))) {
      command.push("--log-dir", userLogDir ?? (readEnv("LOG_DIR") as string));
    }
  }

  return { command: [...command, ...args.passthrough], env };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const { command, env } = buildCompatibilityCommand(args);
  const result = spawnSync(command[0], command.slice(1), {
    stdio: "inherit",
    env,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
  if (result.signal) {
    throw new Error(`compatibility entrypoint exited with signal ${result.signal}`);
  }
}

main();
