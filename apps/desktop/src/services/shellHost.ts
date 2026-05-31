import type { ShellRunOutput, ShellToolHost } from "@seekforge/tools";
import { isTauriRuntime } from "./fileHost";
import { createTauriShellHost, createTauriShellJobHost } from "./tauriShellHost";

export interface ShellJobRecord {
  id: string;
  workspacePath: string;
  command: string;
  status: "running" | "canceling" | "completed" | "failed" | "canceled";
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
}

export interface ShellJobHost {
  start(input: { workspacePath: string; command: string; timeoutMs: number }): Promise<ShellJobRecord>;
  get(input: { workspacePath: string; jobId: string }): Promise<ShellJobRecord>;
  list(): Promise<ShellJobRecord[]>;
  cancel(jobId: string): Promise<ShellJobRecord>;
}

const browserPreviewJobs: ShellJobRecord[] = [];

export function createRuntimeShellHost(): ShellToolHost {
  if (isTauriRuntime()) {
    return createTauriShellHost();
  }

  return createBrowserPreviewShellHost();
}

export function createRuntimeShellJobHost(): ShellJobHost {
  if (isTauriRuntime()) {
    return createTauriShellJobHost();
  }

  return createBrowserPreviewShellJobHost();
}

function createBrowserPreviewShellHost(): ShellToolHost {
  return {
    async run(input): Promise<ShellRunOutput> {
      const stderr = "Browser preview does not execute shell commands. Run the Tauri app for real shell execution.";
      input.onOutput?.({ stream: "stderr", text: stderr });
      return {
        command: input.command,
        exitCode: 127,
        stdout: "",
        stderr,
        durationMs: 0,
        timedOut: false
      };
    }
  };
}

function createBrowserPreviewShellJobHost(): ShellJobHost {
  return {
    async start(input): Promise<ShellJobRecord> {
      const now = String(Date.now());
      const job: ShellJobRecord = {
        id: `browser-job-${now}`,
        workspacePath: input.workspacePath,
        command: input.command,
        status: "completed",
        exitCode: 127,
        stdout: "",
        stderr: "Browser preview does not execute background shell jobs. Run the Tauri app for real shell execution.",
        durationMs: 0,
        timedOut: false,
        stdoutTruncated: false,
        stderrTruncated: false,
        createdAt: now,
        updatedAt: now
      };
      browserPreviewJobs.unshift(job);
      return job;
    },
    async list(): Promise<ShellJobRecord[]> {
      return browserPreviewJobs;
    },
    async get(input): Promise<ShellJobRecord> {
      const job = browserPreviewJobs.find((item) => item.id === input.jobId);
      if (!job) {
        throw new Error("shell job does not exist");
      }
      return job;
    },
    async cancel(jobId): Promise<ShellJobRecord> {
      const job = browserPreviewJobs.find((item) => item.id === jobId);
      if (!job) {
        throw new Error("shell job does not exist");
      }
      return job;
    }
  };
}
