import { z } from "zod";

export const SnapshotFileRecordSchema = z.object({
  path: z.string().min(1),
  changeKind: z.enum(["created", "updated", "deleted"]),
  existedBefore: z.boolean(),
  beforeContentRef: z.string().min(1),
  afterContentRef: z.string().min(1),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  diffRef: z.string().min(1),
  beforeContent: z.string().optional(),
  afterContent: z.string().optional(),
  diff: z.string().optional()
});

export type SnapshotFileRecord = z.infer<typeof SnapshotFileRecordSchema>;

export const SnapshotRecordSchema = z.object({
  id: z.string().min(1),
  threadId: z.string().min(1),
  turnId: z.string().min(1),
  workspacePath: z.string().min(1),
  createdAt: z.string().datetime({ offset: true }),
  sideSnapshotId: z.string().min(1).optional(),
  sidePostSnapshotId: z.string().min(1).optional(),
  sideGitCommit: z.string().min(1).optional(),
  sidePostGitCommit: z.string().min(1).optional(),
  sideGitBranch: z.string().min(1).optional(),
  files: SnapshotFileRecordSchema.array()
});

export type SnapshotRecord = z.infer<typeof SnapshotRecordSchema>;
