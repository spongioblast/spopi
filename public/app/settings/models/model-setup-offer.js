// ABOUTME: The banner on a provider that offers to run model setup for models just added from a server.
// ABOUTME: Run opens the chosen model with setup running; dismiss forgets the offer until the next add.

import { t } from "../../i18n/i18n.js";
import { enhanceSelect } from "../../ui/select-menu.js";

/**
 * @typedef {import("./provider-editor.js").ModelsViewState} ModelsViewState
 * @typedef {import("./model-draft.js").ModelEntry} ModelsJsonModel
 *
 * @typedef {object} ModelSetupOfferDeps
 * @property {ModelsViewState} view
 * @property {ModelsJsonModel[]} models
 * @property {(providerName: string, index: number, options: { runSetup: boolean }) => void} openModel
 */

/**
 * @param {HTMLElement} main
 * @param {string} providerName
 * @param {ModelSetupOfferDeps} offerDeps
 */
export function renderModelSetupOffer(main, providerName, { view, models, openModel }) {
  const offer = view.offerSetup;
  if (!offer || offer.provider !== providerName) return;
  const ids = offer.modelIds.filter((id) => models.some((model) => model.id === id));
  if (ids.length === 0) return;
  const banner = document.createElement("div");
  banner.className = "models-setup-offer";
  banner.setAttribute("role", "status");
  const text = document.createElement("p");
  text.textContent = t("models.setup.offer", { count: ids.length });
  const actions = document.createElement("div");
  actions.className = "models-setup-offer-actions";
  /** @type {HTMLSelectElement | null} */
  let picker = null;
  if (ids.length > 1) {
    picker = document.createElement("select");
    picker.className = "ui-select models-setup-offer-model";
    picker.setAttribute("aria-label", t("models.setup.pickModel"));
    for (const id of ids) picker.appendChild(new Option(id, id));
    actions.appendChild(picker);
  }
  const run = document.createElement("button");
  run.type = "button";
  run.className = "ui-button ui-button--primary ui-button--sm models-setup-offer-run";
  run.textContent =
    ids.length > 1 ? t("models.setup.button") : t("models.setup.buttonFor", { model: ids[0] });
  run.addEventListener("click", () => {
    const id = picker ? picker.value : ids[0];
    const index = models.findIndex((model) => model.id === id);
    if (index >= 0) openModel(providerName, index, { runSetup: true });
  });
  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.className = "ui-icon-button ui-icon-button--ghost ui-icon-button--sm";
  dismiss.setAttribute("aria-label", t("models.setup.dismiss"));
  dismiss.textContent = "×";
  dismiss.addEventListener("click", () => {
    view.offerSetup = null;
    banner.remove();
  });
  actions.append(run, dismiss);
  banner.append(text, actions);
  main.appendChild(banner);
  const pickerEl = picker;
  if (pickerEl) queueMicrotask(() => pickerEl.isConnected && enhanceSelect(pickerEl));
}
