// ABOUTME: Sets body data-layout and data-pointer from one breakpoint table.
// ABOUTME: Shell CSS reads those attributes. No shell rule uses a width media query.

const LAYOUT_BREAKS = Object.freeze({ wide: 1100, narrow: 600 });

/** @param {number} width */
export function layoutForWidth(width) {
  if (width >= LAYOUT_BREAKS.wide) return "wide";
  if (width >= LAYOUT_BREAKS.narrow) return "narrow";
  return "phone";
}

/**
 * @param {{
 *   target?: Window & { innerWidth?: number, matchMedia?: (q: string) => MediaQueryList },
 *   document?: Document,
 * }} [deps]
 */
export function createLayoutMode({ target = window, document: doc = document } = {}) {
  const apply = () => {
    const width = target.innerWidth || doc.documentElement.clientWidth || 0;
    doc.body.dataset.layout = layoutForWidth(width);
    const coarse = target.matchMedia?.("(pointer: coarse)")?.matches;
    doc.body.dataset.pointer = coarse ? "coarse" : "fine";
  };
  apply();
  target.addEventListener?.("resize", apply);
  const query = target.matchMedia?.("(pointer: coarse)");
  query?.addEventListener?.("change", apply);
  return {
    layout: () => doc.body.dataset.layout || "wide",
    destroy() {
      target.removeEventListener?.("resize", apply);
      query?.removeEventListener?.("change", apply);
    },
  };
}
