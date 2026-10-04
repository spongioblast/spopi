// ABOUTME: Keeps the workbench's recommended-packages panel: install queue, install errors, health, first run.
// ABOUTME: Installs go through the host installPackage contract; the panel itself is mounted by packages-page.js.

import { t } from "../i18n/i18n.js";
import { extensionErrors } from "../packages/extension-errors.js";
import { notePackageHealth } from "../packages/packages-installed.js";
import { mountExtensionsPanel } from "../packages/packages-page.js";
import { extensionsSettingsRefs } from "../settings/extensions-settings.js";

/**
 * @typedef {import("../packages/packages-recommended.js").PackageRef} PackageRef
 * @typedef {import("./mount-workbench.js").CreateSpopiWorkbenchOptions} CreateSpopiWorkbenchOptions
 * @typedef {Array<{ name?: string, state?: string, error?: string }>} PackageHealthRows
 */

/**
 * @param {{
 *   packages: () => PackageRef[],
 *   installPackage?: CreateSpopiWorkbenchOptions["installPackage"],
 *   configCall?: CreateSpopiWorkbenchOptions["configCall"],
 *   onDismissFirstRun: () => void | Promise<void>,
 * }} deps
 */
export function createWorkbenchPackages({
  packages,
  installPackage,
  configCall,
  onDismissFirstRun,
}) {
  let firstRunDismissed = false;
  /** @type {PackageHealthRows} */
  let lastHealth = [];
  /** @type {Set<string>} */
  const installingSources = new Set();
  /** @type {Map<string, string>} */
  const installErrors = new Map();
  /** @type {{ done: number, total: number } | null} */
  let installProgress = null;
  let installFlight = false;
  /**
   * @param {string[]} sources
   */
  async function installSources(sources) {
    if (installFlight || !sources.length) return;
    installFlight = true;
    installProgress = { done: 0, total: sources.length };
    try {
      for (const source of sources) {
        installingSources.add(source);
        installErrors.delete(source);
        remountExtensions();
        try {
          if (!installPackage) throw new Error(t("extensions.desktopOnly"));
          await installPackage(source);
        } catch (error) {
          const message =
            error && typeof error === "object" && "message" in error && error.message != null
              ? String(error.message)
              : String(error || t("extensions.installFailed"));
          installErrors.set(source, message);
        } finally {
          installingSources.delete(source);
          installProgress = {
            done: (installProgress?.done || 0) + 1,
            total: sources.length,
          };
          remountExtensions();
        }
      }
    } finally {
      installFlight = false;
      installProgress = null;
      remountExtensions();
    }
  }
  const remountExtensions = (/** @type {PackageHealthRows | undefined} */ health = undefined) => {
    if (health) lastHealth = health;
    return mountExtensionsPanel(extensionsSettingsRefs(document).recommendedHost, {
      t,
      packages: packages(),
      health: lastHealth,
      firstRunDismissed,
      installing: [...installingSources],
      installErrors: Object.fromEntries(installErrors),
      progress: installProgress,
      // Contract: install goes through installPiPackage. Never /install via chat.
      onInstall: (source) => installSources([source]),
      onInstallAll: (sources) => installSources(sources),
      onDismissFirstRun: () => onDismissFirstRun(),
    });
  };
  /**
   * @param {{ workspaceId?: string, sessionId?: string, instanceId?: string } | null | undefined} [target]
   */
  function refreshPackageHealth(target) {
    void configCall?.("package_health", { packages: packages(), errors: extensionErrors(target) })
      ?.then((result) => {
        const rows = result?.data?.packages || [];
        notePackageHealth(rows);
        remountExtensions(rows);
      })
      ?.catch(() => {});
  }

  return {
    remount: () => {
      remountExtensions();
    },
    refreshPackageHealth,
    markFirstRunDismissed() {
      firstRunDismissed = true;
    },
  };
}
