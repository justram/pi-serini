import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";

import { getDefaultBenchmarkId, resolveBenchmarkConfig } from "../benchmarks/registry";
import type { BenchmarkManifestSnapshot } from "../benchmarks/types";
import { detectBenchmarkManifestSnapshot, resolveRunRoot } from "../benchmarks/run_manifest";
import { getRetrievalEvalSummaryCandidates } from "../evaluation/retrieval_eval_summary";
import { getJudgeEvalSummaryCandidates } from "../runtime/output_layout";
import {
  getManagedRunLaunchProvenance,
  listManagedRunEvents,
  refreshAllManagedRunStates,
  startQueuedManagedRuns,
  type ManagedRunEvent,
  type ManagedRunState,
} from "./bench_supervisor";

type BenchmarkRun = {
  metadata?: {
    model?: string;
    output_dir?: string;
    prompt_variant?: string;
  };
  query_id: string;
  status: string;
  retrieved_docids?: string[];
  stats?: {
    elapsed_seconds?: number;
    timed_out?: boolean;
    search_calls?: number;
    read_search_results_calls?: number;
    read_document_calls?: number;
    tool_calls_total?: number;
  };
};

type EvaluationSummary = {
  "Accuracy (%)"?: number;
  "Completed-Only Accuracy (%)"?: number | null;
  "Completed Queries"?: number;
  "Timeout/Incomplete Queries"?: number;
  "Completed Correct"?: number;
  "Completed Wrong"?: number;
};

export type BenchServerStatus = {
  host?: string;
  port?: number;
  ready: boolean;
  listening: boolean;
  indexPath?: string;
  transport?: string;
  uptimeSeconds?: number;
  initMs?: number;
};

export type BenchShardSnapshot = {
  name: string;
  progressCompleted: number;
  progressTotal?: number;
  currentQueryId?: string;
  status: "running" | "finished" | "pending";
  lastLine?: string;
  lastActivityAt?: number;
};

export type BenchRunSnapshot = {
  id: string;
  benchmarkId: string;
  querySetId?: string;
  runDir: string;
  logDir?: string;
  model: string;
  retryPending: boolean;
  pendingRetryShards: string[];
  promptVariant?: string;
  launchTopology: "single-worker" | "shared-bm25" | "sharded-shared-bm25";
  preferredLaunchScript?: string;
  launcherScript?: string;
  launcherCommandDisplay?: string;
  provenanceHint?: string;
  statusDetail: string;
  isSharded: boolean;
  shardCount: number;
  activeShardCount: number;
  shards: BenchShardSnapshot[];
  stage: "retrieval" | "evaluation" | "finished";
  artifactSummary: string;
  stageDetail: string;
  status:
    | "queued"
    | "launching"
    | "running"
    | "finished"
    | "dead"
    | "stalled"
    | "killed"
    | "failed"
    | "unknown";
  runnerStatus: string;
  managedRunId?: string;
  supervisorPid?: number;
  supervisorStatus?: ManagedRunState["status"];
  currentQueryId?: string;
  currentPhase?: string;
  phaseDetail: string;
  progressCompleted: number;
  progressTotal?: number;
  statusCounts: Record<string, number>;
  agentSetMacroRecall?: number;
  agentSetMicroRecall?: number;
  agentSetMicroHits?: number;
  agentSetMicroGold?: number;
  secondaryRecallLabel?: string;
  secondaryAgentSetMacroRecall?: number;
  secondaryAgentSetMicroRecall?: number;
  secondaryAgentSetMicroHits?: number;
  secondaryAgentSetMicroGold?: number;
  accuracy?: number;
  completedOnlyAccuracy?: number | null;
  elapsedSeconds?: number;
  estimatedRemainingSeconds?: number;
  avgSecondsPerCompletedQuery?: number;
  avgToolQps?: number;
  toolCalls?: number;
  bm25: BenchServerStatus;
  lastActivityAt?: number;
  lastActivityAgeSeconds?: number;
  lastLogLine?: string;
  recentLogLines: string[];
  recentSupervisorEvents: string[];
  recentBenchmarkEvents: string[];
};

export type BenchSnapshot = {
  generatedAt: number;
  runsRoot: string;
  runs: BenchRunSnapshot[];
};

type LogDirInfo = {
  path: string;
  outputDir?: string;
  model?: string;
  queryFile?: string;
  qrelsFile?: string;
  totalQueries?: number;
  currentQueryId?: string;
  currentPhase?: string;
  lastLogLine?: string;
  recentLogLines: string[];
  shardLogs: ShardLogSummary[];
  host?: string;
  port?: number;
  indexPath?: string;
  transport?: string;
  bm25Ready: boolean;
  finished: boolean;
  lastActivityAt?: number;
  bm25LogPath?: string;
  initMs?: number;
};

const DEFAULT_QRELS_PATH = resolveBenchmarkConfig({
  benchmarkId: getDefaultBenchmarkId(),
}).qrelsPath;
const DEFAULT_SECONDARY_QRELS_PATH =
  resolveBenchmarkConfig({ benchmarkId: getDefaultBenchmarkId() }).secondaryQrelsPath ?? "";
const RUN_DIR_PATTERN = /^pi_bm25/;
const LOG_DIR_PATTERN = /^shared-bm25/;

function safeReadFile(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function safeStatMtimeMs(path: string): number | undefined {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return undefined;
  }
}

function safeListDir(path: string): string[] {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
}

function readPendingShardRetry(runDir: string): { pending: boolean; shards: string[] } {
  const path = join(runDir, "_control", "shard_retry_request.json");
  const text = safeReadFile(path);
  if (!text) return { pending: false, shards: [] };
  try {
    const parsed = JSON.parse(text) as { shards?: unknown };
    const shards = Array.isArray(parsed.shards)
      ? parsed.shards.filter((value): value is string => typeof value === "string")
      : [];
    return { pending: true, shards };
  } catch {
    return { pending: true, shards: [] };
  }
}

