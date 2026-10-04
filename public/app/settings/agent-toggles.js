// ABOUTME: Auto-compaction and auto-retry toggles for General settings.
// ABOUTME: Each one sends the live RPC first, then writes settings.json.

import { randomId } from "../utils/random-id.js";

/**
 * @typedef {import("./general-settings.js").GeneralSettingsDeps} GeneralSettingsDeps
 * @typedef {import("./general-settings.js").ConfigGatewayLike} ConfigGatewayLike
 * @typedef {import("./general-toggles.js").SettingToggleConfig} SettingToggleConfig
 */

/**
 * @param {GeneralSettingsDeps | null | undefined} deps
 * @param {string} type
 * @param {boolean} enabled
 */
async function applyLive(deps, type, enabled) {
  if (!deps?.runtime?.request) return;
  await deps.runtime.request({ type, enabled }, deps.getTarget?.() ?? null, {
    idempotencyKey: randomId(),
  });
}

/**
 * @param {ConfigGatewayLike | null | undefined} configGateway
 * @param {string} op
 * @param {Record<string, unknown>} params
 * @param {string} failure
 */
async function callConfig(configGateway, op, params, failure) {
  if (!configGateway) return undefined;
  const response = await configGateway.call(op, params);
  if (!response?.ok) throw new Error(response?.error || failure);
  return response.data?.enabled;
}

/**
 * @param {GeneralSettingsDeps | null | undefined} deps
 * @returns {SettingToggleConfig[]}
 */
export function agentToggleSpecs(deps) {
  return [
    {
      id: "toggle-auto-compact",
      key: "auto-compact",
      label: "Auto-compaction",
      defaultValue: true,
      persist: "config",
      load: (configGateway) =>
        callConfig(
          configGateway,
          "get_default_auto_compaction",
          { scope: "global" },
          "Failed to load auto-compaction",
        ),
      save: async (configGateway, value) => {
        await applyLive(deps, "set_auto_compaction", value);
        await callConfig(
          configGateway,
          "set_default_auto_compaction",
          { enabled: value, scope: "global" },
          "Failed to save auto-compaction",
        );
      },
      onChange: (value) => {
        document.body.dataset.autoCompact = value ? "on" : "off";
      },
    },
    {
      id: "toggle-auto-retry",
      key: "auto-retry",
      label: "Auto-retry",
      labelKey: "settings.autoRetry",
      defaultValue: true,
      persist: "config",
      load: (configGateway) =>
        callConfig(
          configGateway,
          "get_default_auto_retry",
          { scope: "global" },
          "Failed to load auto-retry",
        ),
      save: async (configGateway, value) => {
        await applyLive(deps, "set_auto_retry", value);
        await callConfig(
          configGateway,
          "set_default_auto_retry",
          { enabled: value, scope: "global" },
          "Failed to save auto-retry",
        );
      },
    },
  ];
}
