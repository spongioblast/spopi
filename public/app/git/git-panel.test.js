// ABOUTME: Verifies Git panel rendering, grouping, and safe text handling.
// ABOUTME: Covers the panel's explicit four-group projection without filesystem side effects.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setFileActionDispatch } from "../chat/file-actions.js";
import { createI18n } from "../i18n/i18n.js";
import { GitPanel } from "./git-panel.js";

const enMessages = JSON.parse(readFileSync(join(process.cwd(), "public/locales/en.json"), "utf8"));

beforeEach(async () => {
  document.body.replaceChildren();
  const panel = document.createElement("div");
  panel.id = "panel";
  const dialogs = document.createElement("div");
  dialogs.id = "dialog-container";
  dialogs.className = "hidden";
  document.body.append(panel, dialogs);
  globalThis.fetch = vi.fn(async (input) => {
    if (String(input).includes("/locales/en.json")) {
      return new Response(JSON.stringify(enMessages));
    }
    return new Response(JSON.stringify({}), { status: 404 });
  });
  await createI18n();
});

describe("GitPanel", () => {
  it("renders four groups and repository paths as text", () => {
    const panel = new GitPanel({
      container: document.querySelector("#panel"),
      client: { command: vi.fn() },
    });
    panel.setSnapshot({
      entries: [
        { entryKind: "ordinary", xy: "M.", displayPath: "<unsafe>.js" },
        { entryKind: "ordinary", xy: ".M", displayPath: "changed.js" },
        { entryKind: "untracked", displayPath: "new.js" },
        { entryKind: "unmerged", displayPath: "conflict.js" },
      ],
    });
    expect(panel.container.textContent).toContain("<unsafe>.js");
    expect(panel.container.querySelectorAll("section")).toHaveLength(4);
    expect(panel.container.querySelector("script")).toBeNull();
  });

  it("shows the not-a-repository message instead of no-status when setNotGitRepo is set", () => {
    const init = vi.fn().mockReturnValue("git-init");
    const panel = new GitPanel({
      container: document.querySelector("#panel"),
      client: { command: vi.fn(), init },
    });
    panel.setNotGitRepo(true);
    expect(panel.container.textContent).toContain("This project is not a Git repository");
    expect(panel.container.textContent).toContain("Initialize repository");
    expect(panel.container.textContent).not.toContain("No Git status loaded");
    panel.container.querySelector("button").click();
    expect(init).toHaveBeenCalledOnce();
    expect(panel.container.querySelector("button").disabled).toBe(true);

    // A successful snapshot clears the not-git state and renders groups again.
    panel.setSnapshot({ entries: [{ entryKind: "ordinary", xy: ".M", displayPath: "app.js" }] });
    expect(panel.container.textContent).toContain("app.js");
    expect(panel.container.textContent).not.toContain("This project is not a Git repository");
  });

  it("only treats the most recent status probe failure as not-a-repository", () => {
    const command = vi.fn().mockReturnValue("git-7");
    const panel = new GitPanel({
      container: document.querySelector("#panel"),
      client: { command },
    });
    void panel.refresh();
    expect(panel.isStatusFailure("git-7")).toBe(true);
    // Stale / concurrent non-status failures must not match.
    expect(panel.isStatusFailure("git-6")).toBe(false);
    expect(panel.isStatusFailure(null)).toBe(false);
    expect(panel.isStatusFailure(undefined)).toBe(false);

    // A successful snapshot retires the status probe so later failures of
    // the same requestId cannot flip the panel back into not-a-repository.
    panel.setSnapshot({ entries: [] });
    expect(panel.isStatusFailure("git-7")).toBe(false);
  });

  it("renders commit controls but leaves status refresh to the shared sidebar header", () => {
    const command = vi.fn();
    const panel = new GitPanel({
      container: document.querySelector("#panel"),
      client: { command },
    });
    panel.setSnapshot({
      branch: "feature/panel",
      upstream: "origin/feature/panel",
      ahead: 2,
      behind: 1,
      counts: { staged: 1, changes: 2, untracked: 3 },
      changeStats: { additions: 5, deletions: 4 },
      entries: [],
    });

    const toolbar = panel.container.querySelector(".git-panel-toolbar");
    expect(toolbar?.querySelector(".git-panel-summary")?.textContent).toContain("feature/panel");
    expect(toolbar?.querySelector(".git-panel-refresh")).toBeNull();
    expect(panel.container.querySelector(".git-panel-commit")).not.toBeNull();
    expect(panel.container.querySelector(".git-panel-stats")).not.toBeNull();
  });

  it("renders group headers as session-list style section headers with a disclosure chevron", () => {
    const panel = new GitPanel({
      container: document.querySelector("#panel"),
      client: { command: vi.fn() },
    });
    panel.setSnapshot({
      entries: [
        { entryKind: "ordinary", xy: ".M", displayPath: "src/app.js", pathBytesBase64: "YQ==" },
      ],
    });

    const header = panel.container.querySelector(".git-group-heading");
    expect(header.classList.contains("sidebar-section-header")).toBe(true);
    expect(header.getAttribute("role")).toBe("button");
    expect(header.getAttribute("aria-expanded")).toBe("true");
    const chevron = header.querySelector(".section-chevron");
    expect(chevron).not.toBeNull();
    expect(chevron.querySelector("svg")).not.toBeNull();
    expect(header.querySelector(".sidebar-section-title")?.textContent).toBe("Staged");
    expect(header.querySelector(".sidebar-section-count")?.textContent).toBe("0");
  });

  it("renders directories and files as distinct tree rows", () => {
    const panel = new GitPanel({
      container: document.querySelector("#panel"),
      client: { command: vi.fn() },
    });
    panel.setSnapshot({
      entries: [
        { entryKind: "ordinary", xy: ".M", displayPath: "src/app.js", pathBytesBase64: "YQ==" },
      ],
    });

    expect(
      panel.container.querySelector(".git-directory-heading")?.classList.contains("git-tree-row"),
    ).toBe(true);
    expect(panel.container.querySelector(".git-entry")?.classList.contains("git-tree-row")).toBe(
      true,
    );
    // Directory rows render a Material folder icon (open when expanded) from
    // the shared file-type vocabulary, matching File Browser's icon set.
    expect(
      panel.container.querySelector(".git-directory-heading .git-tree-folder-icon svg"),
    ).not.toBeNull();
    expect(panel.container.querySelector(".git-directory-heading.collapsed")).toBeNull();
  });

  it("shows a mixed index/worktree entry in both actionable groups", () => {
    const panel = new GitPanel({
      container: document.querySelector("#panel"),
      client: { command: vi.fn() },
    });
    panel.setSnapshot({
      entries: [
        {
          entryKind: "ordinary",
          xy: "MM",
          displayPath: "mixed.js",
          pathBytesBase64: "bWl4ZWQuanM=",
        },
      ],
    });
    expect(panel.container.querySelectorAll(".git-entry")).toHaveLength(2);
  });

  it("requests only the allowed write operation for each group", () => {
    const write = vi.fn();
    const panel = new GitPanel({
      container: document.querySelector("#panel"),
      client: { command: vi.fn(), write },
    });
    const staged = {
      entryKind: "ordinary",
      xy: "M.",
      displayPath: "staged.js",
      pathBytesBase64: "c3RhZ2VkLmpz",
    };
    const changed = {
      entryKind: "ordinary",
      xy: ".M",
      displayPath: "changed.js",
      pathBytesBase64: "Y2hhbmdlZC5qcw==",
    };
    panel.setSnapshot({ snapshotId: "snapshot", entries: [staged, changed] });
    expect(panel.write("stage", [staged])).toBeNull();
    panel.write("unstage", [staged]);
    panel.write("discard", [changed]);
    expect(write).toHaveBeenCalledTimes(2);
  });

  it("re-enables the submit button after a confirmation-required token arrives", () => {
    const panel = new GitPanel({
      container: document.querySelector("#panel"),
      client: { command: vi.fn(), commit: vi.fn() },
    });
    panel.aiSnapshot = { snapshotId: "ai-snap" };
    panel.commitMessage = "feat: x";
    panel.openCommitDialog();
    // Simulate the first commit attempt putting the dialog in-progress.
    panel.setCommitInProgress(true);
    expect(document.body.querySelector(".git-commit-submit").disabled).toBe(true);
    // The confirmation-required response must end in-progress and re-enable submit.
    panel.applyConfirmationToken("token-123");
    expect(panel.commitInProgress).toBe(false);
    expect(document.body.querySelector(".git-commit-submit").disabled).toBe(false);
    expect(panel.pendingConfirmationToken).toBe("token-123");
    panel.closeCommitDialog();
  });

  it("keeps the dialog open with the error when commit result is failed", () => {
    const panel = new GitPanel({
      container: document.querySelector("#panel"),
      client: { command: vi.fn(), commit: vi.fn() },
    });
    panel.aiSnapshot = { snapshotId: "ai-snap" };
    panel.commitMessage = "my message";
    panel.openCommitDialog();
    panel.setCommitInProgress(true);
    // Simulate a hook-rejection failure.
    panel.applyCommitResult({ status: "failed", error: "hook says no" });
    expect(panel.commitInProgress).toBe(false);
    // The user's message must be preserved for retry.
    expect(panel.commitMessage).toBe("my message");
    // The dialog must still be open with the error shown.
    expect(document.body.querySelector(".git-commit-dialog")).not.toBeNull();
    expect(document.body.querySelector(".git-commit-error").textContent).toContain("hook says no");
    expect(document.body.querySelector(".ui-dialog.git-commit-dialog")).not.toBeNull();
    expect(document.body.querySelector(".ui-button--primary.git-commit-submit")).not.toBeNull();
    panel.closeCommitDialog();
  });

  it("turns Git's missing-author error into the name and email form", async () => {
    const identity = {
      load: vi.fn(async () => ({
        name: "",
        email: "",
        global: { name: "", email: "" },
        repository: { name: "", email: "" },
      })),
      save: vi.fn(async ({ name, email, scope }) => ({
        name,
        email,
        global: { name, email },
        repository: { name: "", email: "" },
        scope,
      })),
    };
    const commit = vi.fn();
    const panel = new GitPanel({
      container: document.querySelector("#panel"),
      client: { command: vi.fn(), commit },
      identity,
    });
    panel.aiSnapshot = { snapshotId: "ai-snap" };
    panel.commitMessage = "feat: x";
    panel.openCommitDialog();
    await vi.waitFor(() =>
      expect(document.body.querySelector(".git-identity-name")).not.toBeNull(),
    );
    panel.applyCommitResult({
      status: "failed",
      error: "Author identity unknown\n*** Please tell me who you are.",
    });
    expect(document.body.querySelector(".git-commit-error").textContent).toMatch(/name and email/i);
    document.body.querySelector(".git-identity-name").value = "Ada";
    document.body.querySelector(".git-identity-name").dispatchEvent(new Event("input"));
    document.body.querySelector(".git-identity-email").value = "ada@example.com";
    document.body.querySelector(".git-identity-email").dispatchEvent(new Event("input"));
    await panel.submitCommit();
    expect(identity.save).toHaveBeenCalledWith({
      name: "Ada",
      email: "ada@example.com",
      scope: "global",
    });
    expect(commit).toHaveBeenCalled();
    panel.closeCommitDialog();
  });

  it("stages a partial-stage file from the changes group with group=changes", () => {
    const write = vi.fn();
    const panel = new GitPanel({
      container: document.querySelector("#panel"),
      client: { command: vi.fn(), write },
    });
    const partial = {
      entryKind: "ordinary",
      xy: "MM",
      displayPath: "partial.js",
      pathBytesBase64: "cGFydGlhbC5qcw==",
    };
    panel.setSnapshot({ snapshotId: "snapshot", entries: [partial] });
    // Staging from the Changes group must send only group="changes", not also
    // "staged" (which would make the allowedGroups check reject it).
    panel.write("stage", [partial], "changes");
    expect(write).toHaveBeenCalledTimes(1);
    const sent = write.mock.calls[0][2];
    expect(sent).toHaveLength(1);
    expect(sent[0].group).toBe("changes");
  });

  it("opens a clicked change in the shared diff tab by its path", () => {
    const onReviewFile = vi.fn();
    const panel = new GitPanel({
      container: document.querySelector("#panel"),
      onReviewFile,
      client: { diff: vi.fn() },
    });
    const entry = {
      entryKind: "untracked",
      displayPath: "new.js",
      pathBytesBase64: "bmV3Lmpz",
    };
    panel.setSnapshot({ snapshotId: "snapshot", entries: [entry] });
    [...panel.container.querySelectorAll(".git-entry")][0].click();
    expect(onReviewFile).toHaveBeenCalledWith("new.js");
  });

  it("prefills the commit dialog when AI succeeds", () => {
    const panel = new GitPanel({
      container: document.querySelector("#panel"),
      client: { command: vi.fn(), commit: vi.fn() },
    });
    panel.applyAiResult({ snapshotId: "ai-snap" }, "feat: add thing");
    expect(document.body.querySelector(".git-commit-dialog")).not.toBeNull();
    expect(document.body.querySelector(".git-commit-textarea").value).toBe("feat: add thing");
    expect(document.body.querySelector(".git-amend-checkbox")).not.toBeNull();
    panel.closeCommitDialog();
  });

  it("closes the commit dialog on Escape", () => {
    const panel = new GitPanel({
      container: document.querySelector("#panel"),
      client: { command: vi.fn(), commit: vi.fn() },
    });
    panel.applyAiResult({ snapshotId: "ai-snap" }, "feat: add thing");
    expect(document.body.querySelector(".git-commit-dialog")).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.body.querySelector(".git-commit-dialog")).toBeNull();
  });

  it("cancels the discard confirm dialog on Escape", async () => {
    const write = vi.fn();
    const panel = new GitPanel({
      container: document.querySelector("#panel"),
      client: { command: vi.fn(), write },
    });
    const pending = panel.discard([{ displayPath: "a.js" }]);
    expect(document.body.querySelector(".dialog")).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await expect(pending).resolves.toBeNull();
    expect(write).not.toHaveBeenCalled();
    expect(document.body.querySelector(".dialog")).toBeNull();
  });

  it("opens the commit dialog with an error and empty message when AI fails", () => {
    const panel = new GitPanel({
      container: document.querySelector("#panel"),
      client: { command: vi.fn(), commit: vi.fn() },
    });
    panel.aiSnapshot = { snapshotId: "ai-snap" };
    panel.applyAiFailure("timeout");
    expect(document.body.querySelector(".git-commit-error").textContent).toBe("timeout");
    expect(document.body.querySelector(".git-commit-textarea").value).toBe("");
    panel.closeCommitDialog();
  });

  it("falls back to the status snapshot when AI fails before any AI snapshot exists", () => {
    const panel = new GitPanel({
      container: document.querySelector("#panel"),
      client: { command: vi.fn(), commit: vi.fn() },
    });
    panel.setSnapshot({ snapshotId: "status-snap", entries: [] });
    expect(panel.aiSnapshot).toBeNull();
    panel.applyAiFailure("timeout");
    expect(document.body.querySelector(".git-commit-dialog")).not.toBeNull();
    expect(panel.aiSnapshot.snapshotId).toBe("status-snap");
    panel.closeCommitDialog();
  });

  it("renders nested directory tree and truncation notice", () => {
    const panel = new GitPanel({
      container: document.querySelector("#panel"),
      client: { command: vi.fn() },
    });
    panel.setSnapshot({
      snapshotId: "snap",
      totalEntryCount: 1500,
      returnedEntryCount: 1200,
      entries: [
        {
          entryKind: "ordinary",
          xy: ".M",
          displayPath: "src/a.js",
          pathBytesBase64: "c3JjL2EuanM=",
        },
        {
          entryKind: "ordinary",
          xy: ".M",
          displayPath: "src/b.js",
          pathBytesBase64: "c3JjL2IuanM=",
        },
      ],
    });
    expect(panel.container.querySelectorAll(".git-directory-heading")).toHaveLength(1);
    expect(panel.container.querySelectorAll(".git-entry")).toHaveLength(2);
    const notice = panel.container.querySelector(".git-truncation-notice");
    expect(notice).not.toBeNull();
    // With locales seeded, the notice must show the hidden count.
    expect(notice.textContent).toContain("300");
  });

  it("accumulates shift-selection and batch-stages only selected", () => {
    const write = vi.fn();
    const panel = new GitPanel({
      container: document.querySelector("#panel"),
      client: { command: vi.fn(), write },
    });
    const e1 = {
      entryKind: "ordinary",
      xy: ".M",
      displayPath: "a.js",
      pathBytesBase64: "YWE=",
    };
    const e2 = {
      entryKind: "ordinary",
      xy: ".M",
      displayPath: "b.js",
      pathBytesBase64: "YmI=",
    };
    panel.setSnapshot({ snapshotId: "snap", entries: [e1, e2] });
    const rows = panel.container.querySelectorAll(".git-entry");
    const shiftClick = new MouseEvent("click", { bubbles: true, shiftKey: true });
    rows[0].dispatchEvent(shiftClick);
    rows[1].dispatchEvent(shiftClick);
    const stageBtn = [...panel.container.querySelectorAll(".git-group-actions button")].find((b) =>
      b.textContent.toLowerCase().includes("stage"),
    );
    stageBtn.click();
    expect(write).toHaveBeenCalledTimes(1);
    const batch = write.mock.calls[0][2];
    expect(batch).toHaveLength(2);
  });

  it("tracks pendingAiRequestId so requestAiCommitMessage records it", () => {
    const aiCommitMessage = vi.fn(() => "ai-req-1");
    const panel = new GitPanel({
      container: document.querySelector("#panel"),
      client: { command: vi.fn(), aiCommitMessage },
    });
    panel.setSnapshot({ snapshotId: "snap", entries: [], counts: { staged: 1, conflicted: 0 } });
    const returned = panel.requestAiCommitMessage();
    expect(returned).toBe("ai-req-1");
    expect(panel.pendingAiRequestId).toBe("ai-req-1");
  });

  it("clears pendingAiRequestId on applyAiResult so a stale later response cannot match", () => {
    const panel = new GitPanel({
      container: document.querySelector("#panel"),
      client: { command: vi.fn() },
    });
    panel.pendingAiRequestId = "ai-req-1";
    panel.applyAiResult({ snapshotId: "ai-snap" }, "msg");
    expect(panel.pendingAiRequestId).toBeNull();
    panel.closeCommitDialog();
  });

  it("clears pendingAiRequestId on applyAiFailure so a stale later failure cannot match", () => {
    const panel = new GitPanel({
      container: document.querySelector("#panel"),
      client: { command: vi.fn() },
    });
    panel.pendingAiRequestId = "ai-req-1";
    panel.applyAiFailure("err");
    expect(panel.pendingAiRequestId).toBeNull();
    panel.closeCommitDialog();
  });

  it("clears pendingCommitRequestId when applyCommitResult succeeds", () => {
    const panel = new GitPanel({
      container: document.querySelector("#panel"),
      client: { command: vi.fn() },
    });
    panel.aiSnapshot = { snapshotId: "ai-snap" };
    panel.commitInProgress = true;
    panel.pendingCommitRequestId = "commit-B";
    panel.applyCommitResult({ status: "succeeded", requestId: "commit-B" });
    expect(panel.commitInProgress).toBe(false);
    expect(panel.aiSnapshot).toBeNull();
    expect(panel.pendingCommitRequestId).toBeNull();
  });

  it("clears pendingCommitRequestId when applyCommitResult fails", () => {
    const panel = new GitPanel({
      container: document.querySelector("#panel"),
      client: { command: vi.fn() },
    });
    panel.aiSnapshot = { snapshotId: "ai-snap" };
    panel.commitMessage = "my msg";
    panel.pendingCommitRequestId = "commit-B";
    panel.applyCommitResult({ status: "failed", requestId: "commit-B", error: "hook" });
    expect(panel.pendingCommitRequestId).toBeNull();
    expect(panel.aiError).toContain("hook");
    panel.closeCommitDialog();
  });
});

