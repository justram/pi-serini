import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { buildReport } from "../src/report/report_run_markdown";
import { detectEvalSummaryPath } from "../src/report/report_markdown_data";
import type { Args, JudgeEvaluationSummary } from "../src/report/report_markdown_types";

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
        git_commit: "1234567890abcdef1234567890abcdef12345678",
        git_commit_short: "123456",
      },
      null,
      2,
    ),
    "utf8",
  );

  writeFileSync(
    join(mergedDir, "1.json"),
    JSON.stringify(
      {
        query_id: "1",
        status: "completed",
        retrieved_docids: ["d1"],
        metadata: { model: "openai-codex/gpt-5.4-mini" },
        stats: {},
      },
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

  assert.match(report.markdown, /Run commit: `123456`/);
  assert.match(report.markdown, /- Run commit: `123456`\./);
  assert.match(report.markdown, /Report commit: `[0-9a-f]{6}`/);
  assert.match(report.markdown, /- Report commit: `[0-9a-f]{6}`\./);
  assert.match(report.markdown, /## Run setup/);
  assert.match(report.markdown, /\| Model \| openai-codex\/gpt-5\.4-mini \|/);
  assert.match(report.markdown, /\| Query file \| data\/browsecomp-plus\/queries\/q9\.tsv \|/);
  assert.match(report.markdown, /\| Index path \| indexes\/browsecomp-plus-bm25-tevatron \|/);
  assert.match(report.markdown, /manifest-qrels\.txt qrels is 100\.00% macro and 100\.00% micro/);
  assert.match(report.markdown, /## Retrieval metric semantics/);
  assert.match(report.markdown, /\| nDCG gain mode \| exponential \|/);
  assert.match(report.markdown, /\| Recall relevance threshold \| qrel >= 1 \|/);
  assert.doesNotMatch(report.markdown, /\| gold \|/);
});

test("buildReport prefers structured run_setup.json for reproducibility metadata", () => {
  const root = mkdtempSync(join(tmpdir(), "report-run-markdown-"));
  const runDir = join(root, "run");
  const mergedDir = join(runDir, "merged");
  mkdirSync(mergedDir, { recursive: true });

  writeFileSync(
    join(runDir, "run_setup.json"),
    JSON.stringify(
      {
        slice: "dl19",
        model: "openai-codex/gpt-5.4-mini",
        queryFile: "queries.tsv",
        qrelsFile: "qrels.txt",
        totalQueries: "1",
        timeoutSeconds: "180",
        indexPath: "indexes/msmarco-v1-passage",
        bm25K1: "1.7",
        bm25B: "0.2",
        bm25Threads: "8",
      },
      null,
      2,
    ),
    "utf8",
  );
  writeFileSync(
    join(mergedDir, "1.json"),
    JSON.stringify(
      {
        query_id: "1",
        status: "completed",
        retrieved_docids: ["d1"],
        metadata: { model: "wrong-model" },
        stats: {},
      },
      null,
      2,
    ),
    "utf8",
  );
  writeFileSync(join(root, "qrels.txt"), "1 0 d1 1\n", "utf8");

  const report = buildReport({
    benchmarkId: "benchmark-template",
    runDir,
    qrelsPath: join(root, "qrels.txt"),
    secondaryQrelsPath: undefined,
    recallCutoffs: [100],
    ndcgCutoffs: [10],
    mrrCutoffs: [10],
  });

  assert.match(report.markdown, /## Run setup/);
  assert.match(report.markdown, /\| Slice \| dl19 \|/);
  assert.match(report.markdown, /\| Model \| openai-codex\/gpt-5\.4-mini \|/);
  assert.match(report.markdown, /\| BM25 k1 \| 1\.7 \|/);
  assert.match(report.markdown, /\| BM25 b \| 0\.2 \|/);
  assert.match(report.markdown, /\| BM25 threads \| 8 \|/);
});

test("buildReport formats reference-free judge accuracy with explicit mode labels", () => {
  const root = mkdtempSync(join(tmpdir(), "report-run-markdown-"));
  const runDir = join(root, "run");
  const mergedDir = join(runDir, "merged");
  mkdirSync(mergedDir, { recursive: true });

  writeFileSync(
    join(mergedDir, "1.json"),
    JSON.stringify(
      {
        query_id: "1",
        status: "completed",
        retrieved_docids: ["d1"],
        stats: { elapsed_seconds: 1, tool_calls_total: 1 },
      },
      null,
      2,
    ),
    "utf8",
  );

  const qrelsPath = join(root, "qrel_evidence.txt");
  writeFileSync(qrelsPath, "1 0 d1 1\n", "utf8");

  const evalSummary: JudgeEvaluationSummary = {
    "Judge Mode": "reference-free",
    "Accuracy Label": "Accuracy (reference-free judge)",
    "Accuracy Semantics":
      "Reference-free judge accuracy: the judge receives the question and the run's final answer, but no benchmark gold answer.",
    "Accuracy (%)": 70,
    "Completed-Only Accuracy (%)": 70,
    "Completed Queries": 1,
    "Timeout/Incomplete Queries": 0,
    "Recall Macro (%)": 100,
    "Recall Micro (%)": 100,
    judge: { mode: "reference-free", usage: { cost: { total: 0.12 } } },
    per_query_metrics: [{ query_id: "1", correct: true, recall: 100 }],
  };
  const evalSummaryPath = join(root, "evaluation_summary.json");
  writeFileSync(evalSummaryPath, JSON.stringify(evalSummary, null, 2), "utf8");

  const report = buildReport({
    benchmarkId: "msmarco-v1-passage",
    runDir,
    qrelsPath,
    secondaryQrelsPath: undefined,
    evalSummaryPath,
    recallCutoffs: [100],
    ndcgCutoffs: [10],
    mrrCutoffs: [10],
  });

  assert.match(report.markdown, /Accuracy \(reference-free judge\) is 70\.00% overall/);
  assert.match(
    report.markdown,
    /This accuracy is based on a reference-free LLM judge and is not benchmark gold-answer accuracy\./,
  );
  assert.match(
    report.markdown,
    /This run used a reference-free judge\. Reported accuracy is produced without benchmark gold answers and should be interpreted as judge-estimated correctness\./,
  );
  assert.match(report.markdown, /\| Judge mode \| reference-free \|/);
  assert.match(report.markdown, /\| Accuracy \(reference-free judge\) \| 70\.00% \|/);
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

test("buildReport prefers matching normalized retrieval summaries for aggregate prefix metrics", () => {
  const root = mkdtempSync(join(tmpdir(), "report-run-markdown-"));
  const cwd = process.cwd();
  const runDir = join(root, "run");
  const mergedDir = join(runDir, "merged");
  const summaryDir = join(root, "evals", "retrieval", "msmarco-v1-passage");
  mkdirSync(mergedDir, { recursive: true });
  mkdirSync(summaryDir, { recursive: true });

  writeFileSync(
    join(runDir, "benchmark_manifest_snapshot.json"),
    JSON.stringify(
      {
        benchmark_id: "msmarco-v1-passage",
        benchmark_display_name: "MS MARCO v1 Passage",
        dataset_id: "msmarco-v1-passage",
        query_set_id: "dl19",
        prompt_variant: "plain_minimal",
        query_path: join(root, "queries.tsv"),
        qrels_path: join(root, "qrels.txt"),
        index_path: "indexes/msmarco-v1-passage",
      },
      null,
      2,
    ),
    "utf8",
  );
  writeFileSync(join(root, "queries.tsv"), "1\tquery\n", "utf8");
  writeFileSync(join(root, "qrels.txt"), "1 0 d1 2\n1 0 d2 1\n", "utf8");
  writeFileSync(
    join(mergedDir, "1.json"),
    JSON.stringify(
      { query_id: "1", status: "completed", retrieved_docids: ["d1"], stats: {} },
      null,
      2,
    ),
    "utf8",
  );
  writeFileSync(
    join(summaryDir, "merged.summary.json"),
    JSON.stringify(
      {
        benchmarkId: "msmarco-v1-passage",
        querySetId: "dl19",
        backend: "internal",
        sourceType: "run-dir",
        sourcePath: mergedDir,
        qrelsPath: join(root, "qrels.txt"),
        queryCount: 1,
        metricSemantics: {
          ndcgGainMode: "linear",
          recallRelevantThreshold: 2,
          binaryRelevantThreshold: 1,
        },
        metrics: [
          { metric: "recall_1000", scope: "all", value: 0.66 },
          { metric: "ndcg_cut_10", scope: "all", value: 0.77 },
          { metric: "recip_rank_10", scope: "all", value: 0.88 },
          { metric: "map", scope: "all", value: 0.55 },
        ],
      },
      null,
      2,
    ),
    "utf8",
  );

  process.chdir(root);
  try {
    const report = buildReport({
      benchmarkId: "msmarco-v1-passage",
      runDir,
      qrelsPath: "",
      secondaryQrelsPath: undefined,
      recallCutoffs: [1000],
      ndcgCutoffs: [10],
      mrrCutoffs: [10],
    });

    assert.match(
      report.markdown,
      /Prefix-of-agent-set qrels\.txt metrics are recall@1000=66\.00%, ndcg@10=77\.00%, mrr@10=88\.00%, map=55\.00%\./,
    );
    assert.match(report.markdown, /\| qrels\.txt \| 66\.00% \| 77\.00% \| 88\.00% \| 55\.00% \|/);
  } finally {
    process.chdir(cwd);
  }
});

test("buildReport surfaces benchmark-specific retrieval semantics for MSMARCO-style runs", () => {
  const root = mkdtempSync(join(tmpdir(), "report-run-markdown-"));
  const runDir = join(root, "run");
  const mergedDir = join(runDir, "merged");
  mkdirSync(mergedDir, { recursive: true });

  writeFileSync(
    join(runDir, "benchmark_manifest_snapshot.json"),
    JSON.stringify(
      {
        benchmark_id: "msmarco-v1-passage",
        benchmark_display_name: "MS MARCO v1 Passage",
        dataset_id: "msmarco-v1-passage",
        query_set_id: "dl19",
        prompt_variant: "plain_minimal",
        query_path: join(root, "queries.tsv"),
        qrels_path: join(root, "qrels.txt"),
        index_path: "indexes/msmarco-v1-passage",
      },
      null,
      2,
    ),
    "utf8",
  );
  writeFileSync(join(root, "queries.tsv"), "1\tquery\n", "utf8");
  writeFileSync(join(root, "qrels.txt"), "1 0 d1 2\n1 0 d2 1\n", "utf8");
  writeFileSync(
    join(mergedDir, "1.json"),
    JSON.stringify(
      { query_id: "1", status: "completed", retrieved_docids: ["d1"], stats: {} },
      null,
      2,
    ),
    "utf8",
  );

  const report = buildReport({
    benchmarkId: "msmarco-v1-passage",
    runDir,
    qrelsPath: "",
    secondaryQrelsPath: undefined,
    recallCutoffs: [1000],
    ndcgCutoffs: [10],
    mrrCutoffs: [10],
  });

  assert.match(report.markdown, /## Retrieval metric semantics/);
  assert.match(report.markdown, /\| nDCG gain mode \| linear \|/);
  assert.match(report.markdown, /\| Recall relevance threshold \| qrel >= 2 \|/);
  assert.match(report.markdown, /\| Binary relevance threshold \(MRR \/ MAP\) \| qrel >= 1 \|/);
  assert.match(
    report.markdown,
    /Agent-set full-sequence coverage on qrels\.txt qrels is 100\.00% macro and 100\.00% micro\./,
  );
  assert.match(report.markdown, /\| qrels\.txt \| 100\.00% \| 100\.00% \| 1 \/ 1 \|/);
});
