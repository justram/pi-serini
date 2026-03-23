import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import net from "node:net";

import { renderManagedPresetPaths, resolveManagedPreset } from "../benchmarks/registry";
import { spawnDetachedCommand } from "../runtime/process";
import { buildTsxCommand } from "../runtime/tsx";

export type ManagedRunPreset =
  | "q9_shared"
  | "q100_sharded"
  | "q300_sharded"
  | "qfull_sharded"
  | "dl19_shared"
  | "dl20_shared"
  | `${string}/${string}`;

export type ManagedRunState = {
  id: string;
  preset: ManagedRunPreset;
  benchmarkId: string;
  querySetId: string;
  rootDir: string;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  finishedAt?: number;
  pid?: number;
  pgid?: number;
  model: string;
  thinking: string;
  timeoutSeconds: number;
  port: number;
  outputDir: string;
  logDir: string;
  launcherScript: string;
  launcherCommand: string[];
  launcherEnv?: Record<string, string>;
  launcherStdoutPath: string;
  launcherStderrPath: string;
  status: "queued" | "launching" | "running" | "finished" | "dead" | "killed" | "failed";
  notes?: string;
};

type LaunchManagedRunOptions = {
  rootDir?: string;
  preset: ManagedRunPreset;
  model: string;
  thinking?: string;
  timeoutSeconds?: number;
  outputDir?: string;
  logDir?: string;
  port?: number;
  queue?: boolean;
  shardCount?: number;
};

const STATE_ROOT_REL = "runs/_bench";
const STATE_DIR_REL = `${STATE_ROOT_REL}/state`;
const EVENTS_DIR_REL = `${STATE_ROOT_REL}/events`;

export type ManagedRunEvent = {
  ts: number;
  runId: string;
  type:
    | "run_registered"
    | "run_queued"
    | "run_started"
    | "status_changed"
    | "kill_requested"
    | "run_killed"
    | "benchmark_started"
    | "query_started"
    | "query_completed"
    | "query_skipped"
    | "benchmark_finished"
    | "shard_retry_approved";
  payload?: Record<string, unknown>;
};

function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

function getStateRoot(rootDir: string): string {
  return resolve(rootDir, STATE_ROOT_REL);
}

function getStateDir(rootDir: string): string {
  return resolve(rootDir, STATE_DIR_REL);
}

function getEventsDir(rootDir: string): string {
  return resolve(rootDir, EVENTS_DIR_REL);
}

function getStatePath(rootDir: string, id: string): string {
  return resolve(getStateDir(rootDir), `${id}.json`);
}

function getEventPath(rootDir: string, id: string): string {
  return resolve(getEventsDir(rootDir), `${id}.jsonl`);
}

function getControlDir(outputDir: string): string {
  return resolve(outputDir, "_control");
}

function getShardRetryRequestPath(outputDir: string): string {
  return resolve(getControlDir(outputDir), "shard_retry_request.json");
}

function getShardRetryApprovalPath(outputDir: string): string {
  return resolve(getControlDir(outputDir), "shard_retry_approval.json");
}

