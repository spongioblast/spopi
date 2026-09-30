#!/usr/bin/env node
// ABOUTME: Streams a fake model through the bundled pi RPC and checks the turn.
// ABOUTME: Later steps append assertions here instead of adding another smoke script.
import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { emptyTranscriptState, reduceTranscript } from "../public/app/chat/transcript-reducer.js";
import { workRowLabel } from "../public/app/chat/transcript-turns.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const piBin = join(
  root,
  "src-tauri",
  "resources",
  "pi",
  process.platform === "win32" ? "pi.exe" : "pi",
);
const bridge = join(root, "extensions", "dist", "spopi-bridge.mjs");
const permission = join(root, "extensions", "dist", "pi-permission-system.mjs");
const verify = join(root, "extensions", "dist", "spopi-verify.mjs");
const toolOutput = join(root, "extensions", "dist", "spopi-tool-output.mjs");
const fakeProvider = join(root, "extensions", "dist", "testing", "spopi-fake-provider.mjs");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function writePermissionMode(dir, mode) {
  const configDir = join(dir, "extensions", "pi-permission-system");
  await mkdir(configDir, { recursive: true });
  const roots = [join(dir, "extensions"), join(homedir(), ".pi", "agent", "extensions")];
  const pathRules = {};
  for (const root of roots) {
    const normalized = root.replaceAll("\\", "/").replace(/\/+$/, "");
    pathRules[normalized] = "deny";
    pathRules[`${normalized}/*`] = "deny";
  }
  const permissionConfig =
    mode === "full"
      ? { "*": "allow", path: pathRules }
      : mode === "auto-edit"
        ? {
            "*": "ask",
            read: "allow",
            edit: "allow",
            write: "allow",
            bash: { "*": "ask" },
            external_directory: "ask",
            path: { "*": "allow", ...pathRules },
          }
        : { "*": "ask", path: { "*": "ask", ...pathRules } };
  await writeFile(
    join(configDir, "config.json"),
    `${JSON.stringify({ permission: permissionConfig }, null, 2)}\n`,
  );
}

