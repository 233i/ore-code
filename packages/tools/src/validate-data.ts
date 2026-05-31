import { parse as parseToml } from "smol-toml";
import { z } from "zod";
import type { FileToolHost } from "./file-tools";
import type { ToolSpec } from "./spec";

const ValidateDataInputSchema = z.object({
  format: z.enum(["json", "toml", "yaml"]).optional(),
  path: z.string().min(1).optional(),
  content: z.string().optional()
}).refine((input) => input.path || input.content !== undefined, {
  message: "path or content is required"
});

export type ValidateDataFormat = "json" | "toml" | "yaml";
export type ValidateDataInput = z.infer<typeof ValidateDataInputSchema>;

export interface ValidateDataIssue {
  message: string;
  line?: number;
  column?: number;
}

export interface ValidateDataOutput {
  valid: boolean;
  format: ValidateDataFormat;
  path?: string;
  summary: string;
  errors: ValidateDataIssue[];
  warnings: ValidateDataIssue[];
  topLevelType?: string;
  keyCount?: number;
}

export function createValidateDataTool(host: FileToolHost): ToolSpec<ValidateDataInput, ValidateDataOutput> {
  return {
    name: "validate_data",
    description: "Validate JSON, TOML, or YAML content from an explicit string or workspace file path.",
    capability: "readonly",
    approval: "never",
    inputSchema: ValidateDataInputSchema,
    modelParameters: {
      type: "object",
      properties: {
        format: {
          type: "string",
          enum: ["json", "toml", "yaml"],
          description: "Data format. If omitted, inferred from path extension."
        },
        path: {
          type: "string",
          description: "Workspace file path to validate."
        },
        content: {
          type: "string",
          description: "Inline content to validate. Overrides path content when both are provided."
        }
      }
    },
    async execute(input, context) {
      const content = input.content ?? (await host.readText({
        workspacePath: context.workspacePath,
        path: input.path ?? ""
      })).content;
      const format = input.format ?? inferFormat(input.path);
      const result = validateContent(content, format);

      return {
        callId: "validate_data",
        ok: true,
        output: {
          ...result,
          ...(input.path ? { path: input.path } : {})
        }
      };
    }
  };
}

function validateContent(content: string, format: ValidateDataFormat): Omit<ValidateDataOutput, "path"> {
  try {
    const parsed = parseContent(content, format);
    const topLevelType = topLevelTypeOf(parsed);
    const keyCount = keyCountOf(parsed);
    return {
      valid: true,
      format,
      summary: `${format.toUpperCase()} is valid${topLevelType ? ` (${topLevelType})` : ""}.`,
      errors: [],
      warnings: yamlWarnings(content, format),
      topLevelType,
      ...(keyCount !== undefined ? { keyCount } : {})
    };
  } catch (error) {
    const issue = issueFromError(error);
    return {
      valid: false,
      format,
      summary: `${format.toUpperCase()} is invalid: ${issue.message}`,
      errors: [issue],
      warnings: []
    };
  }
}

function parseContent(content: string, format: ValidateDataFormat): unknown {
  switch (format) {
    case "json":
      return JSON.parse(content) as unknown;
    case "toml":
      return parseToml(content);
    case "yaml":
      return parseYamlSubset(content);
  }
}

