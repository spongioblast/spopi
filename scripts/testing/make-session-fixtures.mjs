// ABOUTME: Writes the golden Pi 0.87 session JSONL fixture.
// ABOUTME: --from-pi records a live run when PI_BIN is set.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const out = join(root, "tests", "fixtures", "pi-sessions", "0.87.1", "scripted.jsonl");

const lines = [
  {
    type: "session",
    version: 3,
    id: "scripted",
    timestamp: "2026-01-02T03:04:05.000Z",
    cwd: "/workspace",
  },
  {
    type: "session_info",
    id: "info-1",
    parentId: null,
    timestamp: "2026-01-02T03:04:06.000Z",
    name: "Scripted",
  },
  {
    type: "model_change",
    id: "model-1",
    parentId: "info-1",
    timestamp: "2026-01-02T03:04:07.000Z",
    provider: "fake",
    modelId: "fake-1",
  },
  {
    type: "thinking_level_change",
    id: "think-1",
    parentId: "model-1",
    timestamp: "2026-01-02T03:04:08.000Z",
    thinkingLevel: "off",
  },
  {
    type: "message",
    id: "user-1",
    parentId: "think-1",
    timestamp: "2026-01-02T03:04:09.000Z",
    message: { role: "user", content: "hello fixture" },
  },
  {
    type: "message",
    id: "assistant-1",
    parentId: "user-1",
    timestamp: "2026-01-02T03:04:10.000Z",
    message: {
      role: "assistant",
      model: "fake-1",
      content: [
        { type: "text", text: "hi" },
        { type: "toolCall", id: "call-1", name: "read", arguments: {} },
      ],
      usage: { input: 10, output: 4, cacheRead: 1, cacheWrite: 2, cost: { total: 0.25 } },
    },
  },
  {
    type: "usage",
    id: "usage-1",
    parentId: "assistant-1",
    timestamp: "2026-01-02T03:04:11.000Z",
    kind: "cache_warm",
    provider: "fake",
    model: "fake-1",
  },
  {
    type: "label",
    id: "label-1",
    parentId: "assistant-1",
    timestamp: "2026-01-02T03:04:12.000Z",
    label: "checkpoint",
  },
  {
    type: "custom",
    id: "custom-1",
    parentId: "label-1",
    timestamp: "2026-01-02T03:04:13.000Z",
    customType: "note",
    data: {},
  },
  {
    type: "custom_message",
    id: "custom-message-1",
    parentId: "custom-1",
    timestamp: "2026-01-02T03:04:14.000Z",
    message: { role: "custom", content: "note" },
  },
  {
    type: "branch_summary",
    id: "branch-1",
    parentId: "custom-message-1",
    timestamp: "2026-01-02T03:04:15.000Z",
    summary: "branched",
  },
  {
    type: "compaction",
    id: "compaction-1",
    parentId: "branch-1",
    timestamp: "2026-01-02T03:04:16.000Z",
    summary: "compacted",
  },
  {
    type: "context_edit",
    id: "edit-1",
    parentId: "compaction-1",
    timestamp: "2026-01-02T03:04:17.000Z",
    targetId: "user-1",
    op: "trim",
  },
];

if (process.argv.includes("--from-pi")) {
  if (!process.env.PI_BIN) {
    console.error("PI_BIN is required for --from-pi");
    process.exit(1);
  }
  console.error(
    "--from-pi records a live session with the pinned binary. The committed fixture stays the golden file until that run replaces it.",
  );
  process.exit(1);
}

await mkdir(dirname(out), { recursive: true });
await writeFile(out, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
console.log(out);
