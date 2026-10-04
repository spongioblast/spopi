// ABOUTME: Tests vLLM metrics parsing.
// ABOUTME: Includes "reads the fields the overlay shows".
import { describe, expect, it } from "vitest";
import {
  cacheSharePct,
  createMetricsModel,
  deriveServerRates,
  describeToolArgs,
  parseVllmMetrics,
  summarizeToolArgs,
} from "./metrics-model.js";

const SAMPLE = [
  "# HELP vllm:num_requests_running Number of running requests",
  "# TYPE vllm:num_requests_running gauge",
  'vllm:num_requests_running{engine="0",model_name="Qwen"} 2.0',
  'vllm:num_requests_waiting{engine="0",model_name="Qwen"} 1.0',
  'vllm:num_requests_waiting_by_reason{engine="0",model_name="Qwen",reason="capacity"} 1.0',
  'vllm:num_requests_waiting_by_reason{engine="0",model_name="Qwen",reason="deferred"} 0.0',
  'vllm:kv_cache_usage_perc{engine="0",model_name="Qwen"} 0.312',
  'vllm:num_preemptions_total{engine="0",model_name="Qwen"} 3.0',
  'vllm:generation_tokens_total{engine="0",model_name="Qwen"} 1000.0',
  'vllm:generation_tokens_created{engine="0",model_name="Qwen"} 1.7898156657067244e+09',
  'vllm:prompt_tokens_total{engine="0",model_name="Qwen"} 5000.0',
  'vllm:prompt_tokens_by_source_total{engine="0",model_name="Qwen",source="local_compute"} 2000.0',
  'vllm:prompt_tokens_by_source_total{engine="0",model_name="Qwen",source="local_cache_hit"} 3000.0',
  'vllm:prompt_tokens_cached_total{engine="0",model_name="Qwen"} 3000.0',
  'vllm:prefix_cache_queries_total{engine="0",model_name="Qwen"} 100.0',
  'vllm:prefix_cache_hits_total{engine="0",model_name="Qwen"} 90.0',
  'vllm:inter_token_latency_seconds_sum{engine="0",model_name="Qwen"} 8.0',
  'vllm:inter_token_latency_seconds_count{engine="0",model_name="Qwen"} 1000.0',
  'vllm:time_to_first_token_seconds_sum{engine="0",model_name="Qwen"} 4.0',
  'vllm:time_to_first_token_seconds_count{engine="0",model_name="Qwen"} 10.0',
  'vllm:iteration_tokens_total_sum{engine="0",model_name="Qwen"} 7000.0',
  'vllm:iteration_tokens_total_count{engine="0",model_name="Qwen"} 1000.0',
  'vllm:spec_decode_num_drafts_total{engine="0",model_name="Qwen"} 100.0',
  'vllm:spec_decode_num_draft_tokens_total{engine="0",model_name="Qwen"} 300.0',
  'vllm:spec_decode_num_accepted_tokens_total{engine="0",model_name="Qwen"} 150.0',
  "vllm:not_a_field_total 42",
].join("\n");

describe("vLLM metrics parsing", () => {
  it("reads the fields the overlay shows", () => {
    const server = parseVllmMetrics(SAMPLE);
    expect(server.running).toBe(2);
    expect(server.waiting).toBe(1);
    expect(server.waitingCapacity).toBe(1);
    expect(server.kvCachePct).toBeCloseTo(31.2, 1);
    expect(server.preemptions).toBe(3);
    expect(server.generationTokens).toBe(1000);
    expect(server.promptCompute).toBe(2000);
    expect(server.prefixHits).toBe(90);
    expect(server.specAcceptedTokens).toBe(150);
    expect(server.notAField).toBeUndefined();
  });

  it("ignores _created timestamp series, which would poison every delta", () => {
    const server = parseVllmMetrics(SAMPLE);
    expect(server.generationTokens).toBe(1000);
    expect(
      parseVllmMetrics('vllm:generation_tokens_created{model_name="m"} 1.79e+09').generationTokens,
    ).toBe(0);
  });

  it("survives empty and malformed input", () => {
    for (const input of [
      null,
      undefined,
      "",
      "# only comments",
      "garbage",
      "vllm:kv_cache_usage_perc nope",
    ]) {
      expect(() => parseVllmMetrics(input)).not.toThrow();
      expect(parseVllmMetrics(input).running).toBe(0);
    }
  });
});

