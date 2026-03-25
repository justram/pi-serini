import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { createRepoPiSearchBackend } from "../bm25/pi_search_backend_factory";
import { registerPiSearchExtension } from "../pi-search/extension";

export default function (pi: ExtensionAPI) {
  registerPiSearchExtension(pi, {
    createBackend: createRepoPiSearchBackend,
  });
}
