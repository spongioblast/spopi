// ABOUTME: Mounts the Models page for providers, catalogs, and OAuth login.
// ABOUTME: Saves go through the config and OAuth gateways.

// Settings → Configuration tab: API keys / model catalog panel plus the inline
// agent-config and models.json editors. Everything goes through the
// ConfigGateway (the spopi-bridge `/spopi-config` command). All model-registry
// access happens inside pi via the bridge; this module only renders.

import { onLocaleChange, t } from "../i18n/i18n.js";
import { confirmDialog, trapModal } from "../ui/dialog.js";
import { settingsState } from "../ui/settings-states.js";
import { createModelHealth } from "./models/model-health.js";
import { createModelsOAuth } from "./models/oauth.js";
import { createProviderEditor } from "./models/provider-editor.js";
import { createProviderList } from "./models/providers.js";
import { modelsSettingsRefs } from "./models-settings.js";
import { clearSettingsSaveMessage, showSettingsSaveError } from "./settings-save-status.js";

const MODELS_DOCS_URL =
  "https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/models.md";

/** Keys that exist without a models.json entry. A keyless custom provider
 * (`apiKey: "none"`) is `models_json_key` and must not linger after delete. */
const STANDALONE_AUTH_SOURCES = new Set(["stored", "environment", "oauth", "runtime"]);

/**
 * True when the catalog row is a cloud/key provider, not a leftover custom one.
 * @param {{ configured?: boolean, source?: string } | null | undefined} provider
 */
export function isStandaloneAuthProvider(provider) {
  return Boolean(provider?.configured && STANDALONE_AUTH_SOURCES.has(provider.source ?? ""));
}

/** @type {Record<string, string>} */
const PROVIDER_ICON_ALIASES = {
  "amazon-bedrock": "aws",
  "azure-openai-responses": "azure",
  "github-copilot": "github-copilot",
  "google-vertex": "google",
  "ant-ling": "ant-group",
  "cloudflare-ai-gateway": "cloudflare",
  "cloudflare-workers-ai": "cloudflare",
  deepseek: "deep-seek",
  fireworks: "fireworks",
  huggingface: "hugging-face",
  openrouter: "open-router",
  opencode: "open-code",
  "opencode-go": "open-code",
  xai: "x-a-i",
  "vercel-ai-gateway": "vercel",
  "minimax-cn": "minimax",
  moonshotai: "moonshot",
  "moonshotai-cn": "moonshot",
  "xiaomi-token-plan-ams": "xiaomi-mi-mo",
  "xiaomi-token-plan-cn": "xiaomi-mi-mo",
  "xiaomi-token-plan-sgp": "xiaomi-mi-mo",
};

/**
 * @typedef {{
 *   id?: string,
 *   name?: string,
 *   provider?: string,
 *   available?: boolean,
 *   visible?: boolean,
 *   health?: { status?: string, latencyMs?: number, error?: string },
 * }} CatalogModel
 *
 * @typedef {{
 *   provider: string,
 *   displayName?: string,
 *   configured?: boolean,
 *   source?: string,
 *   authType?: string,
 *   custom?: boolean,
 *   models?: CatalogModel[],
 * }} CatalogProvider
 *
 * @typedef {{
 *   id?: string,
 *   name?: string,
 *   contextWindow?: number,
 *   maxTokens?: number,
 *   reasoning?: boolean,
 *   provider?: string,
 * }} ModelsJsonModel
 *
 * @typedef {{
 *   baseUrl?: string,
 *   apiKey?: string,
 *   api?: string,
 *   models?: ModelsJsonModel[],
 * }} ModelsJsonProvider
 *
 * @typedef {{
 *   providers: Record<string, ModelsJsonProvider>,
 * }} ModelsJsonConfig
 *
 * @typedef {import("./models/provider-editor.js").ModelsConfigSelection} ModelsConfigSelection
 * @typedef {import("./models/provider-editor.js").ModelsViewState} ModelsViewState
 * @typedef {import("./models/provider-editor.js").ModelConfigChange} ModelConfigChange
 *
 * @typedef {{
 *   ok?: boolean,
 *   error?: string,
 *   data?: {
 *     providers?: CatalogProvider[],
 *     content?: string,
 *     path?: string,
 *   },
 * }} ConfigGatewayResponse
 *
 * @typedef {{
 *   call: (op: string, params?: unknown, options?: unknown) => Promise<unknown>,
 * }} ConfigGateway
 *
 * @typedef {{
 *   command: (frame: Record<string, unknown>, options?: unknown) => Promise<unknown>,
 *   subscribe: (handler: (envelope: unknown) => void) => (() => void),
 * } | null | undefined} OauthGateway
 *
 * @typedef {object} MountModelsPageDeps
 * @property {ConfigGateway} configGateway
 * @property {OauthGateway} [oauthGateway]
 * @property {((change?: ModelConfigChange) => Promise<void> | void) | null | undefined} [onModelConfigurationChanged]
 * @property {((url: string) => Promise<unknown>) | null | undefined} [openExternal]
 *
 * @typedef {object} LoadApiKeysOptions
 * @property {boolean} [preserveUi]
 */

