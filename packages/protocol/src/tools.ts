import { z } from "zod";

export const ToolCapabilitySchema = z.enum([
  "readonly",
  "workspace-write",
  "shell",
  "network",
  "high-risk"
]);
export type ToolCapability = z.infer<typeof ToolCapabilitySchema>;

export const ApprovalRequirementSchema = z.enum(["never", "suggest", "required"]);
export type ApprovalRequirement = z.infer<typeof ApprovalRequirementSchema>;

export const ToolCallSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  input: z.unknown(),
  capability: ToolCapabilitySchema.optional(),
  approval: ApprovalRequirementSchema.optional()
});
export type ToolCall = z.infer<typeof ToolCallSchema>;

export const ToolResultSchema = z.object({
  callId: z.string().min(1),
  ok: z.boolean(),
  output: z.unknown().optional(),
  error: z
    .object({
      code: z.string().min(1),
      message: z.string().min(1),
      detail: z.unknown().optional()
    })
    .optional(),
  artifactId: z.string().optional()
});
export type ToolResult = z.infer<typeof ToolResultSchema>;

export const ApprovalDecisionSchema = z.object({
  callId: z.string().min(1),
  decision: z.enum(["approved-once", "approved-always", "denied", "edited"]),
  editedInput: z.unknown().optional()
});
export type ApprovalDecision = z.infer<typeof ApprovalDecisionSchema>;

