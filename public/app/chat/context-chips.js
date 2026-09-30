// ABOUTME: Removable composer chips for Ctrl+L selections. Source stays in the chip, not a second prompt copy.
// ABOUTME: A chip can be removed or sent back into the prompt.

/**
 * @typedef {{ id: string, label: string }} ContextChip
 * @param {HTMLElement | null | undefined} composer
 */
export function mountContextChips(composer) {
  if (!composer) return null;
  /** @type {HTMLElement | null} */
  let row = composer.querySelector(".context-chips");
  if (!row) {
    row = document.createElement("div");
    row.className = "context-chips";
    const textarea = composer.querySelector("textarea");
    if (textarea) composer.insertBefore(row, textarea);
    else composer.prepend(row);
  }
  /** @type {ContextChip[]} */
  const chips = [];
  /** @param {ContextChip} chip */
  const add = (chip) => {
    chips.push(chip);
    render();
  };
  /** @param {string} id */
  const remove = (id) => {
    const index = chips.findIndex((item) => item.id === id);
    if (index >= 0) chips.splice(index, 1);
    render();
  };
  const render = () => {
    row.replaceChildren();
    for (const chip of chips) {
      const el = document.createElement("span");
      el.className = "context-chip";
      el.textContent = chip.label;
      const close = document.createElement("button");
      close.type = "button";
      close.textContent = "×";
      close.addEventListener("click", () => remove(chip.id));
      el.appendChild(close);
      row.appendChild(el);
    }
  };
  return { row, chips, add, remove, render };
}

/**
 * Adds an @-mention at the end of the draft, spaced from the text before it, with the
 * caret after it so the question can follow.
 * @param {HTMLTextAreaElement | HTMLInputElement | null | undefined} input
 * @param {string} mention
 */
export function appendMentionToComposer(input, mention) {
  if (!input) return "";
  const current = input.value || "";
  const gap = current === "" || /\s$/.test(current) ? "" : " ";
  const next = `${current}${gap}${mention} `;
  input.value = next;
  input.setSelectionRange?.(next.length, next.length);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  return next;
}

/**
 * @param {HTMLTextAreaElement | HTMLInputElement | null | undefined} input
 * @param {string} formatted
 */
export function appendSelectionToComposer(input, formatted) {
  if (!input) return "";
  const current = input.value || "";
  const next = current ? `${current}\n\n${formatted}` : formatted;
  input.value = next;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  return next;
}
