import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveBenchmarkJudgeEvaluation,
  resolveBenchmarkRetrievalEvaluation,
} from "../src/evaluation/benchmark_evaluation";

void test("benchmark evaluation resolver exposes benchmark-specific retrieval backends and semantics", () => {
  const browsecompRunFile = resolveBenchmarkRetrievalEvaluation({
    benchmarkId: "browsecomp-plus",
    sourceType: "run-file",
  });
  assert.equal(browsecompRunFile.selectedBackend, "internal");
  assert.deepEqual(browsecompRunFile.internalMetricSemantics, {
    ndcgGainMode: "exponential",
    recallRelevantThreshold: 1,
    binaryRelevantThreshold: 1,
  });

  const msmarcoRunFile = resolveBenchmarkRetrievalEvaluation({
    benchmarkId: "msmarco-v1-passage",
    sourceType: "run-file",
  });
  assert.equal(msmarcoRunFile.selectedBackend, "trec_eval");
  assert.ok(msmarcoRunFile.trecEvalMetrics);
  assert.equal(msmarcoRunFile.trecEvalMetrics?.[0]?.id, "ndcg_cut_10");
  assert.deepEqual(msmarcoRunFile.internalMetricSemantics, {
    ndcgGainMode: "linear",
    recallRelevantThreshold: 2,
    binaryRelevantThreshold: 1,
  });

  const msmarcoRunDir = resolveBenchmarkRetrievalEvaluation({
    benchmarkId: "msmarco-v1-passage",
    sourceType: "run-dir",
  });
  assert.equal(msmarcoRunDir.selectedBackend, "internal");
});

void test("benchmark evaluation resolver exposes benchmark-specific judge defaults", () => {
  const browsecompJudge = resolveBenchmarkJudgeEvaluation({
    benchmarkId: "browsecomp-plus",
    groundTruthConfigured: true,
  });
  assert.equal(browsecompJudge.defaultMode, "gold-answer");
  assert.deepEqual(browsecompJudge.supportedModes, ["gold-answer", "reference-free"]);

  const msmarcoJudge = resolveBenchmarkJudgeEvaluation({
    benchmarkId: "msmarco-v1-passage",
    groundTruthConfigured: false,
  });
  assert.equal(msmarcoJudge.defaultMode, "reference-free");
  assert.deepEqual(msmarcoJudge.supportedModes, ["reference-free"]);
});
