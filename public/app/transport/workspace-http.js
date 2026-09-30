// ABOUTME: File, git, and search reads go through one host HTTP client.
// ABOUTME: Callers pass a path; this module owns the /api request shape.

/**
 * @typedef {typeof fetch} FetchImpl
 *
 * @typedef {object} FileRequestOptions
 * @property {AbortSignal} [signal]
 * @property {string} [workspaceId]
 * @property {FetchImpl} [fetchImpl]
 *
 * @typedef {object} WriteFileOptions
 * @property {string} [path]
 * @property {string} [content]
 * @property {number} [expectedMtimeMs]
 * @property {boolean} [force]
 * @property {string} [workspaceId]
 * @property {FetchImpl} [fetchImpl]
 *
 * @typedef {object} CreateFileApiOptions
 * @property {() => string | null | undefined} [workspaceId]
 * @property {(workspaceId: string, path: string, showHidden: boolean) => unknown} [listFiles]
 * @property {FetchImpl} [fetchImpl]
 *
 * @typedef {object} ListDirOptions
 * @property {boolean} [showHidden]
 */

/**
 * @param {string} base
 * @param {string | null | undefined} path
 * @param {string | null | undefined} workspaceId
 */
function endpoint(base, path, workspaceId) {
  const params = new URLSearchParams();
  if (workspaceId) params.set("workspaceId", workspaceId);
  if (path != null) params.set("path", path);
  const text = params.toString();
  return text ? `${base}?${text}` : base;
}

/**
 * @param {string} path
 * @param {FileRequestOptions} [options]
 */
export function readFile(path, { signal, workspaceId, fetchImpl = fetch } = {}) {
  return fetchImpl(endpoint("/api/files/content", path, workspaceId), { signal });
}

/**
 * @param {WriteFileOptions} [options]
 */
export function writeFile({
  path,
  content,
  expectedMtimeMs,
  force,
  workspaceId,
  fetchImpl = fetch,
} = {}) {
  return fetchImpl("/api/files/content", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      workspaceId,
      path,
      content,
      expectedMtimeMs,
      force,
    }),
  });
}

/**
 * @param {string | null | undefined} path
 * @param {string | null | undefined} [workspaceId]
 */
export function rawFileUrl(path, workspaceId) {
  return endpoint("/api/files/raw", path, workspaceId);
}

/**
 * @param {string} path
 * @param {FileRequestOptions} [options]
 */
function gitDiff(path, { signal, workspaceId, fetchImpl = fetch } = {}) {
  return fetchImpl(endpoint("/api/git/diff", path, workspaceId), { signal });
}

/**
 * @param {FileRequestOptions} [options]
 */
function gitStat({ signal, workspaceId, fetchImpl = fetch } = {}) {
  return fetchImpl(endpoint("/api/git/stat", null, workspaceId), { signal });
}

/**
 * @param {string} queryText
 * @param {FileRequestOptions} [options]
 */
export function search(queryText, { workspaceId, signal, fetchImpl = fetch } = {}) {
  const params = new URLSearchParams();
  params.set("workspaceId", workspaceId || "");
  params.set("q", queryText);
  return fetchImpl(`/api/search?${params}`, { signal });
}

/**
 * @param {CreateFileApiOptions} [options]
 */
export function createFileApi({ workspaceId, listFiles, fetchImpl = fetch } = {}) {
  const id = () => workspaceId?.() || "";
  return {
    /**
     * @param {string} path
     * @param {FileRequestOptions} [options]
     */
    readFile(path, options = {}) {
      return readFile(path, { ...options, workspaceId: id(), fetchImpl });
    },
    /**
     * @param {string} path
     * @param {FileRequestOptions} [options]
     */
    readFileContent(path, options) {
      return this.readFile(path, options);
    },
    /**
     * @param {WriteFileOptions} args
     */
    writeFile(args) {
      return writeFile({ ...args, workspaceId: args.workspaceId ?? id(), fetchImpl });
    },
    /**
     * @param {WriteFileOptions} args
     */
    writeFileContent(args) {
      return this.writeFile(args);
    },
    /**
     * @param {string} path
     */
    rawUrlForPath(path) {
      return rawFileUrl(path, id());
    },
    /**
     * @param {string} path
     * @param {ListDirOptions} [options]
     */
    listDir(path, { showHidden = false } = {}) {
      if (typeof listFiles !== "function") throw new Error("listDir needs listFiles");
      return listFiles(id(), path, showHidden);
    },
    /**
     * @param {string} path
     * @param {FileRequestOptions} [options]
     */
    gitDiff(path, options = {}) {
      return gitDiff(path, { ...options, workspaceId: id(), fetchImpl });
    },
    /**
     * @param {string} path
     * @param {FileRequestOptions} [options]
     */
    readGitDiff(path, options) {
      return this.gitDiff(path, options);
    },
    /**
     * @param {FileRequestOptions} [options]
     */
    gitStat(options = {}) {
      return gitStat({ ...options, workspaceId: id(), fetchImpl });
    },
    /**
     * @param {FileRequestOptions} [options]
     */
    readGitStat(options) {
      return this.gitStat(options);
    },
    /**
     * @param {string} queryText
     * @param {FileRequestOptions} [options]
     */
    search(queryText, options = {}) {
      return search(queryText, { ...options, workspaceId: id(), fetchImpl });
    },
  };
}
