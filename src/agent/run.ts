import { gatherContext } from "./context";
import { routeIntent, RoutedIntent } from "./router";
import { handlePlan } from "./plan";
import { handleAsk } from "./ask";
import { handleEdit } from "./edit";
import { handleShell } from "./shell";
import { track } from "../analytics";
import { formatDiffPreview } from "./diff";

export type AgentProgressStep =
  | "gathering_context"
  | "routing"
  | "searching"
  | "planning"
  | "asking"
  | "editing"
  | "shell"
  | "awaiting_confirm"
  | "done";

export interface AgentRunResult {
  transcript: string;
  routed: RoutedIntent;
  resultMarkdown: string;
}

export interface RunAgentOptions {
  signal?: AbortSignal;
  selectedWorkspaceRoot?: string;
  alwaysApproveEdits?: boolean;
  onProgress?: (step: AgentProgressStep, detail?: string) => void;
}

export async function runAgent(
  transcript: string,
  options?: RunAgentOptions
): Promise<AgentRunResult> {
  const signal = options?.signal;
  const progress = options?.onProgress;

  progress?.("gathering_context");
  const ctx = await gatherContext(transcript, {
    preferredRoot: options?.selectedWorkspaceRoot,
    onSearch: () => progress?.("searching"),
  });

  progress?.("routing");
  const routed = await routeIntent(transcript, ctx, signal);

  await track("agent_intent", {
    intent: routed.intent,
    confidence: Number(routed.confidence.toFixed(2)),
    pro: ctx.proContext,
  });

  let resultMarkdown = "";

  switch (routed.intent) {
    case "plan": {
      progress?.("planning");
      const plan = await handlePlan(transcript, ctx, routed.payload, signal);
      resultMarkdown = plan.markdown;
      break;
    }
    case "ask": {
      progress?.("asking");
      const ask = await handleAsk(transcript, ctx, routed.payload, signal);
      resultMarkdown = ask.answer;
      break;
    }
    case "edit": {
      progress?.("editing");
      const edit = await handleEdit(transcript, ctx, routed.payload, signal, {
        alwaysApprove: options?.alwaysApproveEdits === true,
        onAwaitingConfirm: () => progress?.("awaiting_confirm"),
      });
      const files = edit.edits.map((e) => `- \`${e.path}\``).join("\n") || "_none_";
      const diffBlock = edit.diffs.length
        ? `\n\n### Diff preview\n\`\`\`diff\n${formatDiffPreview(edit.diffs, 6000)}\n\`\`\``
        : "";
      resultMarkdown =
        [
          `**Instruction:** ${edit.instruction}`,
          `**Status:** ${edit.message}`,
          `**Files:**`,
          files,
        ].join("\n\n") + diffBlock;
      break;
    }
    case "shell": {
      progress?.("shell");
      const shell = await handleShell(transcript, ctx, routed.payload, signal, {
        onAwaitingConfirm: () => progress?.("awaiting_confirm"),
      });
      resultMarkdown = [
        `**Shell:** ${shell.shell}`,
        `**Risk:** ${shell.risk}`,
        `**Command:**\n\`\`\`\n${shell.command || "(empty)"}\n\`\`\``,
        `**Status:** ${shell.message}`,
      ].join("\n\n");
      break;
    }
  }

  progress?.("done");
  return { transcript, routed, resultMarkdown };
}
