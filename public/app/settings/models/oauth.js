// ABOUTME: Models settings OAuth login, Codex logout, and the provider picker.
// ABOUTME: Dialogs talk to the config and OAuth gateways through the deps bag.

import { t } from "../../i18n/i18n.js";
import { confirmDialog, openDialog } from "../../ui/dialog.js";
import { createModelsOAuthLoginDialog } from "../models-oauth-login.js";
import { openCustomProviderEditor } from "../settings-custom-provider.js";

/**
 * @typedef {{
 *   provider: string,
 *   displayName?: string,
 *   configured?: boolean,
 *   custom?: boolean,
 *   authType?: string,
 *   source?: string,
 *   models?: unknown[],
 * }} PickerProvider
 *
 * @typedef {{
 *   providerId?: string,
 *   configured?: boolean,
 * }} CodexOAuthCapability
 *
 * @typedef {{
 *   success?: boolean,
 *   ok?: boolean,
 *   error?: string,
 *   data?: { providers?: CodexOAuthCapability[] },
 * }} OauthGatewayResponse
 *
 * @typedef {{
 *   command: (frame: Record<string, unknown>, options?: unknown) => Promise<unknown>,
 *   subscribe: (handler: (envelope: unknown) => void) => (() => void),
 * } | null | undefined} OauthGateway
 *
 * @typedef {(
 *   op: string,
 *   params?: unknown,
 *   options?: unknown,
 * ) => Promise<unknown>} ModelsConfigCall
 *
 * @typedef {(
 *   op: string,
 *   params?: Record<string, unknown>,
 *   options?: unknown,
 * ) => Promise<unknown>} ModelsOauthCall
 *
 * @typedef {{ start: () => Promise<void>, destroy: () => void }} OauthLoginDialog
 *
 * @typedef {{
 *   ok?: boolean,
 *   error?: string,
 *   data?: Record<string, unknown>,
 * }} CustomProviderCallResult
 *
 * @typedef {object} ModelsOAuthDeps
 * @property {ModelsConfigCall} call
 * @property {ModelsOauthCall} oauthCall
 * @property {((url: string) => Promise<unknown>) | null | undefined} [openExternal]
 * @property {OauthGateway} oauthGateway
 * @property {((change?: { providers?: string[] }) => Promise<void> | void) | null | undefined} [onModelConfigurationChanged]
 * @property {(provider: string, className?: string) => Element} providerIcon
 * @property {() => Element | null | undefined} apiKeysContainer
 * @property {() => PickerProvider[]} catalogProviders
 * @property {(providers: PickerProvider[]) => void} renderApiKeysPanel
 * @property {(options?: { preserveUi?: boolean }) => Promise<void> | void} loadApiKeysPanel
 * @property {() => Promise<void> | void} loadInlineModelsEditor
 * @property {(provider: PickerProvider) => Element} buildApiKeyRow
 * @property {(row: Element, provider: PickerProvider) => void} openApiKeyEditor
 * @property {(item: {
 *   type: string,
 *   provider: string,
 *   offerSetup?: { server?: string, modelIds: string[] },
 * }) => void} setSelectedModelsConfigItem
 */

/**
 * @param {ModelsOAuthDeps} deps
 */