function timestampTag(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function slugifyModel(model: string): string {
  return model
    .replace(/^openai-codex\//, "")
    .replace(/^openai\//, "")
    .replace(/[^a-zA-Z0-9]+/g, "")
    .toLowerCase();
}

function getPresetDefaults(
  rootDir: string,
  preset: ManagedRunPreset,
  modelSlug: string,
  runStamp: string,
  shardCount?: number,
): {
  benchmarkId: string;
  querySetId: string;
  launcherScript: string;
  launcherCommand: string[];
  outputDir: string;
  logDir: string;
  launcherEnv?: Record<string, string>;
} {
  const rendered = renderManagedPresetPaths({
    rootDir,
    presetName: preset,
    modelSlug,
    runStamp,
    shardCount,
  });
  return {
    benchmarkId: rendered.benchmark.id,
    querySetId: rendered.querySetId,
    launcherScript: rendered.launcherScript,
    launcherCommand: rendered.launcherCommand,
    outputDir: rendered.outputDir,
    logDir: rendered.logDir,
    launcherEnv: rendered.launcherEnv,
  };
}

function buildManagedRunLauncherCommand(state: Pick<ManagedRunState, "rootDir" | "benchmarkId" | "querySetId" | "preset">): string[] {
  const { preset } = resolveManagedPreset(state.preset);
  const entrypoint =
    preset.launchMode === "shared"
      ? resolve(state.rootDir, "src/orchestration/query_set_shared_bm25.ts")
      : resolve(state.rootDir, "src/orchestration/query_set_sharded_shared_bm25.ts");
  return buildTsxCommand(entrypoint, [
    "--benchmark",
    state.benchmarkId,
    "--query-set",
    state.querySetId,
  ]);
}

function normalizeManagedRunState(state: ManagedRunState): ManagedRunState {
  if (Array.isArray(state.launcherCommand) && state.launcherCommand.length > 0) {
    return state;
  }
  return {
    ...state,
    launcherCommand: buildManagedRunLauncherCommand(state),
  };
}

function stateExists(rootDir: string, id: string): boolean {
  return existsSync(getStatePath(rootDir, id));
}

export function saveManagedRunState(state: ManagedRunState): void {
  ensureDir(getStateDir(state.rootDir));
  state.updatedAt = Date.now();
  writeFileSync(
    getStatePath(state.rootDir, state.id),
    `${JSON.stringify(state, null, 2)}\n`,
    "utf8",
  );
}

export function appendManagedRunEvent(rootDir: string, event: ManagedRunEvent): void {
  ensureDir(getEventsDir(rootDir));
  appendFileSync(getEventPath(rootDir, event.runId), `${JSON.stringify(event)}\n`, "utf8");
}

export function listManagedRunEvents(
  rootDir = process.cwd(),
  id: string,
  limit = 20,
): ManagedRunEvent[] {
  const path = getEventPath(resolve(rootDir), id);
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.slice(-limit).flatMap((line) => {
    try {
      return [JSON.parse(line) as ManagedRunEvent];
    } catch {
      return [];
    }
  });
}

export function listManagedRunStates(rootDir = process.cwd()): ManagedRunState[] {
  const stateDir = getStateDir(resolve(rootDir));
  if (!existsSync(stateDir)) return [];
  return readdirSync(stateDir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => {
      const fullPath = resolve(stateDir, name);
      return normalizeManagedRunState(JSON.parse(readFileSync(fullPath, "utf8")) as ManagedRunState);
    })
    .sort((left, right) => right.createdAt - left.createdAt);
}

export function getManagedRunState(rootDir = process.cwd(), id: string): ManagedRunState {
  const path = getStatePath(resolve(rootDir), id);
  if (!existsSync(path)) {
    throw new Error(`Managed run not found: ${id}`);
  }
  return normalizeManagedRunState(JSON.parse(readFileSync(path, "utf8")) as ManagedRunState);
}

export function processExists(pid: number | undefined): boolean {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function findFreePort(): Promise<number> {
  return await new Promise<number>((resolvePromise, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to allocate free port")));
        return;
      }
      const port = address.port;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolvePromise(port);
      });
    });
  });
}

const MANAGED_STARTUP_POLL_MS = 100;
const MANAGED_STARTUP_TIMEOUT_MS = 1_500;
const MANAGED_SLEEP_ARRAY = new Int32Array(new SharedArrayBuffer(4));

function sleepSync(ms: number): void {
  Atomics.wait(MANAGED_SLEEP_ARRAY, 0, 0, ms);
}

function readTextIfExists(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function readLastNonEmptyLine(path: string): string | undefined {
  const text = readTextIfExists(path).trim();
  if (!text) return undefined;
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).at(-1);
}

function detectManagedRunFinished(state: Pick<ManagedRunState, "logDir">): boolean {
  const runLogPath = join(state.logDir, "run.log");
  return readTextIfExists(runLogPath).includes("Finished ");
}

function hasManagedStartupErrorOutput(state: Pick<ManagedRunState, "launcherStderrPath">): boolean {
  return Boolean(readLastNonEmptyLine(state.launcherStderrPath));
}

