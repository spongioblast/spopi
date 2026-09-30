// ABOUTME: Model health labels, dots, and the provider health section.
// ABOUTME: A check asks the config gateway and paints each model row.

import { t } from "../../i18n/i18n.js";

export const HEALTH_CHECK_TIMEOUT_MS = 120_000;

/**
 * @typedef {{
 *   status?: string,
 *   latencyMs?: number,
 *   error?: string,
 * }} ModelHealthState
 *
 * @typedef {{
 *   id?: string,
 *   name?: string,
 *   provider?: string,
 *   available?: boolean,
 *   visible?: boolean,
 *   health?: ModelHealthState,
 * }} CatalogModel
 *
 * @typedef {{
 *   provider: string,
 *   displayName?: string,
 *   configured?: boolean,
 *   models?: CatalogModel[],
 * }} CatalogProvider
 *
 * @typedef {{
 *   provider?: string,
 *   modelId?: string,
 *   status?: string,
 *   latencyMs?: number,
 *   error?: string,
 * }} HealthCheckResult
 *
 * @typedef {{
 *   ok?: boolean,
 *   error?: string,
 *   data?: { results?: HealthCheckResult[] },
 * }} HealthCheckResponse
 *
 * @typedef {(
 *   op: string,
 *   params?: unknown,
 *   options?: { timeoutMs?: number },
 * ) => Promise<unknown>} ModelsConfigCall
 *
 * @typedef {object} ModelHealthDeps
 * @property {ModelsConfigCall} call
 * @property {() => Element | null | undefined} apiKeysContainer
 * @property {(value: unknown) => string} escapeSelectorValue
 * @property {(provider: string) => Element[]} getProviderModelRows
 * @property {(provider: CatalogProvider) => CatalogModel[]} getProviderModels
 */

/**
 * @param {ModelHealthDeps} deps
 */
export function createModelHealth(deps) {
  /** @param {ModelHealthState | null | undefined} health */
  function describeModelHealth(health) {
    if (!health || health.status === "unknown") return t("settings.apiKeys.healthUnknown");
    if (health.status === "healthy") {
      return health.latencyMs
        ? t("settings.apiKeys.healthyLatency", { latency: health.latencyMs })
        : t("settings.apiKeys.healthy");
    }
    return health.error
      ? t("settings.apiKeys.failedWithMessage", { message: health.error })
      : t("settings.apiKeys.failed");
  }

  /** @param {CatalogModel} model */
  function describeModelStatus(model) {
    const parts = [];
    if (!model.available) parts.push(t("settings.apiKeys.noKeyAvailable"));
    parts.push(describeModelHealth(model.health || { status: "unknown" }));
    return parts.join(" · ");
  }

  /** @param {CatalogModel[]} models */
  function describeProviderSummary(models) {
    const enabled = models.filter((model) => model.visible === true).length;
    const healthy = models.filter((model) => model.health?.status === "healthy").length;
    const issues = models.filter((model) => model.health?.status === "unhealthy").length;
    return t("settings.apiKeys.summary", { enabled, healthy, issues });
  }

  /** @param {ModelHealthState | null | undefined} health */
  function healthDotClass(health) {
    if (!health?.status || health.status === "unknown" || health.status === "checking") {
      return health?.status || "unknown";
    }
    if (health.status !== "healthy") return "unhealthy";
    if (typeof health.latencyMs !== "number") return "healthy";
    if (health.latencyMs < 1500) return "healthy";
    if (health.latencyMs < 3000) return "healthy-slow";
    return "healthy-veryslow";
  }

  /** @param {Element | null | undefined} row */
  function setModelRowChecking(row) {
    if (!row) return;
    const dot = row.querySelector(".api-model-health-dot");
    const status = row.querySelector(".api-model-health-status");
    if (dot) {
      dot.className = "api-model-health-dot checking";
      if ("title" in dot)
        /** @type {{ title: string }} */ (dot).title = t("settings.apiKeys.checkingHealth");
    }
    if (status) status.textContent = t("settings.apiKeys.checkingHealthEllipsis");
  }

  /**
   * @param {Element | null | undefined} row
   * @param {string} message
   */
  function setModelRowHealthError(row, message) {
    if (!row) return;
    const dot = row.querySelector(".api-model-health-dot");
    const status = row.querySelector(".api-model-health-status");
    const text = t("settings.apiKeys.failedWithMessage", {
      message: message || t("settings.apiKeys.healthCheckFailed"),
    });
    if (dot) {
      dot.className = "api-model-health-dot unknown";
      if ("title" in dot) /** @type {{ title: string }} */ (dot).title = text;
    }
    if (status) status.textContent = text;
  }

  /** @param {HealthCheckResult} result */
  function applyHealthResult(result) {
    const container = deps.apiKeysContainer();
    if (!container) return;
    const row = container.querySelector(
      `.api-model-row[data-provider="${deps.escapeSelectorValue(result.provider)}"][data-model-id="${deps.escapeSelectorValue(result.modelId)}"]`,
    );
    if (!row) return;
    const dot = row.querySelector(".api-model-health-dot");
    const status = row.querySelector(".api-model-health-status");
    const health = { status: result.status, latencyMs: result.latencyMs, error: result.error };
    if (dot) {
      dot.className = `api-model-health-dot ${healthDotClass(health)}`;
      if ("title" in dot)
        /** @type {{ title: string }} */ (dot).title = describeModelHealth(health);
    }
    if (status) status.textContent = describeModelHealth(health);
  }

  /** @param {string} provider */
  async function checkModelHealth(provider) {
    for (const modelRow of deps.getProviderModelRows(provider)) {
      const toggle = modelRow.querySelector(".api-model-visibility-toggle");
      const checked =
        toggle && "checked" in toggle
          ? /** @type {{ checked: boolean }} */ (toggle).checked
          : false;
      const available =
        "dataset" in modelRow
          ? /** @type {{ dataset: DOMStringMap }} */ (modelRow).dataset.available
          : undefined;
      if (checked && available !== "false") setModelRowChecking(modelRow);
    }
    const resp = await deps
      .call("check_model_health", { provider }, { timeoutMs: HEALTH_CHECK_TIMEOUT_MS })
      .catch((/** @type {unknown} */ error) => ({
        ok: false,
        error: errorMessage(error),
      }));
    const response = asHealthCheckResponse(resp);
    if (response?.ok && Array.isArray(response.data?.results)) {
      for (const result of response.data.results) applyHealthResult(result);
    } else {
      const message = response?.error || t("settings.apiKeys.healthCheckFailed");
      for (const modelRow of deps.getProviderModelRows(provider)) {
        const toggle = modelRow.querySelector(".api-model-visibility-toggle");
        const checked =
          toggle && "checked" in toggle
            ? /** @type {{ checked: boolean }} */ (toggle).checked
            : false;
        const available =
          "dataset" in modelRow
            ? /** @type {{ dataset: DOMStringMap }} */ (modelRow).dataset.available
            : undefined;
        if (checked && available !== "false") {
          setModelRowHealthError(modelRow, message);
        }
      }
    }
  }

  return {
    describeModelHealth,
    describeModelStatus,
    describeProviderSummary,
    healthDotClass,
    checkModelHealth,
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
function asHealthCheckResponse(value) {
  if (!value || typeof value !== "object") return /** @type {HealthCheckResponse | null} */ (null);
  return /** @type {HealthCheckResponse} */ (value);
}
