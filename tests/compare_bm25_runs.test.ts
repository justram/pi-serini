import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildBuckets, resolveOverallMetrics } from "../src/evaluation/compare_bm25_runs";
import type { Qrels, Rankings } from "../src/evaluation/retrieval_metrics";

test("buildBuckets uses benchmark recall semantics for difficulty and gold buckets", () => {
  const qrels: Qrels = new Map([
    [
      "1",
      new Map([
        ["doc-a", 1],
        ["doc-b", 2],
      ]),
    ],
  ]);
  const rankings: Rankings = new Map([
    [
      "1",
      [
        { docid: "doc-a", rank: 1, score: 2 },
        { docid: "doc-z", rank: 2, score: 1 },
      ],
    ],
  ]);

  const defaultBuckets = buildBuckets(["1"], rankings, qrels, 1);
  const trecLikeBuckets = buildBuckets(["1"], rankings, qrels, 1, {
    recallRelevantThreshold: 2,
  });

  assert.deepEqual(defaultBuckets.difficulty, [{ label: "medium", queryIds: ["1"] }]);
  assert.deepEqual(defaultBuckets.gold, [{ label: "small", queryIds: ["1"] }]);

  assert.deepEqual(trecLikeBuckets.difficulty, [{ label: "zero", queryIds: ["1"] }]);
  assert.deepEqual(trecLikeBuckets.gold, [{ label: "small", queryIds: ["1"] }]);
  assert.deepEqual(trecLikeBuckets.strata, [{ label: "zero_small", queryIds: ["1"] }]);
});

test("compare_bm25_runs CLI resolves query-set-specific compare defaults", () => {
  const output = execFileSync(
    "node",
    [
      "--import",
      "tsx",
      "src/evaluation/compare_bm25_runs.ts",
      "--help",
    ],
    {
      cwd: process.cwd(),
      env: process.env,
      encoding: "utf8",
    },
  );

  assert.match(output, /--querySet, --query-set\s+Query set id for benchmark-scoped compare defaults/);

  const dl19Output = execFileSync(
    "node",
    [
      "--import",
      "tsx",
      "src/evaluation/compare_bm25_runs.ts",
      "--benchmark",
      "msmarco-v1-passage",
      "--query-set",
      "dl19",
      "--candidateRun",
      "data\/msmarco-v1-passage\/source\/bm25_pure.dl19.trec",
      "--baselineRun",
      "data\/msmarco-v1-passage\/source\/bm25_pure.dl19.trec",
    ],
    {
      cwd: process.cwd(),
      env: process.env,
      encoding: "utf8",
    },
  );

  assert.match(dl19Output, /Queries: .*data\/msmarco-v1-passage\/queries\/dl19.tsv/);
  assert.match(dl19Output, /Qrels: .*data\/msmarco-v1-passage\/qrels\/qrels\.dl19-passage\.txt/);

  const dl20Output = execFileSync(
    "node",
    [
      "--import",
      "tsx",
      "src/evaluation/compare_bm25_runs.ts",
      "--benchmark",
      "msmarco-v1-passage",
      "--query-set",
      "dl20",
      "--candidateRun",
      "data\/msmarco-v1-passage\/source\/bm25_pure.dl20.trec",
      "--baselineRun",
      "data\/msmarco-v1-passage\/source\/bm25_pure.dl20.trec",
    ],
    {
      cwd: process.cwd(),
      env: process.env,
      encoding: "utf8",
    },
  );

  assert.match(dl20Output, /Queries: .*data\/msmarco-v1-passage\/queries\/dl20.tsv/);
  assert.match(dl20Output, /Qrels: .*data\/msmarco-v1-passage\/qrels\/qrels\.dl20-passage\.txt/);
});

test("resolveOverallMetrics prefers matching normalized retrieval summaries", () => {
  const root = mkdtempSync(join(tmpdir(), "compare-bm25-runs-"));
  const cwd = process.cwd();
  const runPath = join(root, "candidate.trec");
  const qrelsPath = join(root, "qrels.txt");
  const summaryDir = join(root, "evals", "retrieval", "msmarco-v1-passage");
  mkdirSync(summaryDir, { recursive: true });
  writeFileSync(runPath, "1 Q0 doc-a 1 1.0 run\n", "utf8");
  writeFileSync(qrelsPath, "1 0 doc-a 1\n", "utf8");
  writeFileSync(
    join(summaryDir, "candidate.summary.json"),
    JSON.stringify(
      {
        benchmarkId: "msmarco-v1-passage",
        querySetId: "dl19",
        backend: "trec_eval",
        sourceType: "run-file",
        sourcePath: runPath,
        qrelsPath,
        metricSemantics: {
          ndcgGainMode: "linear",
          recallRelevantThreshold: 2,
          binaryRelevantThreshold: 1,
        },
        metrics: [
          { metric: "ndcg_cut_10", scope: "all", value: 0.77 },
          { metric: "recall_1000", scope: "all", value: 0.66 },
        ],
      },
      null,
      2,
    ),
    "utf8",
  );

  const qrels: Qrels = new Map([["1", new Map([["doc-a", 1]])]]);
  const rankings: Rankings = new Map([["1", [{ docid: "doc-a", rank: 1, score: 1 }]]]);

  process.chdir(root);
  try {
    const metrics = resolveOverallMetrics({
      benchmarkId: "msmarco-v1-passage",
      querySetId: "dl19",
      runPath,
      qrelsPath,
      queryCount: 1,
      queryIds: ["1"],
      rankings,
      qrels,
      ndcgCutoff: 10,
      recallCutoff: 1000,
      semantics: { ndcgGainMode: "linear", recallRelevantThreshold: 2, binaryRelevantThreshold: 1 },
    });

    assert.equal(metrics.usedSummary, true);
    assert.equal(metrics.ndcg, 0.77);
    assert.equal(metrics.recall, 0.66);
  } finally {
    process.chdir(cwd);
  }
});
