import {
  DEEPSEEK_V4_FLASH_MODEL,
  type DeepSeekTurnClassifierResult,
  type LlmClient,
  type ModelStreamChunk
} from "@seekforge/agent-core";

type ClassifierClientFactory = (
  reason: string,
  options?: { modelOverride?: string }
) => Promise<LlmClient | null>;

const DEFAULT_CLASSIFIER_CACHE_TTL_MS = 2 * 60 * 1000;

export type DeepSeekTurnClassifierCache = Map<string, {
  expiresAtMs: number;
  result: DeepSeekTurnClassifierResult | null;
}>;

export async function classifyDeepSeekTurnWithFlash(input: {
  contextTextChars?: number;
  createConfiguredProviderClient: ClassifierClientFactory;
  hasAttachments?: boolean;
  prompt: string;
  signal?: AbortSignal;
}): Promise<DeepSeekTurnClassifierResult | null> {
  const client = await input.createConfiguredProviderClient("DeepSeek auto model classifier", {
    modelOverride: DEEPSEEK_V4_FLASH_MODEL
  });
  if (!client) {
    return null;
  }

  try {
    const text = await collectClassifierText(client, input);
    return parseDeepSeekTurnClassifierResult(text);
  } catch {
    return null;
  }
}

export async function classifyDeepSeekTurnWithFlashCached(input: {
  cache: DeepSeekTurnClassifierCache;
  contextTextChars?: number;
  createConfiguredProviderClient: ClassifierClientFactory;
  hasAttachments?: boolean;
  nowMs?: number;
  prompt: string;
  signal?: AbortSignal;
  ttlMs?: number;
}): Promise<DeepSeekTurnClassifierResult | null> {
  const key = deepSeekTurnClassifierCacheKey(input);
  const nowMs = input.nowMs ?? Date.now();
  const cached = input.cache.get(key);
  if (cached && cached.expiresAtMs > nowMs) {
    return cached.result;
  }

  const result = await classifyDeepSeekTurnWithFlash(input);
  input.cache.set(key, {
    expiresAtMs: nowMs + (input.ttlMs ?? DEFAULT_CLASSIFIER_CACHE_TTL_MS),
    result
  });
  return result;
}

export function deepSeekTurnClassifierCacheKey(input: {
  contextTextChars?: number;
  hasAttachments?: boolean;
  prompt: string;
}) {
  return JSON.stringify({
    prompt: input.prompt.trim(),
    hasAttachments: Boolean(input.hasAttachments),
    contextTextChars: input.contextTextChars ?? 0
  });
}

export function parseDeepSeekTurnClassifierResult(text: string): DeepSeekTurnClassifierResult | null {
  const rawJson = extractFirstJsonObject(text);
  if (!rawJson) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawJson) as Record<string, unknown>;
    const intent = normalizeClassifierIntent(parsed.intent);
    const sideEffectRisk = normalizeSideEffectRisk(parsed.sideEffectRisk ?? parsed.side_effect_risk);
    const confidence = normalizeConfidence(parsed.confidence);
    if (!intent || !sideEffectRisk || confidence === null) {
      return null;
    }

    return {
      confidence,
      intent,
      reason: typeof parsed.reason === "string" ? parsed.reason.slice(0, 160) : undefined,
      sideEffectRisk
    };
  } catch {
    return null;
  }
}

async function collectClassifierText(
  client: LlmClient,
  input: { contextTextChars?: number; hasAttachments?: boolean; prompt: string; signal?: AbortSignal }
) {
  let text = "";
  for await (const chunk of client.streamTurn({
    threadId: "deepseek-auto-model-classifier",
    turnId: crypto.randomUUID(),
    signal: input.signal,
    tools: [],
    messages: [
      {
        role: "system",
        content: [
          "You classify one coding-agent user request for model routing.",
          "Return only one compact JSON object with this exact shape:",
          "{\"intent\":\"local|readonly|side_effect|ambiguous\",\"sideEffectRisk\":\"none|possible|required\",\"confidence\":0.0,\"reason\":\"short\"}",
          "readonly means the task can be completed with read/list/search/diff/web-fetch style tools and no mutation.",
          "side_effect means the task likely needs file edits, shell commands, tests/builds, git mutation, MCP mutation, automation mutation, installs, or app state changes.",
          "If there is any realistic chance of side effects, set sideEffectRisk to possible or required.",
          "Use ambiguous with low confidence when the request is underspecified."
        ].join("\n")
      },
      {
        role: "user",
        content: JSON.stringify({
          prompt: input.prompt,
          hasAttachments: Boolean(input.hasAttachments),
          contextTextChars: input.contextTextChars ?? 0
        })
      }
    ]
  })) {
    text = appendClassifierChunk(text, chunk);
  }
  return text;
}

function appendClassifierChunk(text: string, chunk: ModelStreamChunk) {
  if (chunk.type === "assistant_delta") {
    return text + chunk.text;
  }
  if (chunk.type === "done" && !text && chunk.finalText) {
    return chunk.finalText;
  }
  return text;
}

function extractFirstJsonObject(text: string) {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return null;
  }
  return candidate.slice(start, end + 1);
}

function normalizeClassifierIntent(value: unknown): DeepSeekTurnClassifierResult["intent"] | null {
  if (value === "local" || value === "readonly" || value === "side_effect" || value === "ambiguous") {
    return value;
  }
  return null;
}

function normalizeSideEffectRisk(value: unknown): DeepSeekTurnClassifierResult["sideEffectRisk"] | null {
  if (value === "none" || value === "possible" || value === "required") {
    return value;
  }
  return null;
}

function normalizeConfidence(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return Math.min(1, Math.max(0, value));
}