describe("server rates", () => {
  it("derives every rate from the delta over its own window", () => {
    const previous = parseVllmMetrics(SAMPLE);
    const next = {
      ...previous,
      generationTokens: 1200,
      promptCompute: 2400,
      promptTokens: 6000,
      promptCached: 3600,
      prefixQueries: 120,
      prefixHits: 108,
      itlSum: 9.6,
      itlCount: 1200,
      ttftSum: 4.4,
      ttftCount: 12,
      iterationTokensSum: 8400,
      iterationTokensCount: 1200,
      specDrafts: 130,
      specDraftTokens: 390,
      specAcceptedTokens: 195,
    };
    const rates = deriveServerRates(previous, next, 2000);
    expect(rates.decodeTps).toBeCloseTo(100, 6);
    expect(rates.prefillTps).toBeCloseTo(200, 6);
    expect(rates.cacheHitPct).toBeCloseTo(60, 6);
    expect(rates.prefixHitPct).toBeCloseTo(90, 6);
    expect(rates.specAcceptPct).toBeCloseTo(50, 6);
    expect(rates.tokensPerDraft).toBeCloseTo(1.5, 6);
    expect(rates.meanItlMs).toBeCloseTo(8, 6);
    expect(rates.meanTtftMs).toBeCloseTo(200, 6);
    expect(rates.tokensPerStep).toBeCloseTo(7, 6);
    expect(rates.windowMs).toBe(2000);
  });

  it("treats a counter reset (engine restart) as no traffic, never negative", () => {
    const previous = parseVllmMetrics(SAMPLE);
    const rates = deriveServerRates(previous, { ...previous, generationTokens: 5 }, 1000);
    expect(rates.decodeTps).toBe(0);
  });

  it("returns zeros without a previous scrape or a positive window", () => {
    const server = parseVllmMetrics(SAMPLE);
    expect(deriveServerRates(null, server, 1000).decodeTps).toBe(0);
    expect(deriveServerRates(server, server, 0).decodeTps).toBe(0);
  });
});

