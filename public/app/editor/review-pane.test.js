// ABOUTME: Tests Review as a viewer: one file at a time, scopes, comments, and Pi's /undo.
// ABOUTME: Nothing in Review writes files; undo goes through Pi and git discards to the Git panel.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setFileActionDispatch } from "../chat/file-actions.js";
import { setComposerInsert } from "../composer/composer-actions.js";
import { centerReviewOpen } from "./center-mode.js";
import { leadTab, leaveLeadTab } from "./lead-tab.js";
import {
  ensureReviewHosts,
  openCommitFile,
  openReview,
  openTurnReview,
  reviewListElement,
  reviewPaneElement,
  setReviewCommands,
  setReviewSend,
  setReviewSources,
  showPiReview,
} from "./review-pane.js";

const payload = {
  label: "Turn 14",
  files: [
    { path: "a.js", before: "one\n", after: "two\n" },
    { path: "b.js", before: "old\n", after: "new\n" },
  ],
};

describe("review pane", () => {
  beforeEach(() => {
    document.body.replaceChildren();
    const sidebar = document.createElement("div");
    sidebar.id = "sidebar";
    const reviewSidebar = document.createElement("aside");
    reviewSidebar.id = "review-sidebar";
    const center = document.createElement("div");
    document.body.append(sidebar, reviewSidebar, center);
    setReviewSources(null);
    setReviewSend(null);
    setReviewCommands(null);
    ensureReviewHosts(center);
    openReview(payload);
  });

  it("shows one file and lists the changes in the Review panel, not Sessions", () => {
    const article = reviewPaneElement()?.querySelector(".review-file");
    expect(article?.textContent).toContain("a.js");
    expect(article?.textContent).not.toContain("b.js");
    expect(reviewListElement()?.parentElement?.id).toBe("review-sidebar");
    expect(document.getElementById("sidebar")?.contains(reviewListElement() || document.body)).toBe(
      false,
    );
  });

  it("steps to the next file and has no approve buttons", () => {
    const steps = reviewPaneElement()?.querySelectorAll(".spopi-review-step");
    steps?.[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(reviewPaneElement()?.querySelector(".review-file")?.textContent).toContain("b.js");
    expect(reviewPaneElement()?.textContent).not.toMatch(/review\.(keep|undoAll|markReviewed)/);
  });

  it("runs Pi's /undo from the newest turn and closes Review", async () => {
    const run = vi.fn();
    setReviewCommands({ has: (name) => name === "undo", run });
    setReviewSources({ load: async () => ({ files: payload.files, turn: { latest: true } }) });
    openTurnReview({ files: payload.files, userEntryId: "u9" });
    await vi.waitFor(() =>
      expect(reviewPaneElement()?.querySelector(".review-undo-turn")).not.toBeNull(),
    );
    reviewPaneElement()
      ?.querySelector(".review-undo-turn")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(run).toHaveBeenCalledWith("/undo");
    expect(centerReviewOpen()).toBe(false);
  });

  it("offers no undo on an older turn, since /undo only rolls back the newest", async () => {
    const load = vi.fn(async () => ({ files: payload.files, turn: { latest: false } }));
    setReviewCommands({ has: (name) => name === "undo", run: vi.fn() });
    setReviewSources({ load });
    openTurnReview({ files: payload.files, userEntryId: "u1" });
    await vi.waitFor(() =>
      expect(load).toHaveBeenCalledWith("turn:u1", { extraPaths: ["a.js", "b.js"] }),
    );
    await Promise.resolve();
    expect(reviewPaneElement()?.querySelector(".review-undo-turn")).toBeNull();
  });

  it("offers no undo when pi-workspace-history is missing", () => {
    setReviewCommands({ has: () => false, run: vi.fn() });
    openReview(payload);
    expect(reviewPaneElement()?.querySelector(".review-undo-turn")).toBeNull();
  });

  it("sends a hunk comment to the chat", () => {
    const send = vi.fn();
    setReviewSend(send);
    reviewPaneElement()
      ?.querySelector(".spopi-review-comment")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const note = /** @type {HTMLTextAreaElement} */ (
      reviewPaneElement()?.querySelector(".review-comment-note")
    );
    note.value = "keep the old name";
    reviewPaneElement()
      ?.querySelector("[data-i18n='review.comments.send']")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(String(send.mock.calls[0][0])).toContain("keep the old name");
  });

  it("adds a comment to the message box when nothing can send", () => {
    /** @type {Record<string, unknown>[]} */
    const inserted = [];
    setComposerInsert((detail) => inserted.push(detail));
    reviewPaneElement()
      ?.querySelector(".spopi-review-comment")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    reviewPaneElement()
      ?.querySelector(".review-comment-add")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(String(inserted[0]?.text || "")).toContain("+");
  });

  it("lists only Pi's scopes and loads the session from the sources", async () => {
    const load = vi.fn(async (/** @type {string} */ key) => ({
      files: [{ path: `${key}.js`, before: "a\n", after: "b\n" }],
    }));
    setReviewSources({ load });
    const scopes = [...(reviewListElement()?.querySelectorAll(".review-scope button") || [])];
    expect(scopes.map((button) => button.getAttribute("data-i18n"))).toEqual([
      "review.scope.turn",
      "review.scope.session",
    ]);
    scopes[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await vi.waitFor(() => expect(reviewPaneElement()?.textContent).toContain("session.js"));
    expect(load).toHaveBeenCalledWith("session", { extraPaths: [] });
  });

  it("opens a Git change beside the Git panel, and the rail brings back Pi's turn", async () => {
    const load = vi.fn(async (/** @type {string} */ key) => ({
      files: [{ path: `${key}.js`, before: "a\n", after: "b\n" }],
    }));
    setReviewSources({ load });
    /** @type {string[]} */
    const lists = [];
    /** @param {Event} event */
    const shown = (event) => lists.push(/** @type {CustomEvent} */ (event).detail?.list);
    document.addEventListener("spopi-review-shown", shown);
    document.dispatchEvent(
      new CustomEvent("spopi-review-git-file", { detail: { path: "git.js" } }),
    );
    await vi.waitFor(() => expect(reviewPaneElement()?.textContent).toContain("git.js"));
    expect(lists.at(-1)).toBe("git");
    expect(reviewPaneElement()?.querySelector(".review-undo-turn")).toBeNull();
    showPiReview();
    document.removeEventListener("spopi-review-shown", shown);
    expect(lists.at(-1)).toBe("review");
    expect(reviewPaneElement()?.querySelector(".review-file")?.textContent).toContain("a.js");
  });

  it("opens a commit file from its patch, titled by the commit", () => {
    openCommitFile({
      commitOid: "f14147d0123",
      subject: "Add a greeting",
      path: "greet.js",
      status: "A",
      patch: "@@ -0,0 +1,2 @@\n+export function greet() {\n+}",
    });
    expect(leadTab("review")?.label).toBe("f14147d Add a greeting");
    expect(reviewPaneElement()?.querySelectorAll(".review-row[data-kind='add']")).toHaveLength(2);
    expect(reviewPaneElement()?.textContent).not.toContain("review.noBaseline");
  });

  it("loads the clicked turn's files by its entry id", async () => {
    const load = vi.fn(async () => ({
      files: [{ path: "app.js", status: "A", before: "", after: "const x = 1;\n" }],
    }));
    setReviewSources({ load });
    openTurnReview({ files: [{ path: "app.js" }], userEntryId: "u7", number: 9 });
    await vi.waitFor(() => expect(reviewPaneElement()?.textContent).toContain("const x = 1;"));
    expect(load).toHaveBeenCalledWith("turn:u7", { extraPaths: ["app.js"] });
    // No locale is loaded here, so the chat's turn number shows as the label key.
    expect(reviewPaneElement()?.querySelector(".review-view-title")?.textContent).toBe(
      "review.label.turn",
    );
  });

  it("closes from its tab back to the editor", () => {
    const repaint = vi.fn();
    const hidden = vi.fn();
    document.addEventListener("spopi-center-repaint", repaint);
    document.addEventListener("spopi-review-hidden", hidden);
    leadTab("review")?.onClose();
    document.removeEventListener("spopi-center-repaint", repaint);
    document.removeEventListener("spopi-review-hidden", hidden);
    expect(centerReviewOpen()).toBe(false);
    expect(leadTab("review")).toBeNull();
    expect(reviewPaneElement()?.classList.contains("is-visible")).toBe(false);
    expect(reviewListElement()?.classList.contains("hidden")).toBe(true);
    expect(repaint).toHaveBeenCalled();
    expect(hidden).toHaveBeenCalled();
  });

  it("steps aside for a file and comes back from its tab", () => {
    expect(leadTab("review")?.active).toBe(true);
    leaveLeadTab();
    expect(centerReviewOpen()).toBe(false);
    expect(leadTab("review")?.active).toBe(false);
    expect(reviewPaneElement()?.classList.contains("is-visible")).toBe(false);
    expect(reviewListElement()?.classList.contains("hidden")).toBe(false);
    leadTab("review")?.onSelect();
    expect(centerReviewOpen()).toBe(true);
    expect(leadTab("review")?.active).toBe(true);
    expect(reviewPaneElement()?.querySelector(".review-file")?.textContent).toContain("a.js");
  });

  it("opens the file in the editor without closing its tab", () => {
    /** @type {{ type: string, path?: string }[]} */
    const actions = [];
    const unbind = setFileActionDispatch((action) => actions.push(action));
    reviewPaneElement()
      ?.querySelector(".review-open-editor")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    unbind();
    expect(actions[0]).toMatchObject({ type: "file.preview", path: "a.js" });
    expect(centerReviewOpen()).toBe(false);
    expect(leadTab("review")?.active).toBe(false);
  });
});
