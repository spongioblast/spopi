// ABOUTME: Tracks the one in-memory Codex device-code login and the events it emits.
// ABOUTME: Only non-secret progress and terminal events reach the UI; error text is stripped of secrets.

import { randomUUID } from "node:crypto";

/**
 * Non-secret operation events projected to the WebView. The transport
 * envelope carries the config request id.
 */
export type OAuthOperationEvent =
  | {
      type: "device_code";
      verificationUri: string;
      userCode: string;
      expiresInSeconds?: number;
      intervalSeconds?: number;
    }
  | { type: "progress"; message: string }
  | { type: "complete" | "failed" | "cancelled" | "expired"; message?: string };

export type OAuthLoginOperationManager = {
  start(): { operationId: string; signal: AbortSignal };
  bindDeviceCode(operationId: string, code: OAuthDeviceCodeInput): OAuthOperationEvent;
  bindProgress(operationId: string, message: string): OAuthOperationEvent;
  complete(operationId: string): OAuthOperationEvent;
  fail(operationId: string, error: unknown): OAuthOperationEvent;
  /** Abort the active operation. Unknown ids are a tolerated no-op (M2). */
  cancel(operationId: string): OAuthOperationEvent | null;
  expire(operationId: string): OAuthOperationEvent;
};

/** Device-code payload forwarded from Pi's AuthEvent.device_code. */
export type OAuthDeviceCodeInput = {
  verificationUri: string;
  userCode: string;
  expiresInSeconds?: number;
  intervalSeconds?: number;
};

type OAuthOperation = {
  operationId: string;
  controller: AbortController;
};

/**
 * Strip token-like material from a failure message before it reaches the
 * WebView: "Authorization: Bearer <token>" units, bare "Bearer <token>",
 * key=value / key: value credential pairs, and URL query fragments. Falls
 * back to a fixed message when nothing safe remains. Credential
 * synchronization failures pass through as stable messages — the UI must not
 * auto-retry them (design §5, N2).
 */
export function sanitizeOAuthError(raw: unknown): string {
  const collapsed = String(raw ?? "")
    .replace(/\s+/g, " ")
    .trim();
  const redacted = collapsed
    .replace(/\bauthorization\s*:\s*bearer\s+[^\s]+/gi, " [redacted]")
    .replace(/\bbearer\s+[^\s]+/gi, " [redacted]")
    .replace(
      /\b(?:token|refresh|access|secret|code|key|authorization)\b\s*=\s*[^\s]+/gi,
      " [redacted]",
    )
    .replace(
      /\b(?:token|refresh|access|secret|code|key|authorization)\b\s*:\s*[^\s]+/gi,
      " [redacted]",
    )
    .replace(/[?&][^\s]*/g, " [redacted]")
    .replace(/\s+/g, " ")
    .trim();
  const bounded = redacted.length > 240 ? `${redacted.slice(0, 237)}...` : redacted;
  const meaningful = bounded.replace(/\[redacted\]/g, "").trim();
  return meaningful ? bounded : "OAuth login failed";
}

export function createOAuthLoginOperationManager(
  options: { createId?: () => string } = {},
): OAuthLoginOperationManager {
  const createId = options.createId ?? (() => randomUUID());
  let active: OAuthOperation | null = null;

  function assertActive(operationId: string): OAuthOperation {
    if (!active) throw new Error("OAuth operation not found");
    if (active.operationId !== operationId) throw new Error("OAuth operation not found");
    return active;
  }

  function removeActive(operation: OAuthOperation) {
    if (active === operation) active = null;
  }

  function terminal(operation: OAuthOperation, event: OAuthOperationEvent): OAuthOperationEvent {
    removeActive(operation);
    return event;
  }

  return {
    start() {
      if (active) throw new Error("OAuth login already in progress");
      const operation: OAuthOperation = {
        operationId: createId(),
        controller: new AbortController(),
      };
      active = operation;
      return { operationId: operation.operationId, signal: operation.controller.signal };
    },

    bindDeviceCode(operationId, code) {
      assertActive(operationId);
      return {
        type: "device_code",
        verificationUri: code.verificationUri,
        userCode: code.userCode,
        ...(code.expiresInSeconds !== undefined ? { expiresInSeconds: code.expiresInSeconds } : {}),
        ...(code.intervalSeconds !== undefined ? { intervalSeconds: code.intervalSeconds } : {}),
      };
    },

    bindProgress(operationId, message) {
      assertActive(operationId);
      return { type: "progress", message };
    },

    complete(operationId) {
      return terminal(assertActive(operationId), { type: "complete" });
    },

    fail(operationId, error) {
      return terminal(assertActive(operationId), {
        type: "failed",
        message: sanitizeOAuthError(error),
      });
    },

    cancel(operationId) {
      // Unknown ids are a tolerated no-op: the map may have been wiped by a
      // pi restart or extension reload; the UI treats it as expired anyway.
      if (!active || active.operationId !== operationId) return null;
      active.controller.abort();
      return terminal(active, { type: "cancelled" });
    },

    expire(operationId) {
      return terminal(assertActive(operationId), { type: "expired" });
    },
  };
}
