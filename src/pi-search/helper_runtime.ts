import type { PiSearchBackend } from "./retrieval_contract/interface";
import { createPiSearchBackend, buildPiSearchBackendCacheKey } from "./adapters/create";
import type { PiSearchExtensionConfig } from "./config";

export class PiSearchBackendRuntime {
  private readonly backendByKey = new Map<string, PiSearchBackend>();

  constructor(private readonly config: PiSearchExtensionConfig) {}

  getBackend(cwd: string): PiSearchBackend {
    const key = buildPiSearchBackendCacheKey(cwd, this.config);
    let backend = this.backendByKey.get(key);
    if (!backend) {
      backend = createPiSearchBackend(cwd, this.config);
      this.backendByKey.set(key, backend);
    }
    return backend;
  }

  dispose(): void {
    for (const backend of this.backendByKey.values()) {
      void backend.close?.();
    }
    this.backendByKey.clear();
  }
}
