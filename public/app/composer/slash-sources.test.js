// ABOUTME: Tests slash-command sources and menu order.
// ABOUTME: Pi built-ins come first. /phone is a SPOPI command.
import { describe, expect, it } from "vitest";
import { commandGroup, PI_BUILTINS, SPOPI_COMMANDS, standardBuiltIns } from "./slash-sources.js";

describe("slash sources", () => {
  it("lists Pi built-ins, then SPOPI commands, including /phone", () => {
    const names = standardBuiltIns().map((command) => command.name);
    expect(names.slice(0, PI_BUILTINS.length)).toEqual(PI_BUILTINS.map((command) => command.name));
    expect(names.slice(PI_BUILTINS.length)).toEqual(SPOPI_COMMANDS.map((command) => command.name));
    expect(names).toContain("phone");
    expect(names.filter((name) => name === "mcp")).toEqual(["mcp"]);
  });

  it("groups skills before extensions and keeps other builtins out", () => {
    expect(commandGroup({ name: "model", source: "pi", type: "pi" })).toBe("pi");
    expect(PI_BUILTINS.find((command) => command.name === "tree")?.type).toBe("pi");
    expect(PI_BUILTINS.every((command) => command.descriptionKey?.startsWith("composer."))).toBe(
      true,
    );
    expect(commandGroup({ name: "skill:research", type: "skill" })).toBe("skill");
    expect(commandGroup({ name: "fix-tests", source: "prompt" })).toBe("prompt");
    expect(commandGroup({ name: "todos", source: "extension" })).toBe("extension");
    expect(commandGroup({ name: "review", source: "spopi" })).toBe("spopi");
    expect(commandGroup({ name: "settings", type: "builtin" })).toBe("other");
  });
});
