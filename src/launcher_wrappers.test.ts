import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

const baseEnv = {
  ...process.env,
  PI_SERINI_DRY_RUN: "1",
};

function runScript(script: string, env: NodeJS.ProcessEnv = {}): string {
  return execFileSync("bash", [script], {
    cwd: process.cwd(),
    env: {
      ...baseEnv,
      ...env,
    },
    encoding: "utf8",
  });
}

test("generic benchmark query-set runner resolves manifest-aligned defaults", () => {
  const output = runScript("scripts/run_benchmark_query_set.sh", {
    BENCHMARK: "benchmark-template",
  });

  assert.match(output, /BENCHMARK=benchmark-template/);
  assert.match(output, /QUERY_SET=dev/);
  assert.match(output, /QUERY_FILE=data\/benchmark-template\/queries\/dev.tsv/);
  assert.match(output, /QRELS_FILE=data\/benchmark-template\/qrels\/qrel_primary.txt/);
  assert.match(output, /INDEX_PATH=indexes\/benchmark-template-bm25/);
  assert.match(output, /OUTPUT_DIR=runs\/pi_bm25_benchmark-template_dev_plain_minimal/);
});

test("legacy BrowseComp shared wrapper preserves legacy output naming", () => {
  const output = runScript("scripts/launch_browsecomp_plus_slice_plain_minimal_excerpt_shared_server.sh", {
    SLICE: "q9",
  });

  assert.match(output, /BENCHMARK=browsecomp-plus/);
  assert.match(output, /QUERY_SET=q9/);
  assert.match(output, /LOG_DIR=runs\/shared-bm25-q9/);
  assert.match(output, /OUTPUT_DIR=runs\/pi_bm25_q9_plain_minimal_excerpt/);
});

test("generic sharded launcher resolves benchmark-aware output naming", () => {
  const output = runScript("scripts/launch_benchmark_query_set_sharded_shared.sh", {
    BENCHMARK: "benchmark-template",
    SHARD_COUNT: "3",
  });

  assert.match(output, /BENCHMARK=benchmark-template/);
  assert.match(output, /QUERY_SET=dev/);
  assert.match(output, /QRELS_FILE=data\/benchmark-template\/qrels\/qrel_primary.txt/);
  assert.match(output, /INDEX_PATH=indexes\/benchmark-template-bm25/);
  assert.match(output, /SHARD_COUNT=3/);
  assert.match(
    output,
    /OUTPUT_ROOT=runs\/pi_bm25_benchmark-template_dev_plain_minimal_gpt54mini_shared3_\d{8}_\d{6}/,
  );
});
