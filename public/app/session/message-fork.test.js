// ABOUTME: Tests mountMessageForkHandler.
// ABOUTME: Includes "forks from the nth user bubble when the event has no entry id, then adopts".
import { beforeEach, describe, expect, it, vi } from "vitest";
import { editMessage, forkMessage } from "../chat/message-actions.js";
import { mountMessageForkHandler } from "./message-fork.js";

const target = { workspaceId: "w", sessionId: "s1", instanceId: "i" };

function mount({ forkText = "second prompt", lifecycle = "idle" } = {}) {
  document.body.innerHTML = `
    <div id="messages">
      <div class="message user"><button class="a"></button></div>
      <div class="message user"><button class="b"></button></div>
    </div>
    <textarea id="message-input"></textarea>`;
  const messagesElement = document.getElementById("messages");
  const input = document.getElementById("message-input");
  const calls = [];
  const runtime = {
    request: vi.fn(async (command) => {
      calls.push(command.type);
      if (command.type === "get_fork_messages") {
        return {
          response: {
            data: {
              messages: [
                { entryId: "e1", text: "first" },
                { entryId: "e2", text: "second" },
              ],
            },
          },
        };
      }
      if (command.type === "fork") return { response: { data: { text: forkText } } };
      return { response: { success: true } };
    }),
  };
  const deps = {
    messagesElement,
    getStore: () => ({ lifecycle }),
    getTarget: () => target,
    runtime,
    randomId: () => "key",
    showError: vi.fn(),
    t: (key) => key,
    getDiskHistoryFallback: () => null,
    setDiskHistoryFallback: vi.fn(),
    hydrateSnapshotOnce: vi.fn(async () => {}),
    adoptForkedSession: vi.fn(async () => {}),
    navigateTree: vi.fn(async () => {}),
    input,
    composerAutoResize: { sync: vi.fn() },
  };
  mountMessageForkHandler(deps);
  return { ...deps, calls, input, messagesElement };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("mountMessageForkHandler", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("forks from the nth user bubble when the event has no entry id, then adopts", async () => {
    const m = mount();
    forkMessage({ entryId: null, messageEl: m.messagesElement.querySelector(".b") });
    await flush();
    await flush();
    expect(m.calls).toEqual(["get_fork_messages", "fork"]);
    expect(m.runtime.request.mock.calls[1][0]).toEqual({ type: "fork", entryId: "e2" });
    expect(m.adoptForkedSession).toHaveBeenCalledWith({ fromSessionId: "s1" });
    expect(m.input.value).toBe("second prompt");
  });

  it("edit resolves the entry id the same way and rewinds this session", async () => {
    const m = mount();
    editMessage({
      entryId: null,
      text: "edited draft",
      messageEl: m.messagesElement.querySelector(".a"),
    });
    await flush();
    await flush();
    expect(m.calls).toEqual(["get_fork_messages"]);
    expect(m.navigateTree).toHaveBeenCalledWith("e1");
    expect(m.input.value).toBe("edited draft");
    expect(m.adoptForkedSession).not.toHaveBeenCalled();
  });

  it("refuses both actions while the agent is working", async () => {
    const m = mount({ lifecycle: "working" });
    const el = m.messagesElement.querySelector(".a");
    forkMessage({ messageEl: el });
    editMessage({ messageEl: el });
    await flush();
    expect(m.calls).toEqual([]);
    expect(m.showError).toHaveBeenCalledTimes(2);
  });
});
