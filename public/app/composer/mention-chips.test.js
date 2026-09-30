// ABOUTME: Tests mention-chips.
// ABOUTME: Includes "parseAtMentions keeps quoted and directory tokens and ignores emails".
// ABOUTME: Parser and inline-pill behavior for composer @-mentions.

import { afterEach, expect, test, vi } from "vitest";
import { setFileActionDispatch } from "../chat/file-actions.js";
import { mentionAtCaret, mountMentionChips, parseAtMentions } from "./mention-chips.js";

afterEach(() => {
  document.body.textContent = "";
});

function mount(extra = {}) {
  const host = document.createElement("div");
  host.className = "composer-card";
  const input = document.createElement("textarea");
  host.appendChild(input);
  document.body.appendChild(host);
  const api = mountMentionChips({ input, host, ...extra });
  return { host, input, api };
}

function type(input, value) {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

test("parseAtMentions keeps quoted and directory tokens and ignores emails", () => {
  expect(parseAtMentions('see @src/app.js and @"my dir/file.ts" plus @docs/')).toEqual([
    expect.objectContaining({ path: "src/app.js" }),
    expect.objectContaining({ path: "my dir/file.ts" }),
    expect.objectContaining({ path: "docs/" }),
  ]);
  expect(parseAtMentions("email user@example.com please")).toEqual([]);
  expect(parseAtMentions("keep foo@bar")).toEqual([]);
});

test("parseAtMentions keeps a line range in the token and apart from the path", () => {
  const [plain, quoted] = parseAtMentions('ask @src/todo.js:1-9 and @"my dir/a.js":4 now');
  expect(plain).toEqual(
    expect.objectContaining({
      raw: "@src/todo.js:1-9",
      path: "src/todo.js",
      range: ":1-9",
      line: 1,
    }),
  );
  expect(quoted).toEqual(expect.objectContaining({ path: "my dir/a.js", range: ":4", line: 4 }));
});

test("a ranged pill shows exactly its token's characters", () => {
  const { host, input } = mount({});
  type(input, "see @src/todo.js:1-9 here");
  const pill = host.querySelector(".composer-mention-inline");
  const text = [...(pill?.querySelectorAll("span") ?? [])].map((span) => span.textContent).join("");
  expect(text).toBe("@src/todo.js:1-9");
});

test("mentionAtCaret matches a caret anywhere inside or at the token edges", () => {
  const mentions = parseAtMentions("look at @src/app.js please");
  expect(mentionAtCaret(mentions, 8)?.path).toBe("src/app.js");
  expect(mentionAtCaret(mentions, 19)?.path).toBe("src/app.js");
  expect(mentionAtCaret(mentions, 3)).toBeNull();
});

test("mirror layer paints each @token as a pill of exactly its own characters", () => {
  const { host, input, api } = mount({ resolveAbsolute: (path) => `/ws/${path}` });
  type(input, 'look at @src/app.js and @"my dir/f.ts" please');
  const layer = host.querySelector(".composer-mention-layer");
  expect(layer.hidden).toBe(false);
  expect(layer.previousElementSibling).toBeNull();
  expect(layer.nextElementSibling).toBe(input);
  const pills = layer.querySelectorAll(".composer-mention-inline");
  expect(pills).toHaveLength(2);
  const text = (/** @type {Element} */ pill) =>
    [...pill.querySelectorAll("span")].map((span) => span.textContent).join("");
  expect(text(pills[0])).toBe("@src/app.js");
  expect(text(pills[1])).toBe('@"my dir/f.ts"');
  expect(pills[0].querySelector(".composer-mention-name").textContent).toBe("app.js");
  expect(pills[0].querySelector(".composer-mention-dir").textContent).toBe("src/");
  expect(pills[0].title).toBe("/ws/src/app.js");
  expect(host.querySelector(".composer-mention-chips")).toBeNull();
  type(input, "plain");
  expect(layer.hidden).toBe(true);
  expect(input.classList.contains("has-mention-layer")).toBe(false);
  api.destroy();
  expect(host.querySelector(".composer-mention-layer")).toBeNull();
});

test("Backspace right after a token removes the whole token", () => {
  const onRemove = vi.fn();
  const { input } = mount({ onRemove });
  type(input, "look at @src/app.js please");
  const end = "look at @src/app.js".length;
  input.setSelectionRange(end, end);
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true }));
  expect(input.value).toBe("look at please");
  expect(input.selectionStart).toBe("look at ".length);
  expect(onRemove).toHaveBeenCalledWith(expect.objectContaining({ path: "src/app.js" }));
});

test("the cross removes the mention, keeps one space, and leaves other spacing alone", () => {
  const onRemove = vi.fn();
  const { host, input } = mount({ onRemove });
  type(input, "look at @src/app.js please\n    indented");
  host.querySelector(".composer-mention-remove").click();
  expect(input.value).toBe("look at please\n    indented");
  expect(onRemove).toHaveBeenCalledWith(expect.objectContaining({ path: "src/app.js" }));
  expect(host.querySelector(".composer-mention-inline")).toBeNull();
  type(input, "@README.md first");
  host.querySelector(".composer-mention-remove").click();
  expect(input.value).toBe("first");
});

test("Backspace elsewhere is left to the textarea", () => {
  const { input } = mount();
  type(input, "look at @src/app.js please");
  input.setSelectionRange(4, 4);
  const event = new KeyboardEvent("keydown", { key: "Backspace", bubbles: true });
  input.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
  expect(input.value).toBe("look at @src/app.js please");
});

test("clicking the pill opens the file; a plain click in the text does not", () => {
  const onOpen = vi.fn();
  const { host, input } = mount({ onOpen });
  type(input, "@README.md");
  const seen = [];
  const unbind = setFileActionDispatch((action) => {
    if (action.type === "file.preview") seen.push(action);
  });
  host.querySelector(".composer-mention-inline").click();
  unbind();
  expect(onOpen).toHaveBeenCalledWith("README.md");
  expect(seen).toEqual([{ type: "file.preview", path: "README.md", line: undefined }]);
  expect(input.value).toBe("@README.md");
  onOpen.mockClear();
  input.setSelectionRange(0, 0);
  input.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  expect(onOpen).not.toHaveBeenCalled();
});
