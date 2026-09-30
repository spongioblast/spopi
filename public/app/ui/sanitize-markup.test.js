// ABOUTME: Tests escapeHtml against the characters that break HTML text.
// ABOUTME: Covers public/app/ui/sanitize-markup.js.

import { describe, expect, test } from "vitest";
import { escapeHtml } from "./sanitize-markup.js";

describe("escapeHtml", () => {
  test("escapes markup characters and leaves other text alone", () => {
    expect(escapeHtml(`a <b> & "c" 'd'`)).toBe("a &lt;b&gt; &amp; &quot;c&quot; &#39;d&#39;");
    expect(escapeHtml(null)).toBe("");
  });
});
