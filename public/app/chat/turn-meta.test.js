// ABOUTME: Tests userTurnActions.
// ABOUTME: Includes "exposes Restore and Fork; Fork is Pi".
import { describe, expect, it } from "vitest";
import { setMessageActionDispatch } from "./message-actions.js";
import {
  appendAssistantTurnMeta,
  appendUserTurnActions,
  assistantTurnMeta,
  shouldHideTurnMeta,
  userTurnActions,
} from "./turn-meta.js";

describe("userTurnActions", () => {
  it("exposes Restore and Fork; Fork is Pi's fork, not /tree", () => {
    const actions = userTurnActions();
    expect(actions.map((item) => item.id)).toEqual(["restore", "fork"]);
    expect(actions[0].command).toBe("/undo");
    expect(actions[1].command).toBeUndefined();
    expect(actions[1].type).toBe("message.fork");
  });
});

describe("assistantTurnMeta", () => {
  it("formats Tier 0 chips", () => {
    const meta = assistantTurnMeta({
      ttftMs: 210,
      cacheHit: true,
      outputTokens: 80,
      tokensPerSec: 120.4,
      model: "vllm:qwen",
    });
    expect(meta.ttft).toBe("210 ms");
    expect(meta.cache).toBe("cache hit");
    expect(meta.tps).toBe("120.4 t/s");
  });

  it("reads the cache state from Pi's usage for any provider", () => {
    expect(assistantTurnMeta({ cacheHit: false }).cache).toBe("cache miss");
    expect(assistantTurnMeta({}).cache).toBe("cache: —");
  });
});

describe("append turn meta", () => {
  it("writes assistant chips and user Restore/Fork", () => {
    const assistant = document.createElement("div");
    appendAssistantTurnMeta(assistant, { ttftMs: 200, cacheHit: true, outputTokens: 3 });
    expect(assistant.querySelector(".turn-meta")?.textContent).toContain("cache hit");
    const user = document.createElement("div");
    appendUserTurnActions(user);
    expect([...user.querySelectorAll("button")].map((node) => node.textContent)).toEqual([
      "restore",
      "fork",
    ]);
  });

  it("restore sends /undo; fork raises message.fork instead of a slash command", () => {
    const user = document.createElement("div");
    user.className = "message user";
    user.dataset.entryId = "u-9";
    document.body.appendChild(user);
    const sent = [];
    const forks = [];
    const unbind = setMessageActionDispatch((action) => {
      if (action.type === "message.fork") forks.push(action);
    });
    appendUserTurnActions(user, (command) => sent.push(command));
    const [restore, fork] = user.querySelectorAll("button");
    restore.click();
    fork.click();
    unbind();
    expect(sent).toEqual(["/undo"]);
    expect(forks).toEqual([{ type: "message.fork", entryId: "u-9", text: "", messageEl: user }]);
    user.remove();
  });
});

describe("shouldHideTurnMeta", () => {
  it("hides below the 380px chat column", () => {
    expect(shouldHideTurnMeta(360)).toBe(true);
    expect(shouldHideTurnMeta(420)).toBe(false);
  });
});
