// ABOUTME: Loads heavy vendor scripts the first time a feature needs them.
// ABOUTME: A second call reuses the same promise so the file is fetched once.

/** @type {Map<string, Promise<void>>} */
const scripts = new Map();
/** @type {Map<string, Promise<void>>} */
const styles = new Map();

function browserCanLoadAssets() {
  return !String(globalThis.navigator?.userAgent || "").includes("jsdom");
}

/**
 * @param {string} src
 * @returns {Promise<void>}
 */
export function loadScriptOnce(src) {
  const cached = scripts.get(src);
  if (cached) return cached;
  if (!browserCanLoadAssets()) {
    const rejected = Promise.reject(new Error(`Cannot load ${src}`));
    rejected.catch(() => {});
    scripts.set(src, rejected);
    return rejected;
  }
  /** @type {Promise<void>} */
  const promise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Cannot load ${src}`));
    document.head.append(script);
  });
  scripts.set(src, promise);
  return promise;
}

/**
 * @param {string} href
 * @returns {Promise<void>}
 */
export function loadStyleOnce(href) {
  const cached = styles.get(href);
  if (cached) return cached;
  if (!browserCanLoadAssets()) {
    const rejected = Promise.reject(new Error(`Cannot load ${href}`));
    rejected.catch(() => {});
    styles.set(href, rejected);
    return rejected;
  }
  /** @type {Promise<void>} */
  const promise = new Promise((resolve, reject) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.onload = () => resolve();
    link.onerror = () => reject(new Error(`Cannot load ${href}`));
    document.head.append(link);
  });
  styles.set(href, promise);
  return promise;
}

export function ensureXterm() {
  const scope = /** @type {typeof globalThis & { SpopiXterm?: { Terminal?: unknown } }} */ (
    globalThis
  );
  if (scope.SpopiXterm?.Terminal) return Promise.resolve();
  return Promise.all([loadStyleOnce("vendor/xterm.css"), loadScriptOnce("vendor/xterm.js")]).then(
    () => {
      if (!scope.SpopiXterm?.Terminal) throw new Error("xterm did not load");
    },
  );
}
