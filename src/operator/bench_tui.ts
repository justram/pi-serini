import { Chalk } from "chalk";
import {
  ProcessTerminal,
  TUI,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  type Component,
} from "@mariozechner/pi-tui";

import {
  formatDuration,
  formatPercent,
  loadBenchSnapshot,
  type BenchRunSnapshot,
} from "./bench_monitor";
import { getDefaultBenchmarkId, resolveBenchmarkConfig } from "../benchmarks/registry";
import {
  approveManagedRunShardRetry,
  killManagedRun,
  relaunchManagedRun,
} from "./bench_supervisor";

type BenchTuiOptions = {
  rootDir?: string;
  runsDir?: string;
  qrelsPath?: string;
  refreshMs?: number;
};

type RunFilterMode = "all" | "active" | "managed" | "finished" | "failed";
type RunSortMode = "activity" | "status" | "model";

const chalk = new Chalk({ level: 3 });

const theme = {
  chrome: (text: string) => chalk.bgHex("#1f2430").white(text),
  header: (text: string) => chalk.bold.hex("#7dd3fc")(text),
  subheader: (text: string) => chalk.bold.hex("#c4b5fd")(text),
  label: (text: string) => chalk.hex("#93c5fd")(text),
  dim: (text: string) => chalk.hex("#94a3b8")(text),
  selected: (text: string) => chalk.bgHex("#1d4ed8").white.bold(text),
  selectedSecondary: (text: string) => chalk.bgHex("#1e3a8a").white(text),
  ok: (text: string) => chalk.black.bgGreenBright(text),
  warn: (text: string) => chalk.black.bgYellowBright(text),
  bad: (text: string) => chalk.white.bgRedBright(text),
  info: (text: string) => chalk.black.bgCyanBright(text),
  accent: (text: string) => chalk.hex("#f9a8d4")(text),
  benchmarkEvent: (text: string) => chalk.hex("#86efac")(text),
  supervisorEvent: (text: string) => chalk.hex("#f0abfc")(text),
  log: (text: string) => chalk.hex("#cbd5e1")(text),
};

function pad(text: string, width: number): string {
  const truncated = truncateToWidth(text, width, "");
  return truncated + " ".repeat(Math.max(0, width - visibleWidth(truncated)));
}

function hr(width: number, label?: string): string {
  if (width <= 0) return "";
  if (!label) return theme.dim("─".repeat(width));
  const prefix = ` ${label} `;
  if (prefix.length >= width) return theme.subheader(truncateToWidth(prefix, width, ""));
  return `${theme.subheader(prefix)}${theme.dim("─".repeat(width - prefix.length))}`;
}

function combineColumns(
  left: string[],
  right: string[],
  leftWidth: number,
  totalWidth: number,
): string[] {
  const gap = 2;
  const rightWidth = Math.max(1, totalWidth - leftWidth - gap);
  const rowCount = Math.max(left.length, right.length);
  const lines: string[] = [];
  for (let index = 0; index < rowCount; index += 1) {
    const leftLine = pad(left[index] ?? "", leftWidth);
    const rightLine = pad(right[index] ?? "", rightWidth);
    lines.push(`${leftLine}${" ".repeat(gap)}${rightLine}`);
  }
  return lines;
}

function formatProgress(run: BenchRunSnapshot): string {
  const total = run.progressTotal ?? "?";
  return `${run.progressCompleted}/${total}`;
}

function statusBadge(status: BenchRunSnapshot["status"]): string {
  const label = ` ${status.toUpperCase()} `;
  switch (status) {
    case "running":
    case "finished":
      return theme.ok(label);
    case "queued":
    case "launching":
    case "stalled":
      return theme.info(label);
    case "dead":
    case "failed":
    case "killed":
      return theme.bad(label);
    default:
      return theme.warn(label);
  }
}

function stageBadge(stage: BenchRunSnapshot["stage"]): string {
  const label = ` ${stage.toUpperCase()} `;
  switch (stage) {
    case "finished":
      return theme.ok(label);
    case "evaluation":
      return theme.accent(label);
    default:
      return theme.info(label);
  }
}

function describeBm25(run: BenchRunSnapshot): string {
  const endpoint =
    run.bm25.host && run.bm25.port !== undefined ? `${run.bm25.host}:${run.bm25.port}` : "n/a";
  const status = run.bm25.listening ? "listening" : run.bm25.ready ? "stopped" : "down";
  const coloredStatus =
    status === "listening"
      ? theme.ok(` ${status.toUpperCase()} `)
      : status === "stopped"
        ? theme.warn(` ${status.toUpperCase()} `)
        : theme.bad(` ${status.toUpperCase()} `);
  return `${coloredStatus} ${theme.dim("@")} ${endpoint}`;
}

