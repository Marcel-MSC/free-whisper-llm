import { getConfig, LlmProvider } from "../config";
import { getApiKey } from "../secrets";

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

export interface ChatOptions {
  signal?: AbortSignal;
  forceJson?: boolean;
}

export async function chat(
  messages: ChatMessage[],
  options?: ChatOptions
): Promise<LlmResponse> {
  const config = getConfig();
  const apiKey = await getApiKey();
  return withRetries(config.llmRetries, () => {
    switch (config.llmProvider) {
      case "ollama":
        return chatOllama(config.llmBaseUrl, config.llmModel, messages, {
          ...options,
          forceJson: true,
          timeoutMs: config.llmTimeoutMs,
        });
      case "openai":
        return chatOpenAi(config.llmBaseUrl, config.llmModel, apiKey, messages, {
          ...options,
          forceJson: true,
          timeoutMs: config.llmTimeoutMs,
        });
      case "anthropic":
        return chatAnthropic(config.llmModel, apiKey, messages, {
          ...options,
          timeoutMs: config.llmTimeoutMs,
        });
      default: {
        const _exhaustive: never = config.llmProvider;
        throw new LlmError(`Unsupported provider: ${_exhaustive}`);
      }
    }
  });
}

/** Free-form chat without forcing JSON (for plan/ask narrative answers). */
export async function chatText(
  messages: ChatMessage[],
  options?: ChatOptions
): Promise<LlmResponse> {
  const config = getConfig();
  const apiKey = await getApiKey();
  return withRetries(config.llmRetries, () => {
    switch (config.llmProvider) {
      case "ollama":
        return chatOllama(config.llmBaseUrl, config.llmModel, messages, {
          ...options,
          forceJson: false,
          timeoutMs: config.llmTimeoutMs,
        });
      case "openai":
        return chatOpenAi(config.llmBaseUrl, config.llmModel, apiKey, messages, {
          ...options,
          forceJson: false,
          timeoutMs: config.llmTimeoutMs,
        });
      case "anthropic":
        return chatAnthropic(config.llmModel, apiKey, messages, {
          ...options,
          timeoutMs: config.llmTimeoutMs,
        });
      default: {
        const _exhaustive: never = config.llmProvider;
        throw new LlmError(`Unsupported provider: ${_exhaustive}`);
      }
    }
  });
}

async function withRetries<T>(retries: number, fn: () => Promise<T>): Promise<T> {
  let last: unknown;
  const attempts = Math.max(1, retries + 1);
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (err instanceof LlmError && /cancel|abort/i.test(err.message)) {
        throw err;
      }
      if (i < attempts - 1) {
        await sleep(300 * Math.pow(2, i));
      }
    }
  }
  throw last instanceof Error ? last : new LlmError(String(last));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

interface RequestOpts extends ChatOptions {
  forceJson?: boolean;
  timeoutMs?: number;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (controller.signal.aborted) {
      throw new LlmError(
        signal?.aborted
          ? "LLM request cancelled."
          : `LLM request timed out after ${Math.round(timeoutMs / 1000)}s.`
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

async function chatOllama(
  baseUrl: string,
  model: string,
  messages: ChatMessage[],
  opts: RequestOpts
): Promise<LlmResponse> {
  const url = `${trimSlash(baseUrl)}/api/chat`;
  const body: Record<string, unknown> = {
    model,
    messages,
    stream: false,
  };
  if (opts.forceJson) {
    body.format = "json";
  }
  const res = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    opts.timeoutMs ?? 90_000,
    opts.signal
  );

  if (!res.ok) {
    const text = await safeText(res);
    throw new LlmError(
      `Ollama error ${res.status}: ${text || res.statusText}. Is Ollama running at ${baseUrl}?`
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
  messages: ChatMessage[],
  opts: RequestOpts
): Promise<LlmResponse> {
  if (!apiKey) {
    throw new LlmError(
      "API key required for OpenAI. Run “Voice Agent: Set API Key”."
    );
  }

  const effectiveBase =
    !baseUrl || baseUrl.includes("11434") ? "https://api.openai.com" : baseUrl;
  const root = effectiveBase.includes("/v1")
    ? trimSlash(effectiveBase)
    : `${trimSlash(effectiveBase)}/v1`;
  const url = `${root}/chat/completions`;
  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: opts.forceJson ? 0.2 : 0.3,
  };
  if (opts.forceJson) {
    body.response_format = { type: "json_object" };
  }

  const res = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    },
    opts.timeoutMs ?? 90_000,
    opts.signal
  );

  if (!res.ok) {
    const text = await safeText(res);
    throw new LlmError(`OpenAI error ${res.status}: ${text || res.statusText}`);
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
  messages: ChatMessage[],
  opts: RequestOpts
): Promise<LlmResponse> {
  if (!apiKey) {
    throw new LlmError(
      "API key required for Anthropic. Run “Voice Agent: Set API Key”."
    );
  }

  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const anthropicMessages = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content,
    }));

  const res = await fetchWithTimeout(
    "https://api.anthropic.com/v1/messages",
    {
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
    },
    opts.timeoutMs ?? 90_000,
    opts.signal
  );

  if (!res.ok) {
    const text = await safeText(res);
    throw new LlmError(`Anthropic error ${res.status}: ${text || res.statusText}`);
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

export async function testProviderConnection(): Promise<string> {
  const config = getConfig();
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(config.llmTimeoutMs, 20_000));
  try {
    const { content } = await chatText(
      [
        { role: "system", content: "Reply with the single word: pong" },
        { role: "user", content: "ping" },
      ],
      { signal: controller.signal }
    );
    const ms = Date.now() - start;
    return `${config.llmProvider}/${config.llmModel} ok in ${ms}ms: ${content.slice(0, 80)}`;
  } finally {
    clearTimeout(timer);
  }
}
