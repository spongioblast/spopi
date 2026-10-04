// ABOUTME: Browses community packages and starts an install from a chosen source.
// ABOUTME: The catalog fetch and the install both run on the host.

import { onLocaleChange, t } from "../i18n/i18n.js";
import { extensionsSettingsRefs } from "../settings/extensions-settings.js";
import { escapeHtml } from "../ui/sanitize-markup.js";
import { enhanceSelect } from "../ui/select-menu.js";
import { settingsState } from "../ui/settings-states.js";
import { getPackageInstallFailure } from "./install-status.js";

// Community package browser for the Settings → Extensions tab.
//
// The package catalog is loaded with browse_pi_packages. The webview CSP does
// not allow the registry, so this page never fetches it directly. Install and
// uninstall still run the embedded `pi` CLI on the host.

const BROWSE_PAGE_SIZE = 50;

/** @type {Readonly<Record<"npm" | "github" | "link", string>>} */
const BROWSE_LINK_SVGS = {
  npm: '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M0 0v24h24v-24h-24zm19.2 19.2h-2.4v-9.6h-4.8v9.6h-7.2v-14.4h14.4v14.4z"/></svg>',
  github:
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>',
  link: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
};

/**
 * @typedef {{
 *   name: string,
 *   description?: string,
 *   author?: string,
 *   types?: string[],
 *   downloads?: number,
 *   updatedAt?: string | number,
 *   updated?: string | number,
 *   modified?: string | number,
 *   date?: string | number,
 *   time?: string | number,
 *   links?: {
 *     npm?: string,
 *     repository?: string,
 *     homepage?: string,
 *   },
 * }} BrowsePackage
 *
 * @typedef {{
 *   type: string,
 *   title: string,
 *   message: string,
 *   detail?: string,
 * }} BrowseNotifyPayload
 */

/**
 * @param {HTMLButtonElement | null | undefined} button
 * @param {string} label
 * @param {boolean} [loading]
 */
function setExtensionActionButton(button, label, loading = false) {
  if (!button) return;
  button.replaceChildren();
  if (!loading) {
    button.textContent = label;
    return;
  }
  const track = document.createElement("span");
  track.className = "pkg-install-track";
  track.setAttribute("role", "progressbar");
  track.setAttribute("aria-label", label);
  const bar = document.createElement("span");
  bar.className = "pkg-install-bar";
  track.append(bar);
  const text = document.createElement("span");
  text.className = "pkg-install-label";
  text.textContent = label;
  button.append(track, text);
}

/**
 * @param {BrowsePackage} pkg
 */
function browseSourceFor(pkg) {
  return `npm:${pkg.name}`;
}

/**
 * @param {string | null | undefined} url
 * @returns {string | null}
 */
