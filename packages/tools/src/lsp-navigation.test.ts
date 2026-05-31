import { describe, expect, it } from "vitest";
import { executeRegisteredTool } from "./executor";
import type { FileToolHost, GrepFilesOutput } from "./file-tools";
import {
  createLspDefinitionTool,
  createLspDocumentSymbolsTool,
  createLspHoverTool,
  createLspReferencesTool
} from "./lsp-navigation";
import { ToolRegistry } from "./registry";
import type { ToolContext } from "./spec";

const context: ToolContext = {
  workspacePath: "/workspace",
  mode: "agent",
  trustedWorkspace: false
};

describe("LSP navigation tools", () => {
  it("extracts document symbols from source files", async () => {
    const result = await executeRegisteredTool(
      registryWithLspTools(memoryHost({
        "src/app.ts": "export function run() {}\nclass Worker {}\nconst value = 1;\n"
      })),
      "lsp_document_symbols",
      { path: "src/app.ts" },
      context
    );

    expect(result.type).toBe("completed");
    if (result.type === "completed") {
      expect(result.result.output).toMatchObject({
        path: "src/app.ts",
        symbols: [
          { name: "run", kind: "function", line: 1 },
          { name: "Worker", kind: "class", line: 2 },
          { name: "value", kind: "variable", line: 3 }
        ]
      });
    }
  });

  it("finds definitions and references through grep", async () => {
    const registry = registryWithLspTools(memoryHost({
      "src/app.ts": "export function run() {}\nrun();\n"
    }));

    await expect(executeRegisteredTool(registry, "lsp_definition", { symbol: "run", path: "src" }, context))
      .resolves.toMatchObject({ type: "completed", result: { output: { locations: [{ path: "src/app.ts", line: 1 }] } } });
    await expect(executeRegisteredTool(registry, "lsp_references", { symbol: "run", path: "src" }, context))
      .resolves.toMatchObject({ type: "completed", result: { output: { locations: [{ path: "src/app.ts", line: 1 }, { path: "src/app.ts", line: 2 }] } } });
  });

  it("returns hover content for a location", async () => {
    const result = await executeRegisteredTool(
      registryWithLspTools(memoryHost({
        "src/app.ts": "const value = 1;\nconsole.log(value);\n"
      })),
      "lsp_hover",
      { path: "src/app.ts", line: 2, column: 13 },
      context
    );

    expect(result.type).toBe("completed");
    if (result.type === "completed") {
      expect(result.result.output).toMatchObject({
        symbol: "value",
        contents: "Symbol `value` in src/app.ts:2."
      });
    }
  });
});

function registryWithLspTools(host: FileToolHost) {
  const registry = new ToolRegistry();
  registry.register(createLspHoverTool(host));
  registry.register(createLspDefinitionTool(host));
  registry.register(createLspReferencesTool(host));
  registry.register(createLspDocumentSymbolsTool(host));
  return registry;
}

function memoryHost(files: Record<string, string>): FileToolHost {
  return {
    async readText(input) {
      return { path: input.path, content: files[input.path] ?? "" };
    },
    async listDir() {
      return { entries: [] };
    },
    async searchFiles() {
      return { matches: [], truncated: false };
    },
    async grepFiles(input): Promise<GrepFilesOutput> {
      const pattern = new RegExp(input.pattern);
      const matches: GrepFilesOutput["matches"] = [];
      for (const [path, content] of Object.entries(files)) {
        if (input.path !== "." && !path.startsWith(input.path)) continue;
        for (const [index, line] of content.split(/\r?\n/).entries()) {
          const match = pattern.exec(line);
          if (match) {
            matches.push({
              path,
              lineNumber: index + 1,
              line,
              matchStart: match.index,
              matchEnd: match.index + match[0].length
            });
          }
        }
      }
      return { matches, truncated: false };
    },
    async writeText(input) {
      return { path: input.path, bytesWritten: input.content.length };
    }
  };
}
