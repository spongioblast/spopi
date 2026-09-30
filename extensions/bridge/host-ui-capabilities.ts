// ABOUTME: Reports `ctx.ui` surfaces that only a real terminal can render.
// ABOUTME: pi's RPC mode turns them into silent no-ops; SPOPI needs to say so.

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

// pi's RPC mode degrades a handful of `ExtensionUIContext` methods to no-ops
// (see docs/rpc.md, "Extension UI Protocol"). The overlay bridge covers
// `custom()`; the rest have no GUI equivalent at all — they install terminal
// chrome or take over raw keyboard input. An extension that leans on one still
// "succeeds", it just does nothing, which is the worst outcome for a user
// wondering why a command did not work.
//
// Throwing a typed unsupported-host-UI error would stop the command, but over
// RPC these calls are genuinely harmless no-ops and the surrounding
// command usually still does its job. So we report instead of failing — the
// WebView attributes the report to the running slash command and badges it
// (see public/app/extension-ui/extension-command-compatibility.js).
//
// The wire format rides `ctx.ui.notify(JSON)` and is swallowed by the
// frontend, mirroring the `spopi-config` and `spopi-custom-ui` data planes.

/** Envelope key the WebView matches on. */
export const HOST_UI_CAPABILITY_KEY = "__spopiHostUi";

/**
 * Methods that take over the terminal itself. `onTerminalInput` is reported on
 * every call; the rest only when they install something, because passing
 * `undefined` is how an extension restores pi's own default.
 */
const REPORT_ALWAYS = ["onTerminalInput"] as const;
const REPORT_WHEN_SET = ["setFooter", "setHeader", "setEditorComponent"] as const;

type PatchableUi = Record<string, unknown>;

export function registerHostUiCapabilityReporter(pi: ExtensionAPI): void {
  // Tracked by identity rather than a marker property: the RPC host rebuilds
  // the UI context on every session rebind, and a copied marker would make a
  // genuinely unpatched context look patched.
  const patched = new WeakSet<object>();

  const ensurePatched = (ctx: ExtensionContext): void => {
    const ui = ctx.ui as unknown as PatchableUi;
    if (!ui || patched.has(ui)) return;
    patched.add(ui);

    const report = (capability: string): void => {
      ctx.ui.notify(JSON.stringify({ [HOST_UI_CAPABILITY_KEY]: { capability } }), "info");
    };

    const wrap = (capability: string, shouldReport: (args: unknown[]) => boolean): void => {
      const original = ui[capability];
      if (typeof original !== "function") return;
      ui[capability] = (...args: unknown[]) => {
        if (shouldReport(args)) report(capability);
        return (original as (...rest: unknown[]) => unknown).apply(ui, args);
      };
    };

    for (const capability of REPORT_ALWAYS) wrap(capability, () => true);
    for (const capability of REPORT_WHEN_SET) {
      wrap(capability, (args) => args[0] !== undefined);
    }
  };

  pi.on("session_start", (_event, ctx) => ensurePatched(ctx));
  pi.on("input", (_event, ctx) => ensurePatched(ctx));
  pi.on("before_agent_start", (_event, ctx) => ensurePatched(ctx));
}
