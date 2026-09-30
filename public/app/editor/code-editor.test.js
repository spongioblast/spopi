// ABOUTME: Tests createCodeEditor.
// ABOUTME: Includes "creates editor with line numbers in preview mode".
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EditorState } from "@codemirror/state";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createI18n, setLocale } from "../i18n/i18n.js";
import { createCodeEditor } from "./code-editor.js";

const locales = {
  en: JSON.parse(readFileSync(join(process.cwd(), "public/locales/en.json"), "utf8")),
  zh: JSON.parse(readFileSync(join(process.cwd(), "public/locales/zh.json"), "utf8")),
};

describe("createCodeEditor", async () => {
  let container;

  beforeEach(async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(async () => {
    if (container?.parentNode) {
      container.parentNode.removeChild(container);
    }
  });

  test("creates editor with line numbers in preview mode", async () => {
    const editor = await createCodeEditor({
      container,
      value: "const x = 1;\n",
      readOnly: true,
    });
    // CodeMirror renders line-number gutters.
    const gutters = container.querySelectorAll(".cm-gutters");
    expect(gutters.length).toBeGreaterThan(0);
    editor.destroy();
  });

  test("creates editor with line numbers in edit mode", async () => {
    const editor = await createCodeEditor({
      container,
      value: "const x = 1;\n",
      readOnly: false,
    });
    const gutters = container.querySelectorAll(".cm-gutters");
    expect(gutters.length).toBeGreaterThan(0);
    editor.destroy();
  });

  test("getValue returns the initial content", async () => {
    const editor = await createCodeEditor({
      container,
      value: "hello world\n",
    });
    expect(editor.getValue()).toBe("hello world\n");
    editor.destroy();
  });

  test("setValue updates the document", async () => {
    const editor = await createCodeEditor({
      container,
      value: "old content\n",
    });
    editor.setValue("new content\n");
    expect(editor.getValue()).toBe("new content\n");
    editor.destroy();
  });

  test("onChange fires when content changes", async () => {
    let lastValue = null;
    const editor = await createCodeEditor({
      container,
      value: "initial\n",
      onChange: (val) => {
        lastValue = val;
      },
    });
    editor.setValue("changed\n");
    expect(lastValue).toBe("changed\n");
    editor.destroy();
  });

  test("goToLine returns false for invalid line", async () => {
    const editor = await createCodeEditor({
      container,
      value: "line1\nline2\nline3\n",
    });
    expect(editor.goToLine(0)).toBe(false);
    expect(editor.goToLine(-1)).toBe(false);
    expect(editor.goToLine(5)).toBe(false);
    expect(editor.goToLine(1.5)).toBe(false);
    editor.destroy();
  });

  test("goToLine returns true for valid line", async () => {
    const editor = await createCodeEditor({
      container,
      value: "line1\nline2\nline3\n",
    });
    expect(editor.goToLine(2)).toBe(true);
    editor.destroy();
  });

  test("destroy removes editor DOM", async () => {
    const editor = await createCodeEditor({
      container,
      value: "test\n",
    });
    expect(container.querySelectorAll(".cm-editor").length).toBe(1);
    editor.destroy();
    // After destroy, the editor DOM should be cleaned up.
    expect(container.querySelectorAll(".cm-editor").length).toBe(0);
  });

  test("calls onViewReady and onViewDestroy lifecycle callbacks", async () => {
    let readyCalled = false;
    let destroyCalled = false;
    const editor = await createCodeEditor({
      container,
      value: "test\n",
      onViewReady: async () => {
        readyCalled = true;
      },
      onViewDestroy: async () => {
        destroyCalled = true;
      },
    });
    expect(readyCalled).toBe(true);
    editor.destroy();
    expect(destroyCalled).toBe(true);
  });

  test("setReadOnly reconfigures both editable and read-only facets", async () => {
    const editor = await createCodeEditor({
      container,
      value: "test\n",
      readOnly: true,
    });
    expect(editor.view.state.facet(EditorState.readOnly)).toBe(true);
    editor.setReadOnly(false);
    expect(editor.view.state.facet(EditorState.readOnly)).toBe(false);
    editor.setReadOnly(true);
    expect(editor.view.state.facet(EditorState.readOnly)).toBe(true);
    editor.destroy();
  });

  test("setWrapLines toggles line wrapping", async () => {
    const editor = await createCodeEditor({
      container,
      value: "test\n",
      wrapLines: false,
    });
    // Should not throw
    editor.setWrapLines(true);
    editor.setWrapLines(false);
    editor.destroy();
  });

  test("openSearch does not throw", async () => {
    const editor = await createCodeEditor({
      container,
      value: "test\n",
    });
    expect(() => editor.openSearch()).not.toThrow();
    editor.destroy();
  });

  test("localizes the CodeMirror search panel in Chinese", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        const locale = String(url).match(/\/locales\/(en|zh)\.json/)?.[1];
        return { ok: Boolean(locale), json: async () => locales[locale] };
      }),
    );
    await createI18n();
    await setLocale("zh");

    const editor = await createCodeEditor({ container, value: "test\n", readOnly: false });
    editor.openSearch();

    expect(container.querySelector('input[name="search"]').placeholder).toBe("查找");
    expect(container.querySelector('input[name="replace"]').placeholder).toBe("替换");
    expect(container.querySelector('button[name="next"]').textContent).toBe("下一个");

    editor.destroy();
    await setLocale("en");
    vi.unstubAllGlobals();
  });
});

describe("syntax highlighting wiring", async () => {
  const read = (rel) => readFileSync(join(process.cwd(), rel), "utf8");

  test("code editor applies One Dark syntax highlighting", async () => {
    const src = read("public/app/editor/code-editor.js");
    expect(src).toContain("oneDarkHighlightStyle");
    expect(src).toContain("syntaxHighlighting");

    // vendor entry must re-export it so the browser bundle includes it
    expect(read("public/codemirror-vendor-entry.js")).toContain("oneDarkHighlightStyle");
    // import map must route the package to the same-origin vendor bundle
    expect(read("public/index.html")).toContain('"@codemirror/theme-one-dark"');
  });
});
