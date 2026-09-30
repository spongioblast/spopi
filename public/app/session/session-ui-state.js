// ABOUTME: Coordinates host-backed per-session model/thinking profiles.
// ABOUTME: Profiles never use browser storage.

/**
 * @typedef {{ provider: string, modelId: string, thinkingLevel: string }} SessionProfile
 * @typedef {{ load?: () => Promise<unknown>, save?: (profile: SessionProfile) => Promise<unknown> }} ProfileClient
 */

/**
 * @param {unknown} profile
 * @returns {SessionProfile | null}
 */
function normalizeProfile(profile) {
  if (!profile || typeof profile !== "object") return null;
  const raw = /** @type {{ provider?: unknown, modelId?: unknown, thinkingLevel?: unknown }} */ (
    profile
  );
  const provider = typeof raw.provider === "string" ? raw.provider.trim() : "";
  const modelId = typeof raw.modelId === "string" ? raw.modelId.trim() : "";
  const thinkingLevel = typeof raw.thinkingLevel === "string" ? raw.thinkingLevel : "off";
  if (!provider || !modelId) return null;
  return { provider, modelId, thinkingLevel };
}

export class SessionUiStateStore {
  /**
   * @param {object} [options]
   * @param {ProfileClient | null} [options.profileClient]
   */
  constructor({ profileClient = null } = {}) {
    /** @type {ProfileClient | null} */
    this.profileClient = profileClient;
  }

  async loadProfile() {
    if (!this.profileClient?.load) return null;
    try {
      return normalizeProfile(await this.profileClient.load());
    } catch {
      return null;
    }
  }

  /**
   * @param {unknown} profile
   * @returns {Promise<SessionProfile | null>}
   */
  async saveProfile(profile) {
    const normalized = normalizeProfile(profile);
    if (!normalized || !this.profileClient?.save) return null;
    try {
      return normalizeProfile(await this.profileClient.save(normalized)) || normalized;
    } catch {
      return null;
    }
  }
}
