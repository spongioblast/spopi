// ABOUTME: The Key row of a custom provider: where its key comes from, plus Replace, Remove, Move.
// ABOUTME: The key itself never reaches this page; the bridge reports only the source.

import { t } from "../../i18n/i18n.js";
import { confirmDialog } from "../../ui/dialog.js";

/**
 * @typedef {"auth" | "env" | "command" | "literal" | "placeholder" | "none"} KeySource
 * @typedef {{ source: KeySource, modelsLiteral?: boolean }} KeyStatus
 * @typedef {(op: string, params?: unknown, options?: unknown) => Promise<unknown>} ConfigCall
 */

const SOURCE_LABELS = {
  auth: "models.key.source.auth",
  env: "models.key.source.env",
  command: "models.key.source.command",
  literal: "models.key.source.literal",
  placeholder: "models.key.source.placeholder",
  none: "models.key.source.none",
};

/** `$NAME`, `${NAME}`, or `!command`: written to models.json as a reference. */
export function isKeyReference(/** @type {string} */ value) {
  const key = value.trim();
  return key.startsWith("!") || /(^|[^$])\$(\{[A-Za-z_]\w*\}|[A-Za-z_])/.test(key);
}

/**
 * @param {unknown} response
 * @returns {{ ok?: boolean, error?: string, data?: KeyStatus }}
 */
function asResponse(response) {
  return response && typeof response === "object" ? /** @type {never} */ (response) : {};
}

/**
 * @param {{
 *   call: ConfigCall,
 *   provider: string,
 *   onChanged: () => Promise<void> | void,
 * }} options
 */
