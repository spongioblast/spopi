// ABOUTME: Pairing screen shown at /pair before a phone has a device cookie.
// ABOUTME: The desktop approves the claim. The token stays in the cookie.

import { t } from "../i18n/i18n.js";

/**
 * @param {HTMLElement} root
 */
export function mountPairScreen(root) {
  const name = document.createElement("input");
  name.value = "Phone";
  name.setAttribute("aria-label", t("pair.name"));
  const status = document.createElement("p");
  status.textContent = t("pair.approve");
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = t("pair.title");
  button.addEventListener("click", () => {
    void claim(name.value, status);
  });
  const hint = document.createElement("p");
  hint.textContent = t("pair.home");
  root.replaceChildren(name, button, status, hint);
  const storage = navigator.storage;
  if (storage && typeof storage.persist === "function") void storage.persist();
  return {
    destroy() {
      root.replaceChildren();
    },
  };
}

/**
 * @param {string} deviceName
 * @param {HTMLElement} status
 * @param {(url: string) => void} [navigate]
 */
export async function claim(deviceName, status, navigate = (url) => location.assign(url)) {
  const opened = await post("/pair/claim", { name: deviceName });
  const claimId = typeof opened.claimId === "string" ? opened.claimId : "";
  if (!claimId) {
    status.textContent = opened.error ? String(opened.error) : t("pair.approve");
    return;
  }
  status.textContent = t("pair.approve");
  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    const result = await get(`/pair/claim/${encodeURIComponent(claimId)}`);
    if (result.ok) {
      navigate("/");
      return;
    }
    if (result.denied) {
      status.textContent = t("pair.denied");
      return;
    }
    if (result.error) {
      status.textContent = String(result.error);
      return;
    }
  }
  status.textContent = t("pair.denied");
}

/** @param {string} url */
async function get(url) {
  const response = await fetch(url, { credentials: "include" });
  return response.json();
}

/** @param {string} url @param {object} body */
async function post(url, body) {
  const response = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return response.json();
}
