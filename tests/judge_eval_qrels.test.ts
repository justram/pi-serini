import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadJudgeEvalRelevantDocids } from "../src/evaluation/judge_eval_qrels";

void test("loadJudgeEvalRelevantDocids applies benchmark recall thresholds", () => {
  const root = mkdtempSync(join(tmpdir(), "judge-eval-qrels-"));
  const qrelsPath = join(root, "qrels.txt");
  writeFileSync(
    qrelsPath,
    ["1 0 d0 0", "1 0 d1 1", "1 0 d2 2", "1 0 d3 3", "2 0 x1 1", "2 0 x2 2"].join("\n") + "\n",
    "utf8",
  );

  assert.deepEqual(
    loadJudgeEvalRelevantDocids(qrelsPath, { benchmarkId: "benchmark-template" }),
    new Map([
      ["1", ["d1", "d2", "d3"]],
      ["2", ["x1", "x2"]],
    ]),
  );

  assert.deepEqual(
    loadJudgeEvalRelevantDocids(qrelsPath, { benchmarkId: "msmarco-v1-passage" }),
    new Map([
      ["1", ["d2", "d3"]],
      ["2", ["x2"]],
    ]),
  );
});
