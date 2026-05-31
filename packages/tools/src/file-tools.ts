import { z } from "zod";
import type { ToolSpec } from "./spec";

export interface FileToolHost {
  readText(input: { workspacePath: string; path: string }): Promise<ReadFileOutput>;
  listDir(input: { workspacePath: string; path: string }): Promise<ListDirOutput>;
  searchFiles(input: { workspacePath: string; path: string; query: string; maxResults?: number }): Promise<FileSearchOutput>;
  grepFiles(input: {
    workspacePath: string;
    path: string;
    pattern: string;
    caseSensitive?: boolean;
    maxResults?: number;
  }): Promise<GrepFilesOutput>;
  writeText(input: {
    workspacePath: string;
    path: string;
    content: string;
  }): Promise<WriteFileOutput>;
  deleteFile?(input: { workspacePath: string; path: string }): Promise<void>;
}

export interface ReadFileOutput {
  path: string;
  content: string;
}

export interface ListDirOutput {
  entries: Array<{
    name: string;
    path: string;
    isDir: boolean;
    size?: number;
  }>;
}

export interface WriteFileOutput {
  path: string;
  bytesWritten: number;
}

export interface FileSearchOutput {
  matches: Array<{
    path: string;
    name: string;
    isDir: boolean;
    size?: number;
  }>;
  truncated: boolean;
}

export interface GrepFilesOutput {
  matches: Array<{
    path: string;
    lineNumber: number;
    line: string;
    matchStart: number;
    matchEnd: number;
  }>;
  truncated: boolean;
}

export interface EditFileOutput {
  path: string;
  bytesWritten: number;
  replacements: number;
}

export interface ApplyPatchOutput {
  files: Array<{
    path: string;
    bytesWritten: number;
    hunksApplied: number;
  }>;
}

const PathInputSchema = z.object({
  path: z.string().min(1)
});

const FileSearchInputSchema = z.object({
  query: z.string().min(1),
  path: z.string().min(1).default("."),
  maxResults: z.number().int().positive().max(200).optional()
});

const GrepFilesInputSchema = z.object({
  pattern: z.string().min(1),
  path: z.string().min(1).default("."),
  caseSensitive: z.boolean().optional(),
  maxResults: z.number().int().positive().max(200).optional()
});

const WriteFileInputSchema = z.object({
  path: z.string().min(1),
  content: z.string()
});

const EditFileInputSchema = z.object({
  path: z.string().min(1),
  oldText: z.string().min(1),
  newText: z.string()
});

const ApplyPatchInputSchema = z.object({
  patch: z.string().min(1)
});

export function createReadFileTool(host: FileToolHost): ToolSpec<z.infer<typeof PathInputSchema>, ReadFileOutput> {
  return {
    name: "read_file",
    description: "Read a UTF-8 text file from the selected workspace.",
    capability: "readonly",
    approval: "never",
    inputSchema: PathInputSchema,
    async execute(input, context) {
      const output = await host.readText({ workspacePath: context.workspacePath, path: input.path });
      return {
        callId: "read_file",
        ok: true,
        output
      };
    }
  };
}

export function createListDirTool(host: FileToolHost): ToolSpec<z.infer<typeof PathInputSchema>, ListDirOutput> {
  return {
    name: "list_dir",
    description: "List entries in a directory under the selected workspace.",
    capability: "readonly",
    approval: "never",
    inputSchema: PathInputSchema,
    async execute(input, context) {
      const output = await host.listDir({ workspacePath: context.workspacePath, path: input.path });
      return {
        callId: "list_dir",
        ok: true,
        output
      };
    }
  };
}

export function createFileSearchTool(
  host: FileToolHost
): ToolSpec<z.infer<typeof FileSearchInputSchema>, FileSearchOutput> {
  return {
    name: "file_search",
    description: "Find files or directories by path/name under the selected workspace.",
    capability: "readonly",
    approval: "never",
    inputSchema: FileSearchInputSchema,
    async execute(input, context) {
      const output = await host.searchFiles({
        workspacePath: context.workspacePath,
        path: input.path,
        query: input.query,
        maxResults: input.maxResults
      });
      return {
        callId: "file_search",
        ok: true,
        output
      };
    }
  };
}

export function createGrepFilesTool(
  host: FileToolHost
): ToolSpec<z.infer<typeof GrepFilesInputSchema>, GrepFilesOutput> {
  return {
    name: "grep_files",
    description: "Search UTF-8 text files by content under the selected workspace.",
    capability: "readonly",
    approval: "never",
    inputSchema: GrepFilesInputSchema,
    async execute(input, context) {
      const output = await host.grepFiles({
        workspacePath: context.workspacePath,
        path: input.path,
        pattern: input.pattern,
        caseSensitive: input.caseSensitive,
        maxResults: input.maxResults
      });
      return {
        callId: "grep_files",
        ok: true,
        output
      };
    }
  };
}

