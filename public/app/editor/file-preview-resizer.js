// ABOUTME: Sizes the standalone file preview panel: drag and keyboard resizing, clamped to a share of the layout.
// ABOUTME: Inside the SPOPI shell the grid sizes the panel, so these functions do nothing there.

/** @typedef {import("./file-preview-panel.js").FilePreviewPanel} FilePreviewPanel */

const MIN_PANEL_WIDTH = 320;

/** @param {FilePreviewPanel} panel */
function availableWidth(panel) {
  const layoutWidth = panel.panel?.parentElement?.offsetWidth || 0;
  const combinedWidth = (panel.mainContainer?.offsetWidth || 0) + (panel.panel?.offsetWidth || 0);
  return layoutWidth || combinedWidth || panel.mainContainer?.offsetWidth || 800;
}

/**
 * @param {FilePreviewPanel} panel
 * @param {number} width
 */
function applyPanelWidth(panel, width) {
  if (panel._inShell()) return;
  const element = panel.panel;
  if (!element) return;
  const totalWidth = availableWidth(panel);
  const maxWidth = Math.max(1, totalWidth * 0.7);
  const minWidth = Math.min(MIN_PANEL_WIDTH, maxWidth);
  const clampedWidth = Math.max(minWidth, Math.min(maxWidth, width));
  panel.panelRatio = clampedWidth / totalWidth;
  element.style.width = `${Math.round(clampedWidth)}px`;
  element.style.flexBasis = `${Math.round(clampedWidth)}px`;
  panel.resizer?.setAttribute("aria-valuenow", String(Math.round(panel.panelRatio * 100)));
}

/** @param {FilePreviewPanel} panel */
export function updatePanelWidth(panel) {
  if (panel._inShell() || !panel.panel || panel.enlarged) return;
  applyPanelWidth(panel, availableWidth(panel) * panel.panelRatio);
}

/** @param {FilePreviewPanel} panel */
export function mountFilePreviewResizer(panel) {
  const resizer = panel.resizer;
  if (!resizer) return;
  let dragging = false;
  let startX = 0;
  let startWidth = 0;

  /** @param {MouseEvent} event */
  const onMouseDown = (event) => {
    if (event.button !== 0) return;
    dragging = true;
    startX = event.clientX;
    startWidth = panel.panel?.offsetWidth || 0;
    resizer.classList.add("dragging");
    document.body.classList.add("file-preview-resizing");
    event.preventDefault();
  };
  /** @param {MouseEvent} event */
  const onMouseMove = (event) => {
    if (!dragging) return;
    applyPanelWidth(panel, startWidth + startX - event.clientX);
  };
  const finishDrag = () => {
    if (!dragging) return;
    dragging = false;
    resizer.classList.remove("dragging");
    document.body.classList.remove("file-preview-resizing");
    panel._savePreferences();
  };
  /** @param {KeyboardEvent} event */
  const onKeyDown = (event) => {
    const currentWidth = panel.panel?.offsetWidth || availableWidth(panel) * panel.panelRatio;
    let nextWidth = currentWidth;
    if (event.key === "ArrowLeft") nextWidth += 16;
    else if (event.key === "ArrowRight") nextWidth -= 16;
    else if (event.key === "Home") nextWidth = MIN_PANEL_WIDTH;
    else if (event.key === "End") nextWidth = availableWidth(panel) * 0.7;
    else return;
    event.preventDefault();
    applyPanelWidth(panel, nextWidth);
    panel._savePreferences();
  };
  const onResize = () => updatePanelWidth(panel);

  panel._listen(resizer, "mousedown", /** @type {EventListener} */ (onMouseDown));
  panel._listen(document, "mousemove", /** @type {EventListener} */ (onMouseMove));
  panel._listen(document, "mouseup", finishDrag);
  panel._listen(resizer, "keydown", /** @type {EventListener} */ (onKeyDown));
  panel._listen(window, "resize", onResize);
  panel.cleanupListeners.push(() => {
    dragging = false;
    resizer.classList.remove("dragging");
    document.body.classList.remove("file-preview-resizing");
  });
}
