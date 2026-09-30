// ABOUTME: Creates sessions and opens folders through the host.
// ABOUTME: The new-session and open-folder buttons call these helpers.

import { t } from "../i18n/i18n.js";
import { sidebarChromeRefs } from "../shell/chrome/sidebar.js";
import { emitSessionCreated } from "./session-created-action.js";

/**
 * Workspace actions — bridge UI controls to native Tauri commands that manage
 * workspace windows. Currently wires the "Open a folder as a project" button to
 * the native folder picker, which spawns a dedicated window + pi runtime for
 * the chosen directory.
 */

/**
 * The host answers `{ error: { code, message? } }`. `new Error` on that object
 * stringifies to "[object Object]", which hides `project_not_found`.
 * @param {unknown} body
 * @param {number} status
 * @returns {Error & { code?: string }}
 */
export function errorFromHostBody(body, status) {
  const record = body && typeof body === "object" ? /** @type {{ error?: unknown }} */ (body) : {};
  const field = record.error;
  let code = "";
  let message = "";
  if (typeof field === "string") {
    message = field;
  } else if (field && typeof field === "object") {
    const nested = /** @type {{ code?: unknown, message?: unknown }} */ (field);
    if (typeof nested.code === "string") code = nested.code;
    if (typeof nested.message === "string") message = nested.message;
  }
  const text = message || code || `Server error ${status}`;
  const error = /** @type {Error & { code?: string }} */ (new Error(text));
  if (code) error.code = code;
  return error;
}

/**
 * Resolve the Tauri `invoke` function exposed via `withGlobalTauri`.
 * Returns null when running outside the native Tauri shell (e.g. a remote
 * browser client), so callers can degrade gracefully.
 * @returns {((cmd: string, args?: object) => Promise<unknown>) | null}
 */
function resolveInvoke() {
  const tauri =
    /** @type {{ core?: { invoke?: (cmd: string, args?: object) => Promise<unknown> } } | undefined} */ (
      /** @type {Record<string, unknown>} */ (globalThis).__TAURI__
    );
  return tauri?.core?.invoke ?? null;
}

/**
 * Create a new session via the host HTTP API (used by LAN/remote clients that
 * cannot invoke Tauri native commands). Spawns a fresh temporary runtime on
 * the server and navigates the current page to the new session URL.
 *
 * @param {string} workspaceId
 * @returns {Promise<void>}
 */
export async function createSessionViaHost(workspaceId) {
  const response = await fetch("/v2/new-session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ workspaceId }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw errorFromHostBody(body, response.status);
  }
  const target = await response.json();
  const {
    workspaceId: wid,
    sessionId: sid,
    instanceId: iid,
  } = /** @type {{ workspaceId?: string, sessionId?: string, instanceId?: string }} */ (target);
  if (!wid || !sid) throw new Error("Server returned an invalid session target");
  // SPA navigation: emit an event so app.js can adoptTarget without reloading
  emitSessionCreated({ workspaceId: wid, sessionId: sid, instanceId: iid });
}

/**
 * Spawn a fresh headless runtime for `workspaceId` via the host HTTP API and
 * return its runtime target WITHOUT navigating the page. Unlike
 * `createSessionViaHost`, this is used when a caller needs a session that is
 * not the one on screen: the caller keeps the returned target and drives it over `/v2/ws` while the
 * current window stays on its own session.
 *
 * @param {string} workspaceId
 * @returns {Promise<{workspaceId: string, sessionId: string, instanceId: string}>}
 */
export async function spawnSessionViaHost(workspaceId) {
  const response = await fetch("/v2/new-session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ workspaceId }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw errorFromHostBody(body, response.status);
  }
  const target = /** @type {{ workspaceId?: string, sessionId?: string, instanceId?: string }} */ (
    await response.json()
  );
  if (!target?.workspaceId || !target?.sessionId || !target?.instanceId) {
    throw new Error("Server returned an invalid session target");
  }
  return {
    workspaceId: target.workspaceId,
    sessionId: target.sessionId,
    instanceId: target.instanceId,
  };
}

/**
 * Resolve a project path to its stable workspace id via the host HTTP API
 * (`POST /v2/resolve-workspace`), registering the workspace on the server so
 * `/v2/bootstrap` can lazily resume its sessions. Used by LAN/remote clients
 * that cannot invoke Tauri native commands.
 *
 * @param {string} projectPath
 * @returns {Promise<string>} the resolved workspace id
 */
