// ABOUTME: Tests reading pi-permission-system prompt text into the approval card's parts.
// ABOUTME: Uses the fact layout the extension renders: aligned "label : value" lines.
import { describe, expect, it } from "vitest";
import { choiceRole, parsePermissionPrompt, sessionLabel } from "./approval-prompt.js";

describe("parsePermissionPrompt", () => {
  it("reads a bash ask and keeps a multi-line command together", () => {
    const text = [
      "Permission Required",
      "tool         : bash",
      "rule         : *",
      "command      : cd /d/work/todo-app",
      "full command : cd /d/work/todo-app && python - <<'PY'",
      "               print('hi')",
      "               PY",
    ].join("\n");
    const prompt = parsePermissionPrompt(text);
    expect(prompt?.kind).toBe("run");
    expect(prompt?.tool).toBe("bash");
    expect(prompt?.subject).toBe("cd /d/work/todo-app && python - <<'PY'\nprint('hi')\nPY");
    expect(prompt?.facts.map((fact) => fact.label)).toEqual(["rule", "command"]);
  });

  it("names an outside read by its surface", () => {
    const text = [
      "Permission Required",
      "tool    : bash",
      "surface : external_directory_read",
      "rule    : *",
      "path    : D:/work/demo/public",
    ].join("\n");
    const prompt = parsePermissionPrompt(text);
    expect(prompt?.kind).toBe("read");
    expect(prompt?.subject).toBe("D:/work/demo/public");
  });

  it("returns null for a select that is not a permission prompt", () => {
    expect(parsePermissionPrompt("Proposed plan ready\nWhat next?")).toBeNull();
  });
});

describe("choiceRole", () => {
  it("maps Pi's option labels to card roles", () => {
    expect(choiceRole("Yes")).toBe("once");
    expect(choiceRole('Yes, allow bash "cd *" for this session')).toBe("session");
    expect(choiceRole("No")).toBe("deny");
    expect(choiceRole("No, provide reason")).toBe("reason");
    expect(choiceRole("Implement here")).toBe("other");
  });

  it("drops the Yes prefix from a session grant", () => {
    expect(sessionLabel('Yes, allow bash "cd *" for this session')).toBe(
      'Allow bash "cd *" for this session',
    );
  });
});
