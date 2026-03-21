import assert from "node:assert/strict";
import test from "node:test";

import { resolveDefaultIndexPath } from "../../src/pi-search/extension";

test("resolveDefaultIndexPath follows the benchmark registry default", () => {
  assert.equal(resolveDefaultIndexPath({}), "indexes/browsecomp-plus-bm25-tevatron");
});

test("resolveDefaultIndexPath respects BENCHMARK overrides", () => {
  assert.equal(
    resolveDefaultIndexPath({ BENCHMARK: "benchmark-template" }),
    "indexes/benchmark-template-bm25",
  );
});