function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function readQrels(path: string): Map<string, Set<string>> {
  const qrels = new Map<string, Set<string>>();
  const text = readFileSync(path, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 4) continue;
    const [queryId, , docid, rel] = parts;
    if (rel === "0") continue;
    const docs = qrels.get(queryId) ?? new Set<string>();
    docs.add(docid);
    qrels.set(queryId, docs);
  }
  return qrels;
}

function inferLaunchTopology(options: {
  isSharded: boolean;
  logDir?: string;
  managedState?: ManagedRunState;
}): "single-worker" | "shared-bm25" | "sharded-shared-bm25" {
  if (options.isSharded) return "sharded-shared-bm25";

  const launcherCommand = options.managedState?.launcherCommand ?? [];
  const launcherScript = options.managedState?.launcherScript ?? "";
  if (
    launcherCommand.some((part) => part.includes("query_set_shared_bm25.ts")) ||
    launcherCommand.some((part) => part.includes("launch_shared_bm25_benchmark_entry.ts")) ||
    launcherScript.includes("shared") ||
    (options.logDir ? LOG_DIR_PATTERN.test(basename(options.logDir)) : false)
  ) {
    return "shared-bm25";
  }

  return "single-worker";
}

function describeRunStatusDetail(options: {
  status: BenchRunSnapshot["status"];
  managedState?: ManagedRunState;
  retryPending: boolean;
  pendingRetryShards: string[];
}): string {
  if (options.retryPending) {
    return options.pendingRetryShards.length > 0
      ? `waiting for shard retry approval: ${options.pendingRetryShards.join(", ")}`
      : "waiting for shard retry approval";
  }

  if (!options.managedState) {
    switch (options.status) {
      case "finished":
        return "finished artifact-only run";
      case "running":
        return "recent unmanaged activity detected";
      case "stalled":
        return "partial unmanaged artifacts with no recent activity";
      case "dead":
        return "unmanaged run appears inactive before completion";
      default:
        return "not supervisor-managed";
    }
  }

  if (options.managedState.notes?.trim()) {
    return options.managedState.notes.trim();
  }

  switch (options.managedState.status) {
    case "queued":
      return "waiting for a supervisor launch slot";
    case "launching":
      return "starting launcher process";
    case "running":
      return "launcher process is alive";
    case "finished":
      return "benchmark finished";
    case "killed":
      return "terminated by operator request";
    case "failed":
      return "launcher failed during startup";
    case "dead":
      return "launcher is no longer alive before benchmark completion";
    default:
      return options.managedState.status;
  }
}

function resolveUnmanagedRunStatus(options: {
  logInfo?: LogDirInfo;
  benchmarkFinishedEvent?: ManagedRunEvent;
  progressCompleted: number;
  progressTotal?: number;
  currentQueryId?: string;
  lastActivityAgeSeconds?: number;
}): BenchRunSnapshot["status"] {
  if (options.logInfo?.finished || options.benchmarkFinishedEvent) {
    return "finished";
  }
  if (options.progressTotal !== undefined) {
    if (options.progressCompleted >= options.progressTotal) {
      return "finished";
    }
    if (options.currentQueryId || options.logInfo?.currentPhase) {
      return "running";
    }
    if (options.lastActivityAgeSeconds !== undefined && options.lastActivityAgeSeconds <= 90) {
      return "running";
    }
    if (options.progressCompleted > 0) {
      return "dead";
    }
    return "unknown";
  }
  if (options.currentQueryId || options.logInfo?.currentPhase) {
    return "running";
  }
  if (options.lastActivityAgeSeconds !== undefined && options.lastActivityAgeSeconds <= 90) {
    return options.progressCompleted > 0 ? "running" : "unknown";
  }
  if (options.progressCompleted > 0) {
    return "stalled";
  }
  return "unknown";
}

function resolveRunPhase(options: {
  status: BenchRunSnapshot["status"];
  stage: BenchRunSnapshot["stage"];
  statusDetail: string;
  retryPending: boolean;
  pendingRetryShards: string[];
  logInfo?: LogDirInfo;
  currentQueryId?: string;
  benchmarkFinishedEvent?: ManagedRunEvent;
  managedState?: ManagedRunState;
  evalSummary: EvaluationSummary | null;
}): { currentPhase: string; phaseDetail: string } {
  if (options.retryPending) {
    return {
      currentPhase: "retry-approval",
      phaseDetail:
        options.pendingRetryShards.length > 0
          ? `waiting for operator approval to retry shards: ${options.pendingRetryShards.join(", ")}`
          : "waiting for operator approval before retrying failed shards",
    };
  }
  if (options.evalSummary) {
    return {
      currentPhase: "evaluation",
      phaseDetail: "evaluation_summary.json is present for this run",
    };
  }
  if (options.logInfo?.currentPhase) {
    return {
      currentPhase: options.logInfo.currentPhase,
      phaseDetail: "derived from the latest run.log phase marker",
    };
  }
  if (options.currentQueryId) {
    return {
      currentPhase: "query-active",
      phaseDetail: `currently processing query ${options.currentQueryId}`,
    };
  }
  if (options.status === "queued") {
    return {
      currentPhase: "queued",
      phaseDetail: "waiting for the supervisor to start the launcher",
    };
  }
  if (options.status === "launching") {
    return {
      currentPhase: "launcher-startup",
      phaseDetail: "detached launcher started; waiting for benchmark-side activity",
    };
  }
  if (
    options.benchmarkFinishedEvent ||
    options.logInfo?.finished ||
    options.status === "finished"
  ) {
    return {
      currentPhase: "finished",
      phaseDetail: "benchmark completion evidence was detected",
    };
  }
  if (options.stage === "retrieval" && options.status === "running") {
    return {
      currentPhase: "retrieval-active",
      phaseDetail: options.managedState
        ? "launcher is alive but no finer-grained phase marker is available yet"
        : "recent artifact activity suggests retrieval is still active",
    };
  }
  return {
    currentPhase: options.stage === "finished" ? "finished" : options.stage,
    phaseDetail: options.statusDetail,
  };
}

