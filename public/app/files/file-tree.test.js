// ABOUTME: Tests FileTree.
// ABOUTME: Includes "renders root files and directories without size text".
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeGateway } from "../test-utils/fake-gateway.js";
import { FileTree } from "./file-tree.js";
import {
  applyGitOverlay,
  createFileTreeState,
  filesFromGitSnapshot,
  visibleRows,
} from "./file-tree-model.js";

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function settleUntil(predicate) {
  for (let index = 0; index < 20 && !predicate(); index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function mountTree(gateway, options = {}) {
  const container = document.createElement("div");
  document.body.append(container);
  const tree = new FileTree(container, {
    gateway,
    workspaceId: "workspace-a",
    loadGitStatus: async () => [],
    workspaceInfo: async () => ({ path: "/tmp/workspace-a" }),
    t: (key) => key,
    ...options,
  });
  return { container, tree };
}

describe("FileTree", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders root files and directories without size text", async () => {
    const gateway = createFakeGateway(async () => ({
      entries: [
        { name: "src", relativePath: "src", kind: "directory" },
        { name: "readme.md", relativePath: "readme.md", kind: "file", size: 4096 },
      ],
    }));
    const { container, tree } = mountTree(gateway);
    await tree.load();
    expect(container.querySelectorAll(".file-tree-row")).toHaveLength(2);
    expect(container.querySelector('[data-path="readme.md"]')?.getAttribute("aria-label")).toBe(
      "readme.md",
    );
    const mentioned = mountTree(gateway, { onMention() {} });
    await mentioned.tree.load();
    const mention = mentioned.container.querySelector(".file-tree-mention");
    expect(mention?.getAttribute("aria-label")).toBe("files.mentionInChat");
    expect(mention?.querySelector("[aria-hidden='true']")?.textContent).toBe("@");
    expect(container.textContent).toContain("src");
    expect(container.textContent).toContain("readme.md");
    expect(container.textContent).not.toContain("4096");
    expect(container.textContent).not.toContain("KB");
  });

  it("expands a directory then collapses it while keeping the cache", async () => {
    const calls = [];
    const gateway = createFakeGateway(async (_id, path) => {
      calls.push(path);
      if (path === "")
        return { entries: [{ name: "src", relativePath: "src", kind: "directory" }] };
      return { entries: [{ name: "app.js", relativePath: "src/app.js", kind: "file" }] };
    });
    const { container, tree } = mountTree(gateway);
    await tree.load();
    container.querySelector('[data-path="src"]').click();
    await settleUntil(() => container.querySelector('[data-path="src/app.js"]'));
    expect(container.querySelector('[data-path="src/app.js"]')?.dataset.depth).toBe("1");
    expect(calls).toContain("src");
    container.querySelector('[data-path="src"]').click();
    await settleUntil(() => !container.querySelector('[data-path="src/app.js"]'));
    expect(container.querySelector('[data-path="src/app.js"]')).toBeNull();
    container.querySelector('[data-path="src"]').click();
    await settleUntil(() => container.querySelector('[data-path="src/app.js"]'));
    expect(calls.filter((path) => path === "src")).toHaveLength(1);
  });

  it("ignores a stale expand after refresh", async () => {
    const slow = deferred();
    let pendingSlow = true;
    const gateway = createFakeGateway(async (_id, path) => {
      if (path === "slow") {
        if (pendingSlow) {
          pendingSlow = false;
          return slow.promise;
        }
        return { entries: [] };
      }
      if (path === "")
        return { entries: [{ name: "slow", relativePath: "slow", kind: "directory" }] };
      return { entries: [] };
    });
    const { container, tree } = mountTree(gateway);
    await tree.load();
    container.querySelector('[data-path="slow"]').click();
    const refresh = tree.refresh();
    slow.resolve({ entries: [{ name: "late.js", relativePath: "slow/late.js", kind: "file" }] });
    await refresh;
    expect(container.textContent).not.toContain("late.js");
  });

  it("refresh keeps expanded paths and scrollTop", async () => {
    const gateway = createFakeGateway(async (_id, path) => {
      if (path === "")
        return { entries: [{ name: "src", relativePath: "src", kind: "directory" }] };
      return { entries: [{ name: "app.js", relativePath: "src/app.js", kind: "file" }] };
    });
    const { container, tree } = mountTree(gateway);
    await tree.load();
    container.querySelector('[data-path="src"]').click();
    await settleUntil(() => container.querySelector('[data-path="src/app.js"]'));
    container.scrollTop = 12;
    await tree.refresh();
    expect(container.querySelector('[data-path="src/app.js"]')).toBeTruthy();
    expect(container.scrollTop).toBe(12);
  });

  it("ArrowDown then ArrowRight expands a folder", async () => {
    const gateway = createFakeGateway(async (_id, path) => {
      if (path === "") {
        return {
          entries: [
            { name: "lib", relativePath: "lib", kind: "directory" },
            { name: "src", relativePath: "src", kind: "directory" },
          ],
        };
      }
      return { entries: [{ name: "app.js", relativePath: "src/app.js", kind: "file" }] };
    });
    const { container, tree } = mountTree(gateway);
    await tree.load();
    container.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    container.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    await settleUntil(() => container.querySelector('[data-path="src/app.js"]'));
    expect(container.querySelector('[data-path="src"]')?.getAttribute("aria-expanded")).toBe(
      "true",
    );
  });

  it("setShowHidden re-lists with showHidden true", async () => {
    const flags = [];
    const gateway = createFakeGateway(async (_id, _path, showHidden) => {
      flags.push(showHidden);
      return { entries: [] };
    });
    const { tree } = mountTree(gateway);
    await tree.load();
    await tree.setShowHidden(true);
    expect(flags.at(-1)).toBe(true);
  });

  it("right-click file shows Reveal in Explorer and calls onReveal", async () => {
    const onReveal = vi.fn();
    const gateway = createFakeGateway(async () => ({
      entries: [{ name: "a.ts", relativePath: "a.ts", kind: "file" }],
    }));
    const { container, tree } = mountTree(gateway, { onReveal });
    await tree.load();
    container
      .querySelector('[data-path="a.ts"]')
      .dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 20, clientY: 20 }));
    const item = [...document.querySelectorAll(".context-menu-item")].find((node) =>
      /Reveal in Explorer|files\.revealInExplorer/i.test(node.textContent),
    );
    expect(item).toBeTruthy();
    item.click();
    expect(onReveal).toHaveBeenCalledWith("a.ts");
  });

  it("offers Run in terminal for runnable files", async () => {
    const onRun = vi.fn();
    const gateway = createFakeGateway(async () => ({
      entries: [{ name: "demo.py", relativePath: "demo.py", kind: "file" }],
    }));
    const { container, tree } = mountTree(gateway, { onRun });
    await tree.load();
    container
      .querySelector('[data-path="demo.py"]')
      .dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 20, clientY: 20 }));
    const item = [...document.querySelectorAll(".context-menu-item")].find((node) =>
      /Run in terminal|files\.runInTerminal/i.test(node.textContent),
    );
    expect(item).toBeTruthy();
    item.click();
    expect(onRun).toHaveBeenCalledWith("demo.py");
  });

  it("adds a git badge after a successful status overlay", async () => {
    const gateway = createFakeGateway(async () => ({
      entries: [{ name: "a.ts", relativePath: "a.ts", kind: "file" }],
    }));
    const { container, tree } = mountTree(gateway, {
      loadGitStatus: async () => [{ path: "a.ts", code: "M", status: "modified" }],
    });
    await tree.load();
    const badge = container.querySelector('.file-git-badge[data-git-status="M"]');
    expect(badge).toBeTruthy();
    expect(badge?.closest(".file-tree-row")?.getAttribute("data-git")).toBe("modified");
    expect(badge?.getAttribute("title")).toBe("files.git.modified");
  });

  it("marks a folder with changes inside with a dot, even while collapsed", async () => {
    const gateway = createFakeGateway(async () => ({
      entries: [{ name: "src", relativePath: "src", kind: "directory" }],
    }));
    const { container, tree } = mountTree(gateway, {
      loadGitStatus: async () => [{ path: "src/deep/a.ts", code: "M", status: "modified" }],
    });
    await tree.load();
    const row = container.querySelector('[data-path="src"]');
    expect(row?.getAttribute("data-git")).toBe("modified");
    expect(row?.querySelector(".file-git-dot")?.getAttribute("title")).toBe("files.git.inside");
  });

  it("shows empty copy and Retry after a rejected list", async () => {
    let fail = true;
    const gateway = createFakeGateway(async () => {
      if (fail) throw new Error("boom");
      return { entries: [] };
    });
    const { container, tree } = mountTree(gateway);
    await tree.load();
    expect(container.querySelector(".file-tree-error")).toBeTruthy();
    fail = false;
    container.querySelector(".file-tree-error button").click();
    await settleUntil(() => container.querySelector(".file-tree-empty"));
    expect(container.textContent).toContain("files.empty");
  });
});

