// ABOUTME: Signals when the config gateway can accept calls.
// ABOUTME: The listener fires after the host socket connects.

/** @type {Set<() => void>} */
const handlers = new Set();

/** @param {() => void} handler */
export function onConfigGatewayReady(handler) {
  if (typeof handler !== "function") return () => {};
  handlers.add(handler);
  return () => handlers.delete(handler);
}

/**
 * @param {{
 *   adapter: { setConnectionListener: (listener: (connected: boolean) => void) => void },
 *   isReady?: () => boolean,
 *   onDisconnected?: () => void,
 * }} options
 */
export function createConfigGatewayConnectionListener({
  adapter,
  isReady = () => true,
  onDisconnected,
}) {
  adapter.setConnectionListener((connected) => {
    if (connected) {
      if (isReady()) signalConfigGatewayReady();
      return;
    }
    onDisconnected?.();
  });
}

export function signalConfigGatewayReady() {
  for (const handler of handlers) handler();
}
