// ABOUTME: Tests notification center.
// ABOUTME: Includes "renders dismissible error notifications".
import { describe, expect, test, vi } from "vitest";
import { createNotificationCenter } from "./notification-center.js";

describe("notification center", () => {
  test("renders dismissible error notifications", () => {
    const center = createNotificationCenter({ duration: 0 });

    const notification = center.notify({
      type: "error",
      title: "Uninstall failed",
      message: "SPOPI could not remove this extension package.",
      detail: "Permission denied in ~/.pi/agent/npm.",
    });

    expect(document.querySelector(".notification-stack")).not.toBeNull();
    expect(notification.element.getAttribute("role")).toBe("alert");
    expect(notification.element.textContent).toContain("Uninstall failed");
    expect(notification.element.textContent).toContain("Permission denied");

    notification.element.querySelector("button")?.click();

    expect(document.querySelector(".notification-stack")).toBeNull();
  });

  test("an action button dismisses and runs its handler; the stack comes back after emptying", () => {
    const center = createNotificationCenter({ duration: 0 });
    const onClick = vi.fn();
    const first = center.notify({
      title: "This model has no thinking levels",
      action: { label: "Open model settings", onClick },
    });
    first.element.querySelector(".notification-action").click();
    expect(onClick).toHaveBeenCalledOnce();
    expect(document.querySelector(".notification-stack")).toBeNull();

    const second = center.notify("Saved");
    expect(document.querySelector(".notification-stack .notification")).not.toBeNull();
    second.dismiss();
  });

  test("auto dismisses notifications after the configured duration", () => {
    vi.useFakeTimers();
    const center = createNotificationCenter({ duration: 100 });

    center.notify("Saved");
    expect(document.querySelector(".notification")).not.toBeNull();

    vi.advanceTimersByTime(100);

    expect(document.querySelector(".notification")).toBeNull();
    vi.useRealTimers();
  });
});