function describeManagedLauncherFailure(state: Pick<ManagedRunState, "launcherStderrPath" | "launcherStdoutPath">): string {
  const stderrLine = readLastNonEmptyLine(state.launcherStderrPath);
  if (stderrLine) return `launcher exited during startup: ${stderrLine}`;
  const stdoutLine = readLastNonEmptyLine(state.launcherStdoutPath);
  if (stdoutLine) return `launcher exited during startup: ${stdoutLine}`;
  return "launcher exited during startup before benchmark activity appeared";
}

function hasBenchmarkEventActivity(rootDir: string, id: string): boolean {
  return listManagedRunEvents(rootDir, id, 50).some((event) =>
    ["benchmark_started", "query_started", "query_completed", "query_skipped", "benchmark_finished"].includes(
      event.type,
    ),
  );
}

function hasManagedBenchmarkActivity(state: Pick<ManagedRunState, "rootDir" | "id" | "logDir">): boolean {
  if (hasBenchmarkEventActivity(state.rootDir, state.id)) return true;
  const runLogPath = join(state.logDir, "run.log");
  return readTextIfExists(runLogPath).trim().length > 0;
}

function resolveManagedRunStartupState(
  state: ManagedRunState,
): Pick<ManagedRunState, "status" | "finishedAt" | "notes"> {
  const deadline = Date.now() + MANAGED_STARTUP_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const alive = processExists(state.pid);
    const finished = detectManagedRunFinished(state);
    const benchmarkActive = hasManagedBenchmarkActivity(state);

    if (finished) {
      return {
        status: "finished",
        finishedAt: Date.now(),
      };
    }
    if (!alive) {
      return {
        status: benchmarkActive ? "dead" : "failed",
        finishedAt: Date.now(),
        notes: benchmarkActive ? undefined : describeManagedLauncherFailure(state),
      };
    }
    if (benchmarkActive) {
      return {
        status: "running",
      };
    }

    sleepSync(MANAGED_STARTUP_POLL_MS);
  }

  if (detectManagedRunFinished(state)) {
    return {
      status: "finished",
      finishedAt: Date.now(),
    };
  }
  const benchmarkActive = hasManagedBenchmarkActivity(state);
  if (!benchmarkActive && hasManagedStartupErrorOutput(state)) {
    return {
      status: "failed",
      finishedAt: Date.now(),
      notes: describeManagedLauncherFailure(state),
    };
  }
  if (processExists(state.pid)) {
    return {
      status: "running",
      notes: benchmarkActive
        ? undefined
        : "launcher process is alive; benchmark activity has not appeared yet",
    };
  }
  return {
    status: benchmarkActive ? "dead" : "failed",
    finishedAt: Date.now(),
    notes: benchmarkActive ? undefined : describeManagedLauncherFailure(state),
  };
}

export function startManagedRunProcess(state: ManagedRunState): ManagedRunState {
  const env = {
    ...process.env,
    ...state.launcherEnv,
    MODEL: state.model,
    THINKING: state.thinking,
    TIMEOUT_SECONDS: String(state.timeoutSeconds),
    OUTPUT_DIR: state.outputDir,
    LOG_DIR: state.logDir,
    PI_BM25_RPC_PORT: String(state.port),
    BENCH_MANAGED_RUN_ID: state.id,
    BENCH_EVENTS_PATH: getEventPath(state.rootDir, state.id),
  };

  const child = spawnDetachedCommand(
    state.launcherCommand,
    {
      cwd: state.rootDir,
      env,
      stdoutPath: state.launcherStdoutPath,
      stderrPath: state.launcherStderrPath,
    },
    "managed launcher",
  );

  state.pid = child.pid;
  state.pgid = child.pid;
  state.startedAt = Date.now();
  state.status = "launching";
  state.finishedAt = undefined;
  state.notes = undefined;
  saveManagedRunState(state);
  appendManagedRunEvent(state.rootDir, {
    ts: Date.now(),
    runId: state.id,
    type: "run_started",
    payload: {
      pid: state.pid,
      pgid: state.pgid,
      status: state.status,
    },
  });

  Object.assign(state, resolveManagedRunStartupState(state));
  saveManagedRunState(state);
  if (state.status !== "launching") {
    appendManagedRunEvent(state.rootDir, {
      ts: Date.now(),
      runId: state.id,
      type: "status_changed",
      payload: {
        previousStatus: "launching",
        status: state.status,
        finishedAt: state.finishedAt,
        notes: state.notes,
      },
    });
  }
  return state;
}