describe("metrics model", () => {
  function buildTurn(model, at = 1000) {
    model.onRuntimeEvent({ type: "agent_start" }, at);
    model.onRuntimeEvent(
      {
        type: "message_update",
        usage: { input: 90_000, output: 10, reasoning: 4, cacheRead: 88_000, cost: { total: 0 } },
        assistantMessageEvent: { type: "thinking_delta", delta: "think" },
      },
      at + 100,
    );
    model.onRuntimeEvent(
      {
        type: "message_update",
        usage: { input: 90_000, output: 20, reasoning: 4, cacheRead: 88_000, cost: { total: 0 } },
        assistantMessageEvent: { type: "text_delta", delta: "hello" },
      },
      at + 200,
    );
    model.onRuntimeEvent(
      {
        type: "message_end",
        message: {
          role: "assistant",
          usage: {
            input: 90_000,
            output: 20,
            reasoning: 4,
            cacheRead: 88_000,
            cost: { total: 0.002 },
          },
        },
      },
      at + 250,
    );
    return at;
  }

  it("times tool calls and keeps newest first", () => {
    const model = createMetricsModel();
    buildTurn(model);
    model.onRuntimeEvent(
      {
        type: "tool_execution_start",
        toolCallId: "a",
        toolName: "bash",
        args: { command: "ls -la" },
      },
      1300,
    );
    model.onRuntimeEvent(
      {
        type: "tool_execution_update",
        toolCallId: "a",
        toolName: "bash",
        partialResult: { content: [{ type: "text", text: "abcde" }] },
      },
      1400,
    );
    model.onRuntimeEvent(
      {
        type: "tool_execution_end",
        toolCallId: "a",
        toolName: "bash",
        result: { content: [{ type: "text", text: "done" }] },
        isError: false,
      },
      1750,
    );
    model.onRuntimeEvent(
      {
        type: "tool_execution_start",
        toolCallId: "b",
        toolName: "edit",
        args: { path: "native/app.js" },
      },
      1800,
    );

    model.onRuntimeEvent(
      {
        type: "tool_execution_start",
        toolCallId: "a/1",
        toolName: "mcp__echo__echo",
        parentToolCallId: "a",
        args: { text: "hi" },
      },
      1760,
    );
    const snapshot = model.snapshot(2000);
    expect(snapshot.tools.map((tool) => tool.id)).toEqual(["b", "a"]);
    expect(snapshot.tools[1]).toMatchObject({ status: "ok", durationMs: 450, outputChars: 5 });
    expect(snapshot.tools[0]).toMatchObject({ status: "running", label: "native/app.js" });
    expect(snapshot.runningToolCount).toBe(1);
  });

  it("never reports a negative duration for a clock skew", () => {
    const model = createMetricsModel();
    buildTurn(model);
    model.onRuntimeEvent(
      { type: "tool_execution_start", toolCallId: "future", toolName: "bash", args: {} },
      50_000,
    );
    expect(model.snapshot(2000).tools[0].durationMs).toBe(0);
  });

  it("reports live tokens/s from streaming usage", () => {
    const model = createMetricsModel();
    model.onRuntimeEvent({ type: "agent_start" }, 1000);
    for (let index = 0; index < 6; index += 1) {
      model.onRuntimeEvent(
        {
          type: "message_update",
          usage: { input: 10, output: index * 12, cacheRead: 0, cost: { total: 0 } },
          assistantMessageEvent: { type: "text_delta", delta: "x".repeat(20) },
        },
        1000 + index * 100,
      );
    }
    // 60 tokens over 500 ms.
    expect(model.snapshot(1600).turn.liveTps).toBeCloseTo(120, 0);
  });

  it("accumulates session totals only from message_end", () => {
    const model = createMetricsModel();
    buildTurn(model);
    const snapshot = model.snapshot(1300);
    expect(snapshot.session).toMatchObject({
      turns: 1,
      input: 90_000,
      output: 20,
      reasoning: 4,
      cacheRead: 88_000,
    });
    expect(snapshot.session.cost).toBeCloseTo(0.002, 6);
    expect(snapshot.turn.thinkingChars).toBe(5);
  });

  it("surfaces compaction and retry phases", () => {
    const model = createMetricsModel();
    buildTurn(model);
    model.onRuntimeEvent({ type: "compaction_start" }, 1300);
    expect(model.snapshot(1300).phase).toBe("compacting");
    model.onRuntimeEvent({ type: "compaction_end" }, 1400);
    expect(model.snapshot(1400).phase).toBe("working");
    model.onRuntimeEvent({ type: "auto_retry_start" }, 1500);
    const snapshot = model.snapshot(1500);
    expect(snapshot.phase).toBe("retrying");
    expect(snapshot.turn.retries).toBe(1);
  });

  it("settles the turn and stops the elapsed clock", () => {
    const model = createMetricsModel();
    buildTurn(model);
    model.onRuntimeEvent({ type: "agent_end" }, 3000);
    const snapshot = model.snapshot(9000);
    expect(snapshot.active).toBe(false);
    expect(snapshot.phase).toBe("idle");
    expect(snapshot.turn.elapsedMs).toBe(2000);
  });

  it("ignores junk events without throwing", () => {
    const model = createMetricsModel();
    for (const event of [null, undefined, {}, { type: "nope" }]) {
      expect(() => model.onRuntimeEvent(event)).not.toThrow();
    }
    expect(model.snapshot().phase).toBe("idle");
    expect(model.snapshot().active).toBe(false);
  });

  it("treats a bare message_update as assistant activity, never as a crash", () => {
    const model = createMetricsModel();
    expect(() => model.onRuntimeEvent({ type: "message_update" })).not.toThrow();
    const snapshot = model.snapshot();
    expect(snapshot.active).toBe(true);
    expect(snapshot.phase).toBe("working");
  });

  it("rotates scrapes so rates always compare two adjacent samples", async () => {
    const model = createMetricsModel();
    const scrape = (tokens, at) =>
      model.recordServerScrape(
        `vllm:generation_tokens_total{model_name="m"} ${tokens}\nvllm:prompt_tokens_by_source_total{source="local_compute",model_name="m"} 0\n`,
        { at, latencyMs: 3 },
      );
    scrape(100, 1000);
    expect(model.snapshot(1000).rates.decodeTps).toBe(0);
    scrape(300, 3000);
    expect(model.snapshot(3000).rates.decodeTps).toBeCloseTo(100, 6);
    scrape(500, 4000);
    expect(model.snapshot(4000).rates.decodeTps).toBeCloseTo(200, 6);
    expect(model.snapshot(4000).health).toMatchObject({ ok: true, latencyMs: 3, scrapes: 3 });
  });

  it("records scrape failures instead of throwing", () => {
    const model = createMetricsModel();
    model.recordServerFailure("Failed to fetch", { at: 1000, latencyMs: 12 });
    const snapshot = model.snapshot(1000);
    expect(snapshot.health).toMatchObject({ ok: false, failures: 1 });
    expect(snapshot.rates.decodeTps).toBe(0);
  });

  it("caps tool history", () => {
    const model = createMetricsModel({ historyLimit: 3 });
    buildTurn(model);
    for (let index = 0; index < 6; index += 1) {
      model.onRuntimeEvent(
        { type: "tool_execution_start", toolCallId: `t${index}`, toolName: "bash", args: {} },
        1000 + index,
      );
    }
    expect(model.snapshot(2000).tools).toHaveLength(3);
  });
});

