import { z } from "zod";
import { codeExecutionSandboxPolicy, type ProcessRunOutput, type ProcessToolHost } from "./process-tools";
import type { ToolSpec } from "./spec";

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 30_000;
const MAX_CODE_CHARS = 20_000;
const MAX_STDIN_CHARS = 100_000;
const MAX_OUTPUT_CHARS = 20_000;

const CodeExecutionInputSchema = z.object({
  language: z.enum(["python"]).default("python"),
  code: z.string().min(1).max(MAX_CODE_CHARS),
  stdin: z.string().max(MAX_STDIN_CHARS).optional(),
  timeoutMs: z.number().int().positive().max(MAX_TIMEOUT_MS).optional()
});

export type CodeExecutionInput = z.infer<typeof CodeExecutionInputSchema>;

export interface CodeExecutionOutput {
  language: "python";
  command: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  passed: boolean;
  summary: string;
}

export function createCodeExecutionTool(host: ProcessToolHost): ToolSpec<CodeExecutionInput, CodeExecutionOutput> {
  return {
    name: "code_execution",
    description: "Run small deterministic Python snippets for statistics, parsing, and lightweight data processing. The runtime uses restricted builtins and an allowlisted module importer.",
    capability: "shell",
    approval: "required",
    inputSchema: CodeExecutionInputSchema,
    modelParameters: {
      type: "object",
      properties: {
        language: { type: "string", enum: ["python"] },
        code: { type: "string", description: "Small deterministic Python snippet. Avoid filesystem, network, subprocess, or package installation." },
        stdin: { type: "string", description: "Optional stdin text available through sys.stdin." },
        timeoutMs: { type: "number", description: "Timeout in milliseconds, max 30000." }
      },
      required: ["code"]
    },
    async execute(input, context) {
      const output = await runPythonSandbox(host, {
        workspacePath: context.workspacePath,
        code: input.code,
        stdin: input.stdin ?? "",
        timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        onOutput: context.onCommandOutput && context.toolCallId
          ? (delta) => context.onCommandOutput?.({ callId: context.toolCallId ?? "code_execution", ...delta })
          : undefined
      });

      return {
        callId: "code_execution",
        ok: true,
        output: codeExecutionOutput(output)
      };
    }
  };
}

async function runPythonSandbox(
  host: ProcessToolHost,
  input: {
    workspacePath: string;
    code: string;
    stdin: string;
    timeoutMs: number;
    onOutput?: (delta: { stream: "stdout" | "stderr"; text: string }) => void;
  }
) {
  const payload = `${JSON.stringify({ code: input.code, stdin: input.stdin })}\n`;
  const candidates = pythonCandidates();
  const errors: string[] = [];

  for (const candidate of candidates) {
    try {
      return await host.run({
        workspacePath: input.workspacePath,
        program: candidate.program,
        args: [...candidate.prefixArgs, "-I", "-S", "-c", pythonSandboxProgram()],
        stdin: payload,
        sandboxPolicy: codeExecutionSandboxPolicy(),
        timeoutMs: input.timeoutMs,
        onOutput: input.onOutput
      });
    } catch (error) {
      errors.push(`${candidate.program}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    program: candidates[0]?.program ?? "python",
    args: [],
    command: "python",
    exitCode: 127,
    stdout: "",
    stderr: errors.join("\n") || "Python runtime not found",
    durationMs: 0,
    timedOut: false
  };
}

function pythonCandidates() {
  const isWindows = typeof navigator !== "undefined" && /win/i.test(navigator.platform);
  return isWindows
    ? [
        { program: "py", prefixArgs: ["-3"] },
        { program: "python", prefixArgs: [] },
        { program: "python3", prefixArgs: [] }
      ]
    : [
        { program: "python3", prefixArgs: [] },
        { program: "python", prefixArgs: [] }
      ];
}

function pythonSandboxProgram() {
  return [
    "import collections, contextlib, csv, datetime, decimal, fractions, functools, itertools, io, json, math, random, re, statistics, string, sys",
    "payload = json.loads(sys.stdin.read() or '{}')",
    "USER_CODE = payload.get('code', '')",
    "USER_STDIN = payload.get('stdin', '')",
    "ALLOWED_MODULES = {",
    "  'collections': collections, 'contextlib': contextlib, 'csv': csv, 'datetime': datetime,",
    "  'decimal': decimal, 'fractions': fractions, 'functools': functools, 'itertools': itertools,",
    "  'io': io, 'json': json, 'math': math, 'random': random, 're': re,",
    "  'statistics': statistics, 'string': string, 'sys': sys",
    "}",
    "def safe_import(name, globals=None, locals=None, fromlist=(), level=0):",
    "    root = name.split('.')[0]",
    "    if level != 0 or root not in ALLOWED_MODULES:",
    "        raise ImportError(f'module not allowed: {name}')",
    "    return ALLOWED_MODULES[root]",
    "safe_builtins = {",
    "  '__import__': safe_import, 'abs': abs, 'all': all, 'any': any, 'bool': bool,",
    "  'dict': dict, 'enumerate': enumerate, 'filter': filter, 'float': float, 'int': int,",
    "  'len': len, 'list': list, 'map': map, 'max': max, 'min': min, 'pow': pow,",
    "  'print': print, 'range': range, 'repr': repr, 'reversed': reversed, 'round': round,",
    "  'set': set, 'slice': slice, 'sorted': sorted, 'str': str, 'sum': sum, 'tuple': tuple, 'zip': zip,",
    "  'Exception': Exception, 'ValueError': ValueError, 'TypeError': TypeError, 'IndexError': IndexError, 'KeyError': KeyError",
    "}",
    "globals_dict = {'__builtins__': safe_builtins, **ALLOWED_MODULES}",
    "sys.stdin = io.StringIO(USER_STDIN)",
    "exec(USER_CODE, globals_dict, globals_dict)"
  ].join("\n");
}

function codeExecutionOutput(output: ProcessRunOutput): CodeExecutionOutput {
  const stdout = truncateText(output.stdout, MAX_OUTPUT_CHARS);
  const stderr = truncateText(output.stderr, MAX_OUTPUT_CHARS);
  const passed = output.exitCode === 0 && !output.timedOut;
  return {
    language: "python",
    command: output.command,
    exitCode: output.exitCode,
    timedOut: output.timedOut,
    durationMs: output.durationMs,
    stdout: stdout.text,
    stderr: stderr.text,
    stdoutTruncated: stdout.truncated,
    stderrTruncated: stderr.truncated,
    passed,
    summary: passed
      ? `Python snippet completed in ${output.durationMs}ms.`
      : `Python snippet failed${output.timedOut ? " after timeout" : ` with exit ${output.exitCode ?? "unknown"}`}.`
  };
}

function truncateText(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) {
    return { text, truncated: false };
  }
  return { text: text.slice(0, maxChars), truncated: true };
}
