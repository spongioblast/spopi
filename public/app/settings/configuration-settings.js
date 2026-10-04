// ABOUTME: Settings → Advanced Configuration renders the agent text editors.
// ABOUTME: The host config gateway loads and saves those files when the tab opens.

import { onLocaleChange, t, translateSubtree } from "../i18n/i18n.js";
import { copyText } from "../ui/clipboard.js";
import { el } from "../ui/dom.js";
import { createIcon } from "../ui/icons.js";
import { applyLoadingPlaceholder, clearLoadingPlaceholder } from "../ui/loading-placeholder.js";
import { settingsCard } from "../ui/settings-controls.js";
import {
  clearSettingsSaveMessage,
  setSettingsSaveButtonSaving,
  showSettingsSaveError,
  showSettingsSaveSuccess,
} from "./settings-save-status.js";

/**
 * @typedef {{
 *   ok?: boolean,
 *   error?: string,
 *   data?: Record<string, unknown>,
 * }} ConfigCallResult
 *
 * @typedef {{
 *   call: (
 *     op: string,
 *     params?: Record<string, unknown>,
 *     options?: Record<string, unknown>
 *   ) => Promise<ConfigCallResult>,
 * }} ConfigGatewayLike
 *
 * @typedef {{
 *   inlinePath: HTMLElement | null,
 *   inlinePathCopy: HTMLElement | null,
 *   inlineTextarea: HTMLTextAreaElement | null,
 *   inlineError: HTMLElement | null,
 *   inlineSave: HTMLButtonElement | null,
 *   agentsPath: HTMLElement | null,
 *   agentsTextarea: HTMLTextAreaElement | null,
 *   agentsError: HTMLElement | null,
 *   agentsSave: HTMLButtonElement | null,
 *   appendPath: HTMLElement | null,
 *   appendTextarea: HTMLTextAreaElement | null,
 *   appendError: HTMLElement | null,
 *   appendSave: HTMLButtonElement | null,
 * }} ConfigurationSettingsRefs
 */

/**
 * @param {unknown} error
 * @returns {string}
 */
function messageFromUnknown(error) {
  if (error && typeof error === "object" && "message" in error) {
    return String(/** @type {{ message: unknown }} */ (error).message);
  }
  return String(error);
}

/**
 * @param {{
 *   title: string,
 *   titleKey: string,
 *   help?: string,
 *   helpKey?: string,
 *   pathId: string,
 *   pathLabel: string,
 *   pathLabelKey: string,
 *   copyId?: string,
 *   textareaId: string,
 *   errorId: string,
 *   saveId: string,
 *   placeholder?: string,
 *   placeholderKey?: string,
 * }} options
 */
function editorSection({
  title,
  titleKey,
  help,
  helpKey,
  pathId,
  pathLabel,
  pathLabelKey,
  copyId,
  textareaId,
  errorId,
  saveId,
  placeholder,
  placeholderKey,
}) {
  const path = /** @type {HTMLElement} */ (
    el("span", {
      class: "settings-static-value settings-config-path",
      id: pathId,
      title: "",
    })
  );
  /** @type {HTMLElement | null} */
  let copy = null;
  if (copyId) {
    copy = /** @type {HTMLElement} */ (
      el(
        "button",
        {
          type: "button",
          class:
            "ui-icon-button ui-icon-button--xs ui-icon-button--ghost settings-config-path-copy",
          id: copyId,
          title: t("settings.copyConfigPath"),
          "aria-label": t("settings.copyConfigPath"),
        },
        [createIcon("copy", { size: 14 })],
      )
    );
    copy.dataset.i18nTitle = "settings.copyConfigPath";
    copy.dataset.i18nAriaLabel = "settings.copyConfigPath";
  }
  const pathLabelNode = /** @type {HTMLElement} */ (
    el("span", { class: "settings-label", text: pathLabel })
  );
  pathLabelNode.dataset.i18n = pathLabelKey;
  const textarea = /** @type {HTMLTextAreaElement} */ (
    el("textarea", {
      class: "ui-textarea config-editor-textarea settings-config-textarea",
      id: textareaId,
      spellcheck: "false",
      autocomplete: "off",
      autocorrect: "off",
      autocapitalize: "off",
      placeholder,
    })
  );
  if (placeholderKey) textarea.dataset.i18nPh = placeholderKey;
  const error = /** @type {HTMLElement} */ (
    el("div", {
      class: "config-editor-error settings-save-status hidden",
      id: errorId,
      role: "status",
    })
  );
  error.setAttribute("aria-live", "polite");
  const save = /** @type {HTMLButtonElement} */ (
    el("button", { class: "ui-button ui-button--primary", id: saveId, text: "Save" })
  );
  save.dataset.i18n = "shell.save";
  /** @type {Array<Node>} */
  const children = [];
  if (help) {
    const helpNode = /** @type {HTMLElement} */ (el("p", { class: "settings-help", text: help }));
    helpNode.dataset.i18n = helpKey;
    children.push(helpNode);
  }
  children.push(
    el("div", { class: "settings-config-meta" }, [
      pathLabelNode,
      el("span", { class: "settings-config-path-row" }, copy ? [path, copy] : [path]),
    ]),
    textarea,
    el("div", { class: "settings-config-actions" }, [
      error,
      el("div", { class: "settings-config-button-group" }, [save]),
    ]),
  );
  return {
    section: settingsCard(title, titleKey, children),
    path,
    copy,
    textarea,
    error,
    save,
  };
}

