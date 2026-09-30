// ABOUTME: Tests the pure model-entry helpers: thinking control, levels, images, setup results.
// ABOUTME: The backup vLLM entry is the target for a switchable Qwen model.
import { describe, expect, test } from "vitest";
import {
  applySetupResult,
  effectiveThinkingLevel,
  setAcceptsImages,
  setImageResize,
  setThinkingBudget,
  setThinkingControl,
  supportedThinkingLevels,
  thinkingControlOf,
} from "./model-draft.js";

describe("thinking control", () => {
  test("reads model compat over provider compat", () => {
    expect(thinkingControlOf({}, {})).toBe("none");
    expect(thinkingControlOf({}, { compat: { thinkingFormat: "qwen-chat-template" } })).toBe(
      "qwen-chat-template",
    );
    expect(thinkingControlOf({ compat: { supportsReasoningEffort: true } })).toBe(
      "reasoning-effort",
    );
    expect(thinkingControlOf({ compat: { thinkingFormat: "deepseek" } })).toBe("other");
  });

  test("writes only the fields for the chosen control", () => {
    const model = { id: "m", compat: { supportsReasoningEffort: true } };
    setThinkingControl(model, "chat-template");
    expect(model.compat).toEqual({
      thinkingFormat: "chat-template",
      chatTemplateKwargs: { enable_thinking: { $var: "thinking.enabled" } },
    });
    setThinkingControl(model, "none");
    expect(model.compat).toBeUndefined();
    setThinkingControl(model, "reasoning-effort");
    expect(model.compat).toEqual({ supportsReasoningEffort: true });
  });
});

describe("thinking levels", () => {
  test("follow reasoning and the level map", () => {
    expect(supportedThinkingLevels({})).toEqual(["off"]);
    expect(supportedThinkingLevels({ reasoning: true })).toEqual([
      "off",
      "minimal",
      "low",
      "medium",
      "high",
    ]);
    expect(
      supportedThinkingLevels({
        reasoning: true,
        thinkingLevelMap: { off: null, minimal: null, low: null, medium: null, high: "high" },
      }),
    ).toEqual(["high"]);
    expect(
      supportedThinkingLevels({
        reasoning: true,
        thinkingLevelMap: { xhigh: "xhigh", max: "max" },
      }),
    ).toContain("max");
  });

  test("default to high, or the saved level when it applies", () => {
    expect(effectiveThinkingLevel({ reasoning: true }, null)).toBe("high");
    expect(effectiveThinkingLevel({ reasoning: true }, "low")).toBe("low");
    expect(effectiveThinkingLevel({ reasoning: true }, "max")).toBe("high");
    expect(effectiveThinkingLevel({}, "high")).toBe("off");
  });
});

describe("images and budget", () => {
  test("images on sets input and resize defaults; off removes them", () => {
    const model = { id: "m" };
    setAcceptsImages(model, true);
    setImageResize(model, "maxBytes", 262144);
    expect(model.input).toEqual(["text", "image"]);
    expect(model.inputLimits.images.resize).toEqual({
      maxWidth: 1280,
      maxHeight: 1280,
      maxBytes: 262144,
      jpegQuality: 80,
    });
    setAcceptsImages(model, false);
    expect(model).toEqual({ id: "m", input: ["text"] });
  });

  test("budget toggles the vLLM field", () => {
    const model = { id: "m" };
    setThinkingBudget(model, true);
    expect(model.compat).toEqual({ thinkingTokenBudgetField: "thinking_token_budget" });
    setThinkingBudget(model, false);
    expect(model.compat).toBeUndefined();
  });
});

describe("applySetupResult", () => {
  test("a switchable vLLM Qwen becomes the backup entry", () => {
    const model = { id: "qwen", maxTokens: 98304 };
    applySetupResult(model, {
      checks: [
        { id: "context", ok: true, detail: "262144" },
        { id: "thinking", ok: true, detail: "switchable" },
        { id: "images", ok: true, detail: "accepted" },
        { id: "budget", ok: true, detail: "accepted" },
      ],
      suggestion: {
        reasoning: true,
        thinkingMode: "switchable",
        thinkingFormat: "qwen-chat-template",
        thinkingLevelMap: {
          minimal: "minimal",
          low: "low",
          medium: "medium",
          high: "high",
          xhigh: "xhigh",
          max: "max",
        },
        contextWindow: 262144,
      },
    });
    expect(model).toEqual({
      id: "qwen",
      maxTokens: 98304,
      contextWindow: 262144,
      reasoning: true,
      thinkingLevelMap: {
        minimal: "minimal",
        low: "low",
        medium: "medium",
        high: "high",
        xhigh: "xhigh",
        max: "max",
      },
      compat: {
        thinkingFormat: "qwen-chat-template",
        thinkingTokenBudgetField: "thinking_token_budget",
      },
      input: ["text", "image"],
      inputLimits: {
        images: { resize: { maxWidth: 1280, maxHeight: 1280, maxBytes: 524288, jpegQuality: 80 } },
      },
    });
  });

  test("a server that checks reasoning_effort gets that control and its level map", () => {
    const model = { id: "qwen", reasoning: true, compat: { thinkingFormat: "qwen-chat-template" } };
    const map = {
      off: "none",
      minimal: null,
      low: "low",
      medium: "medium",
      high: null,
      xhigh: "xhigh",
      max: null,
    };
    applySetupResult(model, {
      checks: [
        { id: "thinking", ok: true, detail: "switchable" },
        { id: "effort", ok: true, detail: "low, medium, xhigh; off: none" },
      ],
      suggestion: {
        reasoning: true,
        thinkingMode: "switchable",
        supportsReasoningEffort: true,
        thinkingLevelMap: map,
      },
    });
    expect(model.compat).toEqual({ supportsReasoningEffort: true });
    expect(model.thinkingLevelMap).toEqual(map);
    expect(supportedThinkingLevels(model)).toEqual(["off", "low", "medium", "xhigh"]);
  });

  test("a check that could not tell leaves the fields alone", () => {
    const model = { id: "m", reasoning: true, input: ["text", "image"] };
    applySetupResult(model, {
      checks: [
        { id: "thinking", ok: null, detail: "HTTP 500" },
        { id: "images", ok: null, detail: "timeout" },
      ],
      suggestion: { reasoning: false, thinkingMode: "unknown", input: ["text"] },
    });
    expect(model).toEqual({ id: "m", reasoning: true, input: ["text", "image"] });
  });
});
