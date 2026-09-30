// ABOUTME: Terminal keystrokes are a store action the Git panel can hear.
// ABOUTME: The dock emits them after it sends the bytes to the PTY.

/** @type {Set<(detail: { dataBase64?: string, data?: string, terminalId?: string }) => void>} */
const handlers = new Set();

/** @param {(detail: { dataBase64?: string, data?: string, terminalId?: string }) => void} handler */
export function onTerminalInput(handler) {
  if (typeof handler !== "function") return () => {};
  handlers.add(handler);
  return () => handlers.delete(handler);
}

/** @param {{ dataBase64?: string, data?: string, terminalId?: string }} detail */
export function emitTerminalInput(detail) {
  for (const handler of handlers) handler(detail);
}
