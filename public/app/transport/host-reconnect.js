// ABOUTME: What a window does when its host connection comes back.
// ABOUTME: Same host: the status recovers. Restarted host: its Pi instances are gone, so reload.

/**
 * @param {{
 *   setStatus: (kind: string) => void,
 *   reload?: () => void,
 *   target?: EventTarget,
 * }} deps
 * @returns {() => void} removes the listener
 */
export function watchHostReconnect({
  setStatus,
  reload = () => globalThis.location.reload(),
  target = document,
}) {
  /** @param {Event} event */
  const onReconnected = (event) => {
    const detail = /** @type {CustomEvent<{ restarted?: boolean } | undefined>} */ (event).detail;
    if (detail?.restarted) reload();
    else setStatus("connected");
  };
  target.addEventListener("spopi-host-reconnected", onReconnected);
  return () => target.removeEventListener("spopi-host-reconnected", onReconnected);
}
