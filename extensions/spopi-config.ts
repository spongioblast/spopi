// ABOUTME: Dispatches /spopi-config operations to one handler module per domain.
// ABOUTME: Unknown operations and thrown errors become { ok: false }; it does not call providers itself.

import { handlers as cacheWarming } from "./bridge/cache-warming";
import { handlers as contextDrop } from "./bridge/context-drop";
import { handlers as modelCalls } from "./bridge/model-calls";
import { handlers as models } from "./bridge/models";
import { handlers as oauth } from "./bridge/oauth";
import { handlers as packageEnable } from "./bridge/package-enable-handlers";
import { handlers as packageHealth } from "./bridge/package-health-handlers";
import { type ConfigContext, errMessage, type SpopiConfigResult } from "./bridge/paths";
import { handlers as permission } from "./bridge/permission-recipes";
import { handlers as providerKeys } from "./bridge/provider-keys";
import { handlers as providers } from "./bridge/providers";
import { handlers as queue } from "./bridge/queue";
import { handlers as resources } from "./bridge/resources";
import { handlers as session } from "./bridge/session";
import { handlers as settings_files } from "./bridge/settings-files";
import { handlers as skills } from "./bridge/skills";
import { handlers as thinking } from "./bridge/thinking";

export type { ConfigContext, SpopiConfigResult };

export const bridgeHandlers = Object.freeze({
  ...session,
  ...contextDrop,
  ...cacheWarming,
  ...oauth,
  ...models,
  ...modelCalls,
  ...providers,
  ...providerKeys,
  ...skills,
  ...resources,
  ...settings_files,
  ...permission,
  ...packageHealth,
  ...packageEnable,
  ...thinking,
  ...queue,
});

const opNames = Object.keys(bridgeHandlers);
if (new Set(opNames).size !== opNames.length) {
  throw new Error("duplicate bridge operation names");
}

export async function handleSpopiConfig(
  op: string,
  params: Record<string, unknown>,
  ctx: ConfigContext,
): Promise<SpopiConfigResult> {
  try {
    const handler = (
      bridgeHandlers as Record<string, (typeof bridgeHandlers)[keyof typeof bridgeHandlers]>
    )[op];
    if (!handler) return { ok: false, error: `Unknown configuration operation: ${op}` };
    return await handler(ctx, params);
  } catch (error: unknown) {
    return { ok: false, error: errMessage(error) };
  }
}
