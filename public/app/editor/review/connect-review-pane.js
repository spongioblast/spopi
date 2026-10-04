// ABOUTME: Gives the Review pane its sources (turn, session, git), its send path, and Pi commands.
// ABOUTME: Sending from Review is a prompt when idle and a steer or follow-up while Pi works.

import { workspaceHistoryCommands } from "../../chat/workspace-history-client.js";
import { readFile } from "../../transport/workspace-http.js";
import {
  paintReview,
  setReviewCommands,
  setReviewDrafts,
  setReviewPackageSend,
  setReviewSend,
  setReviewSources,
} from "../review-pane.js";
import { createReviewDrafts } from "./review-drafts.js";
import { createReviewSources } from "./review-sources.js";

/**
 * @typedef {{ workspaceId?: string, sessionId?: string, instanceId?: string }} ReviewTarget
 * @typedef {{
 *   panel?: { notGitRepo?: boolean, snapshot?: { entries?: unknown[] } | null } | null,
 *   client: { fileAtHeadText: (id: string) => Promise<unknown> },
 * }} ReviewGitPanel
 */

/**
 * @param {{
 *   control: import("../../transport/control-gateway.js").HostControlGateway,
 *   runtime: import("../../transport/runtime-gateway.js").RuntimeGateway,
 *   getTarget: () => ReviewTarget,
 *   getGitPanel: () => ReviewGitPanel | null | undefined,
 *   getProjectPath?: () => Promise<string>,
 *   isWorking: () => boolean,
 *   hasCommand: (name: string) => boolean,
 *   listCommands?: () => Array<{ name?: string, sourceInfo?: { source?: string, path?: string } }>,
 *   randomId: () => string,
 *   t: (key: string, params?: Record<string, unknown>) => string,
 * }} deps
 */
export function connectReviewPane({
  control,
  runtime,
  getTarget,
  getGitPanel,
  getProjectPath,
  isWorking,
  hasCommand,
  listCommands = () => [],
  randomId,
  t,
}) {
  setReviewSources(
    createReviewSources({
      control,
      t,
      getTarget: () => {
        const target = getTarget();
        return { workspaceId: target.workspaceId || "", sessionId: target.sessionId || "" };
      },
      isGitRepo: () => !getGitPanel()?.panel?.notGitRepo,
      projectRoot: getProjectPath,
      uiRoot: async () => {
        const response = await fetch("/api/ui/overrides");
        if (!response.ok) return "";
        const body = /** @type {{ root?: string }} */ (await response.json());
        return typeof body.root === "string" ? body.root : "";
      },
      files: {
        readFile: async (/** @type {string} */ path) => {
          const response = await readFile(path, { workspaceId: getTarget().workspaceId || "" });
          if (!response.ok) throw new Error("read_failed");
          const body = /** @type {{ content?: string, isBinary?: boolean, binary?: boolean }} */ (
            await response.json()
          );
          return {
            content: typeof body.content === "string" ? body.content : "",
            isBinary: body.isBinary === true || body.binary === true,
          };
        },
      },
      git: {
        // Ask git directly: the Git panel only loads status once it has been opened.
        status: async () => {
          const frame = /** @type {{ snapshot?: { entries?: unknown[] } } | null} */ (
            await runtime.git({ type: "status" }, getTarget())
          );
          const snapshot = frame?.snapshot ?? frame;
          return snapshot && Array.isArray(/** @type {{ entries?: unknown }} */ (snapshot).entries)
            ? snapshot
            : getGitPanel()?.panel?.snapshot || { entries: [] };
        },
        fileAtHeadText: (/** @type {string} */ id) =>
          getGitPanel()?.client.fileAtHeadText(id) ??
          Promise.resolve({ content: "", exists: false }),
      },
    }),
  );
  setReviewDrafts(
    createReviewDrafts({
      load: (id) => control.loadReviewDrafts(id),
      save: (id, list) => control.saveReviewDrafts(id, list),
      onChange: () => paintReview(),
    }),
    () => getTarget().workspaceId || "",
  );
  setReviewSend((message, { queue } = {}) => {
    const type = !isWorking() ? "prompt" : queue ? "follow_up" : "steer";
    return runtime.request({ type, message }, getTarget(), { idempotencyKey: randomId() });
  });
  setReviewPackageSend((message) =>
    runtime.request({ type: isWorking() ? "follow_up" : "prompt", message }, getTarget(), {
      idempotencyKey: randomId(),
    }),
  );
  setReviewCommands({
    has: hasCommand,
    historyInstalled: () => workspaceHistoryCommands(listCommands()).length > 0,
    run: (command) =>
      runtime.request({ type: "prompt", message: command }, getTarget(), {
        idempotencyKey: randomId(),
      }),
  });
}
