import { getConfig, LlmProvider } from "../config";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmResponse {
  content: string;
}

export class LlmError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmError";
  }
}

export async function chat(messages: ChatMessage[]): Promise<LlmResponse> {
  const config = getConfig();
  switch (config.llmProvider) {
    case "ollama":
      return chatOllama(config.llmBaseUrl, config.llmModel, messages);
    case "openai":
      return chatOpenAi(config.llmBaseUrl, config.llmModel, config.llmApiKey, messages);
    case "anthropic":
      return chatAnthropic(config.llmModel, config.llmApiKey, messages);
    default: {
      const _exhaustive: never = config.llmProvider;
      throw new LlmError(`Unsupported provider: ${_exhaustive}`);
    }
  }
}

async function chatOllama(
  baseUrl: string,
  model: string,
  messages: ChatMessage[]
): Promise<LlmResponse> {
  const url = `${trimSlash(baseUrl)}/api/chat`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      format: "json",
    }),
  });

  if (!res.ok) {
    const body = await safeText(res);
    throw new LlmError(
      `Ollama error ${res.status}: ${body || res.statusText}. Is Ollama running at ${baseUrl}?`
    );
  }

  const data = (await res.json()) as { message?: { content?: string } };
  const content = data.message?.content?.trim() ?? "";
  if (!content) {
    throw new LlmError("Ollama returned an empty response.");
  }
  return { content };
}

async function chatOpenAi(
  baseUrl: string,
  model: string,
  apiKey: string,
  messages: ChatMessage[]
): Promise<LlmResponse> {
  if (!apiKey) {
    throw new LlmError("voiceAgent.llm.apiKey is required for OpenAI.");
  }

  const effectiveBase =
    !baseUrl || baseUrl.includes("11434") ? "https://api.openai.com" : baseUrl;
  const root = effectiveBase.includes("/v1")
    ? trimSlash(effectiveBase)
    : `${trimSlash(effectiveBase)}/v1`;
  const url = `${root}/chat/completions`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.2,
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    const body = await safeText(res);
    throw new LlmError(`OpenAI error ${res.status}: ${body || res.statusText}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content?.trim() ?? "";
  if (!content) {
    throw new LlmError("OpenAI returned an empty response.");
  }
  return { content };
}

async function chatAnthropic(
  model: string,
  apiKey: string,
  messages: ChatMessage[]
): Promise<LlmResponse> {
  if (!apiKey) {
    throw new LlmError("voiceAgent.llm.apiKey is required for Anthropic.");
  }

  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const anthropicMessages = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content,
    }));

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system: system || undefined,
      messages: anthropicMessages,
    }),
  });

  if (!res.ok) {
    const body = await safeText(res);
    throw new LlmError(`Anthropic error ${res.status}: ${body || res.statusText}`);
  }

  const data = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };
  const content =
    data.content
      ?.filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("\n")
      .trim() ?? "";
  if (!content) {
    throw new LlmError("Anthropic returned an empty response.");
  }
  return { content };
}

/** Free-form chat without forcing JSON (for plan/ask narrative answers). */
export async function chatText(messages: ChatMessage[]): Promise<LlmResponse> {
  const config = getConfig();
  switch (config.llmProvider) {
    case "ollama":
      return chatOllamaText(config.llmBaseUrl, config.llmModel, messages);
    case "openai":
      return chatOpenAiText(config.llmBaseUrl, config.llmModel, config.llmApiKey, messages);
    case "anthropic":
      return chatAnthropic(config.llmModel, config.llmApiKey, messages);
    default: {
      const _exhaustive: never = config.llmProvider;
      throw new LlmError(`Unsupported provider: ${_exhaustive}`);
    }
  }
}

async function chatOllamaText(
  baseUrl: string,
  model: string,
  messages: ChatMessage[]
): Promise<LlmResponse> {
  const url = `${trimSlash(baseUrl)}/api/chat`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, stream: false }),
  });
  if (!res.ok) {
    const body = await safeText(res);
    throw new LlmError(
      `Ollama error ${res.status}: ${body || res.statusText}. Is Ollama running at ${baseUrl}?`
    );
  }
  const data = (await res.json()) as { message?: { content?: string } };
  const content = data.message?.content?.trim() ?? "";
  if (!content) {
    throw new LlmError("Ollama returned an empty response.");
  }
  return { content };
}

async function chatOpenAiText(
  baseUrl: string,
  model: string,
  apiKey: string,
  messages: ChatMessage[]
): Promise<LlmResponse> {
  if (!apiKey) {
    throw new LlmError("voiceAgent.llm.apiKey is required for OpenAI.");
  }
  const effectiveBase =
    !baseUrl || baseUrl.includes("11434") ? "https://api.openai.com" : baseUrl;
  const root = effectiveBase.includes("/v1")
    ? trimSlash(effectiveBase)
    : `${trimSlash(effectiveBase)}/v1`;
  const url = `${root}/chat/completions`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, messages, temperature: 0.3 }),
  });
  if (!res.ok) {
    const body = await safeText(res);
    throw new LlmError(`OpenAI error ${res.status}: ${body || res.statusText}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content?.trim() ?? "";
  if (!content) {
    throw new LlmError("OpenAI returned an empty response.");
  }
  return { content };
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

export function providerLabel(provider: LlmProvider): string {
  return provider;
}
