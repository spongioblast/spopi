// ABOUTME: spopi_terminal_run and spopi_terminal_read: Pi runs long or background commands in a dock tab the user watches.
// ABOUTME: Only registered when SPOPI started this Pi. The host owns the tab and process; the guard checks commands like bash.

import { isAbsolute, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { lastLines } from "./terminal-text";

export const TERMINAL_RUN_TOOL = "spopi_terminal_run";
export const TERMINAL_READ_TOOL = "spopi_terminal_read";

const DEFAULT_RUN_WAIT_S = 10;
const MAX_WAIT_S = 300;
const DEFAULT_LINES = 60;
const MAX_LINES = 400;
const POLL_MS = 500;
const BYTES_PER_LINE = 512;

type Fetch = typeof fetch;

export type RunView = {
  terminalId: string;
  label: string;
  status: "running" | "exited" | "stopped" | "failed";
  exitCode?: number;
  failReason?: string;
  elapsedMs: number;
  output: string;
  outputTruncated: boolean;
};

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  details: Record<string, unknown>;
};
type OnUpdate = ((result: ToolResult) => void) | undefined;

function clamp(value: unknown, fallback: number, max: number): number {
  const number = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(0, Math.round(number)));
}

function duration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  return seconds < 120 ? `${seconds} s` : `${Math.round(seconds / 60)} min`;
}

function stateText(view: RunView): string {
  const after = duration(view.elapsedMs);
  if (view.status === "running") return `still running after ${after}`;
  if (view.status === "exited")
    return `exited with code ${view.exitCode ?? "unknown"} after ${after}`;
  if (view.status === "stopped") return `stopped after ${after}`;
  return `failed to start: ${view.failReason || "unknown reason"}`;
}

export function describeRun(view: RunView, lines: number): string {
  const out = lastLines(view.output, lines, view.outputTruncated);
  const head =
    out.total > out.shown || view.outputTruncated
      ? `Last ${out.shown} lines of output:`
      : "Output:";
  const body = out.text ? `${head}\n${out.text}` : "No output yet.";
  const next =
    view.status === "running"
      ? `\nIt keeps running in the user's terminal tab. Check it with ${TERMINAL_READ_TOOL} and terminal "${view.terminalId}": add wait to wait for it to end, or stop: true to end it.`
      : "";
  return `Terminal "${view.label}" (id ${view.terminalId}): ${stateText(view)}.\n${body}${next}`;
}

function result(view: RunView, lines: number): ToolResult {
  return {
    content: [{ type: "text", text: describeRun(view, lines) }],
    details: {
      terminalId: view.terminalId,
      label: view.label,
      status: view.status,
      exitCode: view.exitCode,
    },
  };
}

async function hostJson<T>(response: Response): Promise<T> {
  if (response.ok) return (await response.json()) as T;
  let message = `HTTP ${response.status}`;
  try {
    const body = (await response.json()) as { error?: { message?: unknown } };
    if (typeof body.error?.message === "string") message = body.error.message;
  } catch {
    // Not JSON; the status is all there is.
  }
  throw new Error(message);
}

function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((done) => {
    const timer = setTimeout(done, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        done();
      },
      { once: true },
    );
  });
}

