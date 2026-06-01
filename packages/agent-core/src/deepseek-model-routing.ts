import type { RuntimeEvent } from "@ore-code/protocol";

export const DEEPSEEK_V4_PRO_MODEL = "deepseek-v4-pro";
export const DEEPSEEK_V4_FLASH_MODEL = "deepseek-v4-flash";
export const DEEPSEEK_MODEL_MODES = ["auto", "pro", "flash"] as const;

export type DeepSeekModelMode = typeof DEEPSEEK_MODEL_MODES[number];
export type DeepSeekResolvedModel = typeof DEEPSEEK_V4_PRO_MODEL | typeof DEEPSEEK_V4_FLASH_MODEL;
export type DeepSeekRouteKind = "local" | "flash_readonly" | "pro_agent";
export type DeepSeekToolProfile = "none" | "readonly" | "full";
export type DeepSeekClassifierIntent = "local" | "readonly" | "side_effect" | "ambiguous";
export type DeepSeekSideEffectRisk = "none" | "possible" | "required";

export interface DeepSeekTurnClassifierResult {
  confidence: number;
  intent: DeepSeekClassifierIntent;
  reason?: string;
  sideEffectRisk: DeepSeekSideEffectRisk;
}

export interface DeepSeekTurnModelInput {
  classifier?: DeepSeekTurnClassifierResult | null;
  modelMode: DeepSeekModelMode;
  prompt: string;
  recentEvents?: RuntimeEvent[];
  contextTextChars?: number;
  hasAttachments?: boolean;
  locale?: string;
  now?: Date;
  timeZone?: string;
}

export interface ResolvedDeepSeekTurnModel {
  mode: DeepSeekModelMode;
  route: DeepSeekRouteKind;
  toolProfile: DeepSeekToolProfile;
  resolvedModel?: DeepSeekResolvedModel;
  reason: string;
  localResponse?: string;
  requiresClassifier?: boolean;
}

const LARGE_CONTEXT_CHARS = 120_000;
const RECENT_EVENT_WINDOW = 40;
const LOCAL_RESPONSE_MAX_CHARS = 80;

const PRO_TOOL_NAMES = [
  "apply_patch",
  "write_file",
  "exec_shell",
  "run_tests",
  "mcp_call_tool",
  "mcp_apply_prompt",
  "automation_create",
  "automation_update",
  "task_create",
  "task_run"
];

const EXPLICIT_PRO_INTENT_PATTERNS = [
  /(?:修复|修改|实现|新增|添加|删除|移除|重构|迁移|回滚|提交|打包|构建|安装|部署|发布|创建|新建|更新)/i,
  /(?:运行|执行|跑|启动).{0,16}(?:测试|命令|脚本|构建|打包|服务|shell|terminal|pnpm|npm|cargo|pytest|vitest|lint|typecheck)/i,
  /\b(?:fix|implement|refactor|edit|write|delete|create|update|run\s+tests?|build|install|migrate|restore|commit|deploy)\b/i,
  /(?:添加|安装|配置|接入|重连|启用|禁用|删除|移除|调用|执行|运行).{0,16}(?:mcp|自动化|automation)/i,
  /\b(?:mcp|automation).{0,16}(?:add|install|configure|reload|enable|disable|remove|delete|call|run|invoke|create|update|pause|resume)\b/i
];

const LOCAL_TIME_ZH_PATTERNS = [
  /^(?:请问)?(?:现在|当前|这会儿)?(?:是)?几点(?:钟)?(?:了|啊|呀|呢)?$/,
  /^(?:请问)?(?:现在|当前)?(?:是)?什么时间(?:了|啊|呀|呢)?$/,
  /^(?:请问)?当前时间(?:是)?(?:多少)?$/
];

const LOCAL_DATE_ZH_PATTERNS = [
  /^(?:请问)?今天(?:是)?(?:几号|星期几)(?:了|啊|呀|呢)?$/,
  /^(?:请问)?(?:当前|现在)日期(?:是)?(?:多少)?$/
];

const LOCAL_CONFIRM_ZH_EXACT = [
  "你好",
  "谢谢",
  "好的",
  "好",
  "对",
  "嗯",
  "收到",
  "明白"
];

