// ABOUTME: Renders the conversation navigator and scrolls to a chosen turn.
// ABOUTME: The turn list is supplied by the chat column.

import { headerChromeRefs } from "../shell/chrome/chat.js";

/**
 * @typedef {{ user: HTMLElement, assistant: HTMLElement | null }} ConvNavTurn
 */

/**
 * @typedef {{
 *   messagesEl: HTMLElement,
 *   headerEl?: HTMLElement | null,
 *   badgeEl?: HTMLElement | null,
 *   onJumpToEntry?: ((entryId: string) => void) | null,
 * }} ConvNavOptions
 */

/**
 * Conversation navigator rail (Codex-style dot track).
 *
 * Renders a vertical rail of dots — one per user/assistant turn — to the
 * right of the chat messages. Clicking a dot jumps to that conversation.
 * Hovering anywhere on the track shows a tooltip with the first ~120 chars
 * of the user prompt and ~180 chars of the assistant reply. The tooltip
 * stays visible for the whole time the pointer is on the track; only its
 * position and content change as the pointer moves.
 *
 * Usage:
 *   const nav = new ConvNav({
 *     messagesEl,   // the scrollable #messages container
 *     headerEl,     // the floating .header element (for offset calc)
 *     badgeEl,      // #scroll-bottom-badge
 *   });
 *   nav.mount();   // wire scroll + mutation + resize listeners
 *   nav.rebuild(); // call explicitly after a full history render
 *   nav.notifyNewMessage(); // call when a new assistant message arrives
 *   nav.destroy(); // clean up listeners
 */
export class ConvNav {
  /** @type {HTMLElement} */
  #messagesEl;
  /** @type {HTMLElement | null | undefined} */
  #headerEl;
  /** @type {HTMLElement | null | undefined} */
  #badgeEl;
  /** @type {HTMLElement | null} */
  #navEl;
  /** @type {HTMLElement | null} */
  #trackEl;
  /** @type {HTMLElement | null} */
  #tooltipEl;
  /** @type {HTMLElement | null} */
  #tooltipQ;
  /** @type {HTMLElement | null} */
  #tooltipA;
  /** @type {HTMLElement | null} */
  #tooltipSep;

  #isScrolledUp = false;
  /** @type {number | undefined} */
  #tooltipHideTimer;
  #navLockedIdx = -1;
  /** @type {number | undefined} */
  #navLockTimer;
  /** @type {((entryId: string) => void) | null} */
  #onJumpToEntry = null;
  /** @type {ConvNavTurn[]} */
  #turns = [];
  #hoveredIdx = -1;

  /** @type {((e: MouseEvent) => void) | undefined} */
  _onTrackPointer;
  /** @type {((e: MouseEvent) => void) | undefined} */
  _onTrackLeave;
  /** @type {((e: MouseEvent) => void) | undefined} */
  _onNavClick;
  /** @type {((e: MouseEvent) => void) | undefined} */
  _onDocumentClick;
  /** @type {(() => void) | undefined} */
  _onScroll;
  /** @type {(() => void) | undefined} */
  _onResize;
  /** @type {MutationObserver | undefined} */
  _observer;

  static #MAX_HEIGHT = 560;

  /**
   * @param {ConvNavOptions} options
   */
  constructor({ messagesEl, headerEl, badgeEl, onJumpToEntry = null }) {
    this.#messagesEl = messagesEl;
    this.#headerEl = headerEl;
    this.#badgeEl = badgeEl;
    // Jump-side hook for cross-panel sync: after the chat
    // scrolls to a turn, app.js highlights/scrolls the Info panel's tree
    // node for the same entry.
    this.#onJumpToEntry = onJumpToEntry;
    const nav = headerChromeRefs();
    this.#navEl = nav.convNav instanceof HTMLElement ? nav.convNav : null;
    this.#trackEl = nav.convNavTrack instanceof HTMLElement ? nav.convNavTrack : null;
    this.#tooltipEl = nav.convNavTooltip instanceof HTMLElement ? nav.convNavTooltip : null;
    this.#tooltipQ = nav.convNavTooltipQ instanceof HTMLElement ? nav.convNavTooltipQ : null;
    this.#tooltipA = nav.convNavTooltipA instanceof HTMLElement ? nav.convNavTooltipA : null;
    this.#tooltipSep = nav.convNavTooltipSep instanceof HTMLElement ? nav.convNavTooltipSep : null;
  }

