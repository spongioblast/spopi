// ABOUTME: Tests for the enabled-only Terminal Panel: lazy first creation, remote
// ABOUTME: gating, height clamping, close-risk reporting, and DOM teardown.
import { afterEach, expect, test, vi } from "vitest";
import { TerminalPanel } from "./terminal-panel.js";

// Tests assert aria-labels against the i18n key (fallback form), so stub
// i18n to return the key itself and avoid missing-key console warns.
vi.mock("./i18n.js", () => ({ t: (key) => key }));

function mountedPanel(opts = {}) {
  const client = opts.client || { create: vi.fn(), closeAll: vi.fn(), checkpointAll: vi.fn() };
  const panel = new TerminalPanel({
    enabled: opts.enabled !== undefined ? opts.enabled : true,
    client,
    subscribeLocale: opts.subscribeLocale,
    getAvailableHeight: opts.getAvailableHeight || (() => opts.availableHeight || 800),
    getFullscreenBounds: opts.getFullscreenBounds,
  });
  panel.mount({ toggleContainer: document.body, panelContainer: document.body });
  return { panel, client };
}

afterEach(() => {
  document.body.textContent = "";
});

test("expand retries create when the first spawn ran before the host connected", async () => {
  const create = vi.fn().mockRejectedValueOnce(new Error("disconnected")).mockResolvedValueOnce({});
  const { panel } = mountedPanel({ client: { create } });
  await panel.expand();
  expect(create).toHaveBeenCalledTimes(1);
  await panel.expand();
  expect(create).toHaveBeenCalledTimes(2);
});

test("repeated expands send one create until the host lists the tab", async () => {
  const create = vi.fn().mockResolvedValue({});
  const panel = new TerminalPanel({ enabled: true, docked: true, client: { create } });
  panel.mount({ toggleContainer: document.body, panelContainer: document.body });
  await panel.expand();
  panel.setTabs([]);
  await panel.expand();
  await panel.expand();
  expect(create).toHaveBeenCalledTimes(1);
  panel.setTabs([{ terminalId: "t1", generation: 1, label: "bash", status: "running" }]);
  panel.setTabs([]);
  await panel.expand();
  expect(create).toHaveBeenCalledTimes(2);
});

test("setTabs survives a profile-menu wrap around the new-tab button", () => {
  const panel = new TerminalPanel({ enabled: true, docked: true, client: { create: vi.fn() } });
  panel.mount({ toggleContainer: document.body, panelContainer: document.body });
  const plus = panel.tabBarEl.querySelector("[data-terminal-new-tab]");
  const group = document.createElement("div");
  group.className = "terminal-new-tab-group";
  plus.replaceWith(group);
  group.appendChild(plus);
  expect(() =>
    panel.setTabs([{ terminalId: "t1", generation: 1, label: "zsh", status: "running" }]),
  ).not.toThrow();
  expect(panel.tabBarEl.querySelectorAll(".terminal-tab")).toHaveLength(1);
  expect(panel.tabBarEl.querySelector(".terminal-new-tab-group")).toBeTruthy();
  expect(group.parentElement).toBe(panel.tabBarEl);
});

test("docked panel stacks instances beside the body and hides the list for one PTY", () => {
  const panel = new TerminalPanel({ enabled: true, docked: true, client: { create: vi.fn() } });
  panel.mount({ toggleContainer: document.body, panelContainer: document.body });
  expect(panel.root.classList.contains("docked")).toBe(true);
  expect(panel.tabBarEl.classList.contains("terminal-instances")).toBe(true);
  expect(panel.root.firstElementChild).toBe(panel.bodyEl);
  panel.setTabs([
    { terminalId: "t1", generation: 1, label: "one", profileId: "default", status: "running" },
  ]);
  expect(panel.tabBarEl.hidden).toBe(true);
  panel.setTabs([
    { terminalId: "t1", generation: 1, label: "one", profileId: "default", status: "running" },
    { terminalId: "t2", generation: 1, label: "two", profileId: "default", status: "running" },
  ]);
  expect(panel.tabBarEl.hidden).toBe(false);
  expect(panel.tabBarEl.querySelectorAll(".terminal-tab")).toHaveLength(2);
});