async function resolveWorkspaceViaHost(projectPath) {
  const response = await fetch("/v2/resolve-workspace", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectPath }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw errorFromHostBody(body, response.status);
  }
  const { workspaceId } = /** @type {{ workspaceId?: string }} */ (await response.json());
  if (!workspaceId) throw new Error("Server returned an invalid workspace id");
  return workspaceId;
}

/**
 * Open an existing session that belongs to a different project via the host
 * HTTP API. Resolves the target project's workspace id, then navigates the
 * current page to that session's route (the page re-bootstraps). Used by
 * LAN/mobile clients switching across projects without a Tauri window.
 *
 * @param {{ projectPath: string, id: string, workspaceId?: string }} session
 * @returns {Promise<void>}
 */
export async function openSessionInProjectViaHost(session) {
  const workspaceId = session.workspaceId || (await resolveWorkspaceViaHost(session.projectPath));
  // SPA navigation: emit an event so app.js can adoptTarget without reloading
  emitSessionCreated({ workspaceId, sessionId: session.id });
}

/**
 * Start a fresh session in another project over the host HTTP API, so the
 * project "+" works where no native window command exists (browser, phone).
 * @param {string} projectPath
 * @returns {Promise<void>}
 */
export async function createSessionInProjectViaHost(projectPath) {
  await createSessionViaHost(await resolveWorkspaceViaHost(projectPath));
}

/**
 * The sidebar + creates a dated project, then a chat in it.
 *
 * @param {object} [options]
 * @param {{ createProject: () => Promise<{ workspaceId: string, projectPath: string }> }} [options.control]
 * @param {(error: Error) => void} [options.onError]
 * @returns {boolean}
 */
export function mountNewSessionButton({ control, onError } = {}) {
  const button = /** @type {HTMLButtonElement | null} */ (sidebarChromeRefs().newSessionBtn);
  if (!button) return false;

  button.title = t("shell.newProjectTitle");
  button.setAttribute("aria-label", t("shell.newProjectTitle"));

  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      if (!control) throw new Error("Project creation is unavailable");
      const project = await control.createProject();
      // The host registered the workspace; the HTTP API keeps the page loaded.
      await createSessionViaHost(project.workspaceId);
    } catch (error) {
      onError?.(error instanceof Error ? error : new Error(String(error)));
    } finally {
      button.disabled = false;
    }
  });
  return true;
}

/**
 * @param {KeyboardEvent} event
 * @returns {boolean}
 */
/** The + on the open project's row, which starts another chat in it. */
export function requestNewChatInCurrentProject() {
  const button = document.querySelector(".project-group.current-project .project-new-chat-btn");
  if (button instanceof HTMLElement) button.click();
}

/** The sidebar + , which creates a project. */
export function requestNewProject() {
  const button = sidebarChromeRefs().newSessionBtn;
  if (button instanceof HTMLElement) button.click();
}

/**
 * The project at `fromPath` is missing. On the desktop the picker's choice
 * gets the project's chats and records; elsewhere it opens like Open folder.
 * @param {string} fromPath
 * @param {(error: Error) => void} [onError]
 */
export async function requestLocateFolder(fromPath, onError) {
  const invoke = resolveInvoke();
  if (!invoke || !fromPath) {
    requestOpenFolder();
    return;
  }
  try {
    await invoke("locate_workspace", { fromPath });
  } catch (error) {
    onError?.(error instanceof Error ? error : new Error(String(error)));
  }
}

/** Opens the same folder picker as the sidebar Open folder button. */
function requestOpenFolder() {
  const button = sidebarChromeRefs().openFolderBtn;
  if (button instanceof HTMLElement) button.click();
}

/**
 * @param {object} [options]
 * @param {(error: Error) => void} [options.onError]
 * @returns {boolean}
 */
export function mountOpenFolderButton({ onError } = {}) {
  const button = /** @type {HTMLButtonElement | null} */ (sidebarChromeRefs().openFolderBtn);
  if (!button) return false;

  const invoke = resolveInvoke();
  if (!invoke) {
    // Remote/browser clients cannot open native windows; hide the control
    // rather than leave a button that silently does nothing.
    button.style.setProperty("display", "none");
    return false;
  }

  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      await invoke("open_folder_as_workspace");
    } catch (error) {
      onError?.(error instanceof Error ? error : new Error(String(error)));
    } finally {
      button.disabled = false;
    }
  });
  return true;
}