const LOCAL_TIME_EN_PATTERNS = [
  /^(?:what\s+time(?:\s+is\s+it)?|current\s+time|time\s+now)\??$/i
];

const LOCAL_DATE_EN_PATTERNS = [
  /^(?:today'?s\s+date|current\s+date)\??$/i
];

const LOCAL_CONFIRM_EN_PATTERNS = [
  /^(?:hello|hi|thanks?|ok(?:ay)?)$/i
];

export function parseDeepSeekModelMode(value: unknown): DeepSeekModelMode | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase().replace(/[\s_]+/g, "-");
  switch (normalized) {
    case "auto":
    case "default":
      return "auto";
    case "pro":
    case "v4-pro":
    case "deepseek-v4-pro":
      return "pro";
    case "flash":
    case "v4-flash":
    case "deepseek-v4-flash":
      return "flash";
    default:
      return undefined;
  }
}

export function normalizeDeepSeekModelMode(value: unknown): DeepSeekModelMode {
  return parseDeepSeekModelMode(value) ?? "auto";
}

export function modelForDeepSeekMode(mode: Exclude<DeepSeekModelMode, "auto">): DeepSeekResolvedModel {
  return mode === "flash" ? DEEPSEEK_V4_FLASH_MODEL : DEEPSEEK_V4_PRO_MODEL;
}

export function deepSeekModelModeLabel(mode: DeepSeekModelMode): string {
  switch (mode) {
    case "flash":
      return "V4 Flash";
    case "pro":
      return "V4 Pro";
    case "auto":
    default:
      return "Auto";
  }
}

export function resolvedDeepSeekModelLabel(model: string | undefined): string {
  if (model === DEEPSEEK_V4_FLASH_MODEL) {
    return "Flash";
  }
  if (model === DEEPSEEK_V4_PRO_MODEL) {
    return "Pro";
  }
  return model || "unknown";
}

export function resolveDeepSeekTurnModel(input: DeepSeekTurnModelInput): ResolvedDeepSeekTurnModel {
  if (input.modelMode === "pro" || input.modelMode === "flash") {
    const resolvedModel = modelForDeepSeekMode(input.modelMode);
    return {
      mode: input.modelMode,
      route: input.modelMode === "pro" ? "pro_agent" : "flash_readonly",
      toolProfile: input.modelMode === "pro" ? "full" : "readonly",
      resolvedModel,
      reason: `manual_${input.modelMode}`
    };
  }

  const prompt = input.prompt.toLowerCase();
  const localResponse = !input.hasAttachments ? localResponseForPrompt(prompt, input) : null;
  if (localResponse) {
    return {
      mode: "auto",
      route: "local",
      toolProfile: "none",
      reason: localResponse.reason,
      localResponse: localResponse.text
    };
  }

  if ((input.contextTextChars ?? 0) >= LARGE_CONTEXT_CHARS) {
    return proDecision("large_context");
  }

  const recentReason = proReasonFromRecentEvents(prompt, input.recentEvents ?? []);
  if (recentReason) {
    return proDecision(recentReason);
  }

  if (input.hasAttachments) {
    return proDecision("attachment_context");
  }

  if (hasExplicitProIntent(prompt)) {
    return proDecision("explicit_pro_intent");
  }

  if (input.classifier === undefined) {
    return {
      ...proDecision("classifier_required"),
      requiresClassifier: true
    };
  }

  if (!input.classifier) {
    return proDecision("classifier_unavailable");
  }

  return decisionFromClassifier(input.classifier);
}

function proDecision(reason: string): ResolvedDeepSeekTurnModel {
  return {
    mode: "auto",
    route: "pro_agent",
    toolProfile: "full",
    resolvedModel: DEEPSEEK_V4_PRO_MODEL,
    reason
  };
}

function flashDecision(reason: string): ResolvedDeepSeekTurnModel {
  return {
    mode: "auto",
    route: "flash_readonly",
    toolProfile: "readonly",
    resolvedModel: DEEPSEEK_V4_FLASH_MODEL,
    reason
  };
}

