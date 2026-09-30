// ABOUTME: Real-runtime smoke check for Pi's public OAuth surface (design §7).
// ABOUTME: Catches seam drift that fakes cannot — no mocks, no network calls.

// @vitest-environment node

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));

// Limitation (design §7): this smoke exercises the npm SDK surface the repo
// compiles against, NOT the embedded binary — src-tauri/resources/pi ships
// the SDK compiled into the bun executable with no loadable dist/. The
// embedded-binary seam is verified by the §7 manual acceptance flow (device
// login against a `bun run dev` instance). When the npm pin drifts from the
// embedded pin, the asserts below would test the wrong version, so they are
// skipped loudly instead of passing silently.
const embeddedPin = (
  JSON.parse(readFileSync(join(here, "../scripts/pi-version.json"), "utf8")) as {
    version: string;
  }
).version;
const sdkVersion = (
  JSON.parse(
    readFileSync(
      join(here, "../node_modules/@earendil-works/pi-coding-agent/package.json"),
      "utf8",
    ),
  ) as { version: string }
).version;
const seamAssertsMatchEmbedded = embeddedPin === sdkVersion;
if (!seamAssertsMatchEmbedded) {
  console.warn(
    `[oauth-login-smoke] embedded pi ${embeddedPin} != npm SDK ${sdkVersion}: ` +
      "skipping real-runtime seam asserts; verify the embedded binary via the design §7 manual acceptance flow.",
  );
}

describe.skipIf(!seamAssertsMatchEmbedded)("embedded pi OAuth seam (real runtime)", () => {
  it("exposes the Phase-0-verified ModelRuntime auth methods", async () => {
    const runtime = await ModelRuntime.create();
    // pi-oauth-login-adapter.ts accesses login/checkAuth/logout on the
    // ModelRuntime instance — assert the same access shape stays functional.
    expect(typeof runtime.login).toBe("function");
    expect(typeof runtime.checkAuth).toBe("function");
    expect(typeof runtime.logout).toBe("function");
    // checkAuth resolves AuthCheck | undefined (undefined = provider not
    // configured on this machine). Either value is valid on a clean box; the
    // point is that the seam call resolves without throwing drift errors.
    await runtime.checkAuth("openai-codex");
  });
});
