// ABOUTME: Paints the retry banner, guard chip, and status footer after each transcript update.
// ABOUTME: Session runtime calls this once; the transcript itself renders the turns.

import { paintRetryBanner } from "../chat/retry-banner.js";
import { registerTurnReview } from "../chat/turn-block.js";
import { paintAdaptiveCenter } from "../editor/center-paint.js";
import { openTurnReview } from "../editor/review-pane.js";
import { paintStatusFooter } from "../shell/status-footer.js";
import { paintGuardChip } from "./guard-chip.js";

registerTurnReview((turn) => openTurnReview(turn));

/**
 * @param {import("../chat/transcript-reducer.js").TranscriptState | null | undefined} state
 */
export function paintSessionChrome(state) {
  if (!state) return;
  paintRetryBanner(state);
  paintGuardChip(state);
  paintStatusFooter(state.status?.keys);
  paintAdaptiveCenter(state);
}
