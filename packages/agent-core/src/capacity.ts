import type { LlmMessage, LlmToolDefinition, ModelUsage } from "./llm";
import {
  contextWindowForModel,
  inputBudgetForModel,
  maxOutputTokensForModel,
  SAFETY_HEADROOM_TOKENS
} from "./model-metadata";
import {
  buildRequestSegments,
  requestPrefixHash,
  requestPromptHash,
  sortToolDefinitions,
  toCanonicalRequestMessage
} from "./request-assembler";
import type { ReasoningRetentionReport } from "./reasoning-retention";
import type { ContextCheckpointReport } from "./checkpoint-controller";
import type { RequestSegmentName } from "./segment-hash";

export type CapacityStatus = "ok" | "warning" | "critical";
export type ContextSeamLevel = "ok" | "l1" | "l2" | "l3" | "cycle" | "hard";
export type CacheWarmupStatus = "disabled" | "unsupported" | "hit" | "warmed" | "failed";
export type CachePrefixLayerName = RequestSegmentName;

export interface CachePrefixLayer {
  name: CachePrefixLayerName;
  label: string;
  hash: string;
  chars: number;
  tokens: number;
  includedInPrefix: boolean;
  cacheStable: boolean;
}

export interface CachePrefixReport {
  prefixHash: string;
  promptHash: string;
  cacheablePrefixTokens: number;
  dynamicTokens: number;
  layers: CachePrefixLayer[];
}

export interface CapacityReport {
  provider?: string;
  model?: string;
  contextWindow: number;
  estimatedInputTokens: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  safetyHeadroomTokens: number;
  reasoningReplayTokens: number;
  reasoningRetention?: ReasoningRetentionReport;
  checkpoint?: ContextCheckpointReport;
  prefixHash: string;
  cachePrefix: CachePrefixReport;
  cacheWarmupStatus?: CacheWarmupStatus;
  cacheWarmupMessage?: string;
  cacheWarmupKey?: string;
  cacheWarmupUpdatedAt?: string;
  seamLevel: ContextSeamLevel;
  seamThresholdTokens: number;
  hardLimitTokens: number;
  seamMessage: string;
  shouldCompressToolOutputs: boolean;
  shouldCompressHistory: boolean;
  shouldGenerateBriefing: boolean;
  utilization: number;
  status: CapacityStatus;
  truncated: boolean;
  omittedMessages: number;
  compressed: boolean;
  summaryTokens: number;
}

export interface CapacityOptions {
  maxInputTokens?: number;
  warningRatio?: number;
  criticalRatio?: number;
}

const DEFAULT_WARNING_RATIO = 0.75;
const DEFAULT_CRITICAL_RATIO = 0.9;
const TOKEN_CHARS_DIVISOR = 3.3;
const CONSERVATIVE_TOKEN_MULTIPLIER = 1.35;
const MESSAGE_FRAMING_TOKENS = 4;
const TOOL_SCHEMA_FRAMING_TOKENS = 8;
const DEEPSEEK_SEAMS: Array<{ level: ContextSeamLevel; threshold: number; message: string }> = [
  { level: "hard", threshold: 930_000, message: "需要压缩或减少上下文后再发送。" },
  { level: "cycle", threshold: 768_000, message: "建议生成本轮 briefing，并准备压缩旧历史。" },
  { level: "l3", threshold: 576_000, message: "建议压缩旧历史，避免后续工具输出推高上下文。" },
  { level: "l2", threshold: 384_000, message: "自动压缩大型工具输出，只保留摘要和 artifact 引用。" },
  { level: "l1", threshold: 192_000, message: "接近 DeepSeek 大上下文 L1 阈值。" },
  { level: "ok", threshold: 0, message: "上下文压力正常。" }
];
const DEFAULT_CNY_PER_USD = 7.2;

const MODEL_PRICES: Array<{
  pattern: RegExp;
  inputPerMillion: number;
  cachedInputPerMillion?: number;
  outputPerMillion: number;
}> = [
  { pattern: /deepseek-v4-flash/i, inputPerMillion: 0.07, cachedInputPerMillion: 0.014, outputPerMillion: 0.28 },
  { pattern: /deepseek-v4-pro|deepseek-chat|deepseek-reasoner/i, inputPerMillion: 0.27, cachedInputPerMillion: 0.07, outputPerMillion: 1.1 }
];

