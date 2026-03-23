import assert from "node:assert/strict";
import test from "node:test";

import { evaluateRankings, type Qrels, type Rankings } from "../src/evaluation/retrieval_metrics";

function buildQrels(): Qrels {
  return new Map([
    [
      "1",
      new Map([
        ["doc-a", 1],
        ["doc-b", 2],
      ]),
    ],
  ]);
}

function buildRankings(): Rankings {
  return new Map([
    [
      "1",
      [
        { docid: "doc-a", rank: 1, score: 2 },
        { docid: "doc-b", rank: 2, score: 1 },
      ],
    ],
  ]);
}

void test("evaluateRankings supports benchmark-configured nDCG gain semantics", () => {
  const qrels = buildQrels();
  const rankings = buildRankings();
  const cutoffs = { recallCutoffs: [2], ndcgCutoffs: [2], mrrCutoffs: [10] };

  const exponential = evaluateRankings(qrels, rankings, ["1"], cutoffs, {
    ndcgGainMode: "exponential",
  });
  const linear = evaluateRankings(qrels, rankings, ["1"], cutoffs, {
    ndcgGainMode: "linear",
  });

  assert.equal(exponential.ndcgByCutoff.get(2)?.toFixed(4), "0.7967");
  assert.equal(linear.ndcgByCutoff.get(2)?.toFixed(4), "0.8597");
});

void test("evaluateRankings applies recall thresholds without changing binary MRR/MAP relevance", () => {
  const qrels = buildQrels();
  const rankings = buildRankings();
  const cutoffs = { recallCutoffs: [1, 2], ndcgCutoffs: [2], mrrCutoffs: [10] };

  const defaultSemantics = evaluateRankings(qrels, rankings, ["1"], cutoffs);
  const trecLikeSemantics = evaluateRankings(qrels, rankings, ["1"], cutoffs, {
    recallRelevantThreshold: 2,
    ndcgGainMode: "linear",
  });

  assert.equal(defaultSemantics.macroRecallByCutoff.get(1), 0.5);
  assert.equal(trecLikeSemantics.macroRecallByCutoff.get(1), 0);
  assert.equal(defaultSemantics.macroRecallByCutoff.get(2), 1);
  assert.equal(trecLikeSemantics.macroRecallByCutoff.get(2), 1);
  assert.equal(defaultSemantics.mrrByCutoff.get(10), 1);
  assert.equal(trecLikeSemantics.mrrByCutoff.get(10), 1);
  assert.equal(defaultSemantics.map, 1);
  assert.equal(trecLikeSemantics.map, 1);
});