function parseYamlSubset(content: string): unknown {
  const root: Record<string, unknown> | unknown[] = firstContentLine(content)?.trim().startsWith("- ") ? [] : {};
  const stack: Array<{ indent: number; container: Record<string, unknown> | unknown[] }> = [{ indent: -1, container: root }];
  let sawContent = false;

  for (const [index, rawLine] of content.replace(/\r\n/g, "\n").split("\n").entries()) {
    const lineNumber = index + 1;
    const withoutComment = stripYamlComment(rawLine);
    if (!withoutComment.trim() || withoutComment.trim() === "---" || withoutComment.trim() === "...") {
      continue;
    }
    if (/^\t+/.test(withoutComment)) {
      throw yamlError("Tabs are not allowed for YAML indentation.", lineNumber, 1);
    }
    const indent = leadingSpaces(withoutComment);
    const trimmed = withoutComment.trim();
    sawContent = true;

    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }
    if (stack.length === 1 && indent > 0) {
      throw yamlError("Unexpected indentation without a parent key.", lineNumber, indent + 1);
    }
    const parent = stack[stack.length - 1].container;

    if (trimmed.startsWith("- ")) {
      if (!Array.isArray(parent)) {
        throw yamlError("List item is not inside a list value.", lineNumber, indent + 1);
      }
      const item = trimmed.slice(2).trim();
      if (!item) {
        const child: Record<string, unknown> = {};
        parent.push(child);
        stack.push({ indent, container: child });
      } else {
        parent.push(parseScalar(item, lineNumber, indent + 3));
      }
      continue;
    }

    const keyMatch = /^([^:[\]{}#][^:]*)\s*:(?:\s*(.*))?$/.exec(trimmed);
    if (!keyMatch) {
      throw yamlError("Expected a key/value pair such as key: value.", lineNumber, indent + 1);
    }
    if (Array.isArray(parent)) {
      throw yamlError("Mapping entry cannot be directly nested under a scalar list item.", lineNumber, indent + 1);
    }

    const key = keyMatch[1].trim();
    const value = keyMatch[2] ?? "";
    if (!key) {
      throw yamlError("YAML key cannot be empty.", lineNumber, indent + 1);
    }
    if (Object.prototype.hasOwnProperty.call(parent, key)) {
      throw yamlError(`Duplicate key "${key}".`, lineNumber, indent + 1);
    }

    if (!value.trim()) {
      const nextContainer = nextIndentedContainer(content, index, indent);
      parent[key] = nextContainer;
      stack.push({ indent, container: nextContainer });
    } else {
      parent[key] = parseScalar(value.trim(), lineNumber, indent + keyMatch[0].indexOf(value) + 1);
    }
  }

  if (!sawContent) {
    throw yamlError("YAML content is empty.", 1, 1);
  }

  return root;
}

function parseScalar(value: string, line: number, column: number): unknown {
  if (value === "null" || value === "~") return null;
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  if (value.startsWith("[") || value.startsWith("{")) {
    try {
      return JSON.parse(value.replace(/'/g, "\""));
    } catch {
      throw yamlError("Inline collection is not valid JSON-compatible YAML.", line, column);
    }
  }
  if (/[{}\[\]]/.test(value)) {
    throw yamlError("Unquoted scalar contains collection punctuation.", line, column);
  }
  return value;
}

function nextIndentedContainer(content: string, currentIndex: number, indent: number): Record<string, unknown> | unknown[] {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  for (let index = currentIndex + 1; index < lines.length; index += 1) {
    const line = stripYamlComment(lines[index]);
    if (!line.trim()) continue;
    if (leadingSpaces(line) <= indent) break;
    return line.trim().startsWith("- ") ? [] : {};
  }
  return {};
}

function stripYamlComment(line: string) {
  let quote: "\"" | "'" | null = null;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if ((char === "\"" || char === "'") && (index === 0 || line[index - 1] !== "\\")) {
      quote = quote === char ? null : quote ?? char;
    }
    if (char === "#" && quote === null && (index === 0 || /\s/.test(line[index - 1]))) {
      return line.slice(0, index);
    }
  }
  return line;
}

function yamlWarnings(content: string, format: ValidateDataFormat): ValidateDataIssue[] {
  if (format !== "yaml") {
    return [];
  }
  return content.includes("\t")
    ? [{ message: "YAML contains tab characters; spaces are recommended for indentation." }]
    : [];
}

function firstContentLine(content: string) {
  return content
    .replace(/\r\n/g, "\n")
    .split("\n")
    .find((line) => stripYamlComment(line).trim() && stripYamlComment(line).trim() !== "---");
}

function inferFormat(path: string | undefined): ValidateDataFormat {
  if (!path) {
    return "json";
  }
  if (/\.ya?ml$/i.test(path)) return "yaml";
  if (/\.toml$/i.test(path)) return "toml";
  return "json";
}

function issueFromError(error: unknown): ValidateDataIssue {
  const message = error instanceof Error ? error.message : String(error);
  const location = /(?:line|position)\s+(\d+)(?:[,:]\s*(?:column|col)\s+(\d+))?/i.exec(message);
  return {
    message,
    ...(location ? { line: Number(location[1]), ...(location[2] ? { column: Number(location[2]) } : {}) } : {})
  };
}

function yamlError(message: string, line: number, column: number) {
  return new Error(`${message} at line ${line}, column ${column}`);
}

function leadingSpaces(value: string) {
  return value.match(/^ */)?.[0].length ?? 0;
}

function topLevelTypeOf(value: unknown) {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value === "object" ? "object" : typeof value;
}

function keyCountOf(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? Object.keys(value).length : undefined;
}