function decisionFromClassifier(classifier: DeepSeekTurnClassifierResult): ResolvedDeepSeekTurnModel {
  if (
    classifier.sideEffectRisk === "required" ||
    (classifier.intent === "side_effect" && classifier.confidence >= 0.55)
  ) {
    return proDecision("classifier_side_effect");
  }

  if (classifier.sideEffectRisk === "possible") {
    return proDecision("classifier_possible_side_effect");
  }

  if (
    classifier.sideEffectRisk === "none" &&
    (classifier.intent === "readonly" || classifier.intent === "local") &&
    classifier.confidence >= 0.65
  ) {
    return flashDecision("classifier_readonly");
  }

  return proDecision("classifier_uncertain");
}

function proReasonFromRecentEvents(prompt: string, events: RuntimeEvent[]): string | undefined {
  if (!isContinuationPrompt(prompt)) {
    return undefined;
  }

  const recent = events.slice(-RECENT_EVENT_WINDOW);
  for (const event of recent) {
    if (event.type === "turn_failed" || event.type === "tool_failed") {
      return "recent_failure_continuation";
    }
    if (event.type === "file_changed") {
      return "recent_edit_continuation";
    }
    if (event.type === "project_delta") {
      if (event.errors.length > 0 || event.testResults.some((result) => !result.ok)) {
        return "recent_project_delta_failure_continuation";
      }
      if (event.changedFiles.length > 0) {
        return "recent_project_delta_change_continuation";
      }
    }
    if (event.type === "tool_call_requested" && PRO_TOOL_NAMES.includes(event.call.name)) {
      return "recent_side_effect_tool";
    }
  }
  return undefined;
}

function hasExplicitProIntent(value: string) {
  return EXPLICIT_PRO_INTENT_PATTERNS.some((pattern) => pattern.test(value));
}

function isContinuationPrompt(value: string) {
  const compact = compactPrompt(value);
  return [
    "继续",
    "接着",
    "下一步",
    "继续做",
    "继续修",
    "继续改",
    "继续优化",
    "goon",
    "continue",
    "next"
  ].some((candidate) => compact === candidate || compact.includes(candidate));
}

function localResponseForPrompt(prompt: string, input: DeepSeekTurnModelInput): { reason: string; text: string } | null {
  const normalized = prompt.trim().replace(/\s+/g, " ");
  if (!normalized || normalized.length > LOCAL_RESPONSE_MAX_CHARS) {
    return null;
  }

  const compact = compactPrompt(normalized);
  const now = input.now ?? new Date();
  if (matchesSimpleLocalZhPrompt(compact, LOCAL_TIME_ZH_PATTERNS) || matchesSimpleLocalEnPrompt(normalized, LOCAL_TIME_EN_PATTERNS)) {
    return { reason: "local_time", text: `现在是 ${formatLocalTime(now, input)}。` };
  }

  if (matchesSimpleLocalZhPrompt(compact, LOCAL_DATE_ZH_PATTERNS) || matchesSimpleLocalEnPrompt(normalized, LOCAL_DATE_EN_PATTERNS)) {
    return { reason: "local_date", text: `今天是 ${formatLocalDate(now, input)}。` };
  }

  if (LOCAL_CONFIRM_ZH_EXACT.includes(compact) || LOCAL_CONFIRM_EN_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return { reason: "local_ack", text: "收到。" };
  }

  return null;
}

function compactPrompt(value: string) {
  return value.trim().toLowerCase().replace(/[，。！？、,.!?;:()\[\]{}"'`~\s]/g, "");
}

function matchesSimpleLocalZhPrompt(compact: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(compact));
}

function matchesSimpleLocalEnPrompt(normalized: string, patterns: RegExp[]) {
  return normalized.length <= 48 && patterns.some((pattern) => pattern.test(normalized));
}

function formatLocalTime(date: Date, input: Pick<DeepSeekTurnModelInput, "locale" | "timeZone">) {
  return new Intl.DateTimeFormat(input.locale ?? "zh-CN", {
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    timeZone: input.timeZone
  }).format(date);
}

function formatLocalDate(date: Date, input: Pick<DeepSeekTurnModelInput, "locale" | "timeZone">) {
  return new Intl.DateTimeFormat(input.locale ?? "zh-CN", {
    day: "numeric",
    month: "long",
    timeZone: input.timeZone,
    weekday: "long",
    year: "numeric"
  }).format(date);
}