function shardBadge(status: BenchRunSnapshot["shards"][number]["status"]): string {
  const label = ` ${status.toUpperCase()} `;
  switch (status) {
    case "finished":
      return theme.ok(label);
    case "running":
      return theme.info(label);
    default:
      return theme.warn(label);
  }
}

function nextFilterMode(current: RunFilterMode): RunFilterMode {
  const modes: RunFilterMode[] = ["all", "active", "managed", "finished", "failed"];
  return modes[(modes.indexOf(current) + 1) % modes.length] ?? "all";
}

function nextSortMode(current: RunSortMode): RunSortMode {
  const modes: RunSortMode[] = ["activity", "status", "model"];
  return modes[(modes.indexOf(current) + 1) % modes.length] ?? "activity";
}

function filterRuns(runs: BenchRunSnapshot[], filterMode: RunFilterMode): BenchRunSnapshot[] {
  switch (filterMode) {
    case "active":
      return runs.filter((run) => ["queued", "launching", "running"].includes(run.status));
    case "managed":
      return runs.filter((run) => Boolean(run.managedRunId));
    case "finished":
      return runs.filter((run) => run.status === "finished");
    case "failed":
      return runs.filter((run) => ["dead", "failed", "killed"].includes(run.status));
    default:
      return runs;
  }
}

function sortRuns(runs: BenchRunSnapshot[], sortMode: RunSortMode): BenchRunSnapshot[] {
  const copy = [...runs];
  switch (sortMode) {
    case "status":
      return copy.sort((left, right) =>
        `${left.status}:${left.id}`.localeCompare(`${right.status}:${right.id}`),
      );
    case "model":
      return copy.sort((left, right) =>
        `${left.model}:${left.id}`.localeCompare(`${right.model}:${right.id}`),
      );
    case "activity":
    default:
      return copy.sort((left, right) => (right.lastActivityAt ?? 0) - (left.lastActivityAt ?? 0));
  }
}

class BenchDashboard implements Component {
  focused = true;
  wantsKeyRelease = false;
  private readonly options: BenchTuiOptions;
  private readonly onQuit: () => void;
  private readonly onRefresh: () => void;
  private selectedIndex = 0;
  private bannerMessage?: string;
  private filterMode: RunFilterMode = "all";
  private sortMode: RunSortMode = "activity";

  constructor(options: BenchTuiOptions, onQuit: () => void, onRefresh: () => void) {
    this.options = options;
    this.onQuit = onQuit;
    this.onRefresh = onRefresh;
  }

  invalidate(): void {
    // Stateless render; nothing cached locally.
  }