/**
 * @param {ParentNode | null | undefined} root
 * @param {{
 *   configGateway?: ConfigGatewayLike | null,
 * }} [options]
 */
export function mountConfigurationSettings(root, { configGateway } = {}) {
  if (!root) return { refresh() {}, destroy() {} };
  const heading = /** @type {HTMLElement} */ (el("h3", { text: "Advanced Configuration" }));
  heading.dataset.i18n = "settings.configuration";
  const inline = editorSection({
    title: "Agent",
    titleKey: "settings.agent",
    pathId: "inline-config-path",
    pathLabel: "Agent config file",
    pathLabelKey: "settings.agentConfigFile",
    copyId: "inline-config-path-copy",
    textareaId: "inline-config-textarea",
    errorId: "inline-config-error",
    saveId: "inline-config-save",
  });
  const agents = editorSection({
    title: "AGENTS.md",
    titleKey: "settings.agentsMd",
    help: "Working notes for the agent (preferences, conventions, commands). Optional. This edits the global file for all projects; put repo-specific rules in that repo's AGENTS.md.",
    helpKey: "settings.agentsMdHelp",
    pathId: "agents-md-path",
    pathLabel: "Agent context",
    pathLabelKey: "settings.agentsContextFile",
    textareaId: "agents-md-textarea",
    placeholder: "e.g. Reply in English. Read related files before editing.",
    placeholderKey: "settings.agentsMdPlaceholder",
    errorId: "agents-md-error",
    saveId: "agents-md-save",
  });
  const append = editorSection({
    title: "APPEND_SYSTEM.md",
    titleKey: "settings.appendSystemMd",
    help: "Appended to the system prompt without replacing Pi's defaults. Use for always-on behavioral rules. Optional; leave empty to keep the default behavior.",
    helpKey: "settings.appendSystemMdHelp",
    pathId: "append-system-md-path",
    pathLabel: "Append to system prompt",
    pathLabelKey: "settings.appendSystemPromptFile",
    textareaId: "append-system-md-textarea",
    placeholder: "e.g. Be concise. Explain risky edits before running them.",
    placeholderKey: "settings.appendSystemMdPlaceholder",
    errorId: "append-system-md-error",
    saveId: "append-system-md-save",
  });
  root.replaceChildren(
    el("div", { class: "settings-header" }, [heading]),
    el("div", { class: "settings-body" }, [inline.section, agents.section, append.section]),
  );
  translateSubtree(root);
  const editors = configGateway
    ? mountSettingsConfig({
        configGateway,
        refs: {
          inlinePath: inline.path,
          inlinePathCopy: inline.copy,
          inlineTextarea: inline.textarea,
          inlineError: inline.error,
          inlineSave: inline.save,
          agentsPath: agents.path,
          agentsTextarea: agents.textarea,
          agentsError: agents.error,
          agentsSave: agents.save,
          appendPath: append.path,
          appendTextarea: append.textarea,
          appendError: append.error,
          appendSave: append.save,
        },
      })
    : null;
  return {
    refresh() {
      translateSubtree(root);
    },
    destroy() {
      root.replaceChildren();
    },
    loadInlineConfigEditor: editors?.loadInlineConfigEditor,
    loadAgentsMdEditor: editors?.loadAgentsMdEditor,
    loadAppendSystemMdEditor: editors?.loadAppendSystemMdEditor,
  };
}

/**
 * Elements this page creates. Callers use the refs instead of looking up ids.
 * @param {ParentNode | null | undefined} root
 * @returns {ConfigurationSettingsRefs}
 */
