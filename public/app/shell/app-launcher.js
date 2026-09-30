// ABOUTME: The /app entry opens the newest saved session in the workbench, like the desktop window.
// ABOUTME: With no session to open it lists projects instead; it never starts a Pi turn itself.

import { createI18n, t } from "../i18n/i18n.js";
import { SessionSidebar } from "../session/session-sidebar.js";
import { mountOpenFolderButton, spawnSessionViaHost } from "../session/workspace-actions.js";
import { applyTheme, getCurrentTheme } from "../theme/themes.js";
import { HostControlGateway } from "../transport/control-gateway.js";
import { HostDataGateway } from "../transport/data-gateway.js";
import { HostRuntimeAdapter, resolveHostWebSocketUrl } from "../transport/runtime-adapter.js";
import { sessionScopedClientId } from "../utils/random-id.js";
import { appRoutePath } from "../utils/router.js";
import { mountAppChrome } from "./app-chrome.js";
import { headerChromeRefs } from "./chrome/chat.js";
import { composerChromeRefs } from "./chrome/composer.js";
import { sidebarChromeRefs } from "./chrome/sidebar.js";

document.body.classList.add("app-launcher");
clearSessionSwapOverlay();

function ensureLauncherChrome() {
  // The session app mounts this shell. The launcher entry is a different module,
  // so an empty #app-layout would otherwise stay on the "Starting session" overlay.
  mountAppChrome(document.querySelector(".app-layout"));
}

try {
  applyTheme(getCurrentTheme());
  await createI18n();
  ensureLauncherChrome();
  prepareLauncherShell();
  await startLauncher();
} catch (error) {
  ensureLauncherChrome();
  prepareLauncherShell();
  showLauncherError(error);
}

async function startLauncher() {
  mountSidebarToggle();
  mountOpenFolderButton({ onError: showLauncherError });

  const adapter = new HostRuntimeAdapter(
    /** @type {{ url: string, clientId: string }} */ (
      /** @type {unknown} */ ({
        url: resolveHostWebSocketUrl(window),
        clientId: sessionScopedClientId("desktop"),
        clientType: "desktop",
      })
    ),
  );
  const dataAdapter = /** @type {import("../transport/data-gateway.js").DataAdapter} */ (
    /** @type {unknown} */ (adapter)
  );
  const controlAdapter =
    /** @type {import("../transport/control-gateway.js").HostControlAdapter} */ (
      /** @type {unknown} */ (adapter)
    );
  const data = new HostDataGateway(dataAdapter);
  const control = new HostControlGateway(controlAdapter);
  adapter.connect();
  if (!new URLSearchParams(window.location.search).has("list")) {
    const listed = /** @type {{ sessions?: Parameters<typeof resumeLatestSession>[0] } | null} */ (
      await data.listLauncherSessions().catch(() => null)
    );
    const resumed = await resumeLatestSession(listed?.sessions ?? [], {
      control,
      navigate: (path) => window.location.replace(path),
    });
    if (resumed) return;
  }
  const sessionList = sidebarChromeRefs().sessionList;
  const sidebar = new SessionSidebar(
    /** @type {HTMLElement} */ (/** @type {unknown} */ (sessionList)),
    /** @type {import("../session/session-sidebar.js").SessionSidebarOptions} */ (
      /** @type {unknown} */ ({
        data,
        runtime: null,
        control,
        config: null,
        getTarget: () => null,
        onSelect: (/** @type {{ id?: string, projectPath?: string | null }} */ session) =>
          openLauncherSession(session, { control }).catch(showLauncherError),
        onCreateSession: null,
        onSessionsLoaded: null,
        onAgentInboxSessionChange: null,
        loadSessions: () => data.listLauncherSessions(),
        cacheScope: "launcher",
      })
    ),
  );

  mountLauncherNewProject(control);
  setupSidebarSearch(sidebar);
  setupRefresh(sidebar);
  sidebar.load().catch(showLauncherError);
}

/**
 * @param {{ id?: string, projectPath?: string | null } | null | undefined} session
 * @param {object} options
 * @param {{ resolveWorkspace: (projectPath: string) => Promise<string> }} options.control
 * @param {(path: string) => void} [options.navigate]
 */
export async function openLauncherSession(
  session,
  { control, navigate = (path) => window.location.assign(path) },
) {
  if (!session?.id || !session?.projectPath) throw new Error(t("launcher.invalidSession"));
  const workspaceId = await control.resolveWorkspace(session.projectPath);
  const path = appRoutePath({ name: "session", workspaceId, sessionId: session.id });
  navigate(path);
}

/**
 * The browser opens where the desktop window would: the most recent session, in the
 * workbench shell. A project that no longer resolves is skipped; `/app?list` keeps the list.
 * @param {{ id?: string, projectPath?: string | null }[]} sessions newest first
 * @param {object} options
 * @param {{ resolveWorkspace: (projectPath: string) => Promise<string> }} options.control
 * @param {(path: string) => void} options.navigate
 */
export async function resumeLatestSession(sessions, { control, navigate }) {
  const openable = sessions.filter((session) => session.id && session.projectPath);
  for (const session of openable.slice(0, 3)) {
    try {
      await openLauncherSession(session, { control, navigate });
      return true;
    } catch {
      // try the next project
    }
  }
  return false;
}

