// ABOUTME: Vitest global setup — injects localStorage/sessionStorage into the jsdom env, and a scratch Pi agent dir.
// ABOUTME: vitest's jsdom runs on about:blank, which omits Web Storage; tests calling clear()/getItem() crash without this.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach } from "vitest";
import { createMemoryStorage } from "./public/app/test-utils/memory-storage.js";

// Pi's getAgentDir() falls back to os.homedir(), which ignores a stubbed HOME. Without this a
// test that reaches the real function writes the user's ~/.pi/agent.
const scratchAgentDir = mkdtempSync(join(tmpdir(), "spopi-test-agent-"));
process.env.PI_CODING_AGENT_DIR = scratchAgentDir;

const localStorageImpl = createMemoryStorage();
const sessionStorageImpl = createMemoryStorage();

// Inject only when the environment hasn't already provided one (jsdom on a real
// URL would). Configurable+writable so individual tests can still vi.stubGlobal
// their own storage and restore via unstubAllGlobals.
if (!globalThis.localStorage) {
  Object.defineProperty(globalThis, "localStorage", {
    value: localStorageImpl,
    configurable: true,
    writable: true,
  });
}
if (!globalThis.sessionStorage) {
  Object.defineProperty(globalThis, "sessionStorage", {
    value: sessionStorageImpl,
    configurable: true,
    writable: true,
  });
}

// Reset between tests so state never leaks across files or cases. Tests that
// stub their own storage are unaffected — this only clears the shared impl.
beforeEach(() => {
  process.env.PI_CODING_AGENT_DIR = scratchAgentDir;
  localStorageImpl.clear();
  sessionStorageImpl.clear();
});
