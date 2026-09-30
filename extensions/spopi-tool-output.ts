// ABOUTME: Bundled Pi extension: a long tool result is saved under `.pi/tmp/tool-output/` and the model gets a digest.
// ABOUTME: Plain Pi extension with no SPOPI host dependency; `pi -e extensions/spopi-tool-output.ts` loads it too.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerToolOutputOffload } from "./spopi-tool-output/offload";

export default function spopiToolOutput(pi: ExtensionAPI) {
  registerToolOutputOffload(pi);
}
