import { z } from "zod";
import { assessCommandRisk, type CommandRiskAssessment } from "./command-risk";
import type { SandboxPolicy, SandboxRunMetadata } from "./process-tools";
import type { ToolSpec } from "./spec";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 300_000;
const MAX_STREAM_CHARS = 20_000;

const ShellInputSchema = z.object({
  command: z.string().min(1),
  timeoutMs: z.number().int().positive().max(MAX_TIMEOUT_MS).optional()
});

const ShellJobIdInputSchema = z.object({
  jobId: z.string().min(1)
});

export interface ShellToolHost {
  run(input: {
    workspacePath: string;
    command: string;
    timeoutMs: number;
    sandboxPolicy?: SandboxPolicy;
    onOutput?: (delta: { stream: "stdout" | "stderr"; text: string }) => void;
  }): Promise<ShellRunOutput>;
}

export interface ShellJobToolHost {
  start(input: {
    workspacePath: string;
    command: string;
    timeoutMs: number;
  }): Promise<ShellJobStartOutput>;
  get(input: {
    workspacePath: string;
    jobId: string;
  }): Promise<ShellJobStartOutput>;
}

export interface ShellRunOutput {
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  sandbox?: SandboxRunMetadata;
}

export interface ShellJobStartOutput {
  id: string;
  workspacePath: string;
  command: string;
  status: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs?: number;
  timedOut: boolean;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  createdAt: string;
  updatedAt: string;
  error?: string;
  risk?: CommandRiskAssessment;
}

export type ShellJobStatusOutput = Omit<
  ShellJobStartOutput,
  "stdout" | "stderr" | "stdoutTruncated" | "stderrTruncated"
>;

export interface ShellJobOutputOutput extends ShellJobStatusOutput {
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
}

export interface ShellToolOutput extends ShellRunOutput {
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  risk: CommandRiskAssessment;
}

export function createShellTool(host: ShellToolHost): ToolSpec<z.infer<typeof ShellInputSchema>, ShellToolOutput> {
  return {
    name: "exec_shell",
    description: "Run a foreground shell command in the selected workspace with a timeout.",
    capability: "shell",
    approval: "required",
    inputSchema: ShellInputSchema,
    async execute(input, context) {
      const risk = assessCommandRisk(input.command);
      const output = await host.run({
        workspacePath: context.workspacePath,
        command: input.command,
        timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        onOutput: context.onCommandOutput && context.toolCallId
          ? (delta) => context.onCommandOutput?.({ callId: context.toolCallId ?? "exec_shell", ...delta })
          : undefined
      });

      return {
        callId: "exec_shell",
        ok: true,
        output: truncateShellOutput(output, risk)
      };
    }
  };
}

export function createStartShellJobTool(
  host: ShellJobToolHost
): ToolSpec<z.infer<typeof ShellInputSchema>, ShellJobStartOutput> {
  return {
    name: "start_shell_job",
    description: "Start a background shell command in the selected workspace and return a job id for polling.",
    capability: "shell",
    approval: "required",
    inputSchema: ShellInputSchema,
    async execute(input, context) {
      const risk = assessCommandRisk(input.command);
      const output = await host.start({
        workspacePath: context.workspacePath,
        command: input.command,
        timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS
      });

      return {
        callId: "start_shell_job",
        ok: true,
        output: { ...output, risk }
      };
    }
  };
}

export function createShellJobStatusTool(
  host: ShellJobToolHost
): ToolSpec<z.infer<typeof ShellJobIdInputSchema>, ShellJobStatusOutput> {
  return {
    name: "shell_job_status",
    description: "Read the status summary for a background shell job.",
    capability: "readonly",
    approval: "never",
    inputSchema: ShellJobIdInputSchema,
    async execute(input, context) {
      const output = await host.get({
        workspacePath: context.workspacePath,
        jobId: input.jobId
      });
      ensureSameWorkspace(output, context.workspacePath);

      return {
        callId: "shell_job_status",
        ok: true,
        output: toShellJobStatusOutput(output)
      };
    }
  };
}

export function createShellJobOutputTool(
  host: ShellJobToolHost
): ToolSpec<z.infer<typeof ShellJobIdInputSchema>, ShellJobOutputOutput> {
  return {
    name: "shell_job_output",
    description: "Read stdout and stderr for a background shell job.",
    capability: "readonly",
    approval: "never",
    inputSchema: ShellJobIdInputSchema,
    async execute(input, context) {
      const output = await host.get({
        workspacePath: context.workspacePath,
        jobId: input.jobId
      });
      ensureSameWorkspace(output, context.workspacePath);

      return {
        callId: "shell_job_output",
        ok: true,
        output: toShellJobOutputOutput(output)
      };
    }
  };
}

export function createShellJobTools(host: ShellJobToolHost): ToolSpec[] {
  return [
    createStartShellJobTool(host),
    createShellJobStatusTool(host),
    createShellJobOutputTool(host)
  ];
}

function truncateShellOutput(output: ShellRunOutput, risk: CommandRiskAssessment): ShellToolOutput {
  const stdout = truncateText(output.stdout, MAX_STREAM_CHARS);
  const stderr = truncateText(output.stderr, MAX_STREAM_CHARS);

  return {
    ...output,
    stdout: stdout.text,
    stderr: stderr.text,
    stdoutTruncated: stdout.truncated,
    stderrTruncated: stderr.truncated,
    risk
  };
}

function toShellJobStatusOutput(output: ShellJobStartOutput): ShellJobStatusOutput {
  return {
    id: output.id,
    workspacePath: output.workspacePath,
    command: output.command,
    status: output.status,
    exitCode: output.exitCode,
    durationMs: output.durationMs,
    timedOut: output.timedOut,
    createdAt: output.createdAt,
    updatedAt: output.updatedAt,
    error: output.error
  };
}

function toShellJobOutputOutput(output: ShellJobStartOutput): ShellJobOutputOutput {
  return {
    ...toShellJobStatusOutput(output),
    stdout: output.stdout,
    stderr: output.stderr,
    stdoutTruncated: output.stdoutTruncated,
    stderrTruncated: output.stderrTruncated
  };
}

function ensureSameWorkspace(output: ShellJobStartOutput, workspacePath: string) {
  if (workspacePath !== "." && output.workspacePath !== workspacePath) {
    throw new Error("shell job belongs to a different workspace");
  }
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