describe("tool labels", () => {
  it("prefers the meaningful argument per tool", () => {
    expect(summarizeToolArgs("bash", { command: "ls -la" })).toBe("ls -la");
    expect(summarizeToolArgs("read", { path: "native/app.js" })).toBe("native/app.js");
    expect(summarizeToolArgs("grep", { pattern: "metrics" })).toBe("metrics");
  });

  it("handles missing arguments and long commands", () => {
    expect(summarizeToolArgs("read", undefined)).toBe("");
    expect(summarizeToolArgs("bash", { command: "x".repeat(300) })).toHaveLength(160);
  });

  it("keeps the untruncated text available for the tooltip", () => {
    const long = "y".repeat(300);
    expect(describeToolArgs("bash", { command: long })).toHaveLength(300);
    expect(describeToolArgs("todo", {})).toBe("todo");
  });
});

/** Metrics text carrying only the counters the per-prompt engine stats need. */
function engineText({
  gen = 0,
  decode = 0,
  compute = 0,
  promptTokens = 0,
  promptCached = 0,
  prefill = 0,
  kv = 0,
  ttftSum = 0,
  ttftCount = 0,
  drafts = 0,
  draftTokens = 0,
  accepted = 0,
  queueTime = 0,
  queueCount = 0,
  prefillCount = 0,
} = {}) {
  const at = (name, value) => `vllm:${name}{engine="0",model_name="Qwen"} ${value}`;
  return [
    at("generation_tokens_total", gen),
    at("prompt_tokens_total", promptTokens),
    at("prompt_tokens_cached_total", promptCached),
    `vllm:prompt_tokens_by_source_total{engine="0",model_name="Qwen",source="local_compute"} ${compute}`,
    at("request_generation_tokens_sum", gen),
    at("request_decode_time_seconds_sum", decode),
    at("request_prefill_time_seconds_sum", prefill),
    at("request_prefill_time_seconds_count", prefillCount),
    at("request_queue_time_seconds_sum", queueTime),
    at("request_queue_time_seconds_count", queueCount),
    at("kv_cache_usage_perc", kv),
    at("time_to_first_token_seconds_sum", ttftSum),
    at("time_to_first_token_seconds_count", ttftCount),
    at("spec_decode_num_drafts_total", drafts),
    at("spec_decode_num_draft_tokens_total", draftTokens),
    at("spec_decode_num_accepted_tokens_total", accepted),
  ].join("\n");
}

function assistantTurn(
  model,
  { at, started, output, reasoning = 0, input = 1000, cacheRead = 0, cost = 0 },
) {
  const usage = { input, output, reasoning, cacheRead, cost: { total: cost } };
  model.onRuntimeEvent(
    {
      type: "message_update",
      usage,
      assistantMessageEvent: { type: "text_delta", delta: "hello" },
    },
    started,
  );
  // A second delta gives the generation window a real length (one delta would
  // leave first and last token timestamps identical).
  model.onRuntimeEvent(
    {
      type: "message_update",
      usage,
      assistantMessageEvent: { type: "text_delta", delta: " world" },
    },
    at,
  );
  model.onRuntimeEvent({ type: "message_end", message: { role: "assistant", usage } }, at);
}

