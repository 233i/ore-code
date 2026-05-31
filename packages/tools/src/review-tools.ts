import { z } from "zod";
import type { GitToolHost } from "./git-tools";
import type { ToolSpec } from "./spec";

const MAX_REVIEW_DIFF_CHARS = 120_000;
const DEFAULT_MAX_FINDINGS = 50;

const StructuredReviewInputSchema = z.object({
  scope: z.enum(["workspace", "staged", "file", "diff", "revision", "pr"]).optional(),
  staged: z.boolean().optional(),
  path: z.string().min(1).optional(),
  diff: z.string().min(1).optional(),
  rev: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
  maxFindings: z.number().int().positive().max(200).optional()
});

export type StructuredReviewInput = z.infer<typeof StructuredReviewInputSchema>;

export type StructuredReviewSeverity = "critical" | "warning" | "info";

export interface StructuredReviewFinding {
  severity: StructuredReviewSeverity;
  category: string;
  path?: string;
  line?: number;
  message: string;
  evidence?: string;
  recommendation?: string;
}

export interface StructuredReviewFile {
  path: string;
  additions: number;
  deletions: number;
}

export interface StructuredReviewOutput {
  scope: NonNullable<StructuredReviewInput["scope"]>;
  source: string;
  summary: string;
  riskLevel: "none" | "low" | "medium" | "high";
  files: StructuredReviewFile[];
  findings: StructuredReviewFinding[];
  findingCounts: Record<StructuredReviewSeverity, number>;
  reviewedDiffChars: number;
  truncated: boolean;
}

export function createStructuredReviewTool(host: GitToolHost): ToolSpec<StructuredReviewInput, StructuredReviewOutput> {
  return {
    name: "structured_review",
    description: "Run a structured code review over workspace, staged, file, revision, PR, or provided diff input.",
    capability: "readonly",
    approval: "never",
    inputSchema: StructuredReviewInputSchema,
    modelParameters: {
      type: "object",
      properties: {
        scope: {
          type: "string",
          enum: ["workspace", "staged", "file", "diff", "revision", "pr"],
          description: "Review scope. Defaults to workspace diff."
        },
        staged: { type: "boolean", description: "Review staged changes when scope is workspace/file." },
        path: { type: "string", description: "Optional file path for file-scoped review." },
        diff: { type: "string", description: "Explicit diff text for diff or PR review." },
        rev: { type: "string", description: "Git revision for revision review." },
        title: { type: "string", description: "Optional PR or review title for context." },
        maxFindings: { type: "number", description: "Maximum findings to return, up to 200." }
      }
    },
    async execute(input, context) {
      const source = await resolveReviewSource(host, context.workspacePath, input);
      if (!source.ok) {
        return {
          callId: "structured_review",
          ok: false,
          error: {
            code: source.code,
            message: source.message
          }
        };
      }

      const truncated = truncateText(source.diff, MAX_REVIEW_DIFF_CHARS);
      return {
        callId: "structured_review",
        ok: true,
        output: reviewDiff({
          diff: truncated.text,
          maxFindings: input.maxFindings ?? DEFAULT_MAX_FINDINGS,
          scope: source.scope,
          source: source.source,
          truncated: truncated.truncated
        })
      };
    }
  };
}

async function resolveReviewSource(
  host: GitToolHost,
  workspacePath: string,
  input: StructuredReviewInput
): Promise<
  | { ok: true; scope: NonNullable<StructuredReviewInput["scope"]>; source: string; diff: string }
  | { ok: false; code: string; message: string }
> {
  const scope = input.scope ?? (input.diff ? "diff" : input.rev ? "revision" : input.path ? "file" : input.staged ? "staged" : "workspace");
  if (input.diff) {
    return { ok: true, scope, source: input.title ?? "provided diff", diff: input.diff };
  }

  if (scope === "pr") {
    return {
      ok: false,
      code: "pr_diff_required",
      message: "structured_review scope=pr requires a diff field in this version."
    };
  }

  if (scope === "revision") {
    const rev = input.rev ?? "HEAD";
    const result = await host.show({ workspacePath, rev, path: input.path });
    if (!result.isRepo) {
      return { ok: false, code: "not_git_workspace", message: result.error ?? "Selected workspace is not inside a Git repository." };
    }
    return { ok: true, scope, source: input.path ? `${rev}:${input.path}` : rev, diff: result.output };
  }

  const staged = scope === "staged" || input.staged === true;
  const result = await host.diff({ workspacePath, staged, path: input.path });
  if (!result.isRepo) {
    return { ok: false, code: "not_git_workspace", message: result.error ?? "Selected workspace is not inside a Git repository." };
  }

  return {
    ok: true,
    scope,
    source: input.path ? `${staged ? "staged" : "unstaged"}:${input.path}` : staged ? "staged diff" : "workspace diff",
    diff: result.diff
  };
}

