// ABOUTME: Tests slash commands.
// ABOUTME: Includes "merges command source, scope, type, and capability state".
import { describe, expect, it } from "vitest";
import { buildCommandCatalog, resolveComposerInput } from "./slash-commands.js";

const catalog = buildCommandCatalog({
  builtIns: [{ name: "settings", description: "Open settings", action: "open_settings" }],
  commands: [
    { name: "review", description: "Review", source: "extension", path: "/global/review.ts" },
    { name: "fix", description: "Fix", source: "prompt", location: "project" },
    { name: "skill:test", description: "Test", source: "skill", location: "global" },
    {
      name: "skill:project-probe",
      description: "Project skill",
      source: "skill",
      sourceInfo: {
        source: "auto",
        scope: "project",
        path: "/tmp/workspace/.pi/skills/project-probe/SKILL.md",
      },
    },
    {
      name: "skill:user-probe",
      description: "User skill",
      source: "skill",
      sourceInfo: {
        source: "auto",
        scope: "user",
        path: "/tmp/home/.pi/agent/skills/user-probe/SKILL.md",
      },
    },
    { name: "todos", description: "Show todos", source: "extension", location: "global" },
    {
      name: "spopi-config",
      description: "SPOPI Settings → Configuration data plane",
      source: "extension",
      location: "global",
    },
    {
      name: "llama",
      description: "Manage llama.cpp router models",
      source: "extension",
      location: "global",
    },
  ],
});

describe("slash commands", () => {
  it("merges command source, scope, type, and capability state", () => {
    expect(catalog.get("settings")).toMatchObject({ type: "builtin", scope: "spopi" });
    expect(catalog.get("review")).toMatchObject({ type: "extension", scope: "global" });
    expect(catalog.get("fix")).toMatchObject({ type: "prompt", scope: "project" });
    expect(catalog.get("skill:project-probe")).toMatchObject({
      type: "skill",
      scope: "project",
      sourceInfo: { source: "auto", scope: "project" },
    });
    expect(catalog.get("skill:user-probe")).toMatchObject({
      type: "skill",
      scope: "user",
      sourceInfo: { source: "auto", scope: "user" },
    });
  });

  it("keeps one mcp command and sends only the arguments to Pi", () => {
    const full = buildCommandCatalog({
      commands: [{ name: "mcp", description: "Pi manager", source: "extension" }],
    });
    expect([...full.keys()].filter((name) => name === "mcp")).toEqual(["mcp"]);
    expect(full.get("mcp")).toMatchObject({ source: "spopi", type: "builtin" });
    expect(resolveComposerInput("/mcp", full)).toMatchObject({ kind: "builtin", action: "mcp" });
    expect(resolveComposerInput("/mcp login x", full)).toEqual({
      kind: "runtime",
      command: { type: "prompt", message: "/mcp login x" },
    });
  });

  it("hides internal native commands from the user-facing catalog", () => {
    expect(catalog.has("spopi-config")).toBe(false);
    expect(catalog.has("llama")).toBe(false);
  });

  it("treats // as a literal slash and unknown slash commands as normal messages", () => {
    expect(resolveComposerInput("//literal", catalog, { working: false })).toEqual({
      kind: "runtime",
      command: { type: "prompt", message: "/literal" },
    });
    expect(resolveComposerInput("/missing/path", catalog, { working: false })).toEqual({
      kind: "runtime",
      command: { type: "prompt", message: "/missing/path" },
    });
    expect(resolveComposerInput("/missing/path", catalog, { working: true })).toEqual({
      kind: "runtime",
      command: { type: "steer", message: "/missing/path" },
    });
  });

  it("routes built-ins locally and native commands through prompt exactly once", () => {
    expect(resolveComposerInput("/settings", catalog, { working: false })).toEqual({
      kind: "builtin",
      action: "open_settings",
      arguments: "",
    });
    expect(resolveComposerInput("/review files", catalog, { working: true })).toEqual({
      kind: "runtime",
      command: { type: "prompt", message: "/review files" },
    });
    expect(resolveComposerInput("/todo", catalog, { working: false })).toEqual({
      kind: "runtime",
      command: { type: "prompt", message: "/todos" },
    });
    expect(resolveComposerInput("hello", catalog, { working: true, altKey: false })).toEqual({
      kind: "runtime",
      command: { type: "steer", message: "hello" },
    });
    expect(resolveComposerInput("later", catalog, { working: true, altKey: true })).toEqual({
      kind: "runtime",
      command: { type: "follow_up", message: "later" },
    });
  });
});
