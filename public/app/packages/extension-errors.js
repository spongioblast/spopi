// ABOUTME: Remembers extension_error frames for one Pi runtime.
// ABOUTME: package_health reads that runtime's list. It is not persisted.

/**
 * @typedef {{ workspaceId?: string, sessionId?: string, instanceId?: string }} RuntimeKey
 * @typedef {{ error: string, extensionPath: string, packageName: string }} StoredExtensionError
 */

/** @type {Map<string, StoredExtensionError[]>} */
const byRuntime = new Map();

/**
 * @param {RuntimeKey | null | undefined} target
 */
function runtimeKey(target) {
  return [target?.workspaceId || "", target?.sessionId || "", target?.instanceId || ""].join("\0");
}

/**
 * @param {{ error?: unknown, extensionPath?: unknown, path?: unknown, packageName?: unknown }} event
 * @param {RuntimeKey | null | undefined} [target]
 */
export function noteExtensionError(event, target) {
  const key = runtimeKey(target);
  const list = byRuntime.get(key) || [];
  list.push({
    error: String(event?.error || ""),
    extensionPath: String(event?.extensionPath || event?.path || ""),
    packageName: String(event?.packageName || ""),
  });
  if (list.length > 50) list.shift();
  byRuntime.set(key, list);
}

/**
 * @param {RuntimeKey | null | undefined} [target]
 * @returns {StoredExtensionError[]}
 */
export function extensionErrors(target) {
  return (byRuntime.get(runtimeKey(target)) || []).slice();
}
