// ABOUTME: Settings → Packages renders installed, recommended, browse, and resources.
// ABOUTME: Package modules mount into the hosts this page creates.

import { translateSubtree } from "../i18n/i18n.js";
import { mountBundledExtensions } from "../packages/packages-bundled.js";
import { el } from "../ui/dom.js";
import { sectionTitle } from "../ui/settings-controls.js";

/**
 * @param {string} view
 * @param {string} label
 * @param {string} [i18n]
 * @param {Array<Node | string | false | null | undefined> | null | undefined} [children]
 * @returns {HTMLElement}
 */
function tab(view, label, i18n, children) {
  const button = /** @type {HTMLElement} */ (
    el(
      "button",
      {
        type: "button",
        class: view === "installed" ? "skills-page-tab active" : "skills-page-tab",
        role: "tab",
        "aria-selected": view === "installed" ? "true" : "false",
      },
      children ?? [label],
    )
  );
  button.dataset.extensionsView = view;
  if (!children) button.dataset.i18n = i18n;
  return button;
}

/**
 * @param {string} type
 * @param {string} label
 * @param {string} i18n
 * @param {boolean} active
 * @returns {HTMLElement}
 */
function pill(type, label, i18n, active) {
  const button = /** @type {HTMLElement} */ (
    el("button", {
      type: "button",
      class: active ? "pkg-browse-pill active" : "pkg-browse-pill",
      text: label,
    })
  );
  button.dataset.pkgType = type;
  button.dataset.i18n = i18n;
  return button;
}

/**
 * @param {string} value
 * @param {string} label
 * @param {string} i18n
 * @returns {HTMLElement}
 */
function option(value, label, i18n) {
  const node = /** @type {HTMLElement} */ (el("option", { value, text: label }));
  node.dataset.i18n = i18n;
  return node;
}

/**
 * @param {ParentNode | null | undefined} root
 * @returns {{ refresh: () => void, destroy: () => void }}
 */
export function mountExtensionsSettings(root) {
  if (!root) return { refresh() {}, destroy() {} };
  const heading = /** @type {HTMLElement} */ (el("h3", { text: "Packages" }));
  heading.dataset.i18n = "settings.packages.title";
  const badge = /** @type {HTMLElement} */ (
    el("span", { class: "extensions-tab-badge", id: "extensions-missing-badge" })
  );
  badge.hidden = true;
  const recommendedLabel = /** @type {HTMLElement} */ (el("span", { text: "Recommended" }));
  recommendedLabel.dataset.i18n = "extensions.tabRecommended";
  const search = /** @type {HTMLElement} */ (
    el("input", {
      type: "text",
      id: "pkg-browse-search",
      class: "pkg-browse-search",
      placeholder: "Search packages...",
      autocomplete: "off",
      spellcheck: "false",
    })
  );
  search.dataset.i18nPh = "extensions.searchPackages";
  const sort = /** @type {HTMLElement} */ (
    el(
      "select",
      {
        id: "pkg-browse-sort",
        class: "ui-select ui-select--sm pkg-browse-sort",
        "aria-label": "Sort packages",
      },
      [
        option("downloads", "Most downloads", "extensions.mostDownloads"),
        option("name", "Name (A–Z)", "extensions.nameAZ"),
        option("updated", "Recently updated", "extensions.recentlyUpdated"),
      ],
    )
  );
  sort.dataset.i18nAriaLabel = "extensions.sortPackages";
  const recommendedHost = /** @type {HTMLElement} */ (
    el("div", { id: "extensions-recommended-host" })
  );
  recommendedHost.hidden = true;
  const browseSection = /** @type {HTMLElement} */ (
    el("div", { class: "settings-section", id: "pkg-browse-section" }, [
      el("div", { class: "pkg-browse-section-header" }, [
        sectionTitle("Browse Community Packages", { i18n: "settings.browseCommunityPackages" }),
      ]),
      el("p", {
        class: "settings-help",
        text: "Discover extensions, skills, themes, and prompts from the Pi ecosystem. Install with one click.",
      }),
      el("div", { class: "pkg-browse-filters" }, [
        search,
        el("div", { class: "pkg-browse-pills", id: "pkg-browse-pills" }, [
          pill("all", "All", "extensions.all", true),
          pill("extension", "Extensions", "nav.catalog.extensions", false),
          pill("skill", "Skills", "nav.skills", false),
          pill("theme", "Themes", "extensions.themes", false),
          pill("prompt", "Prompts", "extensions.prompts", false),
        ]),
        el("label", { class: "pkg-browse-installed-toggle" }, [
          el("input", { type: "checkbox", id: "pkg-browse-installed-only" }),
          el("span", { text: "Installed only" }),
        ]),
        sort,
        el("span", { class: "pkg-browse-count", id: "pkg-browse-count" }),
      ]),
      el("div", { class: "settings-extension-list pkg-browse-list", id: "pkg-browse-list" }),
      el("div", { class: "pkg-browse-pagination", id: "pkg-browse-pagination" }),
    ])
  );
  browseSection.hidden = true;
  const help = /** @type {HTMLElement} */ (browseSection.querySelector(".settings-help"));
  help.dataset.i18n = "settings.browseHelp";
  /** @type {HTMLElement} */ (
    browseSection.querySelector(".pkg-browse-installed-toggle span")
  ).dataset.i18n = "extensions.installedOnly";
  /** @type {HTMLElement} */ (browseSection.querySelector("#pkg-browse-pagination")).hidden = true;
  const resources = /** @type {HTMLElement} */ (
    el("div", { class: "settings-section", id: "pkg-resources-section" }, [
      el("div", { id: "settings-resources" }),
      el("section", {
        id: "settings-install-skills",
        class: "skills-install-page hidden",
        "aria-live": "polite",
      }),
    ])
  );
  resources.hidden = true;
  root.replaceChildren(
    el("div", { class: "settings-header" }, [heading]),
    el("div", { class: "settings-body" }, [
      el("div", { class: "skills-page-tabs", id: "extensions-tabs", role: "tablist" }, [
        tab("installed", "Installed", "extensions.tabInstalled"),
        tab("recommended", "Recommended", "extensions.tabRecommended", [recommendedLabel, badge]),
        tab("marketplace", "Browse", "extensions.tabBrowse"),
        tab("resources", "Resources", "settings.resources.title"),
      ]),
      recommendedHost,
      el("div", { class: "settings-section", id: "pkg-manager-section" }, [
        el("div", { id: "pkg-bundled-host" }),
        sectionTitle("Installed Packages", { i18n: "settings.installedPackages" }),
        el("p", {
          class: "settings-help",
          text: "Manage the extension packages configured for this installation: enable, disable, update, or remove.",
        }),
        el("div", { id: "pkg-manager-toolbar", class: "pkg-manager-toolbar" }),
        el("div", { class: "pkg-manager-shell" }, [
          el("div", { class: "pkg-manager-sidebar" }, [
            el("div", { id: "pkg-manager-groups", class: "pkg-manager-groups" }),
          ]),
          el("div", { id: "pkg-manager-detail", class: "pkg-manager-detail" }),
        ]),
      ]),
      browseSection,
      resources,
    ]),
  );
  /** @type {HTMLElement} */ (
    root.querySelector("#pkg-manager-section .settings-help")
  ).dataset.i18n = "settings.installedHelp";
  mountBundledExtensions(root.querySelector("#pkg-bundled-host"));
  translateSubtree(root);
  return {
    refresh() {
      translateSubtree(root);
    },
    destroy() {
      root.replaceChildren();
    },
  };
}