function inferBm25Listening(
  logInfo: LogDirInfo | undefined,
  managedState: ManagedRunState | undefined,
): boolean {
  const port = logInfo?.port ?? managedState?.port;
  if (port === undefined) return false;

  if (managedState?.status === "queued") return false;
  if (managedState?.status === "launching") return Boolean(logInfo?.bm25Ready);
  if (["finished", "dead", "killed", "failed"].includes(managedState?.status ?? "")) {
    return false;
  }

  if (managedState?.status === "running") {
    return true;
  }

  if (logInfo?.finished) {
    return false;
  }

  if (logInfo?.bm25Ready) {
    return true;
  }

  return false;
}

function parseServerReady(text: string): {
  host?: string;
  port?: number;
  transport?: string;
  initMs?: number;
} {
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.includes('"type":"server_ready"') && !line.includes('"type": "server_ready"')) {
      continue;
    }
    try {
      const parsed = JSON.parse(line) as {
        host?: string;
        port?: number;
        transport?: string;
        timing_ms?: { init?: number };
      };
      return {
        host: parsed.host,
        port: parsed.port,
        transport: parsed.transport,
        initMs: parsed.timing_ms?.init,
      };
    } catch {
      continue;
    }
  }
  return {};
}

function getLastNonEmptyLines(text: string, count: number): string[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);
  return lines.slice(-count);
}

function readLastNonEmptyLine(path: string): string | undefined {
  return getLastNonEmptyLines(safeReadFile(path) ?? "", 1).at(-1);
}

function inferCurrentQueryId(path: string): string | undefined {
  const text = safeReadFile(path) ?? "";
  let currentQueryId: string | undefined;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    const marker = "] Running query ";
    if (line.includes(marker)) {
      currentQueryId = line.slice(line.indexOf(marker) + marker.length).trim();
    }
    if (line.includes("] Wrote ")) {
      currentQueryId = undefined;
    }
  }
  return currentQueryId;
}

function parseCurrentPhase(line: string | undefined): string | undefined {
  if (!line) return undefined;
  if (line.includes("tool_start search")) return "retrieval: search";
  if (line.includes("tool_start read_search_results")) return "retrieval: browse";
  if (line.includes("tool_start read_document")) return "retrieval: read_document";
  if (line.includes("message_start role=")) return "model reasoning";
  if (line.includes("assistant_message_end chars=")) return "finalizing answer";
  if (line.includes("waiting; idle")) return "waiting on model";
  if (line.includes("Saved raw events")) return "writing artifacts";
  if (line.startsWith("Finished ") || line.includes("Finished sharded slice run status="))
    return "finished";
  if (/^\[\d+\/\d+\] Running query /.test(line) || line.includes("] Running query "))
    return "starting query";
  return undefined;
}

type ShardLogSummary = {
  name: string;
  path: string;
  mtimeMs?: number;
  currentQueryId?: string;
  lastLine?: string;
};

function summarizeShardLogs(logDirPath: string): ShardLogSummary[] {
  return safeListDir(logDirPath)
    .filter((name) => /^shard_\d+\.log$/.test(name))
    .map((name) => {
      const path = join(logDirPath, name);
      return {
        name: name.replace(/\.log$/, ""),
        path,
        mtimeMs: safeStatMtimeMs(path),
        currentQueryId: inferCurrentQueryId(path),
        lastLine: readLastNonEmptyLine(path),
      };
    })
    .sort((left, right) => (right.mtimeMs ?? 0) - (left.mtimeMs ?? 0));
}