  mount() {
    if (!this.#navEl || !this.#trackEl || !this.#messagesEl) return;
    const navEl = this.#navEl;
    const trackEl = this.#trackEl;
    const messagesEl = this.#messagesEl;
    const tooltipEl = this.#tooltipEl;

    if (tooltipEl) {
      tooltipEl.onmouseenter = () => window.clearTimeout(this.#tooltipHideTimer);
      /**
       * @param {MouseEvent} e
       */
      tooltipEl.onmouseleave = (e) => {
        if (e.relatedTarget instanceof Node && trackEl.contains(e.relatedTarget)) return;
        this.#hideTooltip();
      };
    }

    /**
     * @param {MouseEvent} e
     */
    this._onTrackPointer = (e) => this.#updateHoverFromPointer(e);
    /**
     * @param {MouseEvent} e
     */
    this._onTrackLeave = (e) => {
      if (this.#isTooltipTarget(e.relatedTarget)) return;
      this.#hoveredIdx = -1;
      this.#clearWave();
      this.#hideTooltip();
    };

    // Delegate clicks to the whole rail so users don't have to hit the thin
    // tick exactly: a click anywhere maps to the nearest turn (same logic as
    // hover). Inter-tick gaps and the rail's own padding are all jump targets.
    /**
     * @param {MouseEvent} e
     */
    this._onNavClick = (e) => {
      // Dots handle their own click (mouse click gives the right index and
      // keyboard activation keeps working). Only delegate clicks that land
      // outside a dot — i.e. in the inter-tick gaps or rail padding — so the
      // user doesn't have to hit the thin tick precisely.
      if (e.target instanceof Element && e.target.closest(".conv-nav-dot")) return;
      const idx = this.#indexFromClientY(e.clientY);
      if (idx < 0) return;
      const turn = this.#turns[idx];
      if (!turn) return;
      this.#jumpTo(turn, idx);
    };

    /**
     * @param {MouseEvent} e
     */
    this._onDocumentClick = (e) => {
      if (
        this.#isTooltipTarget(e.target) ||
        (e.target instanceof Node && trackEl.contains(e.target))
      ) {
        return;
      }
      this.#hoveredIdx = -1;
      this.#clearWave();
      this.#hideTooltip(true);
    };

    trackEl.addEventListener("mouseenter", this._onTrackPointer);
    trackEl.addEventListener("mousemove", this._onTrackPointer);
    trackEl.addEventListener("mouseleave", this._onTrackLeave);
    navEl.addEventListener("click", this._onNavClick);
    document.addEventListener("click", this._onDocumentClick);

    this._onScroll = () => {
      const threshold = 150;
      const el = this.#messagesEl;
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
      this.#isScrolledUp = !atBottom;
      if (atBottom) this.#badgeEl?.classList.add("hidden");
      this.#buildDots();
    };

    this._onResize = () => this.#buildDots();

    this._observer = new MutationObserver(() => this.#buildDots());
    this._observer.observe(messagesEl, { childList: true });

    messagesEl.addEventListener("scroll", this._onScroll);
    window.addEventListener("resize", this._onResize);

    this.#buildDots();
  }

  destroy() {
    const onScroll = this._onScroll;
    const onResize = this._onResize;
    const onTrackPointer = this._onTrackPointer;
    const onTrackLeave = this._onTrackLeave;
    const onNavClick = this._onNavClick;
    const onDocumentClick = this._onDocumentClick;
    if (onScroll) this.#messagesEl.removeEventListener("scroll", onScroll);
    if (onResize) window.removeEventListener("resize", onResize);
    if (onTrackPointer) {
      this.#trackEl?.removeEventListener("mouseenter", onTrackPointer);
      this.#trackEl?.removeEventListener("mousemove", onTrackPointer);
    }
    if (onTrackLeave) this.#trackEl?.removeEventListener("mouseleave", onTrackLeave);
    if (onNavClick) this.#navEl?.removeEventListener("click", onNavClick);
    if (onDocumentClick) document.removeEventListener("click", onDocumentClick);
    this._observer?.disconnect();
    window.clearTimeout(this.#tooltipHideTimer);
    window.clearTimeout(this.#navLockTimer);
  }

  /**
   * Call explicitly after renderHistory() finishes so the nav is always
   * up-to-date even if MutationObserver batching skipped a frame.
   */
  rebuild() {
    this.#buildDots();
  }

  /** Call after a new assistant message finishes rendering. */
  notifyNewMessage() {
    if (this.#isScrolledUp) {
      this.#badgeEl?.classList.remove("hidden");
    }
    this.#buildDots();
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  /** Collect all (user, assistant?) turn pairs from the messages container. */
  #getConversations() {
    /** @type {ConvNavTurn[]} */
    const turns = [];
    for (const node of this.#messagesEl.children) {
      if (!(node instanceof HTMLElement)) continue;
      if (node.classList.contains("message") && node.classList.contains("user")) {
        // Find the very next sibling that is an assistant message
        let sibling = node.nextElementSibling;
        while (sibling && !sibling.classList.contains("message")) {
          sibling = sibling.nextElementSibling;
        }
        const reply =
          sibling instanceof HTMLElement && sibling.classList.contains("assistant")
            ? sibling
            : null;
        turns.push({ user: node, assistant: reply });
      }
    }
    return turns;
  }

  /**
   * @param {ConvNavTurn[]} turns
   */
  #getActiveIndex(turns) {
    if (this.#navLockedIdx >= 0 && this.#navLockedIdx < turns.length) return this.#navLockedIdx;
    const visibleTop = Math.max(
      this.#messagesEl.getBoundingClientRect().top,
      this.#headerEl?.getBoundingClientRect().bottom || 0,
    );
    for (let i = turns.length - 1; i >= 0; i--) {
      if (turns[i].user.getBoundingClientRect().top <= visibleTop + 4) return i;
    }
    return 0;
  }

  #buildDots() {
    const navEl = this.#navEl;
    const trackEl = this.#trackEl;
    if (!navEl || !trackEl) return;

    const turns = this.#getConversations();
    this.#turns = turns;
    const hasConvs = turns.length > 1;
    navEl.classList.toggle("hidden", !hasConvs);
    if (!hasConvs) {
      trackEl.replaceChildren();
      this.#hoveredIdx = -1;
      this.#hideTooltip(true);
      return;
    }

    const activeIdx = this.#getActiveIndex(turns);

    // Add missing dots
    while (trackEl.children.length < turns.length) {
      const dot = document.createElement("button");
      dot.type = "button";
      dot.className = "conv-nav-dot";
      dot.setAttribute("aria-label", `Jump to conversation ${trackEl.children.length + 1}`);
      trackEl.appendChild(dot);
    }
    // Remove extra dots
    while (trackEl.children.length > turns.length) {
      const last = trackEl.lastChild;
      if (!last) break;
      trackEl.removeChild(last);
    }

    [...trackEl.children].forEach((dot, i) => {
      if (!(dot instanceof HTMLElement)) return;
      dot.onclick = () => this.#jumpTo(this.#turns[i], i);
      dot.classList.toggle("active", i === activeIdx);
      dot.setAttribute("aria-label", `Jump to conversation ${i + 1}`);
      dot.style.removeProperty("top");
      if (this.#hoveredIdx < 0) {
        // No wave when not hovering — keep all dots at their base CSS width
        dot.style.removeProperty("--nav-w");
      }
    });

    if (this.#hoveredIdx >= this.#turns.length) this.#hoveredIdx = this.#turns.length - 1;
    if (this.#hoveredIdx >= 0) {
      this.#applyWave(this.#hoveredIdx);
      const hoveredDot = trackEl.children[this.#hoveredIdx];
      const hoveredTurn = this.#turns[this.#hoveredIdx];
      if (hoveredDot instanceof HTMLElement && hoveredTurn) {
        this.#showTooltip(hoveredDot, hoveredTurn);
      }
    }

    // Scale down if the track exceeds the max nav height
    const naturalHeight = trackEl.scrollHeight;
    const scale = naturalHeight > ConvNav.#MAX_HEIGHT ? ConvNav.#MAX_HEIGHT / naturalHeight : 1;
    trackEl.style.transform = scale < 1 ? `scale(${scale})` : "";
    trackEl.style.transformOrigin = scale < 1 ? "top left" : "";
    navEl.style.height = scale < 1 ? `${naturalHeight * scale}px` : "";
  }

  /** Apply gaussian-bell width wave centered on the hovered dot index. */
  /**
   * @param {number} centerIdx
   */
  #applyWave(centerIdx) {
    const trackEl = this.#trackEl;
    if (!trackEl) return;
    [...trackEl.children].forEach((dot, i) => {
      if (!(dot instanceof HTMLElement)) return;
      const dist = Math.abs(i - centerIdx);
      // Gaussian bell: peak 20 px, base 10 px, σ=3
      const w = Math.round(10 + 10 * Math.exp(-(dist * dist) / (2 * 3 * 3)));
      dot.style.setProperty("--nav-w", `${w}px`);
    });
  }

  /** Remove per-dot wave widths, letting CSS default take over. */
  #clearWave() {
    const trackEl = this.#trackEl;
    if (!trackEl) return;
    for (const dot of trackEl.children) {
      if (dot instanceof HTMLElement) dot.style.removeProperty("--nav-w");
    }
  }

  /**
   * @param {ConvNavTurn} turn
   * @param {number} [idx]
   */
  #jumpTo(turn, idx) {
    if (idx !== undefined) {
      this.#navLockedIdx = idx;
      window.clearTimeout(this.#navLockTimer);
      this.#navLockTimer = window.setTimeout(() => {
        this.#navLockedIdx = -1;
        this.#buildDots();
      }, 800);
    }
    const visibleTop =
      this.#headerEl?.getBoundingClientRect().bottom ||
      this.#messagesEl.getBoundingClientRect().top;
    const delta = turn.user.getBoundingClientRect().top - visibleTop;
    const maxScrollTop = this.#messagesEl.scrollHeight - this.#messagesEl.clientHeight;
    const targetScrollTop = Math.max(0, Math.min(this.#messagesEl.scrollTop + delta, maxScrollTop));
    this.#messagesEl.scrollTo({ top: targetScrollTop, behavior: "smooth" });
    const entryId = turn.user?.dataset.entryId;
    if (entryId) this.#onJumpToEntry?.(entryId);
    this.#flashHighlight(turn.user);
    this.#buildDots();
  }

  /**
   * @param {HTMLElement} target
   */
  #flashHighlight(target) {
    target.classList.remove("message-jump-highlight");
    void target.offsetWidth; // reflow to replay animation
    target.classList.add("message-jump-highlight");
    target.addEventListener(
      "animationend",
      () => target.classList.remove("message-jump-highlight"),
      {
        once: true,
      },
    );
  }

  /**
   * @param {EventTarget | null} node
   */
  #isTooltipTarget(node) {
    const tooltipEl = this.#tooltipEl;
    return Boolean(tooltipEl && node instanceof Node && tooltipEl.contains(node));
  }

  /**
   * @param {number} clientY
   */
  #indexFromClientY(clientY) {
    const trackEl = this.#trackEl;
    if (!trackEl) return -1;
    const dots = trackEl.children;
    if (!dots.length) return -1;
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < dots.length; i++) {
      const rect = dots[i].getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      const dist = Math.abs(clientY - mid);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    }
    return best;
  }

  /**
   * @param {MouseEvent} e
   */
  #updateHoverFromPointer(e) {
    const trackEl = this.#trackEl;
    if (!trackEl) return;
    const idx = this.#indexFromClientY(e.clientY);
    if (idx < 0) return;
    if (
      idx === this.#hoveredIdx &&
      this.#tooltipEl &&
      !this.#tooltipEl.classList.contains("hidden")
    ) {
      return;
    }
    const turn = this.#turns[idx];
    const dot = trackEl.children[idx];
    if (!turn || !(dot instanceof HTMLElement)) return;
    this.#hoveredIdx = idx;
    this.#applyWave(idx);
    this.#showTooltip(dot, turn);
  }