describe("per-prompt engine stats", () => {
  it("uses the engine's decode time rather than the scrape window", () => {
    const model = createMetricsModel();
    model.onRuntimeEvent({ type: "agent_start" }, 1000);
    model.recordServerScrape(engineText(), { at: 1000 });
    model.recordServerScrape(
      engineText({ gen: 500, decode: 4, compute: 1000, prefill: 2, kv: 0.42 }),
      { at: 2000 },
    );
    const rates = model.snapshot(2000).rates;
    expect(rates.decodeFromCounters).toBe(true);
    // 500 tokens over 4 s of actual decode time, not over the 1 s wall window.
    expect(rates.decodeTps).toBeCloseTo(125, 1);
    expect(rates.meanItlMs).toBeCloseTo(8, 1);
    expect(rates.prefillTps).toBeCloseTo(500, 0);
  });

  it("accumulates a running average for the current prompt", () => {
    const model = createMetricsModel();
    model.onRuntimeEvent({ type: "agent_start" }, 1000);
    model.recordServerScrape(engineText(), { at: 1000 });
    model.recordServerScrape(engineText({ gen: 300, decode: 2.5 }), { at: 1500 });
    model.recordServerScrape(
      engineText({ gen: 500, decode: 4, kv: 0.55, drafts: 200, draftTokens: 600, accepted: 360 }),
      { at: 2000 },
    );
    assistantTurn(model, {
      at: 2100,
      started: 1100,
      output: 500,
      reasoning: 100,
      input: 91000,
      cacheRead: 90000,
      cost: 0.5,
    });
    const prompt = model.snapshot(2100).prompt;
    expect(prompt.decodeTps).toBeCloseTo(125, 1);
    expect(prompt.engine.genTokens).toBe(500);
    expect(prompt.engine.kvPeakPct).toBeCloseTo(55, 0);
    expect(prompt.genMs).toBe(1000);
    expect(prompt.clientTps).toBeCloseTo(500, 0);
    expect(prompt.engine.specAcceptPct).toBeCloseTo(60, 1);
    expect(prompt.engine.tokensPerStep).toBeCloseTo(2.8, 2);
    expect(prompt.outputTokens).toBe(500);
  });

  it("ignores counters scraped while no prompt was running", () => {
    const model = createMetricsModel();
    model.recordServerScrape(engineText({ gen: 999, decode: 1 }), { at: 1000 });
    model.onRuntimeEvent({ type: "agent_start" }, 2000);
    const prompt = model.snapshot(2500).prompt;
    expect(prompt.engine).toBeNull();
    expect(prompt.decodeTps).toBe(0);
  });
});

describe("prompt log", () => {
  it("lists prompts newest first, each with its own tool calls", () => {
    const model = createMetricsModel();
    model.onRuntimeEvent({ type: "agent_start" }, 1000);
    model.onRuntimeEvent(
      {
        type: "tool_execution_start",
        toolCallId: "a",
        toolName: "bash",
        args: { command: "first" },
      },
      1100,
    );
    model.onRuntimeEvent(
      { type: "tool_execution_end", toolCallId: "a", toolName: "bash", isError: false },
      1600,
    );
    assistantTurn(model, { at: 2000, started: 1050, output: 100 });
    model.onRuntimeEvent({ type: "agent_end" }, 2100);
    model.onRuntimeEvent({ type: "agent_start" }, 3000);
    model.onRuntimeEvent(
      {
        type: "tool_execution_start",
        toolCallId: "b",
        toolName: "read",
        args: { path: "second.js" },
      },
      3100,
    );
    model.onRuntimeEvent(
      { type: "tool_execution_end", toolCallId: "b", toolName: "read", isError: false },
      3250,
    );
    assistantTurn(model, { at: 4000, started: 3050, output: 200 });
    model.onRuntimeEvent({ type: "agent_end" }, 4100);

    const snap = model.snapshot(4100);
    expect(snap.promptLog.map((entry) => entry.id)).toEqual([2, 1]);
    expect(snap.promptLog[0].tools.map((tool) => tool.label)).toEqual(["second.js"]);
    expect(snap.promptLog[1].tools.map((tool) => tool.label)).toEqual(["first"]);
    expect(snap.promptLog[1].tools[0].durationMs).toBe(500);
    expect(snap.prompt.id).toBe(2);
  });

  it("averages decode over the last finished prompts", () => {
    const model = createMetricsModel();
    for (let index = 1; index <= 3; index += 1) {
      const start = index * 10000;
      model.onRuntimeEvent({ type: "agent_start" }, start);
      assistantTurn(model, { at: start + 1000, started: start + 100, output: 100 * index });
      model.onRuntimeEvent({ type: "agent_end" }, start + 1100);
    }
    const snap = model.snapshot(40000);
    expect(snap.promptLog.length).toBe(3);
    expect(snap.avgDecodeTps).toBeCloseTo((100 / 0.9 + 200 / 0.9 + 300 / 0.9) / 3, 1);
  });
});

