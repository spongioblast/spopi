// ABOUTME: Tiny stdio MCP server for tests: echo, write_note, and a 1x1 PNG image tool.
// ABOUTME: Newline-delimited JSON-RPC 2.0 on stdin/stdout; logs go to stderr only.
import { createInterface } from "node:readline";

const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const TOOLS = [
  {
    name: "echo",
    description: "Echo text back",
    annotations: { readOnlyHint: true },
    inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
  },
  {
    name: "write_note",
    description: "Pretend to write a note",
    annotations: { destructiveHint: true },
    inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
  },
  {
    name: "pixel",
    description: "Return a 1x1 PNG",
    annotations: { readOnlyHint: true },
    inputSchema: { type: "object", properties: {} },
  },
];
const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const handlers = {
  initialize: (params) => ({
    protocolVersion: params?.protocolVersion ?? "2025-06-18",
    capabilities: { tools: {} },
    serverInfo: { name: "echo", version: "1.0.0" },
  }),
  ping: () => ({}),
  "tools/list": () => ({ tools: TOOLS }),
  "tools/call": ({ name, arguments: args = {} }) => {
    if (name === "echo") return { content: [{ type: "text", text: String(args.text ?? "") }] };
    if (name === "write_note") {
      return { content: [{ type: "text", text: `noted: ${args.text ?? ""}` }] };
    }
    if (name === "pixel") {
      return { content: [{ type: "image", data: PNG_1X1, mimeType: "image/png" }] };
    }
    return { isError: true, content: [{ type: "text", text: `unknown tool ${name}` }] };
  },
};
createInterface({ input: process.stdin }).on("line", (line) => {
  if (!line.trim()) return;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (message.id === undefined) return;
  const handler = handlers[message.method];
  if (!handler) {
    send({
      jsonrpc: "2.0",
      id: message.id,
      error: { code: -32601, message: "Method not found" },
    });
    return;
  }
  try {
    send({ jsonrpc: "2.0", id: message.id, result: handler(message.params) });
  } catch (error) {
    send({ jsonrpc: "2.0", id: message.id, error: { code: -32603, message: String(error) } });
  }
});
