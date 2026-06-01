import {
  createRlmQueryTool,
  DEEPSEEK_V4_FLASH_MODEL,
  DEEPSEEK_V4_PRO_MODEL,
  type LlmClient,
  type ModelStreamChunk,
  type RlmArtifactSink,
  type RlmQueryResult
} from "@ore-code/agent-core";
import type { RuntimeEvent } from "@ore-code/protocol";
import type { ToolContext, ToolRegistry } from "@ore-code/tools";

const MAX_EXPLORATION_PROMPTS = 4;
const MAX_PROMPT_CHARS = 1_200;
const MAX_STRATEGY_CHARS = 800;
const MAX_RESULT_TEXT_CHARS = 2_000;
const MAX_CONTEXT_BLOCK_CHARS = 8_000;
const COMPLEX_PROMPT_CHARS = 120;
const COMPLEX_CONTEXT_CHARS = 12_000;
const COMPLEX_RELEVANT_FILES = 4;

type ProviderClientFactory = (
  reason: string,
  options?: { modelOverride?: string }
) => Promise<LlmClient | null>;

export interface DeepSeekExplorationPlanItem {
  prompt: string;
  title: string;
}

export interface DeepSeekExplorationPlan {
  prompts: DeepSeekExplorationPlanItem[];
  strategy: string;
}

export interface DeepSeekProOrchestrationResult {
  contextBlock: string;
  plan: DeepSeekExplorationPlan;
  rlm: RlmQueryResult;
}

export function shouldUseDeepSeekProOrchestration(input: {
  contextTextChars?: number;
  prompt: string;
  recentEvents?: RuntimeEvent[];
  relevantFileCount?: number;
  routingReason?: string;
}) {
  if (input.routingReason === "large_context") {
    return false;
  }
  if (hasRecentFailure(input.recentEvents ?? [])) {
    return true;
  }
  if ((input.contextTextChars ?? 0) >= COMPLEX_CONTEXT_CHARS) {
    return true;
  }
  if ((input.relevantFileCount ?? 0) >= COMPLEX_RELEVANT_FILES) {
    return true;
  }

  const prompt = input.prompt.trim();
  if (prompt.length >= COMPLEX_PROMPT_CHARS) {
    return true;
  }
  return hasComplexInvestigationIntent(prompt);
}

export async function runDeepSeekProOrchestratedExploration(input: {
  artifactStore?: RlmArtifactSink;
  codebaseContext?: string;
  createConfiguredProviderClient: ProviderClientFactory;
  readonlyRegistry: ToolRegistry;
  signal?: AbortSignal;
  toolContext: ToolContext;
  userPrompt: string;
}): Promise<DeepSeekProOrchestrationResult | null> {
  const planner = await input.createConfiguredProviderClient("DeepSeek Pro orchestration planner", {
    modelOverride: DEEPSEEK_V4_PRO_MODEL
  });
  if (!planner) {
    return null;
  }

  if (input.signal?.aborted) {
    return null;
  }
  const plan = await createExplorationPlan(planner, input);
  if (input.signal?.aborted) {
    return null;
  }
  if (plan.prompts.length === 0) {
    return null;
  }

  const rlmTool = createRlmQueryTool({
    artifacts: input.artifactStore ? { store: input.artifactStore } : undefined,
    childModel: DEEPSEEK_V4_FLASH_MODEL,
    createClient: async () => {
      const client = await input.createConfiguredProviderClient("DeepSeek Pro orchestrated Flash exploration", {
        modelOverride: DEEPSEEK_V4_FLASH_MODEL
      });
      if (!client) {
        throw new Error("DeepSeek API Key is required for orchestrated Flash exploration.");
      }
      return client;
    },
    readonlyTools: input.readonlyRegistry
  });

  const rlmResult = await rlmTool.execute({
    prompts: plan.prompts.map((item) => item.prompt),
    system: [
      "You are a DeepSeek Flash read-only explorer for a Pro coding agent.",
      "Use only read-only tools when helpful.",
      "Return concise findings with concrete file paths, symbols, commands observed, and uncertainty.",
      "Do not propose or perform edits. Do not claim validation or changes."
    ].join("\n")
  }, input.toolContext);

  if (input.signal?.aborted) {
    return null;
  }
  if (!rlmResult.ok || !rlmResult.output) {
    return null;
  }

  return {
    contextBlock: formatDeepSeekProOrchestrationContext(plan, rlmResult.output),
    plan,
    rlm: rlmResult.output
  };
}

export function parseDeepSeekExplorationPlan(text: string): DeepSeekExplorationPlan {
  const fallback: DeepSeekExplorationPlan = { prompts: [], strategy: "" };
  const rawJson = extractFirstJsonObject(text);
  if (!rawJson) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(rawJson) as Record<string, unknown>;
    const strategy = typeof parsed.strategy === "string" ? truncate(parsed.strategy.trim(), MAX_STRATEGY_CHARS) : "";
    const prompts = Array.isArray(parsed.prompts)
      ? parsed.prompts.flatMap(normalizePlanItem).slice(0, MAX_EXPLORATION_PROMPTS)
      : [];
    return { prompts, strategy };
  } catch {
    return fallback;
  }
}

