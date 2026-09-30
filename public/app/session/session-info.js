// ABOUTME: Describes the active session file and id for the header.
// ABOUTME: It reads the sidebar session list and does not rename sessions.

import { basenameLocalPath } from "../files/path-utils.js";
import { t } from "../i18n/i18n.js";

/**
 * Compact label for a session file path; copy/hover still use the full path.
 * @param {string | null | undefined} filePath
 * @param {string} inMemoryLabel
 * @returns {{ text: string, title: string, copyValue: string }}
 */
export function describeSessionFile(filePath, inMemoryLabel) {
  if (!filePath) {
    return { text: inMemoryLabel, title: "", copyValue: inMemoryLabel };
  }
  return {
    text: basenameLocalPath(filePath) || filePath,
    title: filePath,
    copyValue: filePath,
  };
}

/**
 * @param {string | null | undefined} sessionId
 * @param {string} unavailableLabel
 * @returns {{ text: string, title: string, copyValue: string }}
 */
export function describeSessionId(sessionId, unavailableLabel) {
  if (!sessionId) {
    return { text: unavailableLabel, title: "", copyValue: unavailableLabel };
  }
  return { text: sessionId, title: sessionId, copyValue: sessionId };
}

/**
 * @param {HTMLElement} el
 * @param {{ text: string, title?: string }} options
 */
function paintSessionInfoValue(el, { text, title }) {
  el.textContent = text;
  if (title) el.setAttribute("title", title);
  else el.removeAttribute("title");
}

/**
 * @param {() => { sessionId?: string } | null | undefined} getTarget
 * @param {(() => Array<{ id?: string, filePath?: string }>) | null | undefined} getSessions
 */
export function activeSession(getTarget, getSessions) {
  const sessionId = getTarget()?.sessionId ?? "";
  return {
    id: sessionId,
    session: getSessions?.().find((item) => item?.id === sessionId) ?? null,
  };
}

/**
 * @param {object} options
 * @param {HTMLElement | null | undefined} options.toggle
 * @param {HTMLElement | null | undefined} options.panel
 * @param {HTMLElement | null | undefined} options.fileValue
 * @param {HTMLElement | null | undefined} options.idValue
 * @param {() => { sessionId?: string } | null | undefined} options.getTarget
 * @param {(() => Array<{ id?: string, filePath?: string }>) | null | undefined} options.getSessions
 * @param {(text: string) => Promise<void> | void | undefined} [options.writeText]
 */
export function mountSessionInfo({
  toggle,
  panel,
  fileValue,
  idValue,
  getTarget,
  getSessions,
  writeText = (text) => navigator.clipboard?.writeText(text),
}) {
  if (!toggle || !panel || !fileValue || !idValue) return { refresh() {} };

  // Match the Context usage popover: portal to <body> so the header's
  // horizontal scroller cannot clip the panel.
  if (panel.parentElement !== document.body) document.body.appendChild(panel);

  const refresh = () => {
    const { id, session } = activeSession(getTarget, getSessions);
    const filePath = session?.filePath || "";
    const file = describeSessionFile(filePath, t("sessionInfo.inMemory"));
    const idDesc = describeSessionId(id, t("sessionInfo.unavailable"));
    paintSessionInfoValue(fileValue, file);
    paintSessionInfoValue(idValue, idDesc);
    fileValue.dataset.copyValue = file.copyValue;
    idValue.dataset.copyValue = idDesc.copyValue;
    return { id, filePath };
  };

  const close = () => {
    panel.classList.add("hidden");
    toggle.setAttribute("aria-expanded", "false");
  };

  toggle.addEventListener("click", (event) => {
    event.stopPropagation();
    if (!panel.classList.contains("hidden")) {
      close();
      return;
    }
    refresh();
    const rect = toggle.getBoundingClientRect();
    panel.style.position = "fixed";
    panel.style.top = `${rect.bottom + 8}px`;
    panel.style.left = `${rect.left}px`;
    panel.style.right = "auto";
    panel.classList.remove("hidden");
    toggle.setAttribute("aria-expanded", "true");
  });

  document.addEventListener("click", (event) => {
    if (!(event.target instanceof Node)) return;
    if (!panel.contains(event.target) && event.target !== toggle) close();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") close();
  });

  for (const button of panel.querySelectorAll("[data-copy-session-field]")) {
    if (!(button instanceof HTMLElement)) continue;
    button.addEventListener("click", async () => {
      const value =
        button.dataset.copySessionField === "file"
          ? fileValue.dataset.copyValue || fileValue.textContent
          : idValue.dataset.copyValue || idValue.textContent;
      const defaultLabel = t(
        button.dataset.copySessionField === "file" ? "sessionInfo.copyFile" : "sessionInfo.copyId",
      );
      try {
        const result = writeText?.(value ?? "");
        if (!result) throw new Error("Clipboard unavailable");
        await result;
        button.title = t("sessionInfo.copied");
        button.setAttribute("aria-label", t("sessionInfo.copied"));
      } catch {
        button.title = t("sessionInfo.copyFailed");
        button.setAttribute("aria-label", t("sessionInfo.copyFailed"));
      }
      setTimeout(() => {
        button.title = defaultLabel;
        button.setAttribute("aria-label", defaultLabel);
      }, 1500);
    });
  }

  return { refresh };
}
