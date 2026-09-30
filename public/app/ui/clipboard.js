// ABOUTME: Copies text with the async clipboard API.
// ABOUTME: WebView2 and WebKit support navigator.clipboard.writeText. There is no legacy fallback.

/** @param {string} text */
export async function copyText(text) {
  await navigator.clipboard.writeText(String(text ?? ""));
}
