import { createWriteStream } from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import { startBm25ServerTcp } from "../bm25/bm25_server_process";
import { buildTsxCommand } from "../runtime/tsx";
import { resolveBenchmarkAwareSharedLogDir } from "../runtime/output_layout";
import {
  buildBenchmarkQuerySetLaunchEnv,
  parseInteger,
  printBenchmarkQuerySetLaunchPlan,
  readEnv,
  resolveBenchmarkQuerySetLaunchPlan,
} from "../orchestration/benchmark_query_set_launch";
import { getDefaultBenchmarkId, listBenchmarks } from "../benchmarks/registry";

type Args = {
  benchmarkId?: string;
  querySetId?: string;
  logDir?: string;
  host?: string;
  port?: number;
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
      case "--querySet":
      case "--query-set":
        if (!next) throw new Error(`${arg} requires a value`);
        args.querySetId = next;
        index += 1;
        break;
      case "--logDir":
      case "--log-dir":
        if (!next) throw new Error(`${arg} requires a value`);
        args.logDir = next;
        index += 1;
        break;
      case "--host":
        if (!next) throw new Error(`${arg} requires a value`);
        args.host = next;
        index += 1;
        break;
      case "--port":
        if (!next) throw new Error(`${arg} requires a value`);
        args.port = parseInteger(next, "port");
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
  console.log(`Usage: npx tsx src/legacy/launch_shared_bm25_benchmark_entry.ts [options]

Options:
  --benchmark <id>               Benchmark manifest id (default: ${getDefaultBenchmarkId()}; supported: ${listBenchmarks()
    .map((benchmark) => benchmark.id)
    .join(", ")})
  --query-set <id>               Query set id for the selected benchmark (default: benchmark default query set)
  --log-dir <dir>                Override shared log directory; otherwise a benchmark-aware default is used
  --host <host>
  --port <port>
  --dry-run
`);
}

async function isTcpPortListening(host: string, port: number): Promise<boolean> {
  return new Promise<boolean>((resolvePromise) => {
    const socket = net.createConnection({ host, port });
    const finish = (listening: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolvePromise(listening);
    };
    socket.setTimeout(500);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const plan = resolveBenchmarkQuerySetLaunchPlan({
    benchmarkId: args.benchmarkId,
    querySetId: args.querySetId,
  });
  const host = args.host ?? readEnv("PI_BM25_RPC_HOST") ?? "127.0.0.1";
  const port =
    args.port ??
    (readEnv("PI_BM25_RPC_PORT")
      ? parseInteger(readEnv("PI_BM25_RPC_PORT") as string, "PI_BM25_RPC_PORT")
      : 50455);
  const logDir =
    args.logDir ??
    readEnv("LOG_DIR") ??
    resolveBenchmarkAwareSharedLogDir(plan.benchmarkId, plan.querySetId);

  printBenchmarkQuerySetLaunchPlan(plan);
  console.log(`LOG_DIR=${logDir}`);
  console.log(`HOST=${host}`);
  console.log(`PORT=${port}`);
  console.log(`RUN_ENTRYPOINT=src/legacy/run_benchmark_entry.ts`);

  if (args.dryRun || readEnv("PI_SERINI_DRY_RUN") === "1") {
    return;
  }

  if (await isTcpPortListening(host, port)) {
    throw new Error(
      `Port ${port} is already in use. Set PI_BM25_RPC_PORT to a free port or stop the existing listener.`,
    );
  }

  const bm25LogPath = `${logDir}/bm25_server.log`;
  const runLogPath = `${logDir}/run.log`;
  const runLog = createWriteStream(runLogPath, { flags: "a" });
  const server = await startBm25ServerTcp({
    cwd: process.cwd(),
    indexPath: plan.indexPath,
    host,
    port,
    logPath: bm25LogPath,
    env: process.env,
  });

  const cleanup = () => {
    server.stop();
    runLog.end();
  };
  process.once("SIGINT", cleanup);
  process.once("SIGTERM", cleanup);

  console.log(`Shared BM25 RPC daemon ready. Log: ${bm25LogPath}`);

  try {
    const command = buildTsxCommand("src/legacy/run_benchmark_entry.ts");
    const child = spawn(command[0], command.slice(1), {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...buildBenchmarkQuerySetLaunchEnv(plan),
        PI_BM25_RPC_HOST: host,
        PI_BM25_RPC_PORT: String(port),
      },
    });
    const stdout = child.stdout;
    const stderr = child.stderr;
    if (!stdout || !stderr) throw new Error("Failed to capture benchmark stdout/stderr");
    stdout.on("data", (chunk) => {
      process.stdout.write(chunk);
      runLog.write(chunk);
    });
    stderr.on("data", (chunk) => {
      process.stderr.write(chunk);
      runLog.write(chunk);
    });
    const status = await new Promise<number>((resolvePromise, reject) => {
      child.once("error", (error) =>
        reject(error instanceof Error ? error : new Error(String(error))),
      );
      child.once("close", (code, signal) => {
        if (signal) {
          reject(new Error(`shared benchmark run exited with signal ${signal}`));
          return;
        }
        resolvePromise(code ?? 0);
      });
    });
    if (status !== 0) process.exit(status);
  } finally {
    cleanup();
    process.off("SIGINT", cleanup);
    process.off("SIGTERM", cleanup);
  }
}

await main();
