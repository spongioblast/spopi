// ABOUTME: Copies public/ into the Tauri frontend stage without tests, fixtures, or test helpers.
// ABOUTME: Debug builds still serve the live public/ folder.

import { cp, rm } from "node:fs/promises";
import path from "node:path";

const TEST_FILE = /\.test\.(js|mjs|ts)$/;
const TEST_DIRS = new Set(["fixtures", "test-utils"]);

const destination = path.resolve("src-tauri/target/frontend-stage/public");
await rm(destination, { recursive: true, force: true });
let copied = 0;
let skipped = 0;
await cp("public", destination, {
  recursive: true,
  filter(source) {
    const name = path.basename(source);
    if (TEST_FILE.test(name) || TEST_DIRS.has(name)) {
      skipped += 1;
      return false;
    }
    copied += 1;
    return true;
  },
});
console.log(`stage:frontend copied ${copied} skipped ${skipped}`);