  handleInput(data: string): void {
    const snapshot = loadBenchSnapshot(this.options);
    const runs = sortRuns(filterRuns(snapshot.runs, this.filterMode), this.sortMode);
    const count = runs.length;

    if (matchesKey(data, "ctrl+c") || matchesKey(data, "q") || matchesKey(data, "escape")) {
      this.onQuit();
      return;
    }

    if (matchesKey(data, "r")) {
      this.bannerMessage = "Refreshed.";
      this.onRefresh();
      return;
    }
    if (matchesKey(data, "f")) {
      this.filterMode = nextFilterMode(this.filterMode);
      this.selectedIndex = 0;
      this.bannerMessage = `Filter: ${this.filterMode}`;
      this.onRefresh();
      return;
    }
    if (matchesKey(data, "s")) {
      this.sortMode = nextSortMode(this.sortMode);
      this.selectedIndex = 0;
      this.bannerMessage = `Sort: ${this.sortMode}`;
      this.onRefresh();
      return;
    }

    if (count === 0) return;

    if (matchesKey(data, "down") || matchesKey(data, "j")) {
      this.selectedIndex = (this.selectedIndex + 1) % count;
      return;
    }
    if (matchesKey(data, "up") || matchesKey(data, "k")) {
      this.selectedIndex = (this.selectedIndex - 1 + count) % count;
      return;
    }
    if (matchesKey(data, "home")) {
      this.selectedIndex = 0;
      return;
    }
    if (matchesKey(data, "end")) {
      this.selectedIndex = count - 1;
      return;
    }
    if (matchesKey(data, "x")) {
      const run = runs[this.selectedIndex];
      if (!run?.managedRunId) {
        this.bannerMessage = "Selected run is not supervisor-managed.";
        this.onRefresh();
        return;
      }
      this.bannerMessage = `Killing ${run.managedRunId}...`;
      void killManagedRun(this.options.rootDir, run.managedRunId)
        .then(() => {
          this.bannerMessage = `Killed ${run.managedRunId}.`;
          this.onRefresh();
        })
        .catch((error) => {
          this.bannerMessage = `Kill failed: ${error instanceof Error ? error.message : String(error)}`;
          this.onRefresh();
        });
      this.onRefresh();
      return;
    }
    if (matchesKey(data, "l")) {
      const run = runs[this.selectedIndex];
      if (!run?.managedRunId) {
        this.bannerMessage = "Selected run is not supervisor-managed.";
        this.onRefresh();
        return;
      }
      this.bannerMessage = `Relaunching ${run.managedRunId}...`;
      void relaunchManagedRun(this.options.rootDir, run.managedRunId)
        .then((relaunched) => {
          this.bannerMessage = `Relaunched as ${relaunched.id}.`;
          this.onRefresh();
        })
        .catch((error) => {
          this.bannerMessage = `Relaunch failed: ${error instanceof Error ? error.message : String(error)}`;
          this.onRefresh();
        });
      this.onRefresh();
      return;
    }
    if (matchesKey(data, "a")) {
      const run = runs[this.selectedIndex];
      if (!run?.managedRunId) {
        this.bannerMessage = "Selected run is not supervisor-managed.";
        this.onRefresh();
        return;
      }
      if (!run.retryPending) {
        this.bannerMessage = "Selected run has no pending shard retry request.";
        this.onRefresh();
        return;
      }
      this.bannerMessage = `Approving shard retry for ${run.managedRunId}...`;
      void approveManagedRunShardRetry(this.options.rootDir, run.managedRunId)
        .then(() => {
          this.bannerMessage = `Approved shard retry for ${run.managedRunId}.`;
          this.onRefresh();
        })
        .catch((error) => {
          this.bannerMessage = `Retry approval failed: ${error instanceof Error ? error.message : String(error)}`;
          this.onRefresh();
        });
      this.onRefresh();
    }
  }

  render(width: number): string[] {
    const snapshot = loadBenchSnapshot(this.options);
    const runs = sortRuns(filterRuns(snapshot.runs, this.filterMode), this.sortMode);
    if (runs.length === 0) {
      return [
        pad(theme.chrome(` pi-serini benchmark monitor `), width),
        pad(hr(width), width),
        pad(`${theme.label("runs root:")} ${snapshot.runsRoot}`, width),
        pad(theme.warn(" No benchmark runs found. "), width),
        pad(theme.dim("Controls: ↑/↓ or j/k to move, q to quit."), width),
      ];
    }

    this.selectedIndex = Math.max(0, Math.min(this.selectedIndex, runs.length - 1));
    const selected = runs[this.selectedIndex];
    const leftWidth = Math.max(34, Math.min(56, Math.floor(width * 0.36)));

    const lines: string[] = [];
    lines.push(
      pad(
        theme.chrome(
          ` pi-serini benchmark monitor  runs=${runs.length}/${snapshot.runs.length}  filter=${this.filterMode}  sort=${this.sortMode}  updated=${new Date(snapshot.generatedAt).toLocaleTimeString()}  refresh=${Math.round((this.options.refreshMs ?? 2000) / 1000)}s `,
        ),
        width,
      ),
    );
    lines.push(
      pad(
        `${theme.dim("keys:")} ${theme.label("q")} quit  ${theme.label("r")} refresh  ${theme.label("a")} approve retry  ${theme.label("x")} kill  ${theme.label("l")} relaunch  ${theme.label("f")} filter  ${theme.label("s")} sort`,
        width,
      ),
    );
    if (this.bannerMessage) {
      const styledBanner = /failed|kill/i.test(this.bannerMessage)
        ? theme.warn(` ${this.bannerMessage} `)
        : /approved|retry/i.test(this.bannerMessage)
          ? theme.accent(` ${this.bannerMessage} `)
          : theme.info(` ${this.bannerMessage} `);
      lines.push(pad(styledBanner, width));
    }
    lines.push(pad(hr(width), width));

    const leftLines = this.renderRunsList(runs, leftWidth);
    const rightLines = this.renderRunDetails(selected, Math.max(1, width - leftWidth - 2));
    lines.push(...combineColumns(leftLines, rightLines, leftWidth, width));
    return lines;
  }

