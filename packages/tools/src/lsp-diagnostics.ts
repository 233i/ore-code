import { z } from "zod";
import type { FileToolHost } from "./file-tools";
import type { ProcessRunOutput, ProcessToolHost } from "./process-tools";
import type { ToolSpec } from "./spec";

type AnalyzerName = "typescript" | "rust" | "python" | "go" | "clangd";
type DiagnosticSeverity = "error" | "warning" | "information";
type AnalyzerStatus = "passed" | "failed" | "skipped" | "unavailable";

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 300_000;
const DEFAULT_MAX_DIAGNOSTICS = 200;
const MAX_OUTPUT_PREVIEW_CHARS = 4_000;

const AnalyzerNameSchema = z.enum(["typescript", "rust", "python", "go", "clangd"]);

const LspDiagnosticsInputSchema = z.object({
  analyzers: z.array(AnalyzerNameSchema).min(1).max(5).optional(),
  paths: z.array(z.string().trim().min(1)).max(50).optional(),
  maxDiagnostics: z.number().int().positive().max(500).optional(),
  timeoutMs: z.number().int().positive().max(MAX_TIMEOUT_MS).optional()
});

export interface LspDiagnostic {
  analyzer: AnalyzerName;
  file?: string;
  line?: number;
  column?: number;
  severity: DiagnosticSeverity;
  code?: string;
  message: string;
}

export interface LspAnalyzerResult {
  analyzer: AnalyzerName;
  command: string;
  status: AnalyzerStatus;
  exitCode: number | null;
  timedOut: boolean;
  diagnostics: LspDiagnostic[];
  stdoutPreview: string;
  stderrPreview: string;
}

export interface LspDiagnosticsOutput {
  diagnostics: LspDiagnostic[];
  analyzers: LspAnalyzerResult[];
  summary: {
    errors: number;
    warnings: number;
    information: number;
    analyzerCount: number;
    failedAnalyzers: number;
    skippedAnalyzers: number;
    unavailableAnalyzers: number;
    truncated: boolean;
  };
}

export function createLspDiagnosticsTool(
  fileHost: FileToolHost,
  processHost: ProcessToolHost
): ToolSpec<z.infer<typeof LspDiagnosticsInputSchema>, LspDiagnosticsOutput> {
  return {
    name: "lsp_diagnostics",
    description: "Run fixed language diagnostics for the selected workspace and return LSP-style errors and warnings. Supports TypeScript, Rust, Python/Pyright, Go/gopls, and clangd checks.",
    capability: "readonly",
    approval: "never",
    inputSchema: LspDiagnosticsInputSchema,
    async execute(input, context) {
      const analyzers = input.analyzers ?? ["typescript", "rust", "python", "go", "clangd"];
      const maxDiagnostics = input.maxDiagnostics ?? DEFAULT_MAX_DIAGNOSTICS;
      const results: LspAnalyzerResult[] = [];
      const diagnostics: LspDiagnostic[] = [];

      for (const analyzer of analyzers) {
        const output = await runAnalyzer({
          analyzer,
          fileHost,
          processHost,
          workspacePath: context.workspacePath,
          paths: input.paths,
          timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS
        });
        const parsed = analyzerResult(analyzer, output);
        results.push(parsed);
        diagnostics.push(...parsed.diagnostics);
      }

      const limitedDiagnostics = diagnostics.slice(0, maxDiagnostics);
      return {
        callId: "lsp_diagnostics",
        ok: true,
        output: {
          diagnostics: limitedDiagnostics,
          analyzers: results.map((result) => ({
            ...result,
            diagnostics: result.diagnostics.slice(0, maxDiagnostics)
          })),
          summary: summarizeDiagnostics(results, diagnostics, limitedDiagnostics.length < diagnostics.length)
        }
      };
    }
  };
}

async function runAnalyzer(input: {
  analyzer: AnalyzerName;
  fileHost: FileToolHost;
  processHost: ProcessToolHost;
  workspacePath: string;
  paths?: string[];
  timeoutMs: number;
}): Promise<ProcessRunOutput> {
  const plan = await analyzerProcessPlan(input);
  if (plan.kind === "skipped") {
    return syntheticProcessOutput(`${input.analyzer} diagnostic skipped: ${plan.reason}`, 0);
  }

  for (const candidate of plan.candidates) {
    try {
      return await input.processHost.run({
        workspacePath: input.workspacePath,
        program: candidate.program,
        args: candidate.args,
        timeoutMs: input.timeoutMs
      });
    } catch {
      continue;
    }
  }

  return syntheticProcessOutput(`${input.analyzer} diagnostic unavailable: ${plan.unavailableMessage}`, 127);
}

