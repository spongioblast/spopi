// ABOUTME: Reads tool call args and results for the tool card: header preview, JSON, text, images, saved path.
// ABOUTME: Pure data helpers with no DOM; tool-card.js and tool-card-parts.js build the nodes.

/**
 * @typedef {object} ToolArgs
 * @property {string} [path]
 * @property {string} [file_path]
 * @property {string} [filePath]
 * @property {string} [command]
 * @property {string} [query]
 * @property {string} [url]
 * @property {string} [oldText]
 * @property {string} [old_text]
 * @property {string} [newText]
 * @property {string} [new_text]
 */

/**
 * @typedef {object} ToolResultContentBlock
 * @property {string} [type]
 * @property {string} [text]
 * @property {string} [data]
 * @property {string} [mimeType]
 */

/**
 * @typedef {object} ToolResult
 * @property {ToolResultContentBlock[]} [content]
 * @property {{ spopiToolOutput?: { path?: unknown } }} [details]
 */

/**
 * @typedef {{
 *   calls?: Array<{ id?: string, name?: string, status?: string, arguments?: unknown, error?: string }>,
 *   complete?: boolean,
 * }} NestedCallRecord
 */

/**
 * A screenshot is hundreds of KB of base64; the card names it instead of printing it.
 * @param {ToolResultContentBlock} block
 */
function imagePlaceholder(block) {
  const kb = Math.round(((block.data?.length ?? 0) * 3) / 4 / 1024);
  return `[image ${block.mimeType ?? ""}, ${kb} KB]`.replace(" ,", ",");
}

const RENDERABLE_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
/** About 9 MB of base64. Larger blocks stay as a text placeholder. */
const MAX_IMAGE_DATA_CHARS = 12_000_000;

/**
 * @param {ToolResultContentBlock | null | undefined} block
 */
function isRenderableImage(block) {
  return (
    block?.type === "image" &&
    typeof block.data === "string" &&
    RENDERABLE_IMAGE_TYPES.has(block.mimeType ?? "") &&
    block.data.length <= MAX_IMAGE_DATA_CHARS
  );
}

/**
 * @param {ToolResult | string | null | undefined} result
 * @returns {NestedCallRecord | null}
 */
export function nestedRecord(result) {
  if (!result || typeof result !== "object") return null;
  const record = /** @type {{ nestedCalls?: NestedCallRecord }} */ (result).nestedCalls;
  return record && typeof record === "object" ? record : null;
}

/**
 * Image blocks safe to put in an img src. SVG is never included.
 * @param {ToolResult | string | null | undefined} result
 * @returns {ToolResultContentBlock[]}
 */
export function resultImages(result) {
  if (!result || typeof result !== "object" || !Array.isArray(result.content)) return [];
  return result.content.filter((block) => isRenderableImage(block));
}

/**
 * Project-relative file where spopi-tool-output saved a long result, or "".
 * @param {ToolResult | string | null | undefined} result
 */
export function savedOutputPath(result) {
  if (!result || typeof result !== "object") return "";
  const path = result.details?.spopiToolOutput?.path;
  return typeof path === "string" ? path : "";
}

/**
 * @param {ToolArgs | null | undefined} args
 */
export function filePathFromArgs(args) {
  if (!args || typeof args !== "object") return "";
  /** @type {Array<"path" | "file_path" | "filePath">} */
  const keys = ["path", "file_path", "filePath"];
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

/**
 * Compact preview for the header line.
 * @param {ToolArgs | null | undefined} [args]
 */
export function toolArgsPreview(args) {
  if (!args || Object.keys(args).length === 0) return "";

  const filePath = filePathFromArgs(args);
  if (filePath) return filePath;

  // Show the most relevant arg inline
  if (args.command) return args.command.substring(0, 80);
  if (args.query) return args.query.substring(0, 60);
  if (args.url) return args.url;

  // Fallback: first string value
  for (const val of Object.values(args)) {
    if (typeof val === "string" && val.length > 0) {
      return val.substring(0, 60);
    }
  }
  return "";
}

/**
 * @param {ToolArgs | object | null | undefined} obj
 */
export function formatToolJson(obj) {
  try {
    if (!obj || Object.keys(obj).length === 0) return "";
    return JSON.stringify(obj, null, 2);
  } catch {
    return String(obj);
  }
}

/**
 * @param {ToolResult | string | null | undefined} result
 * @param {{ includeImages?: boolean }} [options]
 */
export function formatToolResult(result, { includeImages = true } = {}) {
  if (!result) return "";

  if (typeof result === "object" && result.content && Array.isArray(result.content)) {
    return (
      result.content
        .filter(Boolean)
        .filter((block) => includeImages || !isRenderableImage(block))
        /**
         * @param {ToolResultContentBlock} block
         */
        .map((block) => {
          if (block.type === "text") return block.text;
          if (block.type === "image") return imagePlaceholder(block);
          return JSON.stringify(block);
        })
        .join("\n")
    );
  }

  return JSON.stringify(result, null, 2);
}
