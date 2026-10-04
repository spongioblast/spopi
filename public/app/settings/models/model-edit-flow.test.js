// ABOUTME: Tests that saving a model from the Models editor keeps models.json keys the form does not edit.
// ABOUTME: Pi's samplingParams and samplingParamsByThinkingLevel must reach the written file unchanged.
import { describe, expect, test, vi } from "vitest";
import { setAcceptsImages, setThinkingBudget, setThinkingControl } from "./model-draft.js";
import { createModelEditFlow } from "./model-edit-flow.js";
import { renderModelForm } from "./model-form.js";

vi.mock("./model-form.js", () => ({
  modelDraftSnapshot: (draft) => JSON.stringify(draft.model),
  renderModelForm: vi.fn(),
}));

const sampling = { temperature: 0.6, top_p: 0.95, top_k: 20 };
const byLevel = { off: { temperature: 0.7, top_p: 0.8 }, high: { temperature: 0.6, min_p: 0 } };

function document() {
  return {
    providers: {
      vllm: {
        baseUrl: "http://127.0.0.1:8000/v1",
        api: "openai-completions",
        models: [
          {
            id: "qwen",
            reasoning: true,
            samplingParams: sampling,
            samplingParamsByThinkingLevel: byLevel,
          },
        ],
      },
    },
  };
}

describe("model edit flow", () => {
  test("a saved edit keeps samplingParams and samplingParamsByThinkingLevel", async () => {
    const written = [];
    const view = {};
    const deps = {
      view,
      call: vi.fn(async () => ({ ok: true, data: {} })),
      renderModelsConfigLayout: vi.fn(),
      loadApiKeysPanel: vi.fn(async () => {}),
    };
    const config = {
      readBase: () => document(),
      persistConfig: vi.fn(async (next, { afterWrite } = {}) => {
        written.push(next);
        await afterWrite?.();
        return true;
      }),
    };
    const flow = createModelEditFlow({ deps, config, confirmLeave: async () => true });

    flow.openModel("vllm", 0);
    const draft = view.modelDraft;
    setThinkingControl(draft.model, "qwen-chat-template");
    setThinkingBudget(draft.model, true);
    setAcceptsImages(draft.model, true);
    flow.renderModelView({}, { type: "model", provider: "vllm", index: 0 });
    const { onSave } = vi.mocked(renderModelForm).mock.calls[0][1];
    onSave({ disabled: false, textContent: "" }, { hidden: true, textContent: "" });
    await vi.waitFor(() => expect(written).toHaveLength(1));

    const saved = written[0].providers.vllm.models[0];
    expect(saved.compat.thinkingFormat).toBe("qwen-chat-template");
    expect(saved.samplingParams).toEqual(sampling);
    expect(saved.samplingParamsByThinkingLevel).toEqual(byLevel);
  });
});
