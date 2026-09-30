// ABOUTME: Maps a workspace file to a shell command and writes it to a live PTY.
// ABOUTME: Never sends a chat prompt; Agent/virtual tabs are not used as targets.

import { defaultTerminalProfile } from "../dock/terminal-profile-menu.js";
import { shellShowsText, waitForShellPrompt } from "./open-in-terminal.js";

const LABELS = {
  python: "Python",
  node: "Node",
  bun: "Bun",
  bash: "Bash",
  powershell: "PowerShell",
  cmd: "Command Prompt",
  go: "Go",
};

/**
 * @typedef {{
 *   platform?: string,
 * }} RunCommandForFileOptions
 *
 * @typedef {{
 *   command: string,
 *   label: string,
 * }} RunCommandSpec
 *
 * @typedef {{
 *   lastAppliedSequence?: number,
 *   generation?: number,
 * }} TerminalTabEntry
 *
 * @typedef {{
 *   type?: string,
 *   terminalId?: string,
 * }} TerminalMessage
 *
 * @typedef {{
 *   tabs?: Map<string, TerminalTabEntry>,
 *   command?: (message: Record<string, unknown>) => void,
 *   sendAndAwait?: (
 *     message: Record<string, unknown>,
 *     predicate: (message: TerminalMessage) => boolean,
 *   ) => Promise<TerminalMessage | null | undefined>,
 * }} TerminalClientLike
 *
 * @typedef {{
 *   wrote: boolean,
 *   command?: string,
 *   terminalId?: string | null,
 * }} WriteCommandResult
 *
 * @typedef {{
 *   status?: string,
 *   terminalId?: string | null,
 * }} PanelTab
 *
 * @typedef {{
 *   tabs?: PanelTab[],
 *   activeTerminalId?: string | null,
 *   setActiveTerminalId?: (terminalId: string) => void,
 * }} TerminalPanelLike
 *
 * @typedef {{
 *   dock?: { setTab?: (name: string) => void },
 *   shell?: { applyHidden?: (state: { dockHidden?: boolean }) => void },
 * }} WorkbenchLike
 *
 * @typedef {{
 *   client?: TerminalClientLike | null,
 *   panel?: TerminalPanelLike | null,
 *   workbench?: WorkbenchLike | null,
 *   path?: unknown,
 *   getDefaultProfile?: (() => unknown) | null,
 * }} RunFileInTerminalOptions
 *
 * @typedef {{
 *   querySelector: (
 *     selectors: string,
 *   ) => { getAttribute: (name: string) => string | null } | null,
 * }} PreviewDocLike
 *
 * @typedef {{
 *   hidden: boolean,
 *   title: string,
 *   setAttribute: (name: string, value: string) => void,
 *   addEventListener: (type: string, listener: () => void) => void,
 *   ownerDocument?: {
 *     getElementById?: (id: string) => {
 *       addEventListener: (type: string, listener: () => void) => void,
 *     } | null,
 *   } | null,
 * }} RunFileButtonLike
 *
 * @typedef {{
 *   button?: RunFileButtonLike | null,
 *   getActivePath?: (() => string | null | undefined) | null,
 *   run?: ((path: string) => unknown) | null,
 *   t?: (key: string, vars?: { label?: string }) => string,
 * }} MountRunFileButtonOptions
 */

/**
 * @param {unknown} relativePath
 * @param {RunCommandForFileOptions} [options]
 * @returns {RunCommandSpec | null}
 */
export function runCommandForFile(relativePath, { platform } = {}) {
  const path = String(relativePath || "")
    .trim()
    .replace(/\\/g, "/");
  if (!path) return null;
  const leaf = path.split(".").pop() || "";
  const ext = path.includes(".") ? `.${leaf.toLowerCase()}` : "";
  const quoted = `"${path}"`;
  const os = platform || (typeof navigator !== "undefined" ? navigator.platform : "");
  const windows = /win/i.test(os);
  if (ext === ".py") return { command: `python ${quoted}`, label: LABELS.python };
  if (ext === ".js" || ext === ".mjs" || ext === ".cjs") {
    return { command: `node ${quoted}`, label: LABELS.node };
  }
  if (ext === ".ts" || ext === ".tsx") return { command: `bun ${quoted}`, label: LABELS.bun };
  if (ext === ".sh") return { command: `bash ${quoted}`, label: LABELS.bash };
  if (ext === ".ps1") return { command: `pwsh -File ${quoted}`, label: LABELS.powershell };
  if ((ext === ".cmd" || ext === ".bat") && windows) {
    return { command: `cmd /c ${quoted}`, label: LABELS.cmd };
  }
  if (ext === ".go") return { command: `go run ${quoted}`, label: LABELS.go };
  return null;
}

