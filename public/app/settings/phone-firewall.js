// ABOUTME: What the Windows Firewall row on Settings → Phone access says, and which button it offers.
// ABOUTME: Pure; the host reports the rule (/api/phone/firewall) and writes it after the admin prompt.

import { t } from "../i18n/i18n.js";
import { canonicalCidr, isAllowEntry } from "./phone-allow.js";

/**
 * @typedef {{ supported?: boolean, rule?: boolean, ports?: string[], remote?: string[], blocked?: number }} FirewallStatus
 */

/**
 * @param {FirewallStatus | null} status
 * @param {number} port
 * @param {string[]} [allow] the allowed sources; when valid, the rule must let in exactly these
 * @returns {{ text: string, button: string } | null}
 */
export function firewallState(status, port, allow = []) {
  if (!status?.supported) return null;
  const ports = Array.isArray(status.ports) ? status.ports.map(String) : [];
  const covered = ports.some((item) => item === String(port) || item === "Any");
  if (status.blocked) {
    return { text: t("settings.phone.firewallBlocked"), button: t("settings.phone.firewallAllow") };
  }
  const remote = Array.isArray(status.remote) ? status.remote.map(String) : null;
  const wanted = allow.length && allow.every(isAllowEntry) ? allow.map(canonicalCidr) : null;
  const sameSources =
    !remote ||
    !wanted ||
    (new Set(remote).size === new Set(wanted).size &&
      wanted.every((item) => remote.includes(item)));
  if (status.rule && covered && !sameSources) {
    return {
      text: t("settings.phone.firewallOtherSources", { remote: remote?.join(", ") || "" }),
      button: t("settings.phone.firewallUpdate"),
    };
  }
  if (status.rule && covered) {
    return { text: t("settings.phone.firewallOk", { port }), button: "" };
  }
  if (status.rule) {
    return {
      text: t("settings.phone.firewallOtherPort", { ports: ports.join(", "), port }),
      button: t("settings.phone.firewallUpdate"),
    };
  }
  return { text: t("settings.phone.firewallNone"), button: t("settings.phone.firewallAllow") };
}
