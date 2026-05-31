import { z } from "zod";
import type { FileToolHost } from "./file-tools";
import type { ToolSpec } from "./spec";

const LocationInputSchema = z.object({
  path: z.string().min(1),
  line: z.number().int().positive().optional(),
  column: z.number().int().positive().optional(),
  symbol: z.string().min(1).optional()
});

const SymbolSearchInputSchema = z.object({
  symbol: z.string().min(1),
  path: z.string().min(1).default("."),
  maxResults: z.number().int().positive().max(100).optional()
});

const DocumentSymbolsInputSchema = z.object({
  path: z.string().min(1),
  maxSymbols: z.number().int().positive().max(500).optional()
});

export interface LspLocation {
  path: string;
  line: number;
  column?: number;
  preview: string;
}

export interface LspSymbol {
  name: string;
  kind: string;
  path: string;
  line: number;
  column: number;
  containerName?: string;
  preview: string;
}

export interface LspHoverOutput {
  symbol: string;
  path: string;
  line?: number;
  column?: number;
  contents: string;
  definitions: LspLocation[];
}

export interface LspLocationsOutput {
  symbol: string;
  locations: LspLocation[];
  truncated: boolean;
}

export interface LspDocumentSymbolsOutput {
  path: string;
  symbols: LspSymbol[];
  truncated: boolean;
}

export function createLspNavigationTools(host: FileToolHost): ToolSpec[] {
  return [
    createLspHoverTool(host),
    createLspDefinitionTool(host),
    createLspReferencesTool(host),
    createLspDocumentSymbolsTool(host)
  ];
}

export function createLspHoverTool(host: FileToolHost): ToolSpec<z.infer<typeof LocationInputSchema>, LspHoverOutput> {
  return {
    name: "lsp_hover",
    description: "Return best-effort hover information for a symbol at a file location.",
    capability: "readonly",
    approval: "never",
    inputSchema: LocationInputSchema,
    async execute(input, context) {
      const file = await host.readText({ workspacePath: context.workspacePath, path: input.path });
      const symbol = input.symbol ?? symbolAt(file.content, input.line, input.column) ?? "";
      const definitions = symbol
        ? await findDefinitions(host, context.workspacePath, symbol, ".", 5)
        : [];
      return {
        callId: "lsp_hover",
        ok: true,
        output: {
          symbol,
          path: input.path,
          line: input.line,
          column: input.column,
          contents: symbol ? `Symbol \`${symbol}\` in ${input.path}${input.line ? `:${input.line}` : ""}.` : "No symbol resolved at the requested location.",
          definitions
        }
      };
    }
  };
}

export function createLspDefinitionTool(host: FileToolHost): ToolSpec<z.infer<typeof SymbolSearchInputSchema>, LspLocationsOutput> {
  return {
    name: "lsp_definition",
    description: "Find best-effort definition locations for a symbol using project text search.",
    capability: "readonly",
    approval: "never",
    inputSchema: SymbolSearchInputSchema,
    async execute(input, context) {
      const maxResults = input.maxResults ?? 20;
      const locations = await findDefinitions(host, context.workspacePath, input.symbol, input.path, maxResults);
      return {
        callId: "lsp_definition",
        ok: true,
        output: {
          symbol: input.symbol,
          locations,
          truncated: locations.length >= maxResults
        }
      };
    }
  };
}

export function createLspReferencesTool(host: FileToolHost): ToolSpec<z.infer<typeof SymbolSearchInputSchema>, LspLocationsOutput> {
  return {
    name: "lsp_references",
    description: "Find best-effort symbol references using project text search.",
    capability: "readonly",
    approval: "never",
    inputSchema: SymbolSearchInputSchema,
    async execute(input, context) {
      const maxResults = input.maxResults ?? 50;
      const grep = await host.grepFiles({
        workspacePath: context.workspacePath,
        path: input.path,
        pattern: `\\b${escapeRegExp(input.symbol)}\\b`,
        maxResults
      });
      return {
        callId: "lsp_references",
        ok: true,
        output: {
          symbol: input.symbol,
          locations: grep.matches.map((match) => ({
            path: match.path,
            line: match.lineNumber,
            column: match.matchStart + 1,
            preview: match.line
          })),
          truncated: grep.truncated
        }
      };
    }
  };
}

export function createLspDocumentSymbolsTool(host: FileToolHost): ToolSpec<z.infer<typeof DocumentSymbolsInputSchema>, LspDocumentSymbolsOutput> {
  return {
    name: "lsp_document_symbols",
    description: "Extract best-effort document symbols from a source file.",
    capability: "readonly",
    approval: "never",
    inputSchema: DocumentSymbolsInputSchema,
    async execute(input, context) {
      const file = await host.readText({ workspacePath: context.workspacePath, path: input.path });
      const symbols = extractDocumentSymbols(input.path, file.content);
      const maxSymbols = input.maxSymbols ?? 200;
      return {
        callId: "lsp_document_symbols",
        ok: true,
        output: {
          path: input.path,
          symbols: symbols.slice(0, maxSymbols),
          truncated: symbols.length > maxSymbols
        }
      };
    }
  };
}

async function findDefinitions(
  host: FileToolHost,
  workspacePath: string,
  symbol: string,
  path: string,
  maxResults: number
): Promise<LspLocation[]> {
  const grep = await host.grepFiles({
    workspacePath,
    path,
    pattern: definitionPattern(symbol),
    maxResults
  });
  return grep.matches.map((match) => ({
    path: match.path,
    line: match.lineNumber,
    column: match.matchStart + 1,
    preview: match.line
  }));
}

function extractDocumentSymbols(path: string, content: string): LspSymbol[] {
  const symbols: LspSymbol[] = [];
  const patterns: Array<{ kind: string; pattern: RegExp }> = [
    { kind: "class", pattern: /\b(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/ },
    { kind: "interface", pattern: /\b(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/ },
    { kind: "type", pattern: /\b(?:export\s+)?type\s+([A-Za-z_$][\w$]*)/ },
    { kind: "function", pattern: /\b(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/ },
    { kind: "variable", pattern: /\b(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/ },
    { kind: "rust", pattern: /\b(?:pub\s+)?(?:fn|struct|enum|trait)\s+([A-Za-z_][\w]*)/ },
    { kind: "python", pattern: /^\s*(?:def|class)\s+([A-Za-z_][\w]*)/ }
  ];
  for (const [index, line] of content.split(/\r?\n/).entries()) {
    for (const item of patterns) {
      const match = item.pattern.exec(line);
      if (match) {
        symbols.push({
          name: match[1],
          kind: item.kind,
          path,
          line: index + 1,
          column: match.index + 1,
          preview: line.trim()
        });
        break;
      }
    }
  }
  return symbols;
}

function symbolAt(content: string, line: number | undefined, column: number | undefined) {
  if (!line) {
    return null;
  }
  const text = content.split(/\r?\n/)[line - 1] ?? "";
  const index = Math.max(0, (column ?? 1) - 1);
  const left = text.slice(0, index + 1).match(/[A-Za-z_$][\w$]*$/)?.[0] ?? "";
  const right = text.slice(index + 1).match(/^[\w$]*/)?.[0] ?? "";
  const symbol = `${left}${right}`;
  return symbol || null;
}

function definitionPattern(symbol: string) {
  const escaped = escapeRegExp(symbol);
  return `\\b(?:function|class|interface|type|const|let|var|def|struct|enum|trait|fn)\\s+${escaped}\\b|\\b${escaped}\\s*=`;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
