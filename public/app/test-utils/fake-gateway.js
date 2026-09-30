// ABOUTME: Test double for file and host gateways that record or answer calls.
// ABOUTME: A function argument is treated as listFiles, which the file tree tests pass.

export function createFakeGateway(handlers = {}) {
  if (typeof handlers === "function") return { listFiles: handlers };
  return { ...handlers };
}
