import type { ApprovalDecision, ToolCall } from "@seekforge/protocol";
import { assessCommandRisk } from "./command-risk";
import { resolveRunTestsCommand } from "./test-tools";
import type { ToolContext, ToolSpec } from "./spec";

export type ApprovalOutcome =
  | { type: "allow" }
  | { type: "deny"; reason: string }
  | { type: "request"; call: ToolCall };

export function evaluateApproval(tool: ToolSpec, context: ToolContext, rawInput?: unknown): ApprovalOutcome {
  const shellRisk = shellRiskLevel(tool, rawInput);

  if (context.mode === "plan" && tool.capability === "shell" && shellRisk === "read") {
    return { type: "allow" };
  }

  if (context.mode === "plan" && tool.capability === "network" && tool.approval === "never") {
    return { type: "allow" };
  }

  if (context.mode === "plan" && context.trustedWorkspace) {
    return { type: "allow" };
  }

  if (context.mode === "yolo") {
    return { type: "allow" };
  }

  if (tool.capability === "shell" && shellRisk === "read") {
    return { type: "allow" };
  }

  if (tool.approval === "required" || (tool.approval === "suggest" && tool.capability !== "readonly")) {
    return { type: "request", call: toolCallForApproval(tool) };
  }

  if (tool.capability === "shell" || tool.capability === "high-risk") {
    return { type: "request", call: toolCallForApproval(tool) };
  }

  return { type: "allow" };
}

export function isApproved(decision: ApprovalDecision | undefined): boolean {
  return decision?.decision === "approved-once" || decision?.decision === "approved-always" || decision?.decision === "edited";
}

function toolCallForApproval(tool: ToolSpec): ToolCall {
  return {
    id: `approval:${tool.name}`,
    name: tool.name,
    input: {},
    capability: tool.capability,
    approval: tool.approval
  };
}

function shellRiskLevel(tool: ToolSpec, rawInput: unknown) {
  if (tool.capability !== "shell") {
    return null;
  }

  if (tool.name === "run_tests") {
    return assessCommandRisk(resolveRunTestsCommand(rawInput).command).level;
  }

  const input = rawInput as { command?: unknown };
  return typeof input?.command === "string" ? assessCommandRisk(input.command).level : null;
}
