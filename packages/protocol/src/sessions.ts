import { z } from "zod";
import { AppModeSchema, IsoDateTimeSchema, ProviderConfigSchema } from "./schemas";

export const ThreadRecordSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  workspacePath: z.string().min(1),
  mode: AppModeSchema,
  provider: ProviderConfigSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  archived: z.boolean().default(false)
});
export type ThreadRecord = z.infer<typeof ThreadRecordSchema>;

export const TurnStatusSchema = z.enum([
  "queued",
  "in-progress",
  "completed",
  "failed",
  "interrupted",
  "canceled"
]);
export type TurnStatus = z.infer<typeof TurnStatusSchema>;

export const TurnRecordSchema = z.object({
  id: z.string().min(1),
  threadId: z.string().min(1),
  status: TurnStatusSchema,
  startedAt: IsoDateTimeSchema,
  completedAt: IsoDateTimeSchema.optional(),
  errorSummary: z.string().optional()
});
export type TurnRecord = z.infer<typeof TurnRecordSchema>;