function parseLogDir(logDirPath: string): LogDirInfo {
  const runLogPath = join(logDirPath, "run.log");
  const launcherStdoutPath = join(logDirPath, "launcher.stdout.log");
  const bm25LogPath = join(logDirPath, "bm25_server.log");
  const sourcePath = existsSync(runLogPath) ? runLogPath : launcherStdoutPath;
  const sourceText = safeReadFile(sourcePath) ?? "";
  const bm25LogText = safeReadFile(bm25LogPath) ?? "";
  const lines = sourceText.split(/\r?\n/);
  const shardLogs = summarizeShardLogs(logDirPath);

  let recentLogLines = getLastNonEmptyLines(sourceText, 10);
  for (const shard of shardLogs.slice(0, 3).reverse()) {
    if (shard.lastLine) {
      recentLogLines.push(`[${shard.name}] ${shard.lastLine}`);
    }
  }
  recentLogLines = recentLogLines.slice(-10);
  let lastLogLine = recentLogLines.at(-1);

  let outputDir: string | undefined;
  let model: string | undefined;
  let queryFile: string | undefined;
  let qrelsFile: string | undefined;
  let totalQueries: number | undefined;
  let currentQueryId: string | undefined;
  let host: string | undefined;
  let port: number | undefined;
  let indexPath: string | undefined;
  let transport: string | undefined;
  let finished = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("MODEL=")) model = line.slice("MODEL=".length).trim();
    if (line.startsWith("QUERY_FILE=")) queryFile = line.slice("QUERY_FILE=".length).trim();
    if (line.startsWith("QRELS_FILE=")) qrelsFile = line.slice("QRELS_FILE=".length).trim();
    if (line.startsWith("OUTPUT_ROOT="))
      outputDir = resolve(logDirPath, "..", line.slice("OUTPUT_ROOT=".length).trim());
    if (line.startsWith("OUTPUT_DIR="))
      outputDir = resolve(logDirPath, "..", line.slice("OUTPUT_DIR=".length).trim());
    if (line.startsWith("TOTAL_QUERIES="))
      totalQueries = Number.parseInt(line.slice("TOTAL_QUERIES=".length).trim(), 10);
    if (line.startsWith("INDEX_PATH=")) indexPath = line.slice("INDEX_PATH=".length).trim();

    const processingMatch = line.match(/^Processing\s+(\d+)\s+queries\s+into\s+(.+)$/);
    if (processingMatch) {
      totalQueries = Number.parseInt(processingMatch[1] ?? "", 10);
      outputDir = resolve(processingMatch[2] ?? "");
    }

    const queryMatch = line.match(/^\[(\d+)\/(\d+)\]\s+Running query\s+(\S+)/);
    if (queryMatch) {
      totalQueries = Number.parseInt(queryMatch[2] ?? "", 10);
      currentQueryId = queryMatch[3];
    }

    const endpointMatch = line.match(/Using external BM25 RPC daemon at\s+([^:\s]+):(\d+)/);
    if (endpointMatch) {
      host = endpointMatch[1];
      port = Number.parseInt(endpointMatch[2] ?? "", 10);
      transport = "tcp";
    }

    const startingMatch = line.match(/Starting shared BM25 RPC daemon on\s+([^:\s]+):(\d+)/);
    if (startingMatch) {
      host = startingMatch[1];
      port = Number.parseInt(startingMatch[2] ?? "", 10);
      transport = "tcp";
    }

    if (line.startsWith("Finished ") || line.includes("Finished sharded slice run status=")) {
      finished = true;
    }
  }

  if (currentQueryId === undefined && shardLogs.length > 0) {
    currentQueryId = shardLogs.find((shard) => shard.currentQueryId)?.currentQueryId;
  }
  if (lastLogLine === undefined && shardLogs.length > 0) {
    lastLogLine = shardLogs.find((shard) => shard.lastLine)?.lastLine;
  }

  const ready = parseServerReady(bm25LogText);
  host = host ?? ready.host;
  port = port ?? ready.port;
  transport = transport ?? ready.transport;

  const sourceMtime = safeStatMtimeMs(sourcePath);
  const bm25Mtime = safeStatMtimeMs(bm25LogPath);
  const shardMtime = shardLogs.reduce<number | undefined>((latest, shard) => {
    if (shard.mtimeMs === undefined) return latest;
    return latest === undefined ? shard.mtimeMs : Math.max(latest, shard.mtimeMs);
  }, undefined);
  const lastActivityAt = Math.max(sourceMtime ?? 0, bm25Mtime ?? 0, shardMtime ?? 0) || undefined;

  return {
    path: logDirPath,
    outputDir,
    model,
    queryFile,
    qrelsFile,
    totalQueries,
    currentQueryId,
    currentPhase: parseCurrentPhase(lastLogLine),
    lastLogLine,
    recentLogLines,
    shardLogs,
    host,
    port,
    indexPath,
    transport,
    bm25Ready: ready.port !== undefined || sourceText.includes("Shared BM25 RPC daemon ready."),
    finished,
    lastActivityAt,
    bm25LogPath: existsSync(bm25LogPath) ? bm25LogPath : undefined,
    initMs: ready.initMs,
  };
}

function computeRecall(retrievedDocids: string[], goldDocids: Set<string>) {
  const retrieved = new Set(retrievedDocids.map(String));
  let hits = 0;
  for (const docid of goldDocids) {
    if (retrieved.has(docid)) hits += 1;
  }
  const gold = goldDocids.size;
  return {
    hits,
    gold,
    recall: gold > 0 ? hits / gold : 0,
  };
}

function qrelsLabel(path: string): string {
  const normalized = path.toLowerCase();
  if (normalized.includes("evidence")) return "evidence";
  if (normalized.includes("gold")) return "gold";
  return "secondary";
}

function computeRecallTotals(files: string[], qrels: Map<string, Set<string>>) {
  let agentSetMacroRecallSum = 0;
  let agentSetMicroHits = 0;
  let agentSetMicroGold = 0;

  for (const path of files) {
    const run = JSON.parse(readFileSync(path, "utf8")) as BenchmarkRun;
    const retrievedDocids = run.retrieved_docids ?? [];
    const goldDocids = qrels.get(String(run.query_id)) ?? new Set<string>();
    const recall = computeRecall(retrievedDocids, goldDocids);
    agentSetMacroRecallSum += recall.recall;
    agentSetMicroHits += recall.hits;
    agentSetMicroGold += recall.gold;
  }

  return { agentSetMacroRecallSum, agentSetMicroHits, agentSetMicroGold };
}

function summarizeManagedEventPayload(payload: Record<string, unknown> | undefined): string {
  if (!payload) return "";
  const queryId = typeof payload.queryId === "string" ? payload.queryId : undefined;
  const index = typeof payload.index === "number" ? payload.index : undefined;
  const totalQueries = typeof payload.totalQueries === "number" ? payload.totalQueries : undefined;
  const status = typeof payload.status === "string" ? payload.status : undefined;
  const agentSetMacroRecall =
    typeof payload.macroRecall === "number" ? payload.macroRecall : undefined;
  const agentSetMicroRecall =
    typeof payload.microRecall === "number" ? payload.microRecall : undefined;
  const bits: string[] = [];
  if (index !== undefined && totalQueries !== undefined) bits.push(`${index}/${totalQueries}`);
  if (queryId) bits.push(`q=${queryId}`);
  if (status) bits.push(`status=${status}`);
  if (agentSetMacroRecall !== undefined) {
    bits.push(`agent_set_macro=${agentSetMacroRecall.toFixed(4)}`);
  }
  if (agentSetMicroRecall !== undefined) {
    bits.push(`agent_set_micro=${agentSetMicroRecall.toFixed(4)}`);
  }
  return bits.length > 0 ? ` ${bits.join(" ")}` : ` ${JSON.stringify(payload)}`;
}

function listRunJsonPaths(dir: string): string[] {
  return safeListDir(dir)
    .filter((name) => /^\d+\.json$/.test(name))
    .sort((left, right) => Number.parseInt(left, 10) - Number.parseInt(right, 10))
    .map((name) => join(dir, name));
}

function collectResultJsonPaths(runDir: string): string[] {
  const shardRoot = join(runDir, "shard-runs");
  if (existsSync(shardRoot)) {
    return safeListDir(shardRoot)
      .filter((name) => /^shard_\d+$/.test(name))
      .flatMap((name) => listRunJsonPaths(join(shardRoot, name)))
      .sort((left, right) => {
        const leftId = Number.parseInt(left.split("/").at(-1) ?? "0", 10);
        const rightId = Number.parseInt(right.split("/").at(-1) ?? "0", 10);
        return leftId - rightId;
      });
  }

  return listRunJsonPaths(runDir);
}

