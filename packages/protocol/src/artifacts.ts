import { z } from "zod";

export const ArtifactMetadataSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["shell-log", "text", "diff", "test-report"]),
  size: z.number().int().nonnegative(),
  createdAt: z.string().datetime({ offset: true }),
  summary: z.string().min(1),
  sourceCallId: z.string().min(1).optional()
});

export type ArtifactMetadata = z.infer<typeof ArtifactMetadataSchema>;

export const ArtifactRecordSchema = ArtifactMetadataSchema.extend({
  content: z.string()
});

export type ArtifactRecord = z.infer<typeof ArtifactRecordSchema>;