test("a terminal this client created becomes active once listed, and same shells are numbered", () => {
  const focusTab = vi.fn();
  const panel = new TerminalPanel({
    enabled: true,
    docked: true,
    client: { create: vi.fn(), focusTab, refitTab: vi.fn() },
  });
  panel.mount({ toggleContainer: document.body, panelContainer: document.body });
  const first = { terminalId: "t1", generation: 1, label: "Git Bash", status: "running" };
  panel.setTabs([first]);
  expect(panel.activeTerminalId).toBe("t1");
  panel.activateWhenListed("t2");
  panel.setTabs([first, { terminalId: "t2", generation: 1, label: "Git Bash", status: "running" }]);
  expect(panel.activeTerminalId).toBe("t2");
  expect(focusTab).toHaveBeenCalledWith("t2");
  const labels = [...panel.tabBarEl.querySelectorAll(".terminal-tab-label")].map(
    (el) => el.textContent,
  );
  expect(labels).toEqual(["Git Bash", "Git Bash 2"]);
  expect(panel.tabBarEl.querySelector(".terminal-tab.active")?.dataset.terminalId).toBe("t2");
});

test("send-to-chat button calls onSendToChat with the terminal id", () => {
  const onSendToChat = vi.fn();
  const panel = new TerminalPanel({
    enabled: true,
    docked: true,
    client: { create: vi.fn() },
    onSendToChat,
  });
  panel.mount({ toggleContainer: document.body, panelContainer: document.body });
  panel.setTabs([
    { terminalId: "t1", generation: 1, label: "Git Bash", status: "running" },
    { terminalId: "t2", generation: 1, label: "CMD", status: "running" },
  ]);
  const row = panel.tabBarEl.querySelector("[data-terminal-id='t2']");
  row.querySelector(".terminal-tab-send").click();
  expect(onSendToChat).toHaveBeenCalledWith("t2");
});

test("repeated start errors keep the same node instead of re-rendering it", () => {
  const { panel } = mountedPanel();
  panel.showStartError("global live terminal quota reached");
  const first = panel.bodyEl.querySelector("[data-terminal-start-error]");
  panel.showStartError("global live terminal quota reached");
  expect(panel.bodyEl.querySelector("[data-terminal-start-error]")).toBe(first);
  expect(panel.bodyEl.querySelectorAll("[data-terminal-start-error]")).toHaveLength(1);
});

test("first enabled expansion lazily creates one default tab", async () => {
  const { panel, client } = mountedPanel();
  expect(panel.toggleEl.classList.contains("panel-toggle-btn")).toBe(true);
  expect(panel.toggleEl.getAttribute("aria-label")).toBe("terminal.toggle");
  expect(panel.toggleEl.querySelector('rect[x="3.5"]')).not.toBeNull();
  expect(panel.toggleEl.querySelector('path[d="M7 15h10"]')).not.toBeNull();
  expect(panel.toggleEl.dataset.terminalCount).toBeUndefined();
  expect(panel.isExpanded()).toBe(false);
  await panel.expand();
  expect(client.create).toHaveBeenCalledWith("default");
});

test("remote client renders no toggle, panel, metadata, or activity", () => {
  mountedPanel({ enabled: false });
  expect(document.querySelector("[data-terminal-toggle]")).toBeNull();
  expect(document.querySelector("[data-terminal-panel]")).toBeNull();
});

test("resizer clamps to 160px minimum and 70 percent maximum", () => {
  const { panel } = mountedPanel({ availableHeight: 1000 });
  expect(panel.setHeight(10)).toBe(160);
  expect(panel.setHeight(900)).toBe(700);
  expect(panel.setHeight(400)).toBe(400);
});

