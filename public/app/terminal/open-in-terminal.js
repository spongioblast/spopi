// ABOUTME: Builds the `pi -r <session>` command for the dock terminal twin.
// ABOUTME: The GUI releases the session first so Pi's lock has one writer.

import { onSessionCreated } from "../session/session-created-action.js";
import { writeCommandToPty } from "./run-file.js";

/**
 * @typedef {{
 *   getElementById?: (
 *     id: string,
 *   ) => { textContent?: string | null, click: () => void } | null,
 * }} StatusDocLike
 *
 * @typedef {{
 *   sameProcess?: boolean,
 *   held?: boolean,
 * }} SessionLockState
 *
 * @typedef {{
 *   timeoutMs?: number,
 *   fromSessionId?: string | null,
 * }} AwaitSessionSwitchOptions
 *
 * @typedef {{
 *   switched: boolean,
 *   sessionId: string | null,
 * }} SessionSwitchResult
 *
 * @typedef {{
 *   lastAppliedSequence?: number,
 *   generation?: number,
 *   tab?: { hasScreenText?: () => boolean },
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
 *   terminalId?: string | null,
 *   timeoutMs?: number,
 *   pollMs?: number,
 *   quietMs?: number,
 * }} WaitForShellPromptOptions
 *
 * @typedef {{
 *   wrote: boolean,
 *   command?: string,
 *   terminalId?: string | null,
 * }} WriteCommandResult
 *
 * @typedef {{
 *   dock?: { setTab?: (name: string) => void },
 *   shell?: { applyHidden?: (state: { dockHidden?: boolean }) => void },
 * }} WorkbenchLike
 *
 * @typedef {{
 *   setActiveTerminalId?: (terminalId: string) => void,
 * }} TerminalPanelLike
 *
 * @typedef {{
 *   __spopiOpenInTerminalLast?: unknown,
 * }} OpenInTerminalWindow
 *
 * @typedef {{
 *   workbench?: WorkbenchLike | null,
 *   sessionPath?: unknown,
 *   currentSessionId?: string | null,
 *   client?: TerminalClientLike | null,
 *   panel?: TerminalPanelLike | null,
 *   getClient?: (() => TerminalClientLike | null | undefined) | null,
 *   getPanel?: (() => TerminalPanelLike | null | undefined) | null,
 *   win?: OpenInTerminalWindow | null,
 *   doc?: StatusDocLike | null,
 * }} OpenSessionInPtyTwinOptions
 */

/** Forward slashes survive Git Bash, PowerShell and cmd; backslashes do not. */
/**
 * @param {unknown} sessionPath
 * @returns {string}
 */
export function normalizeSessionPath(sessionPath) {
  return String(sessionPath || "")
    .trim()
    .replace(/\\/g, "/");
}

/**
 * Quote a pi path that contains spaces. A bare `pi` stays a PATH command only
 * when the host has not reported the bundled binary.
 * @param {unknown} piBin
 * @returns {string}
 */