export function buildCapacityReport(input: {
  provider?: string;
  model?: string;
  messages: LlmMessage[];
  tools?: LlmToolDefinition[];
  systemPrompt?: string;
  omittedMessages?: number;
  truncated?: boolean;
  compressed?: boolean;
  summaryChars?: number;
  reasoningReplayTokens?: number;
  reasoningRetention?: ReasoningRetentionReport;
  checkpoint?: ContextCheckpointReport;
}, options: CapacityOptions = {}): CapacityReport {
  const contextWindow = contextWindowForModel(input.model);
  const maxOutputTokens = maxOutputTokensForModel(input.model);
  const estimatedInputTokens = estimateInputTokens(input.messages, input.tools, input.systemPrompt);
  const cachePrefix = buildCachePrefixReport(input.messages, input.tools, input.systemPrompt);
  const maxInputTokens = options.maxInputTokens ?? inputBudgetForModel(input.model);
  const seam = contextSeamForTokens(estimatedInputTokens, maxInputTokens, contextWindow);
  const utilization = maxInputTokens > 0 ? estimatedInputTokens / maxInputTokens : 1;
  const warningRatio = options.warningRatio ?? DEFAULT_WARNING_RATIO;
  const criticalRatio = options.criticalRatio ?? DEFAULT_CRITICAL_RATIO;
  const status: CapacityStatus = contextWindow >= 1_000_000
    ? seam.level === "hard"
      ? "critical"
      : seam.level !== "ok"
        ? "warning"
        : "ok"
    : utilization >= criticalRatio
      ? "critical"
      : seam.level !== "ok" || utilization >= warningRatio
        ? "warning"
        : "ok";

  return {
    provider: input.provider,
    model: input.model,
    contextWindow,
    estimatedInputTokens,
    maxInputTokens,
    maxOutputTokens,
    safetyHeadroomTokens: SAFETY_HEADROOM_TOKENS,
    reasoningReplayTokens: input.reasoningReplayTokens ?? reasoningReplayTokensFromMessages(input.messages),
    reasoningRetention: input.reasoningRetention,
    checkpoint: input.checkpoint,
    prefixHash: cachePrefix.prefixHash,
    cachePrefix,
    seamLevel: seam.level,
    seamThresholdTokens: seam.threshold,
    hardLimitTokens: seam.hardLimitTokens,
    seamMessage: seam.message,
    shouldCompressToolOutputs: seam.level === "l2" || seam.level === "l3" || seam.level === "cycle" || seam.level === "hard",
    shouldCompressHistory: seam.level === "l3" || seam.level === "cycle" || seam.level === "hard",
    shouldGenerateBriefing: seam.level === "cycle" || seam.level === "hard",
    utilization,
    status,
    truncated: Boolean(input.truncated),
    omittedMessages: input.omittedMessages ?? 0,
    compressed: Boolean(input.compressed),
    summaryTokens: estimateTokensFromChars(input.summaryChars ?? 0)
  };
}

function reasoningReplayTokensFromMessages(messages: LlmMessage[]) {
  const reasoningChars = messages.reduce((sum, message) => sum + (message.reasoningContent?.length ?? 0), 0);
  return estimateTokensFromChars(reasoningChars);
}

export function estimateInputTokens(messages: LlmMessage[], tools?: LlmToolDefinition[], systemPrompt?: string) {
  const payload = {
    messages: [
      ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
      ...messages.map(toCanonicalRequestMessage)
    ],
    tools: sortToolDefinitions(tools)
  };
  const payloadChars = JSON.stringify(payload).length;
  const framingTokens =
    payload.messages.length * MESSAGE_FRAMING_TOKENS +
    (tools?.length ?? 0) * TOOL_SCHEMA_FRAMING_TOKENS;
  return estimateTokensFromChars(payloadChars) + framingTokens;
}

export function estimateTokensFromChars(chars: number) {
  return Math.max(0, Math.ceil((chars / TOKEN_CHARS_DIVISOR) * CONSERVATIVE_TOKEN_MULTIPLIER));
}

export function estimateUsageCost(model: string | undefined, usage: ModelUsage): number | undefined {
  return estimateUsageCostDetails(model, usage)?.totalUsd;
}

export interface UsageCostDetails {
  currency: "USD";
  totalUsd: number;
  totalCny: number;
  cacheHitInputUsd: number;
  cacheMissInputUsd: number;
  outputUsd: number;
  cacheHitInputCny: number;
  cacheMissInputCny: number;
  outputCny: number;
  cachedTokens: number;
  uncachedPromptTokens: number;
}