export async function launchManagedRun(options: LaunchManagedRunOptions): Promise<ManagedRunState> {
  const rootDir = resolve(options.rootDir ?? process.cwd());
  if (
    options.shardCount !== undefined &&
    (!Number.isFinite(options.shardCount) || options.shardCount <= 0)
  ) {
    throw new Error(`Invalid shardCount=${options.shardCount}`);
  }
  const createdAt = Date.now();
  const runStamp = timestampTag(new Date(createdAt));
  const modelSlug = slugifyModel(options.model);
  const port = options.port ?? (await findFreePort());
  const runId = `bench_${options.preset}_${modelSlug}_${runStamp}_${randomUUID().slice(0, 8)}`;
  if (stateExists(rootDir, runId)) {
    throw new Error(`Managed run id collision: ${runId}`);
  }

  const presetDefaults = getPresetDefaults(
    rootDir,
    options.preset,
    modelSlug,
    runStamp,
    options.shardCount,
  );
  const outputDir = resolve(rootDir, options.outputDir ?? presetDefaults.outputDir);
  const logDir = resolve(rootDir, options.logDir ?? presetDefaults.logDir);
  ensureDir(outputDir);
  ensureDir(logDir);
  ensureDir(getStateRoot(rootDir));
  ensureDir(getStateDir(rootDir));
  ensureDir(getEventsDir(rootDir));

  const state: ManagedRunState = {
    id: runId,
    preset: options.preset,
    benchmarkId: presetDefaults.benchmarkId,
    querySetId: presetDefaults.querySetId,
    rootDir,
    createdAt,
    updatedAt: createdAt,
    model: options.model,
    thinking: options.thinking ?? "medium",
    timeoutSeconds: options.timeoutSeconds ?? 300,
    port,
    outputDir,
    logDir,
    launcherScript: presetDefaults.launcherScript,
    launcherCommand: presetDefaults.launcherCommand,
    launcherEnv: presetDefaults.launcherEnv,
    launcherStdoutPath: resolve(logDir, "launcher.stdout.log"),
    launcherStderrPath: resolve(logDir, "launcher.stderr.log"),
    status: options.queue ? "queued" : "launching",
  };
  saveManagedRunState(state);
  appendManagedRunEvent(rootDir, {
    ts: createdAt,
    runId,
    type: "run_registered",
    payload: {
      preset: state.preset,
      benchmarkId: state.benchmarkId,
      querySetId: state.querySetId,
      model: state.model,
      outputDir: state.outputDir,
      logDir: state.logDir,
      port: state.port,
      queued: Boolean(options.queue),
    },
  });
  if (options.queue) {
    appendManagedRunEvent(rootDir, {
      ts: Date.now(),
      runId,
      type: "run_queued",
      payload: { status: state.status },
    });
    return state;
  }
  return startManagedRunProcess(state);
}

export function refreshManagedRunState(state: ManagedRunState): ManagedRunState {
  const refreshed = { ...state };
  const previousStatus = state.status;
  if (refreshed.status === "queued") {
    saveManagedRunState(refreshed);
    return refreshed;
  }
  const alive = processExists(refreshed.pid);
  const runLogPath = join(refreshed.logDir, "run.log");
  const runLog = existsSync(runLogPath) ? readFileSync(runLogPath, "utf8") : "";
  const finished = runLog.includes("Finished ");

  if (finished) {
    refreshed.status = "finished";
    refreshed.finishedAt ??= Date.now();
  } else if (refreshed.status === "killed") {
    refreshed.finishedAt ??= Date.now();
  } else if (alive) {
    refreshed.status = "running";
  } else if (refreshed.status !== "failed") {
    refreshed.status = "dead";
    refreshed.finishedAt ??= Date.now();
  }

  saveManagedRunState(refreshed);
  if (refreshed.status !== previousStatus) {
    appendManagedRunEvent(refreshed.rootDir, {
      ts: Date.now(),
      runId: refreshed.id,
      type: "status_changed",
      payload: {
        previousStatus,
        status: refreshed.status,
        finishedAt: refreshed.finishedAt,
      },
    });
  }
  return refreshed;
}

