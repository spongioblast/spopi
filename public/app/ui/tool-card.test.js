// ABOUTME: Tests ToolCardRenderer status localization.
// ABOUTME: Covers public/app/ui/tool-card.js with the result and part helpers it composes.
import { beforeEach, describe, expect, it, vi } from "vitest";

function makeFetchMock(handlers = {}) {
  const defaults = {
    en: {
      tools: {
        streaming: "streaming",
        complete: "complete",
        error: "error",
        copyOutput: "Copy output",
        openInPreview: "Open in preview",
        imageResult: "Tool image",
        nestedMore: "More calls were not recorded",
      },
    },
    zh: {
      tools: {
        streaming: "执行中",
        complete: "完成",
        error: "错误",
        copyOutput: "复制输出",
        openInPreview: "在预览中打开",
      },
    },
  };
  return vi.fn(async (url) => {
    const u = String(url);
    if (u.includes("/locales/en.json"))
      return { ok: true, status: 200, json: async () => handlers.en ?? defaults.en };
    if (u.includes("/locales/zh.json"))
      return handlers.zh === null
        ? { ok: false, status: 404, json: async () => ({}) }
        : { ok: true, status: 200, json: async () => handlers.zh ?? defaults.zh };
    return { ok: false, status: 404, json: async () => ({}) };
  });
}

async function importFreshI18n() {
  vi.resetModules();
  return import("../i18n/i18n.js");
}

beforeEach(() => {
  document.cookie.split(";").forEach((c) => {
    const name = c.split("=")[0].trim();
    if (name) document.cookie = `${name}=; Max-Age=0; Path=/`;
  });
  vi.unstubAllGlobals();
});

describe("ToolCardRenderer status localization", () => {
  it("createToolCard sets dataset.status to raw status and displays localized text", async () => {
    vi.stubGlobal("fetch", makeFetchMock());
    const { createI18n } = await importFreshI18n();
    await createI18n();
    const { ToolCardRenderer } = await import("./tool-card.js");

    const container = document.createElement("div");
    const renderer = new ToolCardRenderer(container);
    const card = renderer.createToolCard({
      toolCallId: "tc1",
      toolName: "read",
      status: "streaming",
      args: {},
    });

    const statusEl = card.querySelector(".tool-status");
    expect(statusEl.dataset.status).toBe("streaming");
    expect(statusEl.textContent).toBe("streaming");
    expect(statusEl.className).toContain("tool-status");
    expect(statusEl.className).toContain("streaming");
  });

  it("finalizeToolCard updates dataset.status to complete", async () => {
    vi.stubGlobal("fetch", makeFetchMock());
    const { createI18n } = await importFreshI18n();
    await createI18n();
    const { ToolCardRenderer } = await import("./tool-card.js");

    const container = document.createElement("div");
    const renderer = new ToolCardRenderer(container);
    const card = renderer.createToolCard({
      toolCallId: "tc2",
      toolName: "read",
      status: "streaming",
      args: {},
    });

    renderer.finalizeToolCard("tc2", "result text", false);
    const statusEl = card.querySelector(".tool-status");
    expect(statusEl.dataset.status).toBe("complete");
    expect(statusEl.textContent).toBe("complete");
  });

  it("finalizeToolCard updates dataset.status to error", async () => {
    vi.stubGlobal("fetch", makeFetchMock());
    const { createI18n } = await importFreshI18n();
    await createI18n();
    const { ToolCardRenderer } = await import("./tool-card.js");

    const container = document.createElement("div");
    const renderer = new ToolCardRenderer(container);
    const card = renderer.createToolCard({
      toolCallId: "tc3",
      toolName: "read",
      status: "streaming",
      args: {},
    });

    renderer.finalizeToolCard("tc3", "error text", true);
    const statusEl = card.querySelector(".tool-status");
    expect(statusEl.dataset.status).toBe("error");
    expect(statusEl.textContent).toBe("error");
  });
});

