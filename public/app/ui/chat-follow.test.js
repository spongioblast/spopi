// ABOUTME: Tests that the chat stays pinned while content grows under an auto-scroll.
// ABOUTME: Scrolling up unpins; scrolling back to the bottom pins again; late growth is followed.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chatFollow } from "./chat-follow.js";

/** @param {{ height: number }} size */
function scroller(size) {
  const box = document.createElement("div");
  Object.defineProperty(box, "clientHeight", { get: () => 100 });
  Object.defineProperty(box, "scrollHeight", { get: () => size.height });
  Object.defineProperty(box, "scrollTop", { value: 0, writable: true });
  return box;
}

describe("chatFollow", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", (/** @type {FrameRequestCallback} */ run) => {
      run(0);
      return 1;
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("stays pinned when thinking grows before the scroll event arrives", () => {
    const size = { height: 1000 };
    const box = scroller(size);
    const follow = chatFollow(box);
    follow.follow();
    expect(box.scrollTop).toBe(1000);
    size.height = 1600;
    box.dispatchEvent(new Event("scroll"));
    expect(follow.pinned).toBe(true);
    follow.follow();
    expect(box.scrollTop).toBe(1600);
  });

  it("lets the user scroll up and pins again at the bottom", () => {
    const size = { height: 1000 };
    const box = scroller(size);
    const follow = chatFollow(box);
    follow.follow();
    box.scrollTop = 400;
    box.dispatchEvent(new Event("scroll"));
    expect(follow.pinned).toBe(false);
    size.height = 1400;
    follow.follow();
    expect(box.scrollTop).toBe(400);
    box.scrollTop = 1300;
    box.dispatchEvent(new Event("scroll"));
    expect(follow.pinned).toBe(true);
  });

  it("keeps jumping while drawn history messages grow past their estimated height", () => {
    /** @type {FrameRequestCallback[]} */
    const frames = [];
    vi.stubGlobal("requestAnimationFrame", (/** @type {FrameRequestCallback} */ run) => {
      frames.push(run);
      return frames.length;
    });
    const size = { height: 800 };
    const box = scroller(size);
    chatFollow(box).force();
    frames.shift()?.(0);
    expect(box.scrollTop).toBe(800);
    size.height = 1100;
    frames.shift()?.(0);
    expect(box.scrollTop).toBe(1100);
    while (frames.length) frames.shift()?.(0);
    expect(box.scrollTop).toBe(1100);
  });

  it("stops the jumps once the user scrolls up", () => {
    /** @type {FrameRequestCallback[]} */
    const frames = [];
    vi.stubGlobal("requestAnimationFrame", (/** @type {FrameRequestCallback} */ run) => {
      frames.push(run);
      return frames.length;
    });
    const size = { height: 800 };
    const box = scroller(size);
    chatFollow(box).force();
    frames.shift()?.(0);
    box.scrollTop = 200;
    box.dispatchEvent(new Event("scroll"));
    size.height = 1100;
    while (frames.length) frames.shift()?.(0);
    expect(box.scrollTop).toBe(200);
  });

  it("shares one state between renderers of the same container", () => {
    const box = scroller({ height: 500 });
    expect(chatFollow(box)).toBe(chatFollow(box));
  });
});