function configurationSettingsRefs(root) {
  return {
    inlinePath: /** @type {HTMLElement | null} */ (
      root?.querySelector("#inline-config-path") ?? null
    ),
    inlinePathCopy: /** @type {HTMLElement | null} */ (
      root?.querySelector("#inline-config-path-copy") ?? null
    ),
    inlineTextarea: /** @type {HTMLTextAreaElement | null} */ (
      root?.querySelector("#inline-config-textarea") ?? null
    ),
    inlineError: /** @type {HTMLElement | null} */ (
      root?.querySelector("#inline-config-error") ?? null
    ),
    inlineSave: /** @type {HTMLButtonElement | null} */ (
      root?.querySelector("#inline-config-save") ?? null
    ),
    agentsPath: /** @type {HTMLElement | null} */ (root?.querySelector("#agents-md-path") ?? null),
    agentsTextarea: /** @type {HTMLTextAreaElement | null} */ (
      root?.querySelector("#agents-md-textarea") ?? null
    ),
    agentsError: /** @type {HTMLElement | null} */ (
      root?.querySelector("#agents-md-error") ?? null
    ),
    agentsSave: /** @type {HTMLButtonElement | null} */ (
      root?.querySelector("#agents-md-save") ?? null
    ),
    appendPath: /** @type {HTMLElement | null} */ (
      root?.querySelector("#append-system-md-path") ?? null
    ),
    appendTextarea: /** @type {HTMLTextAreaElement | null} */ (
      root?.querySelector("#append-system-md-textarea") ?? null
    ),
    appendError: /** @type {HTMLElement | null} */ (
      root?.querySelector("#append-system-md-error") ?? null
    ),
    appendSave: /** @type {HTMLButtonElement | null} */ (
      root?.querySelector("#append-system-md-save") ?? null
    ),
  };
}

/**
 * @param {{
 *   configGateway: ConfigGatewayLike,
 *   pathEl: HTMLElement | null | undefined,
 *   textareaEl: HTMLTextAreaElement | null | undefined,
 *   errorEl: HTMLElement | null | undefined,
 *   saveBtn: HTMLButtonElement | null | undefined,
 *   readOp: string,
 *   writeOp: string,
 * }} options
 */
function wireFileEditor({ configGateway, pathEl, textareaEl, errorEl, saveBtn, readOp, writeOp }) {
  async function load() {
    if (!textareaEl) return;
    errorEl?.classList.add("hidden");
    textareaEl.value = "";
    if (pathEl) {
      pathEl.textContent = t("settings.config.loading");
      pathEl.title = "";
    }
    try {
      const data = await configGateway.call(readOp);
      if (!data?.ok) throw new Error(data?.error || "Failed to load file");
      const payload = data.data ?? {};
      textareaEl.value = payload.content == null ? "" : String(payload.content);
      if (pathEl) {
        const filePath = payload.path == null ? "" : String(payload.path);
        pathEl.textContent = filePath;
        pathEl.title = filePath;
      }
    } catch (e) {
      if (pathEl) pathEl.textContent = "";
      if (errorEl) {
        errorEl.textContent = messageFromUnknown(e) || String(e);
        errorEl.classList.remove("hidden");
      }
    }
  }
  saveBtn?.addEventListener("click", async () => {
    if (!textareaEl) return;
    clearSettingsSaveMessage(errorEl);
    const content = textareaEl.value;
    setSettingsSaveButtonSaving(saveBtn, true);
    try {
      const data = await configGateway.call(writeOp, { content });
      if (!data?.ok) throw new Error(data?.error || "Failed to save file");
      showSettingsSaveSuccess(errorEl);
    } catch (e) {
      showSettingsSaveError(errorEl, messageFromUnknown(e) || String(e));
    } finally {
      setSettingsSaveButtonSaving(saveBtn, false);
    }
  });
  return { load };
}

/**
 * @param {{
 *   configGateway?: ConfigGatewayLike | null,
 *   refs?: ConfigurationSettingsRefs | null,
 * }} [options]
 */