describe("prompt stats window", () => {
  it("credits the scrape that fires just after the prompt ended", () => {
    const model = createMetricsModel();
    model.onRuntimeEvent({ type: "agent_start" }, 1000);
    model.recordServerScrape(engineText(), { at: 1000 });
    assistantTurn(model, { at: 2000, started: 1100, output: 30 });
    model.onRuntimeEvent({ type: "agent_end" }, 2000);
    // The overlay scrapes after agent_end; those tokens belong to this prompt.
    model.recordServerScrape(engineText({ gen: 300, decode: 2.5 }), { at: 2010 });
    expect(model.snapshot(2100).prompt.engine?.genTokens).toBe(300);
    expect(model.snapshot(2100).prompt.decodeTps).toBeCloseTo(120, 1);
  });

  it("stops crediting a prompt once the grace window has passed", () => {
    const model = createMetricsModel();
    model.onRuntimeEvent({ type: "agent_start" }, 1000);
    model.recordServerScrape(engineText(), { at: 1000 });
    assistantTurn(model, { at: 2000, started: 1100, output: 30 });
    model.onRuntimeEvent({ type: "agent_end" }, 2000);
    model.recordServerScrape(engineText({ gen: 900, decode: 7.5 }), { at: 20000 });
    const prompt = model.snapshot(20100).prompt;
    expect(prompt.engine?.genTokens || 0).toBe(0);
    expect(prompt.decodeTps).toBeCloseTo(30 / 0.9, 1); // client estimate only
  });
});

describe("pi's real streaming protocol (usage only arrives at message_end)", () => {
  it("counts a running prompt from engine counters, then from pi's usage", () => {
    const model = createMetricsModel();
    model.onRuntimeEvent({ type: "agent_start" }, 1000);
    model.recordServerScrape(engineText(), { at: 1000 });
    model.onRuntimeEvent({ type: "message_start", message: { role: "assistant" } }, 1100);
    // Deltas carry no usage whatsoever, exactly like pi's current RPC protocol.
    model.onRuntimeEvent(
      {
        type: "message_update",
        assistantMessageEvent: { type: "thinking_delta", delta: "thinking hard about it" },
      },
      1200,
    );
    model.recordServerScrape(
      engineText({ gen: 200, decode: 1.6, promptTokens: 88000, promptCached: 87000 }),
      { at: 1600 },
    );

    const live = model.snapshot(1700).prompt;
    expect(live.outputTokens).toBe(200);
    expect(live.inputTokens).toBe(88000);
    expect(live.cacheReadTokens).toBe(87000);
    expect(live.reasoningTokens).toBe(6);
    expect(live.decodeTps).toBeCloseTo(125, 1);
    expect(live.estimated.out).toBe(true);
    expect(live.estimated.think).toBe(true);

    model.recordServerScrape(
      engineText({ gen: 400, decode: 3.2, promptTokens: 88000, promptCached: 87000 }),
      { at: 2000 },
    );
    model.onRuntimeEvent(
      {
        type: "message_end",
        message: {
          role: "assistant",
          usage: {
            input: 91000,
            output: 380,
            reasoning: 260,
            cacheRead: 90000,
            cost: { total: 0.0021 },
          },
        },
      },
      2100,
    );
    const done = model.snapshot(2100).prompt;
    expect(done.outputTokens).toBe(380);
    expect(done.inputTokens).toBe(91000);
    expect(done.cacheReadTokens).toBe(90000);
    expect(done.reasoningTokens).toBe(260);
    expect(done.cost).toBeCloseTo(0.0021, 6);
    expect(done.estimated.out).toBe(false);
    expect(done.decodeTps).toBeCloseTo(125, 1);
  });
});

describe("waiting costs and session totals", () => {
  it("reports queue and prefill time per request in ms", () => {
    const model = createMetricsModel();
    model.onRuntimeEvent({ type: "agent_start" }, 1000);
    model.recordServerScrape(engineText(), { at: 1000 });
    model.recordServerScrape(
      engineText({ queueTime: 0.012, queueCount: 1, prefill: 0.38, prefillCount: 1 }),
      { at: 1500 },
    );
    const rates = model.snapshot(1500).rates;
    expect(rates.meanQueueMs).toBeCloseTo(12, 0);
    expect(rates.meanPrefillMs).toBeCloseTo(380, 0);
  });

  it("totals generated tokens for the session, pi's usage first", () => {
    const model = createMetricsModel();
    model.onRuntimeEvent({ type: "agent_start" }, 1000);
    model.recordServerScrape(engineText({ gen: 400, decode: 4 }), { at: 1000 });
    // pi reports 380 output tokens for this prompt; the engine saw 400.
    assistantTurn(model, { at: 2000, started: 1100, output: 380 });
    model.onRuntimeEvent({ type: "agent_end" }, 2050);
    expect(model.snapshot(2100).session.tokens).toBe(380);

    // A prompt pi never reported usage for still counts, via the engine's own
    // delta for that prompt: 900 cumulative minus the 400 already attributed.
    model.onRuntimeEvent({ type: "agent_start" }, 3000);
    model.recordServerScrape(engineText({ gen: 900, decode: 8 }), { at: 3000 });
    model.onRuntimeEvent({ type: "agent_end" }, 3500);
    expect(model.snapshot(3600).session.tokens).toBe(880);

    // Crediting is idempotent: further agent_end events add nothing more.
    model.onRuntimeEvent({ type: "agent_end" }, 4000);
    expect(model.snapshot(4100).session.tokens).toBe(880);
  });
});

