// ABOUTME: Keeps the message list padded clear of the header and the composer.
// ABOUTME: The insets update when those bars change height.

const CHROME_GAP = 12;

/** @param {HTMLElement | null | undefined} element */
function defaultMeasureHeight(element) {
  if (!element) return 0;
  const rect = element.getBoundingClientRect?.();
  return Math.ceil(rect?.height || element.offsetHeight || 0);
}

/**
 * @param {{
 *   main?: HTMLElement,
 *   messages?: HTMLElement,
 *   header?: HTMLElement,
 *   inputArea?: HTMLElement,
 *   workspaceContent?: HTMLElement,
 *   measureHeight?: (element: HTMLElement) => number
 * }} [options]
 */
export function syncMessagesInsets({
  main,
  messages,
  header,
  inputArea,
  workspaceContent,
  measureHeight = defaultMeasureHeight,
} = {}) {
  if (!main || !messages || !header || !inputArea) {
    document.documentElement.style.setProperty("--kb-inset", "0px");
    return {
      topInset: 0,
      bottomInset: 0,
      workspaceHeaderOffset: 0,
    };
  }

  const headerHeight = measureHeight(header);
  const topInset = headerHeight + CHROME_GAP;
  const viewport = window.visualViewport;
  const keyboard = viewport
    ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)
    : 0;
  document.documentElement.style.setProperty("--kb-inset", `${keyboard}px`);
  document.documentElement.style.setProperty("--header-offset", `${headerHeight}px`);
  const bottomInset = measureHeight(inputArea) + CHROME_GAP + keyboard;
  const workspaceHeaderOffset = Math.max(0, headerHeight);

  main.style.setProperty("--messages-top-inset", `${topInset}px`);
  main.style.setProperty("--messages-bottom-inset", `${bottomInset}px`);
  messages.style.setProperty("scroll-padding-top", `${topInset}px`);
  messages.style.setProperty("scroll-padding-bottom", `${bottomInset}px`);
  workspaceContent?.style.setProperty("--workspace-header-offset", `${workspaceHeaderOffset}px`);

  return { topInset, bottomInset, workspaceHeaderOffset };
}

/**
 * @param {{
 *   main?: HTMLElement,
 *   messages?: HTMLElement,
 *   header?: HTMLElement,
 *   inputArea?: HTMLElement,
 *   workspaceContent?: HTMLElement
 * }} [options]
 */
export function mountMessagesInsets({ main, messages, header, inputArea, workspaceContent } = {}) {
  let frameId = 0;

  const sync = () => {
    frameId = 0;
    syncMessagesInsets({ main, messages, header, inputArea, workspaceContent });
  };

  const scheduleSync = () => {
    if (frameId) return;
    frameId = requestAnimationFrame(sync);
  };

  scheduleSync();

  const observer =
    typeof ResizeObserver === "function"
      ? new ResizeObserver(() => {
          scheduleSync();
        })
      : null;

  if (header) observer?.observe(header);
  if (inputArea) observer?.observe(inputArea);
  if (main) observer?.observe(main);

  window.addEventListener("resize", scheduleSync);
  window.visualViewport?.addEventListener("resize", scheduleSync);

  return () => {
    if (frameId) cancelAnimationFrame(frameId);
    observer?.disconnect();
    window.removeEventListener("resize", scheduleSync);
    window.visualViewport?.removeEventListener("resize", scheduleSync);
  };
}