export function createModelsOAuth(deps) {
  /** @type {CodexOAuthCapability | null} */
  let codexOAuthCapability = null;
  /** @type {OauthLoginDialog | null} */
  let oauthDialog = null;

  /** @param {PickerProvider | null | undefined} provider */
  function isCodexProvider(provider) {
    return provider?.provider === "openai-codex";
  }

  function buildCodexConnectedCard() {
    const card = document.createElement("div");
    card.className = "provider-manager-card oauth-connected-card";
    const title = document.createElement("div");
    title.className = "api-key-row-name";
    title.textContent = t("settings.models.oauth.connected");
    const logoutBtn = document.createElement("button");
    logoutBtn.type = "button";
    logoutBtn.className = "ui-button ui-button--secondary";
    logoutBtn.textContent = t("settings.models.oauth.logout");
    logoutBtn.addEventListener("click", () => void logoutCodex());
    card.append(title, logoutBtn);
    return card;
  }

  async function loadOAuthCapability() {
    if (!deps.oauthGateway) return;
    try {
      const resp = asOauthGatewayResponse(await deps.oauthCall("get_oauth_login_capabilities"));
      const providers =
        resp?.success && Array.isArray(resp.data?.providers) ? resp.data.providers : [];
      codexOAuthCapability = providers.find((p) => p.providerId === "openai-codex") ?? null;
    } catch {
      codexOAuthCapability = null;
    }
    const apiKeysContainer = deps.apiKeysContainer();
    if (apiKeysContainer?.isConnected && deps.catalogProviders().length > 0) {
      deps.renderApiKeysPanel(deps.catalogProviders());
    }
  }

  function startOAuthLogin() {
    oauthDialog?.destroy();
    oauthDialog = createModelsOAuthLoginDialog({
      command: (frame) => deps.oauthCall(String(frame.type), frame),
      subscribe: (handler) => deps.oauthGateway?.subscribe(handler) ?? (() => {}),
      openExternal: (url) => {
        if (!deps.openExternal) return;
        deps.openExternal(url).catch((/** @type {unknown} */ error) => {
          console.warn("[models-page] could not open the login url:", error);
        });
      },
      copyText: (text) => {
        void navigator.clipboard?.writeText(text);
      },
      onSuccess: async () => {
        await deps.onModelConfigurationChanged?.();
        await deps.loadApiKeysPanel();
        await loadOAuthCapability();
        await deps.loadInlineModelsEditor();
      },
      onTerminal: () => {},
    });
    void oauthDialog.start().catch((/** @type {unknown} */ error) => {
      console.warn("[models-page] OAuth login failed to start:", error);
    });
  }

  async function logoutCodex() {
    const ok = await confirmDialog({
      message: t("settings.models.oauth.logoutConfirm", { provider: "OpenAI Codex" }),
    });
    if (!ok) return;
    const resp = asOauthGatewayResponse(
      await deps.call("oauth_logout", { provider: "openai-codex" }).catch(() => null),
    );
    if (resp?.ok) {
      await deps.onModelConfigurationChanged?.();
      await deps.loadApiKeysPanel();
      await loadOAuthCapability();
    }
  }

  /** @param {unknown} value */
  function escapeSelectorValue(value) {
    if (globalThis.CSS?.escape) return globalThis.CSS.escape(String(value));
    return String(value).replace(/["\\]/g, "\\$&");
  }

  /** @param {PickerProvider[]} providers */
  function openProviderPicker(providers) {
    const root = document.getElementById("dialog-container");
    if (!root) throw new Error("dialog container is missing");
    let closePicker = () => {};
    const shell = document.createElement("div");
    const head = document.createElement("div");
    head.className = "provider-picker-head";
    head.innerHTML = `<div><h2 id="provider-picker-title">Add provider</h2><p>Connect a provider to start using its models.</p></div>`;
    const close = document.createElement("button");
    close.type = "button";
    close.className = "ui-icon-button ui-icon-button--ghost provider-picker-close";
    close.setAttribute("aria-label", "Close");
    close.textContent = "×";
    head.appendChild(close);
    const search = document.createElement("input");
    search.className = "ui-input provider-picker-search";
    search.placeholder = "Search providers…";
    const toolbar = document.createElement("div");
    toolbar.className = "provider-picker-toolbar";
    toolbar.append(head, search);
    const body = document.createElement("div");
    body.className = "provider-picker-body";
    shell.append(toolbar, body);

    /**
     * @param {string} section
     * @param {PickerProvider} p
     */
    const pickerSubtitle = (section, p) => {
      if (section === "custom") return "Custom endpoint";
      if (section === "subscriptions") return "OAuth";
      const count = Array.isArray(p.models) ? p.models.length : 0;
      if (count <= 0) return "";
      return count === 1 ? "1 model" : `${count} models`;
    };

    /**
     * @param {Element} parent
     * @param {PickerProvider} p
     * @param {string} section
     */
    const appendPickerCard = (parent, p, section) => {
      const card = document.createElement("button");
      card.className = "provider-picker-card";
      card.type = "button";
      card.dataset.section = section;
      const logo = deps.providerIcon(p.provider);
      const text = document.createElement("span");
      const strong = document.createElement("strong");
      strong.textContent = p.displayName || p.provider;
      text.append(strong);
      const subtitle = pickerSubtitle(section, p);
      if (subtitle) {
        const small = document.createElement("small");
        small.textContent = subtitle;
        text.append(small);
      }
      card.append(logo, text);
      card.addEventListener("click", () => {
        closePicker();
        if (p.custom) {
          openCustomProviderEditor({
            call: async (op, params, options) => {
              const result = await deps.call(op, params, options);
              return /** @type {CustomProviderCallResult} */ (
                result && typeof result === "object" ? result : { ok: false }
              );
            },
            setupDialog: (title, subtitle) => {
              const opened = setupDialog(title, subtitle);
              return {
                backdrop: /** @type {HTMLElement} */ (/** @type {unknown} */ (opened.backdrop)),
                dialog: /** @type {HTMLElement} */ (opened.dialog),
              };
            },
            onSaved: async (providerId, info) => {
              if (providerId)
                deps.setSelectedModelsConfigItem({
                  type: "provider",
                  provider: String(providerId),
                  offerSetup: { server: info?.server, modelIds: info?.modelIds ?? [] },
                });
              await deps.loadInlineModelsEditor();
              await deps.loadApiKeysPanel();
              if (providerId) {
                await deps.onModelConfigurationChanged?.({ providers: [String(providerId)] });
              }
            },
          });
          return;
        }
        if (section === "subscriptions") {
          openSubscriptionSetup(p);
          return;
        }
        const apiKeysContainer = deps.apiKeysContainer();
        if (!apiKeysContainer) return;
        let row = apiKeysContainer.querySelector(
          `[data-provider="${escapeSelectorValue(p.provider)}"]`,
        );
        if (!row) {
          row = deps.buildApiKeyRow(p);
          const detail = apiKeysContainer.querySelector(".models-config-main");
          detail?.replaceChildren(row);
        }
        deps.openApiKeyEditor(row, p);
      });
      parent.appendChild(card);
    };

    /**
     * @param {string} label
     * @param {string} section
     * @param {PickerProvider[]} items
     */
    const appendPickerSection = (label, section, items) => {
      if (!items.length) return;
      const group = document.createElement("section");
      group.className = "provider-picker-section";
      const heading = document.createElement("h3");
      heading.className = "provider-picker-section-title";
      heading.dataset.section = section;
      heading.textContent = label;
      const wrap = document.createElement("div");
      wrap.className = "provider-picker-grid";
      for (const p of items) appendPickerCard(wrap, p, section);
      group.append(heading, wrap);
      body.appendChild(group);
    };

    const render = () => {
      body.replaceChildren();
      const q = search.value.toLowerCase();
      const matches = providers.filter((p) =>
        (p.displayName || p.provider).toLowerCase().includes(q),
      );
      /** @type {PickerProvider} */
      const custom = {
        provider: "custom",
        displayName: "OpenAI / Anthropic compatible",
        custom: true,
      };
      const customItems =
        !q || "custom openai-compatible anthropic-compatible".includes(q)
          ? [custom]
          : matches.filter((p) => p.custom || p.provider === "custom");
      const subscriptionItems = matches.filter(
        (p) =>
          !p.custom &&
          (p.authType === "oauth" ||
            p.source === "oauth" ||
            p.source === "subscription" ||
            (isCodexProvider(p) && Boolean(deps.oauthGateway))),
      );
      const featuredItems = [
        ...customItems.map((p) => ({ p, section: "custom" })),
        ...subscriptionItems.map((p) => ({ p, section: "subscriptions" })),
      ];
      if (featuredItems.length) {
        const group = document.createElement("section");
        group.className = "provider-picker-section";
        group.setAttribute("aria-label", "Custom and subscriptions");
        const wrap = document.createElement("div");
        wrap.className = "provider-picker-featured";
        wrap.dataset.section = "featured";
        for (const { p, section } of featuredItems) appendPickerCard(wrap, p, section);
        group.appendChild(wrap);
        body.appendChild(group);
      }
      appendPickerSection(
        "API key",
        "apiKey",
        matches.filter(
          (p) =>
            !p.custom &&
            !(isCodexProvider(p) && Boolean(deps.oauthGateway)) &&
            p.authType !== "oauth" &&
            p.source !== "oauth" &&
            p.source !== "subscription",
        ),
      );
    };
    search.addEventListener("input", render);
    root.classList.add("ui-overlay", "provider-picker-backdrop");
    const handle = openDialog({
      container: root,
      body: shell,
      className: "ui-dialog provider-picker-dialog",
      initialFocus: search,
      onClose: () => root.classList.remove("ui-overlay", "provider-picker-backdrop"),
    });
    handle.element.setAttribute("aria-labelledby", "provider-picker-title");
    closePicker = () => handle.close();
    close.addEventListener("click", closePicker);
    render();
  }

  /**
   * @param {string} title
   * @param {string} subtitle
   */
  function setupDialog(title, subtitle) {
    const root = document.getElementById("dialog-container");
    if (!root) throw new Error("dialog container is missing");
    const caption = document.createElement("p");
    caption.textContent = subtitle;
    root.classList.add("ui-overlay", "provider-picker-backdrop");
    const handle = openDialog({
      container: root,
      title,
      body: caption,
      className: "ui-dialog provider-setup-dialog",
      onClose: () => root.classList.remove("ui-overlay", "provider-picker-backdrop"),
    });
    const close = document.createElement("button");
    close.type = "button";
    close.className = "ui-icon-button ui-icon-button--ghost provider-picker-close";
    close.setAttribute("aria-label", "Close");
    close.textContent = "×";
    close.onclick = () => handle.close();
    handle.element.querySelector(".dialog-title")?.append(close);
    return {
      backdrop: { remove: () => handle.close() },
      dialog: handle.element,
    };
  }

  /** @param {PickerProvider} p */
  function openSubscriptionSetup(p) {
    const isCodex = deps.oauthGateway && isCodexProvider(p);
    if (isCodex) {
      if (codexOAuthCapability?.configured) {
        void logoutCodex();
        return;
      }
      startOAuthLogin();
      return;
    }
    showTerminalLoginDialog(p);
  }

  /** @param {PickerProvider} p */
  function showTerminalLoginDialog(p) {
    const { backdrop, dialog } = setupDialog(
      `Connect ${p.displayName || p.provider}`,
      "This provider uses your subscription account.",
    );
    const note = document.createElement("div");
    note.className = "provider-setup-note";
    note.textContent =
      "OAuth login is run by the pi agent. Start the login flow from a terminal, then return here to refresh the provider status.";
    dialog.appendChild(note);
    const command = document.createElement("code");
    command.className = "provider-login-command";
    command.textContent = `pi /login ${p.provider}`;
    dialog.appendChild(command);
    const actions = document.createElement("div");
    actions.className = "provider-setup-actions";
    const close = document.createElement("button");
    close.className = "ui-button ui-button--secondary";
    close.textContent = "Close";
    close.onclick = () => backdrop.remove();
    actions.appendChild(close);
    dialog.appendChild(actions);
  }

  return {
    isCodexProvider,
    buildCodexConnectedCard,
    loadOAuthCapability,
    startOAuthLogin,
    openProviderPicker,
    setupDialog,
    get codexOAuthCapability() {
      return codexOAuthCapability;
    },
  };
}

/** @param {unknown} value */
function asOauthGatewayResponse(value) {
  if (!value || typeof value !== "object") return /** @type {OauthGatewayResponse | null} */ (null);
  return /** @type {OauthGatewayResponse} */ (value);
}
