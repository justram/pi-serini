import assert from "node:assert/strict";
import test from "node:test";

import { buildPiJsonCommandArgs, startPiProcessTimeout } from "../src/runtime/pi_process";

void test("buildPiJsonCommandArgs includes extension wiring only when provided", () => {
  assert.deepEqual(
    buildPiJsonCommandArgs({
      model: "openai-codex/gpt-5.4-mini",
      thinking: "medium",
      prompt: "hello",
      extensionPath: "src/pi-search/extension.ts",
    }),
    [
      "--no-tools",
      "--no-session",
      "--no-skills",
      "-e",
      "src/pi-search/extension.ts",
      "--mode",
      "json",
      "--model",
      "openai-codex/gpt-5.4-mini",
      "--thinking",
      "medium",
      "hello",
    ],
  );

  assert.deepEqual(
    buildPiJsonCommandArgs({
      model: "openai-codex/gpt-5.4-mini",
      thinking: "medium",
      prompt: "judge prompt",
    }),
    [
      "--no-tools",
      "--no-session",
      "--no-skills",
      "--mode",
      "json",
      "--model",
      "openai-codex/gpt-5.4-mini",
      "--thinking",
      "medium",
      "judge prompt",
    ],
  );
});

void test("startPiProcessTimeout sends SIGTERM immediately and SIGKILL after the grace period", async () => {
  const signals: string[] = [];
  const fakeChild = {
    killed: false,
    kill(signal?: NodeJS.Signals) {
      signals.push(signal ?? "SIGTERM");
      return true;
    },
  } as unknown as import("node:child_process").ChildProcess;

  let timedOut = false;
  const controller = startPiProcessTimeout({
    child: fakeChild,
    timeoutSeconds: 0.001,
    killGracePeriodMs: 1,
    onTimeout: () => {
      timedOut = true;
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(timedOut, true);
  assert.equal(controller.wasTriggered(), true);
  assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
  controller.clear();
});

void test("startPiProcessTimeout does not escalate to SIGKILL after the child is marked killed", async () => {
  const signals: string[] = [];
  const fakeChildState = { killed: false };
  const fakeChild = {
    get killed() {
      return fakeChildState.killed;
    },
    kill(signal?: NodeJS.Signals) {
      signals.push(signal ?? "SIGTERM");
      fakeChildState.killed = true;
      return true;
    },
  } as unknown as import("node:child_process").ChildProcess;

  const controller = startPiProcessTimeout({
    child: fakeChild,
    timeoutSeconds: 0.001,
    killGracePeriodMs: 1,
  });

  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(controller.wasTriggered(), true);
  assert.deepEqual(signals, ["SIGTERM"]);
  controller.clear();
});
