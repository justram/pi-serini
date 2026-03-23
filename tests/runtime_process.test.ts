import assert from "node:assert/strict";
import test from "node:test";

import { runInheritedCommandSync } from "../src/runtime/process";

test("runInheritedCommandSync executes a successful child command with inherited defaults", () => {
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

test("runInheritedCommandSync exits with the child status code on non-zero exit", () => {
  const originalExit = process.exit;
  try {
    process.exit = ((code?: number) => {
      throw new Error(`process.exit:${code ?? "undefined"}`);
    }) as typeof process.exit;

    assert.throws(
      () => {
        runInheritedCommandSync(
          [process.execPath, "-e", "process.exit(7)"],
          { stdio: "pipe" },
          "non-zero-test",
        );
      },
      /process\.exit:7/,
    );
  } finally {
    process.exit = originalExit;
  }
});

test("runInheritedCommandSync throws when the child exits with a signal", () => {
  assert.throws(
    () => {
      runInheritedCommandSync(
        [process.execPath, "-e", "process.kill(process.pid, 'SIGTERM')"],
        { stdio: "pipe" },
        "signal-test",
      );
    },
    /signal-test exited with signal SIGTERM/,
  );
});
