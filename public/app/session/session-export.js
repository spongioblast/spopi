// ABOUTME: Export the active session to HTML through Pi, then reveal the file.
// ABOUTME: The menu only starts this; the path comes back from export_html.

/**
 * @param {unknown} result
 * @returns {string}
 */
function exportedPath(result) {
  if (!result || typeof result !== "object" || !("response" in result)) return "";
  const path = /** @type {{ response?: { data?: { path?: string } } }} */ (result).response?.data
    ?.path;
  return typeof path === "string" ? path : "";
}

/**
 * @param {string} path
 * @returns {string}
 */
function fileUrl(path) {
  if (path.startsWith("file:")) return path;
  const slashed = path.replace(/\\/g, "/");
  return slashed.startsWith("/") ? `file://${slashed}` : `file:///${slashed}`;
}

/**
 * @param {object} runtime
 * @param {unknown} target
 * @param {object | null | undefined} [control]
 * @returns {Promise<{ path: string }>}
 */
export async function exportSessionHtml(runtime, target, control) {
  const request =
    /** @type {{ request?: (payload: object, target?: unknown) => Promise<unknown> }} */ (runtime)
      .request;
  const path = exportedPath(await request?.({ type: "export_html" }, target));
  if (!path) return { path: "" };
  const host =
    /** @type {{ revealPath?: (path: string) => Promise<unknown>, openExternal?: (url: string) => Promise<unknown> }} */ (
      control ?? {}
    );
  if (typeof host.revealPath === "function") await host.revealPath(path);
  else if (typeof host.openExternal === "function") await host.openExternal(fileUrl(path));
  return { path };
}
