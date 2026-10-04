// ABOUTME: Settings → MCP. Lists, adds, and removes servers through `pi mcp`.
// ABOUTME: Sign-in and the manager go to the session and to Pi's own TUI.

import { observeExtensionNotify } from "../../extension-ui/notify-observers.js";
import { t } from "../../i18n/i18n.js";
import { copyText } from "../../ui/clipboard.js";
import { el } from "../../ui/dom.js";
import { settingsCard, settingsPage } from "../../ui/settings-controls.js";
import { openAddServerDialog } from "./mcp-add-dialog.js";
import { openMcpManager } from "./mcp-manage-in-pi.js";
import { groupServers } from "./mcp-model.js";
import { renderServerRow } from "./mcp-row.js";
import { firstUrl, isTerminalMcpNotice, runMcpSessionCommand } from "./mcp-session-actions.js";

const DESKTOP_ONLY = "cannot run that action";

/**
 * @param {Element} root
 * @param {{
 *   control?: { listMcpServers?: Function, removeMcpServer?: Function, addMcpServer?: Function, openExternal?: Function },
 *   configGateway?: { call?: Function },
 *   runtime?: { request?: Function },
 *   getTarget?: () => { workspaceId?: string, sessionId?: string } | null,
 *   getWorkspaceId?: () => string,
 *   notify?: (notice: { type?: string, title?: string, message?: string, action?: { label: string, run: () => void } }) => void,
 *   closeSettings?: () => void,
 *   workbench?: Parameters<typeof openMcpManager>[0]["workbench"],
 *   terminal?: Parameters<typeof openMcpManager>[0]["terminal"],
 * }} [deps]
 */