function quotePiBin(piBin) {
  const text = String(piBin || "pi").trim() || "pi";
  if (!/[\s"]/.test(text)) return text;
  return `"${text.replaceAll('"', '\\"')}"`;
}

/**
 * @param {unknown} sessionPath
 * @param {unknown} [piBin]
 * @returns {string}
 */
export function resumeSessionCommand(sessionPath, piBin = "pi") {
  const bin = quotePiBin(piBin);
  const path = normalizeSessionPath(sessionPath);
  if (!path) return bin;
  return `${bin} -r "${path}"`;
}

/** Ask the host for the bundled pi binary. Fall back to `pi` if it is missing. */
/** @returns {Promise<string>} */
async function resolveBundledPiBin() {
  try {
    const response = await fetch("/health");
    if (!response.ok) return "pi";
    const body = await response.json();
    const piBin =
      body && typeof body === "object" ? /** @type {{ piBin?: unknown }} */ (body).piBin : "";
    return typeof piBin === "string" && piBin.trim() ? piBin.trim() : "pi";
  } catch {
    return "pi";
  }
}

/** Prefer the path we already have; otherwise ask Pi for the session file. */
/**
 * @param {unknown} sessionPath
 * @param {(() => Promise<unknown>) | null | undefined} [requestStats]
 * @returns {Promise<string>}
 */
export async function resolveResumePath(sessionPath, requestStats) {
  const direct = normalizeSessionPath(sessionPath);
  if (direct) return direct;
  if (!requestStats) return "";
  try {
    const frame = await requestStats();
    const root =
      frame && typeof frame === "object" ? /** @type {Record<string, unknown>} */ (frame) : null;
    const resultRaw = root ? (root.response ?? root) : frame;
    const result =
      resultRaw && typeof resultRaw === "object"
        ? /** @type {Record<string, unknown>} */ (resultRaw)
        : null;
    const data =
      result?.data && typeof result.data === "object"
        ? /** @type {Record<string, unknown>} */ (result.data)
        : null;
    return normalizeSessionPath(data?.sessionFile || "");
  } catch {
    return "";
  }
}

/** After a GUI session switch the host WS is mid-reconnect; wait for Connected. */
/**
 * @param {StatusDocLike | null | undefined} [doc]
 * @param {object} [options]
 * @param {number} [options.timeoutMs]
 * @returns {Promise<boolean>}
 */
export async function waitUntilConnected(doc = globalThis.document, { timeoutMs = 20_000 } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const text = (doc?.getElementById?.("status-text")?.textContent || "").trim();
    if (/^connected$/i.test(text)) return true;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return false;
}

/**
 * The GUI always holds the session it is showing, so the default answer is
 * "switch"; `sameProcess` is the only opt-out (the PTY twin is the GUI's own
 * Pi, which never happens today).
 * @param {SessionLockState} [lockState]
 * @returns {boolean}
 */
export function shouldSwitchToFreshSession(lockState = {}) {
  if (lockState.sameProcess === true) return false;
  return lockState.held !== false;
}

/** Resolve once the page adopts a new session target, or after `timeoutMs`. */
/**
 * @param {unknown} [_win]
 * @param {AwaitSessionSwitchOptions} [options]
 * @returns {Promise<SessionSwitchResult>}
 */
export function awaitSessionSwitch(_win = globalThis, { timeoutMs = 5000, fromSessionId } = {}) {
  return new Promise((resolve) => {
    let done = false;
    let unbind = () => {};
    /**
     * @param {SessionSwitchResult} value
     */
    const finish = (value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      unbind();
      resolve(value);
    };
    /**
     * @param {{ sessionId?: string }} detail
     */
    const onCreated = (detail) => {
      const sessionId = detail?.sessionId;
      if (!sessionId || sessionId === fromSessionId) return;
      finish({ switched: true, sessionId });
    };
    const timer = setTimeout(() => finish({ switched: false, sessionId: null }), timeoutMs);
    unbind = onSessionCreated(onCreated);
  });
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
 * @param {unknown} sessionPath
 * @param {string | null} [terminalId]
 * @param {unknown} [piBin]
 * @returns {WriteCommandResult}
 */
export function writeResumeToPty(client, sessionPath, terminalId = null, piBin = "pi") {
  return writeCommandToPty(client, resumeSessionCommand(sessionPath, piBin), terminalId);
}

/**
 * @param {TerminalTabEntry | undefined} entry
 * @returns {boolean}
 */
function entryShowsText(entry) {
  const hasText = entry?.tab?.hasScreenText;
  if (typeof hasText === "function") return hasText.call(entry?.tab);
  return Number(entry?.lastAppliedSequence) > 0;
}

/**
 * @param {TerminalClientLike | null | undefined} client
 * @param {string | null | undefined} terminalId
 * @returns {boolean}
 */
export function shellShowsText(client, terminalId) {
  return entryShowsText(pickTab(client, terminalId)?.entry);
}

/**
 * ConPTY answers first with a cursor query and mode switches, before the shell
 * runs; Git Bash drops the first key typed then. Wait for visible text (the
 * prompt), then for output to go quiet so a prompt painted in pieces is done.
 * @param {TerminalClientLike | null | undefined} client
 * @param {WaitForShellPromptOptions} [options]
 * @returns {Promise<boolean>}
 */
export async function waitForShellPrompt(
  client,
  { terminalId = null, timeoutMs = 6000, pollMs = 50, quietMs = 200 } = {},
) {
  const started = Date.now();
  let sequence = -1;
  let quietSince = 0;
  while (Date.now() - started < timeoutMs) {
    const entry = pickTab(client, terminalId)?.entry;
    if (entryShowsText(entry)) {
      const latest = Number(entry?.lastAppliedSequence) || 0;
      if (latest !== sequence) {
        sequence = latest;
        quietSince = Date.now();
      } else if (Date.now() - quietSince >= quietMs) {
        return true;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  return false;
}

/**
 * Open a dedicated PTY tab (never type into a shell the user may be using),
 * wait for its prompt, then write `pi -r`. Never sends a chat prompt.
 * @param {TerminalClientLike | null | undefined} client
 * @param {unknown} sessionPath
 * @param {{ piBin?: unknown }} [options]
 * @returns {Promise<WriteCommandResult>}
 */
export async function ensureResumeInPty(client, sessionPath, { piBin = "pi" } = {}) {
  const command = resumeSessionCommand(sessionPath, piBin);
  if (!client?.command) return { wrote: false, command };
  if (!(client.tabs instanceof Map)) return { wrote: false, command };
  const tabs = client.tabs;
  const before = new Set(tabs.keys());
  let terminalId = /** @type {string | null} */ (null);
  if (typeof client.sendAndAwait === "function") {
    const sendAndAwait = client.sendAndAwait;
    const created = await sendAndAwait(
      { type: "terminal_create", profileId: "default" },
      (message) => message.type === "terminal_created",
    );
    await sendAndAwait({ type: "terminal_list" }, (message) => message.type === "terminal_listed");
    terminalId = created?.terminalId || [...tabs.keys()].find((id) => !before.has(id)) || null;
  } else {
    client.command({ type: "terminal_create", profileId: "default" });
  }
  await waitForShellPrompt(client, { terminalId });
  return writeResumeToPty(client, sessionPath, terminalId, piBin);
}

/**
 * Header "Open in terminal": show the dock terminal, move the GUI to a fresh
 * session (Pi's lock allows one writer per session file), wait for adoption,
 * then let the PTY twin resume the old session.
 * @param {OpenSessionInPtyTwinOptions} [options]
 * @returns {Promise<WriteCommandResult & SessionSwitchResult>}
 */
export async function openSessionInPtyTwin({
  workbench,
  sessionPath,
  currentSessionId,
  client,
  panel,
  getClient,
  getPanel,
  win = /** @type {OpenInTerminalWindow} */ (globalThis),
  doc = globalThis.document,
} = {}) {
  workbench?.dock?.setTab?.("terminal");
  workbench?.shell?.applyHidden?.({ dockHidden: false });
  let switched = /** @type {SessionSwitchResult} */ ({ switched: false, sessionId: null });
  if (shouldSwitchToFreshSession({ held: true })) {
    const pending = awaitSessionSwitch(win, { fromSessionId: currentSessionId });
    doc?.getElementById?.("new-session-btn")?.click();
    switched = await pending;
  }
  if (switched.switched) await waitUntilConnected(doc);
  const piBin = await resolveBundledPiBin();
  const liveClient = getClient?.() || client;
  const livePanel = getPanel?.() || panel;
  const written = liveClient
    ? await ensureResumeInPty(liveClient, sessionPath, { piBin })
    : /** @type {WriteCommandResult} */ ({ wrote: false });
  const writtenTerminalId = written.terminalId;
  if (writtenTerminalId) livePanel?.setActiveTerminalId?.(writtenTerminalId);
  const result = { ...written, ...switched };
  if (win) win.__spopiOpenInTerminalLast = { sessionPath, result };
  return result;
}
