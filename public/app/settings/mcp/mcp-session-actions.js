// ABOUTME: Sends /mcp login, logout, and reconnect to the open Pi session.
// ABOUTME: Pi runs the command; this file only builds the prompt and reads notices.

import { randomId } from "../../utils/random-id.js";

const DONE =
  /signed in to mcp server|signed out of|no stored credentials|reconnected to mcp server|failed|cancelled/i;

/**
 * @param {{ runtime?: { request?: Function }, getTarget?: () => unknown }} deps
 * @param {string} subcommand
 * @param {string} name
 */
export function runMcpSessionCommand(deps, subcommand, name) {
  const message = `/mcp ${subcommand} ${name}`;
  return deps.runtime?.request?.({ type: "prompt", message }, deps.getTarget?.(), {
    idempotencyKey: randomId(),
  });
}

/** @param {string} message */
export function firstUrl(message) {
  return String(message ?? "").match(/https?:\/\/\S+/)?.[0] ?? "";
}

/** @param {string} message */
export function isTerminalMcpNotice(message) {
  return DONE.test(String(message ?? ""));
}
