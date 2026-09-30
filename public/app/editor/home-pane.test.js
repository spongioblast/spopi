// ABOUTME: Tests the empty center home pane.
// ABOUTME: Covers home-pane.js disconnecting its preview observer.

import { expect, test, vi } from "vitest";
import { mountHomePane } from "./home-pane.js";

test("destroy disconnects the preview observer", () => {
  const disconnect = vi.spyOn(MutationObserver.prototype, "disconnect");
  const center = document.createElement("div");
  const preview = document.createElement("section");
  preview.id = "file-preview-panel";
  preview.className = "file-preview-panel collapsed";
  center.append(preview);
  document.body.append(center);
  const home = mountHomePane(center);
  home?.destroy();
  expect(disconnect).toHaveBeenCalled();
  disconnect.mockRestore();
  center.remove();
});
