// ABOUTME: Quiet turn rendering collapses several tool calls into one work row.
// ABOUTME: The Review button is present when the turn changed a file.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { emptyTranscriptState, reduceTranscript } from "./transcript-reducer.js";
import {
  chatChangedPaths,
  forgetChangedPaths,
  mountReviewCard,
  mountTurnBlock,
  paintExtensionNotice,
} from "./turn-block.js";

const dir = dirname(fileURLToPath(import.meta.url));

function replay(name) {
  const events = JSON.parse(readFileSync(join(dir, "fixtures", name), "utf8"));
  return events.reduce((state, event) => reduceTranscript(state, event), emptyTranscriptState());
}

describe("mountTurnBlock", () => {
  it("renders TOOL:multi as one work row", () => {
    const state = replay("tool-multi.json");
    const root = document.createElement("div");
    mountTurnBlock(root, { turn: state.transcript.turns[0], messages: state.transcript.messages });
    const rows = root.querySelectorAll(".turn-block-work-row");
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toBe("Worked for 1s · read 2 files · ran 1 command");
    expect(root.querySelector(".turn-block-answer")?.textContent).toBe("Work done.");
    expect(root.querySelector(".turn-block-review")).toBeNull();
  });

  it("renders a changed-files review button for TOOL:write", () => {
    const state = replay("tool-write.json");
    const root = document.createElement("div");
    let reviewed = 0;
    mountTurnBlock(root, {
      turn: state.transcript.turns[0],
      messages: state.transcript.messages,
      onReview: () => {
        reviewed += 1;
      },
    });
    const button = root.querySelector(".turn-block-review");
    expect(button?.textContent).toContain("Changed 1 file");
    button?.dispatchEvent(new MouseEvent("click"));
    expect(reviewed).toBe(1);
  });
});

describe("mountReviewCard", () => {
  it("replaces an earlier card for the same prompt", () => {
    const root = document.createElement("div");
    const turn = { files: [{ path: "a.js", add: 1, del: 0 }], userEntryId: "u1" };
    mountReviewCard(root, turn, (key) => key);
    mountReviewCard(
      root,
      { files: [{ path: "a.js", add: 3, del: 1 }], userEntryId: "u1" },
      (key) => key,
    );
    const cards = root.querySelectorAll(".turn-block-review");
    expect(cards).toHaveLength(1);
    expect(cards[0].textContent).toContain("Changed 1 file");
    expect(/** @type {HTMLElement} */ (cards[0]).dataset.reviewKey).toBe("turn:u1");
  });

  it("re-keys a pending card once the prompt id is known", () => {
    const root = document.createElement("div");
    const files = [{ path: "a.js", add: 2, del: 0 }];
    mountReviewCard(
      root,
      { files, key: "turn:pending-0", pendingKey: "turn:pending-0" },
      (key) => key,
    );
    mountReviewCard(
      root,
      { files, userEntryId: "u9", key: "turn:u9", pendingKey: "turn:pending-0" },
      (key) => key,
    );
    const cards = root.querySelectorAll(".turn-block-review");
    expect(cards).toHaveLength(1);
    expect(/** @type {HTMLElement} */ (cards[0]).dataset.reviewKey).toBe("turn:u9");
    expect(cards[0].textContent).toContain("Changed 1 file");
  });

  it("remembers every card's paths for Session until the chat is rebuilt", () => {
    forgetChangedPaths();
    const root = document.createElement("div");
    const t = (/** @type {string} */ key) => key;
    mountReviewCard(root, { files: [{ path: "a.js", add: 1, del: 0 }], userEntryId: "u1" }, t);
    mountReviewCard(
      root,
      { files: [{ path: "D:/ui/user.css", add: 2, del: 0 }], userEntryId: "u2" },
      t,
    );
    mountReviewCard(root, { files: [{ path: "a.js", add: 1, del: 1 }], userEntryId: "u1" }, t);
    expect(chatChangedPaths().sort()).toEqual(["D:/ui/user.css", "a.js"]);
    forgetChangedPaths();
    expect(chatChangedPaths()).toEqual([]);
  });
});

describe("paintExtensionNotice", () => {
  it("maps info, warning, and error onto the muted turn notice", () => {
    const root = document.createElement("div");
    const turn = document.createElement("div");
    turn.className = "turn-block";
    root.append(turn);
    paintExtensionNotice(root, { message: "saved", notifyType: "warning" });
    paintExtensionNotice(root, { message: "failed", severity: "error" });
    paintExtensionNotice(root, { message: "note" });
    const lines = turn.querySelectorAll(".turn-block-notice");
    expect(lines).toHaveLength(3);
    expect(root.querySelector(".system-message")).toBeNull();
    expect(lines[0].dataset.severity).toBe("warning");
    expect(lines[1].dataset.severity).toBe("error");
    expect(lines[2].dataset.severity).toBe("info");
    expect(lines[0].textContent).toBe("saved");
  });
});
