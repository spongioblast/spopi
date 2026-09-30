// ABOUTME: Generates concise model-backed titles for persisted Pi sessions.
// ABOUTME: Keeps title parsing and transcript shaping isolated and testable.

import {
  createAgentSession,
  type ModelRuntime,
  SessionManager,
} from "@earendil-works/pi-coding-agent";

const TITLE_TIMEOUT_MS = 90_000;
const MAX_TITLE_LENGTH = 80;
const MAX_TRANSCRIPT_LENGTH = 24_000;

const TITLE_PROMPT = `Create a concise title for this session based on the conversation below.

Requirements:
- Match the primary language used by the user.
- Describe the user's concrete goal or outcome.
- Use 4-12 words for space-separated languages, or 8-24 characters for CJK text when practical.
- Return only the title as plain text, with no quotes, label, markdown, or explanation.`;

type MessageEntry = {
  type?: string;
  message?: {
    role?: string;
    content?: unknown;
  };
};

function messageText(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (block): block is { type: "text"; text: string } =>
        Boolean(block) &&
        typeof block === "object" &&
        (block as { type?: unknown }).type === "text" &&
        typeof (block as { text?: unknown }).text === "string",
    )
    .map((block) => block.text)
    .join("\n")
    .trim();
}

export function buildTitleTranscript(entries: MessageEntry[]): string {
  const lines: string[] = [];
  for (const entry of entries) {
    if (entry.type !== "message") continue;
    const role = entry.message?.role;
    if (role !== "user" && role !== "assistant") continue;
    const text = messageText(entry.message?.content);
    if (!text) continue;
    lines.push(`${role === "user" ? "User" : "Assistant"}: ${text}`);
  }

  const transcript = lines.join("\n\n");
  if (transcript.length <= MAX_TRANSCRIPT_LENGTH) return transcript;
  return transcript.slice(0, MAX_TRANSCRIPT_LENGTH).trimEnd();
}

function stripWrappingQuotes(value: string): string {
  const pairs: Array<[string, string]> = [
    ['"', '"'],
    ["'", "'"],
    ["`", "`"],
    ["“", "”"],
    ["「", "」"],
    ["『", "』"],
  ];
  for (const [start, end] of pairs) {
    if (value.startsWith(start) && value.endsWith(end) && value.length > 2) {
      return value.slice(start.length, -end.length).trim();
    }
  }
  return value;
}

export function parseGeneratedSessionTitle(raw: string): string {
  let value = raw.trim();
  const fenced = value.match(/^```(?:json|text)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) value = fenced[1].trim();

  if (value.startsWith("{")) {
    try {
      const parsed = JSON.parse(value) as { title?: unknown };
      if (typeof parsed.title === "string") value = parsed.title.trim();
    } catch {
      // Treat malformed JSON as plain model output.
    }
  }

  value = value.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, "");
  const closed = value.match(/<\/think(?:ing)?>/i);
  if (closed?.index != null) {
    const last = value.toLowerCase().lastIndexOf(closed[0].toLowerCase());
    value = value.slice(last + closed[0].length);
  }
  if (/<think(?:ing)?>/i.test(value)) {
    throw new Error("The model returned unfinished reasoning");
  }
  value = value.trim();

  value = value.split(/\r?\n/, 1)[0] ?? "";
  value = value.replace(/^(?:session\s+title|title|标题)\s*[:：-]\s*/i, "");
  value = stripWrappingQuotes(value).replace(/\s+/g, " ").trim();
  value = value.replace(/[。.!]+$/u, "").trim();
  if (!/[\p{L}\p{N}]/u.test(value)) throw new Error("The model did not return a usable title");

  const characters = Array.from(value);
  return characters.length > MAX_TITLE_LENGTH
    ? characters.slice(0, MAX_TITLE_LENGTH).join("").trim()
    : value;
}

export type GenerateTitleRuntime = {
  model?: unknown;
  modelRuntime?: ModelRuntime;
};

export async function generateTitleForSession(
  sessionFile: string,
  runtime: GenerateTitleRuntime,
): Promise<string> {
  const entries = SessionManager.open(sessionFile).getEntries() as MessageEntry[];
  const transcript = buildTitleTranscript(entries);
  if (!transcript.includes("User:")) throw new Error("The session has no user messages to name");

  return generateTitleFromTranscript(transcript, runtime);
}

export async function generateTitleForPrompt(
  prompt: string,
  runtime: GenerateTitleRuntime,
): Promise<string> {
  const text = prompt.trim();
  if (!text) throw new Error("The prompt is empty");
  const transcript = buildTitleTranscript([
    { type: "message", message: { role: "user", content: text } },
  ]);
  return generateTitleFromTranscript(transcript, runtime);
}

async function generateTitleFromTranscript(
  transcript: string,
  runtime: GenerateTitleRuntime,
): Promise<string> {
  const { session } = await createAgentSession({
    ...(runtime.model ? { model: runtime.model } : {}),
    thinkingLevel: "off",
    tools: [],
    sessionManager: SessionManager.inMemory(),
    ...(runtime.modelRuntime ? { modelRuntime: runtime.modelRuntime } : {}),
  } as unknown as Parameters<typeof createAgentSession>[0]);

  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const run = session.prompt(`${TITLE_PROMPT}\n\n<conversation>\n${transcript}\n</conversation>`);
    await Promise.race([
      run,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          session.abort();
          reject(new Error("Session title generation timed out"));
        }, TITLE_TIMEOUT_MS);
      }),
    ]);

    const messages = session.agent.state.messages;
    for (let index = messages.length - 1; index >= 0; index--) {
      const message = messages[index];
      if (message.role !== "assistant") continue;
      const text = message.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n");
      if (text.trim()) return parseGeneratedSessionTitle(text);
    }
    throw new Error("The model did not return a title");
  } finally {
    if (timeout) clearTimeout(timeout);
    session.dispose();
  }
}