  /**
   * @param {HTMLElement} dotEl
   * @param {ConvNavTurn} turn
   */
  #showTooltip(dotEl, turn) {
    const tooltipEl = this.#tooltipEl;
    if (!tooltipEl) return;
    window.clearTimeout(this.#tooltipHideTimer);
    const q = turn.user.textContent.trim().slice(0, 120);
    const a = turn.assistant
      ? turn.assistant.textContent.trim().replace(/\s+/g, " ").slice(0, 180)
      : "";
    if (this.#tooltipQ) this.#tooltipQ.textContent = q;
    if (this.#tooltipA) {
      this.#tooltipA.textContent = a;
      this.#tooltipA.style.display = a ? "" : "none";
    }
    if (this.#tooltipSep) this.#tooltipSep.style.display = a ? "" : "none";

    const wasHidden = tooltipEl.classList.contains("hidden");
    tooltipEl.classList.remove("hidden");
    const dotRect = dotEl.getBoundingClientRect();
    const tipHeight = tooltipEl.offsetHeight || 90;
    const tipWidth = tooltipEl.offsetWidth || 260;
    const top = Math.max(
      8,
      Math.min(
        dotRect.top + dotRect.height / 2 - tipHeight / 2,
        window.innerHeight - tipHeight - 8,
      ),
    );
    tooltipEl.style.top = `${top}px`;
    // Anchor the tooltip to the right of the dot (the rail sits on the
    // chat's left edge), following the dot so panels never cover it.
    tooltipEl.style.left = `${Math.min(dotRect.right + 8, window.innerWidth - tipWidth - 8)}px`;

    // Replay the enter animation only on first show. Updating while already
    // visible (moving along the track) must not fade the tooltip out.
    if (!wasHidden) return;

    tooltipEl.classList.remove("animating");
    void tooltipEl.offsetWidth; // reflow
    tooltipEl.classList.add("animating");
    tooltipEl.addEventListener(
      "animationend",
      () => this.#tooltipEl?.classList.remove("animating"),
      { once: true },
    );
  }

  #hideTooltip(immediate = false) {
    const tooltipEl = this.#tooltipEl;
    if (!tooltipEl) return;
    window.clearTimeout(this.#tooltipHideTimer);
    if (immediate) {
      tooltipEl.classList.add("hidden");
      return;
    }
    this.#tooltipHideTimer = window.setTimeout(() => {
      const tip = this.#tooltipEl;
      if (tip) tip.classList.add("hidden");
    }, 120);
  }
}
