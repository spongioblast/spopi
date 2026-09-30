// ABOUTME: Tests custom-message-note.
// ABOUTME: Includes "skips hidden entries and other entry types".

import { expect, test } from "vitest";
import { customMessageNote } from "./custom-message-note.js";

test("returns the text of a displayed custom_message", () => {
  expect(
    customMessageNote({
      type: "custom_message",
      customType: "spopi-verify",
      display: true,
      content: "`bun run check` failed after your edits (exit 1).",
    }),
  ).toBe("`bun run check` failed after your edits (exit 1).");
  expect(
    customMessageNote({
      type: "custom_message",
      display: true,
      content: [
        { type: "text", text: "one " },
        { type: "image", data: "x" },
        { type: "text", text: "two" },
      ],
    }),
  ).toBe("one two");
});

test("skips hidden entries and other entry types", () => {
  expect(customMessageNote({ type: "custom_message", display: false, content: "x" })).toBeNull();
  expect(customMessageNote({ type: "custom", data: {} })).toBeNull();
  expect(customMessageNote({ type: "custom_message", display: true, content: "  " })).toBeNull();
  expect(customMessageNote(null)).toBeNull();
});
