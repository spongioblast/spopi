// ABOUTME: Renders a PDF into canvases with pdf.js.
// ABOUTME: The worker script is loaded on the first PDF, not at startup.

import { rawFileUrl } from "../transport/workspace-http.js";

/**
 * PDF.js canvas renderer.
 *
 * Renders PDF pages into canvas elements inside a scrollable container.
 * The worker is configured to use the same-origin vendor bundle.
 * At runtime, the browser import map redirects pdfjs-dist/legacy/build/pdf.mjs
 * to the generated vendor file. In Vitest, the import resolves from node_modules.
 */

/**
 * @typedef {{
 *   promise: Promise<PdfDocumentLike>,
 *   destroy?: () => void | Promise<void>,
 * }} PdfLoadingTask
 * @typedef {{
 *   numPages: number,
 *   getPage: (n: number) => Promise<PdfPageLike>,
 *   destroy?: () => void | Promise<void>,
 * }} PdfDocumentLike
 * @typedef {{
 *   getViewport: (opts: { scale: number }) => { width: number, height: number },
 *   render: (opts: {
 *     canvasContext: CanvasRenderingContext2D,
 *     viewport: { width: number, height: number },
 *   }) => { promise: Promise<void>, cancel?: () => void },
 * }} PdfPageLike
 * @typedef {{
 *   GlobalWorkerOptions?: { workerSrc: string },
 *   getDocument: (src: unknown) => PdfLoadingTask,
 * }} PdfModule
 */

/** @type {PdfModule | null} */
let pdfModule = null;

async function loadPdfModule() {
  if (!pdfModule) {
    pdfModule = /** @type {PdfModule} */ (
      /** @type {unknown} */ (await import("pdfjs-dist/legacy/build/pdf.mjs"))
    );
    if (typeof window !== "undefined" && pdfModule.GlobalWorkerOptions) {
      pdfModule.GlobalWorkerOptions.workerSrc = "/vendor/pdf.worker.js";
    }
  }
  return pdfModule;
}

/**
 * @param {object} [options]
 * @param {string} [options.filePath]
 * @param {((error: unknown) => void) | undefined} [options.onError]
 * @param {((path: string) => string) | undefined} [options.rawUrlForPath]
 * @param {((src: unknown) => PdfLoadingTask) | undefined} [options.getDocumentImpl]
 */
export function createPdfRenderer({ filePath, onError, rawUrlForPath, getDocumentImpl } = {}) {
  /** @type {HTMLElement | null} */
  let container = null;
  /** @type {PdfDocumentLike | null} */
  let pdfDoc = null;
  /** @type {PdfLoadingTask | null} */
  let loadingTask = null;
  /** @type {{ promise: Promise<void>, cancel?: () => void } | null} */
  let renderTask = null;
  let destroyed = false;

  async function loadDocument() {
    if (!container || destroyed) return;
    try {
      const url =
        typeof rawUrlForPath === "function" ? rawUrlForPath(filePath || "") : rawFileUrl(filePath);
      const openDocument = getDocumentImpl ?? (await loadPdfModule()).getDocument;
      const task = openDocument({ url });
      loadingTask = task;
      const loadedDocument = await task.promise;
      if (loadingTask === task) loadingTask = null;

      if (destroyed || !container) {
        void loadedDocument.destroy?.();
        return;
      }
      pdfDoc = loadedDocument;

      for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
        if (destroyed || !container) return;
        const page = await pdfDoc.getPage(pageNum);
        if (destroyed || !container) return;
        const viewport = page.getViewport({ scale: 1.5 });

        const canvas = document.createElement("canvas");
        canvas.className = "file-pdf-page";
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        container.appendChild(canvas);

        const context = canvas.getContext("2d");
        if (!context) throw new Error("Canvas 2D context is unavailable");
        renderTask = page.render({ canvasContext: context, viewport });
        await renderTask.promise;
        renderTask = null;
      }
    } catch (error) {
      if (!destroyed && typeof onError === "function") onError(error);
    } finally {
      loadingTask = null;
    }
  }

  return {
    /**
     * @param {Element} parent
     */
    mount(parent) {
      destroyed = false;
      container = document.createElement("div");
      container.className = "file-pdf-container";
      parent.appendChild(container);
      void loadDocument();
    },

    update() {
      // PDF preview has no props to update.
    },

    destroy() {
      destroyed = true;
      renderTask?.cancel?.();
      renderTask = null;
      const activeLoadingTask = loadingTask;
      loadingTask = null;
      void activeLoadingTask?.destroy?.();
      const activeDocument = pdfDoc;
      pdfDoc = null;
      void activeDocument?.destroy?.();
      container?.remove();
      container = null;
    },
  };
}
