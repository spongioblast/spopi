// ABOUTME: Bundled Pi extension: after a run that edits files, run the project check before Pi settles.
// ABOUTME: Plain Pi extension with no SPOPI host dependency; `pi -e extensions/spopi-verify.ts` loads it too.
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerVerifyGate } from "./spopi-verify/verify-gate";
import { registerVerifySkills } from "./spopi-verify/verify-skills";

// Resolved from this entry file, so it holds for the source and for the `dist/` bundle,
// where `scripts/build-extensions.js` copies the skills to the same relative place.
const SKILLS_ROOT = fileURLToPath(new URL("./spopi-verify/skills", import.meta.url));

export default function spopiVerify(pi: ExtensionAPI) {
  registerVerifyGate(pi);
  registerVerifySkills(pi, SKILLS_ROOT);
}
