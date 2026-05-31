import { describe, expect, it } from "vitest";
import { executeRegisteredTool } from "./executor";
import { EchoTool } from "./builtin";
import { ToolRegistry } from "./registry";
import { createToolSearchTool, type ToolSearchOutput } from "./tool-search";
import { createValidateDataTool } from "./validate-data";
import type { FileToolHost } from "./file-tools";
import type { ToolContext } from "./spec";

const context: ToolContext = {
  workspacePath: "/workspace",
  mode: "agent",
  trustedWorkspace: false
};

describe("tool_search tool", () => {
  it("searches registered tools by name and description", async () => {
    const registry = new ToolRegistry();
    registry.register(EchoTool);
    registry.register(createValidateDataTool(makeHost()));
    registry.register(createToolSearchTool(registry));

    const result = await executeRegisteredTool(registry, "tool_search", { query: "validate json" }, context);

    expect(result.type).toBe("completed");
    if (result.type === "completed") {
      const output = result.result.output as ToolSearchOutput;
      expect(output).toMatchObject({
        query: "validate json",
        totalTools: 3
      });
      expect(output.results[0]).toMatchObject({
        name: "validate_data",
        capability: "readonly"
      });
    }
  });

  it("filters by capability", async () => {
    const registry = new ToolRegistry();
    registry.register(EchoTool);
    registry.register(createToolSearchTool(registry));

    const result = await executeRegisteredTool(registry, "tool_search", { capability: "readonly" }, context);

    expect(result.type).toBe("completed");
    if (result.type === "completed") {
      const output = result.result.output as ToolSearchOutput;
      expect(output.results.map((tool) => tool.name)).toEqual(["echo", "tool_search"]);
    }
  });
});

function makeHost(): FileToolHost {
  return {
    async readText(input) {
      return { path: input.path, content: "{}" };
    },
    async listDir() {
      return { entries: [] };
    },
    async searchFiles() {
      return { matches: [], truncated: false };
    },
    async grepFiles() {
      return { matches: [], truncated: false };
    },
    async writeText(input) {
      return { path: input.path, bytesWritten: input.content.length };
    }
  };
}
