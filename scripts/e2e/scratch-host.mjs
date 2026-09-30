// ABOUTME: Stops a live-host script unless that host runs on a scratch app-data folder.
// ABOUTME: The host reports this as `appDataScratch` in GET /health.

/**
 * @param {string} origin e.g. http://127.0.0.1:57620
 */
export async function requireScratchHost(origin) {
  console.warn(`[spopi-e2e] This script drives the live host at ${origin}.`);
  let body = null;
  try {
    body = await (await fetch(`${origin}/health`)).json();
  } catch {
    // Reported below.
  }
  if (body?.appDataScratch === true) return;
  console.error(
    "[spopi-e2e] Refusing to run: start the host with SPOPI_APP_DATA_DIR set to a scratch folder.",
  );
  process.exit(1);
}
