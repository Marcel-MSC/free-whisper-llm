import { chatText } from "../llm/provider";
import { WorkspaceContext, formatContextForPrompt } from "./context";

export interface PlanResult {
  markdown: string;
}

export async function handlePlan(
  transcript: string,
  ctx: WorkspaceContext,
  payload: Record<string, unknown>,
  signal?: AbortSignal
): Promise<PlanResult> {
  const goal =
    typeof payload.goal === "string" && payload.goal.trim()
      ? payload.goal.trim()
      : transcript;

  const { content } = await chatText(
    [
      {
        role: "system",
        content: `You are a senior software engineer writing an implementation plan.
Produce a clear markdown plan. Do NOT write or apply code. Do NOT invent files you cannot infer from context.
Include: goal, approach, steps, risks, and files likely touched.`,
      },
      {
        role: "user",
        content: `Goal: ${goal}\n\nOriginal utterance: ${transcript}\n\n${formatContextForPrompt(ctx)}`,
      },
    ],
    { signal }
  );

  return { markdown: content };
}