  private renderRunsList(runs: BenchRunSnapshot[], width: number): string[] {
    const lines: string[] = [];
    lines.push(hr(width, "Runs"));
    lines.push(
      pad(`${theme.dim("status")}  ${theme.dim("progress")}  ${theme.dim("model")}`, width),
    );
    lines.push(pad(theme.dim("──────  ────────  ─────"), width));
    runs.forEach((run, index) => {
      const isSelected = index === this.selectedIndex;
      const marker = isSelected ? theme.header("❯") : theme.dim("·");
      const status = statusBadge(run.status);
      const progress = theme.label(formatProgress(run));
      const model = isSelected
        ? chalk.bold.white(truncateToWidth(run.model, Math.max(1, width - 24), ""))
        : truncateToWidth(run.model, Math.max(1, width - 24), "");
      const primary = `${marker} ${status} ${progress} ${model}`;
      const scope = `${run.benchmarkId}${run.querySetId ? `/${run.querySetId}` : ""}`;
      const managedMarker = run.managedRunId ? "managed" : "unmanaged";
      const retryMarker = run.retryPending ? "retry" : undefined;
      const secondaryText = `  ${truncateToWidth(
        [scope, run.launchTopology, `artifacts=${run.artifactSummary}`, managedMarker, retryMarker]
          .filter(Boolean)
          .join("  ·  "),
        width - 2,
        "",
      )}`;
      const tertiaryText = `  ${truncateToWidth(run.id, width - 2, "")}`;
      lines.push(pad(isSelected ? theme.selected(primary) : primary, width));
      lines.push(
        pad(isSelected ? theme.selectedSecondary(secondaryText) : theme.dim(secondaryText), width),
      );
      lines.push(
        pad(isSelected ? theme.selectedSecondary(tertiaryText) : theme.dim(tertiaryText), width),
      );
    });
    return lines;
  }

