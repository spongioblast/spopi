// ABOUTME: Tracks whether the active session is idle, working, or showing an error.
// ABOUTME: Extension setStatus keys are painted by the dock status footer.

/**
 * Header connection/run status.
 *
 * Kept out of `app.js` because that module has top-level `await`s. Runtime
 * status hooks (and locale changes) can fire while `app.js` is paused, and a
 * `let statusKind` in that module would still be in the TDZ.
 */
/**
 * @typedef {{
 *   statusText?: HTMLElement | null,
 *   statusIndicator?: HTMLElement | null,
 *   composerCard?: HTMLElement | null,
 *   abortButton?: HTMLElement | null,
 *   sendButton?: HTMLElement | null,
 *   hasPending?: (sessionId: string | null | undefined) => boolean,
 *   getSessionId?: () => string | null | undefined,
 * }} SessionStatusUi
 */

/**
 * @param {object} options
 * @param {(key: string) => string} options.t
 */
export function createSessionStatus({ t }) {
  /** @type {{ kind: string, customText: string }} */
  const state = {
    kind: "connecting",
    customText: "",
  };
  /** @type {SessionStatusUi | null} */
  let ui = null;

  function statusLabel() {
    switch (state.kind) {
      case "working":
        return state.customText || t("status.working");
      case "disconnected":
        return t("status.disconnected");
      case "loading":
        return t("status.loading");
      case "connecting":
        return t("status.connecting");
      case "custom":
        return state.customText;
      case "waiting":
        return t("status.waitingForYou");
      default:
        return t("status.connected");
    }
  }

  function renderStatus() {
    if (!ui?.statusText) return;
    const working = state.kind === "working";
    const waiting = state.kind === "waiting";
    const disconnected = state.kind === "disconnected";
    ui.statusText.textContent = statusLabel();
    const showAbort = working || Boolean(ui.hasPending?.(ui.getSessionId?.()));
    ui.statusIndicator?.classList.toggle("streaming", working && !waiting);
    ui.composerCard?.classList.toggle("streaming", working);
    ui.abortButton?.classList.toggle("hidden", !showAbort);
    ui.sendButton?.classList.toggle("hidden", showAbort);
    ui.statusIndicator?.classList.toggle("disconnected", disconnected);
    ui.statusIndicator?.classList.toggle("connected", !working && !disconnected);
  }

  /** @type {{ kind: string, customText: string } | null} */
  let beforeWaiting = null;

  /**
   * @param {boolean} active
   */
  function setWaiting(active) {
    if (active) {
      if (state.kind !== "waiting") beforeWaiting = { ...state };
      state.kind = "waiting";
      state.customText = "";
    } else if (state.kind === "waiting") {
      state.kind = beforeWaiting?.kind || "connected";
      state.customText = beforeWaiting?.customText || "";
      beforeWaiting = null;
    }
    renderStatus();
  }

  function isWaiting() {
    return state.kind === "waiting";
  }

  /**
   * @param {string} kind
   * @param {string} [customText]
   */
  function setStatus(kind, customText = "") {
    state.kind = kind;
    state.customText = customText;
    renderStatus();
  }

  /**
   * @param {SessionStatusUi} nextUi
   */
  function bind(nextUi) {
    ui = nextUi;
    renderStatus();
  }

  return {
    bind,
    getKind: () => state.kind,
    renderStatus,
    setStatus,
    setWaiting,
    isWaiting,
  };
}