describe("GitPanel push", () => {
  const snapshotWithBranch = (overrides = {}) => ({
    snapshotId: "snap-1",
    branch: "feature",
    upstream: "origin/feature",
    ahead: 2,
    behind: 0,
    entries: [],
    counts: { staged: 0, changes: 0, untracked: 0, conflicted: 0 },
    ...overrides,
  });

  it("sends a push command and disables the button while in flight", () => {
    const push = vi.fn(() => "git-7");
    const panel = new GitPanel({
      container: document.querySelector("#panel"),
      client: { command: vi.fn(), push },
    });
    panel.setSnapshot(snapshotWithBranch());
    panel.container.querySelector(".git-panel-push").click();
    expect(push).toHaveBeenCalledTimes(1);
    expect(panel.pushInProgress).toBe(true);
    expect(panel.container.querySelector(".git-panel-push").disabled).toBe(true);
  });

  it("ignores a second click while a push is already running", () => {
    const push = vi.fn(() => "git-7");
    const panel = new GitPanel({
      container: document.querySelector("#panel"),
      client: { command: vi.fn(), push },
    });
    panel.setSnapshot(snapshotWithBranch());
    panel.push();
    panel.push();
    expect(push).toHaveBeenCalledTimes(1);
  });

  it("disables push on a detached HEAD", () => {
    const panel = new GitPanel({
      container: document.querySelector("#panel"),
      client: { command: vi.fn(), push: vi.fn() },
    });
    panel.setSnapshot(snapshotWithBranch({ branch: null, headState: "detached" }));
    expect(panel.container.querySelector(".git-panel-push").disabled).toBe(true);
  });

  it("clears the in-flight state and shows no error after a successful push", () => {
    const panel = new GitPanel({
      container: document.querySelector("#panel"),
      client: { command: vi.fn(), push: vi.fn(() => "git-7") },
    });
    panel.setSnapshot(snapshotWithBranch());
    panel.push();
    panel.applyPushResult({ status: "succeeded", remote: "origin", branch: "feature" });
    expect(panel.pushInProgress).toBe(false);
    expect(panel.container.querySelector(".git-panel-push-error")).toBeNull();
    expect(panel.container.querySelector(".git-panel-push").disabled).toBe(false);
  });

  it("maps backend failure codes onto localized copy", () => {
    const panel = new GitPanel({
      container: document.querySelector("#panel"),
      client: { command: vi.fn(), push: vi.fn(() => "git-7") },
    });
    panel.setSnapshot(snapshotWithBranch());
    panel.applyPushResult({ status: "failed", error: "push_no_remote" });
    expect(panel.container.querySelector(".git-panel-push-error").textContent).toBe(
      enMessages.git.pushNoRemote,
    );
  });

  it("passes an unrecognized git error through as text", () => {
    const panel = new GitPanel({
      container: document.querySelector("#panel"),
      client: { command: vi.fn(), push: vi.fn(() => "git-7") },
    });
    panel.setSnapshot(snapshotWithBranch());
    panel.applyPushResult({ status: "failed", error: "! [rejected] feature -> feature" });
    const error = panel.container.querySelector(".git-panel-push-error");
    expect(error.textContent).toBe("! [rejected] feature -> feature");
    expect(panel.container.querySelector("script")).toBeNull();
  });

  it("drops a stale error when the next push starts", () => {
    const panel = new GitPanel({
      container: document.querySelector("#panel"),
      client: { command: vi.fn(), push: vi.fn(() => "git-7") },
    });
    panel.setSnapshot(snapshotWithBranch());
    panel.applyPushResult({ status: "failed", error: "push_no_remote" });
    panel.push();
    expect(panel.container.querySelector(".git-panel-push-error")).toBeNull();
  });

  it("renders hover actions for each group and a publish pill without upstream", () => {
    const write = vi.fn();
    const push = vi.fn().mockReturnValue("git-push");
    const panel = new GitPanel({
      container: document.querySelector("#panel"),
      client: { command: vi.fn(), write, push },
    });
    panel.setSnapshot({
      snapshotId: "snap",
      branch: "master",
      remotes: ["origin"],
      entries: [
        { entryKind: "ordinary", xy: "M.", displayPath: "staged.js", pathBytesBase64: "c3Q=" },
        { entryKind: "ordinary", xy: ".M", displayPath: "changed.js", pathBytesBase64: "Y2g=" },
        { entryKind: "untracked", displayPath: "new.js", pathBytesBase64: "bmU=" },
        { entryKind: "unmerged", displayPath: "conflict.js", pathBytesBase64: "Y28=" },
      ],
    });
    const pill = /** @type {HTMLButtonElement} */ (
      panel.container.querySelector(".git-publish-pill")
    );
    expect(pill.textContent).toContain("publish");
    pill.click();
    expect(push).toHaveBeenCalledOnce();
    expect(panel.container.querySelector(".git-group-changes .git-row-stage")).not.toBeNull();
    expect(panel.container.querySelector(".git-group-staged .git-row-unstage")).not.toBeNull();
    expect(panel.container.querySelector(".git-group-untracked .git-row-delete")).not.toBeNull();
    expect(panel.container.querySelector(".git-group-conflicted .git-row-open")).not.toBeNull();
    panel.container.querySelector(".git-group-changes .git-row-stage").click();
    expect(write).toHaveBeenCalledWith(
      "stage",
      "snap",
      expect.arrayContaining([expect.objectContaining({ group: "changes" })]),
    );
  });

  it("offers Add remote without a remote, adds it, and publishes the branch", async () => {
    const sendAndAwait = vi.fn(async (payload) =>
      payload.type === "remote_add" && payload.url === "https://github.com/me/app.git"
        ? { type: "git_command_ack" }
        : { type: "git_command_failed", error: "a remote named origin already exists" },
    );
    const push = vi.fn().mockReturnValue("git-push");
    const panel = new GitPanel({
      container: document.querySelector("#panel"),
      client: { command: vi.fn(), sendAndAwait, push },
    });
    panel.setSnapshot({ snapshotId: "snap", branch: "main", remotes: [], entries: [] });
    const pill = /** @type {HTMLButtonElement} */ (
      panel.container.querySelector(".git-publish-pill")
    );
    expect(pill.textContent).toBe("Add remote…");
    pill.click();
    const dialog = /** @type {HTMLElement} */ (document.querySelector(".git-remote-dialog"));
    expect(dialog.querySelector(".dialog-title")?.textContent).toBe("Add remote");
    const url = /** @type {HTMLInputElement} */ (dialog.querySelector(".git-remote-url"));
    const save = /** @type {HTMLButtonElement} */ (dialog.querySelector(".git-remote-save"));

    url.value = "ext::sh -c id";
    save.click();
    expect(dialog.querySelector(".git-remote-error")?.textContent).toContain("https://");
    expect(sendAndAwait).not.toHaveBeenCalled();

    url.value = "https://github.com/someone/else.git";
    save.click();
    await vi.waitFor(() =>
      expect(dialog.querySelector(".git-remote-error")?.textContent).toContain("already exists"),
    );
    expect(dialog.isConnected).toBe(true);

    url.value = "https://github.com/me/app.git";
    save.click();
    await vi.waitFor(() => expect(dialog.isConnected).toBe(false));
    expect(sendAndAwait).toHaveBeenLastCalledWith({
      type: "remote_add",
      name: "origin",
      url: "https://github.com/me/app.git",
    });
    expect(push).toHaveBeenCalledOnce();
  });

  it("opens a conflicted row via previewfile and confirms untracked delete", async () => {
    const write = vi.fn();
    const panel = new GitPanel({
      container: document.querySelector("#panel"),
      client: { command: vi.fn(), write },
    });
    panel.setSnapshot({
      snapshotId: "snap",
      entries: [
        { entryKind: "unmerged", displayPath: "conflict.js", pathBytesBase64: "Y28=" },
        { entryKind: "untracked", displayPath: "new.js", pathBytesBase64: "bmU=" },
      ],
    });
    const opened = [];
    const unbind = setFileActionDispatch((action) => {
      if (action.type === "file.preview") opened.push(action);
    });
    panel.container.querySelector(".git-group-conflicted .git-entry").click();
    unbind();
    expect(opened).toEqual([{ type: "file.preview", path: "conflict.js", line: undefined }]);
    panel.container.querySelector(".git-group-untracked .git-row-delete").click();
    await vi.waitFor(() => expect(document.querySelector(".dialog")).not.toBeNull());
    expect(document.querySelector(".dialog p")?.textContent).toContain("untracked");
    document.querySelector(".ui-button--danger").click();
    await vi.waitFor(() => expect(write).toHaveBeenCalled());
    expect(write.mock.calls[0][0]).toBe("discard");
    expect(write.mock.calls[0][2][0].group).toBe("untracked");
  });

  it("shows the git-missing copy", () => {
    const panel = new GitPanel({
      container: document.querySelector("#panel"),
      client: { command: vi.fn() },
    });
    panel.setGitMissing(true);
    expect(panel.container.textContent).toContain("Git was not found");
  });
});
