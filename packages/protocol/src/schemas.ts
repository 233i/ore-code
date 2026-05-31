import { z } from "zod";

export const IsoDateTimeSchema = z.string().datetime({ offset: true });
export const IdSchema = z.string().min(1);

export const WorkspaceSchema = z.object({
  path: z.string().min(1),
  trusted: z.boolean().default(false)
});

export const AppModeSchema = z.enum(["plan", "agent", "yolo"]);
export type AppMode = z.infer<typeof AppModeSchema>;

export const ReasoningEffortSchema = z.enum(["off", "high", "max"]);
export type ReasoningEffort = z.infer<typeof ReasoningEffortSchema>;

export const ProviderConfigSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  baseUrl: z.string().url().optional(),
  apiKeySource: z.enum(["missing", "env", "keychain", "config"]).default("missing")
});
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

