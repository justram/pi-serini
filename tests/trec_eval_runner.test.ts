import test from "node:test";
import assert from "node:assert/strict";

import {
  buildTrecEvalCommands,
  parseTrecEvalMetricOutput,
  resolveAnseriniJarPath,
} from "../src/evaluation/trec_eval_runner";

void test("resolveAnseriniJarPath prefers explicit environment overrides", () => {
  assert.equal(
    resolveAnseriniJarPath({ ANSERINI_JAR: "custom/anserini.jar" } as NodeJS.ProcessEnv),
    "custom/anserini.jar",
  );
  assert.equal(
    resolveAnseriniJarPath({ ANSERINI_FATJAR_PATH: "custom/fatjar.jar" } as NodeJS.ProcessEnv),
    "custom/fatjar.jar",
  );
});

void test("parseTrecEvalMetricOutput parses standard trec_eval metric output", () => {
  assert.deepEqual(parseTrecEvalMetricOutput("ndcg_cut_10            all\t0.5058\n"), {
    metric: "ndcg_cut_10",
    scope: "all",
    value: 0.5058,
    stdout: "ndcg_cut_10            all\t0.5058",
  });
});

void test("buildTrecEvalCommands builds Java trec_eval commands for configured metrics", () => {
  const commands = buildTrecEvalCommands({
    anseriniJarPath: "vendor/anserini/anserini-1.6.0-fatjar.jar",
    qrelsPath: "data/msmarco-v1-passage/qrels/qrels.dl19-passage.txt",
    runFilePath: "data/msmarco-v1-passage/source/bm25_pure.dl19.trec",
    metrics: [
      { id: "ndcg_cut_10", args: ["-c", "-m", "ndcg_cut.10"] },
      { id: "recall_1000_l2", args: ["-c", "-m", "recall.1000", "-l", "2"] },
    ],
  });

  assert.deepEqual(commands, [
    {
      metricId: "ndcg_cut_10",
      command: [
        "java",
        "-cp",
        `${process.cwd()}/vendor/anserini/anserini-1.6.0-fatjar.jar`,
        "trec_eval",
        "-c",
        "-m",
        "ndcg_cut.10",
        `${process.cwd()}/data/msmarco-v1-passage/qrels/qrels.dl19-passage.txt`,
        `${process.cwd()}/data/msmarco-v1-passage/source/bm25_pure.dl19.trec`,
      ],
    },
    {
      metricId: "recall_1000_l2",
      command: [
        "java",
        "-cp",
        `${process.cwd()}/vendor/anserini/anserini-1.6.0-fatjar.jar`,
        "trec_eval",
        "-c",
        "-m",
        "recall.1000",
        "-l",
        "2",
        `${process.cwd()}/data/msmarco-v1-passage/qrels/qrels.dl19-passage.txt`,
        `${process.cwd()}/data/msmarco-v1-passage/source/bm25_pure.dl19.trec`,
      ],
    },
  ]);
});
