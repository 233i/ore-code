import type { ToolSpec } from "@seekforge/tools";
import { toJSONSchema } from "zod";
import type { LlmToolDefinition } from "./llm";
import { sortToolDefinitions } from "./request-assembler";
import { stableHash } from "./stable-json";

export type PrefixInvalidationReason =
  | "new_session"
  | "workspace_changed"
  | "provider_changed"
  | "model_changed"
  | "mode_changed"
  | "system_prompt_changed"
  | "project_snapshot_changed"
  | "unknown";

export interface ImmutablePrefixInput {
  provider?: string;
  model?: string;
  workspacePath: string;
  mode: "plan" | "agent" | "yolo";
  systemPrompt?: string;
  projectContext?: string;
  toolDefinitions?: LlmToolDefinition[];
  toolSpecs?: ToolSpec[];
}

export interface ImmutablePrefixSnapshot {
  contextKey: string;
  fingerprint: string;
  provider?: string;
  model?: string;
  workspacePath: string;
  mode: "plan" | "agent" | "yolo";
  corePrompt?: string;
  projectSnapshot?: string;
  toolDefinitions?: LlmToolDefinition[];
  coreHash: string;
  projectHash: string;
  toolHash: string;
}

export function createImmutablePrefixSnapshot(input: ImmutablePrefixInput): ImmutablePrefixSnapshot {
  const corePrompt = normalizeOptionalText(input.systemPrompt);
  const projectSnapshot = normalizeOptionalText(input.projectContext);
  const toolDefinitions = sortToolDefinitions(input.toolDefinitions ?? toolSpecsToLlmDefinitions(input.toolSpecs));
  const contextKey = stableHash({
    provider: input.provider,
    model: input.model,
    workspacePath: input.workspacePath,
    mode: input.mode,
    corePrompt,
    projectSnapshot
  });
  const toolHash = stableHash(toolDefinitions ?? []);

  return {
    contextKey,
    fingerprint: stableHash({ contextKey, toolHash }),
    provider: input.provider,
    model: input.model,
    workspacePath: input.workspacePath,
    mode: input.mode,
    corePrompt,
    projectSnapshot,
    toolDefinitions,
    coreHash: stableHash(corePrompt ?? ""),
    projectHash: stableHash(projectSnapshot ?? ""),
    toolHash
  };
}

export function shouldReuseImmutablePrefixSnapshot(
  previous: ImmutablePrefixSnapshot | undefined,
  next: ImmutablePrefixSnapshot
): previous is ImmutablePrefixSnapshot {
  return Boolean(previous && previous.contextKey === next.contextKey);
}

export function resolvePrefixInvalidationReason(
  previous: ImmutablePrefixSnapshot | undefined,
  next: ImmutablePrefixSnapshot
): PrefixInvalidationReason {
  if (!previous) {
    return "new_session";
  }
  if (previous.workspacePath !== next.workspacePath) {
    return "workspace_changed";
  }
  if (previous.provider !== next.provider) {
    return "provider_changed";
  }
  if (previous.model !== next.model) {
    return "model_changed";
  }
  if (previous.mode !== next.mode) {
    return "mode_changed";
  }
  if (previous.corePrompt !== next.corePrompt) {
    return "system_prompt_changed";
  }
  if (previous.projectSnapshot !== next.projectSnapshot) {
    return "project_snapshot_changed";
  }
  return "unknown";
}

export function toolSpecsToLlmDefinitions(tools?: readonly ToolSpec[]): LlmToolDefinition[] | undefined {
  if (!tools?.length) {
    return undefined;
  }

  return sortToolDefinitions(tools.map(toolSpecToLlmDefinition));
}

export function toolSpecToLlmDefinition(tool: ToolSpec): LlmToolDefinition {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.modelParameters ?? toJSONSchema(tool.inputSchema)
    }
  };
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
