// ABOUTME: Sends one inbound host frame to the gateway that owns it.
// ABOUTME: OAuth, config replies, background sessions, and the foreground transcript each take their own frames.

import { consumeConfigResponseFrame } from "./config-gateway.js";

/**
 * @typedef {"foreground" | "consumed-foreground" | "background" | "consumed-background"} FrameRoute
 *
 * @param {{
 *   frame: { target: { instanceId: string, sessionId?: string } },
 *   target: { instanceId: string, sessionId?: string },
 *   consumeConfigResponse: (frame: { target: { instanceId: string, sessionId?: string } }) => boolean,
 * }} options
 * @returns {FrameRoute}
 */
export function routeRuntimeFrame({ frame, target, consumeConfigResponse }) {
  const configResponseConsumed = consumeConfigResponse(frame);
  const isBackground =
    frame.target.instanceId !== target.instanceId ||
    (frame.target.sessionId && frame.target.sessionId !== target.sessionId);
  if (isBackground) return configResponseConsumed ? "consumed-background" : "background";
  return configResponseConsumed ? "consumed-foreground" : "foreground";
}

/**
 * @typedef {{
 *   getState: () => { sync: { snapshotRequired: boolean } },
 *   dispatch: (action: { type: "frame", frame: import("../chat/transcript-reducer.js").RuntimeFrame }) => { sync: { snapshotRequired: boolean } },
 * }} FrameSessionRuntime
 */

/**
 * @param {{
 *   runtime: import("./runtime-gateway.js").RuntimeGateway,
 *   config: import("./config-gateway.js").ConfigGateway,
 *   getTarget: () => { instanceId: string, sessionId?: string },
 *   getSessionRuntime: () => FrameSessionRuntime,
 *   consumeOauthFrame: (frame: unknown) => boolean,
 *   onTaskFrame: (frame: unknown) => void,
 *   onForegroundEvent: (event: import("../chat/runtime-events.js").RuntimeEventFrame) => Promise<unknown>,
 *   onBackgroundFrame: (frame: unknown) => Promise<unknown>,
 *   hydrateSnapshot: () => Promise<unknown>,
 *   showError: (error: unknown) => void,
 * }} deps
 */
export function subscribeRuntimeFrames({
  runtime,
  config,
  getTarget,
  getSessionRuntime,
  consumeOauthFrame,
  onTaskFrame,
  onForegroundEvent,
  onBackgroundFrame,
  hydrateSnapshot,
  showError,
}) {
  return runtime.subscribe((frame) => {
    const runtimeFrame = /** @type {{ type?: string, event?: unknown }} */ (frame);
    if (runtimeFrame.type === "extension_ui_resolved") {
      onForegroundEvent(
        /** @type {import("../chat/runtime-events.js").RuntimeEventFrame} */ (frame),
      ).catch(showError);
      return;
    }
    if (runtimeFrame.type !== "runtime_event") return;
    onTaskFrame(frame);
    const routed = routeRuntimeFrame({
      frame: /** @type {Parameters<typeof routeRuntimeFrame>[0]["frame"]} */ (frame),
      target: getTarget(),
      // M3 mutual exclusion: OAuth envelopes are consumed first and never
      // reach the config gateway or chat rendering.
      consumeConfigResponse: (candidate) =>
        consumeOauthFrame(candidate) ||
        consumeConfigResponseFrame(
          config,
          /** @type {Parameters<typeof consumeConfigResponseFrame>[1]} */ (candidate),
        ),
    });
    if (routed === "background" || routed === "consumed-background") {
      if (routed === "background") onBackgroundFrame(frame).catch(showError);
      return;
    }
    const session = getSessionRuntime();
    const wasMissing = session.getState().sync.snapshotRequired;
    const { sync } = session.dispatch({
      type: "frame",
      frame: /** @type {import("../chat/transcript-reducer.js").RuntimeFrame} */ (frame),
    });
    if (!wasMissing && sync.snapshotRequired) {
      // hydrateSnapshot dedupes concurrent calls and retries brief disconnects
      // during project switches instead of painting errors that vanish a moment later.
      hydrateSnapshot().catch(showError);
      // After a reload the host replays open questions and the latest statuses with their
      // old sequence. The snapshot carries neither, so apply them anyway.
      const event = /** @type {{ type?: string } | null} */ (runtimeFrame.event);
      if (event?.type !== "extension_ui_request") return;
    }
    if (routed === "consumed-foreground") return;
    onForegroundEvent(
      /** @type {import("../chat/runtime-events.js").RuntimeEventFrame} */ (runtimeFrame.event),
    ).catch(showError);
  });
}
