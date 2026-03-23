import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { resolveGitCommitProvenance } from "../src/runtime/git";

void test("resolveGitCommitProvenance returns current repo commit metadata when inside the repo", () => {
  const provenance = resolveGitCommitProvenance();

  assert.match(provenance.gitCommit ?? "", /^[0-9a-f]{40}$/);
  assert.match(provenance.gitCommitShort ?? "", /^[0-9a-f]{6}$/);
  assert.equal(provenance.gitCommitShort, provenance.gitCommit?.slice(0, 6));
});

void test("resolveGitCommitProvenance returns empty metadata outside a git repo", () => {
  const outsideRepo = mkdtempSync(join(tmpdir(), "runtime-git-"));
  const provenance = resolveGitCommitProvenance(outsideRepo);

  assert.deepEqual(provenance, {});
});