function countNonEmptyLines(path: string): number | undefined {
  const text = safeReadFile(path);
  if (text === null) return undefined;
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean).length;
}

function collectShardSnapshots(runDir: string, shardLogs: ShardLogSummary[]): BenchShardSnapshot[] {
  const shardRoot = join(runDir, "shard-runs");
  const shardQueryRoot = join(runDir, "shard-queries");
  if (!existsSync(shardRoot) && shardLogs.length === 0) return [];

  const shardNames = new Set<string>();
  for (const name of safeListDir(shardRoot).filter((entry) => /^shard_\d+$/.test(entry))) {
    shardNames.add(name);
  }
  for (const shard of shardLogs) {
    shardNames.add(shard.name);
  }

  return [...shardNames]
    .sort((left, right) => left.localeCompare(right))
    .map((name) => {
      const shardDir = join(shardRoot, name);
      const shardQueryPath = join(shardQueryRoot, `${name}.tsv`);
      const completed = listRunJsonPaths(shardDir).length;
      const total = countNonEmptyLines(shardQueryPath);
      const shardLog = shardLogs.find((entry) => entry.name === name);
      const status: BenchShardSnapshot["status"] =
        total !== undefined && completed >= total
          ? "finished"
          : shardLog?.currentQueryId
            ? "running"
            : completed > 0 || shardLog?.lastLine
              ? "pending"
              : "pending";
      return {
        name,
        progressCompleted: completed,
        progressTotal: total,
        currentQueryId: shardLog?.currentQueryId,
        status,
        lastLine: shardLog?.lastLine,
        lastActivityAt: shardLog?.mtimeMs,
      };
    });
}

function resolveExpectedRunQueryCount(options: {
  rootDir: string;
  runDir: string;
  logInfo?: LogDirInfo;
  manifestSnapshot?: BenchmarkManifestSnapshot;
  managedState?: ManagedRunState;
}): number | undefined {
  const queryPathFromLog = options.logInfo?.queryFile;
  if (queryPathFromLog) {
    return countNonEmptyLines(resolve(queryPathFromLog));
  }

  const queryPathFromManifest = options.manifestSnapshot?.query_path;
  if (queryPathFromManifest) {
    return countNonEmptyLines(resolve(options.rootDir, queryPathFromManifest));
  }

  if (options.managedState?.benchmarkId && options.managedState.querySetId) {
    const resolved = resolveBenchmarkConfig({
      benchmarkId: options.managedState.benchmarkId,
      querySetId: options.managedState.querySetId,
    });
    return countNonEmptyLines(resolve(options.rootDir, resolved.queryPath));
  }

  return undefined;
}

function findJudgeEvaluationSummaryPath(
  rootDir: string,
  runDir: string,
  benchmarkId: string,
): string | undefined {
  return getJudgeEvalSummaryCandidates({
    runDir,
    benchmarkId,
    evalRoot: resolve(rootDir, "evals/pi_judge"),
  }).find((path) => existsSync(path));
}

function readEvaluationSummary(rootDir: string, runDir: string): EvaluationSummary | null {
  const benchmarkId =
    detectBenchmarkManifestSnapshot(runDir)?.snapshot.benchmark_id ?? getDefaultBenchmarkId();
  const summaryPath = findJudgeEvaluationSummaryPath(rootDir, runDir, benchmarkId);
  if (!summaryPath) return null;
  try {
    return JSON.parse(readFileSync(summaryPath, "utf8")) as EvaluationSummary;
  } catch {
    return null;
  }
}

function findRetrievalEvaluationSummaryPath(
  rootDir: string,
  runDir: string,
  benchmarkId: string,
): string | undefined {
  const runRoot = resolveRunRoot(runDir);
  const sourcePaths = existsSync(join(runRoot, "merged"))
    ? [join(runRoot, "merged"), runRoot]
    : [runRoot];
  for (const sourcePath of sourcePaths) {
    const candidate = getRetrievalEvalSummaryCandidates({
      benchmarkId,
      sourcePath,
      evalRoot: resolve(rootDir, "evals/retrieval"),
    }).find((path) => existsSync(path));
    if (candidate) return candidate;
  }
  return undefined;
}

function resolveUnmanagedProvenanceHint(options: {
  runDir: string;
  manifestSnapshot?: BenchmarkManifestSnapshot;
  logInfo?: LogDirInfo;
  isSharded: boolean;
}): string | undefined {
  const evidence: string[] = [];
  if (options.manifestSnapshot) {
    evidence.push("benchmark_manifest_snapshot.json");
  }
  if (existsSync(join(options.runDir, "run_setup.json"))) {
    evidence.push("run_setup.json");
  }
  if (options.isSharded) {
    evidence.push("sharded run layout");
  }
  if (options.logInfo?.path && LOG_DIR_PATTERN.test(basename(options.logInfo.path))) {
    evidence.push("shared-bm25 log layout");
  }
  return evidence.length > 0 ? `unmanaged artifact evidence: ${evidence.join(", ")}` : undefined;
}

