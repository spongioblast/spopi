// ABOUTME: The verify gate: after a run that edited files, run the project check once before Pi settles.
// ABOUTME: A failure in a changed file asks the model for one repair, capped; everything else goes to the user.

import * as path from "node:path";
import {
  type AgentBeforeSettleEvent,
  type AgentBeforeSettleEventResult,
  type BashOperations,
  createLocalBashOperations,
  type ExtensionAPI,
  type ExtensionContext,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { type CheckResolution, resolveCheckCommand } from "./check-command";
import { describeChangedFiles, outputTail, relevantOutput, repairMessage } from "./check-report";
import { type CheckRun, runCheck } from "./run-check";

export const STATUS_KEY = "spopi-verify";
export const MESSAGE_TYPE = "spopi-verify";

export type VerifyGateDeps = {
  resolve: (cwd: string) => CheckResolution;
  operations: (cwd: string) => BashOperations;
  run: typeof runCheck;
};

export function defaultVerifyGateDeps(): VerifyGateDeps {
  const cache = new Map<string, BashOperations>();
  return {
    resolve: resolveCheckCommand,
    operations: (cwd) => {
      let ops = cache.get(cwd);
      if (!ops) {
        ops = createLocalBashOperations({ shellPath: configuredShellPath(cwd) });
        cache.set(cwd, ops);
      }
      return ops;
    },
    run: runCheck,
  };
}

function configuredShellPath(cwd: string): string | undefined {
  try {
    return SettingsManager.create(cwd).getShellPath();
  } catch {
    return undefined;
  }
}

/** Pi's own `write` and `edit`, and package tools named like them (`multi_edit`, `hashline_edit`). */
function isFileEditTool(name: string): boolean {
  return name === "write" || name === "edit" || /[_-](edit|write)$/.test(name);
}

function editedPath(input: Record<string, unknown>): string | null {
  for (const key of ["path", "file_path", "filePath"]) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

export function registerVerifyGate(
  pi: ExtensionAPI,
  deps: VerifyGateDeps = defaultVerifyGateDeps(),
) {
  const changed = new Set<string>();
  let repairs = 0;
  // Edits since the last check. After a repair request, no new edit means the
  // model answered that the failure is not its own, and the same check would fail the same way.
  let editsSinceCheck = 0;
  // True once the check has passed in this session: a later failure then comes
  // from what changed since, even when its output names no changed file.
  let cleanBefore = false;

  const status = (ctx: ExtensionContext, text: string | undefined) => {
    if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, text);
  };
  const tell = (ctx: ExtensionContext, text: string, level: "info" | "warning") => {
    if (ctx.hasUI) ctx.ui.notify(text, level);
  };

  const check = async (ctx: ExtensionContext, command: string, timeoutSeconds: number) =>
    deps.run({
      operations: deps.operations(ctx.cwd),
      command,
      cwd: ctx.cwd,
      timeoutSeconds,
      logName: ctx.sessionManager.getSessionId() || "check",
      signal: ctx.signal,
    });

  pi.on("tool_result", (event, ctx) => {
    if (event.isError || !isFileEditTool(event.toolName)) return;
    const file = editedPath(event.input);
    if (!file) return;
    changed.add(path.resolve(ctx.cwd, file));
    editsSinceCheck += 1;
  });

  const reset = () => {
    changed.clear();
    repairs = 0;
    editsSinceCheck = 0;
  };
  pi.on("session_start", () => {
    reset();
    cleanBefore = false;
  });
  pi.on("agent_settled", reset);

  pi.on(
    "agent_before_settle",
    async (
      event: AgentBeforeSettleEvent,
      ctx: ExtensionContext,
    ): Promise<AgentBeforeSettleEventResult | undefined> => {
      if (event.outcome !== "completed" || changed.size === 0) return;
      // The command is the project's own code. Pi's trust decision is the consent to run it.
      if (!ctx.isProjectTrusted() || ctx.hasPendingMessages()) return;
      const resolution = deps.resolve(ctx.cwd);
      if (resolution.kind !== "command") return;
      const { command, timeoutSeconds, maxRepairs } = resolution.check;
      if (repairs > 0 && editsSinceCheck === 0) {
        status(ctx, "check: failed");
        tell(
          ctx,
          `\`${command}\` still fails. The model left it as not caused by its change.`,
          "warning",
        );
        return;
      }

      status(ctx, `check: ${command}`);
      editsSinceCheck = 0;
      const run = await check(ctx, command, timeoutSeconds);
      const outcome = settle(run, {
        files: describeChangedFiles(ctx.cwd, changed),
        repairs,
        maxRepairs,
        cleanBefore,
      });
      if (run.status === "done") cleanBefore = run.exitCode === 0;
      status(ctx, outcome.status);
      if (outcome.notice) tell(ctx, outcome.notice(command, run.logPath), outcome.level);
      if (!outcome.repair) return;

      repairs += 1;
      return {
        entries: [
          ...event.entries,
          {
            type: "custom_message",
            customType: MESSAGE_TYPE,
            content: repairMessage({
              command,
              exitCode: run.status === "done" ? run.exitCode : null,
              lines: outcome.repair,
              logPath: run.logPath,
            }),
            display: true,
            details: { command, repair: repairs, maxRepairs },
          },
        ],
        continue: true,
      };
    },
  );

  pi.registerCommand("verify", {
    description: "Run the project check the verify gate uses, and show the result",
    handler: async (_args, ctx) => {
      const resolution = deps.resolve(ctx.cwd);
      if (resolution.kind === "disabled") {
        tell(ctx, `Verify gate is off for this project (${resolution.source}).`, "info");
        return;
      }
      if (resolution.kind === "none") {
        tell(ctx, "No check found. Add .pi/verify.json with a command.", "info");
        return;
      }
      if (!ctx.isProjectTrusted()) {
        tell(
          ctx,
          "The project is not trusted, so the verify gate does not run commands.",
          "warning",
        );
        return;
      }
      const { command, timeoutSeconds, source } = resolution.check;
      status(ctx, `check: ${command}`);
      const run = await check(ctx, command, timeoutSeconds);
      const passed = run.status === "done" && run.exitCode === 0;
      if (run.status === "done") cleanBefore = passed;
      status(ctx, passed ? "check: passed" : "check: failed");
      const where = run.logPath ? ` Full output: ${run.logPath}` : "";
      const result =
        run.status === "failed-to-run"
          ? `could not run (${run.message})`
          : `exit ${run.exitCode ?? "none"}`;
      tell(ctx, `\`${command}\` from ${source}: ${result}.${where}`, passed ? "info" : "warning");
    },
  });
}

type Settled = {
  status: string;
  level: "info" | "warning";
  notice?: (command: string, logPath: string | null) => string;
  repair?: string[];
};

/** Decides what one check run means for this settle. Exported for tests; no Pi or I/O. */
export function settle(
  run: CheckRun,
  state: {
    files: ReturnType<typeof describeChangedFiles>;
    repairs: number;
    maxRepairs: number;
    cleanBefore: boolean;
  },
): Settled {
  const log = (logPath: string | null) => (logPath ? ` Full output: ${logPath}` : "");
  if (run.status === "failed-to-run") {
    return {
      status: "check: could not run",
      level: "warning",
      notice: (command, logPath) =>
        `Verify gate could not run \`${command}\`: ${run.message}.${log(logPath)}`,
    };
  }
  if (run.exitCode === 0) {
    return state.repairs > 0
      ? {
          status: "check: passed",
          level: "info",
          notice: (command) => `\`${command}\` passes after ${state.repairs} repair(s).`,
        }
      : { status: "check: passed", level: "info" };
  }
  const named = relevantOutput(run.output, state.files);
  const lines = named.length > 0 || !state.cleanBefore ? named : outputTail(run.output);
  if (lines.length === 0) {
    return {
      status: "check: failed outside this change",
      level: "warning",
      notice: (command, logPath) =>
        `\`${command}\` fails, but not in files changed this run.${log(logPath)}`,
    };
  }
  if (state.repairs >= state.maxRepairs) {
    return {
      status: "check: failed",
      level: "warning",
      notice: (command, logPath) =>
        `\`${command}\` still fails after ${state.repairs} repair(s).${log(logPath)}`,
    };
  }
  return {
    status: `check: failed, repair ${state.repairs + 1}/${state.maxRepairs}`,
    level: "info",
    repair: lines,
  };
}