export function createTerminalClient(origin: string, fetchImpl: Fetch = fetch) {
  const base = origin.replace(/\/+$/, "");
  const post = (path: string, body: unknown) =>
    fetchImpl(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  const read = async (terminalId: string, lines: number) =>
    hostJson<RunView>(
      await fetchImpl(
        `${base}/api/terminal/output?id=${encodeURIComponent(terminalId)}&bytes=${lines * BYTES_PER_LINE}`,
      ),
    );
  return {
    run: async (body: { cwd: string; sessionId?: string; command: string; title?: string }) =>
      hostJson<{ terminalId: string; label: string }>(await post("/api/terminal/run", body)),
    stop: async (terminalId: string) =>
      hostJson<unknown>(await post("/api/terminal/stop", { id: terminalId })),
    read,
    /** Poll until the command ends, `waitS` passes, or the turn is aborted. The command keeps running. */
    follow: async (
      terminalId: string,
      waitS: number,
      lines: number,
      signal: AbortSignal | undefined,
      onUpdate: OnUpdate,
    ): Promise<RunView> => {
      const deadline = Date.now() + waitS * 1000;
      let view = await read(terminalId, lines);
      let shown = "";
      while (view.status === "running" && Date.now() < deadline && !signal?.aborted) {
        await sleep(POLL_MS, signal);
        view = await read(terminalId, lines);
        const update = result(view, lines);
        const text = update.content[0].text;
        if (onUpdate && text !== shown) {
          shown = text;
          onUpdate(update);
        }
      }
      return view;
    },
  };
}

function sessionIdOf(ctx: unknown): string | undefined {
  const manager = (ctx as { sessionManager?: { getSessionId?: () => unknown } }).sessionManager;
  const id = manager?.getSessionId?.();
  return typeof id === "string" && id ? id : undefined;
}

export function registerSpopiTerminal(
  pi: ExtensionAPI,
  origin = process.env.SPOPI_HOST_ORIGIN?.trim() ?? "",
  fetchImpl: Fetch = fetch,
) {
  if (!origin) return;
  const host = createTerminalClient(origin, fetchImpl);
  pi.registerTool({
    name: TERMINAL_RUN_TOOL,
    label: "Run in terminal",
    description:
      "Run a shell command in a new terminal tab in SPOPI's dock, where the user watches it live and can stop it. Same bash as the bash tool. Use it for anything that runs longer than about a minute or keeps running: servers, watchers, builds, test suites, batch jobs, scripts with workers. Returns when the command ends or after `wait` seconds with its last output; a command still running keeps running.",
    promptSnippet: "Run long or background commands in a terminal tab the user watches",
    promptGuidelines: [
      `Run long or background commands (servers, watchers, batch jobs, anything over about a minute) with ${TERMINAL_RUN_TOOL}, so the user can watch them in a terminal tab. Never start them detached from bash with \`&\`, \`nohup\`, \`setsid\`, \`disown\`, or \`start\`.`,
    ],
    parameters: Type.Object({
      command: Type.String({ description: "The bash command to run." }),
      title: Type.Optional(Type.String({ description: "Short tab name, such as 'dev server'." })),
      cwd: Type.Optional(
        Type.String({ description: "Working folder. Defaults to the project folder." }),
      ),
      wait: Type.Optional(
        Type.Number({
          description: `Seconds to wait for the command to end before returning (default ${DEFAULT_RUN_WAIT_S}, max ${MAX_WAIT_S}).`,
        }),
      ),
    }),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const cwd = params.cwd?.trim()
        ? isAbsolute(params.cwd.trim())
          ? params.cwd.trim()
          : resolve(ctx.cwd, params.cwd.trim())
        : ctx.cwd;
      const started = await host.run({
        cwd,
        sessionId: sessionIdOf(ctx),
        command: params.command,
        title: params.title,
      });
      const view = await host.follow(
        started.terminalId,
        clamp(params.wait, DEFAULT_RUN_WAIT_S, MAX_WAIT_S),
        DEFAULT_LINES,
        signal,
        onUpdate as OnUpdate,
      );
      return result(view, DEFAULT_LINES);
    },
  });
  pi.registerTool({
    name: TERMINAL_READ_TOOL,
    label: "Read terminal",
    description: `Read the state and last output of a command started with ${TERMINAL_RUN_TOOL}, optionally waiting for it to end, or stop it.`,
    parameters: Type.Object({
      terminal: Type.String({ description: `The terminal id ${TERMINAL_RUN_TOOL} returned.` }),
      wait: Type.Optional(
        Type.Number({
          description: `Seconds to wait for the command to end (default 0, max ${MAX_WAIT_S}).`,
        }),
      ),
      lines: Type.Optional(
        Type.Number({
          description: `How many of the last output lines to return (default ${DEFAULT_LINES}, max ${MAX_LINES}).`,
        }),
      ),
      stop: Type.Optional(
        Type.Boolean({ description: "End the command and every process it started." }),
      ),
    }),
    async execute(_toolCallId, params, signal, onUpdate) {
      const lines = Math.max(1, clamp(params.lines, DEFAULT_LINES, MAX_LINES));
      const terminalId = params.terminal.trim();
      if (params.stop) await host.stop(terminalId);
      const wait = params.stop
        ? Math.max(5, clamp(params.wait, 0, MAX_WAIT_S))
        : clamp(params.wait, 0, MAX_WAIT_S);
      const view = await host.follow(terminalId, wait, lines, signal, onUpdate as OnUpdate);
      return result(view, lines);
    },
  });
}
