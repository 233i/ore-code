import { estimateUsageCostDetails } from "./capacity";
import {
  deepSeekThinkingRequestPatch,
  isDeepSeekThinkingExplicitlyEnabled,
  type DeepSeekThinkingLevel
} from "./deepseek-thinking";
import type {
  LlmClient,
  LlmMessage,
  LlmPrefixCompletionInput,
  LlmPrefixCompletionResult,
  LlmToolDefinition,
  LlmTurnInput,
  LlmWarmupInput,
  ModelFinishReason,
  ModelStreamChunk,
  ModelUsage
} from "./llm";

export interface OpenAiCompatibleConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature?: number;
  fetch?: FetchLike;
  headers?: Record<string, string>;
  provider?: string;
  reasoningContentPolicy?: ReasoningContentPolicy;
  deepSeekThinkingLevel?: DeepSeekThinkingLevel;
}

export type FetchLike = (url: string, init: FetchInit) => Promise<StreamResponse>;
export type ReasoningContentPolicy = "when-present" | "required-for-tool-calls";

export interface FetchInit {
  method: "POST";
  headers: Record<string, string>;
  body: string;
  signal?: AbortSignal;
}

export interface StreamResponse {
  ok: boolean;
  status: number;
  statusText: string;
  body: StreamBody | null;
  text(): Promise<string>;
}

export type StreamBody = ReaderBody | AsyncIterable<Uint8Array>;

export interface ReaderBody {
  getReader(): StreamReader;
}

export interface StreamReader {
  read(): Promise<{ done: boolean; value?: Uint8Array }>;
  releaseLock?(): void;
}

interface ChatCompletionChunk {
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    prompt_cache_hit_tokens?: number;
    prompt_cache_miss_tokens?: number;
    prompt_tokens_details?: {
      cached_tokens?: number;
    };
    completion_tokens_details?: {
      reasoning_tokens?: number;
    };
  } | null;
  choices?: Array<{
    delta?: {
      content?: string | null;
      reasoning_content?: string | null;
      tool_calls?: ToolCallDelta[];
    };
    finish_reason?: string | null;
  }>;
}

interface ChatCompletionResponse {
  usage?: ChatCompletionChunk["usage"];
  choices?: Array<{
    message?: {
      content?: string | null;
    };
    text?: string | null;
    finish_reason?: string | null;
  }>;
}

interface ToolCallDelta {
  index?: number;
  id?: string;
  type?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}

interface PendingToolCall {
  id?: string;
  name?: string;
  argumentsText: string;
}

export class OpenAiCompatibleLlmClient implements LlmClient {
  private readonly fetchImpl: FetchLike;

  constructor(private readonly config: OpenAiCompatibleConfig) {
    this.fetchImpl = config.fetch ?? globalFetch;
  }

  async *streamTurn(input: LlmTurnInput): AsyncIterable<ModelStreamChunk> {
    const response = await this.fetchImpl(`${trimTrailingSlash(this.config.baseUrl)}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.config.apiKey}`,
        ...this.config.headers
      },
      signal: input.signal,
      body: JSON.stringify(this.requestBody(input, { stream: true }))
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(formatProviderError(response, body, this.config));
    }

    if (!response.body) {
      throw new Error("LLM response did not include a stream body.");
    }

    const pendingToolCalls = new Map<number, PendingToolCall>();
    let finishReason: ModelFinishReason | undefined;
    let emittedToolCall = false;

    for await (const payload of readSseData(response.body)) {
      if (payload === "[DONE]") {
        for (const chunk of flushToolCalls(pendingToolCalls)) {
          emittedToolCall = true;
          yield chunk;
        }
        yield { type: "done", finishReason: finishReason ?? (emittedToolCall ? "tool_calls" : undefined) };
        return;
      }

      const chunk = parseChunk(payload);
      const usage = usageFromChunk(chunk, this.config.model, this.config.provider);
      if (usage) {
        yield { type: "usage", usage };
      }
      for (const choice of chunk.choices ?? []) {
        const delta = choice.delta;

        if (delta?.reasoning_content) {
          yield { type: "reasoning_delta", text: delta.reasoning_content };
        }

        if (delta?.content) {
          yield { type: "assistant_delta", text: delta.content };
        }

        for (const toolCall of delta?.tool_calls ?? []) {
          mergeToolCallDelta(pendingToolCalls, toolCall);
        }

        if (choice.finish_reason) {
          finishReason = normalizeFinishReason(choice.finish_reason);
        }

        if (choice.finish_reason === "tool_calls") {
          for (const toolCall of flushToolCalls(pendingToolCalls)) {
            emittedToolCall = true;
            yield toolCall;
          }
        }
      }
    }