/**
 * Elements this page creates. Callers use the refs instead of looking up ids.
 * @param {ParentNode | null | undefined} root
 * @returns {{
 *   tabs: Element | null,
 *   tabButtons: Element[],
 *   recommendedHost: HTMLElement | null,
 *   missingBadge: Element | null,
 *   managerSection: HTMLElement | null,
 *   managerGroups: Element | null,
 *   managerDetail: Element | null,
 *   managerToolbar: Element | null,
 *   browseSection: HTMLElement | null,
 *   browseSearch: Element | null,
 *   browsePills: Element | null,
 *   browseInstalledOnly: Element | null,
 *   browseSort: Element | null,
 *   browseCount: Element | null,
 *   browseList: Element | null,
 *   browsePagination: Element | null,
 *   resourcesSection: HTMLElement | null,
 *   resources: Element | null,
 *   installSkills: Element | null,
 * }}
 */
export function extensionsSettingsRefs(root) {
  return {
    tabs: root?.querySelector("#extensions-tabs") ?? null,
    tabButtons: root ? [...root.querySelectorAll("#extensions-tabs [data-extensions-view]")] : [],
    recommendedHost: /** @type {HTMLElement | null} */ (
      root?.querySelector("#extensions-recommended-host") ?? null
    ),
    missingBadge: root?.querySelector("#extensions-missing-badge") ?? null,
    managerSection: /** @type {HTMLElement | null} */ (
      root?.querySelector("#pkg-manager-section") ?? null
    ),
    managerGroups: root?.querySelector("#pkg-manager-groups") ?? null,
    managerDetail: root?.querySelector("#pkg-manager-detail") ?? null,
    managerToolbar: root?.querySelector("#pkg-manager-toolbar") ?? null,
    browseSection: /** @type {HTMLElement | null} */ (
      root?.querySelector("#pkg-browse-section") ?? null
    ),
    browseSearch: root?.querySelector("#pkg-browse-search") ?? null,
    browsePills: root?.querySelector("#pkg-browse-pills") ?? null,
    browseInstalledOnly: root?.querySelector("#pkg-browse-installed-only") ?? null,
    browseSort: root?.querySelector("#pkg-browse-sort") ?? null,
    browseCount: root?.querySelector("#pkg-browse-count") ?? null,
    browseList: root?.querySelector("#pkg-browse-list") ?? null,
    browsePagination: root?.querySelector("#pkg-browse-pagination") ?? null,
    resourcesSection: /** @type {HTMLElement | null} */ (
      root?.querySelector("#pkg-resources-section") ?? null
    ),
    resources: root?.querySelector("#settings-resources") ?? null,
    installSkills: root?.querySelector("#settings-install-skills") ?? null,
  };
}