function resolveStageInfo(options: {
  runDir: string;
  benchmarkId: string;
  status: BenchRunSnapshot["status"];
  judgeEvalSummaryPath?: string;
  retrievalEvalSummaryPath?: string;
}): {
  stage: BenchRunSnapshot["stage"];
  artifactSummary: string;
  stageDetail: string;
  reportPath?: string;
} {
  const runRoot = resolveRunRoot(options.runDir);
  const reportPath = resolve(runRoot, "report.md");
  const hasReport = existsSync(reportPath);
  const artifactTokens = [
    options.retrievalEvalSummaryPath ? "retrieval-eval" : undefined,
    options.judgeEvalSummaryPath ? "judge-eval" : undefined,
    hasReport ? "report" : undefined,
  ].filter(Boolean) as string[];
  const artifactLabels = [
    options.retrievalEvalSummaryPath ? "retrieval evaluation summary" : undefined,
    options.judgeEvalSummaryPath ? "judge evaluation summary" : undefined,
    hasReport ? "report.md" : undefined,
  ].filter(Boolean) as string[];

  if (artifactLabels.length > 0) {
    return {
      stage: "evaluation",
      artifactSummary: artifactTokens.join(", "),
      stageDetail: `downstream artifacts detected: ${artifactLabels.join(", ")}`,
      reportPath: hasReport ? reportPath : undefined,
    };
  }

  if (options.status === "finished") {
    return {
      stage: "finished",
      artifactSummary: "none",
      stageDetail: "retrieval completed; no downstream evaluation artifacts detected yet",
      reportPath: hasReport ? reportPath : undefined,
    };
  }

  return {
    stage: "retrieval",
    artifactSummary: "none",
    stageDetail: "retrieval is still the active stage",
    reportPath: hasReport ? reportPath : undefined,
  };
}