async function assertPermissionDeniesBash(opts) {
  await mkdir(opts.agentDir, { recursive: true });
  await writeFile(
    join(opts.agentDir, "settings.json"),
    `${JSON.stringify({ defaultProvider: "fake", defaultModel: "fake-1" }, null, 2)}\n`,
  );
  await writePermissionMode(opts.agentDir, "ask");
  const child = spawn(
    opts.piBin,
    [
      "--mode",
      "rpc",
      "--extension",
      opts.bridge,
      "--extension",
      opts.permission,
      "--extension",
      opts.verify,
      "--extension",
      opts.fakeProvider,
    ],
    {
      cwd: opts.workspace,
      env: {
        ...process.env,
        PI_CODING_AGENT_DIR: opts.agentDir,
        SPOPI_FAKE_OPENAI_URL: opts.fakeUrl,
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  let err = "";
  child.stderr.on("data", (chunk) => {
    err += chunk.toString();
  });
  try {
    const askRpc = attachRpc(child);
    const model = await askRpc.request({ type: "set_model", provider: "fake", modelId: "fake-1" });
    assert(model.success === true, `permission set_model failed: ${JSON.stringify(model)} ${err}`);
    const selectWait = askRpc.collectUntil(
      (frame) => frame.method === "select" && String(frame.title || "").includes("bash"),
    );
    const settledWait = askRpc.collectUntil((frame) => frame.type === "agent_settled");
    const bash = await askRpc.request({ type: "prompt", message: "TOOL:bash" });
    assert(bash.success === true, `TOOL:bash failed: ${JSON.stringify(bash)} ${err}`);
    const selectFrames = await selectWait;
    const select = selectFrames.find((frame) => frame.method === "select");
    assert(
      select?.id,
      `permission select missing: ${JSON.stringify(selectFrames.slice(-4))} ${err}`,
    );
    child.stdin.write(
      `${JSON.stringify({ type: "extension_ui_response", id: select.id, value: "No" })}\n`,
    );
    const bashFrames = await settledWait;
    assert(
      JSON.stringify(bashFrames).toLowerCase().includes("denied"),
      `bash was not blocked: ${JSON.stringify(bashFrames.slice(-6))}`,
    );
  } finally {
    child.kill();
  }
}

function startFakeServer() {
  return new Promise((resolvePort, reject) => {
    const child = spawn(
      process.execPath,
      [join(root, "scripts", "testing", "fake-openai-server.mjs")],
      {
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let buffer = "";
    const timer = setTimeout(() => reject(new Error("fake server did not print a port")), 5000);
    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString();
      const line = buffer.split(/\r?\n/).find((item) => item.trim());
      if (!line) return;
      clearTimeout(timer);
      resolvePort({ child, port: Number(line.trim()) });
    });
    child.on("error", reject);
  });
}

function textFromMessage(message) {
  const content = message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => (part?.type === "text" ? part.text || "" : "")).join("");
}

function attachRpc(child) {
  const pending = new Map();
  const waiters = [];
  let buffer = "";
  let nextId = 1;
  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString();
    for (;;) {
      const newline = buffer.indexOf("\n");
      if (newline < 0) break;
      const line = buffer.slice(0, newline).replace(/\r$/, "");
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      const frame = JSON.parse(line);
      const waiter = frame.id && pending.get(frame.id);
      if (waiter && frame.type === "response") {
        pending.delete(frame.id);
        waiter.resolve(frame);
        continue;
      }
      for (const candidate of waiters) candidate(frame);
    }
  });
  function request(command, timeoutMs = 20_000) {
    const id = `stream-${nextId++}`;
    child.stdin.write(`${JSON.stringify({ id, ...command })}\n`);
    return new Promise((resolveRequest, rejectRequest) => {
      const timeout = setTimeout(() => {
        pending.delete(id);
        rejectRequest(new Error(`Timed out waiting for ${command.type}`));
      }, timeoutMs);
      pending.set(id, {
        resolve(value) {
          clearTimeout(timeout);
          resolveRequest(value);
        },
      });
    });
  }
  function collectUntil(predicate, timeoutMs = 30_000) {
    const frames = [];
    return new Promise((resolveFrames, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Timed out. Last frames: ${JSON.stringify(frames.slice(-6))}`));
      }, timeoutMs);
      waiters.push((frame) => {
        frames.push(frame);
        if (!predicate(frame, frames)) return;
        clearTimeout(timeout);
        resolveFrames(frames);
      });
    });
  }
  return { request, collectUntil };
}

function joinedText(frames) {
  let text = "";
  for (const frame of frames) {
    if (frame.type === "message_update" && frame.assistantMessageEvent?.type === "text_delta") {
      text += frame.assistantMessageEvent.delta || "";
    }
    if (frame.type === "message_end") text += textFromMessage(frame.message);
  }
  return text;
}

async function runHostSmoke() {
  const temp = await mkdtemp(join(tmpdir(), "spopi-host-stream-"));
  const agentDir = join(temp, "agent");
  const fake = await startFakeServer();
  try {
    await mkdir(agentDir, { recursive: true });
    await writeFile(
      join(agentDir, "settings.json"),
      `${JSON.stringify({ defaultProvider: "fake", defaultModel: "fake-1" }, null, 2)}\n`,
    );
    const cargo = spawn(
      "cargo",
      [
        "test",
        "--manifest-path",
        "src-tauri/Cargo.toml",
        "host_stream",
        "--",
        "--ignored",
        "--test-threads=1",
      ],
      {
        cwd: root,
        env: {
          ...process.env,
          CARGO_TARGET_DIR: join(root, "src-tauri", "target"),
          PI_CODING_AGENT_DIR: agentDir,
          SPOPI_FAKE_OPENAI_URL: `http://127.0.0.1:${fake.port}`,
          SPOPI_FAKE_PROVIDER: "1",
        },
        stdio: "inherit",
      },
    );
    const code = await new Promise((resolveCode, reject) => {
      cargo.on("error", reject);
      cargo.on("exit", resolveCode);
    });
    assert(code === 0, `host_stream cargo test exited ${code}`);
    console.log("smoke:stream --host passed");
  } finally {
    fake.child.kill();
    await rm(temp, { recursive: true, force: true }).catch(() => {});
  }
}

if (process.argv.includes("--host")) {
  try {
    await runHostSmoke();
  } catch (error) {
    console.error(error instanceof Error ? error.stack || error.message : error);
    process.exitCode = 1;
  }
  process.exit(process.exitCode || 0);
}
const deadline = setTimeout(() => {
  console.error("smoke:stream exceeded 90s");
  process.exit(1);
}, 90_000);

