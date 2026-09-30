// ABOUTME: Shared types for bridge command handlers so every domain module has the same shape.
// ABOUTME: A handler map is { [opName]: (ctx, params) => Promise<unknown> }; the entry merges them.

import type { ConfigContext, SpopiConfigResult } from "./paths";

export type BridgeHandler = (
  ctx: ConfigContext,
  params: Record<string, unknown>,
) => Promise<SpopiConfigResult>;

export type BridgeHandlers = Readonly<Record<string, BridgeHandler>>;
