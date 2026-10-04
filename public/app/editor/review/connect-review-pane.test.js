// ABOUTME: Tests that a finished review is a prompt, or a follow-up while Pi works.
// ABOUTME: One comment sent on its own still steers the running turn.

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ensureReviewHosts,
  openReview,
  reviewPaneElement,
  setReviewDrafts,
  setReviewPackageSend,
  setReviewSend,
} from "../review-pane.js";
import { connectReviewPane } from "./connect-review-pane.js";

const payload = {
  files: [{ path: "a.js", before: "one\n", after: "two\n" }],
};

/** @param {boolean} working */
function connect(working) {
  /** @type {Array<{ type?: string }>} */
  const commands = [];
  connectReviewPane({
    control: {
      loadReviewDrafts: async () => [],
      saveReviewDrafts: async (_id, drafts) => drafts,
      shadowHistoryFiles: async () => ({}),
      shadowHistoryFilePair: async () => ({}),
    },
    runtime: {
      request: async (/** @type {{ type?: string }} */ command) => {
        commands.push(command);
      },
      git: async () => ({ entries: [] }),
    },
    getTarget: () => ({ workspaceId: "w", sessionId: "s" }),
    getGitPanel: () => null,
    isWorking: () => working,
    hasCommand: () => false,
    randomId: () => "id",
    t: (key) => key,
  });
  return commands;
}

describe("connectReviewPane", () => {
  beforeEach(() => {
    document.body.replaceChildren();
    const center = document.createElement("div");
    document.body.append(center);
    setReviewDrafts(null);
    setReviewSend(null);
    setReviewPackageSend(null);
    ensureReviewHosts(center);
  });

  it("queues the whole review as a follow-up while Pi is working", async () => {
    const commands = connect(true);
    openReview(payload);
    await Promise.resolve();
    reviewPaneElement()
      ?.querySelector(".spopi-review-comment")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const note = /** @type {HTMLTextAreaElement} */ (
      reviewPaneElement()?.querySelector(".review-comment-note")
    );
    note.value = "later";
    reviewPaneElement()
      ?.querySelector("[data-i18n='review.comments.addToReview']")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    reviewPaneElement()
      ?.querySelector(".review-drafts-send")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await vi.waitFor(() => expect(commands).toHaveLength(1));
    expect(commands[0]?.type).toBe("follow_up");
  });

  it("sends the review at once when Pi is idle", async () => {
    const commands = connect(false);
    openReview(payload);
    await Promise.resolve();
    reviewPaneElement()
      ?.querySelector(".spopi-review-comment")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    reviewPaneElement()
      ?.querySelector("[data-i18n='review.comments.addToReview']")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    reviewPaneElement()
      ?.querySelector(".review-drafts-send")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await vi.waitFor(() => expect(commands[0]?.type).toBe("prompt"));
  });
});