export interface UsagePricingOptions {
  cacheHitInputMultiplier?: number;
  cacheMissInputMultiplier?: number;
  outputMultiplier?: number;
  cnyPerUsd?: number;
}

export function estimateUsageCostDetails(
  model: string | undefined,
  usage: ModelUsage,
  options: UsagePricingOptions = {}
): UsageCostDetails | undefined {
  const price = MODEL_PRICES.find((candidate) => model && candidate.pattern.test(model));
  if (!price) {
    return undefined;
  }

  const cachedTokens = usage.cachedTokens ?? 0;
  const uncachedPromptTokens = Math.max(0, usage.promptTokens - cachedTokens);
  const cacheMissInputUsd = roundCost(uncachedPromptTokens * price.inputPerMillion * (options.cacheMissInputMultiplier ?? 1) / 1_000_000);
  const cacheHitInputUsd = roundCost(cachedTokens * (price.cachedInputPerMillion ?? price.inputPerMillion) * (options.cacheHitInputMultiplier ?? 1) / 1_000_000);
  const outputUsd = roundCost(usage.completionTokens * price.outputPerMillion * (options.outputMultiplier ?? 1) / 1_000_000);
  const totalUsd = roundCost(cacheMissInputUsd + cacheHitInputUsd + outputUsd);
  const cnyPerUsd = options.cnyPerUsd ?? DEFAULT_CNY_PER_USD;
  return {
    currency: "USD",
    totalUsd,
    totalCny: usdToCny(totalUsd, cnyPerUsd),
    cacheHitInputUsd,
    cacheMissInputUsd,
    outputUsd,
    cacheHitInputCny: usdToCny(cacheHitInputUsd, cnyPerUsd),
    cacheMissInputCny: usdToCny(cacheMissInputUsd, cnyPerUsd),
    outputCny: usdToCny(outputUsd, cnyPerUsd),
    cachedTokens,
    uncachedPromptTokens
  };
}

function roundCost(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function usdToCny(value: number, cnyPerUsd: number) {
  return Math.round(value * cnyPerUsd * 1_000_000) / 1_000_000;
}

function contextSeamForTokens(tokens: number, maxInputTokens: number, contextWindow: number) {
  const hardLimitTokens = contextWindow >= 1_000_000 ? Math.min(maxInputTokens, 930_000) : maxInputTokens;
  if (contextWindow < 1_000_000) {
    return {
      level: tokens >= hardLimitTokens ? "hard" as const : tokens >= maxInputTokens * DEFAULT_WARNING_RATIO ? "l1" as const : "ok" as const,
      threshold: tokens >= hardLimitTokens ? hardLimitTokens : Math.floor(maxInputTokens * DEFAULT_WARNING_RATIO),
      hardLimitTokens,
      message: tokens >= hardLimitTokens ? "需要压缩或减少上下文后再发送。" : "上下文压力正常。"
    };
  }

  if (tokens >= hardLimitTokens) {
    return {
      level: "hard" as const,
      threshold: hardLimitTokens,
      hardLimitTokens,
      message: "需要压缩或减少上下文后再发送。"
    };
  }

  const seam = DEEPSEEK_SEAMS.find((candidate) => tokens >= candidate.threshold) ?? DEEPSEEK_SEAMS[DEEPSEEK_SEAMS.length - 1];
  return {
    level: seam.level,
    threshold: seam.threshold,
    hardLimitTokens,
    message: seam.message
  };
}

export function buildCachePrefixReport(
  messages: LlmMessage[],
  tools?: LlmToolDefinition[],
  systemPrompt?: string
): CachePrefixReport {
  const requestMessages = [
    ...(systemPrompt ? [{ role: "system" as const, content: systemPrompt }] : []),
    ...messages
  ];
  const segments = buildRequestSegments(requestMessages, tools);
  const layers: CachePrefixLayer[] = [
    ...segments.map((segment) => ({
      ...segment,
      tokens: estimateTokensFromChars(segment.chars) +
        (segment.name === "tool_prefix" ? TOOL_SCHEMA_FRAMING_TOKENS * (tools?.length ?? 0) : 0)
    }))
  ];

  return {
    prefixHash: requestPrefixHash(requestMessages, tools),
    promptHash: requestPromptHash(requestMessages, tools),
    cacheablePrefixTokens: layers
      .filter((layer) => layer.includedInPrefix)
      .reduce((sum, layer) => sum + layer.tokens, 0),
    dynamicTokens: layers
      .filter((layer) => !layer.cacheStable)
      .reduce((sum, layer) => sum + layer.tokens, 0),
    layers
  };
}
