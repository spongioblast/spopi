// ABOUTME: Checks that startup imports the full login-shell environment.
// ABOUTME: It reads main.rs as text and does not launch the app.
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

describe("SPOPI startup environment", () => {
  test("imports the complete login-shell environment", () => {
    const source = readFileSync("src-tauri/src/main.rs", "utf8");
    expect(source).toContain("fix_path_env::fix_all_vars()");
    expect(source).not.toContain("fix_path_env::fix()");
  });
});
