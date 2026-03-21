import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { buildReport } from "../src/report_run_markdown";
import { detectEvalSummaryPath } from "../src/report_markdown_data";
import type { Args, JudgeEvaluationSummary } from "../src/report_markdown_types";

test("detectEvalSummaryPath finds namespaced sharded judge summaries under evals/pi_judge/<benchmark>/<run>/merged", () => {
  const root = mkdtempSync(join(tmpdir(), "report-run-markdown-"));
  const cwd = process.cwd();
  const runDir = join(root, "runs", "run");
  const judgeDir = join(root, "evals", "pi_judge", "benchmark-template", "run", "merged");
  mkdirSync(judgeDir, { recursive: true });
  const expectedPath = join(judgeDir, "evaluation_summary.json");
  writeFileSync(expectedPath, JSON.stringify({ "Accuracy (%)": 68.31 }, null, 2), "utf8");

  process.chdir(root);
  try {
    assert.equal(
      realpathSync(detectEvalSummaryPath(runDir, "benchmark-template") ?? ""),
      realpathSync(expectedPath),
    );
  } finally {
    process.chdir(cwd);
  }
});

test("buildReport loads qrels defaults from benchmark manifest snapshots", () => {
  const root = mkdtempSync(join(tmpdir(), "report-run-markdown-"));
  const runDir = join(root, "run");
  const mergedDir = join(runDir, "merged");
  mkdirSync(mergedDir, { recursive: true });

  writeFileSync(
    join(runDir, "benchmark_manifest_snapshot.json"),
    JSON.stringify(
      {
        benchmark_id: "browsecomp-plus",
        benchmark_display_name: "BrowseComp-Plus",
        dataset_id: "browsecomp-plus",
        query_set_id: "q9",
        prompt_variant: "plain_minimal",
        query_path: "data/browsecomp-plus/queries/q9.tsv",
        qrels_path: join(root, "manifest-qrels.txt"),
        secondary_qrels_path: undefined,
        ground_truth_path: join(root, "ground-truth.jsonl"),
        index_path: "indexes/browsecomp-plus-bm25-tevatron",
      },
      null,
      2,
    ),
    "utf8",
  );

  writeFileSync(
    join(mergedDir, "1.json"),
    JSON.stringify(
      { query_id: "1", status: "completed", retrieved_docids: ["d1"], stats: {} },
      null,
      2,
    ),
    "utf8",
  );
  writeFileSync(join(root, "manifest-qrels.txt"), "1 0 d1 1\n", "utf8");

  const report = buildReport({
    benchmarkId: "benchmark-template",
    runDir,
    qrelsPath: "",
    secondaryQrelsPath: undefined,
    recallCutoffs: [100],
    ndcgCutoffs: [10],
    mrrCutoffs: [10],
  });

  assert.match(report.markdown, /manifest-qrels\.txt qrels is 100\.00% macro and 100\.00% micro/);
  assert.doesNotMatch(report.markdown, /\| gold \|/);
});

test("buildReport formats judged incorrect query recall as a percent, not a rate", () => {
  const root = mkdtempSync(join(tmpdir(), "report-run-markdown-"));
  const runDir = join(root, "run");
  const mergedDir = join(runDir, "merged");
  mkdirSync(mergedDir, { recursive: true });

  writeFileSync(
    join(mergedDir, "1265.json"),
    JSON.stringify(
      {
        query_id: "1265",
        status: "completed",
        retrieved_docids: ["d1", "noise"],
        stats: {
          elapsed_seconds: 1,
          search_calls: 1,
          read_search_results_calls: 0,
          read_document_calls: 0,
          tool_calls_total: 1,
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  const qrelsPath = join(root, "qrel_evidence.txt");
  writeFileSync(qrelsPath, "1265 0 d1 1\n1265 0 d2 1\n1265 0 d3 1\n1265 0 d4 1\n", "utf8");

  const evalSummary: JudgeEvaluationSummary = {
    "Accuracy (%)": 0,
    "Completed-Only Accuracy (%)": 0,
    "Completed Queries": 1,
    "Timeout/Incomplete Queries": 0,
    "Recall Macro (%)": 25,
    "Recall Micro (%)": 25,
    per_query_metrics: [
      {
        query_id: "1265",
        correct: false,
        recall: 25,
      },
    ],
  };
  const evalSummaryPath = join(root, "evaluation_summary.json");
  writeFileSync(evalSummaryPath, JSON.stringify(evalSummary, null, 2), "utf8");

  const args: Args = {
    benchmarkId: "browsecomp-plus",
    runDir,
    qrelsPath,
    secondaryQrelsPath: undefined,
    evalSummaryPath,
    recallCutoffs: [100, 1000],
    ndcgCutoffs: [10],
    mrrCutoffs: [10],
  };

  const report = buildReport(args);

  assert.match(report.markdown, /## Judged incorrect queries/);
  assert.match(report.markdown, /\| 1265 \| 25\.00% \|/);
  assert.doesNotMatch(report.markdown, /\| 1265 \| 2500\.00% \|/);
});
