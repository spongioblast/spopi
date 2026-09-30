// ABOUTME: Session title, tree navigation, and paste offload.
// ABOUTME: These ops do not read models.json or settings.json.

import path from "node:path";
import { ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import { writePasteOffloadFile } from "./paste-offload";
import { asString, renameHistoricalSession } from "./paths";
import { generateTitleForSession } from "./session-title";
import type { BridgeHandlers } from "./types";

type ListedSessionInfo = {
  path: string;
  id: string;
  cwd: string;
  name?: string;
  created: Date;
  modified: Date;
  firstMessage: string;
};

type SessionLister = {
  list: (cwd: string) => Promise<ListedSessionInfo[]>;
};

function millis(value: Date): number {
  const time = value instanceof Date ? value.getTime() : Date.parse(String(value));
  return Number.isFinite(time) ? time : 0;
}

/** Same camelCase shape `HostDataPlane` serves for the sidebar. */
export function sessionSummary(info: ListedSessionInfo, workspaceId: string, currentCwd: string) {
  const projectPath = info.cwd || "";
  const modifiedAtMs = millis(info.modified);
  const current = currentCwd ? path.resolve(currentCwd) : "";
  const project = projectPath ? path.resolve(projectPath) : "";
  return {
    id: info.id,
    timestamp: info.created instanceof Date ? info.created.toISOString() : String(info.created),
    name: info.name ?? null,
    firstMessage: info.firstMessage || null,
    workspaceId,
    projectPath,
    projectName: projectPath ? path.basename(projectPath) : "",
    isCurrentWorkspace: current !== "" && project === current,
    filePath: info.path,
    fileName: path.basename(info.path),
    modifiedAtMs,
    activityAtMs: modifiedAtMs,
  };
}

export function sessionListHandlers(lister: SessionLister = SessionManager): BridgeHandlers {
  return {
    list_sessions: async (ctx, params) => {
      const cwd = typeof ctx.cwd === "string" ? ctx.cwd : "";
      if (!cwd) throw new Error("Active workspace is required");
      const workspaceId = asString(params.workspaceId) ?? "";
      const listed = await lister.list(cwd);
      const sessions = listed
        .filter((info) => info.cwd === cwd || path.resolve(info.cwd) === path.resolve(cwd))
        .map((info) => sessionSummary(info, workspaceId, cwd));
      return { ok: true, data: { sessions } };
    },
  };
}

export const handlers = {
  ...sessionListHandlers(),
  write_paste_offload: async (ctx, params) => {
    const content = params.content;
    if (typeof content !== "string") throw new Error("content is required");
    if (!ctx.cwd) throw new Error("Active workspace is required");
    const result = writePasteOffloadFile(ctx.cwd, content);
    return { ok: true, data: { path: result.relativePath } };
  },
  navigate_tree: async (ctx, params) => {
    const targetId = asString(params.targetId);
    if (!targetId) throw new Error("targetId is required");
    if (typeof ctx.navigateTree !== "function") {
      throw new Error("Session tree navigation is unavailable.");
    }
    const result = await ctx.navigateTree(targetId, {
      summarize: params.summarize === true,
      ...(typeof params.customInstructions === "string"
        ? { customInstructions: params.customInstructions }
        : {}),
      ...(typeof params.replaceInstructions === "boolean"
        ? { replaceInstructions: params.replaceInstructions }
        : {}),
      ...(typeof params.label === "string" ? { label: params.label } : {}),
    });
    return { ok: true, data: result ?? { cancelled: false } };
  },
  set_label: async (ctx, params) => {
    const entryId = asString(params.entryId);
    const label = asString(params.label);
    if (!entryId || !label) throw new Error("entryId and label are required");
    if (typeof ctx.setLabel !== "function") throw new Error("Labels are unavailable.");
    ctx.setLabel(entryId, label);
    return { ok: true };
  },
  rename_historical_session: async (_ctx, params) => {
    const result = await renameHistoricalSession(params.filePath, params.name);
    return { ok: true, data: result };
  },
  generate_session_title: async (ctx, _params) => {
    const sessionFile = ctx.sessionManager?.getSessionFile();
    if (!sessionFile) throw new Error("The active session has not been saved yet.");
    const modelRuntime = await ModelRuntime.create();
    const title = await generateTitleForSession(sessionFile, {
      model: ctx.model,
      modelRuntime,
    });
    return { ok: true, data: { title } };
  },
} satisfies BridgeHandlers;
