// ABOUTME: One MCP server row: status, transport, exposure, a project override, and its actions.
// ABOUTME: Sign in stays on the row; the rest sit in a menu. Extension rows have no actions.

import { t } from "../../i18n/i18n.js";
import { showContextMenu } from "../../ui/context-menu.js";
import { confirmDialog } from "../../ui/dialog.js";
import { el } from "../../ui/dom.js";
import { createIcon } from "../../ui/icons.js";
import { isHttp, rowState } from "./mcp-model.js";

/**
 * @param {Record<string, unknown>} server
 * @param {{
 *   onSignIn?: (name: string) => void,
 *   onSignOut?: (name: string) => void,
 *   onReconnect?: (name: string) => void,
 *   onRemove?: (name: string, scope: string) => void,
 *   notice?: string,
 * }} actions
 */
export function renderServerRow(server, actions = {}) {
  const name = String(server.name ?? "");
  const scope = String(server.scope ?? "");
  const state = rowState(server);
  const tools = Array.isArray(server.tools) ? server.tools : [];
  const summary =
    server.state === "connected"
      ? t("settings.mcp.tools", { count: tools.length })
      : t(state.labelKey);
  const http = isHttp(server);
  const transport = String(server.transport ?? "");
  const head = el("div", { class: "mcp-row-head" }, [
    el("span", { class: `mcp-dot mcp-dot--${state.dot}`, title: t(state.labelKey) }),
    el("span", { class: "mcp-row-name", text: name }),
    el("span", { class: "mcp-row-transport", text: transport, title: transport }),
    el("span", { class: "mcp-chip", text: String(server.exposure ?? "") }),
    el("span", { class: "mcp-row-summary", text: summary }),
  ]);
  if (scope !== "extension") head.append(rowActions(server, name, scope, http, actions));
  /** @type {Array<Node>} */
  const children = [head];
  if (typeof server.override === "string" && server.override) {
    children.push(
      el("p", {
        class: "mcp-row-override",
        text: t("settings.mcp.override", { path: server.override }),
      }),
    );
  }
  if (actions.notice) {
    children.push(el("p", { class: "mcp-row-notice", text: actions.notice }));
  }
  children.push(details(server, tools));
  return el("div", { class: "mcp-server-row", dataset: { server: name, scope } }, children);
}

/**
 * @param {Record<string, unknown>} server
 * @param {string} name
 * @param {string} scope
 * @param {boolean} http
 * @param {NonNullable<Parameters<typeof renderServerRow>[1]>} actions
 */
function rowActions(server, name, scope, http, actions) {
  const box = el("div", { class: "mcp-row-actions" });
  if (http) {
    box.append(
      el("button", {
        class: server.state === "needs-auth" ? "ui-button ui-button--primary" : "ui-button",
        type: "button",
        text: t("settings.mcp.signIn"),
        onClick: () => actions.onSignIn?.(name),
      }),
    );
  }
  const more = /** @type {HTMLButtonElement} */ (
    el("button", {
      class: "ui-icon-button ui-icon-button--sm ui-icon-button--ghost mcp-row-more",
      type: "button",
      title: t("settings.mcp.more"),
      aria: { label: t("settings.mcp.more"), haspopup: "menu" },
    })
  );
  const icon = createIcon("ellipsis", { size: 14 });
  if (icon) more.append(icon);
  more.addEventListener("click", (event) => {
    // The session sidebar closes the shared menu on any document click.
    event.stopPropagation();
    const rect = more.getBoundingClientRect();
    const items = [];
    if (http) {
      items.push({ label: t("settings.mcp.signOut"), action: () => actions.onSignOut?.(name) });
    }
    items.push(
      { label: t("settings.mcp.reconnect"), action: () => actions.onReconnect?.(name) },
      { separator: true },
      {
        label: t("settings.mcp.remove"),
        action: async () => {
          const ok = await confirmDialog({
            title: t("settings.mcp.remove"),
            message: t("settings.mcp.removeConfirm", { name }),
            danger: true,
          });
          if (ok) actions.onRemove?.(name, scope);
        },
      },
    );
    showContextMenu({ event: { clientX: rect.left, clientY: rect.bottom }, items });
  });
  box.append(more);
  return box;
}

/**
 * @param {Record<string, unknown>} server
 * @param {unknown[]} tools
 */
function details(server, tools) {
  const overrides =
    server.toolExposure && typeof server.toolExposure === "object"
      ? /** @type {Record<string, string>} */ (server.toolExposure)
      : {};
  const resources = Number(server.resources ?? 0);
  const templates = Number(server.resourceTemplates ?? 0);
  const extra = [
    tools
      .map((tool) =>
        overrides[String(tool)] ? `${tool} (${overrides[String(tool)]})` : String(tool),
      )
      .join("\n"),
    resources ? t("settings.mcp.resources", { count: resources }) : "",
    templates ? t("settings.mcp.templates", { count: templates }) : "",
    typeof server.error === "string" ? server.error : "",
  ]
    .filter(Boolean)
    .join("\n");
  return el("details", { class: "mcp-row-details" }, [
    el("summary", { text: t("settings.mcp.details") }),
    el("pre", { class: "mcp-row-extra", text: extra }),
  ]);
}