test("enlarged terminal uses chat panel bounds instead of covering the sidebar", () => {
  const { panel } = mountedPanel({
    client: { refitAll: vi.fn() },
    getFullscreenBounds: () => ({ left: 272, top: 36, right: 320 }),
  });

  panel.toggleEnlarge();

  expect(panel.root.classList.contains("enlarged")).toBe(true);
  expect(panel.root.dataset.fullscreenScope).toBe("chat");
  expect(panel.root.style.getPropertyValue("--terminal-fullscreen-left")).toBe("272px");
  expect(panel.root.style.getPropertyValue("--terminal-fullscreen-top")).toBe("36px");
  expect(panel.root.style.getPropertyValue("--terminal-fullscreen-right")).toBe("320px");
});

test("restoring enlarged terminal clears fullscreen bounds", () => {
  const { panel } = mountedPanel({
    client: { refitAll: vi.fn() },
    getFullscreenBounds: () => ({ left: 272, top: 36, right: 0 }),
  });

  panel.toggleEnlarge();
  panel.toggleEnlarge();

  expect(panel.root.classList.contains("enlarged")).toBe(false);
  expect(panel.root.dataset.fullscreenScope).toBeUndefined();
  expect(panel.root.style.getPropertyValue("--terminal-fullscreen-left")).toBe("");
  expect(panel.root.style.getPropertyValue("--terminal-fullscreen-top")).toBe("");
  expect(panel.root.style.getPropertyValue("--terminal-fullscreen-right")).toBe("");
});

test("resizing the panel refits the xterm viewport", () => {
  const refitAll = vi.fn();
  const { panel } = mountedPanel({ client: { refitAll } });

  panel.setHeight(360);

  expect(refitAll).toHaveBeenCalledTimes(1);
});

test("closing the final tab collapses the panel", async () => {
  const { panel } = mountedPanel();
  await panel.expand();

  panel.setTabs([]);

  expect(panel.isExpanded()).toBe(false);
  expect(panel.root.classList.contains("hidden")).toBe(true);
});

test("body resize refits xterm and destroy disconnects the observer", () => {
  const observer = { observe: vi.fn(), disconnect: vi.fn() };
  let resizeCallback;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback) {
        resizeCallback = callback;
        this.observe = observer.observe;
        this.disconnect = observer.disconnect;
      }
    },
  );
  const refitAll = vi.fn();
  const { panel } = mountedPanel({ client: { refitAll } });

  expect(observer.observe).toHaveBeenCalledWith(panel.bodyEl);
  resizeCallback();
  expect(refitAll).toHaveBeenCalledTimes(1);
  panel.destroy();
  expect(observer.disconnect).toHaveBeenCalledTimes(1);
  vi.unstubAllGlobals();
});

test("closing a running tab requires confirmation", async () => {
  const close = vi.fn();
  const host = document.createElement("div");
  host.id = "dialog-container";
  document.body.append(host);
  const { panel } = mountedPanel({ client: { close } });
  panel.setTabs([
    { terminalId: "t1", generation: 1, label: "zsh", profileId: "default", status: "running" },
  ]);

  panel.tabButtons.get("t1").querySelector(".terminal-tab-close").click();
  await vi.waitFor(() => {
    expect(document.querySelector("#dialog-container .dialog")).not.toBeNull();
  });
  expect(close).not.toHaveBeenCalled();
  document.querySelector("#dialog-container button").click();
  expect(close).not.toHaveBeenCalled();

  panel.tabButtons.get("t1").querySelector(".terminal-tab-close").click();
  await vi.waitFor(() => {
    expect(document.querySelector("#dialog-container .ui-button--primary")).not.toBeNull();
  });
  document.querySelector("#dialog-container .ui-button--primary").click();
  await vi.waitFor(() => expect(close).toHaveBeenCalledWith("t1", 1));
});

