// ABOUTME: index.html loads the overlay's user.js, and the app announces spopi:ready for it.
// ABOUTME: Guards the one hook that lets an overlay add behaviour without copying a shipped file.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const html = readFileSync(join(root, "public/index.html"), "utf8");
const app = readFileSync(join(root, "public/app/app.js"), "utf8");

describe("overlay user.js entry", () => {
  it("is loaded as a module after the app entry, from the unversioned root", () => {
    const entry = html.indexOf('src="bootstrap-entry.js"');
    const user = html.indexOf('<script type="module" src="/user.js"></script>');
    expect(entry).toBeGreaterThan(-1);
    expect(user).toBeGreaterThan(entry);
  });

  it("has an app-ready event to wait for", () => {
    expect(app).toContain('new Event("spopi:ready")');
  });
});
