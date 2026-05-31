export const DEFAULT_CONTEXT_WINDOW = 128_000;
export const DEFAULT_MAX_OUTPUT_TOKENS = 8_192;
export const DEEPSEEK_V4_CONTEXT_WINDOW = 1_000_000;
export const DEEPSEEK_V4_MAX_OUTPUT_TOKENS = 65_536;
export const DEEPSEEK_LEGACY_CONTEXT_WINDOW = 128_000;
export const SAFETY_HEADROOM_TOKENS = 4_096;

const SUFFIX_CONTEXT_WINDOWS: Array<{ pattern: RegExp; contextWindow: number }> = [
  { pattern: /(?:^|[-_])1m$/i, contextWindow: 1_000_000 },
  { pattern: /(?:^|[-_])256k$/i, contextWindow: 256_000 },
  { pattern: /(?:^|[-_])128k$/i, contextWindow: 128_000 },
  { pattern: /(?:^|[-_])32k$/i, contextWindow: 32_000 }
];

export function contextWindowForModel(model: string | undefined): number {
  const normalized = normalizeModel(model);
  const suffix = SUFFIX_CONTEXT_WINDOWS.find((candidate) => candidate.pattern.test(normalized));
  if (suffix) {
    return suffix.contextWindow;
  }

  if (/deepseek-v4-(pro|flash)/i.test(normalized)) {
    return DEEPSEEK_V4_CONTEXT_WINDOW;
  }

  if (/deepseek-(chat|reasoner)/i.test(normalized)) {
    return DEEPSEEK_LEGACY_CONTEXT_WINDOW;
  }

  return DEFAULT_CONTEXT_WINDOW;
}

export function maxOutputTokensForModel(model: string | undefined): number {
  return /deepseek-v4-(pro|flash)/i.test(normalizeModel(model))
    ? DEEPSEEK_V4_MAX_OUTPUT_TOKENS
    : DEFAULT_MAX_OUTPUT_TOKENS;
}

export function inputBudgetForModel(model: string | undefined): number {
  return Math.max(0, contextWindowForModel(model) - maxOutputTokensForModel(model) - SAFETY_HEADROOM_TOKENS);
}

export function isDeepSeekThinkingModel(model: string | undefined): boolean {
  return /deepseek-v4-(pro|flash)|deepseek-reasoner/i.test(normalizeModel(model));
}

function normalizeModel(model: string | undefined) {
  return (model ?? "").trim();
}