describe("ToolCardRenderer locale change", () => {
  it("existing tool-status text is repainted from tools.* on locale change", async () => {
    vi.stubGlobal("fetch", makeFetchMock());
    const { createI18n, setLocale } = await importFreshI18n();
    await createI18n();
    const { ToolCardRenderer } = await import("./tool-card.js");

    const container = document.createElement("div");
    const renderer = new ToolCardRenderer(container);
    renderer.createToolCard({
      toolCallId: "tc4",
      toolName: "read",
      status: "streaming",
      args: {},
    });

    let statusEl = container.querySelector(".tool-status");
    expect(statusEl.textContent).toBe("streaming");

    await setLocale("zh");
    statusEl = container.querySelector(".tool-status");
    expect(statusEl.textContent).toBe("执行中");
    expect(statusEl.dataset.status).toBe("streaming");
  });

  it("copy-output-btn title and aria-label repaint on locale change", async () => {
    vi.stubGlobal("fetch", makeFetchMock());
    const { createI18n, setLocale } = await importFreshI18n();
    await createI18n();
    const { ToolCardRenderer } = await import("./tool-card.js");

    const container = document.createElement("div");
    const renderer = new ToolCardRenderer(container);
    renderer.createToolCard({
      toolCallId: "tc5",
      toolName: "read",
      status: "streaming",
      args: {},
    });

    let copyBtn = container.querySelector(".copy-output-btn");
    expect(copyBtn.title).toBe("Copy output");

    await setLocale("zh");
    copyBtn = container.querySelector(".copy-output-btn");
    expect(copyBtn.title).toBe("复制输出");
    expect(copyBtn.getAttribute("aria-label")).toBe("复制输出");
  });
});

describe("ToolCardRenderer teardown", () => {
  it("destroy() clears cards, stops locale updates, and is idempotent", async () => {
    vi.stubGlobal("fetch", makeFetchMock());
    const { createI18n, setLocale } = await importFreshI18n();
    await createI18n();
    const { ToolCardRenderer } = await import("./tool-card.js");
    const container = document.createElement("div");
    const renderer = new ToolCardRenderer(container);
    renderer.createToolCard({
      toolCallId: "t1",
      toolName: "bash",
      status: "streaming",
      args: {},
    });
    expect(container.querySelector(".tool-card")).toBeTruthy();

    renderer.destroy();
    expect(() => renderer.destroy()).not.toThrow();
    expect(renderer.toolCards.size).toBe(0);
    // A locale change after destroy must not throw or re-render.
    await setLocale("zh");
  });

  it("destroy() makes queued scroll callbacks safe", async () => {
    vi.stubGlobal("fetch", makeFetchMock());
    const { createI18n } = await importFreshI18n();
    await createI18n();
    const { ToolCardRenderer } = await import("./tool-card.js");
    const queuedFrames = [];
    vi.stubGlobal("requestAnimationFrame", (callback) => {
      queuedFrames.push(callback);
      return queuedFrames.length;
    });
    const renderer = new ToolCardRenderer(document.createElement("div"));
    renderer.createToolCard({
      toolCallId: "t2",
      toolName: "bash",
      status: "streaming",
      args: {},
    });

    renderer.destroy();
    expect(() => {
      queuedFrames.forEach((callback) => {
        callback();
      });
    }).not.toThrow();
  });
});

