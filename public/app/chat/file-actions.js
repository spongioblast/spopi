// ABOUTME: File preview and run-in-terminal are chat actions.
// ABOUTME: Leaf widgets emit them; the chat mount subscribes and performs them.

/** @type {(action: { type: string, path?: string, line?: number, command?: string }) => void} */
let emit = () => {};

/** @param {(action: { type: string, path?: string, line?: number, command?: string }) => void} dispatch */
export function setFileActionDispatch(dispatch) {
  const previous = emit;
  emit = typeof dispatch === "function" ? dispatch : () => {};
  return () => {
    if (emit === dispatch) emit = previous;
  };
}

/** @param {string} path @param {number} [line] */
export function previewFile(path, line) {
  if (!path) return;
  emit({ type: "file.preview", path, line });
}

/** @param {string} command */
export function runInTerminal(command) {
  if (!command) return;
  emit({ type: "terminal.run", command });
}