test("getCloseRisk reports only live terminals with stable labels", async () => {
  const { panel } = mountedPanel();
  await panel.expand();
  panel.setTabs([
    { terminalId: "t1", generation: 1, label: "zsh", profileId: "default", status: "running" },
    { terminalId: "t2", generation: 1, label: "gone", profileId: "default", status: "exited" },
  ]);
  const risk = panel.getCloseRisk();
  expect(risk.terminalTabs).toEqual([{ terminalId: "t1", label: "zsh" }]);
});

test("collapse retains the saved expanded height", async () => {
  const { panel } = mountedPanel({ availableHeight: 1000 });
  await panel.expand();
  panel.setHeight(300);
  panel.collapse();
  expect(panel.heightPx).toBe(300);
});

test("destroy removes toggle and panel from the DOM", async () => {
  const { panel } = mountedPanel();
  await panel.expand();
  panel.destroy();
  expect(document.querySelector("[data-terminal-toggle]")).toBeNull();
  expect(document.querySelector("[data-terminal-panel]")).toBeNull();
});

test("beforeWorkspaceTransition locks interaction and checkpoints", async () => {
  const checkpointAll = vi.fn(async () => {});
  const { panel } = mountedPanel({ client: { checkpointAll } });
  await panel.expand();
  await panel.beforeWorkspaceTransition();
  expect(checkpointAll).toHaveBeenCalledTimes(1);
  expect(panel.locked).toBe(true);
});

test("setInteractionLocked toggles the lock", () => {
  const { panel } = mountedPanel();
  panel.setInteractionLocked(true);
  expect(panel.locked).toBe(true);
  panel.setInteractionLocked(false);
  expect(panel.locked).toBe(false);
});

test("markActivity tracks background output and clearActivity resets it", () => {
  const dockTab = document.createElement("button");
  dockTab.className = "spopi-dock-tab";
  dockTab.dataset.dock = "terminal";
  document.body.appendChild(dockTab);
  const { panel } = mountedPanel();
  panel.setTabs([
    { terminalId: "t1", generation: 1, label: "zsh", profileId: "default", status: "running" },
  ]);
  expect(panel.getProjection()).toEqual({ count: 1, hasActivity: false });
  panel.markActivity("t1");
  expect(panel.getProjection()).toEqual({ count: 1, hasActivity: true });
  expect(panel.toggleEl.classList.contains("has-activity")).toBe(false);
  expect(panel.toggleEl.dataset.terminalCount).toBeUndefined();
  expect(dockTab.classList.contains("has-activity")).toBe(true);
  panel.clearActivity("t1");
  expect(panel.getProjection()).toEqual({ count: 1, hasActivity: false });
  expect(dockTab.classList.contains("has-activity")).toBe(false);
});

test("expand clears background activity", async () => {
  const { panel } = mountedPanel();
  panel.setTabs([
    { terminalId: "t1", generation: 1, label: "zsh", profileId: "default", status: "running" },
  ]);
  panel.markActivity("t1");
  expect(panel.getProjection().hasActivity).toBe(true);
  await panel.expand();
  expect(panel.getProjection().hasActivity).toBe(false);
});

test("beforeWorkspaceTransition checkpoints even when collapsed", async () => {
  const checkpointAll = vi.fn(async () => {});
  const { panel } = mountedPanel({ client: { checkpointAll } });
  expect(panel.isExpanded()).toBe(false);
  const ok = await panel.beforeWorkspaceTransition();
  expect(ok).toBe(true);
  expect(checkpointAll).toHaveBeenCalledTimes(1);
});

