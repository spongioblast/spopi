// ABOUTME: Tests the composer handlers for Pi's terminal-only slash commands.
// ABOUTME: Arguments reach the RPC call, and a refusal comes back as an error.

import { describe, expect, it, vi } from "vitest";
import { createPiBuiltinCommands } from "./pi-builtin-commands.js";

function makeCommands(overrides = {}) {
  const deps = {
    compact: vi.fn(async () => ""),
    openModelPicker: vi.fn(),
    cycleThinking: vi.fn(),
    setThinkingLevel: vi.fn(async () => {}),
    exportSession: vi.fn(async () => {}),
    ...overrides,
  };
  return { deps, commands: createPiBuiltinCommands(deps) };
}

describe("Pi built-in slash commands", () => {
  it("compacts with the typed instructions and reports Pi's refusal", async () => {
    const { deps, commands } = makeCommands();
    await commands.pi_compact("  keep the API notes ");
    expect(deps.compact).toHaveBeenCalledWith("keep the API notes");

    const refused = makeCommands({ compact: vi.fn(async () => "Nothing to compact") });
    await expect(refused.commands.pi_compact("")).rejects.toThrow("Nothing to compact");
  });

  it("sets a named thinking level, cycles without one, and rejects an unknown one", async () => {
    const { deps, commands } = makeCommands();
    await commands.pi_thinking("High");
    expect(deps.setThinkingLevel).toHaveBeenCalledWith("high");
    await commands.pi_thinking("");
    expect(deps.cycleThinking).toHaveBeenCalledOnce();
    await expect(commands.pi_thinking("turbo")).rejects.toThrow("Unknown thinking level: turbo");
    expect(deps.setThinkingLevel).toHaveBeenCalledOnce();
  });

  it("opens the model picker and exports the session", async () => {
    const { deps, commands } = makeCommands();
    await commands.pi_model("");
    await commands.pi_export("");
    expect(deps.openModelPicker).toHaveBeenCalledOnce();
    expect(deps.exportSession).toHaveBeenCalledOnce();
  });
});
