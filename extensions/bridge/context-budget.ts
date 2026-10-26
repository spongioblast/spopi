// ABOUTME: One prompt line with the active model's context window and Pi's compaction point.
// ABOUTME: The model cannot see its token count; without this it guesses a limit and stops early.

import { type ExtensionAPI, getAgentDir, SettingsManager } from "@earendil-works/pi-coding-agent";

export type Compaction = { enabled: boolean; reserveTokens: number };

type ModelRef = { provider: string; id: string; contextWindow?: number };

const PREFIX = "Your context window is ";

const count = (tokens: number) => Math.round(tokens).toLocaleString("en-US");

export function contextBudgetLine(contextWindow: number, compaction: Compaction): string {
  const window = `${PREFIX}${count(contextWindow)} tokens.`;
  if (!compaction.enabled) {
    return `${window} Auto-compaction is off, so the user compacts when needed. You cannot see your token count, so do not stop or shorten work because you think context is running out.`;
  }
  const at = Math.max(0, contextWindow - compaction.reserveTokens);
  return `${window} Pi compacts the conversation automatically at about ${count(at)} tokens and you keep working after it. You cannot see your token count, so never stop, shorten, or hand off work because you think context is running out.`;
}

export function readCompaction(cwd: string, model: ModelRef): Compaction {
  let manager: SettingsManager;
  try {
    manager = SettingsManager.create(cwd || getAgentDir(), getAgentDir());
  } catch {
    manager = SettingsManager.inMemory();
  }
  return {
    enabled: manager.getCompactionEnabled(),
    reserveTokens: manager.getCompactionReserveTokens(model),
  };
}

export function registerContextBudget(pi: ExtensionAPI, read = readCompaction) {
  pi.on("before_agent_start", (event, ctx) => {
    const options = (event as { systemPromptOptions?: { promptGuidelines?: string[] } })
      .systemPromptOptions;
    if (!options) return undefined;
    const model = ctx.model as ModelRef | undefined;
    const window = model?.contextWindow;
    const kept = (Array.isArray(options.promptGuidelines) ? options.promptGuidelines : []).filter(
      (line) => !line.startsWith(PREFIX),
    );
    if (model && typeof window === "number" && window > 0) {
      kept.push(contextBudgetLine(window, read(ctx.cwd, model)));
    }
    options.promptGuidelines = kept;
    return undefined;
  });
}