test("settleCloseRisk unlocks on cancel and closes every terminal on discard", async () => {
  const closeAll = vi.fn(async () => {});
  const { panel } = mountedPanel({ client: { closeAll } });

  panel.setInteractionLocked(true);
  await panel.settleCloseRisk("cancel");
  expect(panel.locked).toBe(false);
  expect(closeAll).not.toHaveBeenCalled();

  await panel.settleCloseRisk("discard");
  expect(panel.locked).toBe(true);
  expect(closeAll).toHaveBeenCalledTimes(1);
});

test("restored terminal metadata shows one restart notice and recreates tabs", async () => {
  const create = vi.fn(async () => {});
  const { panel } = mountedPanel({ client: { create } });
  panel.setTabs([
    {
      terminalId: "restored-1",
      generation: 0,
      label: "zsh",
      profileId: "bash",
      status: "restoredMetadata",
      running: true,
    },
  ]);

  await panel.expand();
  expect(create).toHaveBeenCalledWith("bash");
  expect(panel.bodyEl.querySelectorAll(".terminal-restart-notice")).toHaveLength(1);
  await panel.expand();
  expect(panel.bodyEl.querySelectorAll(".terminal-restart-notice")).toHaveLength(1);
});

test("pointer resizing persists the new height after the drag ends", () => {
  vi.useFakeTimers();
  const refitAll = vi.fn();
  const setPanelHeight = vi.fn();
  const { panel } = mountedPanel({ client: { refitAll, setPanelHeight } });
  panel.setHeight(300);
  panel._beginResize({ clientY: 500, preventDefault: vi.fn() });

  const move = new Event("pointermove");
  Object.defineProperty(move, "clientY", { value: 450 });
  window.dispatchEvent(move);
  expect(panel.heightPx).toBe(350);
  vi.advanceTimersByTime(100);

  window.dispatchEvent(new Event("pointerup"));
  expect(setPanelHeight).toHaveBeenCalledWith(350);
  expect(refitAll).toHaveBeenCalled();
  vi.useRealTimers();
});

test("keyboard resize and tab roving update the active terminal", () => {
  const refitTab = vi.fn();
  const focusTab = vi.fn();
  const { panel } = mountedPanel({ client: { refitTab, focusTab } });
  panel.setHeight(300);
  const preventResize = vi.fn();
  panel._keyboardResize({ key: "ArrowUp", shiftKey: false, preventDefault: preventResize });
  expect(panel.heightPx).toBe(320);
  expect(preventResize).toHaveBeenCalledTimes(1);

  panel.setTabs([
    { terminalId: "t1", generation: 1, label: "one", profileId: "default", status: "running" },
    { terminalId: "t2", generation: 1, label: "two", profileId: "default", status: "running" },
  ]);
  const preventRove = vi.fn();
  panel._tabKeydown({ key: "ArrowRight", preventDefault: preventRove }, "t1");
  expect(panel.activeTerminalId).toBe("t2");
  expect(refitTab).toHaveBeenCalledWith("t2");
  expect(focusTab).toHaveBeenCalledWith("t2");
  expect(preventRove).toHaveBeenCalledTimes(1);
});

test("failed tab metadata shows the host error inside the panel", () => {
  const { panel } = mountedPanel();
  panel.setTabs([
    {
      terminalId: "t-fail",
      generation: 1,
      label: "Terminal",
      profileId: "default",
      status: "failed",
      failReason: "Git for Windows was not found.",
    },
  ]);
  const errorEl = panel.bodyEl.querySelector("[data-terminal-start-error]");
  expect(errorEl).not.toBeNull();
  expect(errorEl.textContent).toBe("Git for Windows was not found.");
  expect(errorEl.getAttribute("role")).toBe("alert");
});

test("running tabs clear a previous start error", () => {
  const { panel } = mountedPanel();
  panel.showStartError("spawn failed");
  panel.setTabs([
    { terminalId: "t1", generation: 1, label: "zsh", profileId: "default", status: "running" },
  ]);
  expect(panel.bodyEl.querySelector("[data-terminal-start-error]")).toBeNull();
});
