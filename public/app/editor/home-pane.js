// ABOUTME: Workspace home when no editor tab is open — never a blank center.
// ABOUTME: The pane only renders summaries. File opening stays with the editor.

import { filePreviewRefs } from "../shell/chrome/file-preview.js";

export function homePaneElement() {
  return document.getElementById("spopi-home");
}

/**
 * @param {Element | null | undefined} paneCenter
 * @param {object} [options]
 * @param {(key: string) => string} [options.t]
 */
export function mountHomePane(paneCenter) {
  if (!paneCenter) return null;
  let home = paneCenter.querySelector(".spopi-home");
  if (!home) {
    home = document.createElement("div");
    home.className = "spopi-home";
    home.id = "spopi-home";
    const preview = filePreviewRefs().panel;
    if (preview?.nextSibling) paneCenter.insertBefore(home, preview.nextSibling);
    else paneCenter.appendChild(home);
  }
  const homeEl = /** @type {HTMLElement} */ (home);
  syncHomeVisibility(homeEl);
  const preview = filePreviewRefs().panel;
  /** @type {MutationObserver | null} */
  let observer = null;
  if (preview) {
    observer = new MutationObserver(() => syncHomeVisibility(homeEl));
    observer.observe(preview, { attributes: true, attributeFilter: ["class"] });
  }
  return {
    element: homeEl,
    destroy() {
      observer?.disconnect();
      observer = null;
      homeEl.remove();
    },
  };
}

/**
 * @param {HTMLElement} home
 */
function syncHomeVisibility(home) {
  const preview = filePreviewRefs().panel;
  const open = preview && !preview.classList.contains("collapsed");
  home.classList.toggle("is-visible", !open);
}