function reviewDiff(input: {
  diff: string;
  maxFindings: number;
  scope: NonNullable<StructuredReviewInput["scope"]>;
  source: string;
  truncated: boolean;
}): StructuredReviewOutput {
  const parsed = parseUnifiedDiff(input.diff);
  const findings = [
    ...reviewAddedLines(parsed),
    ...reviewCoverage(parsed),
    ...(input.truncated ? [{
      severity: "info" as const,
      category: "coverage",
      message: "Review input was truncated before analysis.",
      recommendation: "Use a narrower path, staged scope, or artifact slice for complete review coverage."
    }] : [])
  ].slice(0, input.maxFindings);
  const findingCounts = countFindings(findings);
  const riskLevel = riskLevelFromCounts(findingCounts);
  const fileCount = parsed.files.length;
  const changedLines = parsed.files.reduce((sum, file) => sum + file.additions + file.deletions, 0);

  return {
    scope: input.scope,
    source: input.source,
    summary: summaryText(fileCount, changedLines, findingCounts, input.truncated),
    riskLevel,
    files: parsed.files.map((file) => ({
      path: file.path,
      additions: file.additions,
      deletions: file.deletions
    })),
    findings,
    findingCounts,
    reviewedDiffChars: input.diff.length,
    truncated: input.truncated
  };
}

type ParsedDiff = {
  files: Array<{
    path: string;
    additions: number;
    deletions: number;
    addedLines: Array<{ line: number; text: string }>;
  }>;
};

function parseUnifiedDiff(diff: string): ParsedDiff {
  const files: ParsedDiff["files"] = [];
  let current: ParsedDiff["files"][number] | null = null;
  let newLine = 0;

  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("diff --git ")) {
      current = {
        path: parseDiffGitPath(line) ?? "unknown",
        additions: 0,
        deletions: 0,
        addedLines: []
      };
      files.push(current);
      continue;
    }

    if (line.startsWith("+++ ")) {
      const path = normalizeDiffPath(line.slice(4));
      if (path && path !== "/dev/null") {
        if (!current) {
          current = { path, additions: 0, deletions: 0, addedLines: [] };
          files.push(current);
        } else {
          current.path = path;
        }
      }
      continue;
    }

    if (line.startsWith("@@")) {
      const match = /\+(\d+)/.exec(line);
      newLine = match ? Number(match[1]) : 0;
      continue;
    }

    if (!current) {
      continue;
    }

    if (line.startsWith("+") && !line.startsWith("+++")) {
      current.additions += 1;
      current.addedLines.push({ line: newLine || current.additions, text: line.slice(1) });
      newLine += 1;
      continue;
    }

    if (line.startsWith("-") && !line.startsWith("---")) {
      current.deletions += 1;
      continue;
    }

    if (!line.startsWith("\\") && newLine > 0) {
      newLine += 1;
    }
  }

  return { files };
}