function loadRunSnapshot(
  rootDir: string,
  runDir: string,
  qrels: Map<string, Set<string>>,
  secondaryQrels: Map<string, Set<string>> | undefined,
  secondaryQrelsLabel: string | undefined,
  logInfo: LogDirInfo | undefined,

  managedState?: ManagedRunState,
): BenchRunSnapshot {
  const manifestSnapshot = detectBenchmarkManifestSnapshot(runDir)?.snapshot;
  const benchmarkId =
    manifestSnapshot?.benchmark_id ?? managedState?.benchmarkId ?? getDefaultBenchmarkId();
  const querySetId = manifestSnapshot?.query_set_id ?? managedState?.querySetId;
  const files = collectResultJsonPaths(runDir);
  const shards = collectShardSnapshots(runDir, logInfo?.shardLogs ?? []);
  const activeShardCount = shards.filter((shard) => shard.status === "running").length;

  let model = "unknown";
  let promptVariant: string | undefined;
  let elapsedSeconds = 0;
  let toolCalls = 0;
  const statusCounts: Record<string, number> = {};

  for (const path of files) {
    const run = JSON.parse(readFileSync(path, "utf8")) as BenchmarkRun;
    model = run.metadata?.model ?? model;
    promptVariant = run.metadata?.prompt_variant ?? promptVariant;
    elapsedSeconds += run.stats?.elapsed_seconds ?? 0;
    toolCalls += run.stats?.tool_calls_total ?? 0;
    const status = run.status || "unknown";
    statusCounts[status] = (statusCounts[status] ?? 0) + 1;
  }

  const primaryRecallTotals = computeRecallTotals(files, qrels);
  const secondaryRecallTotals = secondaryQrels
    ? computeRecallTotals(files, secondaryQrels)
    : undefined;

  if (managedState?.model) model = managedState.model;
  if (logInfo?.model) model = logInfo.model;

  const allManagedEvents = managedState
    ? listManagedRunEvents(managedState.rootDir, managedState.id, 200)
    : [];
  const benchmarkEvents = allManagedEvents.filter((event) =>
    [
      "benchmark_started",
      "query_started",
      "query_completed",
      "query_skipped",
      "benchmark_finished",
    ].includes(event.type),
  );
  const queryCompletedEvents = benchmarkEvents.filter((event) => event.type === "query_completed");
  const querySkippedEvents = benchmarkEvents.filter((event) => event.type === "query_skipped");
  const benchmarkStartedEvent = benchmarkEvents.find((event) => event.type === "benchmark_started");
  const benchmarkFinishedEvent = benchmarkEvents.find(
    (event) => event.type === "benchmark_finished",
  );

  const progressCompleted = Math.max(
    files.length,
    queryCompletedEvents.length + querySkippedEvents.length,
  );
  const progressTotalFromEvents =
    typeof benchmarkStartedEvent?.payload?.totalQueries === "number"
      ? benchmarkStartedEvent.payload.totalQueries
      : undefined;
  const progressTotal =
    logInfo?.totalQueries ??
    progressTotalFromEvents ??
    resolveExpectedRunQueryCount({
      rootDir,
      runDir,
      logInfo,
      manifestSnapshot,
      managedState,
    });
  const agentSetMacroRecall =
    progressCompleted > 0
      ? primaryRecallTotals.agentSetMacroRecallSum / progressCompleted
      : undefined;
  const agentSetMicroRecall =
    primaryRecallTotals.agentSetMicroGold > 0
      ? primaryRecallTotals.agentSetMicroHits / primaryRecallTotals.agentSetMicroGold
      : undefined;
  const secondaryAgentSetMacroRecall =
    secondaryRecallTotals && progressCompleted > 0
      ? secondaryRecallTotals.agentSetMacroRecallSum / progressCompleted
      : undefined;
  const secondaryAgentSetMicroRecall =
    secondaryRecallTotals && secondaryRecallTotals.agentSetMicroGold > 0
      ? secondaryRecallTotals.agentSetMicroHits / secondaryRecallTotals.agentSetMicroGold
      : undefined;
  const avgSecondsPerCompletedQuery =
    progressCompleted > 0
      ? elapsedSeconds > 0
        ? elapsedSeconds / progressCompleted
        : queryCompletedEvents.length > 0 && managedState?.startedAt
          ? (queryCompletedEvents.at(-1)!.ts - managedState.startedAt) /
            1000 /
            queryCompletedEvents.length
          : undefined
      : undefined;
  const estimatedRemainingSeconds =
    progressTotal !== undefined && avgSecondsPerCompletedQuery !== undefined
      ? Math.max(progressTotal - progressCompleted, 0) * avgSecondsPerCompletedQuery
      : undefined;
  const avgToolQps = elapsedSeconds > 0 ? toolCalls / elapsedSeconds : undefined;
  const judgeEvalSummaryPath = findJudgeEvaluationSummaryPath(rootDir, runDir, benchmarkId);
  const evalSummary = judgeEvalSummaryPath ? readEvaluationSummary(rootDir, runDir) : null;
  const retrievalEvalSummaryPath = findRetrievalEvaluationSummaryPath(rootDir, runDir, benchmarkId);

  const now = Date.now();
  const fileActivityAt = files.reduce<number | undefined>((latest, path) => {
    const mtime = safeStatMtimeMs(path);
    if (mtime === undefined) return latest;
    return latest === undefined ? mtime : Math.max(latest, mtime);
  }, undefined);
  const lastActivityAt =
    logInfo?.lastActivityAt ?? fileActivityAt ?? managedState?.updatedAt ?? managedState?.startedAt;
  const lastActivityAgeSeconds =
    lastActivityAt !== undefined ? Math.max(0, (now - lastActivityAt) / 1000) : undefined;

  const port = logInfo?.port ?? managedState?.port;
  const listening = inferBm25Listening(logInfo, managedState);
  const bm25UptimeSeconds =
    logInfo?.bm25LogPath && logInfo.lastActivityAt
      ? Math.max(
          0,
          (Date.now() - (safeStatMtimeMs(logInfo.bm25LogPath) ?? logInfo.lastActivityAt)) / 1000,
        )
      : undefined;

  const currentQueryIdFromEvents = [...benchmarkEvents]
    .reverse()
    .find((event) => event.type === "query_started")?.payload?.queryId;
  const unresolvedCurrentQueryId =
    logInfo?.currentQueryId ??
    (typeof currentQueryIdFromEvents === "string" ? currentQueryIdFromEvents : undefined);

  let status: BenchRunSnapshot["status"] = "unknown";
  if (managedState?.status === "queued") {
    status = "queued";
  } else if (managedState?.status === "launching") {
    status = "launching";
  } else if (managedState?.status === "killed") {
    status = "killed";
  } else if (managedState?.status === "failed") {
    status = "failed";
  } else if (managedState?.status === "dead") {
    status = "dead";
  } else if (managedState?.status === "finished") {
    status = "finished";
  } else if (managedState?.status === "running") {
    status = "running";
  } else {
    status = resolveUnmanagedRunStatus({
      logInfo,
      benchmarkFinishedEvent,
      progressCompleted,
      progressTotal,
      currentQueryId: unresolvedCurrentQueryId,
      lastActivityAgeSeconds,
    });
  }

  const stageInfo = resolveStageInfo({
    runDir,
    benchmarkId,
    status,
    judgeEvalSummaryPath,
    retrievalEvalSummaryPath,
  });
  const stage: BenchRunSnapshot["stage"] = stageInfo.stage;

  const currentQueryId =
    status === "finished" && progressCompleted > 0 ? undefined : unresolvedCurrentQueryId;
  const recentSupervisorEvents = allManagedEvents
    .filter((event) =>
      [
        "run_registered",
        "run_queued",
        "run_started",
        "status_changed",
        "kill_requested",
        "run_killed",
      ].includes(event.type),
    )
    .slice(-8)
    .map((event) => {
      const payload = event.payload ? ` ${JSON.stringify(event.payload)}` : "";
      return `${new Date(event.ts).toLocaleTimeString()} ${event.type}${payload}`;
    });
  const recentBenchmarkEvents = benchmarkEvents.slice(-8).map((event) => {
    return `${new Date(event.ts).toLocaleTimeString()} ${event.type}${summarizeManagedEventPayload(event.payload)}`;
  });

  const pendingShardRetry = readPendingShardRetry(runDir);
  const configuredShardCount = managedState?.launcherEnv?.SHARD_COUNT
    ? Number.parseInt(managedState.launcherEnv.SHARD_COUNT, 10)
    : undefined;
  const isSharded =
    shards.length > 0 || (configuredShardCount !== undefined && configuredShardCount > 1);
  const shardCount = shards.length > 0 ? shards.length : (configuredShardCount ?? 0);
  const launchTopology = inferLaunchTopology({
    isSharded,
    logDir: logInfo?.path ?? managedState?.logDir,
    managedState,
  });
  const provenanceHint = managedState
    ? undefined
    : resolveUnmanagedProvenanceHint({
        runDir,
        manifestSnapshot,
        logInfo,
        isSharded,
      });
  const launchProvenance = managedState ? getManagedRunLaunchProvenance(managedState) : undefined;
  const statusDetail = describeRunStatusDetail({
    status,
    managedState,
    retryPending: pendingShardRetry.pending,
    pendingRetryShards: pendingShardRetry.shards,
  });
  const phase = resolveRunPhase({
    status,
    stage,
    statusDetail,
    retryPending: pendingShardRetry.pending,
    pendingRetryShards: pendingShardRetry.shards,
    logInfo,
    currentQueryId,
    benchmarkFinishedEvent,
    managedState,
    evalSummary,
  });

  return {
    id: runDir.split("/").at(-1) ?? runDir,
    benchmarkId,
    querySetId,
    runDir,
    logDir: logInfo?.path ?? managedState?.logDir,
    model,
    retryPending: pendingShardRetry.pending,
    pendingRetryShards: pendingShardRetry.shards,
    promptVariant,
    launchTopology,
    preferredLaunchScript: launchProvenance?.preferredPackageScript,
    launcherScript: launchProvenance?.launcherScript,
    launcherCommandDisplay: launchProvenance?.launcherCommandDisplay,
    provenanceHint,
    statusDetail,
    isSharded,
    shardCount,
    activeShardCount,
    shards,
    stage,
    artifactSummary: stageInfo.artifactSummary,
    stageDetail: stageInfo.stageDetail,
    status,
    runnerStatus: managedState?.status ?? status,
    managedRunId: managedState?.id,
    supervisorPid: managedState?.pid,
    supervisorStatus: managedState?.status,
    currentQueryId,
    currentPhase: phase.currentPhase,
    phaseDetail: phase.phaseDetail,
    progressCompleted,
    progressTotal,
    statusCounts,
    agentSetMacroRecall: agentSetMacroRecall !== undefined ? round(agentSetMacroRecall) : undefined,
    agentSetMicroRecall: agentSetMicroRecall !== undefined ? round(agentSetMicroRecall) : undefined,
    agentSetMicroHits: primaryRecallTotals.agentSetMicroHits,
    agentSetMicroGold: primaryRecallTotals.agentSetMicroGold,
    secondaryRecallLabel: secondaryRecallTotals ? secondaryQrelsLabel : undefined,
    secondaryAgentSetMacroRecall:
      secondaryAgentSetMacroRecall !== undefined ? round(secondaryAgentSetMacroRecall) : undefined,
    secondaryAgentSetMicroRecall:
      secondaryAgentSetMicroRecall !== undefined ? round(secondaryAgentSetMicroRecall) : undefined,
    secondaryAgentSetMicroHits: secondaryRecallTotals?.agentSetMicroHits,
    secondaryAgentSetMicroGold: secondaryRecallTotals?.agentSetMicroGold,
    accuracy: evalSummary?.["Accuracy (%)"],
    completedOnlyAccuracy: evalSummary?.["Completed-Only Accuracy (%)"] ?? null,
    elapsedSeconds: elapsedSeconds > 0 ? round(elapsedSeconds, 3) : undefined,
    estimatedRemainingSeconds:
      estimatedRemainingSeconds !== undefined ? round(estimatedRemainingSeconds, 1) : undefined,
    avgSecondsPerCompletedQuery:
      avgSecondsPerCompletedQuery !== undefined ? round(avgSecondsPerCompletedQuery, 1) : undefined,
    avgToolQps: avgToolQps !== undefined ? round(avgToolQps, 3) : undefined,
    toolCalls,
    bm25: {
      host: logInfo?.host ?? "127.0.0.1",
      port,
      ready: Boolean(logInfo?.bm25Ready),
      listening,
      indexPath: logInfo?.indexPath,
      transport: logInfo?.transport,
      uptimeSeconds: bm25UptimeSeconds,
      initMs: logInfo?.initMs,
    },
    lastActivityAt,
    lastActivityAgeSeconds:
      lastActivityAgeSeconds !== undefined ? round(lastActivityAgeSeconds, 1) : undefined,
    lastLogLine: logInfo?.lastLogLine,
    recentLogLines: logInfo?.recentLogLines ?? [],
    recentSupervisorEvents,
    recentBenchmarkEvents,
  };
}

