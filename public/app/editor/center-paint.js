// ABOUTME: Paints the center as Home, Work, Editor, Review, or a subagent's transcript.
// ABOUTME: Empty home columns are omitted so a heading never sits over blank space.

import { t } from "../i18n/i18n.js";
import { missingWorkspace, setMissingPainter } from "../session/missing-workspace.js";
import { requestLocateFolder } from "../session/workspace-actions.js";
import { headerChromeRefs } from "../shell/chrome/chat.js";
import { composerChromeRefs } from "../shell/chrome/composer.js";
import { filePreviewRefs } from "../shell/chrome/file-preview.js";
import { paintBreadcrumb } from "../shell/header-breadcrumb.js";
import {
  ensureSubagentHost,
  paintSubagent,
  subagentPaneElement,
} from "../subagents/subagent-view.js";
import { centerReviewOpen, centerSubagentOpen, chooseCenterMode } from "./center-mode.js";
import { homePaneElement } from "./home-pane.js";
import { ensureReviewHosts, paintReview, reviewPaneElement } from "./review-pane.js";

/** @typedef {{ status?: { phase?: string }, session?: { title?: string }, plan?: { lines?: string[] } | null, transcript?: { turns?: { files?: { path?: string }[] }[] } } | null | undefined} CenterState */

/** @type {CenterState} */
let lastState = null;

document.addEventListener("spopi-center-repaint", () => paintAdaptiveCenter(lastState));

/**
 * @param {CenterState} state
 */
export function paintAdaptiveCenter(state) {
  lastState = state;
  const preview = filePreviewRefs().panel;
  const fileOpen = Boolean(preview && !preview.classList.contains("collapsed"));
  const phase = state?.status?.phase;
  const running = phase === "working" || phase === "retrying";
  const mode = chooseCenterMode({
    fileOpen,
    running,
    review: centerReviewOpen(),
    subagent: centerSubagentOpen(),
  });
  document.body.dataset.centerMode = mode;
  ensureReviewHosts(preview?.parentElement);
  ensureSubagentHost(preview?.parentElement);
  const review = reviewPaneElement();
  if (review instanceof HTMLElement) review.classList.toggle("is-visible", mode === "review");
  if (mode === "review") paintReview();
  const subagent = subagentPaneElement();
  if (subagent instanceof HTMLElement) subagent.classList.toggle("is-visible", mode === "subagent");
  if (mode === "subagent") paintSubagent();
  const home = homePaneElement();
  if (home instanceof HTMLElement) {
    home.classList.toggle("is-visible", mode === "home" || mode === "work");
    home.dataset.mode = mode;
    if (mode === "home") paintHome(home);
    if (mode === "work") paintWork(home, state);
  }
  const header = headerChromeRefs();
  paintBreadcrumb({
    project: textOf(header.workspaceIndicator),
    branch: textOf(header.gitBranch),
    session: state?.session?.title || "",
    working: running,
  });
}

/** @param {HTMLElement} home */
function paintHome(home) {
  if (missingWorkspace()) {
    paintMissing(home);
    return;
  }
  const models = column("home.models", localModelsUp);
  models?.classList.add("spopi-home-models");
  home.replaceChildren(actionRow(), ...(models ? [models] : []));
  void probeLocalModels(home);
}

// Default ports. The probe reads the response, so a server must allow the app
// origin: vLLM and Ollama do by default, LM Studio only with CORS turned on.
const LOCAL_MODELS = [
  ["vLLM", "http://127.0.0.1:8000/v1/models"],
  ["Ollama", "http://127.0.0.1:11434/v1/models"],
  ["LM Studio", "http://127.0.0.1:1234/v1/models"],
];
const PROBE_INTERVAL_MS = 30_000;

/** @type {string[]} */
let localModelsUp = [];
/** @type {Promise<void> | null} */
let probeInFlight = null;
let probedAt = 0;

/**
 * Home repaints on every store update, so the probe is shared and throttled;
 * each paint renders the last result instead of starting its own fetches.
 * @param {HTMLElement} home
 */
