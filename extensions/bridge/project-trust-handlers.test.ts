// ABOUTME: Tests MCP trust reads and the idle reload decision.
// ABOUTME: Uses a temp agent dir so the real ~/.pi/agent is never opened.

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { handlers } from "./project-trust-handlers";

const previous = process.env.PI_CODING_AGENT_DIR;

afterEach(() => {
  if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previous;
});

function agentDir() {
  const dir = mkdtempSync(join(tmpdir(), "spopi-mcp-trust-"));
  process.env.PI_CODING_AGENT_DIR = dir;
  return dir;
}

describe("mcp handlers", () => {
  it("reads null trust when trust.json is missing, then true after the button", async () => {
    agentDir();
    const ctx = { cwd: "D:/work/demo", isProjectTrusted: () => true, isIdle: () => true };
    const before = await handlers.get_mcp_project_trust(ctx, {});
    expect(before.data).toMatchObject({ sessionTrusted: true, savedTrust: null });
    await handlers.trust_project_in_pi(ctx, {});
    const after = await handlers.get_mcp_project_trust(ctx, {});
    expect(after.data).toMatchObject({ savedTrust: true });
  });

  it("returns null saved trust when trust.json is corrupt", async () => {
    const dir = agentDir();
    writeFileSync(join(dir, "trust.json"), "{");
    const result = await handlers.get_mcp_project_trust({ cwd: "D:/work/demo" }, {});
    expect(result.data).toEqual(
      expect.objectContaining({ savedTrust: null, trustError: expect.any(String) }),
    );
  });

  it("reloads only when Pi is idle", async () => {
    const busy = await handlers.mcp_config_changed(
      { isIdle: () => false, reload: async () => {} },
      {},
    );
    expect(busy.data).toEqual({ reloaded: false });
    expect(busy.postResponse).toBeUndefined();
    let ran = false;
    const idle = await handlers.mcp_config_changed(
      {
        isIdle: () => true,
        reload: async () => {
          ran = true;
        },
      },
      {},
    );
    expect(idle.data).toEqual({ reloaded: true });
    await idle.postResponse?.();
    expect(ran).toBe(true);
  });
});
