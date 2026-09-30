// ABOUTME: One stable prompt line and the spopi-customize skill path.
// ABOUTME: Loaded only by the bridge, so a plain TUI launch never sees it.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { SCREENSHOT_TOOL } from "./spopi-screenshot";

type Env = Record<string, string | undefined>;

export function spopiPromptLine(env: Env = process.env): string {
  const shipped = env.SPOPI_PUBLIC_DIR || "";
  const overlay = env.SPOPI_UI_OVERLAY || "";
  const parts = [
    `You are running inside SPOPI, a desktop GUI for Pi. To change SPOPI itself (look, layout, wording, panels), load the spopi-customize skill. Shipped UI (read-only): ${shipped}. Your edits go to: ${overlay}.`,
  ];
  if (env.SPOPI_HOST_ORIGIN) {
    parts.push(`To see SPOPI as the user sees it, call ${SCREENSHOT_TOOL}.`);
  }
  const agentBrowser = env.SPOPI_AGENT_BROWSER !== "0";
  const cdp = env.SPOPI_CDP_PORT?.trim();
  if (agentBrowser && cdp && /^\d+$/.test(cdp)) {
    parts.push(
      `Live debugging is on: \`agent-browser --cdp ${cdp} snapshot -i\`, then \`click\`, \`get\`, and \`screenshot\` with the same \`--cdp ${cdp}\`, act on the SPOPI window the user is looking at. Look and click only: do not type into the chat composer and do not navigate the window away.`,
    );
  }
  if (agentBrowser && env.SPOPI_SURF === "1") {
    parts.push(
      "Two browsers are available: use agent-browser for local pages and apps you build, and the surf_* tools for the web and sites that need the user's logins.",
    );
  }
  return parts.join(" ");
}

const LINE = spopiPromptLine();

export function registerSpopiAwareness(pi: ExtensionAPI) {
  pi.on("before_agent_start", (event) => {
    const options = (event as { systemPromptOptions?: { promptGuidelines?: string[] } })
      .systemPromptOptions;
    if (!options) return undefined;
    const guidelines = Array.isArray(options.promptGuidelines) ? options.promptGuidelines : [];
    if (!guidelines.includes(LINE)) guidelines.push(LINE);
    options.promptGuidelines = guidelines;
    return undefined;
  });
  pi.on("resources_discover", () => {
    const dir = process.env.SPOPI_SKILL_DIR;
    if (!dir) return undefined;
    return { skillPaths: [dir] };
  });
}