export function mountSettingsConfig({ configGateway, refs } = {}) {
  const gateway = /** @type {ConfigGatewayLike} */ (configGateway);
  /**
   * @param {string} op
   * @param {Record<string, unknown>} [params]
   * @param {Record<string, unknown>} [options]
   */
  const call = (op, params, options) => gateway.call(op, params, options);
  const page = refs ?? configurationSettingsRefs(document);
  const inlineConfigPath = page.inlinePath;
  const inlineConfigPathCopy = page.inlinePathCopy;
  const inlineConfigTextarea = page.inlineTextarea;
  const inlineConfigError = page.inlineError;
  const inlineConfigSave = page.inlineSave;

  /**
   * @param {string} path
   * @param {{ copyable?: boolean }} [options]
   */
  function setInlineConfigPath(path, { copyable = true } = {}) {
    if (!inlineConfigPath) return;
    clearLoadingPlaceholder(inlineConfigPath);
    inlineConfigPath.textContent = path;
    inlineConfigPath.title = path;
    if (inlineConfigPathCopy) inlineConfigPathCopy.classList.toggle("hidden", !path || !copyable);
  }

  async function loadInlineConfigEditor() {
    if (!inlineConfigTextarea) return;
    inlineConfigError?.classList.add("hidden");
    inlineConfigTextarea.value = "";
    applyLoadingPlaceholder(inlineConfigPath, { label: t("settings.config.loading") });
    if (inlineConfigPathCopy) inlineConfigPathCopy.classList.add("hidden");
    try {
      const data = await call("read_agent_config");
      if (!data?.ok) throw new Error(data?.error || "Failed to load config");
      const payload = data.data ?? {};
      const rawContent = payload.content == null ? "" : String(payload.content);
      try {
        inlineConfigTextarea.value = JSON.stringify(JSON.parse(rawContent), null, 2);
      } catch {
        inlineConfigTextarea.value = rawContent;
      }
      setInlineConfigPath(payload.path == null ? "" : String(payload.path));
    } catch (e) {
      setInlineConfigPath("", { copyable: false });
      if (inlineConfigError) {
        inlineConfigError.textContent = messageFromUnknown(e) || String(e);
        inlineConfigError.classList.remove("hidden");
      }
    }
  }

  if (inlineConfigPathCopy) {
    const pathCopyBtn = inlineConfigPathCopy;
    pathCopyBtn.addEventListener("click", async () => {
      const path = inlineConfigPath?.textContent || "";
      if (!path) return;
      const defaultLabel = t("settings.copyConfigPath");
      try {
        await copyText(path);
        pathCopyBtn.title = t("settings.configPathCopied");
        pathCopyBtn.setAttribute("aria-label", t("settings.configPathCopied"));
      } catch {
        pathCopyBtn.title = t("settings.configPathCopyFailed");
        pathCopyBtn.setAttribute("aria-label", t("settings.configPathCopyFailed"));
      }
      setTimeout(() => {
        pathCopyBtn.title = defaultLabel;
        pathCopyBtn.setAttribute("aria-label", defaultLabel);
      }, 1500);
    });
  }

  inlineConfigSave?.addEventListener("click", async () => {
    if (!inlineConfigTextarea) return;
    clearSettingsSaveMessage(inlineConfigError);
    const content = inlineConfigTextarea.value;
    try {
      JSON.parse(content);
    } catch (e) {
      showSettingsSaveError(inlineConfigError, `Invalid JSON: ${messageFromUnknown(e)}`);
      return;
    }
    setSettingsSaveButtonSaving(inlineConfigSave, true);
    try {
      const data = await call("write_agent_config", { content });
      if (!data?.ok) throw new Error(data?.error || "Failed to save config");
      showSettingsSaveSuccess(inlineConfigError);
    } catch (e) {
      showSettingsSaveError(inlineConfigError, messageFromUnknown(e) || String(e));
    } finally {
      setSettingsSaveButtonSaving(inlineConfigSave, false);
    }
  });

  const agentsMdEditor = wireFileEditor({
    configGateway: gateway,
    pathEl: page.agentsPath,
    textareaEl: page.agentsTextarea,
    errorEl: page.agentsError,
    saveBtn: page.agentsSave,
    readOp: "read_agents_md",
    writeOp: "write_agents_md",
  });
  const appendSystemMdEditor = wireFileEditor({
    configGateway: gateway,
    pathEl: page.appendPath,
    textareaEl: page.appendTextarea,
    errorEl: page.appendError,
    saveBtn: page.appendSave,
    readOp: "read_append_system_md",
    writeOp: "write_append_system_md",
  });
  onLocaleChange(() => {
    if (inlineConfigTextarea?.isConnected) void loadInlineConfigEditor();
    if (page.agentsTextarea?.isConnected) void agentsMdEditor.load();
    if (page.appendTextarea?.isConnected) void appendSystemMdEditor.load();
  });
  return {
    loadInlineConfigEditor,
    loadAgentsMdEditor: agentsMdEditor.load,
    loadAppendSystemMdEditor: appendSystemMdEditor.load,
  };
}
