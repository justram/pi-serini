import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  buildRetrievalEvalSummaryPath,
  loadRetrievalEvalSummary,
  writeRetrievalEvalSummary,
} from "../src/retrieval_eval_summary";

test("buildRetrievalEvalSummaryPath uses benchmark-aware evals/retrieval layout", () => {
  assert.equal(
    buildRetrievalEvalSummaryPath({
      benchmarkId: "msmarco-v1-passage",
      sourcePath: "data/msmarco-v1-passage/source/bm25_pure.dl19.trec",
    }),
    `${process.cwd()}/evals/retrieval/msmarco-v1-passage/bm25_pure.dl19.summary.json`,
  );
});

test("writeRetrievalEvalSummary and loadRetrievalEvalSummary round-trip unified summaries", () => {
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
    metrics: [
      { metric: "ndcg_cut_10", scope: "all", value: 0.5 },
      { metric: "recall_1000", scope: "all", value: 0.75 },
    ],
  };

  writeRetrievalEvalSummary(summaryPath, expected);
  assert.deepEqual(loadRetrievalEvalSummary(summaryPath), expected);
});
