// ABOUTME: Tests file-tree-hooks.
// ABOUTME: Includes "refreshes on an interval only while the Files rail is showing".
// ABOUTME: Files panel polls for disk changes only while it is the visible rail.

import { afterEach, expect, test, vi } from "vitest";
import { createFileTreeHooks } from "./file-tree-hooks.js";

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

test("refreshes on an interval only while the Files rail is showing", () => {
  vi.useFakeTimers();
  const refresh = vi.fn().mockResolvedValue(undefined);
  const hooks = createFileTreeHooks({
    getTree: () => ({ loaded: true, refresh }),
    watchMs: 2000,
  });
  document.body.dataset.railPanel = "sessions";
  vi.advanceTimersByTime(2500);
  expect(refresh).not.toHaveBeenCalled();
  document.body.dataset.railPanel = "files";
  vi.advanceTimersByTime(2500);
  expect(refresh).toHaveBeenCalled();
  hooks.stop();
});
