import type { ApprovalDecision, ToolResult } from "@ore-code/protocol";
import { evaluateApproval, isApproved } from "./approval-policy";
import type { ToolRegistry } from "./registry";
import type { ToolContext } from "./spec";

export type ToolExecutionOutcome =
  | { type: "completed"; result: ToolResult }
  | { type: "approval-required"; toolName: string; reason: string }
  | { type: "denied"; toolName: string; reason: string }
  | { type: "not-found"; toolName: string };

export async function executeRegisteredTool(
  registry: ToolRegistry,
  toolName: string,
  rawInput: unknown,
  context: ToolContext,
  approvalDecision?: ApprovalDecision,
  options: { callId?: string } = {}
): Promise<ToolExecutionOutcome> {
  const tool = registry.get(toolName);
  if (!tool) {
    return { type: "not-found", toolName };
  }

  const approval = evaluateApproval(tool, context, rawInput);
  if (approval.type === "deny") {
    return { type: "denied", toolName, reason: approval.reason };
  }

  if (approval.type === "request" && !isApproved(approvalDecision)) {
    return {
      type: "approval-required",
      toolName,
      reason: `${toolName} requires approval in ${context.mode} mode.`
    };
  }

  const input = tool.inputSchema.parse(approvalDecision?.editedInput ?? rawInput);
  const executionContext = options.callId ? { ...context, toolCallId: options.callId } : context;
  return {
    type: "completed",
    result: await tool.execute(input, executionContext)
  };
}
