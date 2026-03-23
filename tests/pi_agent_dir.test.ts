import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { prepareIsolatedAgentDir, resolveDefaultAgentDir } from "../src/runtime/pi_agent_dir";

void test("resolveDefaultAgentDir honors tilde-expanded PI_CODING_AGENT_DIR overrides", () => {
  const originalHome = process.env.HOME;
  process.env.HOME = "/tmp/pi-agent-home";

  try {
    assert.equal(resolveDefaultAgentDir({ PI_CODING_AGENT_DIR: "~" }), "/tmp/pi-agent-home");
    assert.equal(
      resolveDefaultAgentDir({ PI_CODING_AGENT_DIR: "~/.pi/custom-agent" }),
      "/tmp/pi-agent-home/.pi/custom-agent",
    );
  } finally {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
  }
});

void test("prepareIsolatedAgentDir creates temp agent state outside artifact roots", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-agent-dir-"));
  const sourceAgentDir = join(root, "source-agent");
  const artifactRoot = join(root, "runs", "demo-run");
  const tempRoot = join(root, "temp-agent-dirs");

  mkdirSync(sourceAgentDir, { recursive: true });
  writeFileSync(join(sourceAgentDir, "auth.json"), '{"token":"secret"}\n', {
    encoding: "utf8",
    flag: "wx",
  });
  writeFileSync(join(sourceAgentDir, "models.json"), '{"default":"model"}\n', {
    encoding: "utf8",
    flag: "wx",
  });

  const isolatedAgentDir = prepareIsolatedAgentDir(artifactRoot, {
    env: { PI_CODING_AGENT_DIR: sourceAgentDir },
    tempRoot,
  });

  assert.ok(isolatedAgentDir.startsWith(`${resolve(tempRoot)}/`));
  assert.ok(!isolatedAgentDir.startsWith(`${resolve(artifactRoot)}/`));
  assert.ok(existsSync(join(isolatedAgentDir, "auth.json")));
  assert.ok(existsSync(join(isolatedAgentDir, "models.json")));
  assert.ok(!existsSync(join(isolatedAgentDir, "oauth.json")));
  assert.ok(!existsSync(join(artifactRoot, ".pi-agent-isolated")));
});
