// ABOUTME: Asks the user to trust a project before Pi loads its extensions.
// ABOUTME: Cancelling leaves the project untrusted.
import type { ExtensionAPI, ProjectTrustEventResult } from "@earendil-works/pi-coding-agent";

export const PROJECT_TRUST_CHOICES = [
  "Trust once",
  "Trust and remember",
  "Open untrusted",
  "Cancel workspace opening",
] as const;

export default function projectTrust(pi: ExtensionAPI) {
  pi.on("project_trust", async (event, ctx): Promise<ProjectTrustEventResult> => {
    // Without a UI we cannot ask: return `undecided` so pi falls through to
    // the saved trust.json decision / defaultProjectTrust instead of a hard
    // "no". A hard "no" here owns the decision and overrides a project the
    // user has already trusted (e.g. in the web UI), silently hiding its
    // project-local skills/prompts/extensions. `undecided` keeps unknown
    // projects untrusted (rpc mode has no saved decision -> defaultProjectTrust
    // `ask` -> ignored) while honoring explicit saved trust.
    if (!ctx.hasUI) return { trusted: "undecided" };
    const choice = await ctx.ui.select(`Project resources require trust:\n${event.cwd}`, [
      ...PROJECT_TRUST_CHOICES,
    ]);
    if (choice === "Trust once") return { trusted: "yes" };
    if (choice === "Trust and remember") return { trusted: "yes", remember: true };
    return { trusted: "no" };
  });
}
