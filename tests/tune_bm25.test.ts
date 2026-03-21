import assert from "node:assert/strict";
import test from "node:test";

import { parseArgs } from "../src/tune_bm25";

test("parseArgs resolves tune_bm25 defaults from the benchmark registry", () => {
  const args = parseArgs(["--benchmark", "benchmark-template"]);

  assert.equal(args.benchmarkId, "benchmark-template");
  assert.equal(args.querySetId, "dev");
  assert.equal(args.queriesPath, "data/benchmark-template/queries/dev.tsv");
  assert.equal(args.qrelsPath, "data/benchmark-template/qrels/qrel_primary.txt");
  assert.equal(args.secondaryQrelsPath, "data/benchmark-template/qrels/qrel_secondary.txt");
  assert.equal(args.indexPath, "indexes/benchmark-template-bm25");
});

test("parseArgs preserves explicit tune_bm25 path overrides over benchmark defaults", () => {
  const args = parseArgs([
    "--benchmark",
    "benchmark-template",
    "--query-set",
    "test",
    "--queries",
    "data/custom/queries.tsv",
    "--qrels",
    "data/custom/qrels.txt",
    "--index",
    "indexes/custom-index",
    "--no-secondary-qrels",
  ]);

  assert.equal(args.benchmarkId, "benchmark-template");
  assert.equal(args.querySetId, "test");
  assert.equal(args.queriesPath, "data/custom/queries.tsv");
  assert.equal(args.qrelsPath, "data/custom/qrels.txt");
  assert.equal(args.secondaryQrelsPath, undefined);
  assert.equal(args.indexPath, "indexes/custom-index");
});
