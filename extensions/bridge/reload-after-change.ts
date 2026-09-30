// ABOUTME: Reloads Pi after a settings change when the agent is idle.
// ABOUTME: The response is sent first; reload is the last use of the command context.

export type ReloadContext = {
  isIdle?: () => boolean;
  reload?: () => Promise<void>;
};

/**
 * When Pi is idle, returns a callback that reloads after the response is sent.
 * When Pi is busy, the caller keeps the restart message.
 */
export function scheduleReload(ctx: ReloadContext): {
  reloaded: boolean;
  postResponse?: () => Promise<void>;
} {
  if (typeof ctx.isIdle !== "function" || !ctx.isIdle()) return { reloaded: false };
  if (typeof ctx.reload !== "function") return { reloaded: false };
  const reload = ctx.reload.bind(ctx);
  return {
    reloaded: true,
    postResponse: () => reload(),
  };
}
