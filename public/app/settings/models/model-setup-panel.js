// ABOUTME: Runs "Set up model" for one custom model and shows what it found as a checklist.
// ABOUTME: The bridge sends a few tiny requests; this module writes nothing itself.

import { t } from "../../i18n/i18n.js";

const SETUP_TIMEOUT_MS = 150_000;

/**
 * @typedef {import("./model-draft.js").SetupResult} SetupResult
 * @typedef {(op: string, params?: unknown, options?: unknown) => Promise<unknown>} ConfigCall
 */

const CHECK_ORDER = ["context", "thinking", "effort", "images", "budget"];
/** @type {Record<string, string>} */
const CHECK_LABELS = {
  context: "models.setup.check.context",
  thinking: "models.setup.check.thinking",
  effort: "models.setup.check.effort",
  images: "models.setup.check.images",
  budget: "models.setup.check.budget",
};

/**
 * @param {{ id: string, ok: boolean | null, detail: string }} check
 */
function checkText(check) {
  const known = {
    switchable: "models.setup.thinkingSwitchable",
    always: "models.setup.thinkingAlways",
    none: "models.setup.thinkingNone",
    accepted: "models.setup.accepted",
    rejected: "models.setup.rejected",
    "not reported": "models.setup.notReported",
    "not vLLM": "models.setup.notVllm",
    "no thinking": "models.setup.noThinking",
    ignored: "models.setup.effortIgnored",
  };
  const key = known[/** @type {keyof typeof known} */ (check.detail)];
  if (key) return t(key);
  if (check.id === "context" && /^\d+$/.test(check.detail)) {
    return t("models.setup.contextTokens", { tokens: Number(check.detail).toLocaleString() });
  }
  return check.detail;
}

/**
 * @param {SetupResult} result
 */
function renderSetupChecklist(result) {
  const list = document.createElement("ul");
  list.className = "model-setup-checklist";
  const checks = [...(result?.checks || [])].sort(
    (a, b) => CHECK_ORDER.indexOf(a.id) - CHECK_ORDER.indexOf(b.id),
  );
  for (const check of checks) {
    const item = document.createElement("li");
    item.className = "model-setup-check";
    item.dataset.check = check.id;
    item.dataset.state = check.ok === true ? "ok" : check.ok === false ? "no" : "unknown";
    const mark = document.createElement("span");
    mark.className = "model-setup-mark";
    mark.setAttribute("aria-hidden", "true");
    mark.textContent = check.ok === true ? "✓" : check.ok === false ? "✗" : "–";
    const label = document.createElement("span");
    label.className = "model-setup-label";
    label.textContent = CHECK_LABELS[check.id] ? t(CHECK_LABELS[check.id]) : check.id;
    const detail = document.createElement("span");
    detail.className = "model-setup-detail";
    detail.textContent = checkText(check);
    item.append(mark, label, detail);
    list.appendChild(item);
  }
  return list;
}

/**
 * @param {{
 *   call: ConfigCall,
 *   provider: string,
 *   modelId: string,
 *   server?: string,
 *   container: HTMLElement,
 * }} options
 * @returns {Promise<SetupResult | null>}
 */
export async function runModelSetup({ call, provider, modelId, server, container }) {
  container.replaceChildren();
  container.hidden = false;
  container.classList.add("model-setup-panel");
  const status = document.createElement("p");
  status.className = "model-setup-status";
  status.setAttribute("role", "status");
  status.textContent = t("models.setup.running", { model: modelId });
  container.appendChild(status);
  try {
    const response = /** @type {{ ok?: boolean, error?: string, data?: SetupResult } | null} */ (
      await call(
        "setup_custom_model",
        { provider, modelId, ...(server ? { server } : {}) },
        { timeoutMs: SETUP_TIMEOUT_MS },
      )
    );
    if (!response?.ok || !response.data) {
      throw new Error(response?.error || t("models.setup.failed"));
    }
    status.textContent = t("models.setup.done", { model: modelId });
    container.appendChild(renderSetupChecklist(response.data));
    return response.data;
  } catch (error) {
    status.textContent = t("models.setup.failedWith", {
      detail: error instanceof Error ? error.message : String(error),
    });
    status.dataset.state = "error";
    return null;
  }
}
