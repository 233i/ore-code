import type { ToolCall } from "@ore-code/protocol";

export type ModelStreamChunk =
  | { type: "assistant_delta"; text: string }
  | { type: "reasoning_delta"; text: string }
  | { type: "tool_call"; call: ToolCall }
  | { type: "usage"; usage: ModelUsage }
  | { type: "done"; finalText?: string; finishReason?: ModelFinishReason };

export type ModelFinishReason = "stop" | "tool_calls" | "length" | "error";

export interface LlmClient {
  streamTurn(input: LlmTurnInput): AsyncIterable<ModelStreamChunk>;
  completePrefix?(input: LlmPrefixCompletionInput): Promise<LlmPrefixCompletionResult>;
  warmupPrefix?(input: LlmWarmupInput): Promise<ModelUsage | undefined>;
}

export interface ModelUsage {
  provider?: string;
  model?: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens?: number;
  cacheHitTokens?: number;
  cacheMissTokens?: number;
  cacheHitRatio?: number;
  reasoningTokens?: number;
  estimated?: boolean;
  costUsd?: number;
  costCny?: number;
  cacheHitInputCostUsd?: number;
  cacheMissInputCostUsd?: number;
  outputCostUsd?: number;
  cacheHitInputCostCny?: number;
  cacheMissInputCostCny?: number;
  outputCostCny?: number;
}

export interface LlmTurnInput {
  threadId: string;
  turnId: string;
  messages: LlmMessage[];
  signal?: AbortSignal;
  tools?: LlmToolDefinition[];
}

export interface LlmWarmupInput {
  threadId: string;
  turnId: string;
  messages: LlmMessage[];
  signal?: AbortSignal;
  tools?: LlmToolDefinition[];
}

export interface LlmPrefixCompletionInput {
  threadId: string;
  turnId: string;
  prefix: string;
  suffix?: string;
  maxTokens?: number;
  stop?: string | string[];
  signal?: AbortSignal;
  allowChatFallback?: boolean;
}

export interface LlmPrefixCompletionResult {
  text: string;
  finishReason?: ModelFinishReason;
  usage?: ModelUsage;
  mode: "fim" | "chat-prefix-fallback";
}

export interface LlmMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  reasoningContent?: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
}

export interface LlmToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: unknown;
  };
}

export class MockLlmClient implements LlmClient {
  constructor(private readonly chunks: ModelStreamChunk[] = []) {}

  async *streamTurn(): AsyncIterable<ModelStreamChunk> {
    for (const chunk of this.chunks) {
      yield chunk;
    }
  }
}