  private renderRunDetails(run: BenchRunSnapshot, width: number): string[] {
    const lines: string[] = [];
    lines.push(hr(width, "Selected run"));
    lines.push(pad(`${theme.label("id:")} ${run.id}`, width));
    lines.push(
      pad(
        `${theme.label("benchmark:")} ${run.benchmarkId}${run.querySetId ? `   ${theme.label("query set:")} ${run.querySetId}` : ""}`,
        width,
      ),
    );
    lines.push(pad(`${theme.label("model:")} ${chalk.bold(run.model)}`, width));
    lines.push(
      pad(
        `${theme.label("status:")} ${statusBadge(run.status)}   ${theme.label("stage:")} ${stageBadge(run.stage)}`,
        width,
      ),
    );
    lines.push(pad(`${theme.label("artifacts:")} ${run.artifactSummary}`, width));
    lines.push(pad(`${theme.label("stage detail:")} ${run.stageDetail}`, width));
    lines.push(pad(`${theme.label("detail:")} ${run.statusDetail}`, width));
    lines.push(
      pad(
        `${theme.label("launch:")} ${run.launchTopology}   ${theme.label("layout:")} ${run.isSharded ? `sharded (${run.shardCount})` : "single-worker"}   ${theme.label("active shards:")} ${run.activeShardCount}`,
        width,
      ),
    );
    lines.push(
      pad(
        `${theme.label("progress:")} ${theme.info(` ${formatProgress(run)} `)}   ${theme.label("current:")} ${run.currentQueryId ?? "-"}`,
        width,
      ),
    );
    lines.push(pad(`${theme.label("phase:")} ${theme.accent(run.currentPhase ?? "n/a")}`, width));
    lines.push(pad(`${theme.label("why:")} ${run.phaseDetail}`, width));
    if (run.retryPending) {
      lines.push(
        pad(
          `${theme.label("retry:")} ${theme.warn(" APPROVAL REQUIRED ")} ${run.pendingRetryShards.join(", ") || "unknown shard"}`,
          width,
        ),
      );
    }
    lines.push(
      pad(
        `${theme.label("runner:")} ${run.runnerStatus}   ${theme.label("pid:")} ${run.supervisorPid ?? "n/a"}`,
        width,
      ),
    );
    lines.push(
      pad(
        `${theme.label("managed:")} ${run.managedRunId ?? "n/a"}   ${theme.label("age:")} ${formatDuration(run.lastActivityAgeSeconds)}`,
        width,
      ),
    );
    lines.push(
      pad(
        `${theme.label("script:")} ${truncateToWidth(run.preferredLaunchScript ?? "n/a", Math.max(1, width - 10), "")}`,
        width,
      ),
    );
    lines.push(
      pad(
        `${theme.label("command:")} ${truncateToWidth(run.launcherCommandDisplay ?? "n/a", Math.max(1, width - 11), "")}`,
        width,
      ),
    );
    lines.push(
      pad(
        `${theme.label("provenance:")} ${truncateToWidth(run.provenanceHint ?? "n/a", Math.max(1, width - 14), "")}`,
        width,
      ),
    );
    lines.push(
      pad(
        `${theme.label("elapsed:")} ${formatDuration(run.elapsedSeconds)}   ${theme.label("eta:")} ${formatDuration(run.estimatedRemainingSeconds)}`,
        width,
      ),
    );
    lines.push(
      pad(
        `${theme.label("avg/query:")} ${formatDuration(run.avgSecondsPerCompletedQuery)}   ${theme.label("avg qps:")} ${run.avgToolQps?.toFixed(3) ?? "n/a"}`,
        width,
      ),
    );
    lines.push(pad(`${theme.label("prompt:")} ${run.promptVariant ?? "n/a"}`, width));
    lines.push(
      pad(
        `${theme.label("run dir:")} ${truncateToWidth(run.runDir, Math.max(1, width - 10), "")}`,
        width,
      ),
    );
    lines.push(
      pad(
        `${theme.label("log dir:")} ${truncateToWidth(run.logDir ?? "n/a", Math.max(1, width - 10), "")}`,
        width,
      ),
    );
    lines.push(hr(width, "Metrics"));
    lines.push(
      pad(
        `${theme.label("agent-set macro recall (evidence):")} ${run.agentSetMacroRecall?.toFixed(4) ?? "n/a"}`,
        width,
      ),
    );
    lines.push(
      pad(
        `${theme.label("agent-set micro recall (evidence):")} ${run.agentSetMicroRecall?.toFixed(4) ?? "n/a"}   ${theme.label("hits:")} ${run.agentSetMicroHits ?? 0}/${run.agentSetMicroGold ?? 0}`,
        width,
      ),
    );
    if (run.secondaryRecallLabel) {
      lines.push(
        pad(
          `${theme.label(`agent-set macro recall (${run.secondaryRecallLabel}):`)} ${run.secondaryAgentSetMacroRecall?.toFixed(4) ?? "n/a"}`,
          width,
        ),
      );
      lines.push(
        pad(
          `${theme.label(`agent-set micro recall (${run.secondaryRecallLabel}):`)} ${run.secondaryAgentSetMicroRecall?.toFixed(4) ?? "n/a"}   ${theme.label("hits:")} ${run.secondaryAgentSetMicroHits ?? 0}/${run.secondaryAgentSetMicroGold ?? 0}`,
          width,
        ),
      );
    }
    lines.push(
      pad(
        `${theme.label("accuracy:")} ${formatPercent(run.accuracy)}   ${theme.label("completed-only:")} ${formatPercent(run.completedOnlyAccuracy)}`,
        width,
      ),
    );
    lines.push(
      pad(
        `${theme.label("status counts:")} ${
          Object.entries(run.statusCounts)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([status, count]) => `${status}=${count}`)
            .join(" ") || "n/a"
        }`,
        width,
      ),
    );
    lines.push(hr(width, "BM25 server"));
    lines.push(pad(`${theme.label("server:")} ${describeBm25(run)}`, width));
    lines.push(
      pad(
        `${theme.label("transport:")} ${run.bm25.transport ?? "n/a"}   ${theme.label("init:")} ${run.bm25.initMs?.toFixed(1) ?? "n/a"} ms`,
        width,
      ),
    );
    lines.push(
      pad(
        `${theme.label("index:")} ${truncateToWidth(run.bm25.indexPath ?? "n/a", Math.max(1, width - 8), "")}`,
        width,
      ),
    );
    if (run.isSharded) {
      lines.push(hr(width, "Shards"));
      const shardLines = run.shards.length > 0 ? run.shards.slice(0, 6) : [];
      for (const shard of shardLines) {
        const summary = `${shard.name} ${shardBadge(shard.status)} ${theme.label(`${shard.progressCompleted}/${shard.progressTotal ?? "?"}`)} current=${shard.currentQueryId ?? "-"}`;
        lines.push(pad(truncateToWidth(summary, width, ""), width));
        lines.push(
          pad(
            theme.dim(truncateToWidth(shard.lastLine ?? "n/a", Math.max(1, width - 2), "")),
            width,
          ),
        );
      }
    }
    lines.push(hr(width, "Benchmark events"));
    const benchmarkEvents =
      run.recentBenchmarkEvents.length > 0 ? run.recentBenchmarkEvents : ["n/a"];
    for (const line of benchmarkEvents.slice(-4)) {
      lines.push(pad(theme.benchmarkEvent(truncateToWidth(line, width, "")), width));
    }
    lines.push(hr(width, "Supervisor events"));
    const supervisorEvents =
      run.recentSupervisorEvents.length > 0 ? run.recentSupervisorEvents : ["n/a"];
    for (const line of supervisorEvents.slice(-3)) {
      lines.push(pad(theme.supervisorEvent(truncateToWidth(line, width, "")), width));
    }
    lines.push(hr(width, "Recent log lines"));
    const recent = run.recentLogLines.length > 0 ? run.recentLogLines : [run.lastLogLine ?? "n/a"];
    for (const line of recent.slice(-6)) {
      lines.push(pad(theme.log(truncateToWidth(line, width, "")), width));
    }
    return lines;
  }
}

