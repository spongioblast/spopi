// ABOUTME: Renders one git file row and opens that file in the preview.
// ABOUTME: Stage and discard actions are confirmed by the caller.
// ABOUTME: Per-row Git hover actions and keyboard shortcuts for the changes tree.

import { previewFile } from "../chat/file-actions.js";
import { t } from "../i18n/i18n.js";
import { createIcon } from "../ui/icons.js";

/**
 * @param {string} className
 * @param {string} icon
 * @param {string} label
 * @param {() => void} onClick
 * @returns {HTMLButtonElement}
 */
function iconButton(className, icon, label, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `git-row-action ${className}`;
  button.title = label;
  button.setAttribute("aria-label", label);
  const svg = createIcon(icon, { size: 12 });
  if (svg) button.append(svg);
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick();
  });
  return button;
}

/**
 * @param {{
 *   row: HTMLElement,
 *   group: string,
 *   identity: string,
 *   selected: boolean,
 *   onToggleSelect?: (identity: string) => void,
 *   onOpenDiff?: () => void,
 *   onStage: () => void,
 *   onUnstage: () => void,
 *   onDiscard: () => void,
 *   onDelete: () => void,
 *   onOpenFile: () => void,
 * }} options
 * @returns {{ destroy: () => void }}
 */
export function mountGitEntryRow({
  row,
  group,
  identity,
  selected,
  onToggleSelect,
  onOpenDiff,
  onStage,
  onUnstage,
  onDiscard,
  onDelete,
  onOpenFile,
}) {
  row.classList.toggle("git-entry-selected", selected);
  if (selected) row.setAttribute("aria-pressed", "true");
  else row.removeAttribute("aria-pressed");
  if (group === "conflicted") row.title = t("git.conflictHint");

  const actions = document.createElement("span");
  actions.className = "git-row-actions";
  if (group === "changes") {
    actions.append(
      iconButton("git-row-stage", "plus", t("git.stage"), onStage),
      iconButton("git-row-discard", "rotate-cw", t("git.discard"), onDiscard),
      iconButton("git-row-open", "external-link", t("git.openFile"), onOpenFile),
    );
  } else if (group === "staged") {
    actions.append(
      iconButton("git-row-unstage", "minus", t("git.unstage"), onUnstage),
      iconButton("git-row-open", "external-link", t("git.openFile"), onOpenFile),
    );
  } else if (group === "untracked") {
    actions.append(
      iconButton("git-row-stage", "plus", t("git.stage"), onStage),
      iconButton("git-row-delete", "trash-2", t("git.deleteUntracked"), onDelete),
    );
  } else if (group === "conflicted") {
    actions.append(
      iconButton("git-row-stage", "plus", t("git.markResolved"), onStage),
      iconButton("git-row-open", "external-link", t("git.openFile"), onOpenFile),
    );
  }
  row.append(actions);

  const openRow = () => {
    if (group === "conflicted") onOpenFile?.();
    else onOpenDiff?.();
  };

  row.addEventListener("click", (event) => {
    const target = event.target;
    if (
      target &&
      typeof target === "object" &&
      "closest" in target &&
      typeof target.closest === "function" &&
      target.closest(".git-row-actions")
    ) {
      return;
    }
    if (event.shiftKey) {
      onToggleSelect?.(identity);
      return;
    }
    openRow();
  });
  row.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      openRow();
    } else if (event.key === " ") {
      event.preventDefault();
      if (group === "staged") onUnstage?.();
      else onStage?.();
    }
  });

  return { destroy() {} };
}

/** @param {unknown} entry */
export function openWorkingTreeFile(entry) {
  if (!entry || typeof entry !== "object") return;
  const path = /** @type {{ displayPath?: unknown }} */ (entry).displayPath;
  if (typeof path !== "string" || !path) return;
  previewFile(path);
}
