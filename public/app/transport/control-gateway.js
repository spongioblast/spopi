// ABOUTME: Sends host control operations such as opening a folder or a session.
// ABOUTME: It rides the same WebSocket adapter as the runtime gateway.

import { createRequestIds } from "./request-id.js";

// Host control gateway: sends `host_request` frames over the native /v2/ws
// protocol and resolves the matching `host_response`. This is the write-capable
// counterpart to the read-only HostDataGateway — it covers package management
// and opening external links, which run the embedded `pi` CLI on the Rust host.
//
// Requests are correlated by a `host-` prefixed requestId; frames that don't
// match a pending request are ignored (other gateways share the same adapter).

/**
 * @typedef {{
 *   send: (frame: Record<string, unknown>) => void,
 *   setReceiver: (listener: (frame: HostFrame) => void) => void,
 *   setConnectionListener?: (listener: (connected: boolean) => void) => void,
 * }} HostControlAdapter
 * @typedef {{
 *   type?: string,
 *   requestId?: string,
 *   error?: { message?: string, code?: string } | null,
 *   packages?: unknown[],
 *   stale?: boolean,
 *   cachedAt?: number,
 *   updates?: unknown[],
 *   snapshot?: unknown,
 *   result?: unknown,
 *   instanceId?: string,
 *   workspaceId?: string,
 *   apps?: unknown[],
 *   addresses?: unknown[],
 *   deleted?: unknown[],
 *   errors?: unknown[],
 *   profile?: unknown,
 *   drafts?: unknown,
 *   changed?: unknown,
 *   value?: unknown,
 *   removed?: unknown,
 *   entries?: Record<string, unknown>,
 *   hidden?: unknown,
 *   report?: unknown,
 *   job?: unknown,
 *   cancelled?: boolean,
 *   path?: string,
 *   projectPath?: string,
 *   merged?: boolean,
 *   into?: string,
 *   conflicts?: string[],
 *   primaryPath?: string,
 *   foreign?: number,
 *   recordedAt?: string,
 *   recordedExists?: boolean,
 *   insideProject?: boolean,
 *   inProjectsFolder?: boolean,
 *   relinked?: number,
 *   worktreeWarning?: string,
 *   moved?: number,
 *   ok?: boolean,
 *   lines?: string[],
 *   list?: unknown,
 *   identity?: GitIdentityReport,
 * }} HostFrame
 * @typedef {{ name: string, email: string }} GitIdentity
 * @typedef {{
 *   name: string,
 *   email: string,
 *   global: GitIdentity,
 *   repository: GitIdentity | null,
 * }} GitIdentityReport
 * @typedef {{
 *   resolve: (frame: HostFrame) => void,
 *   reject: (error: unknown) => void,
 *   generation: number,
 * }} HostControlPending
 */

export class HostControlGateway {
  /** @type {HostControlAdapter} */
  #adapter;
  #generation = 0;
  #ids = createRequestIds("host");
  /** @type {Map<string | undefined, HostControlPending>} */
  #pending = new Map();

