import { z } from "zod";
import type { InteractionDecision } from "@ore-code/protocol";
import type { ToolSpec } from "@ore-code/tools";

export const RequestUserInputSchema = z.object({
  title: z.string().trim().min(1).max(24),
  message: z.string().trim().min(1).max(160),
  options: z.array(z.object({
    id: z.string().trim().min(1).max(40),
    label: z.string().trim().min(1).max(48),
    description: z.string().trim().min(1).max(120).optional(),
    value: z.string().optional()
  })).min(2).max(3),
  recommendedOptionId: z.string().trim().min(1).max(40).optional()
});

export type RequestUserInput = z.infer<typeof RequestUserInputSchema>;

export interface InteractionToolDecision {
  requestId: string;
  decision: InteractionDecision;
}

export function createInteractionRequestTool(): ToolSpec<RequestUserInput, InteractionToolDecision> {
  return {
    name: "request_user_input",
    description: "Ask the user one concise plan-mode choice with 2-3 options. The UI adds a custom free-form option automatically.",
    capability: "readonly",
    approval: "never",
    inputSchema: RequestUserInputSchema,
    modelParameters: {
      type: "object",
      required: ["title", "message", "options"],
      properties: {
        title: { type: "string", maxLength: 24 },
        message: { type: "string", maxLength: 160 },
        recommendedOptionId: { type: "string" },
        options: {
          type: "array",
          minItems: 2,
          maxItems: 3,
          items: {
            type: "object",
            required: ["id", "label"],
            properties: {
              id: { type: "string" },
              label: { type: "string" },
              description: { type: "string" },
              value: { type: "string" }
            }
          }
        }
      }
    },
    async execute() {
      return {
        callId: "request_user_input",
        ok: false,
        error: {
          code: "interaction_runtime_required",
          message: "request_user_input must be handled by AgentEngine."
        }
      };
    }
  };
}
