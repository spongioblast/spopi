// ABOUTME: Renders an image file as an <img> loaded from the raw file URL.
// ABOUTME: Shows a broken-image state on load failure; it has no editing or props to update.

import { rawFileUrl } from "../transport/workspace-http.js";

/**
 * @typedef {object} ImageRendererOptions
 * @property {string} [filePath]
 * @property {string} [fileName]
 * @property {(path: string | undefined) => string} [rawUrlForPath]
 */

/**
 * @param {ImageRendererOptions} options
 */
export function createImageRenderer({ filePath, fileName, rawUrlForPath }) {
  /** @type {HTMLImageElement | null} */
  let imgEl = null;
  /** @type {HTMLDivElement | null} */
  let containerEl = null;

  return {
    /** @param {Element} container */
    mount(container) {
      container.replaceChildren();
      containerEl = document.createElement("div");
      containerEl.className = "file-image-preview";

      imgEl = document.createElement("img");
      imgEl.className = "file-image-img";
      imgEl.alt = fileName || filePath || "";
      imgEl.src =
        typeof rawUrlForPath === "function" ? rawUrlForPath(filePath) : rawFileUrl(filePath);
      imgEl.onerror = () => {
        if (containerEl) {
          containerEl.classList.add("file-image-error");
        }
      };

      containerEl.appendChild(imgEl);
      container.appendChild(containerEl);
    },

    update() {
      // Images have no props to update.
    },

    destroy() {
      if (imgEl) {
        imgEl.src = "";
        imgEl = null;
      }
      if (containerEl?.parentNode) {
        containerEl.parentNode.removeChild(containerEl);
      }
      containerEl = null;
    },

    get contentType() {
      return "image";
    },
  };
}
