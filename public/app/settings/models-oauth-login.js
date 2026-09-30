// ABOUTME: Renders the owner-scoped OpenAI Codex device-code login dialog for Settings Models.
// ABOUTME: Shows only Pi-provided non-secret device-code events and never handles OAuth credentials.

import { t } from "../i18n/i18n.js";
import { createDialogEscape } from "../ui/dialog.js";

const DIALOG_CLASS = "oauth-login-dialog";

/**
 * @typedef {{
 *   type?: string,
 *   operationId?: string,
 *   verificationUri?: string,
 *   userCode?: string,
 *   expiresInSeconds?: number,
 *   message?: string,
 * }} OauthLoginEvent
 *
 * @typedef {{ event?: OauthLoginEvent | null }} OauthLoginEnvelope
 *
 * @typedef {{
 *   success?: boolean,
 *   error?: string,
 *   data?: { operationId?: string },
 * }} OauthCommandResponse
 *
 * @typedef {(frame: Record<string, unknown>) => Promise<unknown>} OauthLoginCommand
 * @typedef {(handler: (envelope: unknown) => void) => (() => void)} OauthLoginSubscribe
 *
 * @typedef {object} ModelsOAuthLoginDialogDeps
 * @property {OauthLoginCommand} command
 * @property {OauthLoginSubscribe} subscribe
 * @property {(url: string) => void} openExternal
 * @property {(text: string) => void} copyText
 * @property {(() => void) | null | undefined} [onSuccess]
 * @property {(() => void) | null | undefined} [onTerminal]
 */

/**
 * Device-code login dialog. `command` sends frames through the OAuth
 * gateway; `subscribe` receives `{ event }` envelopes whose `type` is one of
 * device_code / progress / complete / failed / cancelled / expired. `onTerminal` fires on every terminal state so the
 * caller can refresh provider state. No token data or OAuth protocol logic
 * lives here.
 *
 * @param {ModelsOAuthLoginDialogDeps} deps
 */