describe("compaction rows", () => {
  const start = (model, at, reason = "auto") =>
    model.onRuntimeEvent({ type: "compaction_start", reason }, at);
  const end = (model, at, extra = {}) =>
    model.onRuntimeEvent(
      {
        type: "compaction_end",
        reason: "auto",
        result: { tokensBefore: 148000, usage: { output: 820 } },
        aborted: false,
        willRetry: false,
        ...extra,
      },
      at,
    );

  it("shows an in-progress row while compaction runs", () => {
    const model = createMetricsModel();
    model.onRuntimeEvent({ type: "agent_start" }, 1000);
    start(model, 1200);
    const snap = model.snapshot(1300);
    expect(snap.phase).toBe("compacting");
    expect(snap.turn.pendingCompaction).toBe(true);
    expect(snap.compactions[0].status).toBe("running");
    expect(snap.compactions[0].startedAt).toBe(1200);
    expect(snap.compactions[0].durationMs).toBe(100);
    // The newest event owns the top of the log, above the prompt it belongs to.
    expect(snap.log[0].kind).toBe("compaction");
  });

  it("prints before to after once the next request proves the new size", () => {
    const model = createMetricsModel();
    model.onRuntimeEvent({ type: "agent_start" }, 1000);
    start(model, 1200);
    end(model, 5900);
    let row = model.snapshot(6000).compactions[0];
    expect(row.status).toBe("ok");
    expect(row.before).toBe(148000);
    expect(row.summaryTokens).toBe(820);
    expect(row.durationMs).toBe(4700);
    // Nothing has proved the new size yet, so it is not invented.
    expect(row.after).toBe(0);
    expect(row.saved).toBe(0);

    // The turn's next message_end is the first request after the rewrite.
    assistantTurn(model, { at: 8000, started: 6100, output: 120, input: 31000 });
    row = model.snapshot(8100).compactions[0];
    expect(row.after).toBe(31000);
    expect(row.saved).toBe(117000);
  });

  it("reads the after size from the next prompt when compaction ran between prompts", () => {
    const model = createMetricsModel();
    model.onRuntimeEvent({ type: "agent_start" }, 1000);
    assistantTurn(model, { at: 1500, started: 1100, output: 50, input: 148000 });
    model.onRuntimeEvent({ type: "agent_end" }, 1600);
    start(model, 2000, "manual");
    end(model, 3200, {
      reason: "manual",
      result: { tokensBefore: 148000, usage: { output: 700 } },
    });

    const idle = model.snapshot(3300).compactions[0];
    expect(idle.reason).toBe("manual");
    // It belongs to no prompt, so it must not be counted inside prompt 1.
    expect(idle.turnId).toBe(0);
    expect(model.snapshot(3300).promptLog[0].compactions).toBe(0);

    model.onRuntimeEvent({ type: "agent_start" }, 4000);
    assistantTurn(model, { at: 5000, started: 4100, output: 40, input: 26000 });
    model.onRuntimeEvent({ type: "agent_end" }, 5200);
    const row = model.snapshot(5300).compactions[0];
    expect(row.after).toBe(26000);
    expect(row.saved).toBe(122000);
  });

  it("marks a failed compaction with pi's own reason", () => {
    const model = createMetricsModel();
    model.onRuntimeEvent({ type: "agent_start" }, 1000);
    start(model, 1200);
    end(model, 3000, { result: null, errorMessage: "Upstream 503" });
    const row = model.snapshot(3100).compactions[0];
    expect(row.status).toBe("error");
    expect(row.error).toBe("Upstream 503");
    expect(row.before).toBe(0);
    // A failed compaction rewrote nothing, so the next request's size is not an
    // "after" measurement and must never be presented as one.
    assistantTurn(model, { at: 4000, started: 3200, output: 60, input: 33000 });
    expect(model.snapshot(4100).compactions[0].after).toBe(0);
  });

  it("distinguishes a retry from an abort", () => {
    const model = createMetricsModel();
    model.onRuntimeEvent({ type: "agent_start" }, 1000);
    start(model, 1200);
    end(model, 1600, { result: null, errorMessage: "timeout", willRetry: true });
    start(model, 1700);
    end(model, 1900, { result: null, aborted: true });
    const snap = model.snapshot(2000);
    expect(snap.compactions[0].status).toBe("aborted");
    expect(snap.compactions[1].status).toBe("retrying");
    expect(snap.turn.compactions).toBe(2);
  });

  it("flags a compaction whose end event never arrived", () => {
    const model = createMetricsModel();
    model.onRuntimeEvent({ type: "agent_start" }, 1000);
    start(model, 1200);
    const snap = model.snapshot(200_000);
    expect(snap.compactions[0].stale).toBe(true);
    // A stuck row must not keep the pill claiming work is in progress.
    expect(snap.turn.pendingCompaction).toBe(false);
  });

  it("interleaves the compaction row with prompts, newest first", () => {
    const model = createMetricsModel();
    model.onRuntimeEvent({ type: "agent_start" }, 1000);
    assistantTurn(model, { at: 2000, started: 1100, output: 80, input: 120000 });
    model.onRuntimeEvent({ type: "agent_end" }, 2100);
    model.onRuntimeEvent({ type: "agent_start" }, 3000);
    start(model, 3500);
    end(model, 3600);
    assistantTurn(model, { at: 4000, started: 3700, output: 60, input: 30000 });
    model.onRuntimeEvent({ type: "agent_end" }, 4100);

    const snap = model.snapshot(4200);
    expect(snap.log.map((item) => item.kind)).toEqual(["compaction", "prompt", "prompt"]);
    expect(snap.log[1].prompt.id).toBe(2);
    expect(snap.log[2].prompt.id).toBe(1);
    // The prompt that contained it keeps its own marker, for cross-reference.
    expect(snap.log[1].prompt.compactions).toBe(1);
    expect(snap.log[1].prompt.tools).toHaveLength(0);
  });

  it("drops the compaction log on reset", () => {
    const model = createMetricsModel();
    model.onRuntimeEvent({ type: "agent_start" }, 1000);
    start(model, 1200);
    end(model, 2000);
    expect(model.snapshot(2100).compactions).toHaveLength(1);
    model.reset();
    const snap = model.snapshot(2200);
    expect(snap.compactions).toHaveLength(0);
    expect(snap.log).toHaveLength(0);
  });

  it("keeps one prompt across model calls and sums what they generated", () => {
    const model = createMetricsModel();
    model.onRuntimeEvent({ type: "agent_start" }, 1000);
    const call = (/** @type {number} */ output, /** @type {number} */ input, at) => {
      model.onRuntimeEvent({ type: "turn_start" }, at);
      model.onRuntimeEvent(
        {
          type: "message_end",
          message: {
            role: "assistant",
            usage: { output, input, reasoning: 1, cacheRead: 10, cost: { total: 0.001 } },
          },
        },
        at + 100,
      );
      model.onRuntimeEvent({ type: "turn_end" }, at + 150);
    };
    call(94, 60_000, 1100);
    call(230, 64_000, 1400);

    const running = model.snapshot(1700);
    expect(running.active).toBe(true);
    expect(running.phase).not.toBe("idle");
    expect(running.prompt).toMatchObject({
      outputTokens: 324,
      inputTokens: 64_000,
      reasoningTokens: 2,
      callOutputs: [94, 230],
    });
    expect(running.prompt?.cost).toBeCloseTo(0.002, 6);

    model.onRuntimeEvent({ type: "agent_end" }, 1800);
    const done = model.snapshot(1900);
    expect(done.active).toBe(false);
    expect(done.session.tokens).toBe(324);
    expect(done.promptLog).toHaveLength(1);
  });

  it("shows the newest tool calls of a long prompt and counts all of them", () => {
    const model = createMetricsModel();
    model.onRuntimeEvent({ type: "agent_start" }, 1000);
    for (let index = 0; index < 45; index += 1) {
      model.onRuntimeEvent(
        { type: "tool_execution_start", toolCallId: `t${index}`, toolName: "bash", args: {} },
        1100 + index,
      );
    }
    const prompt = model.snapshot(2000).prompt;
    expect(prompt?.toolCount).toBe(45);
    expect(prompt?.tools).toHaveLength(40);
    expect(prompt?.tools[0]?.id).toBe("t5");
    expect(prompt?.tools.at(-1)?.id).toBe("t44");
  });
});

describe("cacheSharePct", () => {
  it("uses cache / (input + cache) and clamps", () => {
    expect(cacheSharePct(200, 800)).toBe(80);
    expect(cacheSharePct(0, 0)).toBe(0);
    expect(cacheSharePct(0, 100)).toBe(100);
  });
});
