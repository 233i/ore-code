import type { RuntimeEvent, ToolCall, ToolResult } from "@ore-code/protocol";

const OUTPUT_TAIL_CHARS = 2_000;

export type ShellJobStatus = "requested" | "approval" | "running" | "completed" | "failed" | "denied";

export interface ShellJobState {
  id: string;
  turnId: string;
  callId: string;
  command: string;
  timeoutMs?: number;
  status: ShellJobStatus;
  createdAt: string;
  updatedAt: string;
  approvalDecision?: string;
  exitCode?: number | null;
  durationMs?: number;
  timedOut?: boolean;
  stdoutTail?: string;
  stderrTail?: string;
  errorMessage?: string;
}

export function deriveShellJobs(events: RuntimeEvent[]): ShellJobState[] {
  const jobs = new Map<string, ShellJobState>();

  for (const event of events) {
    if (event.type === "tool_call_requested" && isShellCall(event.call)) {
      upsertShellCall(jobs, event.turnId, event.call, "requested", event.createdAt);
    }

    if (event.type === "approval_requested" && isShellCall(event.call)) {
      upsertShellCall(jobs, event.turnId, event.call, "approval", event.createdAt);
    }

    if (event.type === "approval_decided") {
      for (const job of jobs.values()) {
        if (job.callId === event.decision.callId) {
          job.approvalDecision = event.decision.decision;
          job.updatedAt = event.createdAt;
        }
      }
    }

    if (event.type === "tool_started" && isShellCall(event.call)) {
      upsertShellCall(jobs, event.turnId, event.call, "running", event.createdAt);
    }

    if (event.type === "tool_completed" || event.type === "tool_failed") {
      updateShellResult(jobs, event.turnId, event.result, event.createdAt);
    }
  }

  return [...jobs.values()].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

function upsertShellCall(
  jobs: Map<string, ShellJobState>,
  turnId: string,
  call: ToolCall,
  status: ShellJobStatus,
  timestamp: string
) {
  const id = shellJobId(turnId, call.id);
  const existing = jobs.get(id);
  const input = parseShellInput(call.input);

  jobs.set(id, {
    id,
    turnId,
    callId: call.id,
    command: input.command,
    timeoutMs: input.timeoutMs,
    status,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
    approvalDecision: existing?.approvalDecision,
    exitCode: existing?.exitCode,
    durationMs: existing?.durationMs,
    timedOut: existing?.timedOut,
    stdoutTail: existing?.stdoutTail,
    stderrTail: existing?.stderrTail,
    errorMessage: existing?.errorMessage
  });
}

function updateShellResult(
  jobs: Map<string, ShellJobState>,
  turnId: string,
  result: ToolResult,
  timestamp: string
) {
  const id = shellJobId(turnId, result.callId);
  const existing = jobs.get(id);
  if (!existing) {
    return;
  }

  const output = parseShellOutput(result.output);
  const status = shellResultStatus(result);
  jobs.set(id, {
    ...existing,
    status,
    updatedAt: timestamp,
    exitCode: output?.exitCode,
    durationMs: output?.durationMs,
    timedOut: output?.timedOut,
    stdoutTail: output?.stdout ? tailText(output.stdout, OUTPUT_TAIL_CHARS) : undefined,
    stderrTail: output?.stderr ? tailText(output.stderr, OUTPUT_TAIL_CHARS) : undefined,
    errorMessage: result.error?.message
  });
}

function isShellCall(call: ToolCall) {
  return call.name === "exec_shell";
}

function parseShellInput(input: unknown): { command: string; timeoutMs?: number } {
  if (!isRecord(input)) {
    return { command: "" };
  }

  return {
    command: typeof input.command === "string" ? input.command : "",
    timeoutMs: typeof input.timeoutMs === "number" ? input.timeoutMs : undefined
  };
}

function parseShellOutput(output: unknown):
  | {
      exitCode: number | null;
      durationMs: number;
      timedOut: boolean;
      stdout: string;
      stderr: string;
    }
  | undefined {
  if (!isRecord(output)) {
    return undefined;
  }

  if (typeof output.durationMs !== "number" || typeof output.timedOut !== "boolean") {
    return undefined;
  }

  return {
    exitCode: typeof output.exitCode === "number" || output.exitCode === null ? output.exitCode : null,
    durationMs: output.durationMs,
    timedOut: output.timedOut,
    stdout: typeof output.stdout === "string" ? output.stdout : "",
    stderr: typeof output.stderr === "string" ? output.stderr : ""
  };
}

function shellResultStatus(result: ToolResult): ShellJobStatus {
  if (result.ok && !shellOutputFailed(result.output)) {
    return "completed";
  }

  if (result.error?.code === "approval_denied" || result.error?.code === "approval_required") {
    return "denied";
  }

  return "failed";
}

function shellOutputFailed(output: unknown) {
  const parsed = parseShellOutput(output);
  if (!parsed) {
    return false;
  }

  return parsed.timedOut || (parsed.exitCode !== null && parsed.exitCode !== 0);
}

function tailText(text: string, maxChars: number) {
  if (text.length <= maxChars) {
    return text;
  }

  return text.slice(text.length - maxChars);
}

function shellJobId(turnId: string, callId: string) {
  return `${turnId}:${callId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
