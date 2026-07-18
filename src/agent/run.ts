import * as vscode from "vscode";
import { gatherContext } from "./context";
import { routeIntent, RoutedIntent } from "./router";
import { handlePlan } from "./plan";
import { handleAsk } from "./ask";
import { handleEdit } from "./edit";
import { handleShell } from "./shell";

export interface AgentRunResult {
  transcript: string;
  routed: RoutedIntent;
  resultMarkdown: string;
}

export async function runAgent(transcript: string): Promise<AgentRunResult> {
  const ctx = await gatherContext();
  const routed = await routeIntent(transcript, ctx);

  let resultMarkdown = "";

  switch (routed.intent) {
    case "plan": {
      const plan = await handlePlan(transcript, ctx, routed.payload);
      resultMarkdown = plan.markdown;
      break;
    }
    case "ask": {
      const ask = await handleAsk(transcript, ctx, routed.payload);
      resultMarkdown = ask.answer;
      break;
    }
    case "edit": {
      const edit = await handleEdit(transcript, ctx, routed.payload);
      const files = edit.edits.map((e) => `- \`${e.path}\``).join("\n") || "_none_";
      resultMarkdown = [
        `**Instruction:** ${edit.instruction}`,
        `**Status:** ${edit.message}`,
        `**Files:**`,
        files,
      ].join("\n\n");
      break;
    }
    case "shell": {
      const shell = await handleShell(transcript, ctx, routed.payload);
      resultMarkdown = [
        `**Shell:** ${shell.shell}`,
        `**Command:**\n\`\`\`\n${shell.command || "(empty)"}\n\`\`\``,
        `**Status:** ${shell.message}`,
      ].join("\n\n");
      break;
    }
  }

  return { transcript, routed, resultMarkdown };
}
