// ABOUTME: Adapts Pi's verified public Codex device-code OAuth API for SPOPI.
// ABOUTME: Emits only non-secret device-code and progress data; Pi owns tokens and persistence.

import type {
  AuthCheck,
  AuthEvent,
  AuthInteraction,
  AuthPrompt,
  AuthType,
  Credential,
} from "@earendil-works/pi-ai";

export type { AuthEvent, AuthInteraction, AuthType };

/**
 * Device-code payload forwarded to the WebView. `expiresInSeconds` and
 * `intervalSeconds` are optional because Pi's `AuthEvent.device_code` event
 * declares them optional; the dialog hides its countdown when absent.
 */
export type OAuthDeviceCode = {
  verificationUri: string;
  userCode: string;
  expiresInSeconds?: number;
  intervalSeconds?: number;
};

/** Non-secret login events projected to the SPOPI UI. */
export type PiOAuthLoginEvents = {
  onDeviceCode(deviceCode: OAuthDeviceCode): void;
  onProgress(message: string): void;
};

export type OAuthCapability =
  | { kind: "supported"; provider: "openai-codex"; methods: ["device_code"] }
  | { kind: "provider-unavailable"; reason: string }
  | { kind: "unsupported"; reason: string };

/**
 * The public Pi `ModelRuntime` surface: `login()`,
 * `checkAuth()`, and `logout()` are declared on the exported class;
 * `AuthInteraction` is caller-supplied so SPOPI injects the device-code/
 * progress projection and an AbortSignal. No private fields, reflection, or
 * property probing.
 */
export type VerifiedPublicPiRuntime = {
  login(providerId: string, type: AuthType, interaction: AuthInteraction): Promise<Credential>;
  checkAuth(providerId: string): Promise<AuthCheck | undefined>;
  logout(providerId: string): Promise<void>;
};

export type PiOAuthLoginAdapter = {
  getCodexCapability(): Promise<OAuthCapability>;
  startCodexDeviceCodeLogin(events: PiOAuthLoginEvents, signal: AbortSignal): Promise<void>;
};

/** Auto-select the device_code method from Pi's select prompt. */
async function promptForCodexDeviceCode(prompt: AuthPrompt): Promise<string> {
  if (prompt.type !== "select") {
    throw new Error("Codex device-code flow does not require manual input");
  }
  const deviceCodeOption = prompt.options.find((option) => option.id === "device_code");
  if (!deviceCodeOption) {
    throw new Error("Pi does not expose the Codex device-code login method");
  }
  return deviceCodeOption.id;
}

export function createPiOAuthLoginAdapter(runtime: VerifiedPublicPiRuntime): PiOAuthLoginAdapter {
  return {
    async getCodexCapability(): Promise<OAuthCapability> {
      if (!runtime || typeof runtime.login !== "function") {
        return { kind: "unsupported", reason: "Pi runtime does not expose ModelRuntime.login" };
      }
      try {
        await runtime.checkAuth("openai-codex");
      } catch {
        return {
          kind: "provider-unavailable",
          reason: "openai-codex is not a registered provider",
        };
      }
      return { kind: "supported", provider: "openai-codex", methods: ["device_code"] };
    },

    async startCodexDeviceCodeLogin(
      events: PiOAuthLoginEvents,
      signal: AbortSignal,
    ): Promise<void> {
      const interaction: AuthInteraction = {
        signal,
        prompt: promptForCodexDeviceCode,
        notify: (event: AuthEvent) => {
          switch (event.type) {
            case "device_code":
              events.onDeviceCode({
                userCode: event.userCode,
                verificationUri: event.verificationUri,
                ...(event.intervalSeconds !== undefined
                  ? { intervalSeconds: event.intervalSeconds }
                  : {}),
                ...(event.expiresInSeconds !== undefined
                  ? { expiresInSeconds: event.expiresInSeconds }
                  : {}),
              });
              break;
            case "progress":
              events.onProgress(event.message);
              break;
          }
        },
      };
      await runtime.login("openai-codex", "oauth", interaction);
    },
  };
}
