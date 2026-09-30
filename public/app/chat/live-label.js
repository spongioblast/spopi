// ABOUTME: Names what Pi is doing right now for the live strip: the running tool and its target,
// ABOUTME: or thinking / writing the answer when no tool runs.

/**
 * @typedef {{
 *   transcript?: {
 *     turns?: { endedAt: number | null, work: { steps: { kind: string, name: string, args: unknown, id?: string }[] } }[],
 *     notes?: { kind: string, id?: string, status?: string }[],
 *   },
 * }} LiveState
 * @typedef {(key: string, params?: Record<string, string>) => string} Translate
 */

const FALLBACK = {
  "chat.live.reading": "Reading {target}",
  "chat.live.writing": "Writing {target}",
  "chat.live.editing": "Editing {target}",
  "chat.live.running": "Running {target}",
  "chat.live.tool": "Using {target}",
  "chat.live.thinking": "Thinking",
  "chat.live.answering": "Writing the answer",
  "chat.live.working": "Working",
};

/**
 * @param {LiveState | null | undefined} state
 * @param {string} phase metrics phase: thinking, streaming, toolcall, tool, working, …
 * @param {Translate} [t]
 */
export function liveLabel(state, phase, t) {
  /** @param {keyof typeof FALLBACK} key @param {string} [target] */
  const say = (key, target = "") => {
    const value = t?.(key, { target });
    const text = value && value !== key ? value : FALLBACK[key];
    return text.replace("{target}", target);
  };
  const turns = state?.transcript?.turns || [];
  const open = [...turns].reverse().find((turn) => turn.endedAt == null);
  const step = open?.work.steps.at(-1);
  const note = step?.id
    ? state?.transcript?.notes?.find((entry) => entry.kind === "tool" && entry.id === step.id)
    : null;
  if (step && note?.status !== "done") {
    const target = stepTarget(step);
    if (step.kind === "read") return say("chat.live.reading", target);
    if (step.kind === "write") return say("chat.live.writing", target);
    if (step.kind === "edit") return say("chat.live.editing", target);
    if (step.kind === "bash") return say("chat.live.running", target);
    return say("chat.live.tool", step.name);
  }
  if (phase === "thinking") return say("chat.live.thinking");
  if (phase === "streaming") return say("chat.live.answering");
  return say("chat.live.working");
}

/** @param {{ kind: string, name: string, args: unknown }} step */
function stepTarget(step) {
  const args = step.args && typeof step.args === "object" ? step.args : {};
  if (step.kind === "bash") {
    const command = "command" in args ? String(args.command || "") : "";
    const first = command.split("\n")[0].trim();
    return first.length > 48 ? `${first.slice(0, 47)}…` : first;
  }
  const path = "path" in args ? String(args.path || "") : "";
  return path.split(/[\\/]/).pop() || step.name;
}