export function startBenchTui(options?: BenchTuiOptions): void {
  const terminal = new ProcessTerminal();
  const tui = new TUI(terminal);
  let shuttingDown = false;
  let altScreenActive = false;

  const enterAltScreen = () => {
    if (altScreenActive) return;
    terminal.write("\x1b[?1049h");
    terminal.clearScreen();
    altScreenActive = true;
  };

  const leaveAltScreen = () => {
    if (!altScreenActive) return;
    terminal.write("\x1b[?1049l");
    altScreenActive = false;
  };

  const shutdown = async (exitCode = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(refreshTimer);
    try {
      await terminal.drainInput();
    } catch {
      // Ignore drain errors during shutdown.
    }
    tui.stop();
    leaveAltScreen();
    process.exit(exitCode);
  };

  const refresh = () => tui.requestRender();
  const dashboard = new BenchDashboard(
    options ?? {},
    () => {
      void shutdown(0);
    },
    refresh,
  );
  enterAltScreen();
  tui.addChild(dashboard);
  tui.setFocus(dashboard);
  tui.start();

  const refreshTimer = setInterval(() => {
    tui.requestRender();
  }, options?.refreshMs ?? 2000);

  process.on("SIGINT", () => {
    void shutdown(0);
  });
}

function parseArgs(argv: string[]): BenchTuiOptions {
  const options: BenchTuiOptions = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    switch (arg) {
      case "--rootDir":
      case "--root-dir":
        if (!next) throw new Error(`${arg} requires a value`);
        options.rootDir = next;
        index += 1;
        break;
      case "--runsDir":
      case "--runs-dir":
        if (!next) throw new Error(`${arg} requires a value`);
        options.runsDir = next;
        index += 1;
        break;
      case "--qrels":
        if (!next) throw new Error(`${arg} requires a value`);
        options.qrelsPath = next;
        index += 1;
        break;
      case "--refreshMs":
      case "--refresh-ms":
        if (!next) throw new Error(`${arg} requires a value`);
        options.refreshMs = Number.parseInt(next, 10);
        index += 1;
        break;
      case "--help":
      case "-h": {
        const defaultBenchmarkId = getDefaultBenchmarkId();
        const defaultQrelsPath = resolveBenchmarkConfig({
          benchmarkId: defaultBenchmarkId,
        }).qrelsPath;
        console.log(
          `Preferred package entrypoint: npm run bench:tui\nLow-level direct command: npx tsx src/operator/bench_tui.ts [options]\n\nOptions:\n  --root-dir <dir>     Repo root (default: cwd)\n  --runs-dir <dir>     Runs directory relative to root (default: runs)\n  --qrels <path>       Qrels file (default: benchmark primary qrels for ${defaultBenchmarkId}: ${defaultQrelsPath})\n  --refresh-ms <ms>    Refresh interval (default: 2000)\n\nSemantics:\n  Runs surface benchmark ids from benchmark_manifest_snapshot.json when available; otherwise the monitor falls back\n  to the default benchmark id ${defaultBenchmarkId}. Monitor recall fields are the full-sequence coverage part of\n  agent-set evaluation. Each query contributes its final accumulated retrieved_docids sequence, and the monitor\n  computes recall over that full sequence, not per-call retrieval metrics and not classical fused rankings.\n`,
        );
        process.exit(0);
        break;
      }
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startBenchTui(parseArgs(process.argv.slice(2)));
}