export function formatDeepSeekProOrchestrationContext(
  plan: DeepSeekExplorationPlan,
  rlm: RlmQueryResult
) {
  const lines = [
    "<pro_orchestrated_exploration>",
    "Pipeline: Pro planned these read-only probes, DeepSeek Flash ran them in parallel, and the main Pro turn should edit and verify.",
    "Use these findings as hints. Cross-check concrete evidence before making edits or final claims.",
    plan.strategy ? `Plan: ${plan.strategy}` : "Plan: no strategy provided.",
    `Flash model: ${rlm.childModel}; prompts=${rlm.promptCount}; ok=${rlm.okCount}; failed=${rlm.failedCount}.`,
    ...rlm.results.map((result) => {
      const title = plan.prompts[result.index]?.title ?? `Probe ${result.index + 1}`;
      if (!result.ok) {
        return [
          `- ${title}: failed`,
          `  prompt: ${plan.prompts[result.index]?.prompt ?? result.promptPreview}`,
          `  error: ${result.error ?? "unknown"}`
        ].join("\n");
      }
      return [
        `- ${title}: ok`,
        `  prompt: ${plan.prompts[result.index]?.prompt ?? result.promptPreview}`,
        `  finding: ${truncate(result.text || "(empty)", MAX_RESULT_TEXT_CHARS)}`
      ].join("\n");
    }),
    "</pro_orchestrated_exploration>"
  ];
  return truncate(lines.join("\n"), MAX_CONTEXT_BLOCK_CHARS);
}

function hasRecentFailure(events: RuntimeEvent[]) {
  return events.slice(-40).some((event) => {
    if (event.type === "turn_failed" || event.type === "tool_failed") {
      return true;
    }
    if (event.type !== "project_delta") {
      return false;
    }
    return event.errors.length > 0 || event.testResults.some((result) => !result.ok);
  });
}

function hasComplexInvestigationIntent(prompt: string) {
  return [
    /(?:深入|完整|全面|复杂|批量|多个|多处|多文件|全局|架构|系统性|一次性)/i,
    /(?:分析|排查|定位|诊断|调研|研究|对比|方案|规划).{0,20}(?:问题|原因|架构|系统|项目|能力|性能|缓存|路由|上下文)/i,
    /\b(?:investigate|diagnose|architecture|system-wide|multi-file|large refactor|migration|root cause|design plan)\b/i
  ].some((pattern) => pattern.test(prompt));
}

async function createExplorationPlan(
  planner: LlmClient,
  input: { codebaseContext?: string; signal?: AbortSignal; userPrompt: string }
) {
  let text = "";
  for await (const chunk of planner.streamTurn({
    threadId: "deepseek-pro-orchestration-planner",
    turnId: crypto.randomUUID(),
    signal: input.signal,
    tools: [],
    messages: [
      {
        role: "system",
        content: [
          "You are the Pro planning stage for a coding-agent turn.",
          "Create 0-4 independent read-only exploration prompts for DeepSeek Flash children.",
          "Return only JSON: {\"strategy\":\"short\",\"prompts\":[{\"title\":\"short\",\"prompt\":\"self-contained read-only prompt\"}]}",
          "Use prompts only when they reduce risk before edits or validation.",
          "Each prompt must be independent, read-only, and ask for concrete evidence.",
          "Return an empty prompts array for trivial tasks, pure local questions, or when the supplied context is already enough."
        ].join("\n")
      },
      {
        role: "user",
        content: JSON.stringify({
          task: input.userPrompt,
          knownContext: truncate(input.codebaseContext?.trim() ?? "", 12_000)
        })
      }
    ]
  })) {
    text = appendModelText(text, chunk);
  }
  return parseDeepSeekExplorationPlan(text);
}

function normalizePlanItem(value: unknown): DeepSeekExplorationPlanItem[] {
  if (!value || typeof value !== "object") {
    return [];
  }
  const record = value as Record<string, unknown>;
  const prompt = typeof record.prompt === "string" ? record.prompt.trim() : "";
  if (!prompt) {
    return [];
  }
  const title = typeof record.title === "string" && record.title.trim()
    ? record.title.trim()
    : prompt.replace(/\s+/g, " ").slice(0, 48);
  return [{
    prompt: truncate(prompt, MAX_PROMPT_CHARS),
    title: truncate(title, 80)
  }];
}

function appendModelText(text: string, chunk: ModelStreamChunk) {
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

function truncate(value: string, maxChars: number) {
  const normalized = value.trim();
  return normalized.length <= maxChars
    ? normalized
    : `${normalized.slice(0, maxChars - 1)}…`;
}
