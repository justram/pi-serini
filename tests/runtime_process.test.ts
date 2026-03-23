import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ChildProcess } from "node:child_process";

import {
  runInheritedCommandSync,
  spawnDetachedCommand,
  spawnPipedCommand,
  waitForChildExit,
} from "../src/runtime/process";

void test("runInheritedCommandSync executes a successful child command with inherited defaults", () => {
  assert.doesNotThrow(() => {
    runInheritedCommandSync(
      [process.execPath, "-e", 'if (process.env.PI_SERINI_TEST_FLAG !== "ok") process.exit(2)'],
      {
        stdio: "pipe",
        env: {
          ...process.env,
          PI_SERINI_TEST_FLAG: "ok",
        },
      },
      "success-test",
    );
  });
});

void test("runInheritedCommandSync exits with the child status code on non-zero exit", () => {
  const originalExit = process.exit.bind(process) as typeof process.exit;
  try {
    process.exit = ((code?: number) => {
      throw new Error(`process.exit:${code ?? "undefined"}`);
    }) as typeof process.exit;

    assert.throws(() => {
      runInheritedCommandSync(
        [process.execPath, "-e", "process.exit(7)"],
        { stdio: "pipe" },
        "non-zero-test",
      );
    }, /process\.exit:7/);
  } finally {
    process.exit = originalExit;
  }
});

void test("runInheritedCommandSync throws when the child exits with a signal", () => {
  assert.throws(() => {
    runInheritedCommandSync(
      [process.execPath, "-e", "process.kill(process.pid, 'SIGTERM')"],
      { stdio: "pipe" },
      "signal-test",
    );
  }, /signal-test exited with signal SIGTERM/);
});

void test("spawnPipedCommand returns a child with piped stdout and stderr", async () => {
  const child = spawnPipedCommand(
    [process.execPath, "-e", "process.stdout.write('out'); process.stderr.write('err')"],
    { stdio: ["ignore", "pipe", "pipe"] },
    "piped-test",
  );

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  const status = await waitForChildExit(child, "piped-test");
  assert.equal(status, 0);
  assert.equal(stdout, "out");
  assert.equal(stderr, "err");
});

void test("waitForChildExit returns the child status code for non-zero exits", async () => {
  const child = spawnPipedCommand([process.execPath, "-e", "process.exit(9)"], {}, "status-test");

  const status = await waitForChildExit(child, "status-test");
  assert.equal(status, 9);
});

void test("waitForChildExit throws when the child exits with a signal", async () => {
  const fakeChild = {
    once(event: string, handler: (...args: unknown[]) => void) {
      if (event === "close") {
        queueMicrotask(() => handler(null, "SIGTERM"));
      }
      return this;
    },
  } as unknown as ChildProcess;

  await assert.rejects(() => waitForChildExit(fakeChild, "async-signal-test"), /SIGTERM/);
});

void test("spawnDetachedCommand launches a detached child and redirects stdout/stderr to files", async () => {
  const root = mkdtempSync(join(tmpdir(), "runtime-process-detached-"));
  const stdoutPath = join(root, "stdout.log");
  const stderrPath = join(root, "stderr.log");
  const markerPath = join(root, "done.txt");

  const child = spawnDetachedCommand(
    [
      process.execPath,
      "-e",
      [
        "const fs = require('node:fs');",
        `fs.writeFileSync(${JSON.stringify(markerPath)}, 'done');`,
        "process.stdout.write('detached-out');",
        "process.stderr.write('detached-err');",
      ].join(" "),
    ],
    {
      stdoutPath,
      stderrPath,
    },
    "detached-test",
  );

  assert.ok(typeof child.pid === "number" && child.pid > 0);

  for (let i = 0; i < 50 && !existsSync(markerPath); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  assert.equal(readFileSync(markerPath, "utf8"), "done");
  assert.equal(readFileSync(stdoutPath, "utf8"), "detached-out");
  assert.equal(readFileSync(stderrPath, "utf8"), "detached-err");
});
