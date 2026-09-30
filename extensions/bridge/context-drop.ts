// ABOUTME: Drops a session entry from the next prompt until a context_edit is written.
// ABOUTME: Pending ids come from spopi-drop entries that have not been persisted yet.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { asString } from "./paths";
import type { BridgeHandlers } from "./types";

export type DropEntry = {
  type?: string;
  customType?: string;
  id?: string;
  targetId?: string;
  replacement?: unknown;
  data?: { targetId?: unknown };
};

export type DropProjection = {
  entries: Array<{ sourceEntry: { id?: string }; messages: object[] }>;
};

const pending = new Set<string>();
let appendEntry: (customType: string, data?: unknown) => void = () => {};
let warned = false;

/**
 * @param entries Custom and context_edit rows, oldest first.
 */
export function pendingDrops(entries: DropEntry[]): Set<string> {
  const next = new Set<string>();
  for (const entry of entries) {
    if (entry.type === "custom" && entry.customType === "spopi-drop") {
      const id = entry.data?.targetId;
      if (typeof id === "string" && id) next.add(id);
      continue;
    }
    if (entry.type === "custom" && entry.customType === "spopi-drop-done") {
      next.clear();
      continue;
    }
    if (entry.type === "context_edit" && entry.replacement == null && entry.targetId) {
      next.delete(entry.targetId);
    }
  }
  return next;
}

/**
 * Map context messages onto projection entries and omit pending targets.
 * Returns null when a message cannot be mapped.
 */
export function filterDroppedMessages(
  messages: object[],
  projection: DropProjection,
  targets: Set<string>,
): object[] | null {
  if (targets.size === 0) return messages;
  const byIdentity = new Map<object, string>();
  for (const entry of projection.entries) {
    const id = entry.sourceEntry?.id;
    if (!id) continue;
    for (const message of entry.messages) byIdentity.set(message, id);
  }
  const byIndex = projection.entries.length === messages.length;
  const next: object[] = [];
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    const identity = message ? byIdentity.get(message) : undefined;
    const indexed = byIndex ? projection.entries[index]?.sourceEntry?.id : undefined;
    const sourceId = identity ?? indexed;
    if (!sourceId) return null;
    if (targets.has(sourceId)) continue;
    next.push(message);
  }
  return next;
}

export function dropBoundaryDrafts(
  entries: Array<Record<string, unknown>>,
  targets: Set<string>,
): Array<Record<string, unknown>> | null {
  if (targets.size === 0) return null;
  const edits = [...targets].map((targetId) => ({
    type: "context_edit",
    targetId,
    replacement: null,
  }));
  targets.clear();
  return [...entries, ...edits];
}

export function registerContextDrop(pi: ExtensionAPI) {
  const bus = pi as unknown as {
    appendEntry: (customType: string, data?: unknown) => void;
    on: (event: string, handler: (event: never, ctx: never) => unknown) => void;
  };
  appendEntry = (customType, data) => bus.appendEntry(customType, data);
  bus.on("session_start", ((
    _event: unknown,
    ctx: { sessionManager: { getEntries: () => DropEntry[] } },
  ) => {
    const restored = pendingDrops(ctx.sessionManager.getEntries());
    pending.clear();
    for (const id of restored) pending.add(id);
  }) as never);
  bus.on("context", ((
    event: { messages: object[] },
    ctx: { sessionManager: { buildSessionProjection: () => DropProjection } },
  ) => {
    const filtered = filterDroppedMessages(
      event.messages,
      ctx.sessionManager.buildSessionProjection(),
      pending,
    );
    if (!filtered) {
      if (!warned) {
        warned = true;
        console.warn("[spopi-drop] could not map context messages to session entries");
      }
      return;
    }
    if (filtered === event.messages) return;
    return { messages: filtered };
  }) as never);
  const settle = (event: { entries: Array<Record<string, unknown>> }) => {
    const entries = dropBoundaryDrafts(event.entries, pending);
    if (!entries) return;
    appendEntry("spopi-drop-done", {});
    return { entries };
  };
  bus.on("turn_end", settle as never);
  bus.on("agent_before_settle", settle as never);
}

export function requestContextDrop(entryId: string) {
  pending.add(entryId);
  appendEntry("spopi-drop", { targetId: entryId });
}

export const handlers = {
  drop_context: async (_ctx, params) => {
    const entryId = asString(params.entryId);
    if (!entryId) throw new Error("entryId is required");
    requestContextDrop(entryId);
    return { ok: true };
  },
} satisfies BridgeHandlers;
