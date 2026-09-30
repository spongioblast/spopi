// ABOUTME: Session context-menu rows, including duplicate and add label.
// ABOUTME: The sidebar supplies the actions; this module only builds the rows.

import { t } from "../i18n/i18n.js";

/**
 * @typedef {{ separator?: boolean, label?: string, action?: () => void }} MenuRow
 * @typedef {{
 *   id?: string,
 *   filePath?: string | null,
 *   projectPath?: string | null,
 * }} MenuSession
 * @typedef {{
 *   activeSessionId?: string | null,
 *   isFavourite: (id: string) => boolean,
 *   toggleFavourite: (id: string) => void,
 *   isArchived: (id: string) => boolean,
 *   toggleArchived: (id: string) => void,
 *   isSessionPinned: (id: string) => boolean,
 *   isWorkspacePinned: (path: string) => boolean,
 *   pinSession: (id: string) => void,
 *   unpinSession: (id: string) => void,
 *   render: () => void,
 *   generateTitle: (session: MenuSession) => void,
 *   startRename: (session: MenuSession) => void,
 *   duplicateSession: () => void,
 *   addLabel: () => void,
 *   exportHtml: () => void,
 * }} MenuActions
 */

/**
 * @param {MenuSession} session
 * @param {MenuActions} actions
 * @returns {MenuRow[]}
 */
export function sessionMenuRows(session, actions) {
  const id = session.id ?? "";
  const workspacePinned = session.projectPath
    ? actions.isWorkspacePinned(session.projectPath)
    : false;
  /** @type {MenuRow[]} */
  const rows = [];
  if (session.filePath) {
    rows.push({ label: t("sidebar.rename"), action: () => actions.startRename(session) });
    rows.push({ separator: true });
  }
  rows.push(
    {
      label: actions.isFavourite(id) ? t("sidebar.unfavourite") : t("sidebar.favourite"),
      action: () => actions.toggleFavourite(id),
    },
    {
      label: actions.isArchived(id) ? t("sidebar.unarchive") : t("sidebar.archive"),
      action: () => actions.toggleArchived(id),
    },
  );
  if (session.id === actions.activeSessionId) {
    rows.push({ label: t("sidebar.generateTitle"), action: () => actions.generateTitle(session) });
    rows.push({
      label: t("sidebar.duplicateSession"),
      action: () => actions.duplicateSession(),
    });
    rows.push({ label: t("sidebar.addLabel"), action: () => actions.addLabel() });
    rows.push({ label: t("sidebar.exportHtml"), action: () => actions.exportHtml() });
  }
  if (!session.filePath) return rows;
  rows.push({ separator: true });
  if (!workspacePinned) {
    const pinned = actions.isSessionPinned(id);
    rows.push({
      label: pinned ? t("sidebar.unpinSession") : t("sidebar.pinSession"),
      action: () => {
        if (pinned) actions.unpinSession(id);
        else actions.pinSession(id);
        actions.render();
      },
    });
  }
  return rows;
}
