// ABOUTME: Keeps long tool results out of model context: saved to a project file, replaced by a digest at turn end.
// ABOUTME: The transcript, UI, and exports keep the full result; only later model requests see the digest.

import type {
  ContextEditEntryDraft,
  ExtensionAPI,
  ExtensionContext,
  ToolResultEvent,
  TurnEndEvent,
} from "@earendil-works/pi-coding-agent";
import {
  buildDigest,
  type DigestLines,
  linesOfText,
  OFFLOAD_THRESHOLD_BYTES,
  pickFromLines,
  pickFromWindows,
} from "./digest";
import { piFullOutputPath, pruneOldOutputs, readWindows, saveOutput } from "./save-output";

/** Key added to the tool result's `details`, so a UI can link the saved file. */
export const DETAILS_KEY = "spopiToolOutput";

export type SavedToolOutput = {
  path: string;
  bytes: number;
  lines: number | null;
  shownHead: number;
  shownTail: number;
};

export type OffloadDeps = { save: typeof saveOutput };

/** `read` already pages through a file the model can reopen; a digest would point at a copy of it. */
const SKIPPED_TOOLS = new Set(["read"]);

/** Text of a tool result, or null when it carries an image, which stays as it is. */
export function resultText(content: ToolResultEvent["content"]): string | null {
  const parts: string[] = [];
  for (const block of content ?? []) {
    if (block.type !== "text") return null;
    parts.push(block.text);
  }
  return parts.join("\n");
}

function truncationTotalLines(details: unknown): number | null {
  const truncation = (details as { truncation?: { totalLines?: unknown } } | null)?.truncation;
  const total = truncation?.totalLines;
  return typeof total === "number" && Number.isFinite(total) ? total : null;
}

function linesFromFile(file: string, knownTotal: number | null) {
  const read = readWindows(file);
  if ("whole" in read) {
    const lines = linesOfText(read.whole);
    return { totalLines: lines.length, lines: pickFromLines(lines) };
  }
  return { totalLines: knownTotal, lines: pickFromWindows(read.head, read.tail, knownTotal) };
}

function toolCallIdOf(entry: unknown): string | null {
  const record = entry as { type?: unknown; message?: { role?: unknown; toolCallId?: unknown } };
  if (record?.type !== "message" || record.message?.role !== "toolResult") return null;
  return typeof record.message.toolCallId === "string" ? record.message.toolCallId : null;
}

function isPlainDetails(details: unknown): details is Record<string, unknown> | undefined {
  return (
    details === undefined ||
    (details !== null && typeof details === "object" && !Array.isArray(details))
  );
}

export function registerToolOutputOffload(
  pi: ExtensionAPI,
  deps: OffloadDeps = { save: saveOutput },
) {
  const digests = new Map<string, string>();

  pi.on("session_start", (_event, ctx: ExtensionContext) => {
    digests.clear();
    pruneOldOutputs(ctx.cwd);
  });
  pi.on("agent_settled", () => digests.clear());

  pi.on("tool_result", (event: ToolResultEvent, ctx: ExtensionContext) => {
    if (SKIPPED_TOOLS.has(event.toolName)) return;
    const text = resultText(event.content);
    if (text === null) return;
    // Once Pi has truncated a shell result, its full output sits in a temp file outside the
    // project; moving it into the project spares the model an outside-the-project read prompt.
    const source = piFullOutputPath(event.details);
    if (!source && Buffer.byteLength(text, "utf8") <= OFFLOAD_THRESHOLD_BYTES) return;

    let saved: ReturnType<typeof saveOutput>;
    let totalLines: number | null;
    let lines: DigestLines;
    try {
      saved = deps.save({
        cwd: ctx.cwd,
        toolName: event.toolName,
        toolCallId: event.toolCallId,
        text,
        sourceFile: source,
      });
      if (source) {
        ({ totalLines, lines } = linesFromFile(
          saved.absolutePath,
          truncationTotalLines(event.details),
        ));
      } else {
        const all = linesOfText(text);
        totalLines = all.length;
        lines = pickFromLines(all);
      }
    } catch {
      // Unwritable project: the model gets the result as the tool returned it.
      return;
    }

    digests.set(
      event.toolCallId,
      buildDigest({ relativePath: saved.relativePath, totalBytes: saved.bytes, totalLines, lines }),
    );
    if (!isPlainDetails(event.details)) return;
    const info: SavedToolOutput = {
      path: saved.relativePath,
      bytes: saved.bytes,
      lines: totalLines,
      shownHead: lines.head.length,
      shownTail: lines.tail.length,
    };
    return { details: { ...(event.details ?? {}), [DETAILS_KEY]: info } };
  });

  // A turn_end context_edit is committed before the next model request, so the model
  // never receives the full result, and the cached prefix never holds it.
  pi.on("turn_end", (event: TurnEndEvent, ctx: ExtensionContext) => {
    if (digests.size === 0) return;
    const edits: ContextEditEntryDraft[] = [];
    for (const entryId of event.toolResultEntryIds) {
      const callId = toolCallIdOf(ctx.sessionManager.getEntry(entryId));
      const digest = callId ? digests.get(callId) : undefined;
      if (!callId || digest === undefined) continue;
      digests.delete(callId);
      edits.push({ type: "context_edit", targetId: entryId, replacement: { content: digest } });
    }
    if (edits.length === 0) return;
    return { entries: [...event.entries, ...edits] };
  });
}
