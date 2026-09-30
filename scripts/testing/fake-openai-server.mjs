#!/usr/bin/env node
// ABOUTME: Deterministic OpenAI chat server for smoke tests that cannot use a GPU.
// ABOUTME: The script is chosen from the last user message, and the port is printed.
import http from "node:http";

const COMMIT_MARKER = "Generate only an English Git commit message from the supplied STAGED_DIFF";
const INLINE_MARKER = "You are an inline code editor.";
const failOnceSeen = new Map();

/**
 * @param {unknown} message
 * @returns {string}
 */
function messageText(message) {
  if (!message || typeof message !== "object") return "";
  const content = /** @type {{ content?: unknown }} */ (message).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && "text" in part) {
        const text = /** @type {{ text?: unknown }} */ (part).text;
        return typeof text === "string" ? text : "";
      }
      return "";
    })
    .join("");
}

/**
 * @param {unknown} body
 * @returns {{ messages: object[], lastUser: string, system: string, hasToolResult: boolean, toolResultText: string }}
 */
function readRequest(body) {
  const record =
    body && typeof body === "object" ? /** @type {Record<string, unknown>} */ (body) : {};
  const messages = Array.isArray(record.messages) ? record.messages : [];
  let lastUser = "";
  let system = typeof record.system === "string" ? record.system : "";
  let hasToolResult = false;
  let toolResultText = "";
  for (const message of messages) {
    if (!message || typeof message !== "object") continue;
    const role = /** @type {{ role?: unknown }} */ (message).role;
    const text = messageText(message);
    if (role === "system") system = `${system}\n${text}`;
    if (role === "user") {
      lastUser = text;
      hasToolResult = false;
      toolResultText = "";
    }
    if (role === "tool" || "tool_call_id" in /** @type {object} */ (message)) {
      hasToolResult = true;
      toolResultText = `${toolResultText}\n${text}`;
    }
  }
  return { messages, lastUser, system, hasToolResult, toolResultText };
}

/**
 * @param {ReturnType<typeof readRequest>} request
 * @returns {{ status: number, texts?: string[], tools?: { name: string, arguments: string }[], finish: string }}
 */
function chooseScript(request) {
  const { lastUser, system, hasToolResult, toolResultText } = request;
  if (lastUser.includes("FAIL:down")) return { status: 500, finish: "stop" };
  if (lastUser.includes("FAIL:once")) {
    const seen = failOnceSeen.get(lastUser) || 0;
    failOnceSeen.set(lastUser, seen + 1);
    if (seen === 0) return { status: 500, finish: "stop" };
    return { status: 200, texts: ["pong"], finish: "stop" };
  }
  if (lastUser.includes("TOOL:read") && !hasToolResult) {
    return {
      status: 200,
      tools: [{ name: "read", arguments: '{"path":"README.md"}' }],
      finish: "tool_calls",
    };
  }
  if (lastUser.includes("TOOL:multi")) {
    if (!hasToolResult) {
      return {
        status: 200,
        tools: [
          { name: "read", arguments: '{"path":"README.md"}' },
          { name: "read", arguments: '{"path":"README.md"}' },
          { name: "bash", arguments: '{"command":"git status"}' },
        ],
        finish: "tool_calls",
      };
    }
    return { status: 200, texts: ["Work ", "done", "."], finish: "stop" };
  }
  if (lastUser.includes("TOOL:write")) {
    if (!hasToolResult) {
      return {
        status: 200,
        tools: [{ name: "write", arguments: '{"path":"note.txt","content":"hi\\n"}' }],
        finish: "tool_calls",
      };
    }
    return { status: 200, texts: ["Wrote note.txt."], finish: "stop" };
  }
  if (lastUser.includes("TOOL:write-auto")) {
    if (!hasToolResult) {
      return {
        status: 200,
        tools: [{ name: "write", arguments: '{"path":"note-auto.txt","content":"ok\\n"}' }],
        finish: "tool_calls",
      };
    }
    return { status: 200, texts: ["Wrote note-auto.txt."], finish: "stop" };
  }
  if (lastUser.includes("TOOL:guard-protected")) {
    const marker = "TOOL:guard-protected ";
    const path = lastUser.slice(lastUser.indexOf(marker) + marker.length).trim();
    if (!hasToolResult) {
      return {
        status: 200,
        tools: [{ name: "write", arguments: JSON.stringify({ path, content: "no\n" }) }],
        finish: "tool_calls",
      };
    }
    return { status: 200, texts: ["Protected."], finish: "stop" };
  }
  if (lastUser.includes("TOOL:bash")) {
    if (!hasToolResult) {
      return {
        status: 200,
        tools: [{ name: "bash", arguments: '{"command":"rm -rf x"}' }],
        finish: "tool_calls",
      };
    }
    if (/block|denied/i.test(toolResultText)) {
      return { status: 200, texts: ["Blocked."], finish: "stop" };
    }
  }
  if (lastUser.includes("TOOL:screenshot")) {
    if (!hasToolResult) {
      return {
        status: 200,
        tools: [{ name: "spopi_screenshot", arguments: "{}" }],
        finish: "tool_calls",
      };
    }
    const seen = toolResultText.includes("The SPOPI window as the user sees it now.");
    return {
      status: 200,
      texts: [seen ? "Screenshot seen." : "No screenshot."],
      finish: "stop",
    };
  }
  if (lastUser.includes("TOOL:long")) {
    if (!hasToolResult) {
      const command = "node -e \"for (let i = 1; i <= 3000; i++) console.log('line ' + i)\"";
      return {
        status: 200,
        tools: [{ name: "bash", arguments: JSON.stringify({ command }) }],
        finish: "tool_calls",
      };
    }
    const digest =
      toolResultText.includes(".pi/tmp/tool-output/") &&
      toolResultText.includes("line 3000") &&
      !toolResultText.includes("\nline 1500\n");
    return { status: 200, texts: [digest ? "Digest seen." : "Full output seen."], finish: "stop" };
  }
  if (hasToolResult) return { status: 200, texts: ["Read ", "done", "."], finish: "stop" };
  if (system.includes(COMMIT_MARKER)) {
    return { status: 200, texts: ["feat: fake commit message"], finish: "stop" };
  }
  if (system.includes(INLINE_MARKER)) {
    const selection = lastUser.split("SELECTION:\n")[1] ?? "";
    return { status: 200, texts: [selection.trimEnd().toUpperCase()], finish: "stop" };
  }
  return { status: 200, texts: ["po", "ng"], finish: "stop" };
}

