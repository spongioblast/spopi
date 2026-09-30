// ABOUTME: Picks Home, Work, Editor, Review, or a subagent's transcript for the center pane.
// ABOUTME: A file wins over a running turn. A tab in front (Review or a subagent) wins over both.

/**
 * @param {{ fileOpen?: boolean, running?: boolean, review?: boolean, subagent?: boolean }} input
 * @returns {"home" | "work" | "editor" | "review" | "subagent"}
 */
export function chooseCenterMode({
  fileOpen = false,
  running = false,
  review = false,
  subagent = false,
} = {}) {
  if (subagent) return "subagent";
  if (review) return "review";
  if (fileOpen) return "editor";
  if (running) return "work";
  return "home";
}

/** @type {boolean} */
let reviewOpen = false;
/** @type {boolean} */
let subagentOpen = false;

/** @param {boolean} open */
export function setCenterReview(open) {
  reviewOpen = Boolean(open);
}

export function centerReviewOpen() {
  return reviewOpen;
}

/** @param {boolean} open */
export function setCenterSubagent(open) {
  subagentOpen = Boolean(open);
}

export function centerSubagentOpen() {
  return subagentOpen;
}
