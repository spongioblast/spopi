// ABOUTME: Sends one inbound host frame to the gateway that owns it.
// ABOUTME: Unknown frames are ignored.

// Classifies runtime frames while preserving the foreground sequence watermark.

/**
 * @template T
 * @param {{
 *   frame: { target: { instanceId: string, sessionId?: string } },
 *   target: { instanceId: string, sessionId?: string },
 *   store: T,
 *   consumeConfigResponse: (frame: { target: { instanceId: string, sessionId?: string } }) => boolean,
 *   reduceForeground: (
 *     store: T,
 *     frame: { target: { instanceId: string, sessionId?: string } },
 *   ) => T,
 * }} options
 */
export function routeRuntimeFrame({
  frame,
  target,
  store,
  consumeConfigResponse,
  reduceForeground,
}) {
  const configResponseConsumed = consumeConfigResponse(frame);
  const isBackground =
    frame.target.instanceId !== target.instanceId ||
    (frame.target.sessionId && frame.target.sessionId !== target.sessionId);

  if (isBackground) {
    return {
      kind: configResponseConsumed ? "consumed-background" : "background",
      store,
    };
  }

  return {
    kind: configResponseConsumed ? "consumed-foreground" : "foreground",
    store: reduceForeground(store, frame),
  };
}
