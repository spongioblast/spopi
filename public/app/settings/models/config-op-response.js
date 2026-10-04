// ABOUTME: Narrows a config gateway reply and a thrown value for the Models editor modules.
// ABOUTME: Pure helpers with no DOM and no calls of their own.

/**
 * @typedef {{
 *   ok?: boolean,
 *   error?: string,
 *   data?: Record<string, unknown>,
 * }} ConfigOpResponse
 */

/** @param {unknown} error */
export function errorMessage(error) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    return String(/** @type {{ message: unknown }} */ (error).message ?? "");
  }
  return "";
}

/** @param {unknown} value */
export function asConfigOpResponse(value) {
  if (!value || typeof value !== "object") return /** @type {ConfigOpResponse | null} */ (null);
  return /** @type {ConfigOpResponse} */ (value);
}
