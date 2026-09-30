// ABOUTME: Replays a recorded turn and checks each transcript event on its own.
// ABOUTME: The reducer stays pure: the same input state is not mutated.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { emptyTranscriptState, reduceTranscript } from "./transcript-reducer.js";

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "turn.json");
const turn = JSON.parse(readFileSync(fixturePath, "utf8"));
const toolMulti = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "fixtures", "tool-multi.json"),
    "utf8",
  ),
);
const toolWrite = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "fixtures", "tool-write.json"),
    "utf8",
  ),
);

function replay(events, state = emptyTranscriptState()) {
  return events.reduce((current, event) => reduceTranscript(current, event), state);
}

describe("reduceTranscript", () => {
  it("replays a text turn and a tool turn", () => {
    const state = replay(turn);
    expect(state.status.phase).toBe("idle");
    expect(state.transcript.streamingId).toBeNull();
    expect(state.transcript.messages.map((message) => message.id)).toEqual(["user-1", "asst-1"]);
    expect(state.transcript.messages[1].content).toEqual([{ type: "text", text: "Looking." }]);
    expect(state.transcript.notes).toContainEqual({
      kind: "tool",
      id: "tool-1",
      name: "read",
      status: "done",
      isError: false,
      output: "ok",
    });
  });

  it("returns the same state for an unknown event", () => {
    const state = emptyTranscriptState();
    expect(reduceTranscript(state, { type: "future_thing" })).toBe(state);
  });

  it("marks the agent working, then idle", () => {
    const working = reduceTranscript(emptyTranscriptState(), { type: "agent_start" });
    expect(working.status.phase).toBe("working");
    expect(reduceTranscript(working, { type: "agent_settled" }).status.phase).toBe("idle");
    expect(reduceTranscript(working, { type: "agent_end" }).status.phase).toBe("idle");
  });

  it("assembles a streaming assistant delta", () => {
    const started = reduceTranscript(emptyTranscriptState(), {
      type: "message_start",
      message: { id: "a", role: "assistant", content: [] },
    });
    const updated = reduceTranscript(started, {
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "Hi" },
    });
    expect(updated.transcript.streamingId).toBe("a");
    expect(updated.transcript.messages[0].content).toEqual([{ type: "text", text: "Hi" }]);
  });

  it("stores the queue, retry, prompts, compaction, and session title", () => {
    let state = emptyTranscriptState();
    state = reduceTranscript(state, {
      type: "queue_update",
      steering: [{ id: "s" }],
      followUp: [],
    });
    expect(state.queue.steering).toEqual([{ id: "s" }]);
    state = reduceTranscript(state, { type: "auto_retry_start", attempt: 1 });
    expect(state.status.phase).toBe("retrying");
    state = reduceTranscript(state, { type: "auto_retry_end" });
    expect(state.status.phase).toBe("idle");
    expect(state.status.retry).toBeNull();
    state = reduceTranscript(state, { type: "extension_ui_request", method: "confirm" });
    expect(state.status.phase).toBe("waiting");
    state = reduceTranscript(state, { type: "extension_ui_resolved" });
    expect(state.status.phase).toBe("idle");
    state = reduceTranscript(state, { type: "extension_ui_request", method: "notify" });
    expect(state.status.phase).toBe("idle");
    state = reduceTranscript(state, { type: "compaction_start" });
    state = reduceTranscript(state, { type: "compaction_end", result: {} });
    state = reduceTranscript(state, {
      type: "compaction_end",
      errorMessage: "context overflow",
      aborted: false,
    });
    expect(state.transcript.notes.map((note) => note.status)).toEqual([
      "running",
      "completed",
      "failed",
    ]);
    expect(state.transcript.notes.at(-1)?.text).toBe("context overflow");
    state = reduceTranscript(state, { type: "extension_error", error: "boom" });
    expect(state.transcript.notes.at(-1)).toEqual({ kind: "error", text: "boom" });
    state = reduceTranscript(state, { type: "session_info_changed", name: "Rename" });
    expect(state.session.title).toBe("Rename");
  });

  it("records a streaming tool update", () => {
    const state = replay([
      { type: "tool_execution_start", toolCallId: "t", toolName: "bash" },
      { type: "tool_execution_update", toolCallId: "t", toolName: "bash", partialResult: "out" },
    ]);
    expect(state.transcript.notes[0]).toMatchObject({
      id: "t",
      name: "bash",
      status: "streaming",
      output: "out",
    });
  });

  it("groups TOOL:multi into one turn with read and bash counts", () => {
    const state = replay(toolMulti);
    expect(state.transcript.turns).toHaveLength(1);
    const [grouped] = state.transcript.turns;
    expect(grouped.endedAt).toBe(2100);
    expect(grouped.answerId).toBe("asst-1");
    expect(grouped.tokens).toEqual({ in: 10, out: 4, cache: 2 });
    expect(grouped.work.steps.map((step) => step.kind)).toEqual(["read", "read", "bash"]);
    expect(grouped.work.durationMs).toBe(500);
    expect(grouped.files).toEqual([]);
  });

  it("groups TOOL:write into one turn and a changed file", () => {
    const state = replay(toolWrite);
    expect(state.transcript.turns).toHaveLength(1);
    const [grouped] = state.transcript.turns;
    expect(grouped.work.steps.map((step) => step.kind)).toEqual(["write"]);
    expect(grouped.files).toEqual([{ path: "note.txt", add: 1, del: 0 }]);
  });

  it("stores setStatus by key and strips ANSI, and drops an empty key", () => {
    const esc = String.fromCharCode(27);
    const set = reduceTranscript(emptyTranscriptState(), {
      type: "extension_ui_request",
      method: "setStatus",
      statusKey: "build",
      statusText: `${esc}[32mrunning${esc}[0m`,
    });
    expect(set.status.keys.build).toBe("running");
    const cleared = reduceTranscript(set, {
      type: "extension_ui_request",
      method: "setStatus",
      statusKey: "build",
      statusText: "",
    });
    expect(cleared.status.keys.build).toBeUndefined();
  });

  it("shows a summarization retry and clears it when the retry finishes", () => {
    const scheduled = reduceTranscript(emptyTranscriptState(), {
      type: "summarization_retry_scheduled",
      attempt: 2,
      maxAttempts: 3,
      delayMs: 2000,
      errorMessage: "terminated",
    });
    expect(scheduled.transcript.notes.at(-1)).toEqual({
      kind: "summarization-retry",
      status: "running",
      text: "retrying (attempt 2) in 2s",
    });
    const started = reduceTranscript(scheduled, {
      type: "summarization_retry_attempt_start",
      source: "compaction",
      reason: "threshold",
    });
    expect(started.transcript.notes.at(-1)?.text).toBe("retrying (compaction)");
    const finished = reduceTranscript(started, { type: "summarization_retry_finished" });
    expect(finished.transcript.notes.some((note) => note.kind === "summarization-retry")).toBe(
      false,
    );
  });
});
