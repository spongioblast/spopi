// ABOUTME: Coordinates user-requested context compaction across independent UI entry points.
// ABOUTME: Distinguishes request acknowledgement from Pi's actual lifecycle completion event.

/**
 * @param {{
 *   send: () => unknown | Promise<unknown>,
 *   onState?: (state: string) => void,
 * }} options
 */
export function createCompactCoordinator({ send, onState = () => {} }) {
  let state = "idle";

  /** @param {string} nextState */
  function setState(nextState) {
    state = nextState;
    onState(state);
  }

  return {
    get state() {
      return state;
    },
    get busy() {
      return state === "requested" || state === "running";
    },
    request() {
      if (state !== "idle") return Promise.resolve(false);
      setState("requested");
      return Promise.resolve(send())
        .then((response) => {
          const result = /** @type {{ success?: boolean } | null | undefined} */ (response);
          if (result?.success === false) {
            setState("idle");
            return false;
          }
          return true;
        })
        .catch(() => {
          setState("idle");
          return false;
        });
    },
    started() {
      if (state === "idle" || state === "requested") setState("running");
    },
    /** @param {{ success?: boolean, error?: unknown }} [result] */
    ended({ success, error } = {}) {
      if (state === "idle") return false;
      setState("idle");
      return success !== false && !error;
    },
    reset() {
      if (state !== "idle") setState("idle");
    },
  };
}