function clearSessionSwapOverlay() {
  document.body.classList.remove("swapping-instance");
  document.documentElement.classList.remove("swapping-instance-pending");
  document.getElementById("instance-swap-overlay")?.removeAttribute("data-visible");
  try {
    sessionStorage.removeItem("spopi:swapping-instance");
  } catch {
    // Storage is best-effort; the DOM state above is authoritative.
  }
}

/**
 * With no project open, the sidebar + still creates a project and opens its
 * first chat, so closing the last project never leaves a dead end.
 * @param {{ createProject: () => Promise<{ workspaceId: string }> }} control
 * @param {(path: string) => void} [navigate]
 */
export function mountLauncherNewProject(
  control,
  navigate = (path) => window.location.assign(path),
) {
  const button = sidebarChromeRefs().newSessionBtn;
  if (!(button instanceof HTMLButtonElement)) return;
  button.classList.remove("hidden");
  button.title = t("shell.newProjectTitle");
  button.setAttribute("aria-label", t("shell.newProjectTitle"));
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      const project = await control.createProject();
      const target = await spawnSessionViaHost(project.workspaceId);
      navigate(
        appRoutePath({
          name: "session",
          workspaceId: target.workspaceId,
          sessionId: target.sessionId,
        }),
      );
    } catch (error) {
      showLauncherError(error);
    } finally {
      button.disabled = false;
    }
  });
}

function prepareLauncherShell() {
  document.querySelector(".sidebar-primary-nav")?.classList.add("hidden");
  document.querySelector(".sidebar-footer")?.classList.add("hidden");

  const header = document.querySelector(".session-header");
  const headerLeft = header?.querySelector(".header-left");
  const toggle = headerChromeRefs().sidebarToggle;
  if (headerLeft && toggle) {
    headerLeft.replaceChildren(toggle);
    const title = document.createElement("h1");
    title.className = "launcher-header-title";
    title.textContent = t("launcher.title");
    headerLeft.appendChild(title);
  }
  header?.querySelector(".header-right")?.classList.add("hidden");

  const messages = headerChromeRefs().messages;
  const hint = messages?.querySelector(".welcome .hint");
  if (hint) hint.textContent = t("launcher.hint");
  messages?.querySelector(".shortcuts-hint")?.classList.add("hidden");

  const composer = composerChromeRefs().card;
  composer?.setAttribute("aria-disabled", "true");
  composer?.querySelectorAll("button, input, textarea, select").forEach((control) => {
    if (!("disabled" in control)) return;
    /** @type {{ disabled: boolean }} */ (control).disabled = true;
  });
  const messageInput = composerChromeRefs().messageInput;
  if (messageInput && "placeholder" in messageInput) {
    /** @type {{ placeholder: string }} */ (messageInput).placeholder = t("launcher.composerHint");
  }
}

function mountSidebarToggle() {
  const shell = sidebarChromeRefs();
  const sidebar = shell.sidebar;
  const toggle = headerChromeRefs().sidebarToggle;
  const overlay = shell.overlay;
  if (!sidebar || !toggle) return;
  const isMobile = () => window.innerWidth <= 768;
  /** @param {boolean} collapsed */
  const setCollapsed = (collapsed) => {
    sidebar.classList.toggle("collapsed", collapsed);
    overlay?.classList.toggle("visible", !collapsed && isMobile());
  };
  if (isMobile()) setCollapsed(true);
  toggle.addEventListener("click", () => setCollapsed(!sidebar.classList.contains("collapsed")));
  overlay?.addEventListener("click", () => setCollapsed(true));
}

/** @param {SessionSidebar} sidebar */
function setupSidebarSearch(sidebar) {
  const input = sidebarChromeRefs().searchInput;
  const clear = sidebarChromeRefs().searchClear;
  input?.addEventListener("input", () => {
    if (!input || !("value" in input)) return;
    const searchInput = /** @type {{ value: string }} */ (input);
    sidebar.setSearchQuery(searchInput.value);
    clear?.classList.toggle("hidden", searchInput.value.length === 0);
  });
  clear?.addEventListener("click", () => {
    if (!input || !("value" in input) || !("focus" in input)) return;
    const searchInput = /** @type {{ value: string, focus: () => void }} */ (input);
    const clearBtn = clear;
    searchInput.value = "";
    sidebar.setSearchQuery("");
    clearBtn.classList.add("hidden");
    searchInput.focus();
  });
}

/** @param {SessionSidebar} sidebar */
function setupRefresh(sidebar) {
  sidebarChromeRefs().refreshSessionsBtn?.addEventListener("click", (event) => {
    const current = event.currentTarget;
    if (!current || !("classList" in current) || !("offsetWidth" in current)) return;
    const button = /** @type {{ classList: DOMTokenList, offsetWidth: number }} */ (current);
    button.classList.remove("spinning");
    void button.offsetWidth;
    button.classList.add("spinning");
    sidebar.load().catch(showLauncherError);
  });
}

/** @param {unknown} error */
function showLauncherError(error) {
  const welcome = headerChromeRefs().messages?.querySelector(".welcome");
  if (!welcome) return;
  let alert = welcome.querySelector(".launcher-error");
  if (!alert) {
    alert = document.createElement("p");
    alert.className = "launcher-error";
    alert.setAttribute("role", "alert");
    welcome.appendChild(alert);
  }
  alert.textContent = error instanceof Error ? error.message : String(error);
}
