// ABOUTME: Tests automatic session titles.
// ABOUTME: Includes "generates from the first prompt without blocking the main agent start".
import { describe, expect, it, vi } from "vitest";
import { registerAutomaticSessionTitle } from "./session-title-auto";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

function createHarness(generateTitle: (prompt: string) => Promise<string>) {
  let beforeAgentStart: ((event: { prompt: string }, ctx: { model?: unknown }) => void) | undefined;
  let sessionName: string | undefined;
  const pi = {
    getSessionName: vi.fn(() => sessionName),
    on: vi.fn((event, handler) => {
      if (event === "before_agent_start") beforeAgentStart = handler;
    }),
    setSessionName: vi.fn((name: string) => {
      sessionName = name;
    }),
  };
  registerAutomaticSessionTitle(pi as never, { generateTitle });
  return { pi, run: (prompt: string) => beforeAgentStart?.({ prompt }, {}) };
}

describe("automatic session titles", () => {
  it("generates from the first prompt without blocking the main agent start", async () => {
    const title = deferred<string>();
    const generateTitle = vi.fn(() => title.promise);
    const { pi, run } = createHarness(generateTitle);

    expect(run("Implement parallel session naming")).toBeUndefined();
    expect(generateTitle).toHaveBeenCalledWith("Implement parallel session naming", undefined);
    expect(pi.setSessionName).not.toHaveBeenCalled();

    title.resolve("Parallel Session Naming");
    await vi.waitFor(() =>
      expect(pi.setSessionName).toHaveBeenCalledWith("Parallel Session Naming"),
    );
  });

  it("starts only once when multiple agent turns begin before naming completes", async () => {
    const title = deferred<string>();
    const generateTitle = vi.fn(() => title.promise);
    const { pi, run } = createHarness(generateTitle);

    run("First prompt");
    run("Queued follow-up");

    expect(generateTitle).toHaveBeenCalledTimes(1);
    title.resolve("First Prompt");
    await vi.waitFor(() => expect(pi.setSessionName).toHaveBeenCalledTimes(1));
    run("Later turn");
    expect(generateTitle).toHaveBeenCalledTimes(1);
  });

  it("preserves a name chosen while automatic generation is running", async () => {
    const title = deferred<string>();
    const { pi, run } = createHarness(() => title.promise);

    run("Name this session");
    pi.setSessionName("My Manual Name");
    title.resolve("Generated Name");
    await title.promise;
    await Promise.resolve();

    expect(pi.setSessionName).toHaveBeenCalledTimes(1);
    expect(pi.getSessionName()).toBe("My Manual Name");
  });
});
