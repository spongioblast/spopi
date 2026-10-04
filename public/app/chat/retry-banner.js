// ABOUTME: One retry banner for repeated model failures.
// ABOUTME: It hides when auto-retry ends. Identical messages increment a count.

import { el } from "../ui/dom.js";

/**
 * @typedef {{
 *   message?: string,
 *   error?: string,
 *   attempt?: number,
 *   kind?: "retry",
 * }} RetryInfo
 */

/**
 * @param {HTMLElement} root
 * @param {{
 *   retry: RetryInfo | null,
 *   count?: number,
 *   t?: (key: string, params?: Record<string, unknown>) => string,
 *   onAbort?: () => void,
 * }} options
 */
export function mountRetryBanner(root, { retry, count = 1, t = () => "", onAbort }) {
  root.classList.add("retry-banner");
  root.replaceChildren();
  if (!retry) {
    root.hidden = true;
    return { root };
  }
  root.hidden = false;
  const message = String(retry.message || retry.error || "");
  const title = t("chat.retry.waiting");
  const countLabel = count > 1 ? t("chat.retry.count", { count }) : "";
  root.append(
    el("p", { class: "retry-banner-title", text: title }),
    el("p", { class: "retry-banner-message", text: message }),
  );
  if (countLabel) root.append(el("p", { class: "retry-banner-count", text: countLabel }));
  root.append(
    el("button", {
      type: "button",
      class: "ui-button ui-button--xs ui-button--secondary retry-banner-abort",
      text: t("chat.retry.abort"),
      onClick: () => onAbort?.(),
    }),
  );
  return { root };
}

/** @type {{ root: HTMLElement, last: string, count: number, t: (key: string, params?: Record<string, unknown>) => string } | null} */
let host = null;
/** @type {(() => void) | null} */
let abortRetry = null;

/**
 * @param {() => void} handler
 */
export function registerRetryAbort(handler) {
  abortRetry = handler;
}

/**
 * @param {HTMLElement} root
 * @param {(key: string, params?: Record<string, unknown>) => string} t
 */
export function registerRetryBanner(root, t) {
  host = { root, last: "", count: 0, t };
  root.hidden = true;
  return () => {
    host = null;
  };
}

/**
 * @param {{ status?: { phase?: string, retry?: RetryInfo | null } }} state
 */
export function paintRetryBanner(state) {
  if (!host) return;
  const retrying =
    state.status?.phase === "retrying" ? state.status.retry || { message: "" } : null;
  if (!retrying) {
    host.last = "";
    host.count = 0;
    mountRetryBanner(host.root, { retry: null, t: host.t });
    return;
  }
  const message = String(retrying.message || retrying.error || "");
  host.count = message && message === host.last ? host.count + 1 : 1;
  host.last = message;
  mountRetryBanner(host.root, {
    retry: retrying,
    count: host.count,
    t: host.t,
    onAbort: () => abortRetry?.(),
  });
}