  /**
   * @param {HostControlAdapter} adapter
   */
  constructor(adapter) {
    this.#adapter = adapter;
    adapter.setReceiver((frame) => this.#receive(frame));
    adapter.setConnectionListener?.((connected) => {
      if (!connected) this.#disconnect();
    });
  }

  /**
   * @param {string} operation
   * @param {Record<string, unknown>} [parameters]
   * @returns {Promise<HostFrame>}
   */
  request(operation, parameters = {}, requestId = this.#ids()) {
    const generation = this.#generation;
    /** @type {Promise<HostFrame>} */
    return new Promise((resolve, reject) => {
      this.#pending.set(requestId, { resolve, reject, generation });
      try {
        this.#adapter.send({
          type: "host_request",
          requestId,
          operation,
          ...parameters,
        });
      } catch (error) {
        this.#pending.delete(requestId);
        reject(error);
      }
    });
  }

  async listPiPackages() {
    const frame = await this.request("list_pi_packages");
    // List returns an array of package objects (source, scope, installedPath,
    // disabled, packageName, version, description).
    return Array.isArray(frame?.packages) ? frame.packages : [];
  }

  async browsePiPackages() {
    const frame = await this.request("browse_pi_packages");
    return {
      packages: Array.isArray(frame?.packages) ? frame.packages : [],
      stale: frame?.stale === true,
      cachedAt: typeof frame?.cachedAt === "number" ? frame.cachedAt : 0,
    };
  }

  /**
   * @param {string} workspaceId
   */
  async checkPiPackageUpdates(workspaceId) {
    const frame = await this.request("check_pi_package_updates", { workspaceId });
    // Only packages with an actual update are reported (source/scope/available).
    return Array.isArray(frame?.updates) ? frame.updates : [];
  }

  /**
   * @param {string} source
   * @param {{ local?: boolean }} [options]
   */
  async installPiPackage(source, { local = false } = {}) {
    await this.request("install_pi_package", { source, local });
  }

  /**
   * @param {string} source
   * @param {{ local?: boolean }} [options]
   */
  async removePiPackage(source, { local = false } = {}) {
    await this.request("remove_pi_package", { source, local });
  }

  /**
   * @param {string} [source]
   */
  async updatePiPackage(source = "") {
    await this.request("update_pi_package", { source });
  }

  /**
   * @param {{ workspaceId: string }} options
   */
  async listMcpServers({ workspaceId }) {
    const frame = await this.request("list_mcp_servers", { workspaceId });
    return { list: frame?.list ?? { servers: [], errors: [] } };
  }

  /**
   * @param {Record<string, unknown>} spec
   * @param {{ workspaceId: string }} options
   */
  async addMcpServer(spec, { workspaceId }) {
    await this.request("add_mcp_server", { workspaceId, spec });
  }

  /**
   * @param {string} name
   * @param {string} scope
   * @param {{ workspaceId: string }} options
   */
  async removeMcpServer(name, scope, { workspaceId }) {
    await this.request("remove_mcp_server", { workspaceId, name, scope });
  }

  /**
   * @param {string} workspaceId
   * @param {string} [sessionId]
   */
  async shadowHistoryFiles(workspaceId, sessionId = "", scope = "turn") {
    return this.request("shadow_history_files", { workspaceId, sessionId, scope });
  }

  /**
   * @param {string} workspaceId
   * @param {string} sessionId
   * @param {string} path
   * @param {string} [scope]
   */
  async shadowHistoryFilePair(workspaceId, sessionId, path, scope = "turn") {
    return this.request("shadow_history_file_pair", { workspaceId, sessionId, path, scope });
  }

  /**
   * @param {string} baseUrl
   * @param {string} metricsUrl
   */
  async engineScrape(baseUrl, metricsUrl) {
    const frame = await this.request("engine_scrape", { baseUrl, metricsUrl });
    return frame?.snapshot ?? null;
  }

  /**
   * @param {string} workspaceId
   * @param {string} query
   */
  /**
   * @param {string} workspaceId
   * @param {string} sessionId
   */
  async restartRuntime(workspaceId, sessionId) {
    const frame = await this.request("restart_runtime", { workspaceId, sessionId });
    return frame?.instanceId ?? null;
  }

  /**
   * @param {string} projectPath
   */
  async resolveWorkspace(projectPath) {
    const frame = await this.request("resolve_workspace", { projectPath });
    if (!frame?.workspaceId) throw new Error("Host returned an invalid workspace id");
    return frame.workspaceId;
  }

  /**
   * A new dated project in the configured projects folder.
   * @returns {Promise<{ workspaceId: string, projectPath: string }>}
   */
  async createProject() {
    const frame = await this.request("create_project", {});
    const workspaceId = typeof frame?.workspaceId === "string" ? frame.workspaceId : "";
    const projectPath = typeof frame?.projectPath === "string" ? frame.projectPath : "";
    if (!workspaceId || !projectPath) throw new Error("Host returned an invalid project");
    return { workspaceId, projectPath };
  }

  /**
   * Chats in a project that were recorded at another folder.
   * @param {string} projectPath
   */
  async projectChats(projectPath) {
    const frame = await this.request("project_chats", { projectPath });
    return {
      foreign: Number(frame?.foreign) || 0,
      recordedAt: typeof frame?.recordedAt === "string" ? frame.recordedAt : "",
      recordedExists: frame?.recordedExists === true,
      insideProject: frame?.insideProject === true,
      inProjectsFolder: frame?.inProjectsFolder === true,
    };
  }

  /**
   * Point a project's chats at the folder they are in.
   * @param {string} projectPath
   */
  async relinkProject(projectPath) {
    const frame = await this.request("relink_project", { projectPath });
    return Number(frame?.relinked) || 0;
  }

  /**
   * Rename a project. The folder moves with it.
   * @param {string} projectPath
   * @param {string} name
   * @returns {Promise<{ projectPath: string, worktreeWarning: string }>}
   */
  async renameProject(projectPath, name) {
    const frame = await this.request("rename_project", { projectPath, name });
    const path = typeof frame?.projectPath === "string" ? frame.projectPath : "";
    if (!path) throw new Error("Host returned an invalid project path");
    return {
      projectPath: path,
      worktreeWarning: typeof frame?.worktreeWarning === "string" ? frame.worktreeWarning : "",
    };
  }

  /**
   * Move a project's chats into the folder and remember that.
   * @param {string} projectPath
   */
  async keepChatsInProject(projectPath) {
    const frame = await this.request("keep_chats_in_project", { projectPath });
    return Number(frame?.moved) || 0;
  }

  /**
   * Remove a dated project that holds only its scaffold.
   * @param {string} projectPath
   * @returns {Promise<boolean>}
   */
  async sweepProject(projectPath) {
    const frame = await this.request("sweep_project", { projectPath });
    return frame?.removed === true;
  }

  /**
   * Stop the project and hide it. Chats stay on disk.
   * @param {string} projectPath
   */
  async closeProject(projectPath) {
    await this.request("close_project", { projectPath });
  }

  /**
   * Hide a workspace from the sidebar. Session files stay on disk.
   * @param {{ workspaceId?: string, projectPath?: string }} request
   */
  async forgetWorkspace({ workspaceId = "", projectPath = "" } = {}) {
    const frame = await this.request("forget_workspace", { workspaceId, projectPath });
    return Array.isArray(frame?.hidden) ? frame.hidden : [];
  }

  /** @returns {Promise<unknown[]>} `{ ip, name, kind }` per address, best first. */
  async listLocalAddresses() {
    const frame = await this.request("list_local_addresses");
    return Array.isArray(frame?.addresses) ? frame.addresses : [];
  }

  /**
   * Open a file or folder with the desktop's default app.
   * @param {string} path
   */
  async openPath(path) {
    await this.request("open_path", { path });
  }

  /**
   * @param {string} path
   * @param {{ workspaceId?: string }} [options]
   */
  async revealPath(path, { workspaceId } = {}) {
    await this.request("reveal_path", { path, workspaceId });
  }

  /**
   * @param {string} url
   */
  async openExternal(url) {
    await this.request("open_external", { url });
  }

  // Permanently deletes saved sessions (by id) from disk. Best effort: the
  // response's `errors` lists ids that could not be removed; callers should
  // only drop successfully-deleted ids from local state.
  /**
   * @param {string[]} sessionIds
   */
  async deleteSessions(sessionIds) {
    const frame = await this.request("delete_sessions", { sessionIds });
    return {
      deleted: Array.isArray(frame?.deleted) ? frame.deleted : [],
      errors: Array.isArray(frame?.errors) ? frame.errors : [],
    };
  }

  /**
   * Opens the OS folder dialog. Scanning and the settings write happen in Pi.
   * @param {string} [workspaceId]
   * @returns {Promise<{ path: string | null }>}
   */
  async pickSkillFolder(workspaceId) {
    const frame = await this.request("pick_skill_folder", { workspaceId });
    return { path: typeof frame?.path === "string" && frame.path ? frame.path : null };
  }

  /**
   * @param {string} sessionId
   */
  async loadSessionUiProfile(sessionId) {
    const frame = await this.request("session_ui_profile_load", { expectedSessionId: sessionId });
    return frame?.profile ?? null;
  }

  /**
   * @param {string} sessionId
   * @param {Record<string, unknown>} profile
   */
  async saveSessionUiProfile(sessionId, profile) {
    const frame = await this.request("session_ui_profile_save", {
      expectedSessionId: sessionId,
      ...profile,
    });
    return frame?.profile ?? profile;
  }

  /**
   * Review comment drafts for the open project. An unknown project is an empty list.
   * @param {string} workspaceId
   * @returns {Promise<unknown[]>}
   */
  async loadReviewDrafts(workspaceId) {
    const frame = await this.request("review_drafts_load", { workspaceId });
    return Array.isArray(frame?.drafts) ? frame.drafts : [];
  }

  /**
   * @param {string} workspaceId
   * @param {unknown[]} drafts
   * @returns {Promise<unknown[]>}
   */
  async saveReviewDrafts(workspaceId, drafts) {
    const frame = await this.request("review_drafts_save", { workspaceId, drafts });
    return Array.isArray(frame?.drafts) ? frame.drafts : drafts;
  }

  /**
   * The name and email Git records with commits, read from Git's own config.
   * Without a workspace it is the computer-wide value.
   * @param {string} [workspaceId]
   * @returns {Promise<GitIdentityReport | null>}
   */
  async getGitIdentity(workspaceId = "") {
    const frame = await this.request("git_identity_get", { workspaceId });
    return frame?.identity ?? null;
  }

  /**
   * @param {{ workspaceId?: string, name: string, email: string, scope: "global" | "repository" }} identity
   * @returns {Promise<GitIdentityReport | null>}
   */
  async setGitIdentity({ workspaceId = "", name, email, scope }) {
    const frame = await this.request("git_identity_set", { workspaceId, name, email, scope });
    return frame?.identity ?? null;
  }

  /**
   * @param {string} projectPath
   * @param {string} branch
   * @returns {Promise<{ projectPath?: string }>}
   */
  async createWorktree(projectPath, branch) {
    return this.request("create_worktree", { projectPath, branch });
  }

  /**
   * @param {string} projectPath
   * @returns {Promise<{ merged?: boolean, into?: string, conflicts?: string[] }>}
   */
  async mergeWorktree(projectPath) {
    return this.request("merge_worktree", { projectPath });
  }

  /**
   * @param {string} projectPath
   * @param {{ force?: boolean }} [options]
   * @returns {Promise<{ primaryPath?: string }>}
   */
  async removeWorktree(projectPath, { force = false } = {}) {
    return this.request("remove_worktree", { projectPath, force });
  }

  /**
   * @param {{ quick?: boolean }} [options]
   */
  async checkDependencies({ quick = false } = {}) {
    const frame = await this.request("check_dependencies", { quick });
    return frame?.report ?? null;
  }

  /**
   * @param {"browser" | "node" | "surf"} kind
   */
  async startDependencyInstall(kind) {
    const frame = await this.request("start_dependency_install", { kind });
    return frame?.job ?? null;
  }

  /**
   * @param {"browser" | "node" | "surf"} kind
   */
  async dependencyInstallStatus(kind) {
    const frame = await this.request("dependency_install_status", { kind });
    return frame?.job ?? null;
  }

  /**
   * @param {"browser" | "node" | "surf"} kind
   */
  async cancelDependencyInstall(kind) {
    const frame = await this.request("cancel_dependency_install", { kind });
    return Boolean(frame?.cancelled);
  }

  async surfExtensionPath() {
    const frame = await this.request("surf_extension_path");
    return typeof frame?.path === "string" ? frame.path : "";
  }

  /**
   * @param {string} extensionId
   * @param {string} browser
   */
  async surfConnect(extensionId, browser) {
    const frame = await this.request("surf_connect", { extensionId, browser });
    return {
      ok: Boolean(frame?.ok),
      lines: Array.isArray(frame?.lines) ? frame.lines.map(String) : [],
    };
  }

  /**
   * @param {string} browser
   */
  async openBrowserExtensions(browser) {
    const frame = await this.request("open_browser_extensions", { browser });
    return Boolean(frame?.ok);
  }

  /**
   * @param {HostFrame} frame
   */
  #receive(frame) {
    const pending = this.#pending.get(frame?.requestId);
    if (!pending || pending.generation !== this.#generation) return;
    this.#pending.delete(frame.requestId);
    if (frame.error) {
      const error = new Error(frame.error.message ?? String(frame.error));
      if (typeof frame.error.code === "string") {
        Object.assign(error, { code: frame.error.code });
      }
      pending.reject(error);
    } else pending.resolve(frame);
  }

  #disconnect() {
    this.#generation += 1;
    for (const pending of this.#pending.values()) {
      pending.reject(new Error("Host disconnected before the control request completed"));
    }
    this.#pending.clear();
  }
}
