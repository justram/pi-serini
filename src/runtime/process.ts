import { spawnSync, type SpawnSyncOptions } from "node:child_process";

export function runInheritedCommandSync(
  command: readonly string[],
  options: SpawnSyncOptions = {},
  label = command[0] ?? "command",
): void {
  if (command.length === 0) {
    throw new Error("runInheritedCommandSync requires a non-empty command");
  }

  const result = spawnSync(command[0], command.slice(1), {
    stdio: "inherit",
    env: process.env,
    ...options,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.signal) {
    throw new Error(`${label} exited with signal ${result.signal}`);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
