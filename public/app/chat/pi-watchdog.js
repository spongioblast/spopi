// ABOUTME: Notices a Pi that stopped answering during a turn: quiet for a while, then a get_state ping with no reply.
// ABOUTME: A long tool or a slow model still answers the ping; only a blocked or dead Pi does not.

const QUIET_MS = 45_000;
const PING_MS = 10_000;
const TICK_MS = 15_000;

/**
 * @param {{
 *   ping: () => Promise<unknown>,
 *   isWorking: () => boolean,
 *   onHung: (quietMs: number) => void,
 *   onAlive: () => void,
 *   now?: () => number,
 *   every?: (fn: () => void, ms: number) => unknown,
 *   quietMs?: number,
 *   pingMs?: number,
 * }} deps
 */
export function createPiWatchdog({
  ping,
  isWorking,
  onHung,
  onAlive,
  now = Date.now,
  every = (fn, ms) => setInterval(fn, ms),
  quietMs = QUIET_MS,
  pingMs = PING_MS,
}) {
  let lastEventAt = now();
  let snoozedUntil = 0;
  let hung = false;
  let checking = false;

  const alive = () => {
    if (!hung) return;
    hung = false;
    onAlive();
  };

  const answers = () =>
    new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), pingMs);
      ping().then(
        () => {
          clearTimeout(timer);
          resolve(true);
        },
        () => {
          clearTimeout(timer);
          resolve(false);
        },
      );
    });

  async function check() {
    if (!isWorking()) {
      lastEventAt = now();
      alive();
      return;
    }
    const quiet = now() - lastEventAt;
    if (checking || quiet < quietMs || now() < snoozedUntil) return;
    checking = true;
    try {
      if (await answers()) {
        lastEventAt = now();
        alive();
      } else if (!hung) {
        hung = true;
        onHung(now() - lastEventAt);
      }
    } finally {
      checking = false;
    }
  }

  every(() => void check(), TICK_MS);

  return {
    check,
    noteEvent() {
      lastEventAt = now();
      alive();
    },
    /** @param {number} ms */
    snooze(ms) {
      snoozedUntil = now() + ms;
      alive();
    },
  };
}