export function createModelsOAuthLoginDialog({
  command,
  subscribe,
  openExternal,
  copyText,
  onSuccess,
  onTerminal,
}) {
  /** @type {string | null} */
  let operationId = null;
  /** @type {HTMLDivElement | null} */
  let backdrop = null;
  /** @type {(() => void) | null} */
  let unsubscribe = null;
  /** @type {ReturnType<typeof setInterval> | null} */
  let countdownTimer = null;
  /** @type {(() => void) | null} */
  let unbindEscape = null;

  function ensureBackdrop() {
    if (!backdrop) {
      backdrop = document.createElement("div");
      backdrop.className = `${DIALOG_CLASS}-backdrop`;
      document.body.appendChild(backdrop);
    }
    backdrop.replaceChildren();
    return backdrop;
  }

  /**
   * @param {string} tag
   * @param {string} [className]
   * @param {string} [text]
   */
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function clearDialog() {
    if (backdrop) {
      backdrop.remove();
      backdrop = null;
    }
  }

  function clearCountdown() {
    if (countdownTimer) {
      clearInterval(countdownTimer);
    }
    countdownTimer = null;
  }

  /**
   * @param {string} action
   * @param {string} label
   * @param {boolean} [primary]
   */
  function button(action, label, primary = false) {
    const node = /** @type {HTMLButtonElement} */ (
      el("button", `ui-button ${primary ? "ui-button--primary" : "ui-button--secondary"}`, label)
    );
    node.type = "button";
    node.dataset.action = action;
    return node;
  }

  /** @param {HTMLButtonElement[] | null | undefined} actions */
  function renderBase(actions) {
    const root = ensureBackdrop();
    const panel = el("div", DIALOG_CLASS);
    const title = el("div", `${DIALOG_CLASS}-title`);
    const status = el("div", `${DIALOG_CLASS}-status`);
    panel.append(title, status);
    if (actions) {
      const row = el("div", `${DIALOG_CLASS}-actions`);
      for (const btn of actions) row.appendChild(btn);
      panel.appendChild(row);
    }
    root.appendChild(panel);
    return { root, panel, title, status };
  }

  /** @param {unknown} envelope */
  function handleEvent(envelope) {
    const event =
      envelope && typeof envelope === "object" && "event" in envelope
        ? /** @type {OauthLoginEnvelope} */ (envelope).event
        : null;
    if (!event || (operationId && event.operationId && event.operationId !== operationId)) return;
    switch (event.type) {
      case "device_code":
        renderDeviceCode(event);
        break;
      case "progress":
        renderProgress(event.message);
        break;
      case "complete":
        clearCountdown();
        renderSuccess();
        onSuccess?.();
        onTerminal?.();
        break;
      case "failed":
        clearCountdown();
        renderFailure(event.message);
        onTerminal?.();
        break;
      case "cancelled":
        clearCountdown();
        renderCancelled();
        onTerminal?.();
        break;
      case "expired":
        clearCountdown();
        renderExpired();
        onTerminal?.();
        break;
    }
  }

  /** @param {OauthLoginEvent} event */
  function renderDeviceCode(event) {
    const { panel, status } = renderBase([
      button("oauth-open-browser", t("settings.models.oauth.openBrowser"), true),
      button("oauth-copy-code", t("settings.models.oauth.copyCode")),
      button("oauth-cancel", t("settings.models.oauth.cancel")),
    ]);
    const titleEl = panel.querySelector(`.${DIALOG_CLASS}-title`);
    if (titleEl) titleEl.textContent = t("settings.models.oauth.signInWithChatGPT");
    // URL and code are plain text nodes; the URL is captured in the click
    // closure only — never stored in a data-* attribute.
    const url = event.verificationUri;
    const userCode = event.userCode;
    const code = el("div", `${DIALOG_CLASS}-code`, userCode);
    const urlEl = el("div", `${DIALOG_CLASS}-url`, url);
    panel.insertBefore(urlEl, status);
    panel.insertBefore(code, urlEl);
    // Local countdown from the relative expiry (no cross-process clock). It
    // renders into its own node so Pi's progress messages in the status node
    // can never clobber it — and vice versa. The bridge also emits an expired
    // terminal event on its own timer; this is the UI-side fallback so the
    // dialog never sits stale after expiry.
    clearCountdown();
    const countdown = el("div", `${DIALOG_CLASS}-countdown`);
    panel.insertBefore(countdown, status);
    if (event.expiresInSeconds && event.expiresInSeconds > 0) {
      let remaining = event.expiresInSeconds;
      const render = () => {
        countdown.textContent =
          remaining > 0 ? `${remaining}s` : t("settings.models.oauth.expired");
      };
      render();
      countdownTimer = setInterval(() => {
        remaining -= 1;
        if (remaining <= 0) {
          clearCountdown();
          renderExpired();
          onTerminal?.();
          return;
        }
        render();
      }, 1000);
    } else {
      countdown.textContent = t("settings.models.oauth.completeInBrowser");
    }
    requireAction(panel, "oauth-open-browser").addEventListener("click", () =>
      openExternal(String(url ?? "")),
    );
    requireAction(panel, "oauth-copy-code").addEventListener("click", () =>
      copyText(String(userCode ?? "")),
    );
    requireAction(panel, "oauth-cancel").addEventListener("click", cancel);
  }

  /** @param {string | undefined} message */
  function renderProgress(message) {
    const statusEl = backdrop?.querySelector(`.${DIALOG_CLASS}-status`);
    if (statusEl && message) statusEl.textContent = message;
  }

  function renderSuccess() {
    const { panel } = renderBase([button("oauth-close", t("actions.close"), true)]);
    const titleEl = panel.querySelector(`.${DIALOG_CLASS}-title`);
    if (titleEl) titleEl.textContent = t("settings.models.oauth.connected");
    requireAction(panel, "oauth-close").addEventListener("click", destroy);
  }

  /** @param {string | undefined} message */
  function renderFailure(message) {
    const { panel, status } = renderBase([
      button("oauth-retry", t("settings.models.oauth.retry"), true),
      button("oauth-close", t("actions.close")),
    ]);
    const titleEl = panel.querySelector(`.${DIALOG_CLASS}-title`);
    if (titleEl) titleEl.textContent = t("settings.models.oauth.failed");
    status.textContent = humanizeOauthFailure(message);
    requireAction(panel, "oauth-retry").addEventListener("click", retry);
    requireAction(panel, "oauth-close").addEventListener("click", destroy);
  }

  function renderCancelled() {
    const { panel } = renderBase([button("oauth-close", t("actions.close"), true)]);
    const titleEl = panel.querySelector(`.${DIALOG_CLASS}-title`);
    if (titleEl) titleEl.textContent = t("settings.models.oauth.cancelled");
    requireAction(panel, "oauth-close").addEventListener("click", destroy);
  }

  function renderExpired() {
    const { panel } = renderBase([
      button("oauth-retry", t("settings.models.oauth.retry"), true),
      button("oauth-close", t("actions.close")),
    ]);
    const titleEl = panel.querySelector(`.${DIALOG_CLASS}-title`);
    if (titleEl) titleEl.textContent = t("settings.models.oauth.expired");
    requireAction(panel, "oauth-retry").addEventListener("click", retry);
    requireAction(panel, "oauth-close").addEventListener("click", destroy);
  }

  async function retry() {
    unsubscribe?.();
    unsubscribe = null;
    operationId = null;
    await start();
  }

  function renderPreparing() {
    const { panel } = renderBase([button("oauth-cancel", t("settings.models.oauth.cancel"))]);
    const titleEl = panel.querySelector(`.${DIALOG_CLASS}-title`);
    if (titleEl) titleEl.textContent = t("settings.models.oauth.preparing");
    requireAction(panel, "oauth-cancel").addEventListener("click", cancel);
  }

  function cancel() {
    const cancelBtn = backdrop?.querySelector('[data-action="oauth-cancel"]');
    if (cancelBtn && "disabled" in cancelBtn) {
      /** @type {{ disabled: boolean }} */ (cancelBtn).disabled = true;
    }
    if (!operationId) {
      destroy();
      return;
    }
    void command({ type: "cancel_oauth_login", operationId });
  }

  function onEscape() {
    if (backdrop?.querySelector('[data-action="oauth-cancel"]:not([disabled])')) {
      cancel();
      return;
    }
    destroy();
  }

  async function start() {
    // Subscribe and show the preparing dialog before the round-trip so a
    // slow start command cannot look like a dead click, and so a device
    // code that arrives immediately is not dropped (no activeHandler).
    unsubscribe?.();
    unsubscribe = subscribe(handleEvent);
    if (!unbindEscape) {
      unbindEscape = createDialogEscape(onEscape, {
        isActive: () => Boolean(backdrop?.isConnected),
      });
    }
    renderPreparing();
    /** @type {unknown} */
    let resp;
    try {
      resp = await command({
        type: "start_oauth_login",
        provider: "openai-codex",
        method: "device_code",
      });
    } catch (error) {
      // The transport failed to deliver the command. Surface a failure
      // instead of leaving the dialog silent.
      renderFailure(errorMessage(error) || t("settings.models.oauth.failed"));
      return;
    }
    const response = asOauthCommandResponse(resp);
    if (response?.success && response.data?.operationId) {
      operationId = response.data.operationId;
    } else {
      renderFailure(response?.error || t("settings.models.oauth.failed"));
    }
  }

  function destroy() {
    unbindEscape?.();
    unbindEscape = null;
    unsubscribe?.();
    unsubscribe = null;
    operationId = null;
    clearCountdown();
    clearDialog();
    onTerminal?.();
  }

  return { start, destroy };
}

