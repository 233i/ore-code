import { z } from "zod";
import type { ToolSpec } from "./spec";

const MAX_DIFF_CHARS = 40_000;

const GitStatusInputSchema = z.object({});

const GitDiffInputSchema = z.object({
  staged: z.boolean().optional(),
  path: z.string().min(1).optional()
});

const GitLogInputSchema = z.object({
  maxCount: z.number().int().positive().max(100).optional()
});

const GitShowInputSchema = z.object({
  rev: z.string().min(1),
  path: z.string().min(1).optional()
});

const GitBlameInputSchema = z.object({
  path: z.string().min(1),
  rev: z.string().min(1).optional()
});

export interface GitToolHost {
  status(input: { workspacePath: string }): Promise<GitStatusHostOutput>;
  diff(input: { workspacePath: string; staged: boolean; path?: string }): Promise<GitDiffHostOutput>;
  branch(input: { workspacePath: string }): Promise<GitBranchHostOutput>;
  log(input: { workspacePath: string; maxCount: number }): Promise<GitTextHostOutput>;
  show(input: { workspacePath: string; rev: string; path?: string }): Promise<GitTextHostOutput>;
  blame(input: { workspacePath: string; path: string; rev?: string }): Promise<GitTextHostOutput>;
}

export interface GitStatusEntry {
  status: string;
  path: string;
}

export interface GitStatusHostOutput {
  isRepo: boolean;
  branch?: string;
  entries: GitStatusEntry[];
  raw: string;
  error?: string;
}

export interface GitDiffHostOutput {
  isRepo: boolean;
  diff: string;
  error?: string;
}

export interface GitBranchHostOutput {
  isRepo: boolean;
  current?: string;
  branches: string[];
  raw: string;
  error?: string;
}

export interface GitTextHostOutput {
  isRepo: boolean;
  output: string;
  error?: string;
}

export interface GitStatusOutput extends GitStatusHostOutput {
  changedFiles: number;
}

export interface GitDiffOutput extends GitDiffHostOutput {
  staged: boolean;
  path?: string;
  truncated: boolean;
}

export interface GitTextOutput extends GitTextHostOutput {
  truncated: boolean;
}

export function createGitStatusTool(host: GitToolHost): ToolSpec<z.infer<typeof GitStatusInputSchema>, GitStatusOutput> {
  return {
    name: "git_status",
    description: "Read git status for the selected workspace.",
    capability: "readonly",
    approval: "never",
    inputSchema: GitStatusInputSchema,
    async execute(_input, context) {
      const status = await host.status({ workspacePath: context.workspacePath });
      if (!status.isRepo) {
        return {
          callId: "git_status",
          ok: false,
          error: {
            code: "not_git_workspace",
            message: status.error ?? "Selected workspace is not inside a Git repository."
          }
        };
      }

      return {
        callId: "git_status",
        ok: true,
        output: {
          ...status,
          changedFiles: status.entries.length
        }
      };
    }
  };
}

export function createGitDiffTool(host: GitToolHost): ToolSpec<z.infer<typeof GitDiffInputSchema>, GitDiffOutput> {
  return {
    name: "git_diff",
    description: "Read the current Git diff for the selected workspace. Pass staged=true for cached changes.",
    capability: "readonly",
    approval: "never",
    inputSchema: GitDiffInputSchema,
    async execute(input, context) {
      const staged = input.staged ?? false;
      const result = await host.diff({ workspacePath: context.workspacePath, staged, path: input.path });
      if (!result.isRepo) {
        return {
          callId: "git_diff",
          ok: false,
          error: {
            code: "not_git_workspace",
            message: result.error ?? "Selected workspace is not inside a Git repository."
          }
        };
      }

      const truncated = truncateText(result.diff, MAX_DIFF_CHARS);
      return {
        callId: "git_diff",
        ok: true,
        output: {
          ...result,
          diff: truncated.text,
          staged,
          path: input.path,
          truncated: truncated.truncated
        }
      };
    }
  };
}

export function createGitBranchTool(host: GitToolHost): ToolSpec<z.infer<typeof GitStatusInputSchema>, GitBranchHostOutput> {
  return {
    name: "git_branch",
    description: "Read current branch and local branches for the selected workspace.",
    capability: "readonly",
    approval: "never",
    inputSchema: GitStatusInputSchema,
    async execute(_input, context) {
      const result = await host.branch({ workspacePath: context.workspacePath });
      if (!result.isRepo) {
        return notGitResult("git_branch", result.error);
      }

      return { callId: "git_branch", ok: true, output: result };
    }
  };
}

export function createGitLogTool(host: GitToolHost): ToolSpec<z.infer<typeof GitLogInputSchema>, GitTextOutput> {
  return {
    name: "git_log",
    description: "Read recent Git commit history for the selected workspace.",
    capability: "readonly",
    approval: "never",
    inputSchema: GitLogInputSchema,
    async execute(input, context) {
      const result = await host.log({ workspacePath: context.workspacePath, maxCount: input.maxCount ?? 20 });
      if (!result.isRepo) {
        return notGitResult("git_log", result.error);
      }

      const truncated = truncateText(result.output, MAX_DIFF_CHARS);
      return { callId: "git_log", ok: true, output: { ...result, output: truncated.text, truncated: truncated.truncated } };
    }
  };
}

export function createGitShowTool(host: GitToolHost): ToolSpec<z.infer<typeof GitShowInputSchema>, GitTextOutput> {
  return {
    name: "git_show",
    description: "Read a Git revision patch/stat, optionally limited to one path.",
    capability: "readonly",
    approval: "never",
    inputSchema: GitShowInputSchema,
    async execute(input, context) {
      const result = await host.show({ workspacePath: context.workspacePath, rev: input.rev, path: input.path });
      if (!result.isRepo) {
        return notGitResult("git_show", result.error);
      }

      const truncated = truncateText(result.output, MAX_DIFF_CHARS);
      return { callId: "git_show", ok: true, output: { ...result, output: truncated.text, truncated: truncated.truncated } };
    }
  };
}

export function createGitBlameTool(host: GitToolHost): ToolSpec<z.infer<typeof GitBlameInputSchema>, GitTextOutput> {
  return {
    name: "git_blame",
    description: "Read Git blame for one file path in the selected workspace.",
    capability: "readonly",
    approval: "never",
    inputSchema: GitBlameInputSchema,
    async execute(input, context) {
      const result = await host.blame({ workspacePath: context.workspacePath, path: input.path, rev: input.rev });
      if (!result.isRepo) {
        return notGitResult("git_blame", result.error);
      }

      const truncated = truncateText(result.output, MAX_DIFF_CHARS);
      return { callId: "git_blame", ok: true, output: { ...result, output: truncated.text, truncated: truncated.truncated } };
    }
  };
}

export function createGitTools(host: GitToolHost): ToolSpec[] {
  return [
    createGitStatusTool(host),
    createGitDiffTool(host),
    createGitBranchTool(host),
    createGitLogTool(host),
    createGitShowTool(host),
    createGitBlameTool(host)
  ];
}

function notGitResult(callId: string, error?: string) {
  return {
    callId,
    ok: false as const,
    error: {
      code: "not_git_workspace",
      message: error ?? "Selected workspace is not inside a Git repository."
    }
  };
}

function truncateText(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) {
    return { text, truncated: false };
  }

  return {
    text: text.slice(0, maxChars),
    truncated: true
  };
}
