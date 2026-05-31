import { z } from "zod";
import { assessCommandRisk, type CommandRiskAssessment } from "./command-risk";
import { processCommandString, runTestsSandboxPolicy, type ProcessToolHost } from "./process-tools";
import type { ShellRunOutput, ShellToolHost } from "./shell-tools";
import type { ToolSpec } from "./spec";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 300_000;
const MAX_STREAM_CHARS = 20_000;
const MAX_FAILURE_SUMMARY_CHARS = 2_000;

export const RUN_TEST_TARGETS = [
  "auto",
  "root",
  "desktop",
  "agent-core",
  "tools",
  "protocol",
  "harness",
  "tauri"
] as const;

export type RunTestsTarget = typeof RUN_TEST_TARGETS[number];

const RunTestsInputSchema = z.object({
  target: z.enum(RUN_TEST_TARGETS).optional(),
  command: z.string().min(1).optional(),
  timeoutMs: z.number().int().positive().max(MAX_TIMEOUT_MS).optional()
}).refine((input) => input.command !== undefined || input.target !== undefined, {
  message: "target or command is required"
});

export type RunTestsInput = z.infer<typeof RunTestsInputSchema>;

export interface RunTestsOutput extends ShellRunOutput {
  target: RunTestsTarget;
  passed: boolean;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  summary: string;
  failureSummary: string;
  risk: CommandRiskAssessment;
}

type RunTestsProcessCommand = {
  program: string;
  args: string[];
};

const TARGET_PROCESS_COMMANDS: Record<RunTestsTarget, RunTestsProcessCommand> = {
  auto: { program: "pnpm", args: ["test"] },
  root: { program: "pnpm", args: ["test"] },
  desktop: { program: "pnpm", args: ["--filter", "@seekforge/desktop", "test"] },
  "agent-core": { program: "pnpm", args: ["--filter", "@seekforge/agent-core", "test"] },
  tools: { program: "pnpm", args: ["--filter", "@seekforge/tools", "test"] },
  protocol: { program: "pnpm", args: ["--filter", "@seekforge/protocol", "test"] },
  harness: { program: "pnpm", args: ["test:harness"] },
  tauri: { program: "cargo", args: ["test", "--manifest-path", "apps/desktop/src-tauri/Cargo.toml"] }
};

export function createRunTestsTool(
  host: ShellToolHost,
  options: { processHost?: ProcessToolHost } = {}
): ToolSpec<RunTestsInput, RunTestsOutput> {
  return {
    name: "run_tests",
    description: "Run the selected workspace test command and return a concise structured test summary.",
    capability: "shell",
    approval: "required",
    inputSchema: RunTestsInputSchema,
    modelParameters: {
      type: "object",
      properties: {
        target: {
          type: "string",
          enum: RUN_TEST_TARGETS,
          description: "Known SeekForge test target. Use auto/root for the whole workspace."
        },
        command: {
          type: "string",
          description: "Optional custom test command. Explicit command overrides target."
        },
        timeoutMs: {
          type: "number",
          description: "Optional timeout in milliseconds, max 300000."
        }
      }
    },
    async execute(input, context) {
      const resolved = resolveRunTestsCommand(input);
      const risk = assessCommandRisk(resolved.command);
      const onOutput = context.onCommandOutput && context.toolCallId
        ? (delta: { stream: "stdout" | "stderr"; text: string }) => {
            context.onCommandOutput?.({ callId: context.toolCallId ?? "run_tests", ...delta });
          }
        : undefined;
      const output = options.processHost && !resolved.custom
        ? await runBuiltInTarget(options.processHost, {
            target: resolved.target,
            timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
            workspacePath: context.workspacePath,
            onOutput
          })
        : await host.run({
            workspacePath: context.workspacePath,
            command: resolved.command,
            sandboxPolicy: resolved.custom ? undefined : runTestsSandboxPolicy(),
            timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
            onOutput
          });

      return {
        callId: "run_tests",
        ok: true,
        output: summarizeRunTestsOutput(output, resolved.target, risk)
      };
    }
  };
}

export function resolveRunTestsCommand(input: unknown): { target: RunTestsTarget; command: string; custom: boolean } {
  if (!input || typeof input !== "object") {
    return { target: "auto", command: targetCommandString("auto"), custom: false };
  }

  const record = input as Record<string, unknown>;
  const explicitCommand = typeof record.command === "string" && record.command.trim()
    ? record.command.trim()
    : "";
  const target = isRunTestsTarget(record.target) ? record.target : "auto";

  return {
    target,
    command: explicitCommand || targetCommandString(target),
    custom: Boolean(explicitCommand)
  };
}

function targetCommandString(target: RunTestsTarget) {
  const command = TARGET_PROCESS_COMMANDS[target];
  return processCommandString(command.program, command.args);
}

async function runBuiltInTarget(
  host: ProcessToolHost,
  input: {
    target: RunTestsTarget;
    timeoutMs: number;
    workspacePath: string;
    onOutput?: (delta: { stream: "stdout" | "stderr"; text: string }) => void;
  }
): Promise<ShellRunOutput> {
  const command = TARGET_PROCESS_COMMANDS[input.target];
  return await host.run({
    workspacePath: input.workspacePath,
    program: command.program,
    args: command.args,
    sandboxPolicy: runTestsSandboxPolicy(),
    timeoutMs: input.timeoutMs,
    onOutput: input.onOutput
  });
}

function summarizeRunTestsOutput(
  output: ShellRunOutput,
  target: RunTestsTarget,
  risk: CommandRiskAssessment
): RunTestsOutput {
  const stdout = truncateText(output.stdout, MAX_STREAM_CHARS);
  const stderr = truncateText(output.stderr, MAX_STREAM_CHARS);
  const passed = output.exitCode === 0 && !output.timedOut;
  const failureSummary = passed ? "" : summarizeFailure(output);

  return {
    ...output,
    target,
    passed,
    stdout: stdout.text,
    stderr: stderr.text,
    stdoutTruncated: stdout.truncated,
    stderrTruncated: stderr.truncated,
    summary: passed
      ? `Tests passed for ${target} in ${output.durationMs}ms.`
      : `Tests failed for ${target}${output.timedOut ? " after timeout" : ` with exit ${output.exitCode ?? "unknown"}`}.`,
    failureSummary,
    risk
  };
}

function summarizeFailure(output: ShellRunOutput) {
  const lines = `${output.stderr}\n${output.stdout}`
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);
  const signalLines = lines.filter((line) => isFailureSignal(line));
  const summaryLines = (signalLines.length > 0 ? signalLines : lines).slice(0, 24);
  return truncateText(summaryLines.join("\n"), MAX_FAILURE_SUMMARY_CHARS).text;
}

function isFailureSignal(line: string) {
  return /\b(fail(?:ed|ure)?|error|exception|timeout|timed out|not found|cannot|denied|panic|expected|received)\b/i
    .test(line);
}

function isRunTestsTarget(value: unknown): value is RunTestsTarget {
  return typeof value === "string" && (RUN_TEST_TARGETS as readonly string[]).includes(value);
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
