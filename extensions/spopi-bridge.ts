// ABOUTME: Bundled Pi extension that registers SPOPI commands and notify channels.
// ABOUTME: The WebView calls /spopi-config and /spopi-custom-ui; Pi stays the agent.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerContextDrop } from "./bridge/context-drop";
import { registerCustomUiBridge } from "./bridge/custom-ui-bridge";
import { registerHostUiCapabilityReporter } from "./bridge/host-ui-capabilities";
import { startOrphanWatchdog } from "./bridge/orphan-watchdog";
import { registerPackageHealth } from "./bridge/package-health-handlers";
import projectTrust from "./bridge/project-trust";
import { registerSpopiAwareness } from "./bridge/spopi-awareness";
import { registerSpopiScreenshot } from "./bridge/spopi-screenshot";
import { registerSpopiUiCopy } from "./bridge/spopi-ui-copy";
import { registerAutomaticSessionTitle } from "./session-title-auto";
import type { ConfigContext } from "./spopi-config";
import { handleSpopiConfig } from "./spopi-config";

type ConfigRequest = {
  id?: string;
  op?: string;
  params?: Record<string, unknown>;
};

export default function spopiBridge(pi: ExtensionAPI) {
  registerPackageHealth(pi);
  // Stop this runtime if SPOPI dies without taking it down — see
  // src-tauri/src/child_supervision.rs for the other layers.
  startOrphanWatchdog();
  registerSpopiAwareness(pi);
  registerSpopiScreenshot(pi);
  registerSpopiUiCopy(pi);
  projectTrust(pi);
  registerAutomaticSessionTitle(pi);
  registerContextDrop(pi);
  // Bridges `ctx.ui.custom()` overlays into the WebView; pi's RPC stub would
  // otherwise leave any extension awaiting one blocked forever.
  registerCustomUiBridge(pi);
  // Surfaces the `ctx.ui` surfaces that stay terminal-only, so a command that
  // silently does nothing in the GUI can say why.
  registerHostUiCapabilityReporter(pi);

  // Configuration data plane. Invoked by the WebView via a native RPC prompt
  // (`/spopi-config <json>`); extension commands run immediately without
  // hitting the LLM or session history. The result is streamed back through
  // `ctx.ui.notify(JSON)` and correlated by request id on the frontend
  // (see public/app/transport/config-gateway.js).
  pi.registerCommand("spopi-config", {
    description: "SPOPI Settings → Configuration data plane",
    handler: async (rawArguments, ctx) => {
      let request: ConfigRequest;
      try {
        request = JSON.parse(rawArguments) as ConfigRequest;
      } catch {
        return;
      }
      const id = typeof request.id === "string" ? request.id : "";
      if (!id) return;
      const respond = (payload: Record<string, unknown>) => {
        ctx.ui.notify(JSON.stringify({ __spopiConfig: id, ...payload }), "info");
      };
      // OAuth login events stream over the same config channel: each frame
      // carries the initiating request id so only the requesting window's
      // active session consumes them (design §5 envelope).
      const oauthNotify = (event: unknown) => {
        ctx.ui.notify(JSON.stringify({ __spopiOauth: id, event }), "info");
      };
      const op = typeof request.op === "string" ? request.op : "";
      const params = request.params && typeof request.params === "object" ? request.params : {};
      try {
        // SAFETY: ctx is the live pi ExtensionContext; ConfigContext only
        // declares the slices these operations consume. The registry's real
        // method signatures are narrower than the structural shell, so this
        // cast widens the object to the shell shape (same rationale as the
        // respond() cast below).
        const result = await handleSpopiConfig(op, params, {
          ...ctx,
          oauthNotify,
          setLabel: (entryId: string, label: string | undefined) => pi.setLabel(entryId, label),
        } as unknown as ConfigContext);
        if (!result.ok) {
          respond(result as unknown as Record<string, unknown>);
          return;
        }
        const { postResponse, ...payload } = result;
        // SAFETY: the payload is JSON ({ ok, data? }). postResponse is a
        // callback and must not be sent to the page.
        respond(payload as unknown as Record<string, unknown>);
        if (postResponse) await postResponse();
      } catch (error) {
        respond({ ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    },
  });
}
