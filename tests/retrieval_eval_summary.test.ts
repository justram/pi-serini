import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";

import {
  buildLegacyRetrievalEvalSummaryPath,
  buildRetrievalEvalSummaryPath,
  loadRetrievalEvalSummary,
  maybeLoadMatchingRetrievalEvalSummary,
  writeRetrievalEvalSummary,
} from "../src/evaluation/retrieval_eval_summary";

void test("buildRetrievalEvalSummaryPath preserves source-relative nesting under evals/retrieval", () => {
  assert.equal(
    buildRetrievalEvalSummaryPath({
      benchmarkId: "msmarco-v1-passage",
      sourcePath: "data/msmarco-v1-passage/source/bm25_pure.dl19.trec",
    }),
    `${process.cwd()}/evals/retrieval/msmarco-v1-passage/data/msmarco-v1-passage/source/bm25_pure.dl19.summary.json`,
  );
});

void test("buildRetrievalEvalSummaryPath uses external/ prefix for sources outside the repo root", () => {
  assert.equal(
    buildRetrievalEvalSummaryPath({
      benchmarkId: "benchmark-template",
      sourcePath: "/tmp/pi-serini-tests/run.trec",
      evalRoot: "/tmp/pi-serini/evals/retrieval",
    }),
    "/tmp/pi-serini/evals/retrieval/benchmark-template/external/tmp/pi-serini-tests/run.summary.json",
  );
});

void test("writeRetrievalEvalSummary and loadRetrievalEvalSummary round-trip unified summaries", () => {
  const root = mkdtempSync(join(tmpdir(), "retrieval-eval-summary-"));
  const summaryPath = join(root, "summary.json");
  const expected = {
    benchmarkId: "benchmark-template",
    querySetId: "dev",
    backend: "internal" as const,
    sourceType: "run-dir" as const,
    sourcePath: "/tmp/run",
    qrelsPath: "/tmp/qrels.txt",
    queryCount: 2,
    metricSemantics: {
      ndcgGainMode: "exponential" as const,
      recallRelevantThreshold: 1,
      binaryRelevantThreshold: 1,
    },
    metrics: [
      { metric: "ndcg_cut_10", scope: "all", value: 0.5 },
      { metric: "recall_1000", scope: "all", value: 0.75 },
    ],
  };

  writeRetrievalEvalSummary(summaryPath, expected);
  assert.deepEqual(loadRetrievalEvalSummary(summaryPath), expected);
});

void test("maybeLoadMatchingRetrievalEvalSummary falls back to the legacy flat path for existing artifacts", () => {
  const root = mkdtempSync(join(tmpdir(), "retrieval-eval-summary-legacy-"));
  const sourcePath = resolve(root, "runs", "nested", "candidate.trec");
  const qrelsPath = resolve(root, "qrels.txt");
  mkdirSync(resolve(root, "runs", "nested"), { recursive: true });
  writeFileSync(qrelsPath, "", "utf8");

  const summary = {
    benchmarkId: "benchmark-template",
    querySetId: "dev",
    backend: "internal" as const,
    sourceType: "run-file" as const,
    sourcePath,
    qrelsPath,
    queryCount: 1,
    metricSemantics: {
      ndcgGainMode: "exponential" as const,
      recallRelevantThreshold: 1,
      binaryRelevantThreshold: 1,
    },
    metrics: [{ metric: "ndcg_cut_10", scope: "all", value: 0.5 }],
  };

  const legacyPath = buildLegacyRetrievalEvalSummaryPath({
    benchmarkId: "benchmark-template",
    sourcePath,
  });
  mkdirSync(dirname(legacyPath), { recursive: true });
  writeRetrievalEvalSummary(legacyPath, summary);

  assert.deepEqual(
    maybeLoadMatchingRetrievalEvalSummary({
      benchmarkId: "benchmark-template",
      sourcePath,
      qrelsPath,
      sourceType: "run-file",
      querySetId: "dev",
      queryCount: 1,
      requireQueryCountMatch: true,
    }),
    summary,
  );
});
