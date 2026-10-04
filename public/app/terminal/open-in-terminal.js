// ABOUTME: Opens the bundled Pi in a dock tab named "Pi" that closes when Pi quits.
// ABOUTME: Its close reloads SPOPI's Pi, so packages and settings changed there apply.

import { defaultTerminalProfile } from "../dock/terminal-profile-menu.js";
import { t } from "../i18n/i18n.js";
import { selectedShellProfile } from "../settings/appearance-preferences.js";
import { writeCommandToPty } from "./run-file.js";

/**
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
 *   shell?: {
 *     applyHidden?: (state: { dockHidden?: boolean }) => void,
 *     showCenter?: () => void,
 *   },
 * }} WorkbenchLike
 *
 * @typedef {{
 *   setActiveTerminalId?: (terminalId: string) => void,
 *   expand?: () => unknown,
 *   activateWhenListed?: (terminalId: string) => void,
 * }} TerminalPanelLike
 *
 * @typedef {{
 *   __spopiOpenInTerminalLast?: unknown,
 * }} OpenInTerminalWindow
 */

/**
 * Quote a pi path that contains spaces. A bare `pi` stays a PATH command only
 * when the host has not reported the bundled binary. Forward slashes, because
 * Git Bash drops the backslashes of an unquoted Windows path.
 * @param {unknown} piBin
 * @returns {string}
 */
function quotePiBin(piBin) {
  const text = String(piBin || "")
    .trim()
    .replace(/\\/g, "/");
  if (!text) return "pi";
  if (!/[\s"]/.test(text)) return text;
  return `"${text.replaceAll('"', '\\"')}"`;
}

/** @param {string} arg */
function quoteShellArg(arg) {
  if (!/[\s"]/.test(arg)) return arg;
  return `"${arg.replaceAll('"', '\\"')}"`;
}

/**
 * The Pi command line for a Pi tab. PowerShell treats a quoted path as a
 * string, so a quoted pi path there is prefixed with `& `. The shell closes
 * once Pi quits cleanly, so a Pi tab never turns into a plain shell; a failed
 * start leaves Pi's error on screen. Git Bash would rewrite a `/command`
 * argument into a Windows path unless path conversion is off.
 * @param {unknown} piBin
 * @param {string} profileId
 * @param {string[]} [args]
 */
export function piTabCommand(piBin, profileId, args = []) {
  const bin = quotePiBin(piBin);
  const prefix = profileId === "powershell" && bin.startsWith('"') ? "& " : "";
  const rest = args.map(quoteShellArg).join(" ");
  const run = `${prefix}${bin}${rest ? ` ${rest}` : ""}`;
  if (profileId === "powershell") return `${run}; if ($LASTEXITCODE -eq 0) { exit }`;
  if (profileId === "git-bash") return `MSYS_NO_PATHCONV=1 ${run} && exit`;
  return `${run} && exit`;
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
 * Show the dock terminal. The overlay and a hidden dock would cover the PTY.
 * @param {WorkbenchLike | null | undefined} workbench
 */
export function showDockTerminal(workbench) {
  workbench?.dock?.setTab?.("terminal");
  workbench?.shell?.showCenter?.();
  workbench?.shell?.applyHidden?.({ dockHidden: false });
}

/**
 * The shell a new tab really runs, so a command's syntax matches it. "default"
 * stays only where the host lists no named shells (the Unix system shell).
 * @param {TerminalClientLike} client
 * @returns {Promise<string>}
 */
async function newTabProfile(client) {
  const listed = /** @type {{ profiles?: unknown } | null | undefined} */ (
    await client.sendAndAwait?.(
      { type: "terminal_profiles" },
      (message) => message.type === "terminal_profiles",
    )
  );
  const profiles = Array.isArray(listed?.profiles) ? listed.profiles : [];
  return profiles.length ? selectedShellProfile(defaultTerminalProfile(), profiles) : "default";
}

/** @type {Map<string, TerminalClientLike>} */
const openPiTabs = new Map();

/** @param {Event} event */
function onTerminalClosed(event) {
  const detail = /** @type {CustomEvent} */ (event).detail;
  const client = openPiTabs.get(detail?.terminalId);
  if (!client) return;
  openPiTabs.delete(detail.terminalId);
  if (!openPiTabs.size) document.removeEventListener("spopi-terminal-closed", onTerminalClosed);
  if (typeof detail.generation === "number") {
    client.command?.({
      type: "terminal_close",
      terminalId: detail.terminalId,
      generation: detail.generation,
    });
  }
  document.dispatchEvent(new CustomEvent("spopi-pi-config-changed"));
}

/**
 * @param {string} terminalId
 * @param {TerminalClientLike} client
 */
function reloadWhenClosed(terminalId, client) {
  if (!openPiTabs.size) document.addEventListener("spopi-terminal-closed", onTerminalClosed);
  openPiTabs.set(terminalId, client);
}

/**
 * Run the bundled Pi in a new tab named "Pi" in the user's shell (never in a
 * shell the user may be using). It shares `~/.pi/agent` with SPOPI's Pi; when
 * the tab closes, SPOPI's Pi reloads.
 * @param {{
 *   client?: TerminalClientLike | null,
 *   panel?: TerminalPanelLike | null,
 *   workbench?: WorkbenchLike | null,
 *   args?: string[],
 * }} options
 * @returns {Promise<WriteCommandResult>}
 */
export async function openPiTab({ client, panel, workbench, args = [] }) {
  if (!(client?.command && client.sendAndAwait && client.tabs instanceof Map)) {
    return { wrote: false };
  }
  showDockTerminal(workbench);
  const [piBin, profileId] = await Promise.all([resolveBundledPiBin(), newTabProfile(client)]);
  const command = piTabCommand(piBin, profileId, args);
  await panel?.expand?.();
  const tabs = client.tabs;
  const before = new Set(tabs.keys());
  const created = await client.sendAndAwait(
    { type: "terminal_create", profileId, label: "Pi" },
    (message) => message.type === "terminal_created",
  );
  const terminalId = created?.terminalId || [...tabs.keys()].find((id) => !before.has(id)) || null;
  if (terminalId) panel?.activateWhenListed?.(terminalId);
  await client.sendAndAwait(
    { type: "terminal_list" },
    (message) => message.type === "terminal_listed",
  );
  await waitForShellPrompt(client, { terminalId });
  const written = writeCommandToPty(client, command, terminalId);
  if (written.wrote && written.terminalId) {
    panel?.setActiveTerminalId?.(written.terminalId);
    reloadWhenClosed(written.terminalId, client);
  }
  return written;
}

/**
 * Header π: Pi in the terminal on a new session of this project. The chat
 * stays as it is.
 * @param {{
 *   client?: TerminalClientLike | null,
 *   panel?: TerminalPanelLike | null,
 *   workbench?: WorkbenchLike | null,
 *   notify?: (notice: { type?: string, title?: string, message?: string }) => void,
 *   win?: OpenInTerminalWindow,
 * }} options
 */
export async function openPiInTerminal({
  notify,
  win = /** @type {OpenInTerminalWindow} */ (/** @type {unknown} */ (globalThis)),
  ...tab
}) {
  const result = await openPiTab(tab);
  if (!result.wrote) {
    notify?.({ type: "error", title: t("header.openPi"), message: t("terminal.piTabFailed") });
  }
  win.__spopiOpenInTerminalLast = { result };
  return result;
}