export function loadBenchSnapshot(options?: {
  rootDir?: string;
  runsDir?: string;
  qrelsPath?: string;
  secondaryQrelsPath?: string;
}): BenchSnapshot {
  const rootDir = resolve(options?.rootDir ?? process.cwd());
  const runsRoot = resolve(rootDir, options?.runsDir ?? "runs");
  const qrelsPath = resolve(rootDir, options?.qrelsPath ?? DEFAULT_QRELS_PATH);
  const secondaryQrelsPath = resolve(
    rootDir,
    options?.secondaryQrelsPath ?? DEFAULT_SECONDARY_QRELS_PATH,
  );
  const qrels = existsSync(qrelsPath) ? readQrels(qrelsPath) : new Map<string, Set<string>>();
  const secondaryQrels =
    secondaryQrelsPath !== qrelsPath && existsSync(secondaryQrelsPath)
      ? readQrels(secondaryQrelsPath)
      : undefined;
  const secondaryQrelsLabel = secondaryQrels ? qrelsLabel(secondaryQrelsPath) : undefined;
  const maxConcurrent = Number.parseInt(process.env.BENCH_MAX_CONCURRENT ?? "1", 10);
  startQueuedManagedRuns(
    rootDir,
    Number.isFinite(maxConcurrent) && maxConcurrent > 0 ? maxConcurrent : 1,
  );
  const managedStates = refreshAllManagedRunStates(rootDir);

  const discoveredLogDirPaths = new Set(
    safeListDir(runsRoot)
      .filter((name) => LOG_DIR_PATTERN.test(name))
      .map((name) => resolve(runsRoot, name))
      .filter((path) => {
        try {
          return statSync(path).isDirectory();
        } catch {
          return false;
        }
      }),
  );
  for (const managedState of managedStates) {
    if (!managedState.logDir) continue;
    try {
      if (statSync(managedState.logDir).isDirectory()) {
        discoveredLogDirPaths.add(resolve(managedState.logDir));
      }
    } catch {
      // Ignore missing log dirs for queued or not-yet-materialized runs.
    }
  }

  const logDirs = [...discoveredLogDirPaths].map(parseLogDir);

  const logByOutputDir = new Map<string, LogDirInfo>();
  for (const info of logDirs) {
    if (info.outputDir) {
      logByOutputDir.set(resolve(info.outputDir), info);
    }
  }

  const managedByOutputDir = new Map<string, ManagedRunState>();
  for (const managedState of managedStates) {
    managedByOutputDir.set(resolve(managedState.outputDir), managedState);
  }

  const runs = safeListDir(runsRoot)
    .filter((name) => RUN_DIR_PATTERN.test(name))
    .map((name) => resolve(runsRoot, name))
    .filter((path) => {
      try {
        return statSync(path).isDirectory();
      } catch {
        return false;
      }
    })
    .map((runDir) =>
      loadRunSnapshot(
        rootDir,
        runDir,
        qrels,
        secondaryQrels,
        secondaryQrelsLabel,
        logByOutputDir.get(resolve(runDir)),
        managedByOutputDir.get(resolve(runDir)),
      ),
    )
    .sort((left, right) => {
      const leftTime = left.lastActivityAt ?? 0;
      const rightTime = right.lastActivityAt ?? 0;
      return rightTime - leftTime;
    });

  return {
    generatedAt: Date.now(),
    runsRoot,
    runs,
  };
}

export function formatDuration(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds)) return "n/a";
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) return `${hours}h${String(minutes).padStart(2, "0")}m`;
  if (minutes > 0) return `${minutes}m${String(secs).padStart(2, "0")}s`;
  return `${secs}s`;
}

export function formatPercent(value: number | null | undefined): string {
  if (value === undefined || value === null || !Number.isFinite(value)) return "n/a";
  return `${value.toFixed(2)}%`;
}
