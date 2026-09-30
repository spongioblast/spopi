// ABOUTME: Keeps the chat pinned to the newest line while Pi streams, for text, thinking, and tools.
// ABOUTME: Only the user scrolling up unpins it; content growing under our own scroll does not.

const BOTTOM_TOLERANCE = 24;

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
  // so only a scrollTop above this mark means the user scrolled up.
  let pinnedTop = -1;
  let queued = false;

  container.addEventListener(
    "scroll",
    () => {
      const gap = container.scrollHeight - container.scrollTop - container.clientHeight;
      if (gap <= BOTTOM_TOLERANCE) {
        pinned = true;
        pinnedTop = container.scrollTop;
      } else if (pinnedTop < 0 || container.scrollTop < pinnedTop - 2) {
        pinned = false;
        pinnedTop = -1;
      }
    },
    { passive: true },
  );

  const jump = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      container.scrollTop = container.scrollHeight;
      pinnedTop = container.scrollTop;
    });
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
