import { gatherContext } from "./context";
import { routeIntent, RoutedIntent } from "./router";
import { handlePlan } from "./plan";
import { handleAsk } from "./ask";
import { handleEdit } from "./edit";
import { handleShell } from "./shell";
import { track } from "../analytics";
import { formatDiffPreview } from "./diff";

export interface AgentRunResult {
  transcript: string;
  routed: RoutedIntent;
  resultMarkdown: string;
}

export interface RunAgentOptions {
  signal?: AbortSignal;
}

export async function runAgent(
  transcript: string,
  options?: RunAgentOptions
): Promise<AgentRunResult> {
  const signal = options?.signal;
  const ctx = await gatherContext(transcript);
  const routed = await routeIntent(transcript, ctx, signal);

  await track("agent_intent", {
    intent: routed.intent,
    confidence: Number(routed.confidence.toFixed(2)),
    pro: ctx.proContext,
  });

  let resultMarkdown = "";

  switch (routed.intent) {
    case "plan": {
      const plan = await handlePlan(transcript, ctx, routed.payload, signal);
      resultMarkdown = plan.markdown;
      break;
    }
    case "ask": {
      const ask = await handleAsk(transcript, ctx, routed.payload, signal);
      resultMarkdown = ask.answer;
      break;
    }
    case "edit": {
      const edit = await handleEdit(transcript, ctx, routed.payload, signal);
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
      const shell = await handleShell(transcript, ctx, routed.payload, signal);
      resultMarkdown = [
        `**Shell:** ${shell.shell}`,
        `**Risk:** ${shell.risk}`,
        `**Command:**\n\`\`\`\n${shell.command || "(empty)"}\n\`\`\``,
        `**Status:** ${shell.message}`,
      ].join("\n\n");
      break;
    }
  }

  return { transcript, routed, resultMarkdown };
}
