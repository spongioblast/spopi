// ABOUTME: Starts the ignored host e2e server and runs each e2e spec.
// ABOUTME: A failing spec stops the host and exits non-zero.

import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const stopDir = await mkdtemp(join(tmpdir(), "spopi-e2e-stop-"));
const stopFile = join(stopDir, "stop");
await writeFile(stopFile, "run");

const cargo = spawn(
  "cargo",
  [
    "test",
    "--manifest-path",
    "src-tauri/Cargo.toml",
    "host_e2e_serve",
    "--",
    "--ignored",
    "--nocapture",
    "--test-threads=1",
  ],
  {
    cwd: root,
    env: {
      ...process.env,
      CARGO_TARGET_DIR: join(root, "src-tauri", "target"),
      SPOPI_E2E_STOP: stopFile,
      PI_SKIP_VERSION_CHECK: "1",
    },
    stdio: ["ignore", "pipe", "inherit"],
  },
);

let ready = "";
let buffer = "";
const readyPromise = new Promise((resolveReady, reject) => {
  const timer = setTimeout(() => reject(new Error("host did not print E2E_READY")), 180000);
  cargo.stdout.on("data", (chunk) => {
    buffer += chunk.toString();
    process.stdout.write(chunk);
    const match = buffer.match(/E2E_READY\s+(\d+)\s+(\d+)\s+(\S+)/);
    if (!match) return;
    clearTimeout(timer);
    ready = match;
    resolveReady(match);
  });
  cargo.on("exit", (code) => {
    clearTimeout(timer);
    if (!ready) reject(new Error(`host exited ${code} before E2E_READY`));
  });
});

let failed = 0;
try {
  const match = await readyPromise;
  const env = {
    ...process.env,
    SPOPI_E2E_LOOPBACK: match[1],
    SPOPI_E2E_PHONE: match[2],
    SPOPI_E2E_CERT: match[3],
  };
  const specs = ["e2e/responsive.spec.mjs"];
  for (const spec of specs) {
    const code = await new Promise((resolveCode, reject) => {
      const child = spawn(process.execPath, [join(root, spec)], {
        cwd: root,
        env,
        stdio: "inherit",
      });
      child.on("error", reject);
      child.on("exit", resolveCode);
    });
    if (code !== 0) {
      failed = code || 1;
      break;
    }
  }
} catch (error) {
  console.error(error);
  failed = 1;
} finally {
  await rm(stopFile, { force: true });
  await new Promise((resolveClose) => {
    const timer = setTimeout(() => {
      cargo.kill();
      resolveClose();
    }, 15000);
    cargo.on("exit", () => {
      clearTimeout(timer);
      resolveClose();
    });
  });
  await rm(stopDir, { recursive: true, force: true });
}
process.exit(failed);
