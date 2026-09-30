// ABOUTME: Tests createFileRenderer — renderer selection.
// ABOUTME: Includes "Markdown → markdown renderer with preview mode".
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createI18n } from "../i18n/i18n.js";
import { createFileRenderer } from "./file-preview-renderers.js";

beforeEach(async () => {
  document.cookie.split(";").forEach((c) => {
    const name = c.split("=")[0].trim();
    if (name) document.cookie = `${name}=; Max-Age=0; Path=/`;
  });
  global.fetch = (_url) =>
    Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve({
          app: { welcome: "Welcome" },
          messages: { copy: "Copy", copied: "Copied!" },
          files: {
            loading: "Loading…",
            preview: { htmlLive: "Live HTML preview" },
          },
        }),
    });
  await createI18n();
});

let container;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  if (container?.parentNode) {
    container.parentNode.removeChild(container);
  }
});

describe("createFileRenderer — renderer selection", async () => {
  test("Markdown → markdown renderer with preview mode", async () => {
    const renderer = createFileRenderer({
      filePath: "README.md",
      content: "# Title",
      mode: "preview",
    });
    await renderer.mount(container);
    expect(renderer.contentType).toBe("markdown");
    expect(container.querySelector(".file-markdown-preview")).not.toBeNull();
    renderer.destroy();
  });

  test("HTML → sandboxed iframe preview", async () => {
    const renderer = createFileRenderer({
      filePath: "index.html",
      content: "<h1>Hi</h1>",
      mode: "preview",
    });
    await renderer.mount(container);
    expect(renderer.contentType).toBe("html");
    const iframe = container.querySelector("iframe");
    expect(iframe).not.toBeNull();
    expect(iframe.getAttribute("sandbox")).toContain("allow-scripts");
    expect(iframe.getAttribute("sandbox")).not.toContain("allow-same-origin");
    renderer.destroy();
  });

  test("Markdown edit mode → CodeMirror", async () => {
    const renderer = createFileRenderer({
      filePath: "README.md",
      content: "# Title",
      mode: "edit",
    });
    await renderer.mount(container);
    expect(container.querySelector(".cm-editor")).not.toBeNull();
    renderer.destroy();
  });

  test("JS text → CodeMirror renderer", async () => {
    const renderer = createFileRenderer({
      filePath: "main.js",
      content: "const x = 1;\n",
      readOnly: true,
    });
    await renderer.mount(container);
    expect(container.querySelector(".cm-editor")).not.toBeNull();
    expect(renderer.contentType).toBe("text");
    renderer.destroy();
  });

  test("Image → image renderer", async () => {
    const renderer = createFileRenderer({
      filePath: "photo.png",
      fileName: "photo.png",
    });
    await renderer.mount(container);
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img.src).toContain("/api/files/raw?path=");
    renderer.destroy();
  });

  test("Text renderer getValue returns content", async () => {
    const renderer = createFileRenderer({
      filePath: "main.js",
      content: "const x = 1;\n",
    });
    await renderer.mount(container);
    expect(renderer.getValue()).toBe("const x = 1;\n");
    renderer.destroy();
  });

  test("Text renderer update toggles readOnly", async () => {
    const renderer = createFileRenderer({
      filePath: "main.js",
      content: "test\n",
      readOnly: true,
    });
    await renderer.mount(container);
    renderer.update({ readOnly: false });
    // Should not throw.
    renderer.destroy();
  });

  test("Text renderer update toggles wrapLines", async () => {
    const renderer = createFileRenderer({
      filePath: "main.js",
      content: "test\n",
      wrapLines: false,
    });
    await renderer.mount(container);
    renderer.update({ wrapLines: true });
    renderer.destroy();
  });

  test("R script → text renderer (plain text fallback)", async () => {
    const renderer = createFileRenderer({
      filePath: "analysis.R",
      content: "x <- 1\n",
    });
    await renderer.mount(container);
    expect(renderer.contentType).toBe("text");
    expect(container.querySelector(".cm-editor")).not.toBeNull();
    renderer.destroy();
  });

  test("Unknown text → text renderer", async () => {
    const renderer = createFileRenderer({
      filePath: "data.xyz",
      content: "some content\n",
    });
    await renderer.mount(container);
    expect(renderer.contentType).toBe("text");
    renderer.destroy();
  });

  test("destroy cleans up DOM", async () => {
    const renderer = createFileRenderer({
      filePath: "main.js",
      content: "test\n",
    });
    await renderer.mount(container);
    expect(container.querySelector(".cm-editor")).not.toBeNull();
    renderer.destroy();
    expect(container.querySelector(".cm-editor")).toBeNull();
  });
});
