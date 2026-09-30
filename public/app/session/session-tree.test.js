// ABOUTME: Tests buildSessionTree.
// ABOUTME: Includes "linear session renders one flat active path without branch indentation".
// ABOUTME: Unit tests for the session-tree projection model (Info panel).
import { describe, expect, test } from "vitest";
import { branchLeafIds, buildSessionTree, messageText } from "./session-tree.js";

/** Shorthand builders for compact fixtures. */
function u(id, parentId, content, extra = {}) {
  return {
    type: "message",
    id,
    parentId,
    timestamp: `2026-08-21T10:00:0${id.length}.000Z`,
    message: { role: "user", content, ...extra },
  };
}
function a(id, parentId, content, stopReason) {
  return {
    type: "message",
    id,
    parentId,
    timestamp: `2026-08-21T10:00:0${id.length}.000Z`,
    message: { role: "assistant", content: [{ type: "text", text: content }], stopReason },
  };
}
const ids = (rows) =>
  rows
    .filter((r) => r.kind === "node")
    .map((r) => `${r.entryId}${r.isActive ? "*" : ""}${r.isCurrentLeaf ? "!" : ""}`);
const branchIds = (rows) => rows.filter((r) => r.kind === "branch").map((r) => r.entryId);

describe("buildSessionTree", () => {
  test("linear session renders one flat active path without branch indentation", () => {
    const { rows, activePathIds } = buildSessionTree({
      entries: [u("u1", null, "First"), a("a1", "u1", "Answer one"), u("u2", "a1", "Second")],
      leafId: "u2",
    });
    expect(ids(rows)).toEqual(["u1*", "a1*", "u2*!"]);
    expect(rows.map((r) => r.depth)).toEqual([0, 0, 0]);
    expect(activePathIds.has("a1")).toBe(true);
    expect(branchIds(rows)).toEqual([]);
  });

  test("sibling branch collapses into an inactive summary with turn count", () => {
    const entries = [
      u("u1", null, "JWT or cookie?"),
      a("a1", "u1", "Recommendation"),
      u("jwt", "a1", "Implement JWT"),
      a("jwtA", "jwt", "JWT done"),
      u("cookie", "a1", "Implement cookie"),
      a("cookieA", "cookie", "Cookie done"),
      u("csrf", "cookieA", "Add CSRF"),
      a("csrfA", "csrf", "CSRF done"),
    ];
    const { rows } = buildSessionTree({ entries, leafId: "jwtA" });
    expect(ids(rows)).toEqual(["u1*", "a1*", "jwt*", "jwtA*!"]);
    expect(branchIds(rows)).toEqual(["cookie"]);
    const branch = rows.find((r) => r.kind === "branch");
    expect(branch.turnCount).toBe(2); // "Implement cookie" + "Add CSRF"
    expect(branch.rows.map((r) => r.isActive)).toEqual([false, false, false, false]);
    expect(branch.rows.map((r) => r.entryId)).toEqual(["cookie", "cookieA", "csrf", "csrfA"]);
  });

  test("hidden entries are bridged, not rendered", () => {
    const entries = [
      u("u1", null, "Question"),
      {
        type: "message",
        id: "tr1",
        parentId: "u1",
        message: { role: "toolResult", toolCallId: "c1", content: [] },
      },
      { type: "model_change", id: "mc1", parentId: "tr1" },
      a("a1", "mc1", "Answer"),
    ];
    const { rows } = buildSessionTree({ entries, leafId: "a1" });
    expect(ids(rows)).toEqual(["u1*", "a1*!"]); // a1 stays depth 1 despite hidden chain
    expect(rows[1].depth).toBe(0);
  });

  test("pure-tool assistant hides; error and aborted assistants render as status nodes", () => {
    const entries = [
      u("u1", null, "Run tests"),
      a("tools", "u1", "", "stop"), // tool-only, no text → hidden
      a("boom", "tools", "", "error"),
      a("cut", "boom", "", "aborted"),
      a("ok", "cut", "Recovered"),
    ];
    const { rows } = buildSessionTree({ entries, leafId: "ok" });
    const nodes = rows.filter((r) => r.kind === "node");
    expect(nodes.map((r) => r.entryId)).toEqual(["u1", "boom", "cut", "ok"]);
    const boom = nodes.find((r) => r.entryId === "boom");
    expect(boom.statusOnly).toBe(true);
    expect(boom.stopReason).toBe("error");
    expect(boom.previewText).toBe("");
  });

  test("hides intermediate assistant process messages while keeping final answer", () => {
    const entries = [
      u("u1", null, "Run the migration"),
      a("process", "u1", "I will inspect the schema first."),
      {
        type: "message",
        id: "tool",
        parentId: "process",
        message: { role: "toolResult", content: [] },
      },
      a("answer", "tool", "Migration completed."),
    ];
    const { rows } = buildSessionTree({ entries, leafId: "answer" });
    expect(ids(rows)).toEqual(["u1*", "answer*!"]);
  });

  test("fork user child between intermediate and final text assistants hides the intermediate", () => {
    // Regression: a visible user child used to `break` the sibling scan, so
    // child order decided whether aMid leaked into the tree as a final
    // assistant. Both orders must render u1*, aFinal* with the fork branch
    // collapsed and no aMid row.
    for (const entries of [
      [
        u("u1", null, "Q"),
        a("aMid", "u1", "Mid"),
        a("aFinal", "aMid", "Final"),
        u("uFork", "aMid", "Fork"),
      ],
      [
        u("u1", null, "Q"),
        a("aMid", "u1", "Mid"),
        u("uFork", "aMid", "Fork"),
        a("aFinal", "aMid", "Final"),
      ],
    ]) {
      const { rows } = buildSessionTree({ entries, leafId: "aFinal" });
      expect(ids(rows)).toEqual(["u1*", "aFinal*!"]);
      expect(branchIds(rows)).toEqual(["uFork"]);
      expect(rows.some((r) => r.entryId === "aMid")).toBe(false);
    }
  });

  test("image-only user message stays visible with hasImages", () => {
    const entries = [
      {
        type: "message",
        id: "u1",
        parentId: null,
        message: { role: "user", content: [{ type: "image", source: {} }] },
      },
      a("a1", "u1", "Seen"),
    ];
    const { rows } = buildSessionTree({ entries, leafId: "a1" });
    expect(rows[0].hasImages).toBe(true);
    expect(rows[0].previewText).toBe("");
  });

  test("preview uses first non-empty line and caps length", () => {
    const long = "x".repeat(300);
    const entries = [
      u("u1", null, `\n\n  hello world  \nsecond line ${long}`),
      a("a1", "u1", "answer"),
    ];
    const { rows } = buildSessionTree({ entries, leafId: "a1" });
    expect(rows[0].previewText).toBe("hello world");
    const capped = buildSessionTree({
      entries: [u("u1", null, long), a("a1", "u1", "x")],
      leafId: "a1",
    });
    expect(capped.rows[0].previewText.length).toBe(200);
  });

  test("orphaned entries render as top-level branches", () => {
    const entries = [
      u("u1", null, "Root"),
      a("a1", "u1", "Answer"),
      u("ghost", "missing", "Orphan"),
    ];
    const { rows } = buildSessionTree({ entries, leafId: "a1" });
    expect(ids(rows)).toEqual(["u1*", "a1*!"]);
    expect(branchIds(rows)).toEqual(["ghost"]);
  });

  test("null or unknown leafId leaves everything inactive but resumable", () => {
    const entries = [u("u1", null, "One"), a("a1", "u1", "Two")];
    for (const leafId of [null, undefined, "nope"]) {
      const { rows } = buildSessionTree({ entries, leafId });
      expect(rows.every((r) => !r.isActive)).toBe(true);
      expect(rows[0].kind).toBe("branch");
    }
  });

  test("nested branch inside an inactive subtree stays its own collapsed summary", () => {
    const entries = [
      u("u1", null, "Q"),
      a("a1", "u1", "A"),
      u("main", "a1", "Main path"),
      u("alt", "a1", "Alt path"),
      u("altSub", "alt", "Alt sub-branch"),
      a("altSubA", "altSub", "Sub answer"),
      a("altA", "alt", "Alt answer"),
    ];
    const { rows } = buildSessionTree({ entries, leafId: "main" });
    expect(branchIds(rows)).toEqual(["alt"]);
    const alt = rows.find((r) => r.kind === "branch");
    // alt subtree: head "alt", then nested branch (altSub…) then leaf "altA"
    expect(alt.rows.map((r) => `${r.kind}:${r.entryId}`)).toEqual([
      "node:alt",
      "branch:altSub",
      "node:altA",
    ]);
    expect(alt.turnCount).toBe(2);
  });

  test("cycle in parentId chain does not hang", () => {
    const entries = [u("u1", "u2", "Loop A"), u("u2", "u1", "Loop B")];
    // Both entries have in-index parents, so neither is a root: nothing is
    // renderable. The assertion's value is termination without throwing.
    const { rows } = buildSessionTree({ entries, leafId: "u1" });
    expect(rows).toEqual([]);
  });

  test("empty or malformed input yields an empty model", () => {
    expect(buildSessionTree().rows).toEqual([]);
    expect(buildSessionTree({ entries: [], leafId: null }).rows).toEqual([]);
    expect(buildSessionTree({ entries: [null, { type: "message" }], leafId: null }).rows).toEqual(
      [],
    );
  });

  test("toolResult / thinking / bookkeeping entries never render", () => {
    const entries = [
      u("u1", null, "Q"),
      { type: "compaction", id: "c1", parentId: "u1" },
      { type: "branch_summary", id: "bs1", parentId: "c1" },
      { type: "custom", id: "x1", parentId: "bs1" },
      a("a1", "x1", "A"),
    ];
    const { rows } = buildSessionTree({ entries, leafId: "a1" });
    expect(ids(rows)).toEqual(["u1*", "a1*!"]);
  });
});

describe("branchLeafIds", () => {
  test("collects only full-tree leaves inside the branch", () => {
    const entries = [
      u("u1", null, "Q"),
      a("a1", "u1", "A"),
      u("main", "a1", "Main"),
      u("alt", "a1", "Alt"),
      u("altSub", "alt", "Nested"),
      a("altSubA", "altSub", "Nested A"),
      a("altA", "alt", "Alt A"),
    ];
    const { rows } = buildSessionTree({ entries, leafId: "main" });
    const alt = rows.find((r) => r.kind === "branch");
    expect(branchLeafIds(alt)).toEqual(["altSubA", "altA"]);
  });

  test("returns [] for node rows and malformed input", () => {
    expect(branchLeafIds({ kind: "node" })).toEqual([]);
    expect(branchLeafIds(null)).toEqual([]);
  });
});

describe("messageText", () => {
  test("handles string, block array, and invalid shapes", () => {
    expect(messageText("plain")).toBe("plain");
    expect(
      messageText([{ type: "text", text: "a" }, { type: "image" }, { type: "text", text: "b" }]),
    ).toBe("ab");
    expect(messageText(null)).toBe("");
    expect(messageText(42)).toBe("");
  });
});
