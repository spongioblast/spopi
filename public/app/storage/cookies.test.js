// ABOUTME: Tests cookie read, write, and expiry against document.cookie.
// ABOUTME: Covers public/app/storage/cookies.js.

import { afterEach, describe, expect, test } from "vitest";
import { expireCookie, readCookie, writeCookie } from "./cookies.js";

describe("cookies", () => {
  afterEach(() => {
    expireCookie("spopi-test");
  });

  test("round-trips a value and then expires it", () => {
    writeCookie("spopi-test", "night", 60);
    expect(readCookie("spopi-test")).toBe("night");
    expireCookie("spopi-test");
    expect(readCookie("spopi-test")).toBeNull();
  });
});
