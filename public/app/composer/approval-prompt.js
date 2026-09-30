// ABOUTME: Reads a permission prompt's "label : value" fact lines into a headline, a subject,
// ABOUTME: and the remaining facts, and gives each Pi option a role for the approval card.

/**
 * @typedef {{ label: string, text: string }} PromptFact
 * @typedef {{
 *   kind: "run" | "read" | "write" | "file" | "skill" | "use",
 *   tool: string,
 *   subject: string,
 *   facts: PromptFact[],
 * }} PermissionPrompt
 * @typedef {"once" | "session" | "deny" | "reason" | "other"} ChoiceRole
 */

const FACT = /^(\S(?:[^:]*\S)?)\s+:\s(.*)$/;
const SUBJECT_LABELS = ["full command", "command", "runs", "path", "target", "file", "skill"];

/**
 * @param {string} text
 * @returns {PermissionPrompt | null}
 */
export function parsePermissionPrompt(text) {
  const lines = String(text || "").split(/\r?\n/);
  /** @type {PromptFact[]} */
  const facts = [];
  let indent = 0;
  for (const line of lines) {
    const match = line.match(FACT);
    if (match && !line.startsWith(" ")) {
      facts.push({ label: match[1].toLowerCase(), text: match[2] });
      indent = line.indexOf(" : ") + 3;
    } else if (facts.length && line.trim()) {
      const last = facts[facts.length - 1];
      last.text += `\n${line.slice(Math.min(indent, line.length - line.trimStart().length))}`;
    }
  }
  const tool = facts.find((fact) => fact.label === "tool")?.text.split(" ")[0] || "";
  if (!tool && !facts.some((fact) => fact.label === "surface")) return null;
  const surface = facts.find((fact) => fact.label === "surface")?.text || "";
  const subjectFact = SUBJECT_LABELS.map((name) => facts.find((fact) => fact.label === name)).find(
    Boolean,
  );
  const rest = facts.filter((fact) => fact !== subjectFact && fact.label !== "tool");
  return { kind: promptKind(tool, surface), tool, subject: subjectFact?.text || "", facts: rest };
}

/**
 * @param {string} tool
 * @param {string} surface
 * @returns {PermissionPrompt["kind"]}
 */
function promptKind(tool, surface) {
  if (/external_directory_write|external_directory$/.test(surface)) return "write";
  if (/external_directory_read/.test(surface)) return "read";
  if (tool === "bash") return "run";
  if (tool === "skill" || surface === "skill") return "skill";
  if (/^path/.test(surface) || ["read", "write", "edit"].includes(tool)) return "file";
  return "use";
}

/**
 * pi-permission-system options: "Yes", "Yes, allow … for this session", "No", "No, provide reason".
 * @param {string} label
 * @returns {ChoiceRole}
 */
export function choiceRole(label) {
  const text = label.trim();
  if (/^(yes|allow once|allow)$/i.test(text)) return "once";
  if (/^yes,/i.test(text) || /^always/i.test(text)) return "session";
  if (/^(no|deny)$/i.test(text)) return "deny";
  if (/^no,/i.test(text)) return "reason";
  return "other";
}

/**
 * The option text without Pi's "Yes, " prefix, first letter raised.
 * @param {string} label
 */
export function sessionLabel(label) {
  const rest = label.replace(/^yes,\s*/i, "");
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}