/**
 * @param {string} provider
 * @param {string} [className]
 */
function providerIcon(provider, className = "provider-logo") {
  const key = PROVIDER_ICON_ALIASES[provider] || provider;
  const img = document.createElement("img");
  img.className = className;
  img.alt = "";
  img.src = `/icons/providers/${key}.svg`;
  img.onerror = () => {
    img.replaceWith(
      Object.assign(document.createElement("span"), {
        className,
        textContent: provider.slice(0, 1).toUpperCase(),
      }),
    );
  };
  return img;
}

/**
 * @param {MountModelsPageDeps} deps
 */
export function mountModelsPage({
  configGateway,
  oauthGateway,
  onModelConfigurationChanged,
  openExternal,
}) {
  /**
   * @param {string} op
   * @param {unknown} [params]
   * @param {unknown} [options]
   */
  const call = (op, params, options) => configGateway.call(op, params, options);
  /**
   * @param {string} op
   * @param {Record<string, unknown>} [params]
   * @param {unknown} [options]
   */
  const oauthCall = (op, params, options) =>
    oauthGateway
      ? oauthGateway.command({ type: op, ...params }, options)
      : Promise.reject(new Error("oauth unavailable"));
  const apiKeysContainer = modelsSettingsRefs().apiKeys;
  const providerExpansionState = new Map();
  /** @type {CatalogProvider[]} */
  let catalogProviders = [];

  /**
   * @param {LoadApiKeysOptions} [options]
   */
  async function loadApiKeysPanel(options = {}) {
    if (!apiKeysContainer) return;
    const keysRoot = apiKeysContainer;
    rememberProviderExpansionState();
    const scrollContainer = options.preserveUi ? getSettingsScrollContainer() : null;
    const scrollTop =
      scrollContainer && "scrollTop" in scrollContainer
        ? /** @type {{ scrollTop: number }} */ (scrollContainer).scrollTop
        : 0;
    if (!options.preserveUi) {
      keysRoot.replaceChildren(
        settingsState({
          kind: "loading",
          text: t("settings.loadingProviders"),
          className: "settings-api-keys-loading",
        }),
      );
    }
    /** @type {unknown} */
    let data;
    try {
      data = await call("list_model_catalog");
    } catch (error) {
      renderApiKeysPanelError(
        errorMessage(error) || t("settings.apiKeys.loadFailed"),
        options.preserveUi,
      );
      restoreScroll(scrollContainer, scrollTop);
      return;
    }
    const response = asConfigResponse(data);
    if (!response?.ok || !Array.isArray(response.data?.providers)) {
      renderApiKeysPanelError(
        response?.error || t("settings.apiKeys.loadFailed"),
        options.preserveUi,
      );
      restoreScroll(scrollContainer, scrollTop);
      return;
    }
    renderApiKeysPanel(response.data.providers);
    restoreScroll(scrollContainer, scrollTop);
  }

  function rememberProviderExpansionState() {
    if (!apiKeysContainer) return;
    const keysRoot = apiKeysContainer;
    for (const row of keysRoot.querySelectorAll(".api-key-row[data-provider]")) {
      const modelList = row.querySelector(".api-model-list");
      if (modelList && "dataset" in row) {
        const providerId = /** @type {{ dataset: DOMStringMap }} */ (row).dataset.provider;
        if (providerId) {
          providerExpansionState.set(providerId, !modelList.classList.contains("collapsed"));
        }
      }
    }
  }

  function getSettingsScrollContainer() {
    return (
      (apiKeysContainer && "closest" in apiKeysContainer
        ? apiKeysContainer.closest(".settings-content")
        : null) ||
      document.scrollingElement ||
      document.documentElement
    );
  }

  /**
   * @param {Element | null | undefined} scrollContainer
   * @param {number} scrollTop
   */
  function restoreScroll(scrollContainer, scrollTop) {
    if (!scrollContainer || !("scrollTop" in scrollContainer)) return;
    const scroller = /** @type {{ scrollTop: number }} */ (scrollContainer);
    requestAnimationFrame(() => {
      scroller.scrollTop = scrollTop;
    });
  }

  /**
   * @param {string} message
   * @param {boolean} [preserveUi]
   */
  function renderApiKeysPanelError(message, preserveUi = false) {
    if (!apiKeysContainer) return;
    const keysRoot = apiKeysContainer;
    // A background refresh that fails keeps the editor the user is in.
    if (preserveUi && keysRoot.querySelector(".models-config-layout")) return;
    keysRoot.replaceChildren(
      settingsState({
        kind: "error",
        text: message,
        className: "settings-api-keys-empty",
        onRetry: () => void loadApiKeysPanel(),
      }),
    );
  }

  /** @param {CatalogProvider[]} providers */
  function renderApiKeysPanel(providers) {
    catalogProviders = providers;
    if (inlineModelsTextarea && "value" in inlineModelsTextarea) {
      const textarea = /** @type {{ value: string }} */ (inlineModelsTextarea);
      if (!textarea.value.trim()) {
        textarea.value = '{\n  "providers": {}\n}';
      }
      renderModelsConfigLayout();
      return;
    }

    if (!apiKeysContainer) return;
    const keysRoot = apiKeysContainer;
    keysRoot.replaceChildren();
    // Codex is OAuth-managed: its configured card is rendered separately as a
    // connected state with a logout action, never as an API-key row.
    const configured = providers.filter(
      (provider) => isStandaloneAuthProvider(provider) && !oauth.isCodexProvider(provider),
    );
    for (const provider of configured.sort((a, b) =>
      (a.displayName || a.provider).localeCompare(b.displayName || b.provider),
    )) {
      keysRoot.appendChild(providerList.buildApiKeyRow(provider));
    }
    if (oauth.codexOAuthCapability?.configured) {
      keysRoot.appendChild(oauth.buildCodexConnectedCard());
    }
  }

  /** @param {unknown} value */
  function escapeSelectorValue(value) {
    if (globalThis.CSS?.escape) return globalThis.CSS.escape(String(value));
    return String(value).replace(/["\\]/g, "\\$&");
  }

  const modelsRefs = modelsSettingsRefs();
  const inlineModelsPath = modelsRefs.path;
  const inlineModelsTextarea = modelsRefs.textarea;
  const inlineModelsError = modelsRefs.error;
  const inlineModelsSave = modelsRefs.save;
  const inlineModelsInsertExample = modelsRefs.insertExample;
  const modelsConfigDocsLink = modelsRefs.docsLink;
  /** @type {ModelsViewState} */
  const view = {
    selected: null,
    providerDraft: null,
    modelDraft: null,
    highlight: null,
    offerSetup: null,
  };

  const MODELS_JSON_EXAMPLE = `{
  "providers": {
    "ollama": {
      "baseUrl": "http://localhost:11434/v1",
      "api": "openai-completions",
      "apiKey": "ollama",
      "compat": {
        "supportsDeveloperRole": false,
        "supportsReasoningEffort": false
      },
      "models": [
        { "id": "llama3.1:8b" },
        { "id": "qwen2.5-coder:7b" }
      ]
    }
  }
}
`;

  /** @param {string} message */
  function showInlineModelsError(message) {
    showSettingsSaveError(asSaveMessage(inlineModelsError), message);
  }

  function clearInlineModelsError() {
    clearSettingsSaveMessage(asSaveMessage(inlineModelsError));
  }

  async function loadInlineModelsEditor() {
    if (!inlineModelsTextarea || !("value" in inlineModelsTextarea)) return;
    const textarea = /** @type {{ value: string }} */ (inlineModelsTextarea);
    clearInlineModelsError();
    if (!textarea.value.trim()) {
      textarea.value = '{\n  "providers": {}\n}';
    }
    renderModelsConfigLayout();
    if (inlineModelsPath) inlineModelsPath.textContent = t("settings.config.loading");
    try {
      const data = asConfigResponse(await call("read_models_config"));
      if (!data?.ok) throw new Error(data?.error || "Failed to load models.json");
      try {
        textarea.value = JSON.stringify(JSON.parse(String(data.data?.content ?? "")), null, 2);
      } catch {
        textarea.value = String(data.data?.content ?? "");
      }
      renderModelsConfigLayout();
      if (inlineModelsPath) inlineModelsPath.textContent = data.data?.path || "";
    } catch (e) {
      if (inlineModelsPath) inlineModelsPath.textContent = "";
      showInlineModelsError(errorMessage(e) || String(e));
    }
  }

  function renderModelsConfigLayout() {
    if (!inlineModelsTextarea || !("value" in inlineModelsTextarea)) return;
    if (!apiKeysContainer) return;
    const keysRoot = apiKeysContainer;
    const textarea = /** @type {{ value: string, focus: () => void }} */ (inlineModelsTextarea);
    /** @type {unknown} */
    let parsedUnknown;
    try {
      parsedUnknown = JSON.parse(textarea.value);
    } catch {
      return;
    }
    if (!parsedUnknown || typeof parsedUnknown !== "object" || Array.isArray(parsedUnknown)) return;
    const parsedRecord = /** @type {Record<string, unknown>} */ (parsedUnknown);
    if (
      !parsedRecord.providers ||
      typeof parsedRecord.providers !== "object" ||
      Array.isArray(parsedRecord.providers)
    ) {
      parsedRecord.providers = {};
    }
    const parsed = /** @type {ModelsJsonConfig} */ (parsedRecord);
    const providers = parsed.providers;
    const providerNames = Object.keys(providers);
    const configuredProviders = catalogProviders
      .filter((provider) => isStandaloneAuthProvider(provider))
      .sort((a, b) => (a.displayName || a.provider).localeCompare(b.displayName || b.provider));
    const selected = view.selected;
    if (
      !selected ||
      (selected.type === "auth" &&
        (providerNames.includes(selected.provider) ||
          !configuredProviders.some((provider) => provider.provider === selected.provider))) ||
      (selected.type !== "auth" && !providers[selected.provider]) ||
      (selected.type === "model" && !providers[selected.provider].models?.[selected.index ?? -1])
    ) {
      view.modelDraft = null;
      view.providerDraft = null;
      const defaultAuthProvider = configuredProviders.find(
        (provider) => !providerNames.includes(provider.provider),
      );
      view.selected = defaultAuthProvider
        ? { type: "auth", provider: defaultAuthProvider.provider }
        : providerNames[0]
          ? { type: "provider", provider: providerNames[0] }
          : null;
    }

    let layout = document.getElementById("models-config-layout");
    if (!layout) {
      layout = document.createElement("div");
      layout.id = "models-config-layout";
      layout.className = "models-config-layout";
      keysRoot.replaceChildren(layout);

      const openSource = document.createElement("button");
      openSource.type = "button";
      openSource.className = "ui-button ui-button--secondary models-config-source-button";
      openSource.textContent = t("models.advancedJson");

      const sourceDialog = document.createElement("div");
      sourceDialog.className = "models-json-dialog-backdrop hidden";
      const dialog = document.createElement("section");
      dialog.className = "models-json-dialog";
      dialog.setAttribute("role", "dialog");
      dialog.setAttribute("aria-labelledby", "models-json-dialog-title");
      const header = document.createElement("header");
      header.className = "models-json-dialog-header";
      const heading = document.createElement("div");
      const title = document.createElement("h2");
      title.id = "models-json-dialog-title";
      title.textContent = t("models.advancedJson");
      if (inlineModelsPath) heading.append(title, inlineModelsPath);
      else heading.append(title);
      const close = document.createElement("button");
      close.type = "button";
      close.className = "ui-icon-button ui-icon-button--ghost";
      close.setAttribute("aria-label", t("models.closeAdvancedJson"));
      close.textContent = "×";
      header.append(heading, close);
      dialog.append(header, /** @type {Node} */ (inlineModelsTextarea));

      const footer = document.createElement("div");
      footer.className = "models-config-footer";
      const sourceSection =
        inlineModelsSave && "closest" in inlineModelsSave
          ? inlineModelsSave.closest(".settings-section")
          : null;
      const actions =
        inlineModelsSave && "closest" in inlineModelsSave
          ? inlineModelsSave.closest(".settings-config-actions")
          : null;
      footer.appendChild(openSource);

      if (actions) {
        actions.classList.add("models-json-dialog-actions");
        dialog.appendChild(actions);
      }
      sourceDialog.appendChild(dialog);
      document.body.appendChild(sourceDialog);

      const closeSourceDialog = () => {
        sourceDialog.classList.add("hidden");
        renderModelsConfigLayout();
        openSource.focus();
      };
      openSource.addEventListener("click", () => {
        sourceDialog.classList.remove("hidden");
        textarea.focus();
      });
      close.addEventListener("click", closeSourceDialog);
      sourceDialog.addEventListener("click", (event) => {
        if (event.target === sourceDialog) closeSourceDialog();
      });
      trapModal(dialog, { onClose: closeSourceDialog });
      /** @type {Element} */ (inlineModelsTextarea).addEventListener(
        "change",
        renderModelsConfigLayout,
      );

      footer.classList.add("models-config-toolbar");
      keysRoot.append(footer, layout);
      if (sourceSection && "hidden" in sourceSection) {
        /** @type {{ hidden: boolean }} */ (sourceSection).hidden = true;
      }
    } else if (layout.parentNode !== keysRoot) {
      keysRoot.prepend(layout);
    }
    layout.replaceChildren();
    const sidebar = document.createElement("aside");
    sidebar.className = "models-config-sidebar";
    const list = document.createElement("div");
    list.className = "models-provider-list";
    const main = document.createElement("section");
    main.className = "models-config-main";

    /** @param {ModelsConfigSelection} next */
    const selectGuarded = (next) => {
      const go = () => {
        view.selected = next;
        renderModelsConfigLayout();
      };
      if (!editor.hasUnsavedChanges()) {
        view.modelDraft = null;
        view.providerDraft = null;
        go();
        return;
      }
      void editor.confirmLeave().then((ok) => {
        if (ok) go();
      });
    };

    for (const provider of configuredProviders) {
      if (providerNames.includes(provider.provider)) continue;
      const item = document.createElement("button");
      item.type = "button";
      item.className = "models-provider-item models-auth-provider-item";
      item.classList.toggle(
        "selected",
        view.selected?.type === "auth" && view.selected.provider === provider.provider,
      );
      item.append(providerIcon(provider.provider, "models-provider-icon"));
      item.appendChild(
        Object.assign(document.createElement("span"), {
          textContent: provider.displayName || provider.provider,
        }),
      );
      item.addEventListener("click", () => {
        selectGuarded({ type: "auth", provider: provider.provider });
      });
      list.appendChild(item);
    }

    if (configuredProviders.length && providerNames.length) {
      const divider = document.createElement("div");
      divider.className = "models-provider-divider";
      list.appendChild(divider);
    }

    for (const id of providerNames) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "models-provider-item";
      item.classList.toggle(
        "selected",
        view.selected?.type !== "auth" && view.selected?.provider === id,
      );
      item.append(providerIcon(id, "models-provider-icon"));
      item.appendChild(Object.assign(document.createElement("span"), { textContent: id }));
      item.addEventListener("click", () => {
        if (view.selected?.type === "provider" && view.selected.provider === id) return;
        selectGuarded({ type: "provider", provider: id });
      });
      list.appendChild(item);
    }
    sidebar.appendChild(list);

    const add = document.createElement("button");
    add.type = "button";
    add.className = "models-provider-add";
    add.textContent = t("models.addProvider");
    add.addEventListener("click", () => oauth.openProviderPicker(catalogProviders));
    sidebar.appendChild(add);

    const currentSelection = view.selected;
    if (!currentSelection) {
      main.append(
        settingsState({
          kind: "empty",
          text: t("models.noProviders"),
          hint: t("models.noProvidersHint"),
        }),
      );
    } else if (currentSelection.type === "auth") {
      const authProvider = currentSelection.provider;
      const provider = configuredProviders.find((candidate) => candidate.provider === authProvider);
      if (provider) {
        const card = providerList.buildApiKeyRow(provider);
        card.classList.add("provider-manager-card");
        card.querySelector(".api-key-row-header")?.classList.add("provider-manager-card-header");
        card.querySelector(".api-model-list")?.classList.add("provider-manager-model-list");
        main.appendChild(card);
      }
    } else if (currentSelection.type === "provider") {
      editor.renderProviderView(main, currentSelection.provider);
    } else {
      editor.renderModelView(main, currentSelection);
    }
    layout.append(sidebar, main);
  }

  if (inlineModelsSave && "addEventListener" in inlineModelsSave) {
    inlineModelsSave.addEventListener("click", () => {
      void (async () => {
        if (await editor.persistInlineModelsConfig()) renderModelsConfigLayout();
      })();
    });
  }

  if (inlineModelsInsertExample && "addEventListener" in inlineModelsInsertExample) {
    inlineModelsInsertExample.addEventListener("click", () => {
      void (async () => {
        if (!inlineModelsTextarea || !("value" in inlineModelsTextarea)) return;
        const textarea = /** @type {{ value: string }} */ (inlineModelsTextarea);
        const current = textarea.value.trim();
        if (current && current !== "{}" && current !== '{\n  "providers": {}\n}') {
          const ok = await confirmDialog({
            title: t("models.advancedJson"),
            message: t("models.replaceOllamaExample"),
          });
          if (!ok) return;
        }
        textarea.value = MODELS_JSON_EXAMPLE;
        view.providerDraft = null;
        view.modelDraft = null;
        view.selected = { type: "provider", provider: "ollama" };
        renderModelsConfigLayout();
        clearInlineModelsError();
      })();
    });
  }

  if (modelsConfigDocsLink && "addEventListener" in modelsConfigDocsLink) {
    modelsConfigDocsLink.addEventListener("click", (e) => {
      e.preventDefault();
      // System-browser handoff only: no WebView window.open fallback for the
      // docs link (keeps the open-redirect surface closed entirely).
      const open = openExternal;
      if (typeof open === "function") {
        open(MODELS_DOCS_URL).catch((/** @type {unknown} */ error) => {
          console.warn("[models-page] could not open the docs:", error);
        });
      }
    });
  }

  onLocaleChange(() => {
    if (apiKeysContainer?.isConnected) void loadApiKeysPanel({ preserveUi: true });
  });

  /** @type {ReturnType<typeof createProviderList>} */
  let providerList;
  const modelHealth = createModelHealth({
    call,
    apiKeysContainer: () => apiKeysContainer,
    escapeSelectorValue,
    getProviderModelRows: (provider) => providerList.getProviderModelRows(provider),
    getProviderModels: (provider) => providerList.getProviderModels(provider),
  });
  const editor = createProviderEditor({
    view,
    renderModelsConfigLayout,
    reloadModelsConfig: loadInlineModelsEditor,
    inlineModelsTextarea: () => inlineModelsTextarea,
    inlineModelsSave: () => inlineModelsSave,
    inlineModelsError: () => inlineModelsError,
    onModelConfigurationChanged,
    call,
    loadApiKeysPanel,
    catalogModels: (provider) => {
      const entry = catalogProviders.find((candidate) => candidate.provider === provider);
      return entry ? providerList.getProviderModels(entry) : [];
    },
    modelHealth,
  });

  providerList = createProviderList({
    modelHealth,
    providerExpansionState,
    apiKeysContainer: () => apiKeysContainer,
    escapeSelectorValue,
    call,
    onModelConfigurationChanged,
    loadApiKeysPanel,
    openApiKeyEditor: editor.openApiKeyEditor,
    removeApiKey: editor.removeApiKey,
  });

  const oauth = createModelsOAuth({
    call,
    oauthCall,
    oauthGateway,
    openExternal,
    onModelConfigurationChanged,
    providerIcon,
    apiKeysContainer: () => apiKeysContainer,
    catalogProviders: () => catalogProviders,
    renderApiKeysPanel: (providers) => {
      renderApiKeysPanel(/** @type {CatalogProvider[]} */ (providers));
    },
    loadApiKeysPanel,
    loadInlineModelsEditor,
    buildApiKeyRow: (provider) =>
      providerList.buildApiKeyRow(/** @type {CatalogProvider} */ (provider)),
    openApiKeyEditor: (row, provider) => {
      editor.openApiKeyEditor(row, /** @type {CatalogProvider} */ (provider));
    },
    setSelectedModelsConfigItem: (item) => {
      const { offerSetup, ...selection } =
        /** @type {ModelsConfigSelection & { offerSetup?: { server?: string, modelIds?: string[] } }} */ (
          item
        );
      view.selected = selection;
      view.providerDraft = null;
      view.modelDraft = null;
      view.offerSetup = offerSetup?.modelIds?.length
        ? {
            provider: selection.provider,
            server: offerSetup.server,
            modelIds: offerSetup.modelIds,
          }
        : null;
    },
  });

  return {
    loadApiKeysPanel,
    loadInlineModelsEditor,
    loadOAuthCapability: () => oauth.loadOAuthCapability(),
    confirmLeave: () => editor.confirmLeave(),
    hasUnsavedChanges: () => editor.hasUnsavedChanges(),
  };
}

/** @param {unknown} error */
function errorMessage(error) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    return String(/** @type {{ message: unknown }} */ (error).message ?? "");
  }
  return "";
}

/** @param {unknown} value */
function asConfigResponse(value) {
  if (!value || typeof value !== "object")
    return /** @type {ConfigGatewayResponse | null} */ (null);
  return /** @type {ConfigGatewayResponse} */ (value);
}

/**
 * @param {unknown} el
 * @returns {{
 *   textContent: string,
 *   classList: { add: (token: string) => void, remove: (token: string) => void },
 *   dataset: DOMStringMap,
 * } | null}
 */
function asSaveMessage(el) {
  if (!el || typeof el !== "object") return null;
  if (!("textContent" in el) || !("classList" in el) || !("dataset" in el)) return null;
  return /** @type {{ textContent: string, classList: { add: (token: string) => void, remove: (token: string) => void }, dataset: DOMStringMap }} */ (
    el
  );
}
