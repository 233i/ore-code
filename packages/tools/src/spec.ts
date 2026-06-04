import type { ApprovalRequirement, RuntimeEvent, ToolCapability, ToolResult } from "@ore-code/protocol";
import type { ZodSchema } from "zod";

export type ToolRuntimeEvent = RuntimeEvent extends infer Event
  ? Event extends RuntimeEvent
    ? Omit<Event, "id" | "seq" | "threadId" | "turnId" | "createdAt">
    : never
  : never;

export interface ToolContext {
  workspacePath: string;
  mode: "plan" | "agent" | "yolo";
  trustedWorkspace: boolean;
  threadId?: string;
  turnId?: string;
  toolCallId?: string;
  onCommandOutput?: (delta: { callId: string; stream: "stdout" | "stderr"; text: string }) => void;
  onRuntimeEvent?: (event: ToolRuntimeEvent) => void;
}

export interface ToolSpec<Input = unknown, Output = unknown> {
  name: string;
  description: string;
  capability: ToolCapability;
  approval: ApprovalRequirement;
  inputSchema: ZodSchema<Input>;
  modelParameters?: unknown;
  execute(input: Input, context: ToolContext): Promise<ToolResult & { output?: Output }>;
}