export function createProviderKeyRow({ call, provider, onChanged }) {
  const row = document.createElement("div");
  row.className = "models-config-field provider-key-row";
  const caption = document.createElement("span");
  caption.textContent = t("models.key.label");
  const body = document.createElement("div");
  body.className = "provider-key-body";
  const source = document.createElement("span");
  source.className = "provider-key-source";
  source.textContent = t("settings.config.loading");
  const actions = document.createElement("div");
  actions.className = "provider-key-actions";
  const error = document.createElement("small");
  error.className = "provider-key-error";
  error.hidden = true;
  const testResult = document.createElement("small");
  testResult.className = "provider-key-test";
  testResult.hidden = true;
  body.append(source, actions);
  row.append(caption, body, testResult, error);
  /** @type {KeySource | null} */
  let currentSource = null;

  /** @param {string} message */
  const showError = (message) => {
    error.textContent = message;
    error.hidden = !message;
  };

  /**
   * @param {string} op
   * @param {Record<string, unknown>} params
   */
  async function change(op, params) {
    showError("");
    const response = asResponse(
      await call(op, { provider, ...params }).catch((e) => ({ error: e?.message })),
    );
    if (!response.ok) {
      showError(response.error || t("settings.apiKeys.saveFailed"));
      return false;
    }
    if (response.data) render(response.data);
    await onChanged();
    return true;
  }

  /**
   * @param {string} label
   * @param {string} className
   * @param {() => void} onClick
   */
  function button(label, className, onClick) {
    const el = document.createElement("button");
    el.type = "button";
    el.className = `ui-button ui-button--sm ${className}`;
    el.textContent = label;
    el.addEventListener("click", onClick);
    return el;
  }

  /**
   * @param {string} text
   * @param {"ok" | "fail" | "busy"} state
   */
  function showTest(text, state) {
    testResult.textContent = text;
    testResult.dataset.state = state;
    testResult.hidden = false;
  }

  async function testAccess() {
    showError("");
    showTest(t("models.key.testing"), "busy");
    /** @type {{ ok?: boolean, error?: string, data?: { ok?: boolean, status?: number, latencyMs?: number, modelCount?: number, needsKey?: boolean, error?: string } }} */
    const response =
      /** @type {never} */ (
        await call("test_provider_access", { provider }, { timeoutMs: 30_000 }).catch((e) => ({
          error: e?.message,
        }))
      ) || {};
    const result = response.data;
    if (!response.ok || !result) {
      showTest(t("models.key.testFailed", { error: response.error || "" }), "fail");
      return;
    }
    const keyless = currentSource === "placeholder" || currentSource === "none";
    if (result.ok) {
      showTest(
        t(keyless ? "models.key.testOkKeyless" : "models.key.testOk", {
          count: result.modelCount ?? 0,
          ms: Math.round(result.latencyMs ?? 0),
        }),
        "ok",
      );
    } else if (result.needsKey) {
      showTest(
        t(keyless ? "models.key.testNeedsKey" : "models.key.testKeyRejected", {
          status: result.status ?? "",
        }),
        "fail",
      );
    } else {
      showTest(t("models.key.testFailed", { error: result.error || "" }), "fail");
    }
  }

  function openReplace() {
    const input = document.createElement("input");
    input.type = "password";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.className = "ui-input provider-key-input";
    input.placeholder =
      currentSource === "placeholder" || currentSource === "none"
        ? t("models.key.optionalPlaceholder")
        : t("models.key.replacePlaceholder");
    input.setAttribute("aria-label", t("models.key.label"));
    const save = button(t("actions.save"), "ui-button--primary provider-key-save", () => {
      const value = input.value.trim();
      if (!value) {
        showError(t("settings.apiKeys.keyCannotBeEmpty"));
        return;
      }
      void change(
        "set_provider_key",
        isKeyReference(value) ? { reference: value } : { apiKey: value },
      );
    });
    const cancel = button(t("actions.cancel"), "ui-button--ghost", () => void load());
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        save.click();
      }
      if (event.key === "Escape") {
        event.preventDefault();
        cancel.click();
      }
    });
    const hint = document.createElement("small");
    hint.className = "provider-key-hint";
    hint.textContent = t("models.key.replaceHint");
    actions.replaceChildren(input, save, cancel);
    error.hidden = true;
    body.after(hint);
    input.focus();
  }

  /** @param {KeyStatus} status */
  function render(status) {
    row.querySelector(".provider-key-hint")?.remove();
    if (currentSource !== status.source) testResult.hidden = true;
    currentSource = status.source;
    row.dataset.source = status.source;
    source.textContent = t(SOURCE_LABELS[status.source] || "models.key.unknown");
    const buttons = [
      button(t("models.key.test"), "ui-button--secondary provider-key-test-button", () => {
        void testAccess();
      }),
      button(
        status.source === "placeholder"
          ? t("models.key.addOptional")
          : status.source === "none"
            ? t("models.key.add")
            : t("models.key.replace"),
        "ui-button--ghost provider-key-replace",
        openReplace,
      ),
    ];
    if (status.modelsLiteral) {
      buttons.push(
        button(t("models.key.move"), "ui-button--ghost provider-key-move", () => {
          void change("move_provider_key_to_auth", {});
        }),
      );
    }
    if (status.source !== "none" && status.source !== "placeholder") {
      buttons.push(
        button(t("actions.remove"), "ui-button--danger provider-key-remove", () => {
          void (async () => {
            const ok = await confirmDialog({
              message: t("models.key.removeConfirm", { provider }),
              confirmLabel: t("actions.remove"),
              danger: true,
            });
            if (ok) await change("remove_provider_key", {});
          })();
        }),
      );
    }
    actions.replaceChildren(...buttons);
  }

  async function load() {
    showError("");
    const response = asResponse(
      await call("get_provider_key_status", { provider }).catch((e) => ({ error: e?.message })),
    );
    if (!response.ok || !response.data) {
      source.textContent = t("models.key.unknown");
      actions.replaceChildren();
      showError(response.error || "");
      return;
    }
    render(response.data);
  }

  void load();
  return { element: row, reload: load };
}