function reviewAddedLines(diff: ParsedDiff): StructuredReviewFinding[] {
  const findings: StructuredReviewFinding[] = [];

  for (const file of diff.files) {
    for (const line of file.addedLines) {
      const text = line.text;
      const trimmed = text.trim();
      if (!trimmed) {
        continue;
      }

      pushIf(findings, /debugger\b/.test(trimmed), {
        severity: "critical",
        category: "debug",
        path: file.path,
        line: line.line,
        message: "Committed debugger statement.",
        evidence: trimmed,
        recommendation: "Remove the debugger statement before shipping."
      });
      pushIf(findings, /\b(console\.(log|debug|trace)|println!|printStackTrace)\b/.test(trimmed), {
        severity: "warning",
        category: "debug",
        path: file.path,
        line: line.line,
        message: "Added ad-hoc debug output.",
        evidence: trimmed,
        recommendation: "Remove debug output or route it through the project's logging mechanism."
      });
      pushIf(findings, /\b(describe|it|test)\.only\s*\(/.test(trimmed), {
        severity: "critical",
        category: "tests",
        path: file.path,
        line: line.line,
        message: "Focused test committed.",
        evidence: trimmed,
        recommendation: "Replace .only with the normal test call."
      });
      pushIf(findings, /\b(describe|it|test)\.skip\s*\(/.test(trimmed), {
        severity: "warning",
        category: "tests",
        path: file.path,
        line: line.line,
        message: "Skipped test added.",
        evidence: trimmed,
        recommendation: "Confirm this skip is temporary and tracked, or remove it."
      });
      pushIf(findings, /eslint-disable|ts-ignore|ts-nocheck|allow\(dead_code\)/.test(trimmed), {
        severity: "warning",
        category: "maintainability",
        path: file.path,
        line: line.line,
        message: "New diagnostic suppression added.",
        evidence: trimmed,
        recommendation: "Prefer fixing the underlying diagnostic or narrow the suppression."
      });
      pushIf(findings, /\b(any|unknown)\b\s*(?:[;=,)]|$)/.test(trimmed) && /\.(ts|tsx)$/.test(file.path), {
        severity: "info",
        category: "types",
        path: file.path,
        line: line.line,
        message: "Broad TypeScript type introduced.",
        evidence: trimmed,
        recommendation: "Use a narrower type when the shape is known."
      });
      pushIf(findings, secretLike(trimmed), {
        severity: "critical",
        category: "security",
        path: file.path,
        line: line.line,
        message: "Possible secret or credential added.",
        evidence: redactSecret(trimmed),
        recommendation: "Remove the secret from source and rotate it if it was real."
      });
      pushIf(findings, /\b(TODO|FIXME|HACK)\b/i.test(trimmed), {
        severity: "info",
        category: "maintenance",
        path: file.path,
        line: line.line,
        message: "New TODO/FIXME marker added.",
        evidence: trimmed,
        recommendation: "Ensure the follow-up is intentional and tracked."
      });
    }
  }

  return findings;
}

function reviewCoverage(diff: ParsedDiff): StructuredReviewFinding[] {
  const sourceChanges = diff.files.filter((file) => isSourcePath(file.path));
  const testChanges = diff.files.filter((file) => isTestPath(file.path));
  if (sourceChanges.length === 0 || testChanges.length > 0) {
    return [];
  }

  return [{
    severity: "warning",
    category: "tests",
    message: "Source files changed without nearby test changes in this diff.",
    evidence: sourceChanges.map((file) => file.path).slice(0, 8).join(", "),
    recommendation: "Run existing tests and add or update tests when behavior changed."
  }];
}

function isSourcePath(path: string) {
  return /\.(ts|tsx|js|jsx|rs|go|py|swift|kt|java|cs)$/.test(path) && !isTestPath(path);
}

function isTestPath(path: string) {
  return /(^|\/)(__tests__|tests?|spec)\//i.test(path) || /\.(test|spec)\.(ts|tsx|js|jsx|py|rs)$/.test(path);
}

function pushIf(findings: StructuredReviewFinding[], condition: boolean, finding: StructuredReviewFinding) {
  if (condition) {
    findings.push(finding);
  }
}

function secretLike(line: string) {
  return (
    /\b(api[_-]?key|secret|token|password|passwd|private[_-]?key)\b\s*[:=]\s*['"][^'"]{8,}/i.test(line) ||
    /\b(sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9_]{16,}|xox[baprs]-[A-Za-z0-9-]{16,})\b/.test(line)
  );
}

function redactSecret(line: string) {
  return line.replace(/(['"])([^'"]{4})[^'"]{4,}(['"])/g, "$1$2...[redacted]$3");
}

function countFindings(findings: StructuredReviewFinding[]): Record<StructuredReviewSeverity, number> {
  return {
    critical: findings.filter((finding) => finding.severity === "critical").length,
    warning: findings.filter((finding) => finding.severity === "warning").length,
    info: findings.filter((finding) => finding.severity === "info").length
  };
}

function riskLevelFromCounts(counts: Record<StructuredReviewSeverity, number>) {
  if (counts.critical > 0) {
    return "high";
  }
  if (counts.warning >= 3) {
    return "medium";
  }
  if (counts.warning > 0 || counts.info > 0) {
    return "low";
  }
  return "none";
}

function summaryText(
  fileCount: number,
  changedLines: number,
  counts: Record<StructuredReviewSeverity, number>,
  truncated: boolean
) {
  const findingText = `${counts.critical} critical, ${counts.warning} warning, ${counts.info} info`;
  const truncationText = truncated ? " Input was truncated." : "";
  return `Reviewed ${fileCount} files and ${changedLines} changed lines; findings: ${findingText}.${truncationText}`;
}

function parseDiffGitPath(line: string) {
  const match = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
  return match ? match[2] : null;
}

function normalizeDiffPath(path: string) {
  return path.replace(/^"|"$/g, "").replace(/^[ab]\//, "");
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
