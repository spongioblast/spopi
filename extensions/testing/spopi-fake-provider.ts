// ABOUTME: Registers a fake OpenAI provider when the smoke server URL is set.
// ABOUTME: A normal launch leaves the provider list unchanged.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function spopiFakeProvider(pi: ExtensionAPI) {
  const base = process.env.SPOPI_FAKE_OPENAI_URL;
  if (!base) return;
  const url = base.replace(/\/$/, "");
  pi.registerProvider("fake", {
    name: "Fake",
    baseUrl: `${url}/v1`,
    apiKey: "fake",
    api: "openai-completions",
    models: [
      {
        id: "fake-1",
        name: "Fake 1",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 32000,
        maxTokens: 4000,
      },
    ],
  });
}
