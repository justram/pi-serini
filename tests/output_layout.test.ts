import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";

import {
  getJudgeEvalSummaryCandidates,
  getRunRelativeParts,
  resolveBenchmarkAwareSharedLogDir,
  resolveJudgeEvalOutputDir,
  resolveRetrievalEvalSummaryPath,
} from "../src/runtime/output_layout";
import { buildAssetsDir } from "../src/report/report_markdown_utils";

void test("output layout preserves run-relative nesting for merged runs", () => {
  const runDir = "/tmp/pi-serini/runs/managed/foo/run-123/merged";

  assert.deepEqual(getRunRelativeParts(runDir), ["managed", "foo", "run-123"]);
  assert.equal(
    resolveJudgeEvalOutputDir({
      inputDir: runDir,
      evalRoot: "/tmp/pi-serini/evals/pi_judge",
      benchmarkId: "browsecomp-plus",
    }),
    "/tmp/pi-serini/evals/pi_judge/browsecomp-plus/managed/foo/run-123",
  );
});

void test("retrieval summaries preserve source-relative nesting and avoid basename collisions", () => {
  assert.equal(
    resolveRetrievalEvalSummaryPath({
      benchmarkId: "msmarco-v1-passage",
      sourcePath: "/tmp/pi-serini/runs/pi_agent_msmarco_dl19_full_live",
      evalRoot: "/tmp/pi-serini/evals/retrieval",
    }),
    "/tmp/pi-serini/evals/retrieval/msmarco-v1-passage/external/tmp/pi-serini/runs/pi_agent_msmarco_dl19_full_live.summary.json",
  );
  assert.notEqual(
    resolveRetrievalEvalSummaryPath({
      benchmarkId: "benchmark-template",
      sourcePath: "/tmp/a/run.trec",
      evalRoot: "/tmp/pi-serini/evals/retrieval",
    }),
    resolveRetrievalEvalSummaryPath({
      benchmarkId: "benchmark-template",
      sourcePath: "/tmp/b/run.trec",
      evalRoot: "/tmp/pi-serini/evals/retrieval",
    }),
  );
});

void test("shared BM25 log dirs are benchmark-aware", () => {
  assert.equal(
    resolveBenchmarkAwareSharedLogDir("browsecomp-plus", "q9"),
    "runs/shared-bm25-browsecomp-plus-q9",
  );
  assert.equal(
    resolveBenchmarkAwareSharedLogDir("msmarco-v1-passage", "dl19"),
    "runs/shared-bm25-msmarco-v1-passage-dl19",
  );
});

void test("report assets are scoped to the report output path", () => {
  assert.equal(
    buildAssetsDir("/tmp/pi-serini/runs/run-a/report.md"),
    "/tmp/pi-serini/runs/run-a/report_assets",
  );
  assert.equal(
    buildAssetsDir("/tmp/pi-serini/runs/run-a/custom-summary.md"),
    "/tmp/pi-serini/runs/run-a/custom-summary_assets",
  );
  assert.notEqual(
    buildAssetsDir("/tmp/pi-serini/runs/run-a/report.md"),
    buildAssetsDir("/tmp/pi-serini/runs/run-b/report.md"),
  );
  assert.notEqual(
    buildAssetsDir("/tmp/pi-serini/runs/run-a/report.md"),
    buildAssetsDir("/tmp/pi-serini/runs/run-a/custom-summary.md"),
  );
});

void test("judge summary candidates check benchmark-namespaced locations before legacy fallback paths", () => {
  const candidates = getJudgeEvalSummaryCandidates({
    runDir: "/tmp/pi-serini/runs/managed/foo/run-123/merged",
    benchmarkId: "benchmark-template",
    evalRoot: "/tmp/pi-serini/evals/pi_judge",
  });

  assert.deepEqual(candidates.slice(0, 4), [
    resolve("/tmp/pi-serini/runs/managed/foo/run-123", "merged", "evaluation_summary.json"),
    resolve("/tmp/pi-serini/runs/managed/foo/run-123", "evaluation_summary.json"),
    resolve(
      "/tmp/pi-serini/evals/pi_judge",
      "benchmark-template",
      "managed",
      "foo",
      "run-123",
      "merged",
      "evaluation_summary.json",
    ),
    resolve(
      "/tmp/pi-serini/evals/pi_judge",
      "benchmark-template",
      "managed",
      "foo",
      "run-123",
      "evaluation_summary.json",
    ),
  ]);
});