    for (const chunk of flushToolCalls(pendingToolCalls)) {
      emittedToolCall = true;
      yield chunk;
    }
    yield { type: "done", finishReason: finishReason ?? (emittedToolCall ? "tool_calls" : undefined) };
  }

  async warmupPrefix(input: LlmWarmupInput): Promise<ModelUsage | undefined> {
    if (input.messages.length === 0) {
      return undefined;
    }

    const response = await this.fetchImpl(`${trimTrailingSlash(this.config.baseUrl)}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.config.apiKey}`,
        ...this.config.headers
      },
      signal: input.signal,
      body: JSON.stringify(this.requestBody(input, { stream: false, maxTokens: 1 }))
    });

    const body = await response.text();
    if (!response.ok) {
      throw new Error(formatProviderError(response, body, this.config));
    }

    const parsed = body ? JSON.parse(body) as ChatCompletionResponse : {};
    return usageFromResponse(parsed, this.config.model, this.config.provider);
  }

  async completePrefix(input: LlmPrefixCompletionInput): Promise<LlmPrefixCompletionResult> {
    try {
      return await this.completeFim(input);
    } catch (error) {
      if (input.allowChatFallback === false) {
        throw error;
      }
      return this.completeChatPrefixFallback(input);
    }
  }

  private async completeFim(input: LlmPrefixCompletionInput): Promise<LlmPrefixCompletionResult> {
    const response = await this.fetchImpl(`${trimTrailingSlash(this.config.baseUrl)}/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.config.apiKey}`,
        ...this.config.headers
      },
      signal: input.signal,
      body: JSON.stringify(this.prefixCompletionBody(input))
    });

    const body = await response.text();
    if (!response.ok) {
      throw new Error(formatProviderError(response, body, this.config));
    }

    const parsed = body ? JSON.parse(body) as ChatCompletionResponse : {};
    return {
      text: firstCompletionText(parsed),
      finishReason: normalizeFinishReason(parsed.choices?.[0]?.finish_reason),
      usage: usageFromResponse(parsed, this.config.model, this.config.provider),
      mode: "fim"
    };
  }

  private async completeChatPrefixFallback(input: LlmPrefixCompletionInput): Promise<LlmPrefixCompletionResult> {
    const response = await this.fetchImpl(`${trimTrailingSlash(this.config.baseUrl)}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.config.apiKey}`,
        ...this.config.headers
      },
      signal: input.signal,
      body: JSON.stringify({
        model: this.config.model,
        messages: [
          {
            role: "user",
            content: input.suffix
              ? "Complete the text between the following prefix and suffix. Return only the missing text."
              : "Continue the following prefix. Return only the completion."
          },
          {
            role: "assistant",
            content: input.prefix,
            prefix: true
          },
          ...(input.suffix ? [{ role: "user", content: `Suffix:\n${input.suffix}` }] : [])
        ],
        stream: false,
        max_tokens: boundedPrefixMaxTokens(input.maxTokens),
        temperature: this.config.temperature,
        stop: input.stop,
        tools: undefined
      })
    });

    const body = await response.text();
    if (!response.ok) {
      throw new Error(formatProviderError(response, body, this.config));
    }

    const parsed = body ? JSON.parse(body) as ChatCompletionResponse : {};
    return {
      text: firstCompletionText(parsed),
      finishReason: normalizeFinishReason(parsed.choices?.[0]?.finish_reason),
      usage: usageFromResponse(parsed, this.config.model, this.config.provider),
      mode: "chat-prefix-fallback"
    };
  }

  private requestBody(
    input: Pick<LlmTurnInput, "messages" | "tools">,
    options: { stream: boolean; maxTokens?: number }
  ) {
    const thinkingPatch = deepSeekThinkingRequestPatch(this.config.deepSeekThinkingLevel);
    const includeTemperature = !isDeepSeekThinkingExplicitlyEnabled(this.config.deepSeekThinkingLevel);
    return {
      model: this.config.model,
      messages: input.messages.map((message) => toProviderMessage(
        message,
        this.config.reasoningContentPolicy ?? "when-present"
      )),
      stream: options.stream,
      ...(options.stream ? { stream_options: { include_usage: true } } : {}),
      ...(options.maxTokens !== undefined ? { max_tokens: options.maxTokens } : {}),
      ...(includeTemperature ? { temperature: this.config.temperature } : {}),
      ...thinkingPatch,
      tools: input.tools?.length ? input.tools : undefined
    };
  }

  private prefixCompletionBody(input: LlmPrefixCompletionInput) {
    return {
      model: this.config.model,
      prompt: input.prefix,
      suffix: input.suffix,
      stream: false,
      max_tokens: boundedPrefixMaxTokens(input.maxTokens),
      temperature: this.config.temperature,
      stop: input.stop
    };
  }
}

