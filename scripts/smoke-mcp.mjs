// ABOUTME: Adds the echo MCP fixture with the bundled pi, lists it, then removes it.
// ABOUTME: Uses a temp agent directory. Not part of CI.

import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const pi = join(
  root,
  "src-tauri",
  "resources",
  "pi",
  process.platform === "win32" ? "pi.exe" : "pi",
);
const echo = join(root, "tests", "fixtures", "mcp", "echo-server.mjs");
const agent = await mkdtemp(join(tmpdir(), "spopi-mcp-smoke-"));
const env = { ...process.env, PI_CODING_AGENT_DIR: agent };

function run(args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(pi, args, { env, cwd: agent });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("exit", (code) => resolveRun({ code, stdout, stderr }));
  });
}

try {
  const added = await run(["mcp", "add", "echo", "--", "node", echo]);
  if (added.code !== 0) throw new Error(added.stderr || added.stdout);
  const listed = await run(["mcp", "list", "--json"]);
  const list = JSON.parse(listed.stdout.slice(listed.stdout.indexOf("{")));
  const row = list.servers.find((server) => server.name === "echo");
  if (row?.state !== "connected" || row.tools?.length !== 3) {
    throw new Error(`echo was not connected with 3 tools: ${listed.stdout}`);
  }
  const removed = await run(["mcp", "remove", "echo"]);
  if (removed.code !== 0) throw new Error(removed.stderr || removed.stdout);
  const empty = await run(["mcp", "list", "--json"]);
  const after = JSON.parse(empty.stdout.slice(empty.stdout.indexOf("{")));
  if (after.servers.length !== 0) throw new Error(`list was not empty: ${empty.stdout}`);
  console.log("smoke:mcp ok");
} finally {
  await rm(agent, { recursive: true, force: true });
}
