// ABOUTME: Tests extractAssistantError.
// ABOUTME: Includes "reads errorMessage from an empty failed assistant message".
import { describe, expect, test } from "vitest";
import { extractAssistantError, extractRuntimeEventError } from "./assistant-error.js";

describe("extractAssistantError", () => {
  test("reads errorMessage from an empty failed assistant message", () => {
    expect(
      extractAssistantError({
        role: "assistant",
        stopReason: "error",
        errorMessage: "Unknown parameter: 'store'",
        content: [],
      }),
    ).toBe("Unknown parameter: 'store'");
  });

  test("ignores aborted turns", () => {
    expect(
      extractAssistantError({
        role: "assistant",
        stopReason: "aborted",
        errorMessage: "Request was aborted",
      }),
    ).toBeNull();
  });

  test("falls back when stopReason is error but no text", () => {
    expect(
      extractAssistantError(
        { role: "assistant", stopReason: "error", content: [] },
        { fallback: "failed" },
      ),
    ).toBe("failed");
  });
});

describe("extractRuntimeEventError", () => {
  test("reads message_end errors", () => {
    expect(
      extractRuntimeEventError({
        type: "message_end",
        message: { role: "assistant", stopReason: "error", errorMessage: "HTTP 400" },
      }),
    ).toBe("HTTP 400");
  });

  test("reads the last failed assistant on agent_end", () => {
    expect(
      extractRuntimeEventError({
        type: "agent_end",
        messages: [
          { role: "user", content: [{ type: "text", text: "hi" }] },
          { role: "assistant", stopReason: "error", errorMessage: "Connection error." },
        ],
      }),
    ).toBe("Connection error.");
  });

  test("returns null on a successful settle", () => {
    expect(
      extractRuntimeEventError({
        type: "agent_settled",
        messages: [
          { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "ok" }] },
        ],
      }),
    ).toBeNull();
  });
});
