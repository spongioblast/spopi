// ABOUTME: Opens a full-size image overlay from a chat or preview thumbnail.
// ABOUTME: Escape and the backdrop close it.

import { t } from "../i18n/i18n.js";
import { bindModal } from "./dialog.js";

/**
 * Image Lightbox — click-to-zoom for message images.
 *
 * Call mountImageLightbox(container) once on the messages container.
 * Handles both .message-image (user-attached) and .inline-image (markdown) via
 * event delegation so dynamically rendered images are covered automatically.
 */

/** @type {HTMLDivElement | null} */
let overlay = null;

function getOrCreateOverlay() {
  if (overlay) return overlay;

  overlay = document.createElement("div");
  overlay.className = "image-lightbox-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-label", t("chat.lightbox.previewLabel"));

  const img = document.createElement("img");
  img.className = "image-lightbox-img";
  img.alt = "";

  const closeBtn = document.createElement("button");
  closeBtn.className = "image-lightbox-close";
  closeBtn.setAttribute("aria-label", t("shell.closeTitle"));
  closeBtn.innerHTML =
    '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><line x1="3" y1="3" x2="17" y2="17" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="17" y1="3" x2="3" y2="17" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

  overlay.appendChild(img);
  overlay.appendChild(closeBtn);
  document.body.appendChild(overlay);

  // Close on backdrop click (not on image itself)
  overlay.addEventListener("click", (e) => {
    if (
      e.target === overlay ||
      e.target === closeBtn ||
      (e.target instanceof Node && closeBtn.contains(e.target))
    ) {
      closeLightbox();
    }
  });
  bindModal(overlay, {
    onClose: closeLightbox,
    isActive: () => Boolean(overlay?.classList.contains("open")),
  });

  return overlay;
}

/**
 * @param {string} src
 * @param {string} [alt]
 */
function openLightbox(src, alt) {
  const ov = getOrCreateOverlay();
  const img = ov.querySelector(".image-lightbox-img");
  if (!(img instanceof HTMLImageElement)) return;
  img.src = src;
  img.alt = alt || "";
  // Reset any previous animation
  ov.classList.remove("open");
  // Force reflow so the transition fires
  void ov.offsetWidth;
  ov.classList.add("open");
  document.body.style.overflow = "hidden";
}

function closeLightbox() {
  if (!overlay) return;
  overlay.classList.remove("open");
  document.body.style.overflow = "";
}

/**
 * Wire up lightbox click delegation on a container element.
 * Safe to call multiple times on the same container (deduped via dataset flag).
 */
/** @param {HTMLElement} container */
export function mountImageLightbox(container) {
  if (container.dataset.lightboxWired) return;
  container.dataset.lightboxWired = "1";

  container.addEventListener("click", (e) => {
    const target = e.target;
    const img =
      target instanceof Element
        ? target.closest("img.message-image, img.inline-image, img.lightbox-image")
        : null;
    if (!(img instanceof HTMLImageElement)) return;
    e.stopPropagation();
    openLightbox(img.src, img.alt);
  });
}