describe("ToolCardRenderer file references", () => {
  it("turns a path argument into a preview button that emits previewfile", async () => {
    vi.stubGlobal("fetch", makeFetchMock());
    const { createI18n } = await importFreshI18n();
    await createI18n();
    const { ToolCardRenderer } = await import("./tool-card.js");

    const container = document.createElement("div");
    const seen = [];
    const { setFileActionDispatch } = await import("../chat/file-actions.js");
    const unbind = setFileActionDispatch((action) => {
      if (action.type === "file.preview") seen.push(action.path);
    });
    const renderer = new ToolCardRenderer(container);
    renderer.createToolCard({
      toolCallId: "write-1",
      toolName: "write",
      status: "complete",
      args: { path: "docs/index.html" },
    });

    const ref = container.querySelector(".tool-file-ref");
    expect(ref).not.toBeNull();
    expect(ref.dataset.path).toBe("docs/index.html");
    expect(ref.getAttribute("aria-label")).toContain("docs/index.html");
    ref.click();
    unbind();
    expect(seen).toEqual(["docs/index.html"]);
    expect(container.querySelector(".tool-card-body")?.classList.contains("expanded")).toBe(false);
  });

  it("links the file where a long result was saved, live and from history", async () => {
    vi.stubGlobal("fetch", makeFetchMock());
    const { createI18n } = await importFreshI18n();
    await createI18n();
    const { ToolCardRenderer } = await import("./tool-card.js");
    const { setFileActionDispatch } = await import("../chat/file-actions.js");
    const seen = [];
    const unbind = setFileActionDispatch((action) => {
      if (action.type === "file.preview") seen.push(action.path);
    });

    const container = document.createElement("div");
    const renderer = new ToolCardRenderer(container);
    const saved = ".pi/tmp/tool-output/bash-20260927-184512-call_0.log";
    renderer.createToolCard({ toolCallId: "long", toolName: "bash", status: "streaming" });
    renderer.finalizeToolCard(
      "long",
      { content: [{ type: "text", text: "full" }], details: { spopiToolOutput: { path: saved } } },
      false,
    );
    renderer.finalizeToolCard("long", { content: [{ type: "text", text: "full" }] }, false);
    expect(container.querySelector(".tool-output-saved")).toBeNull();
    renderer.finalizeToolCard(
      "long",
      { content: [{ type: "text", text: "full" }], details: { spopiToolOutput: { path: saved } } },
      false,
    );
    expect(container.querySelectorAll(".tool-output-saved")).toHaveLength(1);
    expect(container.querySelector(".tool-output")?.textContent).toBe("full");
    container.querySelector(".tool-output-saved .tool-file-ref").click();

    renderer.createHistoryCard({ toolCallId: "old", toolName: "bash", args: {} });
    renderer.addHistoryResult("old", { details: { spopiToolOutput: { path: saved } } }, false);
    expect(container.querySelectorAll(".tool-output-saved")).toHaveLength(2);
    unbind();
    expect(seen).toEqual([saved]);
  });

  it("names an image result instead of printing its base64", async () => {
    vi.stubGlobal("fetch", makeFetchMock());
    const { createI18n } = await importFreshI18n();
    await createI18n();
    const { ToolCardRenderer } = await import("./tool-card.js");
    const renderer = new ToolCardRenderer(document.createElement("div"));
    const text = renderer.formatResult({
      content: [
        { type: "text", text: "The SPOPI window as the user sees it now." },
        { type: "image", mimeType: "image/png", data: "A".repeat(4096) },
      ],
    });
    expect(text).toBe("The SPOPI window as the user sees it now.\n[image image/png, 3 KB]");
  });

  it("keeps non-path previews as plain text", async () => {
    vi.stubGlobal("fetch", makeFetchMock());
    const { createI18n } = await importFreshI18n();
    await createI18n();
    const { ToolCardRenderer } = await import("./tool-card.js");

    const container = document.createElement("div");
    const renderer = new ToolCardRenderer(container);
    renderer.createToolCard({
      toolCallId: "bash-1",
      toolName: "bash",
      status: "complete",
      args: { command: "ls -la" },
    });

    expect(container.querySelector(".tool-file-ref")).toBeNull();
    expect(container.querySelector(".tool-args-preview")?.textContent).toBe("ls -la");
  });

  it("renders a PNG tool result as a lightbox thumbnail and copies text only", async () => {
    vi.stubGlobal("fetch", makeFetchMock());
    const { createI18n } = await importFreshI18n();
    await createI18n();
    const { ToolCardRenderer } = await import("./tool-card.js");
    const png =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const container = document.createElement("div");
    const renderer = new ToolCardRenderer(container);
    renderer.createToolCard({ toolCallId: "img", toolName: "pixel", status: "pending" });
    renderer.finalizeToolCard(
      "img",
      {
        content: [
          { type: "text", text: "pixel" },
          { type: "image", mimeType: "image/png", data: png },
        ],
      },
      false,
    );
    const image = container.querySelector("img.tool-result-image");
    expect(image).not.toBeNull();
    expect(image?.getAttribute("src")).toBe(`data:image/png;base64,${png}`);
    expect(container.querySelector(".tool-output")?.textContent).toBe("pixel");
    expect(container.querySelector(".tool-output")?.textContent).not.toContain("[image");
  });

  it("keeps an SVG tool result as text", async () => {
    vi.stubGlobal("fetch", makeFetchMock());
    const { createI18n } = await importFreshI18n();
    await createI18n();
    const { ToolCardRenderer } = await import("./tool-card.js");
    const container = document.createElement("div");
    const renderer = new ToolCardRenderer(container);
    renderer.createToolCard({ toolCallId: "svg", toolName: "pixel", status: "pending" });
    renderer.finalizeToolCard(
      "svg",
      {
        content: [{ type: "image", mimeType: "image/svg+xml", data: "PHN2Zy8+" }],
      },
      false,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector(".tool-output")?.textContent).toContain("[image image/svg+xml");
  });

  it("does not render an oversized image", async () => {
    vi.stubGlobal("fetch", makeFetchMock());
    const { createI18n } = await importFreshI18n();
    await createI18n();
    const { ToolCardRenderer } = await import("./tool-card.js");
    const container = document.createElement("div");
    const renderer = new ToolCardRenderer(container);
    renderer.createHistoryCard({ toolCallId: "big", toolName: "pixel", args: {} });
    renderer.addHistoryResult(
      "big",
      { content: [{ type: "image", mimeType: "image/png", data: "A".repeat(12_000_001) }] },
      false,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector(".tool-output")?.textContent).toContain("[image image/png");
  });

  it("lists nested calls from a history result and titles MCP tools", async () => {
    vi.stubGlobal("fetch", makeFetchMock());
    const { createI18n } = await importFreshI18n();
    await createI18n();
    const { ToolCardRenderer } = await import("./tool-card.js");
    const container = document.createElement("div");
    const renderer = new ToolCardRenderer(container);
    renderer.createHistoryCard({ toolCallId: "c", toolName: "codemode", args: {} });
    renderer.addHistoryResult(
      "c",
      {
        content: [{ type: "text", text: "done" }],
        nestedCalls: {
          complete: false,
          calls: [
            { id: "c/1", name: "mcp__my_server__echo", status: "ok", arguments: { text: "hi" } },
          ],
        },
      },
      false,
    );
    expect(container.querySelector(".tool-name")?.textContent).toBe("codemode");
    expect(container.querySelector(".tool-nested-name")?.textContent).toBe("my_server / echo");
    expect(container.querySelector(".tool-nested-name")?.getAttribute("title")).toBe(
      "mcp__my_server__echo",
    );
    expect(container.querySelector(".tool-nested-more")?.textContent).toBe(
      "More calls were not recorded",
    );
  });

  it("keeps a live nested call's preview when its end event has no args", async () => {
    vi.stubGlobal("fetch", makeFetchMock());
    const { createI18n } = await importFreshI18n();
    await createI18n();
    const { ToolCardRenderer } = await import("./tool-card.js");
    const container = document.createElement("div");
    const renderer = new ToolCardRenderer(container);
    renderer.createToolCard({ toolCallId: "c", toolName: "codemode", args: {}, status: "pending" });
    renderer.upsertNestedCall("c", {
      id: "c/1",
      name: "read",
      status: "pending",
      args: { path: "a.txt" },
    });
    expect(container.querySelector(".tool-nested-dot")?.classList.contains("is-running")).toBe(
      true,
    );
    renderer.upsertNestedCall("c", { id: "c/1", name: "read", status: "done", isError: false });
    expect(container.querySelectorAll(".tool-nested-call")).toHaveLength(1);
    expect(container.querySelector(".tool-nested-args")?.textContent).toContain("a.txt");
    expect(container.querySelector(".tool-nested-dot")?.classList.contains("is-running")).toBe(
      false,
    );
  });

  it("renders nested calls from a captured codemode session", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const result = readFileSync(
      join(process.cwd(), "tests/fixtures/pi-sessions/codemode-nested.jsonl"),
      "utf8",
    )
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
      .map((entry) => entry.message)
      .find((message) => message?.role === "toolResult");
    vi.stubGlobal("fetch", makeFetchMock());
    const { createI18n } = await importFreshI18n();
    await createI18n();
    const { ToolCardRenderer } = await import("./tool-card.js");
    const container = document.createElement("div");
    const renderer = new ToolCardRenderer(container);
    renderer.createHistoryCard({
      toolCallId: result.toolCallId,
      toolName: result.toolName,
      args: {},
    });
    renderer.addHistoryResult(result.toolCallId, result, result.isError);
    expect(
      [...container.querySelectorAll(".tool-nested-name")].map((node) => node.textContent),
    ).toEqual(["echo / echo", "echo / write_note"]);
    expect(container.querySelector(".tool-nested-more")).toBeNull();
  });
});
