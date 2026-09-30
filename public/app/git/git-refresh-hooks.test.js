// ABOUTME: Tests git-refresh-hooks.
// ABOUTME: Includes "bash tool end refreshes after 500ms".
// ABOUTME: Debounce contract for Git refresh hooks.

import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { emitTerminalInput } from "../terminal/terminal-input-action.js";
import { createGitRefreshHooks } from "./git-refresh-hooks.js";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

test("bash tool end refreshes after 500ms", () => {
  const refresh = vi.fn();
  const hooks = createGitRefreshHooks({ refresh, isVisible: () => true });
  hooks.onFrame({ type: "tool_execution_end", toolName: "bash" });
  expect(refresh).not.toHaveBeenCalled();
  vi.advanceTimersByTime(499);
  expect(refresh).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(refresh).toHaveBeenCalledTimes(1);
  hooks.destroy();
});

test("shell Enter refreshes after 2s", () => {
  const refresh = vi.fn();
  const hooks = createGitRefreshHooks({ refresh, isVisible: () => true });
  emitTerminalInput({ data: "git status\r" });
  vi.advanceTimersByTime(1999);
  expect(refresh).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(refresh).toHaveBeenCalledTimes(1);
  hooks.destroy();
});

test("polls every 15s only while the Git tab is visible", () => {
  const refresh = vi.fn();
  let visible = true;
  const hooks = createGitRefreshHooks({ refresh, isVisible: () => visible });
  hooks.setGitVisible(true);
  vi.advanceTimersByTime(15000);
  expect(refresh).toHaveBeenCalledTimes(1);
  visible = false;
  hooks.setGitVisible(false);
  vi.advanceTimersByTime(30000);
  expect(refresh).toHaveBeenCalledTimes(1);
  hooks.destroy();
});
