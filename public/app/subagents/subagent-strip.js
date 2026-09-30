// ABOUTME: The row of subagents above the composer, shown only while pi-subagents reports runs.
// ABOUTME: One row per child: state, time, tools, Open (its transcript tab) and Stop.

import { el } from "../ui/dom.js";
import { formatDuration } from "../ui/formatters.js";
import { isLive, openTargets } from "./subagent-feed.js";

/**
 * @typedef {import("./subagent-feed.js").SubagentNode} SubagentNode
 * @typedef {import("./subagent-feed.js").SubagentTarget} SubagentTarget
 */

export class SubagentStrip {
  #element;
  /** @type {SubagentNode[]} */
  #runs = [];
  /** @type {ReturnType<typeof setInterval> | 0} */
  #timer = 0;
  #t;
  #onOpen;
  #onStop;
  #now;

  /**
   * @param {{
   *   container?: Element | null,
   *   t: (key: string, params?: Record<string, unknown>) => string,
   *   onOpen: (target: SubagentTarget) => void,
   *   onStop: (runId: string, childId?: string) => void,
   *   now?: () => number,
   * }} options
   */
  constructor({ container, t, onOpen, onStop, now = Date.now }) {
    this.#t = t;
    this.#onOpen = onOpen;
    this.#onStop = onStop;
    this.#now = now;
    this.#element = el("section", {
      class: "subagent-strip hidden",
      aria: { label: t("subagents.label"), live: "polite" },
    });
    container?.insertBefore(this.#element, container.querySelector("form"));
  }

  /** @param {SubagentNode[]} runs */
  setRuns(runs) {
    this.#runs = runs;
    this.#render();
    const ticking = runs.some((run) => isLive(run.state));
    if (ticking && !this.#timer) this.#timer = setInterval(() => this.#render(), 1000);
    if (!ticking && this.#timer) {
      clearInterval(this.#timer);
      this.#timer = 0;
    }
  }

  clear() {
    this.setRuns([]);
  }

  #render() {
    if (this.#runs.length === 0) {
      this.#element.classList.add("hidden");
      this.#element.replaceChildren();
      return;
    }
    const rows = [];
    for (const run of this.#runs) {
      const targets = openTargets(run);
      for (const target of targets) rows.push(this.#row(run, target, targets.length > 1));
    }
    this.#element.replaceChildren(...rows);
    this.#element.classList.remove("hidden");
  }

  /**
   * @param {SubagentNode} run
   * @param {SubagentTarget} target
   * @param {boolean} partOfMany
   */
  #row(run, target, partOfMany) {
    const node = target.node;
    const live = isLive(node.state);
    const meta = [
      this.#t(`subagents.state.${node.state}`),
      this.#elapsed(node),
      node.toolCount
        ? this.#t(node.toolCount === 1 ? "subagents.tools.one" : "subagents.tools.other", {
            count: node.toolCount,
          })
        : "",
      live && node.currentTool ? node.currentTool : "",
    ].filter(Boolean);
    return el("div", { class: "subagent-row", dataset: { state: node.state } }, [
      el("span", { class: "subagent-dot", aria: { hidden: "true" } }),
      el("span", { class: "subagent-name", text: node.label, title: run.id }),
      el("span", { class: "subagent-meta", text: meta.join(" · ") }),
      el("button", {
        type: "button",
        class: "ui-button ui-button--ghost ui-button--xs subagent-open",
        text: this.#t("subagents.open"),
        onClick: () => this.#onOpen(target),
      }),
      live
        ? el("button", {
            type: "button",
            class: "ui-button ui-button--ghost ui-button--xs subagent-stop",
            text: this.#t("subagents.stop"),
            onClick: () => this.#onStop(run.id, partOfMany ? target.childId : undefined),
          })
        : null,
    ]);
  }

  /** @param {SubagentNode} node */
  #elapsed(node) {
    if (!node.startedAt) return "";
    const end = node.endedAt || (isLive(node.state) ? this.#now() : node.startedAt);
    return formatDuration(Math.max(0, end - node.startedAt));
  }
}
