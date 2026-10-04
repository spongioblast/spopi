// ABOUTME: Bridge ops for Pi project trust and reloading after an MCP change.
// ABOUTME: Trust is written only through Pi's ProjectTrustStore, and only on a click.

import { getAgentDir, ProjectTrustStore } from "@earendil-works/pi-coding-agent";
import { scheduleReload } from "./reload-after-change";
import type { BridgeHandlers } from "./types";

function savedTrust(cwd: string): { savedTrust: boolean | null; trustError?: string } {
  try {
    return { savedTrust: new ProjectTrustStore(getAgentDir()).get(cwd) };
  } catch (error) {
    return {
      savedTrust: null,
      trustError: error instanceof Error ? error.message : String(error),
    };
  }
}

export const handlers = {
  get_mcp_project_trust: async (ctx, _params) => {
    const trust = savedTrust(ctx.cwd ?? "");
    return {
      ok: true,
      data: { sessionTrusted: Boolean(ctx.isProjectTrusted?.()), ...trust },
    };
  },
  trust_project_in_pi: async (ctx, _params) => {
    new ProjectTrustStore(getAgentDir()).set(ctx.cwd ?? "", true);
    return { ok: true };
  },
  mcp_config_changed: async (ctx, _params) => {
    const reload = scheduleReload(ctx);
    return {
      ok: true,
      data: { reloaded: reload.reloaded },
      postResponse: reload.postResponse,
    };
  },
} satisfies BridgeHandlers;
