import { chat } from "../llm/provider";
import { getConfig } from "../config";
import { WorkspaceContext, formatContextForPrompt } from "./context";

export type Intent = "plan" | "ask" | "edit" | "shell";

export interface RoutedIntent {
  intent: Intent;
  confidence: number;
  summary: string;
  payload: Record<string, unknown>;
  raw: string;
}

const SYSTEM = `You are an intent classifier for a voice coding agent inside VS Code/Cursor.
Given a user utterance (speech-to-text) and editor context, classify into exactly one intent:

- plan: user wants a plan/strategy for a change, without applying edits yet
- ask: user asks a question about code, concepts, or the workspace
- edit: user wants code files created or modified
- shell: user wants a terminal command (bash, powershell, or cmd)

Respond with ONLY valid JSON (no markdown fences) in this shape:
{
  "intent": "plan" | "ask" | "edit" | "shell",
  "confidence": 0.0-1.0,
  "summary": "short restatement of what the user wants",
  "payload": {
    // for plan: { "goal": "..." }
    // for ask: { "question": "..." }
    // for edit: { "instruction": "..." }
    // for shell: { "goal": "...", "commandHint": "optional draft command" }
  }
}

Rules:
- Prefer "edit" when the user asks to change/add/fix/delete code.
- Prefer "shell" for install, git, npm, docker, build, run tests, list files via CLI, etc.
- Prefer "plan" when they say plan, outline, how would we, strategy, without asking you to apply now.
- Prefer "ask" for explanations and questions.
- confidence < 0.55 should still pick the best intent; the host may fall back to ask.`;

export async function routeIntent(
  transcript: string,
  ctx: WorkspaceContext,
  signal?: AbortSignal
): Promise<RoutedIntent> {
  const config = getConfig();
  const user = `Utterance:\n"""${transcript}"""\n\nContext:\n${formatContextForPrompt(ctx)}`;

  const { content } = await chat(
    [
      { role: "system", content: SYSTEM },
      { role: "user", content: user },
    ],
    { signal }
  );

  const parsed = parseRouterJson(content);
  let intent = normalizeIntent(parsed.intent);
  let confidence =
    typeof parsed.confidence === "number" && !Number.isNaN(parsed.confidence)
      ? Math.min(1, Math.max(0, parsed.confidence))
      : 0.5;

  if (confidence < config.confidenceThreshold) {
    intent = "ask";
    confidence = Math.max(confidence, config.confidenceThreshold);
  }

  const summary =
    typeof parsed.summary === "string" && parsed.summary.trim()
      ? parsed.summary.trim()
      : transcript.slice(0, 200);

  const payload =
    parsed.payload && typeof parsed.payload === "object" && !Array.isArray(parsed.payload)
      ? (parsed.payload as Record<string, unknown>)
      : defaultPayload(intent, transcript);

  return { intent, confidence, summary, payload, raw: content };
}

function defaultPayload(intent: Intent, transcript: string): Record<string, unknown> {
  switch (intent) {
    case "plan":
      return { goal: transcript };
    case "ask":
      return { question: transcript };
    case "edit":
      return { instruction: transcript };
    case "shell":
      return { goal: transcript };
  }
}

function normalizeIntent(value: unknown): Intent {
  if (value === "plan" || value === "ask" || value === "edit" || value === "shell") {
    return value;
  }
  return "ask";
}

function parseRouterJson(content: string): {
  intent?: unknown;
  confidence?: unknown;
  summary?: unknown;
  payload?: unknown;
} {
  const cleaned = stripFences(content);
  try {
    return JSON.parse(cleaned) as {
      intent?: unknown;
      confidence?: unknown;
      summary?: unknown;
      payload?: unknown;
    };
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]) as {
          intent?: unknown;
          confidence?: unknown;
          summary?: unknown;
          payload?: unknown;
        };
      } catch {
        // fall through
      }
    }
    return {
      intent: "ask",
      confidence: 0.4,
      summary: content.slice(0, 200),
      payload: { question: content },
    };
  }
}

function stripFences(text: string): string {
  const trimmed = text.trim();
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fence ? fence[1].trim() : trimmed;
}