/**
 * @param {TerminalClientLike | null | undefined} client
 * @param {string | null | undefined} terminalId
 * @returns {{ terminalId: string | undefined, entry: TerminalTabEntry | undefined } | null}
 */
function pickTab(client, terminalId) {
  if (!(client?.tabs instanceof Map) || client.tabs.size === 0) return null;
  const tabs = client.tabs;
  const id = terminalId && tabs.has(terminalId) ? terminalId : [...tabs.keys()].at(-1);
  return { terminalId: id, entry: tabs.get(/** @type {string} */ (id)) };
}

/**
 * @param {TerminalClientLike | null | undefined} client
 * @param {unknown} command
 * @param {string | null} [terminalId]
 * @returns {WriteCommandResult}
 */
export function writeCommandToPty(client, command, terminalId = null) {
  const line = String(command || "").endsWith("\n") ? String(command) : `${command}\n`;
  const picked = pickTab(client, terminalId);
  if (!picked?.entry || !client?.command) return { wrote: false, command: line.trim() };
  const entry = picked.entry;
  const bytes = new TextEncoder().encode(line);
  const dataBase64 = btoa(String.fromCharCode(...bytes));
  client.command({
    type: "terminal_input",
    terminalId: picked.terminalId,
    generation: entry.generation,
    dataBase64,
  });
  return { wrote: true, command: line.trim(), terminalId: picked.terminalId };
}

/**
 * @param {TerminalPanelLike | null | undefined} panel
 * @returns {PanelTab | null}
 */
function pickRunningShell(panel) {
  const running = (panel?.tabs || []).filter((tab) => tab.status === "running");
  const active = running.find((tab) => tab.terminalId === panel?.activeTerminalId);
  return active || running[0] || null;
}

/**
 * @param {RunFileInTerminalOptions} [options]
 * @returns {Promise<WriteCommandResult & { label?: string }>}
 */
export async function runFileInTerminal({
  client,
  panel,
  workbench,
  path,
  getDefaultProfile = defaultTerminalProfile,
} = {}) {
  const spec = runCommandForFile(path);
  if (!spec || !client) return { wrote: false, command: spec?.command };
  workbench?.dock?.setTab?.("terminal");
  workbench?.shell?.applyHidden?.({ dockHidden: false });
  let target = pickRunningShell(panel);
  if (!target) {
    const created = await client.sendAndAwait?.(
      { type: "terminal_create", profileId: getDefaultProfile?.() || "default" },
      (message) => message.type === "terminal_created",
    );
    target = { terminalId: created?.terminalId };
  }
  const terminalId = target.terminalId;
  if (terminalId && !shellShowsText(client, terminalId)) {
    await waitForShellPrompt(client, { terminalId });
  }
  const written = writeCommandToPty(client, spec.command, terminalId ?? null);
  const writtenTerminalId = written.terminalId;
  if (writtenTerminalId) panel?.setActiveTerminalId?.(writtenTerminalId);
  return { ...written, label: spec.label };
}

/**
 * @param {PreviewDocLike | undefined} [doc]
 * @returns {string}
 */
function activePreviewPath(doc = document) {
  return (
    doc.querySelector(".file-preview-tab.active .file-preview-tab-name")?.getAttribute("title") ||
    ""
  );
}

/**
 * @param {MountRunFileButtonOptions} [options]
 * @returns {() => void}
 */
export function mountRunFileButton({
  button,
  getActivePath = activePreviewPath,
  run,
  t = (key, vars) => key.replace("{label}", vars?.label || ""),
} = {}) {
  if (!button) return () => {};
  const target = button;
  const sync = () => {
    const spec = runCommandForFile(getActivePath?.() || "");
    target.hidden = !spec;
    if (spec) {
      const title =
        t("files.preview.run", { label: spec.label }) || `Run ${spec.label} in terminal`;
      target.title = title;
      target.setAttribute("aria-label", title);
    }
  };
  target.addEventListener("click", () => {
    const path = getActivePath?.();
    if (path) void run?.(path);
  });
  const tabs = target.ownerDocument?.getElementById?.("file-preview-tabs");
  const observer = tabs ? new MutationObserver(sync) : null;
  observer?.observe(/** @type {Node} */ (tabs), {
    childList: true,
    subtree: true,
    attributes: true,
  });
  tabs?.addEventListener("click", () => queueMicrotask(sync));
  sync();
  return sync;
}
