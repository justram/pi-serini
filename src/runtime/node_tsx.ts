export function buildNodeTsxCommand(scriptPath: string, args: string[] = []): string[] {
  return [process.execPath, "--import", "tsx", scriptPath, ...args];
}
