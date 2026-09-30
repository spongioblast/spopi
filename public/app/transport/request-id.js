// ABOUTME: Builds prefixed request ids shared by the host gateways.
// ABOUTME: Each factory keeps its own counter so prefixes stay independent.

/** @param {string} prefix @returns {() => string} */
export function createRequestIds(prefix) {
  let n = 0;
  return () => `${prefix}-${++n}`;
}