async function analyzerProcessPlan(input: {
  analyzer: AnalyzerName;
  fileHost: FileToolHost;
  workspacePath: string;
  paths?: string[];
}): Promise<
  | { kind: "skipped"; reason: string }
  | { kind: "run"; unavailableMessage: string; candidates: Array<{ program: string; args: string[] }> }
> {
  switch (input.analyzer) {
    case "typescript":
      if (!await hasFile(input.fileHost, input.workspacePath, "tsconfig.json")) {
        return { kind: "skipped", reason: "no tsconfig.json found" };
      }
      return {
        kind: "run",
        unavailableMessage: "tsc not found",
        candidates: [
          { program: "pnpm", args: ["exec", "tsc", "--noEmit", "--pretty", "false"] },
          { program: "tsc", args: ["--noEmit", "--pretty", "false"] }
        ]
      };
    case "rust":
      if (!await hasFile(input.fileHost, input.workspacePath, "Cargo.toml")) {
        return { kind: "skipped", reason: "no Cargo.toml found" };
      }
      return {
        kind: "run",
        unavailableMessage: "cargo not found",
        candidates: [{ program: "cargo", args: ["check", "--message-format", "short"] }]
      };
    case "python":
      if (!await hasFile(input.fileHost, input.workspacePath, ".py")) {
        return { kind: "skipped", reason: "no Python files found" };
      }
      return {
        kind: "run",
        unavailableMessage: "pyright not found",
        candidates: [{ program: "pyright", args: ["--outputjson"] }]
      };
    case "go":
      if (!await hasFile(input.fileHost, input.workspacePath, "go.mod")) {
        return { kind: "skipped", reason: "no go.mod found" };
      }
      return {
        kind: "run",
        unavailableMessage: "gopls/go not found",
        candidates: [
          { program: "gopls", args: ["check", "./..."] },
          { program: "go", args: ["test", "./..."] }
        ]
      };
    case "clangd": {
      const target = firstClangTarget(input.paths) ?? await firstSearchedClangTarget(input.fileHost, input.workspacePath);
      if (!target) {
        return { kind: "skipped", reason: "no C/C++ file found" };
      }
      return {
        kind: "run",
        unavailableMessage: "clangd not found",
        candidates: [{ program: "clangd", args: [`--check=${target}`, "--log=error"] }]
      };
    }
  }
}

async function hasFile(host: FileToolHost, workspacePath: string, query: string) {
  const result = await host.searchFiles({ workspacePath, path: ".", query, maxResults: 50 });
  return result.matches.some((match) => match.name === query || match.path.endsWith(query));
}

async function firstSearchedClangTarget(host: FileToolHost, workspacePath: string) {
  for (const query of [".cpp", ".cc", ".c", ".hpp", ".h"]) {
    const result = await host.searchFiles({ workspacePath, path: ".", query, maxResults: 20 });
    const match = result.matches.find((item) => isClangPath(item.path));
    if (match) {
      return match.path;
    }
  }
  return null;
}

function syntheticProcessOutput(message: string, exitCode: number): ProcessRunOutput {
  const unavailable = exitCode === 127;
  return {
    program: "",
    args: [],
    command: message,
    exitCode,
    timedOut: false,
    durationMs: 0,
    stdout: unavailable ? "" : message,
    stderr: unavailable ? message : ""
  };
}

function analyzerResult(analyzer: AnalyzerName, output: ProcessRunOutput): LspAnalyzerResult {
  const diagnostics = parseDiagnostics(analyzer, output.stdout, output.stderr);
  return {
    analyzer,
    command: output.command,
    status: statusFromOutput(output, diagnostics),
    exitCode: output.exitCode,
    timedOut: output.timedOut,
    diagnostics,
    stdoutPreview: preview(output.stdout),
    stderrPreview: preview(output.stderr)
  };
}

