// ABOUTME: The SPOPI prompt line is added once and stays byte-identical.
// ABOUTME: resources_discover returns the skill directory only when SPOPI set it.

import { describe, expect, it } from "vitest";
import { registerSpopiAwareness, spopiPromptLine } from "./spopi-awareness";

describe("spopi awareness", () => {
  it("adds the prompt line once", () => {
    const handlers = new Map<string, (event: unknown) => unknown>();
    const pi = {
      on: (event: string, handler: (event: unknown) => unknown) => handlers.set(event, handler),
    };
    registerSpopiAwareness(pi as never);
    const options = { promptGuidelines: [] as string[] };
    handlers.get("before_agent_start")?.({ systemPromptOptions: options });
    handlers.get("before_agent_start")?.({ systemPromptOptions: options });
    expect(options.promptGuidelines).toEqual([spopiPromptLine()]);
  });

  it("names the screenshot tool and the live-debugging port only when SPOPI set them", () => {
    const bare = spopiPromptLine({ SPOPI_PUBLIC_DIR: "P", SPOPI_UI_OVERLAY: "O" });
    expect(bare).not.toContain("spopi_screenshot");
    expect(bare).not.toContain("--cdp");

    const hosted = spopiPromptLine({ SPOPI_HOST_ORIGIN: "http://127.0.0.1:57620" });
    expect(hosted).toContain("call spopi_screenshot");
    expect(hosted).not.toContain("--cdp");

    const live = spopiPromptLine({
      SPOPI_HOST_ORIGIN: "http://127.0.0.1:57620",
      SPOPI_CDP_PORT: "9340",
    });
    expect(live).toContain("agent-browser --cdp 9340 snapshot -i");
    expect(live).toContain("do not type into the chat composer");
    expect(spopiPromptLine({ SPOPI_CDP_PORT: "9340; rm -rf" })).not.toContain("--cdp");
    expect(spopiPromptLine({ SPOPI_CDP_PORT: "9340", SPOPI_AGENT_BROWSER: "0" })).not.toContain(
      "--cdp",
    );
  });

  it("names both browsers only when agent-browser and Surf are both on", () => {
    const both = spopiPromptLine({ SPOPI_AGENT_BROWSER: "1", SPOPI_SURF: "1" });
    expect(both).toContain("use agent-browser for local pages");
    expect(both).toContain("surf_* tools");
    expect(spopiPromptLine({ SPOPI_SURF: "1", SPOPI_AGENT_BROWSER: "0" })).not.toContain(
      "Two browsers",
    );
    expect(spopiPromptLine({ SPOPI_AGENT_BROWSER: "1" })).not.toContain("Two browsers");
  });

  it("returns the skill path from resources_discover", () => {
    const previous = process.env.SPOPI_SKILL_DIR;
    process.env.SPOPI_SKILL_DIR = "D:/skills/spopi-customize";
    const handlers = new Map<string, () => unknown>();
    const pi = { on: (event: string, handler: () => unknown) => handlers.set(event, handler) };
    registerSpopiAwareness(pi as never);
    expect(handlers.get("resources_discover")?.()).toEqual({
      skillPaths: ["D:/skills/spopi-customize"],
    });
    if (previous == null) delete process.env.SPOPI_SKILL_DIR;
    else process.env.SPOPI_SKILL_DIR = previous;
  });
});
