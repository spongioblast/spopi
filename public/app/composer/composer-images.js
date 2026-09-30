// ABOUTME: Attaches pasted and picked images to the composer.
// ABOUTME: Each attachment can be removed before the message is sent.

import { mountImageLightbox } from "../ui/image-lightbox.js";

const MAX_IMAGE_DIMENSION = 2048;
const VALID_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

/**
 * @typedef {object} ComposerImage
 * @property {"image"} type
 * @property {string} data
 * @property {string} mimeType
 */

/**
 * @typedef {object} ComposerImageAttachmentsOptions
 * @property {HTMLElement | null | undefined} [input]
 * @property {HTMLElement | null | undefined} [attachButton]
 * @property {HTMLInputElement | null | undefined} [imageInput]
 * @property {HTMLElement | null | undefined} [previewContainer]
 * @property {HTMLElement | null | undefined} [dropTarget]
 * @property {(file: File) => Promise<ComposerImage>} [processImageFile]
 * @property {(error: unknown) => void} [onError]
 */

/** @param {string} type */
function normalizeMimeType(type) {
  return VALID_MIME_TYPES.has(type) ? type : "image/png";
}

/** @param {File} file */
function defaultProcessImageFile(file) {
  return new Promise((resolve, reject) => {
    const mimeType = normalizeMimeType(file.type);
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read image"));
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        let { width, height } = image;
        if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
          const scale = MAX_IMAGE_DIMENSION / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        if (!context) {
          reject(new Error("Failed to create canvas context"));
          return;
        }
        context.drawImage(image, 0, 0, width, height);

        const outputMimeType = mimeType === "image/jpeg" ? "image/jpeg" : "image/png";
        const quality = outputMimeType === "image/jpeg" ? 0.85 : undefined;
        const base64 = canvas.toDataURL(outputMimeType, quality).split(",")[1];
        if (!base64) {
          reject(new Error("Failed to encode image"));
          return;
        }
        resolve({ type: "image", data: base64, mimeType: outputMimeType });
      };
      image.onerror = () => reject(new Error("Failed to decode image"));
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Failed to read image"));
        return;
      }
      image.src = result;
    };
    reader.readAsDataURL(file);
  });
}

/**
 * @param {ComposerImageAttachmentsOptions} options
 */
export function mountComposerImageAttachments({
  input,
  attachButton,
  imageInput,
  previewContainer,
  dropTarget,
  processImageFile = defaultProcessImageFile,
  onError = console.error,
}) {
  if (!previewContainer) {
    return {
      async addFiles() {},
      getImages: () => [],
      setImages() {},
      clear() {},
    };
  }

  const previews = previewContainer;

  /** @type {ComposerImage[]} */
  let pendingImages = [];

  mountImageLightbox(previews);

  function renderPreviews() {
    previews.innerHTML = "";
    previews.classList.toggle("hidden", pendingImages.length === 0);
    pendingImages.forEach((image, index) => {
      const preview = document.createElement("div");
      preview.className = "image-preview";

      const thumbnail = document.createElement("img");
      thumbnail.className = "lightbox-image";
      thumbnail.src = `data:${image.mimeType};base64,${image.data}`;
      thumbnail.alt = "Attached image preview";

      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "image-preview-remove";
      removeButton.dataset.index = String(index);
      removeButton.textContent = "✕";
      removeButton.addEventListener("click", () => {
        pendingImages.splice(index, 1);
        renderPreviews();
      });

      preview.append(thumbnail, removeButton);
      previews.appendChild(preview);
    });
  }

  /** @param {FileList | File[] | null | undefined} files */
  async function addFiles(files) {
    const imageFiles = Array.from(files ?? []).filter((file) => file?.type?.startsWith("image/"));
    for (const file of imageFiles) {
      try {
        pendingImages.push(await processImageFile(file));
      } catch (error) {
        onError(error);
      }
    }
    renderPreviews();
  }

  function getImages() {
    return pendingImages.map((image) => ({ ...image }));
  }

  /** @param {ComposerImage[] | null | undefined} images */
  function setImages(images) {
    pendingImages = Array.from(images ?? []).map((image) => ({ ...image }));
    renderPreviews();
  }

  function clear() {
    pendingImages = [];
    renderPreviews();
  }

  attachButton?.addEventListener("click", () => imageInput?.click());
  imageInput?.addEventListener("change", () => {
    addFiles(imageInput.files);
    imageInput.value = "";
  });
  dropTarget?.addEventListener("dragover", (event) => {
    event.preventDefault();
  });
  dropTarget?.addEventListener("drop", (event) => {
    const dragEvent = /** @type {DragEvent} */ (event);
    dragEvent.preventDefault();
    addFiles(dragEvent.dataTransfer?.files);
  });
  input?.addEventListener("paste", (event) => {
    const clipboardEvent = /** @type {ClipboardEvent} */ (event);
    const files = Array.from(clipboardEvent.clipboardData?.items ?? [])
      .filter((item) => item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter(Boolean);
    if (files.length > 0) addFiles(/** @type {File[]} */ (files));
  });
  renderPreviews();

  return { addFiles, getImages, setImages, clear };
}
