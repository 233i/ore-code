import type { ToolPromptHintSource } from "./toolPromptHints";
import {
  codingPromptSections,
  PLAN_MODE_INTERACTION_PROTOCOL_LINES,
  projectContextLines,
  renderPromptSections,
  runtimeOperatingSystemLabel,
  subagentRolePromptLines,
  type PromptBuildContext,
  type PromptMode,
  type RuntimeOperatingSystem
} from "./promptSections";

export type { PromptMode, RuntimeOperatingSystem };
export { PLAN_MODE_INTERACTION_PROTOCOL_LINES, runtimeOperatingSystemLabel };

export interface CodingSystemPromptInput {
  durableTask?: boolean;
  durableTaskNote?: string;
  lazyContextIndex?: string;
  operatingSystem?: RuntimeOperatingSystem;
  projectInstructions?: string;
  tools?: ToolPromptHintSource;
  userInstructions?: string;
  workspacePath: string;
  mode?: PromptMode;
}

export function createCodingSystemPrompt(input?: Partial<CodingSystemPromptInput>): string {
  return renderPromptSections(codingPromptSections(), normalizePromptInput(input));
}

export function createDurableTaskSystemPrompt(input: CodingSystemPromptInput): string {
  return createCodingSystemPrompt({
    ...input,
    durableTask: true
  });
}

export function createProjectContextPrompt(input: CodingSystemPromptInput): string {
  return projectContextLines(normalizePromptInput(input)).join("\n");
}

export function createSubagentRoleSystemPrompt(input: { id: string; role?: string }): string {
  return subagentRolePromptLines(input).join("\n");
}

/**
 * @deprecated Use createCodingSystemPrompt. The legacy prompt now reuses the
 * same prompt pack so old callers do not drift from the maintained sections.
 */
export function createLegacyCodingSystemPrompt(input: CodingSystemPromptInput): string {
  return createCodingSystemPrompt(input);
}

function normalizePromptInput(input?: Partial<CodingSystemPromptInput>): PromptBuildContext {
  return {
    ...input,
    mode: input?.mode ?? "agent",
    workspacePath: input?.workspacePath ?? "."
  };
}
