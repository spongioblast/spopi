// ABOUTME: Re-exports the pdf.js entry used by the import map.
// ABOUTME: The worker file is separate and loaded on the first PDF.
// Vendor bundle entry for PDF.js.
// Bundled by scripts/build-frontend.js into public/vendor/pdf.js.
// The browser import map maps pdfjs-dist/legacy/build/pdf.mjs to this file.
// The worker is emitted separately as public/vendor/pdf.worker.js.
export { GlobalWorkerOptions, getDocument, version } from "pdfjs-dist/legacy/build/pdf.mjs";
