// ABOUTME: The interface language select in Settings → General: builds it and switches the locale.
// ABOUTME: Options come from LANGUAGES; changing one calls setLocale and the list re-renders on locale change.

import { getLanguagePreference, LANGUAGES, onLocaleChange, setLocale, t } from "../i18n/i18n.js";
import { enhanceSelect } from "../ui/select-menu.js";
import { select } from "../ui/settings-controls.js";

export function languageSelectControl() {
  const languageSelect = select({
    id: "settings-language-select",
    label: "Language",
    className: "ui-select settings-language-select",
  });
  languageSelect.dataset.i18nAriaLabel = "settings.language.title";
  return languageSelect;
}

/**
 * @param {ParentNode} root
 * @param {{
 *   onChange?: (() => void) | null,
 * }} [options]
 */
export function mountLanguageSelector(root, { onChange } = {}) {
  const languageSelect = /** @type {HTMLSelectElement | null} */ (
    root?.querySelector("#settings-language-select") ?? null
  );
  if (!languageSelect) return null;
  const selectEl = languageSelect;
  const menu = enhanceSelect(selectEl);
  function render() {
    const current = getLanguagePreference();
    selectEl.replaceChildren();
    for (const language of LANGUAGES) {
      const option = document.createElement("option");
      option.value = language.value;
      const item = /** @type {{ nativeLabel?: string, labelKey?: string }} */ (language);
      option.textContent = item.nativeLabel || t(item.labelKey || language.value);
      option.selected = current === language.value;
      selectEl.append(option);
    }
  }
  async function handleChange() {
    selectEl.disabled = true;
    try {
      await setLocale(selectEl.value);
      render();
      onChange?.();
    } finally {
      selectEl.disabled = false;
    }
  }
  selectEl.addEventListener("change", handleChange);
  render();
  const unsubscribe = onLocaleChange(render);
  return {
    render,
    destroy() {
      unsubscribe();
      menu?.destroy();
    },
  };
}