function usageFromChunk(chunk: ChatCompletionChunk, model: string, provider: string | undefined): ModelUsage | undefined {
  return usageFromResponse(chunk, model, provider);
}

function usageFromResponse(response: ChatCompletionResponse, model: string, provider: string | undefined): ModelUsage | undefined {
  const usage = response.usage;
  if (!usage) {
    return undefined;
  }
  const cachedTokens = usage.prompt_tokens_details?.cached_tokens ?? usage.prompt_cache_hit_tokens ?? 0;
  const promptTokens = usage.prompt_tokens ?? 0;
  const cacheMissTokens = usage.prompt_cache_miss_tokens ?? Math.max(0, promptTokens - cachedTokens);
  const modelUsage: ModelUsage = {
    provider,
    model,
    promptTokens,
    completionTokens: usage.completion_tokens ?? 0,
    totalTokens: usage.total_tokens ?? (promptTokens + (usage.completion_tokens ?? 0)),
    cachedTokens,
    cacheHitTokens: cachedTokens,
    cacheMissTokens,
    cacheHitRatio: promptTokens > 0 ? cachedTokens / promptTokens : 0,
    reasoningTokens: usage.completion_tokens_details?.reasoning_tokens
  };
  const cost = estimateUsageCostDetails(model, modelUsage);
  return {
    ...modelUsage,
    costUsd: cost?.totalUsd,
    costCny: cost?.totalCny,
    cacheHitInputCostUsd: cost?.cacheHitInputUsd,
    cacheMissInputCostUsd: cost?.cacheMissInputUsd,
    outputCostUsd: cost?.outputUsd,
    cacheHitInputCostCny: cost?.cacheHitInputCny,
    cacheMissInputCostCny: cost?.cacheMissInputCny,
    outputCostCny: cost?.outputCny
  };
}

function boundedPrefixMaxTokens(value: number | undefined) {
  if (value === undefined) {
    return 512;
  }
  return Math.max(1, Math.min(4096, Math.floor(value)));
}

function firstCompletionText(response: ChatCompletionResponse) {
  const choice = response.choices?.[0];
  return choice?.text ?? choice?.message?.content ?? "";
}

function toProviderMessage(message: LlmMessage, reasoningContentPolicy: ReasoningContentPolicy): Record<string, unknown> {
  if (message.role === "tool") {
    return {
      role: "tool",
      tool_call_id: message.toolCallId,
      content: message.content
    };
  }

  if (message.role === "assistant" && message.toolCalls?.length) {
    return {
      role: "assistant",
      content: message.content || null,
      reasoning_content: assistantReasoningContent(message, reasoningContentPolicy),
      tool_calls: message.toolCalls.map((call) => ({
        id: call.id,
        type: "function",
        function: {
          name: call.name,
          arguments: JSON.stringify(call.input ?? {})
        }
      }))
    };
  }

  if (message.role === "assistant" && message.reasoningContent) {
    return {
      role: "assistant",
      content: message.content,
      reasoning_content: message.reasoningContent
    };
  }

  return {
    role: message.role,
    content: message.content
  };
}

function assistantReasoningContent(message: LlmMessage, policy: ReasoningContentPolicy) {
  if (message.reasoningContent) {
    return message.reasoningContent;
  }

  return policy === "required-for-tool-calls" ? "(reasoning omitted)" : undefined;
}

