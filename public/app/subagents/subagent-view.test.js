// ABOUTME: Tests a subagent's transcript tab: inspect requests, replies, steer, stop, and stepping aside.
// ABOUTME: pi-subagents is faked by capturing the slash commands the tab sends.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { centerSubagentOpen } from "../editor/center-mode.js";
import { leadTab, leaveLeadTab } from "../editor/lead-tab.js";
import {
  applySubagentInspect,
  configureSubagentView,
  ensureSubagentHost,
  noteSubagentRuns,
  openSubagent,
  paintSubagent,
  resetSubagentView,
  subagentPaneElement,
} from "./subagent-view.js";

/** @type {string[]} */
let sent = [];
const node = (/** @type {Record<string, unknown>} */ fields = {}) => ({
  id: "run-1",
  label: "scout",
  state: "running",
  startedAt: 1_000,
  children: [],
  ...fields,
});

beforeEach(() => {
  resetSubagentView();
  document.body.replaceChildren();
  const center = document.createElement("div");
  document.body.append(center);
  ensureSubagentHost(center);
  sent = [];
  configureSubagentView({ run: (command) => sent.push(command), t: (key) => key });
});

/** @param {Record<string, unknown>} fields */
function reply(fields) {
  const id = sent.at(-1)?.split(" ")[1] || "";
  applySubagentInspect({ requestId: id, messages: [], ...fields });
  paintSubagent();
}

describe("subagent view", () => {
  it("opens as a tab in front and asks pi-subagents for the child's conversation", () => {
    openSubagent({ runId: "run-1", childId: "step:0", node: node() });
    expect(centerSubagentOpen()).toBe(true);
    expect(leadTab("subagent")).toMatchObject({ label: "scout", icon: "bot", active: true });
    expect(sent[0]).toMatch(/^\/subagents-inspect-rpc spopi\d+ run-1 step:0 --lines 100$/);
    paintSubagent();
    expect(subagentPaneElement()?.textContent).toContain("subagents.loading");
  });

  it("renders the task, messages, and result from the matching reply only", () => {
    openSubagent({ runId: "run-1", childId: "step:0", node: node() });
    applySubagentInspect({ requestId: "someone-else", messages: [] });
    paintSubagent();
    expect(subagentPaneElement()?.textContent).toContain("subagents.loading");
    reply({
      task: "List the files, then say which exports todo.js has.",
      messages: [
        { role: "user", kind: "text", text: "List the files, then say whi…" },
        { role: "assistant", kind: "toolCall", text: "[tool: bash]", name: "bash" },
        { role: "toolResult", kind: "text", text: "./todo.js\n./README.md" },
        { role: "assistant", kind: "text", text: "Single-file repo." },
      ],
      finalOutput: "Found todo.js",
    });
    const pane = subagentPaneElement();
    expect(pane?.querySelector(".subagent-task")?.textContent).toContain("List the files");
    expect(pane?.querySelector(".subagent-msg.is-user")).toBeNull();
    expect(pane?.querySelector(".subagent-msg.is-tool")?.textContent).toBe("bash");
    expect(pane?.querySelector(".subagent-msg.is-result summary")?.textContent).toBe("./todo.js");
    expect(pane?.querySelector(".subagent-final")?.textContent).toContain("Found todo.js");
  });

  it("steers and stops the run while it is live, then hides the steer box once it ends", () => {
    openSubagent({ runId: "run-1", childId: "step:0", node: node() });
    reply({ messages: [] });
    const pane = subagentPaneElement();
    const input = /** @type {HTMLInputElement} */ (pane?.querySelector(".subagent-steer-input"));
    input.value = "also check auth";
    pane
      ?.querySelector(".subagent-steer")
      ?.dispatchEvent(new Event("submit", { cancelable: true }));
    expect(sent).toContain("/subagents-steer run-1 also check auth");
    pane?.querySelector(".subagent-view-stop")?.dispatchEvent(new MouseEvent("click"));
    expect(sent).toContain("/subagents-stop run-1");

    const before = sent.length;
    noteSubagentRuns([node({ state: "complete", endedAt: 5000 })]);
    expect(sent.length).toBe(before + 1);
    expect(sent.at(-1)).toMatch(/^\/subagents-inspect-rpc /);
    const form = /** @type {HTMLElement} */ (pane?.querySelector(".subagent-steer"));
    expect(form.hidden).toBe(true);
    expect(pane?.querySelector(".subagent-view-stop")).toBeNull();
  });

  it("steps aside for a file and closes from its tab", () => {
    openSubagent({ runId: "run-1", childId: "step:0", node: node() });
    leaveLeadTab();
    expect(centerSubagentOpen()).toBe(false);
    expect(leadTab("subagent")?.active).toBe(false);
    leadTab("subagent")?.onSelect();
    expect(centerSubagentOpen()).toBe(true);
    leadTab("subagent")?.onClose();
    expect(leadTab("subagent")).toBeNull();
    expect(centerSubagentOpen()).toBe(false);
  });

  it("keeps a typed steer message when a new snapshot arrives", () => {
    openSubagent({ runId: "run-1", childId: "step:0", node: node() });
    reply({ messages: [] });
    const input = /** @type {HTMLInputElement} */ (
      subagentPaneElement()?.querySelector(".subagent-steer-input")
    );
    input.value = "half typed";
    noteSubagentRuns([node({ toolCount: 4 })]);
    paintSubagent();
    const after = /** @type {HTMLInputElement} */ (
      subagentPaneElement()?.querySelector(".subagent-steer-input")
    );
    expect(after.value).toBe("half typed");
    vi.clearAllTimers();
  });
});