function normalizeRepoUrl(url) {
  if (!url) return null;
  return url
    .replace(/^git\+/, "")
    .replace(/^git:\/\//, "https://")
    .replace(/^git@github\.com:/, "https://github.com/")
    .replace(/\.git$/, "");
}

/**
 * @param {BrowsePackage} pkg
 */
function browseUpdatedTime(pkg) {
  const raw = pkg.updatedAt || pkg.updated || pkg.modified || pkg.date || pkg.time || 0;
  const stamp = typeof raw === "number" ? raw : Date.parse(String(raw));
  return Number.isFinite(stamp) ? stamp : 0;
}

/**
 * @param {unknown} value
 * @returns {value is BrowsePackage}
 */
function isBrowsePackage(value) {
  return Boolean(
    value && typeof value === "object" && "name" in value && typeof value.name === "string",
  );
}

// Wires the Settings → Extensions package browser. `control` is a
// HostControlGateway (or null when host operations are unavailable). Returns
// `{ load }`; call `load()` when the tab is opened to fetch/render the catalog.
/**
 * @typedef {{
 *   openExternal: (url: string) => Promise<unknown>,
 *   listPiPackages: () => Promise<unknown>,
 *   browsePiPackages: () => Promise<unknown>,
 *   removePiPackage: (source: string) => Promise<unknown>,
 *   installPiPackage: (source: string) => Promise<unknown>,
 * }} PackageBrowseHost
 */

/**
 * @param {unknown} control
 * @param {object} [options]
 * @param {((payload: BrowseNotifyPayload) => void) | null | undefined} [options.notify]
 */
export function mountPackageBrowse(control, { notify } = {}) {
  const browse = extensionsSettingsRefs(document);
  const listEl = browse.browseList;
  if (!listEl) return { load() {} };
  const listRoot = listEl;
  const searchEl = browse.browseSearch;
  const pillsEl = browse.browsePills;
  const countEl = browse.browseCount;
  const installedOnlyEl = browse.browseInstalledOnly;
  const sortEl = browse.browseSort;

  /** @type {Element | null} */
  let paginationEl = browse.browsePagination;
  if (!paginationEl && listRoot.parentNode) {
    const created = document.createElement("div");
    created.className = "pkg-browse-pagination";
    created.id = "pkg-browse-pagination";
    created.hidden = true;
    listRoot.parentNode.insertBefore(created, listRoot.nextSibling);
    paginationEl = created;
  }

  const host =
    control && typeof control === "object" ? /** @type {PackageBrowseHost} */ (control) : null;
  const canManage = Boolean(host);
  /** @type {BrowsePackage[] | null} */
  let allPackages = null;
  /** @type {Set<string>} */
  let installedSet = new Set();
  let loaded = false;
  let loading = false;
  let activeType = "all";
  let searchQuery = "";
  let installedOnly = false;
  let sortMode = "downloads";
  /** @type {ReturnType<typeof setTimeout> | 0} */
  let searchTimer = 0;
  let page = 1;

  /**
   * @param {string | null | undefined} url
   */
  function openExternalLink(url) {
    if (!url) return;
    if (host) {
      host.openExternal(url).catch((err) => {
        console.error("[browse] failed to open external link:", err);
      });
    } else {
      window.open(url, "_blank", "noopener");
    }
  }

  /**
   * @param {"npm" | "github" | "link"} kind
   * @param {string} label
   * @param {string} url
   */
  function createLinkButton(kind, label, url) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pkg-browse-link";
    btn.title = label;
    btn.setAttribute("aria-label", label);
    btn.innerHTML = `${BROWSE_LINK_SVGS[kind] || BROWSE_LINK_SVGS.link}<span>${escapeHtml(label)}</span>`;
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      openExternalLink(url);
    });
    return btn;
  }

  /**
   * @param {BrowsePackage} pkg
   */
  function buildLinks(pkg) {
    const links = pkg.links || {};
    const container = document.createElement("div");
    container.className = "pkg-browse-links";

    const npmUrl = links.npm || `https://www.npmjs.com/package/${encodeURIComponent(pkg.name)}`;
    container.appendChild(createLinkButton("npm", "npm", npmUrl));

    const repo = normalizeRepoUrl(links.repository);
    if (repo) {
      const isGithub = /github\.com/i.test(repo);
      container.appendChild(
        createLinkButton(isGithub ? "github" : "link", isGithub ? "GitHub" : "repo", repo),
      );
    }

    const homepage = normalizeRepoUrl(links.homepage);
    if (homepage && homepage !== repo) {
      container.appendChild(createLinkButton("link", "homepage", homepage));
    }
    return container;
  }

  async function fetchCatalog() {
    if (!host || typeof host.browsePiPackages !== "function") {
      throw new Error(t("extensions.failedToLoadPackages"));
    }
    const result = /** @type {any} */ (await host.browsePiPackages());
    const packages = Array.isArray(result) ? result : result?.packages;
    /** @type {BrowsePackage[]} */
    const all = [];
    if (Array.isArray(packages)) {
      for (const entry of packages) {
        if (isBrowsePackage(entry)) all.push(entry);
      }
    }
    return {
      packages: all,
      stale: !Array.isArray(result) && result?.stale === true,
      cachedAt: !Array.isArray(result) ? result?.cachedAt : undefined,
    };
  }

  async function refreshInstalled() {
    if (!host) {
      installedSet = new Set();
      return installedSet;
    }
    try {
      const configured = await host.listPiPackages();
      // listPiPackages now returns package objects; keep just the sources for
      // installed-state matching against the catalog.
      installedSet = new Set(
        (Array.isArray(configured) ? configured : []).map((pkg) => {
          if (typeof pkg === "string") return pkg;
          if (pkg && typeof pkg === "object" && "source" in pkg) {
            const source = pkg.source;
            return typeof source === "string" ? source : String(source ?? "");
          }
          return "";
        }),
      );
    } catch {
      installedSet = new Set();
    }
    return installedSet;
  }

  /**
   * @param {BrowsePackage[]} packages
   */
  function sortPackages(packages) {
    const sorted = packages.slice();
    switch (sortMode) {
      case "name":
        sorted.sort((a, b) =>
          (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base" }),
        );
        break;
      case "updated":
        sorted.sort((a, b) => browseUpdatedTime(b) - browseUpdatedTime(a));
        break;
      default:
        sorted.sort((a, b) => (b.downloads || 0) - (a.downloads || 0));
        break;
    }
    return sorted;
  }

  function filterPackages() {
    if (!allPackages) return [];
    const query = searchQuery.toLowerCase().trim();
    const filtered = allPackages.filter((pkg) => {
      if (installedOnly && !installedSet.has(browseSourceFor(pkg))) return false;
      if (activeType !== "all") {
        if (!Array.isArray(pkg.types) || !pkg.types.includes(activeType)) return false;
      }
      if (query) {
        const inName = pkg.name.toLowerCase().includes(query);
        const inDesc = (pkg.description || "").toLowerCase().includes(query);
        const inAuthor = (pkg.author || "").toLowerCase().includes(query);
        if (!inName && !inDesc && !inAuthor) return false;
      }
      return true;
    });
    return sortPackages(filtered);
  }

  /**
   * @param {BrowsePackage} pkg
   */
  function createRow(pkg) {
    const source = browseSourceFor(pkg);
    const installed = installedSet.has(source);

    const row = document.createElement("div");
    row.className = "settings-extension-row pkg-browse-row";

    const info = document.createElement("div");
    info.className = "settings-extension-info";

    const name = document.createElement("div");
    name.className = "settings-extension-name";
    name.textContent = pkg.name;
    info.appendChild(name);

    if (pkg.description) {
      const description = document.createElement("div");
      description.className = "settings-extension-description";
      description.textContent = pkg.description;
      info.appendChild(description);
    }

    const badges = document.createElement("div");
    badges.className = "pkg-browse-badges";
    for (const type of pkg.types || []) {
      const badge = document.createElement("span");
      badge.className = "ui-badge ui-badge--accent pkg-browse-badge";
      badge.dataset.type = type;
      badge.textContent = type;
      badges.appendChild(badge);
    }
    const downloads = document.createElement("span");
    downloads.className = "pkg-browse-meta";
    downloads.textContent = t("extensions.downloadsPerMonth", {
      count: (pkg.downloads || 0).toLocaleString(),
    });
    badges.appendChild(downloads);
    info.appendChild(badges);

    const status = document.createElement("div");
    status.className = "settings-extension-status";
    status.hidden = true;
    info.appendChild(status);

    info.appendChild(buildLinks(pkg));

    const actions = document.createElement("div");
    actions.className = "settings-extension-actions";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "settings-value-btn";

    if (!canManage || !host) {
      button.disabled = true;
      setExtensionActionButton(button, t("extensions.desktopOnly"));
    } else {
      const gateway = host;
      setExtensionActionButton(button, installed ? t("actions.uninstall") : t("actions.install"));
      button.addEventListener("click", async () => {
        button.disabled = true;
        button.classList.add("loading");
        const previous = installed ? t("actions.uninstall") : t("actions.install");
        setExtensionActionButton(
          button,
          installed ? t("status.uninstalling") : t("status.installing"),
          true,
        );
        status.hidden = false;
        status.classList.remove("is-error");
        status.textContent = installed ? t("status.removing") : t("status.installing");
        status.title = status.textContent;
        try {
          if (installed) {
            await gateway.removePiPackage(source);
            installedSet.delete(source);
          } else {
            await gateway.installPiPackage(source);
            installedSet.add(source);
          }
          render();
        } catch (err) {
          const operation = installed ? "uninstall" : "install";
          const failure = getPackageInstallFailure(err, operation);
          status.hidden = true;
          status.classList.remove("is-error");
          status.textContent = "";
          status.title = "";
          notify?.({
            type: "error",
            title: failure.title,
            message: failure.note,
            detail: failure.detail,
          });
          button.disabled = false;
          button.classList.remove("loading");
          setExtensionActionButton(button, previous);
        }
      });
    }
    actions.appendChild(button);

    row.appendChild(info);
    row.appendChild(actions);
    return row;
  }

  /**
   * @param {number} totalPages
   */
  function renderPagination(totalPages) {
    const pagination = paginationEl;
    if (!pagination) return;
    if (!("hidden" in pagination)) return;
    if (totalPages <= 1) {
      pagination.hidden = true;
      pagination.innerHTML = "";
      return;
    }
    pagination.hidden = false;
    pagination.innerHTML = "";

    /**
     * @param {number} nextPage
     */
    const goTo = (nextPage) => {
      page = nextPage;
      render();
      listRoot.scrollIntoView({ block: "nearest" });
    };

    /**
     * @param {string} label
     * @param {number} target
     * @param {object} [btnOptions]
     * @param {boolean} [btnOptions.active]
     * @param {boolean} [btnOptions.disabled]
     */
    const addBtn = (label, target, { active = false, disabled = false } = {}) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `pkg-browse-page-btn${active ? " is-active" : ""}`;
      btn.textContent = label;
      btn.disabled = disabled;
      if (!disabled && !active) btn.addEventListener("click", () => goTo(target));
      pagination.appendChild(btn);
    };

    const addEllipsis = () => {
      const span = document.createElement("span");
      span.className = "pkg-browse-page-ellipsis";
      span.textContent = "…";
      pagination.appendChild(span);
    };

    addBtn("‹", page - 1, { disabled: page <= 1 });
    const pages = new Set([1, totalPages, page]);
    for (let d = 1; d <= 2; d++) {
      pages.add(page - d);
      pages.add(page + d);
    }
    const visible = [...pages].filter((p) => p >= 1 && p <= totalPages).sort((a, b) => a - b);
    let prev = 0;
    for (const p of visible) {
      if (p - prev > 1) addEllipsis();
      addBtn(String(p), p, { active: p === page });
      prev = p;
    }
    addBtn("›", page + 1, { disabled: page >= totalPages });
  }

  function render() {
    const results = filterPackages();
    const totalPages = Math.max(1, Math.ceil(results.length / BROWSE_PAGE_SIZE));
    if (page > totalPages) page = totalPages;
    if (page < 1) page = 1;
    const start = (page - 1) * BROWSE_PAGE_SIZE;
    const pageResults = results.slice(start, start + BROWSE_PAGE_SIZE);

    if (countEl) {
      if (results.length === 0) {
        countEl.textContent = t("extensions.browseCountZero", { total: results.length });
      } else {
        countEl.textContent = t("extensions.browseCountRange", {
          start: start + 1,
          end: start + pageResults.length,
          total: results.length,
        });
      }
    }

    listRoot.innerHTML = "";
    if (!results.length) {
      listRoot.replaceChildren(
        settingsState({
          kind: "empty",
          text: t("extensions.noPackagesMatch"),
          className: "settings-api-keys-empty pkg-browse-full-row",
        }),
      );
      renderPagination(totalPages);
      return;
    }
    for (const pkg of pageResults) listRoot.appendChild(createRow(pkg));
    renderPagination(totalPages);
  }

  /**
   * @param {boolean} [force]
   */
  async function load(force = false) {
    if (loading) return;
    if (loaded && !force) {
      render();
      return;
    }
    loading = true;
    listRoot.replaceChildren(
      settingsState({
        kind: "loading",
        text: t("extensions.loadingPackages"),
        className: "settings-api-keys-loading pkg-browse-full-row",
      }),
    );
    try {
      const [catalog] = await Promise.all([fetchCatalog(), refreshInstalled()]);
      allPackages = catalog.packages;
      loaded = true;
      render();
      const note = document.getElementById("pkg-browse-offline");
      if (note) note.remove();
      if (catalog.stale) {
        const when = Number(catalog.cachedAt);
        const date = Number.isFinite(when) && when > 0 ? new Date(when).toLocaleString() : "";
        const banner = document.createElement("div");
        banner.id = "pkg-browse-offline";
        banner.className = "settings-api-keys-empty pkg-browse-full-row";
        banner.textContent = t("extensions.catalogOffline", { date });
        listRoot.prepend(banner);
      }
    } catch (err) {
      const message = String(
        err && typeof err === "object" && "message" in err && err.message != null
          ? err.message
          : err || t("extensions.failedToLoadPackages"),
      );
      listRoot.replaceChildren(
        settingsState({
          kind: "error",
          text: message,
          className: "settings-api-keys-empty pkg-browse-full-row",
          onRetry: () => void load(true),
        }),
      );
    } finally {
      loading = false;
    }
  }

  pillsEl?.addEventListener("click", (event) => {
    const target = event.target;
    if (!target || !("closest" in target) || typeof target.closest !== "function") return;
    const pill = target.closest(".pkg-browse-pill");
    if (!pill || !("dataset" in pill)) return;
    activeType = pill.dataset.pkgType || "all";
    for (const p of pillsEl.querySelectorAll(".pkg-browse-pill")) {
      p.classList.toggle("active", p === pill);
    }
    page = 1;
    render();
  });

  if (searchEl && "value" in searchEl) {
    const searchInput = searchEl;
    searchInput.addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        searchQuery = String(searchInput.value);
        page = 1;
        render();
      }, 180);
    });
  }

  if (installedOnlyEl && "checked" in installedOnlyEl) {
    const installedOnlyInput = installedOnlyEl;
    installedOnlyInput.addEventListener("change", async () => {
      installedOnly = Boolean(installedOnlyInput.checked);
      page = 1;
      if (installedOnly) await refreshInstalled();
      render();
    });
  }

  if (sortEl && "value" in sortEl && "options" in sortEl) {
    const sortSelect = /** @type {HTMLSelectElement} */ (sortEl);
    const sortMenu = enhanceSelect(sortSelect);
    sortSelect.value = sortMode;
    sortMenu?.sync();
    sortSelect.addEventListener("change", () => {
      sortMode = sortSelect.value || "downloads";
      page = 1;
      render();
    });
  }

  onLocaleChange(() => {
    if (loaded) render();
  });

  return { load };
}