/**
 * @param {ParentNode} panel
 * @param {string} action
 */
function requireAction(panel, action) {
  const node = panel.querySelector(`[data-action="${action}"]`);
  if (!node) throw new Error(`oauth dialog control missing: ${action}`);
  return node;
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
function asOauthCommandResponse(value) {
  if (!value || typeof value !== "object") return /** @type {OauthCommandResponse | null} */ (null);
  return /** @type {OauthCommandResponse} */ (value);
}

/**
 * Defensive client-side redaction for failure messages. The bridge already
 * sanitizes, but the dialog never trusts a raw message that could carry a
 * token-like fragment into the DOM.
 *
 * @param {unknown} raw
 */
function humanizeOauthFailure(raw) {
  const text = String(raw ?? "");
  if (
    /self.?signed certificate in certificate chain/i.test(text) ||
    /unable to verify the first certificate/i.test(text)
  ) {
    return t("settings.models.oauth.tlsUntrusted");
  }
  return sanitizeDialogMessage(raw);
}

/** @param {unknown} raw */
function sanitizeDialogMessage(raw) {
  const collapsed = String(raw ?? "")
    .replace(/\s+/g, " ")
    .trim();
  const redacted = collapsed
    .replace(/\bauthorization\s*:\s*bearer\s+[^\s]+/gi, " [redacted]")
    .replace(/\bbearer\s+[^\s]+/gi, " [redacted]")
    .replace(
      /\b(?:token|refresh|access|secret|code|key|authorization)\b\s*=\s*[^\s]+/gi,
      " [redacted]",
    )
    .replace(
      /\b(?:token|refresh|access|secret|code|key|authorization)\b\s*:\s*[^\s]+/gi,
      " [redacted]",
    )
    .replace(/[?&][^\s]*/g, " [redacted]")
    .replace(/\s+/g, " ")
    .trim();
  return redacted || "";
}
