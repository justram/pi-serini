import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

import {
  listManagedRunEvents,
  refreshAllManagedRunStates,
  startQueuedManagedRuns,
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
  runDir: string;
  logDir?: string;
  model: string;
  retryPending: boolean;
  pendingRetryShards: string[];
  promptVariant?: string;
  isSharded: boolean;
  shardCount: number;
  activeShardCount: number;
  shards: BenchShardSnapshot[];
  stage: "retrieval" | "evaluation" | "finished";
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

type ListeningEndpoint = {
  command?: string;
};

const DEFAULT_QRELS_PATH = "data/browsecomp-plus/qrels/qrel_evidence.txt";
const DEFAULT_SECONDARY_QRELS_PATH = "data/browsecomp-plus/qrels/qrel_gold.txt";
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

function getListeningTcpMap(): Map<number, ListeningEndpoint> {
  const endpoints = new Map<number, ListeningEndpoint>();
  try {
    const output = execFileSync("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-F", "pcn"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    let currentCommand: string | undefined;
    for (const rawLine of output.split(/\r?\n/)) {
      if (!rawLine) continue;
      const prefix = rawLine[0];
      const value = rawLine.slice(1);
      if (prefix === "c") {
        currentCommand = value;
        continue;
      }
      if (prefix !== "n") continue;
      const match = value.match(/:(\d+)$/);
      if (!match) continue;
      const port = Number.parseInt(match[1], 10);
      if (!Number.isFinite(port)) continue;
      endpoints.set(port, { command: currentCommand });
    }
  } catch {
    return endpoints;
  }
  return endpoints;
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

function readEvaluationSummary(runDir: string): EvaluationSummary | null {
  const candidates = [
    join(runDir, "evaluation_summary.json"),
    join(runDir, "merged", "evaluation_summary.json"),
  ];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    try {
      return JSON.parse(readFileSync(path, "utf8")) as EvaluationSummary;
    } catch {
      // Continue to fallback candidates.
    }
  }
  return null;
}

function loadRunSnapshot(
  runDir: string,
  qrels: Map<string, Set<string>>,
  secondaryQrels: Map<string, Set<string>> | undefined,
  secondaryQrelsLabel: string | undefined,
  logInfo: LogDirInfo | undefined,
  listeningPorts: Map<number, ListeningEndpoint>,
  managedState?: ManagedRunState,
): BenchRunSnapshot {
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
  const secondaryRecallTotals = secondaryQrels ? computeRecallTotals(files, secondaryQrels) : undefined;

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
    (managedState?.preset === "q9_shared"
      ? 9
      : managedState?.preset === "q100_sharded"
        ? 100
        : managedState?.preset === "q300_sharded"
          ? 300
          : undefined);
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
  const evalSummary = readEvaluationSummary(runDir);

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
  const listening = port !== undefined ? listeningPorts.has(port) : false;
  const bm25UptimeSeconds =
    logInfo?.bm25LogPath && logInfo.lastActivityAt
      ? Math.max(
          0,
          (Date.now() - (safeStatMtimeMs(logInfo.bm25LogPath) ?? logInfo.lastActivityAt)) / 1000,
        )
      : undefined;

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
  } else if (logInfo?.finished || managedState?.status === "finished") {
    status = "finished";
  } else if (managedState?.status === "running") {
    status = "running";
  } else if (lastActivityAgeSeconds !== undefined && lastActivityAgeSeconds <= 90) {
    status = "running";
  } else if (progressTotal !== undefined && progressCompleted < progressTotal) {
    status = "dead";
  } else if (progressCompleted > 0) {
    status = "stalled";
  }

  const stage: BenchRunSnapshot["stage"] = evalSummary
    ? "evaluation"
    : status === "finished"
      ? "finished"
      : "retrieval";

  const currentQueryIdFromEvents = [...benchmarkEvents]
    .reverse()
    .find((event) => event.type === "query_started")?.payload?.queryId;
  const currentQueryId =
    status === "finished" && progressCompleted > 0
      ? undefined
      : (logInfo?.currentQueryId ??
        (typeof currentQueryIdFromEvents === "string" ? currentQueryIdFromEvents : undefined));
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
  const isConfiguredSharded =
    managedState?.preset === "q100_sharded" ||
    managedState?.preset === "q300_sharded" ||
    managedState?.preset === "qfull_sharded";
  const isSharded = shards.length > 0 || isConfiguredSharded;
  const shardCount = shards.length > 0 ? shards.length : configuredShardCount ?? 0;

  return {
    id: runDir.split("/").at(-1) ?? runDir,
    runDir,
    logDir: logInfo?.path ?? managedState?.logDir,
    model,
    retryPending: pendingShardRetry.pending,
    pendingRetryShards: pendingShardRetry.shards,
    promptVariant,
    isSharded,
    shardCount,
    activeShardCount,
    shards,
    stage,
    status,
    runnerStatus: managedState?.status ?? status,
    managedRunId: managedState?.id,
    supervisorPid: managedState?.pid,
    supervisorStatus: managedState?.status,
    currentQueryId,
    currentPhase:
      pendingShardRetry.pending
        ? `awaiting retry approval${pendingShardRetry.shards.length > 0 ? `: ${pendingShardRetry.shards.join(", ")}` : ""}`
        : logInfo?.currentPhase ??
          (benchmarkFinishedEvent
            ? "finished"
            : currentQueryId
              ? "query active"
              : managedState?.status),
    progressCompleted,
    progressTotal,
    statusCounts,
    agentSetMacroRecall:
      agentSetMacroRecall !== undefined ? round(agentSetMacroRecall) : undefined,
    agentSetMicroRecall:
      agentSetMicroRecall !== undefined ? round(agentSetMicroRecall) : undefined,
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
  const listeningPorts = getListeningTcpMap();
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
        runDir,
        qrels,
        secondaryQrels,
        secondaryQrelsLabel,
        logByOutputDir.get(resolve(runDir)),
        listeningPorts,
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
