// ABOUTME: Opens Pi's own /mcp manager in a Pi tab that closes when Pi quits.
// ABOUTME: The Pi tab reloads SPOPI's Pi and the MCP list when it closes.

import { t } from "../../i18n/i18n.js";
import { openPiTab } from "../../terminal/open-in-terminal.js";

/** @typedef {import("../../terminal/open-in-terminal.js").TerminalClientLike} TerminalClientLike */

/**
 * @param {{
 *   closeSettings?: () => void,
 *   workbench?: import("../../terminal/open-in-terminal.js").WorkbenchLike | null,
 *   terminal?: {
 *     client?: TerminalClientLike,
 *     panel?: import("../../terminal/open-in-terminal.js").TerminalPanelLike,
 *   } | null,
 *   notify?: (notice: { type?: string, title?: string, message?: string }) => void,
 * }} deps
 */
export async function openMcpManager(deps) {
  const title = t("settings.mcp.manage");
  const client = deps.terminal?.client;
  if (!(client?.command && client.sendAndAwait && client.tabs instanceof Map)) {
    deps.notify?.({ type: "error", title, message: t("settings.mcp.manageFailed") });
    return;
  }
  try {
    deps.closeSettings?.();
    const written = await openPiTab({
      client,
      panel: deps.terminal?.panel,
      workbench: deps.workbench,
      args: ["--no-session", "--approve", "/mcp"],
    });
    if (!written.wrote) throw new Error(t("settings.mcp.manageFailed"));
    deps.notify?.({ type: "info", title, message: t("settings.mcp.manageToast") });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    deps.notify?.({ type: "error", title, message });
  }
}