export function refreshAllManagedRunStates(rootDir = process.cwd()): ManagedRunState[] {
  return listManagedRunStates(rootDir).map(refreshManagedRunState);
}

export function startQueuedManagedRuns(
  rootDir = process.cwd(),
  maxConcurrent = 1,
): ManagedRunState[] {
  const states = listManagedRunStates(rootDir).map(refreshManagedRunState);
  let runningCount = states.filter((state) => state.status === "running").length;
  const updated: ManagedRunState[] = [];
  for (const state of states) {
    if (state.status !== "queued") {
      updated.push(state);
      continue;
    }
    if (runningCount >= maxConcurrent) {
      updated.push(state);
      continue;
    }
    state.status = "launching";
    saveManagedRunState(state);
    appendManagedRunEvent(state.rootDir, {
      ts: Date.now(),
      runId: state.id,
      type: "status_changed",
      payload: { previousStatus: "queued", status: "launching" },
    });
    const started = startManagedRunProcess(state);
    updated.push(started);
    if (["launching", "running"].includes(started.status)) runningCount += 1;
  }
  return updated.sort((left, right) => right.createdAt - left.createdAt);
}

export async function killManagedRun(
  rootDir = process.cwd(),
  id: string,
): Promise<ManagedRunState> {
  const state = getManagedRunState(rootDir, id);
  appendManagedRunEvent(resolve(rootDir), {
    ts: Date.now(),
    runId: id,
    type: "kill_requested",
    payload: { pid: state.pid },
  });
  if (!state.pid) {
    state.status = "killed";
    state.finishedAt = Date.now();
    saveManagedRunState(state);
    appendManagedRunEvent(resolve(rootDir), {
      ts: Date.now(),
      runId: id,
      type: "run_killed",
      payload: { pid: state.pid },
    });
    return state;
  }

  try {
    process.kill(-state.pid, "SIGTERM");
  } catch {
    try {
      process.kill(state.pid, "SIGTERM");
    } catch {
      // noop
    }
  }

  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (!processExists(state.pid)) break;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));
  }

  if (processExists(state.pid)) {
    try {
      process.kill(-state.pid, "SIGKILL");
    } catch {
      try {
        process.kill(state.pid, "SIGKILL");
      } catch {
        // noop
      }
    }
  }

  state.status = "killed";
  state.finishedAt = Date.now();
  saveManagedRunState(state);
  appendManagedRunEvent(resolve(rootDir), {
    ts: Date.now(),
    runId: id,
    type: "run_killed",
    payload: { pid: state.pid },
  });
  return state;
}

export async function approveManagedRunShardRetry(
  rootDir = process.cwd(),
  id: string,
): Promise<ManagedRunState> {
  const state = getManagedRunState(rootDir, id);
  const requestPath = getShardRetryRequestPath(state.outputDir);
  if (!existsSync(requestPath)) {
    throw new Error(`No pending shard retry request for ${id}`);
  }
  const approvalPath = getShardRetryApprovalPath(state.outputDir);
  ensureDir(getControlDir(state.outputDir));
  writeFileSync(approvalPath, `${JSON.stringify({ approvedAt: Date.now(), runId: id })}\n`, "utf8");
  appendManagedRunEvent(resolve(rootDir), {
    ts: Date.now(),
    runId: id,
    type: "shard_retry_approved",
    payload: { approvalPath },
  });
  return state;
}

export async function relaunchManagedRun(
  rootDir = process.cwd(),
  id: string,
  options?: { queue?: boolean },
): Promise<ManagedRunState> {
  const state = getManagedRunState(rootDir, id);
  return await launchManagedRun({
    rootDir,
    preset: state.preset,
    model: state.model,
    thinking: state.thinking,
    timeoutSeconds: state.timeoutSeconds,
    queue: options?.queue,
    shardCount: state.launcherEnv?.SHARD_COUNT
      ? Number.parseInt(state.launcherEnv.SHARD_COUNT, 10)
      : undefined,
  });
}