export function createWriteFileTool(
  host: FileToolHost
): ToolSpec<z.infer<typeof WriteFileInputSchema>, WriteFileOutput> {
  return {
    name: "write_file",
    description: "Create or overwrite a UTF-8 text file under the selected workspace.",
    capability: "workspace-write",
    approval: "suggest",
    inputSchema: WriteFileInputSchema,
    async execute(input, context) {
      const output = await host.writeText({
        workspacePath: context.workspacePath,
        path: input.path,
        content: input.content
      });
      return {
        callId: "write_file",
        ok: true,
        output
      };
    }
  };
}

export function createEditFileTool(host: FileToolHost): ToolSpec<z.infer<typeof EditFileInputSchema>, EditFileOutput> {
  return {
    name: "edit_file",
    description: "Replace one exact, uniquely matching text range in a UTF-8 file under the selected workspace.",
    capability: "workspace-write",
    approval: "suggest",
    inputSchema: EditFileInputSchema,
    async execute(input, context) {
      const current = await host.readText({ workspacePath: context.workspacePath, path: input.path });
      const matches = countOccurrences(current.content, input.oldText);

      if (matches !== 1) {
        return {
          callId: "edit_file",
          ok: false,
          error: {
            code: matches === 0 ? "old_text_not_found" : "old_text_not_unique",
            message:
              matches === 0
                ? `oldText was not found in ${input.path}.`
                : `oldText matched ${matches} times in ${input.path}; edit_file requires exactly one match.`
          }
        };
      }

      const nextContent = current.content.replace(input.oldText, input.newText);
      const output = await host.writeText({
        workspacePath: context.workspacePath,
        path: input.path,
        content: nextContent
      });

      return {
        callId: "edit_file",
        ok: true,
        output: {
          path: output.path,
          bytesWritten: output.bytesWritten,
          replacements: 1
        }
      };
    }
  };
}

export function createApplyPatchTool(
  host: FileToolHost
): ToolSpec<z.infer<typeof ApplyPatchInputSchema>, ApplyPatchOutput> {
  return {
    name: "apply_patch",
    description: "Apply a unified diff patch to existing UTF-8 files under the selected workspace.",
    capability: "workspace-write",
    approval: "suggest",
    inputSchema: ApplyPatchInputSchema,
    async execute(input, context) {
      const patch = parseUnifiedPatch(input.patch);
      if (!patch.ok) {
        return {
          callId: "apply_patch",
          ok: false,
          error: patch.error
        };
      }

      const files = [];
      for (const filePatch of patch.files) {
        const current = await host.readText({ workspacePath: context.workspacePath, path: filePatch.path });
        const applied = applyFilePatch(current.content, filePatch);
        if (!applied.ok) {
          return {
            callId: "apply_patch",
            ok: false,
            error: applied.error
          };
        }

        const written = await host.writeText({
          workspacePath: context.workspacePath,
          path: filePatch.path,
          content: applied.content
        });
        files.push({
          path: written.path,
          bytesWritten: written.bytesWritten,
          hunksApplied: filePatch.hunks.length
        });
      }

      return {
        callId: "apply_patch",
        ok: true,
        output: { files }
      };
    }
  };
}

export function createFileTools(host: FileToolHost): ToolSpec[] {
  return [
    createReadFileTool(host),
    createListDirTool(host),
    createFileSearchTool(host),
    createGrepFilesTool(host),
    createWriteFileTool(host),
    createEditFileTool(host),
    createApplyPatchTool(host)
  ];
}

function countOccurrences(content: string, needle: string): number {
  let count = 0;
  let index = 0;
  while (true) {
    index = content.indexOf(needle, index);
    if (index === -1) {
      return count;
    }
    count += 1;
    index += needle.length;
  }
}

interface ParsedPatchFile {
  path: string;
  hunks: ParsedHunk[];
}

interface ParsedHunk {
  oldStart: number;
  lines: string[];
}

type PatchParseResult =
  | { ok: true; files: ParsedPatchFile[] }
  | { ok: false; error: { code: string; message: string; detail?: unknown } };

type PatchApplyResult =
  | { ok: true; content: string }
  | { ok: false; error: { code: string; message: string; detail?: unknown } };

