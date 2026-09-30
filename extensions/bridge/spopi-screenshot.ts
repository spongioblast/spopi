// ABOUTME: The spopi_screenshot tool: a PNG of the SPOPI window the user sees, returned to the model as an image.
// ABOUTME: Only registered when SPOPI started this Pi; the host captures the window, this module only fetches it.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export const SCREENSHOT_TOOL = "spopi_screenshot";

type Fetch = typeof fetch;

export function screenshotUrl(origin: string, cwd: string): string {
  return `${origin.replace(/\/+$/, "")}/api/ui/screenshot?cwd=${encodeURIComponent(cwd)}`;
}

async function failureMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: unknown } };
    if (typeof body.error?.message === "string") return body.error.message;
  } catch {
    // Not JSON; the status is all there is.
  }
  return `HTTP ${response.status}`;
}

export function registerSpopiScreenshot(
  pi: ExtensionAPI,
  origin = process.env.SPOPI_HOST_ORIGIN?.trim() ?? "",
  fetchImpl: Fetch = fetch,
) {
  if (!origin) return;
  pi.registerTool({
    name: SCREENSHOT_TOOL,
    label: "SPOPI screenshot",
    description:
      "Take a screenshot of the whole SPOPI window as the user sees it right now: chat, editor, dock, and terminal.",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, signal, _onUpdate, ctx) {
      const response = await fetchImpl(screenshotUrl(origin, ctx.cwd), { signal });
      if (!response.ok) {
        throw new Error(`SPOPI could not take a screenshot: ${await failureMessage(response)}`);
      }
      const png = Buffer.from(await response.arrayBuffer());
      return {
        content: [
          { type: "text", text: "The SPOPI window as the user sees it now." },
          { type: "image", data: png.toString("base64"), mimeType: "image/png" },
        ],
        details: { bytes: png.length },
      };
    },
  });
}
