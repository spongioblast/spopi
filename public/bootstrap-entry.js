// ABOUTME: Chooses the launcher or the session app from the current route.
// ABOUTME: It runs before either module paints.
try {
  performance.mark("spopi:boot-start");
} catch {
  // performance is absent in some non-browser hosts
}

import { parseAppRoute } from "./app/utils/router.js";

// A bare dynamic import() has no error path: if module linking fails (e.g. a
// transient mismatch between cached and fresh files during an app update),
// the rejection goes unhandled and the app is left on a blank screen with
// nothing but a console error. Reload once to pick up a consistent set of
// files; a second failure means it's a real bug, so we stop retrying.
const RELOAD_GUARD_KEY = "spopi:bootstrap-reload-attempted";
const route = parseAppRoute(window.location.pathname);

if (route.name === "launcher" || route.name === "settings" || route.name === "not_found") {
  window.location.replace("/app");
} else {
  const entry = route.name === "app_launcher" ? "./app/shell/app-launcher.js" : "./app/app.js";
  import(entry)
    .then(() => sessionStorage.removeItem(RELOAD_GUARD_KEY))
    .catch((error) => {
      console.error(`[bootstrap] failed to load ${entry}`, error);
      if (sessionStorage.getItem(RELOAD_GUARD_KEY)) return;
      sessionStorage.setItem(RELOAD_GUARD_KEY, "1");
      location.reload();
    });
}
