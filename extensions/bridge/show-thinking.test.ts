// ABOUTME: Tests that Show thinking writes Pi's hideThinkingBlock, inverted.
// ABOUTME: The checkbox stays; the shared agent folder is what the Pi terminal reads.

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { handleSpopiConfig } from "../spopi-config";

const roots: string[] = [];
const saved = process.env.PI_CODING_AGENT_DIR;

afterEach(() => {
  if (saved === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = saved;
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots.length = 0;
});

describe("show thinking", () => {
  it("persists hideThinkingBlock as the inverse of the checkbox", async () => {
    const home = mkdtempSync(join(tmpdir(), "spopi-show-thinking-"));
    roots.push(home);
    const agent = join(home, "agent");
    process.env.PI_CODING_AGENT_DIR = agent;
    const hidden = await handleSpopiConfig("set_show_thinking", { enabled: false }, { cwd: home });
    expect(hidden).toMatchObject({ ok: true, data: { enabled: false } });
    const settings = JSON.parse(readFileSync(join(agent, "settings.json"), "utf8"));
    expect(settings.hideThinkingBlock).toBe(true);
    const loaded = await handleSpopiConfig("get_show_thinking", {}, { cwd: home });
    expect(loaded).toMatchObject({ ok: true, data: { enabled: false } });
    await handleSpopiConfig("set_show_thinking", { enabled: true }, { cwd: home });
    const shown = JSON.parse(readFileSync(join(agent, "settings.json"), "utf8"));
    expect(shown.hideThinkingBlock).toBe(false);
  });
});