describe("filesFromGitSnapshot", () => {
  it("maps porcelain v2 entries onto badge codes", () => {
    expect(
      filesFromGitSnapshot({
        snapshot: {
          entries: [
            { displayPath: "a.ts", xy: " M", entryKind: "ordinary" },
            { displayPath: "b.ts", entryKind: "untracked" },
            { displayPath: "c.ts", entryKind: "ignored" },
          ],
        },
      }),
    ).toEqual([
      { path: "a.ts", code: "M", status: "modified" },
      { path: "b.ts", code: "U", status: "untracked" },
    ]);
  });
});

describe("applyGitOverlay", () => {
  /** @param {{ path: string, code: string, status: string }[]} files */
  function rowsFor(files) {
    const state = createFileTreeState();
    state.childrenByPath.set("", [
      { name: "lib", relativePath: "lib", kind: "directory" },
      { name: "new", relativePath: "new", kind: "directory" },
      { name: "src", relativePath: "src", kind: "directory" },
    ]);
    state.childrenByPath.set("new", [{ name: "x.js", relativePath: "new/x.js", kind: "file" }]);
    state.expanded.add("new");
    applyGitOverlay(state, files);
    return Object.fromEntries(visibleRows(state).map((row) => [row.path, row]));
  }

  it("gives a folder the most urgent state anywhere below it", () => {
    const rows = rowsFor([
      { path: "src/a.ts", code: "U", status: "untracked" },
      { path: "src/deep/b.ts", code: "C", status: "conflict" },
      { path: "src/c.ts", code: "M", status: "modified" },
    ]);
    expect(rows.src.gitStatus).toBe("conflict");
    expect(rows.src.gitCode).toBeUndefined();
    expect(rows.lib.gitStatus).toBeUndefined();
  });

  it("treats files under a new folder that Git reports as dir/ as untracked", () => {
    const rows = rowsFor([{ path: "new/", code: "U", status: "untracked" }]);
    expect(rows.new.gitStatus).toBe("untracked");
    expect(rows["new/x.js"]).toMatchObject({ gitCode: "U", gitStatus: "untracked" });
  });
});