async function probeLocalModels(home) {
  if (probeInFlight || Date.now() - probedAt < PROBE_INTERVAL_MS) return;
  probeInFlight = (async () => {
    /** @type {string[]} */
    const up = [];
    await Promise.all(
      LOCAL_MODELS.map(async ([name, url]) => {
        try {
          const response = await fetch(url, { signal: AbortSignal.timeout(400) });
          if (response.ok) up.push(name);
        } catch {
          // A closed port is a down model, not an error in the pane.
        }
      }),
    );
    const next = LOCAL_MODELS.map(([name]) => name).filter((name) => up.includes(name));
    const changed = next.join() !== localModelsUp.join();
    localModelsUp = next;
    probedAt = Date.now();
    if (changed && home.isConnected && home.dataset.mode === "home") paintHome(home);
  })();
  try {
    await probeInFlight;
  } finally {
    probeInFlight = null;
  }
}

/**
 * @param {HTMLElement} home
 * @param {{ transcript?: { turns?: { files?: { path?: string }[] }[] } } | null | undefined} state
 */
function paintWork(home, state) {
  const turns = state?.transcript?.turns || [];
  const files = turns.length ? turns[turns.length - 1]?.files || [] : [];
  const touched = column("home.touched", files.map((file) => file.path || "").filter(Boolean));
  if (!touched) {
    paintHome(home);
    return;
  }
  home.replaceChildren(touched);
}

/**
 * @param {string} labelKey
 * @param {string[]} rows
 */
function column(labelKey, rows) {
  if (rows.length === 0) return null;
  const col = document.createElement("div");
  col.className = "spopi-home-col";
  const heading = document.createElement("h3");
  heading.dataset.i18n = labelKey;
  heading.textContent = t(labelKey);
  col.append(heading);
  for (const row of rows) {
    const line = document.createElement("p");
    line.className = "change-row";
    line.textContent = row;
    col.append(line);
  }
  return col;
}

function actionRow() {
  const row = document.createElement("div");
  row.className = "spopi-home-actions";
  row.append(
    actionButton("new-session-btn", "home.newSession", false, undefined, "home.newSessionHint"),
    actionButton("open-folder-btn", "home.openFolder", false, undefined, "home.openFolderHint"),
    actionButton("", "home.worktree", false, openWorktree, "home.worktreeHint"),
  );
  return row;
}

/**
 * @param {string} id
 * @param {string} labelKey
 * @param {boolean} [disabled]
 * @param {(() => void) | undefined} [onClick]
 * @param {string} [hintKey]
 */
function actionButton(id, labelKey, disabled = false, onClick, hintKey) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "ui-button ui-button--secondary ui-button--sm spopi-home-action";
  button.dataset.i18n = labelKey;
  button.textContent = t(labelKey);
  if (hintKey) {
    button.dataset.i18nTitle = hintKey;
    button.title = t(hintKey);
  }
  button.disabled = disabled;
  if (onClick) button.addEventListener("click", onClick);
  else if (id) {
    button.addEventListener("click", () => {
      const target = document.getElementById(id);
      if (target && "click" in target) target.click();
    });
  }
  return button;
}

function openWorktree() {
  const input = composerChromeRefs().messageInput;
  if (!(input instanceof HTMLTextAreaElement) && !(input instanceof HTMLInputElement)) return;
  input.value = "/worktree create ";
  input.focus();
}

/** @param {HTMLElement} home */
function paintMissing(home) {
  const record = missingWorkspace();
  const path = record?.path || "";
  const card = document.createElement("section");
  card.className = "workspace-missing";
  card.dataset.path = path;
  const title = document.createElement("h2");
  title.dataset.i18n = "workspace.missing.title";
  title.textContent = t("workspace.missing.title");
  const pathLine = document.createElement("p");
  pathLine.className = "workspace-missing-path";
  pathLine.textContent = path;
  const body = document.createElement("p");
  body.className = "settings-help";
  body.dataset.i18n = "workspace.missing.body";
  body.textContent = t("workspace.missing.body");
  const actions = document.createElement("div");
  actions.className = "spopi-home-actions";
  const remove = actionButton("", "workspace.missing.remove", false, () => {
    Promise.resolve(record?.onRemove?.()).catch((error) => record?.onError?.(error));
  });
  remove.classList.remove("ui-button--secondary");
  remove.classList.add("ui-button--danger");
  const locate = actionButton("", "workspace.missing.locate", false, () => {
    void requestLocateFolder(path, (error) => record?.onError?.(error));
  });
  actions.append(remove, locate);
  card.append(title, pathLine, body, actions);
  home.replaceChildren(card);
  home.classList.add("is-visible");
}

setMissingPainter(() => {
  const home = homePaneElement();
  if (home instanceof HTMLElement) paintHome(home);
});

/** @param {Element | null | undefined} node */
function textOf(node) {
  return node?.textContent?.trim() || "";
}