function normalizeFinishReason(value: string | null | undefined): ModelFinishReason | undefined {
  if (!value) {
    return undefined;
  }
  if (value === "tool_calls" || value === "length" || value === "stop") {
    return value;
  }
  return "error";
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function parseChunk(payload: string): ChatCompletionChunk {
  const parsed: unknown = JSON.parse(payload);
  if (!isRecord(parsed)) {
    return {};
  }
  return parsed as ChatCompletionChunk;
}

async function* readSseData(body: StreamBody): AsyncIterable<string> {
  let buffer = "";

  for await (const text of readTextChunks(body)) {
    buffer += text;
    const frames = buffer.split(/\r?\n\r?\n/);
    buffer = frames.pop() ?? "";

    for (const frame of frames) {
      const data = frame
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n")
        .trim();

      if (data) {
        yield data;
      }
    }
  }

  const tail = buffer.trim();
  if (tail.startsWith("data:")) {
    yield tail.slice(5).trimStart();
  }
}

async function* readTextChunks(body: StreamBody): AsyncIterable<string> {
  const decoder = new TextDecoder();

  if (isAsyncIterable(body)) {
    for await (const chunk of body) {
      yield decoder.decode(chunk, { stream: true });
    }
    const tail = decoder.decode();
    if (tail) {
      yield tail;
    }
    return;
  }

  const reader = body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value) {
        yield decoder.decode(value, { stream: true });
      }
    }

    const tail = decoder.decode();
    if (tail) {
      yield tail;
    }
  } finally {
    reader.releaseLock?.();
  }
}

function mergeToolCallDelta(pendingToolCalls: Map<number, PendingToolCall>, delta: ToolCallDelta): void {
  const index = delta.index ?? 0;
  const current = pendingToolCalls.get(index) ?? { argumentsText: "" };

  current.id = delta.id ?? current.id;
  current.name = delta.function?.name ?? current.name;
  current.argumentsText += delta.function?.arguments ?? "";

  pendingToolCalls.set(index, current);
}

function* flushToolCalls(pendingToolCalls: Map<number, PendingToolCall>): Iterable<ModelStreamChunk> {
  const sorted = [...pendingToolCalls.entries()].sort(([left], [right]) => left - right);
  pendingToolCalls.clear();

  for (const [index, pending] of sorted) {
    if (!pending.name) {
      continue;
    }

    yield {
      type: "tool_call",
      call: {
        id: pending.id ?? `tool-call-${index}`,
        name: pending.name,
        input: parseToolArguments(pending.argumentsText)
      }
    };
  }
}

function parseToolArguments(value: string): unknown {
  if (!value.trim()) {
    return {};
  }

  try {
    return JSON.parse(value);
  } catch {
    return { arguments: value };
  }
}

function isAsyncIterable(value: StreamBody): value is AsyncIterable<Uint8Array> {
  return Symbol.asyncIterator in value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function globalFetch(url: string, init: FetchInit): Promise<StreamResponse> {
  return fetch(url, init) as Promise<StreamResponse>;
}

function formatProviderError(response: StreamResponse, body: string, config: OpenAiCompatibleConfig) {
  const base = `LLM request failed: ${response.status} ${response.statusText}${body ? ` - ${body}` : ""}`;
  if (response.status !== 400 || !/deepseek/i.test(config.model)) {
    return base;
  }

  if (/reasoning_content|tool_calls?|tool_call_id|messages/i.test(body)) {
    return `${base}\nDeepSeek thinking mode requires assistant tool-call history to replay reasoning_content and matching tool messages. Try reloading the thread after the latest Ore Code reasoning ledger migration, or start a new thread if the saved history predates reasoning replay.`;
  }

  return base;
}

export const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com/beta";
export const DEFAULT_DEEPSEEK_MODEL = "deepseek-v4-pro";

export function createDeepSeekClient(input: {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  fetch?: FetchLike;
  deepSeekThinkingLevel?: DeepSeekThinkingLevel;
}): OpenAiCompatibleLlmClient {
  return new OpenAiCompatibleLlmClient({
    apiKey: input.apiKey,
    baseUrl: input.baseUrl ?? DEFAULT_DEEPSEEK_BASE_URL,
    model: input.model ?? DEFAULT_DEEPSEEK_MODEL,
    provider: "deepseek",
    fetch: input.fetch,
    reasoningContentPolicy: "required-for-tool-calls",
    deepSeekThinkingLevel: input.deepSeekThinkingLevel
  });
}

export function createOpenAiCompatibleTool(name: string, description: string, parameters: unknown): LlmToolDefinition {
  return {
    type: "function",
    function: { name, description, parameters }
  };
}