function statusFromOutput(output: ProcessRunOutput, diagnostics: LspDiagnostic[]): AnalyzerStatus {
  const text = `${output.stdout}\n${output.stderr}`.toLowerCase();
  if (text.includes(" diagnostic skipped:")) {
    return "skipped";
  }
  if (output.exitCode === 127 || text.includes(" diagnostic unavailable:")) {
    return "unavailable";
  }
  if (output.timedOut || output.exitCode !== 0 || diagnostics.some((item) => item.severity === "error")) {
    return "failed";
  }
  return "passed";
}

function parseDiagnostics(analyzer: AnalyzerName, stdout: string, stderr: string): LspDiagnostic[] {
  if (analyzer === "python") {
    const pyright = parsePyrightJson(stdout);
    if (pyright.length > 0) {
      return pyright;
    }
  }

  const text = `${stdout}\n${stderr}`;
  if (analyzer === "typescript") {
    return parseTypeScript(text);
  }
  return parseColonDiagnostics(analyzer, text);
}

function parseTypeScript(text: string): LspDiagnostic[] {
  const diagnostics: LspDiagnostic[] = [];
  const pattern = /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.+)$/gm;
  for (const match of text.matchAll(pattern)) {
    diagnostics.push({
      analyzer: "typescript",
      file: match[1],
      line: Number(match[2]),
      column: Number(match[3]),
      severity: normalizeSeverity(match[4]),
      code: match[5],
      message: match[6].trim()
    });
  }
  return diagnostics;
}

function parsePyrightJson(stdout: string): LspDiagnostic[] {
  try {
    const parsed = JSON.parse(stdout) as {
      generalDiagnostics?: Array<{
        file?: string;
        severity?: string;
        message?: string;
        rule?: string;
        range?: { start?: { line?: number; character?: number } };
      }>;
    };
    return (parsed.generalDiagnostics ?? []).map((item) => ({
      analyzer: "python" as const,
      file: item.file,
      line: item.range?.start?.line !== undefined ? item.range.start.line + 1 : undefined,
      column: item.range?.start?.character !== undefined ? item.range.start.character + 1 : undefined,
      severity: normalizeSeverity(item.severity),
      code: item.rule,
      message: item.message ?? "Pyright diagnostic"
    }));
  } catch {
    return [];
  }
}

function parseColonDiagnostics(analyzer: AnalyzerName, text: string): LspDiagnostic[] {
  const diagnostics: LspDiagnostic[] = [];
  const pattern = /^(.+?):(\d+):(?:(\d+):)?\s*(error|warning|info|information|note)(?:\[[^\]]+\])?:\s+(.+)$/gm;
  for (const match of text.matchAll(pattern)) {
    diagnostics.push({
      analyzer,
      file: match[1],
      line: Number(match[2]),
      column: match[3] ? Number(match[3]) : undefined,
      severity: normalizeSeverity(match[4]),
      message: match[5].trim()
    });
  }
  return diagnostics;
}

function normalizeSeverity(value: string | undefined): DiagnosticSeverity {
  const normalized = value?.toLowerCase();
  if (normalized === "warning") {
    return "warning";
  }
  if (normalized === "info" || normalized === "information" || normalized === "note") {
    return "information";
  }
  return "error";
}

function summarizeDiagnostics(results: LspAnalyzerResult[], diagnostics: LspDiagnostic[], truncated: boolean) {
  return {
    errors: diagnostics.filter((item) => item.severity === "error").length,
    warnings: diagnostics.filter((item) => item.severity === "warning").length,
    information: diagnostics.filter((item) => item.severity === "information").length,
    analyzerCount: results.length,
    failedAnalyzers: results.filter((item) => item.status === "failed").length,
    skippedAnalyzers: results.filter((item) => item.status === "skipped").length,
    unavailableAnalyzers: results.filter((item) => item.status === "unavailable").length,
    truncated
  };
}

function firstClangTarget(paths: string[] | undefined) {
  return paths?.find(isClangPath) ?? null;
}

function isClangPath(path: string) {
  return /\.(c|cc|cpp|h|hpp|m|mm)$/i.test(path);
}

function preview(value: string) {
  return value.length > MAX_OUTPUT_PREVIEW_CHARS ? `${value.slice(0, MAX_OUTPUT_PREVIEW_CHARS)}...` : value;
}