/**
 * @param {import("node:http").ServerResponse} response
 * @param {NonNullable<ReturnType<typeof chooseScript>["texts"]>} texts
 * @param {ReturnType<typeof chooseScript>["tools"]} tools
 * @param {string} finish
 */
function writeStream(response, texts, tools, finish) {
  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
  });
  const id = "chatcmpl-fake";
  let index = 0;
  for (const tool of tools || []) {
    const chunk = {
      id,
      object: "chat.completion.chunk",
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index,
                id: `call_${index}`,
                type: "function",
                function: { name: tool.name, arguments: tool.arguments },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    };
    response.write(`data: ${JSON.stringify(chunk)}\n\n`);
    index += 1;
  }
  for (const text of texts || []) {
    const chunk = {
      id,
      object: "chat.completion.chunk",
      choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
    };
    response.write(`data: ${JSON.stringify(chunk)}\n\n`);
  }
  const done = {
    id,
    object: "chat.completion.chunk",
    choices: [{ index: 0, delta: {}, finish_reason: finish }],
    usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 },
  };
  response.write(`data: ${JSON.stringify(done)}\n\n`);
  response.write("data: [DONE]\n\n");
  response.end();
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url || "/", "http://127.0.0.1");
  if (request.method === "GET" && url.pathname === "/v1/models") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        object: "list",
        data: [{ id: "fake-1", object: "model", owned_by: "spopi" }],
      }),
    );
    return;
  }
  if (request.method !== "POST" || url.pathname !== "/v1/chat/completions") {
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "not found" }));
    return;
  }
  const chunks = [];
  request.on("data", (chunk) => chunks.push(chunk));
  request.on("end", () => {
    let body = {};
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    } catch {
      body = {};
    }
    const script = chooseScript(readRequest(body));
    if (script.status !== 200) {
      response.writeHead(script.status, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: "fake failure" } }));
      return;
    }
    const stream =
      body &&
      typeof body === "object" &&
      /** @type {{ stream?: unknown }} */ (body).stream === true;
    if (!stream) {
      const text = (script.texts || []).join("");
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          id: "chatcmpl-fake",
          object: "chat.completion",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: text },
              finish_reason: script.finish,
            },
          ],
          usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 },
        }),
      );
      return;
    }
    writeStream(response, script.texts || [], script.tools, script.finish);
  });
});

server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  const port = address && typeof address === "object" ? address.port : 0;
  console.log(port);
});
