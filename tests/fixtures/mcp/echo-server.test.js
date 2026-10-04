// ABOUTME: Drives the echo MCP fixture over stdio and checks each JSON-RPC reply.
// ABOUTME: Stdout must stay JSON lines only. A notification gets no reply.
import { spawn } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import { describe, expect, test } from "vitest";

const serverPath = path.join(import.meta.dirname, "echo-server.mjs");

function start() {
  const child = spawn(process.execPath, [serverPath], { stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  return { child, read: () => stdout, errors: () => stderr };
}

async function roundTrip(lines) {
  const { child, read, errors } = start();
  child.stdin.write(`${lines.join("\n")}\n`);
  child.stdin.end();
  await once(child, "close");
  return { stdout: read(), stderr: errors() };
}

describe("echo MCP server", () => {
  test("answers initialize, tools/list, echo, pixel, and an unknown method", async () => {
    const { stdout, stderr } = await roundTrip([
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
      JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
      JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "echo", arguments: { text: "hi" } },
      }),
      JSON.stringify({
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "pixel", arguments: {} },
      }),
      JSON.stringify({ jsonrpc: "2.0", id: 5, method: "nope" }),
    ]);
    expect(stderr).toBe("");
    const messages = stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(messages).toHaveLength(5);
    expect(messages[0].result.serverInfo.name).toBe("echo");
    expect(messages[1].result.tools.map((tool) => tool.name)).toEqual([
      "echo",
      "write_note",
      "pixel",
    ]);
    expect(messages[2].result.content[0].text).toBe("hi");
    expect(messages[3].result.content[0]).toMatchObject({ type: "image", mimeType: "image/png" });
    expect(messages[4].error.code).toBe(-32601);
  });
});
