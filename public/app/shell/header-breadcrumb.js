// ABOUTME: Paints project, branch, and session title in the header.
// ABOUTME: A status dot follows whether a turn is running.

/**
 * @param {{ project?: string, branch?: string, session?: string, working?: boolean }} parts
 */
export function paintBreadcrumb({ project = "", branch = "", session = "", working = false } = {}) {
  const header = document.querySelector(".header");
  if (!header) return;
  let crumb = header.querySelector("#header-breadcrumb");
  if (!crumb) {
    crumb = document.createElement("p");
    crumb.id = "header-breadcrumb";
    crumb.className = "header-breadcrumb";
    header.prepend(crumb);
  }
  const text = [project, branch, session].map((part) => part.trim()).filter(Boolean);
  const row = /** @type {HTMLElement} */ (crumb);
  row.textContent = text.join(" / ");
  row.classList.toggle("hidden", text.length === 0);
  row.dataset.status = working ? "working" : "idle";
}