function parseUnifiedPatch(patch: string): PatchParseResult {
  const lines = patch.replace(/\r\n/g, "\n").split("\n");
  const files: ParsedPatchFile[] = [];
  let index = 0;

  while (index < lines.length) {
    if (!lines[index].startsWith("--- ")) {
      index += 1;
      continue;
    }

    const oldPath = parsePatchPath(lines[index]);
    const nextLine = lines[index + 1];
    if (!nextLine?.startsWith("+++ ")) {
      return {
        ok: false,
        error: { code: "invalid_patch_header", message: "Unified patch file header must include --- and +++ lines." }
      };
    }

    const newPath = parsePatchPath(nextLine);
    if (oldPath === "/dev/null" || newPath === "/dev/null") {
      return {
        ok: false,
        error: {
          code: "unsupported_patch_file_operation",
          message: "apply_patch currently supports modifying existing files only."
        }
      };
    }

    const filePatch: ParsedPatchFile = { path: stripDiffPrefix(newPath), hunks: [] };
    index += 2;

    while (index < lines.length && !lines[index].startsWith("--- ")) {
      if (!lines[index].startsWith("@@")) {
        index += 1;
        continue;
      }

      const header = lines[index].match(/^@@ -(\d+)(?:,\d+)? \+\d+(?:,\d+)? @@/);
      if (!header) {
        return {
          ok: false,
          error: { code: "invalid_hunk_header", message: `Invalid unified patch hunk header: ${lines[index]}` }
        };
      }

      const hunk: ParsedHunk = { oldStart: Number(header[1]), lines: [] };
      index += 1;

      while (index < lines.length && !lines[index].startsWith("@@") && !lines[index].startsWith("--- ")) {
        const line = lines[index];
        if (line === "" && index === lines.length - 1) {
          index += 1;
          break;
        }
        if (line === "\\ No newline at end of file") {
          index += 1;
          continue;
        }
        if (!line.startsWith(" ") && !line.startsWith("-") && !line.startsWith("+")) {
          return {
            ok: false,
            error: { code: "invalid_hunk_line", message: `Invalid unified patch hunk line: ${line}` }
          };
        }
        hunk.lines.push(line);
        index += 1;
      }

      filePatch.hunks.push(hunk);
    }

    if (filePatch.hunks.length === 0) {
      return {
        ok: false,
        error: { code: "patch_without_hunks", message: `Patch for ${filePatch.path} does not contain any hunks.` }
      };
    }

    files.push(filePatch);
  }

  if (files.length === 0) {
    return {
      ok: false,
      error: { code: "patch_without_files", message: "Unified patch does not contain any file patches." }
    };
  }

  return { ok: true, files };
}

function applyFilePatch(content: string, patch: ParsedPatchFile): PatchApplyResult {
  const lineEnding = detectLineEnding(content);
  const hadFinalLineEnding = hasFinalLineEnding(content);
  const lines = normalizeLineEndings(content).split("\n");
  if (hadFinalLineEnding) {
    lines.pop();
  }

  let lineOffset = 0;
  for (const hunk of patch.hunks) {
    const oldLines = [];
    const newLines = [];
    for (const line of hunk.lines) {
      const text = line.slice(1);
      if (line.startsWith(" ")) {
        oldLines.push(text);
        newLines.push(text);
      }
      if (line.startsWith("-")) {
        oldLines.push(text);
      }
      if (line.startsWith("+")) {
        newLines.push(text);
      }
    }

    const start = hunk.oldStart - 1 + lineOffset;
    const actual = lines.slice(start, start + oldLines.length);
    if (!arraysEqual(actual, oldLines)) {
      return {
        ok: false,
        error: {
          code: "hunk_context_mismatch",
          message: `Patch hunk did not match ${patch.path} at line ${hunk.oldStart}.`,
          detail: { expected: oldLines, actual }
        }
      };
    }

    lines.splice(start, oldLines.length, ...newLines);
    lineOffset += newLines.length - oldLines.length;
  }

  return {
    ok: true,
    content: restoreLineEndings(lines.join("\n") + (hadFinalLineEnding ? "\n" : ""), lineEnding)
  };
}

function normalizeLineEndings(content: string) {
  return content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function restoreLineEndings(content: string, lineEnding: string) {
  return lineEnding === "\n" ? content : content.replace(/\n/g, lineEnding);
}

function hasFinalLineEnding(content: string) {
  return content.endsWith("\n") || content.endsWith("\r");
}

function detectLineEnding(content: string) {
  let crlf = 0;
  let lf = 0;
  let cr = 0;
  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    if (char === "\r" && content[index + 1] === "\n") {
      crlf += 1;
      index += 1;
    } else if (char === "\r") {
      cr += 1;
    } else if (char === "\n") {
      lf += 1;
    }
  }

  if (crlf > 0 && crlf >= lf && crlf >= cr) {
    return "\r\n";
  }
  if (cr > 0 && cr > lf) {
    return "\r";
  }
  return "\n";
}

function parsePatchPath(line: string): string {
  return line.slice(4).trim().split(/\s+/)[0];
}

function stripDiffPrefix(path: string): string {
  return path.replace(/^[ab]\//, "");
}

function arraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}
