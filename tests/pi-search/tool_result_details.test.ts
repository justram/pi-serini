import assert from "node:assert/strict";
import test from "node:test";

import { extractRetrievedDocidsFromPiSearchToolDetails } from "../../src/pi-search/protocol/tool_result_details";

void test("extractRetrievedDocidsFromPiSearchToolDetails returns retrievedDocids for valid pi-search search details", () => {
  assert.deepEqual(
    extractRetrievedDocidsFromPiSearchToolDetails({
      searchId: "s1",
      retrievedDocids: ["d1", "d2"],
      totalCached: 2,
    }),
    ["d1", "d2"],
  );
});

void test("extractRetrievedDocidsFromPiSearchToolDetails rejects malformed details instead of guessing from shape", () => {
  assert.deepEqual(
    extractRetrievedDocidsFromPiSearchToolDetails({
      retrievedDocids: ["d1", 42],
    }),
    [],
  );
});
