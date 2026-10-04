// ABOUTME: Tests composer slash menu.
// ABOUTME: Includes "recognizes slash queries at the start of the composer".
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openSettingsTab } from "../settings/settings-panel.js";
import {
  activeSlashQuery,
  mountComposerSlashMenu,
  originLabel,
  titleCaseCommandName,
} from "./composer-slash-menu.js";
import { mountComposerSubmitHandling } from "./composer-submit.js";
import { buildCommandCatalog } from "./slash-commands.js";
import { standardBuiltIns } from "./slash-sources.js";

vi.mock("../settings/settings-panel.js", () => ({ openSettingsTab: vi.fn() }));

describe("composer slash menu", () => {
  let dom;
  let input;
  let menu;

  beforeEach(() => {
    dom = new JSDOM(`
      <form id="composer-form">
        <textarea id="message-input"></textarea>
      </form>
      <button id="command-btn" type="button"></button>
      <div id="skill-slash-menu" class="hidden"></div>
    `);
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    globalThis.Event = dom.window.Event;
    globalThis.KeyboardEvent = dom.window.KeyboardEvent;
    globalThis.queueMicrotask = (callback) => callback();
    dom.window.HTMLElement.prototype.scrollIntoView = vi.fn();
    input = document.getElementById("message-input");
    menu = document.getElementById("skill-slash-menu");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    dom.window.close();
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.Event;
    delete globalThis.KeyboardEvent;
    delete globalThis.queueMicrotask;
  });

  it("recognizes slash queries at the start of the composer", () => {
    input.value = "/skill:res";
    input.setSelectionRange(input.value.length, input.value.length);
    expect(activeSlashQuery(input)).toEqual({ query: "skill:res", end: 10 });

    input.value = "please /skill:res";
    input.setSelectionRange(input.value.length, input.value.length);
    expect(activeSlashQuery(input)).toBeNull();
  });

  it("lists skills before extension commands", async () => {
    const formSubmit = vi.fn();
    input.form?.addEventListener("submit", formSubmit);
    const controller = mountComposerSlashMenu({
      input,
      container: menu,
      getCommands: () => [
        { name: "settings", description: "Open settings", type: "builtin", scope: "spopi" },
        { name: "review", description: "Review files", type: "extension", scope: "user" },
        {
          name: "skill:research",
          description: "Investigate primary sources",
          type: "skill",
          scope: "user",
        },
      ],
    });

    input.value = "/";
    input.setSelectionRange(input.value.length, input.value.length);
    await controller.update();

    // The menu groups both kinds (headings may be i18n-translated).
    const options = menu.querySelectorAll(".skill-slash-option");
    expect(options).toHaveLength(2);
    expect(options[0].textContent).toContain("Research");
    expect(options[1].textContent).toContain("Review");
    expect(menu.querySelectorAll(".skill-slash-heading")).toHaveLength(2);
    expect(menu.textContent).not.toContain("Settings");

    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", cancelable: true }));

    expect(input.value).toBe("/skill:research ");
    expect(menu.classList.contains("hidden")).toBe(true);
    expect(formSubmit).not.toHaveBeenCalled();
  });

  it("inserts an extension command when it is selected", async () => {
    const controller = mountComposerSlashMenu({
      input,
      container: menu,
      getCommands: () => [
        { name: "skill:research", description: "Investigate", type: "skill", scope: "user" },
        { name: "spopi-help", description: "Show help", source: "extension", scope: "user" },
      ],
    });

    input.value = "/help";
    input.setSelectionRange(input.value.length, input.value.length);
    await controller.update();

    expect(menu.querySelectorAll(".skill-slash-option")).toHaveLength(1);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", cancelable: true }));

    expect(input.value).toBe("/spopi-help ");
  });

  it("lists prompt-template commands alongside skills and extensions", async () => {
    const controller = mountComposerSlashMenu({
      input,
      container: menu,
      getCommands: () => [
        { name: "fix-tests", description: "Fix failing tests", source: "prompt", scope: "project" },
      ],
    });

    input.value = "/fix";
    input.setSelectionRange(input.value.length, input.value.length);
    await controller.update();

    const options = menu.querySelectorAll(".skill-slash-option");
    expect(options).toHaveLength(1);
    expect(options[0].textContent).toContain("Fix Tests");
  });

  it("shows Personal vs Project from pi skill sourceInfo", async () => {
    const catalog = buildCommandCatalog({
      commands: [
        {
          name: "skill:research",
          description: "Investigate primary sources",
          source: "skill",
          sourceInfo: {
            source: "auto",
            scope: "user",
            path: "/Users/me/.pi/agent/skills/research/SKILL.md",
          },
        },
        {
          name: "skill:upgrade-embedded-pi",
          description: "Upgrade bundled Pi",
          source: "skill",
          sourceInfo: {
            source: "auto",
            scope: "project",
            path: "/Users/me/code/spopi/.pi/skills/upgrade-embedded-pi/SKILL.md",
          },
        },
      ],
    });
    const controller = mountComposerSlashMenu({
      input,
      container: menu,
      getCommands: () => catalog.values(),
    });

    input.value = "/";
    input.setSelectionRange(input.value.length, input.value.length);
    await controller.update();

    const byName = Object.fromEntries(
      [...menu.querySelectorAll(".skill-slash-option")].map((option) => [
        option.querySelector(".skill-slash-name").textContent,
        {
          origin: option.querySelector(".skill-slash-scope").textContent,
          title: option.querySelector(".skill-slash-scope").title,
        },
      ]),
    );
    expect(byName.Research).toEqual({
      origin: "composer.slashMenu.originPersonal",
      title: "/Users/me/.pi/agent/skills/research/SKILL.md",
    });
    expect(byName["Upgrade Embedded Pi"]).toEqual({
      origin: "composer.slashMenu.originProject",
      title: "/Users/me/code/spopi/.pi/skills/upgrade-embedded-pi/SKILL.md",
    });
  });

  it("labels each command with the package it comes from", () => {
    expect(originLabel({ source: "extension", sourceInfo: { source: "npm:pi-web-access" } })).toBe(
      "pi-web-access",
    );
    expect(
      originLabel({ source: "extension", sourceInfo: { source: "inline", scope: "temporary" } }),
    ).toBe("composer.slashMenu.originInline");
    expect(originLabel({ source: "skill", sourceInfo: { source: "auto", scope: "project" } })).toBe(
      "composer.slashMenu.originProject",
    );
    expect(originLabel({ source: "skill", sourceInfo: { source: "auto", scope: "user" } })).toBe(
      "composer.slashMenu.originPersonal",
    );
    expect(originLabel({ type: "builtin", scope: "spopi" })).toBe("composer.slashMenu.spopi");
    expect(originLabel({ name: "model", source: "pi", type: "pi" })).toBe("composer.slashMenu.pi");
  });

  it("renders the providing package in the slash menu", async () => {
    const controller = mountComposerSlashMenu({
      input,
      container: menu,
      getCommands: () => [
        {
          name: "todos",
          description: "Show all todos",
          source: "extension",
          sourceInfo: {
            source: "npm:@juicesharp/rpiv-todo",
            scope: "user",
            path: "/Users/me/.pi/agent/npm/node_modules/@juicesharp/rpiv-todo/index.ts",
          },
        },
      ],
    });

    input.value = "/todos";
    input.setSelectionRange(input.value.length, input.value.length);
    await controller.update();

    const scope = menu.querySelector(".skill-slash-scope");
    expect(scope.textContent).toBe("@juicesharp/rpiv-todo");
    expect(scope.title).toContain("node_modules/@juicesharp/rpiv-todo");
  });

  it("matches commands by the package they come from", async () => {
    const controller = mountComposerSlashMenu({
      input,
      container: menu,
      getCommands: () => [
        {
          name: "websearch",
          description: "Open web search curator",
          source: "extension",
          sourceInfo: { source: "npm:pi-web-access", scope: "user" },
        },
        { name: "skill:research", description: "Investigate", type: "skill", scope: "user" },
      ],
    });

    input.value = "/web-access";
    input.setSelectionRange(input.value.length, input.value.length);
    await controller.update();

    const options = menu.querySelectorAll(".skill-slash-option");
    expect(options).toHaveLength(1);
    expect(options[0].textContent).toContain("Websearch");
  });

  it("selects a slash command instead of submitting when submit handling was registered first", async () => {
    const onSubmit = vi.fn();
    mountComposerSubmitHandling({ input, form: input.form, onSubmit });
    const controller = mountComposerSlashMenu({
      input,
      container: menu,
      getCommands: () => [{ name: "skill:btw", description: "Append message", type: "skill" }],
    });

    input.value = "/bt";
    input.setSelectionRange(input.value.length, input.value.length);
    await controller.update();
    const event = new KeyboardEvent("keydown", { key: "Enter", cancelable: true });
    input.dispatchEvent(event);

    expect(input.value).toBe("/skill:btw ");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("filters skills while typing a slash query", async () => {
    const controller = mountComposerSlashMenu({
      input,
      container: menu,
      getCommands: () => [
        { name: "skill:code-review", description: "Review a diff", type: "skill", scope: "user" },
        {
          name: "skill:research",
          description: "Investigate primary sources",
          type: "skill",
          scope: "project",
        },
      ],
    });

    input.value = "/res";
    input.setSelectionRange(input.value.length, input.value.length);
    await controller.update();

    expect(menu.classList.contains("hidden")).toBe(false);
    expect(menu.querySelectorAll(".skill-slash-option")).toHaveLength(1);
    expect(menu.textContent).toContain("Research");
    expect(menu.textContent).toContain("Project");
  });

  it("ranks a prefix match above a fuzzy match from an earlier group", async () => {
    const controller = mountComposerSlashMenu({
      input,
      container: menu,
      getCommands: () => [
        {
          name: "skill:plan",
          description: "Break a todo into steps",
          type: "skill",
          scope: "user",
        },
        { name: "todos", description: "Show all todos", source: "extension", scope: "user" },
      ],
    });

    input.value = "/tod";
    input.setSelectionRange(input.value.length, input.value.length);
    await controller.update();

    const options = menu.querySelectorAll(".skill-slash-option");
    expect(options).toHaveLength(2);
    expect(options[0].textContent).toContain("Todos");
    expect(options[1].textContent).toContain("Plan");
  });

  it("badges a command SPOPI has learned is terminal-only", async () => {
    const controller = mountComposerSlashMenu({
      input,
      container: menu,
      getCommands: () => [
        {
          name: "mcp",
          description: "Manage MCP servers",
          source: "extension",
          scope: "user",
          compatibility: { status: "terminal-only", message: "/mcp needs the terminal." },
        },
      ],
    });

    input.value = "/mcp";
    input.setSelectionRange(input.value.length, input.value.length);
    await controller.update();

    // i18n is not initialized under vitest, so `t()` echoes the key back.
    const badge = menu.querySelector(".skill-slash-badge");
    expect(badge.textContent).toBe("composer.slashMenu.terminalOnly");
    expect(badge.title).toBe("/mcp needs the terminal.");
  });

  it("leaves the badge empty for a GUI-compatible command", async () => {
    const controller = mountComposerSlashMenu({
      input,
      container: menu,
      getCommands: () => [
        { name: "websearch", description: "Search the web", source: "extension", scope: "user" },
      ],
    });

    input.value = "/web";
    input.setSelectionRange(input.value.length, input.value.length);
    await controller.update();

    expect(menu.querySelector(".skill-slash-badge").textContent).toBe("");
  });

  it("formats command names for display", () => {
    expect(titleCaseCommandName("skill:code-review")).toBe("Code Review");
  });

  it("opens the Pi catalog from the commands button", async () => {
    const button = document.getElementById("command-btn");
    const controller = mountComposerSlashMenu({
      input,
      container: menu,
      commandButton: button,
      getCommands: () => [
        { name: "review", description: "Review files", source: "extension", scope: "user" },
      ],
    });

    button.click();
    await controller.update();

    expect(input.value).toBe("/");
    expect(menu.classList.contains("hidden")).toBe(false);
    expect(menu.textContent).toContain("Review");
  });

  it("leaves a draft alone when the commands button is clicked", async () => {
    const button = document.getElementById("command-btn");
    mountComposerSlashMenu({
      input,
      container: menu,
      commandButton: button,
      getCommands: () => [
        { name: "review", description: "Review files", source: "extension", scope: "user" },
      ],
    });
    input.value = "keep this";
    button.click();
    await Promise.resolve();

    expect(input.value).toBe("keep this");
    expect(menu.classList.contains("hidden")).toBe(true);
  });

  it("offers Settings when Pi has no commands", async () => {
    const controller = mountComposerSlashMenu({
      input,
      container: menu,
      getCommands: () => [],
    });
    input.value = "/";
    input.setSelectionRange(1, 1);
    await controller.update();

    expect(menu.querySelector(".skill-slash-heading")).toBeNull();
    const link = menu.querySelector(".skill-slash-empty-link");
    expect(link.textContent).toBe("composer.slashMenu.installExtensions");
    link.click();
    expect(openSettingsTab).toHaveBeenCalledWith("extensions");
    expect(menu.classList.contains("hidden")).toBe(true);
  });

  it("orders Pi, skills, extensions, and SPOPI, and shows a shortcut", async () => {
    const commands = standardBuiltIns().map((command) =>
      command.name === "tree" ? { ...command, shortcut: "Esc Esc" } : command,
    );
    commands.push(
      { name: "skill:research", description: "Investigate", type: "skill" },
      { name: "todos", description: "Show todos", source: "extension" },
    );
    const controller = mountComposerSlashMenu({
      input,
      container: menu,
      getCommands: () => commands,
    });
    input.value = "/";
    input.setSelectionRange(1, 1);
    await controller.update();

    const names = [...menu.querySelectorAll(".skill-slash-name")].map((node) => node.textContent);
    expect(names.indexOf("Model")).toBeLessThan(names.indexOf("Research"));
    expect(names.indexOf("Research")).toBeLessThan(names.indexOf("Todos"));
    expect(names.indexOf("Todos")).toBeLessThan(names.indexOf("Review"));
    expect(names).toContain("Phone");
    expect(menu.textContent).toContain("Esc Esc");
  });
});
