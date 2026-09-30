// ABOUTME: Reads and writes Pi settings and prompt markdown files.
// ABOUTME: Project .pi files stay on the workspace file browser.

import { agentConfigPath, agentsMdPath, appendSystemPath } from "./paths";
import { scheduleReload } from "./reload-after-change";
import {
  readConfigFile,
  readTextFile,
  withSettingsLock,
  writeConfigFile,
  writeTextFile,
} from "./settings-io";
import type { BridgeHandlers } from "./types";

export const handlers = {
  read_agent_config: async (_ctx, _params) => {
    return { ok: true, data: readConfigFile(agentConfigPath(), "{}") };
  },
  write_agent_config: async (ctx, params) => {
    const filePath = agentConfigPath();
    await withSettingsLock(filePath, () => {
      writeConfigFile(filePath, params.content);
    });
    const reload = scheduleReload(ctx);
    return {
      ok: true,
      data: { path: filePath, reloaded: reload.reloaded },
      ...(reload.postResponse ? { postResponse: reload.postResponse } : {}),
    };
  },
  read_agents_md: async (_ctx, _params) => {
    return { ok: true, data: readTextFile(agentsMdPath()) };
  },
  write_agents_md: async (_ctx, params) => {
    writeTextFile(agentsMdPath(), params.content);
    return { ok: true, data: { path: agentsMdPath() } };
  },
  read_append_system_md: async (_ctx, _params) => {
    return { ok: true, data: readTextFile(appendSystemPath()) };
  },
  write_append_system_md: async (_ctx, params) => {
    writeTextFile(appendSystemPath(), params.content);
    return { ok: true, data: { path: appendSystemPath() } };
  },
} satisfies BridgeHandlers;
