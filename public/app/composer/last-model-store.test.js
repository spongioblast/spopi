// ABOUTME: Tests last-model-store.
// ABOUTME: Includes "returns null when nothing is stored".
import { beforeEach, describe, expect, test } from "vitest";
import { createMemoryStorage } from "../test-utils/memory-storage.js";
import { getLastModel, setLastModel } from "./last-model-store.js";

describe("last-model-store", () => {
  let storage;
  beforeEach(() => {
    storage = createMemoryStorage();
  });

  test("returns null when nothing is stored", () => {
    expect(getLastModel(storage)).toBeNull();
  });

  test("round-trips an available-model object ({ provider, id })", () => {
    setLastModel({ provider: "anthropic", id: "claude-opus-4-8" }, storage);
    expect(getLastModel(storage)).toEqual({
      provider: "anthropic",
      modelId: "claude-opus-4-8",
    });
  });

  test("accepts a profile-shaped pair ({ provider, modelId })", () => {
    setLastModel({ provider: "openai", modelId: "gpt-5" }, storage);
    expect(getLastModel(storage)).toEqual({ provider: "openai", modelId: "gpt-5" });
  });

  test("ignores writes missing a provider or model id", () => {
    setLastModel({ provider: "anthropic" }, storage);
    setLastModel({ id: "claude-opus-4-8" }, storage);
    setLastModel({ provider: "  ", id: "  " }, storage);
    expect(getLastModel(storage)).toBeNull();
  });

  test("returns null for corrupted json", () => {
    storage.setItem("ui.composer.lastModel", "{not json");
    expect(getLastModel(storage)).toBeNull();
  });

  test("returns null when the stored record is incomplete", () => {
    storage.setItem("ui.composer.lastModel", JSON.stringify({ provider: "anthropic" }));
    expect(getLastModel(storage)).toBeNull();
  });
});
