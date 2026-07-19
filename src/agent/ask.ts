import { chatText } from "../llm/provider";
import { WorkspaceContext, formatContextForPrompt } from "./context";

export interface AskResult {
  answer: string;
}

export async function handleAsk(
  transcript: string,
  ctx: WorkspaceContext,
  payload: Record<string, unknown>,
  signal?: AbortSignal
): Promise<AskResult> {
  const question =
    typeof payload.question === "string" && payload.question.trim()
      ? payload.question.trim()
      : transcript;

  const { content } = await chatText(
    [
      {
        role: "system",
        content: `You are a helpful coding assistant inside the user's editor.
Answer clearly and concisely. Use the provided workspace context. If context is insufficient, say what is missing.`,
      },
      {
        role: "user",
        content: `Question: ${question}\n\nOriginal utterance: ${transcript}\n\n${formatContextForPrompt(ctx)}`,
      },
    ],
    { signal }
  );

  return { answer: content };
}
