// ABOUTME: Shows one dependency install while it runs, then Retry or Copy log.
// ABOUTME: Polls status once a second and stops when the row is destroyed.

import { copyText } from "../../ui/clipboard.js";
import { el } from "../../ui/dom.js";
import { actionButton } from "./dependency-row.js";

/**
 * @param {HTMLElement} host
 * @param {{
 *   control: {
 *     startDependencyInstall: (kind: string) => Promise<unknown>,
 *     dependencyInstallStatus: (kind: string) => Promise<{ state?: string, lines?: string[] } | null>,
 *     cancelDependencyInstall: (kind: string) => Promise<unknown>,
 *   },
 *   kind: string,
 *   onDone?: (job: { state?: string, lines?: string[] }) => void,
 *   autostart?: boolean,
 * }} options
 */
export function mountInstallJob(host, { control, kind, onDone, autostart = false }) {
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  let stopped = false;
  const box = /** @type {HTMLElement} */ (el("div", { class: "dependencies-job" }));
  host.replaceChildren(box);

  function stop() {
    stopped = true;
    clearTimeout(timer);
  }

  /**
   * @param {{ state?: string, lines?: string[] } | null | undefined} job
   */
  function paint(job) {
    const lines = Array.isArray(job?.lines) ? job.lines.slice(-6) : [];
    const nodes = lines.map((line) => el("p", { class: "dependencies-job-line", text: line }));
    if (!job || job.state === "running") {
      nodes.push(
        actionButton("settings.dependencies.cancel", {
          onClick: () => {
            void control.cancelDependencyInstall(kind);
          },
        }),
      );
      box.replaceChildren(...nodes);
      return;
    }
    if (job.state !== "succeeded") {
      nodes.push(
        actionButton("settings.dependencies.retry", {
          onClick: () => {
            void control.startDependencyInstall(kind).then(() => poll());
          },
        }),
        actionButton("settings.dependencies.copyLog", {
          onClick: () => {
            void copyText((job.lines || []).join("\n"));
          },
        }),
      );
    }
    box.replaceChildren(...nodes);
  }

  async function poll() {
    if (stopped) return;
    const job = await control.dependencyInstallStatus(kind);
    if (stopped) return;
    paint(job);
    if (!job || job.state === "running") {
      timer = setTimeout(() => {
        void poll();
      }, 1000);
      return;
    }
    onDone?.(job);
  }

  void (async () => {
    if (autostart) await control.startDependencyInstall(kind);
    await poll();
  })();

  return { destroy: stop };
}