export function mountMcpSettings(root, deps = {}) {
  const body = el("div", { class: "settings-stack mcp-page" });
  root.replaceChildren(
    ...settingsPage(t("settings.mcp.pageTitle"), "settings.mcp.pageTitle", [body]),
  );
  /** @type {{
   *   list?: object,
   *   trust?: { sessionTrusted?: boolean, savedTrust?: boolean | null } | null,
   *   checkedAt?: Date,
   *   error?: string,
   *   desktopOnly?: boolean,
   * } | null} */
  let last = null;
  /** @type {Record<string, string>} */
  const notices = {};
  let loading = false;
  let stopObserve = () => {};
  /** @type {Promise<void> | null} */
  let inflight = null;

  // A list starts every server, so a hidden page waits: opening the tab reloads it.
  const onConfig = () => {
    if (root.classList.contains("active") && !root.closest(".hidden")) void reload();
  };
  document.addEventListener("spopi-pi-config-changed", onConfig);

  /** One list at a time; an add here also arrives as a fanout. */
  function reload() {
    inflight ??= load().finally(() => {
      inflight = null;
    });
    return inflight;
  }

  async function load() {
    const workspaceId = deps.getWorkspaceId?.() || deps.getTarget?.()?.workspaceId || "";
    loading = true;
    paint();
    try {
      const [listed, trust] = await Promise.all([
        deps.control?.listMcpServers?.({ workspaceId }),
        deps.configGateway?.call?.("get_mcp_project_trust").catch(() => null),
      ]);
      last = { ...(listed ?? {}), trust: trust?.data ?? null, checkedAt: new Date() };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      last = {
        error: message,
        desktopOnly: message.toLowerCase().includes(DESKTOP_ONLY),
        checkedAt: new Date(),
      };
    } finally {
      loading = false;
      paint();
    }
  }

  function paint() {
    body.replaceChildren();
    const overview = card();
    body.append(overview);
    const actions = el("div", { class: "mcp-header-actions" });
    const add = button(t("settings.mcp.add"), "ui-button ui-button--primary", () => openAdd());
    const refresh = button(t("settings.mcp.refresh"), "ui-button", () => void reload());
    const manageButton = button(t("settings.mcp.manage"), "ui-button ui-button--secondary", manage);
    for (const control of [add, refresh, manageButton]) {
      if (loading) control.setAttribute("disabled", "");
      actions.append(control);
    }
    actions.append(
      button(t("settings.mcp.permissionsLink"), "ui-button ui-button--ghost", () =>
        document.dispatchEvent(
          new CustomEvent("spopi-open-settings", { detail: { tab: "general" } }),
        ),
      ),
    );
    if (last?.checkedAt instanceof Date) {
      actions.append(
        el("span", {
          class: "mcp-checked",
          text: t("settings.mcp.checking", { time: formatTime(last.checkedAt) }),
        }),
      );
    }
    overview.append(el("p", { class: "settings-help", text: t("settings.mcp.help") }), actions);
    if (loading && !last?.list) {
      overview.append(el("p", { class: "mcp-status", text: t("settings.mcp.loading") }));
      return;
    }
    if (last?.desktopOnly) {
      overview.append(el("p", { class: "mcp-status", text: t("settings.mcp.desktopOnly") }));
      return;
    }
    if (last?.error) {
      overview.append(
        el("p", { class: "mcp-status mcp-form-error", text: String(last.error) }),
        button(t("settings.mcp.retry"), "ui-button", () => void reload()),
      );
      return;
    }
    const grouped = groupServers(last?.list);
    const trust = last?.trust;
    if (grouped.note && trust?.sessionTrusted) {
      const denied = trust.savedTrust === false;
      overview.append(
        el("p", {
          class: "mcp-status mcp-trust-note",
          text: denied ? t("settings.mcp.trustDenied") : t("settings.mcp.trustNote"),
        }),
        button(t("settings.mcp.trustButton"), "ui-button", () =>
          attempt(t("settings.mcp.trustButton"), () =>
            deps.configGateway?.call?.("trust_project_in_pi"),
          ),
        ),
      );
    }
    for (const line of grouped.errors)
      overview.append(el("p", { class: "mcp-status mcp-form-warning", text: line }));
    const total = grouped.global.length + grouped.project.length + grouped.extension.length;
    if (total === 0) {
      overview.append(
        el("div", { class: "mcp-examples" }, [
          el("code", { text: t("settings.mcp.exampleCommand") }),
          el("code", { text: t("settings.mcp.exampleUrl") }),
        ]),
        el("p", { class: "mcp-status", text: t("settings.mcp.emptyHint") }),
      );
    }
    paintSection("settings.mcp.global", grouped.global);
    paintSection("settings.mcp.project", grouped.project);
    if (grouped.extension.length) {
      const packages = card("settings.mcp.packages");
      packages.append(el("p", { class: "settings-help", text: t("settings.mcp.packageNote") }));
      for (const server of grouped.extension) packages.append(renderServerRow(server));
      body.append(packages);
    }
  }

  /** @param {string} [titleKey] */
  function card(titleKey) {
    return settingsCard(titleKey ? t(titleKey) : "", titleKey || "", []);
  }

  /** @param {string} key @param {Array<Record<string, unknown>>} servers */
  function paintSection(key, servers) {
    if (!servers.length) return;
    const section = card(key);
    body.append(section);
    for (const server of servers) {
      section.append(
        renderServerRow(server, {
          notice: notices[String(server.name)] ?? "",
          onSignIn: (name) => void sessionAction("login", name),
          onSignOut: (name) => void sessionAction("logout", name),
          onReconnect: (name) => void sessionAction("reconnect", name),
          onRemove: (name, scope) => {
            const workspaceId = deps.getWorkspaceId?.() || "";
            void attempt(t("settings.mcp.remove"), () =>
              deps.control?.removeMcpServer?.(name, scope, { workspaceId }),
            );
          },
        }),
      );
    }
  }

  function openAdd() {
    const grouped = groupServers(last?.list);
    openAddServerDialog({
      control: deps.control,
      workspaceId: deps.getWorkspaceId?.(),
      servers: [...grouped.global, ...grouped.project],
      notify: deps.notify,
      onAdded: () => void reload(),
    });
  }

  /** @param {string} sub @param {string} name */
  async function sessionAction(sub, name) {
    stopObserve();
    const timer = setTimeout(() => stopObserve(), 6 * 60 * 1000);
    stopObserve = observeExtensionNotify((notice) => {
      const message = String(notice.message ?? "");
      const url = firstUrl(message);
      notices[name] = message;
      paint();
      const row = body.querySelector(`[data-server="${CSS.escape(name)}"] .mcp-row-notice`);
      if (row && url) {
        row.append(
          button(t("settings.mcp.open"), "ui-button", () => {
            void deps.control?.openExternal?.(url);
          }),
          button(t("settings.mcp.copy"), "ui-button", () => void copyText(url)),
        );
      }
      if (isTerminalMcpNotice(message)) {
        if (/signed in/i.test(message)) {
          document.dispatchEvent(
            new CustomEvent("spopi-dismiss-mcp-sign-in", { detail: { name } }),
          );
        }
        clearTimeout(timer);
        stopObserve();
        void reload();
      }
    });
    try {
      await runMcpSessionCommand(deps, sub, name);
    } catch (error) {
      clearTimeout(timer);
      stopObserve();
      const message = error instanceof Error ? error.message : String(error);
      const titles = {
        login: "settings.mcp.signIn",
        logout: "settings.mcp.signOut",
        reconnect: "settings.mcp.reconnect",
      };
      deps.notify?.({
        type: "error",
        title: t(titles[/** @type {keyof typeof titles} */ (sub)] || titles.reconnect),
        message,
      });
    }
  }

  function manage() {
    void openMcpManager({
      closeSettings: deps.closeSettings,
      workbench: deps.workbench,
      terminal: deps.terminal,
      notify: deps.notify,
    });
  }

  /**
   * Run a write, report a failure as a toast, then reload either way.
   * @param {string} title
   * @param {() => unknown} run
   */
  async function attempt(title, run) {
    try {
      await run();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      deps.notify?.({ type: "error", title, message });
    }
    await reload();
  }

  paint();
  return {
    reload,
    destroy() {
      document.removeEventListener("spopi-pi-config-changed", onConfig);
      stopObserve();
    },
  };
}

/** @param {string} label @param {string} className @param {() => void} onClick */
function button(label, className, onClick) {
  return /** @type {HTMLButtonElement} */ (
    el("button", { type: "button", class: className, text: label, onClick })
  );
}

/** @param {Date} date */
function formatTime(date) {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
