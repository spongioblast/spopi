// ABOUTME: Keeps the chat pinned to the newest line while Pi streams, for text, thinking, and tools.
// ABOUTME: Scrolling up (wheel, keys, touch, scrollbar) unpins it; reaching the bottom pins it again.

const BOTTOM_TOLERANCE = 24;
const MAX_SETTLE_FRAMES = 10;
const UP_KEYS = new Set(["ArrowUp", "PageUp", "Home"]);

/** @typedef {{ follow: () => void, force: () => void, readonly pinned: boolean }} ChatFollow */

/** @type {WeakMap<HTMLElement, ChatFollow>} */
const followers = new WeakMap();

/**
 * One follower per scroll container, shared by every renderer that writes into it.
 * @param {HTMLElement} container
 * @returns {ChatFollow}
 */
export function chatFollow(container) {
  let follower = followers.get(container);
  if (!follower) {
    follower = createFollower(container);
    followers.set(container, follower);
  }
  return follower;
}

/**
 * @param {HTMLElement} container
 * @returns {ChatFollow}
 */
function createFollower(container) {
  let pinned = true;
  // Where the last pin left scrollTop. Streaming grows the page below it without moving it,
  // so only a scrollTop above this mark means the user scrolled up (scrollbar drags).
  let pinnedTop = -1;
  let queued = false;
  /** @type {number | null} */
  let touchY = null;

  const gap = () => container.scrollHeight - container.scrollTop - container.clientHeight;
  const unpin = () => {
    pinned = false;
    pinnedTop = -1;
  };
  const pinIfAtBottom = () => {
    if (gap() > BOTTOM_TOLERANCE) return false;
    pinned = true;
    pinnedTop = container.scrollTop;
    return true;
  };

  container.addEventListener(
    "scroll",
    () => {
      if (pinIfAtBottom()) return;
      if (pinnedTop < 0 || container.scrollTop < pinnedTop - 2) unpin();
    },
    { passive: true },
  );
  // Intent beats position: a wheel over a nested scroller (thinking box, code block) never
  // moves this container, but the user still asked to look up.
  container.addEventListener(
    "wheel",
    (event) => {
      if (event.deltaY < 0) unpin();
      else if (event.deltaY > 0) pinIfAtBottom();
    },
    { passive: true },
  );
  container.addEventListener("keydown", (event) => {
    if (UP_KEYS.has(event.key)) unpin();
  });
  container.addEventListener(
    "touchstart",
    (event) => {
      touchY = event.touches[0]?.clientY ?? null;
    },
    { passive: true },
  );
  container.addEventListener(
    "touchmove",
    (event) => {
      const y = event.touches[0]?.clientY;
      if (touchY != null && y != null && y > touchY + 4) unpin();
    },
    { passive: true },
  );

  // History messages use content-visibility: auto, so the bottom is first an estimate. Drawing
  // the messages it reveals moves it a frame later, so the jump repeats for a few frames.
  /** @param {number} framesLeft */
  const settle = (framesLeft) => {
    requestAnimationFrame(() => {
      if (!pinned) {
        queued = false;
        return;
      }
      if (gap() > 1) container.scrollTop = container.scrollHeight;
      pinnedTop = container.scrollTop;
      if (framesLeft > 0) settle(framesLeft - 1);
      else queued = false;
    });
  };

  const jump = () => {
    if (queued) return;
    queued = true;
    settle(MAX_SETTLE_FRAMES);
  };

  return {
    follow() {
      if (pinned) jump();
    },
    force() {
      pinned = true;
      jump();
    },
    get pinned() {
      return pinned;
    },
  };
}