const temp = await mkdtemp(join(tmpdir(), "spopi-stream-"));
const agentDir = join(temp, "agent");
const workspace = join(temp, "workspace");
const fake = await startFakeServer();
let pi;
try {
  await mkdir(agentDir, { recursive: true });
  await mkdir(workspace, { recursive: true });
  await writeFile(
    join(agentDir, "settings.json"),
    `${JSON.stringify({ defaultProvider: "fake", defaultModel: "fake-1" }, null, 2)}\n`,
  );
  await writePermissionMode(agentDir, "full");
  await writeFile(join(workspace, "README.md"), "hello\n");
  pi = spawn(
    piBin,
    [
      "--mode",
      "rpc",
      "--extension",
      bridge,
      "--extension",
      permission,
      "--extension",
      verify,
      "--extension",
      toolOutput,
      "--extension",
      fakeProvider,
    ],
    {
      cwd: workspace,
      env: {
        ...process.env,
        PI_CODING_AGENT_DIR: agentDir,
        SPOPI_FAKE_OPENAI_URL: `http://127.0.0.1:${fake.port}`,
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  let stderr = "";
  pi.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  const rpc = attachRpc(pi);
  const model = await rpc.request({ type: "set_model", provider: "fake", modelId: "fake-1" });
  assert(model.success === true, `set_model failed: ${JSON.stringify(model)} ${stderr}`);

  const pingWait = rpc.collectUntil((frame) => frame.type === "agent_settled");
  const ping = await rpc.request({ type: "prompt", message: "ping" });
  assert(ping.success === true, `prompt ping failed: ${JSON.stringify(ping)}`);
  const pingFrames = await pingWait;
  assert(joinedText(pingFrames).includes("pong"), `ping text was ${joinedText(pingFrames)}`);

  const failWait = rpc.collectUntil((frame) => frame.type === "agent_settled");
  const failOnce = await rpc.request({ type: "prompt", message: "FAIL:once" });
  assert(failOnce.success === true, `FAIL:once prompt failed: ${JSON.stringify(failOnce)}`);
  const failFrames = await failWait;
  assert(
    failFrames.some((frame) => frame.type === "auto_retry_start"),
    "FAIL:once did not start a retry",
  );
  assert(joinedText(failFrames).includes("pong"), `FAIL:once text was ${joinedText(failFrames)}`);

  const tree = await rpc.request({ type: "get_tree" });
  assert(tree.success === true, `get_tree failed: ${JSON.stringify(tree)}`);
  assert(Array.isArray(tree.data?.tree), `get_tree data was ${JSON.stringify(tree.data)}`);
  assert("leafId" in (tree.data ?? {}), "get_tree did not return leafId");

  const outputPath = join(agentDir, "session.html");
  const exported = await rpc.request({ type: "export_html", outputPath });
  assert(exported.success === true, `export_html failed: ${JSON.stringify(exported)}`);
  assert(
    typeof exported.data?.path === "string" && exported.data.path.length > 0,
    "export_html returned no path",
  );
  await access(exported.data.path);

  const toolWait = rpc.collectUntil((frame) => frame.type === "agent_settled");
  const tool = await rpc.request({ type: "prompt", message: "TOOL:read" });
  assert(tool.success === true, `prompt TOOL:read failed: ${JSON.stringify(tool)}`);
  const toolFrames = await toolWait;
  assert(
    toolFrames.some((frame) => frame.type === "tool_execution_start" && frame.toolName === "read"),
    "TOOL:read did not start a read tool",
  );
  assert(joinedText(toolFrames).includes("Read done."), `tool text was ${joinedText(toolFrames)}`);

  const multiWait = rpc.collectUntil((frame) => frame.type === "agent_settled");
  const multi = await rpc.request({ type: "prompt", message: "TOOL:multi" });
  assert(multi.success === true, `prompt TOOL:multi failed: ${JSON.stringify(multi)}`);
  const multiFrames = await multiWait;
  let multiState = emptyTranscriptState();
  for (const frame of multiFrames) {
    const started = performance.now();
    multiState = reduceTranscript(multiState, frame);
    const elapsed = performance.now() - started;
    assert(elapsed < 50, `render budget ${elapsed.toFixed(1)}ms on ${frame.type}`);
  }
  const workRows = multiState.transcript.turns.filter((turn) => turn.work.steps.length > 0);
  assert(workRows.length === 1, `TOOL:multi work rows ${workRows.length}`);
  assert(
    workRowLabel(workRows[0]).includes("read 2 files") &&
      workRowLabel(workRows[0]).includes("ran 1 command"),
    `work row was ${workRowLabel(workRows[0])}`,
  );

  const longWait = rpc.collectUntil((frame) => frame.type === "agent_settled");
  const long = await rpc.request({ type: "prompt", message: "TOOL:long" });
  assert(long.success === true, `prompt TOOL:long failed: ${JSON.stringify(long)}`);
  const longFrames = await longWait;
  const longEnd = longFrames.find(
    (frame) => frame.type === "tool_execution_end" && frame.toolName === "bash",
  );
  assert(
    joinedText(longFrames).includes("Digest seen."),
    `TOOL:long: the next request did not carry the digest. saved=${JSON.stringify(longEnd?.result?.details?.spopiToolOutput)} errors=${JSON.stringify(longFrames.filter((frame) => frame.type === "extension_error"))}`,
  );
  const savedPath = longEnd?.result?.details?.spopiToolOutput?.path;
  assert(
    typeof savedPath === "string" && savedPath.startsWith(".pi/tmp/tool-output/"),
    `TOOL:long saved path was ${JSON.stringify(longEnd?.result?.details)}`,
  );
  const savedText = await readFile(join(workspace, savedPath), "utf8");
  assert(
    savedText.includes("\nline 1500\n") && savedText.includes("line 3000"),
    `TOOL:long saved file is not the full output (${savedText.length} chars)`,
  );

  const configId = "smoke-commit";
  const commitWait = rpc.collectUntil(
    (frame) =>
      frame.type === "extension_ui_request" &&
      frame.method === "notify" &&
      String(frame.message || "").includes(configId),
  );
  await rpc.request({
    type: "prompt",
    message: `/spopi-config ${JSON.stringify({
      id: configId,
      op: "commit_message",
      params: { diff: "diff --git a/README.md\n+hello\n" },
    })}`,
  });
  const commitFrames = await commitWait;
  const commitNotify = commitFrames.find((frame) => String(frame.message || "").includes(configId));
  const commitPayload = JSON.parse(commitNotify.message);
  assert(
    JSON.stringify(commitPayload).includes("feat: fake commit message"),
    `commit payload ${commitNotify.message}`,
  );

  const editId = "smoke-edit";
  const editWait = rpc.collectUntil(
    (frame) =>
      frame.type === "extension_ui_request" &&
      frame.method === "notify" &&
      String(frame.message || "").includes(editId),
  );
  await rpc.request({
    type: "prompt",
    message: `/spopi-config ${JSON.stringify({
      id: editId,
      op: "inline_edit",
      params: {
        prompt: "FILE: README.md\nLINES: 1-1\nINSTRUCTION:\nupper\n\nSELECTION:\nhello\n",
        systemPrompt:
          "You are an inline code editor. Output only the replacement text for the supplied selection.",
      },
    })}`,
  });
  const editFrames = await editWait;
  const editNotify = editFrames.find((frame) => String(frame.message || "").includes(editId));
  assert(
    JSON.stringify(JSON.parse(editNotify.message)).includes("HELLO"),
    `edit payload ${editNotify.message}`,
  );

  const stats = await rpc.request({ type: "get_session_stats" });
  assert(stats.success === true, `get_session_stats failed: ${JSON.stringify(stats)}`);
  assert(
    JSON.stringify(stats.data || {}).match(/token|usage|cost/i),
    `stats had no usage: ${JSON.stringify(stats.data)}`,
  );
  await assertPermissionDeniesBash({
    piBin,
    workspace,
    permission,
    bridge,
    verify,
    fakeProvider,
    fakeUrl: `http://127.0.0.1:${fake.port}`,
    agentDir: join(temp, "agent-ask"),
  });
  console.log("smoke:stream passed");
} catch (error) {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  pi?.kill();
  fake.child.kill();
  await new Promise((resolveDone) => setTimeout(resolveDone, 300));
  await rm(temp, { recursive: true, force: true }).catch(() => {});
}
